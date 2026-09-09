from fastapi import APIRouter, Depends, HTTPException, Query, status
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
from app.services import push
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
    A 404 for an unknown old endpoint is the same answer as for one belonging to someone else.

    The user_id is carried over from the row being replaced, never taken from the request, so this
    cannot be used to attach a device to an arbitrary account.
    """
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
