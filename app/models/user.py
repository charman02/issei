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
    # SEVEN columns as of #107 — six live ones plus the `notify_prompt` tombstone at the end of
    # this block, which is a dead column kept for one release for the deploy-ordering reason
    # explained there. All on the PERSON rather than on a device, because that is what they are
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
    # TWO settings, not one and not five. One master switch forces a choice between "hear when a
    # friend asks for your Adobo" and "don't be nudged daily", which people resolve as OFF. Five
    # per-type switches are a settings page for an app that currently sends nobody anything.
    #   notify_posts  = hearing that FRIENDS POSTED — the app bringing you the feed
    #   notify_people = a PERSON reaching you (every type in NOTIFICATION_TYPES)
    #
    # `notify_posts` REPLACED the boolean `notify_prompt`, and it is a CADENCE rather than an
    # on/off because the two ways of hearing about a friend's post are alternatives, not
    # additions:
    #
    #   "daily"   the 18:00 nudge — "3 friends posted since you last looked" (the old True)
    #   "instant" a push as each friend posts, and NO daily nudge
    #   "off"     neither (the old False)
    #
    # Two independent switches were the obvious build and they are wrong: the nudge summarises
    # exactly the posts an instant push has already announced, so switching both on delivers four
    # notifications for three posts, and the fourth one tells you about three things you were
    # already told about. `prompt.is_due` therefore tests `== "daily"`, which is the single line
    # that makes the exclusivity real; a test pins it.
    #
    # Migrated from `notify_prompt` value-for-value (True → "daily", False → "off") so nobody's
    # existing choice changed, and "daily" stays the default because the daily nudge is the
    # retention mechanism the whole feature was built for.
    #
    # `AccountUpdate` still accepts `notify_prompt` as a deprecated alias — see the note there —
    # because Vercel and ECS deploy independently, and silently ignoring someone's "don't
    # interrupt me" is not an acceptable deploy-window behaviour.
    notify_posts: Mapped[str] = mapped_column(nullable=False, server_default="daily")
    notify_people: Mapped[bool] = mapped_column(nullable=False, server_default="1")
    # DEAD COLUMN, KEPT ON PURPOSE FOR ONE MORE RELEASE. Nothing reads it — `notify_posts` above
    # replaced it — and yes, "a column nothing reads" is the exact defect this codebase deletes
    # things over. It is here anyway because the alternative is a production outage, and the
    # reason is the ORDER in `.github/workflows/deploy.yml`: `alembic upgrade head` runs FIRST,
    # then the image is built and pushed, then ECS rolls. So the OLD task serves traffic against
    # the new schema for the whole window. Drop this column in the same deploy that stops
    # declaring it and the old task emits `SELECT ... users.notify_prompt ...` on every
    # authenticated request → `ProgrammingError` 500s across the whole API, on a
    # `desiredCount: 1` service, with `/health` still green because it never touches `users`.
    # Nothing would alarm. A health-check failure would then roll ECS back to an image that
    # cannot talk to the database at all. Found by the ship gate.
    #
    # Removing a column therefore takes THREE releases under this pipeline, and this is release
    # one:
    #   1. (this one) add `notify_posts`, backfill, stop READING `notify_prompt`. Both declared,
    #      both present — so `tests/test_migrations.py::test_migrated_schema_matches_models`,
    #      which forbids ANY model/migration drift and has no exemption mechanism, stays green.
    #   2. stop DECLARING it here. No migration. Now no running code selects it.
    #   3. a migration that drops it. Model and schema agree again.
    # Skipping step 2 is what causes the outage; skipping step 3 leaves this comment lying.
    # Tracked in TECHDEBT with that sequence written out.
    notify_prompt: Mapped[bool] = mapped_column(nullable=False, server_default="1")
    # Quiet hours, in `timezone`, as hours-of-day. Kept even though sending is already local,
    # because a person's day is not the same as their timezone's: 22:00-08:00 is the default and
    # someone who works nights will want it inverted.
    #
    # THE RANGE WRAPS MIDNIGHT, and that is the common case rather than the edge one — which is
    # why a naive `quiet_from <= hour <= quiet_to` is exactly backwards here (it would suppress
    # the whole day EXCEPT the quiet window). See `services/push.py::in_quiet_hours`.
    quiet_from: Mapped[int] = mapped_column(nullable=False, server_default="22")
    quiet_to: Mapped[int] = mapped_column(nullable=False, server_default="8")

    # --- The two settings from #105 ------------------------------------------------------
    #
    # WHO MAY PRE-ADDRESS A HANDOFF TO YOU: "anyone" | "friends".
    #
    # This is the app's last unsolicited-contact channel, and blocking (#85) does not reach it.
    # `POST /recipes/{id}/handoff` accepts a `to_email`, and a sender needs no relationship with
    # you — not even an account of yours to exist — to put a recipe, a byline, a story and their
    # own name on your Kept shelf. A block can't help, because there is nobody to block until
    # after it has happened.
    #
    # DEFAULT "anyone", which is the *permissive* choice and deliberately so: it is exactly
    # today's behaviour, and a migration that silently tightened everyone's setting would break
    # sends that are already in flight for people who never asked for that. It is offered as a
    # setting rather than imposed as a rule.
    #
    # NOT enforced on the LINK-ONLY handoff, ever. There the token is the capability and the
    # sender chose to hand it over — that is the product (POSITIONING), and gating it would
    # break the founding case, someone who asked for the dish at the table.
    invite_permission: Mapped[str] = mapped_column(nullable=False, server_default="anyone")
    #
    # WHAT THE CREATE FORM PRE-SELECTS FOR A NEW RECIPE: "public" | "friends" | "private".
    #
    # Stated directly, because it used to be INFERRED and the inference lost a value:
    # `profile_visibility` is two-valued while an item's visibility is three-valued, so
    # "friends" — the actual default for every new recipe — existed only as the side effect of
    # having a private profile, and nothing on any screen said so.
    #
    # THIS IS NOT A FOURTH VISIBILITY VALUE AND NOT A LIVE POINTER. Per #68 an item's
    # visibility is stored LITERALLY at create time; this only picks what the form starts on, so
    # changing it later moves nothing already saved. `profile_visibility` stays, because it still
    # drives the bulk sweep — retiring it is a separate decision.
    #
    # Backfilled from `profile_visibility` in the migration (public profile → "public", private →
    # "friends") rather than defaulted flat, so no existing account's create form changes
    # behaviour on the day this shipped.
    default_recipe_visibility: Mapped[str] = mapped_column(
        nullable=False, server_default="friends"
    )

    # server_default lets the database generate the timestamp, more reliable
    # than app-side defaults in distributed environments
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
