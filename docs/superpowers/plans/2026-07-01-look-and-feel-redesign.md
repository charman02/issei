# Issei Look-and-Feel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin Issei's frontend from spare Asian-minimalism into a warm "family kitchen" heirloom aesthetic, rewrite copy in an intimate voice, expand vocabulary/nav, and land the in-progress Edit Recipe feature.

**Architecture:** Frontend-only reskin (React + Vite + Tailwind). Introduce a new design-token set in `tailwind.config.js` + `index.css`, then migrate shared components and each screen from old tokens to new. Fold in the Edit Recipe frontend (extract a shared `RecipeForm` used by both Add and Edit; the backend `PATCH` already supports child collections). No data-model changes.

**Tech Stack:** React 18 (function components + hooks), Vite 5, Tailwind CSS 3, React Router 6, Axios. Fonts: Playfair Display (serif) + Inter (sans), already loaded via `index.html`.

## Global Constraints

Every task implicitly includes these.

- **Palette (exact hex, define once in `tailwind.config.js`):** `paper #EFE4D2`, `card #FBF6EC`, `ink #3A2A1C`, `ink-soft #6D5844`, `line #E3D3BA`, `terra #BD5A2C`, `saffron #D99A2B`, `herb #6F8A4D`, `plum #8A3D5A`.
- **Type:** Playfair Display (`font-serif`) for headings/recipe names/greetings; Inter (`font-sans`) for body/labels/buttons/nav. No new fonts.
- **Voice — warm & intimate** for greetings, empty states, prompts, and primary buttons. **Functional microcopy** (field labels, validation errors) stays plain and clear. Do not make error messages "cute."
- **Vocabulary (verbatim):** "Keep a recipe" = author your own. "Add to your kitchen" = save another user's (reserved; feature built later). Both live in "Kitchen." Recipe byline: "kept by [name]". Nav labels: **Home · Browse · Add · Kitchen · You**.
- **Routes unchanged:** nav renames are label-only. `/my-recipes` URL stays; only its UI label becomes "Kitchen." `/profile` stays; label becomes "You."
- **Mobile-first**, max-width 430px centered (`max-w-app`), existing bottom-nav layout.
- **All API calls go through `src/api/client.js`.** JWT under `issei_token`, user under `issei_user`.
- **Verification method (frontend):** there is NO frontend unit-test framework in this project, and adding one is out of scope. Each frontend task verifies with: (1) `cd frontend && npm run build` exits 0 with no errors, and (2) visual confirmation on the running dev server (`http://localhost:5173`). Node is not on PATH in non-interactive shells — prefix build/dev commands with `export PATH="$PATH:/c/Program Files/nodejs"`.
- **Verification method (backend):** `venv/Scripts/python.exe -m pytest -q` stays green (run from repo root).
- **Do NOT build (deferred to community cycle):** richer Home features, extra Browse filters beyond cuisine + dietary, the "Add to your kitchen" save-others feature, user-to-user social, fuller profile settings (edit/delete account).

---

## File Structure

**New files:**
- `frontend/src/components/RecipeForm.jsx` — shared create/edit form (extracted from `AddRecipe.jsx`), holds all form state, photo upload, quantity parsing, ingredient/step management; calls an injected `onSubmit(payload)`.
- `frontend/src/pages/EditRecipe.jsx` — loads a recipe by id, renders `RecipeForm` prefilled, submits via `PATCH /recipes/:id`.

**Modified files:**
- `frontend/tailwind.config.js` — new color tokens + warm shadows.
- `frontend/index.html` — body background/text classes.
- `frontend/src/index.css` — shared heirloom component classes (chips, story callout, section label).
- `frontend/src/components/CoverImage.jsx` — heirloom placeholder.
- `frontend/src/components/BottomNav.jsx` — new labels + warm palette.
- `frontend/src/pages/Login.jsx`, `Home.jsx`, `Browse.jsx`, `RecipeDetail.jsx`, `MyRecipes.jsx`, `Profile.jsx` — reskin + copy.
- `frontend/src/pages/AddRecipe.jsx` — thin wrapper over `RecipeForm`.
- `frontend/src/App.jsx` — add `/recipes/:id/edit` route.
- Backend (already changed, needs commit): `app/routers/recipes.py`, `app/schemas/recipe.py`.
- Docs (final task): `README.md`, `FUTURE.md`, `CLAUDE.md`, `ARCHITECTURE.md`.

**Token migration map (old → new):**
| Old | New |
|---|---|
| `bg-cream` | `bg-paper` |
| `bg-surface` | `bg-card` |
| `text-primary` | `text-ink` |
| `text-gray-400/500` (secondary text) | `text-ink-soft` |
| `text-accent` | `text-terra` |
| `bg-accent` | `bg-terra` |
| `border-secondary` | `border-line` |
| `bg-secondary/*` (fills) | `bg-line/*` |

---

## Task 1: Design-system foundation (tokens, shadows, shared classes)

**Files:**
- Modify: `frontend/tailwind.config.js`
- Modify: `frontend/src/index.css`
- Modify: `frontend/index.html:11`

