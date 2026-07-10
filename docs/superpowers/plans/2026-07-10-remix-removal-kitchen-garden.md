# Remix Removal + Kitchen-as-Garden Implementation Plan (Sub-Project 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove remixing from the v1 product surface (spec §0.1) and turn the Kitchen into a "garden" — recipe-plants grouped into growth bands that pull the user to tend the ones that need love (spec §6).

**Architecture:** Frontend-only. Two independent halves. **(A) Remix removal:** delete the two user-facing remix touchpoints — the "Make it mine" button on RecipeDetail and the `/recipes/:id/remix` route in App.jsx — while leaving `RemixRecipe.jsx`, `buildRemixInitialValues`, `remixRecipe`, and the entire backend endpoint DORMANT on disk (the exact pattern of the already-unrouted `AddRecipe.jsx`), so remix is a cheap UI revival later, not a re-architecture. **(B) Kitchen-as-garden:** a pure `gardenBands(recipes)` helper groups a recipe list into three ordered stage-bands ("Needs tending" = seed/sprout, "Growing" = sapling, "Thriving" = tree); `MyRecipes` renders each non-empty band under a warm header, and `RecipeCard` shows a larger, more legible plant.

**Tech Stack:** React 18, Vite 5, Tailwind 3, React Router 6, Vitest + React Testing Library.

## Global Constraints

- **Remix is CUT from v1, not deleted (spec §0.1):** remove only the user-facing UI exposure (button + route). Do NOT delete `RemixRecipe.jsx`, `frontend/src/lib/lineagePayload.js`'s `buildRemixInitialValues`, `remixRecipe` in `api/lineage.js`, or any backend remix endpoint/model. They stay dormant and revivable. Keep their existing tests passing (`RemixRecipe.test.jsx`, `lineagePayload.test.js`) — do not modify them.
- **The `parent_recipe_id` FK and remix backend stay untouched** (spec §0.1 "reversible safeguard").
- **No new required fields, no backend changes, no migrations.**
- **Growth is the source of truth via `lib/growth.js`:** band membership derives from `stageForRecipe(recipe)` (server-first). Do not duplicate or re-derive growth thresholds. Stage values are exactly `'seed' | 'sprout' | 'sapling' | 'tree'`.
- **Tailwind design tokens only** — `ink`, `ink-soft`, `herb`, `terra`, `line`, `card`, `paper`, and font families `font-serif`/`font-sans`/`font-hand`. No raw hex beyond values already present in the file being edited. No new tokens.
- **Typographic punctuation** in user-facing copy (curly quotes/apostrophes, em-dash), matching surrounding files.
- **Tests:** Vitest + RTL, colocated (`Foo.jsx` → `Foo.test.jsx`, `foo.js` → `foo.test.js`). Run from `frontend/`. On this Windows shell prefix node with `export PATH="$PATH:/c/Program Files/nodejs"`. Test files are `.jsx`/`.js` — use exact paths.

---

## Reference: current state (do not re-derive)

- **Remix touchpoints (exactly two, user-facing):**
  - `frontend/src/pages/RecipeDetail.jsx:176` — a `<button onClick={() => navigate(\`/recipes/${recipe.id}/remix\`)}>Make it mine</button>` in the actions row (alongside "I cooked this" and, for owners, "Pass it on").
  - `frontend/src/App.jsx:11` (import `RemixRecipe`) + `:68-75` (the `<Route path="/recipes/:id/remix">`).
- **Dormant-but-unrouted precedent:** `frontend/src/pages/AddRecipe.jsx` exists on disk and has zero references in `App.jsx` (`/add` maps to `PlantRecipe`). This is the exact pattern for keeping `RemixRecipe.jsx` around unrouted.
- **Growth:** `stageForRecipe(recipe)` in `frontend/src/lib/growth.js` returns `'seed' | 'sprout' | 'sapling' | 'tree'` (server value `recipe.growth_stage` first, else a client fallback). `vitalityForRecipe(recipe)` returns `'bare' | 'blooming' | 'fruiting'`.
- **Kitchen:** `frontend/src/pages/MyRecipes.jsx` fetches `GET /recipes`, filters by search, and renders a flat `grid grid-cols-2` of `<RecipeCard variant="grid">`.
- **Card:** `frontend/src/components/RecipeCard.jsx` renders the plant at `size={22}` in a top-right badge on the cover photo.
- **Tests that must keep passing untouched:** `RemixRecipe.test.jsx`, `lineagePayload.test.js`. `MyRecipes.test.jsx` mocks `RecipeCard` and asserts the header + "shared with you" link (will need one added assertion, not a rewrite). `RecipeCard.test.jsx` (1 test).

