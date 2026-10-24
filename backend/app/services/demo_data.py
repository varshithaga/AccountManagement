"""Sample books for trying the app out: clients, suppliers, products, invoices, bills, payments, a
credit note, a journal entry and two bank statements - including deliberate duplicates (a repeated
bank row, an overlapping second statement, a near-duplicate client) so the duplicate checks have
something to flag.

Everything goes through the API itself (in-process), as the first administrator, so it is checked
and posted exactly as if typed in. Run it only on a company you are trying out - never on live books.
"""
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select

from ..access import is_admin
from ..database import COMPANY_HEADER, company_session
from ..models import Client, User
from ..security import create_token_pair

MARKER = "DEMO-C01"  # the first sample client's code - its presence means the data is already in


class DemoDataError(Exception):
    pass


def _day(months_back: int, day: int) -> date:
    """`day` of the month `months_back` months before this one (clamped to today)."""
    today = date.today()
    y, m = today.year, today.month - months_back
    while m < 1:
        y, m = y - 1, m + 12
    return min(date(y, m, min(day, 28)), today)


def _csv(opening: Decimal, rows: list[tuple[date, str, str, str]]) -> str:
    """A bank CSV with a running balance; rows are (date, description, debit, credit)."""
    balance, lines = opening, ["Date,Description,Debit,Credit,Balance"]
    for when, text, debit, credit in rows:
        balance += Decimal(credit or 0) - Decimal(debit or 0)
        lines.append(f"{when.isoformat()},{text},{debit},{credit},{balance:.2f}")
    return "\n".join(lines) + "\n"


class _Api:
    def __init__(self, company: str):
        from fastapi.testclient import TestClient
        from ..main import app

        with company_session(company) as db:
            if db.scalar(select(Client.id).where(Client.code == MARKER)):
                raise DemoDataError(f'The sample data is already in company "{company}".')
            user = next((u for u in db.scalars(select(User).where(User.is_active.is_(True)).order_by(User.id))
                         if is_admin(u)), None)
            if user is None:
                raise DemoDataError("No administrator yet - run create-admin (or register in the app) first.")
            token = create_token_pair(user, company)["access"]
        # No `with`: the app's startup (the recurring-invoice scheduler) is not needed here.
        self.http = TestClient(app, headers={"Authorization": f"Bearer {token}", COMPANY_HEADER: company})
        self.counts: dict[str, int] = {}

    def call(self, method: str, url: str, what: str | None = None, **kwargs) -> dict:
        r = self.http.request(method, url, **kwargs)
        if r.status_code >= 400:
            raise DemoDataError(f"{method} {url} failed ({r.status_code}): {r.text[:500]}")
        if what:
            self.counts[what] = self.counts.get(what, 0) + 1
        return r.json() if r.content else {}

    def post(self, url: str, what: str | None = None, **kwargs) -> dict:
        return self.call("POST", url, what, **kwargs)

    def get(self, url: str, **params) -> dict:
        return self.call("GET", url, params=params)

    def account(self, name: str) -> int:
        rows = self.get("/api/lookups/subcategories/", search=name, limit=50)["results"]
        match = next((s["id"] for s in rows if s["name"] == name), None)
        if match is None:
            raise DemoDataError(f'Account "{name}" is missing - run: python cli.py seed')
        return match


