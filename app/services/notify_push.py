"""The bridge from the inbox to a phone — `notify()` on one side, `push.send()` on the other.

#89 built the transport and wired exactly ONE sender: the daily nudge. So every person-to-person
notification — an ask, an arrival, a friend request — landed in a database row and waited to be
noticed, and `User.notify_people` was an API-visible switch that nothing consulted. This module is
that switch's consumer.

THREE things decide the shape of this file.

**1. It cannot live inside `notify()`.** `notify()` deliberately does not commit, so that a
notification lands in the transaction of the act that caused it. A push fired from in there would
go out for an ask that then rolled back — a phone buzzing about something that did not happen, and
unrecallable. So the row is committed first and the push is a separate, later step. That is the
same ordering `routers/feedback.py` uses for its owner email, for the same reason.

**2. It runs AFTER the response, on its own session.** A push is an HTTP call to a third party with
a 10-second timeout, and there can be several (one per device, one per recipient — `fulfill_post`
answers every pending asker at once). Doing that inside the request means a cook who just answered
five people waits on Apple and Google before their screen moves. FastAPI's `BackgroundTasks` runs
the work after the response is sent, which is exactly right and needs no queue, no worker and no
new dependency. The cost is that the request's session is gone by then, so the task takes
notification IDs and opens a fresh one — which has the happy side effect of proving the rows were
really committed before anything was sent.

**3. The copy is server-side, and there is now a second place that words a notification.**
`Notifications.jsx` words the inbox line; this words the lock screen. Two places phrasing one event
is precisely how a claim drifts, so `BODIES` is a table keyed by the SAME vocabulary the producer
validates against, and `tests/test_notify_push.py` fails if a type exists without copy. A new
notification type cannot ship silent.
"""

import logging
from typing import Callable, Iterable, NamedTuple, Optional

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.notification import Notification
from app.models.post import Post
from app.models.push_subscription import PushSubscription
from app.models.recipe import Recipe
from app.models.user import User
from app.services.notifications import ANONYMOUS_TYPES, NOTIFICATION_TYPES
from app.services.prompt import local_now
from app.services.push import DEAD_SUBSCRIPTION_CODES, in_quiet_hours, is_configured, send

log = logging.getLogger(__name__)

# Every notification's title is the app's name, and the sentence is the body — matching
# `prompt.prompt_payload`. A lock screen already shows which app is speaking, so spending the
# title on anything else would just repeat it.
TITLE = "issei"


# WHAT EACH TYPE SAYS ON A LOCK SCREEN. Deliberately a table over the same keys as
# NOTIFICATION_TYPES, so "is there copy for this type" is a set comparison rather than a reading
# exercise — see the module docstring.
#
# Each entry takes (who, what): the actor's display name, and the dish, which may be None because
# the recipe or post it referred to can have been deleted since. Every line handles that, because
# a notification whose subject is gone still describes something that happened.
#
# Mirrors `lineFor()` in `frontend/src/pages/Notifications.jsx` — same words, so the lock screen
# and the inbox row a tap later say the same thing. Never mentions voice, audio or a recording
# (POSITIONING).
BODIES: dict[str, Callable[[str, Optional[str]], str]] = {
    "recipe_request": lambda who, what: (
        f"{who} asked you for your {what}." if what else f"{who} asked you for a recipe."
    ),
    "request_fulfilled": lambda who, what: (
        f"{who} sent you {what}." if what else f"{who} sent you the recipe you asked for."
    ),
    # "Someone" is HARDCODED, exactly as it is in the client (#96). This is the ONE place where
    # getting it wrong would be worst: a lock-screen notification is read by whoever is holding
    # the phone, and it cannot be unsent or corrected. `deliver` also passes "Someone" for every
    # ANONYMOUS_TYPE, so the name is suppressed twice independently.
    "recipe_kept": lambda who, what: (
        f"Someone kept your {what}." if what else "Someone kept one of your recipes."
    ),
    "recipe_arrived": lambda who, what: (
        f"{who} wanted you to have {what}." if what else f"{who} sent you a recipe."
    ),
    "recipe_claimed": lambda who, what: (
        f"{who} has your {what} now." if what else f"{who} opened the recipe you sent."
    ),
    "friend_request": lambda who, what: f"{who} wants to be friends.",
    "friend_accept": lambda who, what: f"{who} is now your friend.",
}


