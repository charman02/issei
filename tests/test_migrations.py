"""Guards that the Alembic chain actually replays on an empty database.

Why this exists: the chain was broken for a long time on SQLite (two revisions
dropped foreign keys by their Postgres-auto-generated names, which a fresh SQLite
database never assigned). Nobody noticed because every local schema is built with
`Base.metadata.create_all`, which never runs a migration. That hides migration
bugs until they reach Postgres in production, where they are far more expensive.
These tests exercise the real code path instead.

SAFETY: these tests never touch the configured DATABASE_URL. They build their own
engine against a temp file and inject the connection through
`config.attributes["connection"]`, which `alembic/env.py` prefers over
`app.database.engine`. Nothing here reads app.config or app.database.
"""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _alembic_config(connection):
    """An Alembic config wired to `connection` and nothing else.

    The url is set to a bogus in-memory value so that any code path which
    ignored the injected connection and tried to connect on its own would hit an
    empty throwaway database rather than a real one.
    """
    cfg = Config(str(PROJECT_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(PROJECT_ROOT / "alembic"))
    cfg.set_main_option("sqlalchemy.url", "sqlite://")
    cfg.attributes["connection"] = connection
    return cfg


@pytest.fixture
def migrated(tmp_path):
    """Run the full chain from empty to head on a throwaway SQLite file.

    A file (not `sqlite://`) because batch_alter_table recreates tables, and the
    revisions under test are exactly the ones that do so — this keeps the test
    honest about the on-disk DDL path.
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'chain.db'}")
    with engine.begin() as connection:
        command.upgrade(_alembic_config(connection), "head")
    yield engine
    engine.dispose()


def test_chain_upgrades_from_empty_to_head(migrated):
    """The whole chain replays on a fresh database and lands on the real head."""
    heads = ScriptDirectory.from_config(
        _alembic_config(None)
    ).get_heads()
    assert len(heads) == 1, f"expected a single head, found {heads}"

    with migrated.connect() as conn:
        stamped = conn.exec_driver_sql("SELECT version_num FROM alembic_version").scalar()
    assert stamped == heads[0]


def test_chain_downgrades_back_to_base(tmp_path):
    """Every downgrade() is reversible too, so the chain isn't a one-way door."""
    engine = create_engine(f"sqlite:///{tmp_path / 'down.db'}")
    with engine.begin() as connection:
        cfg = _alembic_config(connection)
        command.upgrade(cfg, "head")
        command.downgrade(cfg, "base")

    # Only alembic's own bookkeeping table should survive a full downgrade.
    assert [t for t in inspect(engine).get_table_names() if t != "alembic_version"] == []
    engine.dispose()


def test_migrated_schema_matches_models(migrated):
    """The migrated schema matches what the models declare.

    Catching this drift is the actual point: `create_all` and the migration chain
    are two independent definitions of the same schema, and only this comparison
    keeps them honest. Uses Alembic's own autogenerate comparison — if it finds
    any table/column difference, the two have diverged.
    """
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    from app.database import Base
    import tests.conftest  # noqa: F401  (imports every model onto Base.metadata)

    with migrated.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)

    # compare_metadata returns TWO shapes: a plain tuple for a simple diff
    # (`('add_table', Table)`) and a LIST of tuples for grouped modify_* diffs
    # (`[('modify_nullable', None, 'tbl', 'col', {...}, True, False)]`). Flatten before
    # filtering — reading `d[0]` on the list shape yields a tuple that CONTAINS a dict,
    # and testing that for set membership raises "unhashable type: 'dict'". That made any
    # nullability drift blow up with a TypeError instead of reporting the drift this test
    # was written to catch (it did exactly that when recipe_saves.created_at was declared
    # nullable in the migration but NOT NULL on the model).
    flat = []
    for d in diff:
        flat.extend(d if isinstance(d, list) else [d])

    # Only structural differences matter. Server-default and type comparison are
    # off by default in compare_metadata and deliberately left off: SQLite
    # round-trips defaults and types too loosely for that to be signal, and this
    # test should fail on real drift (a missing table or column), not on
    # dialect noise.
    structural = [d for d in flat if d[0] in {
        "add_table", "remove_table", "add_column", "remove_column",
    }]
    assert structural == [], f"migrations drifted from models: {structural}"

    # Nullability drift is reported separately: it is real (a column NOT NULL on one side
    # and nullable on the other will accept a row locally and reject it in Postgres), but
    # it is listed rather than folded into `structural` so the failure message names the
    # exact column instead of dumping a Table repr.
    nullable_drift = [d for d in flat if d[0] == "modify_nullable"]
    assert nullable_drift == [], (
        "migration/model nullability drift: "
        + "; ".join(f"{d[2]}.{d[3]} migration={d[5]!r} model={d[6]!r}" for d in nullable_drift)
    )


