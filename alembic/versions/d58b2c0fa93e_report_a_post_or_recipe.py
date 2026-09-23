"""Let a report name a post or a recipe (#87 part two).

Revision ID: d58b2c0fa93e
Revises: c47a1e8b5d92
Create Date: 2026-09-23

Two nullable FKs on `reports`, both `ON DELETE SET NULL`, plus an index on each.

WHY `SET NULL` AND NOT `CASCADE`, when both user FKs on this table cascade: deleting the post is
exactly what a person does when they have been reported for it. CASCADE would hand the subject of a
report a delete button for the report. The reporter's account of what happened and the reported
person both outlive the content, and a report whose subject is gone is simply a report about a
person — which is what every report on this table was before these columns existed.

ADDITIVE AND NULLABLE, so no `server_default` is needed and the deploy window is safe in both
directions: the pipeline migrates before it ships the image, and the old code never names these
columns in any SELECT it issues.

REVERSIBLE, with the cost stated: `downgrade` drops both columns, which loses which post or recipe
each open report was about. The reports themselves survive — only the subject link goes.

SQLite note: `op.drop_column` on SQLite rewrites the table, and `alembic` handles that via batch
mode only if asked. The chain is replayed on SQLite by the test suite, so the downgrade here uses
`batch_alter_table`, which is a no-op wrapper on Postgres and the required one on SQLite.
"""

from alembic import op
import sqlalchemy as sa


revision = "d58b2c0fa93e"
down_revision = "c47a1e8b5d92"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reports", sa.Column("post_id", sa.Integer(), nullable=True))
    op.add_column("reports", sa.Column("recipe_id", sa.Integer(), nullable=True))
    op.create_index("ix_reports_post_id", "reports", ["post_id"])
    op.create_index("ix_reports_recipe_id", "reports", ["recipe_id"])
    # NAMED constraints, because an unnamed one cannot be dropped portably — #31 was exactly this
    # lesson (a hardcoded Postgres constraint name broke the SQLite replay).
    with op.batch_alter_table("reports") as batch:
        batch.create_foreign_key(
            "fk_reports_post_id", "posts", ["post_id"], ["id"], ondelete="SET NULL"
        )
        batch.create_foreign_key(
            "fk_reports_recipe_id", "recipes", ["recipe_id"], ["id"], ondelete="SET NULL"
        )


def downgrade() -> None:
    with op.batch_alter_table("reports") as batch:
        batch.drop_constraint("fk_reports_recipe_id", type_="foreignkey")
        batch.drop_constraint("fk_reports_post_id", type_="foreignkey")
    op.drop_index("ix_reports_recipe_id", table_name="reports")
    op.drop_index("ix_reports_post_id", table_name="reports")
    op.drop_column("reports", "recipe_id")
    op.drop_column("reports", "post_id")
