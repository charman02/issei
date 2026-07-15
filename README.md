# Issei

**Live app:** https://issei-delta.vercel.app · **API + interactive docs:** https://family-recipe-library.onrender.com/docs · **Source:** https://github.com/charman02/issei

> Both are on free tiers — allow up to ~1 minute for the API to cold-start on the first request, then it's responsive.

## What It Is
A deployed full-stack web app for preserving the family recipes that were never written down — the cooking knowledge immigrant elders carry in memory, one generation from being lost. *Issei* (一世) means "first generation": the first of a family to arrive somewhere new. The tagline says it — **recipes that live in memory, not cookbooks.**

Instead of treating a recipe as a static list of grams and steps, Issei treats it as a **living vessel for a person**: the cook's own voice and story are woven in, their imprecise measurements ("a dash," "three soup spoons," "until it smells right") are preserved verbatim and celebrated as fidelity rather than normalized away, and each recipe **grows from a seed into a tree** as it's cooked, enriched, and handed down to the next generation. Passing a recipe to a relative — the *handoff* — is both how the knowledge spreads and how families are invited in to fill in what one person can't remember alone.

Under the hood that's a full CRUD REST API with JWT auth, a domain-driven fuzzy-quantity model, serving-size scaling, shopping-list consolidation, photo upload, and a lineage/growth system with private → shared → public visibility.

**Stack at a glance:** React + Vite + Tailwind SPA (Vercel) → FastAPI + SQLAlchemy REST API (Render) → PostgreSQL (Neon). JWT auth, 19 endpoints, 8 data models, ~140 automated tests (pytest + Vitest).

## Tech Stack
**FastAPI** - automatic request validation via Pydantic, auto-generated /docs page for testing, and async-ready. Faster to build with than Flask for the backend API.

**SQLAlchemy** - ORM that maps Python classes to database tables. Lets me write queries in Python while being database-agnostic - same code runs on SQLite locally and Postgres in production.

**Alembic** - versioned database migrations that track schema changes across environments. Works natively with SQLAlchemy.

**Pydantic** - data validation and serialization at the API boundary. Separating request/response schemas from database models prevents accidentally leaking sensitive fields like hashed passwords.

**PostgreSQL (Neon)** - production database. Handles concurrent writes reliably, unlike SQLite. Hosted on Neon's free tier.

**bcrypt** - industry-standard password hashing. Deliberately slow to resist brute-force attacks; includes automatic salting to defeat rainbow table attacks.

**python-jose** JWT creation and verification for stateless authentication. Tokens are signed with a secret key and include expiry - no server-side session storage needed.

**pytest** - automated tests for the scaling service, auth endpoints, and unit conversion logic.

**Vitest + React Testing Library** - frontend unit/component tests (growth-state logic, lineage payload builders, form and page components). Run with `npm test` in `frontend/`.

**Cloudinary** - hosts recipe photos uploaded through the `/upload` endpoint.

**React + Vite + Tailwind CSS** - the frontend single-page app (`frontend/`), with **axios** for API calls and **React Router** for client-side routing. Mobile-first, talks to the backend over HTTP.

**Render + Vercel** - the two deployment platforms, both wired to GitHub: the FastAPI backend auto-deploys to **Render** and the React SPA auto-deploys to **Vercel** on every push to `main`. The frontend reaches the backend via a build-time `VITE_API_URL` env var, and the backend's allowed CORS origins are env-driven — so hosts can change without a code edit.

## Key Engineering Decisions
**Fuzzy quantity modeling:** Ingredients store both `quantity_text` (always preserved verbatim) and optional `quantity_value` and `unit` fields, with a `quantity_type` of "precise", "imprecise", or "unmeasured". The alternative was storing only exact measurements, but Asian home cooking rarely uses precise quantities — "a dash of fish sauce" and "3 soup spoons" are how recipes are actually passed down. The three-type model lets the scaling service handle each case appropriately: precise quantities scale mathematically, imprecise quantities scale approximately, unmeasured quantities don't scale at all.

**Denormalized `recipe_id` on ingredients:** Ingredients store `recipe_id` directly even though they could derive it through `section_id → ingredient_sections → recipe_id`. This is a deliberate denormalization. Without it, fetching all ingredients for a recipe requires a join through sections — and sectionless ingredients (where `section_id` is null) would be unreachable entirely. The direct `recipe_id` makes the common query simple and fast: `WHERE recipe_id = ?`.

**Single transaction with `db.flush()` for mid-transaction IDs:** Creating a recipe with nested ingredients and steps happens in a single database transaction — all inserts succeed or all are rolled back. Within that transaction, `db.flush()` is called after creating the recipe and each ingredient section to get their auto-generated IDs without committing. Those IDs are then set on child rows (`recipe_id`, `section_id`) before the final `db.commit()`. Without `flush()`, the IDs wouldn't exist in Python yet and the foreign key assignments would fail.