---

## File Structure

- **Modify** `frontend/src/pages/RecipeDetail.jsx` — remove the "Make it mine" button (Task 1).
- **Modify** `frontend/src/App.jsx` — remove the `RemixRecipe` import + `/recipes/:id/remix` route (Task 1).
- **Create** `frontend/src/lib/gardenBands.js` — `gardenBands(recipes)` pure grouping helper (Task 2).
- **Create** `frontend/src/lib/gardenBands.test.js` — its unit tests (Task 2).
- **Modify** `frontend/src/components/RecipeCard.jsx` — larger, more legible plant (Task 3).
- **Modify** `frontend/src/components/RecipeCard.test.jsx` — assert the plant size (Task 3).
- **Modify** `frontend/src/pages/MyRecipes.jsx` — render the garden bands (Task 4).
- **Modify** `frontend/src/pages/MyRecipes.test.jsx` — add a band-rendering assertion (Task 4).
- **Modify** `ARCHITECTURE.md` — document remix-cut + Kitchen-as-garden (Task 5).

---

### Task 1: Remove the remix surface (button + route)

Remove the two user-facing remix touchpoints, leaving all remix code dormant on disk.

**Files:**
- Modify: `frontend/src/pages/RecipeDetail.jsx:176`
- Modify: `frontend/src/App.jsx` (import line 11; route lines ~68-75)
- Test: `frontend/src/pages/RecipeDetail.test.jsx` (add a negative assertion)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. This is pure removal.

- [ ] **Step 1: Write the failing test — the remix button is gone**

In `frontend/src/pages/RecipeDetail.test.jsx`, find the test that renders the recipe as a viewer/owner and add an assertion that no "make it mine" control exists. If there is an existing render in a test, add this assertion there; otherwise add a focused test. Use this test (append it inside the existing top-level `describe`, adapting the mock setup already used in the file — the file already mocks `../api/client` and renders `<RecipeDetail>` inside a `MemoryRouter`; mirror the existing pattern):

```jsx
it('does not offer remix ("make it mine") — remix is cut from v1', async () => {
  // (mirror the file's existing render+mock setup for a viewable recipe)
  expect(await screen.findByRole('button', { name: /i cooked this/i })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /make it mine/i })).not.toBeInTheDocument()
})
```

Note for the implementer: read `RecipeDetail.test.jsx` first and reuse its existing mock/render helper so this test matches the file's conventions (the exact mock of `client.get` returning a recipe). The assertion that matters is the two `expect` lines.

- [ ] **Step 2: Run it to verify it fails**

Run (from `frontend/`): `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/pages/RecipeDetail.test.jsx`
Expected: FAIL — the "make it mine" button is still rendered, so `queryByRole(...).not.toBeInTheDocument()` fails.

- [ ] **Step 3: Remove the button from RecipeDetail**

In `frontend/src/pages/RecipeDetail.jsx`, delete the "Make it mine" button (line 176). The actions row goes from:

```jsx
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={handleCook} className="btn-primary !w-auto px-5">I cooked this</button>
          <button onClick={() => navigate(`/recipes/${recipe.id}/remix`)} className="px-5 py-3 rounded-[10px] border border-terra text-terra font-serif font-semibold text-sm">Make it mine</button>
          {isOwner && (
            <button onClick={() => setShowHandoff(true)} className="px-5 py-3 rounded-[10px] border border-line text-ink-soft font-serif text-sm">Pass it on</button>
          )}
        </div>
```

to:

```jsx
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={handleCook} className="btn-primary !w-auto px-5">I cooked this</button>
          {isOwner && (
            <button onClick={() => setShowHandoff(true)} className="px-5 py-3 rounded-[10px] border border-line text-ink-soft font-serif text-sm">Pass it on</button>
          )}
        </div>
```

- [ ] **Step 4: Remove the route from App.jsx**

In `frontend/src/App.jsx`, delete the import (line 11):

```jsx
import RemixRecipe from './pages/RemixRecipe'
```

and delete the entire route block (lines ~68-75):

```jsx
      <Route
        path="/recipes/:id/remix"
        element={
          <ProtectedRoute>
            <Layout><RemixRecipe /></Layout>
          </ProtectedRoute>
        }
      />
```

