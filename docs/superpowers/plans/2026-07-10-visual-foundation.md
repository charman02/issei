# Visual Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the app to the locked visual identity — new type system (Cormorant Garamond + Nunito Sans + a handwritten hand), the handwritten `issei` wordmark, and explicit palette color-roles (terra = actions, herb-green = growth).

**Architecture:** The app already references fonts through Tailwind aliases (`font-serif`, `font-sans`) in ~17 files, so retargeting those aliases in `tailwind.config.js` re-skins everything at once — no per-file edits. Add a third `font-hand` family for the wordmark + special moments, add semantic `action`/`growth` color aliases to encode the color-role system, and rewrite the `Wordmark` component to the handwritten mark. This is the dependency root for all later identity work.

**Tech Stack:** React 18 + Vite 5 + Tailwind 3 + Vitest/RTL. Google Fonts via `<link>` in `frontend/index.html`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-10-visual-identity-design.md`. Direction = refine & elevate the warm-heirloom look.
- **Type (§3):** Display/titles = **Cormorant Garamond**; body/UI = **Nunito Sans**; **handwritten hand** (Caveat as the directional placeholder) reserved for the **logo + special moments only** (e.g. the story pull-quote), never every title/label.
- **Logo (§1):** the wordmark is the word **issei**, hand-lettered, **no icon**. (Caveat placeholder for the final commissioned hand-lettering.)
- **Palette (§4):** heirloom colors unchanged — paper `#EFE4D2`, card `#FBF6EC`, ink `#3A2A1C`, ink-soft `#6D5844`, line `#E3D3BA`, terra `#BD5A2C`, saffron `#D99A2B`, herb `#6F8A4D`, plum `#8A3D5A`.
- **Color roles (§4):** **terra = ACTIONS/UI** (buttons, links, active); **herb-green = GROWTH** (plants, stage pills, garden). "Warm for do, green for grow."
- **Theme (§5):** app is **light/cream throughout — no dark theme**, splash included.
- **Run frontend tests** from the `frontend/` directory: `npx vitest run` (or a single file: `npx vitest run src/path/File.test.jsx`). Node is on PATH here; if a non-interactive shell can't find it, prefix `export PATH="$PATH:/c/Program Files/nodejs"`.
- **Build check:** `cd frontend && npx vite build` must succeed.
- **Don't git commit without explicit user approval.** Per-task Commit steps stage + write the message; a human approves.

---

## File Structure

