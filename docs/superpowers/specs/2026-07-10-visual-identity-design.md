# Issei Visual Identity — Design

**Status:** Design approved in brainstorm session (2026-07-10). This is task #10
("new visual identity for the lineage product"). Complements the product specs
(`2026-07-09-living-recipe-growth-design.md` and the lineage/sharing/visibility
specs) — this covers *how it looks*, they cover *how it works*.

**Scope:** The brand's visual language — direction, logo/wordmark, the seed→tree
plant system (the signature element), type, palette + color roles, theme. Excludes
per-screen layout (that's the product specs + build) and final production art
(hand-lettering + production SVGs are build-time execution, noted where relevant).

---

## 0. Direction

**Refine & elevate** the existing warm-heirloom look — evolution, not reinvention
(chosen over "fresh direction" and "bold reinvention"). Keep the equity already
built (cream, terra, warmth); sharpen it; make the **plant the new signature
element**. The plant is the product's heart (per the living-recipe re-center), so
it leads the identity.

---

## 1. Logo / Wordmark

**The wordmark is the brand mark: the word "issei", hand-lettered, no icon.**

- **Rationale:** the product preserves a *person's hand and voice* (their
  handwriting on a recipe card, "a dash", "cook till it smells right"). A handmade,
  handwritten wordmark *feels* like the product; a clean tech-serif feels like any
  recipe app. This is a deliberate pivot **off** the original Fraunces `issei.`
  serif wordmark.
- **Form:** "issei" in a warm handwritten hand (Caveat-style as the directional
  placeholder; final = commissioned/refined hand-lettering, likely lowercase).
- **No icon/symbol** in the mark for now. Explored integrating the plant — replacing
  an i-dot (tittle) with a sprout/seed/leaf, and drawing letters whose stroke grows
  into a leaf — but every integration read forced in mockup. The clean word is
  strong on its own; the growth story lives in the app's plant system, not the logo.
- **Parked (possible future refinement):** a properly hand-lettered sprout replacing
  an i-tittle — e.g. one sprout on the last "i", or a seed→sprout across the two i's.
  Only if custom-drawn into the letterforms (not an icon parked over a font).

---

## 2. The plant system (the signature element)

Each recipe is a living plant that grows seed→tree; this art is the app's signature.
(Growth *logic* — what advances a recipe — is in the living-recipe spec §2; this
section is the *visual system*.)

### 2.1 Core principle

**Each stage is its own distinct object — shape, not size, tells the stage.**
(Drawing "one tree at four sizes" failed: a sapling *is* a small tree, so it was
ambiguous.) The plant glyph is the **source of truth** and stands alone (e.g. on
Kitchen cards). Pots/soil are **optional scenery** only in a continuous "garden
strip" view — never part of the plant's identity (uniform pots flatten the stage
differences).

### 2.2 The four stages

| Stage | Glyph |
|-------|-------|
| **Seed** | A clean two-tone teardrop seed/kernel. (NOT an acorn — an acorn implies oak, mismatching the generic broadleaf tree.) |
| **Sprout** | A short green stem with two cotyledon leaves. |
| **Sapling** | A "baby tree": a little woody trunk + two small branch stubs + a small three-puff green canopy — a miniature of the full tree. (Chosen over a leafy herb-stalk, which created a vocabulary jump to the tree; the baby-tree makes the arc read as one plant maturing.) |
| **Tree** | Woody trunk + two branch stubs + three overlapping round canopy puffs + two small terra/saffron accent buds. |

**Colors:** foliage in the herb-green family (base `#6F8A4D`, light `#8AA36A`, mid
`#7E9758`); stem/trunk bark-brown `#7A5638`; seed `#8B5E3C`/`#6B4426`; accent buds
terra `#BD5A2C` + saffron `#D99A2B`.

### 2.3 Vitality (fullness within a stage)

Three states — **bare → blooming → fruiting** — driven by repeated use (cooking/
sharing). Blooming = soft pink blossoms; fruiting = ripe terra/saffron fruit. The
**silhouette never changes** (stage stays readable); only decoration is added.

- **Applies to Sapling & Tree only.** Seed & Sprout are single clean states (too
  nascent to "bloom"; a vital sprout is conceptually off and hard to draw).
- Vitality **caps at fruiting** → further use converts to milestones + the recipe's
  textual "its life" record (per living-recipe spec §2.4).
