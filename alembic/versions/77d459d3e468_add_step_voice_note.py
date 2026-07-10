"""add step voice_note

Revision ID: 77d459d3e468
Revises: a1b2c3d4e5f6
Create Date: 2026-07-10 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "77d459d3e468"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("steps", sa.Column("voice_note", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("steps", "voice_note")
