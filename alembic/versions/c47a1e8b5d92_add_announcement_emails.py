"""Add users.announcement_emails — the opt-out for the one email the app sends unasked (#107).

Revision ID: c47a1e8b5d92
Revises: b9d3f07a4c81
Create Date: 2026-09-23

ADDITIVE, with a `server_default`, and both halves matter. The deploy pipeline runs
`alembic upgrade head` BEFORE it builds and ships the image, so the OLD code serves live traffic
against this new column for a minute or two. A NOT NULL column added without a default fails
outright on a non-empty table, and `users` in production is never empty — so the default is not
tidiness, it is the difference between a migration and an outage. (`tests/test_migrations.py`
pins exactly this for the last column pair that went the other way.)

DEFAULT TRUE because this is an OPT-OUT. These accounts joined a product in open beta; "the thing
you signed up for has changed" is mail they are owed, and silently defaulting every existing
account to off would ship a feature that reaches nobody. The switch is on the You page, and every
send carries a `List-Unsubscribe` header.

The old image ignores the column entirely (it doesn't appear in any SELECT it issues), so the
window is safe in both directions — and nothing sends announcements until someone runs
`scripts/send_announcement.py` by hand, which is a separate, deliberate act.
"""

from alembic import op
import sqlalchemy as sa


revision = "c47a1e8b5d92"
down_revision = "b9d3f07a4c81"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "announcement_emails",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    # Genuinely reversible, unlike the data repair one revision back: this adds a column and nothing
    # reads it except the send script and one switch, so dropping it loses only the opt-outs people
    # had recorded. Worth stating that cost out loud — a downgrade-then-upgrade cycle silently
    # re-subscribes anyone who had turned announcements off, so re-running the send script after one
    # would mail people who asked not to be mailed.
    op.drop_column("users", "announcement_emails")
