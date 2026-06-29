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

## Environment

Requires a `.env` file in the project root:
```
DATABASE_URL=sqlite:///./recipes.db
JWT_SECRET=your-secret-here
```

Production uses PostgreSQL via `DATABASE_URL` pointing to Neon. The database layer auto-detects SQLite vs Postgres and adjusts connection args accordingly.

## Architecture

**App entry:** `app/main.py` — mounts four routers (auth, recipes, shopping_list, mom_form).

**Routers** (`app/routers/`) — endpoint definitions. Each router handles one domain: auth (signup/login/me), recipes (CRUD + scaling), shopping_list (consolidation), mom_form (HTML form served with HTTP Basic Auth).

**Models** (`app/models/`) — SQLAlchemy ORM models. Key relationship: Recipe → IngredientSection → Ingredient, but ingredients also have a direct `recipe_id` FK (deliberate denormalization for query simplicity).

**Schemas** (`app/schemas/`) — Pydantic models for request/response validation. Separate from ORM models to control what's exposed at the API boundary.

**Services** (`app/services/`) — business logic decoupled from HTTP layer. `scaling.py` handles the three-type quantity model (precise/imprecise/unmeasured), `shopping_list.py` consolidates ingredients, `units.py` handles unit conversion.

**Auth** (`app/auth.py`) — JWT-based stateless auth. `get_current_user` is the dependency injected into protected endpoints.

**Migrations** (`alembic/`) — `alembic/env.py` imports all models and uses the app's engine directly. New models must be imported there for autogenerate to detect them.

## Key Design Decisions

- **Quantity model:** Ingredients have `quantity_type` of "precise", "imprecise", or "unmeasured". Scaling logic branches on this: precise scales mathematically, imprecise scales approximately, unmeasured stays unchanged.
- **Soft delete:** Recipes use `deleted_at` timestamp. All queries must filter `WHERE deleted_at IS NULL`.
- **Single transaction pattern:** Recipe creation flushes mid-transaction to get auto-generated IDs for child rows before final commit.

## Frontend (in progress)

Located in `frontend/` directory. React + Vite + Tailwind CSS + React Router + Axios.

**Design system:**
- Background: #F7F2EA (warm cream)
- Primary text: #1A1A1A
- Accent: #8B5E3C (warm brown)
- Secondary: #D4C5B0
- Card surface: #FFFFFF
- Serif font: Playfair Display (Google Fonts) — headers, recipe names
- Sans-serif: Inter (Google Fonts) — body text
- Mobile-first, max-width 430px centered on desktop
- Bottom navigation: Home, Recipes, Add Recipe, Profile

**Conventions:**
- JWT stored in localStorage under key `issei_token`
- User object stored in localStorage under key `issei_user`
- API calls through `src/api/client.js` (axios instance with base URL + auth header)
- Components in `src/components/`, pages in `src/pages/`
- Hooks only, no class components
- No UI libraries (no shadcn, no MUI) — custom Tailwind only

**MVP screens:** Login/Signup, Home (empty + populated states), Recipe List, Recipe Detail, Add Recipe
