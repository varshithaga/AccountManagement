"""Document numbering, TDS on bills, recurring invoices, inventory, Excel import, payment reminders and email."""
import smtplib
from datetime import date

import pytest

from app.services import mailer, recurring
from app.models import Frequency
from conftest import sub_id
from test_api import TODAY, _gst18, d


def _item(admin, price="1000", account="Consulting Revenue", **extra):
    return {"description": "Work", "quantity": 1, "unit_price": price, "tax_rate_id": _gst18(admin)["id"],
            "account_id": sub_id(admin, account), **extra}


# ---------------------------------------------------------------------------
# Numbering
# ---------------------------------------------------------------------------

def test_number_counter(admin):
    c = admin.post("/api/clients/", json={"name": "Acme"}).json()
    peek = lambda: admin.get("/api/sales-invoices/next-number/").json()["invoice_number"]
    new = lambda **extra: admin.post("/api/sales-invoices/", json={
        "client_id": c["id"], "invoice_date": d(0), "items": [_item(admin)], **extra})

    # Looking at the next number doesn't take it.
    assert peek() == "INV-00001" and peek() == "INV-00001"
    assert new().json()["invoice_number"] == "INV-00001"
    assert peek() == "INV-00002"

    # A number typed in further ahead is skipped past; a clash is refused.
    assert new(invoice_number="INV-00010").status_code == 201
    assert peek() == "INV-00011" and new().json()["invoice_number"] == "INV-00011"
    assert new(invoice_number="INV-00010").status_code == 400

    # A save that fails gives its number back.
    assert admin.post("/api/sales-invoices/", json={"client_id": c["id"], "items": []}).status_code == 400
    assert new().json()["invoice_number"] == "INV-00012"

    # Deleting the newest draft doesn't hand its number out again.
    last = new().json()
    assert admin.delete(f"/api/sales-invoices/{last['id']}/").status_code == 204
    assert new().json()["invoice_number"] == "INV-00014"


# ---------------------------------------------------------------------------
# TDS
# ---------------------------------------------------------------------------

