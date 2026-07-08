# Recipe Sharing (the "Shared" tier) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the middle visibility tier — Private → **Shared** → Public — as one action: passing a private recipe to someone grants them view+cook+remix access (root-bound), completing the Handoff primitive with the accept lifecycle it was missing, plus a "shared with me" surface.

**Architecture:** Reuse the existing `handoffs` table as the access grant (no new table); its `state` becomes `pending|accepted`. Grants attach to the lineage **root** (passing normalizes to root). A new `can_view(recipe, user, db)` gate = public-root OR owner OR accepted-grant-on-root, applied to `get_recipe`/`get_lineage`. In-app grants are instant-accepted; email invites are `pending` and auto-accept when a user signs up with the matching email. Frontend: visibility-adaptive pass copy, a "shared with me" view (accepted only, no accept UI), and a "Shared with N" indicator.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Pydantic 2 + pytest + Alembic (backend); React 18 + Vite + Tailwind + Vitest/RTL (frontend). All harnesses exist.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-08-recipe-sharing-design.md`. Builds on visibility (`2026-07-08-recipe-visibility-design.md`) + lineage §4.
- **Handoff IS sharing** — one concept, no separate access-grant feature.
- **Uniform read rule:** viewable iff `effective_visibility(root)=="public"` OR `user==owner` OR the user has an **accepted** handoff on the recipe's **root**.
- **`state` ∈ `pending | accepted`** (repurposed from the never-populated `pending|kept|cooked`). No prod data → semantic change, not a data migration.
- **Grants attach to the ROOT.** Passing any node normalizes `handoff.recipe_id` to the lineage root's id. Idempotent per `(root_id, grantee)`.
- **In-app grant = INSTANT** (`state="accepted"` on create). **Email invite = `pending`**, **auto-accepts on signup** when `to_email` matches the new user (link `to_user_id` + set `accepted`).
- **Owner-only** passing; grantees cannot re-share.
- **NO Accept UI in MVP** — the `POST` accept endpoint exists (backend, for a future invite-link/mismatched-email flow) but is not surfaced. "Shared with me" shows accepted only.
- **`visibility` unchanged** (`private|public`); "Shared" emerges from grants, not an enum value.
- **Run:** backend `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q`; frontend `cd frontend && npx vitest run`.
- **Don't git commit without explicit user approval.** Per-task Commit steps stage + write the message; a human approves.

---

## File Structure

**Backend:**
- `app/services/lineage.py` — add `root_of(recipe, db)` (returns the root Recipe) + `can_view(recipe, user, db)`. (Refactor `effective_visibility` to use `root_of` for DRY.)
- `app/routers/recipes.py` — handoff create: normalize to root + instant-accept in-app / pending email + idempotency; replace `get_recipe`/`get_lineage` read-gate with `can_view`; add `POST /recipes/handoffs/{id}/accept`; add `GET /recipes/shared`.
- `app/routers/auth.py` — signup: resolve+auto-accept matching `pending` email invites.
- `app/schemas/recipe.py` — a `SharedRecipe`/reuse `RecipeResponse` for the shared list; a small `shared_with_count` maybe on response (see Task 6). `HandoffResponse` already exists.
- `alembic/versions/…` — index on `handoffs (recipe_id, to_user_id, state)`; no column changes.
- `tests/test_sharing.py` (create) — the full matrix.

**Frontend:**
- `frontend/src/api/lineage.js` — `getSharedWithMe()`; (handoff call already exists).
- `frontend/src/components/HandoffInvite.jsx` — copy adapts to `recipe.visibility` (grant vs nudge).
- `frontend/src/pages/SharedWithMe.jsx` (create) + route, OR a section in `MyRecipes.jsx` — accepted-shared recipes.
- `frontend/src/components/VisibilityControl.jsx` — "· Shared with N" next to the private pill.
- co-located `*.test.*`.

---

## Task 1: `root_of` + `can_view` service helpers

**Files:**
- Modify: `app/services/lineage.py`
- Test: `tests/test_sharing.py` (create)

**Interfaces:**
- Produces:
  - `root_of(recipe, db) -> Recipe` — walks `parent_recipe_id` to the root, returns the root Recipe (cycle-guarded). 
  - `can_view(recipe, user, db) -> bool` — `True` if `root.visibility=="public"` OR `recipe.user_id==user.id` OR an **accepted** `Handoff` exists with `recipe_id==root.id` and `to_user_id==user.id`.
  - `effective_visibility(recipe, db)` refactored to `return root_of(recipe, db).visibility` (behavior unchanged).

- [ ] **Step 1: Write the failing tests**

Create `tests/test_sharing.py`:

```python
def _payload(name="Adobo", **extra):
    return {"name": name,
            "ingredients": [{"name": "chicken", "quantity_text": "2 lbs",
                             "quantity_type": "precise", "position": 1}],
            "steps": [{"content": "Cook", "position": 1}], **extra}


