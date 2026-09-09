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

    Three properties are deliberate, and each one is a decision that could have gone the other
    way:

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

    3. **One open report per person per target.** A second report from the same reporter while
       one is still `open` is accepted and discarded rather than stored, so the table can't be
       flooded by repeated taps and a moderator sees one row per grievance. Enforced in the
       router rather than by a UNIQUE constraint, because a constraint over a nullable column
       set can't express "one OPEN one" — the same reason `notify()` dedupes in Python.

    `state` is `open` until someone reviews it, then `closed`. There is no moderation UI yet
    and deliberately no endpoint to read these back: that would need an admin role, which this
    app has no concept of, and inventing one to avoid opening a database console would be the
    larger mistake. Rows are read directly from Postgres for now.

    No `post_id`/`recipe_id` column yet. Reporting a specific meal or recipe is a real thing to
    want and will need one, but there is no UI for it today, and a nullable column nothing
    writes is the same half-wired mistake as an API field nothing sends.
    """

    __tablename__ = "reports"
    __table_args__ = (
        # The query a moderator actually runs: the open ones, newest first.
        Index("ix_reports_state_created", "state", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
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
    # moderator reads first, which is why it's allowed to be long-ish (1000 in the schema).
    note: Mapped[Optional[str]] = mapped_column(nullable=True)
    state: Mapped[str] = mapped_column(server_default="open", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
