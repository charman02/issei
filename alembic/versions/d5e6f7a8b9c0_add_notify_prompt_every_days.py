"""Add notify_prompt_every_days — how often the "share a meal" nudge may arrive

#108 made the nudge a genuine prompt, gated on the recipient's own absence rather than their
friends' activity. That fixed the circularity and immediately created the opposite problem, which
TECHDEBT recorded as load-bearing the day it shipped: the old friend-activity gate had been
ACCIDENTALLY capping how often the nudge could repeat (a quiet week sent nothing), and removing it
means someone who never posts gets the same line every evening, indefinitely. Correct for a prompt;
wrong for a relationship.

The owner's answer was to hand the decision to the person rather than cap it for them (2026-09-17):
a frequency they choose, not a limit we impose.

A MINIMUM GAP IN LOCAL DAYS, which is why this is an integer rather than a three-value enum:

    1   every day          (today, if the last nudge was yesterday or earlier)
    3   a few days a week
    7   once a week

`1` reproduces the existing behaviour exactly, so the default changes nothing for anyone — the
at-most-once-per-local-day rule IS this rule with the window at its floor. That is the whole reason
to model it as a gap: it generalises a predicate that already exists instead of adding a second one
beside it, and `prompt_sends` already records every send per local date, so the data to measure the
gap is there.

WHY NOT A `Literal`, when `visibility` and `invite_permission` both are. Those are vocabularies
where an unlisted value matches no branch and silently means "off" — the failure this codebase
guards with a Literal. An integer has no such hole: EVERY value >= 1 has a coherent meaning, so a
client sending 2 or 14 gets exactly what it asked for rather than a dead value. Bounded 1..30 all
the same — below 1 would mean "more than once a day", which the per-day UNIQUE forbids anyway, and
past a month the honest way to say it is `notify_prompt_me = false`.

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision = "d5e6f7a8b9c0"
down_revision = "c4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # DEFAULT 1 = every day, which is what everyone already had. No backfill: the point of choosing
    # a gap rather than an enum is that the existing behaviour is this column's floor value.
    op.add_column(
        "users",
        sa.Column(
            "notify_prompt_every_days",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
    )


def downgrade() -> None:
    # Nothing to re-derive: the old code has no concept of a gap, and dropping this returns every
    # account to daily — which is the value all of them start at.
    with op.batch_alter_table("users") as batch:
        batch.drop_column("notify_prompt_every_days")
