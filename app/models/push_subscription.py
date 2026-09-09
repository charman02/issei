from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class PushSubscription(Base):
    """One browser, on one device, that has agreed to receive pushes (#89).

    PER DEVICE, not per user — the whole point. Somebody with the app on a phone and a laptop
    has two rows, and a push goes to both; a `user_id` unique constraint would silently mean
    "only the last device you allowed" and there is no way to notice that from the inside.

    Preferences live on `users` instead, because they are about the PERSON: turning the daily
    nudge off should not depend on which device you happen to be holding. That split also makes
    a legitimate state expressible — preferences on, zero subscriptions — which is exactly a user
    who hasn't installed the app anywhere yet.

    THE FIELDS ARE THE BROWSER'S, NOT OURS. A `PushSubscription` from the Push API gives an
    `endpoint` URL plus two keys, and all three are opaque to us: `p256dh` is the client's public
    key for the ECDH exchange and `auth` is a shared secret, both base64url. We store them
    verbatim and hand them to `services/push.py`. There is nothing to validate beyond length and
    presence — a malformed key surfaces as a failed send, and a send that fails with 404/410 is
    how a row gets pruned.

    `endpoint` is the identity: it is unique per subscription and the browser is the one that
    mints it. UNIQUE on it, so re-subscribing the same device updates rather than duplicating —
    and BOUNDED at 500 chars, which matters more than it looks: an unbounded string under a
    Postgres UNIQUE index raises "index row size exceeds maximum" for a long endpoint, a
    prod-only 500 that SQLite will never reproduce (the same shape as the ceilings in
    `schemas/recipe.py`). Real endpoints run 100–350 chars.

    A note on WHO may write here. Rotation is browser-initiated: Chrome fires
    `pushsubscriptionchange` inside the service worker, where there is no page, no localStorage
    and therefore no bearer token. So the row has to be replaceable by presenting the OLD
    endpoint rather than by authenticating — see `routers/notifications.py`. Without that, a
    rotated endpoint means a device that silently stops receiving anything, forever, with no
    signal to either side.
    """

    __tablename__ = "push_subscriptions"
    __table_args__ = (
        # Declared inline rather than as an ALTER: SQLite has no ADD CONSTRAINT and this chain
        # must replay there (see migration 31 / TESTING.md).
        UniqueConstraint("endpoint", name="uq_push_subscription_endpoint"),
        # The send query is "every live subscription for these users", so this is the index it
        # wants. Declared on the model AND in the migration deliberately: an index that exists
        # only in a migration is invisible to `MetaData`, so `alembic check` reports it as a
        # stray index and the next --autogenerate writes a DROP for it. That nearly shipped for
        # `ix_handoffs_grant_lookup`.
        Index("ix_push_subscriptions_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    endpoint: Mapped[str] = mapped_column(nullable=False)
    p256dh: Mapped[str] = mapped_column(nullable=False)
    auth: Mapped[str] = mapped_column(nullable=False)
    # What the browser said it was, for debugging a device that stops working. Never shown to
    # anyone and never used in a decision — if it ever becomes load-bearing, that's a bug.
    user_agent: Mapped[Optional[str]] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    # Bumped on every successful send. Not currently read by anything — it exists so a future
    # cleanup can distinguish "this device has been dead for a year" from "this device was
    # registered a year ago and works fine", which `created_at` alone cannot.
    last_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
