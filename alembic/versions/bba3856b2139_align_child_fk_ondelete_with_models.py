"""Align child FK ondelete with models

Revision ID: bba3856b2139
Revises: 0894735d3ccd
Create Date: 2026-06-29 10:22:50.255199

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bba3856b2139'
down_revision: Union[str, Sequence[str], None] = '0894735d3ccd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Recreate child FKs with the ON DELETE behavior declared in the models."""
    with op.batch_alter_table('steps') as batch_op:
        batch_op.drop_constraint('steps_recipe_id_fkey', type_='foreignkey')
        batch_op.create_foreign_key(
            'steps_recipe_id_fkey', 'recipes', ['recipe_id'], ['id'], ondelete='CASCADE'
        )
    with op.batch_alter_table('ingredient_sections') as batch_op:
        batch_op.drop_constraint('ingredient_sections_recipe_id_fkey', type_='foreignkey')
        batch_op.create_foreign_key(
            'ingredient_sections_recipe_id_fkey', 'recipes', ['recipe_id'], ['id'], ondelete='CASCADE'
        )
    with op.batch_alter_table('ingredients') as batch_op:
        batch_op.drop_constraint('ingredients_recipe_id_fkey', type_='foreignkey')
        batch_op.create_foreign_key(
            'ingredients_recipe_id_fkey', 'recipes', ['recipe_id'], ['id'], ondelete='CASCADE'
        )
        batch_op.drop_constraint('ingredients_section_id_fkey', type_='foreignkey')
        batch_op.create_foreign_key(
            'ingredients_section_id_fkey', 'ingredient_sections', ['section_id'], ['id'], ondelete='SET NULL'
        )


def downgrade() -> None:
    """Restore child FKs without ON DELETE behavior (NO ACTION)."""
    with op.batch_alter_table('ingredients') as batch_op:
        batch_op.drop_constraint('ingredients_section_id_fkey', type_='foreignkey')
        batch_op.create_foreign_key(
            'ingredients_section_id_fkey', 'ingredient_sections', ['section_id'], ['id']
        )
        batch_op.drop_constraint('ingredients_recipe_id_fkey', type_='foreignkey')
        batch_op.create_foreign_key(
            'ingredients_recipe_id_fkey', 'recipes', ['recipe_id'], ['id']
        )
    with op.batch_alter_table('ingredient_sections') as batch_op:
        batch_op.drop_constraint('ingredient_sections_recipe_id_fkey', type_='foreignkey')
        batch_op.create_foreign_key(
            'ingredient_sections_recipe_id_fkey', 'recipes', ['recipe_id'], ['id']
        )
    with op.batch_alter_table('steps') as batch_op:
        batch_op.drop_constraint('steps_recipe_id_fkey', type_='foreignkey')
        batch_op.create_foreign_key(
            'steps_recipe_id_fkey', 'recipes', ['recipe_id'], ['id']
        )
