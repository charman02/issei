# TECHDEBT.md

A living map of **what to understand, learn, and revisit** — not only classic tech
debt, but concepts used, decisions made fast, and shortcuts with a tradeoff attached.
Kept as issei grows into a multi-user social product, so the cost of every shortcut is
written down where the next person reading this code will find it.

**How this file is organized:** bucketed by **urgency** first, then **by area** inside
each bucket, so the clusters are visible at a glance. Each entry says what it is, why
it's flagged, and where it lives.

> Rebuilt from scratch 2026-08-20 by a fresh pass over the current code (the previous
> ledger was stale). Add to it continuously; move entries between buckets as urgency
> shifts rather than leaving them stale.

> **Stack note / drift caught:** the backend runs on **AWS ECS Fargate** (migrated off
> Render, task #37), frontend on **Vercel**, DB on **Neon Postgres**. Any doc/notes still
> saying "Render" are stale.

---

## Understand before scaling further

These are the things most likely to bite when real multi-user traffic and real
strangers arrive. Security/privacy first.

### Auth & permissions

- **Everyone is discoverable, and that is the DECISION, not a gap.** Owner call,
  2026-09-04: name + photo findable by any signed-in user while your *content* stays
  private is how Instagram, TikTok and X all work — private controls what people SEE, not
  whether you EXIST. issei matches that, so there is no opt-out and none is planned.
  `profile_visibility` governs content and is correctly silent on findability.

  One thing about our version genuinely differs from those apps, and it is the real item —
  it is not an opt-out. (The second item here used to be "there is no block"; blocking
  shipped in #85, so that gap is closed and its replacement debt is listed below.)

  1. **We BROWSE-ALL; they SEARCH-ONLY.** `GET /friends/discover` with no `?q=` returns
     every other user, newest first, 50 at a time — though only for addable STRANGERS:
     anyone the caller has already asked comes back outside that cap (#80), so a response can
     legitimately exceed 50, and the cap can never drop the person whose "Requested" label is
     the whole reason the row stays. Instagram will find a name you type; it
     will not hand you a paginated list of the whole platform. At a dozen users browse-all
     IS the feature (it is why #80 exists — a real user could not find anybody). Past a few
     hundred it is a scrapeable member list. *When to revisit:* make `q` required once the
     directory stops being the only way to find a first friend. *Where:*
     `app/routers/friends.py::discover_people`, `DISCOVER_LIMIT`.

  What stays true regardless: **do not describe the app as private-by-default without saying
  findability is not covered.** Instagram does not claim it either. That is a copy rule, not
  a code gap — see POSITIONING.

- **No rate limiting anywhere.** `app/main.py` mounts only `CORSMiddleware`. Not created by
  the directory, but the directory makes bulk name harvesting a single loop, and
  `POST /auth/login`, `POST /auth/forgot-password` and **`POST /posts/{id}/request`** are equally unthrottled — the last one is a write into someone else's inbox, which is why its notification is deduped while unread. *Why flagged:*
  it's the cheapest thing that turns an accepted disclosure into an abuse vector.

- **Authorization is application-level, not query-level — the single most important
  thing to understand.** Read endpoints fetch the row by id, THEN call `can_view` /
  `can_view_post` in Python and 404 if false. The database query does *not* filter by who
  may see it. So the only thing protecting a private recipe is that a human remembered to
  write `if not can_view(...): raise 404` after the fetch. A future endpoint that fetches
  and returns a row **without** calling the rule leaks private content, and no DB
  constraint or test would catch it. *Why flagged:* this is the structural foundation of
  all privacy in the app, and it's the easiest thing to accidentally bypass. *Where:*
  `app/services/sharing.py` (`can_view`, `can_view_post`, `_resource_is_visible`);
  enforcement points in `app/routers/recipes.py` (`get_recipe`, `cook_recipe`,
  `get_scaled_recipe`) and `app/routers/posts.py` (`get_post`, `feed`, `user_posts`).

- **The invite link is a bearer credential — no expiry, no revoke.** `GET
  /recipes/invite/{token}` returns the whole recipe to anyone holding the link, no account
  needed (token = `secrets.token_urlsafe(32)`, unguessable). But whoever gets the link —
  forwarded, screenshotted, indexed — can read it, and there is no "disable this link"
  control. The only cut-off is deleting the recipe. *Why flagged:* it's central and
  intentional, but you must internalize that sharing a link = handing out a permanent
  read key. *Where:* `app/routers/recipes.py` (`preview_invite`, `claim_invite`).

- **Handoff grants are permanent and orthogonal to visibility.** Once someone claims your
  invite (or you hand them a recipe), they can read it *forever* — setting the recipe to
  "private" later does NOT revoke grants already given. "Make it private" only blocks
  people who never held a link. *Why flagged:* "private" doesn't mean what a user might
  assume; this is the #1 privacy surprise. *Where:* `app/services/sharing.py` (`can_view`
  handoff branch); `app/routers/recipes.py` (`claim_invite`).

- **Signup doesn't verify email ownership — and that feeds the invite flow.** Anyone who
  registers `victim@example.com` instantly inherits any recipe email-invited to that
  address (signup auto-accepts pending email handoffs). *Why flagged:* an account-takeover
  / data-inheritance path that matters more as you add users. *Where:* `app/routers/auth.py`
  (`signup` auto-accept block; `handoff_recipe` with `to_email`).

- **The `is_friend` / `is_grantee` / `blocked` precompute trusts the caller.** To avoid
  re-querying per item on a profile/feed page, callers can pass a precomputed boolean that
  the rule uses *blindly*. A future caller that builds its "friends" set wrong (or passes
  `True` by mistake) silently makes a friends-only item visible to that viewer. `blocked`
  (#85) is the worse of the three: passing `blocked=False` by mistake silently defeats a
  block, and unlike the friends case the person it was protecting will never find out. *Why
  flagged:* it's a performance optimization that can become a leak if used carelessly. *Where:*
  `app/services/sharing.py`; callers in `app/routers/posts.py`, `recipes.py`, `friends.py`.

- **`notify_people` is an API-visible switch that nothing consults.** (#89)
  The column exists, `UserResponse` exposes it, login returns it, `PATCH /auth/me` writes it — and
  no code reads it, because person-to-person pushes are not wired: `services/notifications.py`'s
  `notify()` is untouched by #89 and does not import `services/push.py`. The owner's decision was
  "every notification type pushes"; only the daily prompt does. **The client half resolved half of
  this by omission** (2026-09-10): `NotificationSettings.jsx` deliberately renders NO switch for it,
  because a control that changes nothing is worse than a missing one — switching it off would read
  as a promise the app then breaks in the other direction — and a test pins the switch COUNT at two
  so one can't be added back before the push is wired. What remains is that the FIELD is still
  writable through `PATCH /auth/me` and consulted by nothing, and no test fails if whoever wires the
  pushes forgets to read it: the three tests that touch it (`tests/test_prompt.py`, `tests/test_push_subscriptions.py`, `frontend/src/components/NotificationSettings.test.jsx`) assert only that it has NO effect — on the daily nudge, and on the switches the UI renders. *Why it's a ledger entry and not a fix:* wiring it properly needs a decision about
  WHERE, and the seam is genuinely awkward — `notify()` deliberately does not commit, so a push
  sent from inside it can fire for a row whose transaction then rolls back, and pushing after each
  caller's commit means touching every call site. *The trap to remember when it is wired:*
  `recipe_kept` is ANONYMOUS (#96), and the actor IS in hand at `notify()` time — the router is
  what strips it today, so a payload built at notify() time would carry the keeper's name straight
  onto a lock screen. That anonymity has to be re-enforced at the push boundary, which is a second
  place, not the same one. *Where:* `app/models/user.py`, `app/services/notifications.py`.

- **The daily prompt can repeat the same sentence forever.** (#89)
  `last_feed_seen_post_id` only advances via `POST /posts/feed/seen`, which the client calls when
  the friends feed renders. So a person who never opens Home gets "3 friends posted since you last
  looked" on day 1 and the identical line on day 30. `prompt_sends` bounds it to once per local day
  and the `daily-prompt` tag collapses them on-device, so it is not a flood — but the message never
  changes and never stops. Literally true, and arguably the point (nudging the person who isn't
  looking is the feature), yet `prompt_payload`'s own docstring argues against "asking for attention
  without offering anything", and an unchanged sentence on day 30 is closer to that than to a fresh
  signal. *Fix, when someone decides:* the cheap version is refusing to repeat an identical count on
  consecutive days, using the `friend_count` already stored on the previous row — no migration
  needed. Deliberately not done unilaterally: it is a product call about how insistent this app is
  allowed to be, and nothing can reach a real inbox until the secrets exist (the client half shipped
  2026-09-10).
  *Where:* `app/services/prompt.py`, `app/models/prompt_send.py`.

- **No end-to-end push delivery has ever been observed.** (#89)
  Every leg is tested except the one that leaves the building. `tests/test_push.py` decrypts what the
  sender produces from the RECEIVER's side (which is how the zero-salt bug was caught), the
  subscribe/rotate/prompt routes are verified live against a running API, and `lib/push.js` is unit
  tested against a stubbed `PushManager` — but nothing here has watched a notification arrive on a
  device, because **headless Chromium refuses to subscribe at all**: `pushManager.subscribe` throws
  `AbortError: Registration failed - permission denied`, since there is no push service behind it.
  So the browser→FCM/APNs→device leg is inferred from the RFCs, not measured. *Why it's a ledger
  entry and not a fix:* it cannot be automated on this machine at all — it needs one real phone,
  once, after the VAPID secrets are set, plus an iOS device added to the home screen to confirm the
  install-first path. Until then, "notifications work" is an untested claim, and the honest phrasing
  is "every layer we can reach is verified". *Where:* `frontend/public/sw.js`,
  `frontend/src/lib/push.js`, `app/services/push.py`.

- **Reports go into a table nobody can read from inside the app.** (#87)
  `POST /friends/reports` stores the row; there is no endpoint, page or notification to get it
  back out, because reading other people's reports needs an admin role this app has no concept
  of and inventing one to avoid opening a database console would have been the larger mistake.
  Consequence: a report is only acted on if someone remembers to query Postgres. That is
  honest for one operator and an obvious failure at any scale — and it is worth being precise
  that the App Store gate asks for a way for USERS to report, which this satisfies, not for a
  demonstrated review process. *Fix:* an owner-only surface (the simplest honest version is a
  `GET` gated on a single admin user id in config) plus a way to mark a report `closed`.
  Nothing can move a report out of `open` today, which the dedupe depends on: the first version
  DISCARDED a second report from the same person, so a genuinely new incident weeks later was
  thrown away while the UI answered "we'll take a look" about it — caught in review. It now
  APPENDS to the open row (bounded at 8000 chars, earliest accounts kept), so the data-loss path
  is closed and what remains is only the missing close action. *Why flagged:* until a report can
  be closed, one grievance and a year of grievances are the same row, and nobody can tell which
  reports have been dealt with. *Where:* `app/routers/friends.py::report_user`,
  `app/models/report.py`.

- **A profile grid now has TWO ceilings, and "Show all" only lifts one.** (#98)
  `ProfileContent` previews six items per tab behind a "Show all N" button, but the endpoints
  behind it cap at 30 server-side (`PROFILE_GRID_LIMIT`, `FEED_PAGE`). So the button reveals
  everything **fetched**, not everything that exists — and on a profile with 45 visible
  recipes the header count ("45 recipes", uncapped and `can_view`-gated) disagrees with the
  button ("Show all 30 recipes"). Neither number lies about what it describes; together they
  read like a bug. *Fix:* `before_id` keyset pagination on `GET /recipes/users/{id}` (the
  posts endpoint already has the shape), then make "Show all" fetch rather than just
  un-slice. *Why flagged:* invisible until someone has more than 30 of anything, and
  permanently confusing after that. *Where:*
  `frontend/src/components/ProfileContent.jsx`, `app/routers/recipes.py`,
  `app/routers/posts.py`.

- **Blocking is enforced in two places, and only one of them is structural.** (#85)
  `_resource_is_visible` covers every recipe and post read, which is the right shape. But
  `request_friend`, `accept_friend`, `friend_suggestions`, `discover_people`,
  `user_profile` and `browse_recipes` each carry a hand-written `is_blocked` / `blocked_ids`
  call, because they
  return *people* (or run unauthenticated) and so have no `can_view` to lean on. This is not
  hypothetical: `friend_suggestions` was missed on the first pass and the review caught it —
  a blocked person reappeared as a friend suggestion precisely *because* you had once handed
  them a recipe. The next list endpoint that returns other people's names will have the same
  gap. *Why flagged:* same class as "authorization is application-level, not query-level"
  above. *Where:* `app/routers/friends.py`, `app/routers/recipes.py::browse_recipes`.

- **Nothing revokes a handoff grant — now a three-way split, not a two-way one.** (#85)
  Unfriending is retroactive; blocking is stronger still (it includes the unfriend and stops
  all new contact). Neither takes back a recipe already handed over, and that is deliberate
  (see invariant 9 in TESTING.md). *Why flagged:* "unfriend", "block" and "revoke what I
  shared" are three different actions and only the first two exist. *Where:*
  `app/services/sharing.py` (`can_view`'s grant branch).

- **The Kept shelf is uncapped and does ~4 queries per row.** `GET /recipes/kept` (#57)
  has no LIMIT, and per visible row runs `can_view` (1–2 queries) plus
  `_attach_growth_fields` (2). It also eagerly loads the full ingredient/step graph for
  rows it then discards as unreachable. Consistent with `GET /recipes` and `/browse`
  (also uncapped) — but Kept is the one list a user can grow without bound from Browse,
  so 100 kept recipes is ~400 sequential round-trips to Neon in one request. *Fix:*
  keyset pagination like the feed's `?before_id=`, resolve the friendship once instead of
  per row, and skip the child-graph load for rows that fail `can_view`. *Why flagged:*
  the shelf's growth path, and the one #57 surface with no ceiling.
  *Where:* `app/routers/recipes.py` (`kept_recipes`).

- **Loading the Kept shelf WRITES — it prunes.** `GET /recipes/kept` deletes the caller's
  own `RecipeSave` rows for recipes they can no longer view. That implements a deliberate
  product rule (losing access is permanent: a deleted recipe is gone for everyone forever,
  a restricted one stops being yours, and re-opening it does NOT put it back — the cook has
  to share it again), and it's why the "unreachable" count is reported once rather than
  standing forever. But it means a GET has a side effect, and the destructive branch keys on
  `can_view` returning False: if a future change ever made `can_view` wrongly say no —
  a bad `is_friend` precompute, a botched migration — that read would silently delete
  people's bookmarks instead of merely hiding rows. *Why flagged:* the blast radius of a
  read-path bug is now data loss, not a blank screen. Handoff grants are deliberately never
  pruned (a grant is the cook's history), so only bookmarks are at risk.
  *Where:* `app/routers/recipes.py` (`kept_recipes`); rule pinned by
  `tests/test_recipe_saves.py::test_losing_access_is_permanent_reopening_does_not_restore_the_bookmark`.

- **Browse loads whole tables and filters/searches in memory (recipes AND posts).** The
  recipe Browse (`browse_recipes`, **optionally** authenticated since #85 — anonymous works,
  and a signed-in viewer's blocks are honoured) loads *all* non-deleted recipes then drops
  non-public ones and blocked owners' with one Python comprehension carrying *two* predicates
  — mis-edit either and you leak (private recipes to anonymous callers, or a blocked person's
  recipes back into the blocker's feed). `browse_posts` (#71, auth-gated) filters
  `visibility=='public'` in SQL (safer) and is **uncapped** — which was justified by the
  client searching the full set from Browse's Meals tab, and that tab is gone (#94), so
  today it is an uncapped query with **no caller at all**. Either give it a cap before
  anything calls it again (#82's "most asked for" row is the likely one) or delete it.
  `browse_recipes` still reads the whole matching table per call and searches client-side. Fine now; a scaling wall as the corpus grows. *Fix:* server-side search +
  keyset pagination on both, mirroring the feed's `?before_id=` cursor. *Why flagged:* the
  recipe one is also a privacy single-point-of-failure; both are scaling walls.
  *Where:* `app/routers/recipes.py` (`browse_recipes`), `app/routers/posts.py` (`browse_posts`);
  frontends `frontend/src/pages/Browse.jsx`.

- **JWT has no revocation, and login isn't rate-limited.** Tokens are valid until they
  expire no matter what; changing/resetting a password does NOT log out existing sessions,
  and nothing throttles password guessing. *Why flagged:* standard for v1, but real gaps
  to close before scale — "I was hacked, I changed my password" won't evict an attacker.
  *Where:* `app/auth.py` (`create_access_token`, `get_current_user`); `app/routers/auth.py`
  (login, `update_me`, `reset_password`).

### Data model

- **Deleting a user is a wide, untested cascade.** `DELETE /auth/me` ships now (password-confirmed, hard delete relying on DB-level cascades); the cascade breadth is what's untested
  yet, but the FK cascades are already defined: deleting a user removes their recipes — and
  a recipe cascade-deletes its ingredients/steps/cook-events/handoffs. Concretely, **a
  grantee's "shared with me" recipe disappears if the original sender deletes their
  account.** *Why flagged:* a real product decision hiding in a cascade rule; test it
  before shipping "delete my account." *Where:* `app/models/*.py` FK `ondelete` clauses
  (esp. `recipe.py`, `handoff.py`, `post.py`, `friendship.py`).

- **Visibility is three unconstrained string columns, and `profile_visibility` never
  gates reads.** `recipe.visibility`, `post.visibility`, `user.profile_visibility` are bare
  strings — no enum/CHECK — so a typo silently misbehaves. And `profile_visibility` does
  NOT decide who can read anything; it only picks the create-form default (except mid-post, #81, where a recipe written from the meal composer starts from the POST's visibility) and drives the
  bulk sweep. *Why flagged:* the "I made my profile private, why can people still see my
  public recipe?" report is *working as designed* — you'll hear it; also add a DB-level
  CHECK/enum before users depend on it. *Where:* `app/models/{recipe,post,user}.py`;
  the rule in `app/services/sharing.py`.

- **Missing indexes on the two hottest multi-user paths.** The posts feed queries
  `user_id IN (...) ORDER BY id DESC` but there's no composite `(user_id, id)` index; the
  friend lookup filters `state='accepted' AND (requester_id=x OR addressee_id=x)` with no
  index on `state`. Fine at small scale, a filter-then-sort as tables grow. *Why flagged:*
  cheap to add now, painful to diagnose as latency later; the feed runs the friend lookup
  on *every* load. *Where:* `app/models/post.py`, `app/models/friendship.py`; queries in
  `app/routers/posts.py` (`feed`), `app/services/friends.py`.

### Infra & deployment

- **Production runs a single container (`desiredCount: 1`), no autoscaling.** One ECS
  Fargate task = one point of failure and a hard traffic ceiling; the intended scaling
  story is "raise the task count," but nothing does it automatically. *Why flagged:* the
  first knob to turn when traffic grows — and it needs a load test first (open task #38).
  *Where:* `infra/lib/issei-stack.ts` (service `desiredCount`); `Dockerfile` scaling note.

---

## Should learn soon

Important to how the app works and where quality/correctness can quietly slip, but not an
imminent scaling risk.

### Auth & permissions

- **Unfriending IS retroactive for friend-gated data (good) — but not for handoffs.**
  Removing a friend hard-deletes the friendship row, and because `are_friends` is checked
  live on every read, friends-only recipes/posts immediately stop being visible. But a
  recipe you *handed* that person survives the unfriend (see the handoff-grant note above).
  *Why flagged:* worth understanding the split — "unfriend", "block" (#85) and "revoke what
  I shared" are three different actions and only the first two exist. *Where:*
  `app/routers/friends.py` (`remove_friend`, `block_user`); `app/services/friends.py`
  (`are_friends`); `app/services/blocks.py` (`is_blocked`).

### Data model

- **Soft-delete (recipes) vs hard-delete (everything else) — "delete" means "tombstone."**
  Deleting a recipe only sets `deleted_at`; the text and photo URLs persist in the row
  forever, and every read query must remember to filter `deleted_at IS NULL` (an unenforced
  convention). *Why flagged:* a real retention/privacy question — a future "delete my data"
  request isn't actually satisfied by this; there's no purge job. *Where:*
  `app/models/recipe.py` (`deleted_at`); the filter convention across `app/routers/recipes.py`.

- **The ingredient denormalization — clever, but an app-level invariant.** Every ingredient
  stores both `section_id` (its group) *and* `recipe_id` (its recipe) directly, so "all
  ingredients for this recipe" is one flat query. Nothing in the DB enforces that an
  ingredient's section belongs to the same recipe — the app must keep them consistent.
  *Why flagged:* a deliberate design worth understanding (and not breaking) before you touch
  recipe editing. *Where:* `app/models/ingredient.py`, `app/models/ingredient_section.py`,
  `app/models/recipe.py` (the filtered `ingredients` relationship).

- **Friendship pair-normalization — `set_pair()` must run on every insert.** One row per
  unordered pair is guaranteed by a unique constraint on `(pair_low, pair_high)` = sorted
  ids, which stops a race from creating two rows for one pair. But those columns are only
  filled by remembering to call `set_pair()`; a future insert path that forgets it defeats
  the guarantee silently. *Why flagged:* a genuinely thoughtful concurrency design with a
  fragile dependency. *Where:* `app/models/friendship.py` (`set_pair`, the unique constraint).

### LLM layer

- **LLM cost & latency are per-call and user-facing, with no cap.** Each `/recipes/parse`
  spends money and the user waits (up to 45s client / 25s server timeout); there's no
  caching or rate-limiting beyond requiring login. A burst of parses = a burst of spend with
  no ceiling in code. *Why flagged:* a cost/abuse surface to watch as usage grows. *Where:*
  `app/services/recipe_ai.py` (`extract_recipe`); `frontend/src/api/client.js` (timeout).

- **LLM failures are invisible — silent fallback to a weaker parser.** When the model is
  down/unconfigured, the endpoint returns `ai: false` and the frontend silently uses the
  local line-based parser (which can't split run-on speech). Users never know they got the
  weaker path; it's logged only at `warning`. *Concept to learn:* **graceful degradation.*
  *Why flagged:* you won't notice quality regressions without watching logs/metrics.
  *Where:* `app/services/recipe_ai.py`; `frontend/src/components/PasteRecipe.jsx` (fallback);
  `frontend/src/lib/parseRecipeText.js` (the local parser).

- **Patterns worth the terms:** *strict JSON-schema extraction* (the model must fill an
  exact schema, `"strict": true`, not "please return JSON") and *verify-don't-trust* (the
  app re-classifies every amount and drops ingredients whose head word isn't in the source,
  so the model can't invent or normalize). *Where:* `app/services/recipe_ai.py`
  (`RESPONSE_SCHEMA`, `SYSTEM_PROMPT`, `_clean`).

### Quantity / scaling model

- **The folk-unit vocabulary lives in TWO files that must be edited together.** The list
  that decides how an amount scales (`app/services/folk_units.py`, backend) and the list
  that classifies an amount at entry time (`frontend/src/utils/quantity.js`) are duplicated
  with no automated sync check. Add a unit to one but not the other and the two halves
  disagree mid-recipe — e.g. a unit the frontend tags "their way" but the backend then
  *silently multiplies*, putting a wrong number in someone's kitchen (the exact thing the
  product exists to prevent). *Why flagged:* highest-value gotcha in this subsystem; there's
  also a real latent mismatch today (the frontend knows more unicode fractions than the
  backend classifier). **When you touch folk units, edit both files.** *Where:*
  `app/services/folk_units.py` ↔ `frontend/src/utils/quantity.js`; a third parser
  (`frontend/src/lib/parseRecipeText.js`) also understands amounts.

- **The three-type quantity model is the product's core claim in code.** Every amount is
  `precise` (scales by math) / `imprecise` (a real count in words that must never be
  converted) / `unmeasured` (stays verbatim). Scaling branches on the *type*, not the text;
  non-linear folk units ("3 fingers of water") get a "×N" note for the cook instead of a
  changed number. *Why flagged:* worth understanding deeply because it IS the differentiator
  — normalizing "a good splash" would be worse than no feature. *Where:*
  `app/services/quantity.py` (`classify_amount`), `app/services/scaling.py` (`scale_ingredient`).

### Frontend / state

- **`issei_user` is a client-side cache of server state that only refreshes on login/edit.**
  The logged-in user object lives in `localStorage` and is read directly (e.g. to pick the
  create-form visibility default from `profile_visibility`). If that value changes anywhere
  other than this device's login/edit, the browser keeps using the stale value. *Concept:*
  *client-side cache of server state.* *Why flagged:* small blast radius today (only a
  default the user can override), but the pattern to watch. **LARGELY CLOSED (#90):** the
  named fix — a `GET /auth/me` refresh on app load — shipped as `reconcile()` in
  `lib/currentUser.js`, called once per app start from `App.jsx`, and every write now goes
  through that module's `patchUser`/`setUser` (which merge over a fresh read, so a stale
  closure can no longer revert a just-uploaded photo) instead of touching `localStorage`.
  What remains is narrower than the entry originally described: `id` and
  `profile_visibility` are still read straight from `localStorage` in a couple of places,
  which is fine for an id and merely stale-tolerant for a create-form default.
  *Where:* `frontend/src/lib/currentUser.js` (the store), `lib/useAvatarUpload.js`,
  `pages/Login.jsx`, `pages/Profile.jsx` (writes); `PlantRecipe.jsx`, `PostComposer.jsx`
  (the direct reads that remain).

- **One axios instance carries three cross-cutting behaviors.** All API calls route through
  `client.js`, which auto-attaches the JWT (request interceptor), redirects to `/login` on
  any 401 (response interceptor), and normalizes every error into one human sentence
  (`toUserMessage` — it exists because a FastAPI 422 is an array of objects that once
  rendered `[object Object]`). *Concepts:* *axios interceptors*, *centralized error
  normalization.* *Why flagged:* route all new API calls + error UI through these, don't
  reinvent them per-page. *Where:* `frontend/src/api/client.js`.

### Infra & deployment

- **CI is the deploy gate, and the pipeline is itself a safety design.** Push to `main`
  auto-deploys, but only after both test suites pass; then the image is built, asserted
  importable, **migrations run (gated — a failed migration stops before the image is pushed
  or the service touched)**, and finally deployed with rollback on failure. Auth to AWS is
  keyless OIDC (no stored AWS secret in GitHub). *Concepts:* *CI as deploy gate*,
  *migration-gated deploy*, *keyless OIDC federation.* *Why flagged:* this is your safety
  net — understanding its order tells you exactly where a bad deploy gets caught. *Where:*
  `.github/workflows/deploy.yml`, `test.yml`; `infra/lib/issei-stack.ts` (the OIDC role).

- **Readiness probe proves the DB is reachable; a circuit breaker rolls back.** The load
  balancer health-checks `/health/ready` (which does a real DB check), so a container that
  can't reach Neon fails the deploy and rolls back instead of going green over a dead
  database. *Concepts:* *readiness vs liveness probes*, *deploy circuit breaker.* *Where:*
  `infra/lib/issei-stack.ts`; `app/main.py` (`/health`, `/health/ready`).

---

## Nice to know, no rush

Real, but low-stakes — dead code, minor redundancy, and conventions that only matter in
narrow situations.

### Data model

- **`growth_stage` / `growth_vitality` / `soul_count` are computed on every recipe read but
  shown nowhere.** A whole scoring model (seed→tree) survives from the removed "garden" UI;
  it reads the recipe's story/photo/steps to produce numbers no screen renders. No schema
  footprint, but dead weight on the read path — a candidate to delete once you confirm
  nothing consumes the response field. *Where:* `app/services/growth.py`.

- **`effective_visibility` is a do-nothing pass-through.** It just returns `recipe.visibility`
  now; it used to resolve inherited visibility. Harmless, but a reader may assume it does
  real work. *Where:* `app/services/sharing.py`.

- **Redundant / unused indexes.** `ix_friendships_pair_low` duplicates the unique
  constraint's index, and *no query reads the pair columns at all* (they exist only to
  enforce uniqueness); `ix_posts_created_at` is unused because the feed keysets on `id`, not
  `created_at`. All pure write-cost with no read benefit — cheap to drop. *Where:*
  `alembic/versions/a7b8c9d0e1f2_add_friendships.py`, `b8c9d0e1f2a3_add_posts.py`.

- **Retention odds and ends.** Pending email invites store the invitee's email forever if
  they never sign up; consumed password-reset tokens are kept (not deleted); cook-events and
  friendships accumulate with no expiry. *Why flagged:* data-minimization items for a future
  privacy pass, not urgent. *Where:* `app/models/handoff.py`, `password_reset.py`,
  `cook_event.py`.

### Auth & permissions

- **User-supplied image URLs are rendered as `<img src>` with only avatar-scoped
  validation.** `photo_url` (avatars, #33) is now validated to a Cloudinary HTTPS host,
  because it's shown to anyone who sees the user's name and an arbitrary URL is a
  viewer-IP tracking pixel. But `recipe.cover_photo_url` and `post.photo_url` are still
  accepted as arbitrary strings and rendered the same way (Browse, feed) — same
  tracking-pixel class, unguarded. Not XSS (React `<img src>` won't run
  `javascript:`/`data:` script). *Why flagged:* the real fix is one shared validator (or
  an image proxy) applied to every user-supplied image URL, not per-field patches.
  A third entry point nearly opened in #98: `PostUpdate` accepted `photo_url` with no host
  check, which would have let an author repoint an existing post's image at any third-party
  URL that then loaded in every friend's browser. It was dropped from the schema instead —
  the right call there for a product reason too (a different photo is a different meal) — but
  dropping a field is not a fix for this class, and the next schema to accept an image URL
  will need the same catch.
  **UPDATE (#106): the shared validator now exists, and it is applied on TWO of the four
  entry points.** `app/services/media.py` holds the rule (`require_our_image_url`: HTTPS +
  a host ending `.cloudinary.com`), `PATCH /auth/me` was refactored onto it, and
  `PATCH /posts/{id}` — which re-accepted `photo_url` when the owner reversed #98 — goes
  through it too. So the "one shared validator" half of this item is DONE. What remains is
  the half that was always the bigger hole: **`POST /posts` and `POST /recipes` still accept
  an arbitrary string**, which means an edit is now stricter than a create, and the tracking-
  pixel path is still open at the point where most photos actually enter. Two reasons it
  wasn't closed in the same pass, both worth weighing rather than inheriting: a large number
  of existing tests create posts and recipes with `https://img.test/...` URLs (mechanical to
  fix, but it is a wide diff on a shipping branch), and tightening a CREATE can reject data
  from an older deployed client, whereas tightening an EDIT only rejects a request nobody's
  client makes. Closing it is a small, self-contained task: import the same function in
  `create_post` and `create_recipe`, update the fixtures, and the class is gone.
  *Where:* `app/services/media.py` (the rule), `app/routers/auth.py` + `app/routers/posts.py`
  `update_post` (both guarded), vs `app/schemas/recipe.py` `cover_photo_url` +
  `app/schemas/post.py` `photo_url` on CREATE (still unguarded); render sites
  `frontend/src/components/{Avatar,CoverImage,PostCard}.jsx`.

- **Signup leaks account existence; forgot-password deliberately doesn't.** Signup returns
  "Email already registered" (confirms an account exists), while forgot-password always
  returns 204 to avoid enumeration. *Why flagged:* an inconsistency to know about if
  enumeration ever matters. *Where:* `app/routers/auth.py`.

### Frontend / state

- **UserProfile's "nothing to see" nudge can disagree with the grid in one benign
  direction.** The warm empty-state gate uses `recipe_count`/`post_count` from
  `GET /friends/profile/{id}`, which *counts* an individually-handed recipe; the grid
  endpoint (`GET /recipes/users/{id}`) *hides* handed recipes (`is_grantee=False`). So a
  non-friend holding a handoff to the owner's only otherwise-hidden recipe sees the tabs
  with an empty grid instead of the nudge. *Why flagged:* it's cosmetic-only and **never a
  leak** — the grid rule is a strict subset of the count rule, so "nudge shown" always
  means both grids are truly empty; it can never hide a visible item. Left as-is rather
  than over-engineered; revisit if it ever confuses a real user. *Where:*
  `frontend/src/pages/UserProfile.jsx` (`nothingVisible`); counts in
  `app/routers/friends.py` (`user_profile`) vs grid in `app/routers/recipes.py`
  (`user_recipes`).

- **Posts `post_count` can exceed the 30 the Kitchen Posts tab renders.** The You-page
  posts count comes from `GET /friends/profile/{id}` (unbounded count of the user's
  posts), but the Kitchen Posts tab loads `GET /posts/users/{id}` which caps at 30 with
  no load-more. So a user with >30 posts sees the true count but can't scroll to all of
  them. *Why flagged:* cosmetic + beta-irrelevant today (no one has 30 posts), but it'll
  read as a bug at scale — fix with pagination/load-more on the posts grid (and mirror it
  on the recipes grid, which has the same 30-cap since #69). *Where:*
  `app/routers/posts.py` (`user_posts` FEED_PAGE), `frontend/src/pages/MyRecipes.jsx`
  (posts tab, no load-more); count in `app/routers/friends.py` (`user_profile`).

### Infra & deployment

- **New migrations that ALTER an existing FK must repeat a specific pattern** (a
  `NAMING_CONVENTION` dict + `batch_alter_table`) or they break local SQLite replay while
  passing on prod Postgres — a silent dev/prod divergence. Only relevant when you write such
  a migration. *Where:* `alembic/versions/0894735d3ccd_*.py`, `bba3856b2139_*.py` (the pattern);
  fixed under task #31.

- **No one-click rollback.** `workflow_dispatch` redeploys HEAD; rolling back means reverting
  the commit. The CI gate runs against in-memory SQLite, so Postgres-specific issues can
  still reach prod (only the migration step touches the real DB). *Where:*
  `.github/workflows/deploy.yml`.
