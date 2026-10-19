"""Engines, session factories and the get_db dependency - one database per company.

The main database (DATABASE_URL) is the company with key "default" and also holds the list of the
other companies (the companies table). Each request names its company in the X-Company header
(none = "default"); get_db opens that company's database. The login token carries the company too,
and get_current_user refuses a token from another company - user ids repeat across databases.
"""
import re
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Optional

from fastapi import Request
from sqlalchemy import create_engine, event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings
from .errors import APIError

settings = get_settings()

DEFAULT_COMPANY = "default"
COMPANY_HEADER = "X-Company"
KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,39}$")
# How long a company's entry (database URL, active or not) is trusted before it is looked up again.
COMPANY_CACHE_SECONDS = 30


def make_engine(url: str) -> Engine:
    is_sqlite = url.startswith("sqlite")
    new = create_engine(url, connect_args={"check_same_thread": False} if is_sqlite else {},
                        pool_pre_ping=not is_sqlite)
    if is_sqlite:
        @event.listens_for(new, "connect")
        def _sqlite_connect(dbapi_connection, _record):
            # SQLite ignores ON DELETE CASCADE / SET NULL / RESTRICT unless this is on.
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
            # Let SQLAlchemy start transactions itself: the driver's own handling makes the first SAVEPOINT
            # open the transaction, so releasing it committed - a dry-run import or a rolled-back
            # recurring invoice was saved anyway.
            dbapi_connection.isolation_level = None

        @event.listens_for(new, "begin")
        def _sqlite_begin(conn):
            conn.exec_driver_sql("BEGIN")
    return new


engine = make_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

_factories: dict[str, sessionmaker] = {}           # database URL -> its session factory
_companies: dict[str, tuple[float, Optional[str]]] = {}  # key -> (looked up at, URL or None if unknown / inactive)
_lock = threading.Lock()


def _factory(url: str) -> sessionmaker:
    with _lock:
        if url not in _factories:
            _factories[url] = sessionmaker(bind=make_engine(url), autoflush=False, expire_on_commit=False)
        return _factories[url]


def company_url(key: str) -> Optional[str]:
    """The database URL of an active company, or None."""
    if key == DEFAULT_COMPANY:
        return settings.database_url
    cached = _companies.get(key)
    if cached and time.monotonic() - cached[0] < COMPANY_CACHE_SECONDS:
        return cached[1]
    from .models import Company

    with SessionLocal() as db:
        company = db.scalar(select(Company).where(Company.key == key))
        url = company.database_url if company and company.is_active else None
    _companies[key] = (time.monotonic(), url)
    return url


def forget_company(key: str) -> None:
    """Drops a cached lookup - after a company is added, moved or deactivated."""
    _companies.pop(key, None)


def company_session(key: str = DEFAULT_COMPANY) -> Session:
    """A session on a company's database (for the CLI and background jobs)."""
    url = company_url(key)
    if url is None:
        raise LookupError(f'There is no active company "{key}".')
    db = SessionLocal() if key == DEFAULT_COMPANY else _factory(url)()
    db.info["company"] = key
    return db


def active_company_keys() -> list[str]:
    """"default" and every active company, in the order they were added."""
    from .models import Company

    with SessionLocal() as db:
        others = db.scalars(select(Company.key).where(Company.is_active.is_(True)).order_by(Company.id)).all()
    return [DEFAULT_COMPANY, *[k for k in others if k != DEFAULT_COMPANY]]


def request_company(request: Request) -> str:
    key = (request.headers.get(COMPANY_HEADER) or DEFAULT_COMPANY).strip().lower()
    if key != DEFAULT_COMPANY and (not KEY_PATTERN.match(key) or company_url(key) is None):
        raise APIError(400, {"detail": f'Unknown company "{key[:40]}".', "code": "unknown_company"})
    return key


def get_db(request: Request) -> Iterator[Session]:
    db = company_session(request_company(request))
    try:
        yield db
    finally:
        db.close()


def media_root(db: Session) -> Path:
    """Where this company's uploads are kept: MEDIA_ROOT itself for "default", MEDIA_ROOT/<key>/ otherwise."""
    key = db.info.get("company", DEFAULT_COMPANY)
    return settings.media_root if key == DEFAULT_COMPANY else settings.media_root / key


def _alembic_config(url: Optional[str] = None):
    from alembic.config import Config

    backend_dir = Path(__file__).resolve().parent.parent
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "migrations"))
    if url:
        cfg.attributes["database_url"] = url  # read by migrations/env.py instead of DATABASE_URL
    return cfg


def migrate(url: Optional[str] = None) -> None:
    """Applies every pending Alembic migration (like Django's `migrate`) to one database - DATABASE_URL by default."""
    from alembic import command

    command.upgrade(_alembic_config(url), "head")


def migrate_all() -> list[str]:
    """Migrates the main database, then every company's. Returns the company keys done."""
    migrate()
    keys = active_company_keys()
    for key in keys[1:]:
        migrate(company_url(key))
    return keys


def make_migration(message: str) -> None:
    """Writes a new migration from the difference between models.py and the database
    (like Django's `makemigrations`). Review the generated file before applying it."""
    from alembic import command

    command.revision(_alembic_config(), message=message, autogenerate=True)