Leave `RemixRecipe.jsx` untouched on disk (it becomes dormant, like `AddRecipe.jsx`).

- [ ] **Step 5: Run the RecipeDetail test to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/pages/RecipeDetail.test.jsx`
Expected: PASS.

- [ ] **Step 6: Confirm dormant remix code + its tests still pass**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/pages/RemixRecipe.test.jsx src/lib/lineagePayload.test.js`
Expected: PASS — the dormant `RemixRecipe` page and `buildRemixInitialValues` still work (we removed only the route/button, not the code). This proves the "revivable" safeguard holds.

- [ ] **Step 7: Verify the build has no dangling reference**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vite build`
Expected: clean build. (Confirms no other file imports the removed route and that removing the `RemixRecipe` import from App.jsx left no dangling symbol.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/RecipeDetail.jsx frontend/src/App.jsx frontend/src/pages/RecipeDetail.test.jsx
git commit -m "feat: remove remix from the v1 surface (button + route); code kept dormant (spec §0.1)"
```

---

### Task 2: The garden-bands grouping helper

A pure function that groups a recipe list into three ordered growth bands. This is the core of Kitchen-as-garden and is independently unit-testable.

**Files:**
- Create: `frontend/src/lib/gardenBands.js`
- Create: `frontend/src/lib/gardenBands.test.js`

**Interfaces:**
- Consumes: `stageForRecipe(recipe)` from `frontend/src/lib/growth.js` → `'seed' | 'sprout' | 'sapling' | 'tree'`.
- Produces: `gardenBands(recipes)` → an ordered array of `{ key: string, title: string, blurb: string, recipes: array }`, in fixed order `['tending', 'growing', 'thriving']`, **omitting any band with no recipes**. Band membership: seed/sprout → `tending`; sapling → `growing`; tree → `thriving`. Within a band, input order is preserved.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/gardenBands.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { gardenBands } from './gardenBands'

// growth_stage present → stageForRecipe returns it verbatim (server-first).
const r = (id, stage) => ({ id, name: `r${id}`, growth_stage: stage })

