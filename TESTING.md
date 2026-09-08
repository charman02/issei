# Testing

How issei is tested, and the invariants that must never regress. If you're
delegating a change and want one file to point someone at, this is it.

## How much ships without asking (autonomy level B)

The agreed working level. Within the guardrails below, **low-risk work ships without
a per-change approval:** bug fixes, doc updates, and changes already covered by
tests — once both suites are green (locally + CI) and the pre-ship review passes.

**Always stop for explicit approval** when a change touches any of:
- the **data model** (a new/changed model, column, or migration),
- **positioning** (anything in POSITIONING.md's territory, or a claim about what the
  app is/does),
- a **new user-facing feature** (not a fix to an existing one).

Merging to `main` still deploys to prod, so the review + green-CI precondition is not
optional — level B changes *who confirms the routine cases* (the process, not a
per-change ask), not *whether the gates run*. When in doubt about which bucket a
change falls in, treat it as "stop and ask."

## The process (three gates)

1. **The suites, run locally, on every change.**
   - Backend: `pytest` (from repo root). Hermetic — each test builds its own
     in-memory SQLite DB (`tests/fixtures.py`), so it needs no `.env` and touches
     no real database.
   - Frontend: `npm test` (= `vitest run`) and `npm run build`, from `frontend/`.
   - Both are fast (~30s each). Run them; don't quote remembered counts.
   - *Local gotcha:* one backend test (`test_health_ready_proves_db_reachable`)
     does a real `SELECT 1` against whatever `DATABASE_URL` your `.env` points at.
     On a dev machine pointed at Neon it fails (no network egress) — that's
     environmental, not a regression. It passes in CI (which uses `sqlite://`).

2. **CI — the automated gate (this is what makes delegation safe).**
   - `.github/workflows/test.yml` runs both suites on every **pull request**.
   - `.github/workflows/deploy.yml` runs the same two jobs on a push to `main` and
     the `deploy` job **`needs:` them** — so **a red suite blocks the prod deploy
     before any image is built or migration runs.** Tests are no longer a thing
     someone has to remember; the pipeline enforces them.
   - (Docs-only pushes — `**.md`, `docs/**` — skip deploy entirely, by design.)

3. **The pre-ship review agents (judgment, not just green).**
   - `issei-ship-review` → the `issei-branch-reviewer` agent: an adversarial,
     read-only review of the whole diff before a `main` merge. This is what catches
     the bugs tests don't have yet (it caught a silent edit-erasure bug that all
     a green suite missed).
   - `issei-docs-check` → the `issei-docs-auditor` agent: re-measures every count in
     the docs and scans for POSITIONING violations.
   - Run **both** before merging to `main`. Green suites are necessary, not
     sufficient — the reviewer is where correctness-in-context is checked.

## Must-pass invariants

These must have a passing test **no matter what a change is for.** If a change
would break one of these, the change is wrong — not the test. If you add a feature
that touches one of these areas, extend its test; never delete the guard to go green.

Each is a real, named test today (verify with the command; don't trust this list
alone — re-run it):

1. **Read authorization: a block, then visibility, then the grant.**
   `can_view` (recipes) and `can_view_post` (posts) are the single rules, sharing one truth
   table (`_resource_is_visible`). In evaluation order: **a block between viewer and owner in
   either direction → never visible**, checked *before* `public`; then owner OR `public` OR
   (`friends` AND an accepted friend via `are_friends`); then — recipes only, orthogonally —
   an accepted handoff grant. The `friends` branch arrived with #68, the block with #85. A
   stranger gets 404 on the recipe, its scale, its cook, and it never appears in `/browse`.
   → `tests/test_sharing.py`, `tests/test_visibility.py`, `tests/test_blocks.py`

2. **Read is not write: a recipient can never edit or delete.**
   `patch_recipe` / `delete_recipe` / `handoff_recipe` filter on `user_id`. A
   grantee can read and cook, never mutate someone else's record.
   → `tests/test_sharing.py`, `tests/test_sharing_api.py`

