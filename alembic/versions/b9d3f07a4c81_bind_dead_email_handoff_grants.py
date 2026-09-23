"""Bind email-addressed handoff grants whose address already has exactly one account.

Revision ID: b9d3f07a4c81
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

THE REVISION ID IS DELIBERATELY UNLIKE ITS NEIGHBOURS. The first version of this migration was
`a1b2c3d4e5f7`, one character from the existing `a1b2c3d4e5f6` — which is ALSO about handoff
grants (it indexes the grant lookup). A ship gate pointed out that anyone reading
`alembic_version` to confirm this deploy could read one as the other and believe a data repair had
run when it hadn't. Renaming removes the hazard; documenting it only warns about it.

## Three conditions here exist because a ship gate broke the first version

**1. EXACTLY ONE ACCOUNT, or this row is skipped.** `users.email` carries a plain case-SENSITIVE
unique index and Pydantic's `EmailStr` normalises only the domain, so `ANA@x.com` and `ana@x.com`
are two separate, independently loginable accounts — an honest duplicate signup produces that, and
so does anyone who wants it. The first version bound with a bare scalar subquery on
`lower(u.email) = lower(handoffs.to_email)`, which with two such accounts:

  · on **Postgres** raises `more than one row returned by a subquery used as an expression`, and
    since the pipeline migrates BEFORE it pushes the image, that fails the deploy at the migration
    step. No data damage — the transaction rolls back — but a red deploy whose cause is not obvious;
  · on **SQLite** silently binds an ARBITRARY one of them. Measured. And SQLite is the only backend
    the suite runs, so no test could have caught either outcome.

A tie now resolves to nobody and the row is left alone. Delivering someone's private recipe to a
coin flip is the one outcome worse than not delivering it; the cook still holds the token.

**2. NOT ACROSS A BLOCK.** The route refuses this exact act — `handoff_recipe` 404s when either
party has blocked the other — and a migration must not quietly perform what the live code forbids.
The first version argued #85/#88 covered it ("a grant that already existed at block time
survives"), and that is the wrong reading: **this row was never a grant.** It was pending and
unreachable in every surface, and #88's rule is that a pending invite stays CLAIMABLE — the
RECIPIENT acts. Binding it here would claim it on the blocker's behalf, putting a blocked cook's
recipe, byline and story on their Kept shelf, unannounced, with no way to learn why. #85 promises
mutual invisibility from then on. So blocked pairs are excluded, in either direction.

`invite_permission` is deliberately NOT consulted, and that asymmetry is #88's own line: a grant
offered BEFORE a restriction stays claimable, because the cook chose to send it. A block is not a
preference about who may contact you later — it is a statement about a person.

**3. ONLY UNBOUND, PENDING ROWS WITH AN ADDRESS.** All three conditions are load-bearing together:
`claim_invite` and `accept_handoff` both set `to_user_id` WITHOUT clearing `to_email`, so a row can
be `accepted`, bound to whoever actually held the link, and still carry the address it was
originally sent to. Dropping either guard re-points that grant at the addressee and silently
revokes the real claimer's access.

## Other properties

IDEMPOTENT by construction rather than by a guard: it clears `to_email`, so a repaired row no
longer matches its own WHERE clause. Safe to re-run, which matters because `alembic upgrade head`
on a partially-applied deploy is a real event.

UPDATE-only on `handoffs`. No row deleted, no column added or dropped, nothing outside this table.
It grants exactly what the sender chose, to exactly the account they addressed.

IT NOTIFIES NOBODY. `notify()` needs a session, an actor and a push queue; a migration writing
inbox rows would reach across that line. The arrival is discoverable anyway — the recipe simply
appears on the Kept shelf where it should have been all along — and a cook who wants the
notification to fire can re-send, which the route now heals and announces.
"""

from alembic import op
import sqlalchemy as sa


revision = "b9d3f07a4c81"
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
       AND (
               SELECT count(*) FROM users u
                WHERE lower(u.email) = lower(handoffs.to_email)
           ) = 1
       AND NOT EXISTS (
               SELECT 1
                 FROM users u
                 JOIN blocks b
                   ON (b.blocker_id = handoffs.from_user_id AND b.blocked_id = u.id)
                   OR (b.blocker_id = u.id AND b.blocked_id = handoffs.from_user_id)
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
