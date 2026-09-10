# Implementation plan: the social presence feed (issei #62)

> **HISTORICAL PLANNING RECORD — do not read the per-phase stamps below as current state.**
> Last reconciled with the code 2026-09-10. Phases 0, 1a, 1b and 2 shipped (friend graph and
> minimal profiles; posts and the friends feed, which became Home; concrete per-item
> visibility; the request → fulfil loop with notifications), and so did work this plan never
> anticipated: the Kept shelf (#57), blocking (#85), reporting (#87), the people directory (#80),
> the feed read-mark (#97), post editing (#98), a cook-only keeper count (#96), field ceilings
> (#100) — and **push notifications with a PWA shell (#89), which this plan repeatedly assigned to
> "the native phase"**.
>
> Two things stamped "BUILT" below were later **UN-SHIPPED by #94** and must not be described
> as features anywhere: the feed's **friends/everyone toggle** (#70) and Browse's **Meals tab**
> (#71). The endpoints survive — `?scope=everyone` is now the client's cold-start
> fall-through, and `GET /posts/browse` has no caller at all — but the user-facing controls
> are gone. `POSITIONING.md` is the authority when this file disagrees with it, and `README.md`
> is the authority on what the API does today.
>
> Kept as-is otherwise, deliberately: this is the record of what was planned and in what
> order, which is worth more intact than retro-edited. Each phase was independently
> shippable, got its own ship-review + docs gate, and was a "stop and ask" item per the
> autonomy policy in `TESTING.md`.

## Guiding constraints (carried from the design)

- **Symmetric friends** (both accept). **Friends-only feed** (no public/global feed).
  *(Superseded 2026-08-19 — see Direction update: the feed gains a friends/everyone
  toggle. "No like button" and symmetric friends stand.)*
- **Extension, not replacement** — handoffs, recipes, invite/OG, Cloudinary all reused.
- **Web-first**; native iOS is a later amplifier, not a prerequisite.
- **No like button** — the recipe-request is the only "reaction."
- **Reuse the handoff grant machinery** for the request→fulfill loop.
- Every new endpoint pins auth + scope (TESTING.md invariants 1–3); every new
  surface respects POSITIONING (invariants 5–6). New models → migration replays on
  SQLite (invariant + `test_migrations.py`).

## Direction update (2026-08-19, post-Phase-1a review)

Six product decisions from the user after Phase 1a shipped/staged. **Direction, not
built** — recorded here so the later phases build the right thing — **except #2
(profile visibility), now BUILT/shipped in #68.** Where one revises an earlier "locked"
line, the revision wins and the older text is annotated in place.

1. **Kitchen tab holds recipes AND posts.** "Your kitchen" becomes the one place a user
   sees both their own recipes and their own past posts. And a friend viewing your
   profile/kitchen sees both your recipes and posts (subject to the visibility rule in
   #2). Reshapes `MyRecipes` and `UserProfile` into a two-section (or tabbed) view.
2. **Profile-level public/private, with a concrete per-item visibility.** *(BUILT/shipped
   in #68.)* This *replaces* the plan's per-recipe `private | friends | public` 3-tier
   model (see "The visibility change" section — now superseded) **and** the earlier
   inherit/live-follow/`force_*` design once sketched here. The model, as shipped:
   - A **profile** (`User.profile_visibility`) is `public` or `private`. **Default:
     private** (the app's spine is the intentional handoff; public is the opt-in, or the
     app drifts toward "broadcast + browse" and weakens the request loop).
   - **Each item's `visibility` is a concrete literal, not a pointer to the profile:**
     `public | friends | private`. There is **no `inherit`** and no live-follow. New
     items default to `friends` (schema-level); `Post`'s DB `server_default` is
     `"friends"` and `Recipe`'s stays `"private"` as a bypass safety net. A label like
     "Friends only" therefore means friends only, permanently — it never silently changes
     when the profile changes.
   - **The profile is NOT consulted at read time.** It does exactly two things: (a) it
     picks the default the create form auto-selects for a new item (mid-post, #81, the post's own visibility does instead) ("Everyone" on a public
     profile, "Friends only" on a private one), and (b) it drives the bulk sweep below. So
     **flipping the profile changes nothing already stored.**
   - **Rescoping existing items is the bulk sweep, not a profile flip.** `PATCH /auth/me`
     accepts `apply_visibility_to_all` (`public | friends | private`) and sets **every** one
     of the caller's recipes and posts to that one concrete value in a single action. It's
     offered by the Profile-page confirm dialog in both directions ("Make everything
     public" when opening the profile, "Make everything friends-only" when closing it); the
     other dialog option leaves existing items untouched. This is the only thing that
     rescopes what's already there, and it always writes a concrete value to every row.
   - **Applies symmetrically to BOTH `Post` and `Recipe`:** a post (or recipe) can be
     `public` while its author's profile is private — that's how a private user surfaces one
     meal into the eventual "everyone" feed (#3) / Browse (#4) without opening their whole
     profile.
   - **`can_view` (recipes) and `can_view_post` (posts) share one truth table**
     (`_resource_is_visible`, one rule per resource type): `owner OR visibility=='public'
     OR (visibility=='friends' AND are_friends) OR accepted handoff grant`. **The handoff
     grant stays orthogonal** — a grantee reads the one recipe handed to them regardless of
     visibility or friendship; it's checked only for recipes, and only after the visibility
     rule says no. `effective_visibility` returns the recipe's own concrete `visibility`
     unchanged; Browse shows recipes where `visibility == "public"`.
3. **Feed friends/everyone toggle.** *(BUILT in #70 — then **UN-SHIPPED by #94**: the toggle is
   gone and `everyone` survives only as the client's cold-start fall-through, rendered under
   "While you find your people" and unreachable once one friend posts.)* The feed gains a control
   to show either just friends (the Phase-1a default) or everyone (public posts from
   non-friends). This revises the "friends-only feed, no public/global feed" constraint
   above. The "everyone" view is scoped to posts whose own `visibility` is `public` (per
   #2) — enforced in SQL — and excludes the caller's own and friends' posts, so it's pure
   discovery with no overlap with the friends scope.
4. **Browse shows posts, not just recipes.** *(BUILT in #71 — then **UN-SHIPPED by #94**: the
   Meals tab is gone, because Browse is an intent surface and nobody searches for a photo of
   someone's dinner. `GET /posts/browse` still exists and is tested; no client calls it.)* Browse gained a
   **Recipes | Meals** tab switcher: Recipes is the existing recipe discovery; Meals is a
   grid of public posts (`GET /posts/browse`, `visibility == "public"` only), each opening
   a read-only `/posts/:id` page. The open "how to mix two result types" question was
   resolved as separate tabs (not a blended grid). The **request the recipe** action on a
   post with no attached recipe stays Phase 2 — Browse surfaces the posts; the fulfill loop
   comes later.
5. **Non-cook audience is in-scope as an on-ramp, not a redefinition.** People who don't
   cook stay connected and see what friends are making; the core job is unchanged. Now
   reflected in `POSITIONING.md` ("Who it's for").
6. **Attach-a-recipe button in the post composer.** `PostComposer` gains an "Attach a
   recipe" control that picks from recipes the author owns (sets `recipe_id`). The
   backend already accepts `recipe_id`; only the composer UI is missing. Small — fold
   into Phase 2 with the request loop.

**Sequencing note:** #2 (profile visibility) is the backbone the others lean on —
#1 (friend sees your posts), #3 (everyone feed), and #4 (posts in Browse) all depend on
a coherent "who can see this" answer. It shipped first, as its own reviewed step (#68);
it supersedes the old per-recipe 3-tier plan below.

## Conventions the code must match (from the current repo)

- Models: SQLAlchemy 2.0 `Mapped[...] / mapped_column`, `server_default` for enums,
  FKs with explicit `ondelete`, `created_at` via `func.now()` (see `models/handoff.py`).
- **Register every new model in `alembic/env.py`** (the `from app.models.x import Y  # noqa`
  block) or autogenerate misses it.
- Migrations: hand-written `upgrade`/`downgrade`, `revision`/`down_revision` chained,
  additive; must replay on SQLite.
- Routers: literal paths declared BEFORE `/{id}` catch-alls; `get_current_user`
  dependency for auth; Pydantic request/response schemas separate from ORM.
- `can_view` in `services/sharing.py` stays the single read-authorization rule.
- Frontend: pages in `src/pages`, components in `src/components`, API calls through
  `src/api/*`; bottom-nav is a floating sticker pill; every new text field/surface
  is POSITIONING-clean. Add tests for new pages (don't extend the coverage gaps).

---

## Phase 0 — the friend graph + minimal profiles  *(prereq; no feed without it)*

**Goal:** two users can become friends, and you can view a friend's profile. Delivers
nothing social-feeling on its own, but everything else needs it. Ship it quietly.

### Backend
- **Model `Friendship`** (`models/friendship.py`): `id`, `requester_id` FK users,
  `addressee_id` FK users (both `ondelete=CASCADE`), `state` (`pending | accepted`,
  server_default `pending`), `created_at`. Unique constraint on the unordered pair
  (enforce one row per pair regardless of direction — store a normalized
  `(low_id, high_id)` pair, or a unique index on `(requester_id, addressee_id)` plus
  an app-level check for the reverse). **Register in `alembic/env.py`.**
- **Migration** `create friendships` (additive; replays on SQLite).
- **Service `services/friends.py`**: `are_friends(a_id, b_id, db) -> bool` (accepted
  in either direction) — the single friendship predicate, reused by Phase 1's feed
  and the Phase-later visibility change. Keep it the one rule, like `can_view`.
- **Endpoints** (new `routers/friends.py`, or fold into a `social` router):
  - `POST /friends/request` `{to_user_id}` → create/accept-idempotent pending request.
  - `POST /friends/{id}/accept` → both-accepted; only the addressee may accept.
  - `DELETE /friends/{id}` → unfriend / decline / cancel (either party).
  - `GET /friends` → accepted friends list.
  - `GET /friends/requests` → incoming pending.
  - `GET /friends/suggestions` → **seeded from the handoff graph** (people you've
    handed a recipe to or received one from) minus existing friends/requests. This is
    the cold-start mitigation; it's why Phase 0 is worth shipping before the feed.
- **Scope/authorization tests** (TESTING.md #1–3 style): can't accept someone else's
  request; can't friend yourself; idempotent re-request; unfriend is mutual;
  suggestions never include non-handoff strangers or already-friends.

### Frontend
- **`api/friends.js`** — the calls above.
- **`pages/Profile`** already exists as "You" (account). Add a **read-only profile
  view** for *another* user: `pages/UserProfile.jsx` at `/u/:userId` — their name,
  avatar placeholder (avatars are backlog #33, fold in here if cheap), and their
  **public + friends-visible recipes** (respects the not-yet-built visibility rule —
  until Phase "visibility" lands, show public only). A "Add friend / Requested /
  Friends ✓" button reflecting state.
- **`pages/Friends.jsx`** (or a section of "You"): friends list, incoming requests,
  and suggestions ("People you've cooked for"). Entry from the "You" tab.
- Tests for both pages (new pages — no coverage gap).

**Superseded by #80:** Phase 0's discovery was handoff-only, and that turned out to be the
plan's one real usability failure — a beta user with no handoffs had no find-friends surface
at all, because the suggestions section self-hides when empty. #80 added `GET
/friends/discover` (the app-wide directory + name search), the "Everyone on issei" section,
and a permanent Friends button in the Feed masthead. `GET /friends/suggestions` is unchanged
and still handoff-only — it just no longer stands alone.

**Phase 0 ships:** you can find people you've exchanged recipes with, friend them, and
see their profile. No feed yet.

---

## Phase 1 — posts + the friends feed (the MVP)

**Goal:** post a photo + dish name; see a reverse-chron feed of friends' posts. This
alone delivers the "see what your friends are making / stay connected from afar" value.
**Ship and learn before building the request loop.**

### Decisions locked (2026-08-18, build session)
- **Scope split:** Phase 1 is posts + feed ONLY. The 3-tier recipe visibility
  (`private/friends/public`, default→friends) is a SEPARATE later step (Phase 1b) —
  the feed is inherently friends-only and doesn't need it. Lower risk, faster to a
  shippable feed. (POSITIONING rework rides with 1b, not 1a.)
- **Feed FULLY replaces Home** (`/`). No hero deck / kitchen grid / "passed down
  lately" tail — a scroll feed has no natural footer, and Kitchen + Browse tabs
  already own that content. An **empty feed shows a warm onboarding empty state**
  driving the two cold-start actions ("Share a meal" + "Find friends" → the Phase-0
  suggestions). The empty state IS the cold-start fix — no own-content tail.
- **The + (Add) nav slot becomes a chooser**: "📸 Share a meal" (photo post) and
  "📖 Write a recipe" (existing add flow). One slot, both creation paths; posting is
  framed as the light everyday act, recipe-keeping as the deliberate one.
- **Re-surface the Friends entry** on the You page (hidden in Phase 0) as part of
  this — and it's also reachable from the feed's empty state.

### Backend
- **Model `Post`** (`models/post.py`): `id`, `user_id` FK, `photo_url` (Cloudinary,
  required), `dish_name` (required), `description` (optional), **`recipe_id`
  nullable FK** (`ondelete=SET NULL` — a post can outlive/precede its recipe),
  `created_at`. Register in `env.py`. Migration additive.
- **Endpoints** (`routers/posts.py`):
  - `POST /posts` `{photo_url, dish_name, description?, recipe_id?}` — create. Photo
    via the **existing `/upload/recipe-photo` pipeline** (reused, no new upload code).
  - `GET /posts/feed` — posts by the caller's **accepted friends** (uses
    `services/friends.are_friends`), reverse-chron, paginated (cursor or
    `?before=<created_at>`; cap page size). **Scope test:** a non-friend's post never
    appears; your own optionally included (decide: BeReal shows yours too — recommend
    include-own so the feed isn't empty for an active poster with few friends).
  - `GET /posts/{id}` — single post (author or a friend of author only).
  - `DELETE /posts/{id}` — author-only (read-is-not-write, invariant 2).
  - `GET /users/{id}/posts` — a user's posts, for the profile grid (friend-or-public gated).
    *(Shipped as `GET /posts/users/{user_id}` — kept under the posts router's own prefix.)*
- **Post→recipe seeding** is a *frontend* concern (Phase 2 closes the loop); in Phase 1
  a post just optionally references an existing `recipe_id`.

### Frontend
- **`api/posts.js`**.
- **New bottom-nav tab** — the feed becomes a first-class surface (design says its own
  tab). Current nav: Home · Browse · Add · Kitchen · You. Options to resolve at build:
  add a 6th ("Feed"), or repurpose. **Flag for decision** — 6 tabs is tight on mobile.
- **`pages/Feed.jsx`** — reverse-chron cards: photo, dish name, "from {friend}",
  description, timestamp. Empty state = the cold-start prompt ("Friend the people
  you've cooked for" → Phase 0 suggestions). NO like button.
- **`components/PostComposer`** (or a `/post` route) — photo (reuse `photoUpload` +
  the sticker photo target from RecipeForm), dish name, optional description. Dead
  simple, one screen. Optionally "attach an existing recipe."
- **`PostCard.jsx`** — the feed/profile card. Tapping opens the post; if it has a
  `recipe_id`, a link through to the recipe.
- Profile grid (Phase 0's UserProfile) now shows the user's posts too.
- Tests: Feed (friends-only rendering, empty state), composer (submit shape), PostCard.

**Phase 1 ships:** the presence feed. Post a meal, see friends' meals. Validate the
core bet here.

---

## Phase 2 — recipe requests → the fulfill loop + notification center  *(BUILT — #79)*

> **Shipped, with three deliberate departures from the spec below. The spec text is kept for
> its reasoning, but where they conflict the CODE and POSITIONING.md win:**
> 1. **Not friends-only.** The guard is `can_view_post` — anyone who can see the post may ask,
>    including a stranger on a public one. #71 put public meals in Browse precisely so a
>    stranger could find your dish; a dead end there would undo it.
> 2. **The count is the COOK'S ALONE**, not "count to all, names to the author".
>    `request_count` is `None` for every non-author and no surface renders a zero. A public
>    tally is a like count with a different noun — see POSITIONING's fourth invariant.
> 3. **No fulfil confirmation dialog.** The intent is met by surface instead: `/requests` lists
>    the requesters' names before you act, then both doors call fulfil directly.

**Goal:** the demand engine. Request a recipe on a post; the poster is nudged; adding
the recipe auto-delivers it to everyone who asked. Requires a notification center
(issei has none).

### Backend
- **Model `RecipeRequest`** (`models/recipe_request.py`): `id`, `post_id` FK
  (`ondelete=CASCADE`), `requester_id` FK, `state` (`pending | fulfilled`), `created_at`.
  **Unique `(post_id, requester_id)`** — idempotent per user (mirrors handoff-grant
  idempotency). Register + migration.
- **Model `Notification`** (`models/notification.py`): `id`, `user_id` FK (recipient),
  `type` (shipped as five names — `recipe_request | request_fulfilled | friend_request |
  friend_accept | recipe_kept`; `comment` awaits Phase 3, and `recipe_kept` (#96) arrived instead
  and is **anonymous at the API boundary**),
  `actor_id` FK (who caused it), `post_id?` / `recipe_id?` / `friendship?` refs,
  `read_at` nullable, `created_at`. Generic enough to serve Phases 2–3. Register +
  migration.
- **Service `services/notifications.py`**: `notify(user_id, type, ...)` — the one
  place notifications are created, so every producer routes through it.
- **Endpoints:**
  - `POST /posts/{id}/request` — idempotent; creates a `RecipeRequest` and a
    `recipe_request` notification to the post's author. Guard: **`can_view_post`** (NOT friends-only — see the note at the top of this phase), and
    not your own post.
  - `DELETE /posts/{id}/request` — retract.
  - `GET /posts/{id}` now returns **request count + whether you've requested** (like
    `shared_with_count` on recipes — **count to the AUTHOR ONLY** (`None` for everyone else), names only on the cook's own
    requests endpoint. The "N friends want this" framing was rejected).
  - **The fulfill loop:** when a recipe is created/edited with a link to a post that
    has pending requests — OR a dedicated `POST /posts/{id}/fulfill {recipe_id}` —
    for each pending `RecipeRequest`, mint a **handoff grant** (reuse
    `handoff_recipe`'s grant creation: `Handoff(recipe_id, from_user_id=author,
    to_user_id=requester, state='accepted')`), mark the request `fulfilled`, and
    `notify(requester, 'request_fulfilled', ...)`. **This is the design's "a fulfilled
    request is a handoff to everyone who asked" — literally reuse the grant path so
    `can_view` already lets them read it.** Idempotent (don't double-grant).
  - `GET /notifications` — the caller's, newest first, paginated.
  - `POST /notifications/read` (or `/{id}/read`) — mark read; unread-count endpoint or
    include in `/notifications`.
- **Scope tests:** can't request your own post; a viewer who fails `can_view_post` gets 404, but a stranger who CAN see a public post may
  ask; `request_count` is `None` for every non-author; fulfill
  grants exactly the requesters (not all friends) and is idempotent; a requester can
  now `can_view` the recipe; notifications are per-recipient only (invariant 1/3).

### Frontend
- **`api/notifications.js`**, extend `api/posts.js` with request/fulfill.
- **PostCard**: a **"Request recipe" button** (the primary action — replaces where a
  like would be). Shows **"Ask for the recipe" / "Asked ✓"**; the count appears only on the
  author's own card, never as a zero, and never to anyone else.
- **Post→recipe conversion**: from a post you own with requests, a "Add the recipe"
  CTA opens the existing add flow **pre-seeded** (dish name → name, description →
  description, photo → cover — the locked auto-seed), and on save runs fulfill. This
  is the low-friction demand→recipe path that is the whole point.
- **`components/NotificationCenter`** — a bell in the header or a "You"-tab section;
  unread badge; list of notifications with deep links (request → your post; fulfilled →
  the recipe). In-app only (no push — that's the native phase). *(Superseded: web push shipped in #89 with a
PWA shell, no native app. See FUTURE.md's roadmap item 1.)*
- **A requests surface (user-requested 2026-08-19):** the author needs to see their
  incoming recipe-requests two ways — a TOTAL across all their posts, and a per-post
  count on each PostCard. Mirror the friend-requests pattern: a dedicated "Recipe
  requests" page listing every post of theirs that has ≥1 pending request with its
  count (tapping a post → who asked / fulfill). The total surfaces as a count/badge
  (e.g. on the You page or the notification bell). Backend: `GET /posts/{id}` already
  plans to return the per-post count; add a caller-scoped aggregate (total pending
  across own posts) + a list endpoint of own posts-with-requests. This is the demand
  surface that makes "6 people asked" visible TO THE COOK (never publicly — the "N friends want this" framing here was rejected; see the note on Phase 2) — build it with the request loop,
  not after.
- Tests: request button states, the seeded add flow, notification list + read state,
  the per-post + total request counts.

**Phase 2 ships:** the motivation engine. Requests turn "why log this?" into "6 friends
are waiting," and fulfilling hands it to them automatically.

---

## Phase 3 — comments + polish

- **Model `Comment`** (`post_id` FK CASCADE, `user_id`, `body`, `created_at`).
  Friends-only create; author-or-commenter delete. `notify(post_author, 'comment')`.
- Endpoints: `POST /posts/{id}/comments`, `GET /posts/{id}/comments`, `DELETE`.
- Frontend: comment thread on the post view; count on PostCard; notification wired.
- Polish: notification center empty/read states, feed pagination UX, profile completeness.
- (Comments are cheap + high-connection-value; could merge into Phase 2 if desired.)

---

## The visibility change (`private | friends | public`) — SUPERSEDED 2026-08-19

> **Superseded by Direction update #2.** The per-recipe three-tier model below is no
> longer the plan — visibility is now **profile-level public/private with per-item
> public overrides**, applied to both recipes and posts. The mechanics below (one
> `can_view` branch per rule, Browse shows only public, migration flips a default, the
> 3-way create/edit control absorbing backlog #61) are still the right *shape* to reuse;
> read them as guidance for building the profile-visibility model, not as the target
> model itself.

Sequenced here because "friends" visibility is meaningless before the friend graph.
Do it as its own reviewed step once Phase 0's `are_friends` exists (it can ride in
Phase 1, or immediately after Phase 0):
- `Recipe.visibility` accepts `friends`; **migration** sets the column default and
  the app default flips `public → friends` (partially reverses the recent
  public-by-default call — intended; see design Tension 1).
- **`can_view` gains a branch:** viewable if public OR owner OR accepted grant OR
  **(`visibility == 'friends'` AND `are_friends(viewer, owner)`)**. This is the one
  rule; test every branch.
- `effective_visibility` / `/browse` gating: **Browse shows only `public`** (a
  friends-default recipe must not leak to the public feed) — a scope test pins this.
- `VisibilityChoice` (create) + the Edit form control (backlog #61) become **3-way**.
  Backlog #61 is absorbed here — build the edit control as 3-tier, not 2-tier.
- Update the visibility tests (`test_visibility.py`, `test_sharing.py`) for the new
  tier; update TESTING.md invariant 1 to name the friends branch.

## POSITIONING rework — DONE (2026-08-19, user-approved)

`POSITIONING.md` was reworked with explicit sign-off. It now frames the feed and the
handoff as **one product** (presence → the ask → the handoff), keeps the one-liner,
adds a "social food feeds" competitor row, folds in the non-cook on-ramp, and bans
treating the friend graph as lineage. *(The "unbuilt social layer" bans it carried at the time —
no "everyone" feed, no profile visibility, no posts in Browse, no request action — are all obsolete:
three shipped, and the everyone-feed and Meals tab were shipped then deliberately UN-shipped by #94,
which is a different prohibition. See POSITIONING.md for the current list.)* The
docs-auditor's POSITIONING scan is green against the new text.

## Backlog items this absorbs / closes

- **#8 profiles** → Phase 0. **#32 relational/close-the-loop** → the feed IS this;
  the fulfill loop closes it. **#33 avatars** → fold into Phase 0/1 profiles.
  **#61 edit-form visibility** → becomes the 3-tier control in the visibility step.

## Open decisions to settle at build time (not blockers now)

1. **Bottom nav** — RESOLVED (2026-08-18): the feed **becomes the Home page** (`/`),
   not a 6th tab. The current Home (hero deck + "passed down lately" + your kitchen)
   is folded into/replaced by the friends feed; "your kitchen" already has its own
   tab. Revisit where the current Home's first-run/empty-handed pitch goes.
2. **Own posts in your own feed?** (Rec: yes — avoids an empty feed for active posters.)
3. **Request count visibility — **RESOLVED THE OTHER WAY: cook-only.****: count to everyone, requester names to the author only? (Rec: yes.)
4. **Fulfill trigger — **RESOLVED: no confirm dialog; /requests shows who it goes to first.****: automatic when a recipe links a requested post, or an explicit
   "share with the N who asked" confirmation? (Rec: explicit confirm — sending to
   people is outward-facing; the user should see who it goes to.)
5. **Notification retention/pagination** shape.
6. **Avatars now or later** (#33) — cheap to include in Phase 0 profiles.

## Rough sequence

Phase 0 → (visibility change) → Phase 1 + POSITIONING rework → Phase 2 → Phase 3.
Each is its own approval-gated ship. Phase 1 is the first point real users feel it;
Phase 2 is the highest-payoff, highest-effort build.
