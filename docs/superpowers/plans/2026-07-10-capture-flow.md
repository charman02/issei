# Capture Flow Refinement Implementation Plan (Sub-Project 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the existing stepped "plant a recipe" capture flow so its final "planted!" beat launches the growth loop (honest growth stage + warm growth-loop copy) and the recipe step carries soul-invitation framing — per living-recipe spec §3.

**Architecture:** Frontend-only, copy-and-wiring refinement of `frontend/src/pages/PlantRecipe.jsx` (the existing doorway → origin → form → planted → handoff flow). A new pure helper `frontend/src/lib/plantedBeat.js` computes the planted-beat copy from the recipe the API returns (which already carries `growth_stage`, so the beat reflects the real computed stage — a recipe planted with an origin/story is born a sprout, not a seed). The shared `RecipeForm` gains one optional `intro` prop so the capture flow can add its framing line without polluting the Edit/Remix reuses. No backend changes, no new endpoints, no migrations.

**Tech Stack:** React 18, Vite 5, Tailwind 3, React Router 6, Vitest + React Testing Library.

## Global Constraints

- **This is a refinement, not a rebuild** (spec §3.3). Do not restructure the five-step flow (`doorway | origin | form | planted | handoff`) or the `handleFormSubmit` origin/story logic — only change the planted beat, add the form intro, and adjust the planted-step CTAs.
- **Recipe #1 must still succeed with just a name** (spec §3.1). Do not add any new required field anywhere in the flow.
- **Out of scope for this sub-project (belongs to SP5, handoff refinement):** the handoff note-starters, the per-source starter pre-selection, the soft-wall recipient landing, and removing the word "remix" from `HandoffInvite.jsx`. Leave `HandoffInvite.jsx` untouched.
- **Remix is cut from v1** (spec §0.1) — do not add any "make your own version" copy to the capture flow.
- **Growth thresholds live in `frontend/src/lib/growth.js`** and mirror the backend; do not duplicate or re-derive them. The planted beat reads the recipe's stage through `stageForRecipe` (which is server-first).
- **Tailwind tokens only** — use the existing design tokens (`ink`, `ink-soft`, `herb`, `terra`, `line`, `card`, `paper`) and font families (`font-serif`, `font-sans`, `font-hand`). No raw hex, no new tokens.
- **Typographic punctuation** — match the surrounding files: curly apostrophes/quotes (`’` `“` `”`) in user-facing copy, not straight ASCII.
- **Tests:** Vitest + RTL, colocated next to source (`Foo.jsx` → `Foo.test.jsx`, `foo.js` → `foo.test.js`). Run from the `frontend/` directory. On this Windows shell, prefix node/npm with `export PATH="$PATH:/c/Program Files/nodejs"`.

---

## Reference: what the API returns to the planted beat

`plantRecipe(payload)` (`src/api/lineage.js`) POSTs to `/recipes` and resolves to `{ data: recipe }`. The backend's `create_recipe` calls `_attach_growth_fields` before returning, so the recipe object carries:

- `id` (number), `name` (string)
- `growth_stage` (string: `"seed" | "sprout" | "sapling" | "tree"`) — computed server-side
- `growth_vitality` (string: `"bare" | "blooming" | "fruiting"`)
- `story` (string | null), `cover_photo_url` (string | null), `origin_attribution` (string | null)

Consequence: a recipe planted via the **ancestor** doorway (sets `origin_attribution`) or with a **memory/story** is born `growth_stage === "sprout"`. A name-only recipe is born `"seed"`.

`stageForRecipe(recipe)` (`src/lib/growth.js`, already built) returns `recipe.growth_stage` when present, else a client-side fallback. The planted beat uses it so it always shows the true stage.

---

## File Structure

- **Create** `frontend/src/lib/plantedBeat.js` — pure helper `plantedBeatCopy(recipe, sourceName)` returning the planted-beat's `{ stage, eyebrow, heading, body }`. One responsibility: the beat's copy, derived from the real recipe + optional source name. Independently unit-testable.
- **Create** `frontend/src/lib/plantedBeat.test.js` — unit tests for the helper.
- **Modify** `frontend/src/pages/PlantRecipe.jsx` — the `planted` step renders the real `<Plant stage={...}>` and the helper's copy; the secondary CTA lands on the new recipe (not the kitchen). Pass the capture framing into `RecipeForm` via a new `intro` prop.
- **Modify** `frontend/src/pages/PlantRecipe.test.jsx` — assert the planted beat reflects stage + growth-loop copy, and that the form step shows the soul-invitation framing.
- **Modify** `frontend/src/components/RecipeForm.jsx` — add one optional `intro` prop rendered under the heading.
- **Modify** `frontend/src/components/RecipeForm.test.jsx` — assert `intro` renders when provided and is absent otherwise.
- **Modify** `ARCHITECTURE.md` — update the PlantRecipe row and `lib/` table (Task 3).

