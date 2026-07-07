# Issei Signature Feature — The Lineage Tree ("The Handoff")

**Status:** Design approved (brainstorm 2026-07-06). Not yet planned or built.
**Supersedes nothing.** This is the app's defining feature; the look-and-feel
redesign (see `2026-07-03-redesign-locked-decisions.md`) is deferred and will be
re-approached *around* this feature.

---

## 1. Why this exists

Issei's purpose — preserving and passing down family recipes — is strong, but on
its own it makes "just another recipe app." The missing piece is a signature
mechanic that turns *heritage + memory* into something active, social, and a
little addictive — the way Beli's head-to-head ranking makes logging a restaurant
feel like a game. Issei's equivalent must clear the same bar (**simple,
interactive, intuitive, logical, memorable**) **without a leaderboard** — ranking
grandmothers' dishes against each other would cheapen the whole thing.

**The feature:** every recipe carries a living **lineage tree** of everyone who
has kept, cooked, and adapted it. You can walk the tree, tap any node to taste
that person's version and read the memory behind it, and see how a dish has
travelled and mutated across households and generations.

**The emotional payoff (the thing users screenshot to the family group chat):**
your late grandmother — never on any app — sitting as the *root* of a dish now
cooked by dozens of strangers who each wrote a line about what it means to them.
*"My grandmother's food is being made by people she never met, and it still says
her name."*

---

## 2. Core concepts

### 2.1 The node
A **node** is one person's distinct **version** of a recipe: their ingredients,
their steps, their memory/story, and a **cook count**. A node is created only by:
- **planting a root** (your own recipe, with a named origin — see ghost ancestor), or
- **remixing** — keeping someone's recipe *and changing something*.

A node is **not** created by merely keeping or cooking (see the friction gradient).

### 2.2 The edge
An **edge** means **descended-from / learned-from**, pointing ancestor → descendant,
and always carries **provenance** ("adapted from", "kept from", "taught by").
Edges and attribution are **immutable** — you cannot re-parent or orphan a recipe
from its roots. This immutability is what makes the lineage trustworthy rather
than feeling like theft or mis-crediting.

Parentage is **single-parent** (a recipe descends from exactly one source), which
keeps the genealogy readable like a real family tree and the data model simple —
one nullable FK. (Multi-parent "merge/marriage" nodes were considered and **cut**;
see §7.)

### 2.3 The ghost ancestor (the cold-start solution)
A heritage recipe *already has a past living in the cook's head*. So when you add
your first recipe, the flow is **"plant a recipe,"** and the mandatory first
prompt is **"Who taught you this?"** — answerable in three words. That answer
mints a **ghost ancestor**: a real node with a name, optional place and year, and
your one-line memory of that person — but **not** a login.

Consequences:
- Recipe #1 is **immediately a two-generation lineage** (e.g. *Nonna Lucia → You*)
  with an origin story, before any other user exists — solo and offline-viable.
- You may seed further back ("and who taught *her*?") to build 2–3 ghost
  generations in under a minute.
- A ghost can later be **"woken"**: if the real person joins, an invite hands them
  the node, turning a memory into a living member.

This is the load-bearing answer to *"a tree of one is just a recipe with extra
UI."* The magic ("my heritage, visualized") lands on recipe #1, alone.

### 2.3a Self-authorship — invite the real cook to add their own version
Transcribing someone else's recipe is high-effort and second-hand: if Mom has to
tell you every ingredient anyway, she should **author it herself, in her own
words**. So the ghost ancestor is explicitly a *placeholder for a real person we'd
rather have author their own node*. The invite flow leads with **"Invite [name] to
add this recipe themselves"** — accepting either **claims the ghost node** (turning
the placeholder into her authored version + memory) or adds her own root. This is
lower-effort for the inviter, produces a more authentic node (her voice, her
memory, her measurements), and is a primary way the network grows. Authoring your
own recipe from scratch (not descended from anyone on-app) is a first-class action,
not an afterthought — many users arrive to preserve *their own* cooking.

