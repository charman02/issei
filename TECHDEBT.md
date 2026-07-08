# Tech Debt

A running, honest ledger of shortcuts, deferrals, half-finished work, and things
worth understanding — so you can stay in focus mode without silently
accumulating surprises. Claude keeps this current as work happens.

**How to read this:** each item has **What** (the debt), **Why it exists**,
**Risk if ignored**, and **To resolve**. Severity: 🔴 high (bugs/prod risk),
🟡 medium (inconsistency/half-done), 🟢 low (cleanup/nice-to-have).

_Last updated: 2026-07-08, on branch `lineage-mvp`._

---

## 🔴 (a) Self-parent FK is `ondelete=SET NULL`, not `RESTRICT` — orphan / visibility-leak risk

**What:** `app/models/recipe.py:33-35` sets the `parent_recipe_id` FK with
`ondelete="SET NULL"`. If a parent recipe row were hard-deleted, children
silently detach — and because `effective_visibility` (`services/lineage.py:41`)
walks to the (now-missing) root, a formerly-private descendant could resolve to
its own default `visibility="private"` or become an orphan root.

**Why it exists:** Deletion semantics were left permissive pending the
account-deletion / tombstone model.

**Risk if ignored:** Currently unreachable — there is no account-deletion path
and remix children default to private, so no leak today. Becomes a real
orphan/visibility-leak risk the moment hard-delete is enabled.

**To resolve:** Build the account-deletion + tombstone model (per the 2026-07-06
spec) before enabling deletion; prefer `RESTRICT` or an explicit
re-parenting/tombstone step.

---

## 🟡 (e) N+1 growth queries on list/browse, untested

**What:** `_attach_growth_fields` (`recipes.py:25`) issues 3 queries per recipe
(cooks, child ids, grandchildren) and is called in a loop by `list_recipes`
(`:240`) and `browse_recipes` (`:255`). No tests cover the list/browse growth
path.

**Why it exists:** Growth fields were added per-recipe first; list/browse reused
the same helper.

**Risk if ignored:** Query count scales with list size (N+1); performance
degrades as libraries grow, and there's no test guarding the behavior.

**To resolve:** Batch the counts (group-by / aggregate) and add list/browse
growth tests.

---

## 🔴/🟡 (f) Pre-existing: two migrations fail on fresh SQLite

**What:** `0894735d3ccd_..._.py` (lines 38/47) and
`bba3856b2139_align_child_fk_ondelete_with_models.py` (lines 24–61) call
`batch_op.drop_constraint('..._fkey', type_='foreignkey')` on named Postgres FK
constraints that don't exist on a fresh SQLite DB, so `alembic upgrade head`
from scratch on SQLite errors.

**Why it exists:** Migrations were authored against the production Postgres
constraint names.

**Risk if ignored:** A from-scratch SQLite setup (new dev machine, CI) can't run
migrations end-to-end.

**To resolve:** Guard the drops for SQLite (skip when the dialect is sqlite, or
use naming-convention-aware batch ops).

---

## 🟢 (g) Dev-dependency npm audit warnings

**What:** The new frontend test tooling (vitest / testing-library / playwright
dev deps) surfaces npm audit warnings.

**Why it exists:** Transitive dev-dependency advisories.

**Risk if ignored:** Cosmetic — dev-only dependencies, not shipped to users.

**To resolve:** Track and bump when convenient.

---

## 🟡 (h) Anonymity / deletion model specced but NOT built

**What:** The 2026-07-06 spec calls for `is_anonymous` / `is_tombstone` columns
and an account-deletion / anonymize flow; neither column nor flow exists in the
code (grep for `is_anonymous` / `is_tombstone` = no matches).

**Why it exists:** Deferred to a later sub-project of the lineage feature.

**Risk if ignored:** This is the counterpart to debt (a): deletion stays disabled
until this lands, so contributors can't leave cleanly.

**To resolve:** Implement the tombstone/anonymity columns + deletion endpoint per
spec.

---

## 🟢 (i) Growth 'blooming' state is inert; seed may read faint

**What:** `growthState.js:41` can return `'blooming'`, but `GrowthMark.jsx:43`
only styles `bloom === 'dormant'` (opacity 0.5) — `'blooming'` renders
identically to `'normal'`. Also the `seed` glyph is a small filled ellipse that
can read faint at small sizes (default 20px).