---

### Task 1: The planted beat launches the growth loop

Replace the planted step's hardcoded seed + stale tree-framing copy with the real computed stage and warm growth-loop copy, extracted into a pure helper. Repoint the secondary CTA to the newly-planted recipe so "cook it / add its story" is one tap away.

**Files:**
- Create: `frontend/src/lib/plantedBeat.js`
- Create: `frontend/src/lib/plantedBeat.test.js`
- Modify: `frontend/src/pages/PlantRecipe.jsx` (the `planted` step block, currently lines 86–97; and the source-name it needs)
- Modify: `frontend/src/pages/PlantRecipe.test.jsx`

**Interfaces:**
- Consumes: `stageForRecipe(recipe)` from `src/lib/growth.js` — returns `"seed" | "sprout" | "sapling" | "tree"`, server-first. `Plant` from `src/components/Plant.jsx` — props `{ stage, vitality, size, className }`.
- Produces: `plantedBeatCopy(recipe, sourceName)` from `src/lib/plantedBeat.js` — returns `{ stage: string, eyebrow: string, heading: string, body: string }`. `sourceName` is the ancestor's display name (string) or `null`/`undefined` on the self-authored path.

- [ ] **Step 1: Write the failing test for the helper**

Create `frontend/src/lib/plantedBeat.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { plantedBeatCopy } from './plantedBeat'

describe('plantedBeatCopy', () => {
  it('name-only recipe reads as a freshly-sown seed', () => {
    const copy = plantedBeatCopy({ name: 'Congee', growth_stage: 'seed' }, null)
    expect(copy.stage).toBe('seed')
    expect(copy.eyebrow).toBe('Seed sown')
    expect(copy.heading).toBe('Congee is planted.')
    // self-authored: no source name → generic "add a memory"
    expect(copy.body).toContain('add a memory')
    expect(copy.body).toContain('and watch it grow')
  })

  it('a recipe planted with soul is born a sprout', () => {
    const copy = plantedBeatCopy(
      { name: 'Lola’s Adobo', growth_stage: 'sprout' },
      'Lola'
    )
    expect(copy.stage).toBe('sprout')
    expect(copy.eyebrow).toBe('First sprout')
    // ancestor path: story act is personalized to the source
    expect(copy.body).toContain('add Lola’s story')
  })

  it('names the three growth-loop acts (cook, story, pass on)', () => {
    const copy = plantedBeatCopy({ name: 'Sinigang', growth_stage: 'seed' }, null)
    expect(copy.body).toContain('Cook it')
    expect(copy.body).toContain('pass it on')
  })

  it('falls back to computing the stage when the server did not send one', () => {
    // no growth_stage, no soul, no cooks → stageForRecipe returns 'seed'
    const copy = plantedBeatCopy({ name: 'Bare' }, null)
    expect(copy.stage).toBe('seed')
    expect(copy.eyebrow).toBe('Seed sown')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/lib/plantedBeat.test.js`
Expected: FAIL — `Failed to resolve import "./plantedBeat"` (the module does not exist yet).

- [ ] **Step 3: Write the helper**

Create `frontend/src/lib/plantedBeat.js`:

