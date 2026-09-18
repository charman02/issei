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
from sqlalchemy import create_engine, inspect, text

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


# `users.notify_prompt` and `users.notify_posts` were removed by migration `e6f7a8b9c0d1` —
# release 3 of 3. These two tests changed subject with it: through release 2 they asserted "on
# the Table, out of the mapper", which was that release's whole safety property. Now they
# assert the columns are gone from BOTH, and that the removal took nothing else with it.
REMOVED_COLUMNS = ("notify_prompt", "notify_posts")

# The three switches that replaced them. Named here because the realistic failure mode of a
# `drop_column` pair is not "it didn't work" — it is taking a neighbour along, or, during release 2,
# a fat-fingered `exclude_properties` entry silently unmapping one of these. Neither raises.
LIVE_NOTIFY_COLUMNS = (
    "notify_prompt_me",
    "notify_prompt_every_days",
    "notify_friend_posts",
    "notify_people",
    "notify_hour",
    "quiet_from",
    "quiet_to",
    "timezone",
)


def test_the_removed_columns_are_gone_from_BOTH_the_table_and_the_mapper():
    """Release 3 landed, so neither name may survive anywhere in the model.

    The pair matters because they can disagree, and each disagreement is a different bug that the
    drift guard above cannot always see:

    * still on the TABLE, gone from the mapper → release 3's migration never ran, or ran and the
      declaration was left behind. `test_migrated_schema_matches_models` catches this one.
    * gone from the table, still MAPPED → the reverse ordering, which is the outage this whole
      sequence exists to prevent: the ORM naming a column the database no longer has.
    """
    from app.models.user import User

    table_columns = set(User.__table__.columns.keys())
    mapped_columns = {p.key for p in User.__mapper__.column_attrs}

    for name in REMOVED_COLUMNS:
        assert name not in table_columns, f"{name} is still declared — release 3 is incomplete"
        assert name not in mapped_columns, f"{name} is still mapped — release 3 is incomplete"

    # And nothing else went with them.
    for name in LIVE_NOTIFY_COLUMNS:
        assert name in table_columns, f"{name} was removed by mistake"
        assert name in mapped_columns, f"{name} lost its mapping by mistake"


def test_no_statement_the_ORM_emits_NAMES_a_removed_column(tmp_path):
    """Reads the SQL the ORM actually emits, rather than inferring it from the model.

    THIS TEST IS THE REASON THE THREE-RELEASE SEQUENCE WORKED. Through release 2 its subject was the
    precondition for the drop — the ORM must stop naming a column BEFORE a migration removes it,
    because `.github/workflows/deploy.yml` migrates before it ships the image, so the previous task
    serves traffic against the new schema. It caught two release-2 attempts that looked correct and
    were not, neither visible in a diff:

    * `deferred=True` alone excludes the column from the SELECT but leaves it in
      `INSERT ... RETURNING` (that clause fetches server defaults; deferral does not govern it).
    * `deferred=True` with `server_default` removed from the model puts an explicit `NULL` in the
      INSERT column list, against a NOT NULL column.

    Now that release 3 has landed the property is simply permanent: nothing may resurrect either
    name. It still earns its place, because the failure it describes is a total API outage with
    `/health` green, and the next column removed from this table needs the same check at step 2.
    """
    import re

    import sqlalchemy
    from sqlalchemy import event  # explicit: `sqlalchemy.event` is a lazy submodule, so attribute
    from sqlalchemy.orm import sessionmaker  # access on the package alone doesn't type-check

    from app.database import Base
    from app.models.user import User
    import tests.conftest  # noqa: F401  (imports every model onto Base.metadata)

    engine = sqlalchemy.create_engine(f"sqlite:///{tmp_path}/removed-columns.db")
    Base.metadata.create_all(engine)

    emitted = []

    @event.listens_for(engine, "before_cursor_execute")
    def _capture(conn, cursor, statement, parameters, context, executemany):
        emitted.append(statement)

    Session = sessionmaker(bind=engine)
    with Session() as db:
        db.add(User(first_name="Ana", last_name="Cruz", email="a@t.com", hashed_password="x"))
        db.commit()
        db.expire_all()
        loaded = db.query(User).first()
        assert loaded is not None, "the row we just inserted did not come back"
        # Touch every live notification field, the way an authenticated request does — a lazy load
        # that dragged a removed column along would surface here and nowhere else.
        _ = tuple(getattr(loaded, name) for name in LIVE_NOTIFY_COLUMNS)

    assert emitted, "captured no SQL — the listener did not fire, so this test proved nothing"
    assert any(s.strip().upper().startswith("SELECT") for s in emitted), "no SELECT was captured"
    assert any(s.strip().upper().startswith("INSERT") for s in emitted), "no INSERT was captured"

    for statement in emitted:
        for name in REMOVED_COLUMNS:
            # WORD-BOUNDARY match, not `in`. `"notify_prompt" in "notify_prompt_me"` is True, so a
            # plain substring test fails on the LIVE column that REPLACED the dead one — which is
            # what the first version of this assertion did, reporting a defect that wasn't there.
            #
            # No CREATE-TABLE exemption any more: through release 2 the Column was still on the
            # Table, so `create_all` legitimately named it and this loop had to skip CREATE. Now
            # nothing may name it, in any statement, and dropping that skip is what makes the test
            # notice a resurrected declaration.
            assert not re.search(rf"\b{re.escape(name)}\b", statement), (
                f"{name} is named in SQL the ORM emits, but migration e6f7a8b9c0d1 dropped the "
                f"column — this is a 500 on every authenticated request:\n{statement}"
            )


