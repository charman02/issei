import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import get_current_user
from app.config import settings
from app.models.user import User
from app.models.push_subscription import PushSubscription
from app.models.post import Post
from app.models.recipe import Recipe
from app.models.notification import Notification
from app.schemas.notification import (
    MarkReadRequest,
    NotificationList,
    NotificationResponse,
)
from app.schemas.push import (
    PushSubscriptionIn,
    PushSubscriptionRotate,
    VapidKeyResponse,
)
from app.services import prompt, push, rate_limit
from app.services.notifications import ANONYMOUS_TYPES, mark_read, unread_count

router = APIRouter(prefix="/notifications", tags=["notifications"])

# Page size. Same reasoning as the feed's: one request must not pull an unbounded history
# onto a phone.
PAGE = 30


@router.get("", response_model=NotificationList)
def list_notifications(
    before_id: int | None = Query(
        default=None,
        description="Keyset cursor — return notifications with an id BELOW this. Ids are "
        "monotonic and rows are never backdated, so id ordering is creation ordering.",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The caller's inbox, newest first, with the unread count.

    Scoped to `user_id == current_user.id` and nothing else — a notification is addressed to
    exactly one person, so there is no visibility question to get wrong here, only a scope
    one. Keyset-paginated on `id` rather than `created_at` for the same reason the feed is:
    SQLite stores second-granularity timestamps and ties mis-order.

    Resolves the actor's name and the subject (the dish) in bulk, so the list renders as
    sentences without the client fetching each referenced object. A reference the row has
    since lost — the post or recipe was deleted, and the FK SET NULL'd — simply comes back
    without a link; the line still reads, because the fact that it happened is still true.
    """
    q = db.query(Notification).filter(Notification.user_id == current_user.id)
    if before_id is not None:
        q = q.filter(Notification.id < before_id)
    rows = q.order_by(Notification.id.desc()).limit(PAGE).all()

    actor_ids = {r.actor_id for r in rows if r.actor_id is not None}
    actors = (
        {u.id: u for u in db.query(User).filter(User.id.in_(actor_ids))} if actor_ids else {}
    )
    post_ids = {r.post_id for r in rows if r.post_id is not None}
    posts = (
        {p.id: p for p in db.query(Post).filter(Post.id.in_(post_ids))} if post_ids else {}
    )
    recipe_ids = {r.recipe_id for r in rows if r.recipe_id is not None}
    recipes = (
        {r.id: r for r in db.query(Recipe).filter(Recipe.id.in_(recipe_ids))}
        if recipe_ids
        else {}
    )

    out = []
    for r in rows:
        actor = actors.get(r.actor_id) if r.actor_id else None
        # Prefer the recipe's name when there is one (a fulfilment is about the recipe);
        # otherwise the dish the post named.
        subject = None
        if r.recipe_id in recipes:
            subject = recipes[r.recipe_id].name
        elif r.post_id in posts:
            subject = posts[r.post_id].dish_name
        # ANONYMOUS BY TYPE (#96). A `recipe_kept` line must never say WHO kept it: the
        # decision is that the cook learns how many, never who — keeping is a bookmark
        # addressed to nobody, and naming the keeper would change what keeping means. The row
        # DOES store actor_id, because notify() needs it for the never-notify-yourself check
        # and for dedupe, so the suppression has to happen here on the way out. Pinned by its
        # own test: a UI that merely declines to render the name would still be shipping it
        # over the wire.
        anon = r.type in ANONYMOUS_TYPES
        out.append(
            NotificationResponse(
                id=r.id,
                type=r.type,
                actor_id=None if anon else r.actor_id,
                actor_first_name=None if anon else (actor.first_name if actor else None),
                actor_last_name=None if anon else (actor.last_name if actor else None),
                actor_photo_url=None if anon else (actor.photo_url if actor else None),
                # Only link a post/recipe the client can actually open. A recipe reference
                # is safe by construction here (a fulfilment means the recipient holds a
                # grant), but a soft-deleted recipe must not produce a dead link.
                post_id=r.post_id if r.post_id in posts else None,
                recipe_id=(
                    r.recipe_id
                    if r.recipe_id in recipes and recipes[r.recipe_id].deleted_at is None
                    else None
                ),
                subject=subject,
                read=r.read_at is not None,
                created_at=r.created_at,
            )
        )
    return NotificationList(
        notifications=out, unread_count=unread_count(db, current_user.id)
    )


@router.post("/read", response_model=NotificationList)
def read_notifications(
    body: MarkReadRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark the caller's notifications read — all of them, or just the ids given.

    Always scoped to the caller, so passing someone else's ids marks nothing rather than
    reaching across accounts. Returns the refreshed list so the client doesn't need a second
    call to update the badge.
    """
    mark_read(db, current_user.id, body.ids if body else None)
    return list_notifications(before_id=None, current_user=current_user, db=db)


# --- Web Push subscriptions (#89) -----------------------------------------------------------
#
# THREE routes, and the shape of each is decided by where the CALLER runs.
#
# `GET /notifications/vapid-key`   a page, before subscribing
# `POST /notifications/subscribe`  a page, after the user grants permission (authenticated)
# `POST /notifications/subscribe/rotate`  a SERVICE WORKER, with no user and no token
#
# Subscriptions are PER DEVICE and preferences are PER PERSON (on `users`), so these endpoints are
# deliberately independent of the preference ones: a user can legitimately have notifications
# switched on and zero subscriptions — that is exactly someone who hasn't installed the app
# anywhere yet.


@router.get("/vapid-key", response_model=VapidKeyResponse)
def vapid_key():
    """The public key a browser needs in order to subscribe at all.

    UNAUTHENTICATED, and that's correct: this value is handed to every client by design (it is the
    application server's public identity), and requiring a token would mean the service worker
    couldn't read it either.

    `configured` is the honest half. With no keypair set, this returns an empty key and False
    rather than 404ing, so the client can show "notifications aren't available" instead of
    subscribing against an empty string — which would mint a subscription that can never be
    delivered to and looks fine from the browser's side.
    """
    return VapidKeyResponse(
        public_key=settings.vapid_public_key, configured=push.is_configured()
    )


@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def subscribe(
    body: PushSubscriptionIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Register this device to receive pushes.

    IDEMPOTENT ON THE ENDPOINT, which the browser mints — so re-granting permission, or a second
    visit from the same install, updates the existing row rather than adding a duplicate. Without
    that, a user who reinstalls a few times receives the same notification several times.

    Re-subscribing MOVES a row between accounts rather than refusing. Two people sharing a device
    is a real case (a family phone, exactly the audience this app is for), and the browser gives
    the same endpoint to whoever is signed in — so the last person to grant permission is the one
    who should receive it. Refusing would silently deliver one person's notifications to another,
    which is the worse failure by a distance.

    204: there is nothing to tell the caller. The row is a fact about their device, not content.
    """
    existing = (
        db.query(PushSubscription)
        .filter(PushSubscription.endpoint == body.endpoint)
        .first()
    )
    if existing is not None:
        existing.user_id = current_user.id
        existing.p256dh = body.p256dh
        existing.auth = body.auth
        existing.user_agent = body.user_agent
    else:
        db.add(
            PushSubscription(
                user_id=current_user.id,
                endpoint=body.endpoint,
                p256dh=body.p256dh,
                auth=body.auth,
                user_agent=body.user_agent,
            )
        )
    db.commit()
    return None


@router.delete("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(
    body: PushSubscriptionIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stop pushing to THIS device. Only ever the caller's own row.

    Scoped to `user_id` as well as endpoint, so presenting someone else's endpoint deletes nothing
    — and 204 either way, so a caller can't use this to discover whether an endpoint belongs to
    another account.

    Takes the whole subscription object rather than just an endpoint because that is what the
    browser has in hand (`registration.pushManager.getSubscription()`), and asking a client to
    pick one field apart is how a mismatch gets introduced.
    """
    db.query(PushSubscription).filter(
        PushSubscription.endpoint == body.endpoint,
        PushSubscription.user_id == current_user.id,
    ).delete(synchronize_session=False)
    db.commit()
    return None


@router.post("/subscribe/rotate", status_code=status.HTTP_204_NO_CONTENT)
def rotate_subscription(
    request: Request,
    body: PushSubscriptionRotate,
    db: Session = Depends(get_db),
):
    """Replace a subscription the browser rotated. NO AUTHENTICATION, deliberately.

    Chrome fires `pushsubscriptionchange` inside the service worker: no page, no localStorage, no
    JWT — the axios interceptor that adds the bearer token isn't even loaded, because there is no
    axios. A route that required auth here would mean a rotated endpoint silently stops receiving
    anything, forever, with no signal to either side. That is a worse failure than the one below.

    THE OLD ENDPOINT IS THE CREDENTIAL. It is a long unguessable URL that only the browser and this
    server ever held, so presenting it is evidence of holding the previous subscription — the same
    reasoning as the invite token being the capability (see `claim_invite`). What it buys an
    attacker who somehow obtains one: the ability to redirect that device's notifications to
    another endpoint they control. That is a real cost, and it is bounded — they learn nothing about
    the account, cannot read anything, and cannot discover the endpoint from any surface here.

    BE PRECISE ABOUT THE 404, because the first version of this comment was not. It claimed the
    answer for an unknown endpoint matches the answer for one belonging to someone else — but there
    IS no "someone else" case: this route has no caller identity, so any KNOWN endpoint is rotated
    whoever owns it. The 404 is therefore an existence oracle; it distinguishes a real endpoint from
    an invented one. That is accepted rather than hidden, on the same grounds the invite token rests
    on (an endpoint is a long unguessable URL, so confirming one you already hold reveals nothing you
    didn't have) — but it is not the property the old comment described, and a comment asserting a
    security property that doesn't hold is worse than no comment, because the next person reasons
    from it.

    The user_id is carried over from the row being replaced, never taken from the request, so this
    cannot be used to attach a device to an arbitrary account.

    RATE-LIMITED PER ADDRESS, and this route earns it twice over: it is the app's only unauthenticated
    WRITE, and the 404 documented above is an acknowledged existence oracle for push endpoints. An
    oracle you can consult without limit is a different thing from one you can consult — so the limit
    is what keeps "confirming an endpoint you already hold reveals nothing" true, rather than leaving
    it as an invitation to enumerate. A real browser rotates a subscription rarely (it is a
    platform-initiated event, not a user action), so twenty an hour is orders of magnitude above use.
    """
    rate_limit.enforce(rate_limit.ip_key(request, "rotate"), *rate_limit.ROTATE_PER_IP)
    old = (
        db.query(PushSubscription)
        .filter(PushSubscription.endpoint == body.old_endpoint)
        .first()
    )
    if old is None:
        raise HTTPException(status_code=404, detail="Subscription not found")

    owner_id = old.user_id
    new = body.subscription
    if new.endpoint == body.old_endpoint:
        # A rotation that didn't rotate. Update the keys in place — the browser may have changed
        # only those — rather than deleting and re-inserting the same row.
        old.p256dh = new.p256dh
        old.auth = new.auth
        old.user_agent = new.user_agent
        db.commit()
        return None

    # The new endpoint may already exist (a race, or a browser that pre-registered it). Replace it
    # rather than colliding with the UNIQUE constraint.
    db.query(PushSubscription).filter(
        PushSubscription.endpoint == new.endpoint
    ).delete(synchronize_session=False)
    db.delete(old)
    db.add(
        PushSubscription(
            user_id=owner_id,
            endpoint=new.endpoint,
            p256dh=new.p256dh,
            auth=new.auth,
            user_agent=new.user_agent,
        )
    )
    db.commit()
    return None


@router.post("/run-daily-prompt")
def run_daily_prompt_endpoint(
    request: Request,
    x_issei_cron_key: str = Header(default=""),
    db: Session = Depends(get_db),
):
    """Trigger the daily prompt run. Called by SCHEDULERS, never by a person (#89).

    TWO CALLERS SINCE 2026-09-18, and this endpoint is the SECOND of them. The primary trigger is
    `app/services/prompt_scheduler.py`, an in-process ticker that calls `run_daily_prompt` directly
    and never comes through here — GitHub delivers only 5-7 scheduled runs a day for
    `daily-prompt.yml` no matter what its cron asks for, which is a cap rather than a loss rate, so
    the workflow alone could not cover a four-hour send window. This route stays because the two
    triggers are idempotent per (user, local_date) and the cron covers what the loop cannot: the
    window where the task is restarting or a deploy is mid-roll.

    RATE-LIMITED PER ADDRESS, VERY GENEROUSLY (2026-09-21). The secret is compared with
    `compare_digest` and a wrong key is a 404, so guessing was never a realistic threat — but "not
    realistic" and "unbounded" are different claims, and this was the last credential-presenting
    surface in the app with no ceiling at all. 60 an hour cannot cost anybody a nudge: GitHub delivers
    this workflow 5-7 times A DAY in total, and the PRIMARY trigger never comes through HTTP. Found
    by a docs gate, which noticed it falsified the README's claim that every unauthenticated surface
    is bounded — and softening that sentence would have been the wrong repair for a three-line hole.

    NOT a user route: there is no `get_current_user` here because there is no user — the caller is
    a cron job acting for everybody. Authenticated by a shared secret in a header instead, compared
    with `secrets.compare_digest` so the check doesn't leak the secret's length or prefix through
    timing.

    DISABLED WHEN THE SECRET IS UNSET, which is the part worth being deliberate about. The
    tempting shape is `if settings.cron_secret and given != settings.cron_secret: raise` — and that
    reads fine until you notice it makes the route WIDE OPEN on any deploy where the secret is
    missing. An unconfigured deploy 404s instead. Same reasoning as `push.is_configured()`:
    unconfigured means "off", never "unguarded".

    404 rather than 401/403 for both a wrong key and an unset one, so probing tells you nothing
    about whether this route exists on this deploy.

    WHY AN ENDPOINT RATHER THAN A SCHEDULED TASK. The deploy pipeline never runs `cdk`, and the CDK
    task-definition family is byte-identical to the one the pipeline re-renders — so a `cdk deploy`
    to add an EventBridge rule would also replace the running prod image with whatever is checked
    out on the operator's machine. An endpoint plus a GitHub Actions cron needs no infrastructure
    change at all and ships with the repo. It also means the trigger is swappable later (EventBridge
    hitting this same URL) without touching anything here.

    Cron drift is handled in `services/prompt.is_due`, which asks "has their hour passed today and
    have they not been sent" rather than "is it exactly their hour" — so a run 40 minutes late still
    catches everyone, and `prompt_sends`' UNIQUE (user, local_date) is what makes that safe.
    """
    # BEFORE the secret comparison, so an unbounded guesser is refused without the route doing any
    # work at all. It also means the limiter cannot become an oracle in the other direction: a right
    # key and a wrong one are equally subject to it, so a 429 says nothing about the key.
    rate_limit.enforce(
        rate_limit.ip_key(request, "cron-trigger"), *rate_limit.CRON_TRIGGER_PER_IP
    )
    # Compared as BYTES. `compare_digest` on two `str`s raises TypeError the moment either holds a
    # non-ASCII character — and Starlette latin-1-decodes header bytes, so one 0x80-0xFF byte in
    # this header reached the comparison as a non-ASCII str. That was an unauthenticated 500 on
    # demand, and worse: a 500 where a wrong key gives 404 is exactly the oracle this route's
    # docstring claims not to exist. It told you the deploy HAS a cron secret.
    given = x_issei_cron_key.encode("utf-8", "surrogateescape")
    expected = settings.cron_secret.encode("utf-8", "surrogateescape")
    if not settings.cron_secret or not secrets.compare_digest(given, expected):
        raise HTTPException(status_code=404, detail="Not found")
    return prompt.run_daily_prompt(db)
