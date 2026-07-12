# R1 — Readable Garden Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the readable, green-forward foundation for the R1–R4 renovation — a garden palette, legible body type, garden language (retiring cookbook metaphors), a login field-reset, and dish-led recipe naming.

**Architecture:** Frontend-only, no backend/migrations. Palette is centralized in `tailwind.config.js` tokens (every token-based component reflows for free); readable type is a small set of shared utility classes in `index.css`; the metaphor sweep + naming + login-reset are targeted edits to a handful of live screens. This is a *foundation* pass — it does NOT build the immersive garden (R2), plant interface (R3), or nav/front-door reimagining (R4).

**Tech Stack:** React 18, Vite 5, Tailwind 3, Vitest + React Testing Library.

## Global Constraints

- **Frontend-only.** No backend changes, no Alembic migration, no schema change.
- **R1 does NOT build immersion.** No garden layout, plant tap-to-tend, growth animation, bottom-nav redesign, capture reimagining, or page transitions — those are R2–R4. "It still feels like a list, not a garden" after R1 is expected and correct.
- **The cook mechanic is out of R1** (deferred to R3 as tactile plant-tending). Do NOT add/keep an "I cooked this" undo or cook-count feature in this plan. (Leave the existing "I cooked this" button as-is; R3 replaces it.)
- **Color roles:** green = ambient + growth (the world); `terra`/`action` = interactive intent (buttons, links); `plum` = the person; `saffron` = vitality sparks. Green is the resting color; terra appears where the user acts.
- **Fonts stay:** Cormorant Garamond (`font-serif`), Nunito Sans (`font-sans`), Caveat (`font-hand`). The readability fix is size + weight + contrast, not new fonts.
- **Body text clears WCAG AA (4.5:1)** against its surface.
- **Keep heritage identity:** the login `一世 · issei` kanji callout, the meaning blurb, and the `<Wordmark>` stay untouched. Only the table/kitchen *hospitality* metaphor is retired; domain words (cook/recipe/ingredient) stay.
- **The login screen keeps its current layout** in R1 (palette + CTA copy + field reset only). Its "living front door" reimagining is R4.
- **Tailwind + curly typographic punctuation** conventions as in the codebase (`’` `“` `”` `—` in user copy).
- **Tests:** Vitest + RTL, colocated. Run from `frontend/`; prefix node on this Windows shell: `export PATH="$PATH:/c/Program Files/nodejs"`.

---

## Reference: current state (verified)

- `frontend/tailwind.config.js` — tokens: `paper #EFE4D2`, `card #FBF6EC`, `ink #3A2A1C`, `ink-soft #6D5844`, `line #E3D3BA`, `terra #BD5A2C`, `saffron #D99A2B`, `herb #6F8A4D`, `plum #8A3D5A`, `action #BD5A2C`, `growth #6F8A4D`.
- `frontend/src/index.css` — `@layer components` holds `.section-label`, `.field`, `.field--login` (border `#ddcba8`), `.btn-primary` (bg-terra, shadow `rgba(189,90,44,0.3)`), `.chip*`, `.story-callout` (`bg-[#F3E7D0]`).
- **Cookbook copy (5 live spots):** `Login.jsx:118` "Join the table", `Login.jsx:196` "Setting your table…" / "Join the table", `MyRecipes.jsx:42` "Your Kitchen", `BottomNav.jsx:11` label "Kitchen", `InviteLanding.jsx:54` "join the table".
- **Ingredient rendering (readability hotspot):** `RecipeDetail.jsx:224-241` — container `font-serif text-[13.5px]`, amount `text-terra font-semibold`, imprecise tag `text-[8.5px]`.
- **Bylines (for "from {source}"):** `RecipeDetail.jsx:124-133` and `RecipeCard.jsx:44-48` both render `kept by {recipe.author_full_name}`. `sourceNameOf(recipe)` exists in `frontend/src/lib/sourceName.js` (leading segment of `origin_attribution`, else null).
- **Capture name field:** `RecipeForm.jsx:208` `placeholder="Recipe name"`.
- **Plant art (`Plant.jsx`) uses its own hardcoded greens** — NOT tokens. Leave it untouched; R1 does not retint the plant art.

---

## File Structure