def _url(row: Notification, *, recipe_ok: bool = True) -> str:
    """Where tapping the notification lands. Mirrors `targetFor()` in the client.

    Falls back to the inbox rather than to Home: an unrecognised type still has a row, and the
    inbox is the one screen guaranteed to show it — the event happened, the thing it was about is
    gone.

    BE PRECISE ABOUT WHAT DROPS THE REFERENCE, because an earlier version of this comment was not:
    the FK `SET NULL`s when the recipe or post is genuinely DELETED, but a **soft** delete leaves
    `recipe_id` populated. So a truthy `recipe_id` is not proof the recipe is readable, which is
    what `recipe_ok` is for: `deliver` resolves the recipe with `deleted_at IS NULL` and passes
    False when it came back empty. Suppressing only the NAME was not enough — the first fix did
    that and left the tap pointing at `/recipes/{id}`, which `get_recipe` 404s. Its own test
    caught it.
    """
    if row.type == "recipe_request":
        return "/requests" if row.post_id else "/notifications"
    if row.type in ("request_fulfilled", "recipe_kept", "recipe_arrived", "recipe_claimed"):
        return f"/recipes/{row.recipe_id}" if (row.recipe_id and recipe_ok) else "/notifications"
    if row.type == "friend_request":
        return "/friends"
    if row.type == "friend_accept":
        return f"/u/{row.actor_id}" if row.actor_id else "/friends"
    return "/notifications"


def payload_for(
    row: Notification, *, who: str, what: Optional[str], recipe_ok: bool = True
) -> Optional[dict]:
    """The push body for one notification row, or None if this type has no copy.

    None rather than a generic fallback: a notification that says nothing specific is the exact
    species people mute an app over, and `prompt_payload` already refuses to send one. A missing
    entry here is a bug the test catches before it can ship.
    """
    body = BODIES.get(row.type)
    if body is None:
        log.warning("notify_push: no push copy for type %r, not sending", row.type)
        return None
    return {
        "title": TITLE,
        "body": body(who, what),
        "url": _url(row, recipe_ok=recipe_ok),
        # A UNIQUE tag PER ROW, and the uniqueness is the point.
        #
        # `tag` makes a notification REPLACE any earlier one carrying the same tag. The daily nudge
        # wants that (two unopened days of "3 friends posted" is one message, so it sends the
        # constant "daily-prompt"). These must not collapse into each other: "Ben asked for your
        # Adobo" quietly overwriting "Ana asked for your Adobo" would lose Ana entirely, with
        # nothing on the phone to show she ever asked.
        #
        # THE OBVIOUS MOVE — omit `tag` — IS WRONG, and I shipped it before noticing: `sw.js`
        # defaults it to the constant `'issei'` (`tag: payload.tag || 'issei'`), so an untagged
        # payload collapses onto EVERY other untagged notification. Sending an explicit unique tag
        # fixes it for the service worker already installed on a phone as well as the updated one,
        # which omitting could never do. The row id is the natural key: distinct events get
        # distinct tags, and a redelivery of the SAME row correctly replaces itself.
        "tag": f"notification-{row.id}",
    }


def _display_name(actor: Optional[User]) -> str:
    if actor is None:
        return "Someone"
    name = " ".join(filter(None, [actor.first_name, actor.last_name])).strip()
    return name or "Someone"


