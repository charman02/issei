"""Ask the cook if you may pass their recipe on (#78).

Revision ID: f3a6c2e94b17
Revises: d58b2c0fa93e
Create Date: 2026-09-24

One new table, `pass_on_requests`: a permission between one reader and one cook about one
recipe. See `app/models/pass_on_request.py` for why the permission exists at all — the short
version is that a re-share is a READER creating access, and `GET /recipes/invite/{token}`
serves a whole recipe with no account, so anything narrower than `public` has to be the cook's
to widen.

A WHOLE NEW TABLE, so the deploy window is safe in the easiest possible way: the pipeline
migrates BEFORE it ships the image, and the old task cannot SELECT a table it has never heard
of. Nothing existing is altered and no column is added to a table the running code reads.

The UNIQUE constraint is declared INLINE in `create_table` rather than as a follow-up
`ALTER`, because SQLite has no ADD CONSTRAINT and `tests/test_migrations.py` replays this
chain up and fully down on SQLite. Same reason the constraint is NAMED: #31 was exactly this
lesson (an unnamed/Postgres-only constraint name broke the SQLite replay).

REVERSIBLE with no data loss worth the name: `downgrade` drops the table, which loses
outstanding pass-on permissions. Nothing else references it, and a dropped permission fails
CLOSED — re-share falls back to public-only, which is the conservative direction.
"""

from alembic import op
import sqlalchemy as sa


revision = "f3a6c2e94b17"
down_revision = "d58b2c0fa93e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pass_on_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "recipe_id",
            sa.Integer(),
            sa.ForeignKey("recipes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "requester_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("state", sa.String(), server_default="pending", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False
        ),
        # NULL while pending; set when the cook answers, either way.
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint(
            "recipe_id", "requester_id", name="uq_pass_on_recipe_requester"
        ),
    )
    op.create_index("ix_pass_on_requests_recipe_id", "pass_on_requests", ["recipe_id"])
    op.create_index(
        "ix_pass_on_requests_requester_id", "pass_on_requests", ["requester_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_pass_on_requests_requester_id", table_name="pass_on_requests")
    op.drop_index("ix_pass_on_requests_recipe_id", table_name="pass_on_requests")
    op.drop_table("pass_on_requests")
