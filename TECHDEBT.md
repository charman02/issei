# Tech Debt

A running, honest ledger of shortcuts, deferrals, half-finished work, and things
worth understanding — so you can stay in focus mode without silently
accumulating surprises. Claude keeps this current as work happens.

**How to read this:** each item has **What** (the debt), **Why it exists**,
**Risk if ignored**, and **To resolve**. Severity: 🔴 high (bugs/prod risk),
🟡 medium (inconsistency/half-done), 🟢 low (cleanup/nice-to-have).

_Last updated: 2026-07-01, on branch `redesign/look-and-feel`._

---

## 🔴 Edit Recipe is half-shipped (backend done & uncommitted, frontend missing)

**What:** Backend support for editing a recipe (including replacing
ingredients/steps) is written and working in `app/routers/recipes.py` +
`app/schemas/recipe.py`, but those changes are **uncommitted** on the redesign
branch. The **frontend has no edit UI at all** — there is no `EditRecipe.jsx`,
no `RecipeForm.jsx`, and no `/recipes/:id/edit` route. The RecipeDetail mock
shows an "Edit" button, but it currently has nowhere to go.

**Why it exists:** We were mid-way through building Edit Recipe (had finished
and verified the backend) when we pivoted to the look-and-feel redesign. The
frontend half was never built.

**Risk if ignored:** Users can create recipes but never fix a typo. The
half-committed backend could get lost or confuse future work. The "Edit" button
in the redesign will be a dead end unless wired up.

**To resolve:** Commit the backend edit support; extract the shared `RecipeForm`
component (originally planned Tasks 10–11); build `EditRecipe.jsx` + the route;
point the RecipeDetail Edit button at it. Plan section already exists in
`docs/superpowers/plans/2026-07-01-look-and-feel-redesign.md`.

---

## 🟡 Redesign is partially applied — some screens still on the old look

**What:** The look-and-feel redesign (Fraunces, wordmark, RecipeCard, heirloom
craft) is done on **Login, Home, and the shared components** (BottomNav,
RecipeCard, CoverImage, Wordmark). Still **not** craft-passed: **Browse,
RecipeDetail, Kitchen (MyRecipes), You (Profile)** — these had an earlier
token-swap but not the real component craft. **`AddRecipe.jsx` still uses old
legacy tokens** (`bg-accent`, `border-secondary`, etc.) and the pre-redesign
form.

**Why it exists:** We're executing the craft pass screen-by-screen with review
checkpoints; only Login + Home are through the high-bar pass so far.

**Risk if ignored:** The app looks inconsistent mid-flight — a polished Login/
Home next to older-looking other screens.

**To resolve:** Finish "Craft D" (Browse, RecipeDetail, Kitchen, You) and fold
`AddRecipe` into the shared `RecipeForm` so it inherits the new look.

---

## 🟡 Legacy color tokens still defined and still referenced

**What:** `frontend/tailwind.config.js` still defines the old palette
(`cream`, `primary`, `accent`, `secondary`, `surface`) alongside the new
heirloom tokens. At least `AddRecipe.jsx` still uses them.

**Why it exists:** Kept intentionally during migration so un-migrated screens
keep building. Removal was planned as the final cleanup task.

**Risk if ignored:** New code might reach for an old token; the two palettes can
drift. Low correctness risk, real consistency risk.

**To resolve:** After every screen is migrated, delete the five legacy tokens
and run a repo-wide grep to confirm nothing references them (planned Task 12).

---

## 🟢 Playfair Display still loaded but no longer the display face

**What:** Fraunces is now the headline font, but `index.html` still loads
Playfair Display and it lingers as a `font-serif` fallback in the Tailwind
config.

**Why it exists:** Leftover from before the Fraunces switch.

**Risk if ignored:** A slightly heavier font download than needed; negligible.

**To resolve:** Drop Playfair from the Google Fonts link and the `font-serif`
stack once we've confirmed Fraunces renders everywhere.

---

## 🟢 No automated frontend tests

**What:** The frontend has no test framework. Every frontend change is verified
only by `npm run build` (catches syntax/import errors) plus manual visual review
on `localhost:5173`.

**Why it exists:** Out of scope so far; the project started backend-first
(backend has `pytest`, 5 tests).

**Risk if ignored:** Regressions in UI logic (auth flow, quantity parsing, form
submission) won't be caught automatically. Relies on manual clicking.

**To resolve:** If the frontend grows, add Vitest + React Testing Library for the
logic-heavy pieces (e.g. `utils/quantity.js`, auth handling, form payloads).

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
