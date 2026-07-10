# Living Recipe Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn RecipeDetail into "the living recipe" — a page that makes you feel the person: a framing story that leads, the person's words woven into the steps, imprecise measures celebrated (not hidden), a provenance line, and a warm-invitational empty state.

**Architecture:** Steps gain an optional `voice_note` column (the "their words" quote attached to a step) — a new model field + schema + migration. Everything else is presentation on data that already exists: `quantity_type` (already on `IngredientResponse`) drives the "her way" imprecise-measure tag; `origin_attribution` + `author_full_name` (already on the recipe) build the provenance line without a network call; absent soul fields drive the warm invitations. A small `Provenance` component + an `ImpreciseTag` render helper keep RecipeDetail focused.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + Pydantic + pytest (backend); React 18 + Vite + Tailwind + Vitest/RTL (frontend).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-09-living-recipe-growth-design.md` §1 (the living recipe page) + §8 decisions. Identity/type per `2026-07-10-visual-identity-design.md`.
- **Three registers (verbatim §1.1):** (1) framing **story** at top (who/when/why); (2) **woven quotes** — short pull-quotes in the person's words attached to specific steps; (3) **imprecise measures** in the ingredient body, honored verbatim with a subtle "her words"/"their way" tag, never normalized.
- **Provenance line (§1.2):** always-legible `🌱 Lola → Mom → you`-style line derived from origin/author; reads fine at 1 node (no tree canvas, no network call required for MVP).
- **Empty-state philosophy (§1.3, "warm & invitational"):** soul content is ALWAYS optional; when absent, the page is calm and intentional, with soft open invitations framed as opportunities, never deficiencies or nags. Empty = "room to grow."
- **Imprecise measures are a FEATURE (spec §2 / §8.2 "truth"):** `quantity_type == "imprecise"` (or `"unmeasured"`) gets a warm tag; precise amounts are plain. Never convert or hide imprecise amounts.
- **Type system:** Cormorant Garamond (`font-serif`) titles/display; Nunito Sans (`font-sans`) body/UI; Caveat (`font-hand`) reserved for the wordmark + special moments — a woven **quote** is a "special moment" and MAY use `font-hand`; do not use the hand for every label. Color roles: `action`/terra = interactive, `growth`/herb = growth.
- **Run backend:** `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q`. **Frontend:** `cd frontend && npx vitest run`. **Migrations:** `alembic` via the venv python; the known TECHDEBT (f) — two older migrations fail on fresh SQLite — means verify a new migration in isolation, not via a full from-scratch `upgrade head` (see Task 1).
- **Don't git commit without explicit user approval.** Per-task Commit steps stage + write the message; a human approves.

---

## File Structure

**Backend:**
- `app/models/step.py` — add `voice_note: Mapped[Optional[str]]` (nullable Text). The person's words for this step.
- `app/schemas/recipe.py` — `StepResponse` + `StepCreate` gain `voice_note: Optional[str] = None`.
- `alembic/versions/<gen>_add_step_voice_note.py` (create) — add the nullable column.
- `app/routers/recipes.py` — `create_recipe` + `patch_recipe` persist `voice_note` when building `Step(...)`.
- `tests/test_living_recipe.py` (create) — voice_note round-trips through create + GET.

**Frontend:**
- `frontend/src/components/Provenance.jsx` (create) — renders the `🌱 origin → you` line from a recipe. `Provenance.test.jsx`.
- `frontend/src/lib/measures.js` (create) — `isImprecise(ingredient)` + the tag label. `measures.test.js`.
- `frontend/src/pages/RecipeDetail.jsx` — restructure: provenance line under the title; imprecise tag in the ingredient rows; woven quote rendered under its step; warm invitations when story/photo/quotes absent.
- `frontend/src/pages/RecipeDetail.test.jsx` — extend for the new elements.

---

## Task 1: Step `voice_note` column + migration

**Files:**
- Modify: `app/models/step.py`, `app/schemas/recipe.py`
- Create: `alembic/versions/<gen>_add_step_voice_note.py`
- Test: `tests/test_living_recipe.py` (create)

**Interfaces:**
- Produces: `Step.voice_note` (nullable str); `StepCreate.voice_note` + `StepResponse.voice_note` (`Optional[str] = None`).

- [ ] **Step 1: Write the failing test**

Create `tests/test_living_recipe.py`:

```python
def test_step_voice_note_roundtrips(client, make_user):
    _, headers = make_user()
    payload = {"name": "Adobo",
               "ingredients": [{"name": "chicken", "quantity_text": "2 lbs",
                                "quantity_type": "precise", "position": 1}],
               "steps": [{"content": "Brown the chicken", "position": 1,
                          "voice_note": "Don't crowd the pan — let it get a real color."}]}
    r = client.post("/recipes", json=payload, headers=headers)
    assert r.status_code == 201
    rid = r.json()["id"]
    body = client.get(f"/recipes/{rid}", headers=headers).json()
    step = body["steps"][0]
    assert step["voice_note"] == "Don't crowd the pan — let it get a real color."
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_living_recipe.py -v`
Expected: FAIL — `voice_note` not accepted/returned (the step dict lacks the key).

- [ ] **Step 3: Add the model column**

In `app/models/step.py`, add after `section_header`:

```python
    voice_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
