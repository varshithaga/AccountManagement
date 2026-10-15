"""GST split (CGST / SGST / IGST), the GST Summary report, company details and the audit log."""
from conftest import sub_id
from test_api import _gst18, d


def _set_company(admin, state="Karnataka"):
    r = admin.put("/api/period-close/", json={"company_name": "LedgerDesk Pvt Ltd", "company_gstin": "29aaaca1234a1z5",
                                              "company_state": state, "company_address": "1 MG Road\nBengaluru"})
    assert r.status_code == 200, r.text
    return r.json()["company"]


def _invoice(admin, client_id, price="1000", post=True):
    r = admin.post("/api/sales-invoices/", json={
        "client_id": client_id, "invoice_date": d(0), "post": post,
        "items": [{"description": "Consulting", "quantity": 1, "unit_price": price, "tax_rate_id": _gst18(admin)["id"],
                   "account_id": sub_id(admin, "Consulting Revenue")}]})
    assert r.status_code == 201, r.text
    return r.json()


def test_company_details(admin):
    company = _set_company(admin)
    assert company["gstin"] == "29AAACA1234A1Z5" and company["state"] == "Karnataka"
    assert admin.get("/api/period-close/company/").json()["name"] == "LedgerDesk Pvt Ltd"
    assert admin.put("/api/period-close/", json={"company_gstin": "123"}).status_code == 400


def test_gst_split_within_and_across_states(admin):
    _set_company(admin)
    local = admin.post("/api/clients/", json={"name": "Local Co", "state": "karnataka ", "gstin": "29abcde1234f1z5"}).json()
    other = admin.post("/api/clients/", json={"name": "Far Co", "state": "Maharashtra"}).json()

    same = _invoice(admin, local["id"])
    assert same["place_of_supply"] == "karnataka" and same["is_interstate"] is False
    assert (same["cgst_amount"], same["sgst_amount"], same["igst_amount"]) == ("90.00", "90.00", "0.00")
    assert same["party"]["gstin"] == "29ABCDE1234F1Z5"
    entry = admin.get(f"/api/journal-entries/{same['journal_entry']}/").json()
    tax_line = next(l for l in entry["lines"] if l["sub_category_name"] == "GST Payable")
    assert tax_line["credit"] == "180.00" and "CGST + SGST" in tax_line["description"]

    # With an "Output IGST" account in the Chart of Accounts, IGST goes there.
    gst_payable = admin.get(f"/api/subcategories/{sub_id(admin, 'GST Payable')}/").json()
    igst = admin.post("/api/subcategories/", json={"category": gst_payable["category"], "name": "Output IGST"}).json()
    across = _invoice(admin, other["id"], price="500")
    assert across["is_interstate"] is True and across["igst_amount"] == "90.00" and across["cgst_amount"] == "0.00"
    entry = admin.get(f"/api/journal-entries/{across['journal_entry']}/").json()
    lines = {l["sub_category"]: (l["debit"], l["credit"]) for l in entry["lines"]}
    assert lines[igst["id"]] == ("0.00", "90.00") and sub_id(admin, "GST Payable") not in lines

    # Credit notes follow their invoice's place of supply.
    note = admin.post("/api/credit-notes/", json={"sales_invoice_id": across["id"], "note_date": d(1), "items": [
        {"description": "Discount", "unit_price": "100", "tax_rate_id": _gst18(admin)["id"],
         "account_id": sub_id(admin, "Consulting Revenue")}]}).json()
    assert note["is_interstate"] is True and note["igst_amount"] == "18.00"

    # A draft is split again when posted - the company may have moved state meanwhile.
    draft = _invoice(admin, other["id"], post=False)
    assert draft["is_interstate"] is True
    _set_company(admin, state="Maharashtra")
    posted = admin.post(f"/api/sales-invoices/{draft['id']}/post/").json()
    assert posted["is_interstate"] is False and posted["cgst_amount"] == "90.00"


