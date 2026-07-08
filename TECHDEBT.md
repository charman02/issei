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

## 🟡 (b) Remix silently drops edited name/notes

**What:** `RemixIn` (`app/schemas/recipe.py:93`) carries only `ingredients`,
`steps`, and `prompt_answer`; `remix_recipe` (`recipes.py:142-156`) copies
`name` (and description, etc.) from the parent. If the remix form lets a user
edit the recipe name or notes, those edits are silently discarded.

**Why it exists:** Remix was scoped to branch content, not metadata.

**Risk if ignored:** User edits to name/notes on a remix vanish with no error.

**To resolve:** Add `name`/`notes` (and any other editable scalars) to `RemixIn`
and apply them in `remix_recipe`, or make the form read-only for those fields.

---

## 🟡 (c) Unauthenticated browse now exposes owner activity

**What:** `browse_recipes` (`recipes.py:244`) has no auth dependency and returns
full `RecipeResponse`, so `owner_cook_count` and `last_cooked_at` (added by
`_attach_growth_fields`) are public for every public-root recipe.

**Why it exists:** Browse reuses the same `RecipeResponse` schema as the
authenticated endpoints.

**Risk if ignored:** Owner-scoped activity data leaks to anonymous visitors.

**To resolve:** Use a slimmer public response schema for browse, or drop
owner-scoped fields from the unauthenticated feed.

---

## 🟢 (d) Unused import

**What:** `from sqlalchemy import func` at `recipes.py:20` is never used (no
`func.` reference anywhere in the file).

**Why it exists:** Leftover from an earlier iteration.

**Risk if ignored:** None — cosmetic lint noise.

**To resolve:** Remove the import.

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