3. **Autosuggest never leaks another user's data.**
   `ingredient-suggestions` and `field-suggestions` are scoped to the caller's own
   non-deleted recipes — a value from someone else's kitchen must not surface.
   → `tests/test_ingredient_suggestions.py`, `tests/test_field_suggestions.py`

4. **Imprecise amounts are preserved verbatim, never normalized.**
   "a dash", "3 soup spoons" survive save, scale, and display unchanged; scaling
   branches on `quantity_type` and refuses to invent precision.
   → `tests/test_scaling.py`, `frontend/src/components/RecipeForm.test.jsx`

5. **No false audio/recording claims in the UI (POSITIONING).**
   The words `voice` / `recording` / `audio` / `listen` / `in their own words`
   appear nowhere a user or screen reader can reach. Dictation is speak-to-type;
   the utterance is discarded. Guard tests assert the banned set across the mic UI.
   → `frontend/src/components/DictateButton.test.jsx`,
     `frontend/src/components/PasteRecipe.test.jsx`, `RecipeForm.test.jsx`

6. **No lineage / family tree.**
   No ancestors, descendants, roots, branches, or parent_recipe_id. Removed
   deliberately; must not creep back (the docs-auditor also scans for this).
   → covered by the POSITIONING scan + absence of the models/columns

