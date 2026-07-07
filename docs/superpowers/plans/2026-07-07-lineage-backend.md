# Lineage Backend & Data Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend data model and API for Issei's lineage-tree signature feature — recipes that descend from a parent, a ghost-ancestor origin, cook counts, private-by-default visibility that a root binds across descendants, handoffs, and a walkable lineage query — as the first of three sub-projects (backend → capture flows → tree viz).

**Architecture:** Extend the existing FastAPI + SQLAlchemy + Alembic backend. Recipes gain self-referential lineage (`parent_recipe_id`, `lineage_relation`, `origin_attribution`, `visibility`, `prompt_key`, `prompt_answer`). Three new tables (`ghost_ancestors`, `cook_events`, `handoffs`) capture origin, cooks, and passing. A `lineage` service computes the walkable spine, cook/version counts, and the ingredient/step diff that pre-fills the remix prompt. New endpoints layer onto the existing `/recipes` router. Privacy is enforced by a single reusable rule: a recipe's *effective* visibility is its root's visibility.

**Tech Stack:** Python 3.13, FastAPI 0.136, SQLAlchemy 2.0 (typed `Mapped` models), Alembic 1.18, Pydantic 2.13, pytest 9, SQLite (tests/local) / Postgres (prod).

## Global Constraints

- **Inclusive language** in all code/comments/docs: use primary/replica, allowlist/denylist — never master/slave/whitelist/blacklist.
- **SQLAlchemy 2.0 typed style:** `Mapped[...]` + `mapped_column(...)`, matching existing models (`app/models/recipe.py`).
- **Soft delete everywhere:** all recipe queries filter `Recipe.deleted_at == None` (existing invariant from `CLAUDE.md`).
- **Editing/authoring is owner-scoped:** mutations filter `Recipe.user_id == current_user.id` (existing pattern in `patch_recipe`).
- **New models MUST be imported in `tests/conftest.py` and `alembic/env.py`** or `create_all`/autogenerate won't see them (existing requirement — `conftest.py` imports every model today).
- **Alembic:** new migration's `down_revision` chains from the current head **`a9838c16cffe`**.
- **DB portability:** enums stored as `String` columns with app-level validation (NOT native DB enums) — SQLite has no enum type and the app targets both SQLite and Postgres.
- **Migrations must be reversible:** every `upgrade()` has a matching `downgrade()` (existing convention).
- **Don't git commit without explicit user approval** (project rule in `CLAUDE.md`). The per-task "Commit" steps below stage the diff and write the message, but a human approves before each commit is finalized.
- **Lineage semantics (from spec `2026-07-06-lineage-tree-signature-feature-design.md`):**
  - Only **remix (a change)** creates a node. Keep/cook do NOT create nodes.
  - **Single-parent only** — `parent_recipe_id` is one nullable FK. Merge nodes are cut.
  - **Ghost ancestor** at recipe creation makes recipe #1 a two-generation lineage.
  - **Private by default; the root author's visibility binds all descendants.**
  - Attribution/edges are **immutable** once set.

---

## File Structure

**Models (`app/models/`)**
- Modify `recipe.py` — add lineage columns + `parent`/`children` self-relationships.
- Create `ghost_ancestor.py` — named non-user origin node.
- Create `cook_event.py` — a cook (powers counts), no node created.
- Create `handoff.py` — passing a recipe to a named person.

**Schemas (`app/schemas/`)**
- Modify `recipe.py` — lineage fields on responses; new request models for plant/remix/handoff/cook; lineage-view response models.

**Services (`app/services/`)**
- Create `lineage.py` — `effective_visibility()`, `build_lineage_view()`, `diff_recipes()`.

**Routers (`app/routers/`)**
- Modify `recipes.py` — plant (extend create), remix, cook, handoff endpoints, lineage query, and visibility enforcement on reads.

**Migrations (`alembic/versions/`)**
- Create one migration adding the columns + three tables.

**Tests (`tests/`)**
- Create `conftest_api.py` fixtures (DB session + TestClient + auth helper) — none exist yet.
- Create `test_lineage_service.py`, `test_lineage_api.py`.
- Modify `conftest.py` — import new models.

---

## Task 1: API test harness (DB + client + auth fixtures)

There is currently **no** API/DB test infrastructure — `tests/conftest.py` only imports models and the only test exercises a pure function. Every later task needs an isolated DB and an authenticated client, so build that first.

**Files:**
- Modify: `tests/conftest.py`
- Create: `tests/fixtures.py`
- Test: `tests/test_harness.py` (smoke test, deleted-in-place is fine to keep)

**Interfaces:**
- Produces:
  - pytest fixture `db_session` → a `sqlalchemy.orm.Session` bound to a fresh in-memory SQLite schema per test.
  - pytest fixture `client` → `fastapi.testclient.TestClient` with `get_db` overridden to use `db_session`.
  - pytest fixture `make_user` → `Callable[..., tuple[User, dict]]` returning `(user, auth_headers)` where `auth_headers = {"Authorization": f"Bearer <jwt>"}`.

- [ ] **Step 1: Add new-model imports to `tests/conftest.py`**

