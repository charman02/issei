from datetime import datetime
from typing import Optional
from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(nullable=False)
    last_name: Mapped[str] = mapped_column(nullable=False)
    email: Mapped[str] = mapped_column(unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(nullable=False)
    # "public" | "private" — DEFAULT private: the app's spine is the intentional
    # handoff, so a profile is closed unless the owner opens it. This does NOT gate reads
    # (item visibility is concrete — see services/sharing.py); it only picks the default
    # the create form auto-selects for a new recipe/post ("Everyone" on a public profile,
    # "Friends only" on a private one) and drives the bulk "make everything …" sweep.
    profile_visibility: Mapped[str] = mapped_column(server_default="private")
    # Cloudinary URL for the user's profile picture. NULL = no photo → the UI shows the
    # first-letter monogram (the default). Uploaded via POST /upload/avatar, set through
    # PATCH /auth/me. Shown wherever the user's name appears (feed, friends, profiles) —
    # a face beside a name is identity, not private content, so it is NOT gated by
    # profile_visibility (which still hides recipes/posts).
    photo_url: Mapped[Optional[str]] = mapped_column(nullable=True)
    # How far the user has read their feed (#97) — the ID of the newest post they have seen.
    # NULL = never looked, so everything is new.
    #
    # SEEN IS NOT GONE. This marks a BOUNDARY, not a filter: the feed still returns every post
    # it would have, and already-seen ones keep their place below the divider. Nothing expires
    # and nothing is hidden — a post is the top of the funnel to a handoff, so a vanishing post
    # would take the ask with it, and posts are permanent records on their author's profile.
    #
    # ONE COLUMN, not a post_view table: a watermark answers all three things that needed this
    # — the "new since you last looked" divider, the "you're all caught up" state, and the
    # content of a push prompt ("3 friends posted since you last looked", #89) — without a row
    # per user per post. Per-post read state buys precision nobody has asked for yet.
    #
    # AN ID, NOT A TIMESTAMP, for the same reason feed pagination is keyset on `id`:
    # `created_at` has SECOND granularity on SQLite, so two posts a moment apart can share a
    # timestamp — and a post published in the same second as the mark would never be flagged
    # new. Post ids are monotonic, so `Post.id > last_feed_seen_post_id` has no ties. (A test
    # caught this: the timestamp version silently failed on same-second posts.)
    #
    # Deliberately NOT a foreign key. It is a watermark, not a reference — pointed at
    # `posts.id` it would SET NULL when that post is deleted, resetting the user to 'never
    # looked' and resurfacing their whole feed as new.
    #
    # Advanced only through POST /posts/feed/seen, and only ever FORWARD (see mark_feed_seen).
    last_feed_seen_post_id: Mapped[Optional[int]] = mapped_column(nullable=True)

    # --- Notifications (#89) ------------------------------------------------------------
    # SIX columns, all on the PERSON rather than on a device, because that is what they are
    # about: turning the daily nudge off shouldn't depend on which phone you're holding. The
    # devices themselves live in `push_subscriptions`.
    #
    # An IANA name ("Asia/Manila"), read from the browser and sent at login/signup. Nullable
    # because every existing account has none and no backfill can invent one — a user with NULL
    # is simply never due for the daily prompt until they next sign in, which is the honest
    # behaviour rather than guessing UTC and waking someone at 3am.
    #
    # This is the column that makes local-time sending possible at all, and it was the reason
    # the owner chose local over a single global hour: this app's premise is a recipe crossing a
    # distance, so the same family is routinely in Manila, California and Sydney.
    timezone: Mapped[Optional[str]] = mapped_column(nullable=True)
    # The hour (0-23, in `timezone`) the daily prompt fires. A column rather than a constant so
    # the hour can move — per user later, or globally now — without a migration.
    notify_hour: Mapped[int] = mapped_column(nullable=False, server_default="18")
    # TWO switches, not one and not five. One master switch forces a choice between "hear when a
    # friend asks for your Adobo" and "don't be nudged daily", which people resolve as OFF. Five
    # per-type switches are a settings page for an app that currently sends nobody anything.
    #   notify_prompt = the app nudging YOU ("3 friends posted since you last looked")
    #   notify_people = a PERSON reaching you (every type in NOTIFICATION_TYPES)
    notify_prompt: Mapped[bool] = mapped_column(nullable=False, server_default="1")
    notify_people: Mapped[bool] = mapped_column(nullable=False, server_default="1")
    # Quiet hours, in `timezone`, as hours-of-day. Kept even though sending is already local,
    # because a person's day is not the same as their timezone's: 22:00-08:00 is the default and
    # someone who works nights will want it inverted.
    #
    # THE RANGE WRAPS MIDNIGHT, and that is the common case rather than the edge one — which is
    # why a naive `quiet_from <= hour <= quiet_to` is exactly backwards here (it would suppress
    # the whole day EXCEPT the quiet window). See `services/push.py::in_quiet_hours`.
    quiet_from: Mapped[int] = mapped_column(nullable=False, server_default="22")
    quiet_to: Mapped[int] = mapped_column(nullable=False, server_default="8")

    # server_default lets the database generate the timestamp, more reliable
    # than app-side defaults in distributed environments
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
