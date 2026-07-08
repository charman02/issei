# Recipe Visibility (Private ↔ Public) — Design

**Status:** Design approved in direction (brainstorm 2026-07-08). Not yet planned
or built. A focused sub-project of the lineage feature. Parent policy:
`2026-07-06-lineage-tree-signature-feature-design.md` §4.

**Scope:** let an owner make a recipe **public** (discoverable in Browse, keepable/
remixable by anyone) or keep it **private** (the default). Unblocks the public
discovery feed — the concrete gap found in the sub-project-2 final review
(`RecipeCreate`/`RecipeUpdate` never accepted `visibility`, so every recipe was
permanently private and Browse showed nothing).

**Explicitly cut / deferred (decided 2026-07-08):**
- **Anonymity** — CUT from this build. Attribution ("kept by …", the provenance
  chain) is the app's emotional engine; anonymity fights it and mostly solves a
  problem heritage recipes don't have. No `is_anonymous` column, no user-settings
  default, no byline changes. Revisit only if real users ask.
- **Tier-2 "share with specific people / family"** — DEFERRED to its own design
  pass (the FUTURE.md "Multi-User Family Sharing" item). This is arguably the most
  important sharing tier for the app, and deserves a dedicated project (access-
  grant model + invitations + family/group concepts). Handoff is a down payment
  on it. This MVP ships only the Private↔Public binary.
- Deletion / tombstone / account-deletion — separate deferred work (parent §4.3).

---

## 1. Visibility model

Two tiers in this MVP:
- **Private (default):** visible only to the owner (and, via handoff/remix
  mechanics already built, people in its lineage — unchanged by this feature).
- **Public:** discoverable in Browse; any logged-in user can view, keep, and remix
  it.

**Root-binds (the one real rule, already enforced on reads via
`effective_visibility()`):** a recipe's *effective* visibility is its lineage
**root's** `visibility`. A descendant can never be more public than its root. This
feature must not let that rule be violated on the *write* side either — see §2.

**Reversible, but deliberate.** Publishing is reversible (public ↔ private) — a
mistaken publish is fixable, which is the kinder default. This refines parent §4's
"deliberate one-way act" wording: the *intent* was deliberateness, not literal
irreversibility. Reversibility caveat, surfaced in the UI: flipping back to private
removes the recipe from Browse, but **cannot un-ring the bell** for anyone who
already kept/remixed it while it was public (their branches persist — as the
lineage model intends).

---

## 2. Backend

**No schema change.** `recipes.visibility` already exists (String, default
`"private"`); `effective_visibility()` and read-gating on `get_recipe` / `browse` /
`get_lineage` are already built.

**Accept `visibility` on write (the gap):**
- **`RecipeCreate`** gains `visibility: str = "private"`. **Implementation note:**
  `create_recipe` builds `Recipe(...)` with an explicit field list (recipes.py,
  the `new_recipe = Recipe(...)` block) — so `visibility` must be added there
  explicitly (it won't flow automatically). `create_recipe` only ever makes root
  recipes (the remix path is a separate endpoint), so honoring the field directly
  is safe; still, set `visibility=recipe_in.visibility` on the constructed root.
  A remixed child (created by `remix_recipe`, not this endpoint) stays private on
  its own row; its effective visibility comes from the root anyway.
- **`RecipeUpdate`** gains `visibility: Optional[str] = None`. **Implementation
  note:** `patch_recipe` applies scalars via a generic `setattr` loop over
  `model_dump(exclude_unset=True)` (recipes.py:401–416) — so `visibility` would
  flow through *automatically*. The root-binds guard must therefore be an
  **explicit check**, not a matter of "not mapping it": if `visibility` is in the
  sent fields **and** the recipe has a `parent_recipe_id`, reject with `400`
  ("Visibility is controlled by this recipe's original; it can't be set on a
  branch.") **before** the setattr loop. On a root, the loop applies it normally.
  (Already owner-scoped by the existing query filter.)
- **Validation:** `visibility` must be `"private"` or `"public"` (reject other
  values with `422`/`400`). A tiny validator or `Literal["private","public"]`.

**No other endpoints change.** Browse already filters to effective-public; the
sub-project-2 fix already strips owner activity from the public feed.

**Root-binds test matrix (the correctness core):**
- create root with `visibility="public"` → browse shows it; non-owner `GET` = 200.
- create root private (default) → browse omits it; non-owner `GET` = 404.
- patch a root private→public→private → browse membership follows; toggling works.
- patch `visibility` on a **child** (has `parent_recipe_id`) → `400`, unchanged.
- a private root with a child: the child is not publicly visible (existing
  `effective_visibility` behavior — regression-guard it).

---

## 3. Frontend (placement C — on the recipe, owner view)

Publishing is a deliberate, in-context act on the recipe itself (not a form field),
matching §4's intent and giving an at-a-glance privacy signal.

**RecipeDetail, owner viewing their own recipe:**
- A **status pill** near the title/byline: 🔒 **Private** or 🌐 **Public**.
- **Root recipe:** the pill is actionable — "Make public" / "Make private" — which
  PATCHes `visibility` and updates the pill in place.
  - **Publish confirm when descendants exist:** if the recipe has children/remixes,
    the confirm notes *"This also makes the N versions built on it public."* A plain
    private→public with no descendants just flips (no dialog). Un-publish (public→
    private) also just flips (with the "can't un-ring the bell" note shown once).
- **Non-root recipe:** show the **inherited** status read-only — e.g. "Public —
  inherited from the original" / "Private — inherited from the original" — with no
  toggle, so the root-binds rule is visible rather than a confusing dead control.
- **Non-owner:** no pill/controls (unchanged view).

**No changes to:** the recipe form (A dropped with anonymity), Profile/You, bylines,
RecipeCard.

**API call:** add `setVisibility(id, visibility)` to `api/lineage.js` (or reuse the
existing patch path) → `PATCH /recipes/{id}` with `{ visibility }`.

---

## 4. MVP cut + testing

**Build:**
1. Backend: `visibility` on `RecipeCreate` (root-only honored) + `RecipeUpdate`
   (root-only, 400 on branch), value validation. Tests per the §2 matrix.
2. Frontend: the owner status pill + publish/un-publish toggle on RecipeDetail
   (root), inherited read-only status (non-root); descendants-aware confirm.
   RTL tests: pill reflects visibility; toggle PATCHes; child shows read-only.
3. Visual-verify: publish a recipe → it appears in Browse; the pill + confirm
   read correctly; a branch shows inherited status.

**Deferred (documented):** anonymity; tier-2 family/specific-people sharing;
deletion/tombstone; account-deletion.

---

## 5. Open questions

None blocking. Reconciled with parent §4: visibility is reversible (refines the
"one-way" wording); anonymity is cut from MVP (parent §4.2 remains the eventual
design if revisited); family-sharing is the deferred tier-2 pass.
