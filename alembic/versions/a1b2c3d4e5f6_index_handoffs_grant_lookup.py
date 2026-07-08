"""index handoffs for grant lookup

Revision ID: a1b2c3d4e5f6
Revises: 017609ee2fb3
Create Date: 2026-07-08 00:00:00.000000

"""
from alembic import op

revision = "a1b2c3d4e5f6"
down_revision = "017609ee2fb3"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "ix_handoffs_grant_lookup",
        "handoffs",
        ["recipe_id", "to_user_id", "state"],
    )


def downgrade():
    op.drop_index("ix_handoffs_grant_lookup", table_name="handoffs")