### 2.4 The friction gradient (the core action — the Beli analog)
The repeatable atomic act is answering **"what makes yours yours?"**

| Action | Effort | Effect on tree |
|---|---|---|
| **Keep** a recipe | one tap | no node — a warmth signal / it appears in your kitchen |
| **Cook it** | one tap | no node — increments the node's **cook count** |
| **Remix** (change an ingredient, step, or add a note) | one tap + one prompt | **creates a branch** (new child node) |

When you change something, Issei **auto-detects the diff** and **pre-fills a single
guided prompt** — e.g. *"You swapped butter → lard. Why?"* — so the user **reacts
in three words** rather than composing from a blank field. Divergence is the
story; only divergence grows the tree; cooking-faithfully stays a count. This is
what keeps the tree legible and the core act near-effortless.

**What a remix child inherits from its parent (decided 2026-07-07):**
- **`source`** — *carried forward.* Provenance should never vanish silently.
- **`story`** — *not carried.* The remixer writes their own memory via the guided
  prompt (`prompt_answer`); inheriting the parent's story would put words in their
  mouth.
- **`notes`** — *pre-filled from the parent but editable during the remix,* so the
  cook starts from the parent's practical notes and adjusts rather than retyping.
- Plus the usual recipe scalars (name, cuisine, servings, etc.) as a starting point.

*(The built MVP's remix handler currently copies 8 scalars and drops
`story`/`source`/`notes`; aligning it to this rule — carry `source`, pre-fill
editable `notes`, skip `story` — is a tracked follow-up.)*

### 2.5 The Handoff (the social growth act — optional, never a gate)
The primary *share* action is **"hand this recipe to someone"** — a named person,
in-app or via invite link — with a one-line note. When they cook or remix it,
their node appears on your tree. The Handoff doubles as the acquisition engine
(pending nodes are invitations). It is **always optional**: the ghost ancestor
already makes a friendless user's tree sing, so no one is ever blocked.

---

## 3. The tree experience (navigation)

**MVP: the walkable spine.** You always land **focused on one node** — the "you
are here" card, large and centered — with:
- the **parent** shown as a single tappable chip above (`↑ from Nonna Lucia`),
- **children** as chips/small nodes below (`3 branches from yours`),
- a pinned **lineage spine breadcrumb** (`Nonna → Mom → You`) so depth is always
  felt but never overwhelming.

Navigation is **tap-to-recenter**, one generation at a time — like tapping through
a family tree — so it stays legible no matter how big the tree grows. Sibling
lists beyond 3 collapse into "+N more." Vertical orientation (oldest at top,
descending down) matches native phone scroll.

Each node card shows: cook's name/photo, their one-line memory, cook count (as
small warmth dots), and **"Taste this version"** which swaps the recipe body to
theirs.

**Fast-follow (NOT MVP): the "see the whole tree" view.** The zoomed-out
"constellation" minimap that produces the shareable screenshot. **This is the one
unsolved design problem** — a viral recipe with hundreds of nodes or a 20-generation
chain breaks naive spine+collapse layouts on a phone. The MVP intentionally ships
without it; see §8 Risks. It must be designed and validated separately before
build, and the answer is not simply "collapse siblings."

---

## 4. Social & privacy model

The guiding principle: **respect the user's privacy preferences to the degree
they're comfortable with, and only ask a real question when something is actually
at stake.** We separate three distinct levers people conflate — *reach* (who can
see it), *attribution* (is my name on it), and *existence* (does it stay in the
app) — and give each its own control so no single action is overloaded.

### 4.1 Reach (visibility)
- **Default: private-to-lineage.** A new recipe and its ghost ancestors are
  visible only to people explicitly invited into that tree.
- **Opening to public is a deliberate, one-way act** with clear explanation.
- **The root author's privacy choice binds all descendants.** A Keeper cannot
  re-share more openly than the origin allowed. This protects sacred family
  recipes as an inviolable rule, not a setting people can accidentally trip.