**Soft delete:** Recipes are soft-deleted by setting a `deleted_at` timestamp rather than removing the row. Hard delete was simpler to implement, but losing a family recipe permanently is unacceptable for this use case. All queries filter `WHERE deleted_at IS NULL`, and recovery is possible by clearing the timestamp.

**JWT stateless auth:** Authentication uses JWT tokens rather than server-side sessions. Sessions require storing state on the server and a session store (like Redis), which adds infrastructure complexity. JWTs are self-contained — the token encodes the user ID and expiry, and any server instance can verify it using just the secret key.

## API Endpoints
| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| POST | /auth/signup | No | Creates a new user account. Returns id, email, and created_at. |
| POST | /auth/login | No | Verifies credentials and returns a JWT access token. |
| GET | /auth/me | Yes | Returns the currently authenticated user. |
| POST | /recipes | Yes | Creates and returns a new recipe. |
| GET | /recipes | Yes | Returns the current user's recipes. |
| GET | /recipes/{recipe_id} | Yes | Returns the queried recipe. |
| GET | /recipes/{recipe_id}/scale?servings={n} | Yes | Returns the recipe scaled to the target serving size. |
| PATCH | /recipes/{recipe_id} | Yes | Modifies the queried recipe. |
| DELETE | /recipes/{recipe_id} | Yes | Deletes the queried recipe. |
| POST | /recipes/{recipe_id}/cook | Yes | Logs a cook event; returns updated cook_count. |
| POST | /recipes/{recipe_id}/handoff | Yes | Passes the recipe to a person (in-app user or email invite). On a **private** recipe this grants the recipient access (view + cook); the grant attaches to the lineage root. |
| GET | /recipes/{recipe_id}/lineage | Yes | Returns the walkable lineage spine + tree counts. |
| GET | /recipes/shared | Yes | Returns recipes shared *with* the current user (accepted grants; excludes their own). |
| POST | /recipes/handoffs/{handoff_id}/accept | Yes | Claims a pending invite for the current user (backend-only; the two auto-accept paths cover the in-app cases, so there is no MVP UI for this). |
| GET | /recipes/invite/{token} | No | Unauthenticated soft-wall preview of a handed-off recipe (name, who it's from, story, plant — never the body). |
| POST | /recipes/invite/{token}/claim | Yes | Claims an invite by its token, granting the current user access (resolves the mismatched-email case). |
| GET | /recipes/browse | No | Public discovery feed (root-visibility gated). |
| POST | /shopping-list | Yes | Creates a shopping list. |
| POST | /upload/recipe-photo | Yes | Uploads a photo to Cloudinary. |

**Three visibility tiers — Private → Shared → Public.** A recipe is viewable by a user when: the root recipe's visibility is `public`, **or** they own it, **or** they hold an accepted handoff (grant) on its root. "Shared" is not a stored enum value — `visibility` stays `private | public`; a private recipe with ≥1 accepted grant *is* shared with those people. In-app grants are accepted instantly; email invites are pending until the invitee signs up with the matching email, at which point they auto-accept. `GET /recipes/{recipe_id}` and `/lineage` apply this same `can_view` rule.

## Setup Instructions
1. **Clone the repo:**
```
git clone https://github.com/charman02/issei.git
cd issei
```
2. **Create and activate venv (Mac/Linux):**
```
python3 -m venv venv
source venv/bin/activate
```
3. **Install dependencies:**
```
pip install -r requirements.txt
```
4. **Create .env file in project root with:**
```
DATABASE_URL=sqlite:///./recipes.db
JWT_SECRET=your-secret-here
```
5. **Run migrations:**
```
alembic upgrade head
```
6. **Start the server:**
```
uvicorn app.main:app --reload
```
7. **Visit:**
```
http://localhost:8000/docs
```

### Frontend
The React frontend lives in `frontend/`. Run it alongside the backend (both servers must be running locally).
1. **Install dependencies:**
```
cd frontend
npm install
```
2. **Start the Vite dev server (on :5173):**
```
npm run dev
```
3. **Build for production:**
```
npm run build
```
4. **Run the frontend test suite:**
```
npm test
```

## Future Roadmap
See [FUTURE.md](FUTURE.md) for planned features including multi-user family sharing, iOS mobile app, translation support, and richer photo/video support.

## Live Demo
- **App (React frontend):** https://issei-delta.vercel.app — sign up and it works end to end: create a recipe, watch it grow, scale it, build a shopping list.
- **API (FastAPI, interactive Swagger docs):** https://family-recipe-library.onrender.com/docs — every endpoint is callable in-browser.

**Deployment:** the frontend is hosted on **Vercel** (static SPA build, auto-deploys on push to `main`); the backend is hosted on **Render** (auto-deploys on push to `main`) and talks to a **Neon** PostgreSQL database. CORS origins are env-driven so the frontend host can change without a code edit.

Note: both run on free tiers — the API may take ~1 minute to cold-start on first load, then it's responsive.