Append the future models so `Base.metadata.create_all` sees them (they'll exist after Task 2/3; import guarded so this step alone doesn't break collection is unnecessary — do this step AFTER Task 3 if executing strictly in order, but the import lines are listed here so the file's final state is unambiguous):

```python
from app.models.user import User  # noqa: F401
from app.models.recipe import Recipe  # noqa: F401
from app.models.ingredient_section import IngredientSection  # noqa: F401
from app.models.ingredient import Ingredient  # noqa: F401
from app.models.step import Step  # noqa: F401
from app.models.ghost_ancestor import GhostAncestor  # noqa: F401
from app.models.cook_event import CookEvent  # noqa: F401
from app.models.handoff import Handoff  # noqa: F401
```

Note for the executor: if running Task 1 before Tasks 2–3 exist, add only the first five imports now and add the last three in Task 3's commit. The plan lists the final state here.

- [ ] **Step 2: Write the harness fixtures**

Create `tests/fixtures.py`:

```python
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from app.database import Base, get_db
from app.main import app
from app.auth import hash_password, create_access_token
from app.models.user import User


@pytest.fixture
def db_session():
    # In-memory SQLite, shared across the connection for the test's lifetime.
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def _fk_pragma(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session):
    def _override_get_db():
        try:
            yield db_session
        finally:
            pass  # session lifecycle owned by the db_session fixture

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def make_user(db_session):
    created = {"n": 0}

    def _make(first_name="Test", last_name="Cook"):
        created["n"] += 1
        user = User(
            first_name=first_name,
            last_name=last_name,
            email=f"user{created['n']}@example.com",
            hashed_password=hash_password("password123"),
        )
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
        token = create_access_token({"sub": str(user.id)})
        return user, {"Authorization": f"Bearer {token}"}

    return _make
```

- [ ] **Step 3: Re-export fixtures from `conftest.py`**

Add to the end of `tests/conftest.py` so the fixtures are auto-discovered by every test:

```python
from tests.fixtures import db_session, client, make_user  # noqa: F401
```

- [ ] **Step 4: Write the smoke test**

Create `tests/test_harness.py`:

```python
def test_health_and_auth_smoke(client, make_user):
    # health is unauthenticated
    assert client.get("/health").json() == {"status": "ok"}
    # auth wiring works end to end
    user, headers = make_user()
    me = client.get("/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == user.email
```

- [ ] **Step 5: Run and verify it passes**

Run: `pytest tests/test_harness.py -v`
Expected: PASS (2 assertions). If `/auth/me` differs, check `app/routers/auth.py` for the actual path/response shape and adjust the assertion to match.

- [ ] **Step 6: Commit**

```bash
git add tests/conftest.py tests/fixtures.py tests/test_harness.py
git commit -m "test: add API DB+client+auth fixtures for lineage work"
```

---

## Task 2: Lineage columns on the Recipe model

**Files:**
- Modify: `app/models/recipe.py`
- Test: `tests/test_lineage_model.py`

**Interfaces:**
- Consumes: existing `Recipe` model.
- Produces: `Recipe` gains attributes `parent_recipe_id: Optional[int]`, `lineage_relation: str` (`"root"|"kept"|"remixed"`, default `"root"`), `origin_attribution: Optional[str]`, `visibility: str` (`"private"|"public"`, default `"private"`), `prompt_key: Optional[str]`, `prompt_answer: Optional[str]`, plus relationships `parent: Optional[Recipe]` and `children: list[Recipe]`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_lineage_model.py`:

```python
from app.models.recipe import Recipe


def test_recipe_has_lineage_defaults(db_session):
    from app.models.user import User
    from app.auth import hash_password
    u = User(first_name="A", last_name="B", email="a@b.com",
             hashed_password=hash_password("x"))
    db_session.add(u); db_session.commit()

    root = Recipe(user_id=u.id, name="Congee")
    db_session.add(root); db_session.commit(); db_session.refresh(root)

    assert root.parent_recipe_id is None
    assert root.lineage_relation == "root"
    assert root.visibility == "private"
    assert root.origin_attribution is None

    child = Recipe(user_id=u.id, name="Congee (mine)",
                   parent_recipe_id=root.id, lineage_relation="remixed")
    db_session.add(child); db_session.commit(); db_session.refresh(child)

    assert child.parent.id == root.id
    assert [c.id for c in root.children] == [child.id]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_lineage_model.py -v`
Expected: FAIL — `AttributeError`/`TypeError` on `parent_recipe_id` / `lineage_relation` (columns don't exist yet).

- [ ] **Step 3: Add the columns and relationships**

In `app/models/recipe.py`, add these columns after the existing `language` column (around line 31), keeping the existing style:

```python
    # --- Lineage (see 2026-07-06 signature-feature spec) ---
    parent_recipe_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("recipes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # "root" | "kept" | "remixed" — app-validated string (portable across SQLite/Postgres)
    lineage_relation: Mapped[str] = mapped_column(server_default="root")
    origin_attribution: Mapped[Optional[str]] = mapped_column(nullable=True)
    # "private" | "public" — effective visibility is the ROOT's (see services/lineage.py)
    visibility: Mapped[str] = mapped_column(server_default="private")
    prompt_key: Mapped[Optional[str]] = mapped_column(nullable=True)
    prompt_answer: Mapped[Optional[str]] = mapped_column(nullable=True)
```

Then add these relationships alongside the existing `ingredient_sections`/`ingredients`/`steps`/`user` relationships (after line 50). `remote_side` tells SQLAlchemy which side of the self-join is the "one":

```python
    parent: Mapped[Optional["Recipe"]] = relationship(
        "Recipe", remote_side="Recipe.id", back_populates="children"
    )
    children: Mapped[list["Recipe"]] = relationship(
        "Recipe", back_populates="parent",
        primaryjoin="Recipe.id==Recipe.parent_recipe_id",
    )
```

`ForeignKey` and `Optional` are already imported at the top of the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_lineage_model.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/models/recipe.py tests/test_lineage_model.py
git commit -m "feat: add self-referential lineage columns to Recipe model"
```

---

## Task 3: Ghost ancestor, cook event, and handoff models

**Files:**
- Create: `app/models/ghost_ancestor.py`
- Create: `app/models/cook_event.py`
- Create: `app/models/handoff.py`
- Modify: `tests/conftest.py` (add the three imports from Task 1 Step 1 if not already present)
- Modify: `alembic/env.py` (import the three new models so autogenerate/`create_all` sees them)
- Test: `tests/test_lineage_model.py` (extend)

**Interfaces:**
- Produces:
  - `GhostAncestor(id, recipe_id, name, place, year, memory, claimed_by_user_id, created_at)` — the named non-user origin attached to a root recipe.
  - `CookEvent(id, recipe_id, user_id, cooked_at, photo_url, note)` — one cook; powers counts.
  - `Handoff(id, recipe_id, from_user_id, to_user_id, to_email, state, note, created_at)` — a pass; `state` in `"pending"|"kept"|"cooked"`.

- [ ] **Step 1: Write the failing test (extend the model test file)**

Append to `tests/test_lineage_model.py`:

```python
def test_ghost_cook_handoff_models(db_session):
    from app.models.user import User
    from app.models.ghost_ancestor import GhostAncestor
    from app.models.cook_event import CookEvent
    from app.models.handoff import Handoff
    from app.auth import hash_password

    u = User(first_name="A", last_name="B", email="g@b.com",
             hashed_password=hash_password("x"))
    db_session.add(u); db_session.commit()
    r = Recipe(user_id=u.id, name="Adobo")
    db_session.add(r); db_session.commit(); db_session.refresh(r)

    ghost = GhostAncestor(recipe_id=r.id, name="Lola", place="Cebu", year="1960s",
                          memory="Made it every Sunday")
    cook = CookEvent(recipe_id=r.id, user_id=u.id)
    pass_ = Handoff(recipe_id=r.id, from_user_id=u.id, to_email="mom@example.com",
                    state="pending", note="Mom, your adobo")
    db_session.add_all([ghost, cook, pass_]); db_session.commit()

    assert db_session.query(GhostAncestor).filter_by(recipe_id=r.id).one().name == "Lola"
    assert db_session.query(CookEvent).filter_by(recipe_id=r.id).count() == 1
    assert db_session.query(Handoff).filter_by(recipe_id=r.id).one().state == "pending"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_lineage_model.py::test_ghost_cook_handoff_models -v`
Expected: FAIL — `ModuleNotFoundError: app.models.ghost_ancestor`.

- [ ] **Step 3: Create `app/models/ghost_ancestor.py`**

```python
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class GhostAncestor(Base):
    """A named non-user origin for a root recipe — the person who taught it,
    captured at creation so recipe #1 is a two-generation lineage. Editable only
    by its creator until 'woken' (claimed_by_user_id set) — see the signature spec."""
    __tablename__ = "ghost_ancestors"

    id: Mapped[int] = mapped_column(primary_key=True)
    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column()
    place: Mapped[Optional[str]] = mapped_column(nullable=True)
    year: Mapped[Optional[str]] = mapped_column(nullable=True)
    memory: Mapped[Optional[str]] = mapped_column(nullable=True)
    claimed_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
```

- [ ] **Step 4: Create `app/models/cook_event.py`**

```python
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class CookEvent(Base):
    """One person cooking a recipe. Powers the cook COUNT on a node; deliberately
    does NOT create a lineage node (only a remix does)."""
    __tablename__ = "cook_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    cooked_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    photo_url: Mapped[Optional[str]] = mapped_column(nullable=True)
    note: Mapped[Optional[str]] = mapped_column(nullable=True)
```

- [ ] **Step 5: Create `app/models/handoff.py`**

```python
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class Handoff(Base):
    """Passing a recipe to a named person (in-app user or an email invite).
    state: 'pending' | 'kept' | 'cooked'. The optional growth act — never a gate."""
    __tablename__ = "handoffs"

    id: Mapped[int] = mapped_column(primary_key=True)
    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), index=True
    )
    from_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    to_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    to_email: Mapped[Optional[str]] = mapped_column(nullable=True)
    state: Mapped[str] = mapped_column(server_default="pending")
    note: Mapped[Optional[str]] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
```

- [ ] **Step 6: Register models for metadata discovery**

Ensure the final import block in `tests/conftest.py` matches Task 1 Step 1 (all eight models). Then add the same three imports to `alembic/env.py` next to its existing model imports (search for `from app.models` in that file and add):

```python
from app.models.ghost_ancestor import GhostAncestor  # noqa: F401
from app.models.cook_event import CookEvent  # noqa: F401
from app.models.handoff import Handoff  # noqa: F401
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pytest tests/test_lineage_model.py -v`
Expected: PASS (both model tests).

- [ ] **Step 8: Commit**

```bash
git add app/models/ghost_ancestor.py app/models/cook_event.py app/models/handoff.py tests/conftest.py alembic/env.py tests/test_lineage_model.py
git commit -m "feat: add GhostAncestor, CookEvent, Handoff models"
```

---

## Task 4: Alembic migration for the schema delta

**Files:**
- Create: `alembic/versions/<generated>_add_lineage_tables_and_columns.py`
- Test: manual upgrade/downgrade against a scratch SQLite DB (steps below)

**Interfaces:**
- Consumes: models from Tasks 2–3; current alembic head `a9838c16cffe`.
- Produces: a reversible migration that adds the six recipe columns and three tables.

- [ ] **Step 1: Autogenerate the migration**

Run against a scratch SQLite DB so autogenerate can diff models vs. an empty schema-at-head. From the package root:

```bash
DATABASE_URL="sqlite:///./_scratch_migrate.db" JWT_SECRET=x alembic upgrade head
DATABASE_URL="sqlite:///./_scratch_migrate.db" JWT_SECRET=x alembic revision --autogenerate -m "add lineage tables and columns"
```

Expected: a new file in `alembic/versions/` with `down_revision = 'a9838c16cffe'`.

- [ ] **Step 2: Review and correct the generated migration**

Open the generated file. Verify `upgrade()` adds: the three tables (`ghost_ancestors`, `cook_events`, `handoffs`) and the six `recipes` columns (`parent_recipe_id`, `lineage_relation`, `origin_attribution`, `visibility`, `prompt_key`, `prompt_answer`). Ensure server defaults are set on the non-nullable string columns so the migration works on a table with existing rows:

```python
    op.add_column('recipes', sa.Column('lineage_relation', sa.String(), server_default='root', nullable=False))
    op.add_column('recipes', sa.Column('visibility', sa.String(), server_default='private', nullable=False))
    op.add_column('recipes', sa.Column('parent_recipe_id', sa.Integer(), nullable=True))
    op.add_column('recipes', sa.Column('origin_attribution', sa.String(), nullable=True))
    op.add_column('recipes', sa.Column('prompt_key', sa.String(), nullable=True))
    op.add_column('recipes', sa.Column('prompt_answer', sa.String(), nullable=True))
    op.create_index('ix_recipes_parent_recipe_id', 'recipes', ['parent_recipe_id'])
```

The self-referential FK on `recipes.parent_recipe_id` must be created with a **named** constraint inside a batch block (SQLite can't ALTER-ADD an FK otherwise):

```python
    with op.batch_alter_table('recipes') as batch:
        batch.create_foreign_key(
            'fk_recipes_parent_recipe_id', 'recipes',
            ['parent_recipe_id'], ['id'], ondelete='SET NULL'
        )
```

Confirm `downgrade()` drops the three tables and six columns (and the index/FK) in reverse order.

- [ ] **Step 3: Verify upgrade then downgrade both run clean**

```bash
rm -f ./_scratch_migrate.db
DATABASE_URL="sqlite:///./_scratch_migrate.db" JWT_SECRET=x alembic upgrade head
DATABASE_URL="sqlite:///./_scratch_migrate.db" JWT_SECRET=x alembic downgrade -1
DATABASE_URL="sqlite:///./_scratch_migrate.db" JWT_SECRET=x alembic upgrade head
rm -f ./_scratch_migrate.db
```

Expected: all three commands exit 0 with no errors. (The scratch DB file is gitignored by the existing `*.db` rule.)

- [ ] **Step 4: Commit**

```bash
git add alembic/versions/
git commit -m "feat: migration for lineage tables and recipe columns"
```

---

## Task 5: Recipe diff service (pre-fills the remix prompt)

**Files:**
- Create: `app/services/lineage.py`
- Test: `tests/test_lineage_service.py`

**Interfaces:**
- Produces: `diff_recipes(parent_ingredients: list, parent_steps: list, child_ingredients: list, child_steps: list) -> dict` returning `{"changed": bool, "summary": str, "prompt_key": str}`. Each item is any object exposing `.name`/`.quantity_text` (ingredients) or `.content` (steps) — plain objects or ORM rows both work. `prompt_key` is `"ingredient_swap"`, `"step_change"`, or `"general_change"`; `summary` is a short human string like `"butter → lard"` used to pre-fill the guided prompt.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_lineage_service.py`:

```python
from types import SimpleNamespace
from app.services.lineage import diff_recipes


def ing(name, qty=None):
    return SimpleNamespace(name=name, quantity_text=qty)


def step(content):
    return SimpleNamespace(content=content)


def test_diff_detects_ingredient_swap():
    parent_ings = [ing("butter"), ing("flour")]
    child_ings = [ing("lard"), ing("flour")]
    d = diff_recipes(parent_ings, [], child_ings, [])
    assert d["changed"] is True
    assert d["prompt_key"] == "ingredient_swap"
    assert "lard" in d["summary"]


def test_diff_detects_added_step():
    d = diff_recipes([ing("rice")], [step("Rinse")],
                     [ing("rice")], [step("Rinse"), step("Toast the rice")])
    assert d["changed"] is True
    assert d["prompt_key"] in ("step_change", "general_change")


def test_diff_no_change():
    ings = [ing("rice"), ing("water")]
    steps = [step("Boil")]
    d = diff_recipes(ings, steps, ings, steps)
    assert d["changed"] is False
    assert d["prompt_key"] == "general_change"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_lineage_service.py -v`
Expected: FAIL — `ModuleNotFoundError: app.services.lineage`.

- [ ] **Step 3: Implement `diff_recipes`**

Create `app/services/lineage.py`:

```python
"""Lineage services: diff detection (pre-fills the remix prompt), effective
visibility (root binds descendants), and the walkable lineage view.

See docs/superpowers/specs/2026-07-06-lineage-tree-signature-feature-design.md.
"""


def _ing_names(items):
    return [i.name.strip().lower() for i in items if getattr(i, "name", None)]


def _step_texts(items):
    return [s.content.strip().lower() for s in items if getattr(s, "content", None)]


def diff_recipes(parent_ingredients, parent_steps, child_ingredients, child_steps):
    """Compare a child version to its parent and describe what changed, so the
    remix prompt can be pre-filled ('You swapped butter -> lard. Why?')."""
    p_ings, c_ings = _ing_names(parent_ingredients), _ing_names(child_ingredients)
    removed = [n for n in p_ings if n not in c_ings]
    added = [n for n in c_ings if n not in p_ings]

    ingredient_changed = bool(removed or added)
    steps_changed = _step_texts(parent_steps) != _step_texts(child_steps)

    if ingredient_changed:
        if removed and added:
            summary = f"{removed[0]} → {added[0]}"
        elif added:
            summary = f"added {added[0]}"
        else:
            summary = f"dropped {removed[0]}"
        return {"changed": True, "summary": summary, "prompt_key": "ingredient_swap"}

    if steps_changed:
        return {"changed": True, "summary": "changed the method", "prompt_key": "step_change"}

    return {"changed": False, "summary": "", "prompt_key": "general_change"}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_lineage_service.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/services/lineage.py tests/test_lineage_service.py
git commit -m "feat: recipe diff service to pre-fill the remix prompt"
```

---

## Task 6: Effective-visibility rule (root binds descendants)

**Files:**
- Modify: `app/services/lineage.py`
- Test: `tests/test_lineage_service.py` (extend)

**Interfaces:**
- Consumes: `Recipe` model with `parent_recipe_id`/`visibility`; a `Session`.
- Produces: `effective_visibility(recipe, db) -> str` — walks up `parent_recipe_id` to the root and returns the ROOT's `visibility` (`"private"|"public"`). A recipe's own `visibility` never overrides its root's. Cycle-guarded.

- [ ] **Step 1: Write the failing test (extend service test file)**

Append to `tests/test_lineage_service.py`:

```python
def test_effective_visibility_follows_root(db_session):
    from app.models.user import User
    from app.models.recipe import Recipe
    from app.services.lineage import effective_visibility
    from app.auth import hash_password

    u = User(first_name="A", last_name="B", email="v@b.com",
             hashed_password=hash_password("x"))
    db_session.add(u); db_session.commit()

    root = Recipe(user_id=u.id, name="Root", visibility="public",
                  lineage_relation="root")
    db_session.add(root); db_session.commit(); db_session.refresh(root)

    # Child stored 'private' but descends from a PUBLIC root -> effective is public.
    child = Recipe(user_id=u.id, name="Child", visibility="private",
                   lineage_relation="remixed", parent_recipe_id=root.id)
    db_session.add(child); db_session.commit(); db_session.refresh(child)

    assert effective_visibility(root, db_session) == "public"
    assert effective_visibility(child, db_session) == "public"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_lineage_service.py::test_effective_visibility_follows_root -v`
Expected: FAIL — `ImportError: cannot import name 'effective_visibility'`.

- [ ] **Step 3: Implement `effective_visibility`**

Add to `app/services/lineage.py`:

```python
def effective_visibility(recipe, db):
    """A recipe's visibility is its ROOT's visibility — the root author binds all
    descendants (a keeper cannot out-share past the origin). Walks parents to root."""
    from app.models.recipe import Recipe

    seen = set()
    current = recipe
    while current.parent_recipe_id is not None and current.id not in seen:
        seen.add(current.id)
        parent = db.query(Recipe).filter(Recipe.id == current.parent_recipe_id).first()
        if parent is None:
            break
        current = parent
    return current.visibility
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_lineage_service.py::test_effective_visibility_follows_root -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/lineage.py tests/test_lineage_service.py
git commit -m "feat: effective-visibility rule (root binds descendants)"
```

---

## Task 7: Plant a recipe with a ghost ancestor

**Files:**
- Modify: `app/schemas/recipe.py`
- Modify: `app/routers/recipes.py` (the `create_recipe` handler at lines 19–88)
- Test: `tests/test_lineage_api.py`

**Interfaces:**
- Consumes: `create_recipe` endpoint (`POST /recipes`), `GhostAncestor` model.
- Produces: `RecipeCreate` gains optional `origin: Optional[OriginIn]` where `OriginIn = {name: str, place: Optional[str], year: Optional[str], memory: Optional[str]}`. When `origin` is present, `POST /recipes` creates a `GhostAncestor` row for the new (root) recipe and sets `recipe.origin_attribution` to a display string (`"{name}" ` or `"{name} · {place} · {year}"`). Response `RecipeResponse` gains `parent_recipe_id`, `lineage_relation`, `visibility`, `origin_attribution`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_lineage_api.py`:

```python
def test_plant_recipe_with_origin_creates_ghost(client, make_user):
    _, headers = make_user()
    payload = {
        "name": "Grandma's Congee",
        "origin": {"name": "Nonna Lucia", "place": "Abruzzo", "year": "1940s",
                   "memory": "She made it every winter"},
        "ingredients": [{"name": "rice", "quantity_text": "1 cup",
                         "quantity_type": "precise", "position": 1}],
        "steps": [{"content": "Simmer", "position": 1}],
    }
    r = client.post("/recipes", json=payload, headers=headers)
    assert r.status_code == 201
    body = r.json()
    assert body["lineage_relation"] == "root"
    assert body["visibility"] == "private"
    assert "Nonna Lucia" in body["origin_attribution"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_lineage_api.py::test_plant_recipe_with_origin_creates_ghost -v`
Expected: FAIL — `origin_attribution` missing/None or 422 (schema rejects `origin`).

- [ ] **Step 3: Add the `OriginIn` schema and lineage response fields**

In `app/schemas/recipe.py`, add near the top (after imports):

```python
class OriginIn(BaseModel):
    name: str
    place: Optional[str] = None
    year: Optional[str] = None
    memory: Optional[str] = None
```

Add to `RecipeCreate` (after its existing fields):

```python
    origin: Optional[OriginIn] = None
```

Add to `RecipeResponse` (after `language`):

```python
    parent_recipe_id: Optional[int] = None
    lineage_relation: str = "root"
    visibility: str = "private"
    origin_attribution: Optional[str] = None
```

- [ ] **Step 4: Create the ghost ancestor in `create_recipe`**

In `app/routers/recipes.py`, add the import at the top with the other model imports:

```python
from app.models.ghost_ancestor import GhostAncestor
```

Then, inside `create_recipe`, right after `db.flush()` (line 41, which gives `new_recipe.id`) and before the ingredient-sections loop, insert:

```python
    # Plant the origin: a ghost ancestor makes recipe #1 a two-generation lineage.
    if recipe_in.origin is not None:
        o = recipe_in.origin
        db.add(GhostAncestor(
            recipe_id=new_recipe.id,
            name=o.name, place=o.place, year=o.year, memory=o.memory,
        ))
        parts = [o.name] + [p for p in (o.place, o.year) if p]
        new_recipe.origin_attribution = " · ".join(parts)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_lineage_api.py::test_plant_recipe_with_origin_creates_ghost -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/schemas/recipe.py app/routers/recipes.py tests/test_lineage_api.py
git commit -m "feat: plant a recipe with a ghost-ancestor origin"
```

---

## Task 8: Remix endpoint (a change creates a child node)

**Files:**
- Modify: `app/schemas/recipe.py`
- Modify: `app/routers/recipes.py`
- Test: `tests/test_lineage_api.py` (extend)

**Interfaces:**
- Consumes: `diff_recipes` (Task 5), `create_recipe` patterns.
- Produces: endpoint `POST /recipes/{recipe_id}/remix` taking a `RemixIn` (`{ingredients: list[IngredientCreate], steps: list[StepCreate], prompt_answer: Optional[str]}`); creates a new Recipe owned by the current user with `parent_recipe_id=recipe_id`, `lineage_relation="remixed"`, copied scalar fields from the parent, the submitted ingredients/steps, and `prompt_key` from `diff_recipes`. Returns `RecipeResponse` (201). The parent must be viewable (exists, not deleted).

- [ ] **Step 1: Write the failing test**

Append to `tests/test_lineage_api.py`:

```python
def _make_root(client, headers):
    payload = {
        "name": "Adobo",
        "ingredients": [{"name": "butter", "quantity_text": "2 tbsp",
                         "quantity_type": "precise", "position": 1}],
        "steps": [{"content": "Brown the meat", "position": 1}],
    }
    return client.post("/recipes", json=payload, headers=headers).json()

def test_remix_creates_child_with_diff_prompt(client, make_user):
    _, owner = make_user()
    root = _make_root(client, owner)

    _, remixer = make_user()
    remix_payload = {
        "ingredients": [{"name": "lard", "quantity_text": "2 tbsp",
                         "quantity_type": "precise", "position": 1}],
        "steps": [{"content": "Brown the meat", "position": 1}],
        "prompt_answer": "Mom always used lard",
    }
    r = client.post(f"/recipes/{root['id']}/remix", json=remix_payload, headers=remixer)
    assert r.status_code == 201
    body = r.json()
    assert body["parent_recipe_id"] == root["id"]
    assert body["lineage_relation"] == "remixed"
    assert body["prompt_answer"] == "Mom always used lard"
    assert body["prompt_key"] == "ingredient_swap"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_lineage_api.py::test_remix_creates_child_with_diff_prompt -v`
Expected: FAIL — 404/405 (route doesn't exist).

- [ ] **Step 3: Add `RemixIn` schema and `prompt_key`/`prompt_answer` to the response**

In `app/schemas/recipe.py` add:

```python
class RemixIn(BaseModel):
    ingredients: list[IngredientCreate] = []
    steps: list[StepCreate] = []
    prompt_answer: Optional[str] = None
```

Add to `RecipeResponse` (after the lineage fields from Task 7):

```python
    prompt_key: Optional[str] = None
    prompt_answer: Optional[str] = None
```

- [ ] **Step 4: Implement the remix endpoint**

In `app/routers/recipes.py`, add imports at the top:

```python
from app.schemas.recipe import RemixIn
from app.services.lineage import diff_recipes
```

(`diff_recipes` may already be importable; keep one import.) Add this endpoint after `create_recipe`:

```python
@router.post("/{recipe_id}/remix", response_model=RecipeResponse,
             status_code=status.HTTP_201_CREATED)
def remix_recipe(
    recipe_id: int,
    remix_in: RemixIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    parent = db.query(Recipe).filter(
        Recipe.id == recipe_id, Recipe.deleted_at == None
    ).options(
        selectinload(Recipe.ingredients), selectinload(Recipe.steps)
    ).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Recipe not found")

    # Only a change branches; describe it to pre-fill the prompt.
    diff = diff_recipes(parent.ingredients, parent.steps,
                        remix_in.ingredients, remix_in.steps)

    child = Recipe(
        user_id=current_user.id,
        name=parent.name,
        cover_photo_url=parent.cover_photo_url,
        description=parent.description,
        servings=parent.servings,
        prep_time_minutes=parent.prep_time_minutes,
        cuisine=parent.cuisine,
        diet=parent.diet,
        language=parent.language,
        parent_recipe_id=parent.id,
        lineage_relation="remixed",
        prompt_key=diff["prompt_key"],
        prompt_answer=remix_in.prompt_answer,
    )
    db.add(child)
    db.flush()

    for ing_in in remix_in.ingredients:
        db.add(Ingredient(
            recipe_id=child.id, section_id=None,
            name=ing_in.name, quantity_text=ing_in.quantity_text,
            quantity_value=ing_in.quantity_value, unit=ing_in.unit,
            quantity_type=ing_in.quantity_type, notes=ing_in.notes,
            position=ing_in.position,
        ))
    for step_in in remix_in.steps:
        db.add(Step(
            recipe_id=child.id, position=step_in.position,
            content=step_in.content, section_header=step_in.section_header,
        ))

    db.commit()
    db.refresh(child)
    return child
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_lineage_api.py::test_remix_creates_child_with_diff_prompt -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/schemas/recipe.py app/routers/recipes.py tests/test_lineage_api.py
git commit -m "feat: remix endpoint creates a child node with diff-derived prompt"
```

---

## Task 9: Cook endpoint (increments count, no node)

**Files:**
- Modify: `app/schemas/recipe.py`
- Modify: `app/routers/recipes.py`
- Test: `tests/test_lineage_api.py` (extend)

**Interfaces:**
- Consumes: `CookEvent` model.
- Produces: `POST /recipes/{recipe_id}/cook` taking optional `CookIn` (`{photo_url: Optional[str], note: Optional[str]}`); creates a `CookEvent`, returns `{"cook_count": int}` (200). Creates NO node.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_lineage_api.py`:

```python
def test_cook_increments_count_no_node(client, make_user):
    _, owner = make_user()
    root = _make_root(client, owner)

    r1 = client.post(f"/recipes/{root['id']}/cook", json={}, headers=owner)
    assert r1.status_code == 200
    assert r1.json()["cook_count"] == 1

    _, cook2 = make_user()
    r2 = client.post(f"/recipes/{root['id']}/cook",
                     json={"note": "yum"}, headers=cook2)
    assert r2.json()["cook_count"] == 2

    # No new recipe nodes were created by cooking.
    mine = client.get("/recipes", headers=cook2).json()
    assert mine == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_lineage_api.py::test_cook_increments_count_no_node -v`
Expected: FAIL — 404/405.

- [ ] **Step 3: Add `CookIn` schema**

In `app/schemas/recipe.py`:

```python
class CookIn(BaseModel):
    photo_url: Optional[str] = None
    note: Optional[str] = None
```

- [ ] **Step 4: Implement the cook endpoint**

In `app/routers/recipes.py` add imports:

```python
from app.models.cook_event import CookEvent
from app.schemas.recipe import CookIn
```

Add the endpoint:

```python
@router.post("/{recipe_id}/cook")
def cook_recipe(
    recipe_id: int,
    cook_in: CookIn | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    recipe = db.query(Recipe).filter(
        Recipe.id == recipe_id, Recipe.deleted_at == None
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    db.add(CookEvent(
        recipe_id=recipe_id, user_id=current_user.id,
        photo_url=(cook_in.photo_url if cook_in else None),
        note=(cook_in.note if cook_in else None),
    ))
    db.commit()
    count = db.query(CookEvent).filter(CookEvent.recipe_id == recipe_id).count()
    return {"cook_count": count}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_lineage_api.py::test_cook_increments_count_no_node -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/schemas/recipe.py app/routers/recipes.py tests/test_lineage_api.py
git commit -m "feat: cook endpoint increments count without creating a node"
```

---

## Task 10: Handoff endpoint (pass a recipe to a named person)

**Files:**
- Modify: `app/schemas/recipe.py`
- Modify: `app/routers/recipes.py`
- Test: `tests/test_lineage_api.py` (extend)

**Interfaces:**
- Consumes: `Handoff` model.
- Produces: `POST /recipes/{recipe_id}/handoff` taking `HandoffIn` (`{to_email: Optional[str], to_user_id: Optional[int], note: Optional[str]}`, at least one recipient required → 422 otherwise); creates a `Handoff` in state `"pending"`; returns `HandoffResponse` (`{id, recipe_id, state, to_email, to_user_id, note}`) at 201. Only the recipe owner may hand off their own recipe (else 404).

- [ ] **Step 1: Write the failing test**

Append to `tests/test_lineage_api.py`:

```python
def test_handoff_creates_pending(client, make_user):
    _, owner = make_user()
    root = _make_root(client, owner)
    r = client.post(f"/recipes/{root['id']}/handoff",
                    json={"to_email": "mom@example.com", "note": "your adobo"},
                    headers=owner)
    assert r.status_code == 201
    body = r.json()
    assert body["state"] == "pending"
    assert body["to_email"] == "mom@example.com"

def test_handoff_requires_a_recipient(client, make_user):
    _, owner = make_user()
    root = _make_root(client, owner)
    r = client.post(f"/recipes/{root['id']}/handoff", json={"note": "x"}, headers=owner)
    assert r.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_lineage_api.py -k handoff -v`
Expected: FAIL — 404/405.

- [ ] **Step 3: Add `HandoffIn`/`HandoffResponse` schemas**

In `app/schemas/recipe.py` (import `model_validator` from pydantic at top: `from pydantic import BaseModel, ConfigDict, model_validator`):

```python
class HandoffIn(BaseModel):
    to_email: Optional[str] = None
    to_user_id: Optional[int] = None
    note: Optional[str] = None

    @model_validator(mode="after")
    def _require_recipient(self):
        if not self.to_email and not self.to_user_id:
            raise ValueError("Provide to_email or to_user_id")
        return self


class HandoffResponse(BaseModel):
    id: int
    recipe_id: int
    state: str
    to_email: Optional[str] = None
    to_user_id: Optional[int] = None
    note: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)
```

(A pydantic `ValueError` in a request body surfaces as HTTP 422 automatically.)

- [ ] **Step 4: Implement the handoff endpoint**

In `app/routers/recipes.py` add imports:

```python
from app.models.handoff import Handoff
from app.schemas.recipe import HandoffIn, HandoffResponse
```

Add the endpoint:

```python
@router.post("/{recipe_id}/handoff", response_model=HandoffResponse,
             status_code=status.HTTP_201_CREATED)
def handoff_recipe(
    recipe_id: int,
    handoff_in: HandoffIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    recipe = db.query(Recipe).filter(
        Recipe.id == recipe_id,
        Recipe.user_id == current_user.id,
        Recipe.deleted_at == None,
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    handoff = Handoff(
        recipe_id=recipe_id, from_user_id=current_user.id,
        to_user_id=handoff_in.to_user_id, to_email=handoff_in.to_email,
        state="pending", note=handoff_in.note,
    )
    db.add(handoff)
    db.commit()
    db.refresh(handoff)
    return handoff
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_lineage_api.py -k handoff -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add app/schemas/recipe.py app/routers/recipes.py tests/test_lineage_api.py
git commit -m "feat: handoff endpoint passes a recipe to a named person"
```

---

## Task 11: Lineage view (walkable spine + counts)

**Files:**
- Modify: `app/services/lineage.py`
- Modify: `app/schemas/recipe.py`
- Modify: `app/routers/recipes.py`
- Test: `tests/test_lineage_service.py` (extend), `tests/test_lineage_api.py` (extend)

**Interfaces:**
- Consumes: `Recipe` (parent/children), `CookEvent`, `effective_visibility`.
- Produces:
  - `build_lineage_view(recipe, db) -> dict` → `{"focus": NodeSummary, "spine": [NodeSummary...], "children": [NodeSummary...], "counts": {"cooks": int, "versions": int}}` where the **spine** is the chain of ancestors from root down to the focus node and **children** are the focus node's direct descendants; `versions` = total nodes in the tree (root subtree size), `cooks` = total `CookEvent`s across the tree.
  - `NodeSummary` schema: `{id, name, author_full_name, lineage_relation, origin_attribution, cook_count}`.
  - endpoint `GET /recipes/{recipe_id}/lineage` → `LineageView` response (200), 404 if not found.

- [ ] **Step 1: Write the failing service test**

Append to `tests/test_lineage_service.py`:

```python
def test_build_lineage_view_spine_and_counts(db_session):
    from app.models.user import User
    from app.models.recipe import Recipe
    from app.models.cook_event import CookEvent
    from app.services.lineage import build_lineage_view
    from app.auth import hash_password

    u = User(first_name="A", last_name="B", email="l@b.com",
             hashed_password=hash_password("x"))
    db_session.add(u); db_session.commit()

    root = Recipe(user_id=u.id, name="Root", lineage_relation="root")
    db_session.add(root); db_session.commit(); db_session.refresh(root)
    child = Recipe(user_id=u.id, name="Child", lineage_relation="remixed",
                   parent_recipe_id=root.id)
    db_session.add(child); db_session.commit(); db_session.refresh(child)
    db_session.add(CookEvent(recipe_id=root.id, user_id=u.id))
    db_session.add(CookEvent(recipe_id=child.id, user_id=u.id))
    db_session.commit()

    view = build_lineage_view(child, db_session)
    assert [n["id"] for n in view["spine"]] == [root.id, child.id]
    assert view["focus"]["id"] == child.id
    assert view["counts"]["versions"] == 2
    assert view["counts"]["cooks"] == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_lineage_service.py::test_build_lineage_view_spine_and_counts -v`
Expected: FAIL — `ImportError: cannot import name 'build_lineage_view'`.

- [ ] **Step 3: Implement `build_lineage_view`**

Add to `app/services/lineage.py`:

```python
def _node_summary(recipe, db):
    from app.models.cook_event import CookEvent
    cook_count = db.query(CookEvent).filter(CookEvent.recipe_id == recipe.id).count()
    return {
        "id": recipe.id,
        "name": recipe.name,
        "author_full_name": recipe.author_full_name,
        "lineage_relation": recipe.lineage_relation,
        "origin_attribution": recipe.origin_attribution,
        "cook_count": cook_count,
    }


def _root_of(recipe, db):
    from app.models.recipe import Recipe
    seen, current = set(), recipe
    while current.parent_recipe_id is not None and current.id not in seen:
        seen.add(current.id)
        parent = db.query(Recipe).filter(Recipe.id == current.parent_recipe_id).first()
        if parent is None:
            break
        current = parent
    return current


def _subtree_ids(root, db):
    from app.models.recipe import Recipe
    ids, frontier = [], [root.id]
    while frontier:
        node_id = frontier.pop()
        ids.append(node_id)
        child_ids = [
            r.id for r in db.query(Recipe.id).filter(
                Recipe.parent_recipe_id == node_id, Recipe.deleted_at == None
            ).all()
        ]
        frontier.extend(child_ids)
    return ids


def build_lineage_view(recipe, db):
    """The walkable spine (root -> focus), the focus node's direct children, and
    whole-tree counts. Powers GET /recipes/{id}/lineage."""
    from app.models.recipe import Recipe
    from app.models.cook_event import CookEvent

    # spine: ancestors from root down to focus
    chain, seen, current = [], set(), recipe
    while current is not None and current.id not in seen:
        seen.add(current.id)
        chain.append(current)
        if current.parent_recipe_id is None:
            break
        current = db.query(Recipe).filter(Recipe.id == current.parent_recipe_id).first()
    chain.reverse()

    children = db.query(Recipe).filter(
        Recipe.parent_recipe_id == recipe.id, Recipe.deleted_at == None
    ).all()

    root = chain[0] if chain else recipe
    subtree = _subtree_ids(root, db)
    cooks = db.query(CookEvent).filter(CookEvent.recipe_id.in_(subtree)).count()

    return {
        "focus": _node_summary(recipe, db),
        "spine": [_node_summary(n, db) for n in chain],
        "children": [_node_summary(c, db) for c in children],
        "counts": {"cooks": cooks, "versions": len(subtree)},
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_lineage_service.py::test_build_lineage_view_spine_and_counts -v`
Expected: PASS.

- [ ] **Step 5: Add response schemas and the endpoint**

In `app/schemas/recipe.py`:

```python
class NodeSummary(BaseModel):
    id: int
    name: str
    author_full_name: Optional[str] = None
    lineage_relation: str
    origin_attribution: Optional[str] = None
    cook_count: int


class LineageCounts(BaseModel):
    cooks: int
    versions: int


class LineageView(BaseModel):
    focus: NodeSummary
    spine: list[NodeSummary]
    children: list[NodeSummary]
    counts: LineageCounts
```

In `app/routers/recipes.py` add imports and endpoint:

```python
from app.services.lineage import build_lineage_view
from app.schemas.recipe import LineageView
```

```python
@router.get("/{recipe_id}/lineage", response_model=LineageView)
def get_lineage(
    recipe_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    recipe = db.query(Recipe).filter(
        Recipe.id == recipe_id, Recipe.deleted_at == None
    ).options(selectinload(Recipe.user)).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return build_lineage_view(recipe, db)
```

- [ ] **Step 6: Write the failing API test**

Append to `tests/test_lineage_api.py`:

```python
def test_lineage_endpoint_returns_spine(client, make_user):
    _, owner = make_user()
    root = _make_root(client, owner)
    remix = client.post(f"/recipes/{root['id']}/remix",
                        json={"ingredients": [{"name": "lard", "quantity_text": "1 tbsp",
                              "quantity_type": "precise", "position": 1}],
                              "steps": [{"content": "Brown the meat", "position": 1}]},
                        headers=owner).json()
    r = client.get(f"/recipes/{remix['id']}/lineage", headers=owner)
    assert r.status_code == 200
    view = r.json()
    assert [n["id"] for n in view["spine"]] == [root["id"], remix["id"]]
    assert view["counts"]["versions"] == 2
```

- [ ] **Step 7: Run the full lineage suite**

Run: `pytest tests/ -v`
Expected: PASS (all tests: harness, model, service, api).

- [ ] **Step 8: Commit**

```bash
git add app/services/lineage.py app/schemas/recipe.py app/routers/recipes.py tests/test_lineage_service.py tests/test_lineage_api.py
git commit -m "feat: lineage view endpoint (walkable spine + tree counts)"
```

---

## Task 12: Enforce effective visibility on recipe reads

**Files:**
- Modify: `app/routers/recipes.py` (the `get_recipe` handler + `/browse`)
- Test: `tests/test_lineage_api.py` (extend)

**Interfaces:**
- Consumes: `effective_visibility` (Task 6).
- Produces: `GET /recipes/{id}` returns 404 for a private recipe requested by a non-owner (owner still sees it); `GET /recipes/browse` returns only recipes whose **effective** visibility is `"public"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_lineage_api.py`:

```python
def test_private_recipe_hidden_from_non_owner(client, make_user):
    _, owner = make_user()
    root = _make_root(client, owner)  # private by default
    _, other = make_user()
    assert client.get(f"/recipes/{root['id']}", headers=other).status_code == 404
    assert client.get(f"/recipes/{root['id']}", headers=owner).status_code == 200

def test_browse_only_shows_public(client, make_user):
    _, owner = make_user()
    _make_root(client, owner)  # private by default
    # /browse is unauthenticated (browse_recipes takes no current_user) — call it plainly.
    assert client.get("/recipes/browse").json() == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_lineage_api.py -k "private or browse" -v`
Expected: FAIL — private recipe currently returns 200 to non-owner; browse returns the private recipe.

- [ ] **Step 3: Enforce visibility in `get_recipe`**

In `app/routers/recipes.py`, ensure `effective_visibility` is imported:

```python
from app.services.lineage import effective_visibility
```

In `get_recipe` (the "any logged-in user can view any recipe" handler), after fetching `recipe` and the not-found check, add the owner-or-public gate:

```python
    if recipe.user_id != current_user.id and effective_visibility(recipe, db) != "public":
        raise HTTPException(status_code=404, detail="Recipe not found")
```

- [ ] **Step 4: Filter `/browse` to effective-public**

In `browse_recipes`, after loading the candidate recipes, filter by effective visibility before returning:

```python
    recipes = [r for r in recipes if effective_visibility(r, db) == "public"]
    return recipes
```

(If `browse_recipes` returns the query result directly, assign it to `recipes` first, then apply the filter above.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_lineage_api.py -k "private or browse" -v`
Expected: PASS.

- [ ] **Step 6: Run the whole suite**

Run: `pytest tests/ -v`
Expected: PASS (all tests green).

- [ ] **Step 7: Commit**

```bash
git add app/routers/recipes.py tests/test_lineage_api.py
git commit -m "feat: enforce root-bound visibility on recipe reads and browse"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** ghost ancestor (T7), change-only branching (T8 remix; cook T9 makes no node), single-parent FK (T2/T4), private-by-default + root-binds-descendants (T6, T12), handoff (T10), walkable spine + counts (T11), diff-prefilled prompt (T5/T8). Deferred by spec and NOT in this plan: whole-tree zoomed view (frontend fast-follow), lineage collision, self-authorship *invite acceptance* flow (this plan creates the pending handoff; claim/accept is a capture-flow/sub-project-2 concern), notifications, merge nodes (cut).
- **Ghost "waking"/claim, handoff accept, and notifications** are intentionally out of scope for the data+API foundation and belong to sub-project 2 (capture flows). `claimed_by_user_id` and handoff `state` transitions exist in the schema so sub-project 2 has the columns it needs.
- **Migration note:** Task 4 is the one non-TDD task (schema migrations aren't unit-tested); its "test" is the reversible upgrade/downgrade round-trip.
