# Recipe Sharing — the "Shared" tier (Pass it to someone) — Design

**Status:** Design approved in direction (brainstorm 2026-07-08). Not yet planned
or built. Builds on: recipe visibility (`2026-07-08-recipe-visibility-design.md`)
and the lineage feature (`2026-07-06...`, §4 privacy). Completes the Handoff
primitive that shipped create-only in the lineage backend.

**Scope:** the middle visibility tier — **Private → Shared (specific people) →
Public** — built as ONE action: *passing a recipe to someone*. Passing a private
recipe grants that person access (view + cook + remix); passing an already-public
recipe is just a personal nudge. Completes Handoff with the accept/claim flow it
was missing, and adds a "shared with me" surface.

---

## 1. The core decision: handoff IS sharing (one concept)

There is **no separate "access grant" feature.** Passing a recipe to someone is
the single sharing act, and its *effect adapts to the recipe's visibility*:

- **Private recipe** → passing it **grants the recipient access** (view + cook +
  remix). Their access is the "Shared" tier.
- **Public recipe** → passing it is a **personal nudge** ("thought you'd love
  this"); no access change (they could already see it).

This collapses what were two overlapping ideas (handoff = propagation nudge;
access-grant = privacy control) into one warm, memorable action — a human "I'm
handing you grandma's adobo." One verb, three visibility states.

**Naming note:** the *word* for this act ("hand off" / "pass down" / "share") is
part of the deferred nomenclature/identity pass (task #10). This spec calls it
"pass" / "handoff" interchangeably; the concept is fixed regardless of the label.

---

## 2. The model (locked decisions)

- **Three visibility tiers:** Private → Shared → Public. **"Shared" is not a
  `visibility` enum value** — `visibility` stays `private | public`. A private
  recipe with ≥1 accepted handoff *is* "shared with those people." Public makes
  handoff-grants moot for access (still allowed as a nudge).
- **Grantee rights:** view + cook + remix — full lineage participation, just not
  editing the owner's copy. Same rights as a public recipe, to a private audience.
- **Root-binds (consistent across all tiers):** access grants attach to the
  lineage **root**; a read is allowed if the viewer has an accepted grant on the
  recipe's root. Passing any node normalizes the grant to its root. A grantee can
  walk the whole shared subtree.
- **Grantee identity:** in-app users (instant access on accept) OR email invites
  (pending until they sign up / accept, then access resolves).
- **Owner-only:** only the recipe's owner can pass/grant; grantees cannot re-share.
- **Handoff is the grant** (one table — see §3). Family *group* = deferred sugar
  (a future shortcut over "pass to everyone in this list"), not built here.

**Uniform read rule (the whole access model in one line):**
> A recipe is viewable by a user iff: `effective_visibility(root) == "public"`
> **OR** the user is the owner **OR** the user has an **accepted** handoff on the
> recipe's **root**.

---

## 3. Data model

**Reuse the existing `handoffs` table as the grant** (no new table). It already
has `id`, `recipe_id`, `from_user_id`, `to_user_id` (nullable), `to_email`
(nullable), `state`, `note`, `created_at`.

Changes:
- **`state` repurposed to `pending | accepted`.** The old `pending|kept|cooked`
  values were never meaningfully populated (handoff was create-only, no prod
  data), so this is a semantic change, not a data migration. `pending` = passed,
  not yet accepted; `accepted` = access active.
- **Grants attach to the root.** On create, normalize `recipe_id` to the lineage
  root of whatever recipe was passed (walk `parent_recipe_id` to root, store the
  root's id). This keeps the read-check a single root lookup and honors root-binds.
- **No schema/column additions** — the existing columns cover it. (A DB migration
  is only needed if we add an index on `(recipe_id, to_user_id, state)` for the
  read-path lookup — recommended, see §4 perf.)

**Uniqueness/idempotency:** at most one active grant per (root, grantee). Re-passing
to the same person is a no-op (or re-sends the invite) rather than duplicating.

---

## 4. Backend

All under the existing `/recipes` router (where handoff already lives), plus one
accept endpoint.

**4.1 Passing (extend existing `POST /recipes/{id}/handoff`)**
- Owner-only (already enforced by the query scope).
- Normalize `recipe_id` → the lineage root id before storing.
- If `to_user_id` given and that user exists → create grant `state="accepted"`
  (**instant access** — decided; frictionless family case; appears in their
  "shared with me" with no accept step).
- If `to_email` given → grant `state="pending"`, `to_user_id=null`.
- Idempotent per (root, grantee).

**4.2 Accept / claim (`POST /recipes/handoffs/{id}/accept`)** — backend only, no MVP UI
- Endpoint exists for the future invite-link / mismatched-email flow: an invited
  user claims a `pending` grant → `state="accepted"`, `to_user_id=current_user.id`.
  **Not surfaced in the MVP UI** (see §5.2) — the two auto-accept paths below cover
  every in-app case.
- **Email-invite resolution on signup (AUTO-ACCEPT — decided):** when a new user
  signs up, any `pending` handoffs with `to_email == their email` get `to_user_id`
  linked **and** flipped to `accepted`, so the shared recipes "just appear" in
  their shared list on arrival.
- **Orphaned invite (known, accepted limitation):** if the invitee signs up with a
  *different* email than the one invited, the `pending` grant never auto-resolves
  and stays dormant — harmless (no access leaked; a dormant `pending` row). It's
  reclaimable later via the deferred invite-link flow (the accept endpoint above).
  Not handled in MVP UI; documented so it isn't a silent surprise.

**4.3 Read gate (extend `effective_visibility`-based check)**
- Add a helper `can_view(recipe, user, db)`: `True` if
  `effective_visibility(root)=="public"` OR `recipe.user_id==user.id` OR an
  **accepted** handoff exists for `(root_id, user.id)`.
- Apply in `get_recipe` (replace the current owner-or-public check) and
  `get_lineage`. `browse` stays public-only (shared recipes are private, not a
  public feed).

**4.4 "Shared with me" (`GET /recipes/shared`)**
- Returns recipes the current user has an **accepted** handoff on (the root
  recipes; the grantee can then walk their subtrees). Excludes the user's own.

**4.5 Perf note:** the read-path grant lookup is one indexed query per recipe view;
add an index on `handoffs (recipe_id, to_user_id, state)`. The N+1 concern only
arises on list endpoints — `/recipes/shared` is a single filtered query, fine.

---

## 5. Frontend

**5.1 Passing (extend the existing HandoffInvite / "Pass it on")**
- The action already exists on RecipeDetail (owner) via `HandoffInvite`. Extend
  the copy so that when the recipe is **private**, it's clear passing grants
  access: *"Sam will be able to see, cook, and remix this."* When **public**, the
  copy stays a nudge: *"Let Sam know about this."*
- On success, if private, the recipe's control shows "Shared with N" (see §5.3).

**5.2 "Shared with me" surface**
- A section (in Kitchen, or a dedicated view) listing recipes shared with me:
  **accepted grants only** → the recipe cards (tap → detail, full grantee rights).
- **No "Accept" affordance in MVP.** Because in-app grants are instant-accept and
  email invites auto-accept on signup, a logged-in user never has a visible,
  actionable pending invite — so an accept button would be dead UI. Shared-with-me
  therefore shows only what's already accepted; a shared recipe simply appears.
  (The `POST /handoffs/{id}/accept` endpoint stays in the backend for the future
  invite-link / mismatched-email flow — see §4.2 — but has no MVP UI.)

**5.3 "Shared with N people" indicator**
- On a **private** recipe the owner is viewing, if it has accepted grants, the
  `VisibilityControl` area shows a subtle "· Shared with N" next to the 🔒 Private
  pill, tappable to see/kick grantees (manage-grants can be a fast-follow; MVP can
  show the count read-only).

**5.4 Bylines / attribution unchanged** — sharing doesn't touch authorship; a
shared recipe still shows "kept by [owner]".

---

## 6. MVP cut (full loop) + testing

**Build (full loop):**
1. Backend: `state` semantics → `pending|accepted`; root-normalize on handoff
   create; `can_view` helper + apply to `get_recipe`/`get_lineage`; instant-accept
   for in-app grants, pending for email; `POST /handoffs/{id}/accept`; email-invite
   linking on signup; `GET /recipes/shared`; index on the lookup.
2. Frontend: HandoffInvite copy adapts to visibility; "shared with me" view
   (accepted grants only — NO accept UI, §5.2); "Shared with N" indicator on the
   owner's private recipe.
3. Visual-verify: pass a private recipe to a 2nd user → it appears in their
   "shared with me" → they can view/cook/remix → a non-grantee still gets 404;
   email invite → signup → recipe appears.

**Test matrix (backend):**
- pass private → grantee (in-app) can `GET` it (200); non-grantee 404.
- root-binds: grantee can view a *descendant* of the shared root.
- pass normalizes to root: passing a branch grants access to the root's subtree.
- owner-only: non-owner passing → 404.
- email invite pending → grantee not yet resolved → no access; after signup with
  the matching email → auto-accepted → access (recipe appears in "shared with me").
- orphaned invite: signup with a *different* email than invited → grant stays
  `pending`, no access leaked, recipe does NOT appear.
- `GET /recipes/shared` returns accepted-grant recipes, excludes own, excludes
  pending.
- re-pass to same grantee is idempotent (no duplicate active grant).
- browse still excludes shared (private) recipes.

**Deferred (documented):** manage/revoke grants UI (MVP shows count; revoke is
fast-follow); family-group shortcut; re-share by grantees (explicitly not allowed).

---

## 7. Resolved decisions (2026-07-08)

1. **In-app grant = INSTANT access.** Passing a private recipe to an existing user
   creates the grant `state="accepted"` immediately; it appears in their "shared
   with me" with no accept step. **No Accept UI anywhere in MVP** (§5.2). (§4.1)
2. **Email-invite on signup = AUTO-ACCEPT.** When a user signs up with an email
   that has `pending` handoffs, those grants link to their account **and** flip to
   `accepted`, so the shared recipes are already present on arrival — the warmest
   first-run ("grandma's recipes are already here"). The explicit
   `POST /handoffs/{id}/accept` endpoint remains for any invite a user chooses to
   accept manually, but the signup path auto-accepts. (§4.2)
3. **MVP = count-only.** The owner sees "Shared with N people" (read-only, §5.3);
   the list-grantees + remove/revoke UI is a documented fast-follow (§6 Deferred).
