# Future Roadmap

This document outlines planned features and improvements for Issei. The current build is a full-stack app (FastAPI backend + React frontend) with recipe management, scaling, shopping lists, and the recipe **lineage tree** (remix / cook / handoff, growth states). The roadmap below represents the natural evolution toward a full product.

---

## Multi-User Family Sharing

**Current state:** The schema is designed with `user_id` on every entity and a `families` table sketched but not implemented. Only single-user access exists in v1.

**What this adds:** Multiple family members share a recipe library. Mom adds recipes, children and grandchildren access them. Invitations sent via email or shareable link. Role-based access (owner can edit, members can read).

**Why it matters:** The core use case — preserving family cooking across generations — requires multiple people to access the same library. A recipe added by mom should be visible to her children without manual sharing.

**Implementation notes:** Add `families` and `family_members` tables. Update authorization checks from `user_id == current_user.id` to `family_id in current_user.families`. Add invitation endpoints with token-based acceptance.

**Note:** Lineage now introduces a lightweight cross-user sharing path — per-recipe `visibility` (public roots that bind descendants) plus handoffs — so the families-table design should account for this overlap rather than duplicate it.

---

## Web Frontend — shipped

**Web frontend — shipped.** React + Vite + Tailwind SPA in `frontend/`, mobile-first, for inputting, browsing, scaling, and sharing recipes from any device — the interface that makes the product usable by non-technical users (the parents and grandparents who are the primary recipe contributors), not just the `/docs` page. Remaining polish is tracked in TECHDEBT.md.

---

## iOS Mobile App

**Current state:** No mobile app exists. The web frontend (now shipped) is mobile-responsive as an interim solution.

**What this adds:** A native iOS experience with faster performance, push notifications for family recipe updates, and camera access for photographing handwritten recipes or dishes.

**Why it matters:** The use case is fundamentally mobile — someone cooking in a kitchen checks a recipe on their phone, not a laptop. Native mobile also enables features impossible in a web app, like voice input for hands-free recipe lookup while cooking.

**Implementation notes:** React Native for cross-platform coverage (iOS and Android), TestFlight for beta testing with initial users, App Store launch after beta validation.

---

## Translation

**Current state:** Recipes have a `language` field (defaults to "en") but no translation functionality exists. A recipe is stored and displayed in whatever language it was entered.

**What this adds:** Automatic translation of recipes into the reader's preferred language, building on the existing `language` field. A recipe entered by a Japanese-speaking parent could be read in English by their kids, or vice versa.

**Why it matters:** This app is built for Asian immigrant families, where it's common for the cooking generation and the reading generation to be most comfortable in different languages. A parent might write a recipe in Japanese; their kids might only read English fluently. Translation also matters practically — when someone is shopping for ingredients, they need the ingredient names in a language they can search for or recognize at the store.

**Implementation notes:** Likely uses a translation API (e.g., DeepL or Google Translate) triggered on read, with caching to avoid re-translating the same recipe repeatedly. The existing `language` field on recipes already tracks the source language, which is the foundation this feature builds on.

---

## Photo/Video Support

**Current state:** Recipes are text-only — no image or video fields exist on any model.

**What this adds:** Support for photos and videos attached to a recipe at multiple levels: a photo of the finished dish, photos, or short videos for individual steps (especially useful for techniques that are hard to describe in words), and a community gallery where people who cooked the recipe can share their own results.

**Why it matters:** Some cooking techniques are much easier to show than describe — how to fold a dumpling, what "until the onions are translucent" actually looks like, the right consistency for a sauce. Photos of the final dish also help confirm "did I make this right?" A gallery of other people's attempts adds a community dimension that text alone can't.

**Implementation notes:** Would require file storage (e.g., S3 or Cloudinary) and new media tables linked to recipes, steps, and a new "gallery post" entity. Video would need size/length limits and probably compression on upload.

---

## Ingredient Canonicalization

**Current state:** Shopping list consolidation matches ingredients by normalized name (lowercase, stripped whitespace) only. "Garlic cloves" and "minced garlic" are treated as two different ingredients and never consolidated, even though they're the same shopping list item.

**What this adds:** A canonicalization layer that recognizes when different ingredient names refer to the same underlying grocery item, so the shopping list can consolidate them correctly. If one recipe calls for "3 garlic cloves" and another calls for "1 tbsp minced garlic," the shopping list should tell you how much garlic to actually buy, not list them as two separate items.

**Why it matters:** This is the most common real-world failure case of the current shopping list feature. Recipes from different sources (or even the same person on different days) describe the same ingredient differently, and the whole point of a shopping list is to tell you what to buy — not to require you to mentally merge entries yourself.

**Implementation notes:** Could start with a manual mapping table (canonical name → list of known aliases) for common ingredients, similar in spirit to the density table already used for unit conversion. A more advanced version could use fuzzy string matching or an LLM-based normalization step, but a simple alias table would cover most real cases for v1.

---

## What I'd Build First

In order of priority:

1. **Anonymity / account-deletion / tombstone model** — the highest-priority *next* step now that the web frontend and lineage tree have shipped. The 2026-07-06 lineage spec calls for `is_anonymous` / `is_tombstone` columns and an account-deletion / anonymize flow so a contributor can leave without orphaning or leaking their descendants' recipes. It's specced but not built, and recipe deletion stays disabled until it lands (see TECHDEBT items (a) and (h)). This is a near-term correctness/privacy dependency, not an exploratory addition.
2. **Multi-user family sharing** — without this, the product can't fully fulfill its actual purpose. A recipe my mom adds should be visible to me and my siblings without needing separate accounts and manual copying. Lineage's per-recipe `visibility` + handoffs now provide a lightweight sharing path, but a proper families model is still closer to a missing core feature than an enhancement, so it ranks above the more exploratory additions below.
3. **iOS mobile app** — now that the web frontend is live, a native mobile experience makes sense given that the real use case (checking a recipe while cooking, contributing a recipe from a phone) is fundamentally mobile-first.
4. **Translation** — highest priority among the "deeper feature" additions, since it directly addresses the core audience: families where the cooking generation and the reading generation may not share a primary language.
5. **Photo/video support** — photo upload already exists via Cloudinary; richer support (step videos, community gallery) meaningfully improves usability for techniques that are hard to describe in text.
6. **Ingredient canonicalization** — the most clearly-scoped technical improvement, but lower priority than the others since the shopping list already works correctly for the common case (exact or near-exact name matches); this fixes an edge case rather than unlocking new usage.