def _section(admin, code="194J", rate="10", **extra):
    r = admin.post("/api/tds-sections/", json={"code": code, "name": f"{code} Professional fees", "rate": rate, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def test_tds_on_bills_and_summary(admin):
    sec = _section(admin)
    assert sec["rate"] == "10.00"
    assert admin.post("/api/tds-sections/", json={"code": "194C"}).status_code == 400  # name and rate required

    supplier = admin.post("/api/suppliers/", json={"name": "Lawyer & Co", "pan": "ABCDE1234F",
                                                   "tds_section": sec["id"]}).json()
    assert supplier["tds_section_name"] == sec["name"]
    bill = admin.post("/api/purchase-bills/", json={
        "supplier_id": supplier["id"], "bill_number": "L-1", "bill_date": d(0), "post": True,
        "items": [_item(admin, "1000", "Professional Fees")]})
    assert bill.status_code == 201, bill.text
    bill = bill.json()
    # 10% of the taxable value (1000), not of the total with GST (1180).
    assert bill["tds_section"] == sec["id"] and bill["tds_rate"] == "10.00" and bill["tds_amount"] == "100.00"
    assert bill["total"] == "1180.00" and bill["balance_due"] == "1080.00"
    entry = admin.get(f"/api/journal-entries/{bill['journal_entry']}/").json()
    lines = {l["sub_category_name"]: (l["debit"], l["credit"]) for l in entry["lines"]}
    assert lines["Accounts Payable"] == ("0.00", "1080.00") and lines["TDS Payable"] == ("0.00", "100.00")
    assert any("TDS 194J @ 10% on L-1" in l["description"] for l in entry["lines"])

    # A bill can opt out of the supplier's default section.
    plain = admin.post("/api/purchase-bills/", json={
        "supplier_id": supplier["id"], "bill_number": "L-2", "bill_date": d(1), "post": True, "tds_section_id": None,
        "items": [_item(admin, "500", "Professional Fees")]}).json()
    assert plain["tds_amount"] == "0.00" and plain["balance_due"] == "590.00"

    # Paying what is due (total less TDS) settles the bill; aging and the statement agree.
    assert admin.get("/api/reports/payables-aging/", params={"as_of": d(1)}).json()["totals"]["total"] == 1670
    assert admin.get(f"/api/suppliers/{supplier['id']}/statement/").json()["closing_balance"] == 1670
    pay = admin.post("/api/payments/", json={"direction": "PAYMENT", "supplier_id": supplier["id"], "amount": "1080",
                                             "method": "CASH", "payment_date": d(2),
                                             "allocations": [{"purchase_bill_id": bill["id"], "amount": "1080"}]})
    assert pay.status_code == 201, pay.text
    assert admin.get(f"/api/purchase-bills/{bill['id']}/").json()["status"] == "PAID"

    # Its rate is fixed once used; it can't be deleted.
    assert admin.patch(f"/api/tds-sections/{sec['id']}/", json={"rate": "5"}).status_code == 400
    assert admin.delete(f"/api/tds-sections/{sec['id']}/").status_code == 400

    r = admin.get("/api/reports/tds-summary/", params={"period": "all_time"})
    assert r.status_code == 200, r.text
    tds = r.json()
    assert tds["total_deducted"] == 100 and tds["total_taxable"] == 1000 and tds["outstanding"] == 100
    assert tds["by_section"][0]["code"] == "194J" and tds["by_section"][0]["bills"] == 1
    assert tds["by_supplier"][0]["pan"] == "ABCDE1234F"
    assert [b["bill_number"] for b in tds["bills"]] == ["L-1"]
    csv = admin.get("/api/reports/tds-summary/", params={"period": "all_time", "format": "csv"})
    assert csv.status_code == 200 and "194J" in csv.text and "ABCDE1234F" in csv.text


# ---------------------------------------------------------------------------
# Recurring invoices
# ---------------------------------------------------------------------------

def test_recurring_month_end_dates():
    jan31 = date(2025, 1, 31)
    feb = recurring.advance(jan31, Frequency.MONTHLY, 31)
    assert feb == date(2025, 2, 28)
    assert recurring.advance(feb, Frequency.MONTHLY, 31) == date(2025, 3, 31)  # back to the 31st, not stuck on 28
    assert recurring.advance(date(2023, 12, 31), Frequency.MONTHLY, 31) == date(2024, 1, 31)
    assert recurring.advance(date(2024, 1, 31), Frequency.MONTHLY, 31) == date(2024, 2, 29)  # leap year
    assert recurring.advance(date(2025, 11, 30), Frequency.QUARTERLY, 30) == date(2026, 2, 28)
    assert recurring.advance(date(2025, 8, 31), Frequency.HALF_YEARLY, 31) == date(2026, 2, 28)
    assert recurring.advance(date(2024, 2, 29), Frequency.YEARLY, 29) == date(2025, 2, 28)


def test_recurring_invoices(admin):
    c = admin.post("/api/clients/", json={"name": "Retainer Co"}).json()
    year = TODAY.year - 1
    template = admin.post("/api/recurring-invoices/", json={
        "name": "Monthly retainer", "client_id": c["id"], "frequency": "monthly",
        "start_date": f"{year}-01-31", "end_date": f"{year}-04-30", "auto_post": True, "items": [_item(admin)]})
    assert template.status_code == 201, template.text
    template = template.json()
    assert template["next_date"] == f"{year}-01-31" and template["frequency"] == "MONTHLY"
    assert admin.get("/api/recurring-invoices/").json()["due"] == 1

    # Bad templates are refused.
    assert admin.post("/api/recurring-invoices/", json={"name": "x", "client_id": c["id"], "frequency": "weekly",
                                                       "start_date": d(0), "items": [_item(admin)]}).status_code == 400
    assert admin.post("/api/recurring-invoices/", json={"name": "x", "client_id": c["id"],
                                                       "start_date": d(0), "items": []}).status_code == 400

    # Catches up on every missed month, on the month's last day where the 31st doesn't exist.
    r = admin.post("/api/recurring-invoices/generate/")
    assert r.status_code == 200, r.text
    assert r.json()["invoices_created"] == 4 and r.json()["errors"] == []
    detail = admin.get(f"/api/recurring-invoices/{template['id']}/").json()
    feb_end = 29 if year % 4 == 0 else 28
    assert sorted(i["invoice_date"] for i in detail["invoices"]) == [
        f"{year}-01-31", f"{year}-02-{feb_end}", f"{year}-03-31", f"{year}-04-30"]
    assert {i["status"] for i in detail["invoices"]} == {"POSTED"}  # auto_post
    assert detail["invoices_created"] == 4 and detail["next_date"] == f"{year}-05-31"
    # Past its end date - nothing more is due.
    assert admin.post(f"/api/recurring-invoices/{template['id']}/generate/").status_code == 400
    assert admin.post("/api/recurring-invoices/generate/").json()["invoices_created"] == 0
    assert admin.get("/api/dashboard/sales-overview/").json()["recurring_due"] == 0

    # Without auto_post the invoices are drafts; a failure is kept on the template.
    drafts = admin.post("/api/recurring-invoices/", json={
        "name": "Quarterly", "client_id": c["id"], "frequency": "QUARTERLY", "start_date": d(0),
        "items": [_item(admin)]}).json()
    one = admin.post(f"/api/recurring-invoices/{drafts['id']}/generate/").json()
    assert one["invoices_created"] == 1
    assert admin.get(f"/api/sales-invoices/{one['invoice_ids'][0]}/").json()["status"] == "DRAFT"

    # Deleting a template keeps the invoices it raised.
    assert admin.delete(f"/api/recurring-invoices/{template['id']}/").status_code == 204
    assert admin.get("/api/sales-invoices/", params={"client": c["id"]}).json()["count"] == 5


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------

def _stock(admin, product_id):
    return next(p for p in admin.get("/api/inventory/").json()["products"] if p["product"] == product_id)


def test_inventory_movements(admin):
    widget = admin.post("/api/products/", json={
        "name": "Widget", "unit": "Nos", "sale_price": "100", "purchase_price": "40", "track_inventory": True,
        "reorder_level": "5", "income_account": sub_id(admin, "Product Sales"),
        "expense_account": sub_id(admin, "Office Supplies")})
    assert widget.status_code == 201, widget.text
    widget = widget.json()
    service = admin.post("/api/products/", json={"name": "Repair", "item_type": "SERVICE"}).json()
    assert admin.patch(f"/api/products/{service['id']}/", json={"track_inventory": True}).status_code == 400

    # Opening stock 10 @ 40.
    r = admin.post("/api/inventory/adjustments/", json={"product": widget["id"], "quantity": "10", "unit_cost": "40",
                                                         "movement_date": d(0), "opening": True})
    assert r.status_code == 201, r.text
    opening_id = r.json()["id"]
    assert admin.post("/api/inventory/adjustments/", json={"product": widget["id"], "quantity": "-1",
                                                           "opening": True}).status_code == 400
    assert admin.post("/api/inventory/adjustments/", json={"product": service["id"], "quantity": "1"}).status_code == 400

    # Buy 5 @ 70: on hand 15, average cost (400 + 350) / 15 = 50.
    supplier = admin.post("/api/suppliers/", json={"name": "Widget Works"}).json()
    bill = admin.post("/api/purchase-bills/", json={"supplier_id": supplier["id"], "bill_number": "W-1",
                                                    "bill_date": d(1), "post": True, "items": [
        {"product_id": widget["id"], "quantity": 5, "unit_price": "70"}]}).json()
    s = _stock(admin, widget["id"])
    assert (s["on_hand"], s["average_cost"], s["value"]) == (15, 50, 750)

    # Sell 12: down to 3, below the reorder level.
    acme = admin.post("/api/clients/", json={"name": "Acme"}).json()
    inv = admin.post("/api/sales-invoices/", json={"client_id": acme["id"], "invoice_date": d(2), "post": True,
                                                   "items": [{"product_id": widget["id"], "quantity": 12}]}).json()
    assert inv["items"][0]["quantity"] == "12"  # not "1.2E+1"
    s = _stock(admin, widget["id"])
    assert s["on_hand"] == 3 and s["below_reorder_level"] is True
    assert admin.get("/api/inventory/").json()["below_reorder_level"] == 1

    # 2 come back from the client (credit note); 1 goes back to the supplier (debit note).
    cn = admin.post("/api/credit-notes/", json={"sales_invoice_id": inv["id"], "note_date": d(3), "items": [
        {"product_id": widget["id"], "quantity": 2, "unit_price": "100"}]}).json()
    admin.post("/api/credit-notes/", json={"purchase_bill_id": bill["id"], "note_date": d(3), "items": [
        {"product_id": widget["id"], "quantity": 1, "unit_price": "70"}]})
    assert _stock(admin, widget["id"])["on_hand"] == 4

    moves = admin.get(f"/api/inventory/{widget['id']}/movements/").json()
    assert [m["kind"] for m in moves["rows"]] == ["OPENING", "PURCHASE", "SALE", "SALES_RETURN", "PURCHASE_RETURN"]
    assert [m["balance"] for m in moves["rows"]] == [10, 15, 3, 5, 4]
    assert moves["rows"][2]["document"] == {"type": "sales_invoice", "id": inv["id"], "number": inv["invoice_number"]}
    later = admin.get(f"/api/inventory/{widget['id']}/movements/", params={"date_from": d(2)}).json()
    assert later["opening"] == 15 and len(later["rows"]) == 3

    # Cancelling the credit note and then the invoice takes their movements out again.
    admin.post(f"/api/credit-notes/{cn['id']}/cancel/")
    assert admin.post(f"/api/sales-invoices/{inv['id']}/cancel/").status_code == 200
    assert _stock(admin, widget["id"])["on_hand"] == 14

    # Only adjustments can be deleted; a tracked product with movements can't stop being tracked.
    sale_move = next(m for m in moves["rows"] if m["kind"] == "PURCHASE")
    assert admin.delete(f"/api/inventory/adjustments/{sale_move['id']}/").status_code == 400
    assert admin.delete(f"/api/inventory/adjustments/{opening_id}/").status_code == 204
    assert _stock(admin, widget["id"])["on_hand"] == 4
    assert admin.patch(f"/api/products/{widget['id']}/", json={"track_inventory": False}).status_code == 400

    # As of a date.
    as_of = admin.get("/api/inventory/", params={"as_of": d(1)}).json()
    assert next(p for p in as_of["products"] if p["product"] == widget["id"])["on_hand"] == 5


# ---------------------------------------------------------------------------
# Excel import
# ---------------------------------------------------------------------------

def test_bulk_import(admin):
    sec = _section(admin)
    rows = [
        {"name": "Alpha Traders", "code": "AT", "state": "Karnataka", "opening_balance": "1000"},
        {"name": "Beta Supplies", "payable_account_name": "accounts payable", "tds_section_name": sec["name"]},
    ]

    # Dry run: checks, saves nothing.
    r = admin.post("/api/suppliers/bulk-import/", json={"rows": rows, "dry_run": True})
    assert r.status_code == 200, r.text
    assert r.json() == {"created": 0, "valid_rows": 2, "errors": [], "dry_run": True}
    assert admin.get("/api/suppliers/").json()["count"] == 0

    # One bad row - nothing is saved, every problem is listed.
    bad = rows + [{"name": "alpha traders"}, {"name": "Gamma", "payable_account_name": "Nope"}, {"code": "X"}]
    r = admin.post("/api/suppliers/bulk-import/", json={"rows": bad}).json()
    assert r["created"] == 0 and [e["row"] for e in r["errors"]] == [3, 4, 5]
    assert "also on row 1" in r["errors"][0]["message"] and '"Nope" does not exist' in r["errors"][1]["message"]
    assert admin.get("/api/suppliers/").json()["count"] == 0

    r = admin.post("/api/suppliers/bulk-import/", json={"rows": rows}).json()
    assert r["created"] == 2
    beta = admin.get("/api/suppliers/", params={"search": "Beta"}).json()["results"][0]
    assert beta["tds_section"] == sec["id"]
    # Opening balances are booked as usual.
    alpha = admin.get("/api/suppliers/", params={"search": "Alpha"}).json()["results"][0]
    assert admin.get("/api/journal-entries/", params={"search": f"OB-S-{alpha['id']}"}).json()["count"] == 1
    # Already exists now.
    assert admin.post("/api/suppliers/bulk-import/", json={"rows": rows[:1]}).json()["errors"]

    assert admin.post("/api/clients/bulk-import/", json={"rows": [{"name": "Client One", "email": "a@b.co"}]}
                      ).json()["created"] == 1
    assert admin.post("/api/clients/bulk-import/", json={"rows": []}).status_code == 400

    r = admin.post("/api/products/bulk-import/", json={"rows": [
        {"name": "Pen", "item_type": "goods", "sale_price": "10", "tax_rate_name": "gst 18%",
         "income_account_name": "Product Sales", "track_inventory": True, "reorder_level": "50"},
        {"name": "Consulting hour", "item_type": "Service", "sale_price": "abc"},
        {"name": "Setup", "item_type": "service", "track_inventory": True},
    ]}).json()
    assert [e["row"] for e in r["errors"]] == [2, 3] and "sale price" in r["errors"][0]["message"]
    r = admin.post("/api/products/bulk-import/", json={"rows": [
        {"name": "Pen", "item_type": "goods", "sale_price": "10", "tax_rate_name": "gst 18%",
         "income_account_name": "Product Sales", "track_inventory": True, "reorder_level": "50"},
        {"name": "Consulting hour", "item_type": "Service", "sale_price": "1500"}]}).json()
    assert r["created"] == 2
    pen = admin.get("/api/products/", params={"search": "Pen"}).json()["results"][0]
    assert pen["tax_rate"] == _gst18(admin)["id"] and pen["track_inventory"] is True and pen["reorder_level"] == "50"


# ---------------------------------------------------------------------------
# Payment reminders and email
# ---------------------------------------------------------------------------

class FakeSMTP:
    sent: list = []

    def __init__(self, host, port, timeout=None, **_):
        self.host, self.port = host, port

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        pass

    def login(self, username, password):
        if password != "secret":
            raise smtplib.SMTPAuthenticationError(535, b"bad password")

    def send_message(self, msg, to_addrs=None):
        FakeSMTP.sent.append((msg, to_addrs))


@pytest.fixture()
def smtp(monkeypatch):
    """Email set up on a fake server - nothing leaves the machine."""
    settings = mailer.get_settings().model_copy(update={
        "smtp_host": "smtp.test", "smtp_username": "accounts@ledgerdesk.test", "smtp_password": "secret"})
    monkeypatch.setattr(mailer, "get_settings", lambda: settings)
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)
    FakeSMTP.sent = []
    return settings


def _overdue_invoice(admin, client_id, price="1000"):
    r = admin.post("/api/sales-invoices/", json={"client_id": client_id, "invoice_date": d(0), "due_date": d(1),
                                                 "post": True, "items": [_item(admin, price)]})
    assert r.status_code == 201, r.text
    return r.json()


def test_payment_reminders(admin, smtp):
    acme = admin.post("/api/clients/", json={"name": "Acme", "contact_person": "Ravi", "email": "ravi@acme.test"}).json()
    other = admin.post("/api/clients/", json={"name": "Other"}).json()
    a1, a2 = _overdue_invoice(admin, acme["id"]), _overdue_invoice(admin, acme["id"], "500")
    _overdue_invoice(admin, other["id"], "100")
    admin.post("/api/sales-invoices/", json={"client_id": acme["id"], "invoice_date": d(0), "due_date": d(1),
                                             "items": [_item(admin)]})  # a draft isn't overdue

    r = admin.get("/api/reminders/")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["email"]["configured"] is True and data["total_overdue"] == 1770 + 118
    first = data["clients"][0]
    assert first["client_name"] == "Acme" and first["total_overdue"] == 1770 and len(first["invoices"]) == 2
    assert first["message"].startswith("Dear Ravi,") and a1["invoice_number"] in first["message"]
    assert "Rs. 1,770.00" in first["subject"]
    assert admin.get("/api/reminders/", params={"as_of": d(1)}).json()["clients"] == []  # not overdue yet

    # Mark as sent another way (phone) - recorded, nothing emailed.
    r = admin.post("/api/reminders/send/", json={"client_id": acme["id"], "invoice_ids": [a1["id"]], "send_email": False})
    assert r.status_code == 200, r.text
    assert r.json()["reminded"] == 1 and r.json()["sent_to"] == [] and FakeSMTP.sent == []
    inv = admin.get(f"/api/sales-invoices/{a1['id']}/").json()
    assert inv["reminder_count"] == 1 and inv["last_reminder_at"]

    # By email.
    r = admin.post("/api/reminders/send/", json={
        "client_id": acme["id"], "invoice_ids": [a1["id"], a2["id"]], "to": "Ravi <ravi@acme.test>",
        "cc": "boss@acme.test", "subject": first["subject"], "message": first["message"]}).json()
    assert r["sent_to"] == ["ravi@acme.test", "boss@acme.test"]
    msg, to_addrs = FakeSMTP.sent[0]
    assert to_addrs == ["ravi@acme.test", "boss@acme.test"] and msg["Subject"] == first["subject"]
    assert admin.get(f"/api/sales-invoices/{a1['id']}/").json()["reminder_count"] == 2
    reminded = admin.get("/api/reminders/").json()["clients"][0]
    assert reminded["last_reminder_at"] and {i["reminder_count"] for i in reminded["invoices"]} == {1, 2}

    # Someone else's invoice, or a bad address, is refused.
    assert admin.post("/api/reminders/send/", json={"client_id": other["id"], "invoice_ids": [a1["id"]],
                                                    "send_email": False}).status_code == 400
    assert admin.post("/api/reminders/send/", json={"client_id": acme["id"], "invoice_ids": [a1["id"]],
                                                    "to": "not-an-email"}).status_code == 400
    assert any(r["action"] == "REMIND" for r in admin.get("/api/audit-log/", params={"entity": "Client"}).json()["results"])


def test_email_invoice(admin, smtp):
    acme = admin.post("/api/clients/", json={"name": "Acme"}).json()
    inv = _overdue_invoice(admin, acme["id"])
    pdf = {"file": ("invoice.pdf", b"%PDF-1.4 test", "application/pdf")}
    form = {"to": "ravi@acme.test", "subject": "Your invoice", "message": "Please find it attached."}

    assert admin.get("/api/email/status/").json() == {"configured": True, "from": "accounts@ledgerdesk.test"}
    r = admin.post(f"/api/sales-invoices/{inv['id']}/email/", data=form, files=pdf)
    assert r.status_code == 200, r.text
    assert r.json()["sent_to"] == ["ravi@acme.test"]
    msg, _ = FakeSMTP.sent[0]
    assert msg["From"] == "accounts@ledgerdesk.test" and msg["Subject"] == "Your invoice"
    attachment = next(msg.iter_attachments())
    assert attachment.get_filename() == "invoice.pdf" and attachment.get_content() == b"%PDF-1.4 test"
    assert any(r["action"] == "EMAIL" for r in admin.get("/api/audit-log/", params={"entity": "SalesInvoice"}).json()["results"])

    # Only a PDF; only posted invoices; the server must accept the login.
    assert admin.post(f"/api/sales-invoices/{inv['id']}/email/", data=form,
                      files={"file": ("x.pdf", b"hello", "application/pdf")}).status_code == 400
    draft = admin.post("/api/sales-invoices/", json={"client_id": acme["id"], "items": [_item(admin)]}).json()
    assert admin.post(f"/api/sales-invoices/{draft['id']}/email/", data=form).status_code == 400
    mailer.get_settings().smtp_password = "wrong"
    r = admin.post(f"/api/sales-invoices/{inv['id']}/email/", data=form)
    assert r.status_code == 400 and "refused" in r.text


def test_email_not_configured(admin, monkeypatch):
    settings = mailer.get_settings().model_copy(update={"smtp_host": ""})
    monkeypatch.setattr(mailer, "get_settings", lambda: settings)
    acme = admin.post("/api/clients/", json={"name": "Acme"}).json()
    inv = _overdue_invoice(admin, acme["id"])
    assert admin.get("/api/email/status/").json()["configured"] is False
    r = admin.post(f"/api/sales-invoices/{inv['id']}/email/", data={"to": "a@b.test"})
    assert r.status_code == 400 and "not set up" in r.text
