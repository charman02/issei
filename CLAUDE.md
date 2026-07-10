# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A FastAPI REST API for preserving and sharing family recipes, designed for Asian home cooks who use imprecise measurements ("a dash", "3 soup spoons"). Deployed on Render with PostgreSQL (Neon) in production, SQLite locally.

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

**App entry:** `app/main.py` — mounts five routers (auth, recipes, shopping_list, mom_form, upload) and a `/health` endpoint.

**Routers** (`app/routers/`) — endpoint definitions. Each router handles one domain: auth (signup/login/me), recipes (CRUD + scaling), shopping_list (consolidation), mom_form (HTML form served with HTTP Basic Auth), upload (Cloudinary photos). Recipes now also has lineage actions: `POST /{id}/remix`, `POST /{id}/cook`, `POST /{id}/handoff`, `GET /{id}/lineage`, plus the public `GET /recipes/browse`.

**Models** (`app/models/`) — SQLAlchemy ORM models. Key relationship: Recipe → IngredientSection → Ingredient, but ingredients also have a direct `recipe_id` FK (deliberate denormalization for query simplicity). Lineage adds `parent_recipe_id` (self-FK) + `lineage_relation`/`visibility`/`origin_attribution`/`prompt_*` columns on Recipe, and new tables `ghost_ancestor`, `cook_event`, `handoff`.

**Schemas** (`app/schemas/`) — Pydantic models for request/response validation. Separate from ORM models to control what's exposed at the API boundary.

**Services** (`app/services/`) — business logic decoupled from HTTP layer. `scaling.py` handles the three-type quantity model (precise/imprecise/unmeasured), `shopping_list.py` consolidates ingredients, `units.py` handles unit conversion, `lineage.py` handles remix diff → remix prompt, effective visibility, and the lineage-view builder.

**Auth** (`app/auth.py`) — JWT-based stateless auth. `get_current_user` is the dependency injected into protected endpoints.

**Migrations** (`alembic/`) — `alembic/env.py` imports all models and uses the app's engine directly. New models must be imported there for autogenerate to detect them.

## Key Design Decisions

- **Quantity model:** Ingredients have `quantity_type` of "precise", "imprecise", or "unmeasured". Scaling logic branches on this: precise scales mathematically, imprecise scales approximately, unmeasured stays unchanged.
- **Soft delete:** Recipes use `deleted_at` timestamp. All queries must filter `WHERE deleted_at IS NULL`.
- **Single transaction pattern:** Recipe creation flushes mid-transaction to get auto-generated IDs for child rows before final commit.
- **Root-bound visibility:** A recipe's effective visibility is its lineage root's `visibility` (private by default); `get_recipe`, `browse`, and `lineage` all gate on `effective_visibility()`.

## Frontend (in progress)

Located in `frontend/` directory. React + Vite + Tailwind CSS + React Router + Axios.

**Design system** (visual identity locked — see `docs/superpowers/specs/2026-07-10-visual-identity-design.md`; palette is the source of truth in `frontend/tailwind.config.js`):
- Heirloom palette: paper `#EFE4D2` · card `#FBF6EC` · ink `#3A2A1C` · ink-soft `#6D5844` · line `#E3D3BA` · terra `#BD5A2C` · saffron `#D99A2B` · herb `#6F8A4D` · plum `#8A3D5A`
- **Color roles:** `action` (= terra) for interactive UI (buttons, links, active); `growth` (= herb) for plants/growth/garden. "Warm for do, green for grow."
- **Type:** Cormorant Garamond (`font-serif`) — display/titles; Nunito Sans (`font-sans`) — body/UI; Caveat (`font-hand`) — the handwritten `issei` wordmark + special moments only (e.g. the story quote), not every title.
- **Logo:** handwritten `issei` wordmark (no icon, no period) via `<Wordmark />`.
- **Theme:** light/cream throughout — no dark theme (splash included).
- Mobile-first, max-width 430px centered on desktop
- Bottom navigation: Home · Browse · Add · Kitchen · You
- **Signature = the seed→tree plant system** (each recipe grows seed→sprout→sapling→tree, with bare→blooming→fruiting vitality); art + growth logic specced, built in later identity sub-projects.

**Conventions:**
- JWT stored in localStorage under key `issei_token`
- User object stored in localStorage under key `issei_user`
- API calls through `src/api/client.js` (axios instance with base URL + auth header)
- Components in `src/components/`, pages in `src/pages/`
- Hooks only, no class components
- No UI libraries (no shadcn, no MUI) — custom Tailwind only
- Don't git commit without my approval

**MVP screens:** Login/Signup, Home (empty + populated states), Recipe List, Recipe Detail, plus PlantRecipe (`/add`, stepped flow — a seed becoming a tree), RemixRecipe (`/recipes/:id/remix`), EditRecipe (`/recipes/:id/edit`), and growth marks / lineage on RecipeCard + RecipeDetail.
