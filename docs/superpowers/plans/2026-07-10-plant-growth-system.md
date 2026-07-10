# Plant & Growth System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old remix-driven growth mark with the designed seed→sprout→sapling→tree system: two-axis growth (stage from soul+use, vitality from repeated use), backed by new server-computed fields and rendered by a production Plant SVG component.

**Architecture:** The backend's `_attach_growth_fields` (in `app/routers/recipes.py`) is the single place growth data is computed; it gains the new fields (`growth_stage`, `growth_vitality`, `soul_count`). A new pure module `frontend/src/lib/growth.js` derives stage+vitality (reading server fields, with a defensive client fallback), replacing `growthState.js`. A new `frontend/src/components/Plant.jsx` renders the four stages × three vitality states, replacing `GrowthMark.jsx`. Cook-notes (already a column on `CookEvent`) get surfaced on the cook action so divergence is captured (remix is cut). Consumers (`RecipeCard`, `RecipeDetail`) swap to the new component/lib.

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic + pytest (backend); React 18 + Vite + Tailwind + Vitest/RTL (frontend).

## Global Constraints

- **Specs:** growth logic in `docs/superpowers/specs/2026-07-09-living-recipe-growth-design.md` §2 (incl. the 2026-07-10 refinement note); plant art in `docs/superpowers/specs/2026-07-10-visual-identity-design.md` §2.
- **Two axes (verbatim):** STAGE (seed→sprout→sapling→tree) from breadth of dimensions; VITALITY (bare→blooming→fruiting) from repeated use, on Sapling & Tree only.
- **Stage rules (verbatim, incl. the refinement):**
  - **Seed** = nothing done yet (just a name + basics).
  - **Sprout** = first sign of life: ONE dimension (a memory/story, OR first cook, OR a photo).
  - **Sapling** = ~3 dimensions filled, OR heavy use (a genuinely-used recipe grows up).
  - **Tree** = a full heirloom — requires SOUL (story/photo/etc.); **use alone can NOT reach Tree.**
  - **USE advances stage up to Sapling max; only SOUL reaches Tree.** Asymmetry is the point.
