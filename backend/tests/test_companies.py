"""Several companies in one installation: each has its own database, and nothing - data, tokens, files -
crosses from one to another."""
import zipfile
from pathlib import Path

import pytest

from app import database
from app.models import Company
from app.services import backup as backup_service
from app.services.companies import CompanyError, create_company
from app.services.seed import seed_chart_of_accounts
from test_api import STATEMENT_CSV, _bank, _upload

PASSWORD = "Str0ng-pass!"


@pytest.fixture()
def acme(client, tmp_path):
    """A second company "acme" with its own (migrated) SQLite database."""
    company = create_company("acme", "Acme Traders", f"sqlite:///{(tmp_path / 'acme.db').as_posix()}")
    with database.company_session("acme") as db:  # as `python cli.py seed --company acme`
        seed_chart_of_accounts(db)
    yield company
    database.forget_company("acme")


def _sign_up(client, company, username="owner"):
    r = client.post("/api/auth/register/", json={"username": username, "password": PASSWORD},
                    headers={"X-Company": company})
    assert r.status_code == 201, r.text
    return {"X-Company": company, "Authorization": f"Bearer {r.json()['access']}"}, r.json()


def test_company_list_and_create_rules(client, acme):
    r = client.get("/api/companies/").json()
    assert [c["key"] for c in r["companies"]] == ["default", "acme"]
    assert r["companies"][1]["name"] == "Acme Traders"
    with pytest.raises(CompanyError):
        create_company("acme", "Again")
    with pytest.raises(CompanyError):
        create_company("default", "Main")
    with pytest.raises(CompanyError):
        create_company("Bad Key!", "x")


def test_companies_are_separate(client, acme):
    main, _ = _sign_up(client, "default")
    other, data = _sign_up(client, "acme")  # the same username, and also the first user - so admin there
    assert client.get("/api/auth/me/", headers=other).json()["is_admin"]
    assert client.get("/api/auth/me/", headers=other).json()["company"] == {"key": "acme", "name": "Acme Traders"}
    assert client.get("/api/auth/me/", headers=main).json()["company"]["key"] == "default"

    client.post("/api/clients/", json={"name": "Only In Acme"}, headers=other)
    assert client.get("/api/clients/", headers=other).json()["count"] == 1
    assert client.get("/api/clients/", headers=main).json()["count"] == 0
    # Each company has its own chart of accounts, roles and numbering.
    assert client.get("/api/roles/", headers=other).status_code == 200


def test_token_only_works_in_its_company(client, acme):
    main, _ = _sign_up(client, "default")
    other, data = _sign_up(client, "acme")
    # User id 1 exists in both databases - the token's company is what keeps them apart.
    stolen = {"Authorization": other["Authorization"]}
    r = client.get("/api/auth/me/", headers=stolen)  # no header = the main company
    assert r.status_code == 401 and r.json()["code"] == "wrong_company"
    assert client.get("/api/auth/me/", headers={**stolen, "X-Company": "default"}).status_code == 401
    assert client.get("/api/auth/me/", headers={"X-Company": "acme", "Authorization": main["Authorization"]}).status_code == 401

    # Refresh and logout too.
    assert client.post("/api/auth/token/refresh/", json={"refresh": data["refresh"]}).status_code == 401
    r = client.post("/api/auth/token/refresh/", json={"refresh": data["refresh"]}, headers={"X-Company": "acme"})
    assert r.status_code == 200

    # Signing in checks the password of that company's user.
    assert client.post("/api/auth/token/", json={"username": "owner", "password": PASSWORD},
                       headers={"X-Company": "acme"}).status_code == 200


def test_unknown_or_inactive_company(client, acme):
    assert client.get("/api/companies/", headers={"X-Company": "nope"}).status_code == 200  # public, no company
    r = client.post("/api/auth/token/", json={"username": "x", "password": "y"}, headers={"X-Company": "nope"})
    assert r.status_code == 400 and r.json()["code"] == "unknown_company"

    other, _ = _sign_up(client, "acme")
    with database.SessionLocal() as db:
        db.query(Company).filter_by(key="acme").update({"is_active": False})
        db.commit()
    database.forget_company("acme")
    assert client.get("/api/auth/me/", headers=other).status_code == 400
    assert [c["key"] for c in client.get("/api/companies/").json()["companies"]] == ["default"]


def test_uploads_are_kept_per_company(client, acme):
    main, _ = _sign_up(client, "default")
    other, _ = _sign_up(client, "acme")
    for h in (main, other):
        client.headers.update(h)
        stmt = _upload(client, _bank(client)["id"]).json()
        assert client.get(f"/api/bank-statements/{stmt['id']}/file/").content == STATEMENT_CSV.encode()
    client.headers.pop("X-Company")
    media = Path(database.settings.media_root)
    assert list((media / "acme" / "bank_statements").rglob("march.csv"))
    main_files = [p for p in (media / "bank_statements").rglob("*.csv")]
    assert main_files and all("acme" not in p.parts for p in main_files)


def test_backup_covers_every_company(client, acme, tmp_path, monkeypatch):
    if not database.settings.database_url.startswith("sqlite"):
        pytest.skip("copies the SQLite test databases")
    main, _ = _sign_up(client, "default")
    other, _ = _sign_up(client, "acme")
    client.headers.update(other)
    _upload(client, _bank(client)["id"])
    patched = backup_service.get_settings().model_copy(update={"backup_dir": tmp_path / "backups"})
    monkeypatch.setattr(backup_service, "get_settings", lambda: patched)

    result = backup_service.backup()
    folder = Path(result["folder"])
    assert set(result["companies"]) == {"default", "acme"}
    assert (folder / "companies" / "acme" / "database.sqlite3").exists()
    acme_zip = zipfile.ZipFile(folder / "companies" / "acme" / "media.zip").namelist()
    main_zip = zipfile.ZipFile(folder / "media.zip").namelist()
    assert any(n.endswith("march.csv") for n in acme_zip)
    assert not any(n.startswith("acme/") for n in main_zip)  # the main company's zip leaves acme's files out
