# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Compact / Handoff Instructions

This is a long, multi-sub-project build run via superpowers subagent-driven-development. Durable state lives in **`.superpowers/sdd/progress.md`** (the ledger) — read it first after any compaction or `/clear` to know exactly where things stand. Prefer **`/clear` at sub-project boundaries** over letting the session auto-compact mid-work.

When compacting, preserve (in priority order):
1. **Active sub-project + task** — which of R1–R4 (or SPn) is in flight, and which task number.
2. **Branch state** — working branch is `lineage-mvp`; `main` is frozen at `65127f7` and auto-deploys to prod Neon (do NOT merge/push without explicit approval). 135 commits ahead, unpushed.
3. **Key files changed** with line numbers, and current test status (backend `pytest`, frontend `vitest`).
4. **Open decisions / next step** — what the user last approved and what comes next.
5. **Non-obvious commands** that work (the isolated demo stack: backend :8010 via `run_backend.py`, Vite :5183 with `VITE_API_URL`; on Windows kill stale servers with `taskkill //F //PID`, not `pkill`).

Drop verbatim tool output, resolved review threads, and superseded design options — the ledger and git history hold those.

## What This Is

A deployed full-stack app (FastAPI backend + React frontend) for preserving the family recipes immigrant elders carry but never wrote down — *issei* (一世) = "first generation." The core is the **living recipe**: a recipe as a vessel for a *person* (their voice/story woven in; imprecise measurements like "a dash" or "3 soup spoons" preserved verbatim as fidelity, never normalized), which **grows from a seed into a tree** as it's cooked, enriched, and **handed down** to the next generation. Lineage/growth + the handoff are the signature; the fuzzy-quantity model is a supporting layer. Backend on Render, frontend on Vercel, PostgreSQL (Neon) in production, SQLite locally.

## Commands

```bash
# Start dev server
uvicorn app.main:app --reload

# Run all tests
pytest

# Run a single test file
pytest tests/test_scaling.py

# Run a single test
pytest tests/test_scaling.py::test_precise_with_unit

# Run migrations
alembic upgrade head

# Create a new migration (after model changes)
alembic revision --autogenerate -m "description"
```

Frontend (from the `frontend/` directory):

```bash
# Start the Vite dev server (on :5173)
cd frontend && npm run dev

# Build for production
cd frontend && npm run build

# Run the frontend test suite (Vitest + React Testing Library)
cd frontend && npm test
```

## Environment

Requires a `.env` file in the project root:
```
DATABASE_URL=sqlite:///./recipes.db
JWT_SECRET=your-secret-here
```

Production uses PostgreSQL via `DATABASE_URL` pointing to Neon. The database layer auto-detects SQLite vs Postgres and adjusts connection args accordingly.

## Architecture

**App entry:** `app/main.py` — mounts four routers (auth, recipes, shopping_list, upload) and a `/health` endpoint.

**Routers** (`app/routers/`) — endpoint definitions. Each router handles one domain: auth (signup/login/me), recipes (CRUD + scaling), shopping_list (consolidation), upload (Cloudinary photos). Recipes also has lineage/sharing actions: `POST /{id}/cook`, `POST /{id}/handoff`, `GET /{id}/lineage`, `GET /recipes/shared`, `POST /recipes/handoffs/{id}/accept`, the soft-wall invite flow (`GET /recipes/invite/{token}`, `POST /recipes/invite/{token}/claim`), plus the public `GET /recipes/browse`.

**Models** (`app/models/`) — SQLAlchemy ORM models. Key relationship: Recipe → IngredientSection → Ingredient, but ingredients also have a direct `recipe_id` FK (deliberate denormalization for query simplicity). Lineage adds `parent_recipe_id` (self-FK) + `lineage_relation`/`visibility`/`origin_attribution`/`prompt_*` columns on Recipe, and new tables `ghost_ancestor`, `cook_event`, `handoff`.

**Schemas** (`app/schemas/`) — Pydantic models for request/response validation. Separate from ORM models to control what's exposed at the API boundary.

**Services** (`app/services/`) — business logic decoupled from HTTP layer. `scaling.py` handles the three-type quantity model (precise/imprecise/unmeasured), `shopping_list.py` consolidates ingredients, `units.py` handles unit conversion, `growth.py` computes the seed→tree growth stage/vitality, `lineage.py` handles root-bound effective visibility, the `can_view` read-authorization rule, and the lineage-view builder.

