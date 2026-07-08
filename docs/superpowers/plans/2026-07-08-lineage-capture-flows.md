# Lineage Capture Flows — Implementation Plan (sub-project 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Issei's built lineage backend to the UI — the plant→handoff, remix, cook, and standalone-handoff flows — and debut the seed→tree growth-state motif, so the signature feature is usable end-to-end.

**Architecture:** React + Vite + Tailwind frontend on branch `lineage-mvp`. Introduce a small logic layer (`stateForRecipe`, payload/diff helpers, a lineage API module) that is unit-tested with Vitest, and a `GrowthMark` SVG primitive reused across cards and flow "beats." The plant page becomes a stepped `PlantRecipe` (doorway → origin → the existing `RecipeForm` → planted beat → handoff invite). Remix/cook actions attach to `RecipeDetail`. Pure logic is TDD'd; visual flows are verified by building + driving the app with Playwright and comparing screenshots to the approved mockups.

**Tech Stack:** React 18, Vite 5, React Router 6, Axios, Tailwind 3 (heirloom tokens already configured); Vitest + @testing-library/react + jsdom (added in Task 1) for unit tests; Playwright (already installed locally) for visual verification; FastAPI backend already built.

## Global Constraints

- **Design guiding principle (spec §6):** prioritize Issei being a top-tier product; do not treat existing frontend structure as a cap — reshape where it serves the vision.
- **Palette (Tailwind tokens, already in `tailwind.config.js`):** paper `#EFE4D2`, card `#FBF6EC`, ink `#3A2A1C`, ink-soft `#6D5844`, line `#E3D3BA`, terra `#BD5A2C` (accent + brand period), saffron `#D99A2B`, herb `#6F8A4D` (living-growth green), plum `#8A3D5A` (rare). Warm shadow `0 2px 10px rgba(120,80,40,.10)`.
- **Fonts:** Fraunces (serif, display/headlines, italic, weights 400/500/600/900); Inter (`font-sans`) ONLY for tiny uppercase labels/metadata.
- **Growth states (spec §2):** `seed` (0 cooks, no children) → `sprout` (≥1 cook, no children) → `sapling` (≥1 child) → `tree` (grandchildren exist). Cooks — **including the owner's own cooks** — drive a bloom/dormancy modifier; branches drive base progression.
- **Remix inheritance (spec §3.2 / parent spec):** child carries `source`, PRE-FILLS editable `notes` from parent, and does NOT carry the parent's `story`.
- **Backend endpoints (built, do not change):** `POST /recipes` (optional `origin`), `POST /recipes/{id}/remix` (`{ingredients, steps, prompt_answer}` → node w/ `prompt_key`), `POST /recipes/{id}/cook` (`{photo_url?, note?}` → `{cook_count}`, no node), `POST /recipes/{id}/handoff` (`{to_email?|to_user_id?, note?}`, owner-only), `GET /recipes/{id}/lineage`.
- **API client:** all calls go through `src/api/client.js` (axios instance, `VITE_API_URL` base, JWT header, 401 handling). Add lineage calls in a module that imports it.
- **Motif:** seed/sprout/sapling/tree are elegant inline SVG (botanical/letterpress, never cartoon). A provisional non-coffee seed is acceptable this sub-project; final mark is task #10.
- **Don't git commit without explicit user approval** (project rule). Per-task "Commit" steps stage + write the message; a human approves before finalizing.
- **Run tooling via the frontend dir:** `cd frontend && npx vitest ...` / `npx vite build`. Node/npm are on PATH.

---

## File Structure

**New (`frontend/src/`):**
- `lib/growthState.js` — `stateForRecipe(recipe)` → `'seed'|'sprout'|'sapling'|'tree'`; `bloomForRecipe(recipe)` → `'dormant'|'normal'|'blooming'`; `ownerCookCount(recipe)`.
- `lib/lineagePayload.js` — `buildOriginPayload(...)`, `buildRemixPayload(...)`: pure functions assembling request bodies (keeps components thin + testable).
- `api/lineage.js` — `plantRecipe`, `remixRecipe`, `cookRecipe`, `handoffRecipe`, `getLineage` (thin wrappers over `client`).
- `components/GrowthMark.jsx` — renders the SVG for a given growth state + bloom.
- `components/HandoffInvite.jsx` — the invite UI (people + email + note), used by plant tail and standalone.
- `pages/PlantRecipe.jsx` — stepped flow: doorway → origin → `RecipeForm` → planted beat → handoff.
- `pages/RemixRecipe.jsx` — pre-filled remix editor + diff prompt.

**Modified:**
- `frontend/package.json`, `frontend/vite.config.js` — Vitest config (Task 1).
- `components/RecipeForm.jsx` — accept `initialValues`/`mode` extensions already present; add optional `submitLabel`/`onValues` hook for embedding in PlantRecipe (Task 6).
- `components/RecipeCard.jsx` — add the growth-state badge.
- `pages/RecipeDetail.jsx` — add "I cooked this", "Make it mine", "Pass it on" + cook beat + growth display.
- `pages/AddRecipe.jsx` — becomes a thin redirect/wrapper to `PlantRecipe` (or is replaced in routing).
- `App.jsx` — routes for `/plant` (or repoint `/add`) and `/recipes/:id/remix`.

**Test files:** co-located `*.test.js(x)` next to logic; a `tests/visual/` Playwright script for the screenshot-verify loop.

---

## Task 1: Vitest + Testing Library setup (test harness)

No JS test tooling exists. Establish it so logic tasks can TDD.

**Files:**
- Modify: `frontend/package.json`, `frontend/vite.config.js`
- Create: `frontend/src/test/setup.js`, `frontend/src/lib/smoke.test.js` (temporary smoke test)

**Interfaces:**
- Produces: `npx vitest run` works; `test`/`test:watch` scripts; jsdom env; `@testing-library/jest-dom` matchers available globally.

- [ ] **Step 1: Install dev deps**

```bash
cd frontend
npm install -D vitest@^2 @testing-library/react@^16 @testing-library/jest-dom@^6 jsdom@^25 @testing-library/user-event@^14
```

- [ ] **Step 2: Configure Vitest in `vite.config.js`**

Add a `test` block to the existing config (keep the existing `plugins`):

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
  },
})
```

- [ ] **Step 3: Create `frontend/src/test/setup.js`**

```js
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 4: Add scripts to `package.json`**

In the `"scripts"` block add:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 5: Write a smoke test `frontend/src/lib/smoke.test.js`**

