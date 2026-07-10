"""add handoff token

Revision ID: b2c3d4e5f6a7
Revises: 77d459d3e468
Create Date: 2026-07-10

"""
import secrets
from alembic import op
import sqlalchemy as sa

revision = "b2c3d4e5f6a7"
down_revision = "77d459d3e468"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("handoffs", sa.Column("token", sa.String(), nullable=True))
    # Backfill existing rows with unique tokens so old invites can gain links too.
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id FROM handoffs WHERE token IS NULL")).fetchall()
    for (hid,) in rows:
        conn.execute(
            sa.text("UPDATE handoffs SET token = :t WHERE id = :id"),
            {"t": secrets.token_urlsafe(32), "id": hid},
        )
    op.create_index("ix_handoffs_token", "handoffs", ["token"], unique=True)


def downgrade():
    op.drop_index("ix_handoffs_token", table_name="handoffs")
    op.drop_column("handoffs", "token")
