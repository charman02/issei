"""The one place a notification is created (#79).

Like `can_view` for reads and `are_friends` for friendship, this is deliberately the single
producer. Every caller goes through `notify()`, so the self-notify guard, the type vocabulary
and the flush discipline exist once instead of being re-derived at each call site.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.notification import Notification

# The vocabulary. A plain string on the model (see the docstring there), validated here so a
# typo is a loud failure at the producer rather than a row nobody can render.
NOTIFICATION_TYPES = {
    # Someone asked you for the recipe behind one of your meals.
    "recipe_request",
    # A recipe you asked for has arrived (you now hold a grant for it).
    "request_fulfilled",
    # Someone sent you a friend request / accepted the one you sent.
    "friend_request",
    "friend_accept",
    # Someone kept one of your recipes (#96). DELIBERATELY ANONYMOUS to the reader: the row
    # stores actor_id (notify() needs it for the never-notify-yourself check and for dedupe),
    # but the RESPONSE nulls every actor field for this type — see NotificationResponse and
    # routers/notifications.py. Keeping is a private act: a bookmark addressed to nobody,
    # unlike an ask, which is addressed to the cook. Publishing the keeper's identity would
    # change what keeping MEANS and could chill it; a bare count gives the cook the signal
    # without costing the reader their privacy.
    "recipe_kept",
}

# Types whose ACTOR is never disclosed to the recipient (#96). Kept here, beside the vocabulary,
# because anonymity is a property OF THE TYPE — not of one call site. It drives two things that
# must not drift apart:
#
#   1. `routers/notifications.py` nulls every actor field on the way out for these types.
#   2. `notify()`'s dedupe key EXCLUDES actor_id for these types (see below) — because two rows
#      the reader cannot tell apart must not both exist.
#
# A second anonymous type should only need adding here.
ANONYMOUS_TYPES = {"recipe_kept"}


def notify(
    db: Session,
    *,
    user_id: int,
    type: str,
    actor_id: Optional[int] = None,
    post_id: Optional[int] = None,
    recipe_id: Optional[int] = None,
    dedupe: bool = False,
) -> Optional[Notification]:
    """Address one notification to one person. Returns the row, or None if suppressed.

    Deliberately does NOT commit. Notifications are always a side effect of some other act
    (a request created, a grant minted), and they must land in that act's transaction — a
    separate commit here could leave a notification for something that then rolled back, or
    a completed act nobody was told about.

    Suppressed rather than raised:
    - **notifying yourself.** Every producer would otherwise need the same guard, and the one
      that forgot would tell you about your own action. There is no case where it is right.
    - **`dedupe=True` and an identical UNREAD row already exists.** For a repeatable act this
      is what keeps an inbox from being weaponised: asking and retracting is deliberately
      free (you may change your mind), and retracting deliberately does NOT delete the
      cook's notification (they were told something true), so without this a loop of
      ask/retract mints one notification per cycle — from any signed-in stranger, on any
      public post, with no rate limiting anywhere in the app. Once the cook has an unread
      "Ana asked for your Adobo", saying it again adds nothing. A READ row does not
      suppress: if they've seen and cleared it, a fresh ask is news again.
    """
    if type not in NOTIFICATION_TYPES:
        raise ValueError(f"unknown notification type {type!r}")
    if actor_id is not None and actor_id == user_id:
        return None
    if dedupe:
        # THE KEY MUST NAME EVERY FIELD THAT MAKES A ROW DISTINCT. It originally omitted
        # `recipe_id`, because it was written for `recipe_request` where `post_id` is the
        # discriminator — and that silently broke `recipe_kept`, whose post_id is always None:
        # the key collapsed to "this actor, this cook, unread", so a keeper who kept a SECOND
        # recipe generated no notification at all. Exactly the signal-lost failure #96 exists
        # to prevent, and there was no row to backfill later. Caught in review.
        #
        # `actor_id` is excluded for ANONYMOUS_TYPES, and that is the other half of the same
        # bug: with the actor in the key, two different people keeping the SAME recipe produced
        # two rows the reader cannot tell apart — "Someone kept your Adobo." twice, both with a
        # blank avatar. If the reader can't distinguish them, they aren't distinct.
        conditions = [
            Notification.user_id == user_id,
            Notification.type == type,
            Notification.post_id == post_id,
            Notification.recipe_id == recipe_id,
            Notification.read_at.is_(None),
        ]
        if type not in ANONYMOUS_TYPES:
            conditions.append(Notification.actor_id == actor_id)
        already = db.query(Notification.id).filter(*conditions).first()
        if already is not None:
            return None
    row = Notification(
        user_id=user_id,
        type=type,
        actor_id=actor_id,
        post_id=post_id,
        recipe_id=recipe_id,
    )
    db.add(row)
    return row


def unread_count(db: Session, user_id: int) -> int:
    """How many of this person's notifications are unread. Derived, never stored — a cached
    counter is the classic thing to drift out of sync with the rows it counts."""
    return (
        db.query(func.count(Notification.id))
        .filter(Notification.user_id == user_id, Notification.read_at.is_(None))
        .scalar()
        or 0
    )


def mark_read(db: Session, user_id: int, ids: Optional[list[int]] = None) -> int:
    """Mark the caller's notifications read; returns how many changed.

    Always scoped to `user_id`, so passing someone else's ids marks nothing rather than
    reaching across accounts. Idempotent: already-read rows are excluded, so a double tap
    reports 0 instead of rewriting timestamps.
    """
    q = db.query(Notification).filter(
        Notification.user_id == user_id, Notification.read_at.is_(None)
    )
    if ids is not None:
        if not ids:
            return 0
        q = q.filter(Notification.id.in_(ids))
    changed = q.update(
        {Notification.read_at: datetime.now(timezone.utc)}, synchronize_session=False
    )
    db.commit()
    return changed