```js
import { stageForRecipe } from './growth'

// Copy for the "planted!" beat that launches the growth loop (spec §3.2.4).
// Reflects the recipe's REAL computed stage — a recipe planted with an origin or
// a story is already a sprout, not a seed — and names the three nourishing acts
// (cook · add its story · pass it on). `sourceName` personalizes the story act on
// the ancestor path ("add Lola’s story"); on the self-authored path it is null
// and the act reads "add a memory".
export function plantedBeatCopy(recipe, sourceName) {
  const stage = stageForRecipe(recipe)
  const sprouted = stage !== 'seed'
  const storyAct = sourceName ? `add ${sourceName}’s story` : 'add a memory'
  return {
    stage,
    eyebrow: sprouted ? 'First sprout' : 'Seed sown',
    heading: `${recipe.name} is planted.`,
    body: `Cook it, ${storyAct}, or pass it on — and watch it grow.`,
  }
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/lib/plantedBeat.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the helper + real stage into the planted step**

In `frontend/src/pages/PlantRecipe.jsx`:

First, add the import at the top (with the other component/lib imports — `Plant` is already imported, and `stageForRecipe` is NOT needed here because the helper uses it internally):

```jsx
import { plantedBeatCopy } from '../lib/plantedBeat'
```

Then replace the entire `if (step === 'planted') { ... }` block (currently lines 86–97) with:

```jsx
  if (step === 'planted') {
    // The ancestor's first name personalizes the "add their story" act; the
    // self-authored path has no source, so the act reads "add a memory".
    const sourceName =
      originMode === 'ancestor' && origin.name.trim()
        ? origin.name.trim().split(/\s+/)[0]
        : null
    const beat = plantedBeatCopy(planted, sourceName)
    return (
      <div className="px-[18px] pt-12 text-center flex flex-col items-center">
        <Plant stage={beat.stage} vitality={planted?.growth_vitality || 'bare'} size={96} />
        <p className="font-sans text-[10px] font-semibold tracking-[0.18em] uppercase text-herb mt-5 mb-2">{beat.eyebrow}</p>
        <h1 className="font-serif font-black italic text-[26px] text-ink leading-tight">{beat.heading}</h1>
        <p className="font-serif italic text-[14px] text-ink-soft mt-3 mb-8 max-w-[16rem]">{beat.body}</p>
        <button className="btn-primary" onClick={() => setStep('handoff')}>Pass it on →</button>
        <button className="mt-3 font-serif italic text-ink-soft text-sm" onClick={() => navigate(`/recipes/${planted.id}`)}>Take me to it →</button>
      </div>
    )
  }
```

Two deliberate changes beyond copy: the `<Plant>` now renders `beat.stage` (the real computed stage — was hardcoded `"seed"`) with the recipe's own vitality (`planted?.growth_vitality || 'bare'`), and the secondary CTA now navigates to `/recipes/${planted.id}` — the living recipe page, where "cook it" and "add its story" happen — instead of `/my-recipes`. The heading/body/eyebrow all come from `beat`, so no other copy is hardcoded in this block.

- [ ] **Step 6: Update the PlantRecipe flow test for the new beat**

In `frontend/src/pages/PlantRecipe.test.jsx`, the mock currently resolves `plantRecipe` to `{ data: { id: 42, name: 'Congee' } }`. Update that mock and add assertions. Change the mock factory (line 6) to:

```js
vi.mock('../api/lineage', () => ({ plantRecipe: vi.fn(() => Promise.resolve({ data: { id: 42, name: 'Congee', growth_stage: 'sprout', growth_vitality: 'bare' } })) }))
```

Then in the first test (`walks doorway → mine → form → planted, sending story not origin`), replace the final assertion line:

```js
    expect(await screen.findByText(/is planted/i)).toBeInTheDocument()
```

with:

```js
    // The planted beat launches the growth loop with real stage + loop copy.
    expect(await screen.findByText('Congee is planted.')).toBeInTheDocument()
    expect(screen.getByText(/and watch it grow/i)).toBeInTheDocument()
    // Mine path has no source name → generic "add a memory"
    expect(screen.getByText(/add a memory/i)).toBeInTheDocument()
    // 'sprout' from the API → sprout eyebrow, and a secondary CTA to the recipe
    expect(screen.getByText(/first sprout/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /take me to it/i })).toBeInTheDocument()
```

- [ ] **Step 7: Run the PlantRecipe test to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/pages/PlantRecipe.test.js`
Expected: PASS (both existing tests, now with the new assertions).

