# Issei Redesign — Locked Decisions (session of 2026-07-01 → 07-03)

This captures every design decision made during the look-and-feel redesign
brainstorm, so the work survives a VS Code / session restart. It supersedes the
earlier `2026-07-01-look-and-feel-redesign-design.md` where they differ (that
spec predates the Fraunces/wordmark/craft decisions below).

**Branch:** `redesign/look-and-feel`. **Status:** all design decisions LOCKED;
build not yet started (was about to build "Craft D" + retrofit Login/Home).

---

## Positioning / voice / vocabulary

- **Positioning:** universal welcome + heritage soul. Open to anyone preserving
  family food memory; heart stays in heritage/immigration. "Issei" name kept.
- **Tagline:** *"Recipes that live in memory, not cookbooks."*
- **Voice:** warm & intimate, like a loved one. Functional microcopy (errors,
  field labels) stays plain and clear.
- **Vocabulary:** "Keep a recipe" = author your own. "Add to your kitchen" =
  save another user's (feature built later). Byline "kept by [name]". Both live
  in "Kitchen." Nav: **Home · Browse · Add · Kitchen · You**.
- Auth action label consistent: tab + button both say "Sign in". Loading:
  "Signing in…" / signup "Setting your table…". Placeholders sentence case.

## Brand

- **Wordmark-only logo, lowercase:** `issei.` in **Fraunces**, weight 900,
  letter-spacing −0.03em, color ink `#3A2A1C`, with a **terra `#BD5A2C` period**.
  No symbol/kanji glyph — the wordmark IS the app icon (Beli-style).
- App icon = `issei.` (or `is.`) Fraunces on terra ground.

## Type

- **Mostly-Fraunces.** Fraunces (serif) is the near-universal font: titles,
  headings, meta rows, About body, ingredients, steps body — all Fraunces.
- **Inter** only for tiny utility text: nav labels, eyebrows / section labels,
  chips, field placeholders.
- Fraunces is a variable font — use the `opsz` axis + slightly larger body size
  + generous line-height so serif body text stays readable. Turnable knob if any
  block feels heavy.
- Both fonts already loaded in `index.html`. (Playfair Display still loaded as a
  leftover fallback — remove during cleanup; see TECHDEBT.md.)

## Palette (Tailwind tokens, already in `tailwind.config.js`)

| token | hex | use |
|---|---|---|
| paper | #EFE4D2 | app background |
| card | #FBF6EC | cards, surfaces, input fills |
| ink | #3A2A1C | primary text |
| ink-soft | #6D5844 | secondary text |
| line | #E3D3BA | hairline borders |
| terra | #BD5A2C | primary accent (buttons, active, quantities, period) |
| saffron | #D99A2B | secondary accent |
| herb | #6F8A4D | tertiary accent |
| plum | #8A3D5A | occasional 4th accent |

Warm shadows: `shadow-warm` = `0 2px 10px rgba(120,80,40,.10)`, `shadow-warm-lg`
= `0 12px 32px rgba(80,50,20,.18)`.

## Icons

- Use **Lucide** glyphs, stroke ~1.7, 24-grid. **OPEN DECISION:** inline the
  Lucide SVG paths into a small custom `Icon` component (no dependency, respects
  CLAUDE.md "custom Tailwind only") vs. add `lucide-react` package. Leaning
  inline. (Mock icons so far were hand-drawn placeholders.)
- Icons needed: back chevron, pencil (edit), mail, lock, search, person (serves),
  bowl (cuisine), clock (time), + nav set (home, compass, plus, book, person).

---

## Screen specs

### Login (built earlier; needs Fraunces/Lucide + field retrofit)
- Hero `issei.` wordmark (~56px). Italic Fraunces tagline.
- **Meaning passage:** quiet left-ruled quote (2px terra left border), italic
  Fraunces body, small terra label "一世 · issei" above. Copy:
  *"The first of a family to arrive somewhere new — the ones who carry the
  recipes no one wrote down. This is where they stay alive, passed from one
  generation to the next."*
- **Pill tabs** (cream-raised): track `#E6D7BD`, active side = paper fill +
  soft shadow + terra text, Fraunces 600 labels ("Sign In" / "Join the table").
- **Input fields — treatment C:** cream card fill `#FBF6EC`, soft border
  `#ddcba8`, Lucide leading icon (mail/lock) in terra, terra focus ring
  `rgba(189,90,44,.12)` + terra border on focus.
- Orange Fraunces CTA buttons.

### Home (built earlier; retrofit to Fraunces/Lucide)
- Eyebrow greeting (Inter uppercase spaced terra): "Good evening, [first name]".
- Fraunces 900 hero "What's cooking tonight?" (~32px). Italic Fraunces tagline.
- Section headers: `SectionHeader` = uppercase Inter label + hairline rule +
  small `issei.` seal at end. Sections: "Passed down lately", "From your kitchen".
- Horizontal RecipeCard rows. Empty state: wordmark + "Every family has a dish
  that means home." + "Keep your first recipe" CTA.

