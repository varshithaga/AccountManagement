"""End-to-end checks of every area of the API, through HTTP, on a fresh SQLite database."""
from datetime import date, timedelta

from conftest import sub_id

TODAY = date.today()
D1 = (TODAY - timedelta(days=40)).replace(day=1)  # a date safely in the past


def d(offset: int) -> str:
    return (D1 + timedelta(days=offset)).isoformat()


STATEMENT_CSV = (
    "Date,Description,Debit,Credit,Balance\n"
    f"{d(0)},Opening deposit client payment ACME,,1000.00,11000.00\n"
    f"{d(1)},POS OFFICE RENT 12345,250.00,,10750.00\n"
    f"{d(2)},Electricity bill,100.00,,10650.00\n"
)


# ---------------------------------------------------------------------------
# Auth & access
# ---------------------------------------------------------------------------

def test_auth_flow(client):
    r = client.post("/api/auth/register/", json={"username": "owner", "password": "Str0ng-pass!"})
    assert r.status_code == 201
    tokens = r.json()
    me = client.get("/api/auth/me/", headers={"Authorization": f"Bearer {tokens['access']}"}).json()
    assert me["is_admin"] and "user_management" in me["pages"]

    assert client.post("/api/auth/token/", json={"username": "owner", "password": "wrong"}).status_code == 401
    pair = client.post("/api/auth/token/", json={"username": "owner", "password": "Str0ng-pass!"}).json()
    rotated = client.post("/api/auth/token/refresh/", json={"refresh": pair["refresh"]})
    assert rotated.status_code == 200
    # The old refresh token was rotated out.
    assert client.post("/api/auth/token/refresh/", json={"refresh": pair["refresh"]}).status_code == 401
    assert client.post("/api/auth/logout/", json={"refresh": rotated.json()["refresh"]}).status_code == 205
    assert client.post("/api/auth/token/refresh/", json={"refresh": rotated.json()["refresh"]}).status_code == 401

    # Weak passwords and duplicate usernames are refused.
    assert client.post("/api/auth/register/", json={"username": "x", "password": "12345678"}).status_code == 400
    assert client.post("/api/auth/register/", json={"username": "OWNER", "password": "Str0ng-pass!"}).status_code == 400


def test_new_user_has_no_access_until_given_a_role(admin):
    admin.post("/api/auth/register/", json={"username": "clerk", "password": "Another-pass1"})
    token = admin.post("/api/auth/token/", json={"username": "clerk", "password": "Another-pass1"}).json()["access"]
    headers = {"Authorization": f"Bearer {token}"}
    assert admin.get("/api/categories/", headers=headers).status_code == 403
    assert admin.get("/api/auth/me/", headers=headers).json()["pages"] == []

    viewer = next(r for r in admin.get("/api/roles/").json() if r["name"] == "Viewer")
    clerk = next(u for u in admin.get("/api/users/").json()["results"] if u["username"] == "clerk")
    assert admin.patch(f"/api/users/{clerk['id']}/", json={"role": viewer["id"]}).status_code == 200
    assert admin.get("/api/reports/profit-and-loss/", headers=headers).status_code == 200
    assert admin.get("/api/categories/", headers=headers).status_code == 403  # Viewer has no Chart of Accounts


def test_last_admin_cannot_be_removed(admin):
    me = admin.get("/api/auth/me/").json()
    assert admin.patch(f"/api/users/{me['id']}/", json={"is_active": False}).status_code == 400
    assert admin.delete(f"/api/users/{me['id']}/").status_code == 400


# ---------------------------------------------------------------------------
# Chart of Accounts & masters
# ---------------------------------------------------------------------------

