# Handoff Refinement Implementation Plan (Sub-Project 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the handoff ("Pass it on") experience per living-recipe spec §4 — note-starters that carry intent, one safe auto-touch for the recorded source, remix-free copy, and a tokenized **soft-wall recipient landing** (a warm public preview of a handed-off recipe, then a signup gate to participate).

**Architecture:** Two halves. **(A) Frontend note-starters + copy** (§4.2, no backend): one-tap starters that pre-fill the handoff note, the "add your part" starter auto-selected when passing back to the recipe's recorded source, and the stale "remix" wording removed. **(B) The soft-wall** (§4.3): a random `token` on each `Handoff` (a capability link), a new **unauthenticated** endpoint that returns a *deliberately limited* preview (name, who-it's-from, story, growth plant — never ingredients/steps), and an authenticated **claim** endpoint that accepts an invite by token (also resolving the mismatched-email orphan case in TECHDEBT (l)). The frontend adds a public `/invite/:token` landing that previews then routes to signup-to-participate, carrying the token through signup so the new account claims the grant.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 (Mapped/mapped_column), Alembic, Pydantic v2, pytest (backend); React 18, Vite 5, Tailwind 3, React Router 6, Vitest + RTL (frontend).

## Global Constraints

- **Preview scope is LOCKED (spec §4.3):** the unauthenticated preview exposes ONLY `recipe name, who it's from (author + origin), the story, and the growth plant (stage/vitality)`. It MUST NOT expose ingredients, steps, notes, cook history, or any other body content. This is a security boundary, not a copy choice.
- **The soft-wall is preview-then-participate:** viewing the preview requires no account; cooking / keeping / adding-your-part requires signup. The signup gate is the intended growth loop, not friction (spec §4.3).
- **Remix is cut from v1** (spec §0.1): handoff copy invites the recipient to **cook it and keep it** (and, for the source, *add their part*). It MUST NOT say "remix" or "make your own version" anywhere.
- **App never guesses intent from recipient identity** (spec §4.2): intent is carried by the sender's note. The ONE safe auto-touch is pre-selecting the "add your part" starter when passing back to the recorded source; everywhere else the starters are neutral/unselected.
- **Token is a capability secret:** generated with `secrets.token_urlsafe(32)`, unique, never logged, and the ONLY thing needed to view a preview. The preview must reveal nothing an attacker with a random guess couldn't already get from a public recipe.
- **Root-binds sharing is preserved:** grants normalize to the lineage root (existing behavior in `handoff_recipe`); the token lives on the handoff row (which already points at the root). Do not change the root-normalization or the grant-forgery guard (owner-of-root check).
- **The logged-out invite landing must call ONLY the public preview endpoint.** `api/client.js` hard-redirects to `/login` on any non-login 401. If the `/invite/:token` page (viewed without an account) called any authenticated endpoint and got a 401, the visitor would be bounced to `/login` and lose the invite context. `InviteLanding` therefore calls `getInvitePreview` only; the token is claimed AFTER auth, inside Login. Any request made from the landing must not require auth.
- **Production is Neon Postgres; migrations are NOT auto-applied and this branch does NOT merge to main in this sub-project.** The migration must be reversible and SQLite-safe (tests + local run on SQLite; prod is Postgres). Nullable column + backfill of existing rows in the migration.
- **Backend tests:** pytest, in-memory SQLite via the `client` / `make_user` / `db_session` fixtures in `tests/fixtures.py`. **Frontend tests:** Vitest + RTL, colocated. Run backend from repo root: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q`. Run frontend from `frontend/` with `export PATH="$PATH:/c/Program Files/nodejs"`.
- **Typographic punctuation** in user-facing copy (curly quotes/apostrophes, em-dash), matching surrounding files.

---

## Reference: existing plumbing (do not re-derive)

- `app/models/handoff.py` — `Handoff(id, recipe_id→root, from_user_id, to_user_id?, to_email?, state('pending'|'accepted'), note?, created_at)`.
- `app/routers/recipes.py`:
  - `handoff_recipe` (`POST /recipes/{id}/handoff`) — owner-of-root check, root-normalization, idempotent per (root, grantee), in-app grantee → `accepted`, email → `pending`.
  - `accept_handoff` (`POST /recipes/handoffs/{id}/accept`) — recipient-only (by user id or matching email) → sets `to_user_id`, `state='accepted'`.
  - `_attach_growth_fields(recipe, db)` — computes `cook_count`, `growth_stage`, `growth_vitality`, etc.
  - `can_view(recipe, user, db)` (from `services/lineage.py`) — public root OR owner OR accepted grant on root.
- `app/routers/auth.py` — `signup` auto-accepts pending handoffs where `to_email == new_user.email`.
- `HandoffIn(to_email?, to_user_id?, note?)`, `HandoffResponse(id, recipe_id, state, to_email?, to_user_id?, note?)` in `app/schemas/recipe.py`.
- Frontend: `HandoffInvite.jsx` (mounted in `PlantRecipe.jsx:122` and `RecipeDetail.jsx:183`), `api/lineage.js` (`handoffRecipe`), `Login.jsx`, `App.jsx` routes, `Plant.jsx`, `lib/growth.js`.
- Alembic head: `77d459d3e468` (add_step_voice_note). New migration chains from it.
- No existing `secrets`/`token_urlsafe` usage — this introduces it.

---

## File Structure

**Backend:**
- **Modify** `app/models/handoff.py` — add `token: Mapped[Optional[str]]` (unique, nullable, indexed).
- **Create** `alembic/versions/<rev>_add_handoff_token.py` — add the column + unique index; backfill existing rows with tokens; down drops it.
- **Modify** `app/routers/recipes.py` — generate a token in `handoff_recipe`; add `GET /recipes/invite/{token}` (unauthenticated, limited preview) and `POST /recipes/invite/{token}/claim` (authenticated). Return `token` (owner-only) in `HandoffResponse`.
- **Modify** `app/schemas/recipe.py` — add `token` to `HandoffResponse`; add a new `InvitePreview` response schema (the locked, limited shape).
- **Modify** `app/routers/auth.py` — no change needed for token-carry (the frontend claims post-signup via the claim endpoint); leave the email auto-accept as a complementary path.

**Frontend:**
- **Modify** `frontend/src/lib/handoffStarters.js` (Create) — the starter definitions + selection logic (pure).
- **Modify** `frontend/src/components/HandoffInvite.jsx` — render starters, auto-select for the source, remove "remix" copy, accept a `sourceName` prop.
- **Modify** `frontend/src/pages/PlantRecipe.jsx` + `frontend/src/pages/RecipeDetail.jsx` — pass `sourceName` (derived from `origin_attribution`) to `HandoffInvite`.
- **Create** `frontend/src/pages/InviteLanding.jsx` — the public soft-wall preview page.
- **Modify** `frontend/src/App.jsx` — add the public `/invite/:token` route (NOT wrapped in `ProtectedRoute`).
- **Modify** `frontend/src/pages/Login.jsx` — read an `?invite=<token>` query param, carry it through signup, and claim after auth.
- **Modify** `frontend/src/api/lineage.js` — add `getInvitePreview(token)` and `claimInvite(token)`.

---

### Task 1: Note-starters + remix-free copy (frontend, §4.2)

Add one-tap starters that pre-fill the handoff note, auto-select "add your part" when passing back to the recorded source, and remove the stale "remix" wording. Pure starter logic in its own module.

**Files:**
- Create: `frontend/src/lib/handoffStarters.js`
- Create: `frontend/src/lib/handoffStarters.test.js`
- Modify: `frontend/src/components/HandoffInvite.jsx`
- Modify: `frontend/src/components/HandoffInvite.test.jsx`

**Interfaces:**
- Produces: `HANDOFF_STARTERS` (array of `{ key: 'fill' | 'love', label: string, note: string }`) and `defaultStarterKey(sourceName)` → `'fill'` when `sourceName` is truthy, else `null`. `HandoffInvite` gains a `sourceName` prop (string | null, default null).

- [ ] **Step 1: Write the failing test for the starter logic**

Create `frontend/src/lib/handoffStarters.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { HANDOFF_STARTERS, defaultStarterKey } from './handoffStarters'

