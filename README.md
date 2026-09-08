# Issei

**Live app:** https://issei.app · **API:** https://api.issei.app · **Source:** https://github.com/charman02/issei

## What It Is
Someone cooked you something you'd never had before, and you asked for the recipe. **Issei is how they send it to you** — not a scrubbed list of grams, but the dish the way they actually make it, with the parts that are "a good splash" left as "a good splash," and their notes on the steps that matter. They write it down once; you get a link and read the whole thing without making an account.

The name is the reason it's built this way: *Issei* (一世) means "first generation" — the first of a family to arrive somewhere new, and usually the one who never wrote any of it down. The recipe app market splits into utility organizers (Paprika, AnyList) and legacy archives (StoryWorth, "heirloom cookbook" products), and **both assume you already know the dish.** Nobody is built for the person who has never tasted it. See [POSITIONING.md](POSITIONING.md).

So a recipe here is attributed to a **person** — the dish is the title, the person is the byline ("from Lola") — and their imprecise measurements ("a dash," "three soup spoons," "until it smells right") are preserved verbatim and celebrated as fidelity rather than normalized away. The knowledge that an ingredient list can't hold lives as a note on the individual step it belongs to. The UI is a warm, playful "kitchen": bold color-block stickers, chunky display type, and food-forward illustration, mobile-first.

