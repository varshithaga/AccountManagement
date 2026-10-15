"""FastAPI application: routers, CORS, error handlers, media files and first-run setup."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .database import SessionLocal
from .errors import register_error_handlers
from .routers import (
    audit, auth, billing, dashboard, journal, masters, parties, period_close, reconciliation, reports, statements,
    transactions, users,
)
from .services import audit as _audit_tracking  # noqa: F401 - registers the audit log's flush listener
from .services.seed import ensure_default_roles

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # The schema is managed by Alembic (python cli.py migrate) - the app never creates tables itself.
    with SessionLocal() as db:
        ensure_default_roles(db)
    yield


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
               reports, period_close, dashboard, audit):
    app.include_router(module.router)

settings.media_root.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=settings.media_root), name="media")


@app.get("/api/health/", tags=["health"])
def health():
    return {"status": "ok"}
