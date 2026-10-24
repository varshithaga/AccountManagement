"""GSTR-1 and GSTR-3B JSON for a month."""
import json

from conftest import sub_id
from test_api import _gst18, d
from test_gst_audit import _invoice, _set_company

MONTH = d(0)[:7]


def _books(admin):
    """A local registered client (with an HSN-coded product), an inter-state unregistered one with a
    small and a B2CL-sized invoice and a credit note, and a local bill."""
    _set_company(admin)
    local = admin.post("/api/clients/", json={"name": "Local Co", "state": "Karnataka", "gstin": "29abcde1234f1z5"}).json()
    far = admin.post("/api/clients/", json={"name": "Far Co", "state": "Kerala"}).json()
    product = admin.post("/api/products/", json={"name": "Audit", "hsn_sac_code": "998222", "unit": "Hrs",
                                                 "sale_price": "1000", "tax_rate": _gst18(admin)["id"],
                                                 "income_account": sub_id(admin, "Consulting Revenue")}).json()
    admin.post("/api/sales-invoices/", json={"client_id": local["id"], "invoice_date": d(0), "post": True,
                                             "items": [{"product_id": product["id"], "quantity": 2}]})
    small = _invoice(admin, far["id"], price="500")
    _invoice(admin, far["id"], price="200000")      # 2,36,000 inter-state to unregistered -> B2CL
    _invoice(admin, far["id"], price="9999", post=False)  # a draft: left out, with a warning
    admin.post("/api/credit-notes/", json={"sales_invoice_id": small["id"], "note_date": d(1), "items": [
        {"description": "Discount", "unit_price": "100", "tax_rate_id": _gst18(admin)["id"],
         "account_id": sub_id(admin, "Consulting Revenue")}]})
    supplier = admin.post("/api/suppliers/", json={"name": "Paper Co", "state": "Karnataka"}).json()
    admin.post("/api/purchase-bills/", json={"supplier_id": supplier["id"], "bill_number": "P1", "bill_date": d(0),
                                             "post": True, "items": [
        {"description": "Paper", "unit_price": "1000", "tax_rate_id": _gst18(admin)["id"],
         "account_id": sub_id(admin, "Office Supplies")}]})


def test_gstr1(admin):
    _books(admin)
    r = admin.get("/api/reports/gst-returns/gstr1/", params={"month": MONTH})
    assert r.status_code == 200, r.text
    g, warnings = r.json()["return"], r.json()["warnings"]
    assert g["gstin"] == "29AAACA1234A1Z5" and g["fp"] == MONTH[5:] + MONTH[:4]

    [b2b] = g["b2b"]
    assert b2b["ctin"] == "29ABCDE1234F1Z5"
    [inv] = b2b["inv"]
    assert inv["pos"] == "29" and inv["val"] == 2360 and inv["rchrg"] == "N"
    assert inv["itms"] == [{"num": 1801, "itm_det": {"rt": 18.0, "txval": 2000.0, "camt": 180.0, "samt": 180.0,
                                                     "csamt": 0.0}}]

    [b2cl] = g["b2cl"]
    assert b2cl["pos"] == "32" and b2cl["inv"][0]["val"] == 236000
    assert b2cl["inv"][0]["itms"][0]["itm_det"]["iamt"] == 36000

    # The small inter-state sale, less its credit note, summed by place of supply and rate.
    assert g["b2cs"] == [{"sply_ty": "INTER", "pos": "32", "typ": "OE", "rt": 18.0, "txval": 400.0, "iamt": 72.0,
                          "csamt": 0.0}]
    assert "cdnr" not in g and "cdnur" not in g and "nil" not in g

    [service] = g["hsn"]["hsn_b2b"]
    assert service["hsn_sc"] == "998222" and service["uqc"] == "NA" and service["qty"] == 0 and service["txval"] == 2000
    assert {h["hsn_sc"] for h in g["hsn"]["hsn_b2c"]} == {""}  # lines typed in without a product
    assert any("no HSN / SAC code" in w for w in warnings)
    assert any("1 draft sales invoice" in w for w in warnings)

    download = admin.get("/api/reports/gst-returns/gstr1/", params={"month": MONTH, "format": "json"})
    assert download.status_code == 200 and "GSTR1_29AAACA1234A1Z5" in download.headers["content-disposition"]
    assert json.loads(download.text) == g


def test_gstr3b(admin):
    _books(admin)
    r = admin.get("/api/reports/gst-returns/gstr3b/", params={"month": MONTH})
    assert r.status_code == 200, r.text
    g = r.json()["return"]
    # 2000 local + 500 + 200000 inter-state - 100 credit note
    assert g["sup_details"]["osup_det"] == {"txval": 202400.0, "iamt": 36072.0, "camt": 180.0, "samt": 180.0,
                                            "csamt": 0.0}
    assert g["inter_sup"]["unreg_details"] == [{"pos": "32", "txval": 200400.0, "iamt": 36072.0}]
    assert g["itc_elg"]["itc_net"] == {"iamt": 0.0, "camt": 90.0, "samt": 90.0, "csamt": 0.0}
    assert g["itc_elg"]["itc_avl"][-1]["ty"] == "OTH"
    assert any("GSTR-2B" in w for w in r.json()["warnings"])


def test_gst_return_errors(admin):
    assert admin.get("/api/reports/gst-returns/gstr1/", params={"month": MONTH}).status_code == 400  # no GSTIN yet
    _set_company(admin)
    assert admin.get("/api/reports/gst-returns/gstr1/", params={"month": "Sept"}).status_code == 400
    assert admin.get("/api/reports/gst-returns/gstr9/", params={"month": MONTH}).status_code == 404


def test_gstr1_credit_note_to_registered_client(admin):
    _set_company(admin)
    local = admin.post("/api/clients/", json={"name": "Local Co", "state": "Karnataka", "gstin": "29abcde1234f1z5"}).json()
    inv = _invoice(admin, local["id"])
    admin.post("/api/credit-notes/", json={"sales_invoice_id": inv["id"], "note_date": d(1), "items": [
        {"description": "Discount", "unit_price": "100", "tax_rate_id": _gst18(admin)["id"],
         "account_id": sub_id(admin, "Consulting Revenue")}]})
    g = admin.get("/api/reports/gst-returns/gstr1/", params={"month": MONTH}).json()["return"]
    [cdnr] = g["cdnr"]
    [note] = cdnr["nt"]
    assert cdnr["ctin"] == "29ABCDE1234F1Z5" and note["ntty"] == "C" and note["val"] == 118 and note["pos"] == "29"
    assert note["itms"][0]["itm_det"] == {"rt": 18.0, "txval": 100.0, "camt": 9.0, "samt": 9.0, "csamt": 0.0}
    assert g["b2b"][0]["inv"][0]["val"] == 1180  # the invoice itself stays as issued
    assert g["hsn"]["hsn_b2b"][0]["txval"] == 900  # HSN summary is net of the note
