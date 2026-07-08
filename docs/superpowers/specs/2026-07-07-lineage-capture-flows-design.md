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

### 2.2 What advances the state — **the rule (confirm at review)**
Two independent signals, two meanings — so the mark encodes both *depth* and
*liveliness*:
- **Branches (lineage depth) drive the main seed→sapling→tree progression.** The
  tree literally grows as the dish travels and mutates across people. This is the
  structural, permanent growth.
- **Cooks add a "bloom / liveliness" layer** on top — a well-cooked recipe visibly
  flourishes (leafier, warmer), and going long uncooked lets it go quietly dormant
  (the garden's "bring this back to life" nudge). This is the reversible, activity
  growth.
- Concretely for MVP: `seed` = 0 cooks & no children; `sprout` = ≥1 cook, no
  children; `sapling` = ≥1 child; `tree` = children spanning ≥2 generations
  (grandchildren exist). Bloom/dormancy is a lighter visual modifier on top of
  whichever base state, driven by recency of the last `CookEvent`.
  *(Exact thresholds are tunable knobs; the ordering is the locked part.)*

> **OPEN FOR REVIEW:** confirm branches-drive-progression + cooks-drive-bloom, vs.
> cooks-alone-drive-growth. Everything else in this spec is independent of the
> exact thresholds; only the state-derivation helper changes.

### 2.3 Where marks appear
- **Recipe cards** (Home/Browse/Kitchen): a small growth-state mark corner-badge.
- **Kitchen-as-garden** (later; parent spec retention engine): the grid reads as a
  garden of trees at varying growth. MVP: the badge on each card is enough to
  seed this; the full "garden" reframe is a fast-follow.
- **Plant/cook/remix confirmation beats:** the mark animates/advances as the
  emotional payoff.

### 2.4 The coffee-bean fix (carried from task #10)
The bare terra seed shape reads as a **coffee bean**. Since the seed is the most
load-bearing symbol, its production mark must not read as coffee — resolve by a
distinguishing sprout cue and/or shape/notch, and keep the **bottom-nav Home icon
as a house** (reserve the seed strictly for plant/growth contexts) so the two
never collide. Final mark set is produced in task #10; these flows reference the
states by name.

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

## 6. Open questions for review

1. **Growth-state rule (§2.2):** confirm branches-drive-progression +
   cooks-drive-bloom, vs. cooks-alone. (Only affects `stateForRecipe`.)
2. **Plant refactor vs. wrapper:** rebuild `AddRecipe` into `PlantRecipe`, or wrap
   the existing form with pre/post steps? (Impl-plan detail; lean = refactor into a
   stepped `PlantRecipe` that still renders `RecipeForm` for the form step.)
3. **Coffee-bean fix ownership:** the final seed mark is produced in task #10; is a
   provisional non-coffee seed acceptable for this sub-project's build, refined
   later? (Lean = yes.)