def test_root_of_walks_to_root(db_session, make_user):
    from app.models.recipe import Recipe
    from app.services.lineage import root_of
    u, _ = make_user()
    root = Recipe(user_id=u.id, name="R", lineage_relation="root")
    db_session.add(root); db_session.commit(); db_session.refresh(root)
    child = Recipe(user_id=u.id, name="C", parent_recipe_id=root.id, lineage_relation="remixed")
    db_session.add(child); db_session.commit(); db_session.refresh(child)
    assert root_of(child, db_session).id == root.id
    assert root_of(root, db_session).id == root.id


def test_can_view_owner_public_and_grant(db_session, make_user):
    from app.models.recipe import Recipe
    from app.models.handoff import Handoff
    from app.services.lineage import can_view
    owner, _ = make_user()
    other, _ = make_user()
    root = Recipe(user_id=owner.id, name="R", lineage_relation="root", visibility="private")
    db_session.add(root); db_session.commit(); db_session.refresh(root)

    assert can_view(root, owner, db_session) is True         # owner
    assert can_view(root, other, db_session) is False        # private, no grant
    # accepted grant on the root → other can view
    db_session.add(Handoff(recipe_id=root.id, from_user_id=owner.id,
                           to_user_id=other.id, state="accepted"))
    db_session.commit()
    assert can_view(root, other, db_session) is True
    # a pending grant does NOT grant view
    other2, _ = make_user()
    db_session.add(Handoff(recipe_id=root.id, from_user_id=owner.id,
                           to_user_id=other2.id, state="pending"))
    db_session.commit()
    assert can_view(root, other2, db_session) is False
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_sharing.py -v`
Expected: FAIL — `ImportError: cannot import name 'root_of'` / `can_view`.

- [ ] **Step 3: Implement in `app/services/lineage.py`**

Replace the body of `effective_visibility` and add the helpers (keep the cycle-guard):

```python
def root_of(recipe, db):
    """Walk parent_recipe_id to the lineage root; return the root Recipe."""
    from app.models.recipe import Recipe
    seen = set()
    current = recipe
    while current.parent_recipe_id is not None and current.id not in seen:
        seen.add(current.id)
        parent = db.query(Recipe).filter(Recipe.id == current.parent_recipe_id).first()
        if parent is None:
            break
        current = parent
    return current


def effective_visibility(recipe, db):
    """A recipe's visibility is its ROOT's visibility (root binds descendants)."""
    return root_of(recipe, db).visibility


def can_view(recipe, user, db):
    """public root OR owner OR an accepted grant on the root (see sharing spec)."""
    from app.models.handoff import Handoff
    if recipe.user_id == user.id:
        return True
    root = root_of(recipe, db)
    if root.visibility == "public":
        return True
    return db.query(Handoff).filter(
        Handoff.recipe_id == root.id,
        Handoff.to_user_id == user.id,
        Handoff.state == "accepted",
    ).first() is not None
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_sharing.py -v`
Expected: PASS.

- [ ] **Step 5: Run full backend suite (effective_visibility refactor must not regress)**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q`
Expected: all pass (existing visibility tests still green — the refactor is behavior-preserving).

- [ ] **Step 6: Commit**

```bash
git add app/services/lineage.py tests/test_sharing.py
git commit -m "feat: root_of + can_view lineage helpers (grant-aware read check)"
```

---

## Task 2: Handoff create = grant (root-normalize, instant/pending, idempotent)

**Files:**
- Modify: `app/routers/recipes.py` (`handoff_recipe`)
- Test: `tests/test_sharing.py` (extend)

**Interfaces:**
- Consumes: `root_of` (Task 1), `Handoff`, `User`.
- Produces: `POST /recipes/{id}/handoff` now: normalizes `recipe_id` to the root's id; if `to_user_id` refers to an existing user → `state="accepted"`; else if `to_email` → `state="pending"`; idempotent per `(root_id, grantee)` (returns the existing grant instead of duplicating). Owner-only (existing). Still returns `HandoffResponse`.

- [ ] **Step 1: Write the failing tests (extend `tests/test_sharing.py`)**