def deliver(db: Session, notification_ids: Iterable[int]) -> int:
    """Push the given (already-committed) notifications. Returns how many devices accepted one.

    Every skip here is deliberate and none of them raise:

    - **`notify_people` off.** The person said no. This is the whole point of the column.
    - **Inside their quiet hours.** Reuses `in_quiet_hours`, the same predicate the nudge uses,
      so "don't wake me" means one thing in this app.
    - **No timezone stored.** Sends ANYWAY, unlike the daily nudge, which skips. The difference is
      that the nudge needs a local hour to decide *when* to fire, so without one there is no
      answer; this is triggered by something a person just did, and the answer to "should it go"
      is yes. Suppressing an ask notification because we can't compute someone's clock would look
      exactly like the feature being broken. Quiet hours are a courtesy applied when we know the
      hour, not a precondition for delivery.
    - **Not configured.** No VAPID keypair means `send()` is a no-op anyway; returning early just
      saves the queries.

    **THE DB CONNECTION IS RELEASED BEFORE ANY HTTP CALL, and that is load-bearing rather than
    tidy.** The first version read, then sent inside the still-open transaction, then committed —
    so one background task held a pooled connection for as long as the push services took. With
    `fulfill_post` answering four askers on two devices each and Apple degraded to `send()`'s
    10-second timeout, that is one connection held for up to 80 seconds; a handful of those exhaust
    `QueuePool`'s 5 + 10 on a single ECS task, and every incoming request then blocks 30s and 500s.
    Which would have defeated the entire point of deferring this past the response: the request
    path would still wait on Apple, just through the connection pool instead of the response.
    Found by the ship gate.

    So the shape is: read everything → `commit()` (the Session hands the connection back) → send
    with no session in hand → one final query to prune whatever came back dead. `send()` therefore
    receives plain strings, never ORM instances, because touching an expired attribute after the
    commit would silently re-open a transaction and undo the whole point.
    """
    ids = [i for i in notification_ids if i is not None]
    if not ids or not is_configured():
        return 0

    rows = db.query(Notification).filter(Notification.id.in_(ids)).all()
    if not rows:
        return 0

    # Resolve recipients, actors and subjects in bulk — the same shape as `list_notifications`,
    # for the same reason: one delivery must not be N queries deep.
    recipients = {
        u.id: u for u in db.query(User).filter(User.id.in_({r.user_id for r in rows}))
    }
    actor_ids = {r.actor_id for r in rows if r.actor_id is not None}
    actors = {u.id: u for u in db.query(User).filter(User.id.in_(actor_ids))} if actor_ids else {}
    recipe_ids = {r.recipe_id for r in rows if r.recipe_id is not None}
    recipes = (
        {
            r.id: r
            for r in db.query(Recipe).filter(
                Recipe.id.in_(recipe_ids), Recipe.deleted_at.is_(None)
            )
        }
        if recipe_ids
        else {}
    )
    post_ids = {r.post_id for r in rows if r.post_id is not None}
    posts = {p.id: p for p in db.query(Post).filter(Post.id.in_(post_ids))} if post_ids else {}

    # One query for every device involved, grouped in Python. A person with no subscription is
    # entirely normal — notifications on, nothing installed yet — and costs nothing here.
    subs_by_user: dict[int, list[PushSubscription]] = {}
    if recipients:
        for sub in (
            db.query(PushSubscription)
            .filter(PushSubscription.user_id.in_(recipients.keys()))
            .all()
        ):
            subs_by_user.setdefault(sub.user_id, []).append(sub)

    jobs: list[_Job] = []
    for row in rows:
        person = recipients.get(row.user_id)
        if person is None or not person.notify_people:
            continue
        now_local = local_now(person)
        if now_local is not None and in_quiet_hours(
            now_local.hour, person.quiet_from, person.quiet_to
        ):
            continue
        subs = subs_by_user.get(row.user_id) or []
        if not subs:
            continue

        anon = row.type in ANONYMOUS_TYPES
        actor = actors.get(row.actor_id) if row.actor_id is not None else None
        who = "Someone" if anon else _display_name(actor)
        what = None
        # `deleted_at IS NULL` matters even though the recipient is always the owner or a
        # grantee: naming a soft-deleted recipe would push a line whose tap 404s, and
        # `list_notifications` is careful about exactly this. A soft delete does NOT null the FK.
        recipe = recipes.get(row.recipe_id) if row.recipe_id is not None else None
        if recipe is not None:
            what = recipe.name
        elif row.post_id in posts:
            what = posts[row.post_id].dish_name
        # `recipe_ok` is False when the row names a recipe that no longer resolves, so the
        # notification neither says its name nor links to it — the line still reads, because the
        # event still happened.
        payload = payload_for(
            row,
            who=who,
            what=what,
            recipe_ok=row.recipe_id is None or recipe is not None,
        )
        if payload is None:
            continue

        for sub in subs:
            jobs.append(_Job(sub.id, sub.endpoint, sub.p256dh, sub.auth, payload))

    return _send_all(db, jobs)


class _Job(NamedTuple):
    """One push, as PLAIN DATA — no ORM instance survives into the send loop.

    The point is that `_send_all` runs with the DB connection handed back to the pool, and reading
    an expired attribute off a committed ORM object would silently re-open a transaction, undoing
    exactly that. Plain strings make the mistake impossible rather than discouraged.
    """

    subscription_id: int
    endpoint: str
    p256dh: str
    auth: str
    payload: dict


def _send_all(db: Session, jobs: list[_Job]) -> int:
    """Release the connection, send everything, then prune whatever came back dead.

    Returns how many devices accepted a push. The commit before the loop is what frees the pooled
    connection for the duration of the HTTP calls; the one after it persists the prune.
    """
    if not jobs:
        return 0
    # Ends the read transaction and returns the connection to the pool. Nothing is pending here —
    # this function only ever reads — so it is a release rather than a write.
    db.commit()

    delivered = 0
    dead: list[int] = []
    for job in jobs:
        status = send(job.endpoint, job.p256dh, job.auth, job.payload)
        if status in DEAD_SUBSCRIPTION_CODES:
            # The browser has moved on. ONLY these two codes — see push.send's docstring; pruning
            # on 401/403 would empty the table on a botched key rotation, and a subscription can
            # only be recreated by the person re-granting permission on that device.
            dead.append(job.subscription_id)
        elif status in (200, 201):
            delivered += 1

    if dead:
        db.query(PushSubscription).filter(PushSubscription.id.in_(dead)).delete(
            synchronize_session=False
        )
        db.commit()
    return delivered