```js
import { describe, it, expect } from 'vitest'

describe('vitest harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 6: Run and verify it passes**

Run: `cd frontend && npx vitest run`
Expected: 1 passed.

- [ ] **Step 7: Delete the smoke test, commit**

```bash
rm frontend/src/lib/smoke.test.js
git add frontend/package.json frontend/package-lock.json frontend/vite.config.js frontend/src/test/setup.js
git commit -m "test: set up Vitest + Testing Library for frontend"
```

---

## Task 2: Growth-state logic (`lib/growthState.js`)

**Files:**
- Create: `frontend/src/lib/growthState.js`, `frontend/src/lib/growthState.test.js`

**Interfaces:**
- Produces:
  - `ownerCookCount(recipe)` → number (`recipe.cook_events` filtered to `recipe.user_id`, or `recipe.owner_cook_count` if the API provides it; falls back to 0).
  - `stateForRecipe(recipe)` → `'seed' | 'sprout' | 'sapling' | 'tree'`.
  - `bloomForRecipe(recipe)` → `'dormant' | 'normal' | 'blooming'`.
- Consumes: a `recipe` object with (any of) `cook_count` (total), `owner_cook_count`, `child_count` / `children`, `has_grandchildren`, `last_cooked_at`. The helper reads defensively so it works whether the API returns counts or arrays.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest'
import { stateForRecipe, bloomForRecipe, ownerCookCount } from './growthState'

describe('stateForRecipe', () => {
  it('is seed when never cooked and no children', () => {
    expect(stateForRecipe({ cook_count: 0, child_count: 0 })).toBe('seed')
  })
  it('is sprout when cooked but no children', () => {
    expect(stateForRecipe({ cook_count: 3, child_count: 0 })).toBe('sprout')
  })
  it('is sprout when only the owner has cooked it', () => {
    expect(stateForRecipe({ owner_cook_count: 2, cook_count: 2, child_count: 0 })).toBe('sprout')
  })
  it('is sapling when it has children', () => {
    expect(stateForRecipe({ cook_count: 5, child_count: 2 })).toBe('sapling')
  })
  it('is tree when grandchildren exist', () => {
    expect(stateForRecipe({ child_count: 2, has_grandchildren: true })).toBe('tree')
  })
})

describe('ownerCookCount', () => {
  it('prefers explicit owner_cook_count', () => {
    expect(ownerCookCount({ owner_cook_count: 4 })).toBe(4)
  })
  it('derives from cook_events + user_id when needed', () => {
    const r = { user_id: 7, cook_events: [{ user_id: 7 }, { user_id: 9 }, { user_id: 7 }] }
    expect(ownerCookCount(r)).toBe(2)
  })
  it('is 0 when unknown', () => {
    expect(ownerCookCount({})).toBe(0)
  })
})

describe('bloomForRecipe', () => {
  it('blooms when cooked many times recently', () => {
    expect(bloomForRecipe({ cook_count: 6, last_cooked_at: new Date().toISOString() })).toBe('blooming')
  })
  it('is normal with a few cooks', () => {
    expect(bloomForRecipe({ cook_count: 1, last_cooked_at: new Date().toISOString() })).toBe('normal')
  })
  it('is dormant when cooked long ago', () => {
    const old = new Date('2000-01-01').toISOString()
    expect(bloomForRecipe({ cook_count: 3, last_cooked_at: old })).toBe('dormant')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/growthState.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `frontend/src/lib/growthState.js`**

```js
// Derives the seed→tree growth state + bloom layer for a recipe.
// Reads defensively: works whether the API returns counts or arrays.
// See docs/superpowers/specs/2026-07-07-lineage-capture-flows-design.md §2.2.

const BLOOM_RECENT_DAYS = 30
const BLOOM_MANY_COOKS = 5

export function ownerCookCount(recipe) {
  if (typeof recipe.owner_cook_count === 'number') return recipe.owner_cook_count
  if (Array.isArray(recipe.cook_events) && recipe.user_id != null) {
    return recipe.cook_events.filter((e) => e.user_id === recipe.user_id).length
  }
  return 0
}

function childCount(recipe) {
  if (typeof recipe.child_count === 'number') return recipe.child_count
  if (Array.isArray(recipe.children)) return recipe.children.length
  return 0
}

function totalCookCount(recipe) {
  if (typeof recipe.cook_count === 'number') return recipe.cook_count
  if (Array.isArray(recipe.cook_events)) return recipe.cook_events.length
  return 0
}

export function stateForRecipe(recipe) {
  const children = childCount(recipe)
  if (children > 0) {
    return recipe.has_grandchildren ? 'tree' : 'sapling'
  }
  return totalCookCount(recipe) > 0 ? 'sprout' : 'seed'
}