- **Modify** `frontend/tailwind.config.js` — garden-forward token values + new `growth-bright`, `soil` (Task 1).
- **Modify** `frontend/src/index.css` — retint hardcoded-hex component classes; add readable type utilities (Tasks 1 + 2).
- **Modify** `frontend/src/pages/RecipeDetail.jsx` — apply readable type to ingredients/body; "from {source}" byline (Tasks 2 + 5).
- **Modify** `frontend/src/components/RecipeCard.jsx` — "from {source}" byline (Task 5).
- **Modify** `frontend/src/pages/Login.jsx` — field reset on tab switch + garden CTA copy (Task 3).
- **Modify** `frontend/src/pages/MyRecipes.jsx`, `frontend/src/components/BottomNav.jsx`, `frontend/src/pages/InviteLanding.jsx` — metaphor sweep (Task 4).
- **Modify** `frontend/src/components/RecipeForm.jsx` — dish-nudge placeholder/helper (Task 5).
- **Modify** test files colocated with the above + `ARCHITECTURE.md` (Task 6).

---

### Task 1: Garden-forward palette

Promote green to the ambient lead and demote terra/brown to a warm action accent, centrally via tokens. Retint the few component classes that bake in old hex.

**Files:**
- Modify: `frontend/tailwind.config.js`
- Modify: `frontend/src/index.css` (`.story-callout`, `.btn-primary` shadow, `.field--login`)
- Test: (visual/build only — no unit test for token values; Task 6 verifies)

**Interfaces:**
- Produces: tokens `paper, card, ink, ink-soft, line, growth, growth-bright, action, terra, saffron, plum, herb, soil` at the new values below. Later tasks/screens consume them by name.

- [ ] **Step 1: Update the color tokens**

In `frontend/tailwind.config.js`, replace the `colors` block with:

```js
      colors: {
        // Garden palette (R1) — green is the ambient lead; terra is the action accent.
        paper: '#F3EAD6',        // warm cream app background
        card: '#FCF8EE',         // surface
        ink: '#2E3A24',          // deep leaf — primary text
        'ink-soft': '#4A5540',   // green-gray — secondary text
        line: '#E3D9C4',         // hairline
        terra: '#B5502A',        // warm action accent
        saffron: '#D99A2B',      // vitality sparks
        herb: '#5C7A3F',         // (kept as alias of the lead green)
        plum: '#8A3D5A',         // the person / heritage accent
        soil: '#C9A277',         // garden ground
        // Semantic roles: green = grow/ambient, terra = do/act
        action: '#B5502A',       // = terra — buttons, links, active states
        growth: '#5C7A3F',       // lead green — plants, growth, garden ambient, eyebrows
        'growth-bright': '#7FA05A', // leaf highlights, plant accents
      },
```

- [ ] **Step 2: Retint the hardcoded-hex component classes**

In `frontend/src/index.css`, update the three classes that bake in old-palette hex so they don't clash with green:

Change `.btn-primary`'s shadow from the old terra rgb to the new terra:

```css
  .btn-primary {
    @apply w-full py-3 rounded-[10px] bg-terra text-white font-serif font-semibold text-sm
      shadow-[0_8px_16px_rgba(181,80,42,0.28)] transition-opacity disabled:opacity-50;
  }
```

Change `.field--login` to use the token instead of the warm-brown literal:

```css
  .field--login { @apply border-line; }
```

Change `.story-callout`'s warm-cream fill to a soft green-cream that sits right on the new palette:

```css
  .story-callout {
    @apply bg-[#EDEAD6] border-l-[3px] border-terra rounded-r-xl p-4;
  }
```

- [ ] **Step 3: Restart Vite and build to verify no token was removed**

Run (from `frontend/`): `export PATH="$PATH:/c/Program Files/nodejs" && npx vite build`
Expected: clean build. (Every token referenced elsewhere — `paper`, `ink`, `terra`, `growth`, `herb`, `plum`, `saffron`, `line`, `card` — still exists; we only changed values and added `soil`/`growth-bright`. No class references a removed token.)