def _deliver_in_new_session(notification_ids: list[int]) -> None:
    """Background-task entry point. Owns its session and swallows everything.

    The request's session is closed by the time this runs, so it opens its own. Nothing here can
    reach the user — the response was sent — so an exception has nowhere to go but a log, and
    letting one escape would surface as an unexplained error in the server log with no request to
    attach it to.
    """
    db = SessionLocal()
    try:
        deliver(db, notification_ids)
    except Exception:
        log.exception("notify_push: delivery failed for %s", notification_ids)
        db.rollback()
    finally:
        db.close()


def queue(background_tasks, rows: Iterable[Optional[Notification]]) -> None:
    """Schedule pushes for the notifications just committed. CALL AFTER `db.commit()`.

    Takes the return values of `notify()` verbatim, Nones included, so a call site never has to
    ask whether its notification was suppressed — a self-notify or a deduped repeat simply
    contributes nothing. That keeps the guard in one place instead of at seven call sites.

    Reads `.id`, which is why the commit has to have happened: before it, an id is None and the
    notification would be silently dropped. Ordering that a test pins.
    """
    ids = [row.id for row in rows if row is not None and row.id is not None]
    if not ids:
        return
    background_tasks.add_task(_deliver_in_new_session, ids)


# Every type the producer accepts must have copy here, or a notification ships silent. Asserted in
# tests/test_notify_push.py rather than at import time: a hard failure on boot would take the whole
# API down over a lock-screen sentence, which is the wrong trade in production.
MISSING_COPY = NOTIFICATION_TYPES - set(BODIES)


# --- "a friend posted" — a push with NO inbox row ----------------------------------------------
#
# THE ONE NOTIFICATION IN THE APP THAT WRITES NOTHING DOWN, and that is the design rather than a
# shortcut. The inbox is for things ADDRESSED to you: an ask needs answering, a friend request
# needs accepting, an arrival is a gift someone chose to send you. "Ana posted Adobo" is ambient —
# it is addressed to nobody in particular, and it already has a home: the feed, where #97's
# `is_new` marks it and a divider says where you left off. Writing an inbox row per friend post
# would turn the inbox into a second feed and bury the asks that actually need a reply, which is
# the one thing in there with a deadline.
#
# So the persistent record is the feed's read-mark, and this is purely the interruption. Which
# also means there is nothing to dedupe against and nothing to mark read — if the phone was off,
# the feed still shows what was missed.
#
# WHO GETS IT: accepted friends only, ALWAYS — never everyone who can technically see a public
# post. `can_view_post` decides visibility (so a `private` post reaches nobody and a block denies
# outright, using the app's single read rule rather than a second copy of it), but the candidate
# set is the friend graph. Pushing a stranger about a public meal would be the app volunteering
# someone's dinner to people who never asked for it, which is the definition of the thing the
# whole cadence setting exists to keep bounded.


def friend_post_payload(
    *, who: str, dish: Optional[str], has_recipe: bool, post_id: int
) -> dict:
    """What "a friend posted" says.

    The recipe half is called out because it is the difference the person actually cares about:
    a photo is a glimpse, a photo WITH the recipe is the thing this app is for. It also answers
    the "posted a photo or recipe" question honestly — a recipe in issei is not posted to a feed
    on its own (writing one is private authoring, and it surfaces on a profile grid), so a post
    carrying one is the only event where both are true at once.
    """
    dish_part = f" — {dish}" if dish else ""
    tail = ", with the recipe" if has_recipe else ""
    return {
        "title": TITLE,
        "body": f"{who} just shared a meal{dish_part}{tail}.",
        # The feed, not the permalink. This notification is about there being something new to
        # look at, and the feed is where "what's new" lives — including everything else that
        # landed while the phone was face-down.
        "url": "/",
        # Unique per POST, for the same reason `payload_for` is unique per row — and note that
        # OMITTING this would not mean "don't collapse": `sw.js` defaults `tag` to the constant
        # `'issei'`, so two friends cooking would overwrite each other and one would vanish.
        "tag": f"post-{post_id}",
    }