**Interfaces:**
- Produces: Tailwind utilities `bg-paper bg-card text-ink text-ink-soft border-line bg-terra text-terra bg-saffron bg-herb bg-plum shadow-warm shadow-warm-lg`; CSS component classes `.section-label`, `.chip`, `.chip--active`, `.chip--herb`, `.chip--saffron`, `.chip--plum`, `.story-callout`. Old tokens (`cream/surface/primary/accent/secondary`) remain temporarily so unmigrated screens keep building; removed in Task 12.

- [ ] **Step 1: Add new color tokens + warm shadows to Tailwind config**

Replace the `theme.extend` block in `frontend/tailwind.config.js` with:

```js
    extend: {
      colors: {
        // New heirloom palette
        paper: '#EFE4D2',
        card: '#FBF6EC',
        ink: '#3A2A1C',
        'ink-soft': '#6D5844',
        line: '#E3D3BA',
        terra: '#BD5A2C',
        saffron: '#D99A2B',
        herb: '#6F8A4D',
        plum: '#8A3D5A',
        // Legacy tokens — retained until Task 12 migration completes
        cream: '#F7F2EA',
        primary: '#1A1A1A',
        accent: '#8B5E3C',
        secondary: '#D4C5B0',
        surface: '#FFFFFF',
      },
      fontFamily: {
        serif: ['Playfair Display', 'serif'],
        sans: ['Inter', 'sans-serif'],
      },
      boxShadow: {
        warm: '0 2px 10px rgba(120, 80, 40, 0.10)',
        'warm-lg': '0 12px 32px rgba(80, 50, 20, 0.18)',
      },
      maxWidth: {
        app: '430px',
      },
    },
```

- [ ] **Step 2: Add shared heirloom component classes to `index.css`**

Append to `frontend/src/index.css` (after the existing `@layer utilities` block):

```css
@layer components {
  .section-label {
    @apply text-[11px] font-sans font-medium uppercase tracking-[0.16em] text-ink-soft;
  }
  .chip {
    @apply inline-block px-4 py-1.5 rounded-full text-sm font-sans border border-line bg-card text-ink-soft transition-colors;
  }
  .chip--active { @apply bg-terra text-white border-terra; }
  .chip--herb { @apply bg-herb text-white border-herb; }
  .chip--saffron { @apply bg-saffron text-[#4a3210] border-saffron; }
  .chip--plum { @apply bg-plum text-white border-plum; }
  .story-callout {
    @apply bg-[#F3E7D0] border-l-[3px] border-terra rounded-r-xl p-4;
  }
}
```

- [ ] **Step 3: Update `index.html` body classes**

Change `frontend/index.html` line 11 from:

```html
  <body class="bg-cream font-sans text-primary">
```
to:
```html
  <body class="bg-paper font-sans text-ink">
```

- [ ] **Step 4: Verify build**

Run: `cd frontend && export PATH="$PATH:/c/Program Files/nodejs" && npm run build`
Expected: exits 0, "✓ built". (New utility classes compile; nothing references them yet, so no visual change.)

- [ ] **Step 5: Commit**

```bash
git add frontend/tailwind.config.js frontend/src/index.css frontend/index.html
git commit -m "Add heirloom design tokens, warm shadows, shared chip/story classes"
```

---

## Task 2: CoverImage heirloom placeholder