- [ ] **Step 4: Run the full frontend suite (nothing regressed)**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run`
Expected: all pass (token value changes don't affect logic; tests assert text/behavior, not hex).

- [ ] **Step 5: Commit**

```bash
git add frontend/tailwind.config.js frontend/src/index.css
git commit -m "feat(R1): garden-forward palette — green as ambient lead, terra as action accent"
```

---

### Task 2: Readable body type

Fix the thin/small regression. Add a small set of shared, legible type utilities and apply them to the recipe page's ingredients (the worst offender — currently Cormorant serif 13.5px) and body text.

**Files:**
- Modify: `frontend/src/index.css` (add type utilities)
- Modify: `frontend/src/pages/RecipeDetail.jsx` (ingredients + body sizes)
- Test: `frontend/src/pages/RecipeDetail.test.jsx` (assert the readable ingredient treatment)

**Interfaces:**
- Produces: utility classes `.ingredient-row`, `.ingredient-amount` (and reuse for body) available app-wide. Consumed here; available to R2–R4.

- [ ] **Step 1: Write the failing test**

In `frontend/src/pages/RecipeDetail.test.jsx`, add a test asserting the ingredient amount renders bold and the ingredient body is legible (mirror the file's existing mock/render setup — it already mocks `../api/client` and renders `<RecipeDetail>` in a `MemoryRouter` with a recipe containing ingredients). Add:

```jsx
it('renders ingredient amounts in a bold, legible treatment (readability fix)', async () => {
  // (reuse the file's existing render helper / mocked recipe that has an
  //  ingredient with quantity_text "2 lbs" and name "chicken thighs")
  const amount = await screen.findByText('2 lbs')
  // amount carries the shared bold amount class, not the old terra-semibold inline
  expect(amount.className).toMatch(/ingredient-amount/)
})
```

Note for the implementer: read `RecipeDetail.test.jsx` first; if its mocked recipe lacks an ingredient with `quantity_text: '2 lbs'`, add one to the mock (or assert against whatever amount the existing mock provides). The assertion that matters: the amount span uses the `ingredient-amount` class.

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/pages/RecipeDetail.test.jsx`
Expected: FAIL — the amount span currently has `text-terra font-semibold`, not `ingredient-amount`.

- [ ] **Step 3: Add the type utilities**

In `frontend/src/index.css`, inside `@layer components`, add:

```css
  /* Readable body scale (R1). Body/ingredients read too thin+small in serif; the
     reading surfaces use Nunito Sans at a legible size with bold amounts. */
  .ingredient-row {
    @apply flex gap-2.5 py-1 font-sans text-[14.5px] leading-[1.65] text-ink;
  }
  .ingredient-amount {
    @apply w-24 flex-shrink-0 font-sans font-bold text-ink;
  }
```

- [ ] **Step 4: Apply to the recipe page ingredients**

In `frontend/src/pages/RecipeDetail.jsx`, replace the ingredient block (currently lines 224-241):

```jsx
        <div className="font-serif text-[13.5px]">
          {allIngredients.map((ing) => (
            <div key={ing.id} className="flex gap-2.5 py-1">
              <span className="w-20 flex-shrink-0 text-terra font-semibold">
                {ing.quantity_text}
              </span>
              <span className="text-ink">
                {ing.name}
                {isImprecise(ing) && (
                  <span className="ml-1.5 align-middle text-[8.5px] font-sans text-ink-soft border border-line rounded px-1 py-px">
                    {impreciseLabel()}
                  </span>
                )}
                {ing.notes && <span className="text-ink-soft italic"> — {ing.notes}</span>}
              </span>
            </div>
          ))}
        </div>
```

with:

```jsx
        <div>
          {allIngredients.map((ing) => (
            <div key={ing.id} className="ingredient-row">
              <span className="ingredient-amount">
                {ing.quantity_text}
              </span>
              <span className="text-ink">
                {ing.name}
                {isImprecise(ing) && (
                  <span className="ml-1.5 align-middle text-[10px] font-sans text-ink-soft border border-line rounded px-1 py-px">
                    {impreciseLabel()}
                  </span>
                )}
                {ing.notes && <span className="text-ink-soft italic"> — {ing.notes}</span>}
              </span>
            </div>
          ))}
        </div>
```

