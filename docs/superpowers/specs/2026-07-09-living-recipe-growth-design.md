# The Living Recipe — Core Product Redesign

**Status:** Design approved in brainstorm session (2026-07-09). Not yet planned or
built. Supersedes the "lineage tree as hero UI" framing from
`2026-07-06-lineage-tree-signature-feature-design.md` §3 (tree experience) — the
lineage data model, backend, sharing tier, and all prior infrastructure remain; only
the **presentation layer and product emphasis** shift.

**Scope:** The app's core mechanic, the hero recipe page, the growth loop, and the
capture flow. Everything downstream (visual identity/art, frontend build, the
optional lineage-tree deep view) builds on what this spec locks.

---

## 0. The re-center (why this exists)

**Issei's purpose:** preserve and pass down a person's living food-legacy before
it's lost. The recipe is the vessel; the *person* — their voice, their imprecise
knowledge, their story — is the point.

**What changed:** the lineage tree (a branching genealogy of remixes across a
network) was the planned hero UI, but it depended on other people remixing —
something most recipes never get. Most trees stay one node forever. Betting the
core on a network visualization for a mostly-empty network was the strategic error
underneath infinite design churn. The re-center shifts the hero from "walk the
network" to **"feed the single recipe until it's a living heirloom"** — something
that works solo, on day one, with recipe #1.

**What's preserved:** the lineage *data model* (parent/child, ghost ancestors, cook
events, handoffs, sharing, visibility — all built on `lineage-mvp`) is the exact
substrate for this. The tree still exists as (a) a quiet provenance line
("Lola → Mom → you") on the recipe, and (b) an optional deep-tree view for the
rare large lineage. The seed→tree metaphor survives — now applied to the *single
recipe's growth*, not the network's shape.

### 0.1 Remixing is cut from v1

