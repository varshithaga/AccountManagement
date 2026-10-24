"""python cli.py demo-data: sample books with planted duplicates."""
import pytest

from app.services.demo_data import DemoDataError, load_demo_data


def test_demo_data_needs_an_admin(client):
    with pytest.raises(DemoDataError, match="No administrator"):
        load_demo_data("default")


def test_demo_data(admin):
    result = load_demo_data("default")
    assert result["added"]["sales invoices"] == 9 and result["added"]["bank statements"] == 2
    assert result["duplicate_bank_rows_flagged"] == 8  # a repeated row (2) + a 3-row overlap (6)
    assert all(line.endswith(": refused") for line in result["refused"])

    assert admin.get("/api/clients/").json()["count"] == 5
    stock = {p["name"]: p for p in admin.get("/api/inventory/").json()["products"]}
    assert stock["Laptop stand"]["on_hand"] == 11 and stock["Printer paper (ream)"]["below_reorder_level"] is True

    with pytest.raises(DemoDataError, match="already in"):
        load_demo_data("default")
