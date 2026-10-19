"""Several companies in one installation: adding a company (its own database, migrated, with the
default roles) and listing them for the sign-in page. See app/database.py for how requests reach them."""
from pathlib import Path
from typing import Optional

from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url

from ..config import get_settings
from ..database import (
    DEFAULT_COMPANY, KEY_PATTERN, SessionLocal, active_company_keys, company_session, forget_company, migrate,
)
from ..models import Company
from .seed import ensure_default_roles
from .settings import accounting_settings


class CompanyError(Exception):
    pass


def default_database_url(key: str) -> str:
    """Next to the main database: PostgreSQL <main db>_<key> on the same server, or SQLite <file>_<key>.db."""
    url = make_url(get_settings().database_url)
    if url.get_backend_name() == 'sqlite':
        path = Path(url.database)
        return url.set(database=str(path.with_name(f'{path.stem}_{key}{path.suffix or ".db"}'))) \
            .render_as_string(hide_password=False)
    return url.set(database=f'{url.database}_{key}').render_as_string(hide_password=False)


def _create_database(url_text: str) -> None:
    url = make_url(url_text)
    if url.get_backend_name() != 'postgresql':
        return  # SQLite creates the file on first use
    server = create_engine(url.set(database='postgres'), isolation_level='AUTOCOMMIT')
    try:
        with server.connect() as conn:
            if not conn.scalar(text('SELECT 1 FROM pg_database WHERE datname = :n'), {'n': url.database}):
                conn.execute(text(f'CREATE DATABASE "{url.database}"'))
    finally:
        server.dispose()


def create_company(key: str, name: str, database_url: Optional[str] = None) -> Company:
    """Creates the company's database (unless it exists), migrates it, adds the default roles, and only
    then lists it - a failure part-way leaves no half-made company behind in the list."""
    key = (key or '').strip().lower()
    name = (name or '').strip()
    if key == DEFAULT_COMPANY or not KEY_PATTERN.match(key):
        raise CompanyError('The key must be 2-40 lowercase letters, digits or _, start with a letter, '
                           f'and not be "{DEFAULT_COMPANY}".')
    if not name:
        raise CompanyError('Give the company a name.')
    url = database_url or default_database_url(key)
    if url == get_settings().database_url:
        raise CompanyError('That is the main database - each company needs a database of its own.')
    with SessionLocal() as main:
        if main.scalar(select(Company.id).where(Company.key == key)):
            raise CompanyError(f'A company "{key}" already exists.')
        if main.scalar(select(Company.id).where(Company.database_url == url)):
            raise CompanyError('Another company already uses that database.')
    _create_database(url)
    migrate(url)
    forget_company(key)
    with SessionLocal() as main:
        company = Company(key=key, name=name, database_url=url, is_active=True)
        main.add(company)
        main.commit()
    forget_company(key)
    with company_session(key) as db:
        ensure_default_roles(db)
        settings = accounting_settings(db)
        if not settings.company_name:
            settings.company_name = name
        db.commit()
    return company


def list_companies() -> list[dict]:
    """Active companies for the sign-in page: [{"key", "name"}], "default" first."""
    with SessionLocal() as main:
        names = dict(main.execute(select(Company.key, Company.name).where(Company.is_active.is_(True))).all())
        default = accounting_settings(main).company_name or 'Main company'
    return [{'key': k, 'name': default if k == DEFAULT_COMPANY else names.get(k, k)} for k in active_company_keys()]
