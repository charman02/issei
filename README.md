## What It Is
A REST API for preserving and sharing family recipes, built for the Asian immigrant community to keep cultural cooking traditions alive across generations. Designed around how Asian home cooks actually share recipes — with imprecise measurements like "a dash" or "a soup spoon" — rather than forcing Western precision. Features include fuzzy quantity modeling, unit conversion, recipe scaling, and shopping list consolidation.

## Tech Stack
**FastAPI** - automatic request validation via Pydantic, auto-generated /docs page for testing, and async-ready. Faster to build with than Flask for an API-only backend.

**SQLAlchemy** - ORM that maps Python classes to database tables. Lets me write queries in Python while being database-agnostic - same code runs on SQLite locally and Postgres in production.

**Alembic** - versioned database migrations that track schema changes across environments. Works natively with SQLAlchemy.

**Pydantic** - data validation and serialization at the API boundary. Separating request/response schemas from database models prevents accidentally leaking sensitive fields like hashed passwords.

**PostgreSQL (Neon)** - production database. Handles concurrent writes reliably, unlike SQLite. Hosted on Neon's free tier.

**bcrypt** - industry-standard password hashing. Deliberately slow to resist brute-force attacks; includes automatic salting to defeat rainbow table attacks.

**python-jose** JWT creation and verification for stateless authentication. Tokens are signed with a secret key and include expiry - no server-side session storage needed.

**pytest** - automated tests for the scaling service, auth endpoints, and unit conversion logic.

**Render** - deployment platform with GitHub integration. Every push to main auto-deploys to production.

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
| POST | /shopping-list | Yes | Creates a shopping list. |

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

## Future Roadmap
See [FUTURE.md](FUTURE.md) for planned features including multi-user family sharing, a web frontend, iOS mobile app, translation support, and photo/video support.

## Live Demo
API: https://family-recipe-library.onrender.com/docs
Note: hosted on Render's free tier — allow 1 minute for cold start on first load.
