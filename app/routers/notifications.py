from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import get_current_user
from app.models.user import User
from app.models.post import Post
from app.models.recipe import Recipe
from app.models.notification import Notification
from app.schemas.notification import (
    MarkReadRequest,
    NotificationList,
    NotificationResponse,
)
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
