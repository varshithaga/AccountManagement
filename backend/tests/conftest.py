import os
import tempfile
from pathlib import Path

# Point the app at a throwaway database and media folder before it is imported. Tests use a
# temporary SQLite file unless TEST_DATABASE_URL names a (disposable!) database - every test drops
# and recreates all its tables.
_tmp = Path(tempfile.mkdtemp(prefix="accounting-tests-"))
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ["MEDIA_ROOT"] = str(_tmp / "media")
os.environ["AUTH_RATE_LIMIT_PER_MINUTE"] = "1000"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402
from app.services.seed import ensure_default_roles, seed_bai_codes, seed_chart_of_accounts  # noqa: E402


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        ensure_default_roles(db)
        seed_chart_of_accounts(db)
        seed_bai_codes(db)
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def admin(client):
    """A client signed in as the first (administrator) user."""
    r = client.post("/api/auth/register/", json={"username": "owner", "password": "Str0ng-pass!"})
    assert r.status_code == 201, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['access']}"
    return client


def sub_id(client, name: str) -> int:
    r = client.get("/api/lookups/subcategories/", params={"search": name, "limit": 50})
    assert r.status_code == 200, r.text
    return next(s["id"] for s in r.json()["results"] if s["name"] == name)