**Files:**
- Modify: `frontend/src/components/CoverImage.jsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: unchanged component API — `<CoverImage url size className />` with `size` in `sm|md|lg`. Used by Home, Browse, MyRecipes, RecipeDetail, RecipeForm.

- [ ] **Step 1: Reskin the placeholder to the paper palette**

Replace the placeholder `<div>` block (lines 15-24) in `CoverImage.jsx` so the fallback uses `bg-paper` with terra/ink-soft text instead of `bg-cream`/`accent`:

```jsx
  const s = sizes[size] || sizes.md
  return (
    <div
      className={`bg-paper flex flex-col items-center justify-center text-center px-3 ${className}`}
    >
      <span className={`font-serif text-terra/70 leading-none ${s.mark}`}>一世</span>
      <span className={`text-ink-soft/80 mt-1.5 leading-tight ${s.text}`}>
        A photo brings this dish to life
      </span>
    </div>
  )
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && export PATH="$PATH:/c/Program Files/nodejs" && npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/CoverImage.jsx
git commit -m "Reskin CoverImage placeholder to heirloom palette"
```

---

## Task 3: BottomNav — new labels + warm palette

**Files:**
- Modify: `frontend/src/components/BottomNav.jsx`

**Interfaces:**
- Produces: nav with items Home (`/`), Browse (`/browse`), Add (`/add`, center raised), Kitchen (`/my-recipes`), You (`/profile`). Routes unchanged.

- [ ] **Step 1: Rename labels**

In `BottomNav.jsx`, change the `navItems` label for path `/my-recipes` from `'My Recipes'` to `'Kitchen'`, and the label for `/profile` from `'Profile'` to `'You'`. Leave icons and paths as-is.

- [ ] **Step 2: Reskin nav palette**

In the `<nav>` and button className strings, migrate tokens: `bg-surface` → `bg-card`, `border-secondary/40` → `border-line`, active `text-accent` → `text-terra`, inactive `text-gray-400` → `text-ink-soft/60`. For the center Add button, `bg-accent` → `bg-terra`. (Exact structure stays; only these class names change.)

- [ ] **Step 3: Verify build**

Run: `cd frontend && export PATH="$PATH:/c/Program Files/nodejs" && npm run build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/BottomNav.jsx
git commit -m "Rename nav to Home/Browse/Add/Kitchen/You and reskin to heirloom palette"
```

---

## Task 4: Login reskin + voice

**Files:**
- Modify: `frontend/src/pages/Login.jsx`

- [ ] **Step 1: Migrate palette tokens**

Across `Login.jsx`, apply the token migration map: `bg-cream`→`bg-paper`, `text-primary`→`text-ink`, `text-gray-400/500`→`text-ink-soft`, `border-secondary`→`border-line`, `bg-surface`→`bg-card`, `text-accent`/`border-accent`→`text-terra`/`border-terra`, `bg-accent`→`bg-terra`. Keep the red error text as-is (functional microcopy).

- [ ] **Step 2: Update copy to intimate voice**

- Under the `一世` wordmark, change the subtitle `Issei` line to add the tagline: keep `Issei` but add a line below it: `Recipes that live in memory, not cookbooks.` (class `text-sm text-ink-soft italic`).
- Login submit button label: keep `Log In` (functional).
- Signup submit button label: change `Sign Up` button's idle text to `Join the table` (keep loading text `Creating account...`).
- Tab labels stay `Login` / `Sign Up` (functional).

- [ ] **Step 3: Verify build + visual**

Run: `cd frontend && export PATH="$PATH:/c/Program Files/nodejs" && npm run build` → exits 0.
Then visually confirm at `http://localhost:5173/login`: warm paper bg, serif wordmark, tagline, "Join the table" on the signup tab.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Login.jsx
git commit -m "Reskin Login to heirloom palette with tagline and warmer signup CTA"
```

---

## Task 5: Home reskin + voice + section names

**Files:**
- Modify: `frontend/src/pages/Home.jsx`

**Interfaces:**
- Consumes: `CoverImage` (Task 2). `GET /recipes` (own recipes; existing).

- [ ] **Step 1: Migrate palette tokens** across the file per the map (`bg-cream`→`bg-paper`, `text-primary`→`text-ink`, `text-gray-*`→`text-ink-soft`, `bg-secondary/30`→`bg-line/40`, `bg-accent`→`bg-terra`, `text-accent`→`text-terra`).

- [ ] **Step 2: Update the populated-state copy**

- The `一世` line stays.
- Greeting `<h2>`: change to `{getGreeting()}, {user.first_name || 'friend'}.` on one line, and add a serif sub-line below it: `What's cooking tonight?` (Playfair, `text-xl text-ink`). Keep the tagline `Recipes that live in memory, not cookbooks.` as `text-sm text-ink-soft italic` beneath.
- Rename the section heading `Recent Recipes` → `From your kitchen` using `.section-label`.

- [ ] **Step 3: Update the empty-state copy** (the `recipes.length === 0` branch, which already shows the greeting per prior work)

- Keep greeting at top.
- Headline: `Every family has a dish that means home.`
- Subtext: `Start with the one you'd miss most — the taste you'd want to keep forever.`
- Button label: `Keep your first recipe` (was "Add your first recipe"), `bg-terra`.

- [ ] **Step 4: Update card markup** — the recipe cards already use `CoverImage`; ensure card container uses `bg-card shadow-warm` and author line uses `text-ink-soft`. The "kept by" byline should read the author: show `{recipe.author_full_name}` as-is (no "kept by" prefix on the compact card — prefix is used on RecipeDetail).

- [ ] **Step 5: Verify build + visual**

Run build → exits 0. Visually confirm at `http://localhost:5173/` (logged in): warm greeting, "From your kitchen" row, terra button. Log out / use a fresh account to confirm the empty state copy.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Home.jsx
git commit -m "Reskin Home with intimate voice, 'From your kitchen' section, keep-a-recipe CTA"
```

---

## Task 6: Browse reskin + voice + chip classes

**Files:**
- Modify: `frontend/src/pages/Browse.jsx`

**Interfaces:**
- Consumes: `CoverImage`; `GET /recipes/browse` (existing).

- [ ] **Step 1: Migrate palette tokens** per the map across the file.

- [ ] **Step 2: Replace inline chip styling with shared classes**

Replace the diet-chip button className logic so each chip uses the `.chip` base and toggles `.chip--active` when selected:

```jsx
<button
  key={diet}
  onClick={() => toggleDiet(diet)}
  className={`chip ${activeDiets.includes(diet) ? 'chip--active' : ''}`}
>
  {diet}
</button>
```
Keep the `flex flex-wrap gap-2 px-4 pb-4` container (chips wrap, all visible).

- [ ] **Step 3: Update copy**

- Page `<h1>`: keep `Browse` (Playfair).
- Add a serif italic subtitle under it: `Wander through everyone's kitchens.` (`text-sm text-ink-soft italic mb-4`).
- Section headings (cuisine names) use `.section-label` styling but keep the cuisine text (Japanese, Italian, etc.).
- On each card, show the byline `kept by {recipe.author_full_name}` in `text-xs text-ink-soft` (only when `author_full_name` exists).

