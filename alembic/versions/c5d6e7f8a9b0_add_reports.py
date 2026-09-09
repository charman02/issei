"""add the reports table — report a person for review (#87)

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-09-09

issei's second safety primitive, after blocking (#85). A block is something you do for
yourself and it works instantly; a report goes to whoever runs the app and works when a human
looks. Only having the first leaves a harasser free to move on to the next person. It is also
a hard App Store requirement (Guideline 1.2) for an app with user content, so it is on the
path to iOS regardless.

Purely additive — one new table, no existing table touched, nothing to backfill.

Both FKs CASCADE. If the reporter deletes their account the report goes with it (it was their
account of what happened and nobody can follow it up without them); if the reported account is
gone the report is moot. That is different from `notifications`, whose refs SET NULL so a line
outlives its subject — a notification is a message someone already read, while a report is a
live case about a specific pair of people.

`reason` and `state` are plain strings, not database enums, matching `visibility` and
`RecipeRequest.state`: adding a sixth reason should be a deploy, not a migration. The Literal
in `app/schemas/report.py` is what rejects an unknown value at the boundary.

The index is (state, created_at) because there is exactly one query a moderator runs — the
open ones, newest first — and no read endpoint at all yet: reading these needs an admin role
this app has no concept of, and inventing one to avoid opening a database console would be the
larger mistake.

Deliberately NO unique constraint. "One OPEN report per reporter per target" is the rule, and
a constraint can't express the state predicate; the router dedupes in Python, the same way
`notify()` does.
"""

from alembic import op
import sqlalchemy as sa

revision = "c5d6e7f8a9b0"
down_revision = "b4c5d6e7f8a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "reporter_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reported_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("state", sa.String(), nullable=False, server_default="open"),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_reports_reporter_id", "reports", ["reporter_id"])
    op.create_index("ix_reports_reported_user_id", "reports", ["reported_user_id"])
    op.create_index("ix_reports_state_created", "reports", ["state", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_reports_state_created", table_name="reports")
    op.drop_index("ix_reports_reported_user_id", table_name="reports")
    op.drop_index("ix_reports_reporter_id", table_name="reports")
    op.drop_table("reports")