### Browse
- Fraunces 900 "Browse" + italic tagline "Wander through everyone's kitchens."
- Search field (Lucide search icon). Diet filter chips (wrap; `.chip` /
  `.chip--active`, terra fill when active). Cross-cultural CUISINES list
  (Japanese, Korean, Chinese, Filipino, Vietnamese, Thai, Indian, Middle
  Eastern, Mexican, Italian, West African, Caribbean) + Quick & Easy +
  Recently Added; each renders only if non-empty.
- Cuisine section headers (label + rule). Horizontal RecipeCard rows.

### Recipe Detail (fully specced; NOT yet built)
- **Hero:** clean photo, subtle TOP gradient, NO cuisine stamp. Matched cream
  circle buttons: back (chevron) TOP-LEFT, edit (pencil) TOP-RIGHT (edit = owner
  only). Both Lucide line icons.
- **Title:** Fraunces 900, 28px, line-height 1.02, −0.01em. Clean title row
  (title + byline + meta), wraps freely.
- **Byline:** solid terra monogram avatar (first initial, white Fraunces) +
  "kept by" in ink-soft + NAME in terra 600. (Person-avatar pattern reused for
  future community features; upgrades to photo later.)
- **Meta row:** Fraunces text, terra Lucide icons — person=serves, bowl=cuisine,
  clock=time.
- **Section headers (About / Ingredients / Steps):** Fraunces 700 bold +
  trailing hairline rule.
- **The Story (treatment 5):** filled terra header band — solid terra bar with
  italic Fraunces label reversed white, body panel `#efdcbb`, italic Fraunces
  body. Only renders if story present.
- **About this dish:** Fraunces serif body, ink-soft. Only renders if present.
- **Ingredients:** terra quantity column LEFT-aligned (~80px), all Fraunces, no
  dashed dividers, header rule kept. Fuzzy quantities ("a thumb", "to taste")
  supported.
- **Steps:** large Fraunces 900 terra numerals (no circle) + Fraunces body text.

### Kitchen (MyRecipes)
- Fraunces 900 "Your Kitchen" + italic "Everything you've kept."
- Search field. 2-col grid of RecipeCards (variant="grid"). Empty state (no
  search): "Your kitchen's just getting started. Keep your first recipe."

### You (Profile)
- Fraunces 900 "You". Card: large terra monogram avatar, name (Fraunces),
  Email label + value. Log out button (red outline).

### Add / Edit recipe (shared RecipeForm — NOT yet built)
- Heading Fraunces 900: "Keep a recipe" (add) / "Edit recipe" (edit).
- Photo dropzone (dashed, Lucide camera, "Add a photo to bring this recipe to
  life", "JPEG, PNG, or WebP · max 10 MB"), remove (×) button when photo set,
  client-side format+size validation, photoError shown by the box.
- Sections: Recipe details (name/servings/cuisine/description), The Story
  (textarea), Ingredients (single free-text quantity field per row, parsed by
  `utils/quantity.js`), Steps.
- Submit: "Keep this recipe" (add) / "Save changes" (edit).

---

## Components

- **Built:** `Wordmark`, `RecipeCard` (squared corners, layered paper edge,
  cream stamp cuisine tag on photo, Fraunces name, italic terra "kept by";
  variants row/grid), `CoverImage` (heirloom placeholder), `BottomNav` (Lucide
  icons, active terra seal disc, raised terra Add). NOTE: these were built before
  the mostly-Fraunces + Lucide + final decisions — need updating to match.
- **To build:** `SectionHeader` (was deleted/never finalized — recreate:
  label + rule + `issei.` seal), `Icon` (inline Lucide, if that route chosen),
  `RecipeForm` (shared Add/Edit), `EditRecipe` page.

## Build plan (Craft D)

1. Resolve icon approach (inline Lucide vs package) + build `Icon`/`SectionHeader`.
2. Retrofit Login (fields C + icons) + Home to mostly-Fraunces + Lucide.
3. Build Recipe Detail to spec.
4. Reskin Browse (RecipeCard, chips, cuisines, mostly-Fraunces).
5. Reskin Kitchen + You.
6. Extract shared `RecipeForm`; make AddRecipe a wrapper; build `EditRecipe` +
   `/recipes/:id/edit` route; commit the (already-done) backend edit support.
7. Remove legacy color tokens + Playfair; full build + visual verify.
8. Update docs (README, FUTURE, CLAUDE, ARCHITECTURE) — Task 13.

## Outstanding / notes

- **OPEN:** icon approach (inline vs package) — needs decision before build.
- Backend edit support (PATCH replacing ingredients/steps) is DONE and verified
  but **uncommitted** (`app/routers/recipes.py`, `app/schemas/recipe.py`).
- Approved full-app mockup lives at
  `.superpowers/brainstorm/*/content/full-app.html` (gitignored).
- PROCESS: do NOT git commit without user approval (CLAUDE.md). Ultracode on.
- TECHDEBT.md tracks: Edit-recipe half-shipped, redesign partial, legacy tokens,
  Playfair leftover, no frontend tests, dev gotchas (node PATH, Vite stale
  tailwind config needs server restart).
