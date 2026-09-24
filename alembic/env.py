from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
from app.database import Base
from app.models.user import User  # noqa: F401
from app.models.recipe import Recipe  # noqa: F401
from app.models.ingredient_section import IngredientSection  # noqa: F401
from app.models.ingredient import Ingredient  # noqa: F401
from app.models.step import Step  # noqa: F401
from app.models.cook_event import CookEvent  # noqa: F401
from app.models.handoff import Handoff  # noqa: F401
from app.models.feedback import Feedback  # noqa: F401
from app.models.friendship import Friendship  # noqa: F401
from app.models.post import Post  # noqa: F401
from app.models.recipe_save import RecipeSave  # noqa: F401
from app.models.recipe_request import RecipeRequest  # noqa: F401
from app.models.notification import Notification  # noqa: F401
from app.models.block import Block  # noqa: F401
from app.models.report import Report  # noqa: F401
from app.models.pass_on_request import PassOnRequest  # noqa: F401
# password_reset was MISSING from this list, which is not cosmetic: autogenerate diffs the
# metadata it can see against the database, so an unimported model reads as a table that
# should not exist. `alembic check` was reporting a pending DROP TABLE
# password_reset_tokens — which the documented workflow (`alembic revision --autogenerate`)
# would have written into a migration, and `main` runs migrations against Neon on push.
# Every model belongs here, whether or not anything else in this file mentions it.
from app.models.password_reset import PasswordResetToken  # noqa: F401
from app.models.push_subscription import PushSubscription  # noqa: F401
from app.models.prompt_send import PromptSend  # noqa: F401

target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    # A caller may inject its own connection via config.attributes (the standard
    # Alembic hook). The migration-chain test uses this to run the chain against a
    # throwaway SQLite file WITHOUT importing app.database, whose module-level
    # engine is bound to DATABASE_URL — which in local .env files points at
    # production. Injection makes it structurally impossible for that test to
    # reach a real database rather than merely unlikely.
    connectable = config.attributes.get("connection", None)

    if connectable is not None:
        context.configure(connection=connectable, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
        return

    from app.database import engine

    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
