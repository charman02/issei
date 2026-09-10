"""drop handoffs.note — a column written on every send and read by nothing (#102)

Revision ID: e7f8a9b0c1d2
Revises: d6e7f8a9b0c1
Create Date: 2026-09-10

THIS MIGRATION DESTROYS DATA, and the data is user-written text, so the reasoning is recorded here
rather than in a commit message someone would have to go looking for.

`handoffs.note` held the sender's message — "Here's my Adobo recipe, I wanted you to have it" — and
it was persisted on every single handoff. Nothing ever read it back: not `InvitePreview`, not the
OpenGraph card builder, no frontend surface. The message reached the recipient only as a string
handed to the share sheet, which means **no recipient has ever seen the stored copy**, and no screen
in the app has ever displayed one.

That left two coherent options and one incoherent status quo. Render it on the invite page, so the
message survives a forwarded link, a truncated SMS and every desktop browser — or stop keeping it,
and let it live where it reads most like the person who wrote it: their own texting app. Storing it
and showing it nowhere was the third thing, and the only one that was indefensible.

The owner chose to stop keeping it (2026-09-10). If it ever comes back, it comes back together with
a surface that displays it — the column alone is what created this situation.

DOWNGRADE RESTORES THE COLUMN, NOT THE TEXT. It is re-added nullable, which is what it always was,
so the schema round-trips cleanly; the notes themselves are gone the moment `upgrade()` runs. There
is no backup step here on purpose: adding one would imply the values are worth recovering, and the
decision above is that they are not.
"""

from alembic import op
import sqlalchemy as sa


revision = "e7f8a9b0c1d2"
down_revision = "d6e7f8a9b0c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # batch_alter_table for SQLite, which cannot DROP COLUMN before 3.35 and which the whole
    # migration chain has to replay on for the test suite (see the note in the migration that
    # hardcoded a Postgres constraint name and broke exactly that, #31).
    with op.batch_alter_table("handoffs") as batch:
        batch.drop_column("note")


def downgrade() -> None:
    with op.batch_alter_table("handoffs") as batch:
        batch.add_column(sa.Column("note", sa.String(), nullable=True))