**Auth** (`app/auth.py`) — JWT-based stateless auth. `get_current_user` is the dependency injected into protected endpoints.

**Migrations** (`alembic/`) — `alembic/env.py` imports all models and uses the app's engine directly. New models must be imported there for autogenerate to detect them.

## Key Design Decisions

- **Quantity model:** Ingredients have `quantity_type` of "precise", "imprecise", or "unmeasured". Scaling logic branches on this: precise scales mathematically, imprecise scales approximately, unmeasured stays unchanged.
- **Soft delete:** Recipes use `deleted_at` timestamp. All queries must filter `WHERE deleted_at IS NULL`.
- **Single transaction pattern:** Recipe creation flushes mid-transaction to get auto-generated IDs for child rows before final commit.
- **Root-bound visibility:** A recipe's effective visibility is its lineage root's `visibility` (private by default); `get_recipe`, `browse`, and `lineage` all gate on `effective_visibility()`.

## Frontend (in progress)

Located in `frontend/` directory. React + Vite + Tailwind CSS + React Router + Axios.

**Design system** (garden palette; the palette source of truth is `frontend/tailwind.config.js`):
- Garden palette (green is the ambient lead; terra is the action accent): paper `#F3EAD6` · card `#FCF8EE` · ink `#2E3A24` (deep leaf) · ink-soft `#4A5540` · line `#E3D9C4` · growth `#5C7A3F` (lead green, = herb) · growth-bright `#7FA05A` · terra `#B5502A` · saffron `#D99A2B` · plum `#8A3D5A` · soil `#C9A277`
- **Color roles:** `growth`/green = ambient + grow (the world, plants, garden, eyebrows); `action` (= terra) = interactive intent (buttons, links, active); `plum` = the person / heritage byline ("from Lola"); `saffron` = vitality sparks. "Green for the world, warm for what you do."
- **Type:** Cormorant Garamond (`font-serif`) — display/titles; Nunito Sans (`font-sans`) — body/UI (body/ingredients at 14.5px, bold amounts — the R1 readability baseline; see `.ingredient-row`/`.ingredient-amount`); Caveat (`font-hand`) — the handwritten `issei` wordmark + special moments only.
- **Logo:** handwritten `issei` wordmark (no icon, no period) via `<Wordmark />`.
- **Language:** garden voice, not cookbook — "Your Garden" (not Kitchen), "Plant your first seed" (signup). Recipes are named by the **dish** ("Adobo"); the person shows as "from {source}" (from `origin_attribution`). Domain words (cook/recipe) stay.
- **Theme:** light/cream throughout — no dark theme (splash included).
- Mobile-first, max-width 430px centered on desktop
- Bottom navigation: Home · Browse · Add · Garden · You
- **Second renovation (R1–R4) in progress:** R1 = readable garden foundation (done); R2 = the immersive garden (a place you enter); R3 = the plant interface + growth animations (cooking becomes a tactile tending ritual, Finch-inspired); R4 = bottom-nav redesign + the living "front door" (login) + capture. Never a scoreboard — playful/alive + personal/significant (the wordmark duality).
- **Signature = the seed→tree plant system** (each recipe grows seed→sprout→sapling→tree, with bare→blooming→fruiting vitality); art + growth logic specced, built in later identity sub-projects.

**Conventions:**
- JWT stored in localStorage under key `issei_token`
- User object stored in localStorage under key `issei_user`
- API calls through `src/api/client.js` (axios instance with base URL + auth header)
- Components in `src/components/`, pages in `src/pages/`
- Hooks only, no class components
- No UI libraries (no shadcn, no MUI) — custom Tailwind only
- Don't git commit without my approval

**MVP screens:** Login/Signup, Home (empty + populated states), Recipe List, Recipe Detail, plus PlantRecipe (`/add`, stepped flow — a seed becoming a tree), EditRecipe (`/recipes/:id/edit`), SharedWithMe (`/shared`), InviteLanding (`/invite/:token` soft wall), and the growth plant / provenance on RecipeCard + RecipeDetail.