**Why it exists:** Botanical art is still in progress (final art = task #10).

**Risk if ignored:** A state that never shows; a mark that's hard to see at list
sizes.

**To resolve:** Give `blooming` a visible treatment (e.g. accent/animation) and
strengthen the seed mark at small sizes.

---

## 🔴 (j) `GET /recipes/{id}/scale` has no visibility/grant gate

**What:** `get_scaled_recipe` (`app/routers/recipes.py`) filters only on
`deleted_at IS NULL` — it does **not** apply `can_view`. Any logged-in user can
call `/recipes/{id}/scale?servings=n` on ANY recipe (private, shared, or public)
and receive the full recipe body (name, ingredients, steps). Introduced by commit
`c99d420` ("Allow viewing any recipe"), predating the sharing work.

**Why it exists:** Scaling was made broadly viewable before per-root visibility
and grant-based sharing existed. The sharing feature gated `get_recipe` and
`get_lineage` on `can_view` but deliberately kept scope to those two endpoints;
`/scale` was flagged during Task 3 and left for a focused fix.

**Risk if ignored:** Read-authorization bypass — a private or shared-only recipe's
contents leak to any authenticated user who guesses/enumerates an id via the scale
endpoint. Now inconsistent with the grant-aware read endpoints.

**To resolve:** Gate `get_scaled_recipe` on `can_view(recipe, current_user, db)`
(same 404-on-deny as `get_recipe`), and add a test: non-owner/non-grantee scaling
a private recipe → 404.

---

## 🟡 (k) Sharing: manage/revoke grants UI deferred (MVP is count-only)

**What:** The owner sees "Shared with N" on a private recipe (read-only count),
but there is no UI to list grantees or revoke a grant. The `handoffs` grant rows
exist and could be revoked at the data layer, but nothing surfaces it.

**Why it exists:** MVP scope (sharing spec §6 "Deferred") — count-only was chosen
to ship the loop; manage/revoke is a documented fast-follow.

**Risk if ignored:** An owner can share but not un-share from the UI; a mistaken
share can't be walked back without direct DB access.

**To resolve:** Add a grantee list + revoke action (delete/deactivate the
`handoffs` row) behind the "Shared with N" indicator.

---

## 🟡 (l) Sharing: orphaned email invite (mismatched email) never resolves in-app

**What:** If an owner emails an invite to `a@x.com` but the invitee signs up with
`b@y.com`, the `pending` handoff never auto-accepts (auto-accept matches on email).
The grant stays a dormant `pending` row — no access leaked, but the recipe never
appears for that user. The `POST /recipes/handoffs/{id}/accept` endpoint exists to
claim it, but has no MVP UI (no invite-link flow).

**Why it exists:** Accepted MVP limitation (sharing spec §4.2) — the two auto-accept
paths (in-app instant, email-match on signup) cover the common cases; the
invite-link/claim flow was deferred.

**Risk if ignored:** A minority of email invites silently do nothing if the invitee
uses a different email; the inviter isn't told.

**To resolve:** Build an invite-link flow (tokenized URL → `accept` endpoint), or
surface pending-invite claiming in-app.

---

## 🟢 (m) Sharing: family-group shortcut not built

**What:** "Pass to everyone in this list" (a family group) is not implemented;
sharing is one recipient at a time.

**Why it exists:** Deferred sugar over the per-person grant (sharing spec §2);
YAGNI for MVP.

**Risk if ignored:** Sharing a recipe with a whole family is N separate passes.

**To resolve:** Add a group abstraction that expands to per-person grants on the
root, reusing the existing handoff mechanism.

---

## Resolved (2026-07-08)

Cleared on the `lineage-mvp` branch: **Edit Recipe half-shipped** (backend
committed — `patch_recipe`, `recipes.py:370` — plus `EditRecipe.jsx`,
`RecipeForm.jsx`, and the `/recipes/:id/edit` route); **No automated frontend
tests** (Vitest + RTL harness now exists — `package.json` `test` script,
`test/setup.js`, and 9 `*.test.*` files); **Playfair Display still loaded**
(verified gone from `index.html` and `tailwind.config.js`); **Redesign partially
applied** (all live/routed screens are on the new look; the only laggard,
`AddRecipe.jsx`, is no longer routed); **Legacy color tokens still referenced**
(no live/routed screen references `cream`/`primary`/`accent`/`secondary`/
`surface` — only the dead, unrouted `AddRecipe.jsx` did).

Cleared in the sub-project-2 final-review fix (`461f028`): **(b) Remix dropped
edited name/notes** (`RemixIn` now carries `name`/`servings`/`cuisine`/
`description`/`notes`, applied edited-else-inherit in `remix_recipe`); **(c)
Unauthenticated browse exposed owner activity** (`browse_recipes` now zeroes
`owner_cook_count` and nulls `last_cooked_at` on the public feed); **(d) Unused
`func` import** (removed).

Cleared by the **recipe-visibility feature** (`daac1d9`..`6ec098a`): recipes had
**no way to be made public** — `RecipeCreate`/`RecipeUpdate` never accepted
`visibility`, so every recipe was permanently private and Browse showed nothing.
Now: `visibility` is accepted on create (root-only) and patch (root-only, `400` on
a branch), with an owner status pill + publish/un-publish control on RecipeDetail.

---

## 🟢 Dev workflow friction (Windows / Git Bash)

**What:** Two recurring gotchas during development, not app bugs:
1. `node`/`npm` aren't on PATH in non-interactive shells — commands must be
   prefixed with `export PATH="$PATH:/c/Program Files/nodejs"`.
2. Vite does **not** reliably hot-reload `tailwind.config.js` changes — after
   editing tokens/fonts, the dev server must be restarted or it serves a stale
   config (we hit a false `text-ink-soft does not exist` error from this).
   Similarly, `uvicorn --reload` sometimes serves stale code after edits.

**Why it exists:** Environment/tooling quirks on this Windows setup.

**Risk if ignored:** Confusing "phantom" errors that look like real bugs but are
just stale caches — already cost us debugging time twice.

**To resolve:** When a change "isn't showing up," restart the relevant dev
server before assuming a code bug. (Documented here so it's not re-diagnosed
each time.)

---

## Context: production & data notes (not debt, but easy to overlook)

- **The running backend and all migrations point at the production Neon
  Postgres DB** (`.env` `DATABASE_URL`). There is no separate staging DB — dev
  work and tests that hit the real engine touch prod data. Be deliberate.
- **`main` auto-deploys to Render on push.** The redesign lives on
  `redesign/look-and-feel` specifically to avoid shipping a half-done redesign
  to production; merge only when it's cohesive.
- **`CLOUDINARY_*` env vars** must be set in Render or photo upload fails at
  runtime (the app boots fine without them thanks to empty-string defaults).
