"""Drop notify_prompt and notify_posts — release 3 of 3, the one that finally removes them

The end of a cleanup that took three deploys. `users.notify_prompt` (#89's daily-nudge switch) and
`users.notify_posts` (the three-value cadence that superseded it for exactly one day) have both been
dead since #108 split the preference into `notify_prompt_me` / `notify_friend_posts` /
`notify_people`.

WHY THREE RELEASES, since this migration is four lines and looks like it could always have been one.
`.github/workflows/deploy.yml` runs `alembic upgrade head` FIRST, then builds and pushes the image,
then rolls ECS. So the OLD task serves traffic against the NEW schema for the whole window. Drop a
column while the running image still selects it and every authenticated request raises
`ProgrammingError` — on a `desiredCount: 1` service, with `/health` still green because it never
touches `users`, so nothing alarms. A health-check failure would then roll ECS back to an image that
cannot talk to the database at all.

    release 1 (c4e65ba)  add the three switches, backfill, stop READING both columns
    release 2 (071adab)  `exclude_properties` — the ORM stops NAMING them in any statement
    release 3 (this one)  drop the columns; the model stops declaring them in the same commit

THIS MIGRATION IS ONLY SAFE BECAUSE RELEASE 2 IS ALREADY RUNNING IN PRODUCTION. That is not a
formality: release 2's image emits no SELECT and no INSERT mentioning either column
(`tests/test_migrations.py::test_no_statement_the_ORM_emits_NAMES_a_removed_column` asserts it
against captured SQL), so it survives this drop happening underneath it. Release 1's image does NOT
— it maps both columns. If this ever needs redoing for another column, the ordering constraint
is the part to copy, not the four lines of `drop_column`.

Both columns together, deliberately, rather than two interleaved three-release sequences over the
same table: `notify_prompt`'s removal was already pending when `notify_posts` joined it a day later,
and running two of these in parallel is how one of them gets forgotten.

`batch_alter_table` because SQLite cannot `ALTER TABLE ... DROP COLUMN` before 3.35 and Alembic's
batch mode rebuilds the table instead. Production is Postgres, where this is a cheap catalogue
update; the batch wrapper is what keeps the chain replayable on the SQLite the test suite uses.

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision = "e6f7a8b9c0d1"
down_revision = "d5e6f7a8b9c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("notify_prompt")
        batch.drop_column("notify_posts")


def downgrade() -> None:
    # Recreated with their ORIGINAL server defaults, so a downgrade lands on the values every row
    # actually had rather than on NULLs a NOT NULL column would reject. The data itself is NOT
    # recoverable and does not need to be: nothing has read either column since #108, so every
    # stored value is whatever the backfill or the default left there, and the live switches carry
    # the person's real preference. `server_default` is what fills existing rows during the ALTER —
    # without it, adding a NOT NULL column to a non-empty `users` fails outright.
    op.add_column(
        "users",
        sa.Column("notify_prompt", sa.Boolean(), nullable=False, server_default="1"),
    )
    op.add_column(
        "users",
        sa.Column("notify_posts", sa.String(), nullable=False, server_default="daily"),
    )