describe('handoffStarters', () => {
  it('offers exactly two starters: fill-in and sharing', () => {
    expect(HANDOFF_STARTERS.map((s) => s.key)).toEqual(['fill', 'love'])
    expect(HANDOFF_STARTERS.find((s) => s.key === 'fill').note).toMatch(/part I/i)
    expect(HANDOFF_STARTERS.find((s) => s.key === 'love').note).toMatch(/love this/i)
  })

  it('auto-selects the fill-in starter when passing back to the source', () => {
    expect(defaultStarterKey('Lola')).toBe('fill')
  })

  it('selects nothing by default when there is no recorded source', () => {
    expect(defaultStarterKey(null)).toBeNull()
    expect(defaultStarterKey('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `frontend/`): `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/lib/handoffStarters.test.js`
Expected: FAIL — `Failed to resolve import "./handoffStarters"`.

- [ ] **Step 3: Write the starter module**

Create `frontend/src/lib/handoffStarters.js`:

```js
// One-tap note starters that carry the sender's intent (spec §4.2). The app never
// guesses intent from the recipient's identity — the note carries it. The ONE safe
// auto-touch: when passing back to the recipe's recorded source, pre-select the
// fill-in starter (near-certain there), still fully editable.
export const HANDOFF_STARTERS = [
  { key: 'fill', label: '✍️ Add the part I’m missing', note: 'Add the part I’m missing — the measures, the timing, the way you know it.' },
  { key: 'love', label: '💛 You’d love this', note: 'You’d love this — I wanted you to have it.' },
]

export function defaultStarterKey(sourceName) {
  return sourceName ? 'fill' : null
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/lib/handoffStarters.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing HandoffInvite behavior tests**

Replace the two stale copy tests in `frontend/src/components/HandoffInvite.test.jsx` (the `shows access-granting copy for a private recipe` test asserting `/see, cook, and remix/i`, and keep the public one) and add starter tests. The full new file:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../api/lineage', () => ({ handoffRecipe: vi.fn(() => Promise.resolve({ data: { id: 1, state: 'pending' } })) }))
import { handoffRecipe } from '../api/lineage'
import HandoffInvite from './HandoffInvite'

beforeEach(() => handoffRecipe.mockClear())

describe('HandoffInvite', () => {
  it('sends the handoff and calls onSent', async () => {
    const onSent = vi.fn()
    render(<HandoffInvite recipeId={7} onSent={onSent} onSkip={() => {}} />)
    await userEvent.type(screen.getByPlaceholderText(/their email/i), 'mom@example.com')
    await userEvent.type(screen.getByPlaceholderText(/a note in your words/i), 'your adobo')
    await userEvent.click(screen.getByRole('button', { name: /pass it on/i }))
    expect(handoffRecipe).toHaveBeenCalledWith(7, { to_email: 'mom@example.com', note: 'your adobo' })
    expect(onSent).toHaveBeenCalled()
  })

  it('calls onSkip', async () => {
    const onSkip = vi.fn()
    render(<HandoffInvite recipeId={7} onSent={() => {}} onSkip={onSkip} />)
    await userEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(onSkip).toHaveBeenCalled()
  })

  it('invites cooking and keeping, never remixing (private)', () => {
    render(<HandoffInvite recipeId={1} recipeVisibility="private" onSent={() => {}} onSkip={() => {}} />)
    expect(screen.getByText(/cook it and keep it/i)).toBeInTheDocument()
    expect(screen.queryByText(/remix/i)).not.toBeInTheDocument()
  })

  it('shows nudge copy for a public recipe', () => {
    render(<HandoffInvite recipeId={1} recipeVisibility="public" onSent={() => {}} onSkip={() => {}} />)
    expect(screen.getByText(/let them know|already public/i)).toBeInTheDocument()
  })

  it('tapping a starter fills the note', async () => {
    render(<HandoffInvite recipeId={7} onSent={() => {}} onSkip={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /add the part i.m missing/i }))
    expect(screen.getByPlaceholderText(/a note in your words/i)).toHaveValue(
      'Add the part I’m missing — the measures, the timing, the way you know it.'
    )
  })

  it('pre-selects the fill-in starter note when passing back to the source', () => {
    render(<HandoffInvite recipeId={7} sourceName="Lola" onSent={() => {}} onSkip={() => {}} />)
    expect(screen.getByPlaceholderText(/a note in your words/i)).toHaveValue(
      'Add the part I’m missing — the measures, the timing, the way you know it.'
    )
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/components/HandoffInvite.test.jsx`
Expected: FAIL — starters aren't rendered, note placeholder differs, "remix" copy still present.

- [ ] **Step 7: Rewrite HandoffInvite**

Replace `frontend/src/components/HandoffInvite.jsx` with:

```jsx
import { useState } from 'react'
import { handoffRecipe } from '../api/lineage'
import { HANDOFF_STARTERS, defaultStarterKey } from '../lib/handoffStarters'

// "Who else should have this seed?" — the pass-it-on invite (spec §4). One broad
// action; the sender's NOTE carries intent. One-tap starters pre-fill the note;
// when passing back to the recorded source, the fill-in starter is pre-selected
// (the one safe auto-touch). Remix is cut (§0.1) — copy invites cook + keep.
export default function HandoffInvite({ recipeId, recipeVisibility = 'private', sourceName = null, onSent, onSkip }) {
  const seedKey = defaultStarterKey(sourceName)
  const seedNote = seedKey ? HANDOFF_STARTERS.find((s) => s.key === seedKey).note : ''
  const [email, setEmail] = useState('')
  const [note, setNote] = useState(seedNote)
  const [activeStarter, setActiveStarter] = useState(seedKey)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  function applyStarter(starter) {
    setActiveStarter(starter.key)
    setNote(starter.note)
  }

  async function send() {
    setError(''); setSending(true)
    try {
      const { data } = await handoffRecipe(recipeId, { to_email: email.trim(), note: note.trim() || null })
      onSent?.(data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not send. Try again.')
      setSending(false)
    }
  }

  return (
    <div className="px-[18px] py-6 text-center">
      <h1 className="font-serif font-black text-[24px] text-ink leading-tight">
        Who else should<br />have this seed?
      </h1>
      <p className="font-serif italic text-[14px] text-ink-soft mt-2 mb-5">
        {recipeVisibility === 'public'
          ? 'Let them know about this — it’s already public.'
          : 'They’ll be able to cook it and keep it — and add the parts only they know.'}
      </p>
      <input
        type="email" placeholder="Their email" value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="field mb-3"
      />
      <div className="flex gap-2 mb-2.5">
        {HANDOFF_STARTERS.map((s) => (
          <button
            key={s.key} type="button" onClick={() => applyStarter(s)}
            aria-pressed={activeStarter === s.key}
            className={`flex-1 text-[12.5px] font-sans rounded-full px-3 py-2 border transition-colors ${
              activeStarter === s.key ? 'border-terra bg-terra/10 text-terra' : 'border-line text-ink-soft'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <textarea
        placeholder="A note in your words… (optional)" value={note}
        onChange={(e) => { setNote(e.target.value); setActiveStarter(null) }}
        rows={2}
        className="field resize-none mb-3"
      />
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      <button
        onClick={send} disabled={!email.trim() || sending}
        className="btn-primary disabled:opacity-50"
      >
        {sending ? 'Sending…' : 'Pass it on'}
      </button>
      <button onClick={onSkip} className="block w-full mt-3 font-serif italic text-ink-soft text-sm">
        Skip for now
      </button>
    </div>
  )
}
```

- [ ] **Step 8: Run both test files to verify they pass**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/lib/handoffStarters.test.js src/components/HandoffInvite.test.jsx`
Expected: PASS (3 + 6 tests).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/handoffStarters.js frontend/src/lib/handoffStarters.test.js frontend/src/components/HandoffInvite.jsx frontend/src/components/HandoffInvite.test.jsx
git commit -m "feat: handoff note-starters + remix-free copy (spec §4.2)"
```

---

### Task 2: Pass the recorded source into HandoffInvite (frontend wiring)

Wire the `sourceName` prop from both mount points so the "add your part" starter auto-selects when passing back to the recorded source. The source name is the leading segment of `origin_attribution` (which is stored as `"Name · Place · Year"`), matching how `Provenance.jsx` already parses it.

**Files:**
- Modify: `frontend/src/pages/RecipeDetail.jsx:183`
- Modify: `frontend/src/pages/PlantRecipe.jsx:122`
- Create: `frontend/src/lib/sourceName.js`
- Create: `frontend/src/lib/sourceName.test.js`

**Interfaces:**
- Consumes: `HandoffInvite`'s `sourceName` prop (Task 1).
- Produces: `sourceNameOf(recipe)` from `src/lib/sourceName.js` → the leading name segment of `recipe.origin_attribution`, or `null`.

- [ ] **Step 1: Write the failing test for `sourceNameOf`**

Create `frontend/src/lib/sourceName.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { sourceNameOf } from './sourceName'

describe('sourceNameOf', () => {
  it('returns the leading name segment of origin_attribution', () => {
    expect(sourceNameOf({ origin_attribution: 'Lola Remedios · Cebu · 1950s' })).toBe('Lola Remedios')
  })
  it('handles a bare name with no separators', () => {
    expect(sourceNameOf({ origin_attribution: 'Mom' })).toBe('Mom')
  })
  it('returns null when there is no origin', () => {
    expect(sourceNameOf({ origin_attribution: null })).toBeNull()
    expect(sourceNameOf({})).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/lib/sourceName.test.js`
Expected: FAIL — `Failed to resolve import "./sourceName"`.

- [ ] **Step 3: Write the helper**

Create `frontend/src/lib/sourceName.js`:

```js
// The recorded source's name = the leading segment of origin_attribution
// (stored "Name · Place · Year"), matching how Provenance.jsx parses it.
export function sourceNameOf(recipe) {
  const attr = recipe?.origin_attribution
  if (!attr) return null
  const name = attr.split('·')[0].trim()
  return name || null
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/lib/sourceName.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire it into RecipeDetail**

In `frontend/src/pages/RecipeDetail.jsx`, add the import near the top (with the other `lib` imports):

```jsx
import { sourceNameOf } from '../lib/sourceName'
```

Then change the `HandoffInvite` mount (line 183) from:

```jsx
            <HandoffInvite recipeId={recipe.id} recipeVisibility={recipe.visibility} onSent={() => setShowHandoff(false)} onSkip={() => setShowHandoff(false)} />
```

to:

```jsx
            <HandoffInvite recipeId={recipe.id} recipeVisibility={recipe.visibility} sourceName={sourceNameOf(recipe)} onSent={() => setShowHandoff(false)} onSkip={() => setShowHandoff(false)} />
```

- [ ] **Step 6: Wire it into PlantRecipe**

In `frontend/src/pages/PlantRecipe.jsx`, the handoff step (line ~122) currently mounts `HandoffInvite` with `recipeId={planted.id}`. The just-planted recipe's origin name is already in component state as `origin.name` on the ancestor path. Change the mount to pass it:

```jsx
  return (
    <HandoffInvite
      recipeId={planted.id}
      sourceName={originMode === 'ancestor' && origin.name.trim() ? origin.name.trim() : null}
      onSent={() => navigate(`/recipes/${planted.id}`)}
      onSkip={() => navigate(`/recipes/${planted.id}`)}
    />
  )
```

- [ ] **Step 7: Run the affected suites**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/lib/sourceName.test.js src/pages/PlantRecipe.test.jsx src/pages/RecipeDetail.test.jsx`
Expected: PASS — the new helper tests pass and the existing PlantRecipe/RecipeDetail tests still pass (the added prop is inert in those tests since they don't set an origin).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/sourceName.js frontend/src/lib/sourceName.test.js frontend/src/pages/RecipeDetail.jsx frontend/src/pages/PlantRecipe.jsx
git commit -m "feat: pass recorded source into handoff for the safe auto-touch"
```

---

### Task 3: Backend — handoff token column + migration

Add a capability `token` to every handoff. The token is the secret that will unlock the soft-wall preview (Task 4).

**Files:**
- Modify: `app/models/handoff.py`
- Create: `alembic/versions/<rev>_add_handoff_token.py`
- Test: `tests/test_handoff_token.py` (Create)

**Interfaces:**
- Produces: `Handoff.token: Optional[str]` (unique, indexed, nullable in schema — populated on creation going forward, backfilled for existing rows).

- [ ] **Step 1: Write the failing test**

Create `tests/test_handoff_token.py`:

```python
def _payload(name="Adobo", **extra):
    return {"name": name,
            "ingredients": [{"name": "chicken", "quantity_text": "2 lbs",
                             "quantity_type": "precise", "position": 1}],
            "steps": [{"content": "Cook", "position": 1}], **extra}


def test_handoff_gets_a_unique_token(client, make_user, db_session):
    from app.models.handoff import Handoff
    owner, oheaders = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    r = client.post(f"/recipes/{root['id']}/handoff",
                    json={"to_email": "mom@example.com"}, headers=oheaders)
    assert r.status_code == 201
    h = db_session.query(Handoff).filter_by(recipe_id=root["id"]).one()
    assert h.token and len(h.token) >= 20  # token_urlsafe(32) → ~43 chars
    # owner sees the token in the response (needed to build the invite link)
    assert r.json()["token"] == h.token
```

- [ ] **Step 2: Run it to verify it fails**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_handoff_token.py -q`
Expected: FAIL — `Handoff` has no `token` attribute (and `HandoffResponse` has no `token`).

- [ ] **Step 3: Add the column to the model**

In `app/models/handoff.py`, add the import if needed and the column after `note`:

```python
    token: Mapped[Optional[str]] = mapped_column(nullable=True, unique=True, index=True)
```

(The `note` line already uses `Mapped[Optional[str]]`, so no new imports are needed.)

- [ ] **Step 4: Generate the token in `handoff_recipe` and expose it**

In `app/routers/recipes.py`, add at the top of the imports:

```python
import secrets
```

In `handoff_recipe`, when constructing the new `Handoff(...)` (currently around line 237), add a `token`:

```python
    handoff = Handoff(
        recipe_id=root.id,
        from_user_id=current_user.id,
        to_user_id=(resolved_user.id if resolved_user else None),
        to_email=(None if resolved_user else to_email),
        state=("accepted" if resolved_user else "pending"),
        note=handoff_in.note,
        token=secrets.token_urlsafe(32),
    )
```

In `app/schemas/recipe.py`, add `token` to `HandoffResponse` (after `note`):

```python
    token: Optional[str] = None
```

- [ ] **Step 5: Write the migration**

Create `alembic/versions/<rev>_add_handoff_token.py` (choose a fresh 12-hex `<rev>`, e.g. `b2c3d4e5f6a7`; the filename's leading id must match `revision`):

```python
"""add handoff token

Revision ID: b2c3d4e5f6a7
Revises: 77d459d3e468
Create Date: 2026-07-10

"""
import secrets
from alembic import op
import sqlalchemy as sa

revision = "b2c3d4e5f6a7"
down_revision = "77d459d3e468"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("handoffs", sa.Column("token", sa.String(), nullable=True))
    # Backfill existing rows with unique tokens so old invites can gain links too.
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id FROM handoffs WHERE token IS NULL")).fetchall()
    for (hid,) in rows:
        conn.execute(
            sa.text("UPDATE handoffs SET token = :t WHERE id = :id"),
            {"t": secrets.token_urlsafe(32), "id": hid},
        )
    op.create_index("ix_handoffs_token", "handoffs", ["token"], unique=True)


def downgrade():
    op.drop_index("ix_handoffs_token", table_name="handoffs")
    op.drop_column("handoffs", "token")
```

- [ ] **Step 6: Run the token test to verify it passes**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_handoff_token.py -q`
Expected: PASS (1 test). The `client`/`db_session` fixtures build the schema from the models via `Base.metadata.create_all`, so the column exists in tests without running the migration.

- [ ] **Step 7: Verify the migration applies + reverses on a scratch SQLite DB**

Run (from repo root):

```bash
rm -f /tmp/mig_test.db
DATABASE_URL="sqlite:////tmp/mig_test.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m alembic upgrade head
DATABASE_URL="sqlite:////tmp/mig_test.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m alembic downgrade -1
rm -f /tmp/mig_test.db
```

Expected: upgrade runs to the new head with no error; downgrade removes the column with no error. NOTE: TECHDEBT (f) documents two OLDER migrations that fail on a from-scratch SQLite upgrade (named-FK drops). If `upgrade head` errors on one of those *pre-existing* migrations (not yours), that is the known debt — instead verify your migration in isolation by stamping to the prior head first:

```bash
rm -f /tmp/mig_test.db
DATABASE_URL="sqlite:////tmp/mig_test.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -c "from app.database import Base, engine; import app.models.user, app.models.recipe, app.models.handoff, app.models.ingredient, app.models.ingredient_section, app.models.step, app.models.ghost_ancestor, app.models.cook_event; Base.metadata.create_all(engine)"
DATABASE_URL="sqlite:////tmp/mig_test.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m alembic stamp 77d459d3e468
DATABASE_URL="sqlite:////tmp/mig_test.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m alembic downgrade -1
rm -f /tmp/mig_test.db
```

Record which path you used in the report. Either clean result is acceptable; a failure originating in YOUR migration is not.

- [ ] **Step 8: Commit**

```bash
git add app/models/handoff.py app/routers/recipes.py app/schemas/recipe.py alembic/versions/*_add_handoff_token.py tests/test_handoff_token.py
git commit -m "feat: capability token on handoffs (+ migration, backfill)"
```

---

### Task 4: Backend — the soft-wall preview + claim endpoints

Add the **unauthenticated** limited preview (`GET /recipes/invite/{token}`) and the **authenticated** claim (`POST /recipes/invite/{token}/claim`). The preview is the security-critical piece: it must expose only name / who-it's-from / story / plant.

**Files:**
- Modify: `app/schemas/recipe.py` (add `InvitePreview`)
- Modify: `app/routers/recipes.py` (two new endpoints)
- Test: `tests/test_invite_softwall.py` (Create)

**Interfaces:**
- Consumes: `Handoff.token` (Task 3), `_attach_growth_fields`, `root_of`.
- Produces:
  - `InvitePreview` schema: `{ recipe_id: int, name: str, from_name: Optional[str], origin_attribution: Optional[str], story: Optional[str], growth_stage: str, growth_vitality: str, cover_photo_url: Optional[str] }`.
  - `GET /recipes/invite/{token}` → `InvitePreview` (no auth). 404 on unknown token.
  - `POST /recipes/invite/{token}/claim` → `HandoffResponse` (auth). Sets `to_user_id=current_user.id`, `state='accepted'`. 404 on unknown token.

**IMPORTANT — route ordering:** both new routes contain the literal segment `invite`. They MUST be declared BEFORE `get_recipe` (`GET /recipes/{recipe_id}`), exactly like the existing `/shared` route is declared before `get_recipe` (see the comment at `recipes.py:317`). Otherwise `invite` is captured as a `{recipe_id}` and 422s. Place them immediately after `accept_handoff` and before `get_recipe`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_invite_softwall.py`:

```python
def _payload(name="Adobo", **extra):
    return {"name": name,
            "ingredients": [{"name": "secret-ingredient", "quantity_text": "2 lbs",
                             "quantity_type": "precise", "position": 1}],
            "steps": [{"content": "secret-step", "position": 1}], **extra}


def _handoff(client, owner_headers, email="mom@example.com", **extra):
    root = client.post("/recipes", json=_payload(story="Lola made this every Sunday.",
                       origin={"name": "Lola Remedios", "place": "Cebu"}, **extra),
                       headers=owner_headers).json()
    r = client.post(f"/recipes/{root['id']}/handoff",
                    json={"to_email": email}, headers=owner_headers)
    return root, r.json()["token"]


def test_preview_is_unauthenticated_and_limited(client, make_user):
    owner, oheaders = make_user()
    root, token = _handoff(client, oheaders)
    # NO auth header — preview must be public
    r = client.get(f"/recipes/invite/{token}")
    assert r.status_code == 200
    body = r.json()
    # Exposed: name, who-it's-from, story, plant
    assert body["name"] == "Adobo"
    assert body["story"] == "Lola made this every Sunday."
    assert body["from_name"]  # the owner's name
    assert "Lola Remedios" in (body["origin_attribution"] or "")
    assert body["growth_stage"] in {"seed", "sprout", "sapling", "tree"}
    # LOCKED OUT: no body content whatsoever
    assert "ingredients" not in body
    assert "steps" not in body
    assert "secret-ingredient" not in r.text
    assert "secret-step" not in r.text


def test_preview_unknown_token_404(client, make_user):
    make_user()
    r = client.get("/recipes/invite/not-a-real-token")
    assert r.status_code == 404


def test_claim_grants_view_even_on_email_mismatch(client, make_user, db_session):
    from app.services.lineage import can_view
    from app.models.recipe import Recipe
    owner, oheaders = make_user()
    # invite addressed to one email…
    root, token = _handoff(client, oheaders, email="aunt@example.com")
    # …but claimed by a DIFFERENT signed-in user (the mismatched-email orphan case)
    claimer, cheaders = make_user()
    r = client.post(f"/recipes/invite/{token}/claim", headers=cheaders)
    assert r.status_code == 200
    assert r.json()["state"] == "accepted"
    # claimer can now view the (private) root
    root_obj = db_session.query(Recipe).filter_by(id=root["id"]).one()
    assert can_view(root_obj, claimer, db_session) is True


def test_claim_requires_auth(client, make_user):
    owner, oheaders = make_user()
    _root, token = _handoff(client, oheaders)
    r = client.post(f"/recipes/invite/{token}/claim")
    assert r.status_code == 401
```

- [ ] **Step 2: Run to verify they fail**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_invite_softwall.py -q`
Expected: FAIL — endpoints don't exist (404/405).

- [ ] **Step 3: Add the `InvitePreview` schema**

In `app/schemas/recipe.py`, add near `HandoffResponse`:

```python
class InvitePreview(BaseModel):
    # The soft-wall preview (spec §4.3). DELIBERATELY LIMITED: name, who-it's-from,
    # story, growth plant — NEVER ingredients/steps/notes. Viewable without an account.
    recipe_id: int
    name: str
    from_name: Optional[str] = None
    origin_attribution: Optional[str] = None
    story: Optional[str] = None
    growth_stage: str = "seed"
    growth_vitality: str = "bare"
    cover_photo_url: Optional[str] = None
```

- [ ] **Step 4: Add the endpoints (BEFORE `get_recipe`)**

In `app/routers/recipes.py`, add `InvitePreview` to the schema import line, then insert these two endpoints immediately AFTER `accept_handoff` and BEFORE `get_recipe` (the `GET /{recipe_id}` route):

```python
@router.get("/invite/{token}", response_model=InvitePreview)
def preview_invite(token: str, db: Session = Depends(get_db)):
    # Unauthenticated soft-wall preview (spec §4.3). Limited by construction — this
    # response model cannot carry ingredients/steps. The token is the capability.
    h = db.query(Handoff).filter(Handoff.token == token).first()
    if h is None:
        raise HTTPException(status_code=404, detail="Invite not found")
    recipe = db.query(Recipe).filter(
        Recipe.id == h.recipe_id, Recipe.deleted_at == None
    ).options(selectinload(Recipe.user)).first()
    if recipe is None:
        raise HTTPException(status_code=404, detail="Invite not found")
    _attach_growth_fields(recipe, db)
    from_name = None
    if recipe.user is not None:
        from_name = " ".join(p for p in [recipe.user.first_name, recipe.user.last_name] if p) or None
    return InvitePreview(
        recipe_id=recipe.id,
        name=recipe.name,
        from_name=from_name,
        origin_attribution=recipe.origin_attribution,
        story=recipe.story,
        growth_stage=recipe.growth_stage,
        growth_vitality=recipe.growth_vitality,
        cover_photo_url=recipe.cover_photo_url,
    )


@router.post("/invite/{token}/claim", response_model=HandoffResponse)
def claim_invite(
    token: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Authenticated claim: the token IS the authorization to accept, so any
    # signed-in user holding the link can claim it — this resolves the
    # mismatched-email orphan (an invite to a@x claimed by someone who signed up
    # as b@y). Idempotent: re-claiming returns the accepted grant.
    h = db.query(Handoff).filter(Handoff.token == token).first()
    if h is None:
        raise HTTPException(status_code=404, detail="Invite not found")
    h.to_user_id = current_user.id
    h.state = "accepted"
    db.commit()
    db.refresh(h)
    return h
```

- [ ] **Step 5: Run to verify the tests pass**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_invite_softwall.py -q`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full backend suite (nothing regressed)**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q`
Expected: PASS — the prior 66 + the new token/invite tests. If any prior test breaks, fix before committing.

- [ ] **Step 7: Commit**

```bash
git add app/schemas/recipe.py app/routers/recipes.py tests/test_invite_softwall.py
git commit -m "feat: soft-wall invite preview (unauth, limited) + token claim (spec §4.3)"
```

---

### Task 5: Frontend — the invite landing + signup-to-participate

Add the public `/invite/:token` soft-wall page (preview → sign up to participate), and carry the token through Login/signup so the new account claims the grant.

**Files:**
- Modify: `frontend/src/api/lineage.js`
- Create: `frontend/src/pages/InviteLanding.jsx`
- Create: `frontend/src/pages/InviteLanding.test.jsx`
- Modify: `frontend/src/App.jsx` (public route)
- Modify: `frontend/src/pages/Login.jsx` (carry `?invite=` token, claim after auth)

**Interfaces:**
- Consumes: `GET /recipes/invite/{token}` + `POST /recipes/invite/{token}/claim` (Task 4).
- Produces: `getInvitePreview(token)` and `claimInvite(token)` in `api/lineage.js`; a public route `/invite/:token`; Login claims the token from `?invite=` after signup/login.

- [ ] **Step 1: Add the API calls**

In `frontend/src/api/lineage.js`, add:

```js
export const getInvitePreview = (token) => client.get(`/recipes/invite/${token}`)
export const claimInvite = (token) => client.post(`/recipes/invite/${token}/claim`)
```

- [ ] **Step 2: Write the failing InviteLanding test**

Create `frontend/src/pages/InviteLanding.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../api/lineage', () => ({
  getInvitePreview: vi.fn(() => Promise.resolve({ data: {
    recipe_id: 5, name: 'Lola’s Adobo', from_name: 'Yoko Matsuda',
    origin_attribution: 'Lola Remedios · Cebu', story: 'Every Sunday.',
    growth_stage: 'sprout', growth_vitality: 'bare', cover_photo_url: null,
  } })),
}))
import InviteLanding from './InviteLanding'

beforeEach(() => localStorage.clear())

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/invite/:token" element={<InviteLanding />} /></Routes>
    </MemoryRouter>
  )
}

describe('InviteLanding (soft wall)', () => {
  it('previews name, who-it-from, and story, then invites signup', async () => {
    renderAt('/invite/abc123')
    await waitFor(() => expect(screen.getByText('Lola’s Adobo')).toBeInTheDocument())
    expect(screen.getByText(/Yoko Matsuda/)).toBeInTheDocument()
    expect(screen.getByText(/Every Sunday\./)).toBeInTheDocument()
    // the gate: a link/button to sign up carrying the token
    const cta = screen.getByRole('link', { name: /sign up|join|keep this/i })
    expect(cta.getAttribute('href')).toContain('invite=abc123')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/pages/InviteLanding.test.jsx`
Expected: FAIL — `Failed to resolve import './InviteLanding'`.

- [ ] **Step 4: Write InviteLanding**

Create `frontend/src/pages/InviteLanding.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getInvitePreview } from '../api/lineage'
import Plant from '../components/Plant'
import { stageForRecipe, vitalityForRecipe } from '../lib/growth'
import Wordmark from '../components/Wordmark'

// The soft-wall recipient landing (spec §4.3): a warm preview — name, who it's
// from, the story, the growth plant — then a signup gate to participate. The
// emotional hook lands BEFORE the ask. Public route; no account required to view.
export default function InviteLanding() {
  const { token } = useParams()
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    getInvitePreview(token)
      .then(({ data }) => { if (live) setPreview(data) })
      .catch(() => { if (live) setError('This invite link is not valid or has expired.') })
    return () => { live = false }
  }, [token])

  if (error) {
    return (
      <div className="min-h-screen bg-paper flex flex-col items-center justify-center px-6 text-center">
        <p className="font-serif italic text-ink-soft">{error}</p>
        <Link to="/login" className="btn-primary mt-5 inline-block">Go to issei</Link>
      </div>
    )
  }
  if (!preview) {
    return <div className="min-h-screen bg-paper flex items-center justify-center"><p className="font-serif italic text-ink-soft">Opening…</p></div>
  }

  return (
    <div className="min-h-screen bg-paper flex flex-col items-center px-6 py-12 text-center">
      <Wordmark className="text-[40px] mb-6" />
      <Plant stage={stageForRecipe(preview)} vitality={vitalityForRecipe(preview)} size={72} />
      {preview.from_name && (
        <p className="font-sans text-[11px] tracking-[0.18em] uppercase text-herb mt-4 mb-1">
          {preview.from_name} passed you
        </p>
      )}
      <h1 className="font-serif font-black text-[28px] text-ink leading-tight">{preview.name}</h1>
      {preview.origin_attribution && (
        <p className="font-serif italic text-[14px] text-ink-soft mt-1">🌱 {preview.origin_attribution.split('·')[0].trim()}</p>
      )}
      {preview.story && (
        <p className="font-serif italic text-[15px] text-ink-soft mt-5 max-w-sm leading-relaxed">{preview.story}</p>
      )}
      <div className="mt-8 w-full max-w-sm">
        <Link to={`/login?tab=signup&invite=${token}`} className="btn-primary block">
          Keep this recipe — join the table
        </Link>
        <p className="font-sans text-[12px] text-ink-soft mt-3">
          Make a free account to cook it, keep it, and add the parts only you know.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/pages/InviteLanding.test.jsx`
Expected: PASS (1 test).

- [ ] **Step 6: Register the PUBLIC route**

In `frontend/src/App.jsx`, add the import and a route that is NOT wrapped in `ProtectedRoute` (like `/login`):

```jsx
import InviteLanding from './pages/InviteLanding'
```

Add, next to the `/login` route:

```jsx
      <Route path="/invite/:token" element={<InviteLanding />} />
```

- [ ] **Step 7: Carry the token through Login/signup + claim**

In `frontend/src/pages/Login.jsx`:

Add imports for the query param + claim call:

```jsx
import { useSearchParams } from 'react-router-dom'
import { claimInvite } from '../api/lineage'
```

Inside the component, read the params and initialize the tab:

```jsx
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('invite')
  const [tab, setTab] = useState(searchParams.get('tab') === 'signup' ? 'signup' : 'login')
```

(Replace the existing `const [tab, setTab] = useState('login')` line with the one above.)

Then factor the post-auth step so BOTH handlers claim the invite before navigating. Add this helper inside the component:

```jsx
  async function finishAuth(data) {
    localStorage.setItem('issei_token', data.access_token)
    localStorage.setItem('issei_user', JSON.stringify(data.user))
    if (inviteToken) {
      // The token IS the authorization; claim the grant for this account, then
      // land the user on the recipe they were invited to.
      try {
        await claimInvite(inviteToken)
      } catch {
        // A bad/expired token shouldn't block sign-in; just proceed home.
      }
    }
    navigate('/')
  }
```

In `handleLogin`, replace the three lines:

```jsx
      localStorage.setItem('issei_token', data.access_token)
      localStorage.setItem('issei_user', JSON.stringify(data.user))
      navigate('/')
```

with:

```jsx
      await finishAuth(data)
```

Do the same replacement in `handleSignup` (it has the identical three lines after the login call).

- [ ] **Step 8: Run the frontend suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run`
Expected: PASS — all files, including the new InviteLanding test and unchanged Login behavior (no existing Login test asserts navigation internals; if one exists and breaks, adjust it to the `finishAuth` path).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/api/lineage.js frontend/src/pages/InviteLanding.jsx frontend/src/pages/InviteLanding.test.jsx frontend/src/App.jsx frontend/src/pages/Login.jsx
git commit -m "feat: soft-wall invite landing + carry token through signup (spec §4.3)"
```

---

### Task 6: Full-suite verify, security check, visual verification, and docs

Confirm the whole handoff refinement works end-to-end, re-verify the security boundary, then update docs + tech-debt.

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `TECHDEBT.md`

- [ ] **Step 1: Full backend suite**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q`
Expected: PASS (all).

- [ ] **Step 2: Full frontend suite + build**

Run (from `frontend/`): `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run && npx vite build`
Expected: all tests pass; build clean.

- [ ] **Step 3: Security re-check of the preview boundary**

Manually confirm (read `preview_invite` + `InvitePreview`): the preview response model has NO ingredients/steps/notes fields, so even if the endpoint code were changed to over-fetch, the schema cannot serialize body content. Grep the invite test's response `.text` assertions pass (no `secret-ingredient`/`secret-step` leak). Record the confirmation in the report. If ANY path exposes body content without `can_view`, STOP and flag it.

- [ ] **Step 4: End-to-end visual verification**

Using the isolated demo stack (throwaway SQLite backend on :8010 via `run_backend.py`, Vite on :5183 with `VITE_API_URL`, seed script under `$CLAUDE_JOB_DIR/tmp`; see `.superpowers/sdd/progress.md` for the pattern), verify with a Playwright driver run from `frontend/`:
1. Owner opens a private recipe → "Pass it on" → sees the two starters; entering the source and tapping "Add the part I'm missing" fills the note; sends to an email.
2. Grab the created handoff's token (query the demo DB or the send response), visit `/invite/<token>` **logged out** → the soft-wall shows the recipe name, "Yoko passed you", the story, and the plant — and NO ingredients/steps.
3. Click "Keep this recipe — join the table" → lands on `/login?tab=signup&invite=<token>` with the signup tab active. Complete signup → claim fires → lands in-app → the recipe now appears under "Shared with you".
4. Confirm 0 console errors. Record observations + screenshots.

- [ ] **Step 5: Update ARCHITECTURE.md**

- In the backend `routers/` row, add the invite endpoints to the recipes domain description: `the soft-wall invite flow (GET /recipes/invite/{token} — unauthenticated limited preview; POST /recipes/invite/{token}/claim — authenticated grant claim by token)`.
- In the models note, add `handoffs.token (a capability secret for the invite link)`.
- In the frontend pages table, add:

```
| `InviteLanding.jsx` | `/invite/:token` | **Public** soft-wall: a warm preview of a handed-off recipe (name, who it's from, story, plant — never the body) via the unauthenticated preview endpoint, then a signup-to-participate gate that carries the token to Login. |
```

- In the `lib/` table, add `handoffStarters.js` and `sourceName.js` rows.
- In the Sharing model paragraph, note the token-based claim resolves the mismatched-email invite case.

- [ ] **Step 6: Update TECHDEBT.md**

Move item **(l)** ("orphaned email invite (mismatched email) never resolves in-app") to the Resolved section — the token-claim path now resolves it (any signed-in holder of the link can claim). Note the invite-link flow is now built. Leave item (k) (manage/revoke grants UI) as still-open.

- [ ] **Step 7: Commit**

```bash
git add ARCHITECTURE.md TECHDEBT.md
git commit -m "docs: document the soft-wall invite flow; resolve orphan-invite debt"
```

---

## Self-Review

**1. Spec coverage (§4):**
- §4.1 (one action, two intents) — the single "Pass it on" action + note carries intent. ✓ (Task 1)
- §4.2 (note carries intent + starters; one safe auto-touch for the source; remix-free copy) — Tasks 1 + 2. ✓
- §4.3 (accounts required; soft-wall preview-then-participate; preview scope = name/from/story/plant) — Tasks 3–5. ✓
- §4.4 (built on existing plumbing) — token added to existing Handoff; claim complements existing accept + signup auto-accept. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code. The migration `<rev>` is a concrete example id with an instruction to keep filename/revision consistent. ✓

**3. Type consistency:** `token` is `Optional[str]` in model + `HandoffResponse`; `InvitePreview` fields match what `preview_invite` constructs; `getInvitePreview`/`claimInvite` names match usage in InviteLanding/Login; `sourceNameOf`/`defaultStarterKey`/`HANDOFF_STARTERS` names consistent across producer and consumer. ✓

**4. Security review:**
- The preview is unauthenticated BY DESIGN but limited BY SCHEMA (`InvitePreview` cannot carry body). ✓
- The token is `secrets.token_urlsafe(32)` (~256 bits), unique-indexed, never logged. ✓
- The claim uses the token as the capability (any signed-in holder can claim) — this is intentional and resolves the orphan case; it grants only VIEW+cook (via the existing `can_view` accepted-grant path), never edit/delete/re-share (owner-only, unchanged). ✓
- Route ordering (`/invite/...` before `/{recipe_id}`) is called out explicitly to avoid the path-capture 422. ✓
- The grant-forgery guard (owner-of-root) and root-normalization in `handoff_recipe` are unchanged. ✓
- The `parent_recipe_id` FK / remix surface are untouched. ✓

**5. Migration safety:** nullable add-column + backfill + unique index; reversible `downgrade`; chains from the true head `77d459d3e468`; a fallback verification path is given for the pre-existing TECHDEBT (f) from-scratch-SQLite issue so the implementer doesn't misattribute it. ✓