```python
def test_handoff_to_user_is_instant_accepted_and_root_normalized(client, make_user, db_session):
    from app.models.handoff import Handoff
    from app.models.recipe import Recipe
    owner, oheaders = make_user()
    grantee, _ = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    # pass the ROOT to the grantee (by user id)
    r = client.post(f"/recipes/{root['id']}/handoff",
                    json={"to_user_id": grantee.id}, headers=oheaders)
    assert r.status_code == 201
    h = db_session.query(Handoff).filter_by(recipe_id=root["id"], to_user_id=grantee.id).one()
    assert h.state == "accepted"


def test_handoff_normalizes_branch_to_root(client, make_user, db_session):
    from app.models.handoff import Handoff
    owner, oheaders = make_user()
    grantee, _ = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    child = client.post(f"/recipes/{root['id']}/remix",
                        json={"ingredients": [{"name": "x", "quantity_text": "1",
                              "quantity_type": "precise", "position": 1}], "steps": []},
                        headers=oheaders).json()
    # owner passes the CHILD → grant must attach to the ROOT
    client.post(f"/recipes/{child['id']}/handoff",
                json={"to_user_id": grantee.id}, headers=oheaders)
    assert db_session.query(Handoff).filter_by(recipe_id=root["id"], to_user_id=grantee.id).count() == 1
    assert db_session.query(Handoff).filter_by(recipe_id=child["id"]).count() == 0


def test_handoff_email_is_pending(client, make_user, db_session):
    from app.models.handoff import Handoff
    owner, oheaders = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    client.post(f"/recipes/{root['id']}/handoff",
                json={"to_email": "mom@example.com"}, headers=oheaders)
    h = db_session.query(Handoff).filter_by(recipe_id=root["id"], to_email="mom@example.com").one()
    assert h.state == "pending" and h.to_user_id is None


def test_handoff_idempotent_per_grantee(client, make_user, db_session):
    from app.models.handoff import Handoff
    owner, oheaders = make_user()
    grantee, _ = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    client.post(f"/recipes/{root['id']}/handoff", json={"to_user_id": grantee.id}, headers=oheaders)
    client.post(f"/recipes/{root['id']}/handoff", json={"to_user_id": grantee.id}, headers=oheaders)
    assert db_session.query(Handoff).filter_by(recipe_id=root["id"], to_user_id=grantee.id).count() == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_sharing.py -k handoff -v`
Expected: FAIL — grants attach to the passed recipe (not root), state always "pending", duplicates allowed.

- [ ] **Step 3: Rewrite `handoff_recipe` body**

In `app/routers/recipes.py`, replace the `handoff_recipe` body (keep the decorator/signature). Ensure `root_of` is imported at top (`from app.services.lineage import ..., root_of`):

```python
    recipe = db.query(Recipe).filter(
        Recipe.id == recipe_id,
        Recipe.user_id == current_user.id,
        Recipe.deleted_at == None,
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    # Grants attach to the lineage root (root-binds).
    root = root_of(recipe, db)

    # Resolve grantee: an in-app user (instant-accept) or an email invite (pending).
    to_user_id = handoff_in.to_user_id
    to_email = handoff_in.to_email
    resolved_user = None
    if to_user_id is not None:
        resolved_user = db.query(User).filter(User.id == to_user_id).first()
        if resolved_user is None:
            raise HTTPException(status_code=404, detail="User not found")

    # Idempotent per (root, grantee): return the existing grant if present.
    existing_q = db.query(Handoff).filter(Handoff.recipe_id == root.id)
    if resolved_user is not None:
        existing = existing_q.filter(Handoff.to_user_id == resolved_user.id).first()
    else:
        existing = existing_q.filter(Handoff.to_email == to_email).first()
    if existing is not None:
        return existing

    handoff = Handoff(
        recipe_id=root.id,
        from_user_id=current_user.id,
        to_user_id=(resolved_user.id if resolved_user else None),
        to_email=(None if resolved_user else to_email),
        state=("accepted" if resolved_user else "pending"),
        note=handoff_in.note,
    )
    db.add(handoff)
    db.commit()
    db.refresh(handoff)
    return handoff
```

(`HandoffIn` requires `to_email` or `to_user_id` already via its validator — unchanged.)

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_sharing.py -k handoff -v`
Expected: PASS.

- [ ] **Step 5: Run full backend suite**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q`
Expected: all pass. (Note: prior handoff tests in `tests/test_lineage_api.py` asserted `state=="pending"` for an email handoff — still true. If any asserted a non-root recipe_id or a to_user_id path, update them to the new root-normalized/instant-accept behavior; report if so.)

- [ ] **Step 6: Commit**

