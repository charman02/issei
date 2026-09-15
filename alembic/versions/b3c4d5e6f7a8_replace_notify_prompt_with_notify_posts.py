"""Add the three-valued notify_posts cadence, superseding (but NOT dropping) notify_prompt

The two ways of hearing that a friend posted are ALTERNATIVES, not additions: the 18:00 nudge
("3 friends posted since you last looked") summarises exactly the posts an instant push has
already announced. Two independent switches would deliver four notifications for three posts, so
this is one cadence with three values rather than a second boolean.

VALUE-FOR-VALUE, so nobody's existing choice moves on the day it ships:

    notify_prompt = TRUE   ->  notify_posts = 'daily'    (the nudge, unchanged)
    notify_prompt = FALSE  ->  notify_posts = 'off'

'instant' is reachable only by choosing it. The default is 'daily' because that is the retention
mechanism #89 was built for, and because it is what every account already had.

**THIS MIGRATION DELIBERATELY DOES NOT DROP `notify_prompt`, and that is the whole reason it is
shaped this way.** The first version did, and the ship gate caught what that means against
`.github/workflows/deploy.yml`: the pipeline runs `alembic upgrade head` FIRST, then builds and
pushes the image, then rolls the ECS service. So for the entire build-plus-rolling-deploy window
the OLD task serves traffic against the new schema — and its `User` model still declares
`notify_prompt`, so SQLAlchemy emits `SELECT ... users.notify_prompt ...` on every authenticated
request. Dropping it here is a `ProgrammingError` 500 on essentially the whole API for several
minutes, on a `desiredCount: 1` service, with `/health` still green because it never touches
`users` — so nothing would alarm and the deploy would look clean. And if the new tasks then failed
their health checks, ECS would roll back to an image that cannot talk to the database at all.

Adding a column is safe in both directions, which is what makes the split work:

  * old task, new schema — `notify_prompt` still there, still selected, still written. Fine.
  * new task, new schema — the model still DECLARES `notify_prompt` (it just stopped reading it),
    so it is selected and ignored. Fine.
  * new task, OLD schema (the instant before the migration, or a rollback) — `notify_posts` is
    missing and the new model declares it, so this window is not safe. It is also not a window
    the pipeline produces: migrations run before the image ships.

**Removing the column takes two MORE releases, and that is not squeamishness.** Release two stops
declaring `notify_prompt` on the model (no migration); release three drops it. Doing steps two and
three together means the release-one task — still serving during the roll — selects a column that
is already gone. And step two cannot be folded in here either, because
`tests/test_migrations.py::test_migrated_schema_matches_models` forbids ANY model/migration drift
and has no exemption mechanism; punching the first hole in an absolute guard to save one deploy is
the worse trade. The sequence is written out in TECHDEBT.

Revision ID: b3c4d5e6f7a8
Revises: f8a9b0c1d2e3
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision = "b3c4d5e6f7a8"
down_revision = "f8a9b0c1d2e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _users_table():
    return sa.table(
        "users",
        sa.column("notify_posts", sa.String()),
        sa.column("notify_prompt", sa.Boolean()),
    )


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "notify_posts",
            sa.String(),
            nullable=False,
            server_default="daily",
        ),
    )
    # Carry each account's existing choice across. Only the False case needs writing, since the
    # server_default already covers True.
    #
    # `== sa.false()` rather than `IS FALSE` / `= 0`: SQLAlchemy renders booleans per dialect and
    # this app runs SQLite locally and Postgres in prod, so the comparison is written the way each
    # dialect will emit it rather than hardcoding either one's literal.
    users = _users_table()
    op.execute(
        users.update().where(users.c.notify_prompt == sa.false()).values(notify_posts="off")
    )


def downgrade() -> None:
    # Re-sync the old boolean from the cadence before removing the cadence, or a downgrade would
    # silently revert anyone who changed the setting after the upgrade — `notify_prompt` was left
    # in place but nothing has written it since, so its values are stale by now.
    #
    # 'instant' collapses to TRUE, not FALSE: the person asked to hear about friends' posts, and
    # the boolean's only way to express that is on. A downgrade cannot preserve a distinction the
    # old column could not hold, so it preserves the INTENT.
    users = _users_table()
    op.execute(
        users.update().where(users.c.notify_posts == "off").values(notify_prompt=sa.false())
    )
    op.execute(
        users.update().where(users.c.notify_posts != "off").values(notify_prompt=sa.true())
    )
    # batch_alter_table because SQLite cannot DROP COLUMN in place on older versions — the same
    # reason the #105 migration's downgrade uses it.
    with op.batch_alter_table("users") as batch:
        batch.drop_column("notify_posts")
