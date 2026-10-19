"""Engine, session factory and the get_db dependency."""
from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings

settings = get_settings()

_is_sqlite = settings.database_url.startswith("sqlite")
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    pool_pre_ping=not _is_sqlite,
)

if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _sqlite_foreign_keys(dbapi_connection, _record):
        # SQLite ignores ON DELETE CASCADE / SET NULL / RESTRICT unless this is on.
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
        # Let SQLAlchemy start transactions itself: the driver's own handling makes the first SAVEPOINT
        # open the transaction, so releasing it committed - a dry-run import or a rolled-back
        # recurring invoice was saved anyway.
        dbapi_connection.isolation_level = None

    @event.listens_for(engine, "begin")
    def _sqlite_begin(conn):
        conn.exec_driver_sql("BEGIN")

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _alembic_config():
    from pathlib import Path

    from alembic.config import Config

    backend_dir = Path(__file__).resolve().parent.parent
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "migrations"))
    return cfg


def migrate() -> None:
    """Applies every pending Alembic migration (like Django's `migrate`)."""
    from alembic import command

    command.upgrade(_alembic_config(), "head")


def make_migration(message: str) -> None:
    """Writes a new migration from the difference between models.py and the database
    (like Django's `makemigrations`). Review the generated file before applying it."""
    from alembic import command

    command.revision(_alembic_config(), message=message, autogenerate=True)