**Getting a recipe in is meant to feel like telling someone how you make it.** The primary way to add a recipe is to paste (or dictate) the whole thing as one blob — "you need about a kilo of pork belly, a good splash of fish sauce, simmer till it smells right" — and a language model structures it into title, ingredients, and steps, which you then correct before saving. Two guarantees make this safe rather than lossy: **amounts come back verbatim** ("a good splash" stays "a good splash"; the app re-classifies every amount with its own parser, so the model can't quietly normalize "a kilo" into "1000 g"), and **the feature is optional** — with no API key the endpoint reports itself unavailable and the client falls back to a local line-based parser, so recipe capture never depends on a third party being up. Every text field on the form also supports **speak-to-type dictation** via the browser's own speech-to-text: the microphone types characters into the field you can see and edit — **no audio is recorded, stored, or sent anywhere** — and when you finish a field the cursor advances to the next one, so a whole recipe can be filled by voice with a tap between fields. "Write a recipe" lands directly on this paste-or-dictate screen ("Add it your way"); if you'd rather not paste, a "Rather fill in the form?" link at the bottom opens the plain field-by-field form. Either way it's the same editable draft before it saves.

Under the hood that's a full CRUD REST API with JWT auth, a domain-driven fuzzy-quantity model, serving-size scaling that refuses to invent precision, photo upload (with automatic iPhone HEIC → JPEG conversion), and a capability-token sharing system layered over a concrete visibility model. A profile is public or private (private by default); each recipe or post is set to "Everyone" (public), "Friends only" (friends), or "Only me" (private) — new items default to "Friends only", or "Everyone" on a public profile. The chosen value is stored literally and fixed once chosen, so a label never silently changes if the profile later changes.

**Stack at a glance:** React + Vite + Tailwind SPA (Vercel) → FastAPI + SQLAlchemy REST API (AWS ECS Fargate) → PostgreSQL (Neon). JWT auth, 58 endpoints, 15 data models, 1153 automated tests (448 pytest + 705 Vitest).

## Tech Stack
**FastAPI** - automatic request validation via Pydantic, auto-generated /docs page for testing, and async-ready. Faster to build with than Flask for the backend API.

**SQLAlchemy** - ORM that maps Python classes to database tables. Lets me write queries in Python while being database-agnostic - same code runs on SQLite locally and Postgres in production.

**Alembic** - versioned database migrations that track schema changes across environments. Works natively with SQLAlchemy.

**Pydantic** - data validation and serialization at the API boundary. Separating request/response schemas from database models prevents accidentally leaking sensitive fields like hashed passwords.

**PostgreSQL (Neon)** - production database. Handles concurrent writes reliably, unlike SQLite. Hosted on Neon's free tier.

**bcrypt** - industry-standard password hashing. Deliberately slow to resist brute-force attacks; includes automatic salting to defeat rainbow table attacks.

**python-jose** JWT creation and verification for stateless authentication. Tokens are signed with a secret key and include expiry - no server-side session storage needed.

**pytest** - backend tests (448) for the scaling service and its folk-unit vocabulary, and the authorization surface (visibility, sharing/grants, blocking, the invite-token flow, the invite link-preview card, the source/cuisine autosuggest scope, the friend graph, signup + account-edit validation).

**Vitest + React Testing Library** - frontend unit/component tests (705 in 50 files: quantity parsing, imprecise-measure labelling, handoff/invite flows, form and page components, plus design-token invariants). Run with `npm test` in `frontend/`.

**Cloudinary** - hosts recipe photos and profile pictures uploaded through the `/upload` endpoint.

**React + Vite + Tailwind CSS** - the frontend single-page app (`frontend/`), with **axios** for API calls and **React Router** for client-side routing. Mobile-first, talks to the backend over HTTP.

**AWS ECS Fargate + Vercel** - the two deployment platforms. The FastAPI backend runs on **AWS ECS Fargate** behind an Application Load Balancer, served over HTTPS at `api.issei.app` (Route53 + ACM). The React SPA auto-deploys to **Vercel** on every push to `main`. The frontend reaches the backend via a build-time `VITE_API_URL` env var, and the backend's allowed CORS origins are env-driven — so hosts can change without a code edit. See [`infra/README.md`](infra/README.md) for the architecture.

## Key Engineering Decisions
**Fuzzy quantity modeling:** Ingredients store both `quantity_text` (always preserved verbatim) and optional `quantity_value` and `unit` fields, with a `quantity_type` of "precise", "imprecise", or "unmeasured". The alternative was storing only exact measurements, but Asian home cooking rarely uses precise quantities — "a dash of fish sauce" and "3 soup spoons" are how recipes are actually passed down. The three-type model lets the scaling service handle each case appropriately: precise quantities scale mathematically, imprecise quantities scale approximately, unmeasured quantities don't scale at all.

Classification is deliberately not just hedge-word detection ("about", "roughly", "~"). It also recognizes **folk, body, and vessel units** — "3 soup spoons", "a pinch", "a good splash", "two fingers of water" — because a clean number in front of a fuzzy vessel is still a fuzzy amount. Those split further at scale time (`app/services/folk_units.py`): a *countable* folk unit has a real count, so "3 soup spoons" doubled honestly is "6 soup spoons"; a *non-linear* one describes a geometry rather than a quantity, so "3 fingers of water" is kept verbatim and the cook is handed the multiplier instead of an invented number. Without this, the app's own headline example would be normalized into "7.5 soup spoons" — exactly the behavior it exists to refuse.

**An LLM that structures, but is never trusted to measure.** The primary way to add a recipe is to paste or dictate the whole thing as free text; `POST /recipes/parse` (`app/services/recipe_ai.py`) sends it to a small, cheap model (OpenRouter, `deepseek/deepseek-v4-flash-0731` by default) under a strict JSON schema and gets back title/ingredients/steps. The interesting constraint is what the model is *not* allowed to do: every amount it returns is re-classified by the app's own parser (`app/services/quantity.py`, sharing the folk-unit vocabulary above), so if the model "helpfully" turns "a good splash" into "30 ml" the app overrides it back — the model splits text, it does not get to measure. Any ingredient whose name the model didn't ground in the source text is dropped, to stop it inventing plausible-but-absent ingredients. And the whole layer is **optional by construction**: with no `OPENROUTER_API_KEY` the endpoint returns `ai: false` and the client falls back to a deterministic local parser, so recipe capture can never be broken by a third-party outage. Dictation on long fields is the browser's own speech-to-text — it types characters into a text field the user can edit; **no audio is recorded, stored, or transmitted** (see [POSITIONING.md](POSITIONING.md), which lists "voice"/"recording"/"in their own words" as banned false claims).

**Denormalized `recipe_id` on ingredients:** Ingredients store `recipe_id` directly even though they could derive it through `section_id → ingredient_sections → recipe_id`. This is a deliberate denormalization. Without it, fetching all ingredients for a recipe requires a join through sections — and sectionless ingredients (where `section_id` is null) would be unreachable entirely. The direct `recipe_id` makes the common query simple and fast: `WHERE recipe_id = ?`.

**Single transaction with `db.flush()` for mid-transaction IDs:** Creating a recipe with nested ingredients and steps happens in a single database transaction — all inserts succeed or all are rolled back. Within that transaction, `db.flush()` is called after creating the recipe and each ingredient section to get their auto-generated IDs without committing. Those IDs are then set on child rows (`recipe_id`, `section_id`) before the final `db.commit()`. Without `flush()`, the IDs wouldn't exist in Python yet and the foreign key assignments would fail.

**Soft delete:** Recipes are soft-deleted by setting a `deleted_at` timestamp rather than removing the row. Hard delete was simpler to implement, but losing a family recipe permanently is unacceptable for this use case. All queries filter `WHERE deleted_at IS NULL`, and recovery is possible by clearing the timestamp.

**JWT stateless auth:** Authentication uses JWT tokens rather than server-side sessions. Sessions require storing state on the server and a session store (like Redis), which adds infrastructure complexity. JWTs are self-contained — the token encodes the user ID and expiry, and any server instance can verify it using just the secret key.

**Deleting features that fought the premise.** Two systems were built, shipped, and then removed on purpose, which is the decision I'd most want to be asked about.

A *consolidating shopping list* summed ingredients across recipes. Summing means normalizing amounts, which is exactly what this app exists to refuse — on its most common data it produced `"a good splash + a glug"`, which is not a total, just two lines concatenated. It also depended on a hand-maintained density table that only ever grew when someone noticed a wrong number, and because no screen ever called it, a crash, several wrong totals, and an inverted conversion ratio all lived in it undetected. Deleted along with `services/units.py`, rather than polished.

A *lineage tree* modeled recipes as a generational graph (`parent_recipe_id`, a `ghost_ancestors` table, root-bound visibility, a `/lineage` endpoint). The product is a bridge between two people — one dish, handed to one person — not a family network, and the tree was carrying architectural weight for a story the app wasn't telling. Removing it collapsed authorization from "walk to the lineage root, then match grants against that root" to a single statement about the recipe in front of you (`can_view` in `app/services/sharing.py`). The simplification was verified safe against production data first: zero recipes had a `parent_recipe_id`, so `root_of()` was already the identity function on every real row and no authorization outcome could change. The one piece kept was `origin_attribution` — the "from Lola" byline — because attribution is a fact about one recipe, not an edge in a tree.

**Validation at the boundary, error copy in one place.** A person's name is load-bearing here — every recipe carries a byline — so `UserCreate` (`app/schemas/user.py`) strips whitespace and then requires one character, which rejects `""` and `"   "` with the same rule; password length is capped at 72 bytes because that's bcrypt's own ceiling and anything longer is silently truncated. The rules live on the *input* model only: tightening `UserResponse` too would turn an already-stored blank name into a 500 on read, punishing an old account for a rule it predates. On the client, `toUserMessage` in `frontend/src/api/client.js` is the single funnel that turns any axios failure into a sentence — a FastAPI 422 arrives as an array of objects, and rendering it raw once put `[object Object]` in front of a user who had simply chosen a short password. It reports every failing field rather than the first, and distinguishes "no response at all" (offline) from "the server said no", so a user on a dead connection isn't told their password is wrong.

## API Endpoints
| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| GET | /health | No | Liveness check. Returns `{"status": "ok"}`. |
| GET | /health/ready | No | Readiness probe (DB check). |
| POST | /auth/signup | No | Creates a new user account. Returns id, email, and created_at. |
| POST | /auth/login | No | Verifies credentials and returns a JWT access token. |
| POST | /auth/forgot-password | No | Request password reset email. |
| POST | /auth/reset-password | No | Set new password with reset token. |
| GET | /auth/me | Yes | Returns the currently authenticated user. |
| PATCH | /auth/me | Yes | Edits the account: name, email, password, profile picture (`photo_url`), and/or profile visibility (public/private). Email and password changes require the correct current password; a name, photo, or profile-visibility change doesn't. Also accepts `apply_visibility_to_all` (`public`/`friends`/`private`) — a bulk sweep that sets **every** one of the caller's recipes and posts to that concrete value in one action (the "make everything public" / "make everything friends-only" confirm dialog). Email must be unique. Returns the updated user. |
| DELETE | /auth/me | Yes | Delete account (requires password). |
| POST | /recipes | Yes | Creates and returns a new recipe. |
| GET | /recipes | Yes | Returns the current user's recipes. |
| GET | /recipes/{recipe_id} | Yes | Returns the queried recipe. |
| GET | /recipes/{recipe_id}/scale?servings={n} | Yes | Returns the recipe scaled to the target serving size. |
| PATCH | /recipes/{recipe_id} | Yes | Modifies the queried recipe. |
| DELETE | /recipes/{recipe_id} | Yes | Deletes the queried recipe. |
| POST | /recipes/{recipe_id}/cook | Yes | Logs a cook event; returns updated cook_count. |
| POST | /recipes/{recipe_id}/handoff | Yes | Passes the recipe on (owner only). A recipient is **optional**: with an in-app user or an email the grant is addressed to them; with neither it is "link-only" — it mints a shareable invite token the sender passes along however they already talk to that person. On a **private** recipe the grant confers access (view + cook, never edit). |
| GET | /recipes/shared | Yes | Returns recipes shared *with* the current user (accepted grants; excludes their own). Superseded in the UI by `/recipes/kept`, which merges these with kept ones. |
| GET | /recipes/kept | Yes | The **Kept shelf** (#57): recipes in the caller's kitchen that aren't theirs — ones handed to them (accepted grants) merged with ones they kept — each re-checked through `can_view` on every read. Also returns `unreachable_count`: how many shelf entries the caller can no longer open because the cook restricted or deleted them, as a bare number (never a dish name). |
| POST | /recipes/{recipe_id}/save | Yes | **Keep** a recipe you didn't write — a bookmark, not a copy. Gated on `can_view`, so you can only keep what you can already read and keeping can never widen access; 404 otherwise, 400 on your own recipe. Idempotent (UNIQUE(user, recipe)). |
| DELETE | /recipes/{recipe_id}/save | Yes | Stop keeping. Touches only the caller's own bookmark — never the cook's recipe, never another keeper's shelf, and never a handoff grant someone gave you. |
| GET | /recipes/users/{user_id} | Yes | A user's recipes for their profile grid, visibility-gated by `can_view`: own → all; a friend → their `public` + `friends` recipes; a non-friend → `public` only (never a `private` one, and never one merely handed to you — that's in `/recipes/shared`). Empty list, not 404, if nothing's visible. Mirrors `GET /posts/users/{id}`. |
| POST | /recipes/handoffs/{handoff_id}/accept | Yes | Claims a pending invite for the current user (backend-only; the two auto-accept paths cover the in-app cases, so there is no MVP UI for this). |
| GET | /recipes/invite/{token} | No | Unauthenticated read of a handed-off recipe — the **full** recipe (ingredients, steps, per-step remarks, story, servings, description), no account required. The owner's private `notes` and account ids are the only things withheld. |
| POST | /recipes/invite/{token}/claim | Yes | Claims an invite by its token, granting the current user access (resolves the mismatched-email case). |
| GET | /recipes/invite/{token}/preview | No | Link-preview (OpenGraph) HTML for a shared invite, so it unfurls in iMessage/Slack showing the actual recipe (name, byline, cover photo). Crawler-only (Vercel routes bot user-agents here); humans meta-refresh to the invite page. Bad token → an honest "expired" card, never a 5xx. |
| GET | /recipes/browse | No | Public discovery feed: shows recipes whose `visibility` is `public`. `friends` and `private` recipes never appear. Readable with **no account** — but the viewer is resolved *optionally* (`get_current_user_optional`), so a signed-in reader also has recipes by anyone they're blocked from either way excluded. This was the one public surface a block couldn't otherwise reach. |
| POST | /upload/recipe-photo | Yes | Uploads a photo to Cloudinary (recipe cover or a step). |
| POST | /upload/avatar | Yes | Uploads a profile picture (square face-centered crop). Returns the Cloudinary URL; saved via PATCH /auth/me. |
| POST | /feedback | Yes | Files a feedback note from inside the app. |
| GET | /feedback | Yes | Returns **only the caller's own** notes. |
| GET | /recipes/ingredient-suggestions | Yes | The caller's own ingredient vocabulary, for autosuggest. |
| GET | /recipes/field-suggestions | Yes | The caller's own past "passed down from" names and cuisines, for the recipe-form autosuggest. Same self-scoping as ingredient-suggestions — never another user's values. |
| POST | /recipes/parse | Yes | Structures a spoken/pasted recipe into fields via an LLM (OpenRouter). Saves nothing — returns a draft the client shows for correction. Amounts come back verbatim and are re-typed server-side, never converted. Returns `ai: false` (client falls back to a local parser) when the model is unavailable, so `/add` keeps working with no key. |
| POST | /friends/request | Yes | Send a friend request (symmetric — both must accept). Idempotent per pair; a reverse pending request resolves to an accepted friendship. |
| POST | /friends/{id}/accept | Yes | Accept a pending request — **addressee only**. |
| DELETE | /friends/{id} | Yes | Unfriend, decline, or cancel — either party. |
| GET | /friends | Yes | The caller's accepted friends. |
| GET | /friends/requests | Yes | Pending requests addressed to the caller. |
| GET | /friends/suggestions | Yes | People to friend, seeded from the caller's handoff graph (whom they've handed a recipe to / received one from), never strangers. |
| GET | /friends/discover | Yes | Everyone else on the app, with an optional `?q=` name search (server-side, so it reaches past the on-screen page, which is capped at 50). Excludes you, your **accepted** friends (they're in `GET /friends`) and anyone in a block relationship. Someone the caller has ASKED deliberately STAYS on the list, carrying `friend_state` (`none` \| `requested`) so the row reads "Requested" — a person vanishing the instant you tap Add reads as "did that work, or did I just remove them?", which a real user reported. An INCOMING request is hidden instead: it already appears in `GET /friends/requests`, which the Friends page renders above this section, so listing it here too showed one request twice with two live Accept buttons. The 50-row cap applies only to people you could still ADD — anyone you asked is returned outside it, so the cap and the label can never contradict each other. Name + photo only: **email is deliberately unsearchable**, so the directory can't be probed as an address book. Not gated on `profile_visibility` (that field is never consulted at read time and is private by default, which would leave the list empty). |
| GET | /friends/profile/{user_id} | Yes | A user's read-only profile: name, their `profile_visibility` (public/private), the caller-side friend state, counts of their recipes and posts **the caller may see** (each gated by the same `can_view` / `can_view_post` rule), and their `friend_count` (a symmetric public number — **not** caller-gated). |
| POST | /friends/blocks | Yes | **Block someone** (#85). From then on the pair is mutually invisible: neither appears to the other in the people directory, Browse, the everyone-feed, each other's profile, each other's posts and recipes, or each other's friend suggestions, and neither can send a friend request or ask the other for a recipe. Also **deletes the friendship** either way and drops pending recipe-asks both ways; unblocking restores none of it. An accepted handoff grant deliberately **survives** — you gave them that recipe — but no *new* grant can cross a block. Idempotent: 204 either way, so the response says nothing about prior state. 400 on yourself, 404 on an unknown user. |
| GET | /friends/blocks | Yes | People **the caller has blocked**, newest first — their own list, so they can undo it. Deliberately **never** who has blocked *them*: that isn't information they're entitled to, and it would turn a protection into a notification. This list is also the only route back, since a blocked person's profile 404s. |
| DELETE | /friends/blocks/{user_id} | Yes | Unblock — removes only the caller's **own** block row, so if the other party blocked them too the pair stays invisible. Does not restore the deleted friendship. 204 whether or not a row existed. |
| POST | /posts | Yes | Share a meal: `photo_url` + `dish_name` required, an optional `description`, and an optional `recipe_id` — linkable **only** to a recipe the caller owns and hasn't deleted. Not a recipe (no ingredients/steps). |
| GET | /posts/feed | Yes | *(Every post response also carries `requested_by_me` — per-viewer — `request_count`, which is **author-only and `None` for every other viewer** (see #79 above and POSITIONING's fourth invariant), and `is_new` (#97), set on the **feed only** and `None` — never `False` — everywhere else, so a client can tell "not new" from "this surface has no concept of new". `is_new` is a FLAG, never a filter: the same posts come back either way and nothing expires.)*  The presence feed, newest first, keyset-paginated via `?before_id=` (a cursor on post `id`, page size 30). `?scope=friends` (default) = the caller's accepted friends' posts plus their own; `?scope=everyone` = **public** posts from people the caller is *not* friends with (discovery — scoped in SQL to `visibility == "public"`, no overlap with the friends scope). No like button, ever. A linked `recipe_id` the viewer can't read (private/soft-deleted) is nulled out so "See the recipe" never dead-ends. |
| POST | /posts/feed/seen | Yes | **Advance the caller's feed read-mark** (#97). Body `{through_post_id}` = the newest post the client received (required in practice; omitted it is a deliberate **no-op**, because marking "everything that exists" would watermark past strangers' and blocked users' posts and suppress `is_new` for a backlog the caller has never been shown). The id is **clamped** to the newest existing post: the column is `int4` on Postgres, so an oversized value is a 500 there and invisible on SQLite, and since the mark is forward-only one such call would otherwise leave that account permanently unable to see anything as new. Stores an **id**, not a timestamp — `created_at` is second-granular on SQLite, so a post made in the same second as the mark would never be flagged new; ids are monotonic. **Forward only**, so a retry or a second tab can't rewind it and resurface read posts. Separate from the feed GET on purpose: a read that mutates marks things seen on a prefetch or a retry. Marks nothing as deleted — `is_new` is a flag, never a filter. 204 always; an unknown id is not confirmed either way. |
| GET | /posts/browse | Yes | Public posts for Browse discovery (the post counterpart of `/recipes/browse`): every post with `visibility == "public"`, newest first, capped at 30, with an optional `?q=` dish-name search. Unlike the everyone-feed scope it includes the caller's own and friends' public posts. Same recipe-link nulling as the feed. |
| GET | /posts/{post_id} | Yes | A single post — visible to its author, a friend of the author, or **anyone** on a public post (that's how a public meal opens from Browse); a viewer not entitled gets 404 (don't confirm it exists). Same recipe-link nulling as the feed. |
| DELETE | /posts/{post_id} | Yes | Delete a post — **author only** (read is not write); a non-author or unknown id gets 404. |
| GET | /posts/users/{user_id} | Yes | A user's posts for their profile grid — friend-or-own gated; a non-friend gets an empty list (the profile is public, its posts are not). Same recipe-link nulling as the feed. |

| POST | /posts/{post_id}/request | Yes | **Ask the cook for the recipe** behind a meal (#79) — the app's premise as a mechanic. Open to **anyone who can already see the post** (`can_view_post`), deliberately *not* friends-only: #71 put public meals in Browse so a stranger could find your dish, and a dead end there would undo that. Only where the caller can't currently read a recipe for it — `recipe_id` arrives nulled when unreadable, so "never written down" and "written but kept private" are one indistinguishable state and the button leaks nothing either way. 400 on your own post. Idempotent (UNIQUE(post, requester)); re-opens a fulfilled row rather than dying silently; notifies the cook, deduped while unread. |
| DELETE | /posts/{post_id}/request | Yes | Take back your ask. Removes only the caller's own **pending** row — a fulfilled request is the record that a recipe was handed over. The cook's notification is deliberately kept: they were told something true. |
| GET | /posts/requests/incoming | Yes | **The cook's asks**: every post of *theirs* with ≥1 pending request, and who asked. Scoped to `Post.user_id == caller` — the only place a request count or a requester's name is ever returned, which is what keeps them off every public surface. |
| POST | /posts/{post_id}/fulfill | Yes | Answer the asks on your own post with one of your own recipes. Delivery is the **existing handoff grant** — one `Handoff(state='accepted')` per pending requester — so a **private** recipe reaches the people who asked **without its visibility changing**, and it lands on their Kept shelf. Author-only and own-recipe-only (a `user_id` filter, not `can_view`: read is not write). Idempotent; also attaches the recipe to the post. |
| GET | /notifications | Yes | The caller's inbox — issei's first notification surface. Newest first, keyset-paginated on `?before_id=` (page 30), returning `{notifications, unread_count}` so the badge can't drift from the rows. Scoped to `user_id == caller`. Four types: `recipe_request`, `request_fulfilled`, `friend_request`, `friend_accept` — friend events were retrofitted onto the same inbox rather than getting their own counter. A row whose post or recipe was deleted (FK `SET NULL`) comes back without a link; the line still reads. |
| POST | /notifications/read | Yes | Mark read — all of the caller's, or just the ids given; always caller-scoped, so passing someone else's ids marks nothing. Returns the refreshed list, so no second call to update the badge. |
*58 application routes on this branch — the table is the whole product surface. Counts have changed several times as features were added and removed, so verify rather than trust: `grep -rn "^@router\.\|^@app\." app/` (router decorators + `GET /health`, declared on the app itself in `app/main.py`).*

**Visibility — a concrete three-value setting per item, plus a profile that picks the default.** Each **recipe or post** carries its own `visibility`, one of three literal values: `public` (anyone can read it; eligible for Browse), `friends` (the owner's accepted friends only), or `private` (only the owner — plus, for recipes, accepted handoff grantees). New items default to `friends`. The value is **stored literally** — a label like "Friends only" means friends only, permanently. A recipe is viewable when: **nobody has blocked anybody** (a block in either direction makes the pair invisible to each other, and it is checked *before* `public`, so a block beats even a public recipe) **and** they own it, **or** it's `public`, **or** it's `friends` **and** the viewer is an accepted friend of the owner — **or** they hold an accepted handoff (grant) on it. The handoff grant is **orthogonal** — a grantee reads the one recipe handed to them whatever the visibility or friendship says, **and that survives a block**: you genuinely gave them that dish, so blocking stops new contact rather than un-sending what was already handed over. (No *new* grant can cross a block, though.) In-app grants are accepted instantly; email invites are pending until the invitee signs up with the matching email, at which point they auto-accept. `can_view` (recipes) and `can_view_post` (posts) in `app/services/sharing.py` are the single read-authorization rules every read funnels through, sharing one truth table (`_resource_is_visible`).

The **profile** (`User.profile_visibility`, `public` or `private`, **private by default**) is **not consulted at read time**. It does two things only: (a) it picks the default the create form auto-selects for a new item — "Everyone" on a public profile, "Friends only" on a private one — and (b) it drives an optional bulk sweep. Flipping the profile therefore changes **nothing** already stored. The sweep is `PATCH /auth/me` with `apply_visibility_to_all`: it sets every one of the caller's recipes and posts to one concrete value in a single action, offered by the Profile-page confirm dialog in both directions ("make everything public" when opening the profile, "make everything friends-only" when closing it). **Read is not write:** editing and deleting stay owner-only, enforced by a `user_id` filter in `patch_recipe`/`delete_recipe` — a grantee can read and cook a recipe they were handed, never change someone else's record of it.

**The invite token is a capability.** The visibility rules above govern *accounts*; a handoff link is a separate axis. `secrets.token_urlsafe(32)` is unguessable, and holding it is the permission to read — so `/recipes/invite/{token}` serves the whole recipe with no account at all. The recipient of a handoff has never tasted the dish and wants to cook it, so gating ingredients behind a signup form would be friction at the moment of highest intent. Signing up is what lets them *keep* it (save and cook it) — never edit or add to it, which is owner-only — not what lets them read it.

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
- **App (React frontend):** https://issei.app — sign up and it works end to end: create a recipe (with a photo), keep it in your kitchen, scale it, pass it on. The handoff link opens the full recipe with no account, which is the path worth trying.
- **API (FastAPI, interactive Swagger docs):** https://api.issei.app/docs — every endpoint is callable in-browser.

**Deployment:** the frontend is hosted on **Vercel** (static SPA build, auto-deploys
on push to `main`). The backend runs on **AWS ECS Fargate** behind an Application
Load Balancer, served over HTTPS at `api.issei.app` (Route53 + ACM), backed by a
**Neon** PostgreSQL database. Deploys go out via a GitHub Actions → OIDC pipeline
(no long-lived AWS keys) on push to `main`, gated by an Alembic migration step so a
bad migration blocks the release before the service is touched. CORS origins are
env-driven so the frontend host can change without a code edit. See
[`infra/README.md`](infra/README.md) for the architecture and
[`infra/RUNBOOK.md`](infra/RUNBOOK.md) for the exact deploy steps.
