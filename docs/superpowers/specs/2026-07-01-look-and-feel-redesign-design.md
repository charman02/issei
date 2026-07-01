# Issei Look-and-Feel Redesign — Design Spec

**Date:** 2026-07-01
**Status:** Approved for planning
**Cycle:** Look-and-feel (positioning + voice + visual). Community/social features are a
separate, later brainstorm cycle.

## Summary

Reframe and reskin Issei from a spare, Asian-minimalist recipe store into a warm,
welcoming, "walking into a family kitchen" experience — while keeping the heritage soul
that makes it distinct. This cycle covers **positioning, voice, and visual design** across
the existing screens. No backend/data-model changes (the `description` and `story` fields
already exist). No new community features (those are deferred).

## Positioning

- **From:** "a REST API for the Asian immigrant community."
- **To:** universal welcome, heritage soul — anyone preserving family food memory belongs,
  while the heart stays in heritage, immigration, and passing culture down through food.
- **Name:** "Issei" is kept as a meaningful nod to first-generation immigrant roots.
- **Tagline:** *"Recipes that live in memory, not cookbooks."*

## Voice

Warm and intimate — speaks the way a loved one does: tender, personal, a little nostalgic.
Applied to the moments that invite people in (greetings, empty states, prompts, primary
buttons). **Functional microcopy** (form field labels, validation errors) stays clear and
plain — the tenderness never gets in the way of usability.

Reference lines:
- Empty Home: "Every family has a dish that means home. Start with the one you'd miss most."
- Add prompt: "What did they always make for you?"
- Primary button (author own): "Keep a recipe"
- Story prompt: "Who taught you this? Close your eyes — whose kitchen are you in?"

## Vocabulary

- **"Keep a recipe"** — author/record your *own* recipe.
- **"Add to your kitchen"** — save *another* user's recipe (reserved now; the saving
  feature itself is built in the community cycle).
- Both kinds live in the user's **"Kitchen."**
- Byline on recipes: **"kept by [user]."**
- Nav renamed: **Home · Browse · Add · Kitchen · You** (was Home/Recipes/Add/Profile).

## Design System

Encoded in `tailwind.config.js` + `index.css` for consistency and easy maintenance.

### Color tokens (replace current cream/primary/accent/secondary)

| Token | Hex | Use |
|---|---|---|
| `paper` | `#EFE4D2` | app background (warm, not white) |
| `card` | `#FBF6EC` | recipe cards, surfaces |
| `ink` | `#3A2A1C` | primary text (warm near-black) |
| `ink-soft` | `#6D5844` | secondary text |
| `line` | `#E3D3BA` | hairline borders |
| `terra` | `#BD5A2C` | primary accent — buttons, active states, quantity column |
| `saffron` | `#D99A2B` | secondary accent — chips, highlights |
| `herb` | `#6F8A4D` | tertiary accent — chips, tags |
| `plum` | `#8A3D5A` | occasional 4th accent |

### Typography

- **Playfair Display** (serif) — headings, recipe names, greetings; used far more
  prominently than the current design.
- **Inter** (sans) — body, labels, buttons, nav.
- Both fonts are already loaded; no new font dependencies.

### Components

Shared warmer treatment: warm-tinted soft shadows, `rounded-xl`, hairline `line` borders,
spice-toned chips, and a consistent section-label style (small uppercase Inter). The
`CoverImage` placeholder is restyled to the heirloom look (warm paper + 一世 mark), not a
cold gray box.

## Screen-by-screen

- **Login** — warm paper, Playfair wordmark, intimate voice on tabs/prompts. Signup keeps
  the stacked first/last name fields.
- **Home** — voice-driven greeting + tagline. Two horizontal card rows: "Passed down
  lately" (recent from everyone) and "From your kitchen" (the user's own). Terracotta
  "+ Keep a recipe." Empty state also shows the greeting.
- **Browse** — "Wander through everyone's kitchens." Spice-toned filter chips (wrap, all
  visible), cross-cultural cuisine rows (Japanese, Italian, Mexican, and more as recipes
  exist), larger cards with "kept by" bylines.
- **Recipe Detail** — photo hero → recipe name (Playfair) → "kept by [user]" byline → meta
  (serves/cuisine/time) → **"About this dish"** (description, practical) → **"The Story"**
  (spice-accented italic callout) → Ingredients (terracotta quantity column, fuzzy
  quantities intact) → Steps. Owner sees an **Edit** entry point.
- **Kitchen** (was My Recipes) — grid of the user's recipes in the new card style, with a
  "Keep a recipe" CTA.
- **You** (was Profile) — reskin of the current profile card + logout in the warm palette.
  (Fuller profile settings — edit/delete account — remain a separate task, not this cycle.)
- **Add/Edit form** — reskin the shared `RecipeForm` in the new palette; keep the
  single-field quantity, photo upload, description, and story sections.

## Implementation approach

1. **Design system first** — color tokens + type + shared utility classes in
   `tailwind.config.js` and `index.css`.
2. **Shared component reskin** — cards, chips, section labels, buttons, `CoverImage`
   placeholder.
3. **Screen-by-screen** — apply across each page, reviewable independently.
4. **Fold in Edit recipe frontend** — the in-progress `RecipeForm` extraction (shared by
   Add and Edit) lands with this reskin. Backend edit support (`PATCH /recipes/{id}`
   handling child collections) is already complete.

## Edge cases

- **No photo** → restyled heirloom placeholder (warm paper + 一世 mark).
- **No story / no description** → those sections don't render (both optional).
- **Long content** (names, stories, many ingredients) → layouts wrap gracefully.
- **Route rename** → keep the existing `/my-recipes` URL as-is; only the UI label changes
  to "Kitchen." No redirect logic needed, so no links break. (Nav renames are
  label-only; underlying route paths are unchanged.)

## Verification

- `npm run build` after each screen (catches syntax/import errors).
- Visual confirmation by running the app.
- Backend `pytest` stays green (no backend changes this cycle).

## Non-goals (deferred to community cycle)

- Richer Home features / more interactivity.
- More Browse filters beyond cuisine + dietary preference (meal type, time, difficulty,
  occasion, etc.).
- Building the "Add to your kitchen" save-others feature and any user-to-user social
  features.
- Fuller profile settings (edit details, delete account) — its own separate task.

## Follow-ups (tracked separately)

- Update `README.md`, `FUTURE.md`, `CLAUDE.md`, `ARCHITECTURE.md` to reflect the new
  positioning, voice, palette, nav labels, and vocabulary — done at the END of the
  redesign so docs match the final state.
