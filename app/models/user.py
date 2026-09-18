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
    # TEN columns — EIGHT live, plus two tombstones at the end of this block
    # (`notify_prompt` and `notify_posts`), both dead and both kept for one release for the
    # deploy-ordering reason explained there. All on the PERSON rather than on a device, because
    # that is what they are about: turning the daily nudge off shouldn't depend on which phone
    # you're holding. The devices themselves live in `push_subscriptions`.
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
    # THREE SWITCHES, and the split is by SUBJECT rather than by notification type — which is the
    # distinction #89 got wrong and paid for. Five per-type switches would be a settings page for
    # an app that sends almost nothing; one master switch forces a choice between "hear when a
    # friend asks for your Adobo" and "don't be nudged daily", which people resolve as OFF. Three
    # KINDS is the honest middle:
    #
    #   notify_prompt_me     the app asking YOU to share a meal          (about you)
    #   notify_friend_posts  a friend shared one, told immediately        (about them)
    #   notify_people        a PERSON reaching you (NOTIFICATION_TYPES)   (addressed to you)
    #
    # WHY THIS ISN'T THE THREE-VALUE CADENCE IT REPLACED. `notify_posts` was
    # `instant | daily | off`, modelling the per-post push and a daily digest as ALTERNATIVES. That
    # was correct about a DIGEST — an 18:00 line reading "3 friends posted since you last looked"
    # summarises exactly what an instant push already announced, so both on would deliver four
    # notifications for three posts. The mistake was one level up: the digest shouldn't exist.
    #
    # #89 was specified as a BeReal-style PROMPT TO POST and built as a digest of other people's
    # activity, and the drift is legible in that task's own code comment, which read:
    #
    #     notify_prompt = the app nudging YOU ("3 friends posted since you last looked")
    #
    # "Nudging YOU", then a parenthetical entirely about other people. The result was circular:
    # the mechanism for getting people to post required people to have already posted, so it could
    # amplify activity but never start it, and a beta with no posts got no nudges. Reported as "the
    # nudge didn't arrive"; correct behaviour by the code as written. `prompt.is_due` now gates on
    # the recipient's OWN absence (`posted_today`) instead of their friends' presence, which is the
    # one substitution that breaks the loop — and once "daily" means "post something", it stops
    # being an alternative to hearing about friends and becomes a different notification about a
    # different subject. Alternatives collapse into one field; independent things must not.
    #
    # ALL THREE default TRUE (`server_default="1"`) — this said "Both" while the heading three
    # lines up said THREE SWITCHES, which is the kind of disagreement that makes a reader trust
    # neither. The prompt is the retention mechanism and a default-off switch means it never
    # happens; hearing that a friend cooked is what people expect from every app of this shape;
    # and something addressed to you personally is the least declinable of the three. Quiet hours
    # are what make on-by-default defensible.
    #
    # `notify_posts` and `notify_prompt` below are DEAD COLUMNS kept for one release — see the note
    # on them. `AccountUpdate` still accepts both as deprecated aliases, because Vercel and ECS
    # deploy independently and silently discarding someone's "don't interrupt me" is not an
    # acceptable deploy-window behaviour.
    notify_prompt_me: Mapped[bool] = mapped_column(nullable=False, server_default="1")
    # HOW OFTEN the prompt may arrive, as a minimum gap in the person's own LOCAL days. 1 = every
    # day, 3 = a few days a week, 7 = once a week; the client offers those three and the column
    # accepts 1..30.
    #
    # This exists because #108 removed something that was capping the nudge by accident. The old
    # design only fired when a friend had posted, so a quiet week sent nothing; gating on the
    # recipient's own absence instead — which is what made the prompt work at all — means someone
    # who never posts would get the same line every evening forever. Correct for a prompt, wrong
    # for a relationship. The owner's call was to hand that decision to the person rather than
    # impose a cap (2026-09-17).
    #
    # A GAP, NOT AN ENUM, and 1 IS THE EXISTING BEHAVIOUR. The at-most-once-per-local-day rule is
    # this rule with the window at its floor, so the default changes nothing for anyone and there
    # is one predicate rather than two sitting beside each other. `prompt_sends` already records
    # every send per local date, so the gap is measurable from data that was already being kept.
    #
    # An INTEGER rather than a `Literal`, unlike `visibility` and `invite_permission`: those are
    # vocabularies where an unlisted value matches no branch and silently reads as "off", which is
    # the failure a Literal guards. Every integer >= 1 here has a coherent meaning, so there is no
    # dead value to protect against — a client asking for 2 or 14 gets 2 or 14.
    notify_prompt_every_days: Mapped[int] = mapped_column(nullable=False, server_default="1")
    notify_friend_posts: Mapped[bool] = mapped_column(nullable=False, server_default="1")
    notify_people: Mapped[bool] = mapped_column(nullable=False, server_default="1")
    # TWO DEAD COLUMNS — RELEASE 2 OF 3. They exist in the database and are now INVISIBLE TO THE
    # ORM: declared on the Table (so the schema still matches), excluded from the mapper (so no
    # query the app emits mentions them). Nothing reads or writes either; the three switches above
    # replaced them.
    #
    # WHY THIS TAKES THREE RELEASES AT ALL. `.github/workflows/deploy.yml` runs
    # `alembic upgrade head` FIRST, then builds and pushes the image, then rolls ECS. So the OLD
    # task serves traffic against the NEW schema for the whole window. Drop a column in the same
    # deploy that stops using it and the old task emits `SELECT ... users.notify_prompt ...` on
    # every authenticated request → `ProgrammingError` 500s across the whole API, on a
    # `desiredCount: 1` service, with `/health` still green because it never touches `users`.
    # Nothing would alarm, and a health-check failure would then roll ECS back to an image that
    # cannot talk to the database at all.
    #
    #   1. (shipped, c4e65ba) add the three switches, backfill, stop READING both dead columns.
    #   2. (this one) stop the ORM from TOUCHING them. No migration. After this rolls, no running
    #      code names either column in any statement — which is the precondition for step 3.
    #   3. one migration dropping both, and these two lines go with it.
    #
    # WHY `exclude_properties` RATHER THAN JUST DELETING THE TWO LINES, which is what this comment
    # and TECHDEBT both used to prescribe. Deleting them does not work, and it was never going to:
    # the columns are still in the migration chain, so `Base.metadata` would no longer match the
    # migrated schema and `tests/test_migrations.py::test_migrated_schema_matches_models` fails with
    # `remove_column` on both. Measured, not reasoned about — it is the same absolute guard the old
    # comment cited as the reason step 2 could not be folded into step 1, without noticing step 2
    # tripped it too. The plan was self-contradictory for two releases and nobody caught it, because
    # nobody had run it.
    #
    # Two other routes were tried and are worse:
    #   * `deferred=True` alone leaves both in `INSERT ... RETURNING` (that clause fetches
    #     server defaults, which deferral does not govern), so signup would break the moment
    #     step 3 lands — the exact outage this sequence exists to avoid, just moved one release
    #     later where it would look unrelated.
    #   * `deferred=True` with `server_default` dropped from the model is worse still: SQLAlchemy
    #     then sends an explicit `notify_prompt=NULL` in the INSERT column list, so signup breaks
    #     IMMEDIATELY, against a NOT NULL column.
    # `exclude_properties` is the only one of the three that leaves the column out of BOTH the
    # SELECT and the INSERT while keeping the Table honest. Verified by capturing the emitted SQL —
    # `tests/test_migrations.py::test_no_statement_the_ORM_emits_NAMES_a_tombstoned_column` is that
    # check, kept as a test because "no query mentions this column" is the entire safety property
    # release 3 depends on and it is invisible in a diff.
    #
    # The `Mapped[...]` annotations STAY even though neither is a mapped attribute any more.
    # Dropping them (the first version did) leaves the assignments unannotated, and Pyright then
    # stops
    # synthesising mapped attributes for the WHOLE class — `notify_prompt_me`, `notify_friend_posts`
    # and `notify_prompt_every_days` all became "unknown attribute" errors at every call site. The
    # annotation is a type-checker fiction here; `exclude_properties` is what the mapper obeys.
    notify_prompt: Mapped[bool] = mapped_column(nullable=False, server_default="1")
    notify_posts: Mapped[str] = mapped_column(nullable=False, server_default="daily")
    __mapper_args__ = {"exclude_properties": ["notify_prompt", "notify_posts"]}
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