describe('gardenBands', () => {
  it('groups recipes into tending / growing / thriving by stage', () => {
    const bands = gardenBands([
      r(1, 'seed'), r(2, 'tree'), r(3, 'sprout'), r(4, 'sapling'), r(5, 'seed'),
    ])
    expect(bands.map((b) => b.key)).toEqual(['tending', 'growing', 'thriving'])
    expect(bands[0].recipes.map((x) => x.id)).toEqual([1, 3, 5]) // seed + sprout, input order
    expect(bands[1].recipes.map((x) => x.id)).toEqual([4])       // sapling
    expect(bands[2].recipes.map((x) => x.id)).toEqual([2])       // tree
  })

  it('omits empty bands and preserves fixed order', () => {
    const bands = gardenBands([r(1, 'tree'), r(2, 'seed')])
    // no sapling → 'growing' band omitted; tending before thriving
    expect(bands.map((b) => b.key)).toEqual(['tending', 'thriving'])
  })

  it('returns an empty array for no recipes', () => {
    expect(gardenBands([])).toEqual([])
  })

  it('gives each band a human title and a warm blurb', () => {
    const [tending] = gardenBands([r(1, 'seed')])
    expect(tending.title).toBe('Needs tending')
    expect(typeof tending.blurb).toBe('string')
    expect(tending.blurb.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/lib/gardenBands.test.js`
Expected: FAIL — `Failed to resolve import "./gardenBands"`.

- [ ] **Step 3: Write the helper**

Create `frontend/src/lib/gardenBands.js`:

```js
import { stageForRecipe } from './growth'

// The Kitchen-as-garden grouping (spec §6). Recipe-plants sort into three growth
// bands so a bare seed sitting above a lush tree creates the pull to "tend the ones
// that need love." Order is fixed (tending → growing → thriving); empty bands are
// omitted so the garden never shows a hollow header.
const BANDS = [
  { key: 'tending', title: 'Needs tending', blurb: 'Young plants — a memory, a cook, or a photo will help them grow.', stages: ['seed', 'sprout'] },
  { key: 'growing', title: 'Growing', blurb: 'Taking shape. Keep feeding them.', stages: ['sapling'] },
  { key: 'thriving', title: 'Thriving', blurb: 'Full heirlooms — richly told, cooked, and passed on.', stages: ['tree'] },
]

export function gardenBands(recipes) {
  return BANDS
    .map(({ key, title, blurb, stages }) => ({
      key,
      title,
      blurb,
      recipes: recipes.filter((r) => stages.includes(stageForRecipe(r))),
    }))
    .filter((band) => band.recipes.length > 0)
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/lib/gardenBands.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/gardenBands.js frontend/src/lib/gardenBands.test.js
git commit -m "feat: gardenBands — group recipes into growth bands for the Kitchen"
```

---

### Task 3: A larger, more legible plant on the card

The plant is the signature; at 22px in a corner badge its stage/vitality distinctions barely read (flagged in the iteration backlog). Enlarge it so the garden feeling comes through on each card.

**Files:**
- Modify: `frontend/src/components/RecipeCard.jsx`
- Modify: `frontend/src/components/RecipeCard.test.jsx`

**Interfaces:**
- Consumes: `Plant` (`stage`/`vitality`/`size` props), `stageForRecipe`, `vitalityForRecipe` — all already imported in RecipeCard.
- Produces: no new exports. Visual change only; the card's props/signature are unchanged.

- [ ] **Step 1: Write the failing test — the plant renders larger**

Replace `frontend/src/components/RecipeCard.test.jsx` with a version that asserts the plant is rendered at the larger size. First read the existing file to preserve its imports/mock style, then use:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RecipeCard from './RecipeCard'

describe('RecipeCard', () => {
  it('renders the recipe name and a byline', () => {
    render(<RecipeCard recipe={{ id: 1, name: 'Adobo', author_full_name: 'Yoko M.', growth_stage: 'tree' }} onClick={() => {}} />)
    expect(screen.getByText('Adobo')).toBeInTheDocument()
    expect(screen.getByText(/kept by Yoko M\./i)).toBeInTheDocument()
  })

  it('renders the growth plant at a legible size (>= 34px)', () => {
    render(<RecipeCard recipe={{ id: 1, name: 'Adobo', growth_stage: 'sapling', growth_vitality: 'blooming' }} onClick={() => {}} />)
    // Plant renders an <svg role="img"> with an accessible name "<vitality> <stage>"
    const svg = screen.getByRole('img', { name: /blooming sapling/i })
    expect(Number(svg.getAttribute('width'))).toBeGreaterThanOrEqual(34)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/components/RecipeCard.test.jsx`
Expected: FAIL — the plant currently renders at `size={22}`, so `width` is 22, below 34.

- [ ] **Step 3: Enlarge the plant**

In `frontend/src/components/RecipeCard.jsx`, change the badge so the plant is larger and its container keeps it legible. Replace the badge span (lines 32-38):

```jsx
        <span className="absolute top-[7px] right-[7px] bg-[rgba(247,238,221,0.94)] rounded-full p-[3px] shadow-[0_1px_3px_rgba(90,60,30,0.2)]">
          <Plant
            stage={stageForRecipe(recipe)}
            vitality={vitalityForRecipe(recipe)}
            size={22}
          />
        </span>
```

with:

```jsx
        <span className="absolute top-[6px] right-[6px] bg-[rgba(247,238,221,0.94)] rounded-full p-[5px] shadow-[0_1px_3px_rgba(90,60,30,0.2)]">
          <Plant
            stage={stageForRecipe(recipe)}
            vitality={vitalityForRecipe(recipe)}
            size={38}
          />
        </span>
```

- [ ] **Step 4: Run the card test to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/components/RecipeCard.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RecipeCard.jsx frontend/src/components/RecipeCard.test.jsx
git commit -m "feat: enlarge the growth plant on RecipeCard for legibility"
```

---

### Task 4: Render the Kitchen as a garden

Group the Kitchen's recipes into growth bands under warm headers, so the "tend the ones that need love" pull is visible. Search still works; when searching, show flat results (grouping a filtered subset would create confusing single-item bands).

**Files:**
- Modify: `frontend/src/pages/MyRecipes.jsx`
- Modify: `frontend/src/pages/MyRecipes.test.jsx`

**Interfaces:**
- Consumes: `gardenBands(recipes)` from `frontend/src/lib/gardenBands.js` (Task 2); `RecipeCard` (unchanged).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test — bands render**

In `frontend/src/pages/MyRecipes.test.jsx`, the file mocks `../api/client` and `../components/RecipeCard`. Add a test that returns recipes at different stages and asserts the band headers appear. Append inside the existing `describe`:

```jsx
  it('groups kept recipes into growth bands (the garden)', async () => {
    const { default: client } = await import('../api/client')
    client.get.mockResolvedValueOnce({ data: [
      { id: 1, name: 'Seedling Stew', growth_stage: 'seed' },
      { id: 2, name: 'Old Faithful', growth_stage: 'tree' },
    ] })
    render(<MemoryRouter><MyRecipes /></MemoryRouter>)
    expect(await screen.findByText('Needs tending')).toBeInTheDocument()
    expect(screen.getByText('Thriving')).toBeInTheDocument()
    expect(screen.getByText('Seedling Stew')).toBeInTheDocument()
    expect(screen.getByText('Old Faithful')).toBeInTheDocument()
    // no sapling → 'Growing' band header absent
    expect(screen.queryByText('Growing')).not.toBeInTheDocument()
  })
```

**Robust mock setup (do this — don't rely on call ordering).** The file's existing top mock hard-codes `Promise.resolve({ data: [] })` inside the `vi.fn()`, which makes per-test overrides order-dependent and flaky. Make the mock's default resettable in a `beforeEach`, so each test starts from `data: []` and only the new test opts into recipes. Concretely, change the top of the file to:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
// ...existing render/userEvent/MemoryRouter imports...
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }))
vi.mock('../components/RecipeCard', () => ({ default: ({ recipe }) => <div>{recipe.name}</div> }))
import client from '../api/client'
import MyRecipes from './MyRecipes'

beforeEach(() => {
  client.get.mockReset()
  client.get.mockResolvedValue({ data: [] })  // default: empty kitchen
})
```

Then the two existing tests keep working (default empty data), and the new band test overrides with `client.get.mockResolvedValueOnce({ data: [...] })` at its top before `render`. This removes the order-dependence entirely. Keep the two existing tests otherwise unchanged.

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/pages/MyRecipes.test.jsx`
Expected: FAIL — the band headers don't render yet (Kitchen is still a flat grid).

- [ ] **Step 3: Render the bands in MyRecipes**

Replace `frontend/src/pages/MyRecipes.jsx` with:

```jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'
import RecipeCard from '../components/RecipeCard'
import IconField from '../components/IconField'
import { gardenBands } from '../lib/gardenBands'

export default function MyRecipes() {
  const [recipes, setRecipes] = useState([])
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    client.get('/recipes').then((res) => setRecipes(res.data)).catch(() => {})
  }, [])

  const searching = search.trim().length > 0
  const filtered = recipes.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase())
  )
  // While searching, show a flat grid of matches (grouping a filtered subset would
  // create confusing single-item bands). Otherwise, show the garden by band.
  const bands = searching ? [] : gardenBands(recipes)

  function grid(list) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {list.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            variant="grid"
            onClick={() => navigate(`/recipes/${recipe.id}`)}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="px-4 pt-6">
      <h1 className="font-serif font-black text-[28px] text-ink">Your Kitchen</h1>
      <p className="font-serif italic text-sm text-ink-soft mt-0.5">A garden of everything you've kept.</p>

      <button
        onClick={() => navigate('/shared')}
        className="mt-2 font-sans text-[11.5px] font-semibold text-terra"
      >
        Shared with you →
      </button>

      <IconField
        icon="search"
        iconClassName="text-ink-soft"
        type="text"
        placeholder="Search recipes"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        wrapperClassName="mt-3.5 mb-4"
      />

      {searching ? (
        grid(filtered)
      ) : (
        bands.map((band) => (
          <section key={band.key} className="mb-6">
            <h2 className="font-serif font-bold text-[17px] text-ink">{band.title}</h2>
            <p className="font-serif italic text-[12.5px] text-ink-soft mb-2.5">{band.blurb}</p>
            {grid(band.recipes)}
          </section>
        ))
      )}

      {searching && filtered.length === 0 && (
        <p className="text-center text-ink-soft text-sm mt-8">No recipes found.</p>
      )}
      {!searching && recipes.length === 0 && (
        <p className="text-center text-ink-soft text-sm mt-8">
          Your kitchen's just getting started. Keep your first recipe.
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the MyRecipes test to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/pages/MyRecipes.test.jsx`
Expected: PASS (3 tests — the 2 existing + the new band test).

- [ ] **Step 5: Full frontend suite + build**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run && npx vite build`
Expected: all tests pass; build clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/MyRecipes.jsx frontend/src/pages/MyRecipes.test.jsx
git commit -m "feat: Kitchen-as-garden — group kept recipes into growth bands (spec §6)"
```

---

### Task 5: Visual verification + docs

Verify the whole sub-project in the browser, then update the architecture docs.

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Visual verification**

Using the isolated demo stack (throwaway SQLite backend on :8010 via `run_backend.py`, Vite on :5183 with `VITE_API_URL`, seed script under `$CLAUDE_JOB_DIR/tmp`; see `.superpowers/sdd/progress.md` for the pattern — and note that on this Windows host stale `python`/`node` processes must be killed with `taskkill //F //PID` since `pkill` is a no-op), seed a user with recipes spanning stages (a seed, a sprout, a sapling, a tree — vary soul fields + cook_count), then verify with a Playwright driver run from `frontend/`:
1. Kitchen shows the bands in order (Needs tending → Growing → Thriving), each with its header + blurb, only non-empty bands present, and the enlarged plant reads clearly on each card.
2. Typing in search collapses to a flat grid of matches (no band headers).
3. On a recipe detail page, there is NO "Make it mine" button (only "I cooked this" and, for owners, "Pass it on").
4. Navigating directly to `/recipes/<id>/remix` no longer renders the remix form (the route is gone — it falls through to no match / redirect).
5. Confirm 0 console errors. Record observations + screenshots in the report.

- [ ] **Step 2: Update ARCHITECTURE.md — remix cut**

In `ARCHITECTURE.md`, the pages table currently lists `RemixRecipe.jsx | /recipes/:id/remix | Branch a child recipe off this one.` Update that row to reflect that it's now dormant/unrouted (mirroring the existing `AddRecipe.jsx` note). Replace it with:

```
| `RemixRecipe.jsx` | *(unrouted)* | Dormant: remix is cut from the v1 surface (spec §0.1). The page, `buildRemixInitialValues`, `remixRecipe`, and the backend `/remix` endpoint remain on disk so remix is a cheap UI revival, not a re-architecture. |
```

Also, if the `App.jsx` route-table description or the recipes-router line mentions remix as a live user action, adjust the wording to note remix is dormant (the backend endpoint still exists but no UI reaches it). Keep it accurate and minimal.

- [ ] **Step 3: Update ARCHITECTURE.md — Kitchen-as-garden**

Update the `MyRecipes.jsx` pages-table row:

```
| `MyRecipes.jsx` | `/my-recipes` | The Kitchen — **a garden of your recipe-plants grouped into growth bands** (Needs tending → Growing → Thriving, via `lib/gardenBands.js`); empty bands are omitted, and searching collapses to a flat grid. Links to "Shared with you". |
```

Add a `gardenBands.js` row to the `lib/` table (after `sourceName.js`):

```
| `gardenBands.js` | `gardenBands(recipes)` — groups a recipe list into ordered growth bands (tending/growing/thriving) by `stageForRecipe`, omitting empty bands. The data behind the Kitchen-as-garden view. |
```

- [ ] **Step 4: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: remix cut from v1 surface; Kitchen-as-garden"
```

---

## Self-Review

**1. Spec coverage:**
- §0.1 (remix cut from v1 surface; data model + endpoint kept dormant/revivable; `parent_recipe_id` untouched) — Task 1 (removes only button + route; Step 6 proves dormant code still passes). ✓
- §6 (Kitchen-as-garden; recipe-plants at different stages; the pull to tend those that need love) — Tasks 2 (bands helper) + 3 (legible plant) + 4 (banded Kitchen render). ✓

**2. Placeholder scan:** No TBD/TODO. Every code step shows complete code. Task 1 Step 1 and Task 3/4 test steps instruct reading the existing test file first to match mock conventions, but give the exact assertions that matter — not a vague "write tests." ✓

**3. Type consistency:** `gardenBands(recipes)` returns `{key,title,blurb,recipes}[]` — consumed exactly that way in MyRecipes (`band.key/title/blurb/recipes`). `stageForRecipe` return values (`seed|sprout|sapling|tree`) match the band `stages` arrays. Plant `size` prop is a number in both card edit and the test's `>= 34` assertion (38 ≥ 34). ✓

**4. Dormancy safeguard:** Task 1 explicitly keeps `RemixRecipe.jsx`, `buildRemixInitialValues`, `remixRecipe`, and the backend endpoint; Step 6 runs their tests to prove they still work. This is the spec's "reversible safeguard." ✓

**5. Search-vs-garden interaction:** handled explicitly — searching shows a flat grid (avoids confusing single-item bands), non-searching shows the garden. Empty-state and no-results messages both preserved. ✓