- `frontend/index.html` — swap the Google Fonts `<link>` to load Cormorant Garamond, Nunito Sans, and Caveat (drop Fraunces/Inter). Update the `<title>` (drop the 一世 kanji per the wordmark decision).
- `frontend/tailwind.config.js` — retarget `fontFamily.serif` → Cormorant Garamond, `fontFamily.sans` → Nunito Sans; add `fontFamily.hand` → Caveat. Add semantic color aliases `action` (= terra) and `growth` (= herb) alongside the existing palette.
- `frontend/src/components/Wordmark.jsx` — rewrite from Fraunces `issei.` to the handwritten `issei` (font-hand), no period, preserving the `muted` variant behavior.
- `frontend/src/components/Wordmark.test.jsx` (create) — assert the wordmark renders "issei" in the hand family.
- `frontend/tailwind.config.test.js` (create) — assert the config exposes the right font families + color roles (config is the single source of truth for the re-skin, so it's worth a guard test).

**No edits needed** to the ~17 files using `font-serif`/`font-sans` — they re-map automatically through the aliases. (A later sub-project handles heading-weight polish; see Task 4 note.)

---

## Task 1: Load the new fonts + retarget Tailwind families

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/tailwind.config.js`
- Test: `frontend/tailwind.config.test.js` (create)

**Interfaces:**
- Produces: Tailwind `font-serif` → `'Cormorant Garamond'`, `font-sans` → `'Nunito Sans'`, `font-hand` → `'Caveat'`. Later tasks/sub-projects rely on these three utility classes.

- [ ] **Step 1: Write the failing test**

Create `frontend/tailwind.config.test.js`:

```js
import { describe, it, expect } from 'vitest'
import config from './tailwind.config.js'

describe('tailwind font families', () => {
  const fam = config.theme.extend.fontFamily
  it('serif is Cormorant Garamond', () => {
    expect(fam.serif[0]).toBe('Cormorant Garamond')
  })
  it('sans is Nunito Sans', () => {
    expect(fam.sans[0]).toBe('Nunito Sans')
  })
  it('hand is Caveat', () => {
    expect(fam.hand[0]).toBe('Caveat')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run tailwind.config.test.js`
Expected: FAIL — `fam.serif[0]` is `'Fraunces'`, `fam.hand` is undefined.

- [ ] **Step 3: Retarget the families in `tailwind.config.js`**

Replace the `fontFamily` block:

```js
      fontFamily: {
        serif: ['Cormorant Garamond', 'Georgia', 'serif'],
        sans: ['Nunito Sans', 'system-ui', 'sans-serif'],
        hand: ['Caveat', 'cursive'],
      },
```

- [ ] **Step 4: Load the fonts in `index.html`**

Replace the existing Google Fonts `<link>` (the Fraunces+Inter one) with:

```html
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700;6..12,800&family=Caveat:wght@600;700&display=swap" rel="stylesheet" />
```

Also update the title (drop the kanji, per the wordmark decision):

```html
    <title>issei</title>
```

- [ ] **Step 5: Run to verify pass**

Run: `cd frontend && npx vitest run tailwind.config.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/index.html frontend/tailwind.config.js frontend/tailwind.config.test.js
git commit -m "feat: load Cormorant Garamond + Nunito Sans + Caveat; retarget font families"
```

---

## Task 2: Semantic color roles (action / growth)

**Files:**
- Modify: `frontend/tailwind.config.js`
- Test: `frontend/tailwind.config.test.js` (extend)

**Interfaces:**
- Produces: Tailwind color aliases `action` (`#BD5A2C`, = terra) and `growth` (`#6F8A4D`, = herb). Later sub-projects use `text-action`/`bg-action` for interactive UI and `text-growth`/`bg-growth` for plant/growth elements, encoding the role system. Existing `terra`/`herb` names stay (backward compatible).

- [ ] **Step 1: Extend the failing test**

Add to `frontend/tailwind.config.test.js`:

```js
describe('tailwind color roles', () => {
  const c = config.theme.extend.colors
  it('action maps to terra', () => {
    expect(c.action).toBe('#BD5A2C')
  })
  it('growth maps to herb', () => {
    expect(c.growth).toBe('#6F8A4D')
  })
  it('keeps the heirloom palette', () => {
    expect(c.paper).toBe('#EFE4D2')
    expect(c.terra).toBe('#BD5A2C')
    expect(c.herb).toBe('#6F8A4D')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run tailwind.config.test.js`
Expected: FAIL — `c.action` / `c.growth` undefined.

- [ ] **Step 3: Add the aliases**

In `tailwind.config.js`, add to the `colors` block (keep all existing entries):

```js
        // Semantic roles (spec §4): warm for "do", green for "grow"
        action: '#BD5A2C', // = terra — buttons, links, active states
        growth: '#6F8A4D', // = herb  — plants, growth-stage pills, the garden
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run tailwind.config.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/tailwind.config.js frontend/tailwind.config.test.js
git commit -m "feat: add semantic action/growth color roles"
```

---

## Task 3: The handwritten `issei` wordmark

**Files:**
- Modify: `frontend/src/components/Wordmark.jsx`
- Test: `frontend/src/components/Wordmark.test.jsx` (create)

**Interfaces:**
- Consumes: `font-hand` (Task 1).
- Produces: `<Wordmark />` renders the text `issei` (no period) with class `font-hand`; keeps the `className` / `as` / `muted` props. `muted` keeps its faded-terra behavior for empty-photo surfaces.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/Wordmark.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import Wordmark from './Wordmark'

describe('Wordmark', () => {
  it('renders the handwritten issei mark (no period)', () => {
    const { container } = render(<Wordmark />)
    const el = container.firstChild
    expect(el.textContent).toBe('issei')
    expect(el.className).toContain('font-hand')
  })
  it('muted variant still renders issei', () => {
    const { container } = render(<Wordmark muted />)
    expect(container.firstChild.textContent).toBe('issei')
    expect(container.firstChild.className).toContain('font-hand')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/Wordmark.test.jsx`
Expected: FAIL — current mark renders `issei.` (with period) in `font-serif`.

- [ ] **Step 3: Rewrite `Wordmark.jsx`**

```jsx
// The Issei brand mark: the word "issei", hand-lettered (no icon, no period) —
// per the visual-identity spec §1. Size is controlled by the caller via
// `className`. `muted` renders the faded variant used on empty-photo surfaces
// (recipe cards / detail hero) in place of a cover image.
export default function Wordmark({ className = 'text-5xl', as: Tag = 'span', muted = false }) {
  const base = 'font-hand leading-none'
  if (muted) {
    return <Tag className={`${base} text-terra/40 ${className}`}>issei</Tag>
  }
  return <Tag className={`${base} text-ink ${className}`}>issei</Tag>
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/components/Wordmark.test.jsx`
Expected: PASS.

- [ ] **Step 5: Run the full frontend suite (no regressions from the re-skin)**

Run: `cd frontend && npx vitest run`
Expected: all pass. (Existing tests assert behavior/structure, not font names, so retargeting aliases shouldn't break them. If any test asserted the literal `issei.` period or a font-family string, update it to the new mark and note it in the report.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Wordmark.jsx frontend/src/components/Wordmark.test.jsx
git commit -m "feat: handwritten issei wordmark (no icon, no period)"
```

---

## Task 4: Production build + visual verification + docs

**Files:** `frontend/` (build only); `CLAUDE.md` (update the design-system note).

- [ ] **Step 1: Production build**

Run: `cd frontend && npx vite build`
Expected: succeeds (no missing-font or config errors).

- [ ] **Step 2: Visual-verify the re-skin**

Start the dev server (`cd frontend && npx vite`) and open a couple of screens (Home, a Recipe Detail, Kitchen). Confirm: titles render in Cormorant Garamond (serif), body/labels in Nunito Sans, the header/wordmark in the Caveat hand, and the palette is unchanged. Screenshot Home + Recipe Detail.

**Known cosmetic follow-up (not a blocker), note it:** headings currently use `font-black` (weight 900), which Fraunces had but Cormorant Garamond does not (it tops out ~700). Those headings will render at Cormorant's heaviest available weight. A dedicated **heading-weight polish** pass (retuning `font-black`/`font-bold` usages for the new serif) belongs to a later identity-polish sub-project — do NOT sweep all 17 files here. Just confirm nothing is broken/illegible.

- [ ] **Step 3: Update the design-system note in `CLAUDE.md`**

In the frontend design-system section of `CLAUDE.md`, replace the font lines (currently "Serif font: Playfair Display … / Sans-serif: Inter") with the new system: Cormorant Garamond (display/titles), Nunito Sans (body/UI), Caveat (handwritten — logo + special moments only); and note the color roles (terra/`action` = actions, herb/`growth` = growth) and that the app is light-themed throughout. Keep it to a few lines, matching the surrounding style.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update design-system note for the new visual identity"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** type system §3 (Task 1 fonts + families; handwriting scoped to the wordmark in Task 3, and available as `font-hand` for later special-moment use), logo §1 (Task 3), palette + roles §4 (Task 2), theme §5 (no dark surfaces introduced — nothing here adds one). The **plant system §2** and **future ideas §6** are explicitly *other sub-projects*, not this plan.
- **The re-skin mechanism:** retargeting `font-serif`/`font-sans` aliases is what re-skins the ~17 consuming files without editing them — verify Task 1 changed the *alias targets*, not just added new ones.
- **Period drop:** the handwritten mark drops the terra period (it belonged to the Fraunces treatment; the approved handwritten direction is just "issei"). If the user wants the period back, it's a one-line change in Wordmark.
- **Heading weight:** the `font-black`→Cormorant gap is a real but cosmetic follow-up (Task 4 Step 2 note) — deliberately deferred to an identity-polish pass, not fixed here, to keep this plan's scope tight and its diff reviewable.
- **`muted` Wordmark:** preserved as-is functionally; the empty-photo *watermark* treatment itself (whether it stays the wordmark or becomes the plant) was never finalized in brainstorming and is out of scope here.