def test_chart_of_accounts(admin):
    r = admin.post("/api/categories/", json={"name": "Test Income", "account_type": "INCOME", "code": " "})
    assert r.status_code == 201 and r.json()["code"] is None
    cat = r.json()["id"]
    assert admin.post("/api/categories/", json={"name": "Test Income", "account_type": "INCOME"}).status_code == 400
    sub = admin.post("/api/subcategories/", json={"category": cat, "name": "Widgets"}).json()
    assert sub["category_name"] == "Test Income"
    assert admin.delete(f"/api/categories/{cat}/").status_code == 400  # still has a sub-category
    assert admin.get("/api/categories/", params={"search": "Widgets"}).json()["count"] == 1

    summary = admin.get("/api/categories/summary/").json()
    assert summary["by_type"]["INCOME"]["categories"] >= 3
    lookup = admin.get("/api/lookups/subcategories/", params={"search": "rent expense"}).json()
    assert lookup["results"][0]["name"] == "Rent"

    r = admin.post("/api/categories/bulk-import/", json={"rows": [
        {"name": "Imported", "account_type": "EXPENSE", "sub_categories": [{"name": "Thing A"}, {"name": "Thing B"}]}]})
    assert r.json() == {"categories_created": 1, "subcategories_created": 2}


def test_keywords_bai_and_bank_accounts(admin):
    rent = sub_id(admin, "Rent")
    r = admin.post("/api/category-keywords/bulk-create/", json={"rows": [{"keyword": "landlord", "sub_category": rent}]})
    assert r.status_code == 201, r.text
    assert admin.get("/api/category-keywords/", params={"search": "landlord"}).json()["results"][0]["sub_category_name"] == "Rent"
    assert admin.get("/api/bai-codes/summary/").json()["total"] > 100
    assert admin.put("/api/categorization-settings/", json={"review_min_score": 40}).json()["review_min_score"] == 40

    bank_gl = sub_id(admin, "Bank Accounts")
    acct = admin.post("/api/bank-accounts/", json={"name": "Main", "bank_name": "HDFC", "gl_account": bank_gl}).json()
    assert acct["gl_account_name"] == "Bank Accounts"
    dup = admin.post("/api/bank-accounts/", json={"name": "Second", "gl_account": bank_gl})
    assert dup.status_code == 400 and "gl_account" in dup.json()


# ---------------------------------------------------------------------------
# Statements, categorization, reconciliation, reports
# ---------------------------------------------------------------------------

def _bank(admin):
    return admin.post("/api/bank-accounts/", json={"name": "Main", "bank_name": "HDFC",
                                                   "gl_account": sub_id(admin, "Bank Accounts")}).json()


def _upload(admin, account_id, content=STATEMENT_CSV, name="march.csv", **extra):
    return admin.post("/api/bank-statements/", data={"account": account_id, "source_type": "CSV", **extra},
                      files={"file": (name, content.encode(), "text/csv")})


def test_statement_upload_categorize_and_finalize(admin):
    bank = _bank(admin)
    r = _upload(admin, bank["id"])
    assert r.status_code == 201, r.text
    stmt = r.json()
    assert stmt["transaction_count"] == 3 and stmt["opening_balance"] == "10000.00" and stmt["closing_balance"] == "10650.00"
    assert _upload(admin, bank["id"]).status_code == 409  # same file again

    result = admin.post(f"/api/bank-statements/{stmt['id']}/categorize/").json()
    assert result["matched"] + result["needs_review"] + result["unmatched"] == 3

    txns = admin.get("/api/transactions/", params={"statement": stmt["id"]}).json()["results"]
    rent = next(t for t in txns if "RENT" in t["description"])
    # A different account than the engine picked = a manual choice; the same one = confirming the engine's pick.
    r = admin.patch(f"/api/transactions/{rent['id']}/", json={"sub_category": sub_id(admin, "Repairs & Maintenance")})
    assert r.json()["status"] == "MANUAL" and r.json()["confirmed"] is True
    r = admin.patch(f"/api/transactions/{rent['id']}/", json={"sub_category": sub_id(admin, "Rent")})
    assert r.json()["sub_category_name"] == "Rent" and r.json()["categorization_source"] == "MANUAL"

    elec = next(t for t in txns if "Electricity" in t["description"])
    income = next(t for t in txns if "client" in t["description"])
    admin.post("/api/transactions/bulk-update/", json={"ids": [elec["id"]], "sub_category": sub_id(admin, "Electricity")})
    admin.post("/api/transactions/bulk-update/", json={"ids": [income["id"]], "sub_category": sub_id(admin, "Service Revenue")})
    fin = admin.post("/api/transactions/finalize/", json={"statement": stmt["id"]}).json()
    assert fin["finalized"] == 3
    assert admin.delete(f"/api/transactions/{rent['id']}/").status_code == 400  # final

    summary = admin.get("/api/transactions/summary/").json()
    assert summary["total_transactions"] == 3 and summary["final_count"] == 3

    pnl = admin.get("/api/reports/profit-and-loss/", params={"period": "all_time"}).json()
    assert pnl["summary"]["total_income"] == 1000 and pnl["summary"]["total_expenses"] == 350
    tb = admin.get("/api/reports/trial-balance/", params={"period": "all_time"}).json()
    assert tb["total_debit"] == 350 and tb["total_credit"] == 1000
    assert admin.get("/api/reports/trial-balance/", params={"period": "all_time", "format": "csv"}).text.startswith("Account Type")
    cf = admin.get("/api/reports/cash-flow/", params={"period": "all_time"}).json()
    assert cf["opening_cash"] == 10000 and cf["closing_cash"] == 10650
    ledger = admin.get("/api/reports/account-ledger/", params={"sub_category": sub_id(admin, "Rent"), "period": "all_time"}).json()
    assert ledger["closing_balance"] == 250
    assert admin.get("/api/reports/balance-sheet/", params={"period": "all_time"}).status_code == 200
    assert admin.get("/api/reports/comparison/", params={"summary": 1, "a_period": "this_month"}).status_code == 200

    page = admin.get("/api/continuity/page/", params={"period": "all_time", "include_banks": 1}).json()
    assert page["summary"]["total_statements"] == 1 and "HDFC" in [b["bank_name"] for b in page["banks"]]


