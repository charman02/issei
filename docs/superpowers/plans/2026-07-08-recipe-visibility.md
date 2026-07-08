# Recipe Visibility (Private ↔ Public) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a recipe's owner make it public (discoverable/keepable/remixable) or private (default), unblocking the Browse feed — by accepting `visibility` on create/patch with root-binds enforcement, and a publish control on RecipeDetail.

**Architecture:** No schema change — `recipes.visibility` (String, default `"private"`) and `effective_visibility()` read-gating already exist. Add `visibility` to the create/update schemas + handlers with an explicit root-binds guard (only a lineage root's visibility is authoritative; branches inherit and reject direct edits), then a placement-C UI: an owner-only status pill + publish/un-publish toggle on RecipeDetail (root), and read-only inherited status on branches.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Pydantic 2 + pytest (backend); React 18 + Vite + Tailwind + Vitest/RTL (frontend). All harnesses already exist.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-08-recipe-visibility-design.md`. Parent policy §4 of `2026-07-06-lineage-tree-signature-feature-design.md`.
- **Values:** `visibility` ∈ `"private" | "public"`; default `"private"`.
- **Root-binds (the core rule):** a recipe's effective visibility is its lineage **root's** `visibility`. Only a root (`parent_recipe_id is None`) may have its `visibility` set; setting it on a branch is rejected `400`.
- **Publishing is reversible** (public↔private toggle), but a **descendants-aware confirm** appears when a root with children is published. Un-publish removes it from Browse but cannot retract branches already made while public.
- **Owner-only:** visibility changes go through the already-owner-scoped `patch_recipe`. Non-owners see no controls.
- **CUT from this build:** anonymity (no `is_anonymous`), tier-2 family/specific-people sharing, deletion/tombstone. Do not add them.
- **Run:** backend `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q`; frontend `cd frontend && npx vitest run`.
- **Don't git commit without explicit user approval** (project rule). Per-task Commit steps stage + write the message; a human approves before finalizing.

---

## File Structure

**Backend (modify):**
- `app/schemas/recipe.py` — add `visibility` to `RecipeCreate` (default `"private"`) and `RecipeUpdate` (`Optional`, default `None`), constrained to the two values. (`RecipeResponse.visibility` already exists.)
- `app/routers/recipes.py` — `create_recipe`: set `visibility` on the constructed root. `patch_recipe`: explicit root-binds `400` guard before the scalar `setattr` loop.
- `tests/test_visibility.py` (create) — the root-binds test matrix.

**Frontend (modify):**
- `frontend/src/api/lineage.js` — add `setVisibility(id, visibility)`.
- `frontend/src/components/VisibilityControl.jsx` (create) — the owner pill + toggle + descendants-aware confirm; read-only inherited status for branches.
- `frontend/src/pages/RecipeDetail.jsx` — render `<VisibilityControl>` in the owner block.
- co-located `*.test.jsx` for the new component.

---

## Task 1: Accept `visibility` on RecipeCreate (root publish-at-create)

**Files:**
- Modify: `app/schemas/recipe.py` (`RecipeCreate`), `app/routers/recipes.py` (`create_recipe`)
- Test: `tests/test_visibility.py` (create)

**Interfaces:**
- Produces: `POST /recipes` accepts an optional `visibility` (`"private"|"public"`, default `"private"`); the created (root) recipe persists it. `RecipeResponse.visibility` reflects it (field already exists).

- [ ] **Step 1: Write the failing test**

Create `tests/test_visibility.py`:

```python
def _payload(name="Adobo", **extra):
    return {
        "name": name,
        "ingredients": [{"name": "chicken", "quantity_text": "2 lbs",
                         "quantity_type": "precise", "position": 1}],
        "steps": [{"content": "Cook", "position": 1}],
        **extra,
    }


def test_create_defaults_private(client, make_user):
    _, headers = make_user()
    r = client.post("/recipes", json=_payload(), headers=headers)
    assert r.status_code == 201
    assert r.json()["visibility"] == "private"


def test_create_public_when_requested(client, make_user):
    _, headers = make_user()
    r = client.post("/recipes", json=_payload(visibility="public"), headers=headers)
    assert r.status_code == 201
    assert r.json()["visibility"] == "public"


def test_create_rejects_bad_visibility(client, make_user):
    _, headers = make_user()
    r = client.post("/recipes", json=_payload(visibility="secret"), headers=headers)
    assert r.status_code == 422
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_visibility.py -v`
Expected: FAIL — `test_create_public_when_requested` gets `"private"` (field ignored); `test_create_rejects_bad_visibility` gets 201 not 422.

- [ ] **Step 3: Add the field to `RecipeCreate`**

In `app/schemas/recipe.py`, at the top ensure `Literal` is importable (`from typing import Optional, Literal` — add `Literal` to the existing typing import). In `RecipeCreate` (after `language`), add:

```python
    visibility: Literal["private", "public"] = "private"
```

- [ ] **Step 4: Persist it in `create_recipe`**

In `app/routers/recipes.py`, in the `new_recipe = Recipe(...)` constructor block, add the field (after `language=recipe_in.language,`):

```python
        visibility=recipe_in.visibility,
```

- [ ] **Step 5: Run to verify pass**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_visibility.py -v`
Expected: the 3 create tests PASS.

- [ ] **Step 6: Commit**

```bash
git add app/schemas/recipe.py app/routers/recipes.py tests/test_visibility.py
git commit -m "feat: accept visibility on recipe create (root publish-at-create)"
```

---

## Task 2: Accept `visibility` on patch, with root-binds guard

**Files:**
- Modify: `app/schemas/recipe.py` (`RecipeUpdate`), `app/routers/recipes.py` (`patch_recipe`)
- Test: `tests/test_visibility.py` (extend)

**Interfaces:**
- Consumes: `RecipeCreate.visibility` behavior (Task 1).
- Produces: `PATCH /recipes/{id}` accepts `visibility`. On a **root** recipe (`parent_recipe_id is None`) it updates; on a **branch** it returns `400` ("Visibility is controlled by this recipe's original; it can't be set on a branch."). Owner-only (existing query scope).

- [ ] **Step 1: Write the failing tests (extend `tests/test_visibility.py`)**

```python
def _make_root(client, headers, visibility="private"):
    from tests.test_visibility import _payload  # same module
    return client.post("/recipes", json=_payload(visibility=visibility), headers=headers).json()


def test_patch_root_toggles_visibility(client, make_user):
    _, headers = make_user()
    root = client.post("/recipes", json=_payload(), headers=headers).json()
    r = client.patch(f"/recipes/{root['id']}", json={"visibility": "public"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["visibility"] == "public"
    # reversible
    r2 = client.patch(f"/recipes/{root['id']}", json={"visibility": "private"}, headers=headers)
    assert r2.json()["visibility"] == "private"


def test_patch_visibility_on_branch_is_rejected(client, make_user):
    _, owner = make_user()
    root = client.post("/recipes", json=_payload(), headers=owner).json()
    child = client.post(f"/recipes/{root['id']}/remix",
                        json={"ingredients": [{"name": "lard", "quantity_text": "1 tbsp",
                              "quantity_type": "precise", "position": 1}], "steps": []},
                        headers=owner).json()
    r = client.patch(f"/recipes/{child['id']}", json={"visibility": "public"}, headers=owner)
    assert r.status_code == 400


def test_patch_bad_visibility_rejected(client, make_user):
    _, headers = make_user()
    root = client.post("/recipes", json=_payload(), headers=headers).json()
    r = client.patch(f"/recipes/{root['id']}", json={"visibility": "everyone"}, headers=headers)
    assert r.status_code == 422
```

(Note: `_payload` is module-level in `tests/test_visibility.py` from Task 1; the local `from tests.test_visibility import _payload` in `_make_root` is unnecessary if the tests live in the same file — call `_payload()` directly. Keep `_make_root` only if used; the tests above call `_payload` directly, so `_make_root` can be omitted.)

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_visibility.py -v`
Expected: FAIL — branch patch returns 200 (not 400); bad value returns 200/500 (not 422).

- [ ] **Step 3: Add the field to `RecipeUpdate`**

In `app/schemas/recipe.py`, in `RecipeUpdate` (after `language`), add:

```python
    visibility: Optional[Literal["private", "public"]] = None
```

- [ ] **Step 4: Add the root-binds guard in `patch_recipe`**

In `app/routers/recipes.py`, in `patch_recipe`, **after** `sent_fields = recipe_in.model_dump(exclude_unset=True)` and the recipe is fetched, **before** the scalar `setattr` loop, add:

```python
    # Root-binds: only a lineage root's visibility is authoritative; a branch
    # inherits its root's visibility, so reject direct edits on a branch.
    if "visibility" in sent_fields and recipe.parent_recipe_id is not None:
        raise HTTPException(
            status_code=400,
            detail="Visibility is controlled by this recipe's original; it can't be set on a branch.",
        )
```

(`visibility` is a scalar, so the existing `setattr` loop applies it on roots automatically — no further change needed there.)

- [ ] **Step 5: Run to verify pass**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_visibility.py -v`
Expected: all visibility tests PASS.

- [ ] **Step 6: Commit**

```bash
git add app/schemas/recipe.py app/routers/recipes.py tests/test_visibility.py
git commit -m "feat: accept visibility on patch with root-binds guard"
```

---

## Task 3: Root-binds read behavior regression test

Guards the interaction between write (Tasks 1–2) and the existing read-gating, so a future change can't silently expose a private root's branch or hide a public one.

**Files:**
- Test: `tests/test_visibility.py` (extend). No production code change expected.

**Interfaces:**
- Consumes: create/patch visibility (Tasks 1–2), existing `browse`/`get_recipe` gating.

- [ ] **Step 1: Write the tests**

```python
def test_public_root_visible_to_non_owner_and_in_browse(client, make_user, db_session):
    _, owner = make_user()
    root = client.post("/recipes", json=_payload(visibility="public"), headers=owner).json()
    _, other = make_user()
    # non-owner can view a public recipe
    assert client.get(f"/recipes/{root['id']}", headers=other).status_code == 200
    # appears in the (unauthenticated) browse feed
    assert any(r["id"] == root["id"] for r in client.get("/recipes/browse").json())


def test_private_root_hidden_from_non_owner_and_browse(client, make_user):
    _, owner = make_user()
    root = client.post("/recipes", json=_payload(), headers=owner).json()  # private
    _, other = make_user()
    assert client.get(f"/recipes/{root['id']}", headers=other).status_code == 404
    assert all(r["id"] != root["id"] for r in client.get("/recipes/browse").json())


def test_branch_of_private_root_stays_hidden(client, make_user):
    _, owner = make_user()
    root = client.post("/recipes", json=_payload(), headers=owner).json()  # private
    child = client.post(f"/recipes/{root['id']}/remix",
                        json={"ingredients": [{"name": "x", "quantity_text": "1",
                              "quantity_type": "precise", "position": 1}], "steps": []},
                        headers=owner).json()
    _, other = make_user()
    # child inherits private root → not publicly visible even though child row default is private
    assert client.get(f"/recipes/{child['id']}", headers=other).status_code == 404
```

- [ ] **Step 2: Run to verify behavior**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_visibility.py -v`
Expected: PASS. If any fail, the read-gating regressed — fix `effective_visibility`/gating, don't weaken the test.

- [ ] **Step 3: Run the full backend suite (no regressions)**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q`
Expected: all pass (prior 29 + new visibility tests).

- [ ] **Step 4: Commit**

```bash
git add tests/test_visibility.py
git commit -m "test: root-binds read-gating regression guards for visibility"
```

---

## Task 4: `setVisibility` API + `VisibilityControl` component

**Files:**
- Modify: `frontend/src/api/lineage.js`
- Create: `frontend/src/components/VisibilityControl.jsx`, `frontend/src/components/VisibilityControl.test.jsx`

**Interfaces:**
- Consumes: `PATCH /recipes/{id}` with `{ visibility }` (Task 2).
- Produces:
  - `setVisibility(id, visibility)` in `api/lineage.js` → `client.patch('/recipes/${id}', { visibility })`.
  - `<VisibilityControl recipe={recipe} onChange={(updatedVisibility) => ...} />`:
    - **Root** (`recipe.parent_recipe_id == null`): a status pill (🔒 Private / 🌐 Public) + a button to toggle. On toggle to **public** when `recipe.child_count > 0`, first show a confirm noting *"This also makes the N versions built on it public."*; otherwise flip directly. On success calls `onChange(newVisibility)`.
    - **Branch** (`parent_recipe_id != null`): read-only text — "🌐 Public — inherited from the original" or "🔒 Private — inherited from the original" (based on `recipe.visibility` as returned; effective visibility is the root's, but the row's own field is shown as the inherited indicator). No toggle.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/VisibilityControl.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../api/lineage', () => ({ setVisibility: vi.fn(() => Promise.resolve({ data: { visibility: 'public' } })) }))
import { setVisibility } from '../api/lineage'
import VisibilityControl from './VisibilityControl'

beforeEach(() => setVisibility.mockClear())

describe('VisibilityControl', () => {
  it('root private → publishes on toggle (no descendants, no confirm)', async () => {
    const onChange = vi.fn()
    render(<VisibilityControl recipe={{ id: 5, parent_recipe_id: null, visibility: 'private', child_count: 0 }} onChange={onChange} />)
    expect(screen.getByText(/private/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /make public/i }))
    expect(setVisibility).toHaveBeenCalledWith(5, 'public')
    expect(onChange).toHaveBeenCalledWith('public')
  })

  it('root with descendants shows a confirm before publishing', async () => {
    render(<VisibilityControl recipe={{ id: 6, parent_recipe_id: null, visibility: 'private', child_count: 3 }} onChange={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /make public/i }))
    // confirm surfaces the ripple; not yet sent
    expect(screen.getByText(/3 versions/i)).toBeInTheDocument()
    expect(setVisibility).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /^publish$/i }))
    expect(setVisibility).toHaveBeenCalledWith(6, 'public')
  })

  it('branch shows inherited status, no toggle', () => {
    render(<VisibilityControl recipe={{ id: 7, parent_recipe_id: 5, visibility: 'public' }} onChange={() => {}} />)
    expect(screen.getByText(/inherited from the original/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/VisibilityControl.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Add `setVisibility` to `api/lineage.js`**

Append to `frontend/src/api/lineage.js`:

```js
export const setVisibility = (id, visibility) => client.patch(`/recipes/${id}`, { visibility })
```

- [ ] **Step 4: Implement `VisibilityControl.jsx`**

Create `frontend/src/components/VisibilityControl.jsx`:

```jsx
import { useState } from 'react'
import { setVisibility } from '../api/lineage'

// Placement-C visibility control (spec §3). Owner-only surface on RecipeDetail.
// Root: status pill + publish/un-publish toggle (descendants-aware confirm).
// Branch: read-only inherited status.
export default function VisibilityControl({ recipe, onChange }) {
  const isRoot = recipe.parent_recipe_id == null
  const [visibility, setVis] = useState(recipe.visibility || 'private')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const isPublic = visibility === 'public'
  const label = isPublic ? '🌐 Public' : '🔒 Private'

  if (!isRoot) {
    return (
      <p className="font-sans text-[11px] text-ink-soft">
        {label} — inherited from the original
      </p>
    )
  }

  async function apply(next) {
    setBusy(true)
    try {
      const { data } = await setVisibility(recipe.id, next)
      setVis(data.visibility)
      setConfirming(false)
      onChange?.(data.visibility)
    } finally {
      setBusy(false)
    }
  }

  function onToggle() {
    if (!isPublic && (recipe.child_count || 0) > 0) {
      setConfirming(true) // publishing a root with descendants → confirm the ripple
      return
    }
    apply(isPublic ? 'private' : 'public')
  }

  return (
    <div className="flex items-center gap-3">
      <span className="font-sans text-[12px] font-semibold text-ink-soft">{label}</span>
      <button
        onClick={onToggle} disabled={busy}
        className="font-sans text-[11.5px] font-semibold text-terra disabled:opacity-50"
      >
        {isPublic ? 'Make private' : 'Make public'}
      </button>

      {confirming && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 px-6">
          <div className="bg-card rounded-2xl p-5 max-w-xs w-full shadow-warm-lg">
            <p className="font-serif text-ink text-[15px] mb-1">Make this public?</p>
            <p className="font-sans text-[12.5px] text-ink-soft mb-4">
              This also makes the {recipe.child_count} versions built on it public.
              Anyone will be able to find and keep it.
            </p>
            <div className="flex gap-2">
              <button onClick={() => apply('public')} disabled={busy} className="btn-primary !w-auto px-5">Publish</button>
              <button onClick={() => setConfirming(false)} className="px-5 py-3 font-serif text-ink-soft text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

(`.btn-primary`, `.shadow-warm-lg`, `bg-card` are existing tokens/classes.)

- [ ] **Step 5: Run to verify pass**

Run: `cd frontend && npx vitest run src/components/VisibilityControl.test.jsx`
Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/lineage.js frontend/src/components/VisibilityControl.jsx frontend/src/components/VisibilityControl.test.jsx
git commit -m "feat: VisibilityControl component + setVisibility API"
```

---

## Task 5: Wire `VisibilityControl` into RecipeDetail (owner block)

**Files:**
- Modify: `frontend/src/pages/RecipeDetail.jsx`
- Test: `frontend/src/pages/RecipeDetail.test.jsx` (extend)

**Interfaces:**
- Consumes: `VisibilityControl` (Task 4), the existing `isOwner` + `recipe` state.
- Produces: RecipeDetail renders `<VisibilityControl>` for the owner (both root and branch cases), reflecting `recipe.visibility`. Non-owners see nothing new.

- [ ] **Step 1: Write the failing test (extend `RecipeDetail.test.jsx`)**

Add a case (the existing test file already mocks `../api/client` and sets `issei_user`; mirror its render harness with a public root recipe owned by the current user):

```jsx
it('shows the visibility control to the owner', async () => {
  // owner is user 7 (localStorage set in the existing beforeEach); recipe.user_id 7, root
  // The existing client mock returns the recipe; ensure it includes visibility + parent_recipe_id null.
  // (If the shared mock lacks these fields, this test overrides via the mock as the file already does.)
  render(<MemoryRouter>{/* existing RecipeDetail render harness */}</MemoryRouter>)
  expect(await screen.findByText(/private|public/i)).toBeInTheDocument()
})
```

Implementer note: the existing `RecipeDetail.test.jsx` mock (from SP2 Task 11) returns a recipe with `user_id: 7`. Extend that mock's returned object to include `visibility: 'private'` and `parent_recipe_id: null`, then assert the pill renders. Keep the existing cook-flow test intact.

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/pages/RecipeDetail.test.jsx`
Expected: FAIL — no visibility text yet.

- [ ] **Step 3: Render `VisibilityControl` in the owner block**

In `frontend/src/pages/RecipeDetail.jsx`: import it —

```jsx
import VisibilityControl from '../components/VisibilityControl'
```

Then, inside the owner-only region near the byline/actions (where `isOwner` is already used, around the title/byline block), render it for the owner:

```jsx
        {isOwner && (
          <div className="mt-2">
            <VisibilityControl
              recipe={recipe}
              onChange={(v) => setRecipe({ ...recipe, visibility: v })}
            />
          </div>
        )}
```

(`setRecipe` is the existing state setter for `recipe` in this component.)

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/pages/RecipeDetail.test.jsx`
Expected: PASS (new + existing cook-flow test).

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/RecipeDetail.jsx frontend/src/pages/RecipeDetail.test.jsx
git commit -m "feat: show VisibilityControl on RecipeDetail for the owner"
```

---

## Task 6: Visual verification + docs touch-up

**Files:**
- Reuse: `frontend/tests/visual/capture-flows.mjs` (or a small addition) for the publish screenshot.
- Modify: `README.md` (browse row can drop the "always empty in practice" caveat if present), `TECHDEBT.md` (remove/close the "no way to make a recipe public" item added after SP2 final review).

- [ ] **Step 1: Production build**

Run: `cd frontend && npx vite build`
Expected: succeeds (catches any missing import from Tasks 4–5).

- [ ] **Step 2: Visual-verify the publish flow**

Reuse the isolated demo stack pattern (throwaway SQLite seeded backend on :8010, Vite on :5183 via `VITE_API_URL`). Log in as the seed owner, open one of their recipes, and screenshot: (a) the private pill + "Make public"; (b) after publishing, the public pill; (c) that the recipe now appears in Browse. Look at the screenshots — confirm the pill, the (descendants) confirm copy, and Browse membership.

- [ ] **Step 3: Close the TECHDEBT item + README caveat**

In `TECHDEBT.md`, remove/close the item noting recipes could never be made public (added after the SP2 final review). In `README.md`, if the browse row notes "shows nothing in practice," drop that caveat. Keep edits minimal and factual.

- [ ] **Step 4: Commit**

```bash
git add TECHDEBT.md README.md frontend/tests/visual/capture-flows.mjs
git commit -m "docs: close 'no public recipes' debt; visual-verify publish flow"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** create-visibility (T1), patch + root-binds 400 (T2), read-gating regression incl. private-root-branch (T3), value validation via `Literal` (T1/T2 → 422), placement-C pill + toggle + descendants confirm + inherited read-only (T4/T5), visual-verify + Browse membership (T6). Cut items (anonymity, family sharing, deletion) are absent by design.
- **Reversibility:** T2 tests public→private→public; the UI toggle (T4) flips both ways. Matches spec §1.
- **Root-binds is enforced twice by design:** on write (T2's 400) and on read (existing `effective_visibility`, guarded by T3). Both matter — the 400 gives a clear error; the read-gate is the safety net.
- **Ordering:** T1→T2→T3 (backend, in order); T4→T5 (frontend, in order); T6 last. T4/T5 depend on T1/T2 being deployed to the demo backend for the T6 visual check.
- **`RecipeResponse.visibility` already exists** (schemas/recipe.py:134) — no response-schema change needed; the frontend reads it directly.