(Ingredient body → Nunito Sans 14.5px; amounts → bold ink via `.ingredient-amount`; imprecise tag bumped 8.5px → 10px so it's readable.)

- [ ] **Step 5: Bump the serif body sizes for readability**

In `frontend/src/pages/RecipeDetail.jsx`, raise the body/step/description serif text from `13.5px` to `14.5px` (keeps the editorial serif voice, just legible). Update these occurrences:
- line ~190 (description): `text-[13.5px]` → `text-[14.5px]`
- line ~203 (story body): `text-[13.5px]` → `text-[14.5px]`
- line ~251 (step content): `text-[13.5px]` → `text-[14.5px]`

Leave the byline (129), meta row (152), and cuisine/time (13px) as-is — those are meta, not reading body.

- [ ] **Step 6: Run the test to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/pages/RecipeDetail.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/index.css frontend/src/pages/RecipeDetail.jsx frontend/src/pages/RecipeDetail.test.jsx
git commit -m "feat(R1): readable ingredient + body type (Nunito Sans 14.5px, bold amounts)"
```

---

### Task 3: Login — field reset + garden CTA

Clear all fields when switching login tabs, and replace the cookbook signup copy with garden voice. Keep the login layout, the kanji callout, and the meaning blurb untouched (R4 reimagines the screen).

**Files:**
- Modify: `frontend/src/pages/Login.jsx`
- Test: `frontend/src/pages/Login.test.jsx` (Create — none exists)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new (behavior + copy change).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/Login.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api/client', () => ({ default: { post: vi.fn() } }))
import Login from './Login'

describe('Login', () => {
  it('uses garden signup copy, not the cookbook "Join the table"', () => {
    render(<MemoryRouter><Login /></MemoryRouter>)
    // On the Sign In tab, only the signup TAB button reads "Plant your first
    // seed" (the submit button reads "Sign in"), so this is unambiguous.
    expect(screen.getByRole('button', { name: /plant your first seed/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /join the table/i })).not.toBeInTheDocument()
  })

  it('clears fields when switching Sign In ↔ signup', async () => {
    render(<MemoryRouter><Login /></MemoryRouter>)
    // type an email on the Sign In tab
    const email = screen.getByPlaceholderText('Email')
    fireEvent.change(email, { target: { value: 'stale@example.com' } })
    expect(email).toHaveValue('stale@example.com')
    // switch to signup (click the signup tab), then back to Sign In
    fireEvent.click(screen.getByRole('button', { name: /plant your first seed/i }))
    // now on signup: TWO buttons read "plant your first seed" (tab + submit).
    // Return to Sign In via its tab.
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    // the email field is a fresh empty field
    expect(screen.getByPlaceholderText('Email')).toHaveValue('')
  })
})
```

**Important markup note for the implementer:** after the copy change, on the *signup* tab BOTH the signup tab button and the submit button read "Plant your first seed" — so `getByRole('button', {name: /plant your first seed/i})` throws (two matches) while on that tab. The test above avoids this by only querying that name from the *Sign In* tab (where the submit button reads "Sign in"), and returns via the "Sign in" tab (use `/^sign in$/i` to avoid matching "Signing in…"). Do not query `/plant your first seed/i` as a role button while the signup tab is active — scope with `within(...)` or a `data-testid` on the tab if you need to.

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/pages/Login.test.jsx`
Expected: FAIL — copy is still "Join the table"; no field reset.

- [ ] **Step 3: Reset fields on tab switch**

In `frontend/src/pages/Login.jsx`, add a helper that clears all state and use it in both tab `onClick`s. Replace the two tab buttons' `onClick={() => { setTab('login'); setError('') }}` / `onClick={() => { setTab('signup'); setError('') }}` with a shared reset. Add near the other handlers:

```jsx
  function switchTab(next) {
    setTab(next)
    setError('')
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setFirstName('')
    setLastName('')
  }
```

Then set the Sign In tab button to `onClick={() => switchTab('login')}` and the signup tab button to `onClick={() => switchTab('signup')}`.

- [ ] **Step 4: Replace the cookbook signup copy**

In `frontend/src/pages/Login.jsx`:
- The signup **tab** label (line ~118): `Join the table` → `Plant your first seed`.
- The signup **submit** button (line ~196): `{loading ? 'Setting your table…' : 'Join the table'}` → `{loading ? 'Planting…' : 'Plant your first seed'}`.

Leave the wordmark, tagline, the `一世 · issei` callout, and the meaning blurb exactly as they are.

- [ ] **Step 5: Run the test to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/pages/Login.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Login.jsx frontend/src/pages/Login.test.jsx
git commit -m "feat(R1): login field reset on tab switch + 'Plant your first seed' garden copy"
```

---

### Task 4: Metaphor sweep (non-login)

Retire the remaining cookbook language: "Your Kitchen" → "Your Garden", the bottom-nav "Kitchen" label → "Garden", and the InviteLanding "join the table" copy → garden voice. Add a guard test so the retired strings don't regress.

**Files:**
- Modify: `frontend/src/pages/MyRecipes.jsx` (title, line 42)
- Modify: `frontend/src/components/BottomNav.jsx` (label, line 11)
- Modify: `frontend/src/pages/InviteLanding.jsx` (CTA, line 54)
- Test: `frontend/src/pages/MyRecipes.test.jsx` (update the title assertion + guard)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (copy/label change).

- [ ] **Step 1: Update the failing test first**

In `frontend/src/pages/MyRecipes.test.jsx`, the existing test asserts `screen.getByText('Your Kitchen')`. Change it to the garden title and add a guard:

```jsx
  it('renders the garden header (not the cookbook "Kitchen")', () => {
    render(<MemoryRouter><MyRecipes /></MemoryRouter>)
    expect(screen.getByText('Your Garden')).toBeInTheDocument()
    expect(screen.queryByText('Your Kitchen')).not.toBeInTheDocument()
  })
```

(Replace the existing `renders the kitchen header` test with this; keep the other MyRecipes tests unchanged.)

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/pages/MyRecipes.test.jsx`
Expected: FAIL — the page still renders "Your Kitchen".

- [ ] **Step 3: Sweep the three copy spots**

- `frontend/src/pages/MyRecipes.jsx:42`: `Your Kitchen` → `Your Garden`.
- `frontend/src/components/BottomNav.jsx:11`: change the label from `'Kitchen'` to `'Garden'` (leave `path`/`icon` unchanged — the nav *redesign* is R4; this is label text only). Also update the comment on line 6 (`Home · Browse · Add · Kitchen · You`) → `Home · Browse · Add · Garden · You`.
- `frontend/src/pages/InviteLanding.jsx:54`: `Keep this recipe — join the table` → `Keep this recipe — start your garden`.

- [ ] **Step 4: Run the MyRecipes test to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/pages/MyRecipes.test.jsx`
Expected: PASS.

- [ ] **Step 5: Confirm no live screen still says "Join the table" / "Your Kitchen"**

Run (from `frontend/`): `grep -rn "Join the table\|Your Kitchen\|Setting your table\|join the table" src --include=*.jsx | grep -v ".test."`
Expected: **no output** (all retired from live components).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/MyRecipes.jsx frontend/src/components/BottomNav.jsx frontend/src/pages/InviteLanding.jsx frontend/src/pages/MyRecipes.test.jsx
git commit -m "feat(R1): retire cookbook metaphor — Your Garden, Garden nav, garden invite copy"
```

---

### Task 5: Dish-led recipe naming

Show the person as "from {source}" (falling back to "kept by {author}"), and nudge dish-only naming at capture. No new fields — uses the existing `sourceNameOf` + `author_full_name`.

**Files:**
- Modify: `frontend/src/components/RecipeCard.jsx` (byline, lines 44-48)
- Modify: `frontend/src/pages/RecipeDetail.jsx` (byline, lines 124-133)
- Modify: `frontend/src/components/RecipeForm.jsx` (name placeholder/helper, line 208)
- Test: `frontend/src/components/RecipeCard.test.jsx` (assert "from {source}" + fallback)

**Interfaces:**
- Consumes: `sourceNameOf(recipe)` from `frontend/src/lib/sourceName.js` (leading name segment of `origin_attribution`, or null); `recipe.author_full_name`.
- Produces: a consistent byline convention — `from {source}` when there's a recorded source, else `kept by {author_full_name}`.

- [ ] **Step 1: Write the failing test**

In `frontend/src/components/RecipeCard.test.jsx`, add:

```jsx
  it('shows "from {source}" when there is a recorded origin', () => {
    render(<RecipeCard recipe={{ id: 1, name: 'Adobo', author_full_name: 'Yoko M.', origin_attribution: 'Lola Remedios · Cebu', growth_stage: 'tree' }} onClick={() => {}} />)
    expect(screen.getByText(/from Lola Remedios/i)).toBeInTheDocument()
    expect(screen.queryByText(/kept by/i)).not.toBeInTheDocument()
  })

  it('falls back to "kept by {author}" when there is no origin', () => {
    render(<RecipeCard recipe={{ id: 2, name: 'Fried Rice', author_full_name: 'Yoko M.', growth_stage: 'seed' }} onClick={() => {}} />)
    expect(screen.getByText(/kept by Yoko M\./i)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/components/RecipeCard.test.jsx`
Expected: FAIL — the card always renders "kept by {author}", never "from {source}".

- [ ] **Step 3: Update the RecipeCard byline**

In `frontend/src/components/RecipeCard.jsx`, add the import near the top:

```jsx
import { sourceNameOf } from '../lib/sourceName'
```

Then replace the byline block (lines 44-48):

```jsx
        {recipe.author_full_name && (
          <p className="font-serif italic text-[11.5px] text-terra mt-[3px]">
            kept by {recipe.author_full_name}
          </p>
        )}
```

with:

```jsx
        {(sourceNameOf(recipe) || recipe.author_full_name) && (
          <p className="font-serif italic text-[11.5px] text-plum mt-[3px]">
            {sourceNameOf(recipe)
              ? `from ${sourceNameOf(recipe)}`
              : `kept by ${recipe.author_full_name}`}
          </p>
        )}
```

(Byline recolored `terra` → `plum`: per the color roles, the person is plum, not the action accent.)

- [ ] **Step 4: Update the RecipeDetail byline**

In `frontend/src/pages/RecipeDetail.jsx`, the byline (lines 124-133) renders `kept by` + `{recipe.author_full_name}`. Replace that byline block so it reads "from {source}" when a source exists, else "kept by {author}". Replace:

```jsx
        {recipe.author_full_name && (
          <p className="...">
            kept by
            <span className="not-italic font-semibold text-terra ml-1">{recipe.author_full_name}</span>
          </p>
        )}
```

with (preserving the surrounding `<p>` classes already on line ~124-131 — only change the label + name source + accent color to plum):

```jsx
        {(sourceNameOf(recipe) || recipe.author_full_name) && (
          <p className="font-serif italic text-[13.5px] text-ink-soft">
            {sourceNameOf(recipe) ? 'from' : 'kept by'}
            <span className="not-italic font-semibold text-plum ml-1">
              {sourceNameOf(recipe) || recipe.author_full_name}
            </span>
          </p>
        )}
```

Note: `sourceNameOf` is already imported in RecipeDetail.jsx (line 13). Read the exact current byline markup and keep its wrapper classes; only swap the label word, the name expression, and the accent color.

- [ ] **Step 5: Nudge dish-only naming at capture**

In `frontend/src/components/RecipeForm.jsx`, the name input (line 208) has `placeholder="Recipe name"`. Change it to guide dish-only naming:

```jsx
            placeholder="Name the dish — e.g. “Adobo”"
```

And add a helper line directly under the name input (a small hint; match the form's existing helper-text style — e.g. the `text-[11px] text-ink-soft` used elsewhere in the form):

```jsx
            {/* dish-led naming: the person is captured separately as the origin */}
```

Then, immediately after the name `<input>`, add:

```jsx
          <p className="font-sans text-[11px] text-ink-soft -mt-1">You’ll say whose recipe it is next.</p>
```

(Only add the hint if the name field is in the always-visible part of the form. If the form's layout makes a sub-hint awkward, the placeholder change alone satisfies the nudge — the implementer should place the hint cleanly or omit it, but the placeholder change is required.)

- [ ] **Step 6: Run the card test to verify it passes**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run src/components/RecipeCard.test.jsx`
Expected: PASS.

- [ ] **Step 7: Run the full suite (bylines used across pages didn't break)**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run`
Expected: all pass. If a RecipeDetail test asserted the old "kept by {author}" text with a recipe that now has an origin, update that assertion to "from {source}".

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/RecipeCard.jsx frontend/src/pages/RecipeDetail.jsx frontend/src/components/RecipeForm.jsx frontend/src/components/RecipeCard.test.jsx
git commit -m "feat(R1): dish-led naming — 'from {source}' byline + capture nudge"
```

---

### Task 6: Full verify, visual check, and docs

Confirm the whole R1 foundation works end-to-end, verify it in the browser, and update the docs.

**Files:**
- Modify: `frontend/tailwind.config.js` (palette comment — the CLAUDE.md source-of-truth note)
- Modify: `ARCHITECTURE.md` (palette + language note)

- [ ] **Step 1: Full suite + build**

Run (from `frontend/`): `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run && npx vite build`
Expected: all tests pass; build clean.

- [ ] **Step 2: Visual verification**

Using the isolated demo stack (throwaway SQLite backend on :8010 via `run_backend.py`, Vite on :5183 with `VITE_API_URL`, seed spanning growth stages + a recipe with `origin_attribution` and one without; see `.superpowers/sdd/progress.md` for the pattern — on this Windows host kill stale servers with `taskkill //F //PID`, not `pkill`), verify with a Playwright driver run from `frontend/`:
1. **Login**: signup tab reads "Plant your first seed"; loading reads "Planting…"; typing on one tab then switching clears the fields; the `一世 · issei` callout + meaning blurb are still present; the screen sits on the new green paper.
2. **Garden** (`/my-recipes`): title reads "Your Garden"; bottom-nav label reads "Garden".
3. **A rich recipe** (`/recipes/:id` with an origin): ingredients read clearly (Nunito Sans 14.5, bold amounts); byline reads "from {source}" in plum; body/steps at 14.5px; palette is green-forward.
4. **A recipe without an origin**: byline falls back to "kept by {author}".
5. Confirm 0 console errors and that body text visibly contrasts on the cream surface.
Record observations + screenshots in the report.

- [ ] **Step 3: Update the palette comment + ARCHITECTURE.md**

In `frontend/tailwind.config.js`, the `colors` comment already says "Garden palette (R1)…" from Task 1 — confirm it's accurate.

In `ARCHITECTURE.md`, update the design-system palette note (currently the "Heirloom palette" line) to reflect the garden palette and the color roles ("green = ambient/grow, terra = action/do, plum = the person, saffron = vitality"), and add a one-line note that the app's language is garden-based ("Your Garden", "Plant your first seed") — cookbook metaphors retired. Keep it concise; this is the where-things-live reference.

- [ ] **Step 4: Commit**

```bash
git add frontend/tailwind.config.js ARCHITECTURE.md
git commit -m "docs(R1): garden palette + language in ARCHITECTURE"
```

---

## Self-Review

**1. Spec coverage (2026-07-11 R1 spec):**
- §2 garden palette → Task 1 (tokens + retint). ✓
- §3 readable body type → Task 2 (utilities + ingredient/body application). ✓
- §4 login field reset → Task 3. ✓
- §5 metaphor sweep → Task 3 (login copy) + Task 4 (Your Garden, nav label, invite). ✓
- §6 dish-led naming → Task 5 ("from {source}" byline + capture nudge). ✓
- §1 "frontend-only, cook mechanic out" → Global Constraints + no cook task. ✓
- §7 testing (metaphor guard, visual verify) → Task 4 Step 5 grep-guard + Task 6. ✓
- §8 #11 login layout stays / R4 defers front door → Global Constraints + Task 3 keeps layout. ✓

**2. Placeholder scan:** No TBD/TODO. Every code step shows complete code or an exact string change. Task 5 Step 5 gives the implementer a bounded choice (place the hint cleanly or omit; placeholder change required) rather than a vague instruction. Task 1/2 test steps instruct reading the target test file first to match mock conventions, with the exact required assertion named.

**3. Type/consistency:** Token names used in later tasks (`plum`, `ink`, `ink-soft`, `line`) all exist after Task 1. `sourceNameOf` signature matches its real export. `.ingredient-amount`/`.ingredient-row` defined in Task 2 Step 3, consumed in Step 4 and asserted in Step 1. Byline convention ("from {source}" else "kept by {author}") is identical in RecipeCard (Task 5 Step 3) and RecipeDetail (Step 4).

**4. Scope discipline:** No backend files, no migration, no cook mechanic, no garden/nav/plant-interface build — all fenced to R2–R4 in Global Constraints. Login layout preserved (only copy + reset). Plant art untouched.