def test_journal_import_and_reconciliation(admin):
    bank = _bank(admin)
    stmt = _upload(admin, bank["id"]).json()
    entries = [
        {"entry_number": "JV-1", "date": d(0), "narration": "Client payment ACME",
         "lines": [{"sub_category_name": "Bank", "debit": "1000"}, {"sub_category_name": "Service Revenue", "credit": 1000}]},
        {"entry_number": "JV-2", "date": d(1), "narration": "Office rent",
         "lines": [{"sub_category_name": "Rent", "debit": 250}, {"sub_category_name": "Bank", "credit": 250}]},
        {"entry_number": "JV-3", "date": d(2), "narration": "Electricity",
         "lines": [{"sub_category_name": "Electricity", "debit": 100}, {"sub_category_name": "Bank", "credit": 100}]},
    ]
    dry = admin.post("/api/journal-entries/import/", json={"source": "JSON", "bank_account": bank["id"], "dry_run": True,
                                                            "entries": entries}).json()
    assert dry["summary"]["ready"] == 3
    bad = admin.post("/api/journal-entries/import/", json={"source": "JSON", "entries": [
        {"entry_number": "X", "date": d(0), "lines": [{"sub_category_name": "Rentt", "debit": 5},
                                                      {"sub_category_name": "Rent", "credit": 4}]}]})
    assert bad.status_code == 400 and 'did you mean "Rent"' in bad.json()["error"][0]
    r = admin.post("/api/journal-entries/import/", json={"source": "JSON", "bank_account": bank["id"], "entries": entries})
    assert r.status_code == 201 and r.json()["created"] == 3
    assert admin.get("/api/journal-entries/").json()["count"] == 3

    # Opening balance: the first statement opened at 10,000.
    owner_capital = sub_id(admin, "Owner Capital")
    r = admin.post("/api/reconciliation/opening-balance/", json={"account": bank["id"], "equity_account": owner_capital})
    assert r.status_code == 201, r.text

    matched = admin.post("/api/reconciliation/auto-match/", json={"account": bank["id"]}).json()
    assert matched["matched"] == 3
    summary = admin.get("/api/reconciliation/summary/", params={"account": bank["id"], "date_to": d(2)}).json()
    assert summary["difference"] == 0 and summary["is_reconciled"] is True

    lines = admin.get("/api/reconciliation/book-lines/", params={"account": bank["id"], "status": "matched"}).json()
    assert lines["count"] == 4  # three matched + the opening balance line
    entry = admin.get("/api/journal-entries/", params={"search": "JV-2"}).json()["results"][0]
    assert entry["reconcile_status"] == "RECONCILED"
    assert admin.delete(f"/api/journal-entries/{entry['id']}/").status_code == 409  # needs confirm_unmatch
    assert admin.delete(f"/api/journal-entries/{entry['id']}/?confirm_unmatch=true").status_code == 204

    month = D1.strftime("%Y-%m")
    overview = admin.get("/api/reconciliation/periods/", params={"account": bank["id"]}).json()
    assert overview["months"][0]["month"] == month
    # The rent row is outstanding again, so the month can't be signed off.
    assert admin.post("/api/reconciliation/periods/close/", json={"account": bank["id"], "month": month}).status_code == 400


