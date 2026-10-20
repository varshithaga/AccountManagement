"""FastAPI application: routers, CORS, error handlers and first-run setup."""
import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .database import active_company_keys, company_session
from .errors import register_error_handlers
from .routers import (
    ai, audit, auth, billing, communication, dashboard, inventory, journal, masters, parties, period_close,
    reconciliation, recurring, reports, statements, transactions, users,
)
from .services import audit as _audit_tracking  # noqa: F401 - registers the audit log's flush listener
from .services.recurring import run_scheduled
from .services.seed import ensure_default_roles

settings = get_settings()
log = logging.getLogger("ledgerdesk")


def _run_recurring() -> None:
    """One run in every company; one company's failure doesn't stop the others."""
    for key in active_company_keys():
        try:
            with company_session(key) as db:
                result = run_scheduled(db)
        except Exception:
            log.exception("Recurring invoice run failed for company %s", key)
            continue
        if result and (result["invoices_created"] or result["errors"]):
            log.info("Recurring invoices (%s): %s created, %s failed", key, result["invoices_created"],
                     len(result["errors"]))


async def _recurring_loop(minutes: int) -> None:
    """Raises recurring invoices that have fallen due - at start-up, then every `minutes`."""
    while True:
        try:
            await asyncio.to_thread(_run_recurring)
        except Exception:  # keep the loop alive; the next run tries again
            log.exception("Recurring invoice run failed")
        await asyncio.sleep(minutes * 60)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # The schema is managed by Alembic (python cli.py migrate) - the app never creates tables itself.
    for key in active_company_keys():
        with company_session(key) as db:
            ensure_default_roles(db)
    task = None
    if settings.recurring_check_minutes > 0:
        task = asyncio.create_task(_recurring_loop(settings.recurring_check_minutes))
    yield
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="LedgerDesk API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_allowed_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
register_error_handlers(app)

for module in (auth, users, masters, statements, transactions, journal, parties, billing, reconciliation,
               reports, period_close, dashboard, audit, inventory, recurring, communication, ai):
    app.include_router(module.router)
app.include_router(auth.companies_router)

# Uploaded files are not served publicly - statements download through /api/bank-statements/<id>/file/.
settings.media_root.mkdir(parents=True, exist_ok=True)


@app.get("/api/health/", tags=["health"])
def health():
    return {"status": "ok"}