```bash
git add app/routers/recipes.py tests/test_sharing.py
git commit -m "feat: handoff creates a root-bound access grant (instant in-app / pending email, idempotent)"
```

---

## Task 3: Apply `can_view` to the read endpoints

**Files:**
- Modify: `app/routers/recipes.py` (`get_recipe`, `get_lineage`)
- Test: `tests/test_sharing.py` (extend)

**Interfaces:**
- Consumes: `can_view` (Task 1), grant-creating handoff (Task 2).
- Produces: `GET /recipes/{id}` and `GET /recipes/{id}/lineage` return 200 to a grantee (accepted grant on the root), including for descendants of a shared root; 404 to a non-grantee non-owner of a private recipe. Owner + public behavior unchanged.

- [ ] **Step 1: Write the failing tests**

```python
def test_grantee_can_view_shared_root_and_descendant(client, make_user):
    owner, oheaders = make_user()
    grantee, gheaders = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()  # private
    child = client.post(f"/recipes/{root['id']}/remix",
                        json={"ingredients": [{"name": "x", "quantity_text": "1",
                              "quantity_type": "precise", "position": 1}], "steps": []},
                        headers=oheaders).json()
    # before sharing: grantee 404 on both
    assert client.get(f"/recipes/{root['id']}", headers=gheaders).status_code == 404
    # share the root with the grantee
    client.post(f"/recipes/{root['id']}/handoff", json={"to_user_id": grantee.id}, headers=oheaders)
    # now grantee sees the root AND the descendant (root-binds)
    assert client.get(f"/recipes/{root['id']}", headers=gheaders).status_code == 200
    assert client.get(f"/recipes/{child['id']}", headers=gheaders).status_code == 200
    assert client.get(f"/recipes/{root['id']}/lineage", headers=gheaders).status_code == 200


def test_non_grantee_still_404(client, make_user):
    owner, oheaders = make_user()
    stranger, sheaders = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    assert client.get(f"/recipes/{root['id']}", headers=sheaders).status_code == 404
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_sharing.py -k "grantee or non_grantee" -v`
Expected: FAIL — grantee gets 404 (current gate is public-or-owner only).

- [ ] **Step 3: Swap the read-gate to `can_view`**

Import `can_view` at the top of `recipes.py`. In `get_recipe`, replace:

```python
    if recipe.user_id != current_user.id and effective_visibility(recipe, db) != "public":
        raise HTTPException(status_code=404, detail="Recipe not found")
```

with:

```python
    if not can_view(recipe, current_user, db):
        raise HTTPException(status_code=404, detail="Recipe not found")
```

In `get_lineage`, find its analogous owner-or-public 404 check and replace it the same way with `if not can_view(recipe, current_user, db): raise HTTPException(404, ...)`.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_sharing.py -v`
Expected: PASS.

- [ ] **Step 5: Full backend suite (visibility regression guard)**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q`
Expected: all pass — the visibility test matrix (public/private/branch) still holds since `can_view` subsumes it.

- [ ] **Step 6: Commit**

```bash
git add app/routers/recipes.py tests/test_sharing.py
git commit -m "feat: gate recipe + lineage reads on can_view (grant-aware)"
```

---

## Task 4: Email-invite auto-accept on signup

**Files:**
- Modify: `app/routers/auth.py` (`signup`)
- Test: `tests/test_sharing.py` (extend)

**Interfaces:**
- Consumes: `Handoff`.
- Produces: on signup, any `pending` `Handoff` with `to_email == new_user.email` gets `to_user_id = new_user.id` and `state = "accepted"` (so the shared recipe appears immediately). Signup response unchanged.

- [ ] **Step 1: Write the failing test**

```python
def test_email_invite_auto_accepts_on_signup(client, make_user, db_session):
    from app.models.handoff import Handoff
    owner, oheaders = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    client.post(f"/recipes/{root['id']}/handoff",
                json={"to_email": "newmom@example.com"}, headers=oheaders)
    # new user signs up with that email
    client.post("/auth/signup", json={"email": "newmom@example.com", "password": "password123",
                                      "first_name": "Mom", "last_name": "X"})
    h = db_session.query(Handoff).filter_by(recipe_id=root["id"], to_email="newmom@example.com").one()
    assert h.state == "accepted"
    assert h.to_user_id is not None
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_sharing.py -k signup -v`
Expected: FAIL — invite stays `pending`, `to_user_id` None.

- [ ] **Step 3: Resolve invites in `signup`**

In `app/routers/auth.py`, add the import at top:

```python
from app.models.handoff import Handoff
```

In `signup`, after `db.refresh(new_user)` and before `return new_user`:

```python
    # Auto-accept any pending recipe invites addressed to this email (sharing spec §4.2).
    pending = db.query(Handoff).filter(
        Handoff.to_email == new_user.email, Handoff.state == "pending"
    ).all()
    for h in pending:
        h.to_user_id = new_user.id
        h.state = "accepted"
    if pending:
        db.commit()
        db.refresh(new_user)
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_sharing.py -k signup -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/routers/auth.py tests/test_sharing.py
git commit -m "feat: auto-accept matching pending recipe invites on signup"
```

---

## Task 5: Accept endpoint + `GET /recipes/shared`

**Files:**
- Modify: `app/routers/recipes.py`
- Test: `tests/test_sharing.py` (extend)

**Interfaces:**
- Produces:
  - `POST /recipes/handoffs/{handoff_id}/accept` — the grant's intended recipient (matching `to_user_id`, or `to_email == current_user.email`) sets it `accepted` + links `to_user_id`. 403/404 if not their invite. (Backend-only; no MVP UI.)
  - `GET /recipes/shared` — recipes the current user has an **accepted** handoff on (the root recipes), excluding own; growth fields attached; returns `list[RecipeResponse]`.

- [ ] **Step 1: Write the failing tests**

```python
def test_shared_with_me_lists_accepted_only(client, make_user):
    owner, oheaders = make_user()
    grantee, gheaders = make_user()
    root = client.post("/recipes", json=_payload(name="Shared Dish"), headers=oheaders).json()
    other_root = client.post("/recipes", json=_payload(name="Not Shared"), headers=oheaders).json()
    client.post(f"/recipes/{root['id']}/handoff", json={"to_user_id": grantee.id}, headers=oheaders)  # accepted
    listing = client.get("/recipes/shared", headers=gheaders).json()
    names = [r["name"] for r in listing]
    assert "Shared Dish" in names
    assert "Not Shared" not in names
    # excludes the grantee's own recipes
    mine = client.post("/recipes", json=_payload(name="My Own"), headers=gheaders).json()
    assert "My Own" not in [r["name"] for r in client.get("/recipes/shared", headers=gheaders).json()]


def test_accept_endpoint_activates_pending_for_recipient(client, make_user, db_session):
    from app.models.handoff import Handoff
    owner, oheaders = make_user()
    # pending email invite, then a user with that email exists and accepts by id
    grantee, gheaders = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    # create a pending grant targeted at the grantee's email (simulate mismatched/link flow)
    h = Handoff(recipe_id=root["id"], from_user_id=owner.id,
                to_email=None, to_user_id=grantee.id, state="pending")
    db_session.add(h); db_session.commit(); db_session.refresh(h)
    r = client.post(f"/recipes/handoffs/{h.id}/accept", headers=gheaders)
    assert r.status_code == 200
    db_session.refresh(h)
    assert h.state == "accepted"
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_sharing.py -k "shared_with_me or accept_endpoint" -v`
Expected: FAIL — routes 404 (don't exist).

- [ ] **Step 3: Implement both endpoints in `recipes.py`**

Add (place near the other handoff route). `_attach_growth_fields`, `Handoff`, `Recipe`, `selectinload`, `IngredientSection` are already imported/defined:

```python
@router.get("/shared", response_model=list[RecipeResponse])
def shared_with_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    root_ids = [
        h.recipe_id for h in db.query(Handoff).filter(
            Handoff.to_user_id == current_user.id, Handoff.state == "accepted"
        ).all()
    ]
    if not root_ids:
        return []
    recipes = db.query(Recipe).filter(
        Recipe.id.in_(root_ids),
        Recipe.user_id != current_user.id,
        Recipe.deleted_at == None,
    ).options(
        selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
        selectinload(Recipe.ingredients),
        selectinload(Recipe.steps),
        selectinload(Recipe.user),
    ).all()
    for r in recipes:
        _attach_growth_fields(r, db)
    return recipes


@router.post("/handoffs/{handoff_id}/accept", response_model=HandoffResponse)
def accept_handoff(
    handoff_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    h = db.query(Handoff).filter(Handoff.id == handoff_id).first()
    if h is None:
        raise HTTPException(status_code=404, detail="Invite not found")
    # Only the intended recipient may accept (by user id or matching email).
    is_recipient = (h.to_user_id == current_user.id) or (
        h.to_email is not None and h.to_email == current_user.email
    )
    if not is_recipient:
        raise HTTPException(status_code=404, detail="Invite not found")
    h.to_user_id = current_user.id
    h.state = "accepted"
    db.commit()
    db.refresh(h)
    return h
```

**Route-order note:** `/shared` and `/handoffs/{id}/accept` must be declared so they don't collide with `/{recipe_id}`. `/recipes/shared` would otherwise match `GET /recipes/{recipe_id}` with `recipe_id="shared"`. Declare `shared_with_me` **before** `get_recipe` in the file (FastAPI matches in declaration order), or the literal path won't be reached. Verify by running the `/shared` test.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_sharing.py -v`
Expected: PASS (all sharing tests).

- [ ] **Step 5: Full backend suite**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/routers/recipes.py tests/test_sharing.py
git commit -m "feat: GET /recipes/shared + accept-handoff endpoint"
```

---

## Task 6: Alembic index migration

**Files:**
- Create: `alembic/versions/<gen>_index_handoffs_grant_lookup.py`

**Interfaces:** additive index on `handoffs (recipe_id, to_user_id, state)` for the read-path grant lookup. No column change.

- [ ] **Step 1: Autogenerate is unreliable for index-only — hand-write the migration**

Create the file (chain `down_revision` from the current head; find it with `DATABASE_URL="sqlite:///./_scratch.db" JWT_SECRET=x alembic heads`):

```python
"""index handoffs for grant lookup

Revision ID: <gen>
Revises: <current_head>
"""
from alembic import op

revision = "<gen>"
down_revision = "<current_head>"
branch_labels = None
depends_on = None

def upgrade():
    op.create_index("ix_handoffs_grant_lookup", "handoffs",
                    ["recipe_id", "to_user_id", "state"])

def downgrade():
    op.drop_index("ix_handoffs_grant_lookup", table_name="handoffs")
```

- [ ] **Step 2: Verify upgrade/downgrade on a scratch SQLite DB**

```bash
rm -f ./_scratch.db
DATABASE_URL="sqlite:///./_scratch.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m alembic upgrade head
DATABASE_URL="sqlite:///./_scratch.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m alembic downgrade -1
rm -f ./_scratch.db
```

Expected: both exit 0. (If `alembic upgrade head` from scratch hits the known pre-existing SQLite `drop_constraint` failure in migrations `0894735d3ccd`/`bba3856b2139` — see TECHDEBT (f) — instead verify the new migration in isolation by stamping to its `down_revision` first, or note it and rely on the model-created schema for tests. Do NOT "fix" those pre-existing migrations here.)

- [ ] **Step 3: Commit**

```bash
git add alembic/versions/
git commit -m "feat: index handoffs for grant-lookup read path"
```

---

## Task 7: Frontend — `getSharedWithMe` API + visibility-adaptive pass copy

**Files:**
- Modify: `frontend/src/api/lineage.js`, `frontend/src/components/HandoffInvite.jsx`
- Test: `frontend/src/components/HandoffInvite.test.jsx` (extend)

**Interfaces:**
- Consumes: `GET /recipes/shared` (Task 5).
- Produces: `getSharedWithMe()` → `client.get('/recipes/shared')`. `HandoffInvite` gains a `recipeVisibility` prop (`'private'|'public'`); its heading/subcopy adapt — private: "…will be able to see, cook, and remix this"; public: a nudge ("Let them know about this"). Default keeps current copy if prop omitted (backward compatible).

- [ ] **Step 1: Write the failing test (extend HandoffInvite.test.jsx)**

```jsx
it('shows access-granting copy for a private recipe', () => {
  render(<HandoffInvite recipeId={1} recipeVisibility="private" onSent={() => {}} onSkip={() => {}} />)
  expect(screen.getByText(/see, cook, and remix/i)).toBeInTheDocument()
})
it('shows nudge copy for a public recipe', () => {
  render(<HandoffInvite recipeId={1} recipeVisibility="public" onSent={() => {}} onSkip={() => {}} />)
  expect(screen.getByText(/let them know|already public/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/HandoffInvite.test.jsx`
Expected: FAIL — copy not conditional yet.

- [ ] **Step 3: Add the API call + adapt the copy**

In `frontend/src/api/lineage.js` append:

```js
export const getSharedWithMe = () => client.get('/recipes/shared')
```

In `frontend/src/components/HandoffInvite.jsx`, accept `recipeVisibility` and branch the sub-copy. Near the existing heading/subtitle, replace the static subtitle with:

```jsx
      <p className="font-serif italic text-[14px] text-ink-soft mt-2 mb-5">
        {recipeVisibility === 'public'
          ? 'Let them know about this — it’s already public.'
          : 'They’ll be able to see, cook, and remix this.'}
      </p>
```

Add `recipeVisibility` to the component's props signature (default `'private'`).

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/components/HandoffInvite.test.jsx`
Expected: PASS (new + existing HandoffInvite tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/lineage.js frontend/src/components/HandoffInvite.jsx frontend/src/components/HandoffInvite.test.jsx
git commit -m "feat: shared-with-me API + visibility-adaptive handoff copy"
```

---

## Task 8: Frontend — "Shared with me" view + pass `recipeVisibility` from RecipeDetail

**Files:**
- Create: `frontend/src/pages/SharedWithMe.jsx`, `frontend/src/pages/SharedWithMe.test.jsx`
- Modify: `frontend/src/App.jsx` (route), `frontend/src/pages/RecipeDetail.jsx` (pass `recipeVisibility` into HandoffInvite)

**Interfaces:**
- Consumes: `getSharedWithMe` (Task 7), `RecipeCard`.
- Produces: route `/shared` rendering a list of shared-with-me recipe cards (empty state: "Nothing's been shared with you yet."); RecipeDetail passes `recipeVisibility={recipe.visibility}` to its `HandoffInvite`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/SharedWithMe.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api/lineage', () => ({ getSharedWithMe: vi.fn(() => Promise.resolve({ data: [
  { id: 9, name: 'Shared Adobo', author_full_name: 'Yoko M.', cook_count: 0, child_count: 0 },
] })) }))
vi.mock('../components/RecipeCard', () => ({ default: ({ recipe }) => <div>{recipe.name}</div> }))
import SharedWithMe from './SharedWithMe'