- (Cut: a "budding" tier between bare and blooming — too subtle a beat.)

### 2.4 The garden view (continuous strip)

For a connected "windowsill" view, the same glyphs may sit in **terra pots on a
shared ground line**, with the **Tree graduating out of the pot into open ground**
as the aspirational "it made it" payoff. The seed pot shows the seed resting in
soil (not empty). On individual Kitchen cards, glyphs are **bare** (no pots).

### 2.5 Species-agnostic architecture

v1 ships **one signature plant**. Store growth state + vitality as data; the plant
art is a *lookup*. A future `species` field (defaulting to the signature plant) can
add variety as a pure art/content drop — framed as heritage-meaningful, not gacha
(deferred; see living-recipe spec).

---

## 3. Type

- **Display / titles:** Cormorant Garamond (a classical, high-contrast serif —
  keepsake/heritage feel).
- **Body / UI:** Nunito Sans (a warm humanist rounded sans — readable, friendly).
- **Handwritten hand:** reserved for the **logo** and **special moments** (e.g. the
  story pull-quote on a recipe) — NOT every title/label (handwriting everywhere
  hurts legibility).
- **Rationale:** the hand-lettered logo pairs better with a softer classical serif +
  warm sans than with the previous crisp Fraunces/Inter, which now reads corporate
  next to the handwriting. (Exact fonts are directional; finalize at build.)
- Supersedes the old Fraunces (display) + Inter (body) pairing.

---

## 4. Palette & color roles

**Palette (unchanged heirloom set):** paper `#EFE4D2` · card `#FBF6EC` · ink
`#3A2A1C` · ink-soft `#6D5844` · line `#E3D3BA` · terra `#BD5A2C` · saffron
`#D99A2B` · herb `#6F8A4D` · plum `#8A3D5A`.

**Color roles (the decision):**
- **Terra = ACTIONS / UI** — buttons, links, active states, primary interactive.
- **Herb-green = GROWTH** — plants, growth-stage pills, the garden.
- The mnemonic: *warm for "do", green for "grow".* This keeps the plants visually
  distinct from the UI chrome (rejected "green everywhere," which makes plants
  un-special and reads generic-eco).
- Saffron & plum remain minor accents (e.g. fruit, occasional highlights).

---

## 5. Theme

**The app is LIGHT / cream throughout — no dark theme anywhere**, including the
splash/launch screen. Rationale: the product centers on growth and vitality, which
should feel light and alive; a dark surface (even just on launch) sets a moody first
impression that fights that. (A dark-ink splash was explicitly considered for
"impact" and rejected.)

---

## 6. Future ideas (tracked, not built)

- **Animated loading screen:** a fast-forwarded seed→sprout→sapling→tree time-lapse,
  the animation completing (becoming a full tree) exactly when the app finishes
  loading — turning the wait into "growth." Reuses the plant art; strongly on-brand.
- **Multiple plant species** (see §2.5): personalization + a diverse garden; framed
  as heritage, not collection-mechanic.
- **Sprout-in-the-wordmark** (see §1): revisit if hand-lettered into the letterforms.

---

## 7. Resolved decisions (brainstorm 2026-07-10)

1. **Direction: refine & elevate** the warm-heirloom look; the plant is the new
   signature element.
2. **Logo: handwritten "issei", no icon.** Off the Fraunces serif; growth lives in
   the app, not the mark. Sprout-in-the-i parked as a future refinement.
3. **Plant system:** distinct object per stage (shape not size) — teardrop seed ·
   two-leaf sprout · baby-tree sapling · three-cluster tree. Bare glyph is the source
   of truth; pots are garden-strip scenery only.
4. **Vitality:** bare → blooming → fruiting, on Sapling & Tree only; seed/sprout
   single-state; caps at fruiting → milestones.
5. **Type:** Cormorant Garamond (display) + Nunito Sans (body); handwriting for logo
   + special moments only. Replaces Fraunces + Inter.
6. **Color roles:** terra = actions/UI, herb-green = growth/plants ("do" vs "grow").
7. **Theme: light/cream throughout**, splash included — no dark theme.
8. Build-time execution (not design decisions): commission/refine the actual
   hand-lettering; finalize exact fonts; draw production plant SVGs (four stages ×
   vitality states).
