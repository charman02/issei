from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class PromptSend(Base):
    """One record that this person has already been nudged today (#89).

    AT-MOST-ONCE, ENFORCED IN THE DATABASE. This table exists before the scheduler does, and
    that order is deliberate: whatever ends up triggering the daily prompt, none of the options
    are safely once-per-day on their own.

      - An in-process tick double-fires on every deploy. The service runs `minHealthyPercent: 100`
        / `maxHealthyPercent: 200`, so a rolling deploy overlaps the old and new task — a tick
        landing in that window sends twice. It also breaks the moment `desiredCount` goes above 1,
        which TECHDEBT and `infra/README` both name as the first scaling knob to turn.
      - An EventBridge schedule is at-LEAST-once by contract; AWS says so.
      - A GitHub Actions cron can be re-run by a human clicking a button.

    So correctness cannot live in the trigger. A UNIQUE index on (user, local calendar date) is
    the only thing that makes a duplicate impossible rather than unlikely, and it costs one small
    row per user per day.

    THE DATE IS THE USER'S LOCAL DATE, not UTC. The prompt fires at a fixed hour in each person's
    own timezone, so "today" means today where they are — for a user in Manila, 18:30 local is
    10:30 UTC the same day, but for one in California it is 01:30 UTC the NEXT day. Keying on a
    UTC date would let the Californian be nudged twice across one of their evenings and not at all
    across another. Computed by the sender from `users.timezone` and passed in.

    Insert-then-catch, not check-then-insert: the row is added inside the same transaction as the
    send decision, and a duplicate raises IntegrityError, which is the signal to skip. A SELECT
    first would leave the window between the check and the insert open to exactly the concurrent
    tick this table exists to defend against.
    """

    __tablename__ = "prompt_sends"
    __table_args__ = (
        # Inline, not an ALTER — SQLite has no ADD CONSTRAINT and this chain replays there.
        UniqueConstraint("user_id", "local_date", name="uq_prompt_send_user_day"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # The calendar date in the RECIPIENT'S timezone. A plain Date, not a timestamp: the whole
    # point is one row per person per local day, and a timestamp would make two rows for the
    # same evening compare unequal.
    local_date: Mapped[date] = mapped_column(Date, nullable=False)
    # What the prompt claimed, so a "why did it say 3?" question is answerable after the fact.
    # Zero is a legitimate stored value even though nobody is sent a zero-count prompt — see
    # `services/prompt.py` for why a zero means "send nothing" rather than "send something bland".
    friend_count: Mapped[int] = mapped_column(nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
