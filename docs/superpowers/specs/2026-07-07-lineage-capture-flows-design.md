# Lineage Capture Flows + Seed→Tree Identity — Design (sub-project 2)

**Status:** Design approved in direction (brainstorm 2026-07-07). Not yet planned
or built. This is **sub-project 2** of the lineage feature; sub-project 1
(backend & data model) is built and merged-ready on `lineage-mvp`. Parent spec:
`2026-07-06-lineage-tree-signature-feature-design.md`.

**Scope:** the four **capture flows** that connect the built backend to the UI —
**plant, remix, cook, handoff** — plus the **seed→tree motif system** and
**growth-state rules** that debut here (and become the app's identity, task #10).
Out of scope: the full cross-app identity rollout (task #10), the zoomed-out
whole-tree visualization (sub-project 3), notifications delivery infrastructure.

---

## 1. What already exists (the ground we build on)

**Backend (built, `lineage-mvp`):** all endpoints below exist and are tested.
- `POST /recipes` — create a root; optional `origin` object mints a ghost ancestor
  and sets `origin_attribution`. No `origin` → the user is the root.
- `POST /recipes/{id}/remix` — creates a single-parent child node; server
  auto-detects the ingredient/step diff and returns `prompt_key`
  (`ingredient_swap | step_change | general_change`). Body: `{ingredients, steps,
  prompt_answer}`.
- `POST /recipes/{id}/cook` — records a `CookEvent`, returns `{cook_count}`,
  creates **no** node. Body optional: `{photo_url, note}`.
- `POST /recipes/{id}/handoff` — owner-only; `{to_email | to_user_id, note}`;
  creates a `Handoff` in state `pending`.
- `GET /recipes/{id}/lineage` — the walkable spine + children + `{cooks, versions}`
  counts (visibility-gated).

**Frontend (built, `lineage-mvp`):** the Craft D redesign — `RecipeForm` (shared
add/edit), `RecipeDetail`, `RecipeCard`, `BottomNav`, etc. **Zero lineage calls
wired yet.** `client.js` reads `VITE_API_URL`.

**Backend follow-ups to fold in when touched (from sub-project 1 review):** align
the remix handler to the inheritance rule (carry `source`, pre-fill editable
`notes`, skip `story`); these flows assume that rule.

---

## 2. The seed→tree motif system (identity debut)

The signature visual language (approved 2026-07-07). Marks are **elegant inline
SVG** — botanical/letterpress, never cartoon. Palette from the parent spec
(terra `#BD5A2C`, herb-green `#6F8A4D` for living growth, saffron `#D99A2B`).

### 2.1 Growth states
A recipe visibly progresses through four marks. **This is the retention engine
made visible** (parent spec §1a).

| State | Mark | Meaning |
|---|---|---|
| **Seed** | seed nestled in soil | just planted (a new root or fresh remix) |
| **Sprout** | seed + first hairline shoot | cooked at least once |
| **Sapling** | small branching stem | has been remixed (has ≥1 child branch) |
| **Tree** | fuller branching form | a deep lineage (multiple generations / many branches) |

### 2.2 What advances the state — **the rule (decided 2026-07-08)**
Two independent signals, two meanings — so the mark encodes both *depth* and
*liveliness*:
- **Branches (lineage depth) drive the main seed→sapling→tree progression.** The
  tree literally grows as the dish travels and mutates across people. This is the
  structural, permanent growth.
- **Cooks — including the owner's own cooks — drive a "bloom / liveliness" layer**
  on top. Every `CookEvent` counts, *whoever* cooked it: this deliberately rewards
  a user for **continuing to make their own recipe**, not just logging it once, so
  a dish you cook weekly visibly thrives even if no one else has touched it (a
  beloved private recipe should never look like a dead seed). Going long uncooked
  lets it go quietly dormant (the garden's "bring this back to life" nudge). This
  layer is the reversible, activity growth.
- **The owner's own cook count is tracked and surfaced** (distinct from total
  cooks across everyone): "you've made this 12 times." It advances bloom and
  powers the "keep the flame" retention beat (parent §1a).
- Concretely for MVP, base state from lineage depth + any cooks:
  `seed` = 0 cooks & no children; `sprout` = ≥1 cook (owner's or anyone's), no
  children; `sapling` = ≥1 child; `tree` = children spanning ≥2 generations
  (grandchildren exist). Bloom/dormancy is a lighter visual modifier on top of the
  base state, driven by **cook frequency + recency** of `CookEvent`s.
  *(Exact thresholds are tunable knobs; the ordering is the locked part.)*

Data note: `CookEvent` already carries `user_id`, so the **owner's own cook count**
is derivable today (`cook_events` where `user_id == recipe.user_id`) with no schema
change — the flows/`stateForRecipe` just compute both totals.

### 2.3 Where marks appear
- **Recipe cards** (Home/Browse/Kitchen): a small growth-state mark corner-badge.
- **Kitchen-as-garden** (later; parent spec retention engine): the grid reads as a
  garden of trees at varying growth. MVP: the badge on each card is enough to
  seed this; the full "garden" reframe is a fast-follow.
- **Plant/cook/remix confirmation beats:** the mark animates/advances as the
  emotional payoff.

### 2.4 The seed mark & the coffee-bean note (scoped to the app icon)
The seed mark **in-context** (plant flow, growth badges, beats) reads fine — it's
specifically the **app icon** rendering of the bare terra seed that read as a
**coffee bean**. So the fix is icon-specific, not a constraint on the seed
everywhere. The seed mark is **open for design + color exploration** (shape, notch,
sprout cue, palette — herb-green shoot, saffron accents, etc.) as part of the
task #10 identity pass; only the app-icon lockup must be unambiguously *not* coffee
(a sprout cue and/or the wordmark resolves it). These flows reference the growth
states by name and can build against a provisional seed mark.

---

## 3. The four capture flows

All flows are **warm, low-friction, and answerable in a sentence**; only a
ghost ancestor's *name* is ever effectively required.

### 3.1 Plant (with the two doorways) → Handoff
Replaces today's straight-to-form `AddRecipe`. Steps:
1. **Doorway** — *"Where does this recipe begin?"* Two equally-honored cards
   (§parent 2.3/2.3a), each with a seed motif:
   - **"A seed passed to you"** → ghost-ancestor path.
   - **"A seed of your own"** → self-authored root.
2. **Origin capture:**
   - *Passed to you:* their **name** (required) + optional place/year + a **memory
     of them & the dish**. → becomes the `origin` object on `POST /recipes`.
   - *Your own:* one warm prompt — *"What made this yours?"* → stored in the
     recipe's **`story`**; no `origin` (the user is the root).
3. **The recipe form** — the existing `RecipeForm` fields (name, servings, cuisine,
   description, ingredients, steps, photo). Submits `POST /recipes` (with `origin`
   iff doorway A).
4. **"Planted!" beat** — the seed-sown moment: *"Grandma Yoko's Adobo is planted."*
   Growth-state = seed.
5. **Handoff invite — front-and-centre (the growth engine, parent §1a Loop):**
   *"Who else should have this seed?"* Suggested people + email entry + a one-line
   note (*"Mom, this is your adobo — add the part I always forget"*). **Skippable,
   but inviting is the visual default.** Each send → `POST /recipes/{id}/handoff`.
6. **Sent confirmation** — shows the seed + a pending branch ("sent to Mom").

### 3.2 Remix ("Make it mine") — a change grows a branch
Entry: a **"Make it mine"** action on any viewable `RecipeDetail`.
1. **Remix editor** — pre-filled from the parent: ingredients/steps editable;
   **`notes` pre-filled** from parent (editable); **`story` empty** (the remixer
   writes their own). A provenance ribbon: *"branching from Yoko M."*
2. **Diff prompt** — after a change, one reactive prompt driven by the server's
   `prompt_key` (e.g. *"You swapped butter → lard. Why?"*) → `prompt_answer`.
   Submits `POST /recipes/{id}/remix`.
3. **Branch-grew beat** — the tree gains a branch: *"Your version is now part of
   Grandma's Adobo's tree."* New node's growth-state = seed (a fresh sub-lineage).

### 3.3 Cook — the recipe visibly grows (retention)
Entry: a prominent **"I cooked this"** action on `RecipeDetail`.
1. **Cook tap** — shows current growth-state + cook count. `POST /{id}/cook`.
2. **Growth beat** — the mark advances/blooms (seed→sprout on first cook; leafier
   after), warm micro-copy: *"That's 4 times you've kept this alive."* Optional
   add-a-photo / one-line note (→ the cook event's `photo_url`/`note`).
3. **Ripple** — a gentle note that the recipe's owner/tree will see it (*"Yoko will
   see her adobo was cooked"*). Sets up the "your tree grew" retention notification
   (delivery infra is later; the flow surfaces the intent).

### 3.4 Handoff (standalone) — pass an existing recipe
The same invite as §3.1 step 5, reachable from a recipe's menu ("Pass it on"), for
recipes not just-planted. Owner-only. `POST /{id}/handoff`.

---

## 4. Components & files (frontend)

New/changed under `frontend/src/`:
- **`components/GrowthMark.jsx`** — renders the seed/sprout/sapling/tree SVG for a
  given state; a `stateForRecipe(recipe)` helper derives the state from
  cook_count + lineage (§2.2). Used by cards + beats.
- **`pages/PlantRecipe.jsx`** (or refactor `AddRecipe`) — the doorway + origin
  steps, handing off to the shared `RecipeForm`, then the planted+handoff beats.
- **`components/HandoffInvite.jsx`** — the invite UI (suggested people, email,
  note); used by both the plant tail and the standalone handoff.
- **`components/RemixEditor.jsx`** (or a `RecipeForm` mode) — pre-filled remix with
  provenance ribbon + diff prompt.
- **`pages/RecipeDetail.jsx`** — add "I cooked this", "Make it mine", "Pass it on"
  actions + growth-state display + cook beat.
- **`components/RecipeCard.jsx`** — add the growth-state corner badge.
- **`api/`** — add lineage calls (remix/cook/handoff/lineage) alongside existing.

Each flow is a self-contained unit with a clear boundary; `GrowthMark` +
`stateForRecipe` are the shared primitive everything else depends on.

---

## 5. Hooks wired now vs. deferred

**Wired into these flows now (cheap, reinforce the engines):**
- Handoff invite as the plant default (growth).
- Growth-state marks on cards + confirmation beats (retention, visible).
- Cook → "your tree will be seen" intent copy (sets up notifications).

**Deferred (need infra / later sub-projects), but designed to plug in:**
- Actual **notification delivery** ("someone cooked your adobo") — backend cook/
  remix events already exist; delivery is its own effort.
- **Kitchen-as-garden** full reframe, **memory resurfacing**, **lineage collision**
  — parent spec retention/growth mechanics; MVP leaves seams for them.
- Handoff **accept/claim** + ghost **"waking"** — the recipient side of the invite.

---

## 6. Guiding principle & resolved decisions

**Guiding principle (founder, 2026-07-08):** prioritize Issei being a **top-tier
product**. Do not treat what's already built (backend or frontend) as a
constraint — where the existing design/structure doesn't serve this product
vision, innovate and restructure rather than conform. The built backend is a
strong, correct foundation; the frontend/Craft D layer is fair game to reshape
where the lineage vision or a better design calls for it.

**Resolved:**
1. **Growth-state rule (§2.2):** DECIDED — branches drive seed→sapling→tree
   progression; cooks (including the **owner's own** cooks) drive a bloom/dormancy
   layer, rewarding continued cooking of one's own recipes. Owner cook count is
   tracked + surfaced.
2. **Seed mark / coffee-bean (§2.4):** DECIDED — issue was app-icon-specific; the
   seed mark is open for design/color exploration in task #10; flows build against
   a provisional mark.

**Still open (impl-plan detail, non-blocking):**
- **Plant refactor vs. wrapper:** rebuild `AddRecipe` into a stepped `PlantRecipe`
  (lean, given the guiding principle) that still renders `RecipeForm` for the form
  step, vs. wrapping the current page. Resolve when planning.
