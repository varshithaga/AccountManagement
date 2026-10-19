"""Alembic environment: uses the app's DATABASE_URL (from .env) and its models' metadata."""
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import get_settings
from app.models import Base

config = context.config
# A company database is migrated by passing its URL (app.database.migrate(url)); else DATABASE_URL.
config.set_main_option("sqlalchemy.url",
                       (config.attributes.get("database_url") or get_settings().database_url).replace("%", "%%"))

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _options(url: str) -> dict:
    return {
        "target_metadata": target_metadata,
        "compare_type": True,  # notice column type / length changes too
        # SQLite can't ALTER most columns in place - batch mode rebuilds the table instead.
        "render_as_batch": url.startswith("sqlite"),
    }


def run_migrations_offline() -> None:
    """Writes the SQL to stdout instead of running it (alembic upgrade head --sql)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, literal_binds=True, dialect_opts={"paramstyle": "named"}, **_options(url))
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.",
                                     poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, **_options(str(connection.engine.url)))
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
