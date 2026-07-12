# R1 — Readable Garden Foundation + Quick Wins

**Status:** Design in progress (brainstormed 2026-07-11). Part of the **second
renovation** (R1–R4) that turns the app from a re-skinned cookbook into an
immersive plant/growth *experience*. R1 is the foundation the rest builds on.

**Context — why a second renovation:** SP1–SP6 delivered the visual *identity*
(palette, type, plant art, living-recipe page, capture, handoff, garden bands) but
the *experience* still reads as a cookbook with plant art added. The renovation
sequence:

- **R1 (this spec)** — readable green foundation + functional quick wins.
- **R2** — the immersive garden (a place you *enter*, not a list). Hero.
- **R3** — the plant interface (kneel-to-tend; growth/vitality animations).
- **R4** — the frame (bottom nav) + the front door (capture), both interactive.

Motion and the "gamified-but-personal" feel are **cross-cutting principles**, not a
separate project. The north star, in one line: **modern + handwritten (the wordmark
duality) applied to the whole app — playful and alive to touch, personal and
significant at its core. Never a scoreboard** (points/streaks would cheapen a
grandmother's recipe; spec `2026-07-09` §2.6).

---

## 1. Scope of R1

R1 is deliberately the *foundation* pass: it changes tokens, type, language, and
naming that every later screen inherits — without building the garden/nav/plant
interfaces (those are R2–R4). **R1 is frontend-only** (no backend changes, no
migration). Five pieces:

1. **A garden-forward palette** (green promoted to the ambient lead; terra becomes a
   warm action accent).
2. **Readable body type** (fix the thin/small regression on ingredients & body).
3. **Login field reset** on switching Sign in ↔ the signup tab.
4. **A cookbook→garden metaphor sweep** (retire "the table"/"the kitchen" language;
   the garden is the center now).
5. **Dish-led recipe naming** (the dish is the name; the person shows as "from …").

Explicitly **out of scope**:
- **The cook mechanic** (logging a cook, undo, count) — deferred to **R3**, where
  cooking becomes a *tactile plant-tending ritual* (Finch-inspired: tend → the plant
  visibly grows), not a throwaway button. Building a button+undo in R1 for a mechanic
  R3 replaces would be wasted work.
- The immersive garden layout, plant tap-to-tend interface, growth animations,
  bottom-nav redesign, capture-flow reimagining, page transitions (R2–R4).

R1 must not try to make the Garden feel immersive — that's R2's whole job.

---

## 2. The garden palette (green-forward)

**Decision:** promote green from an accent to the **ambient lead**, so the app reads
as a garden rather than a cookbook. Warm cream stays as the surface; terra/brown
demote from "the whole mood" to **warm action/heritage accents** ("warm for *do*,
green for *grow*" — finally realized). The user confirmed green-forward over the
current browns on a real mockup (direction "Sunlit garden").

**Token changes** (`frontend/tailwind.config.js` is the source of truth; these are
the starting values, tunable during build):

| Role | Token | Current (cookbook) | R1 (garden) | Use |
|---|---|---|---|---|
| Ambient/base | `paper` | `#EFE4D2` | `#F3EAD6` (warmer cream) | app background |
| Surface | `card` | `#FBF6EC` | `#FCF8EE` | cards/panels |
| Primary text | `ink` | `#3A2A1C` (brown) | `#2E3A24` (deep leaf) | titles, body |
| Secondary text | `ink-soft` | `#6D5844` | `#4A5540` (green-gray) | subtitles, meta |
| Hairline | `line` | `#E3D3BA` | `#E3D9C4` | borders |
| **Growth (lead)** | `growth` | `#6F8A4D` (herb) | `#5C7A3F` (deeper leaf) | plants, growth, ambient garden, section eyebrows |
| Growth-bright | *(new)* `growth-bright` | — | `#7FA05A` | leaf highlights, plant accents |
| **Action (accent)** | `action`/`terra` | `#BD5A2C` | `#B5502A` | buttons, links, the *do* actions |
| Warm accent | `saffron` | `#D99A2B` | `#D99A2B` (keep) | fruiting/vitality sparks |
| Heritage accent | `plum` | `#8A3D5A` | `#8A3D5A` (keep) | "kept by"/person accents |
| Soil | *(new)* `soil` | — | `#C9A277` | garden ground, capture beats |

**Color-role rule (updated):** **green = ambient + growth (the world);
terra/action = interactive intent (buttons, links, "cook it"); plum = the person;
saffron = vitality sparks.** Green is now the resting color of the whole app; terra
appears where the user *acts*.

**Migration approach:** change the tokens centrally; every component that already
uses tokens (not raw hex) inherits the new palette for free. R1 sweeps live/routed
screens for raw-hex color literals that should be tokens and converts the ones that
now look wrong against green (the known offenders: the story panel `#EFDCBB`, the
cover-placeholder cream, the RecipeCard shadow/edge hexes). Screens that R2–R4 will
rebuild wholesale get the token benefit automatically; R1 does **not** hand-retouch
every pixel of those.

**Contrast floor:** all body/label text must clear **WCAG AA (4.5:1)** against its
surface. `ink #2E3A24` on `card #FCF8EE` and on `paper #F3EAD6` both pass; this is
part of the readability fix, not just aesthetics.

---

## 3. Readable body type

**The regression:** the Cormorant/Nunito switch (SP1) made ingredients and body copy
read too thin and small versus the old design. Confirmed on a mockup that a heavier,
larger body reads comfortably; fonts stay (Cormorant Garamond / Nunito Sans / Caveat).

**Changes (a small, consistent type scale — the fix is size + weight + contrast, not
new fonts):**

- **Body/ingredients:** raise from the current ~12.5px to **14.5px**, line-height
  **1.6–1.7**. This is the headline fix — ingredient lists are the worst offender.
- **Ingredient amounts** ("2 lbs", "a good splash"): **weight 700**, color `ink`
  (currently they blend in). The amount is what the eye scans for.
- **Body default weight:** Nunito Sans **400** minimum for paragraphs; **600** for
  labels/meta; never rely on `300`/thin weights for readable text.
- **Meta/eyebrows** (section labels, "kept by"): keep small (11–12px) but ensure
  `ink-soft`/`growth` contrast passes AA.
- Titles (Cormorant) unchanged in family; verify weight reads well on the new green
  `ink`.

Codify this as a **small set of shared type utilities/classes** (e.g. `.body`,
`.body-strong`, `.amount`, `.eyebrow`) so later renovations reuse one legible scale
instead of re-guessing per screen.

---

## 4. Login field reset

**Problem:** switching the Login tabs (Sign in ↔ the signup tab) keeps whatever was
typed, so stale values bleed across modes.

**Behavior:** switching tabs **clears all form fields** (email, password, confirm
password, first name, last name) **and the error message**. Switching is a fresh
start. No other Login change in R1 (the password-eye toggle from the old backlog can
ride along if trivial, but the reset is the requirement).

---

## 5. Cookbook → garden metaphor sweep

**Problem:** the app's language is still cookbook-era ("Join the table," "Your
Kitchen," "Setting your table…"), which now actively fights the vision: the **garden
is the app's center**, and the copy should say so. This must land in R1, before R2
builds garden screens, so the whole app speaks one language.

**Behavior:** sweep live/routed screens and replace table/kitchen metaphors with
garden voice. Known replacements (not exhaustive — the implementer greps for the
patterns):

| Old (cookbook) | New (garden) |
|---|---|
| "Join the table" (signup CTA) | **"Plant your first seed"** |
| "Setting your table…" (signup loading) | **"Planting…"** |
| "Your Kitchen" (page title + nav label) | **"Your Garden"** |
| "A garden of everything you've kept." (subtitle) | keep — already garden voice |
| Any "the table" / "at the table" phrasing | garden equivalent ("your garden") |
| Bottom-nav "Kitchen" label | **"Garden"** |

**Constraints:**
- The **login kanji callout** (一世 · issei) and the wordmark are heritage identity,
  **not** cookbook metaphor — leave them (the kanji stays; decided 2026-07-12).
- The **login screen's layout/visual reimagining** (the "living front door" — a
  growing-seed entrance, motion, the heritage story arriving *into* a garden rather
  than sitting on paper) is **deferred to R4** ("the frame & the front door"). R1
  only refreshes login within its *current* layout: new palette, "Plant your first
  seed" CTA, field reset. The meaning blurb + issei story are kept as-is (they're the
  "soul" half of the wordmark duality and a good newcomer hook); R4 gives them life.