- [ ] **Step 4: Confirm cross-cultural cuisines present**

Verify the `CUISINES` array in `Browse.jsx` includes at least: `['Japanese', 'Korean', 'Chinese', 'Filipino', 'Vietnamese', 'Indian', 'Mexican', 'Italian', 'Middle Eastern', 'West African', 'Thai']`. Add the missing cross-cultural entries to the array. (Sections still only render when they contain recipes, so empty cuisines won't show.)

- [ ] **Step 5: Verify build + visual**

Run build → exits 0. Visually confirm at `http://localhost:5173/browse`: wrapped spice-toned chips, subtitle, "kept by" bylines.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Browse.jsx
git commit -m "Reskin Browse with shared chips, kitchen subtitle, cross-cultural cuisines"
```

---

## Task 7: RecipeDetail — heirloom layout, About + The Story

**Files:**
- Modify: `frontend/src/pages/RecipeDetail.jsx`

**Interfaces:**
- Consumes: `CoverImage`; `GET /recipes/:id` (returns `description`, `story`, `author_full_name`, `cover_photo_url`, etc.).

- [ ] **Step 1: Migrate palette tokens** per the map across the file (including the error/back-link states: `text-accent`→`text-terra`).

- [ ] **Step 2: Add byline + restructure the header**

Below the recipe name `<h1>` (Playfair, `text-ink`), the existing `author_full_name` line should read `kept by {recipe.author_full_name}` in `text-sm text-ink-soft italic`. Keep the meta row (serves · cuisine · time) in `text-ink-soft`.

- [ ] **Step 3: Show "About this dish" then "The Story"**

Replace the single description paragraph with two distinct, conditionally-rendered blocks in this order (both optional):

```jsx
{recipe.description && (
  <div className="mb-5">
    <h2 className="section-label mb-1">About this dish</h2>
    <p className="text-sm text-ink-soft leading-relaxed">{recipe.description}</p>
  </div>
)}

{recipe.story && (
  <div className="story-callout mb-6">
    <h2 className="font-sans text-[12px] uppercase tracking-[0.12em] text-terra mb-1.5">The Story</h2>
    <p className="font-serif text-sm italic text-ink/80 whitespace-pre-line leading-relaxed">
      {recipe.story}
    </p>
  </div>
)}
```

- [ ] **Step 4: Reskin ingredients + steps**

- Ingredients: the quantity text uses `text-terra font-semibold`; ingredient name `text-ink`; notes `text-ink-soft italic`. The bullet dot uses `bg-terra`.
- Steps: the step number badge uses `bg-terra text-white`; content `text-ink`.
- Section headings `Ingredients` / `Steps` stay Playfair `text-ink`.

- [ ] **Step 5: Add owner-only Edit entry point**

At the top of the component, read the current user and compare to the recipe owner:

```jsx
const currentUser = JSON.parse(localStorage.getItem('issei_user') || '{}')
const isOwner = recipe && currentUser.id === recipe.user_id
```
When `isOwner`, render an Edit link near the recipe name (right-aligned), navigating to edit:

```jsx
{isOwner && (
  <button
    onClick={() => navigate(`/recipes/${recipe.id}/edit`)}
    className="text-sm text-terra font-sans font-medium"
  >
    Edit
  </button>
)}
```
(Place it in a flex row with the title, or just below the meta — implementer's choice, but it must only show for the owner.)

- [ ] **Step 6: Verify build + visual**

Run build → exits 0. Visually confirm at a recipe URL: hero image, "kept by", "About this dish" + "The Story" callout distinct, terra quantities, Edit button visible only on your own recipe.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/RecipeDetail.jsx
git commit -m "Reskin RecipeDetail: byline, About + The Story, terra quantities, owner Edit link"
```

---

## Task 8: Kitchen (MyRecipes) reskin

**Files:**
- Modify: `frontend/src/pages/MyRecipes.jsx`

- [ ] **Step 1: Migrate palette tokens** per the map across the file.

- [ ] **Step 2: Update copy**

- Page `<h1>`: change `My Recipes` → `Your Kitchen` (Playfair `text-ink`).
- Add serif italic subtitle: `Everything you've kept.` (`text-sm text-ink-soft italic mb-4`).
- Empty state (`filtered.length === 0`): change `No recipes found.` — when there is no search term and zero recipes, show `Your kitchen's just getting started. Keep your first recipe.`; keep the plain `No recipes found.` when a search yields nothing. (Distinguish by whether `search` is empty.)
- Cards: `bg-card shadow-warm`, author line `text-ink-soft`.

- [ ] **Step 3: Verify build + visual**

Run build → exits 0. Visually confirm at `http://localhost:5173/my-recipes`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/MyRecipes.jsx
git commit -m "Reskin Kitchen (MyRecipes) with heirloom palette and warmer copy"
```

---

## Task 9: You (Profile) reskin

**Files:**
- Modify: `frontend/src/pages/Profile.jsx`

- [ ] **Step 1: Migrate palette tokens**

`text-primary`→`text-ink`, `bg-surface`→`bg-card shadow-warm`, `bg-secondary/40`→`bg-line/50`, `text-gray-400/500`→`text-ink-soft`. Keep the logout button's red border/text (functional/destructive affordance).

- [ ] **Step 2: Update copy**

- Page `<h1>`: change `Profile` → `You` (Playfair `text-ink`).
- Show the user's name above the email: add `<p className="font-serif text-lg text-ink">{user.first_name} {user.last_name}</p>` inside the card, with the `Email` label + value beneath.

- [ ] **Step 3: Verify build + visual**

Run build → exits 0. Visually confirm at `http://localhost:5173/profile`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Profile.jsx
git commit -m "Reskin Profile as 'You' with name display and heirloom palette"
```

---

## Task 10: Extract shared RecipeForm (create path)

**Files:**
- Create: `frontend/src/components/RecipeForm.jsx`
- Modify: `frontend/src/pages/AddRecipe.jsx`

**Interfaces:**
- Produces: `RecipeForm` — `<RecipeForm heading submitLabel initialRecipe={null|recipe} onSubmit={async (payload) => {}} />`. `onSubmit` receives the built payload object (name, cover_photo_url, servings, cuisine, description, story, ingredients[], steps[]) and should perform the API call + navigation; it may throw to surface an error in the form. `initialRecipe` (nullable) prefills state; its stored `quantity_text` becomes each ingredient's single `quantity` field; sectionless + section ingredients are flattened by position.
- Consumes: `client`, `parseQuantity` from `../utils/quantity`.

- [ ] **Step 1: Create `RecipeForm.jsx`**

Create `frontend/src/components/RecipeForm.jsx` with the full component below. It is the current `AddRecipe` form logic, parameterized, with palette tokens migrated (`bg-accent`→`bg-terra`, `text-accent`→`text-terra`, `border-secondary`→`border-line`, `bg-surface`→`bg-card`, `text-gray-*`→`text-ink-soft`, `bg-cream`→`bg-paper`) and a `buildInitialState` helper for prefill:

```jsx
import { useState } from 'react'
import client from '../api/client'
import { parseQuantity } from '../utils/quantity'

const emptyIngredient = () => ({ name: '', quantity: '' })
const emptyStep = () => ({ content: '' })

// Keep in sync with the backend's accepted formats in app/routers/upload.py.
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB

function hasAcceptedExtension(filename) {
  const lower = filename.toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function buildInitialState(recipe) {
  if (!recipe) {
    return {
      name: '', servings: '', cuisine: '', description: '', story: '',
      coverPhotoUrl: '', ingredients: [emptyIngredient()], steps: [emptyStep()],
    }
  }
  const sectionIngredients = (recipe.ingredient_sections || []).flatMap((s) => s.ingredients || [])
  const allIngredients = [...(recipe.ingredients || []), ...sectionIngredients]
    .sort((a, b) => a.position - b.position)
    .map((ing) => ({ name: ing.name, quantity: ing.quantity_text || '' }))
  const steps = [...(recipe.steps || [])]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ content: s.content }))
  return {
    name: recipe.name || '',
    servings: recipe.servings != null ? String(recipe.servings) : '',
    cuisine: recipe.cuisine || '',
    description: recipe.description || '',
    story: recipe.story || '',
    coverPhotoUrl: recipe.cover_photo_url || '',
    ingredients: allIngredients.length ? allIngredients : [emptyIngredient()],
    steps: steps.length ? steps : [emptyStep()],
  }
}

