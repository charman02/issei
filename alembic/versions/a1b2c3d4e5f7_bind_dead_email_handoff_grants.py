"""Bind email-addressed handoff grants whose address already has an account.

Revision ID: a1b2c3d4e5f7
Revises: e6f7a8b9c0d1
Create Date: 2026-09-23

THE ROWS THIS REPAIRS ARE DEAD, NOT MERELY UNCLAIMED. `POST /recipes/{id}/handoff` with a
`to_email` used to store the grant `pending` with `to_user_id` NULL no matter whose address it
was. For an address with no account that is correct — signup claims it. For an address that
ALREADY had an account it was unreachable in every surface, permanently:

  · `GET /recipes/shared` filters on `to_user_id`, so the recipe never appeared on their shelf;
  · `can_view`'s grant branch requires BOTH `accepted` AND a matching `to_user_id`, so opening
    the recipe 404'd;
  · the signup auto-accept in `routers/auth.py` matches on account CREATION, which for an
    existing account had run long before this row was written.

The code fix stops new ones. This binds the ones already in the database, because nothing else
ever will: the recipient cannot see the grant to accept it, and the cook has no reason to think
their "sent ✓" did nothing.

WHY THIS IS SAFE TO RUN FORWARD. It grants exactly what the sender chose to grant, to exactly the
account they addressed, and nothing else — one recipe, one person, from a row that person's cook
created deliberately. It is `UPDATE` only: no row is deleted, no column is dropped, and it touches
nothing outside `handoffs`. Being a subquery match on `lower(to_email) = lower(users.email)`, it is
idempotent — a second run finds nothing, because the rows it fixed no longer have a `to_email`.

WHY A BLOCK IS NOT CONSULTED. #85's locked rule, restated in #88: a grant that already existed at
block time SURVIVES a block, because the cook genuinely handed that dish over and a block means "no
new contact", not "unsend". These grants all predate the block by definition — they predate this
migration. Binding one does not create access the cook did not choose to give; it delivers access
the app failed to record properly. (A *new* grant still cannot cross a block: `handoff_recipe`
404s, which is the check #105 added and this migration does not touch.)

WHAT IT DELIBERATELY DOES NOT DO: notify anybody. `notify()` lives in the application and needs a
session, an actor and a push queue; a migration that wrote inbox rows would be reaching across that
line, and the arrival is discoverable anyway — the recipe simply appears on the Kept shelf where it
should have been all along. A cook who wants the notification to fire can re-send, which the route
now heals and announces.
"""

from alembic import op
import sqlalchemy as sa


revision = "a1b2c3d4e5f7"
down_revision = "e6f7a8b9c0d1"
branch_labels = None
depends_on = None


# ONE CORRELATED UPDATE rather than a Python loop, so it runs as a single statement on both
# backends. Postgres would accept `UPDATE ... FROM`; SQLite would not; the correlated subquery is the
# form both take — which matters because the suite replays this whole chain on SQLite (a hardcoded
# Postgres constraint name broke that once already, #31).
#
# EXPORTED so `tests/test_handoff_grant_repair.py` can execute the real statement instead of a
# paraphrase of it. A data migration nothing exercises is a guess about production, and this one
# decides who can read whose recipe.
BIND_DEAD_GRANTS_SQL = """
    UPDATE handoffs
       SET to_user_id = (
               SELECT u.id FROM users u
                WHERE lower(u.email) = lower(handoffs.to_email)
           ),
           to_email = NULL,
           state = 'accepted'
     WHERE to_user_id IS NULL
       AND to_email IS NOT NULL
       AND state = 'pending'
       AND EXISTS (
               SELECT 1 FROM users u
                WHERE lower(u.email) = lower(handoffs.to_email)
           )
"""


def upgrade() -> None:
    op.execute(sa.text(BIND_DEAD_GRANTS_SQL))


def downgrade() -> None:
    # NOT REVERSIBLE, and saying so is more honest than a plausible inverse. Rows repaired here are
    # now indistinguishable from every grant the `to_user_id` path has always written: same shape,
    # same state, `to_email` cleared. Reconstructing the address would mean reading it back off the
    # user and un-accepting a grant the recipient may have cooked from since — undoing a delivery
    # rather than undoing a schema change. The forward migration adds no column, so a downgrade past
    # it needs nothing undone.
    pass