- "Cook"/"cooked"/"recipe" are the *domain* (this is still a recipe app) — those
  stay; only the **table/kitchen hospitality metaphor** is retired.
- The bottom-nav visual redesign is **R4**; R1 only changes the *label text*
  ("Kitchen" → "Garden") within the existing nav, not its design.
- Route paths (e.g. `/my-recipes`) are unaffected — this is user-facing copy only.

This is a copy/label sweep — cheap, foundational, and unblocks R2's garden language.

---

## 6. Dish-led recipe naming

**Problem:** naming a recipe "Lola's Adobo" and then also stamping "· Lola" beneath
is redundant, and inconsistent naming makes garden labels messy.

**Convention:** a recipe's **name is the dish** ("Adobo", "Sinigang"). The
**person** is carried separately (already captured as the origin/source attribution)
and displayed as **"from {name}"**. This matches how families talk ("Lola's version
of adobo" → dish = adobo, person = Lola) and needs **no new fields** — the app
already stores `origin_attribution`/source and `author_full_name`.

**R1 changes (display + gentle guidance only — the immersive garden label is R2):**

- **Capture nudge:** the plant-a-recipe name field gently guides dish-only naming —
  placeholder/helper like *"Name the dish — e.g. "Adobo". You'll say whose it is
  next."* No hard validation; freeform still allowed.
- **Consistent "from" display:** wherever a recipe currently shows the person
  (RecipeCard byline, RecipeDetail), present it as **"from {source person}"**
  (falling back to "kept by {author}" when there's no recorded source), using the
  leading name segment of `origin_attribution` (the existing `sourceNameOf` helper).
- The full garden-plant label ("Adobo" / "from Lola" under the plant) is **specified
  here but rendered in R2**, when the garden is built. R1 establishes the convention
  + the data plumbing so R2 just places it.

---

## 7. Testing

R1 is frontend-only — no backend tests change.

- **Frontend:** Login clears fields on tab switch; the signup CTA reads "Plant your
  first seed"; "Your Kitchen"/nav "Kitchen" now read "Your Garden"/"Garden"; no
  live/routed screen still shows "the table"/"Join the table" copy; ingredient body
  renders at the new size/weight; "from {source}" displays with the "kept by" fallback.
  Palette: a token smoke check (no removed token referenced) + build clean.
- **Metaphor-sweep guard:** a test (or grep-based check) asserting the retired strings
  ("Join the table", "Your Kitchen", "Setting your table") are absent from live/routed
  components — so the sweep doesn't silently regress.
- **Visual verification:** the isolated demo stack (backend :8010 + Vite :5183),
  screenshot the login ("Plant your first seed"), the Garden page title, a rich recipe
  (readable ingredients, "from Lola"), and the app background/cards in the new green
  palette; confirm 0 console errors and AA contrast on body text.

---

## 8. Resolved decisions (brainstorm 2026-07-11)

1. **North star = the wordmark duality:** modern + handwritten → playful/alive to
   touch, personal/significant at core. "Gamified" = responsive, tactile, rewarding
   to tend — **never** points/streaks/leaderboards.
2. **Person presence = layered:** a light person mark on every garden plant + full
   person (story/voice/face) revealed on entering it. (Realized in R2/R3; the naming
   convention here sets it up.)
3. **Plant interface = feed its growth** (cook = water, add story/photo/words = feed,
   pass it on = seed); recipe lives one tap deeper. (R3.)
9. **Cook logging = a tactile plant-tending ritual, deferred to R3** (Finch-inspired:
   tend → the plant visibly grows). NOT a one-tap "I cooked this" button. Removed from
   R1 so we don't build a mechanic R3 replaces.
10. **Cookbook metaphor is retired** ("the table"/"the kitchen" → garden voice): signup
    CTA = "Plant your first seed"; "Your Kitchen" → "Your Garden". The *domain* words
    (cook/recipe) and heritage identity (一世 kanji + wordmark) stay.
11. **Login screen stays this layout in R1** (palette + CTA + reset only). Its full
    "living front door" reimagining — growing-seed entrance, motion, story arriving into
    a garden — is deferred to **R4**, where the entrance/capture experience lives.
4. **Palette = green-forward** ("Sunlit garden"): green is the ambient lead, terra the
   action accent, cream the surface. Chosen over cookbook browns on a real mockup.
5. **Flat SVG plant art confirmed** — clean/artistic, not 3D/pixel/gamey; and
   confirmed **animation-ready** (vector paths sway/grow/bloom) for R3.
6. **Body type stays (Cormorant/Nunito/Caveat)** but bumps to a legible scale
   (~14.5px body, bold amounts) — the readability fix.
7. **Recipe naming = dish-led**, person shown as "from {name}" from existing
   attribution; capture nudges dish-only naming; no new fields.
8. **"Row, not a garden" is expected in R1** — immersion is R2's job; R1 only lays the
   legible, green foundation. Each screen becoming "a place you enter" is the R2–R4
   mandate.
