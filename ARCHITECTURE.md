# Architecture

A practical map of how this codebase is organized and what each piece does.
For *why* the backend is built the way it is (tech choices, design trade-offs),
see `README.md`. For planned features, see `FUTURE.md`. This file is the
"where does X live and what does it do" reference.

The project has two halves:

- **Backend** (`app/`) — a FastAPI REST API. Stores data, enforces auth, does
  the recipe math. Talks to PostgreSQL (prod) / SQLite (local).
- **Frontend** (`frontend/`) — a React single-page app. The UI users actually
  touch. Talks to the backend over HTTP.

They are completely separate programs. The frontend runs in the browser; the
backend runs on a server. They communicate only through HTTP requests (JSON).

---

## Backend (`app/`)

FastAPI app. The request flow is layered: a request hits a **router**, which
validates input against a **schema**, calls into a **service** (for business
logic) or directly queries a **model**, and returns a **schema** as JSON.

```
HTTP request
   ↓
router  (app/routers/)      endpoint definitions, auth checks
   ↓
schema  (app/schemas/)      validate request, shape response (Pydantic)
   ↓
service (app/services/)     business logic — scaling, conversions
   ↓
model   (app/models/)       database tables (SQLAlchemy ORM)
   ↓
database (Postgres / SQLite)
```

| File / folder | What it does |
|---|---|
| `main.py` | App entry point. Creates the FastAPI app, configures CORS, and mounts all the routers. This is what `uvicorn` runs. |
| `config.py` | Reads settings from the `.env` file (database URL, JWT secret, token lifetime, Cloudinary keys) into a typed `settings` object. |
| `database.py` | Sets up the SQLAlchemy engine + session. Auto-detects SQLite vs Postgres. `get_db` is the dependency that hands each request a database session. |
| `auth.py` | Password hashing (bcrypt), JWT creation/decoding, and `get_current_user` — the dependency that protects endpoints by requiring a valid token. |
| `models/` | **ORM models** — Python classes mapping to database tables. One file per table: `user`, `recipe`, `ingredient`, `ingredient_section`, `step`. |
| `schemas/` | **Pydantic models** — define the JSON shape of requests and responses, separately from the DB models. Keeps internal fields (like password hashes) from leaking to the API. |
| `routers/` | **Endpoint definitions**, grouped by domain: `auth` (signup/login/me), `recipes` (CRUD + scaling + browse), `shopping_list`, `upload` (Cloudinary photos), `mom_form` (an HTML form). |
| `services/` | **Business logic**, decoupled from HTTP. `scaling.py` (the precise/imprecise/unmeasured quantity math), `units.py` (unit conversion), `shopping_list.py` (ingredient consolidation). |

**Models vs Schemas — the distinction that trips people up.** A *model*
(`models/recipe.py`) is the database table. A *schema* (`schemas/recipe.py`) is
the API contract. They look similar but serve different masters: the model has
every column (including ones you never expose); the schema has only what the API
should accept or return. `RecipeCreate` (what you send to create) and
`RecipeResponse` (what you get back) are different schemas for the same model.

**`alembic/`** (sibling of `app/`, not inside it) — database migrations. Every
time a model changes (new column, etc.), you generate a migration here and apply
it to keep the real database schema in sync. Files in `alembic/versions/` are
the ordered history of schema changes.

---

## Frontend (`frontend/`)

A **React** app built with **Vite** (the dev server + build tool) and styled
with **Tailwind CSS**. If React is new to you, the mental model is:

- The UI is built from **components** — JavaScript functions that return markup
  (JSX, which looks like HTML inside JS). A page is just a big component made of
  smaller ones.