def deliver_friend_post(db: Session, post_id: int) -> int:
    """Push a new post to the author's friends who asked to hear immediately."""
    from app.models.recipe import Recipe as RecipeModel
    from app.services.blocks import blocked_ids
    from app.services.friends import friend_ids
    from app.services.sharing import can_view, can_view_post

    if not is_configured():
        return 0
    post = db.query(Post).filter(Post.id == post_id).first()
    if post is None:
        return 0

    ids = friend_ids(post.user_id, db)
    if not ids:
        return 0
    # The linked recipe, if any, so `has_recipe` can be answered PER RECIPIENT below.
    linked_recipe = None
    if post.recipe_id is not None:
        linked_recipe = (
            db.query(RecipeModel)
            .filter(RecipeModel.id == post.recipe_id, RecipeModel.deleted_at.is_(None))
            .first()
        )
    # `notify_friend_posts` is the whole gate, and it is now ON BY DEFAULT rather than an opt-in
    # cadence value — this is the Instagram-shaped behaviour people already expect from an app of
    # this shape, and the three-value cadence that used to gate it was modelling this and the daily
    # nudge as alternatives, which they are not (see `User.notify_prompt_me`).
    #
    # Note this does NOT consult `notify_people`: that switch is about a PERSON reaching you and
    # this is ambient news about someone else, and conflating them would mean someone who wants to
    # know when a friend asks for their Adobo cannot decline the ambient stream, or vice versa.
    candidates = (
        db.query(User)
        .filter(User.id.in_(ids), User.notify_friend_posts.is_(True))
        .all()
    )
    if not candidates:
        return 0

    blocked = blocked_ids(post.user_id, db)
    subs_by_user: dict[int, list[PushSubscription]] = {}
    for sub in (
        db.query(PushSubscription)
        .filter(PushSubscription.user_id.in_([c.id for c in candidates]))
        .all()
    ):
        subs_by_user.setdefault(sub.user_id, []).append(sub)
    if not subs_by_user:
        return 0

    author = db.query(User).filter(User.id == post.user_id).first()
    who = _display_name(author)

    jobs: list[_Job] = []
    for person in candidates:
        subs = subs_by_user.get(person.id) or []
        if not subs:
            continue
        # The single read rule, with both escape hatches precomputed so this is one call and not
        # two queries per friend. `is_friend=True` is a fact by construction here; `blocked` is
        # passed because a block deletes the friendship, so it should be impossible — and it is
        # cheaper to pass the answer than to rely on that staying true.
        if not can_view_post(post, person, db, is_friend=True, blocked=person.id in blocked):
            continue
        now_local = local_now(person)
        if now_local is not None and in_quiet_hours(
            now_local.hour, person.quiet_from, person.quiet_to
        ):
            continue
        # "…, WITH THE RECIPE" IS ANSWERED PER PERSON, which is why the payload is built inside
        # this loop rather than hoisted above it. A post links a recipe the AUTHOR owns, and its
        # visibility is independent of the post's — the `Recipe` server_default is literally
        # `private` — so a friend can legitimately see the meal and not the recipe. `_to_response`
        # already nulls `recipe_id` for exactly that viewer, "so a 'See the recipe' link is only
        # shown when it would resolve". A push promising a recipe that the card then doesn't offer
        # would be the one surface making that claim, and the one that can't be corrected.
        # Found by the ship gate.
        has_recipe = linked_recipe is not None and can_view(
            linked_recipe, person, db, is_friend=True, blocked=person.id in blocked
        )
        payload = friend_post_payload(
            who=who, dish=post.dish_name, has_recipe=has_recipe, post_id=post.id
        )
        for sub in subs:
            jobs.append(_Job(sub.id, sub.endpoint, sub.p256dh, sub.auth, payload))

    return _send_all(db, jobs)


def _deliver_friend_post_in_new_session(post_id: int) -> None:
    """Background-task entry point for a new post. Owns its session, swallows everything."""
    db = SessionLocal()
    try:
        deliver_friend_post(db, post_id)
    except Exception:
        log.exception("notify_push: friend-post delivery failed for post %s", post_id)
        db.rollback()
    finally:
        db.close()


def queue_friend_post(background_tasks, post_id: Optional[int]) -> None:
    """Schedule the friend-post pushes for a post just committed. CALL AFTER `db.commit()`.

    Only on CREATE. An edit deliberately notifies nobody — `PATCH /posts/{id}` already refuses to
    move the #97 read-mark for the same reason, so a post cannot resurface as new; and a visibility
    change from private to friends is someone widening an old post, not cooking something.
    """
    if post_id is None:
        return
    background_tasks.add_task(_deliver_friend_post_in_new_session, post_id)