describe('SharedWithMe', () => {
  it('lists recipes shared with me', async () => {
    render(<MemoryRouter><SharedWithMe /></MemoryRouter>)
    expect(await screen.findByText('Shared Adobo')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/pages/SharedWithMe.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SharedWithMe.jsx`**

```jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSharedWithMe } from '../api/lineage'
import RecipeCard from '../components/RecipeCard'

export default function SharedWithMe() {
  const [recipes, setRecipes] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    getSharedWithMe().then((res) => setRecipes(res.data)).catch(() => setRecipes([]))
  }, [])

  if (recipes === null) return <div className="p-6 text-center text-ink-soft">Loading…</div>

  return (
    <div className="px-4 pt-6">
      <h1 className="font-serif font-black text-[28px] text-ink">Shared with you</h1>
      <p className="font-serif italic text-sm text-ink-soft mt-0.5 mb-4">Recipes others have passed to you.</p>
      {recipes.length === 0 ? (
        <p className="text-center text-ink-soft text-sm mt-8">Nothing's been shared with you yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {recipes.map((r) => (
            <RecipeCard key={r.id} recipe={r} variant="grid" onClick={() => navigate(`/recipes/${r.id}`)} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire route + RecipeDetail prop**

In `App.jsx`: import `SharedWithMe`; add a protected route inside `Layout`:

```jsx
      <Route path="/shared" element={<ProtectedRoute><Layout><SharedWithMe /></Layout></ProtectedRoute>} />
```

In `RecipeDetail.jsx`, where `<HandoffInvite recipeId={recipe.id} .../>` is rendered, add the prop:

```jsx
              recipeVisibility={recipe.visibility}
```

- [ ] **Step 5: Run to verify pass + full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/SharedWithMe.jsx frontend/src/pages/SharedWithMe.test.jsx frontend/src/App.jsx frontend/src/pages/RecipeDetail.jsx
git commit -m "feat: Shared-with-me view + pass recipe visibility into HandoffInvite"
```

---

## Task 9: "Shared with N" indicator + backend count

**Files:**
- Modify: `app/routers/recipes.py` (`_attach_growth_fields` or a small addition), `app/schemas/recipe.py` (`RecipeResponse`), `frontend/src/components/VisibilityControl.jsx`
- Test: `tests/test_sharing.py` (extend), `frontend/src/components/VisibilityControl.test.jsx` (extend)

**Interfaces:**
- Produces: `RecipeResponse` gains `shared_with_count: int = 0` (count of accepted grants on the recipe, owner-facing). `VisibilityControl` shows "· Shared with N" next to the 🔒 Private pill when `recipe.shared_with_count > 0` and the recipe is private + root.

- [ ] **Step 1: Backend test**

```python
def test_recipe_response_has_shared_with_count(client, make_user):
    owner, oheaders = make_user()
    grantee, _ = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    client.post(f"/recipes/{root['id']}/handoff", json={"to_user_id": grantee.id}, headers=oheaders)
    body = client.get(f"/recipes/{root['id']}", headers=oheaders).json()
    assert body["shared_with_count"] == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_sharing.py -k shared_with_count -v`
Expected: FAIL — field missing.

- [ ] **Step 3: Add the field + populate it**

In `app/schemas/recipe.py` `RecipeResponse`, add: `shared_with_count: int = 0`.

In `app/routers/recipes.py` `_attach_growth_fields`, add (it already imports `Handoff`):

```python
    recipe.shared_with_count = db.query(Handoff).filter(
        Handoff.recipe_id == recipe.id, Handoff.state == "accepted"
    ).count()
```

- [ ] **Step 4: Frontend test (extend VisibilityControl.test.jsx)**

```jsx
it('shows "Shared with N" when a private root has accepted grants', () => {
  render(<VisibilityControl recipe={{ id: 1, parent_recipe_id: null, visibility: 'private', child_count: 0, shared_with_count: 2 }} onChange={() => {}} />)
  expect(screen.getByText(/shared with 2/i)).toBeInTheDocument()
})
```

- [ ] **Step 5: Add the indicator to `VisibilityControl.jsx`**

In the root branch, next to the pill, when `recipe.visibility === 'private' && (recipe.shared_with_count || 0) > 0`, render:

```jsx
        <span className="font-sans text-[11px] text-ink-soft">· Shared with {recipe.shared_with_count}</span>
```

- [ ] **Step 6: Run both suites**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q` and `cd frontend && npx vitest run`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add app/schemas/recipe.py app/routers/recipes.py frontend/src/components/VisibilityControl.jsx tests/test_sharing.py frontend/src/components/VisibilityControl.test.jsx
git commit -m "feat: shared_with_count on RecipeResponse + 'Shared with N' indicator"
```

---

## Task 10: Visual verification + docs

**Files:** reuse a Playwright driver; `TECHDEBT.md`, `README.md`, `ARCHITECTURE.md`.

- [ ] **Step 1: Production build**

Run: `cd frontend && npx vite build`
Expected: succeeds.

- [ ] **Step 2: Visual-verify the share loop**

Isolated demo stack (throwaway SQLite on :8010, Vite :5183). Seed: user A owns a private recipe (with a child); user B exists. As A: open the recipe → "Pass it on" → send to B (see access-granting copy + "Shared with 1" appears). As B: `/shared` shows the recipe → open it → can view/cook/remix; open the child → visible (root-binds). As a third user C: the recipe 404s / not in `/shared`. Screenshot each; confirm.

- [ ] **Step 3: Docs**

`ARCHITECTURE.md`: note the sharing model (handoff = grant, `can_view`, `/recipes/shared`, `/shared` route, SharedWithMe page). `README.md`: add `GET /recipes/shared` + `POST /recipes/handoffs/{id}/accept` to the endpoint table; note the three visibility tiers. `TECHDEBT.md`: add the deferred items (manage/revoke grants UI; orphaned-different-email invite reclaim via invite-link; family-group shortcut).

- [ ] **Step 4: Commit**

```bash
git add ARCHITECTURE.md README.md TECHDEBT.md frontend/tests/visual/
git commit -m "docs: document recipe-sharing; visual-verify share loop"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** handoff-as-grant + root-normalize + instant/pending (T2); can_view read-gate on recipe+lineage (T1,T3); email auto-accept on signup (T4); accept endpoint + /shared (T5); index (T6); adaptive pass copy + shared API (T7); shared-with-me view (T8); "Shared with N" (T9); visual+docs (T10). Cut/deferred per spec: manage/revoke UI, family-group, re-share, Accept UI (endpoint only) — all absent by design.
- **Route ordering (critical):** `GET /recipes/shared` must be declared BEFORE `GET /recipes/{recipe_id}` or it's shadowed. Task 5 Step 3 calls this out; the `/shared` test catches it.
- **Existing handoff tests:** `tests/test_lineage_api.py` has handoff tests asserting `state=="pending"` and a `to_email` path — still valid. If any assert the old non-root recipe_id or a to_user_id→pending path, Task 2 Step 5 says to update + report them (the instant-accept + root-normalize behavior changed).
- **`can_view` subsumes visibility:** Task 3 replaces the public-or-owner check; the visibility test matrix must stay green (public root visible to non-owner, private hidden, branch inherits) — `can_view` returns the same answers for the no-grant case.
- **`shared_with_count` is owner-facing metadata** computed per-request (like the growth fields); it does not leak grantee identities (just a count), and browse already zeroes owner-scoped fields — confirm the count isn't exposed on the public browse feed (it's fine as a count, but keep it out of browse if we're strict; note for review).