- Components hold **state** with the `useState` hook (a "hook" is a function
  starting with `use` that plugs into React's features). When state changes,
  React re-renders that component automatically. You never manually touch the
  DOM.
- `useEffect` runs code *after* render — used here mostly to fetch data from the
  backend when a page first loads.

### Folder layout

```
frontend/
├── index.html              the single HTML page everything mounts into
├── package.json            dependencies + npm scripts (dev, build)
├── vite.config.js          build tool config
├── tailwind.config.js      design tokens: colors, fonts, max-width
└── src/
    ├── main.jsx            entry point — mounts <App> into index.html
    ├── App.jsx             route table — maps URLs to pages
    ├── index.css           Tailwind imports + custom utilities
    ├── api/
    │   └── client.js       the axios HTTP client (talks to the backend)
    ├── components/         reusable UI pieces (used across pages)
    ├── pages/              one component per screen / route
    └── utils/              non-UI helper logic
```

### How a page actually loads (the data flow)

1. The browser loads `index.html`, which loads `main.jsx`.
2. `main.jsx` wraps everything in `<BrowserRouter>` (enables URL routing) and
   renders `<App>`.
3. `App.jsx` looks at the current URL and renders the matching **page**
   component (e.g. `/my-recipes` → `MyRecipes.jsx`).
4. That page, on mount, calls the backend via `client` (axios) — e.g.
   `client.get('/recipes')`.
5. The response data goes into component **state**; React renders the list.

### Key files

| File | What it does |
|---|---|
| `main.jsx` | The true entry point. Mounts the app and enables routing. You rarely touch this. |
| `App.jsx` | The **route table**. Each `<Route>` maps a URL path to a page component. Protected routes are wrapped in `<ProtectedRoute>` and `<Layout>` (which adds the bottom nav). When you add a page, you add a route here. |
| `api/client.js` | A single configured **axios** instance — the *only* thing that talks to the backend. It auto-attaches the JWT token to every request (request interceptor) and, on any 401 response, clears the session and redirects to login (response interceptor). Import `client` anywhere you need data. |
| `index.css` | Pulls in Tailwind and defines a couple of custom utility classes (e.g. `scrollbar-hide`). |

### `components/` — reusable pieces

| Component | Role |
|---|---|
| `ProtectedRoute.jsx` | A gate. If there's no token in localStorage, it redirects to `/login`. Wraps every authenticated route. |
| `BottomNav.jsx` | The fixed bottom navigation bar (Home, Browse, Add, My Recipes, Profile). |
| `CoverImage.jsx` | Renders a recipe's cover photo, or a styled cream placeholder with the 一世 mark when there's no photo. Shared by every screen that shows a recipe. |

### `pages/` — one per screen

| Page | Route | Purpose |
|---|---|---|
| `Login.jsx` | `/login` | Login + signup (tabs). The only public page. |
| `Home.jsx` | `/` | Greeting + recent recipes (or a welcome empty state). |
| `Browse.jsx` | `/browse` | Discovery: search, diet filters, recipes grouped by cuisine. |
| `MyRecipes.jsx` | `/my-recipes` | The logged-in user's recipe grid. |
| `RecipeDetail.jsx` | `/recipes/:id` | A single recipe — cover, story, ingredients, steps. |
| `AddRecipe.jsx` | `/add` | The create-recipe form (photo upload, ingredients, steps, story). |
| `Profile.jsx` | `/profile` | User info + logout. |

### `utils/` — non-UI logic

| File | What it does |
|---|---|
| `quantity.js` | Parses a free-text quantity ("1 1/2 cups", "a dash") into the structured fields the backend needs (value, unit, type). Keeps messy parsing logic out of the form component. |

### Conventions to follow (from `CLAUDE.md`)

- **Auth storage:** JWT in `localStorage` under `issei_token`; the user object
  under `issei_user`.
- **All API calls go through `src/api/client.js`** — never call `fetch`/axios
  directly, or you lose the token attachment and 401 handling.
- **Function components + hooks only** — no class components.
- **Tailwind only** — no UI libraries. Use the design tokens in
  `tailwind.config.js` (`cream`, `accent`, `primary`, etc.) rather than raw hex.
- **Mobile-first**, max-width 430px centered.

---

## The two halves, connected

```
Browser ──────────────── Server ──────────── Database
React app                FastAPI app          Postgres (Neon)
(frontend/)              (app/)               via SQLAlchemy
   │                        │
   │  client.js (axios)     │  routers → schemas → services → models
   └──── HTTP/JSON ─────────┘
        e.g. GET /recipes
        Authorization: Bearer <JWT>
```

- The frontend never touches the database. It only makes HTTP calls.
- The JWT (issued at login) rides along on every request so the backend knows
  who you are.
- Local dev: frontend on `localhost:5173`, backend on `localhost:8000`. CORS in
  `main.py` allows that origin to call the API.

---

## Working with Claude Code in this repo

- **CLAUDE.md** holds standing instructions and conventions Claude follows
  automatically. If you establish a new convention, putting it there makes it
  stick across sessions.
- **Backend changes that touch the database** (new/changed model fields) need an
  Alembic migration *and* application to the production database — these aren't
  automatic. Watch for them when reviewing changes.
- **Two servers must be running to use the app locally**: `uvicorn app.main:app
  --reload` (backend) and `npm run dev` in `frontend/` (frontend).
- **Verifying changes:** backend has `pytest`; frontend has `npm run build`
  (which catches syntax/import errors). There's no automated frontend test
  suite yet.