### 4.2 Attribution (anonymity)
- **Anonymity is a simple per-recipe toggle** — "Add anonymously" at creation,
  and flippable later in edit-recipe. Plus an **account-wide default** so a
  privacy-minded user sets it once. Rationale: *we would much rather a user add a
  recipe anonymously than not add it at all.*
- An anonymous node keeps its place, content, and cook count, but its author is
  shown as **"anonymous"** in the provenance chain instead of a name.
- **Attribution is otherwise permanent and prominent.** Every node shows its
  provenance chain (`kept from Ana · adapted from anonymous · taught by Nonna
  Lucia`); the original planter / ghost ancestor position is never severed.
- **Ghost ancestors name real people (living or deceased).** Handled with
  reverence: private by default, editable only by their creator, framed as a
  memorial/tribute, with an opt-out/removal path. (Policy detail to finalize in
  the backend sub-project — flagged as a trust landmine, §8.)

### 4.3 Existence (deletion) — and why a node with descendants is never orphaned
Once a recipe has descendants it is **load-bearing for other people's trees**, so
"delete" behaves differently by situation. **A user's own recipe (their content)
is always theirs to remove; what they cannot do is amputate the branch others
built on top of it.**

- **Delete a leaf** (no descendants): fully removed. Simple, no prompt.
- **Delete a node others have remixed:** it disappears from the owner's app
  entirely (their intent), and in the shared tree its position becomes a
  **de-identified, content-stripped tombstone** — the same primitive as a ghost
  ancestor, but mid-tree ("a recipe once lived here"). Name **and** personal
  content (story/notes/ingredients/steps) are stripped; only the structural
  anchor + descendant links remain, so every downstream remix stays intact and
  fully owned by its author. This is **not** the same as anonymize (which keeps
  the recipe readable) — delete means the content goes.
- **The only prompt that ever appears** is when descendants exist:
  *"N people have built on this — [Delete & leave a placeholder] · [Just make it
  anonymous instead] · [Cancel]."* A leaf delete shows no such prompt (the
  "make anonymous instead" nudge appears **only when it matters**).
- **Account deletion** (no feature exists yet — spec-only): one screen, safe
  default = *anonymize my recipes and keep their trees alive*; alternative =
  *remove everything that won't break others' trees* (leaves deleted, nodes with
  descendants tombstoned). Never a per-recipe questionnaire.

**Design consequence — the orphan/leak hole is designed out.** Because a node with
descendants is *never hard-deleted* (it tombstones in place, retaining its row
and its parent link), a descendant's `parent_recipe_id` can never be nulled out
from under it. The root-binds-visibility walk therefore never mis-resolves an
orphaned child as public. See §6 for the schema treatment and §8 for the risk
this closes. Deliberately **not** built: per-audience visibility choices at
deletion ("show to viewers but not remixers", etc.) — reach is already governed
by §4.1, and that granularity is burden without benefit (YAGNI).

---

## 5. The come-back loop

Warm, non-spammy, never leaderboard-y:
1. **"Your recipe grew a branch"** — someone kept or adapted your version;
   notification carries their name + one-line memory
   (*"Priya kept your kimchi jjigae — 'reminds me of my halmoni'"*). The dopamine
   of seeing your heritage travel.
