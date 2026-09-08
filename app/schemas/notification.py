from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel


class NotificationResponse(BaseModel):
    """One line in the caller's inbox (#79).

    Carries the actor's NAME rather than making the client resolve ids, and the refs the
    client needs to deep-link (`post_id` → the post, `recipe_id` → the recipe). Both refs
    are nullable and stay nullable in practice: the underlying row SET NULLs them when the
    post or recipe is deleted, so an old notification degrades to an un-clickable line
    rather than a link that 404s.

    No email, ever — same rule as every other social response.
    """

    id: int
    type: str
    actor_id: Optional[int] = None
    actor_first_name: Optional[str] = None
    actor_last_name: Optional[str] = None
    actor_photo_url: Optional[str] = None
    post_id: Optional[int] = None
    recipe_id: Optional[int] = None
    # The dish this is about, when it's still resolvable — so a line can read "Ana asked
    # for your Adobo" instead of "Ana asked for a recipe".
    subject: Optional[str] = None
    read: bool = False
    created_at: datetime


class NotificationList(BaseModel):
    """The inbox plus its unread count, in one round trip — the badge and the list are
    always wanted together, and deriving the count here keeps it from drifting from the
    rows (there is no stored counter anywhere)."""

    notifications: list[NotificationResponse]
    unread_count: int


class MarkReadRequest(BaseModel):
    """Mark notifications read. Omitting `ids` marks ALL of the caller's unread ones —
    the common case (opening the inbox). Always scoped to the caller server-side, so
    passing someone else's ids marks nothing."""

    ids: Optional[list[int]] = None


class RequesterSummary(BaseModel):
    """Someone who asked for a recipe, as shown to the COOK only."""

    user_id: int
    first_name: str
    last_name: str
    photo_url: Optional[str] = None
    created_at: datetime


class FulfillRequest(BaseModel):
    """Which of your recipes answers the asks on this post."""

    recipe_id: int


class NotificationType(BaseModel):
    """Not used at the API boundary — kept as documentation of the vocabulary the client
    switches on. The authoritative set is `services/notifications.NOTIFICATION_TYPES`."""

    type: Literal[
        "recipe_request",
        "request_fulfilled",
        "friend_request",
        "friend_accept",
        "recipe_kept",
    ]