def test_a_downgrade_that_re_adds_a_NOT_NULL_column_works_on_a_NON_EMPTY_table(tmp_path):
    """The blind spot in `test_chain_downgrades_back_to_base`, which runs on an EMPTY database.

    `e6f7a8b9c0d1`'s downgrade re-adds `notify_prompt` and `notify_posts` as NOT NULL. On an empty
    table that succeeds with or without a `server_default`; on a table with rows in it, omitting the
    default fails outright, because there is no value to put in the existing rows. Production's
    `users` is never empty, and a downgrade is what you reach for when a deploy has ALREADY gone
    wrong — so "the rollback also fails" is the worst possible time to discover this.

    A mutation deleting `server_default="1"` from the downgrade passed the whole suite before this
    existed. The lesson generalises past these two columns: any downgrade that re-adds a NOT NULL
    column needs a default, and only a seeded table proves it.

    Scoped to ONE step rather than the full chain, deliberately — seeding rows and then downgrading
    to base would fail on unrelated revisions for unrelated reasons, and the failure would be noise.
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'seeded.db'}")
    try:
        with engine.begin() as connection:
            command.upgrade(_alembic_config(connection), "head")

        # A row that exists BEFORE the downgrade — the whole point of the test.
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users (first_name, last_name, email, hashed_password) "
                    "VALUES ('Ana', 'Cruz', 'downgrade@t.com', 'x')"
                )
            )

        with engine.begin() as connection:
            command.downgrade(_alembic_config(connection), "-1")

        # Both columns are back, and the pre-existing row carries their original defaults rather
        # than a NULL a NOT NULL column would have rejected.
        with engine.connect() as connection:
            row = connection.execute(
                text(
                    "SELECT notify_prompt, notify_posts FROM users"
                    " WHERE email = 'downgrade@t.com'"
                )
            ).one()
        assert row[0] in (1, True), f"notify_prompt came back as {row[0]!r}, not its default"
        assert row[1] == "daily", f"notify_posts came back as {row[1]!r}, not its default"

        # And it goes back up, so the step is genuinely reversible rather than one-way-then-stuck.
        with engine.begin() as connection:
            command.upgrade(_alembic_config(connection), "head")
        with engine.connect() as connection:
            columns = {
                r[1] for r in connection.execute(text("PRAGMA table_info(users)")).fetchall()
            }
        assert not (set(REMOVED_COLUMNS) & columns), "re-upgrade left a dropped column behind"
    finally:
        engine.dispose()