def load_demo_data(company: str) -> dict:
    """Adds the sample books to `company`. Returns what was added and the duplicates it planted."""
    api = _Api(company)
    rates = {t["name"]: t["id"] for t in api.get("/api/tax-rates/", limit=100)["results"]}
    if "GST 18%" not in rates:
        raise DemoDataError("GST rates are missing - run: python cli.py seed")
    gst18, gst5, gst12 = rates["GST 18%"], rates.get("GST 5%"), rates.get("GST 12%")
    acc = {n: api.account(n) for n in ("Consulting Revenue", "Product Sales", "Service Revenue", "Office Supplies",
                                       "Purchases", "Internet", "Rent", "Cash", "Bank Accounts")}

    # Company details (only when none are set - real details are never overwritten).
    company_info = api.get("/api/period-close/company/")
    if not company_info.get("gstin"):
        api.call("PUT", "/api/period-close/", json={"company_name": company_info.get("name") or "Demo Traders Pvt Ltd",
                                                   "company_gstin": "29AAACD1234A1Z5", "company_state": "Karnataka",
                                                   "company_address": "12 Residency Road\nBengaluru 560025"})

    # A bank account tied to the "Bank Accounts" ledger (payments and statements need one).
    banks = api.get("/api/bank-accounts/", limit=100)["results"]
    bank = next((b for b in banks if b.get("gl_account") == acc["Bank Accounts"]), None) or api.post(
        "/api/bank-accounts/", "bank accounts", json={"name": "Demo Current Account", "bank_name": "HDFC Bank",
                                                     "account_number": "XXXXXXXX4321",
                                                     "gl_account": acc["Bank Accounts"]})

    clients = [
        api.post("/api/clients/", "clients", json=c) for c in [
            {"code": MARKER, "name": "Sharma Traders", "state": "Karnataka", "gstin": "29ABCDE1234F1Z5",
             "email": "accounts@sharmatraders.example", "phone": "9845000001", "payment_terms_days": 30},
            {"code": "DEMO-C02", "name": "Kerala Spices Co", "state": "Kerala", "gstin": "32ABCDE5678G1Z2",
             "payment_terms_days": 15},
            {"code": "DEMO-C03", "name": "Ravi Kumar", "state": "Tamil Nadu", "payment_terms_days": 7},
            {"code": "DEMO-C04", "name": "Bright Schools Trust", "state": "Karnataka", "payment_terms_days": 45,
             "opening_balance": "25000", "opening_balance_date": _day(3, 1).isoformat()},
            # A near-duplicate of Sharma Traders - the same business entered twice under another name.
            {"code": "DEMO-C05", "name": "Sharma Traders Pvt Ltd", "state": "Karnataka",
             "email": "accounts@sharmatraders.example", "phone": "9845000001"},
        ]]
    suppliers = [
        api.post("/api/suppliers/", "suppliers", json=s) for s in [
            {"code": "DEMO-S01", "name": "Paper World", "state": "Karnataka", "gstin": "29PQRST1234K1Z9"},
            {"code": "DEMO-S02", "name": "Mumbai Electronics", "state": "Maharashtra", "gstin": "27LMNOP4321Q1Z3"},
            {"code": "DEMO-S03", "name": "City Broadband", "state": "Karnataka"},
        ]]
    products = {p["name"]: p for p in (api.post("/api/products/", "products", json=body) for body in [
        {"code": "DEMO-P01", "name": "Bookkeeping (monthly)", "item_type": "SERVICE", "hsn_sac_code": "998222",
         "unit": "Month", "sale_price": "15000", "tax_rate": gst18, "income_account": acc["Consulting Revenue"]},
        {"code": "DEMO-P02", "name": "GST filing", "item_type": "SERVICE", "hsn_sac_code": "998231",
         "unit": "Nos", "sale_price": "3500", "tax_rate": gst18, "income_account": acc["Service Revenue"]},
        {"code": "DEMO-P03", "name": "Laptop stand", "item_type": "PRODUCT", "hsn_sac_code": "8473",
         "unit": "Nos", "sale_price": "1800", "purchase_price": "1100", "tax_rate": gst18,
         "income_account": acc["Product Sales"], "expense_account": acc["Purchases"],
         "track_inventory": True, "reorder_level": "5"},
        {"code": "DEMO-P04", "name": "Printer paper (ream)", "item_type": "PRODUCT", "hsn_sac_code": "4802",
         "unit": "Nos", "sale_price": "320", "purchase_price": "240", "tax_rate": gst12 or gst18,
         "income_account": acc["Product Sales"], "expense_account": acc["Purchases"],
         "track_inventory": True, "reorder_level": "20"},
    ])}

    def bill(supplier, number, when, items, post=True):
        return api.post("/api/purchase-bills/", "purchase bills", json={
            "supplier_id": supplier["id"], "bill_number": number, "bill_date": when.isoformat(), "post": post,
            "items": items})

    def invoice(client, when, items, post=True):
        return api.post("/api/sales-invoices/", "sales invoices", json={
            "client_id": client["id"], "invoice_date": when.isoformat(), "post": post, "items": items})

    stand, paper = products["Laptop stand"], products["Printer paper (ream)"]
    books, filing = products["Bookkeeping (monthly)"], products["GST filing"]

    # Stock comes in before it goes out.
    b1 = bill(suppliers[1], "ME-1041", _day(2, 3), [{"product_id": stand["id"], "quantity": 20, "unit_price": "1100"}])
    b2 = bill(suppliers[0], "PW-552", _day(2, 5), [{"product_id": paper["id"], "quantity": 100, "unit_price": "240"}])
    bill(suppliers[2], "CB-OCT", _day(1, 2), [{"description": "Broadband - monthly", "unit_price": "1500",
                                              "tax_rate_id": gst18, "account_id": acc["Internet"]}])
    bill(suppliers[0], "PW-561", _day(0, 4), [{"description": "Stationery", "quantity": 4, "unit_price": "450",
                                              "tax_rate_id": gst5 or gst18, "account_id": acc["Office Supplies"]}],
         post=False)  # a draft bill

    invoices = []
    for months_back in (2, 1, 0):
        invoices.append(invoice(clients[0], _day(months_back, 1), [{"product_id": books["id"], "quantity": 1}]))
    invoices.append(invoice(clients[1], _day(2, 10), [{"product_id": stand["id"], "quantity": 8},
                                                      {"product_id": paper["id"], "quantity": 30}]))
    invoices.append(invoice(clients[1], _day(1, 12), [{"product_id": filing["id"], "quantity": 2}]))
    invoices.append(invoice(clients[2], _day(1, 18), [{"product_id": stand["id"], "quantity": 2}]))
    invoices.append(invoice(clients[3], _day(1, 20), [{"product_id": paper["id"], "quantity": 60,
                                                       "discount_percent": "5"}]))
    # A large inter-state sale to an unregistered buyer (B2CL in GSTR-1).
    invoices.append(invoice(clients[2], _day(0, 6), [{"description": "Annual accounts and audit support",
                                                      "unit_price": "120000", "tax_rate_id": gst18,
                                                      "account_id": acc["Consulting Revenue"]}]))
    invoice(clients[4], _day(0, 8), [{"product_id": filing["id"], "quantity": 1}], post=False)  # a draft

    # Receipts: two paid in full, one part-paid; the rest stay outstanding (and some overdue).
    def receipt(client, inv, amount, when, ref):
        return api.post("/api/payments/", "payments", json={
            "direction": "RECEIPT", "client_id": client["id"], "amount": str(amount), "bank_account_id": bank["id"],
            "payment_date": when.isoformat(), "reference_number": ref,
            "allocations": [{"sales_invoice_id": inv["id"], "amount": str(amount)}]})

    receipt(clients[0], invoices[0], invoices[0]["total"], _day(2, 20), "NEFT-SHARMA-01")
    receipt(clients[1], invoices[3], invoices[3]["total"], _day(1, 2), "NEFT-KSC-77")
    receipt(clients[0], invoices[1], "10000", _day(1, 25), "UPI-SHARMA-02")
    # Paying suppliers.
    for supplier, b, when, ref in ((suppliers[1], b1, _day(2, 15), "NEFT-ME-1041"),
                                   (suppliers[0], b2, _day(1, 5), "NEFT-PW-552")):
        api.post("/api/payments/", "payments", json={
            "direction": "PAYMENT", "supplier_id": supplier["id"],
            "amount": b["total"], "bank_account_id": bank["id"], "payment_date": when.isoformat(),
            "reference_number": ref, "allocations": [{"purchase_bill_id": b["id"], "amount": b["total"]}]})

    # A credit note: one of Ravi Kumar's two laptop stands came back damaged.
    api.post("/api/credit-notes/", "credit notes", json={
        "sales_invoice_id": invoices[5]["id"], "note_date": _day(1, 22).isoformat(), "reason": "1 stand returned damaged",
        "items": [{"product_id": stand["id"], "quantity": 1}]})

    # Office rent paid in cash.
    for months_back in (2, 1):
        api.post("/api/journal-entries/manual/", "journal entries", json={
            "date": _day(months_back, 5).isoformat(), "narration": "Office rent paid in cash", "lines": [
                {"sub_category_id": acc["Rent"], "debit": "12000", "description": "Office rent"},
                {"sub_category_id": acc["Cash"], "credit": "12000"}]})

    # Bank statements, with planted duplicates:
    #   - statement 1 repeats one row (an export that printed a line twice);
    #   - statement 2 starts three days before statement 1 ends (overlapping exports), so those rows repeat.
    s1_rows = [
        (_day(2, 2), "NEFT CR SHARMA TRADERS", "", "50000.00"),
        (_day(2, 5), "ATM CASH WITHDRAWAL", "12000.00", ""),
        (_day(2, 9), "POS AMAZON OFFICE SUPPLIES", "2350.00", ""),
        (_day(2, 9), "POS AMAZON OFFICE SUPPLIES", "2350.00", ""),  # repeated row
        (_day(2, 15), "NEFT DR MUMBAI ELECTRONICS", "25960.00", ""),
        (_day(2, 20), "NEFT CR SHARMA TRADERS", "", "17700.00"),
        (_day(2, 24), "BANK CHARGES", "236.00", ""),
        (_day(2, 26), "UPI ZOMATO TEAM LUNCH", "1840.00", ""),
        (_day(2, 27), "ELECTRICITY BILL BESCOM", "3200.00", ""),
    ]
    s2_rows = s1_rows[-3:] + [  # the overlap
        (_day(1, 2), "NEFT CR KERALA SPICES CO", "", "16050.00"),
        (_day(1, 5), "NEFT DR PAPER WORLD", "26880.00", ""),
        (_day(1, 10), "INTERNET BILL CITY BROADBAND", "1770.00", ""),
        (_day(1, 25), "UPI CR SHARMA TRADERS", "", "10000.00"),
        (_day(1, 27), "INTEREST CREDIT", "", "412.00"),
    ]
    opening = Decimal("100000.00")
    s1 = _csv(opening, s1_rows)
    s1_close = Decimal(s1.strip().rsplit(",", 1)[-1])
    s2_open = s1_close + sum(Decimal(dr or 0) - Decimal(cr or 0) for _, _, dr, cr in s1_rows[-3:])
    statements = []
    for name, content in ((f"demo-statement-{_day(2, 1):%Y-%m}.csv", s1),
                          (f"demo-statement-{_day(1, 1):%Y-%m}.csv", _csv(s2_open, s2_rows))):
        statements.append(api.post("/api/bank-statements/", "bank statements", data={
            "account": bank["id"], "source_type": "CSV", "confirm_continuity": "true"}, files={"file": (name, content.encode(), "text/csv")}))
    for st in statements:
        api.post(f"/api/bank-statements/{st['id']}/categorize/")
    flagged = api.get("/api/transactions/", is_potential_duplicate="true", limit=100)["count"]

    # The exact duplicates the app refuses outright.
    refused = []
    for url, body, label in (
        ("/api/clients/", {"name": "Sharma Traders"}, "a second client named Sharma Traders"),
        ("/api/purchase-bills/", {"supplier_id": suppliers[1]["id"], "bill_number": "ME-1041", "items": [
            {"description": "x", "unit_price": "1", "account_id": acc["Office Supplies"]}]},
         "bill ME-1041 from Mumbai Electronics entered twice"),
    ):
        r = api.http.post(url, json=body)
        refused.append(f"{label}: {'refused' if r.status_code >= 400 else 'ACCEPTED (unexpected)'}")
    r = api.http.post("/api/bank-statements/", data={"account": bank["id"], "source_type": "CSV"},
                      files={"file": ("same-file-again.csv", s1.encode(), "text/csv")})
    refused.append(f"the first statement file uploaded again: {'refused' if r.status_code >= 400 else 'ACCEPTED'}")

    return {"added": api.counts, "duplicate_bank_rows_flagged": flagged, "refused": refused,
            "near_duplicate_client": "Sharma Traders / Sharma Traders Pvt Ltd (same email and phone)"}