def test_period_close(admin):
    state = admin.get("/api/period-close/").json()
    assert state["closed_through"] is None and state["fiscal_year_start_month"] == 4
    r = admin.post("/api/period-close/close/", json={"as_of": d(0)})
    assert r.status_code == 201 and r.json()["closed_through"] == d(0)
    # Nothing dated in the closed period can be imported now.
    r = admin.post("/api/journal-entries/import/", json={"source": "API", "entries": [
        {"entry_number": "LATE", "date": d(0), "lines": [{"sub_category_name": "Rent", "debit": 5},
                                                         {"sub_category_name": "Cash", "credit": 5}]}]})
    assert r.status_code == 400 and "closed" in r.json()["error"][0]
    assert admin.post("/api/period-close/reopen/").json()["closed_through"] is None


def test_dashboard_and_workflow(admin):
    bank = _bank(admin)
    _upload(admin, bank["id"])
    overview = admin.get("/api/dashboard/overview/", params={"period": "all_time"})
    assert overview.status_code == 200, overview.text
    data = overview.json()
    assert data["cash_position"]["total_cash_balance"] == 10650
    assert data["attention"]["not_auto_categorized"]["count"] == 1
    assert admin.get("/api/workflow/status/").json()["transactions"]["total"] == 3


# ---------------------------------------------------------------------------
# Clients, suppliers, invoices, bills, payments
# ---------------------------------------------------------------------------

def _gst18(admin):
    return next(t for t in admin.get("/api/tax-rates/").json()["results"] if t["name"] == "GST 18%")


def test_sales_invoice_payment_cycle(admin):
    bank = _bank(admin)
    client_ = admin.post("/api/clients/", json={"name": "Acme Ltd", "gstin": "29abcde1234f1z5",
                                                "payment_terms_days": 15}).json()
    assert client_["gstin"] == "29ABCDE1234F1Z5"
    product = admin.post("/api/products/", json={"name": "Consulting hour", "item_type": "SERVICE", "sale_price": "1000",
                                                 "tax_rate": _gst18(admin)["id"],
                                                 "income_account": sub_id(admin, "Consulting Revenue")}).json()
    r = admin.post("/api/sales-invoices/", json={"client_id": client_["id"], "invoice_date": d(0),
                                                 "items": [{"product_id": product["id"], "quantity": 2},
                                                           {"description": "Travel", "unit_price": "500",
                                                            "account_id": sub_id(admin, "Other Sales")}]})
    assert r.status_code == 201, r.text
    inv = r.json()
    assert inv["invoice_number"] == "INV-00001" and inv["status"] == "DRAFT"
    assert inv["subtotal"] == "2500.00" and inv["tax_amount"] == "360.00" and inv["total"] == "2860.00"
    assert inv["due_date"] == d(15)

    posted = admin.post(f"/api/sales-invoices/{inv['id']}/post/").json()
    assert posted["status"] == "POSTED" and posted["journal_entry_number"] == "SI-INV-00001"
    entry = admin.get(f"/api/journal-entries/{posted['journal_entry']}/").json()
    assert entry["total_debit"] == entry["total_credit"] == "2860.00" and entry["source"] == "SALES_INVOICE"
    assert admin.delete(f"/api/journal-entries/{posted['journal_entry']}/").status_code == 400  # cancel the invoice instead
    assert admin.patch(f"/api/sales-invoices/{inv['id']}/", json={"notes": "x"}).status_code == 400  # not a draft

    over = admin.post("/api/payments/", json={"direction": "RECEIPT", "client_id": client_["id"], "amount": "5000",
                                              "bank_account_id": bank["id"], "payment_date": d(5),
                                              "allocations": [{"sales_invoice_id": inv["id"], "amount": "3000"}]})
    assert over.status_code == 400  # more than is due on the invoice
    pay = admin.post("/api/payments/", json={"direction": "RECEIPT", "client_id": client_["id"], "amount": "2000",
                                             "bank_account_id": bank["id"], "payment_date": d(5),
                                             "allocations": [{"sales_invoice_id": inv["id"], "amount": "2000"}]}).json()
    assert pay["payment_number"] == "RCPT-00001" and pay["unallocated"] == "0.00"
    inv = admin.get(f"/api/sales-invoices/{inv['id']}/").json()
    assert inv["status"] == "PARTIALLY_PAID" and inv["balance_due"] == "860.00"

    statement = admin.get(f"/api/clients/{client_['id']}/statement/").json()
    assert statement["closing_balance"] == 860
    aging = admin.get("/api/reports/receivables-aging/", params={"as_of": d(5)}).json()
    assert aging["totals"]["current"] == 860
    assert admin.get("/api/clients/").json()["results"][0]["outstanding"] == "860.00"

    assert admin.post(f"/api/sales-invoices/{inv['id']}/cancel/").status_code == 400  # has a payment
    assert admin.delete(f"/api/payments/{pay['id']}/").status_code == 204
    inv = admin.get(f"/api/sales-invoices/{inv['id']}/").json()
    assert inv["status"] == "POSTED" and inv["amount_paid"] == "0.00"
    cancelled = admin.post(f"/api/sales-invoices/{inv['id']}/cancel/").json()
    assert cancelled["status"] == "CANCELLED" and cancelled["journal_entry"] is None
    assert admin.delete(f"/api/sales-invoices/{inv['id']}/").status_code == 204
    assert admin.get("/api/journal-entries/").json()["count"] == 0