Note: the file is `PlantRecipe.test.jsx`; vitest resolves either — if the `.js` glob misses it, run `npx vitest run src/pages/PlantRecipe.test.jsx`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/plantedBeat.js frontend/src/lib/plantedBeat.test.js frontend/src/pages/PlantRecipe.jsx frontend/src/pages/PlantRecipe.test.jsx
git commit -m "feat: planted beat launches the growth loop (real stage + loop copy)"
```

---

### Task 2: Soul-invitation framing on the recipe step

Give the capture flow's recipe step the spec's warm framing ("Add what you've got — 'a splash of vinegar' is perfect. Only the name is required.") without baking capture-only copy into the shared `RecipeForm` (which Edit and Remix also use). Do this with one optional `intro` prop, mirroring the existing `beforeSubmitSlot`/`submitLabel` extension pattern.

**Files:**
- Modify: `frontend/src/components/RecipeForm.jsx` (signature line 27; heading render around line 159)
- Modify: `frontend/src/components/RecipeForm.test.jsx`
- Modify: `frontend/src/pages/PlantRecipe.jsx` (the `form` step render, currently line 83)
- Modify: `frontend/src/pages/PlantRecipe.test.jsx` (its `RecipeForm` mock + a form-step assertion)

**Interfaces:**
- Consumes: nothing new.
- Produces: `RecipeForm` gains an optional prop `intro` (ReactNode, default `null`) rendered directly under the form heading. Existing props unchanged: `{ mode, initialValues, onSubmit, submitLabel, beforeSubmitSlot }`.

- [ ] **Step 1: Write the failing test for the `intro` prop**

In `frontend/src/components/RecipeForm.test.jsx`, add a new describe block at the end of the file:

```js
describe('RecipeForm intro', () => {
  it('renders the intro node under the heading when provided', () => {
    render(<RecipeForm mode="add" intro={<p>splash-of-vinegar-framing</p>} onSubmit={() => {}} />)
    expect(screen.getByText('splash-of-vinegar-framing')).toBeInTheDocument()
  })

  it('renders no intro by default (Edit/Remix reuse stays clean)', () => {
    render(<RecipeForm mode="edit" onSubmit={() => {}} />)
    expect(screen.queryByText('splash-of-vinegar-framing')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/components/RecipeForm.test.jsx`
Expected: FAIL — the first new test fails because `intro` is not rendered (the text is not in the document).

- [ ] **Step 3: Add the `intro` prop to RecipeForm**

In `frontend/src/components/RecipeForm.jsx`, change the signature (line 27) from:

```jsx
export default function RecipeForm({ mode = 'add', initialValues = {}, onSubmit, submitLabel, beforeSubmitSlot = null }) {
```

to:

```jsx
export default function RecipeForm({ mode = 'add', initialValues = {}, onSubmit, submitLabel, beforeSubmitSlot = null, intro = null }) {
```

Then, in the render, add `{intro}` immediately after the heading `<h1>` (currently line 159):

```jsx
      <h1 className="font-serif font-black text-[26px] text-ink mb-4">{heading}</h1>

      {intro}

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
```

- [ ] **Step 4: Run the RecipeForm test to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/components/RecipeForm.test.jsx`
Expected: PASS (all existing tests + the 2 new intro tests).

- [ ] **Step 5: Pass the capture framing from PlantRecipe**

In `frontend/src/pages/PlantRecipe.jsx`, replace the `form` step return (currently line 83):

```jsx
    return <RecipeForm mode="add" initialValues={initialValues} onSubmit={handleFormSubmit} />
```

with:

```jsx
    return (
      <RecipeForm
        mode="add"
        initialValues={initialValues}
        onSubmit={handleFormSubmit}
        intro={
          <p className="font-serif italic text-[14px] text-ink-soft -mt-2 mb-4">
            Add what you’ve got — “a splash of vinegar” is perfect. Only the name is required.
          </p>
        }
      />
    )
```

- [ ] **Step 6: Assert the framing reaches the form step in the flow test**

In `frontend/src/pages/PlantRecipe.test.jsx`, the `RecipeForm` mock (lines 12–21) currently ignores every prop except `onSubmit`/`initialValues`. Extend it to render `intro` so the wiring is covered. Change the mock to:

```js
vi.mock('../components/RecipeForm', () => ({
  default: ({ onSubmit, initialValues = {}, intro = null }) => {
    lastInitialValues = initialValues
    return (
      <div>
        {intro}
        <button onClick={() => onSubmit({ name: 'Congee', ingredients: [], steps: [], story: initialValues.story || null })}>
          submit-form
        </button>
      </div>
    )
  },
}))
```

Then, in the first test, after the `continue to the recipe` click and before `submit-form`, add:

```js
    // The capture flow frames the recipe step as low-pressure (spec §3.2.3).
    expect(screen.getByText(/a splash of vinegar/i)).toBeInTheDocument()
```

- [ ] **Step 7: Run the PlantRecipe test to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/pages/PlantRecipe.test.jsx`
Expected: PASS (both tests, including the new framing assertion).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/RecipeForm.jsx frontend/src/components/RecipeForm.test.jsx frontend/src/pages/PlantRecipe.jsx frontend/src/pages/PlantRecipe.test.jsx
git commit -m "feat: soul-invitation framing on the capture recipe step"
```

---

### Task 3: Full-suite verify, visual check, and docs

Confirm the whole capture flow works end-to-end (both doorways), the full frontend suite and build are green, then update the architecture docs to describe the refined flow.

**Files:**
- Modify: `ARCHITECTURE.md` (the `PlantRecipe.jsx` page row; the `lib/` table)

- [ ] **Step 1: Run the full frontend suite**

Run (from `frontend/`): `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run`
Expected: PASS — all files (the prior 64 tests + the ~6 added here). If anything fails, fix it before proceeding.

- [ ] **Step 2: Run the production build**

Run (from `frontend/`): `export PATH="$PATH:/c/Program Files/nodejs" && npx vite build`
Expected: build completes with no errors (catches syntax/import mistakes, e.g. an unused-import lint or a bad path).

- [ ] **Step 3: Visual verification of both doorways**

Use the isolated demo stack the earlier sub-projects established (throwaway SQLite backend + Vite on the alt port; see `.superpowers/sdd/progress.md` for the exact run commands and the seed script pattern under `$CLAUDE_JOB_DIR/tmp`). Verify with a Playwright screenshot driver run from `frontend/`:

1. **Ancestor path:** doorway → "A seed passed to you" → enter a source name (e.g. "Lola Remedios") + optional place/year/memory → the recipe form shows the "a splash of vinegar" framing → submit name-only → the planted beat shows a **sprout** (origin set → soul), eyebrow "First sprout", body "Cook it, add Lola’s story, or pass it on — and watch it grow.", and a "Take me to it →" secondary CTA.
2. **Mine path:** doorway → "A seed of your own" → skip the memory → recipe form (framing present) → submit name-only → planted beat shows a **seed**, eyebrow "Seed sown", body "Cook it, add a memory, or pass it on — and watch it grow."
3. Confirm "Take me to it →" navigates to `/recipes/{id}` and "Pass it on →" advances to the handoff step. Confirm 0 console errors.

Record the observations (stage shown, copy, CTA targets, console clean) in the task report.

- [ ] **Step 4: Update ARCHITECTURE.md**

In `ARCHITECTURE.md`, update the `PlantRecipe.jsx` row of the pages table to describe the growth-loop planted beat and capture framing. Replace the existing row:

```
| `PlantRecipe.jsx` | `/add` | Stepped plant-a-recipe flow: choose a doorway (ghost ancestor vs. self-authored root) → RecipeForm → planted beat → HandoffInvite. |
```

with:

```
| `PlantRecipe.jsx` | `/add` | Stepped plant-a-recipe flow: choose a doorway (ghost ancestor vs. self-authored root) → RecipeForm (with a soul-invitation framing line — only a name is required) → **planted beat** that launches the growth loop (shows the recipe's real computed stage — a recipe planted with an origin/story is born a sprout — and invites the three nourishing acts: cook it · add its story · pass it on, via `lib/plantedBeat.js`) → HandoffInvite. The beat's secondary CTA lands on the new recipe page. |
```

Then add a `plantedBeat.js` entry to the `lib/` table, after the `measures.js` row:

```
| `plantedBeat.js` | `plantedBeatCopy(recipe, sourceName)` — the copy for the capture flow's "planted!" beat, derived from the recipe's real growth stage (server-first via `growth.js`) + the source's name. Names the three growth-loop acts. |
```

- [ ] **Step 5: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: document the growth-loop planted beat + capture framing"
```

---

## Self-Review

**1. Spec coverage (§3):**
- §3.1 (name-only in under a minute; model B invited-not-required) — preserved by the Global Constraint (no new required fields) and the framing "Only the name is required" (Task 2). ✓
- §3.2.1 doorway — already matches the spec ("Where does this recipe begin?" + two intent doorways); left unchanged deliberately (noted in scope). ✓
- §3.2.2 who/mine origin step — already matches (name required, place/year/memory optional; "What made this yours?"); left unchanged. ✓
- §3.2.3 the recipe step framing — Task 2. ✓
- §3.2.4 planted beat launches the growth loop — Task 1 (real stage + loop copy + CTA to the recipe). ✓
- §3.2.5 handoff — explicitly deferred to SP5 (scope note). ✓ (gap is intentional)
- §3.3 refine not rebuild — Global Constraint. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code. ✓

**3. Type consistency:** `plantedBeatCopy(recipe, sourceName)` returns `{ stage, eyebrow, heading, body }` — used consistently in Task 1 Step 5. `stageForRecipe`/`Plant` signatures match the real files. The `intro` prop name is consistent across RecipeForm signature, its render, the test, and the PlantRecipe caller + mock. ✓

**4. Dead-import guard:** Task 1 Step 5 flags that `stageForRecipe` may end up unused after simplifying the vitality line — instructs removing the import if the build/lint flags it. ✓