# The two dead notification columns (`users.notify_prompt`, `users.notify_posts`) are in RELEASE 2
# of a three-release removal: present in the database, excluded from the ORM mapper. See the long
# note in `app/models/user.py`.
TOMBSTONED_COLUMNS = ("notify_prompt", "notify_posts")


def test_the_tombstoned_columns_are_in_the_TABLE_but_not_the_MAPPER():
    """Both halves matter, and each one alone is a bug.

    IN THE TABLE, because the migration chain still creates them: drop them from `Base.metadata`
    and `test_migrated_schema_matches_models` above fails with `remove_column`. That is exactly
    what the first version of this cleanup prescribed, and it could never have worked — the drift
    guard is absolute and has no exemption mechanism, deliberately.

    OUT OF THE MAPPER, because that is the whole point of release 2: after it rolls, no running
    code names either column, which is the precondition for release 3's migration dropping them
    while the release-2 task is still serving traffic.
    """
    from app.models.user import User

    table_columns = set(User.__table__.columns.keys())
    mapped_columns = {p.key for p in User.__mapper__.column_attrs}

    for name in TOMBSTONED_COLUMNS:
        assert name in table_columns, f"{name} vanished from the Table — release 3 shipped early?"
        assert name not in mapped_columns, f"{name} is mapped again — release 2 was reverted"

    # The live switches must NOT have been caught by the same exclusion. `exclude_properties` takes
    # a list of strings, so a typo silently excludes nothing while a copy-paste silently excludes
    # a column the app depends on, and neither raises.
    for name in ("notify_prompt_me", "notify_friend_posts", "notify_people"):
        assert name in mapped_columns, f"{name} was excluded from the mapper by mistake"


def test_no_statement_the_ORM_emits_NAMES_a_tombstoned_column(tmp_path):
    """The release-3 safety property, asserted against real SQL rather than inferred.

    Release 3 drops these columns while the release-2 image is still serving, so if ANY statement
    still names one, that deploy is `ProgrammingError` 500s on a `desiredCount: 1` service with
    `/health` green. Two earlier attempts at release 2 failed exactly here and looked fine
    otherwise: `deferred=True` keeps both out of the SELECT but leaves them in
    `INSERT ... RETURNING`, and `deferred=True` without `server_default` puts an explicit NULL in
    the INSERT column list. Neither is visible without reading the emitted SQL, which is why this
    test reads it.
    """
    import re

    import sqlalchemy
    from sqlalchemy.orm import sessionmaker

    from app.database import Base
    from app.models.user import User
    import tests.conftest  # noqa: F401  (imports every model onto Base.metadata)

    engine = sqlalchemy.create_engine(f"sqlite:///{tmp_path}/tombstone.db")
    Base.metadata.create_all(engine)

    emitted = []

    @sqlalchemy.event.listens_for(engine, "before_cursor_execute")
    def _capture(conn, cursor, statement, parameters, context, executemany):
        emitted.append(statement)

    Session = sessionmaker(bind=engine)
    with Session() as db:
        db.add(User(first_name="Ana", last_name="Cruz", email="a@t.com", hashed_password="x"))
        db.commit()
        db.expire_all()
        loaded = db.query(User).first()
        # Touch every live notification field, the way a real request does, so a lazy load that
        # dragged a tombstone along would show up here.
        _ = (loaded.notify_prompt_me, loaded.notify_friend_posts, loaded.notify_people,
             loaded.notify_hour, loaded.notify_prompt_every_days, loaded.timezone)

    assert emitted, "captured no SQL — the listener did not fire, so this test proved nothing"
    for statement in emitted:
        if statement.strip().upper().startswith("CREATE"):
            continue  # CREATE TABLE legitimately names them; it is the Table that keeps them.
        for name in TOMBSTONED_COLUMNS:
            # WORD-BOUNDARY match, not `in`. `"notify_prompt" in "notify_prompt_me"` is True, so a
            # plain substring test fails on the LIVE column that REPLACED the dead one — which is
            # what the first version of this assertion did, reporting a defect that wasn't there.
            assert not re.search(rf"\b{re.escape(name)}\b", statement), (
                f"{name} is still named in a statement the ORM emits, so release 3 would "
                f"500 the API:\n{statement}"
            )
