# issei — architecture refresher

Written to be reread before an interview. Verified against the code on 2026-08-06, not
from memory. Every number here was counted, not estimated.

**Scale:** 58 endpoints · 15 tables · 21 migrations · 448 backend tests · 704 frontend
tests · 6,320 lines of Python under `app/` (excluding tests and migrations), deployed
(AWS ECS Fargate + Vercel + Neon Postgres).

---

## 1. The one-sentence version

A person cooked you something you'd never had, you asked for the recipe, and this is how
they send it to you — with their imprecise amounts intact ("3 soup spoons", "a good
splash"), because normalizing those to grams deletes the only part that was theirs.

Everything technical below follows from that sentence. That's the useful thing to say in
an interview: the data model, the authorization rule, and the LLM constraints are all
downstream of one product decision.

---

## 2. Stack and why

| Layer | Choice | The reason, if asked |
|---|---|---|
| API | FastAPI | Pydantic gives request/response validation at the boundary for free; async for the LLM call |
| ORM | SQLAlchemy 2.0 (`Mapped[]` typed style) | Types are checkable; the models double as documentation |
| DB | Postgres (Neon) in prod, SQLite locally | Same ORM either way; `database.py` branches on the URL |
| Migrations | Alembic | 21 versioned migrations, forward-only in practice |
| Auth | JWT, stateless, bcrypt | No session store to run; the token carries `sub` = user id |
| Frontend | React + Vite + Tailwind | — |
| Hosting | AWS ECS Fargate (API) · Vercel (web) · Neon (DB) | Push to `main` auto-deploys via GitHub Actions OIDC pipeline |

**Two dialect details worth knowing** (`app/database.py`) — this is the kind of thing a
data engineer will respect:

- `pool_pre_ping=True` and `pool_recycle=300` on Postgres only. Neon closes idle
  connections server-side, so a pooled connection can be dead when reused. The symptom
  was an intermittent 500 on the first request after an idle period. Pre-ping tests each
  connection with a cheap query before handing it out.
- `PRAGMA foreign_keys=ON` on SQLite connect. **SQLite doesn't enforce foreign keys by
  default.** Without this, local tests would pass while Postgres rejected the same
  operation in production.

---

## 3. Data model (15 tables)

```
users
  ├── password_reset_tokens      (user_id FK)
  ├── friendships                (requester_id, addressee_id + pair_low/pair_high — one row per pair)
  ├── posts                      (user_id FK; optional recipe_id FK, SET NULL — a shared meal)
  └── recipes                    (user_id FK, CASCADE)
        ├── ingredient_sections  (recipe_id FK, CASCADE)
        │     └── ingredients    (section_id FK, SET NULL)
        ├── ingredients          (recipe_id FK, CASCADE)   ← also direct
        ├── steps                (recipe_id FK, CASCADE)
        ├── cook_events          (recipe_id FK)
        ├── handoffs             (recipe_id, from_user_id, to_user_id)
        └── recipe_saves         (user_id, recipe_id — a bookmark; UNIQUE(user,recipe), one recipe FK)
feedback                          (standalone)
```

### The three design decisions to be able to defend

**(a) Ingredients have BOTH `recipe_id` and a nullable `section_id`.**

A recipe may group ingredients ("For the marinade", "For the sauce") or not group them at
all. Two ways to model that:

- Normalized: every ingredient belongs to a section; ungrouped recipes get one implicit
  section. Cost: every read joins through a table that usually holds one meaningless row.
- What I did: `recipe_id` is always set, `section_id` is nullable. An ungrouped ingredient
  has `section_id IS NULL`.

The tradeoff is real and I'd name it: this is **deliberate denormalization**. The
`recipe_id` on a sectioned ingredient is derivable from its section, so it's duplicated
data that could theoretically disagree. What it buys is that *every* ingredient query is
one predicate on an indexed column, with no join and no special case for the common shape.
The relationship is disambiguated in SQLAlchemy with an explicit `primaryjoin`
(`Recipe.ingredients` matches `section_id == None`).

*If pushed on the risk:* the only writer is `create_recipe`, which sets both in one
transaction, so divergence would require a new write path. A CHECK constraint asserting
`section_id IS NULL OR section.recipe_id = recipe_id` would close it properly.

**(b) Soft delete: `recipes.deleted_at`, indexed.**

Every read filters `deleted_at IS NULL`. Recipes are things people were *given* — a
hard delete makes a handed-off recipe vanish from someone else's kitchen with no recovery.
Indexed because it's in the predicate of every list query.

*The honest weakness:* this is enforced by convention, not by the database. A new query
that forgets the filter silently exposes deleted rows. The proper fix is a view or a
SQLAlchemy query filter default.

**(c) `origin_attribution` is a display string, not a foreign key.**

"Lola Remedios · Cebu" is stored as text on the recipe. There is no `people` table.

This is the interesting one because **there used to be more.** An earlier version modeled
lineage — `parent_recipe_id`, `lineage_relation`, and a `ghost_ancestors` table for
people who weren't users. I removed all of it (migration `c1d2e3f4a5b6`). The reason:
attribution is a *fact about one recipe*, not an edge in a graph, and nothing read the
graph. The product is one recipe handed to one person, not a family network.

*How I de-risked the removal* — this is the part worth telling: before dropping the
columns I queried production and confirmed **zero recipes had a `parent_recipe_id`**.
That meant `root_of()` was already the identity function on every real row, so no
authorization outcome could change. I verified the migration was a no-op by rendering the
Postgres SQL offline before and after and diffing it byte-for-byte.

That's a schema migration on a live database, de-risked by measuring production first.

---

## 4. The quantity model — the core of the product

Three types on every ingredient, stored in `quantity_type`:

| Type | Example | Scales? |
|---|---|---|
| `precise` | "200 g", "2 cups" | Arithmetically |
| `imprecise` | "3 soup spoons", "about 2 cups" | Yes, but the words are preserved |
| `unmeasured` | "a good splash", "to taste" | Never — no number to scale |

And within folk units, a second distinction that is the most original thing in the
codebase (`app/services/folk_units.py`):

- **Countable** — the vessel is unknowable but the count is real. "3 soup spoons" doubled
  genuinely is 6 soup spoons; a cook can do that. Pluralized so it reads like a person
  wrote it.
- **Non-linear** — the number describes a *geometry*, not a quantity. **"3 fingers of
  water" is a depth in the pot.** Double the rice and the pot is wider, so the depth
  barely changes. Doubling the number gives you soup. These never scale: the cook gets
  her own words plus the multiplier (`scale_note: "×2"`) to apply by feel.

There's a third case in `scaling.py` worth knowing: a countable folk unit whose scaled
result is **fractional** also stays verbatim. There is no half-pinch, and you can't buy
1.5 cans — so rather than invent an uncookable instruction, hand back the original and
the multiplier.

**Say this out loud once before the interview.** It's the moment where a technical
interviewer realizes the project has a real idea in it.

---

## 5. Authorization — one rule, one place

`app/services/sharing.py::can_view(recipe, user, db)`:

```
NOT blocked (either direction)
  AND ( owner  OR  public  OR  (friends AND viewer is an accepted friend) )
  OR  holds an accepted handoff for this recipe
```

The block term is first, and its position is the interesting part: it is checked **before**
`public`, so a block outranks even a public recipe. A block that didn't would leave every
public recipe and post of theirs on your screen, which is not what anyone means by blocking.

The one asymmetry — and the thing worth being able to explain — is that a block does **not**
override an already-accepted handoff grant. You genuinely handed that person that dish; it is
on their shelf and they may have cooked from it. A block means "no new contact", not "unsend",
and revoking would be the only place in the app where access is taken back after being given.
A *new* grant can't cross a block, though: `handoff_recipe` refuses, or the grant branch would
be an uncapped channel into a blocker's kitchen.

`visibility` is a concrete per-recipe value (`public | friends | private`); the friends
branch resolves against `are_friends(viewer, owner)`. The handoff grant is orthogonal —
it's checked last and lets a grantee read the one recipe handed to them whatever the
visibility says. Every read funnels through this: `get_recipe`, `/scale`, `/cook`,
`/handoff`.

**The distinction to state precisely: read is not write.** `can_view` answers *read*
only. Editing and deleting are owner-only, enforced separately by a `user_id` filter in
`patch_recipe` / `delete_recipe`. Someone handed a recipe can read it and cook it; they
can never change another person's record of the dish. Collapsing those two questions into
one rule is how a recipient ends up able to edit someone's grandmother's recipe.

### The capability token — the design decision I'd lead with

`GET /recipes/invite/{token}` returns the **whole recipe, unauthenticated.**

The token is `secrets.token_urlsafe(32)` — 256 bits, unguessable — stored unique+indexed
on the handoff row. **Holding the link IS the authorization.** That's a capability model,
not an identity model.

It used to be a soft wall: name, story and photo visible, ingredients behind signup. That
inverted the entire product — someone's mother sent them a recipe and the app demanded an
account before they could read it. What's actually withheld is bounded by the response
schema (`InvitePreview` omits the owner's private `notes` and all account ids), not by a
signup gate.

*If asked about the risk:* the token is bearer authority, so anyone it's forwarded to has
the same access — appropriate here, because forwarding a recipe is the point. Missing:
expiry and revocation. In a regulated setting I'd add both, plus an access log.

---

## 6. The transaction pattern (`create_recipe`)

A recipe write inserts across four tables in one transaction:

1. `db.add(recipe)` then **`db.flush()`** — flush sends the INSERT and populates
   `recipe.id` **without committing**, so child rows have a real FK to point at.
2. Sections: add, flush again for each section id.
3. Ingredients (sectioned and unsectioned) and steps.
4. One `db.commit()` at the end.

The point: **flush ≠ commit.** Flush gets you server-generated ids inside an open
transaction. If any child insert fails, the whole thing rolls back and there's no orphaned
recipe. One atomic unit.

---

## 7. N+1 and how it's handled

Every list endpoint uses `selectinload` to eager-load children:

```python
.options(
    selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
    selectinload(Recipe.ingredients),
    selectinload(Recipe.steps),
    selectinload(Recipe.user),
)
```

Without it, serializing 20 recipes fires 20 queries for ingredients, 20 for steps, 20 for
users. `selectinload` issues one additional query per relationship using `WHERE id IN
(...)`, so it's a fixed small number of queries regardless of row count.

*Why `selectinload` and not `joinedload`:* joined loading multiplies rows across
collections (a recipe with 10 ingredients × 5 steps returns 50 rows to deduplicate).
`selectinload` uses separate IN queries, which is the right shape for one-to-many.

**Known weakness, worth volunteering:** `GET /recipes/browse` loads every non-deleted
recipe and filters visibility **in Python**, after the query. Fine at current scale,
wrong in principle — the predicate belongs in SQL, and it needs pagination. I know it and
I know why it's a problem.

---

## 8. Indexes, and what they're for

| Index | Why |
|---|---|
| `recipes.user_id` | Every "my kitchen" query |
| `recipes.deleted_at` | In every read's predicate |
| `ingredients.recipe_id`, `steps.recipe_id` | The `IN (...)` of every selectinload |
| `handoffs.token` (unique) | The capability lookup — one row by token |
| `handoffs(to_user_id, recipe_id, state)` | Composite, added deliberately (migration `a1b2c3d4e5f6`) for the grant check in `can_view`, which runs on every non-owner read |
| `users.email` (unique) | Login, and it enforces the constraint |

The composite one is the good answer to "have you ever added an index on purpose?" — it
exists because `can_view` filters on exactly those three columns together.

---

## 9. FK delete behavior — set deliberately, per relationship

Migration `bba3856b2139` aligned the database with the models, because they had drifted.

- `recipes.user_id` → **CASCADE**. Delete a user, their recipes go.
- `ingredients.recipe_id`, `steps.recipe_id` → **CASCADE**. Children of a recipe.
- `ingredients.section_id` → **SET NULL**. Deleting a *grouping* must not delete the
  food; the ingredient survives, ungrouped.
- `handoffs.to_user_id` → **SET NULL**. The handoff is a historical fact. If the
  recipient's account goes away, the record that it happened should remain.

That last pair is the answer to "how do you think about referential integrity?" — the
delete rule encodes what the row *means*.

---

## 10. The LLM layer (newest work)

`POST /recipes/parse` → OpenRouter → structured JSON. Saves nothing.

**The problem:** the local line-based parser can't split run-on speech. "you need
tamarind, about a thumb of ginger, and some kangkong" is one line holding three
ingredients — and that's exactly how a person talks. A model splits it trivially.

**The risk:** a model's default helpfulness is to normalize. It will turn "a good splash"
into "2 tbsp (30 ml)" — deleting the only part of the recipe that was the cook's, *while
looking like an improvement.*

**The control, in three layers:**

1. **Prompt** forbids conversion, with concrete examples ("never 45 ml").
2. **`json_schema` mode, `strict: true`, `temperature: 0`.** Extraction against a fixed
   schema, not generation. Creativity here means invented ingredients.
3. **Code enforcement in `_clean()`** — the layer that matters:
   - Every amount is **re-typed by the app's own classifier**. The model returns words;
     the app decides what they mean. The model never grades its own output.
   - **Grounding check:** an ingredient whose head word doesn't appear in the source text
     is dropped. Asked about adobo, a model will helpfully add bay leaves nobody
     mentioned — and a recipe with ingredients the cook never said isn't their recipe.
   - `servings` reduced to digits, because the column is `Optional[int]` and guessing
     which number "4–6 people" means isn't the app's business.

**The line:** *a prompt is a request; only code is a guarantee.*

**Graceful degradation.** Missing key, timeout, 429, malformed JSON, valid-JSON-wrong-shape
— all one exception type, because the caller's response is identical in every case: fall
back to the deterministic parser the client already ships. Verified against a running
server with no key: returns `ai: false`, not a 500, and the form still fills.
*That's the difference between adding a feature and adding a dependency.*

**Controls:** key is server-side only (a `VITE_` var gets inlined into a bundle that's
publicly readable at `/assets/index-*.js`); endpoint is auth-gated despite touching no
rows, because it spends money per call; input capped at 8,000 chars so a paste can't
become an unbounded prompt.

**Model pinning:** pinned `deepseek/deepseek-v4-flash-0731` (`recipe_ai.py` `DEFAULT_MODEL`,
and the `OPENROUTER_MODEL` prod runs), not a floating `-latest` alias. If a provider swaps
the model under a validated workflow, the thing that breaks is the exact behavior the
product promises.

**Known gap, worth volunteering:** that endpoint is a **prompt-injection surface** — user
text goes straight into a user message. Blast radius is small (the model can't write, and
every field is re-validated) but it's unhandled, and I'd want output-side validation
before it touched anything consequential.

---

## 11. Two testing details worth mentioning

- **The LLM integration is testable offline.** `httpx.AsyncClient` is stubbed, so the
  prompt, the parsing and the validation all run in CI with no network and no cost.
  Tests assert the prompt *still contains* the conversion prohibition — a prompt is code,
  so a change to it should break a test.
- **A cross-implementation check.** The amount classifier exists in both Python
  (`app/services/quantity.py`) and JavaScript (`frontend/src/utils/quantity.js`). I
  verified them case-by-case against each other and found a real bug: `"~2 cups"` with no
  space typed as `precise` because one regex required whitespace after the tilde. Both are
  built on the same shared folk-unit vocabulary rather than two independent word lists,
  because two lists is how they eventually disagree — and that disagreement is a wrong
  number in someone's kitchen.

---

## 12. What I'd change next (say these before you're asked)

Volunteering these is what separates "I built a thing" from "I understand what I built."

1. **`/browse` filters visibility in Python.** Belongs in SQL, and needs pagination.
2. **Soft delete is convention, not constraint.** One forgotten `WHERE` exposes deleted
   rows. Should be a view or a default query filter.
3. **Invite tokens have no expiry or revocation.** Fine for texting a recipe to your
   sister; not fine in a regulated context.
4. **No CHECK constraint** on the ingredient denormalization.
5. **No rate limiting on `/parse`.** It costs money per call and auth is the only gate.
6. **`/parse` is unhandled for prompt injection.**
7. **No structured logging or request tracing.** No way to reconstruct what happened.

---

## 13. Fast recall drill

Cover the answers.

- Why does an ingredient carry both `recipe_id` and `section_id`? → Denormalization; every
  ingredient query is one indexed predicate, no join, no special case for ungrouped.
- What does `flush()` do that `commit()` doesn't? → Sends the INSERT to get the
  server-generated id *without* ending the transaction.
- Why `selectinload` over `joinedload`? → Avoids the row multiplication of joining across
  two collections; separate `IN` queries instead.
- What is the invite token, in one word? → A **capability**. Holding it is the authority.
- Why doesn't "3 fingers of water" scale? → It's a depth, not a quantity. A bigger batch
  sits in a wider pot; doubling gives you soup.
- Where is read authorization decided? → One function, `can_view`. Read only — write is
  owner-only, enforced separately.
- Why does a block beat `public` but not a handoff grant? → Because those answer different
  questions. Visibility is "who is this for"; a block is "not this person, ever" and has to
  outrank it. But a grant is a thing already given — you handed them that recipe — so
  blocking stops *new* contact rather than retracting what's done. It's the one place the
  rule isn't a simple precedence chain, and it's a product decision, not an oversight.
- How do you stop a block from being detectable? → Every denial returns the same 404 body an
  unknown user gets, and `POST /friends/blocks` returns 204 whether or not a row existed. The
  blocked person sees what someone looking at a deleted account sees.
- Why is `PRAGMA foreign_keys=ON` there? → SQLite ignores FKs by default; without it local
  tests pass where Postgres would reject.
- How did you de-risk dropping the lineage columns? → Queried prod first: zero rows had a
  parent, so `root_of()` was already identity and no authz outcome could change. Diffed
  the rendered SQL byte-for-byte.
- What stops the model normalizing "a good splash"? → Not the prompt. The app re-types
  every amount with its own classifier.
- What happens when OpenRouter is down? → `ai: false`, silent fallback to the local
  deterministic parser. No error surfaces.
