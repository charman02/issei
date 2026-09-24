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

- **Rate limiting: four things accepted rather than fixed (2026-09-21).** All four were raised by
  the ship gate and each is a deliberate stop, recorded so nobody re-derives them:
  1. **A distributed attacker still spends one bcrypt per guess.** The per-account limit bounds their
     PROGRESS, not their LOAD, because a correct password must never be refused — so the CPU
     protection is the per-address limit, which an address-rotating caller sidesteps. Closing this
     needs a WAF at the edge, not code; `infra/README.md` item 3 is re-justified on exactly this.
  2. **LRU eviction can flush a victim's `login:account:` bucket.** `_touch` creates a map entry per
     distinct submitted email, so churning `MAX_TRACKED_KEYS` (20,000) keys evicts a victim's bucket
     and frees 10 more guesses. ~2,000 requests per freed guess, and the per-address limit still
     binds, so it is not a practical bypass — but the eviction policy is documented as safe and this
     is the case it does not cover. (The reverse is impossible: a caller cannot evict their OWN
     bucket, since every limited route `move_to_end`s it to most-recently-used.)
  3. **`POST /feedback` and the two `/upload` routes are unlimited.** Both cost money per call (SES;
     Cloudinary quota) and both are authenticated, so they are the same shape as `/recipes/parse`
     before it got `PARSE_PER_USER`. Left out of scope deliberately — the scope was credentials,
     tokens and the LLM — so this is the honest place for them rather than a comment nobody reads.
  4. **A 429 on `/recipes/parse` is swallowed by `PasteRecipe`'s bare `catch {}`** and falls through
     to the local line parser. That is CORRECT and consistent with the route's "never fail recipe
     capture" contract — noted so nobody later "fixes" it into a blocking error and turns a graceful
     degrade into a wall. It does mean `what="recipes parsed"` is copy no user will ever see.

- **~~No rate limiting anywhere~~ — CLOSED for credentials, OPEN for the social writes
  (2026-09-21).** `app/services/rate_limit.py` now bounds login, signup, forgot-password,
  reset-password, the invite-token read/claim pair, the push-rotate write, the cron trigger
  and `/recipes/parse`. What remains unthrottled is the part the DIRECTORY created:
  **`GET /friends/discover`**, where bulk name harvesting is still a single loop, and
  **`POST /posts/{id}/request`**, a write into someone else's inbox — which is why that
  notification is deduped while unread, a mitigation that bounds the inbox and not the
  request rate. *Why still flagged:* the cheapest remaining thing that turns an accepted
  disclosure into an abuse vector. Both are per-user rather than per-address problems, so
  they want a different key than anything shipped so far.

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

