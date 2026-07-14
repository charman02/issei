# Architecture

Issei is a full-stack app for preserving the family recipes immigrant elders
carry but never wrote down (*issei* = "first generation"). Its core is the
**living recipe** — a recipe as a vessel for a person, which grows from a seed
into a tree as it's cooked, enriched, and handed down. This file is a practical
map of how that codebase is organized and what each piece does.

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
| `models/` | **ORM models** — Python classes mapping to database tables. One file per table: `user`, `recipe`, `ingredient`, `ingredient_section`, `step` (carries `voice_note` — the person's words for that step), and the lineage tables `ghost_ancestor`, `cook_event` (carries `note` — a cook's variation), `handoff` (carries `token` — a capability secret for the invite link). |
| `schemas/` | **Pydantic models** — define the JSON shape of requests and responses, separately from the DB models. Keeps internal fields (like password hashes) from leaking to the API. |
| `routers/` | **Endpoint definitions**, grouped by domain: `auth` (signup/login/me — signup also auto-accepts pending recipe invites addressed to the new user's email), `recipes` (CRUD + scaling + browse + lineage actions: remix, cook, handoff, the `/lineage` view, plus sharing: `/recipes/shared` and `/recipes/handoffs/{id}/accept`, plus the soft-wall invite flow: `GET /recipes/invite/{token}` — unauthenticated limited preview; `POST /recipes/invite/{token}/claim` — authenticated grant claim by token), `shopping_list`, `upload` (Cloudinary photos), `mom_form` (an HTML form). |
| `services/` | **Business logic**, decoupled from HTTP. `scaling.py` (the precise/imprecise/unmeasured quantity math), `units.py` (unit conversion), `shopping_list.py` (ingredient consolidation), `growth.py` (the seed→tree growth model — `soul_count`, `growth_stage`, `growth_vitality`; stage from soul-breadth + use where **use advances only to sapling and only soul reaches tree**, vitality from repeated use), `lineage.py` (`root_of` + `effective_visibility` where the root binds descendants; `can_view`, the single read-authorization rule — public root **or** owner **or** an accepted grant on the root; and the walkable lineage-view builder). |

**Sharing model (the "Shared" tier).** Passing a recipe *is* sharing — there is no separate access-grant concept. The `handoffs` table doubles as the grant: passing a private recipe to someone creates a `Handoff` normalized to the lineage **root** (so a grant covers the whole subtree), with `state` in `pending | accepted` and a `token` (a `secrets.token_urlsafe(32)` capability secret). In-app recipients are accepted instantly; email invites stay `pending` until that address signs up (then they auto-accept). Additionally, any holder of the invite token can **claim** the grant (via `POST /recipes/invite/{token}/claim`) — this resolves the mismatched-email orphan case (an invite addressed to one email claimed by someone who signed up with another). `can_view` in `lineage.py` gates `get_recipe` and `get_lineage` on this. `GET /recipes/shared` lists a user's accepted-grant recipes; `RecipeResponse.shared_with_count` tells an owner how many people a private recipe is shared with (count only — no identities). Grantees get view + cook, but cannot edit the owner's copy or re-share.

**Soft-wall invite preview.** Before signing up, a recipient holding an invite link (`/invite/:token`) sees a *warm, limited preview* of the recipe: name, who it's from, the story, and the growth plant — never ingredients, steps, or body content. This boundary is enforced by the `InvitePreview` schema (it simply has no body fields). After signup/login, the token is claimed and the recipe becomes fully viewable.

**Models vs Schemas — the distinction that trips people up.** A *model*
(`models/recipe.py`) is the database table. A *schema* (`schemas/recipe.py`) is
the API contract. They look similar but serve different masters: the model has
every column (including ones you never expose); the schema has only what the API
should accept or return. `RecipeCreate` (what you send to create) and
`RecipeResponse` (what you get back) are different schemas for the same model.
`RecipeResponse` also includes derived growth counts (`cook_count`,
`child_count`, `has_grandchildren`, etc.) that are computed per-request in
`_attach_growth_fields`, not stored columns.

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
    │   ├── client.js       the axios HTTP client (talks to the backend)
    │   └── lineage.js      lineage endpoint calls (remix, cook, handoff, view)
    ├── components/         reusable UI pieces (used across pages)
    ├── pages/              one component per screen / route
    ├── lib/                non-UI logic (growth state, payload builders)
    ├── utils/              non-UI helper logic
    └── test/               Vitest setup
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
| `api/lineage.js` | Lineage + sharing endpoint calls (remix, cook, handoff, the `/lineage` view, `getSharedWithMe`, and `setVisibility`) built on `client`. |
| `index.css` | Pulls in Tailwind and defines a couple of custom utility classes (e.g. `scrollbar-hide`). |

### `components/` — reusable pieces

| Component | Role |
|---|---|
| `ProtectedRoute.jsx` | A gate. If there's no token in localStorage, it redirects to `/login`. Wraps every authenticated route. |
| `BottomNav.jsx` | The fixed bottom navigation bar (Home, Browse, Add, Kitchen, You). |
| `CoverImage.jsx` | Renders a recipe's cover photo, or a styled cream placeholder with the handwritten `issei` `<Wordmark />` when there's no photo. Shared by every screen that shows a recipe. |
| `Plant.jsx` | The seed→sprout→sapling→tree plant SVG (4 distinct stage shapes × bare/blooming/fruiting vitality). Props `stage`/`vitality`/`size`; reads growth from the recipe via `lib/growth.js`. Replaced the old `GrowthMark`. |
| `HandoffInvite.jsx` | Pass-it-on invite form (hand a recipe to a person / email). Copy adapts to the recipe's visibility — access-granting for a private recipe, a nudge for a public one. |
| `RecipeForm.jsx` | Shared create/edit/remix form body, reused by PlantRecipe, EditRecipe, and RemixRecipe. |
| `Wordmark.jsx` | The handwritten `issei` wordmark (Caveat). |
| `Provenance.jsx` | The provenance line — `🌱 <origin> → <keeper>` — built from the recipe's `origin_attribution` + `author_full_name` (no tree/network needed; reads at 1 node). |
| `Icon.jsx` / `IconField.jsx` | The line-icon set and a labeled input field. |
| `SectionHeader.jsx` | A titled section header. |

### `pages/` — one per screen

| Page | Route | Purpose |
|---|---|---|
| `Login.jsx` | `/login` | Login + signup (tabs). The only public page. |
| `Home.jsx` | `/` | Greeting + recent recipes (or a welcome empty state). |
| `Browse.jsx` | `/browse` | Discovery: search, diet filters, recipes grouped by cuisine. |
| `MyRecipes.jsx` | `/my-recipes` | The Kitchen — **a garden of your recipe-plants grouped into growth bands** (Needs tending → Growing → Thriving, via `lib/gardenBands.js`); empty bands are omitted, and searching collapses to a flat grid. Links to "Shared with you". |
| `SharedWithMe.jsx` | `/shared` | Recipes others have passed to the user (accepted grants only; no accept UI). |
| `RecipeDetail.jsx` | `/recipes/:id` | The **living recipe page** — three registers of voice: the framing **story** leads; each step's `voice_note` renders as a woven **quote** (Caveat hand) beneath it; **imprecise measures** are tagged "their way" (via `lib/measures.js`), never normalized. Plus a `<Provenance>` line (🌱 origin → keeper), the growth `<Plant>`, and — for the owner when there's no story yet — a warm "add a memory" invitation (empty-state). Owner also sees "Shared with N" + "Pass it on". |
| `PlantRecipe.jsx` | `/add` | Stepped plant-a-recipe flow: choose a doorway (ghost ancestor vs. self-authored root) → RecipeForm (with a soul-invitation framing line — only a name is required) → **planted beat** that launches the growth loop (shows the recipe's real computed stage — a recipe planted with an origin/story is born a sprout, not a seed — and invites the three nourishing acts: cook it · add its story · pass it on, via `lib/plantedBeat.js`) → HandoffInvite. The beat's secondary CTA lands on the new recipe page. |
| `EditRecipe.jsx` | `/recipes/:id/edit` | Edit an existing recipe (shared RecipeForm). |
| `RemixRecipe.jsx` | *(unrouted)* | Dormant: remix is cut from the v1 surface (spec §0.1). The page, `buildRemixInitialValues`, `remixRecipe`, and the backend `/remix` endpoint remain on disk so remix is a cheap UI revival, not a re-architecture. |
| `InviteLanding.jsx` | `/invite/:token` | **Public** soft-wall: a warm preview of a handed-off recipe (name, who it's from, story, plant — never the body) via the unauthenticated preview endpoint, then a signup-to-participate gate that carries the token to Login. |
| `Profile.jsx` | `/profile` | User info + logout. |

(`AddRecipe.jsx` and `RemixRecipe.jsx` still exist on disk but are no longer routed — `/add` maps to `PlantRecipe`, and remix is cut from the v1 surface per spec §0.1. Both are dormant-but-revivable.)

### `lib/` — non-UI logic

| File | What it does |
|---|---|
| `growth.js` | `stageForRecipe` / `vitalityForRecipe` — read the server-computed `recipe.growth_stage`/`growth_vitality` (source of truth), with a client fallback that mirrors `app/services/growth.py` exactly. Replaced the old `growthState.js`. |
| `measures.js` | `isImprecise` / `impreciseLabel` — flags imprecise/unmeasured ingredient amounts so the recipe page tags them "their way" (celebrated as fidelity, never normalized). |
| `plantedBeat.js` | `plantedBeatCopy(recipe, sourceName)` — the copy for the capture flow's "planted!" beat, derived from the recipe's real growth stage (server-first via `growth.js`) + the source's name. Names the three growth-loop acts. |
| `handoffStarters.js` | `HANDOFF_STARTERS` (two starter objects: fill-in + sharing) and `defaultStarterKey(sourceName)` — logic for the one-tap note starters + the safe auto-touch when passing back to the recorded source. |
| `sourceName.js` | `sourceNameOf(recipe)` — extracts the recorded source's name from `origin_attribution` (leading segment before `·`). Used to trigger the auto-preselect on HandoffInvite. |
| `gardenBands.js` | `gardenBands(recipes)` — groups a recipe list into ordered growth bands (tending/growing/thriving) by `stageForRecipe`, omitting empty bands. The data behind the Kitchen-as-garden view. |
| `lineagePayload.js` | Builds the remix/plant request payloads sent to the backend. |

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
- **Verifying changes:** backend has `pytest`; frontend has Vitest + React
  Testing Library — run `npm test` (`vitest run`) in `frontend/`. `npm run
  build` still catches syntax/import errors.