def test_purchase_bill_and_supplier_payment(admin):
    bank = _bank(admin)
    supplier = admin.post("/api/suppliers/", json={"name": "Paper Co"}).json()
    bill = admin.post("/api/purchase-bills/", json={
        "supplier_id": supplier["id"], "bill_number": "PC-778", "bill_date": d(1), "post": True,
        "items": [{"description": "Printer paper", "quantity": 10, "unit_price": "50",
                   "tax_rate_id": _gst18(admin)["id"], "account_id": sub_id(admin, "Office Supplies")}]})
    assert bill.status_code == 201, bill.text
    bill = bill.json()
    assert bill["status"] == "POSTED" and bill["total"] == "590.00"
    entry = admin.get(f"/api/journal-entries/{bill['journal_entry']}/").json()
    names = {l["sub_category_name"]: (l["debit"], l["credit"]) for l in entry["lines"]}
    assert names["Office Supplies"] == ("500.00", "0.00") and names["GST Input Credit"] == ("90.00", "0.00")
    assert names["Accounts Payable"] == ("0.00", "590.00")
    dup = admin.post("/api/purchase-bills/", json={"supplier_id": supplier["id"], "bill_number": "PC-778",
                                                   "items": [{"description": "x", "unit_price": 1,
                                                              "account_id": sub_id(admin, "Office Supplies")}]})
    assert dup.status_code == 400

    pay = admin.post("/api/payments/", json={"direction": "PAYMENT", "supplier_id": supplier["id"], "amount": "590",
                                             "bank_account_id": bank["id"], "payment_date": d(3)}).json()
    assert pay["unallocated"] == "590.00"
    pay = admin.post(f"/api/payments/{pay['id']}/allocate/",
                     json={"allocations": [{"purchase_bill_id": bill["id"], "amount": "590"}]}).json()
    assert pay["unallocated"] == "0.00"
    assert admin.get(f"/api/purchase-bills/{bill['id']}/").json()["status"] == "PAID"
    summary = admin.get("/api/purchase-bills/summary/").json()
    assert summary["by_status"]["PAID"]["count"] == 1 and summary["outstanding"] == 0

    # A receipt naming a supplier is refused.
    r = admin.post("/api/payments/", json={"direction": "RECEIPT", "supplier_id": supplier["id"], "amount": 5,
                                           "method": "CASH"})
    assert r.status_code == 400
