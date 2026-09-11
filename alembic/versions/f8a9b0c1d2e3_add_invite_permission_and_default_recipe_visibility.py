"""add invite_permission and default_recipe_visibility to users (#105)

Two settings the owner approved after the You page's two dead display toggles came out. Both live
on `users` because both are about the PERSON rather than a device or an item.

`invite_permission` ("anyone" | "friends") closes the app's last unsolicited-contact channel:
`POST /recipes/{id}/handoff` takes a `to_email`, and blocking cannot reach it because there is
nobody to block until after a stranger has already put a recipe on your shelf. Defaulted to
"anyone" — the PERMISSIVE value — on purpose: that is today's behaviour, and tightening every
existing account by fiat would break sends already in flight for people who never asked for it.

`default_recipe_visibility` ("public" | "friends" | "private") states directly what the create
form pre-selects. It is NOT a fourth visibility value and NOT a live pointer — an item's
visibility is still stored literally at create time (#68), so this changes nothing already saved.

THE BACKFILL IS THE POINT of this migration, not the columns. The default was previously INFERRED
from `profile_visibility`, which is two-valued while an item's visibility is three-valued: a public
profile pre-selected "public", a private one pre-selected "friends". A flat `server_default` of
"friends" would therefore have silently changed the create form for every public-profile account on
the day this shipped — they would have gone from publishing to Browse by default to not. So the
column is backfilled from the profile it used to be derived from, and nobody's form moves.

Revision ID: f8a9b0c1d2e3
Revises: e7f8a9b0c1d2
"""

from alembic import op
import sqlalchemy as sa


revision = "f8a9b0c1d2e3"
down_revision = "e7f8a9b0c1d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # server_default (not just `default`) so the columns are NOT NULL for rows that already
    # exist — an app-side default would leave every current row null and fail the constraint.
    op.add_column(
        "users",
        sa.Column(
            "invite_permission",
            sa.String(),
            nullable=False,
            server_default="anyone",
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "default_recipe_visibility",
            sa.String(),
            nullable=False,
            server_default="friends",
        ),
    )
    # Preserve the behaviour the inference produced: a public profile pre-selected "Everyone".
    # Written as textual SQL against the two literal values rather than through the ORM, because a
    # migration must not import a model whose columns may have moved on by the time it replays.
    op.execute(
        "UPDATE users SET default_recipe_visibility = 'public' "
        "WHERE profile_visibility = 'public'"
    )


def downgrade() -> None:
    # batch_alter_table for SQLite, which had no DROP COLUMN before 3.35 — and the whole chain
    # replays against SQLite in tests/test_migrations.py, so this is exercised rather than
    # theoretical.
    with op.batch_alter_table("users") as batch:
        batch.drop_column("default_recipe_visibility")
        batch.drop_column("invite_permission")
