"""Scheduled recurring runs, backups and the audit log of the newer records."""
import sqlite3
import zipfile
from contextlib import closing
from pathlib import Path

from app.database import SessionLocal
from app.services import backup as backup_service
from app.services.recurring import run_scheduled
from conftest import sub_id
from test_api import _gst18, d


def _template(admin, **extra):
    c = admin.post("/api/clients/", json={"name": "Retainer Co"}).json()
    r = admin.post("/api/recurring-invoices/", json={
        "name": "Retainer", "client_id": c["id"], "frequency": "MONTHLY", "start_date": d(0), "items": [
            {"description": "Retainer", "unit_price": "1000", "tax_rate_id": _gst18(admin)["id"],
             "account_id": sub_id(admin, "Consulting Revenue")}], **extra})
    assert r.status_code == 201, r.text
    return r.json()


def test_scheduled_recurring_run(admin):
    t = _template(admin)
    with SessionLocal() as db:
        first = run_scheduled(db)
    assert first["invoices_created"] >= 1 and first["errors"] == []
    with SessionLocal() as db:
        assert run_scheduled(db)["invoices_created"] == 0  # nothing due twice
    assert admin.get(f"/api/recurring-invoices/{t['id']}/").json()["invoices_created"] == first["invoices_created"]
    runs = admin.get("/api/audit-log/", params={"entity": "RecurringInvoice"}).json()["results"]
    assert any(r["action"] == "GENERATE" and r["username"] == "scheduler" for r in runs)


def test_backup_sqlite(admin, tmp_path, monkeypatch):
    admin.post("/api/clients/", json={"name": "Backed Up Ltd"})
    settings = backup_service.get_settings()
    media = Path(settings.media_root)
    (media / "bank_statements").mkdir(parents=True, exist_ok=True)
    (media / "bank_statements" / "april.csv").write_text("Date,Amount\n")
    patched = settings.model_copy(update={"backup_dir": tmp_path / "backups"})
    monkeypatch.setattr(backup_service, "get_settings", lambda: patched)

    result = backup_service.backup()
    folder = Path(result["folder"])
    assert sorted(p.name for p in folder.iterdir()) == ["RESTORE.txt", "database.sqlite3", "media.zip"]
    assert "bank_statements/april.csv" in zipfile.ZipFile(folder / "media.zip").namelist()
    assert "python cli.py migrate" in (folder / "RESTORE.txt").read_text(encoding="utf-8")
    with closing(sqlite3.connect(folder / "database.sqlite3")) as copy:
        assert copy.execute("SELECT name FROM clients").fetchall() == [("Backed Up Ltd",)]

    # --keep removes the oldest backups.
    (tmp_path / "backups" / "2000-01-01_000000").mkdir()
    (tmp_path / "backups" / "2000-01-01_000000" / "RESTORE.txt").write_text("old")
    assert backup_service.backup(keep=1)["removed"] == ["2000-01-01_000000", folder.name]


def test_audit_log_of_newer_records(admin):
    log = lambda entity: admin.get("/api/audit-log/", params={"entity": entity}).json()["results"]
    sec = admin.post("/api/tds-sections/", json={"code": "194C", "name": "Contractors", "rate": "1"}).json()
    admin.patch(f"/api/tds-sections/{sec['id']}/", json={"rate": "2"})
    assert [r["action"] for r in log("TdsSection")] == ["UPDATE", "CREATE"]

    _template(admin)
    assert log("RecurringInvoice")[0]["label"] == "Retainer"

    widget = admin.post("/api/products/", json={"name": "Widget", "track_inventory": True,
                                                "expense_account": sub_id(admin, "Office Supplies")}).json()
    admin.post("/api/inventory/adjustments/", json={"product": widget["id"], "quantity": "10", "opening": True,
                                                    "movement_date": d(0)})
    supplier = admin.post("/api/suppliers/", json={"name": "Widget Works"}).json()
    admin.post("/api/purchase-bills/", json={"supplier_id": supplier["id"], "bill_number": "W1", "bill_date": d(1),
                                             "post": True, "items": [{"product_id": widget["id"], "unit_price": "5"}]})
    # The opening stock is logged; the bill's movement is not (the bill itself is).
    moves = log("StockMovement")
    assert len(moves) == 1 and moves[0]["label"] == "Widget +10.000 (opening)"
