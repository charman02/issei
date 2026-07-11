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

R1 is deliberately the *foundation* pass: it changes tokens, type, and a few
mechanics that every later screen inherits — without building the garden/nav/plant
interfaces (those are R2–R4). Five pieces:

1. **A garden-forward palette** (green promoted to the ambient lead; terra becomes a
   warm action accent).
2. **Readable body type** (fix the thin/small regression on ingredients & body).
3. **Login field reset** on switching Sign in ↔ Join the table.
4. **"I cooked this" undo + a visible cook count** on a recipe.
5. **Dish-led recipe naming** (the dish is the name; the person shows as "from …").

Explicitly **out of scope** (deferred to R2–R4): the immersive garden layout, plant
tap-to-tend interface, growth animations, bottom-nav redesign, capture-flow
reimagining, page transitions. R1 must not try to make the Garden feel immersive —
that's R2's whole job.

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

**Problem:** switching the Login tabs (Sign in ↔ Join the table) keeps whatever was
typed, so stale values bleed across modes.

**Behavior:** switching tabs **clears all form fields** (email, password, confirm
password, first name, last name) **and the error message**. Switching is a fresh
start. No other Login change in R1 (the password-eye toggle from the old backlog can
ride along if trivial, but the reset is the requirement).

---

## 5. "I cooked this" — undo + visible count

**Problem:** "I cooked this" fires immediately with no recovery (a misclick
permanently adds a cook event and feeds growth), and the recipe never shows *how many
times* it's been cooked.

**Behavior:**

- **Undo:** after tapping "I cooked this", show an inline confirmation with an
  **Undo** affordance (e.g. "🍲 Cooked! · Undo") that reverses the just-logged cook.
  Undo removes that specific cook event (and thus its growth contribution). The undo
  stays available until it's dismissed/navigated away — it does **not** silently
  vanish on a timer (misclick recovery must be reliable).
- **Cook count:** the recipe surface shows a gentle, non-scoreboard count — **"Cooked
  N times"** (and, where it reads naturally, "last cooked …"). This is heritage
  ("this dish has been made 12 times"), framed warmly — never a competitive metric.
  `RecipeResponse` already carries `cook_count`/`owner_cook_count`/`last_cooked_at`;
  surface them.

**Backend:** `POST /recipes/{id}/cook` returns the created cook-event id; a new
**`DELETE /recipes/{id}/cook/{event_id}`** removes it, restricted to the event's own
author (a user can only undo their own cook). Re-derive growth on the affected
recipe as usual. This is the one backend change in R1 (nullable/additive — no schema
migration; `cook_events` already exists).

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

- **Backend:** unit/integration for the new `DELETE /recipes/{id}/cook/{event_id}` —
  author-only (non-author → 404/403), removes exactly one event, recomputes growth,
  and undoing the *first* cook reverts a Sprout→Seed stage change. Existing cook/growth
  tests stay green.
- **Frontend:** Login clears fields on tab switch; "I cooked this" shows undo and undo
  reverses the count; cook count renders ("Cooked N times"); ingredient body renders
  at the new size/weight; "from {source}" displays with the fallback. Palette: a token
  smoke check (no removed token referenced) + build clean.
- **Visual verification:** the isolated demo stack (backend :8010 + Vite :5183),
  screenshot the login, a rich recipe (readable ingredients, "from Lola", cook count +
  undo), and the app background/cards in the new green palette; confirm 0 console
  errors and AA contrast on body text.

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