2. **"Someone cooked from your family"** — a gentle weekly digest when your recipe
   or a descendant is cooked (*"Your grandmother's recipe was cooked 4 times this
   week"*), so a quiet recipe still feels alive.
3. **"A memory to add"** — periodic guided-prompt nudges (*"You've cooked this 5
   times but never said why you love it — one line?"*), pulling latent stories out.

The returning emotion: *my family's food is still being made by people.*

---

## 6. Data model (delta on the current schema)

The current `Recipe` model already has `user_id`, `story`, `source`, and
soft-delete. The lineage feature is a **genuinely small delta**:

**`recipes` table additions:**
- `parent_recipe_id` — self-referential FK, nullable (`null` = root node).
- `lineage_relation` — enum: `root | kept | remixed`.
- `origin_attribution` — text, nullable (the ghost ancestor's name/place/year on
  root nodes, e.g. "From my Halmoni · Busan · 1960s").
- `visibility` — enum: `private | public`, default `private`. On non-root nodes
  this is **derived/clamped** by the root's setting (root binds descendants).
- `is_anonymous` — bool, default `false` (§4.2). When true, the node's author is
  rendered as "anonymous" in provenance chains; content/counts unaffected.
- `is_tombstone` — bool, default `false` (§4.3). When true, the node is a
  de-identified, content-stripped placeholder retained only to anchor descendant
  links after a delete; the tree view renders it as "a recipe once lived here".
- structured prompt capture: `prompt_key` + `prompt_answer` (extends the existing
  `story` field rather than replacing it).

**Deletion behavior (§4.3), enforced in the delete handler — not the schema:**
- Deleting a **leaf** (no rows reference it as `parent_recipe_id`) → normal
  soft-delete (existing `deleted_at`), fully removed from the owner's views.
- Deleting a **node with descendants** → set `is_tombstone = true`, null out the
  author association + strip content fields (name/story/notes/ingredients/steps),
  but **keep the row and its `parent_recipe_id`** so descendants stay linked. The
  node is excluded from the owner's kitchen but remains as a tombstone in the tree.
- **Never hard-delete a recipe that has descendants.** This — plus keeping the
  self-FK non-orphaning — is what closes the visibility-leak risk (§8). The
  `parent_recipe_id` self-FK should therefore be `ondelete=RESTRICT`/`NO ACTION`
  (or enforced app-side) rather than `SET NULL`, since a node with children is
  never hard-deleted. (Note: the built MVP currently ships `SET NULL`; migrating
  it to non-orphaning is tracked as a follow-up — see §8 / TECHDEBT.)

**`ghost_ancestors` table (or a lightweight node variant):** a named non-user
origin — `name`, optional `place`, `year`, `memory`, owned/editable by its creator,
`claimed_by_user_id` nullable (for "waking the ghost").

**`cook_events` table:** `recipe_id`, `user_id`, `cooked_at`, optional `photo_url`,
optional one-line note. Powers the cook **count** without creating nodes.

**`handoffs` table:** `recipe_id`, `from_user_id`, `to_user_id_or_email`,
`state` (`pending | kept | cooked`), `note`, `created_at`.

**Diff detection:** computed by comparing a remixed recipe's ingredients/steps to
its parent's, to pre-fill the guided prompt. Lives in a service (analogous to the
existing `app/services/`).

---

## 7. Folded into the vision (design around now, build later)

- **~~Merge / marriage nodes~~ — CUT (2026-07-06).** Considered a rare, celebrated
  two-parents-join event, but the founder judged it unlikely to happen in practice.
  Cutting it keeps parentage strictly single-parent (one nullable FK) and the data
  model simpler. Not planned.
- **Lineage collision / discovery** — surface when a stranger's recipe descends
  from the **same ancestral root** as yours ("someone else on Issei cooks a dish
  descended from the same grandmother's technique"). Turns isolated trees into a
  discovery engine and directly attacks the low-liquidity problem.

**Parked for a later brainstorm (explicitly not yet decided):** voice/audio
memories; memorial/legacy stewardship when a root author passes; a time/generation
axis in the visualization; a printable/exportable keepsake tree; passive flavor
profile; light gamification / unlocks; expanded guided-prompt library.

---

## 8. Risks (known, not blockers)

1. **Tree legibility at scale** — the "see the whole tree" payoff view is unsolved
   on a phone for large/deep trees. MVP ships the walkable spine only; the
   zoomed-out view is a validated fast-follow, not a hand-wave. **Highest-risk
   open problem.**
2. **Privacy of sacred recipes** — an accidental public toggle or a stranger
   branching a sacred dish is an irreversible betrayal. Mitigated by
   private-by-default + root-binds-descendants + deliberate one-way opening +
   per-recipe anonymity (§4.2) + non-orphaning deletion (§4.3).
   **Known open item (from the backend final review):** the built MVP's
   self-parent FK uses `ondelete=SET NULL`, so *if* a parent were ever
   hard-deleted (only possible via a not-yet-built account-deletion), a private
   root's descendant could be orphaned and mis-resolve as public. The §4.3
   tombstone model (never hard-delete a node with descendants) closes this; until
   the deletion flow + FK change land, it is unreachable in the current app (no
   hard-delete path, remix children default private, no public-toggle endpoint) —
   tracked as TECHDEBT, resolve alongside the account-deletion feature.
3. **Ghost-ancestor consent** — naming real people without consent is an emotional
   (and possibly legal) landmine. Needs reverent framing, opt-out, memorialization
   tone — finalized before the backend ships.
4. **Low-liquidity / empty network** — most trees may stay one node forever, so the
   feature MUST be fully rewarding solo. The ghost ancestor + self-lineage-over-
   time is the bet; it is deliberately the cold-start core, not an afterthought.
5. **Core action feeling like homework** — recipe entry is already the app's
   heaviest task. The diff-prefilled, three-word-answerable prompt is the mitigation;
   if capture ever feels like a form, no tree forms.

---

## 9. MVP cut (what to build first)

The smallest version that still delivers the magic — *plant a root with a
grandmother in it, hand it to one person, watch a second node appear:*

1. **"Plant a recipe" flow** with the mandatory first guided prompt *"Who taught
   you this?"* → auto-creates one **ghost ancestor** (name, optional place/year,
   one-line memory).
2. **A recipe = a node** with owner, story/prompt-answer, ingredients/steps, cook count.
3. **Keep** = one tap, appears in your kitchen, no node.
4. **Cook it** = one tap, increments cook count, no node.
5. **Remix** = auto-diff detection on ingredients/steps + one pre-filled guided
   prompt → creates a **single-parent child node**.
6. **Walkable lineage-spine view**: focus-on-one-node, parent chip above, collapsed
   sibling children below, pinned spine breadcrumb, tap-to-recenter, "Taste this
   version."
7. **Two visibilities** — private-to-lineage (default) vs public; opening is
   deliberate; root binds descendants.
8. **The Handoff** — hand a recipe to one named person (in-app or invite link);
   pending node; accept claims the child. The invite explicitly offers **"add this
   recipe yourself"** so the real cook (e.g. your mom) can author their own version
   / claim their ghost node in their own words, rather than you transcribing it.
9. **One notification** — "your recipe grew a branch," with the brancher's name +
   one-line memory.

**Explicitly deferred from MVP:** the zoomed-out whole-tree view, merge/multi-parent
nodes, lineage collision, seeded public heritage trees, flavor profile, unlocks,
voice memories, printable keepsake.

---

## 10. Decomposition (sequencing)

This is too large for one implementation plan. Three sub-projects, in order:

1. **Backend & data model** — schema delta (§6), diff-detection service, privacy
   inheritance rules, ghost-ancestor + handoff + cook-event tables, lineage query
   endpoints (`GET /recipes/{id}/lineage` returning the spine + collapsed counts;
   `POST /recipes/{id}/handoff`; remix create).
2. **Capture flows (frontend)** — "plant a root" onboarding, remix-with-prefilled-
   prompt, keep/cook taps, the Handoff invite.
3. **Tree visualization (frontend)** — the walkable spine for MVP; the zoomed-out
   view as its own later effort with a dedicated viz exploration.

The **look-and-feel redesign** (`2026-07-03-redesign-locked-decisions.md` +
the editorial "Double Rule Folio" direction explored 2026-07-06) is re-approached
**after** the feature shape is real, so the UI is designed *around* the lineage
tree rather than retrofitted to it.