**Remixing (a user creating their own branched child of another user's recipe) is
removed from the v1 product surface.** Rationale: remix only creates value once
multiple family members are actively on the app cooking the same dish differently —
a network-maturity feature, not a day-one one (the real early user graph is *one
person capturing one elder's recipe*). Keeping it would add conceptual clutter
("whose version is this?") that competes with the clean, reverent "this is *the
person's* recipe" framing, for a case almost no early user hits.

- **Divergence is captured via cook-notes instead.** "I use coconut milk instead"
  is recorded as a **cook with a note** (an existing cook event that already feeds
  growth) — low-friction, preserved as a memory *on* the recipe, without
  fragmenting one heirloom into parallel copies.
- **Provenance survives without remix.** "Lola → Mom → you" as *heritage* comes from
  **ghost ancestors** (captured origins), which stay. Only cross-*app-user* version
  branching is removed — which wouldn't occur at this stage anyway.
- **Reversible safeguard:** the `parent_recipe_id` FK stays in the database
  (already built, harmless); only the remix UI/endpoint exposure is removed. If the
  app ever grows dense multi-member family networks that genuinely want divergent
  versions side by side, reviving remix is a cheap UI addition, not a
  re-architecture.

---

## 1. The living recipe page — the hero

A recipe page's job is to make you feel *the person's presence*, not just store
instructions. It carries three registers of voice, plus a growth plant.

### 1.1 Three registers

1. **Framing story** (top) — a few sentences: who, when, why. Written by whoever
   remembers (the capturer's paraphrase is explicitly blessed as fine).
2. **Woven quotes** (inline with steps) — short pull-quotes in the person's words
   attached to specific steps: "Don't crowd the pan — let it get a real color."
   Displayed as a gold-ruled aside under the step they belong to.
3. **Imprecise measures** (in the ingredient body) — "a good splash," "3 soup
   spoons," "until it smells right" — honored verbatim with a subtle "her words" /
   "his way" tag. Never normalized to grams. The app's existing `quantity_type:
   imprecise | unmeasured` already supports this; this spec makes it *visible and
   celebrated as a feature* rather than treated as data.

### 1.2 Provenance line

Every recipe carries a simple, always-legible provenance line on the cover/header:
`🌱 Lola → Mom → you` — derived from `parent_recipe_id` chain + origin attribution.
Reads fine at 1 node or 40. No tree canvas required; the line *is* the lineage
surface for 99% of recipes.

### 1.3 Empty-state philosophy ("warm & invitational")

All soul content (story, quotes, photo, the person's words) is **always optional**.
Recipe #1 succeeds with just a name + ingredients.

When soul fields are absent, the page is **calm and intentional, not broken**: soft
open invitations mark where soul *could* go, framed as **opportunities, never
deficiencies** (e.g. "Whose hands does this come from? — add a line about her, or
invite her to tell it"). Enrichment happens through one soft invitation at a time,
gentle resurfacing over time, AND the handoff. Empty space = room to grow.

---

## 2. The growth model — seed → sprout → sapling → tree

Each recipe is a **seed** that grows into a tree as the owner feeds it. Growth is
the reward for exactly the acts the app exists to encourage.

### 2.1 Two layers

- **Stage (breadth):** the discrete ladder. Climbs only as new *dimensions* appear.
- **Vitality (depth):** continuous fullness *within* a stage. Grows from repeated
  low-friction acts (cooking, handoffs). Bounded with diminishing returns.

The two layers never compete: breadth builds the structure; depth fills it with
life. Ratio can never distort the plant because they affect different visual
qualities.

### 2.2 The four stages (breadth = dimensions filled)

| Stage | Condition |
|-------|-----------|
| **Seed** | Just planted — a name + the basics. Every recipe starts here. |
| **Sprout** | First sign of life: one dimension added (a memory, OR first cook, OR a photo). |
| **Sapling** | Taking shape: ~3 dimensions filled. |
| **Tree** | A full heirloom: most dimensions filled — richly told, cooked, and passed on. |

**Refinement (added 2026-07-10, from the identity/plant design):** **use advances
stage, but only up to Sapling — reaching Tree requires SOUL.** A recipe cooked/
shared heavily but never storied grows into a *Sapling* (a living staple deserves
to be more than a Sprout), and its vitality (§2.4) shows there as a fruiting
Sapling — but it cannot become a full Tree on use alone; the majestic heirloom
requires its story. Asymmetry: *use → Sapling max; soul → Tree.* (This also means a
Seed can't accumulate cooks — the first cook is itself a dimension, so it graduates
to Sprout.) See the visual-identity spec §2.3 for the vitality states.

### 2.3 What feeds the seed

**Soul (breadth — each counts once, contributes to stage):**
- A memory / the story (who, when, why)
- Their words / a saying (woven quote on a step)
- A photo (the dish, or the person)
- First cook
- First handoff (passed on at least once)

**Use (depth — contributes to vitality, bounded):**
- Each additional cook after the first
- A **cook-note** (a variation or comment left when cooking — "I used coconut milk
  instead") — this is also how personal divergence is captured now that remix is
  cut (see §0.1)

**Spread (both breadth + depth):**
- First handoff opens the dimension (breadth/stage)
- Each additional handoff, and especially if the recipient adds their own words,
  adds vitality (depth, diminishing)

**Excluded from growth (deliberately):** imprecise measures. Rewarding it would
incentivize corrupting the data (marking precise things as imprecise to grow the
plant) and would penalize honestly-precise recipes. Imprecise measures are
celebrated *in the body* as truth/fidelity, not as a growth lever.

### 2.4 Vitality saturation (the cap)

Vitality follows a **diminishing-returns curve toward a full-lush ceiling** (~a
couple dozen cooks, tunable). Early cooks are visually big; later cooks are subtle;
past ~25 the plant is "thriving and full" and **holds proportioned forever** (25
cooks and 100 cooks look visually identical). No hard cutoff — no cook ever feels
like it "did nothing" — it just quietly reaches maturity.

**Past the ceiling, cooks/handoffs convert to:**
1. **Milestone moments** — "🌸 Cooked 100 times" — a warm celebration (a brief
   bloom, a shareable note to the family chat). Big numbers → meaning, not mass.
2. **The "its life" record** — a textual life story that counts forever: "cooked
   100× across 6 cities · made by 9 people · 3 made their own version." This is
   where big numbers belong — as narrative the family is proud of.

### 2.5 Representation (how the user sees growth)

**Default (the resting state):** the plant glyph at its current stage + a soft,
rotating "gardener's nudge" naming one next nourishing act as a warm invitation —
never a count, percentage, or checklist. Growth feels like life, not a score.

**On tap (optional clarity):** tapping the plant reveals the breadth view — what's
added (✓) and what could still nourish it (+ story, + photo, + pass it on). This
gives users who *want* to know a clear path without forcing a checklist on everyone.

### 2.6 One plant per recipe, species-agnostic architecture

V1 ships **one signature Issei plant** (seed/sprout/sapling/tree art). The data
model is species-agnostic: growth state + vitality are stored data; the plant art
is a *lookup* on that data. A `species` field (defaulting to the signature plant)
will accept multiple species later — a pure art + content drop (no re-architecture)
once the visual identity work (task #10) lands.

**Future direction (deferred, not built):** multiple plant species for
personalization + garden diversity. Framed as heritage-meaningful ("a Filipino dish
grows calamansi") rather than "collect them all" — to avoid cheapening the mission.

---

## 3. The capture flow ("planting the seed")

### 3.1 Philosophy

Recipe #1 succeeds in under a minute with **just a name** (protects the wedge:
"I just saved something I was scared to lose"). Soul is invited at natural moments
but never required — model B (invited, not required). The flow ends on the
**planted beat** that launches the growth loop.

### 3.2 The steps

1. **Doorway** — "Where does this recipe begin?" → *Someone taught me* / *It starts
   with me.*
2. **Who** (ancestor path) — "Who taught you this?" — their name (required), place /
   year / a memory of them (all optional). The "mine" path: "What made this yours?"
   (optional).
3. **The recipe** — name + ingredients + steps. "Add what you've got — 'a splash of
   vinegar' is perfect." Photo optional. **Only a name is truly required.**
4. **Planted!** — the seed glyph appears: *"It's planted. Grandma's Adobo is a seed
   now. Cook it, add her story, or pass it on — and watch it grow."* This beat
   launches the growth loop.
5. **Handoff (optional)** — "Pass it on" with note-starters (see §4).

### 3.3 Existing substrate

The stepped plant flow already exists (`frontend/src/pages/PlantRecipe.jsx`:
doorway → origin → form → planted → handoff). This spec *refines* it (updated copy,
stronger planting beat, soul-invitation framing), not a rebuild.

---

## 4. The handoff — "Pass it on"

### 4.1 One action, two intents

Handoff carries two intents the sender may have:
- **"Help me fill this in"** — passing to the source (Grandma) or a relative to add
  the parts you're missing (words, measures, their story).
- **"I want you to have this"** — sharing with someone who'd appreciate/enjoy it.

### 4.2 How intent is expressed (model #3: note carries intent + starters)

The app **never guesses or auto-senses intent** from the recipient's identity
(intent is in the sender's head, not derivable from who they choose — a new email
might be the aunt who remembers everything; a sibling might just want to cook it).

A single broad **"Pass it on"** action; intent is carried by the **personal note in
the sender's own words.** To make that note effortless, **optional one-tap
starters** pre-fill it:
- "✍️ Add the part I'm missing" (fill-in intent)
- "💛 You'd love this" (sharing intent)
- (Tap to use, edit, or ignore; the note is always fully editable.)

**One safe auto-touch:** when passing back to the recipe's *recorded source* (the
person captured in the ghost-ancestor / origin), the "add your part" starter is
pre-selected — because there it's near-certain, and still editable. Everywhere
else: neutral + note carries it.

**Copy note (post-remix-cut):** handoff copy invites the recipient to **cook it and
keep it** (and, for the source, *add their part*) — it does **not** invite them to
"make their own version" (remix is cut, §0.1).

### 4.3 Accounts & the recipient landing (the growth loop)

**Accessing a handed-off recipe requires an account.** This is deliberate: the
handoff-as-signup-gate *is* the app's primary acquisition loop — "Mom, I saved your
adobo, add the part I forget" pulls a real person into the app far more reliably
than a generic invite. Family will make an account to preserve heritage. Requiring
an account here is a feature, not friction.

**Recipient landing = soft wall (decided).** A recipient (esp. via email invite,
before they have an account) sees a **warm preview first** — the recipe name, who
it's from, the story, the growth plant — *then* a signup prompt to unlock cooking /
keeping / adding their part. The emotional hook ("that's Grandma's adobo, and it
says her name") lands *before* the ask, which converts better than a cold gate while
still requiring an account to participate. (Exact preview scope + gated actions are
an implementation detail to refine during the build; the principle — preview, then
sign up to participate — is locked.)

### 4.4 Existing substrate

The handoff endpoint (`POST /recipes/{id}/handoff`) + the sharing tier (instant-
accept for in-app users, pending for email, auto-accept on signup) are already
built. This spec adds copy + light frontend logic (starters, per-source
pre-selection) + the soft-wall recipient landing on top of existing plumbing.

---

## 5. The lineage tree (demoted to optional view)

### 5.1 What remains

- The **provenance line** ("Lola → Mom → you") on every recipe, always visible.
- The **growth marks** (seed/sprout/sapling/tree) on recipe cards in the Kitchen —
  the "garden" feeling.
- The **backend lineage endpoint** (`GET /recipes/{id}/lineage`) — returns the
  spine, children, and tree counts. No changes needed.
- An **optional deep-tree view** for the rare recipe with a large lineage — deferred
  as a fast-follow or only built if real data shows demand.

### 5.2 What's deferred indefinitely

- The pannable infinite-tree-canvas as the hero screen (replaced by the growth
  model as the hero mechanic).
- The aggregate/canopy "see the whole tree" visualization (may never be needed —
  real use will tell).
- The "living/seasonal" bloom on a network-tree diagram (this idea now lives inside
  the per-recipe vitality layer, which is simpler and more legible).

---

## 6. Kitchen-as-garden

Your Kitchen tab is a garden of your recipe-plants at different growth stages. A
lush full tree next to a bare seed creates a natural pull: "tend the ones that need
love." Tending = cooking, adding a memory, or passing them on — the core acts. This
is the retention surface — the reason to open the app between cooking events.

---

## 7. Sequencing (decided 2026-07-09)

1. ✅ **This spec** — locks the design so nothing's lost.
2. → **Visual identity (task #10)** — logo, palette, fonts, and critically the
   **plant art** (the four growth stages + vitality variants). The plant is now the
   product's heart; art must be designed before building the hero screens.
3. → **Implementation plan + build** — against the finished identity. Hero screens
   built once, right.

---

## 8. Resolved decisions (brainstorm 2026-07-09)

1. **Product core = the living recipe + the handoff** (not the tree view). Rewarding
   solo on day one, no network required. (Whitespace = Storyworth × food.)
2. **Voice = presence (emotional lead); imprecise knowledge = truth (body fidelity).**
   Story + woven quotes lead the page; imprecise measures live inside the
   instructions and are celebrated, not normalized.
3. **Soul is always optional, enriches over time.** The capturer is usually NOT the
   person with the memories (early users = friends entering a parent's recipe from
   fuzzy memory). Paraphrase is blessed. Soul accumulates asynchronously from
   multiple hands (via resurfacing + the handoff).
4. **Growth model = richness/completeness (never wilts).** Breadth → stage
   (bounded ladder, uncorruptible). Depth → vitality (bounded, diminishing; caps at
   full-lush → converts to milestones + "its life"). Never a count-race; the reward
   aligns with the mission.
5. **Imprecise measures excluded from growth.** Rewarding it would incentivize
   corruption; imprecise measures are truth/fidelity, not an enrichment act.
6. **Capture flow = model B (invited, not required).** Name-only to plant; soul
   offered at natural moments, always skippable. Existing PlantRecipe flow refined.
7. **Handoff = one action, note carries intent + starters (model #3).** App never
   guesses intent from recipient identity; one safe auto-touch for the source.
8. **Growth representation = plant glyph + soft nudge (B) + tap-for-clarity (hybrid
   #2+#3).** No progress bars, no %, no forced checklists.
9. **One signature plant v1; species-agnostic architecture** for future variety
   (deferred to identity work / task #10; framed as heritage, not gacha).
10. **Sequence: spec → identity → build.** Avoids building hero screens twice.
11. **Remix is cut from v1** (§0.1). Divergence captured via cook-notes;
    provenance via ghost ancestors; `parent_recipe_id` FK kept dormant so remix is
    revivable later without re-architecture.
12. **Handoff requires an account, with a soft-wall recipient landing** (§4.3):
    preview the recipe (name, source, story, plant) first, then sign up to
    participate. The signup gate is the intended growth loop, not friction.
