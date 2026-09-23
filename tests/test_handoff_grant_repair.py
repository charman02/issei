"""The data migration that repairs handoff grants already dead in the database.

A data migration nothing exercises is a guess about production, and this one decides who can read
whose recipe — so it runs the REAL statement, imported from the migration module rather than
paraphrased here. A copy would drift, and a drifted copy of this test would report that a repair
works while the version that ships does something else.

What was broken (see the migration's own docstring, and TECHDEBT): `POST /recipes/{id}/handoff`
with a `to_email` stored the grant `pending` with `to_user_id` NULL regardless of whose address it
was. For an address that already had an account that row was unreachable in every surface, forever.
The code fix stops new ones; this binds the ones already written.
"""

import importlib.util
from pathlib import Path

from sqlalchemy import text

from app.models.handoff import Handoff
from app.models.recipe import Recipe

# Loaded BY PATH, not by import: `alembic/versions/` has no `__init__.py`, so it is a directory of
# scripts rather than a package and `import alembic.versions...` raises ModuleNotFoundError. Alembic
# itself loads them this way.
_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "a1b2c3d4e5f7_bind_dead_email_handoff_grants.py"
)
_spec = importlib.util.spec_from_file_location("_handoff_grant_repair_migration", _PATH)
_migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_migration)
REPAIR = _migration.BIND_DEAD_GRANTS_SQL


def _recipe(db, owner_id, name="Adobo"):
    r = Recipe(name=name, user_id=owner_id, visibility="private")
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def _pending_email_grant(db, recipe_id, from_user_id, to_email, token):
    h = Handoff(
        recipe_id=recipe_id,
        from_user_id=from_user_id,
        to_user_id=None,
        to_email=to_email,
        state="pending",
        token=token,
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


def test_a_dead_grant_is_bound_to_the_account_it_was_addressed_to(db_session, make_user):
    cook, _ = make_user()
    other, _ = make_user()
    recipe = _recipe(db_session, cook.id)
    h = _pending_email_grant(db_session, recipe.id, cook.id, other.email, "tok-dead-1")

    db_session.execute(text(REPAIR))
    db_session.commit()
    db_session.refresh(h)

    assert h.to_user_id == other.id
    assert h.state == "accepted"
    # `to_email` is cleared, which is what makes the migration idempotent: the row no longer matches
    # its own WHERE clause, so a re-run cannot touch it again.
    assert h.to_email is None


def test_it_matches_the_address_case_INSENSITIVELY(db_session, make_user):
    """The sender may have typed "Ana@x.com" for "ana@x.com". Those rows are dead by a second route
    — the signup auto-accept compared exactly until this round — so the repair has to reach them or
    it fixes the smaller half of the problem."""
    cook, _ = make_user()
    other, _ = make_user()
    recipe = _recipe(db_session, cook.id)
    h = _pending_email_grant(db_session, recipe.id, cook.id, other.email.upper(), "tok-case-1")

    db_session.execute(text(REPAIR))
    db_session.commit()
    db_session.refresh(h)

    assert h.to_user_id == other.id and h.state == "accepted"


def test_a_grant_to_an_address_with_NO_account_is_left_alone(db_session, make_user):
    """The load-bearing exclusion. A pending invite to a stranger is not broken — it is the founding
    shape of the product, waiting for signup's auto-accept to claim it (#88). Binding it to nobody,
    or accepting it, would destroy a working invite to repair a different bug."""
    cook, _ = make_user()
    recipe = _recipe(db_session, cook.id)
    h = _pending_email_grant(
        db_session, recipe.id, cook.id, "nobody-here-yet@example.com", "tok-stranger-1"
    )

    db_session.execute(text(REPAIR))
    db_session.commit()
    db_session.refresh(h)

    assert h.to_user_id is None
    assert h.state == "pending"
    assert h.to_email == "nobody-here-yet@example.com"


def test_an_already_accepted_grant_is_untouched(db_session, make_user):
    """Including the LINK-ONLY shape — `to_user_id` set, `to_email` NULL — which every claimed invite
    token produces. The WHERE clause needs all three conditions: a row with a to_email but already
    accepted, or already bound, must not be rewritten."""
    cook, _ = make_user()
    other, _ = make_user()
    recipe = _recipe(db_session, cook.id)
    live = Handoff(
        recipe_id=recipe.id,
        from_user_id=cook.id,
        to_user_id=other.id,
        to_email=None,
        state="accepted",
        token="tok-live-1",
    )
    db_session.add(live)
    db_session.commit()

    db_session.execute(text(REPAIR))
    db_session.commit()
    db_session.refresh(live)

    assert live.to_user_id == other.id and live.state == "accepted"


def test_an_unclaimed_LINK_only_grant_is_untouched(db_session, make_user):
    """A link-only handoff is `pending` with BOTH ids NULL — the token is the capability and nobody
    has claimed it yet. It has no `to_email`, so the repair must skip it; accepting it would hand a
    recipe to whoever the subquery happened to find, which for a NULL address is nobody, and
    `to_user_id = NULL, state = accepted` is a grant `can_view` would reject anyway. Pinned because
    dropping the `to_email IS NOT NULL` condition would look harmless and would corrupt this row."""
    cook, _ = make_user()
    recipe = _recipe(db_session, cook.id)
    link = Handoff(
        recipe_id=recipe.id,
        from_user_id=cook.id,
        to_user_id=None,
        to_email=None,
        state="pending",
        token="tok-linkonly-1",
    )
    db_session.add(link)
    db_session.commit()

    db_session.execute(text(REPAIR))
    db_session.commit()
    db_session.refresh(link)

    assert link.to_user_id is None and link.state == "pending"


def test_running_it_twice_changes_nothing_the_second_time(db_session, make_user):
    """Idempotent by construction rather than by a guard, which is worth pinning: a migration can be
    re-run by a human, and `alembic upgrade head` on a partially-applied deploy is a real event."""
    cook, _ = make_user()
    other, _ = make_user()
    recipe = _recipe(db_session, cook.id)
    h = _pending_email_grant(db_session, recipe.id, cook.id, other.email, "tok-twice-1")

    db_session.execute(text(REPAIR))
    db_session.commit()
    db_session.refresh(h)
    first = (h.to_user_id, h.state, h.to_email)

    db_session.execute(text(REPAIR))
    db_session.commit()
    db_session.refresh(h)

    assert (h.to_user_id, h.state, h.to_email) == first


def test_the_repaired_grant_actually_opens_the_recipe(client, db_session, make_user):
    """END TO END, which is the only assertion that proves the repair was worth running. The three
    columns are a means; what was broken was that the recipient could not read the dish."""
    cook, _ = make_user()
    other, oh = make_user()
    recipe = _recipe(db_session, cook.id, name="Kare-kare")
    _pending_email_grant(db_session, recipe.id, cook.id, other.email, "tok-e2e-1")

    # Before: the grant exists and is useless — a private recipe with no reachable grant.
    assert client.get(f"/recipes/{recipe.id}", headers=oh).status_code == 404
    assert client.get("/recipes/shared", headers=oh).json() == []

    db_session.execute(text(REPAIR))
    db_session.commit()

    assert client.get(f"/recipes/{recipe.id}", headers=oh).status_code == 200
    assert [r["id"] for r in client.get("/recipes/shared", headers=oh).json()] == [recipe.id]