def test_gst_summary_report(admin):
    _set_company(admin)
    local = admin.post("/api/clients/", json={"name": "Local Co", "state": "Karnataka", "gstin": "29abcde1234f1z5"}).json()
    other = admin.post("/api/clients/", json={"name": "Far Co", "state": "Kerala"}).json()
    product = admin.post("/api/products/", json={"name": "Audit", "hsn_sac_code": "998222", "unit": "Hrs",
                                                 "sale_price": "1000", "tax_rate": _gst18(admin)["id"],
                                                 "income_account": sub_id(admin, "Consulting Revenue")}).json()
    admin.post("/api/sales-invoices/", json={"client_id": local["id"], "invoice_date": d(0), "post": True,
                                             "items": [{"product_id": product["id"], "quantity": 2}]})
    inv = _invoice(admin, other["id"], price="500")
    _invoice(admin, other["id"], price="9999", post=False)  # drafts don't count
    admin.post("/api/credit-notes/", json={"sales_invoice_id": inv["id"], "note_date": d(1), "items": [
        {"description": "Discount", "unit_price": "100", "tax_rate_id": _gst18(admin)["id"],
         "account_id": sub_id(admin, "Consulting Revenue")}]})
    supplier = admin.post("/api/suppliers/", json={"name": "Paper Co", "state": "Karnataka"}).json()
    admin.post("/api/purchase-bills/", json={"supplier_id": supplier["id"], "bill_number": "P1", "bill_date": d(0),
                                             "post": True, "items": [
        {"description": "Paper", "unit_price": "1000", "tax_rate_id": _gst18(admin)["id"],
         "account_id": sub_id(admin, "Office Supplies")}]})

    r = admin.get("/api/reports/gst-summary/", params={"period": "all_time"})
    assert r.status_code == 200, r.text
    g = r.json()
    out = g["outward"]
    # 2000 local (180 + 180) + 500 interstate (90 IGST) - 100 credit note (18 IGST)
    assert out["taxable"] == 2400 and out["cgst"] == 180 and out["sgst"] == 180 and out["igst"] == 72
    assert out["b2b"]["taxable"] == 2000 and out["b2c"]["taxable"] == 400
    assert out["inter_state"]["tax"] == 72
    assert [r["rate"] for r in out["by_rate"]] == [18]
    assert g["input_tax_credit"]["cgst"] == 90 and g["ineligible_input_tax"] == 0
    assert g["net_payable"] == {"cgst": 90, "sgst": 90, "igst": 72, "total": 252}
    hsn = {h["hsn_sac_code"]: h for h in g["hsn_summary"]}
    assert hsn["998222"]["quantity"] == 2 and hsn["998222"]["unit"] == "Hrs" and hsn["998222"]["tax"] == 360
    kinds = [doc["kind"] for doc in g["documents"]]
    assert kinds.count("INVOICE") == 2 and kinds.count("CREDIT_NOTE") == 1 and kinds.count("BILL") == 1

    csv = admin.get("/api/reports/gst-summary/", params={"period": "all_time", "format": "csv"})
    assert csv.status_code == 200 and "Net payable" in csv.text and "998222" in csv.text


def test_audit_log(admin, client):
    log = lambda **p: admin.get("/api/audit-log/", params=p).json()["results"]

    # Sign-ins, good and bad.
    assert client.post("/api/auth/token/", json={"username": "owner", "password": "wrong"}).status_code == 401
    assert client.post("/api/auth/token/", json={"username": "owner", "password": "Str0ng-pass!"}).status_code == 200
    assert {r["action"] for r in log(entity="User")} >= {"CREATE", "LOGIN", "LOGIN_FAILED"}

    # Created, changed, posted, cancelled - by the signed-in user, with what changed.
    c = admin.post("/api/clients/", json={"name": "Acme", "phone": "123"}).json()
    admin.patch(f"/api/clients/{c['id']}/", json={"phone": "999"})
    rows = log(entity="Client", entity_id=c["id"])
    assert [r["action"] for r in rows] == ["UPDATE", "CREATE"]
    assert rows[0]["username"] == "owner" and rows[0]["changes"]["phone"] == ["123", "999"]
    assert rows[1]["label"] == "Acme" and rows[1]["changes"]["name"] == "Acme"

    inv = _invoice(admin, c["id"], post=False)
    admin.post(f"/api/sales-invoices/{inv['id']}/post/")
    admin.post(f"/api/sales-invoices/{inv['id']}/cancel/")
    actions = [r["action"] for r in log(entity="SalesInvoice")]
    assert actions[:3] == ["CANCEL", "POST", "CREATE"]
    assert all(r["label"] == inv["invoice_number"] for r in log(entity="SalesInvoice"))
    # The invoice's own journal entry is not logged separately; a manual one is.
    assert not log(entity="JournalEntry")

    # A password change is logged without the password.
    admin.post("/api/auth/change-password/", json={"current_password": "Str0ng-pass!", "new_password": "An0ther-pass!"})
    pw = log(action="PASSWORD")[0]
    assert pw["changes"] == {"hashed_password": "changed"}

    filters = admin.get("/api/audit-log/filters/").json()
    assert "SalesInvoice" in filters["entities"] and filters["users"][0]["username"] == "owner"
    assert admin.get("/api/audit-log/", params={"search": "Acme"}).json()["count"] >= 2

    # Only roles given the Audit Log page can read it (the Accountant role isn't).
    accountant = next(r for r in admin.get("/api/roles/").json() if r["name"] == "Accountant")
    assert "audit_log" not in accountant["pages"] and "gst_summary" in accountant["pages"]


def test_bulk_imports_are_logged_as_one_row(admin):
    rows = [{"name": "Bulk", "account_type": "EXPENSE", "sub_categories": [{"name": f"Thing {i}"} for i in range(30)]}]
    admin.post("/api/categories/bulk-import/", json={"rows": rows})
    created = admin.get("/api/audit-log/", params={"entity": "SubCategory", "action": "CREATE"}).json()["results"]
    bulk = [r for r in created if r["changes"] and r["changes"].get("count") == 30]
    assert len(bulk) == 1 and bulk[0]["label"] == "30 records"
