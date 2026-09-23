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
    / "b9d3f07a4c81_bind_dead_email_handoff_grants.py"
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
    """The LINK-ONLY shape specifically — `to_user_id` set, `to_email` NULL — which every claimed
    invite token produces.

    Its first docstring claimed this also covered "a row with a to_email but already accepted, or
    already bound", which it did not: the row built here has `to_email=None`, so it exercised
    neither. A ship gate mutation-tested the statement and found only ONE of its four conditions
    actually pinned. The two real cases now have their own tests below, and the shape they protect
    is live in production."""
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
    has claimed it yet. It has no `to_email`, so the repair must skip it.

    HONEST ABOUT WHAT THIS DOES NOT PROVE: its first docstring said dropping `to_email IS NOT NULL`
    "would corrupt this row", and a gate showed that is false — the `count(*) = 1` subquery already
    excludes a NULL address, so this row survives that mutation untouched. The condition is kept as
    an explicit statement of intent rather than as the only thing standing between this row and
    damage, and this test is kept because the row shape must stay excluded however the clause is
    later rewritten."""
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


# --- the three conditions a ship gate found unpinned, each with the shape it really protects ---


def test_a_row_ALREADY_BOUND_to_someone_else_is_never_re_pointed(db_session, make_user):
    """`to_user_id IS NULL` and `state = 'pending'`, and this is the shape that makes them matter.

    `claim_invite` sets `to_user_id` WITHOUT clearing `to_email`, so a row can be accepted, bound to
    whoever actually held the link, and still carry the address it was first sent to — the documented
    mismatched-email orphan flow, and a shape live in production today. With either guard dropped,
    the repair re-points that grant from the claimer to the addressee: a silent revocation of access
    somebody is already using, which is exactly what `accept_handoff` was hardened against.

    Measured by the gate with both guards removed: `(3, 'other@x.com', 'accepted')` became
    `(9, None, 'accepted')`.
    """
    cook, _ = make_user()
    claimer, _ = make_user()
    addressee, _ = make_user()
    recipe = _recipe(db_session, cook.id)
    row = Handoff(
        recipe_id=recipe.id,
        from_user_id=cook.id,
        to_user_id=claimer.id,          # the person who actually claimed the link
        to_email=addressee.email,       # the address it was addressed to, NOT cleared
        state="accepted",
        token="tok-orphan-1",
    )
    db_session.add(row)
    db_session.commit()

    db_session.execute(text(REPAIR))
    db_session.commit()
    db_session.refresh(row)

    assert row.to_user_id == claimer.id, "the real claimer's access must survive the repair"
    assert row.to_email == addressee.email
    assert row.state == "accepted"


def test_an_AMBIGUOUS_address_is_left_alone_rather_than_bound_to_a_guess(db_session, make_user):
    """TWO ACCOUNTS, ONE ADDRESS, CASE-DIFFERING — and the repair must decline.

    `users.email` has a plain case-SENSITIVE unique index and `EmailStr` normalises only the domain,
    so `ANA@x.com` and `ana@x.com` are two independently loginable accounts. The first version of
    this statement bound with a bare scalar subquery, which a ship gate showed **aborts the whole
    migration on Postgres** (`more than one row returned by a subquery used as an expression`, and
    the pipeline migrates before it ships the image, so the deploy stops there) while **silently
    binding an arbitrary one of them on SQLite** — the only backend this suite runs, which is why no
    test here could have caught it.

    Skipping is right rather than merely safe: the cook still holds the token, and delivering
    someone's private recipe to a coin flip is worse than not delivering it.
    """
    cook, _ = make_user()
    # Neither matches the stored address exactly, so the count(*) subquery sees two rows.
    twin_upper, _ = make_user(email="TWIN@example.com")
    twin_lower, _ = make_user(email="TwIn@example.com")
    recipe = _recipe(db_session, cook.id)
    h = _pending_email_grant(
        db_session, recipe.id, cook.id, "twin@example.com", "tok-ambiguous-1"
    )

    # Must not raise on either backend, and must not bind.
    db_session.execute(text(REPAIR))
    db_session.commit()
    db_session.refresh(h)

    assert h.to_user_id is None, "an ambiguous address must not resolve to a guess"
    assert h.state == "pending"
    assert h.to_email == "twin@example.com"
    # Neither twin gained access.
    assert twin_upper.id != twin_lower.id


def test_it_does_NOT_bind_across_a_BLOCK(db_session, make_user, client):
    """The route refuses this exact act; the migration must not quietly perform it.

    The first version argued #85/#88 covered it — "a grant that already existed at block time
    survives" — and that misreads both. **This row was never a grant**: it was pending and
    unreachable in every surface. #88's rule is that a pending invite stays CLAIMABLE, which is the
    RECIPIENT acting. Binding it here claims it on the blocker's behalf, putting a blocked cook's
    recipe, byline and story on their Kept shelf, unannounced, with nothing to explain it — against
    #85's promise of mutual invisibility from then on.

    Either direction, because `is_blocked` is symmetric over a directional row.
    """
    from app.models.block import Block

    cook, _ = make_user()
    fan, fh = make_user()
    recipe = _recipe(db_session, cook.id)
    h = _pending_email_grant(db_session, recipe.id, cook.id, fan.email, "tok-blocked-1")
    # The FAN blocks the cook — the direction that matters, since the cook is the sender.
    db_session.add(Block(blocker_id=fan.id, blocked_id=cook.id))
    db_session.commit()

    db_session.execute(text(REPAIR))
    db_session.commit()
    db_session.refresh(h)

    assert h.to_user_id is None and h.state == "pending"
    assert client.get(f"/recipes/{recipe.id}", headers=fh).status_code == 404
    assert client.get("/recipes/shared", headers=fh).json() == []


def test_it_DOES_bind_when_the_block_is_between_OTHER_people(db_session, make_user):
    """The other half of the block exclusion — without this, "blocks are excluded" is
    indistinguishable from "the NOT EXISTS clause matches everything and nothing is ever repaired."
    """
    from app.models.block import Block

    cook, _ = make_user()
    other, _ = make_user()
    stranger, _ = make_user()
    recipe = _recipe(db_session, cook.id)
    h = _pending_email_grant(db_session, recipe.id, cook.id, other.email, "tok-unrelated-block")
    db_session.add(Block(blocker_id=stranger.id, blocked_id=cook.id))
    db_session.commit()

    db_session.execute(text(REPAIR))
    db_session.commit()
    db_session.refresh(h)

    assert h.to_user_id == other.id and h.state == "accepted"


def test_each_of_the_two_state_guards_holds_on_its_OWN(db_session, make_user):
    """`to_user_id IS NULL` and `state = 'pending'` MASK EACH OTHER on every shape the app writes,
    which is why a gate's mutation run found neither individually pinned.

    On the real orphan row above (bound AND accepted) either guard alone excludes it, so dropping one
    changes nothing and only dropping BOTH re-points the grant. That combined case is covered by the
    test above; these two rows cover the conditions singly.

    STATED PLAINLY: neither row here is a shape the app writes today — `accept_handoff` and
    `claim_invite` both set `to_user_id` and `state` together. They are defense in depth against a
    future partial write, and against someone deleting one condition because "the other one already
    covers it". That reasoning is exactly what the masking makes look true.
    """
    cook, _ = make_user()
    claimer, _ = make_user()
    addressee, _ = make_user()
    recipe = _recipe(db_session, cook.id)

    bound_but_pending = Handoff(
        recipe_id=recipe.id,
        from_user_id=cook.id,
        to_user_id=claimer.id,
        to_email=addressee.email,
        state="pending",
        token="tok-bound-pending",
    )
    unbound_but_accepted = Handoff(
        recipe_id=recipe.id,
        from_user_id=cook.id,
        to_user_id=None,
        to_email=addressee.email,
        state="accepted",
        token="tok-unbound-accepted",
    )
    db_session.add_all([bound_but_pending, unbound_but_accepted])
    db_session.commit()

    db_session.execute(text(REPAIR))
    db_session.commit()
    db_session.refresh(bound_but_pending)
    db_session.refresh(unbound_but_accepted)

    # `to_user_id IS NULL` is the only thing excluding the first row.
    assert bound_but_pending.to_user_id == claimer.id
    assert bound_but_pending.to_email == addressee.email
    # `state = 'pending'` is the only thing excluding the second.
    assert unbound_but_accepted.to_user_id is None
    assert unbound_but_accepted.to_email == addressee.email