7. **Edit round-trips every field — nothing silently erased on save.**
   The form sends its scalars unconditionally, so `EditRecipe` must seed every one
   back from the fetched recipe. A field not seeded is nulled on the next edit —
   this is a real bug we shipped-then-caught (diet/prep_time). Any new scalar on the
   form gets a seed in `EditRecipe.initialValues` AND a round-trip assertion.
   → `frontend/src/components/RecipeForm.test.jsx` ("carries ... through an edit
     round-trip")

## When you add a feature

- **New endpoint** → a test file that pins its auth (401 for anonymous where
  required) and, if it reads user data, its **scope** (invariant 1/3). If it returns
  **another person's** name, photo, recipe or post, it must either funnel through
  `can_view` / `can_view_post` or call `is_blocked` / `blocked_ids` itself (invariant 9) —
  that's the actual failure mode, not a theoretical one: `discover_people`, `user_profile`,
  `request_friend`, `friend_suggestions` and `browse_recipes` each needed a hand-written
  check, and `friend_suggestions` was missed on the first pass.
- **New surface that displays the signed-in person** (their name, email or avatar) → read it
  through `lib/currentUser.js` (`useCurrentUser()` / `readUser()`), never
  `localStorage.getItem('issei_user')` directly, and write with `patchUser` so the merge
  happens over a fresh read. Two drift bugs shipped from the direct pattern: the Home photo
  nudge that wouldn't go away, and the You page's stale monogram beside a correct avatar on the
  same user's post card. `id` and `profile_visibility` are the only sanctioned direct reads.
  → `frontend/src/lib/currentUser.test.jsx`
- **New recipe-form field** → seed it in `EditRecipe.initialValues` and add a
  round-trip assertion (invariant 7). Add it to the payload test.
- **New user-facing copy near dictation/handoff** → it's covered by the banned-word
  guards, but if you add a new screen with a mic, add the guard there too.
- **New model/migration** → `tests/test_migrations.py` must still replay clean on
  SQLite (migrations are portable, not Postgres-only).

## Coverage gaps (known, not yet closed)

Backend routers are well covered. These frontend surfaces have **no test file** and
are the first places a silent break can hide — add tests when you next touch them:
`EditRecipe`, `HandoffPage`, `ForgotPassword`, `ResetPassword`.

### Invariant 8 — a recipe-request count never reaches anyone but the cook

`PostResponse.request_count` must be `None` for every viewer who is not the post's author, and
no surface may render a zero. This is the app's first engagement metric and the easiest thing
to "helpfully" make public: it is already computed and already on the wire, so publishing it is
deleting one `if`, and two earlier design docs even recommended the public version. See
POSITIONING.md's fourth invariant for why it stays private.

Pinned by `tests/test_recipe_requests.py` — `test_the_count_goes_to_the_cook_and_to_nobody_else`,
`test_a_viewer_never_learns_that_someone_else_asked`, `test_the_feed_carries_the_same_rule` (all
assert `None`, not `0`) — and by `frontend/src/components/PostCard.test.jsx`, "shows the count
to the COOK only, and never as a zero". (`Browse` has a test file now.)
(`EditRecipe` being untested is exactly how invariant 7's bug reached prod.)

### Invariant 9 — a block beats visibility, never an accepted grant, and is always a 404

Three separable claims, all pinned in `tests/test_blocks.py`. The middle one is the one a
future contributor is most likely to "fix", because it reads as a leak until you know why.

1. **A block beats visibility, including `public`.** The check is first in
   `_resource_is_visible`, before the `public` short-circuit. Reordering it is a silent
   regression — a block that didn't outrank `public` would leave every public recipe and post
   of theirs on your screen, and no other test would fail.
   → `test_a_blocked_pair_cannot_read_each_others_PUBLIC_posts`,
   `test_a_blocked_pair_cannot_read_each_others_PUBLIC_recipes`,
   `test_blocked_posts_leave_the_browse_and_everyone_surfaces`,
   `test_blocked_recipes_leave_browse`,
   `test_friends_only_content_stops_being_readable_after_a_block`

2. **A block does NOT revoke a handoff grant that already existed. This is not a bug.**
   `can_view`'s grant branch stays open to a blocked viewer for that **one** recipe. You
   genuinely handed them that dish; it is on their Kept shelf and they may have cooked from
   it. A block means "no new contact", not "unsend" — and revoking would be the only place in
   this app where access is taken back after being given. **Do not tighten this.** Changing
   it changes a product decision, not a vulnerability. What a block *does* stop is a **new**
   grant: `handoff_recipe` refuses across a block with the same 404 an unknown user gets,
   which matters because the grant branch bypasses visibility entirely and would otherwise be
   an uncapped channel into a blocker's kitchen.
   The same line applies to a **capability token minted before the block** (owner call, #88,
   2026-09-04): a link-only invite stays claimable and an emailed invite stays acceptable,
   because the cook minted the token and chose to share it — claiming it completes an offer
   already made, and the token *is* the authorization. The cut is offer-time, not accept-time:
   anything offered before the block still lands, nothing new can be offered after it.
   → `test_a_handed_over_recipe_SURVIVES_a_block`,
   `test_a_grant_that_existed_BEFORE_the_block_still_works`,
   `test_a_block_still_hides_everything_they_were_NOT_handed` (the carve-out is exactly one
   recipe, not a hole), `test_a_blocked_person_cannot_hand_you_a_NEW_recipe`,
   `test_a_link_only_token_minted_BEFORE_a_block_is_still_claimable`,
   `test_an_email_invite_sent_BEFORE_a_block_can_still_be_accepted`,
   `test_claiming_a_pre_block_token_grants_that_ONE_recipe_and_nothing_more`

3. **Every block denial is a 404, never a 403, and never a distinct message.** A blocked
   person must not be able to detect the block from a status code, a body, or a timing
   difference in what's returned. `request_friend` and `user_profile` return the *same*
   `{"detail": "User not found"}` an unknown user gets; `POST /friends/blocks` returns 204
   whether or not a block already existed. This is a copy rule as well as a code one: no UI
   may ever say "you have been blocked".
   → `test_a_block_is_indistinguishable_from_a_private_post`,
   `test_blocking_someone_who_already_blocked_you_is_still_204`,
   `test_a_blocked_person_cannot_send_a_friend_request`,
   `test_a_blocked_pair_cannot_open_each_others_profile`

And two consequences that are easy to get backwards, both pinned:
**blocking must not delete data** the caller can't get back — the Kept shelf's prune is
permanent, so a block hides a bookmarked recipe without deleting the save row, and unblocking
restores it (`test_a_block_does_not_DELETE_your_bookmarks_of_their_recipes`, guarded against
over-correction by `test_losing_access_for_any_OTHER_reason_still_prunes`) — and **the
inbox is not exempt**, since `list_notifications` resolves an actor's name and photo with no
`can_view` to lean on (`test_blocking_clears_notifications_between_the_two`).
### Invariant 10 — `is_new` is a flag, never a filter (nothing in issei expires)

The feed returns **exactly the same posts** before and after a read-mark. `is_new` (#97) marks
a BOUNDARY so the client can draw "You're all caught up"; it must never become a reason to omit
a row. Filtering seen posts out of the feed looks like a pure win — smaller payload, less to
scroll — and no other test would fail. This is the one that catches it.

Why it's a product rule and not just a data one: a post is the top of the funnel to a handoff,
so a vanishing post takes the ask with it. Posts are also permanent records on their author's
profile. **issei is not ephemeral**, and BeReal's expiry is the one mechanic deliberately not
copied.
→ `tests/test_feed_seen.py::test_marking_seen_HIDES_NOTHING_it_only_clears_the_flag` (asserts
dish names, order AND the id set, so a filter fails on the first assertion), plus
`test_the_mark_only_moves_FORWARD`, `test_your_own_post_is_never_new_to_you`,
`test_is_new_is_None_off_the_feed_where_new_has_no_meaning`,
`test_the_everyone_tab_has_no_is_new_at_all`; and on the client
`frontend/src/pages/Feed.test.jsx` — "draws the line after the last new post, keeping the older
ones on screen", "draws ONE divider even when your own post sits among new ones".

Two model constraints break separately and each has its own test:
- **An id, not a timestamp.** `created_at` is second-granular on SQLite, so a post made in the
  same second as the mark is wrongly counted as read. A test caught the timestamp version doing
  exactly that → `test_marking_through_a_post_does_not_swallow_newer_ones`.
- **Not a foreign key.** A FK to `posts.id` would `SET NULL` when that post is deleted, resetting
  the user to "never looked" and resurfacing their whole feed as new. It is a watermark.

### Invariant 11 — a keeper count is the cook's alone, and a keeper's NAME is nobody's

Two separable claims, and the second is the one to guard hardest.

1. **The count is owner-only.** `keeper_count` is `None` — never `0` — for anyone but the
   recipe's owner, so a non-owner client is handed no number to render. Hidden at zero even for
   the cook: "0 people keep this" under your own recipe is the discouraging line the private
   count exists to avoid, and it's the default state of every recipe ever written.
   → `tests/test_recipe_saves.py::test_the_keeper_count_is_the_COOKS_ALONE`,
   `test_a_cook_with_no_keepers_gets_zero_not_None`; and
   `frontend/src/pages/RecipePage.test.jsx` — "shows nothing at zero".

2. **No keeper NAME reaches anyone, including the cook.** Keeping is a bookmark addressed to
   nobody — unlike an ask, which is addressed to the cook — so naming the keeper would change
   what keeping means and could chill it. There is no keeper-list endpoint and must never be
   one. The `recipe_kept` notification stores `actor_id` (notify() needs it for the
   never-notify-yourself check and for dedupe) but the RESPONSE nulls every actor field, so the
   name never leaves the server; the client hardcodes "Someone" as well.
   → `test_NO_keeper_names_or_list_for_anyone_including_the_cook`,
   `test_the_keep_notification_NEVER_carries_who_did_it`,
   `test_an_ask_still_names_the_asker` (the anonymity is scoped to keeps, not global), and
   `frontend/src/pages/Notifications.test.jsx` — "a keep will not print a name even if one
   arrives anyway".

Also pinned, because a repeatable act needs it: keep → unkeep → keep does not flood the cook's
inbox (`test_keep_unkeep_keep_does_not_flood_the_inbox`), and re-keeping an already-kept recipe
notifies nothing new — the endpoint is idempotent, so the notification is too.