export function bloomForRecipe(recipe) {
  const cooks = totalCookCount(recipe)
  if (cooks === 0 || !recipe.last_cooked_at) return 'normal'
  const daysSince = (Date.now() - new Date(recipe.last_cooked_at).getTime()) / 86400000
  if (daysSince > 180) return 'dormant'
  if (cooks >= BLOOM_MANY_COOKS && daysSince <= BLOOM_RECENT_DAYS) return 'blooming'
  return 'normal'
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/growthState.test.js`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/growthState.js frontend/src/lib/growthState.test.js
git commit -m "feat: growth-state logic (seed/sprout/sapling/tree + bloom)"
```

---

## Task 3: Lineage payload builders (`lib/lineagePayload.js`)

**Files:**
- Create: `frontend/src/lib/lineagePayload.js`, `frontend/src/lib/lineagePayload.test.js`

**Interfaces:**
- Produces:
  - `buildOriginPayload({ name, place, year, memory })` → `{ name, place, year, memory }` with empty→null, or `null` if no name (self-authored path sends no origin).
  - `buildRemixInitialValues(parentRecipe)` → `{ name, servings, cuisine, ingredients, steps, source, notes, story }` where `story` is `''` (remixer writes own), `notes` is copied from parent, `source` copied, ingredients/steps deep-copied from parent for editing.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest'
import { buildOriginPayload, buildRemixInitialValues } from './lineagePayload'

describe('buildOriginPayload', () => {
  it('returns null when no name (self-authored root)', () => {
    expect(buildOriginPayload({ name: '' })).toBeNull()
  })
  it('maps fields and nulls empties', () => {
    expect(buildOriginPayload({ name: 'Grandma Yoko', place: '', year: '1960s', memory: '' }))
      .toEqual({ name: 'Grandma Yoko', place: null, year: '1960s', memory: null })
  })
})

describe('buildRemixInitialValues', () => {
  const parent = {
    name: "Grandma's Adobo", servings: 4, cuisine: 'Filipino',
    source: 'Lola', notes: 'Use cane vinegar', story: 'Her Sunday dish',
    ingredients: [{ name: 'butter', quantity_text: '2 tbsp' }],
    steps: [{ content: 'Brown the meat', position: 1 }],
  }
  it('carries source and notes, drops story', () => {
    const v = buildRemixInitialValues(parent)
    expect(v.source).toBe('Lola')
    expect(v.notes).toBe('Use cane vinegar')
    expect(v.story).toBe('')
  })
  it('deep-copies ingredients/steps (edits do not mutate parent)', () => {
    const v = buildRemixInitialValues(parent)
    v.ingredients[0].name = 'lard'
    expect(parent.ingredients[0].name).toBe('butter')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/lineagePayload.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `frontend/src/lib/lineagePayload.js`**

```js
// Pure builders for lineage request bodies / form seeds. Keeps components thin.

const clean = (v) => (v && String(v).trim() ? String(v).trim() : null)

export function buildOriginPayload({ name, place, year, memory }) {
  if (!name || !name.trim()) return null // self-authored root: no origin
  return { name: name.trim(), place: clean(place), year: clean(year), memory: clean(memory) }
}

export function buildRemixInitialValues(parent) {
  return {
    name: parent.name || '',
    servings: parent.servings ?? '',
    cuisine: parent.cuisine || '',
    source: parent.source || '',
    notes: parent.notes || '',   // pre-filled, editable
    story: '',                   // remixer writes their own
    ingredients: (parent.ingredients || []).map((i) => ({ ...i })),
    steps: (parent.steps || []).map((s) => ({ ...s })),
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/lineagePayload.test.js`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/lineagePayload.js frontend/src/lib/lineagePayload.test.js
git commit -m "feat: lineage payload/seed builders (origin + remix inheritance)"
```

---

## Task 4: Lineage API module (`api/lineage.js`)

**Files:**
- Create: `frontend/src/api/lineage.js`, `frontend/src/api/lineage.test.js`

**Interfaces:**
- Consumes: the default axios instance from `./client`.
- Produces:
  - `plantRecipe(payload)` → `client.post('/recipes', payload)` (payload may include `origin`).
  - `remixRecipe(id, { ingredients, steps, prompt_answer })` → `client.post('/recipes/${id}/remix', ...)`.
  - `cookRecipe(id, { photo_url, note } = {})` → `client.post('/recipes/${id}/cook', ...)`.
  - `handoffRecipe(id, { to_email, to_user_id, note })` → `client.post('/recipes/${id}/handoff', ...)`.
  - `getLineage(id)` → `client.get('/recipes/${id}/lineage')`.
  - Each returns the axios promise; callers use `.data`.

- [ ] **Step 1: Write the failing test (mock the client)**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('./client', () => ({ default: { post: vi.fn(() => Promise.resolve({ data: {} })), get: vi.fn(() => Promise.resolve({ data: {} })) } }))
import client from './client'
import { plantRecipe, remixRecipe, cookRecipe, handoffRecipe, getLineage } from './lineage'

beforeEach(() => { client.post.mockClear(); client.get.mockClear() })

describe('lineage api', () => {
  it('plantRecipe posts to /recipes', () => {
    plantRecipe({ name: 'x' })
    expect(client.post).toHaveBeenCalledWith('/recipes', { name: 'x' })
  })
  it('remixRecipe posts to the remix route', () => {
    remixRecipe(12, { ingredients: [], steps: [], prompt_answer: 'why' })
    expect(client.post).toHaveBeenCalledWith('/recipes/12/remix', { ingredients: [], steps: [], prompt_answer: 'why' })
  })
  it('cookRecipe posts to the cook route with default body', () => {
    cookRecipe(5)
    expect(client.post).toHaveBeenCalledWith('/recipes/5/cook', {})
  })
  it('handoffRecipe posts recipient + note', () => {
    handoffRecipe(5, { to_email: 'a@b.com', note: 'hi' })
    expect(client.post).toHaveBeenCalledWith('/recipes/5/handoff', { to_email: 'a@b.com', note: 'hi' })
  })
  it('getLineage gets the lineage route', () => {
    getLineage(9)
    expect(client.get).toHaveBeenCalledWith('/recipes/9/lineage')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/api/lineage.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `frontend/src/api/lineage.js`**

```js
import client from './client'

export const plantRecipe = (payload) => client.post('/recipes', payload)
export const remixRecipe = (id, body) => client.post(`/recipes/${id}/remix`, body)
export const cookRecipe = (id, body = {}) => client.post(`/recipes/${id}/cook`, body)
export const handoffRecipe = (id, body) => client.post(`/recipes/${id}/handoff`, body)
export const getLineage = (id) => client.get(`/recipes/${id}/lineage`)
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/api/lineage.test.js`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/lineage.js frontend/src/api/lineage.test.js
git commit -m "feat: lineage API module (plant/remix/cook/handoff/lineage)"
```

---

## Task 5: `GrowthMark` component (the seed→tree SVG primitive)

**Files:**
- Create: `frontend/src/components/GrowthMark.jsx`, `frontend/src/components/GrowthMark.test.jsx`

**Interfaces:**
- Consumes: nothing (self-contained SVG). Optionally `stateForRecipe` at call sites.
- Produces: `<GrowthMark state="seed|sprout|sapling|tree" bloom="dormant|normal|blooming" size={20} className="" />`. Renders an inline `<svg>` with a `data-growth-state` attribute (for tests) and an accessible `<title>`. Provisional non-coffee marks (herb-green sprout cue distinguishes seed from a bean).

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import GrowthMark from './GrowthMark'

describe('GrowthMark', () => {
  it('renders the requested state with an accessible title', () => {
    const { container, getByTitle } = render(<GrowthMark state="sprout" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-growth-state', 'sprout')
    expect(getByTitle(/sprout/i)).toBeInTheDocument()
  })
  it('falls back to seed for an unknown state', () => {
    const { container } = render(<GrowthMark state="bogus" />)
    expect(container.querySelector('svg')).toHaveAttribute('data-growth-state', 'seed')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/GrowthMark.test.jsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `frontend/src/components/GrowthMark.jsx`**

```jsx
// The seed→tree growth mark. Provisional botanical SVGs (final art = task #10).
// A herb-green shoot distinguishes the seed from a coffee bean.
const TERRA = '#BD5A2C'
const HERB = '#6F8A4D'
const INK = '#3A2A1C'

const STATES = {
  seed: (
    <>
      <ellipse cx="12" cy="14" rx="5" ry="7" fill={TERRA} />
      <path d="M12 7c-1 3 0 5 0 5s1-2 0-5z" fill={HERB} />
    </>
  ),
  sprout: (
    <>
      <path d="M12 21v-8" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 15c-3-.5-5-2.5-5-5.5 3 .5 5 2.5 5 5.5z" fill={HERB} />
      <path d="M12 13c2.4-.4 4-2 4-4.4-2.4.4-4 2-4 4.4z" fill={HERB} opacity=".75" />
    </>
  ),
  sapling: (
    <>
      <path d="M12 21v-9" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 14l-4-3M12 12l4-3" stroke={INK} strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="11" r="2.4" fill={HERB} />
      <circle cx="16" cy="9" r="2.4" fill={HERB} />
      <circle cx="12" cy="7" r="2.6" fill={HERB} />
    </>
  ),
  tree: (
    <>
      <path d="M12 21v-7" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 16l-4-3M12 15l4-3M12 12l-3-3M12 11l3-2" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="12" cy="7" r="5.5" fill={HERB} />
      <circle cx="7" cy="10" r="3" fill={HERB} />
      <circle cx="17" cy="10" r="3" fill={HERB} />
    </>
  ),
}

export default function GrowthMark({ state = 'seed', bloom = 'normal', size = 20, className = '' }) {
  const key = STATES[state] ? state : 'seed'
  const opacity = bloom === 'dormant' ? 0.5 : 1
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} className={className}
      data-growth-state={key} style={{ opacity }} role="img"
    >
      <title>{`${key} — recipe growth state`}</title>
      {STATES[key]}
    </svg>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/components/GrowthMark.test.jsx`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/GrowthMark.jsx frontend/src/components/GrowthMark.test.jsx
git commit -m "feat: GrowthMark seed/sprout/sapling/tree SVG primitive"
```

---

## Task 5b: Backend — surface growth fields on `RecipeResponse`

The growth badges/marks need per-recipe counts that the API does **not** currently
return. `RecipeResponse` (the `GET /recipes` list and `GET /recipes/{id}` shape) has
no `cook_count`, `child_count`, `owner_cook_count`, `last_cooked_at`, or
`has_grandchildren`. Without these, every `GrowthMark` renders as `seed`. Add them
as computed response fields. (This is the one backend change in this sub-project.)

**Files:**
- Modify: `app/schemas/recipe.py` (add fields to `RecipeResponse`)
- Modify: `app/routers/recipes.py` (populate the fields in `get_recipe`, `list_recipes`, `browse_recipes`)
- Test: `tests/test_growth_fields.py`

**Interfaces:**
- Produces: `RecipeResponse` gains `cook_count: int = 0`, `owner_cook_count: int = 0`, `child_count: int = 0`, `has_grandchildren: bool = False`, `last_cooked_at: Optional[datetime] = None`. Consumed by the frontend growth helpers (Task 2), which read these exact names.

- [ ] **Step 1: Write the failing test**

```python
def test_recipe_response_includes_growth_fields(client, make_user, db_session):
    from app.models.recipe import Recipe
    from app.models.cook_event import CookEvent
    owner, headers = make_user()
    # a root with one child and two cooks (one by owner)
    root = Recipe(user_id=owner.id, name="Adobo", lineage_relation="root")
    db_session.add(root); db_session.commit(); db_session.refresh(root)
    child = Recipe(user_id=owner.id, name="Adobo mine", lineage_relation="remixed", parent_recipe_id=root.id)
    other, _ = make_user()
    db_session.add(child)
    db_session.add(CookEvent(recipe_id=root.id, user_id=owner.id))
    db_session.add(CookEvent(recipe_id=root.id, user_id=other.id))
    db_session.commit()

    body = client.get(f"/recipes/{root.id}", headers=headers).json()
    assert body["cook_count"] == 2
    assert body["owner_cook_count"] == 1
    assert body["child_count"] == 1
    assert body["has_grandchildren"] is False
    assert body["last_cooked_at"] is not None
```

- [ ] **Step 2: Run to verify failure**

Run (from repo root): `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_growth_fields.py -v`
Expected: FAIL (`KeyError`/missing fields).

- [ ] **Step 3: Add the fields to `RecipeResponse`**

In `app/schemas/recipe.py`, add to `RecipeResponse` (after `lineage_relation`):

```python
    cook_count: int = 0
    owner_cook_count: int = 0
    child_count: int = 0
    has_grandchildren: bool = False
    last_cooked_at: Optional[datetime] = None
```

- [ ] **Step 4: Populate them in the read endpoints**

Add a helper near the top of `app/routers/recipes.py` (after imports):

```python
from sqlalchemy import func

def _attach_growth_fields(recipe, db):
    """Compute the growth-state counts the frontend reads. Small N per request."""
    cooks = db.query(CookEvent).filter(CookEvent.recipe_id == recipe.id).all()
    recipe.cook_count = len(cooks)
    recipe.owner_cook_count = sum(1 for c in cooks if c.user_id == recipe.user_id)
    recipe.last_cooked_at = max((c.cooked_at for c in cooks), default=None)
    child_ids = [r.id for r in db.query(Recipe.id).filter(
        Recipe.parent_recipe_id == recipe.id, Recipe.deleted_at == None
    ).all()]
    recipe.child_count = len(child_ids)
    recipe.has_grandchildren = bool(child_ids) and db.query(Recipe.id).filter(
        Recipe.parent_recipe_id.in_(child_ids), Recipe.deleted_at == None
    ).first() is not None
    return recipe
```

Then call `_attach_growth_fields(recipe, db)` on the recipe(s) returned by
`get_recipe` (single) and map over the lists in `list_recipes` and
`browse_recipes` before returning. Because `RecipeResponse` uses
`from_attributes`, setting these attributes on the ORM instance flows into the
response. Example for `get_recipe` (before `return recipe`): `_attach_growth_fields(recipe, db)`.
For the list endpoints: `for r in recipes: _attach_growth_fields(r, db)` before return.

- [ ] **Step 5: Run to verify pass**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_growth_fields.py -v`
Expected: passed.

- [ ] **Step 6: Run the full backend suite (no regressions)**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q`
Expected: all passed (prior 25 + new).

- [ ] **Step 7: Commit**

```bash
git add app/schemas/recipe.py app/routers/recipes.py tests/test_growth_fields.py
git commit -m "feat: surface growth-state fields (cook/child counts) on RecipeResponse"
```

---

## Task 6: Growth badge on `RecipeCard`

**Files:**
- Modify: `frontend/src/components/RecipeCard.jsx`
- Create: `frontend/src/components/RecipeCard.test.jsx`

**Interfaces:**
- Consumes: `GrowthMark`, `stateForRecipe`, `bloomForRecipe`.
- Produces: `RecipeCard` renders a `GrowthMark` badge (top-right of the photo area) derived from the recipe. No prop changes to callers.

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import RecipeCard from './RecipeCard'

vi.mock('./CoverImage', () => ({ default: () => <div data-testid="cover" /> }))

describe('RecipeCard growth badge', () => {
  it('shows a sapling badge when the recipe has children', () => {
    const recipe = { id: 1, name: 'Adobo', cook_count: 2, child_count: 1 }
    const { container } = render(<RecipeCard recipe={recipe} onClick={() => {}} />)
    expect(container.querySelector('[data-growth-state="sapling"]')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/RecipeCard.test.jsx`
Expected: FAIL (no growth badge yet).

- [ ] **Step 3: Add the badge to `RecipeCard.jsx`**

Add imports at top:

```jsx
import GrowthMark from './GrowthMark'
import { stateForRecipe, bloomForRecipe } from '../lib/growthState'
```

Inside the `relative` photo wrapper (the `<div className="relative">` that holds `CoverImage` + the cuisine stamp), add the badge as the last child:

```jsx
        <span className="absolute top-[7px] right-[7px] bg-[rgba(247,238,221,0.94)] rounded-full p-[3px] shadow-[0_1px_3px_rgba(90,60,30,0.2)]">
          <GrowthMark
            state={stateForRecipe(recipe)}
            bloom={bloomForRecipe(recipe)}
            size={16}
          />
        </span>
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/components/RecipeCard.test.jsx`
Expected: passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RecipeCard.jsx frontend/src/components/RecipeCard.test.jsx
git commit -m "feat: growth-state badge on RecipeCard"
```

---

## Task 7: `HandoffInvite` component

**Files:**
- Create: `frontend/src/components/HandoffInvite.jsx`, `frontend/src/components/HandoffInvite.test.jsx`

**Interfaces:**
- Consumes: `handoffRecipe` from `api/lineage`.
- Produces: `<HandoffInvite recipeId={id} onSent={(handoff)=>...} onSkip={()=>...} />`. An email input + a note input + a "Pass it on" button (calls `handoffRecipe`, then `onSent`), and a "Skip for now" affordance (`onSkip`). Button disabled until an email is entered. Shows an error on failure.

- [ ] **Step 1: Write the failing test**

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
    await userEvent.type(screen.getByPlaceholderText(/email/i), 'mom@example.com')
    await userEvent.type(screen.getByPlaceholderText(/add the part/i), 'your adobo')
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
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/HandoffInvite.test.jsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `frontend/src/components/HandoffInvite.jsx`**

```jsx
import { useState } from 'react'
import { handoffRecipe } from '../api/lineage'

// "Who else should have this seed?" — the growth-engine invite (spec §3.1/§3.4).
export default function HandoffInvite({ recipeId, onSent, onSkip }) {
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

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
        Hand it to someone who'll grow it — they can add the part you always forget.
      </p>
      <input
        type="email" placeholder="Their email" value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="field mb-2.5"
      />
      <input
        type="text" placeholder="Add the part they always forget… (optional)" value={note}
        onChange={(e) => setNote(e.target.value)}
        className="field mb-3"
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

(`.field` and `.btn-primary` are existing shared classes in `index.css`.)

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/components/HandoffInvite.test.jsx`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/HandoffInvite.jsx frontend/src/components/HandoffInvite.test.jsx
git commit -m "feat: HandoffInvite component (pass a recipe to someone)"
```

---

## Task 8: `PlantRecipe` stepped flow

**Files:**
- Create: `frontend/src/pages/PlantRecipe.jsx`, `frontend/src/pages/PlantRecipe.test.jsx`
- Modify: `frontend/src/App.jsx` (route), `frontend/src/pages/AddRecipe.jsx` (redirect to `/plant`)

**Interfaces:**
- Consumes: `buildOriginPayload` (Task 3), `plantRecipe` (Task 4), `RecipeForm` (existing, `mode`/`initialValues`/`onSubmit`), `HandoffInvite` (Task 7), `GrowthMark` (Task 5).
- Produces: route `/plant` rendering a step machine with `step` in `doorway | origin | form | planted | handoff`. Doorway sets `origin` mode (`ancestor` | `mine`); origin step captures fields; form step renders `RecipeForm`; on submit calls `plantRecipe` with the assembled payload (origin included iff ancestor path; the `mine` memory maps to `story`); planted beat shows the seed + name; handoff renders `HandoffInvite`.

- [ ] **Step 1: Write the failing test (doorway → mine → form path)**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api/lineage', () => ({ plantRecipe: vi.fn(() => Promise.resolve({ data: { id: 42, name: 'Congee' } })) }))
// RecipeForm is heavy; stub it to immediately submit a minimal payload.
vi.mock('../components/RecipeForm', () => ({
  default: ({ onSubmit }) => (
    <button onClick={() => onSubmit({ name: 'Congee', ingredients: [], steps: [] })}>submit-form</button>
  ),
}))
import { plantRecipe } from '../api/lineage'
import PlantRecipe from './PlantRecipe'

beforeEach(() => plantRecipe.mockClear())

describe('PlantRecipe', () => {
  it('walks doorway → mine → form → planted, sending story not origin', async () => {
    render(<MemoryRouter><PlantRecipe /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: /a seed of your own/i }))
    await userEvent.type(screen.getByPlaceholderText(/what made this yours/i), 'I riffed on it for years')
    await userEvent.click(screen.getByRole('button', { name: /continue to the recipe/i }))
    await userEvent.click(screen.getByRole('button', { name: /submit-form/i }))
    expect(plantRecipe).toHaveBeenCalled()
    const payload = plantRecipe.mock.calls[0][0]
    expect(payload.origin ?? null).toBeNull()
    expect(payload.story).toBe('I riffed on it for years')
    expect(await screen.findByText(/is planted/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/pages/PlantRecipe.test.jsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `frontend/src/pages/PlantRecipe.jsx`**

```jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import RecipeForm from '../components/RecipeForm'
import HandoffInvite from '../components/HandoffInvite'
import GrowthMark from '../components/GrowthMark'
import { buildOriginPayload } from '../lib/lineagePayload'
import { plantRecipe } from '../api/lineage'

export default function PlantRecipe() {
  const navigate = useNavigate()
  const [step, setStep] = useState('doorway') // doorway|origin|form|planted|handoff
  const [originMode, setOriginMode] = useState(null) // 'ancestor'|'mine'
  const [origin, setOrigin] = useState({ name: '', place: '', year: '', memory: '' })
  const [selfMemory, setSelfMemory] = useState('')
  const [planted, setPlanted] = useState(null)

  function chooseDoor(mode) { setOriginMode(mode); setStep('origin') }

  async function handleFormSubmit(formPayload) {
    const payload = { ...formPayload }
    if (originMode === 'ancestor') {
      payload.origin = buildOriginPayload(origin)
    } else {
      payload.story = selfMemory.trim() || formPayload.story || null
    }
    const { data } = await plantRecipe(payload)
    setPlanted(data)
    setStep('planted')
  }

  if (step === 'doorway') {
    return (
      <div className="px-[18px] pt-8">
        <h1 className="font-serif font-black text-[28px] text-ink leading-tight">Where does this<br />recipe begin?</h1>
        <p className="font-serif italic text-[15px] text-ink-soft mt-2 mb-6">Every seed has a first hand that held it.</p>
        <button onClick={() => chooseDoor('ancestor')} className="block w-full text-left bg-card border border-line rounded-2xl p-4 mb-3 shadow-warm">
          <span className="font-serif font-semibold text-[17px] text-ink">A seed passed to you</span>
          <span className="block font-sans text-[12.5px] text-ink-soft mt-0.5">Someone taught you this. Honor them.</span>
        </button>
        <button onClick={() => chooseDoor('mine')} className="block w-full text-left bg-card border border-line rounded-2xl p-4 shadow-warm">
          <span className="font-serif font-semibold text-[17px] text-ink">A seed of your own</span>
          <span className="block font-sans text-[12.5px] text-ink-soft mt-0.5">You are the root of this one.</span>
        </button>
      </div>
    )
  }

  if (step === 'origin') {
    return (
      <div className="px-[18px] pt-8">
        {originMode === 'ancestor' ? (
          <>
            <h1 className="font-serif font-black text-[26px] text-ink leading-tight">Who taught you<br />this recipe?</h1>
            <p className="font-serif italic text-[14px] text-ink-soft mt-2 mb-5">They'll sit at the root of its tree.</p>
            <input className="field mb-2.5" placeholder="Their name" value={origin.name} onChange={(e) => setOrigin({ ...origin, name: e.target.value })} />
            <div className="flex gap-2.5 mb-2.5">
              <input className="field" placeholder="Place (optional)" value={origin.place} onChange={(e) => setOrigin({ ...origin, place: e.target.value })} />
              <input className="field" placeholder="Year (optional)" value={origin.year} onChange={(e) => setOrigin({ ...origin, year: e.target.value })} />
            </div>
            <textarea className="field resize-none mb-4" rows={3} placeholder="A memory of them & this dish (optional)" value={origin.memory} onChange={(e) => setOrigin({ ...origin, memory: e.target.value })} />
            <button className="btn-primary disabled:opacity-50" disabled={!origin.name.trim()} onClick={() => setStep('form')}>Continue to the recipe →</button>
          </>
        ) : (
          <>
            <h1 className="font-serif font-black text-[26px] text-ink leading-tight">This one starts<br />with you.</h1>
            <p className="font-serif italic text-[14px] text-ink-soft mt-2 mb-5">You're the root of this dish's tree.</p>
            <textarea className="field resize-none mb-4" rows={4} placeholder="What made this yours? (optional)" value={selfMemory} onChange={(e) => setSelfMemory(e.target.value)} />
            <button className="btn-primary" onClick={() => setStep('form')}>Continue to the recipe →</button>
          </>
        )}
      </div>
    )
  }

  if (step === 'form') {
    return <RecipeForm mode="add" onSubmit={handleFormSubmit} />
  }

  if (step === 'planted') {
    return (
      <div className="px-[18px] pt-12 text-center flex flex-col items-center">
        <GrowthMark state="seed" size={96} />
        <p className="font-sans text-[10px] font-semibold tracking-[0.18em] uppercase text-herb mt-5 mb-2">Seed sown</p>
        <h1 className="font-serif font-black italic text-[26px] text-ink leading-tight">{planted?.name} is planted.</h1>
        <p className="font-serif italic text-[14px] text-ink-soft mt-3 mb-8 max-w-[16rem]">It lives in your lineage now — the first node on a tree only you can start.</p>
        <button className="btn-primary" onClick={() => setStep('handoff')}>Pass it on →</button>
        <button className="mt-3 font-serif italic text-ink-soft text-sm" onClick={() => navigate('/my-recipes')}>Not now — take me to my kitchen</button>
      </div>
    )
  }

  // step === 'handoff'
  return (
    <HandoffInvite
      recipeId={planted.id}
      onSent={() => navigate(`/recipes/${planted.id}`)}
      onSkip={() => navigate(`/recipes/${planted.id}`)}
    />
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/pages/PlantRecipe.test.jsx`
Expected: passed.

- [ ] **Step 5: Wire the route and redirect old AddRecipe**

In `App.jsx`: import `PlantRecipe` and change the `/add` route element to `<PlantRecipe />` (keep `/add` as the path so `BottomNav`'s Add button still works; the stepped flow lives there now). Leave the `AddRecipe` file but repoint it as a safety redirect:

Replace `frontend/src/pages/AddRecipe.jsx` body with:

```jsx
import { Navigate } from 'react-router-dom'
// Superseded by the stepped PlantRecipe flow (spec §3.1).
export default function AddRecipe() {
  return <Navigate to="/add" replace />
}
```

(If `App.jsx` already routes `/add` → `PlantRecipe`, `AddRecipe.jsx` becomes unreferenced; deleting it is fine instead of the redirect. Confirm no other import references it via `grep -rn AddRecipe frontend/src`.)

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: all passed.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/PlantRecipe.jsx frontend/src/pages/PlantRecipe.test.jsx frontend/src/App.jsx frontend/src/pages/AddRecipe.jsx
git commit -m "feat: stepped PlantRecipe flow (doorway → origin → form → planted → handoff)"
```

---

## Task 9: `RemixRecipe` page (pre-filled editor + diff prompt)

**Files:**
- Create: `frontend/src/pages/RemixRecipe.jsx`, `frontend/src/pages/RemixRecipe.test.jsx`
- Modify: `frontend/src/App.jsx` (route `/recipes/:id/remix`)

**Interfaces:**
- Consumes: `buildRemixInitialValues` (Task 3), `remixRecipe` (Task 4), `RecipeForm` (existing).
- Produces: route `/recipes/:id/remix` that fetches the parent (`client.get('/recipes/:id')`), seeds `RecipeForm` with `buildRemixInitialValues(parent)`, shows a "branching from {author}" ribbon, and on submit calls `remixRecipe(id, { ingredients, steps, prompt_answer })` then navigates to the new child. `prompt_answer` is captured by a small prompt field shown above submit ("What makes yours yours?").

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../api/client', () => ({ default: { get: vi.fn(() => Promise.resolve({ data: { id: 1, name: 'Adobo', author_full_name: 'Yoko M.', ingredients: [], steps: [], source: 'Lola', notes: 'cane vinegar' } })) } }))
vi.mock('../api/lineage', () => ({ remixRecipe: vi.fn(() => Promise.resolve({ data: { id: 99 } })) }))
vi.mock('../components/RecipeForm', () => ({
  default: ({ onSubmit, initialValues }) => (
    <div>
      <span>notes:{initialValues.notes}</span>
      <button onClick={() => onSubmit({ ingredients: [{ name: 'lard', position: 1 }], steps: [] })}>submit-form</button>
    </div>
  ),
}))
import { remixRecipe } from '../api/lineage'
import RemixRecipe from './RemixRecipe'

beforeEach(() => remixRecipe.mockClear())

describe('RemixRecipe', () => {
  it('seeds notes from parent and remixes with the prompt answer', async () => {
    render(
      <MemoryRouter initialEntries={['/recipes/1/remix']}>
        <Routes><Route path="/recipes/:id/remix" element={<RemixRecipe />} /><Route path="/recipes/:id" element={<div>child page</div>} /></Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText(/notes:cane vinegar/)).toBeInTheDocument()
    expect(screen.getByText(/branching from Yoko M\./i)).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText(/what makes yours yours/i), 'Mom used lard')
    await userEvent.click(screen.getByRole('button', { name: /submit-form/i }))
    expect(remixRecipe).toHaveBeenCalledWith('1', { ingredients: [{ name: 'lard', position: 1 }], steps: [], prompt_answer: 'Mom used lard' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/pages/RemixRecipe.test.jsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `frontend/src/pages/RemixRecipe.jsx`**

```jsx
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import client from '../api/client'
import RecipeForm from '../components/RecipeForm'
import { buildRemixInitialValues } from '../lib/lineagePayload'
import { remixRecipe } from '../api/lineage'

export default function RemixRecipe() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [parent, setParent] = useState(null)
  const [error, setError] = useState('')
  const [promptAnswer, setPromptAnswer] = useState('')

  useEffect(() => {
    client.get(`/recipes/${id}`).then((res) => setParent(res.data)).catch(() => setError('Recipe not found'))
  }, [id])

  if (error) return <div className="p-6 text-center text-red-600">{error}</div>
  if (!parent) return <div className="p-6 text-center text-ink-soft">Loading…</div>

  async function handleSubmit(formPayload) {
    const { data } = await remixRecipe(id, {
      ingredients: formPayload.ingredients,
      steps: formPayload.steps,
      prompt_answer: promptAnswer.trim() || null,
    })
    navigate(`/recipes/${data.id}`)
  }

  return (
    <div>
      <div className="px-[18px] pt-6">
        <p className="font-sans text-[11px] uppercase tracking-[0.14em] text-terra">
          Branching from {parent.author_full_name || 'the original'}
        </p>
      </div>
      <RecipeForm
        mode="edit"
        initialValues={buildRemixInitialValues(parent)}
        submitLabel="Make it mine"
        beforeSubmitSlot={
          <div className="px-[18px]">
            <p className="section-label mb-1">What makes yours yours?</p>
            <input className="field mb-3" placeholder="What makes yours yours? e.g. Mom used lard" value={promptAnswer} onChange={(e) => setPromptAnswer(e.target.value)} />
          </div>
        }
        onSubmit={handleSubmit}
      />
    </div>
  )
}
```

Note: `RecipeForm` must accept optional `submitLabel` and `beforeSubmitSlot` props (Task 10 adds them; if implementing Task 9 first, add those two optional props to `RecipeForm` now — default `submitLabel` to the existing label, render `beforeSubmitSlot` just above the submit button).

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/pages/RemixRecipe.test.jsx`
Expected: passed.

- [ ] **Step 5: Wire the route in `App.jsx`**

Import `RemixRecipe`; add a protected route inside `Layout`:

```jsx
      <Route path="/recipes/:id/remix" element={<ProtectedRoute><Layout><RemixRecipe /></Layout></ProtectedRoute>} />
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/RemixRecipe.jsx frontend/src/pages/RemixRecipe.test.jsx frontend/src/App.jsx
git commit -m "feat: RemixRecipe page (pre-filled editor + diff prompt)"
```

---

## Task 10: `RecipeForm` — support `submitLabel` + `beforeSubmitSlot`

**Files:**
- Modify: `frontend/src/components/RecipeForm.jsx`
- Create: `frontend/src/components/RecipeForm.test.jsx`

**Interfaces:**
- Consumes: existing `RecipeForm` props (`mode`, `initialValues`, `onSubmit`).
- Produces: two new optional props — `submitLabel` (string; overrides the default add/edit button text) and `beforeSubmitSlot` (ReactNode; rendered just above the submit button). Backward compatible (both optional).

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import RecipeForm from './RecipeForm'

vi.mock('../api/client', () => ({ default: { post: vi.fn() } }))

describe('RecipeForm slots', () => {
  it('renders a custom submit label and beforeSubmitSlot', () => {
    render(<RecipeForm mode="edit" submitLabel="Make it mine" beforeSubmitSlot={<div>slot-here</div>} onSubmit={() => {}} />)
    expect(screen.getByText('slot-here')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /make it mine/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/RecipeForm.test.jsx`
Expected: FAIL (label/slot not supported).

- [ ] **Step 3: Add the props to `RecipeForm.jsx`**

Change the signature:

```jsx
export default function RecipeForm({ mode = 'add', initialValues = {}, onSubmit, submitLabel, beforeSubmitSlot = null }) {
```

Where the submit button label is computed (the existing `heading`/label logic near the top), make the button text prefer `submitLabel`:

```jsx
  const defaultSubmit = mode === 'edit' ? 'Save changes' : 'Keep this recipe'
  const submitText = submitLabel || defaultSubmit
```

Immediately before the submit `<button>` in the returned JSX, render the slot, and use `submitText`:

```jsx
        {beforeSubmitSlot}
        <button type="submit" disabled={loading} className="btn-primary mt-2">
          {loading ? 'Saving…' : submitText}
        </button>
```

(Match the existing button's exact classes/loading text already in the file; only add the slot line and swap the label to `submitText`.)

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/components/RecipeForm.test.jsx`
Expected: passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RecipeForm.jsx frontend/src/components/RecipeForm.test.jsx
git commit -m "feat: RecipeForm supports submitLabel + beforeSubmitSlot for remix"
```

---

## Task 11: RecipeDetail — cook / remix / pass-it-on actions + growth + cook beat

**Files:**
- Modify: `frontend/src/pages/RecipeDetail.jsx`
- Create: `frontend/src/pages/RecipeDetail.test.jsx`

**Interfaces:**
- Consumes: `cookRecipe` (Task 4), `GrowthMark` + `stateForRecipe`/`bloomForRecipe`, `HandoffInvite` (Task 7), navigation to `/recipes/:id/remix`.
- Produces: on `RecipeDetail`, (a) a growth mark near the title reflecting the recipe; (b) an **"I cooked this"** button that calls `cookRecipe`, then shows an inline "beat" ("That's N times you've kept this alive.") and updates the local cook count; (c) a **"Make it mine"** button → `/recipes/:id/remix`; (d) a **"Pass it on"** action opening `HandoffInvite` (owner only for handoff). Actions available per existing `isOwner` logic (cook + remix for anyone viewing; pass-it-on owner-only).

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api/client', () => ({ default: { get: vi.fn(() => Promise.resolve({ data: {
  id: 1, name: 'Adobo', user_id: 7, author_full_name: 'Yoko M.',
  ingredients: [], ingredient_sections: [], steps: [], cook_count: 3, child_count: 0,
} })) } }))
vi.mock('../api/lineage', () => ({ cookRecipe: vi.fn(() => Promise.resolve({ data: { cook_count: 4 } })) }))
beforeEach(() => { localStorage.setItem('issei_user', JSON.stringify({ id: 7 })) })
import { cookRecipe } from '../api/lineage'
import RecipeDetail from './RecipeDetail'

describe('RecipeDetail cook action', () => {
  it('cooks and shows the growth beat', async () => {
    render(<MemoryRouter><RecipeDetail /></MemoryRouter>)
    const btn = await screen.findByRole('button', { name: /cooked this/i })
    await userEvent.click(btn)
    expect(cookRecipe).toHaveBeenCalledWith('1', {})
    expect(await screen.findByText(/4 times/i)).toBeInTheDocument()
  })
})
```

(Note: `useParams` needs a route; wrap with a `Routes`/`Route` on `/recipes/:id` if the component reads `id` — mirror Task 9's harness. Adjust the render wrapper to provide `:id=1`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/pages/RecipeDetail.test.jsx`
Expected: FAIL (no cook button yet).

- [ ] **Step 3: Add the actions to `RecipeDetail.jsx`**

Add imports:

```jsx
import { cookRecipe } from '../api/lineage'
import GrowthMark from '../components/GrowthMark'
import HandoffInvite from '../components/HandoffInvite'
import { stateForRecipe, bloomForRecipe } from '../lib/growthState'
```

Add state near the top of the component:

```jsx
  const [cookCount, setCookCount] = useState(null)
  const [cookBeat, setCookBeat] = useState('')
  const [showHandoff, setShowHandoff] = useState(false)

  async function handleCook() {
    try {
      const { data } = await cookRecipe(id)
      setCookCount(data.cook_count)
      setCookBeat(`That's ${data.cook_count} ${data.cook_count === 1 ? 'time' : 'times'} you've kept this alive.`)
    } catch { /* non-fatal; leave UI as-is */ }
  }
```

In the JSX, near the title row, render the growth mark:

```jsx
        <GrowthMark state={stateForRecipe(recipe)} bloom={bloomForRecipe(recipe)} size={22} className="inline-block align-middle ml-2" />
```

Add an actions block (place after the meta row, before About):

```jsx
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={handleCook} className="btn-primary !w-auto px-5">I cooked this</button>
          <button onClick={() => navigate(`/recipes/${recipe.id}/remix`)} className="px-5 py-3 rounded-[10px] border border-terra text-terra font-serif font-semibold text-sm">Make it mine</button>
          {isOwner && (
            <button onClick={() => setShowHandoff(true)} className="px-5 py-3 rounded-[10px] border border-line text-ink-soft font-serif text-sm">Pass it on</button>
          )}
        </div>
        {cookBeat && <p className="font-serif italic text-herb text-sm mt-3">{cookBeat}</p>}
        {showHandoff && (
          <div className="mt-4 border-t border-line pt-4">
            <HandoffInvite recipeId={recipe.id} onSent={() => setShowHandoff(false)} onSkip={() => setShowHandoff(false)} />
          </div>
        )}
```

(`useState` is already imported in this file.)

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/pages/RecipeDetail.test.jsx`
Expected: passed.

- [ ] **Step 5: Run the whole frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all passed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/RecipeDetail.jsx frontend/src/pages/RecipeDetail.test.jsx
git commit -m "feat: RecipeDetail cook/remix/handoff actions + growth mark + cook beat"
```

---

## Task 12: Visual verification loop (build + drive + screenshot vs. mockups)

This sub-project debuts the identity; unit tests can't catch visual regressions. Verify the real app against the approved mockups.

**Files:**
- Create: `frontend/tests/visual/capture-flows.mjs` (Playwright driver; not committed to prod bundle — lives under `tests/`)

**Interfaces:**
- Consumes: a running isolated backend (throwaway SQLite, seeded) + the Vite dev server (as done in prior sessions), Playwright (installed locally).
- Produces: screenshots of the plant doorway, both origin screens, the planted beat, the handoff invite, a recipe detail with cook/remix actions + growth mark, and a card grid showing growth badges — for human comparison to the mockups in `.superpowers/brainstorm/`.

- [ ] **Step 1: Production build must pass**

Run: `cd frontend && npx vite build`
Expected: build succeeds, no unresolved imports (catches any missing wiring across Tasks 5–11).

- [ ] **Step 2: Stand up an isolated demo backend + seed**

Reuse the prior-session approach (documented in the repo's brainstorm/job history): a throwaway SQLite DB on a separate port, seeded with a few recipes (some with children/cooks so growth states vary), the app's real `hash_password`, env vars overriding `.env`. Point Vite at it via `VITE_API_URL`. (This is operational, not a code deliverable — no commit.)

- [ ] **Step 3: Drive the flows with Playwright and screenshot**

Create `frontend/tests/visual/capture-flows.mjs` that logs in, then visits `/add` (plant doorway), clicks each doorway, screenshots the origin screens, completes a plant, screenshots the planted beat + handoff, opens a recipe, screenshots the cook/remix actions + growth mark, and screenshots the kitchen grid (growth badges). Save PNGs to the job temp dir.

- [ ] **Step 4: Look at the screenshots**

Open each PNG and compare to the approved mockups (`plant-designs`, `seed-tree-identity`, `capture-flows` in `.superpowers/brainstorm/`). Confirm: doorways read as designed, growth marks render (and the seed does NOT look like a coffee bean in context), the planted beat + handoff match, cook beat appears, detail actions present. Note any visual gaps.

- [ ] **Step 5: Fix visual gaps, re-verify**

For any mismatch, adjust the component styles and re-run Steps 1–4. (No new behavior — visual polish only.)

- [ ] **Step 6: Tear down demo servers; commit the driver**

```bash
git add frontend/tests/visual/capture-flows.mjs
git commit -m "test: Playwright visual-verification driver for capture flows"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** motif system + growth states (Tasks 5, 6, GrowthMark + badge); growth rule incl. owner cooks (Task 2 `ownerCookCount`); plant→handoff (Tasks 7, 8); remix + inheritance carry/skip (Tasks 3, 9, 10); cook + beat + owner-notify intent copy (Task 11); API wiring (Task 4); visual verification (Task 12). Deferred by spec and NOT in this plan: notification delivery, kitchen-as-garden full reframe, memory resurfacing, lineage collision, handoff accept/claim, final seed art (task #10), zoomed-out tree viz (sub-project 3).
- **Growth-rule note:** thresholds (BLOOM_RECENT_DAYS, dormant at 180d, BLOOM_MANY_COOKS) are tunable knobs per spec; the state ordering is what's locked.
- **`RecipeForm` coupling + task ordering:** **Execute Task 10 BEFORE Task 9** — Task 10 adds/tests the `submitLabel`+`beforeSubmitSlot` props that Task 9's `RemixRecipe` depends on. (Task numbers are logical, not a strict order here; the executor should reorder 10 before 9.) Likewise **Task 5b before Tasks 6 & 11.** All other tasks are in dependency order.
- **`GET /recipes/{id}` shape:** confirmed the current `RecipeResponse` does NOT return the growth fields — **Task 5b adds them** (`cook_count`, `owner_cook_count`, `child_count`, `has_grandchildren`, `last_cooked_at`). Task 5b MUST run before Tasks 6 and 11 (badge + detail consume the fields) or badges render all-seed. The frontend helpers still read defensively (safe defaults) so the frontend tests pass regardless, but the live app needs 5b for real growth states. Task 5b is the only backend change in this sub-project.