- **Vitality (verbatim):** bare → blooming → fruiting, driven by repeated cooking/sharing; **caps at fruiting** (further use → milestones, not more plant); **Sapling & Tree only** — Seed & Sprout are single states.
- **Soul dimensions (what counts for stage), using fields that exist today:** has a story (`story`), has a photo (`cover_photo_url`), has an origin/ghost ancestor (`origin_attribution`), has notes (`notes`). ("The person's words / woven quote" is a *later* sub-project's field — NOT part of growth now.) **Imprecise measures do NOT count toward growth** (spec §2.3).
- **Cook-notes:** `CookEvent.note` already exists (nullable). Surface an optional note on the cook action; it's how divergence is captured now that remix is cut.
- **Plant colors (verbatim):** foliage herb-green family (`#6F8A4D` base, `#8AA36A` light, `#7E9758` mid); stem/trunk bark-brown `#7A5638`; seed `#8B5E3C`/`#6B4426`; blossom soft pink `#E7A0B8`; fruit terra `#BD5A2C` + saffron `#D99A2B`. Use the `growth` Tailwind role where a token fits.
- **Distinct-object principle (verbatim §2.1):** each stage is its own shape (not one tree at 4 sizes). Bare glyph is the source of truth; NO pots here (pots are the garden-strip's job, a later sub-project).
- **Run backend tests:** `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q`. **Frontend:** `cd frontend && npx vitest run`.
- **Don't git commit without explicit user approval.** Per-task Commit steps stage + write the message; a human approves.

---

## File Structure

**Backend:**
- `app/services/growth.py` (create) — pure functions: `soul_count(recipe)`, `growth_stage(recipe, cook_count, soul)`, `growth_vitality(cook_count, share_count)`. Unit-testable without HTTP/DB.
- `app/routers/recipes.py` — `_attach_growth_fields` calls the service, attaches `growth_stage`, `growth_vitality`, `soul_count`. `cook_recipe` accepts an optional `note`.
- `app/schemas/recipe.py` — `RecipeResponse` gains `growth_stage: str`, `growth_vitality: str`, `soul_count: int`. `CookIn` already has `note` (confirm).
- `tests/test_growth.py` (create) — the stage/vitality matrix + the endpoint fields.

**Frontend:**
- `frontend/src/lib/growth.js` (create) — `stageForRecipe(recipe)` + `vitalityForRecipe(recipe)`: prefer server `growth_stage`/`growth_vitality`; fall back to a client computation. Replaces `growthState.js`.
- `frontend/src/components/Plant.jsx` (create) — `<Plant stage vitality size />`; the 4×3 SVG system. Replaces `GrowthMark.jsx`.
- `frontend/src/components/RecipeCard.jsx`, `frontend/src/pages/RecipeDetail.jsx` — swap `GrowthMark`/`growthState` → `Plant`/`growth`.
- Co-located `*.test.*`.
- **Remove** `growthState.js` + `GrowthMark.jsx` (+ their tests) once consumers migrate.

---

## Task 1: Backend growth service (pure logic)

**Files:**
- Create: `app/services/growth.py`
- Test: `tests/test_growth.py` (create)

**Interfaces:**
- Produces:
  - `soul_count(recipe) -> int` — number of soul dimensions present: story (`recipe.story` truthy), photo (`recipe.cover_photo_url` truthy), origin (`recipe.origin_attribution` truthy), notes (`recipe.notes` truthy). Range 0–4.
  - `growth_stage(soul, cook_count) -> str` — returns `"seed"|"sprout"|"sapling"|"tree"`.
  - `growth_vitality(cook_count, share_count) -> str` — returns `"bare"|"blooming"|"fruiting"`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_growth.py`:

```python
from app.services.growth import growth_stage, growth_vitality


def test_seed_is_nothing_done():
    assert growth_stage(soul=0, cook_count=0) == "seed"


def test_sprout_from_one_dimension():
    assert growth_stage(soul=1, cook_count=0) == "sprout"   # a memory/photo
    assert growth_stage(soul=0, cook_count=1) == "sprout"   # or first cook


def test_sapling_from_soul_breadth():
    assert growth_stage(soul=3, cook_count=0) == "sapling"


def test_use_advances_to_sapling_but_not_tree():
    # heavy use, no soul → grows UP to sapling, never tree
    assert growth_stage(soul=0, cook_count=50) == "sapling"


def test_tree_requires_soul():
    # rich soul (all 4 dimensions) → tree
    assert growth_stage(soul=4, cook_count=1) == "tree"
    # even huge use can't reach tree without enough soul
    assert growth_stage(soul=1, cook_count=999) != "tree"


def test_vitality_states():
    assert growth_vitality(cook_count=0, share_count=0) == "bare"
    assert growth_vitality(cook_count=3, share_count=0) == "blooming"
    assert growth_vitality(cook_count=30, share_count=2) == "fruiting"
    # caps: 30 and 300 both fruiting (no higher state)
    assert growth_vitality(cook_count=300, share_count=9) == "fruiting"
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_growth.py -v`
Expected: FAIL — `ModuleNotFoundError: app.services.growth`.

- [ ] **Step 3: Implement `app/services/growth.py`**

```python
"""Growth model: stage (breadth of dimensions + use) and vitality (repeated use).
See the living-recipe spec §2 + its 2026-07-10 refinement.

Two axes:
  STAGE   seed → sprout → sapling → tree.  USE advances up to SAPLING; only SOUL
          reaches TREE (a beloved-but-untold recipe caps at sapling).
  VITALITY bare → blooming → fruiting (Sapling & Tree only; caps at fruiting).
"""

# tunable thresholds
_SAPLING_SOUL = 3      # soul dimensions to reach sapling by breadth
_TREE_SOUL = 3         # soul dimensions required for tree (use can't substitute)
_HEAVY_USE = 5         # cooks that count as "genuinely used" → grows up to sapling
_BLOOM_COOKS = 2       # activity to start blooming
_FRUIT_COOKS = 12      # activity to fruit (then caps)


def soul_count(recipe) -> int:
    """How many soul dimensions are present (0-4)."""
    return sum(bool(getattr(recipe, f, None)) for f in
               ("story", "cover_photo_url", "origin_attribution", "notes"))


def growth_stage(soul: int, cook_count: int) -> str:
    # Tree requires soul; use alone can never get here.
    if soul >= _TREE_SOUL and (cook_count >= 1 or soul >= 4):
        return "tree"
    # Sapling: enough soul breadth, OR genuinely used (grows up on use).
    if soul >= _SAPLING_SOUL or cook_count >= _HEAVY_USE:
        return "sapling"
    # Sprout: any single sign of life.
    if soul >= 1 or cook_count >= 1:
        return "sprout"
    return "seed"


def growth_vitality(cook_count: int, share_count: int) -> str:
    activity = cook_count + share_count
    if activity >= _FRUIT_COOKS:
        return "fruiting"
    if activity >= _BLOOM_COOKS:
        return "blooming"
    return "bare"
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_growth.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/growth.py tests/test_growth.py
git commit -m "feat: growth service — stage (soul+use) & vitality (repeated use)"
```

---

## Task 2: Attach growth fields to the recipe API

**Files:**
- Modify: `app/routers/recipes.py` (`_attach_growth_fields`)
- Modify: `app/schemas/recipe.py` (`RecipeResponse`)
- Test: `tests/test_growth.py` (extend)

**Interfaces:**
- Consumes: `soul_count`, `growth_stage`, `growth_vitality` (Task 1); `shared_with_count` (already computed in `_attach_growth_fields`).
- Produces: `RecipeResponse` gains `growth_stage: str = "seed"`, `growth_vitality: str = "bare"`, `soul_count: int = 0`. The recipe GET returns them.

- [ ] **Step 1: Write the failing test (extend `tests/test_growth.py`)**

```python
def test_recipe_response_has_growth_fields(client, make_user):
    _, headers = make_user()
    payload = {"name": "Adobo",
               "story": "Lola made it every Sunday",
               "ingredients": [{"name": "chicken", "quantity_text": "2 lbs",
                                "quantity_type": "precise", "position": 1}],
               "steps": [{"content": "Cook", "position": 1}]}
    r = client.post("/recipes", json=payload, headers=headers)
    body = r.json()
    assert body["growth_stage"] == "sprout"   # 1 soul dimension (story), 0 cooks
    assert body["growth_vitality"] == "bare"
    assert body["soul_count"] == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_growth.py -k growth_fields -v`
Expected: FAIL — `KeyError: 'growth_stage'`.

- [ ] **Step 3: Add the fields to `RecipeResponse`**

In `app/schemas/recipe.py`, add to `RecipeResponse` (near the other growth fields, ~line 130-135):

```python
    growth_stage: str = "seed"
    growth_vitality: str = "bare"
    soul_count: int = 0
```

- [ ] **Step 4: Compute them in `_attach_growth_fields`**

In `app/routers/recipes.py`, add `from app.services.growth import soul_count, growth_stage, growth_vitality` at the top. In `_attach_growth_fields`, after `recipe.shared_with_count = ...` and before `return recipe`:

```python
    soul = soul_count(recipe)
    recipe.soul_count = soul
    recipe.growth_stage = growth_stage(soul, recipe.cook_count)
    recipe.growth_vitality = growth_vitality(recipe.cook_count, recipe.shared_with_count)
```

- [ ] **Step 5: Run to verify pass + full backend suite**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q`
Expected: all pass. (`_attach_growth_fields` runs on list/browse/shared/get — confirm none break; the new fields have defaults so serialization is safe on the scaled-recipe path too.)

- [ ] **Step 6: Commit**

```bash
git add app/routers/recipes.py app/schemas/recipe.py tests/test_growth.py
git commit -m "feat: expose growth_stage/growth_vitality/soul_count on RecipeResponse"
```

---

## Task 3: Cook-notes on the cook action

**Files:**
- Modify: `app/routers/recipes.py` (`cook_recipe`) — confirm/wire the note
- Test: `tests/test_growth.py` (extend)

**Interfaces:**
- Consumes: `CookIn` (already has `photo_url`, `note`).
- Produces: `POST /recipes/{id}/cook` persists the optional `note` on the `CookEvent`. (This is the divergence-capture path now that remix is cut.)

- [ ] **Step 1: Write the failing test**

```python
def test_cook_note_is_persisted(client, make_user, db_session):
    from app.models.cook_event import CookEvent
    _, headers = make_user()
    root = client.post("/recipes", json={"name": "Adobo",
        "ingredients": [{"name": "x", "quantity_text": "1", "quantity_type": "precise", "position": 1}],
        "steps": []}, headers=headers).json()
    client.post(f"/recipes/{root['id']}/cook",
                json={"note": "I used coconut milk instead"}, headers=headers)
    ev = db_session.query(CookEvent).filter_by(recipe_id=root["id"]).one()
    assert ev.note == "I used coconut milk instead"
```

- [ ] **Step 2: Run to verify failure or pass**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_growth.py -k cook_note -v`
Expected: If `cook_recipe` already reads `cook_in.note` (it may — verify), this passes immediately; then this task is a no-op confirmation + a regression test. If it does NOT persist the note, it FAILS.

- [ ] **Step 3: Wire the note if needed**

Read `cook_recipe` in `app/routers/recipes.py`. It already builds `CookEvent(recipe_id=..., user_id=..., photo_url=(cook_in.photo_url if cook_in else None), note=(cook_in.note if cook_in else None))`. If the `note=` is already present, no code change is needed — the test just guards it. If missing, add `note=(cook_in.note if cook_in else None)` to the `CookEvent(...)` construction.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/test_growth.py -k cook_note -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/routers/recipes.py tests/test_growth.py
git commit -m "test: guard cook-note persistence (divergence capture)"
```

---

## Task 4: Frontend growth lib (`growth.js`)

**Files:**
- Create: `frontend/src/lib/growth.js`
- Test: `frontend/src/lib/growth.test.js` (create)

**Interfaces:**
- Produces:
  - `stageForRecipe(recipe) -> 'seed'|'sprout'|'sapling'|'tree'` — returns `recipe.growth_stage` when present (server-computed, the source of truth); otherwise falls back to a client computation mirroring the backend (soul dimensions + cook_count).
  - `vitalityForRecipe(recipe) -> 'bare'|'blooming'|'fruiting'` — returns `recipe.growth_vitality` when present; else client fallback from `cook_count` + `shared_with_count`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/growth.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { stageForRecipe, vitalityForRecipe } from './growth'

describe('growth lib', () => {
  it('prefers server growth_stage', () => {
    expect(stageForRecipe({ growth_stage: 'tree' })).toBe('tree')
  })
  it('prefers server growth_vitality', () => {
    expect(vitalityForRecipe({ growth_vitality: 'fruiting' })).toBe('fruiting')
  })
  it('falls back to client compute (seed when empty)', () => {
    expect(stageForRecipe({})).toBe('seed')
  })
  it('client fallback: a story alone → sprout', () => {
    expect(stageForRecipe({ story: 'Lola made it' })).toBe('sprout')
  })
  it('client fallback: heavy use, no soul → sapling (not tree)', () => {
    expect(stageForRecipe({ cook_count: 50 })).toBe('sapling')
  })
  it('client fallback vitality: many cooks → fruiting', () => {
    expect(vitalityForRecipe({ cook_count: 30 })).toBe('fruiting')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/growth.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `frontend/src/lib/growth.js`**

```js
// Growth stage + vitality for a recipe. The server computes these
// (recipe.growth_stage / recipe.growth_vitality) and is the source of truth;
// this mirrors the backend as a defensive fallback. See growth spec §2.

const SAPLING_SOUL = 3
const TREE_SOUL = 3
const HEAVY_USE = 5
const BLOOM = 2
const FRUIT = 12

function soulCount(r) {
  return [r.story, r.cover_photo_url, r.origin_attribution, r.notes]
    .filter(Boolean).length
}

export function stageForRecipe(recipe) {
  if (recipe.growth_stage) return recipe.growth_stage
  const soul = soulCount(recipe)
  const cooks = recipe.cook_count || 0
  if (soul >= TREE_SOUL && (cooks >= 1 || soul >= 4)) return 'tree'
  if (soul >= SAPLING_SOUL || cooks >= HEAVY_USE) return 'sapling'
  if (soul >= 1 || cooks >= 1) return 'sprout'
  return 'seed'
}

export function vitalityForRecipe(recipe) {
  if (recipe.growth_vitality) return recipe.growth_vitality
  const activity = (recipe.cook_count || 0) + (recipe.shared_with_count || 0)
  if (activity >= FRUIT) return 'fruiting'
  if (activity >= BLOOM) return 'blooming'
  return 'bare'
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/growth.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/growth.js frontend/src/lib/growth.test.js
git commit -m "feat: frontend growth lib (server-first, client fallback)"
```

---

## Task 5: The production Plant component

**Files:**
- Create: `frontend/src/components/Plant.jsx`
- Test: `frontend/src/components/Plant.test.jsx` (create)

**Interfaces:**
- Consumes: nothing (pure SVG art keyed by props).
- Produces: `<Plant stage="seed|sprout|sapling|tree" vitality="bare|blooming|fruiting" size={n} className />`. Renders an SVG with `data-stage` and `data-vitality` attributes (for tests + styling). Vitality decoration (blossoms/fruit) renders ONLY for `sapling`/`tree`; ignored for seed/sprout. Blossoms = soft pink `#E7A0B8`; fruit = terra `#BD5A2C` + saffron `#D99A2B`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/Plant.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import Plant from './Plant'

describe('Plant', () => {
  it('renders the requested stage + vitality as data attrs', () => {
    const { container } = render(<Plant stage="tree" vitality="fruiting" />)
    const svg = container.querySelector('svg')
    expect(svg.getAttribute('data-stage')).toBe('tree')
    expect(svg.getAttribute('data-vitality')).toBe('fruiting')
  })
  it('a bare seed renders no fruit/blossom accents', () => {
    const { container } = render(<Plant stage="seed" vitality="bare" />)
    expect(container.querySelectorAll('[data-accent]').length).toBe(0)
  })
  it('a fruiting tree renders fruit accents', () => {
    const { container } = render(<Plant stage="tree" vitality="fruiting" />)
    expect(container.querySelectorAll('[data-accent="fruit"]').length).toBeGreaterThan(0)
  })
  it('seed ignores vitality (no accents even if fruiting passed)', () => {
    const { container } = render(<Plant stage="seed" vitality="fruiting" />)
    expect(container.querySelectorAll('[data-accent]').length).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/Plant.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `frontend/src/components/Plant.jsx`**

Render each stage as its own distinct shape (per spec §2.1/§2.2), on a `24x24`-ish viewBox scaled by `size`. Colors per Global Constraints. Vitality accents (`data-accent="blossom"` pink / `data-accent="fruit"` terra+saffron) render only for sapling/tree.

```jsx
// The seed→tree plant mark. Each stage is its OWN shape (not one tree at 4 sizes):
// seed = teardrop kernel · sprout = 2-leaf shoot · sapling = baby tree (trunk +
// stubs + small canopy) · tree = trunk + 3-puff canopy. Vitality (bare→blooming→
// fruiting) adds blossom/fruit accents on sapling & tree only. See visual-identity
// spec §2. Colors: herb-green foliage, bark-brown stem, pink blossom, terra/saffron fruit.
const BARK = '#7A5638'
const G1 = '#6F8A4D', G2 = '#8AA36A', G3 = '#7E9758'
const SEED_A = '#8B5E3C', SEED_B = '#6B4426'
const BLOSSOM = '#E7A0B8', FRUIT_T = '#BD5A2C', FRUIT_S = '#D99A2B'

function accents(stage, vitality) {
  if (stage !== 'sapling' && stage !== 'tree') return null
  if (vitality === 'bare') return null
  // positions differ a touch by stage; keep simple + legible
  const pts = stage === 'tree'
    ? [[-8, -13], [6, -10], [0, -20], [11, -15]]
    : [[-6, -13], [6, -14], [0, -18]]
  const fill = vitality === 'fruiting'
    ? (i) => (i % 2 ? FRUIT_S : FRUIT_T)
    : () => BLOSSOM
  const type = vitality === 'fruiting' ? 'fruit' : 'blossom'
  const r = vitality === 'fruiting' ? 2.6 : 2.4
  return pts.map(([x, y], i) => (
    <circle key={i} data-accent={type} cx={x} cy={y} r={r} fill={fill(i)} />
  ))
}

const STAGES = {
  seed: (
    <g>
      <path d="M0,10 C7,4 7,-6 0,-10 C-7,-6 -7,4 0,10Z" fill={SEED_A} />
      <path d="M0,10 C7,4 7,-6 0,-10Z" fill={SEED_B} />
    </g>
  ),
  sprout: (
    <g>
      <path d="M0,11 C0,4 0,0 0,-6" stroke={G1} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M0,-2 C-9,-4 -11,-13 -2,-11 C-1,-6 0,-4 0,-2Z" fill={G1} />
      <path d="M0,-4 C9,-6 11,-15 2,-12 C1,-7 0,-6 0,-4Z" fill={G2} />
    </g>
  ),
  sapling: (
    <g>
      <path d="M0,11 L0,-6" stroke={BARK} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M0,0 L-4,-3 M0,-2 L4,-5" stroke={BARK} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="-4" cy="-10" r="6" fill={G1} />
      <circle cx="4" cy="-11" r="6" fill={G2} />
      <circle cx="0" cy="-15" r="6.5" fill={G3} />
    </g>
  ),
  tree: (
    <g>
      <path d="M0,12 L0,-4" stroke={BARK} strokeWidth="4.5" strokeLinecap="round" />
      <path d="M0,1 L-7,-4 M0,-2 L7,-6" stroke={BARK} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="-11" cy="-11" r="11" fill={G1} />
      <circle cx="11" cy="-12" r="11" fill={G2} />
      <circle cx="0" cy="-19" r="12" fill={G3} />
    </g>
  ),
}

export default function Plant({ stage = 'seed', vitality = 'bare', size = 28, className = '' }) {
  return (
    <svg
      data-stage={stage} data-vitality={vitality}
      width={size} height={size} viewBox="-24 -30 48 52"
      className={className} role="img" aria-label={`${vitality} ${stage}`}
    >
      {STAGES[stage] || STAGES.seed}
      {accents(stage, vitality)}
    </svg>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/components/Plant.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Plant.jsx frontend/src/components/Plant.test.jsx
git commit -m "feat: production Plant component (4 stages x 3 vitality)"
```

---

## Task 6: Migrate consumers + remove the old growth mark

**Files:**
- Modify: `frontend/src/components/RecipeCard.jsx`, `frontend/src/pages/RecipeDetail.jsx`
- Modify: `frontend/src/components/RecipeCard.test.jsx` (update to new attrs)
- Delete: `frontend/src/components/GrowthMark.jsx`, `frontend/src/components/GrowthMark.test.jsx`, `frontend/src/lib/growthState.js`, `frontend/src/lib/growthState.test.js`

**Interfaces:**
- Consumes: `Plant` (Task 5), `stageForRecipe`/`vitalityForRecipe` (Task 4).
- Produces: RecipeCard + RecipeDetail render `<Plant>` from the recipe's growth fields. No references to `GrowthMark`/`growthState` remain.

- [ ] **Step 1: Find every consumer**

Run: `cd frontend && grep -rn "GrowthMark\|growthState\|stateForRecipe\|bloomForRecipe" src/`
Expected references: `RecipeCard.jsx`, `RecipeDetail.jsx`, `PlantRecipe.jsx` (uses the word "seed" in copy — NOT the component; leave copy alone), and the old test files. Note each real usage.

- [ ] **Step 2: Update `RecipeCard.test.jsx` to the new contract (failing)**

The old test asserts `[data-growth-state="sapling"]` via child_count. Rewrite it to drive off the new fields + `Plant`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import RecipeCard from './RecipeCard'

vi.mock('./CoverImage', () => ({ default: () => <div data-testid="cover" /> }))

describe('RecipeCard plant', () => {
  it('renders the recipe growth stage from server fields', () => {
    const recipe = { id: 1, name: 'Adobo', growth_stage: 'sapling', growth_vitality: 'blooming' }
    const { container } = render(<RecipeCard recipe={recipe} onClick={() => {}} />)
    expect(container.querySelector('svg[data-stage="sapling"]')).toBeInTheDocument()
  })
})
```

Run: `cd frontend && npx vitest run src/components/RecipeCard.test.jsx` → FAIL (still renders GrowthMark).

- [ ] **Step 3: Migrate `RecipeCard.jsx`**

Replace the `GrowthMark`/`growthState` import + usage with:

```jsx
import Plant from './Plant'
import { stageForRecipe, vitalityForRecipe } from '../lib/growth'
// ...where the growth badge renders:
<Plant stage={stageForRecipe(recipe)} vitality={vitalityForRecipe(recipe)} size={22} />
```

Preserve the badge's existing position/wrapper styling.

- [ ] **Step 4: Migrate `RecipeDetail.jsx`**

Replace the `GrowthMark` + `stateForRecipe`/`bloomForRecipe` import/usage (currently ~line 118) with the `Plant` + `stageForRecipe`/`vitalityForRecipe` equivalent, same placement/size.

- [ ] **Step 5: Delete the old files**

```bash
git rm frontend/src/components/GrowthMark.jsx frontend/src/components/GrowthMark.test.jsx frontend/src/lib/growthState.js frontend/src/lib/growthState.test.js
```

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all pass; no test references the deleted modules. (If `RecipeDetail.test.jsx` mocked `growthState`, update its mock to `../lib/growth` with `stageForRecipe`/`vitalityForRecipe`.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: migrate RecipeCard + RecipeDetail to Plant; remove old GrowthMark/growthState"
```

---

## Task 7: Visual verification + docs

**Files:** reuse the isolated demo stack + a Playwright driver; `ARCHITECTURE.md`, `TECHDEBT.md`.

- [ ] **Step 1: Backend + frontend suites green**

Run: `DATABASE_URL="sqlite:///./recipes.db" JWT_SECRET=x /c/Users/chissman/issei/venv/Scripts/python -m pytest tests/ -q` and `cd frontend && npx vite build`
Expected: both succeed.

- [ ] **Step 2: Visual-verify the plant across stages**

Isolated demo (throwaway SQLite on :8010, Vite :5183 via `VITE_API_URL`). Seed recipes spanning the range: a bare seed (name only), a sprout (1 cook OR a story), a sapling (heavy cooks / no soul → confirm it's a sapling not a tree), a fruiting tree (full soul + many cooks). Screenshot Kitchen (garden of mixed plants) + a Recipe Detail. Confirm: each stage is a distinct shape; fruiting shows fruit accents; the heavy-use-no-soul recipe reads as a fruiting *sapling* (not a tree). Note console errors (expect 0).

- [ ] **Step 3: Docs**

`ARCHITECTURE.md`: note `app/services/growth.py` (stage/vitality logic), the new `RecipeResponse` growth fields, `Plant.jsx`/`growth.js` replacing `GrowthMark`/`growthState`, and that stage is soul+use (use caps at sapling; soul→tree). `TECHDEBT.md`: note the growth thresholds are tunable constants (may need real-usage calibration); note "the person's words / woven quote" isn't yet a soul dimension (arrives with the living-recipe page sub-project) and can be added to `soul_count` then.

- [ ] **Step 4: Commit**

```bash
git add ARCHITECTURE.md TECHDEBT.md frontend/tests/visual/
git commit -m "docs: document the plant & growth system; visual-verify stages"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** growth two-axis logic (T1), API exposure (T2), cook-notes/divergence (T3), frontend lib (T4), production plant art 4×3 (T5), consumer migration + old-code removal (T6), verify+docs (T7). The **use→sapling / soul→tree asymmetry** is explicitly tested (T1 `test_use_advances_to_sapling_but_not_tree` + `test_tree_requires_soul`).
- **Remix is cut (prior decision):** the old `stateForRecipe` drove sapling/tree off `child_count` (remixes). The new model deliberately ignores children for stage — do NOT reintroduce child-count-drives-stage. (Lineage/provenance still exists as data; it's just not the growth driver.)
- **Thresholds are tunable:** the exact soul/cook numbers (`_SAPLING_SOUL`, `_HEAVY_USE`, `_FRUIT_COOKS`, etc.) are first-pass; they live as named constants in one place (backend service + mirrored in `growth.js`) so calibration is a small change. Flagged in TECHDEBT (T7).
- **Server-first, client-fallback:** `growth.js` prefers server fields; the fallback exists for list contexts / optimistic UI. Keep the two computations in sync (same constants/logic) — a divergence would be a latent bug; note it for the final review.
- **Vitality only on sapling/tree:** enforced in `Plant.jsx` (`accents` returns null otherwise) AND conceptually in the model (seed/sprout are early). The Plant test guards "seed ignores vitality."
- **Plant art is directional, not final-final:** the SVG paths here are the production first cut of the designed shapes; a later identity-polish pass may refine curves. The *contract* (stages, vitality, data-attrs, colors) is what matters and is spec-locked.
- **`_attach_growth_fields` ordering:** growth_stage/vitality depend on `recipe.cook_count` and `recipe.shared_with_count` being set earlier in the same function — verify the new block is placed AFTER those assignments (T2 Step 4 does this).
