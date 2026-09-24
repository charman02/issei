from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class Report(Base):
    """One person has reported another for review (#87).

    issei's second safety primitive, after blocking. They answer different questions and you
    need both: a block is something you do FOR YOURSELF and it takes effect instantly; a report
    is something you send to WHOEVER RUNS THE APP and it takes effect when a human looks. Only
    having a block leaves a harasser free to move on to the next person.

    It is also a hard requirement for shipping to the App Store — Guideline 1.2 asks for a way
    to report objectionable content and the people posting it — so this is on the path to iOS
    whatever else happens.

    SIX properties are deliberate, and each one is a decision that could have gone the other way.
    The first three are original to #87; the last three arrived with the content half — see below.

    1. **A BLOCK DOES NOT GATE A REPORT.** Every other read in this app is filtered through
       `is_blocked`, and doing that here would be a serious bug: someone harasses you, blocks
       you, and becomes permanently unreportable — the block turning into cover for the person
       who earned it. `report_user` deliberately performs no block check in either direction.
       Pinned by a test, because it looks like an oversight next to every route that does.

    2. **The reported person is never told.** No notification, no signal of any kind. Telling
       them converts a safety mechanism into an escalation trigger, and the person most likely
       to retaliate is exactly the person most likely to be reported. This is the same reasoning
       that keeps a block silent (`services/blocks`), and the same reasoning that makes a keep
       notification anonymous (#96) — the app doesn't create contact nobody asked for.

    3. **One open report per reporter per target PER SUBJECT, which ACCUMULATES.** (It was per
       (reporter, target) until #87 part two widened the key — see decision 5, which is the whole
       account of why.) A second report on the same subject while one
       is still `open` appends its words to that row rather than creating another, so repeated
       taps can't flood the table and whoever reads them sees one case per grievance instead of a
       thread. It does NOT discard — that was the first version, and it was a real bug: nothing
       can move a report out of `open`, so a genuinely new incident weeks later was thrown away
       while the UI answered "we'll take a look" about it. The original account is never
       overwritten and the later reason is stamped inline. Enforced in the router rather than by a
       UNIQUE constraint, because a constraint can't express the `state == "open"` predicate —
       the same reason `notify()` dedupes in Python.

    `state` is `open` until someone reviews it, then `closed` — though nothing can currently SET
    it to closed, which is the one real gap here and is recorded in TECHDEBT. There is no
    moderation queue and deliberately no endpoint to read these back: that would need an admin
    role, which this app has no concept of, and inventing one to avoid opening a database console
    would be the larger mistake. Rows are read directly from Postgres for now — so claim the
    mechanism to users, never a response (POSITIONING says this explicitly).

    **A REPORT CAN NOW NAME A SUBJECT (#87 part two).** `post_id` and `recipe_id` are nullable and
    mutually exclusive: a report is about a person, optionally *because of* one specific thing they
    posted or wrote. Guideline 1.2 asks for a way to report objectionable CONTENT as well as the
    people posting it, so this is the other half of the App Store requirement. (The previous version
    of this paragraph explained why the columns did not exist yet — "a nullable column nothing writes
    is the same half-wired mistake as an API field nothing sends" — and that rule is why they arrive
    in the same change as the two screens that write them.)

    Three more decisions, each of which could have gone the other way:

    4. **`SET NULL`, not `CASCADE`, on the content FKs — unlike the two user FKs above.** Deleting the
       post is exactly what someone does when they are reported for it, so CASCADE would hand the
       subject of a report a delete button for the report. The reporter's words and the reported
       person both outlive the content; what remains is a report about a person with no subject
       attached, which is precisely what every report was before this column existed.

    5. **ONE OPEN REPORT PER (reporter, target, SUBJECT)**, a change from per (reporter, target).
       Two different bad posts are two different incidents and a reviewer needs to see WHICH one;
       folding the second into the first would bury it under an older unrelated complaint and leave
       the subject visible only in prose. Re-reporting the SAME subject still appends, so the
       flooding the dedupe exists to stop is still stopped — and this serves the reason the
       accumulate behaviour was introduced at all: a genuinely new incident was being thrown away.
       Still enforced in the router rather than by a UNIQUE constraint, for the original reason
       (`state == "open"` is a predicate a constraint cannot express) plus a new one: the key spans
       FOUR columns and TWO of them are nullable (`post_id`, `recipe_id`), and Postgres treats NULLs
       as distinct in a UNIQUE index — so a constraint would not enforce the person-only case at all,
       which is the case most likely to be reported twice.

    6. **Mutually exclusive, validated at the schema boundary.** A report names a person, or a person
       AND one post, or a person AND one recipe — never both kinds. Allowing both makes "which thing
       is this about" unanswerable, and there is no interface in which to disambiguate it.

    7. **THE SUBJECT IS A HINT, NOT A PRECONDITION** (owner's call, 2026-09-24). The router resolves
       each id against the reported person and **drops it** if it isn't theirs; the report lands as a
       person-level one and the caller always gets 204. The invariant is that **no subject is ever
       stored that does not belong to the person named** — which is what closes the frame-up a ship
       gate found (`{user_id: <innocent>, post_id: <somebody else's vile post>}` wrote
       *reporter → innocent, inappropriate, post 57*), since the attack needed the app to VOUCH for
       the pairing. A drop rather than a 404 for three reasons: refusing told a reporter "Post not
       found" about content that had been on their screen a second earlier, which POSITIONING
       forbids and which a HARD post delete produces on its own; the 204/404 split was itself an
       ownership oracle over every id in the app, which #80's directory makes enumerable; and a
       person-level report is something that reporter could always have filed anyway, so the drop
       gives nothing away. **A SOFT-deleted recipe still belongs to its author, so it resolves and
       its subject is KEPT** — that is now the whole difference between the two types, and it is the
       point: the case must survive its subject or deleting it would be the way out.

    What is deliberately NOT here: any check that the reporter could SEE the content. A report is not
    a read, `can_view` is not consulted, and that is decision 1 again — someone shown a post in a
    feed that was then made private, or who was blocked straight after, must still be able to report
    it. The id is recorded whether or not it still resolves for them.
    """

    __tablename__ = "reports"
    __table_args__ = (
        # The one query there is: the open ones, newest first.
        Index("ix_reports_state_created", "state", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Both FKs CASCADE, and the second one is a DECISION rather than a default (settled at
    # review, 2026-09-09). If the REPORTED person deletes their account, every report against
    # them goes too — and yes, that means someone can erase their own record with their own
    # password and register again. Accepted anyway, for now, on three grounds: there is no
    # moderation surface, so nothing is acting on those rows to be undermined; keeping reports
    # about a deleted person means retaining accusations about someone who has exercised
    # deletion, which is the harder position to defend; and a report is a live case about a
    # PAIR of people, so with one gone there is nobody to follow it up with. Revisit alongside
    # any real moderation queue — changing FK behaviour later is a data migration, so this is
    # written down rather than assumed.
    #
    # Who reported. CASCADE: if they delete their account the report goes with it — it was
    # their account of what happened, and nobody can follow it up without them.
    reporter_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Who was reported. Also CASCADE — if the reported account is gone, the report is moot.
    reported_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # One of REPORT_REASONS (see app/schemas/report.py). Stored as the literal string rather
    # than a database enum, for the same reason `visibility` is: adding a reason should be a
    # deploy, not a migration.
    reason: Mapped[str] = mapped_column(nullable=False)
    # The reporter's own words, optional. The most useful field on the row and the one a
    # reader reaches for first, which is why it's allowed to be long-ish (1000 in the schema).
    note: Mapped[Optional[str]] = mapped_column(nullable=True)
    # WHAT the report is about, optionally. Both nullable, at most one set (#87 part two).
    #
    # `SET NULL` rather than CASCADE, and the asymmetry with the user FKs above IS the decision:
    # deleting the post is what a person does when they are reported for it, so CASCADE would hand
    # the subject of a report a delete button for the report itself. The case survives its subject.
    post_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("posts.id", ondelete="SET NULL"), index=True, nullable=True
    )
    recipe_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("recipes.id", ondelete="SET NULL"), index=True, nullable=True
    )
    state: Mapped[str] = mapped_column(server_default="open", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