```

- [ ] **Step 4: Add the schema fields**

In `app/schemas/recipe.py`, add `voice_note: Optional[str] = None` to BOTH `StepCreate` and `StepResponse`.

- [ ] **Step 5: Persist it in the router**

In `app/routers/recipes.py`, find every place a `Step(...)` is constructed from an input step (in `create_recipe` and in `patch_recipe`'s step-rebuild loop). Add `voice_note=step_in.voice_note` to each `Step(...)` call. (There are two: create + patch. Grep `Step(` to find them.)

- [ ] **Step 6: Create the migration**

Find the current head: `DATABASE_URL="sqlite:///./_scratch.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m alembic heads` (note it, then `rm -f ./_scratch.db`). Create `alembic/versions/<gen>_add_step_voice_note.py` (fresh `revision`, `down_revision` = that head):

```python
"""add step voice_note

Revision ID: <gen>
Revises: <head>
"""
from alembic import op
import sqlalchemy as sa

revision = "<gen>"
down_revision = "<head>"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("steps", sa.Column("voice_note", sa.Text(), nullable=True))

def downgrade():
    op.drop_column("steps", "voice_note")
```

- [ ] **Step 7: Verify the migration in isolation**

`add_column` is safe on SQLite (unlike the drop_constraint TECHDEBT (f) migrations). Verify without a from-scratch upgrade: build schema from models on a scratch DB, confirm the migration file imports + chains cleanly:
```bash
DATABASE_URL="sqlite:///./_scratch.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -c "import alembic.versions.<yourfile> as m; print(m.revision, m.down_revision)"
DATABASE_URL="sqlite:///./_scratch.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m alembic history | head -3
rm -f ./_scratch.db
```
Expected: prints the revision + its down_revision (chains to the recorded head); history shows it at the head with no multiple-heads error. (Tests build the schema from models, so the column exists for them regardless.)

- [ ] **Step 8: Run the test to green + full suite**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q`
Expected: all pass (voice_note round-trips; existing recipe tests unaffected since the field is optional).

- [ ] **Step 9: Commit**

```bash
git add app/models/step.py app/schemas/recipe.py app/routers/recipes.py alembic/versions/ tests/test_living_recipe.py
git commit -m "feat: step voice_note — the person's words woven into a step"
```

---

## Task 2: `measures.js` — celebrate imprecise amounts

**Files:**
- Create: `frontend/src/lib/measures.js`
- Test: `frontend/src/lib/measures.test.js` (create)

**Interfaces:**
- Produces:
  - `isImprecise(ingredient) -> boolean` — true when `ingredient.quantity_type` is `"imprecise"` or `"unmeasured"`.
  - `impreciseLabel() -> string` — the small tag text: `"their way"`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/measures.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { isImprecise, impreciseLabel } from './measures'

describe('measures', () => {
  it('imprecise amounts are flagged', () => {
    expect(isImprecise({ quantity_type: 'imprecise' })).toBe(true)
    expect(isImprecise({ quantity_type: 'unmeasured' })).toBe(true)
  })
  it('precise amounts are not', () => {
    expect(isImprecise({ quantity_type: 'precise' })).toBe(false)
    expect(isImprecise({})).toBe(false)
  })
  it('the tag reads warm, not clinical', () => {
    expect(impreciseLabel()).toBe('their way')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/measures.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `frontend/src/lib/measures.js`**

```js
// Imprecise measures are TRUTH, not a defect — "a dash", "3 soup spoons",
// "until it smells right". We tag them (never normalize them) so the person's
// way of cooking is celebrated. See living-recipe spec §1.1 / §8.2.

export function isImprecise(ingredient) {
  const t = ingredient?.quantity_type
  return t === 'imprecise' || t === 'unmeasured'
}

export function impreciseLabel() {
  return 'their way'
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/measures.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/measures.js frontend/src/lib/measures.test.js
git commit -m "feat: measures lib — flag imprecise amounts as a celebrated feature"
```

---

## Task 3: `Provenance` component

**Files:**
- Create: `frontend/src/components/Provenance.jsx`
- Test: `frontend/src/components/Provenance.test.jsx` (create)

**Interfaces:**
- Consumes: a recipe object (`origin_attribution`, `author_full_name`).
- Produces: `<Provenance recipe={recipe} />` — renders a small "🌱 origin → keeper" line. If `origin_attribution` present: shows the origin's leading name (the part before the first `·`) → the author. If no origin: just `🌱 <author_full_name>`. Renders nothing if neither exists.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/Provenance.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import Provenance from './Provenance'

describe('Provenance', () => {
  it('shows origin → keeper when there is a ghost ancestor', () => {
    const { container } = render(<Provenance recipe={{
      origin_attribution: 'Lola Remedios · Cebu · 1950s', author_full_name: 'Yoko Matsuda' }} />)
    const t = container.textContent
    expect(t).toContain('Lola Remedios')
    expect(t).toContain('Yoko Matsuda')
    expect(t).toContain('→')
  })
  it('shows just the keeper when there is no origin', () => {
    const { container } = render(<Provenance recipe={{ author_full_name: 'Yoko Matsuda' }} />)
    expect(container.textContent).toContain('Yoko Matsuda')
    expect(container.textContent).not.toContain('→')
  })
  it('renders nothing when there is neither', () => {
    const { container } = render(<Provenance recipe={{}} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/Provenance.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `frontend/src/components/Provenance.jsx`**

```jsx
// The provenance line — "🌱 Lola → you". Built from origin_attribution (the ghost
// ancestor) + the recipe's keeper. Reads fine at 1 node; no tree/network needed.
// See living-recipe spec §1.2.
export default function Provenance({ recipe }) {
  const origin = recipe.origin_attribution
    ? recipe.origin_attribution.split('·')[0].trim()
    : null
  const keeper = recipe.author_full_name || null
  if (!origin && !keeper) return null

  return (
    <p className="font-sans text-[11px] text-ink-soft flex items-center gap-1.5">
      <span aria-hidden="true">🌱</span>
      {origin && keeper ? (
        <span>{origin} <span className="text-growth">→</span> {keeper}</span>
      ) : (
        <span>{origin || keeper}</span>
      )}
    </p>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/components/Provenance.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Provenance.jsx frontend/src/components/Provenance.test.jsx
git commit -m "feat: Provenance line component (origin → keeper)"
```

---

## Task 4: Weave it into RecipeDetail — quotes, imprecise tags, provenance

**Files:**
- Modify: `frontend/src/pages/RecipeDetail.jsx`
- Test: `frontend/src/pages/RecipeDetail.test.jsx` (extend)

**Interfaces:**
- Consumes: `Provenance` (T3), `isImprecise`/`impreciseLabel` (T2), `voice_note` on steps (T1).
- Produces: RecipeDetail renders (a) the `<Provenance>` line under the byline; (b) an imprecise "their way" tag on ingredient rows where `isImprecise(ing)`; (c) a step's `voice_note` as a quote beneath that step (font-hand, terra rule).

- [ ] **Step 1: Write the failing tests (extend RecipeDetail.test.jsx)**

Read the existing `RecipeDetail.test.jsx` to match its mock/render pattern (it mocks `../api/client` + `../api/lineage`). Add:

```jsx
it('shows a woven voice-note quote under its step', async () => {
  // mock client.get to return a recipe with a step voice_note
  // (follow the file's existing mocking pattern; recipe has steps:[{id,position,content,voice_note}])
  // then assert the quote text is in the document
})
it('tags an imprecise ingredient as "their way"', async () => {
  // recipe with an ingredient quantity_type:'imprecise'
  // assert /their way/i present; and NOT present for a precise-only recipe
})
```

(Write these concretely against the file's actual mock setup — the pattern is `vi.mock('../api/client', ...)` returning `{ default: { get: vi.fn(() => Promise.resolve({ data: RECIPE })) } }`. Use `findByText` for async.)

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/pages/RecipeDetail.test.jsx`
Expected: FAIL — quote + tag not rendered yet.

- [ ] **Step 3: Add imports + provenance line**

In `RecipeDetail.jsx`: `import Provenance from '../components/Provenance'` and `import { isImprecise, impreciseLabel } from '../lib/measures'`. Render `<Provenance recipe={recipe} />` right under the "kept by" byline block (inside the header area).

- [ ] **Step 4: Tag imprecise ingredients**

In the ingredients map, when `isImprecise(ing)` render a small tag after the name:

```jsx
<span className="text-ink">
  {ing.name}
  {isImprecise(ing) && (
    <span className="ml-1.5 align-middle text-[8.5px] font-sans text-brown border border-line rounded px-1 py-px">
      {impreciseLabel()}
    </span>
  )}
  {ing.notes && <span className="text-ink-soft italic"> — {ing.notes}</span>}
</span>
```

(`text-brown` may not be a token — use `text-ink-soft` if not; keep it subtle.)

- [ ] **Step 5: Weave the voice-note quote under its step**

In the steps map, after the `<p>` step content, when `step.voice_note` is present:

```jsx
{step.voice_note && (
  <p className="mt-1.5 pl-2.5 border-l-2 border-terra/50 font-hand text-[15px] text-brown leading-snug">
    "{step.voice_note}"
  </p>
)}
```

Ensure the step row is a flex column so the quote sits under the content (wrap content + quote in a `<div className="flex-1">`).

- [ ] **Step 6: Run to verify pass + full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/RecipeDetail.jsx frontend/src/pages/RecipeDetail.test.jsx
git commit -m "feat: living recipe page — provenance, imprecise tags, woven step quotes"
```

---

## Task 5: Warm-invitational empty state

**Files:**
- Modify: `frontend/src/pages/RecipeDetail.jsx`
- Test: `frontend/src/pages/RecipeDetail.test.jsx` (extend)

**Interfaces:**
- Consumes: recipe soul fields (`story`, `cover_photo_url`).
- Produces: for the OWNER, when a soul field is absent, a soft invitation appears (not a nag). Specifically: when `!recipe.story`, show a gentle "Add a memory of [origin/author]" invite where the story block would be. Only for the owner (non-owners just see a clean page). Invitations read as opportunities.

- [ ] **Step 1: Write the failing test**

```jsx
it('offers the owner a warm invitation when there is no story', async () => {
  // recipe owned by the current user, story: null
  // assert an invite like /add a memory/i is present
})
it('does NOT show the invitation to a non-owner', async () => {
  // recipe.user_id != current user; story null
  // assert /add a memory/i NOT present
})
```

(Owner detection in RecipeDetail is `currentUser.id === recipe.user_id`, from `localStorage.issei_user`. The test sets `localStorage.setItem('issei_user', JSON.stringify({id: N}))` to match/not-match.)

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/pages/RecipeDetail.test.jsx`
Expected: FAIL — no invitation.

- [ ] **Step 3: Add the invitation (owner + no story)**

Where the story block renders, add an `else` branch — when `isOwner && !recipe.story`:

```jsx
{isOwner && !recipe.story && (
  <button
    onClick={() => navigate(`/recipes/${recipe.id}/edit`)}
    className="mt-[15px] w-full text-left rounded-xl border border-dashed border-line bg-card/60 px-[15px] py-3"
  >
    <span className="font-serif italic text-[13px] text-brown">
      Whose hands does this come from? Add a memory ↦
    </span>
  </button>
)}
```

(Use `text-ink-soft` if `text-brown` isn't a token. Keep it a warm door, not an alert.)

- [ ] **Step 4: Run to verify pass + full suite**

Run: `cd frontend && npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/RecipeDetail.jsx frontend/src/pages/RecipeDetail.test.jsx
git commit -m "feat: warm-invitational empty state on the recipe page (owner, no story)"
```

---

## Task 6: Capture voice-notes in the recipe form (so quotes can be entered)

**Files:**
- Modify: `frontend/src/components/RecipeForm.jsx`
- Test: `frontend/src/components/RecipeForm.test.jsx` (extend if it asserts step fields)

**Interfaces:**
- Consumes: the `voice_note` field on steps (T1 backend).
- Produces: each step row in the form has an optional "their words (a saying for this step)" input that maps to `step.voice_note`; the payload sent to the API includes `voice_note` per step.

- [ ] **Step 1: Read `RecipeForm.jsx` + its payload builder**

Steps are edited in `RecipeForm.jsx` and the payload is built in `frontend/src/lib/lineagePayload.js` (or inline). Find where a step object is created/collected (`content`, `position`, `section_header`) and where the steps array is serialized for the API. Confirm the shape.

- [ ] **Step 2: Write the failing test (extend RecipeForm.test.jsx)**

Add a test that: renders the form, types into a step's voice-note input, submits, and asserts the submit handler received a step with `voice_note` set. (Match the file's existing submit-assertion pattern; if it calls an `onSubmit` prop with the payload, assert on that.)

Run: `cd frontend && npx vitest run src/components/RecipeForm.test.jsx` → FAIL.

- [ ] **Step 3: Add the voice-note input per step**

In the step editor row, add an optional text input bound to that step's `voice_note` (placeholder: `Their words for this step (optional) — "don't rush the onions"`). Follow the existing per-step field pattern (how `content` is bound). Ensure the step state object carries `voice_note` and the payload includes it.

- [ ] **Step 4: Run to verify pass + full suite**

Run: `cd frontend && npx vitest run`
Expected: all pass.

**IMPORTANT — confirmed coupling:** `frontend/src/lib/lineagePayload.js:25` currently maps steps as `.map((s) => ({ content: s.content }))` — it keeps ONLY `content`, dropping every other step key. This is the REMIX pre-fill builder (`buildRemixInitialValues`). For voice-notes to survive a remix pre-fill, add `voice_note: s.voice_note` (and, while there, `section_header: s.section_header` is currently dropped too — but do NOT expand scope to fix that here; only add `voice_note`, and note the pre-existing section_header drop for the final review). Update `lineagePayload.test.js` accordingly. Note: the primary PLANT/create path is `RecipeForm`'s own state → the create payload; the lineagePayload builder is specifically the remix seed, so its step mapping matters for remix pre-fill, not first-plant.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RecipeForm.jsx frontend/src/lib/lineagePayload.js frontend/src/components/RecipeForm.test.jsx frontend/src/lib/lineagePayload.test.js
git commit -m "feat: capture per-step voice-notes in the recipe form"
```

---

## Task 7: Visual verification + docs

**Files:** reuse the demo stack + a Playwright driver; `ARCHITECTURE.md`.

- [ ] **Step 1: Suites + build green**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q` and `cd frontend && npx vite build`
Expected: both succeed.

- [ ] **Step 2: Visual-verify the living recipe page**

Isolated demo (throwaway SQLite :8010, Vite :5183). Seed a rich recipe: a story, an origin ("Lola Remedios · Cebu · 1950s"), imprecise ingredients ("a good splash" / "3 soup spoons", quantity_type imprecise), steps WITH voice_notes. And a bare recipe (name + ingredients only) owned by the demo user. Screenshot: (a) the rich recipe detail — confirm provenance line, "their way" tags, woven quotes under steps read well; (b) the bare recipe — confirm the warm "add a memory" invitation shows for the owner and the page feels calm, not broken. Note console errors (expect 0).

- [ ] **Step 3: Docs**

`ARCHITECTURE.md`: note `Step.voice_note`, the `Provenance` component + `measures.js`, and that the recipe page renders the three registers (story / woven quotes / imprecise tags) + provenance + owner empty-state invitations. (Keep it a few lines.)

- [ ] **Step 4: Commit**

```bash
git add ARCHITECTURE.md frontend/tests/visual/
git commit -m "docs: document the living recipe page; visual-verify"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** story lead (already rendered; kept) + woven quotes (T1 backend field + T4 render + T6 capture) + imprecise-as-feature (T2 + T4) + provenance (T3 + T4) + warm empty state (T5). All of §1.
- **The story block already exists** in RecipeDetail (terra band) — do NOT rebuild it; the plan adds the *other* registers around it. Task 5 adds the empty-state branch for when it's absent.
- **No network call for provenance:** MVP builds the line from `origin_attribution` + `author_full_name` on the recipe itself. The richer multi-generation "Lola → Mom → you" (walking real app-user ancestors) needs the lineage endpoint and is a later concern — the spec explicitly says the line "reads fine at 1 node." Don't pull in the tree.
- **Imprecise tag is display-only:** never mutate `quantity_text`/`quantity_type`; scaling already preserves imprecise amounts (existing `scaling.py` behavior). This task only *labels* them.
- **`text-brown` token check:** the Tailwind palette has `ink`/`ink-soft`/`terra`/`saffron`/`herb`/`plum` but likely NOT `brown`. Where the plan writes `text-brown`, the implementer must use an existing token (`text-ink-soft` or `text-terra`) — flagged in the tasks; verify against `tailwind.config.js`.
- **Migration safety:** `add_column` is SQLite-safe (unlike the drop_constraint TECHDEBT (f) migrations). Verify in isolation per Task 1 Step 7; don't attempt a full from-scratch `upgrade head`.
- **`font-hand` for quotes:** the woven quote is the one place on this page the handwritten hand is used (a "special moment" per the identity spec) — that's intentional, not a violation of "hand for logo only."
- **RecipeForm/lineagePayload coupling:** Task 6 depends on how the payload is built; if `lineagePayload.js` explicitly lists step keys, `voice_note` must be added there or it'll be silently dropped — the task calls this out.