- **RESOLVED (#107): `notify_people` has a consumer.**
  Was: an API-visible switch that nothing read, because `notify()` never reached `push.py`.
  `app/services/notify_push.py` is the seam this entry said was awkward, and the awkwardness was
  real — it is resolved by committing the row FIRST and pushing from a FastAPI `BackgroundTasks`
  task on its own session, so nothing is ever sent for a transaction that rolls back and no user
  waits on a third party. Both traps this entry flagged were live and are now covered: the
  `recipe_kept` anonymity IS re-enforced at the push boundary (twice, in `deliver` and again in the
  copy table — a mutation test found the first layer unpinned and there is now a test that isolates
  it), and the switch has a UI control plus a test that it changes delivery rather than only that
  it exists. Left here as a closed entry rather than deleted, because the ORDERING argument is the
  reusable part: a notification that cannot be recalled must not precede its own commit.

- **RESOLVED 2026-09-18: both columns are gone (migration `e6f7a8b9c0d1`).** (#107, #108)
  `users.notify_prompt` and `users.notify_posts` are dropped, the model no longer declares them, and
  `test_migrated_schema_matches_models` is green with no exemption ever having been added to it.
  Kept as a closed entry because the SEQUENCE is reusable and the plan for it was wrong twice — the
  next person removing a column from a hot table needs both halves of that.

  Shipped as: release 1 `c4e65ba` (add the replacement, stop reading), release 2 `071adab`
  (`exclude_properties` — the ORM stops naming them), release 3 `e6f7a8b9c0d1` (drop + delete the
  declarations in one commit). **Release 2 had to be RUNNING IN PRODUCTION before release 3 merged**,
  which is the constraint the whole thing exists for, not a formality.

  *Why three releases.* The ORDER in `.github/workflows/deploy.yml`: `alembic upgrade head` runs, THEN the
  image is built and pushed, THEN ECS rolls. So the old task serves traffic against the new
  schema for the whole window — and its model still selects `notify_prompt`, which means dropping
  the column in the same deploy is `ProgrammingError` 500s on every authenticated request, on a
  `desiredCount: 1` service, with `/health` still green because it never touches `users`. Nothing
  would alarm; the deploy would look clean. Worse, a health-check failure would roll ECS back to
  an image that cannot talk to the database at all.
  *WHAT THE PLAN GOT WRONG — TWICE. Recorded in full, because both failures were in the reasoning
  rather than in any code, and the second one was invisible to every test:*

  **Release 2.** Originally specified as "delete
  `notify_prompt` AND `notify_posts` from `app/models/user.py`. No migration." **That fails
  `tests/test_migrations.py::test_migrated_schema_matches_models`** — the columns are still in the
  migration chain, so removing them from `Base.metadata` IS drift, reported as `remove_column` on
  both. Which is the same guard this entry cited as the reason step 2 could not be folded into step
  1, *without noticing step 2 trips it too*. Self-contradictory for two releases; caught only by
  running it.

  What release 2 actually is: keep both `mapped_column`s on the Table and add
  `__mapper_args__ = {"exclude_properties": [...]}`. The columns stay in `Base.metadata` (guard
  green) and leave the mapper entirely, so no statement the app emits names them — which is the
  real precondition for release 3. Two alternatives were measured and rejected: `deferred=True`
  alone still leaves both in `INSERT ... RETURNING` (that clause fetches server defaults; deferral
  does not govern it), so signup would break when release 3 lands; and `deferred=True` with
  `server_default` removed from the model makes SQLAlchemy send an explicit `NULL` for a NOT NULL
  column, breaking signup immediately.

  **Release 3 (`e6f7a8b9c0d1`).** One migration dropping both inside a `batch_alter_table`, with the
  two `mapped_column` lines and the `__mapper_args__` deleted in the same commit.

  *A THIRD thing nothing caught, found by mutating release 3's own migration.* Deleting
  `server_default` from the DOWNGRADE passed the entire suite, because
  `test_chain_downgrades_back_to_base` runs on an EMPTY database — where re-adding a NOT NULL column
  succeeds with or without a default. On a table with rows it fails outright, and production's
  `users` is never empty. A downgrade is what you reach for when a deploy has already gone wrong, so
  "the rollback also fails" is the worst possible time to learn this.
  `test_a_downgrade_that_re_adds_a_NOT_NULL_column_works_on_a_NON_EMPTY_table` seeds a row first and
  now covers it. **The lesson generalises past these two columns:** any downgrade that re-adds a NOT
  NULL column needs a `server_default`, and only a seeded table proves it.

  *The deprecated ALIASES are NOT part of this sequence, which the first version of this entry also
  got wrong.* It said release 2 was "the moment to delete both deprecated aliases from
  `AccountUpdate`, their handling in `update_me`, and the two older branches of
  `promptMeOf`/`friendPostsOf`". They are independent: `update_me` maps both aliases onto
  `notify_prompt_me`/`notify_friend_posts` and never writes either dead column, so they cannot block
  the drop. They are on a different clock — they protect against a stale CLIENT (a long-lived SPA tab
  or a cached `issei_user` written by an older build), not against the deploy window. Both columns
  shipped 2026-09-16/17, so "no build that old is plausibly still live" is not yet true, and removing
  them now would silently discard someone's opt-out, which is the one failure they exist to prevent.
  Retire them on their own schedule, well after release 3.
  They are deliberately merged into ONE sequence: `notify_prompt`'s removal was already pending when
  `notify_posts` joined it a day later, and running two interleaved three-release cleanups over the
  same table is how one of them gets forgotten.
  Neither can be folded into release 1: dropping the column while release 1's task is still
  serving is the outage above, and stopping the model from declaring it in release 1 would trip
  `tests/test_migrations.py::test_migrated_schema_matches_models`, which forbids ANY
  model/migration drift and has no exemption mechanism — punching the first hole in an absolute
  guard to save a deploy is the worse trade.
  *Why it's here and not just a comment:* a column nothing reads is the exact defect this file has
  an entry about elsewhere, so it needs an explicit expiry rather than looking like an oversight.
  Found by the ship gate.
  *Where:* `alembic/versions/b3c4d5e6f7a8_*.py`, `app/models/user.py`, `app/schemas/user.py`,
  `frontend/src/components/NotificationSettings.jsx`.

- **ACCOUNT EMAIL UNIQUENESS IS CASE-SENSITIVE, AND THE DURABLE FIX IS STILL OPEN.** Found by the
  ship gate on the handoff-grant fix below, and it is the root cause under two of that round's
  findings rather than a curiosity. `users.email` is a plain `unique=True` column, signup's duplicate
  check is `User.email == user_in.email`, `login` and `PATCH /auth/me` compare the same way, and
  Pydantic's `EmailStr` normalises only the DOMAIN (measured: `Ana@X.com` → `Ana@x.com`). So
  `ANA@x.com` and `ana@x.com` are **two independently loginable accounts** — an honest duplicate
  signup produces that, and so does anyone who wants it deliberately.

  Everything that resolves a person BY ADDRESS therefore has an ambiguous input. `handoff_recipe` and
  the repair migration now each refuse to guess (exact match preferred; a genuine tie binds to
  nobody; every candidate is checked for a block), which makes the ambiguity SAFE but does not remove
  it — and it means two people can be told "that address is taken" and "that address is free" about
  the same mailbox. *The durable fix* is a functional unique index on `lower(email)` plus
  case-insensitive comparisons in `signup`, `login` and `PATCH /auth/me`. *Why it is not done here:*
  it is a data-model change that can FAIL on a database that already contains a twin pair, so it
  wants a look at prod first (`SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) >
  1`) and a decision about which of a colliding pair wins. Owner's call. *Where:*
  `app/models/user.py`, `app/routers/auth.py` (`signup`, `login`, `update_me`).

- **A dead grant can still be created by an EMAIL CHANGE.** `PATCH /auth/me` sets
  `current_user.email` and does NOT run signup's claim loop, so a pending invite to `new@x.com` plus
  someone changing their address to `new@x.com` reproduces exactly the shape the entry below declares
  fixed: pending, `to_user_id` NULL, address belongs to an account, unreachable unless the cook still
  holds the token. *Deliberately not fixed by adding the claim loop there*, which looked obvious and
  is worse: signup can claim an address once, while an email change can be repeated from one
  authenticated account, turning the loop into a way to harvest pending invites by cycling through
  guessed addresses. Closing it properly means claiming only on a VERIFIED address, and signup
  doesn't verify email ownership either (see the entry above about that). Rare in practice — it needs
  a pending invite to the exact address someone then moves to. *Where:* `app/routers/auth.py`
  (`update_me`).

- **The deploy window can mint one duplicate grant, and it self-heals.** The pipeline runs `alembic
  upgrade head` BEFORE it pushes the image, so for a minute or two the OLD code serves traffic
  against repaired rows. Old `handoff_recipe` dedupes on `Handoff.to_email == to_email` exactly, and
  a repaired row has `to_email` NULL — so a re-send by email inside that window mints a second
  pending row for the same (recipe, person). The new image then heals whichever the `.first()` finds.
  Consequences are cosmetic: `/recipes/shared` dedupes through `Recipe.id.in_(...)`, `can_view` uses
  `.first()`, and the only visible artefact is `RecipeResponse.shared_with_count` over-counting for
  the cook. Recorded rather than fixed because the fix is a unique constraint on (recipe, grantee)
  that the link-only path deliberately cannot satisfy — each link is an independent grant.

- **`GET /friends/suggestions` now sees email-addressed handoffs.** It is seeded from the handoff
  graph on `to_user_id`, which email-addressed grants never used to have — so binding them produces
  friend suggestions where there previously were none. Believed benign (it is the same behaviour the
  `to_user_id` path always had, and the block filter there is intact, pinned by `test_blocks.py`),
  but it is a real behaviour change that nothing in the branch tests or mentions, found by the ship
  gate. *Where:* `app/routers/friends.py::friend_suggestions`.

- **RESOLVED 2026-09-23: a handoff addressed to an EMAIL that already had an account was
  unreachable in-app, forever.** ("Resolved" for every shape the app WRITES — the two entries above
  name the edges that survive: an email change can still create one, and a case-twin pair makes the
  address ambiguous rather than dead.) The fix bound the resolved account and accepted the grant,
  exactly as the `to_user_id` path always did — `handoff_recipe` now has ONE `recipient` variable
  where it had two, and the split between them was the bug. Four things came out of doing it, each worth
  keeping:
  - **The signup auto-accept compared `Handoff.to_email == new_user.email` EXACTLY**, while the send
    side has lower-cased since #105. So "Ana@x.com" for an account opened as "ana@x.com" minted a
    dead row by a second, independent route. Now case-insensitive on both halves.
  - **Signup's auto-accept notified nobody**, which did not matter while the bug existed (the only
    way to reach the notifying `accept_handoff` was to already have an account, i.e. the broken
    path). With the send side fixed, that loop is the ONLY place a pending email invite is ever
    claimed — so without a `recipe_claimed` there, the fix would have silently removed the cook's
    one signal that their recipe landed, in the founding shape of the product. It notifies now.
  - **`POST /recipes/handoffs/{id}/accept` is effectively unreachable for anything the app writes
    today**, because a pending unbound row now only exists for an address with NO account, and
    signup claims that the moment it appears. It is KEPT: it still serves pre-fix rows, and three
    tests (`test_blocks`, `test_owner_only_writes`, `test_handoff_notifications`) now construct that
    legacy shape by hand rather than through the route, so the #88 exemption and the #107 block
    suppression stay covered instead of quietly testing a shape nothing writes. Removing the route
    is a separate decision; don't do it without checking the `handoffs` table for unbound rows.
  - **Migration `b9d3f07a4c81` repairs the rows already in the database** — UPDATE-only, idempotent,
    and tested against all five shapes (dead, case-mismatched, stranger-pending, already-accepted,
    link-only) in `tests/test_handoff_grant_repair.py`, which imports the statement from the
    migration rather than paraphrasing it.
  *Where:* `app/routers/recipes.py`, `app/routers/auth.py`,
  `alembic/versions/b9d3f07a4c81_bind_dead_email_handoff_grants.py`.

  *The original entry, kept because the diagnosis is the useful part:*
  `handoff_recipe` resolves `to_email` to a `User` for its two permission checks (#105) but
  deliberately does NOT bind the grant to that account — it stays `state="pending"` with
  `to_user_id` NULL, which the comment there explains as "a different feature". The consequence
  was not visible until this task went looking: `GET /recipes/shared` filters on `to_user_id`, and
  `can_view`'s grant branch requires both `accepted` AND a matching `to_user_id`, so the recipient
  can neither see the invite nor read the recipe. The signup auto-accept in `routers/auth.py`
  matches `to_email` on account CREATION, which for an existing account ran long before this row
  existed. So the grant is dead unless the sender also texts the invite link — and because the
  recipient can't reach it, #107 deliberately does not write a `recipe_arrived` notification on
  that path (a notification linking to a 404 is worse than silence).
  *The fix is roughly one line* — bind the resolved account and mark it accepted, exactly as the
  `to_user_id` path does. *Why it's a ledger entry:* it changes what the app's signature endpoint
  STORES (an instant grant instead of a pending invite), which moves the dedupe key and the state
  the recipient sees, and the existing comment fenced that off on purpose. Owner's call.

  *How it actually went:* the one line was right, and the dedupe-key move was the real work — the
  idempotency lookup now matches EITHER a bound row or a legacy row still keyed on the address, or
  the first re-send after the fix would have minted a second grant for the same pair. The test named
  above flipped as predicted. The estimate missed the two consequences above (silent auto-accept,
  the now-unreachable accept route), both found by existing tests going red rather than by reading.

- **RESOLVED 2026-09-18: GitHub's scheduler CAPS this workflow at 5-7 runs a day, and raising the
  declared frequency did nothing. The trigger is now in-process.** (#89, re-measured)

  *What the first version of this entry said, and got wrong twice.* It was titled "drops ~75% of its
  runs, and nothing inside the app can fix that", and prescribed raising the cron from hourly to
  every 10 minutes on the reasoning that more attempts would survive a 75% loss rate. Both halves
  were false:

  1. It is not a ~75% DROP RATE, it is a CAP. Runs delivered per day, off the Actions API on
     2026-09-18, with the 10-minute cron shipping on the 16th:

    hourly (target 24/day)          every 10 min (target 144/day)
      Sep 11  6   Sep 14  5           Sep 17  6
      Sep 12  7   Sep 15  5
      Sep 13  7
      n=5, mean 6.0/day = 25%         n=1, mean 6.0/day = 4%

     Split at the moment `ea85076` changed the cron (2026-09-16 14:44 UTC), complete UTC days only —
     Sep 10 and Sep 18 are partial data and Sep 16 is mixed. **The 10-minute side is ONE day.** Enough
     to say the mitigation bought no improvement; not enough to prove "cap" over "a quieter week".
     The in-process trigger is justified either way: both eras deliver 5-7 runs a day against a
     four-hour window.

     Five to seven a day before and after. Asking for six times as many runs delivered no more of
     them, so the mitigation bought nothing — and the comment it left in the workflow,
     asserting that the frequency was doing real work, was false the day it landed. Median gap 245
     minutes, worst 459, against a four-hour send window.
  2. Something inside the app CAN fix it, and now does: `app/services/prompt_scheduler.py` ticks on a
     real interval inside the ECS task, started from the app's lifespan.

  *Why an in-process tick is safe here, having been rejected before.* The objection was that it
  double-fires during a rolling deploy (minHealthyPercent 100 / maxHealthyPercent 200 overlaps two
  tasks) and breaks above `desiredCount: 1`. True and irrelevant: `prompt_sends` has a UNIQUE on
  (user_id, local_date) and `run_daily_prompt` catches the `IntegrityError`. Correctness was put in
  the DATABASE rather than the trigger precisely so the trigger could be anything — including two at
  once. The constraint that made a re-runnable endpoint safe is the same one that makes this safe.

  *The cron STAYS as a second trigger.* Both are idempotent, so they cannot interfere, and the cron
  covers the one thing the loop cannot: the window where the task is restarting or a deploy is
  mid-roll. Two unreliable triggers that can't double-send beat either alone.

  *Still open, and still the properly-decoupled answer:* EventBridge Scheduler pointed at the same
  URL. Blocked on the same hazard as before — the deploy pipeline never runs `cdk`, and the CDK
  task-definition Family is byte-identical to the one `deploy.yml` re-renders, so a `cdk deploy`
  merely to add a schedule would point the live service at whatever image is in the operator's
  working tree. Adding the rule outside CDK works but puts infrastructure outside the repo. Much less
  urgent now that the primary trigger runs in-process — though note that is an argument from
  design, not from observation: the loop has unit tests and has never yet run in production.
  *Where:* `app/services/prompt_scheduler.py`, `app/main.py` (lifespan),
  `.github/workflows/daily-prompt.yml`, `infra/`.

- **The daily prompt can repeat the same sentence forever — and #108 REMOVED THE ACCIDENT THAT
  LIMITED IT.** (#89, sharpened #108)
  Until #108 the nudge fired only when a friend had posted something unseen, which is a bug in
  its own right (it made the retention engine circular) but which also, by accident, kept the
  repetition bounded: a quiet week sent nothing. The prompt is now gated on the recipient's OWN
  absence, so someone who never posts and never opens the app gets the same line every evening,
  indefinitely. That is the correct behaviour for a prompt and the wrong behaviour for a
  relationship. Capping consecutive unanswered prompts — or varying the line — moves from
  nicety to real follow-up work with this change, and `prompt_sends` already records every
  send per local date, so the data to count them is there.
  **LARGELY ANSWERED BY #109, and by the owner rather than by a cap.** The remedy this entry asked
  for was "cap consecutive unanswered prompts"; what shipped instead is
  `notify_prompt_every_days` — the person chooses a minimum gap in their own local days (1 / 3 / 7
  in the UI), so a nightly line becomes a weekly one if that is what they want. That is a better
  answer than a cap for the same reason the whole #108 fix was: it hands the decision to the person
  whose evening it is, instead of the app deciding how much nagging is acceptable on their behalf.
  What REMAINS is the narrow case the setting cannot reach: someone on "Every day" who never posts
  and never opens the app still receives the same sentence indefinitely. Varying the line, or
  backing off after N unanswered prompts, is still open — and `prompt_sends` now has a
  `days_since_last_prompt` helper, so the data to count them is not just present but already read.
  *And be precise about what kind of obligation this is,* because the older wording here leaned on
  `prompt_payload`'s docstring arguing against "asking for attention without offering anything" —
  reasoning POSITIONING's rule 2 has since explicitly re-scoped (asking for an ACTION is permitted;
  it is asking for ATTENTION that is not). So this is a PRODUCT-TONE call, not a positioning
  violation: nothing in POSITIONING forbids the prompt repeating, and a future reader should not
  mistake this entry for a rule. It is a judgement that a line repeated nightly for a month stops
  reading as a nudge and starts reading as nagging. Flagged by the docs gate.
  Original entry follows.
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
  allowed to be, and nothing had reached a real inbox while the secrets were unset (the client half
  shipped 2026-09-10; the parameters were created 2026-09-15, so this is now gated on a deploy and
  one phone rather than on configuration).
  *Where:* `app/services/prompt.py`, `app/models/prompt_send.py`.

- **RESOLVED 2026-09-17 (PARTIALLY): end-to-end push delivery has now been observed once.** (#89)
  A production daily prompt arrived on an installed iOS home-screen app, and tapping it opened the
  composer. That closes the leg nothing in CI can reach.

  **BE PRECISE ABOUT WHAT IS AND ISN'T PROVEN, because the whole value of this entry was that
  precision.** Proven: the TRANSPORT — server → FCM/APNs → an installed iOS device → the service
  worker's `notificationclick` navigating. NOT proven: any individual notification other than the
  daily prompt (the seven `NOTIFICATION_TYPES` and the friend-post push share that transport but
  each has its own copy and its own URL, and none has been watched arriving), and Android entirely.
  `POSITIONING.md` rule 6 carries the same split and is the authority on what may be SAID:
  "push notifications work" is now sayable; "a recipe-request notification arrives" is not, yet.

  *Kept rather than deleted because the reasoning is reusable:* every other leg was tested and the
  one that left the building was not, and that was the one deciding whether the feature existed at
  all. `tests/test_push.py` decrypts what the sender produces from the RECEIVER's side (which is how
  the zero-salt bug was caught), the subscribe/rotate/prompt routes are verified live against a
  running API, and `lib/push.js` is unit tested against a stubbed `PushManager` — but **headless
  Chromium refuses to subscribe at all**: `pushManager.subscribe` throws `AbortError: Registration
  failed - permission denied`, since there is no push service behind it. So this could never be
  automated on this machine; it needed one real phone, once, and now it has had one.
  *Where:* `frontend/public/sw.js`, `frontend/src/lib/push.js`, `app/services/push.py`.

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
  be closed, one grievance and a year of grievances are the same row — though only PER SUBJECT since #87 part
  two widened the dedupe key, and the sharper version of the worry is the other side of that: **one
  reporter can now hold N simultaneously-open cases against one person** (one per post, one per
  recipe, plus one person-level), and since nothing can close any of them the table grows per-subject
  rather than per-pair. The 8000-character append bound no longer bounds a reporter's total footprint
  against one target. That is a real consequence of a deliberate change and nobody would rediscover
  it from the code, so it is written down here rather than treated as a surprise later.

- **A report can name a soft-deleted recipe, and the two subject types diverge after deletion.**
  (#87 part two, raised by the ship gate, deliberate.) `report_user`'s recipe check has no
  `deleted_at IS NULL`, against the project-wide "all queries must filter" convention. That is
  right here — you saw it, they deleted it, and the case survives so whoever reads it can still
  see WHAT was reported — and since the 2026-09-24 drop it is the ENTIRE behavioural difference
  between the two subject types: a soft-deleted recipe still BELONGS to its author, so it resolves
  and its subject is kept forever, while a hard-deleted post cannot resolve at all, so its subject
  is dropped at report time (and the FK's `SET NULL` would have dropped it later anyway).
  `tests/test_reports.py` pins the acceptance in both directions, so the next person neither
  "fixes" the missing filter silently nor is surprised by the difference. *Why flagged:* it is a
  deliberate exception to a rule stated everywhere else, which is exactly the kind of thing
  somebody reasonably tidies up.

- **CLOSED 2026-09-24 — the report subject became a HINT rather than a precondition, which took
  three problems out at once.** Kept here because the sequence is the useful part. The first version
  of #87 part two checked a subject for EXISTENCE only, which a ship gate broke with one curl:
  `{user_id: <innocent>, post_id: <somebody else's vile post>}` → 204, stored as *reporter →
  innocent, inappropriate, post 57*, on the one table whose entire purpose is that a human reads it
  and acts. The obvious fix — also check OWNERSHIP, 404 otherwise — closed the frame-up and bought
  two new problems: (1) a 204/404 split answered "does post N belong to A?" for any pair, to any
  signed-in caller, which with #80's enumerable directory maps the AUTHOR of every post and recipe
  id in the app including private ones; (2) `DELETE /posts/{id}` is a HARD delete and `toUserMessage`
  passes a router's `detail` through untouched, so an author deleting the post between the tap and
  the send made a reporter read **"Post not found"** about a photo that had been on their screen a
  second earlier — which POSITIONING forbids outright, and which makes deleting the content a way to
  dodge the report. **The owner's call was to DROP an unresolvable subject rather than refuse it.**
  The report lands as a person-level one, the answer is always 204, the frame-up stays closed (the
  attack needed the app to VOUCH for the pairing, and it no longer does), the oracle is gone rather
  than narrowed, and no reporter is ever refused. *What is still true and worth knowing:* this route
  has **no rate limit** — `app/routers/friends.py` imports no limiter at all — so the per-subject
  flooding bound above rests entirely on the dedupe reading the RESOLVED ids, which is what makes
  invented ids collapse onto one case. Pinned by `test_unresolvable_subjects_collapse_onto_ONE_case`;
  reading `body.post_id` there instead is a mutation that fails loudly (a FOREIGN KEY violation,
  not a soft assertion).

- **After a block, the only reporting surface left is a recipe you were already handed.**
  (#87 part two, partially closed 2026-09-23 after a ship gate.) `/u/{id}` and `PostPage` 404 across
  a block, so neither can carry the ⋯ — but an accepted handoff grant SURVIVES a block (#85), so a
  grantee can still open the recipe, and `RecipePage` used to hide the menu entirely when
  `GET /friends/profile/{id}` 404'd. That reintroduced at the UI exactly what the backend's
  no-block-gate rule exists to prevent: the block becoming cover for the person who earned it.
  `SafetyMenu` now renders with NO person name when a subject is set — the report item names the
  THING ("Report this recipe") and the BLOCK item is suppressed, because a block genuinely cannot be
  offered without naming who it lands on. So the reportable surface survives a block and the
  unnameable act does not. Still owed: `author_first_name` on `RecipeResponse` would remove the
  fetch and restore the block item too (see the extra-fetch entry). The rejected alternative was
  falling back to `origin_attribution`, which is the BYLINE — frequently not the account holder —
  so it would name the wrong person on a safety control.
  And nobody can tell which reports have been dealt with. *Where:*
  `app/routers/friends.py::report_user`, `app/models/report.py`.

- **`RecipePage` issues an extra request per non-owner view, for a first name.** (#87 part two, low
  severity, raised by the ship gate.) The safety menu needs the cook's name, `RecipeResponse` carries
  none, and `origin_attribution` is the BYLINE — whoever the dish came from, often not the account
  holder — so using it would name the wrong person on a safety control. The fetch is
  `GET /friends/profile/{id}`, it fires for every non-owner viewer whether or not they ever scroll to
  the control, and it fails silently by design. So the cost is a wasted round trip on the app's
  most-read page rather than a defect. **The fix is a schema change, not a patch:** put
  `author_first_name` on `RecipeResponse` the way `PostResponse` already carries it — which means
  populating it in every path that serialises a recipe (get, browse, kept, both profile grids), which
  is why it was not done inside a safety feature. *Where:* `frontend/src/pages/RecipePage.jsx`,
  `app/schemas/recipe.py`.


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

- **JWT has no revocation.** (The "and login isn't rate-limited" half of this entry was
  closed on 2026-09-21 — see `app/services/rate_limit.py`; password guessing is now bounded
  at 10 failures per account and 30 per address per 15 minutes.) Tokens are still valid until
  they expire no matter what, and changing/resetting a password does NOT log out existing
  sessions. *Why flagged:* standard for v1, but a real gap to close before scale — "I was
  hacked, I changed my password" won't evict an attacker, and rate limiting does nothing
  about a token already stolen.
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

- **A PASS-ON LINK MINTED WHILE A RECIPE WAS `public` KEEPS WORKING AFTER THE COOK MAKES IT
  PRIVATE, AND THE COOK DID NOT MINT IT.** (#78, accepted on ship.)
  #88's locked rule is that the token IS the capability and one minted before a restriction stays
  claimable — because the cook chose to send it. Re-sharing keeps the first half and weakens the
  second: a reader may pass on a `public` recipe with no approval, so the enduring link was minted
  by somebody else. Publish for a day, get re-shared, go private, and that link outlives the
  decision. **Why it was accepted rather than fixed:** while the recipe WAS public, anyone signed in
  could already read it, copy it out, or screenshot it, so the marginal loss is the account-free
  convenience rather than the content. And the alternative — a token whose validity is re-checked
  against current visibility — would be the app's first CONDITIONAL token, breaking the one sentence
  the whole invite model rests on. *The real fix is grant revocation*, which this app has none of
  (a block deliberately doesn't unsend either, #85) and which is a feature rather than a patch.
  **AND IT MEANS THE ONE RULE HOLDS AT MINT TIME ONLY — say it that way.** "A resharer may never
  grant more than they could cause by other means" is true at the moment the link is made and
  becomes false the instant the cook narrows the recipe: from then on an outstanding resharer token
  grants strictly more than that resharer could cause by any other route. The unqualified "never"
  is too strong, and the gate was right to catch it.
  *Why flagged:* it is a genuine narrowing of what "Only me" protects, arrived at by ordinary use
  rather than by abuse, and nobody would rediscover the reasoning from the code.

- **A cook has no way to see who holds a pass-on permission, or to take one back.** (#78.)
  `GET /recipes/pass-on-requests/incoming` is PENDING-only — a to-do list, not a history — so once
  a cook says yes, that yes is invisible and permanent. There is deliberately no list of approved
  askers (the same discipline as no keeper list, ever) and no revoke. Both are defensible while the
  app is small and both stop being defensible at scale; they go together with the revocation entry
  above, since a revoke with nothing to point it at is unusable. *Fix:* an approved-list surface on
  the recipe, owner-only, with a revoke that drops the permission but — per #85 — leaves grants
  already minted alone.

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
  spends money and the user waits (up to 45s client / 25s server timeout). **There is a
  ceiling in code now** — `rate_limit.PARSE_PER_USER`, 20 an hour keyed per USER rather than
  per address, since the route has a session and the spender is therefore known (2026-09-21).
  Still **no caching**, so the same text pasted twice is paid for twice, and the per-hour cap
  bounds one account rather than total spend across many. *Why flagged:* a cost surface to
  watch as usage grows, now bounded rather than open-ended. *Where:*
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

- **`feedback@issei.app` IS NOW THE CONFIGURED UNSUBSCRIBE TARGET, AND TWO THINGS OUTSIDE THIS REPO
  STILL HAVE TO BE TRUE.** (#107, set in #87 part two)
  `FEEDBACK_NOTIFY_EMAIL=feedback@issei.app` is in the task definition and the CDK stack — a ROLE
  address forwarding to a person, because this repo is public and the value rides in every
  announcement's headers anyway. **Still owed, and neither is visible from the code:** (1) that
  address must FORWARD to an inbox somebody reads, or the unsubscribe fails silently exactly as
  before; (2) it must be a VERIFIED SES identity in us-west-2 — the account is sandboxed, so the
  RECIPIENT has to be verified too, and until it is, #101's feedback mail degrades to a logged no-op
  while notes keep saving. Note the second-order effect a ship gate flagged: setting this **lifted the
  announcement hard block**, because `looks_unmonitored("feedback@issei.app")` is False. That check
  now guards the SHAPE of whatever is configured rather than standing as a stop, so the only thing
  between here and a real broadcast is the SES verification. Pinned for config parity by
  `tests/test_deploy_config.py` (it was unpinned when first added — the parity tests iterate a curated
  list, not the task definition's own names).

  *History, because the shape of the original defect is why the check exists at all.* The header
  pointed at `SENDER_EMAIL` and ALSO carried `List-Unsubscribe-Post`, i.e. it claimed ONE-CLICK
  while aiming at a mailbox nobody reads. The `-Post` header is gone (RFC 8058's one-click flow
  specifies an `https:` URI, so pairing it with a `mailto:` was outside the spec *and* advertised
  an automation nothing performed), and the target is now `feedback_recipient()`.
  **What changed on 2026-09-23 matters more than it looks:** `FEEDBACK_NOTIFY_EMAIL` is now SET,
  so `looks_unmonitored("feedback@issei.app")` is False and the script's refusal **no longer
  fires**. That refusal was doing real work — it was the last automated thing standing between an
  operator and a broadcast whose unsubscribe link goes nowhere. What stands there now is the SES
  sandbox and nothing else. So the remaining action is not "set the variable", it is **verify the
  address in SES us-west-2 and confirm it forwards to an inbox you read** — and do that BEFORE
  requesting production access, because lifting the sandbox removes the last guard at the same
  moment it makes a real send possible.
  *Where:* `app/services/email.py` (`unsubscribe_address`, `looks_unmonitored`),
  `.aws/task-definition.json`, `infra/lib/issei-stack.ts`, `infra/RUNBOOK.md` (which carried the
  "absent, so the script will refuse" claim for a day after it stopped being true — the one place
  that wrongness had operational teeth, since an operator reads it expecting the refusal to catch a
  mistake).

- **An announcement can reach an address nobody ever confirmed, and a bounce spike can pause
  the identity PASSWORD RESET depends on.** (#107, raised by the ship gate)
  `POST /auth/signup` does no email verification — there is no `email_verified` column, no
  bounce or complaint handling, and no suppression list anywhere in `app/`. So `users.email` is
  a set of syntactically valid, never-confirmed addresses, and a broadcast mails all of them.
  The blast radius is cross-feature: a bounce/complaint spike gets the SES identity's sending
  paused, and that identity is also the Source for `send_password_reset_email` — **the app's
  only account-recovery path** — and for the feedback notification. Mitigation is procedural for
  now and belongs in the runbook: `--only` yourself first, then small batches, watching the
  account's bounce rate. A real fix is a bounce/complaint SNS topic feeding a suppression
  column, which is a feature of its own.
  `build_announcement` sets `List-Unsubscribe: <mailto:{sender}?subject=unsubscribe>` plus
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, and `sender` is `SENDER_EMAIL`, which prod
  sets to **`noreply@issei.app`** (`.aws/task-definition.json`, `infra/lib/issei-stack.ts`). Two
  problems compound:
  1. That header tells Gmail the control is ONE-CLICK, so Gmail renders its own unsubscribe button,
     the person taps it, Gmail mails `noreply@` — and if nobody reads that mailbox (a `noreply`
     local part conventionally means exactly that, and it may not even accept inbound mail) the
     opt-out **silently fails while the person believes it succeeded**. The in-app switch still
     works, but they have no reason to go looking for it.
  2. **RFC 8058 one-click requires an HTTPS target.** Pairing `List-Unsubscribe-Post` with a bare
     `mailto:` is not what that RFC describes, so the header may be ignored or counted against the
     sender rather than helping deliverability — which was the entire reason for using
     `send_raw_email` instead of `send_email`.
  *Options, all owner decisions:* drop `List-Unsubscribe-Post` and keep the plain `mailto:` (valid
  per RFC 2369, still shows an unsubscribe affordance, claims nothing automatic); point the mailto at
  an inbox that IS read; or build the real HTTPS one-click route, which was deliberately declined as
  a new unauthenticated write surface with its own token scheme. *Where:*
  `app/services/email.py::build_announcement`, `.aws/task-definition.json`, `infra/lib/issei-stack.ts`.

- **An announcement has no send record, so re-running mails everyone AGAIN — and a rollback
  re-subscribes the people who opted out.** (#107)
  `scripts/send_announcement.py` writes NOTHING: no column updated, no send logged. Deliberate, and
  the reasoning holds — a one-off broadcast has no natural dedupe key, and inventing one (the subject
  line?) would be worse than the honest constraint, where `prompt_sends`' UNIQUE (user, local_date)
  gives the daily nudge a real one. But the cost is sharper than either the script docstring or
  CLAUDE.md conveys, because two facts combine: there is no record of who was mailed, AND migration
  `c47a1e8b5d92`'s `downgrade` drops the column, so a downgrade-then-upgrade cycle silently resets
  every opt-out back to the default TRUE. **A rollback followed by a re-send therefore mails people
  who asked not to be mailed, with nothing in the system able to notice.** The mitigation today is
  procedural (read the dry-run count, send once); a real fix is an `announcement_sends` table keyed
  on something stable, or at minimum a `last_announced_at` on `users`. *Where:*
  `scripts/send_announcement.py`, `alembic/versions/c47a1e8b5d92_add_announcement_emails.py`.

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
  **CLOSED (#106, after the ship gate). All five write surfaces now validate.**
  `app/services/media.py` holds the rule and every route that accepts an image URL calls it:
  `PATCH /auth/me`, `PATCH /posts/{id}`, `POST /posts`, `POST /recipes` and `PATCH /recipes/{id}`
  (the last two via `_check_recipe_image_urls`, which covers the cover AND every step photo).

  Two things are worth keeping from how this went, because both were mistakes of the same shape —
  believing a rule was enforced because it existed somewhere.
  1. The first pass applied it to the two PATCH routes only, and recorded the create-side gap here
     as deferred with a cost estimate. The gate's reply was blunt and correct: with `POST /posts`
     and `POST /recipes` still open, the validator prevented nothing an attacker couldn't do
     through the front door, so "2 of 4 done" was really 0 of 1. The cost estimate was accurate —
     25 fixture URLs across 12 test files — and it was also not a reason.
  2. The count was wrong. There were FIVE surfaces, not four: `PATCH /recipes/{id}` writes
     `cover_photo_url` and every step's `photo_url`, and that is the path #106's own new
     "Change photo" control on the recipe form writes through. So the feature that introduced the
     rule was itself writing past it.

  What remains is not this class: the ORPHAN problem (a replaced Cloudinary asset is never deleted)
  is recorded separately, and validation says nothing about it.

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
