"""add lineage tables and columns

Revision ID: 017609ee2fb3
Revises: a9838c16cffe
Create Date: 2026-07-07 09:27:44.431303

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '017609ee2fb3'
down_revision: Union[str, Sequence[str], None] = 'a9838c16cffe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add the three lineage tables and the six recipe lineage columns."""
    # --- New tables ---
    op.create_table(
        'ghost_ancestors',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('recipe_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('place', sa.String(), nullable=True),
        sa.Column('year', sa.String(), nullable=True),
        sa.Column('memory', sa.String(), nullable=True),
        sa.Column('claimed_by_user_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['claimed_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['recipe_id'], ['recipes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_ghost_ancestors_recipe_id'), 'ghost_ancestors', ['recipe_id'], unique=False)

    op.create_table(
        'cook_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('recipe_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('cooked_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('photo_url', sa.String(), nullable=True),
        sa.Column('note', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['recipe_id'], ['recipes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_cook_events_recipe_id'), 'cook_events', ['recipe_id'], unique=False)
    op.create_index(op.f('ix_cook_events_user_id'), 'cook_events', ['user_id'], unique=False)

    op.create_table(
        'handoffs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('recipe_id', sa.Integer(), nullable=False),
        sa.Column('from_user_id', sa.Integer(), nullable=False),
        sa.Column('to_user_id', sa.Integer(), nullable=True),
        sa.Column('to_email', sa.String(), nullable=True),
        sa.Column('state', sa.String(), server_default='pending', nullable=False),
        sa.Column('note', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['from_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['recipe_id'], ['recipes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['to_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_handoffs_from_user_id'), 'handoffs', ['from_user_id'], unique=False)
    op.create_index(op.f('ix_handoffs_recipe_id'), 'handoffs', ['recipe_id'], unique=False)

    # --- New recipe columns (server defaults on the NOT NULL string columns so
    #     the migration is safe against a table with existing rows) ---
    op.add_column('recipes', sa.Column('parent_recipe_id', sa.Integer(), nullable=True))
    op.add_column('recipes', sa.Column('lineage_relation', sa.String(), server_default='root', nullable=False))
    op.add_column('recipes', sa.Column('origin_attribution', sa.String(), nullable=True))
    op.add_column('recipes', sa.Column('visibility', sa.String(), server_default='private', nullable=False))
    op.add_column('recipes', sa.Column('prompt_key', sa.String(), nullable=True))
    op.add_column('recipes', sa.Column('prompt_answer', sa.String(), nullable=True))
    op.create_index(op.f('ix_recipes_parent_recipe_id'), 'recipes', ['parent_recipe_id'], unique=False)

    # Self-referential FK. SQLite cannot ALTER-ADD a foreign key, so use a named
    # constraint inside a batch block (which recreates the table on SQLite and is
    # a plain ALTER on Postgres).
    with op.batch_alter_table('recipes') as batch:
        batch.create_foreign_key(
            'fk_recipes_parent_recipe_id', 'recipes',
            ['parent_recipe_id'], ['id'], ondelete='SET NULL'
        )


def downgrade() -> None:
    """Reverse everything upgrade() added, in reverse order."""
    with op.batch_alter_table('recipes') as batch:
        batch.drop_constraint('fk_recipes_parent_recipe_id', type_='foreignkey')

    op.drop_index(op.f('ix_recipes_parent_recipe_id'), table_name='recipes')
    op.drop_column('recipes', 'prompt_answer')
    op.drop_column('recipes', 'prompt_key')
    op.drop_column('recipes', 'visibility')
    op.drop_column('recipes', 'origin_attribution')
    op.drop_column('recipes', 'lineage_relation')
    op.drop_column('recipes', 'parent_recipe_id')

    op.drop_index(op.f('ix_handoffs_recipe_id'), table_name='handoffs')
    op.drop_index(op.f('ix_handoffs_from_user_id'), table_name='handoffs')
    op.drop_table('handoffs')

    op.drop_index(op.f('ix_cook_events_user_id'), table_name='cook_events')
    op.drop_index(op.f('ix_cook_events_recipe_id'), table_name='cook_events')
    op.drop_table('cook_events')

    op.drop_index(op.f('ix_ghost_ancestors_recipe_id'), table_name='ghost_ancestors')
    op.drop_table('ghost_ancestors')
