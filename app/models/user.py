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
    # THE ONE ABOVE THIS LINE ARE PUSH; THIS ONE IS EMAIL, and the split is the reason it is named
    # `announcement_emails` rather than `notify_announcements` (#107). Every `notify_*` field gates a
    # Web Push delivery through `services/push.py`, which needs a subscription on a device the person
    # installed the app on. An announcement cannot use that channel and reach everyone: most of this
    # audience is on an iPhone in Safari, where `pushAvailability()` is `install-first` and there is no
    # subscription to send to. So the one message that has to reach EVERY account goes by email, and
    # a name that said `notify_` would invite the next person to gate a push on it.
    #
    # AN OPT-OUT, NOT AN OPT-IN: default TRUE, because these accounts signed up for a product in
    # beta and "the thing you joined has changed" is the mail they are owed. It is also why this is
    # the ONLY email the app sends unasked — a password reset is a reply to a request, and the
    # feedback notification goes to the owner's own inbox.
    #
    # THE SWITCH IS THE ONLY WAY TO SET IT and it lives on the You page beside the push switches,
    # under its own EMAIL heading, so nobody reads it as another push toggle. Every send also carries
    # a `List-Unsubscribe` header (see `services/email.send_announcement`) so Gmail and Apple Mail
    # offer their own native unsubscribe — which is not politeness, it is deliverability: bulk mail
    # without that header is filtered harder, and an announcement in spam is the feature not working.
    announcement_emails: Mapped[bool] = mapped_column(nullable=False, server_default="1")
    # `notify_prompt` and `notify_posts` USED TO SIT HERE, and are gone as of migration
    # `e6f7a8b9c0d1` — release 3 of 3. Left as a note rather than a clean deletion because the
    # SEQUENCE is the reusable part, and the next person to remove a column from this table needs
    # it:
    #
    #   `.github/workflows/deploy.yml` runs `alembic upgrade head` BEFORE it builds and ships the
    # image, so the OLD task serves traffic against the NEW schema for the whole window. Dropping a
    # column the running image still names is `ProgrammingError` on every authenticated request, on
    #   a `desiredCount: 1` service, with `/health` green because it never touches `users` — so
    #   nothing alarms, and a health-check failure would roll ECS back to an image that cannot reach
    #   the database at all.
    #
    #   1. add the replacement, backfill, stop READING the old column.
    #   2. `__mapper_args__ = {"exclude_properties": [...]}` — the ORM stops NAMING it in any
    #      statement, while the Column stays on the Table so the drift guard stays green. NOT
    #      "delete the declaration": that IS metadata drift while the migration chain still creates
    #      the column, and `tests/test_migrations.py::test_migrated_schema_matches_models` is
    #      absolute. `deferred=True` is not a substitute either — it leaves the column in
    #      `INSERT ... RETURNING`.
    #   3. drop the column and delete the declaration in ONE commit (this one).
    #
    # Step 2 is the step that cannot be skipped and the one that looks skippable. See TECHDEBT for
    # the full account, including the two releases during which the written plan was impossible.
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