export default function RecipeForm({ heading, submitLabel, initialRecipe = null, onSubmit }) {
  const init = buildInitialState(initialRecipe)
  const [name, setName] = useState(init.name)
  const [servings, setServings] = useState(init.servings)
  const [cuisine, setCuisine] = useState(init.cuisine)
  const [description, setDescription] = useState(init.description)
  const [story, setStory] = useState(init.story)
  const [ingredients, setIngredients] = useState(init.ingredients)
  const [steps, setSteps] = useState(init.steps)
  const [coverPhotoUrl, setCoverPhotoUrl] = useState(init.coverPhotoUrl)
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handlePhotoSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoError('')
    const typeOk = ACCEPTED_IMAGE_TYPES.includes(file.type)
    const extOk = hasAcceptedExtension(file.name)
    if (!typeOk && !extOk) {
      setPhotoError('Please choose a JPEG, PNG, or WebP image.')
      e.target.value = ''
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setPhotoError('That image is too large (max 10 MB).')
      e.target.value = ''
      return
    }
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await client.post('/upload/recipe-photo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setCoverPhotoUrl(data.url)
    } catch (err) {
      setPhotoError(err.response?.data?.detail || 'Photo upload failed. Please try again.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  function removePhoto() { setCoverPhotoUrl(''); setPhotoError('') }
  function updateIngredient(i, field, value) {
    setIngredients((prev) => prev.map((ing, idx) => (idx === i ? { ...ing, [field]: value } : ing)))
  }
  function removeIngredient(i) { setIngredients((prev) => prev.filter((_, idx) => idx !== i)) }
  function updateStep(i, value) { setSteps((prev) => prev.map((s, idx) => (idx === i ? { content: value } : s))) }
  function removeStep(i) { setSteps((prev) => prev.filter((_, idx) => idx !== i)) }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const payload = {
      name,
      cover_photo_url: coverPhotoUrl || null,
      servings: servings ? parseInt(servings) : null,
      cuisine: cuisine || null,
      description: description || null,
      story: story || null,
      ingredients: ingredients
        .filter((ing) => ing.name.trim())
        .map((ing, idx) => {
          const parsed = parseQuantity(ing.quantity)
          return {
            name: ing.name.trim(),
            quantity_text: parsed.quantity_text,
            quantity_value: parsed.quantity_value,
            unit: parsed.unit,
            quantity_type: parsed.quantity_type,
            position: idx + 1,
          }
        }),
      steps: steps
        .filter((s) => s.content.trim())
        .map((s, idx) => ({ content: s.content.trim(), position: idx + 1 })),
    }
    try {
      await onSubmit(payload)
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="px-4 pt-6 pb-8">
      <h1 className="font-serif text-2xl font-bold text-ink mb-6">{heading}</h1>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Cover Photo */}
        <section>
          {coverPhotoUrl ? (
            <div className="relative w-full h-44 rounded-xl overflow-hidden">
              <img src={coverPhotoUrl} alt="Recipe cover" className="w-full h-full object-cover" />
              <button type="button" onClick={removePhoto} aria-label="Remove photo"
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center text-lg leading-none hover:bg-black/70">×</button>
            </div>
          ) : (
            <label className="block w-full h-44 rounded-xl overflow-hidden cursor-pointer">
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoSelect} className="hidden" />
              <div className="w-full h-full bg-paper border-2 border-dashed border-line flex flex-col items-center justify-center text-center px-4">
                {uploading ? (
                  <span className="text-sm text-terra/70">Uploading…</span>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-9 h-9 text-terra/70 mb-2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                    </svg>
                    <span className="text-sm text-terra/70">Add a photo to bring this recipe to life</span>
                  </>
                )}
              </div>
            </label>
          )}
          {photoError ? (
            <p className="text-red-600 text-xs mt-2">{photoError}</p>
          ) : (
            <p className="text-ink-soft text-xs mt-2">JPEG, PNG, or WebP · max 10 MB</p>
          )}
        </section>

        {/* Recipe Details */}
        <section>
          <h2 className="section-label mb-3">Recipe Details</h2>
          <div className="space-y-3">
            <input type="text" placeholder="Recipe name *" value={name} onChange={(e) => setName(e.target.value)} required
              className="w-full px-4 py-3 rounded-lg border border-line bg-card text-sm focus:outline-none focus:border-terra" />
            <input type="number" placeholder="Servings" value={servings} onChange={(e) => setServings(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-line bg-card text-sm focus:outline-none focus:border-terra" />
            <input type="text" placeholder="Cuisine" value={cuisine} onChange={(e) => setCuisine(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-line bg-card text-sm focus:outline-none focus:border-terra" />
            <textarea placeholder="Description — what is this dish? (helps anyone unfamiliar with it)" value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              className="w-full px-4 py-3 rounded-lg border border-line bg-card text-sm focus:outline-none focus:border-terra resize-none" />
          </div>
        </section>

        {/* The Story */}
        <section>
          <h2 className="section-label mb-1">The Story</h2>
          <p className="text-xs text-ink-soft mb-3">What makes this recipe yours? Who taught you, when you make it, the memories it holds. (optional)</p>
          <textarea placeholder="My grandmother made this every Lunar New Year…" value={story} onChange={(e) => setStory(e.target.value)} rows={4}
            className="w-full px-4 py-3 rounded-lg border border-line bg-card text-sm focus:outline-none focus:border-terra resize-none" />
        </section>

        {/* Ingredients */}
        <section>
          <h2 className="section-label mb-1">Ingredients</h2>
          <p className="text-xs text-ink-soft mb-3">Write quantities naturally — fractions ("1 1/2 cups"), approximations ("~3 tbsp"), or by feel ("a dash", "to taste").</p>
          <div className="space-y-3">
            {ingredients.map((ing, idx) => (
              <div key={idx} className="bg-card rounded-lg border border-line p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-soft">#{idx + 1}</span>
                  {ingredients.length > 1 && (
                    <button type="button" onClick={() => removeIngredient(idx)} className="text-ink-soft hover:text-red-500 text-lg leading-none">×</button>
                  )}
                </div>
                <input type="text" placeholder="Ingredient name *" value={ing.name} onChange={(e) => updateIngredient(idx, 'name', e.target.value)}
                  className="w-full px-3 py-2 rounded border border-line text-sm focus:outline-none focus:border-terra" />
                <input type="text" placeholder="Quantity — e.g. 1 1/2 cups, 3 tbsp, a dash" value={ing.quantity} onChange={(e) => updateIngredient(idx, 'quantity', e.target.value)}
                  className="w-full px-3 py-2 rounded border border-line text-sm focus:outline-none focus:border-terra" />
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setIngredients((prev) => [...prev, emptyIngredient()])} className="mt-3 text-sm text-terra font-medium">+ Add Ingredient</button>
        </section>

        {/* Steps */}
        <section>
          <h2 className="section-label mb-3">Steps</h2>
          <div className="space-y-3">
            {steps.map((step, idx) => (
              <div key={idx} className="relative">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-ink-soft">Step {idx + 1}</span>
                  {steps.length > 1 && (
                    <button type="button" onClick={() => removeStep(idx)} className="text-ink-soft hover:text-red-500 text-lg leading-none">×</button>
                  )}
                </div>
                <textarea placeholder="Describe this step..." value={step.content} onChange={(e) => updateStep(idx, e.target.value)} rows={2}
                  className="w-full px-4 py-3 rounded-lg border border-line bg-card text-sm focus:outline-none focus:border-terra resize-none" />
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setSteps((prev) => [...prev, emptyStep()])} className="mt-3 text-sm text-terra font-medium">+ Add Step</button>
        </section>

        <button type="submit" disabled={loading} className="w-full py-3 rounded-lg bg-terra text-white font-medium text-sm disabled:opacity-50">
          {loading ? 'Saving...' : submitLabel}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Rewrite `AddRecipe.jsx` as a thin wrapper**

Replace the entire contents of `frontend/src/pages/AddRecipe.jsx` with:

```jsx
import { useNavigate } from 'react-router-dom'
import client from '../api/client'
import RecipeForm from '../components/RecipeForm'

export default function AddRecipe() {
  const navigate = useNavigate()

  async function handleCreate(payload) {
    await client.post('/recipes', payload)
    navigate('/my-recipes')
  }

  return (
    <RecipeForm
      heading="Keep a recipe"
      submitLabel="Keep this recipe"
      onSubmit={handleCreate}
    />
  )
}
```

- [ ] **Step 3: Verify build + visual**

Run: `cd frontend && export PATH="$PATH:/c/Program Files/nodejs" && npm run build` → exits 0.
Visually confirm at `http://localhost:5173/add`: form renders in heirloom palette, heading "Keep a recipe", button "Keep this recipe"; create a recipe end-to-end and confirm it saves and navigates to Kitchen.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/RecipeForm.jsx frontend/src/pages/AddRecipe.jsx
git commit -m "Extract shared RecipeForm; AddRecipe becomes a thin wrapper"
```

---

## Task 11: EditRecipe page + route + backend commit

**Files:**
- Create: `frontend/src/pages/EditRecipe.jsx`
- Modify: `frontend/src/App.jsx`
- Commit (already modified): `app/routers/recipes.py`, `app/schemas/recipe.py`

**Interfaces:**
- Consumes: `RecipeForm` (Task 10); `GET /recipes/:id`; `PATCH /recipes/:id` (backend already supports replacing ingredients/steps when those keys are present).

- [ ] **Step 1: Commit the completed backend edit support**

The backend `PATCH /recipes/{id}` already handles child-collection replacement and `RecipeUpdate` already includes `ingredient_sections`/`ingredients`/`steps` (implemented and verified earlier this session). Run backend tests, then commit:

Run: `venv/Scripts/python.exe -m pytest -q`
Expected: `5 passed`.

```bash
git add app/routers/recipes.py app/schemas/recipe.py
git commit -m "Support replacing ingredients/steps in PATCH /recipes/{id} for edit"
```

- [ ] **Step 2: Create `EditRecipe.jsx`**

Create `frontend/src/pages/EditRecipe.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import client from '../api/client'
import RecipeForm from '../components/RecipeForm'

export default function EditRecipe() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [recipe, setRecipe] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    client
      .get(`/recipes/${id}`)
      .then((res) => setRecipe(res.data))
      .catch(() => setError('Recipe not found'))
  }, [id])

  async function handleUpdate(payload) {
    await client.patch(`/recipes/${id}`, payload)
    navigate(`/recipes/${id}`)
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-600 mb-4">{error}</p>
        <button onClick={() => navigate('/my-recipes')} className="text-terra text-sm">Back to your kitchen</button>
      </div>
    )
  }

  if (!recipe) {
    return <div className="p-6 text-center text-ink-soft">Loading...</div>
  }

  return (
    <RecipeForm
      heading="Edit recipe"
      submitLabel="Save changes"
      initialRecipe={recipe}
      onSubmit={handleUpdate}
    />
  )
}
```

- [ ] **Step 3: Register the edit route in `App.jsx`**

Add the import alongside the other page imports:

```jsx
import EditRecipe from './pages/EditRecipe'
```
Add the protected route (place it near the other `/recipes/:id` route):

```jsx
      <Route
        path="/recipes/:id/edit"
        element={
          <ProtectedRoute>
            <Layout><EditRecipe /></Layout>
          </ProtectedRoute>
        }
      />
```

- [ ] **Step 4: Verify build + full edit flow**

Run: `cd frontend && export PATH="$PATH:/c/Program Files/nodejs" && npm run build` → exits 0.
With the backend running, visually confirm: open your own recipe → click **Edit** (from Task 7) → form is prefilled (name, servings, description, story, cover photo, ingredients as single-field quantities, steps) → change the name and an ingredient → **Save changes** → returns to detail with the update persisted. Confirm a non-owner does not see the Edit button.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EditRecipe.jsx frontend/src/App.jsx
git commit -m "Add Edit Recipe page and /recipes/:id/edit route"
```

---

## Task 12: Remove legacy tokens + full verification sweep

**Files:**
- Modify: `frontend/tailwind.config.js`
- Modify: any file still referencing legacy tokens (should be none).

- [ ] **Step 1: Find any remaining legacy token usage**

Run from repo root:
`grep -rnE "bg-cream|text-primary|bg-surface|text-accent|bg-accent|border-secondary|bg-secondary|border-accent|text-secondary" frontend/src frontend/index.html`
Expected: no matches. If any remain, migrate them per the token map (Task File Structure) and note which file.

- [ ] **Step 2: Remove the legacy color tokens from Tailwind config**

Delete the five legacy entries (`cream`, `primary`, `accent`, `secondary`, `surface`) from the `colors` block in `frontend/tailwind.config.js`, leaving only the new heirloom tokens.

- [ ] **Step 3: Verify build**

Run: `cd frontend && export PATH="$PATH:/c/Program Files/nodejs" && npm run build`
Expected: exits 0 with no "class does not exist"/unknown-utility errors. (If it errors, a legacy class was missed — fix and rebuild.)

- [ ] **Step 4: Backend tests still green**

Run: `venv/Scripts/python.exe -m pytest -q`
Expected: `5 passed`.

- [ ] **Step 5: Full visual pass**

With both servers running, click through every screen (`/login`, `/`, `/browse`, a recipe, `/my-recipes`, `/add`, edit, `/profile`) and confirm: consistent warm paper background, no stray white/cold-gray surfaces, terra/saffron/herb accents present, serif headings, intimate copy in place.

- [ ] **Step 6: Commit**

```bash
git add frontend/tailwind.config.js
git commit -m "Remove legacy color tokens after heirloom migration"
```

---

## Task 13: Update documentation to the new direction

**Files:**
- Modify: `README.md`, `FUTURE.md`, `CLAUDE.md`, `ARCHITECTURE.md`

- [ ] **Step 1: README.md** — Update the "What It Is" opening: reframe from "Asian immigrant community / REST API" to the universal-welcome-with-heritage-soul positioning and the tagline "Recipes that live in memory, not cookbooks." Note the app now has a React frontend (not backend-only). Keep the engineering-decisions sections accurate.

- [ ] **Step 2: CLAUDE.md** — Update the Frontend section: replace the old design system (background `#F7F2EA`, accent `#8B5E3C`, "Bottom navigation: Home, Recipes, Add Recipe, Profile") with the heirloom palette (paper `#EFE4D2`, card `#FBF6EC`, ink `#3A2A1C`, terra `#BD5A2C`, saffron `#D99A2B`, herb `#6F8A4D`, plum `#8A3D5A`), Playfair+Inter, the new nav (Home · Browse · Add · Kitchen · You), and the keep/add-to-kitchen vocabulary. Update the MVP-screens list to include Browse and the keep/edit flows.

- [ ] **Step 3: ARCHITECTURE.md** — Update: page table (`MyRecipes.jsx` labeled "Kitchen", `Profile.jsx` labeled "You", add `EditRecipe.jsx`), components table (add `RecipeForm.jsx`; note CoverImage heirloom placeholder), and the design-tokens/conventions references to the new palette and vocabulary.

- [ ] **Step 4: FUTURE.md** — Reconcile the roadmap with the new direction: note the frontend and look-and-feel redesign are done; fold the deferred items (richer Home, more Browse filters, "Add to your kitchen"/social features, profile settings) into the roadmap as the upcoming community cycle.

- [ ] **Step 5: Commit**

```bash
git add README.md FUTURE.md CLAUDE.md ARCHITECTURE.md
git commit -m "Update docs to warm/universal positioning and heirloom design system"
```

---

## Self-Review Notes

- **Spec coverage:** positioning/voice/vocabulary (Tasks 4–9 copy + Global Constraints), design system (Task 1), CoverImage (Task 2), nav rename (Task 3), all six screens (Tasks 4–9), About+Story on detail (Task 7), Browse cross-cultural cuisines + chips (Task 6), Edit recipe incl. backend commit (Tasks 10–11), route-label-only rename (Global Constraints + Task 8/9), edge cases (CoverImage placeholder Task 2; optional description/story Task 7; legacy-token sweep Task 12), docs follow-up (Task 13). All spec sections map to a task.
- **Placeholder scan:** none — every code step includes concrete classes/copy/code.
- **Type/name consistency:** `RecipeForm` prop names (`heading`, `submitLabel`, `initialRecipe`, `onSubmit`) are identical in Tasks 10 and 11; `buildInitialState` flatten logic matches the backend response shape; token names match the config defined in Task 1.
