"""Add first_name last_name to users and cover_photo_url to recipes

Revision ID: 0894735d3ccd
Revises: c96af0203c3d
Create Date: 2026-06-29 09:40:17.625555

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0894735d3ccd'
down_revision: Union[str, Sequence[str], None] = 'c96af0203c3d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add cover photo to recipes (nullable, no backfill needed).
    op.add_column('recipes', sa.Column('cover_photo_url', sa.String(), nullable=True))

    # Add first/last name to users. They are NOT NULL, so use a temporary
    # server_default to backfill existing rows, then drop the default so the
    # column schema matches the model (which declares no DB-level default).
    op.add_column('users', sa.Column('first_name', sa.String(), nullable=False, server_default='Unknown'))
    op.add_column('users', sa.Column('last_name', sa.String(), nullable=False, server_default='Unknown'))
    with op.batch_alter_table('users') as batch_op:
        batch_op.alter_column('first_name', server_default=None)
        batch_op.alter_column('last_name', server_default=None)

    # Recreate recipes.user_id FK with ON DELETE CASCADE so deleting a user
    # cleans up their recipes (and, via existing cascades, child rows).
    with op.batch_alter_table('recipes') as batch_op:
        batch_op.drop_constraint('recipes_user_id_fkey', type_='foreignkey')
        batch_op.create_foreign_key(
            'recipes_user_id_fkey', 'users', ['user_id'], ['id'], ondelete='CASCADE'
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('recipes') as batch_op:
        batch_op.drop_constraint('recipes_user_id_fkey', type_='foreignkey')
        batch_op.create_foreign_key(
            'recipes_user_id_fkey', 'users', ['user_id'], ['id']
        )
    op.drop_column('users', 'last_name')
    op.drop_column('users', 'first_name')
    op.drop_column('recipes', 'cover_photo_url')
