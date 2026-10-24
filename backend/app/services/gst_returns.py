"""GSTR-1 and GSTR-3B for one month, as JSON in the layout of the GST portal's offline tool, plus the
warnings to fix before filing (missing HSN codes, bad GSTINs, ...).

Built from the same posted documents as the GST Summary (services/gst.py). What LedgerDesk does not
record is sent as zero: cess, exports / SEZ, reverse charge, advances, amendments, document series.
The 3B input tax credit is what the books claim - check it against GSTR-2B before filing.

GSTR-1 sections:
- b2b: invoices to a client with a GSTIN, per client, lines grouped by rate
- b2cl: inter-state invoices to an unregistered client above B2CL_LIMIT
- b2cs: every other sale to an unregistered client, summed by place of supply and rate
- cdnr / cdnur: credit notes to registered clients / against a B2CL invoice (others net into b2cs)
- nil: lines with no GST (0% or no tax rate)
- hsn: per HSN / SAC, unit and rate, split into B2B and B2C
"""
import re
from collections import OrderedDict
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import DocumentStatus, NoteKind, PurchaseBill, SalesInvoice
from ..utils import ZERO
from .gst import posted_documents
from .settings import accounting_settings

# An inter-state sale to an unregistered buyer above this invoice value is reported invoice by
# invoice (B2CL); below it, summed into B2CS. Rs 1 lakh from 1 Aug 2024 (was Rs 2.5 lakh).
B2CL_LIMIT = Decimal("100000")

# GST state codes - the first two digits of a GSTIN (same list as frontend/src/constants/indianStates.ts).
STATE_CODES = {
    "andaman and nicobar islands": "35", "andhra pradesh": "37", "arunachal pradesh": "12", "assam": "18",
    "bihar": "10", "chandigarh": "04", "chhattisgarh": "22", "dadra and nagar haveli and daman and diu": "26",
    "delhi": "07", "goa": "30", "gujarat": "24", "haryana": "06", "himachal pradesh": "02",
    "jammu and kashmir": "01", "jharkhand": "20", "karnataka": "29", "kerala": "32", "ladakh": "38",
    "lakshadweep": "31", "madhya pradesh": "23", "maharashtra": "27", "manipur": "14", "meghalaya": "17",
    "mizoram": "15", "nagaland": "13", "odisha": "21", "puducherry": "34", "punjab": "03", "rajasthan": "08",
    "sikkim": "11", "tamil nadu": "33", "telangana": "36", "tripura": "16", "uttar pradesh": "09",
    "uttarakhand": "05", "west bengal": "19", "other territory": "97",
}

# LedgerDesk units -> GST unit quantity codes (UQC). Anything else is reported as OTH.
UQC = {
    "nos": "NOS", "no": "NOS", "number": "NOS", "numbers": "NOS", "pcs": "PCS", "pc": "PCS", "piece": "PCS",
    "kg": "KGS", "kgs": "KGS", "g": "GMS", "gm": "GMS", "gms": "GMS", "gram": "GMS", "ton": "TON", "tonne": "TON",
    "l": "LTR", "ltr": "LTR", "litre": "LTR", "liter": "LTR", "ml": "MLT", "m": "MTR", "mtr": "MTR",
    "metre": "MTR", "meter": "MTR", "sqm": "SQM", "sqft": "SQF", "box": "BOX", "set": "SET", "pair": "PRS",
    "dozen": "DOZ", "doz": "DOZ", "bag": "BAG", "bottle": "BTL", "carton": "CTN", "roll": "ROL",
}

GSTIN_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$")


class GstReturnError(ValueError):
    """The return cannot be built (e.g. the company has no GSTIN)."""


def state_code(state: Optional[str]) -> str:
    return STATE_CODES.get((state or "").strip().lower(), "")


def month_range(month: str) -> tuple[date, date]:
    """"2026-09" -> (1 Sep 2026, 30 Sep 2026)."""
    try:
        year, mon = (int(x) for x in month.split("-"))
        start = date(year, mon, 1)
    except (ValueError, AttributeError):
        raise GstReturnError('Month must be YYYY-MM, e.g. "2026-09".')
    end = date(year + mon // 12, mon % 12 + 1, 1)
    return start, date.fromordinal(end.toordinal() - 1)


def _n(value) -> float:
    """Money as the portal wants it: a number with two decimals."""
    return float(Decimal(value or 0).quantize(Decimal("0.01")))


def _dt(day: date) -> str:
    return day.strftime("%d-%m-%Y")


def _rate(item) -> Decimal:
    return item.tax_rate.rate if item.tax_rate else ZERO


def _blank() -> dict:
    return {"txval": ZERO, "iamt": ZERO, "camt": ZERO, "samt": ZERO}


def _add(bucket: dict, item, sign: int = 1) -> None:
    bucket["txval"] += sign * item.amount
    bucket["iamt"] += sign * (item.igst_amount or ZERO)
    bucket["camt"] += sign * (item.cgst_amount or ZERO)
    bucket["samt"] += sign * (item.sgst_amount or ZERO)


def _tax_json(bucket: dict, interstate: Optional[bool] = None) -> dict:
    """{"txval", "iamt", "camt", "samt", "csamt"}; inter-state rows carry IGST only, intra-state CGST + SGST."""
    row = {"txval": _n(bucket["txval"])}
    if interstate is not False:
        row["iamt"] = _n(bucket["iamt"])
    if interstate is not True:
        row["camt"], row["samt"] = _n(bucket["camt"]), _n(bucket["samt"])
    row["csamt"] = 0.0
    return row


def _items_json(items, interstate: bool) -> list:
    """A document's taxed lines summed per rate, numbered the way the offline tool does (18% -> 1801)."""
    by_rate: dict = OrderedDict()
    for item in items:
        if _rate(item) > 0:
            _add(by_rate.setdefault(_rate(item), _blank()), item)
    return [{"num": int(rate * 100) + 1, "itm_det": {"rt": float(rate), **_tax_json(b, interstate)}}
            for rate, b in sorted(by_rate.items())]


def _doc_value(items) -> Decimal:
    return sum((i.amount + i.tax_amount for i in items), ZERO)


def _taxed(items) -> bool:
    return any(_rate(i) > 0 for i in items)


class _Context:
    def __init__(self, db: Session, month: str):
        settings = accounting_settings(db)
        gstin = (settings.company_gstin or "").strip().upper()
        if not gstin:
            raise GstReturnError("Set the company GSTIN first (Period Close -> Company details).")
        self.gstin = gstin
        self.home = gstin[:2]
        self.start, self.end = month_range(month)
        self.fp = self.start.strftime("%m%Y")
        self.invoices, self.bills, self.notes = posted_documents(db, self.start.isoformat(), self.end.isoformat())
        self.warnings: list[str] = []
        self._db = db

    def pos(self, doc, party) -> str:
        """The place-of-supply state code: the document's state, else the party's GSTIN, else the company's."""
        code = state_code(doc.place_of_supply)
        if not code and party.gstin:
            code = party.gstin[:2]
        if not code:
            code = self.home
            self.warn(f"{party.name}: no place of supply on {self._number(doc)} - reported as the company's state.")
        return code

    @staticmethod
    def _number(doc) -> str:
        return getattr(doc, "invoice_number", None) or getattr(doc, "note_number", None) or doc.bill_number

    def ctin(self, party) -> str:
        gstin = (party.gstin or "").strip().upper()
        if gstin and not GSTIN_RE.match(gstin):
            self.warn(f"{party.name}: GSTIN {gstin} does not look valid - the portal will reject it.")
        return gstin

    def warn(self, message: str) -> None:
        if message not in self.warnings:
            self.warnings.append(message)

    def drafts_left_out(self) -> None:
        """Drafts dated in the month are not in the return - say so, they may have been forgotten."""
        db, start, end = self._db, self.start, self.end
        draft = DocumentStatus.DRAFT
        count = db.scalar(select(func.count(SalesInvoice.id)).where(
            SalesInvoice.status == draft, SalesInvoice.invoice_date.between(start, end)))
        if count:
            self.warn(f"{count} draft sales invoice(s) dated in this month are not included - post them first.")
        count = db.scalar(select(func.count(PurchaseBill.id)).where(
            PurchaseBill.status == draft, PurchaseBill.bill_date.between(start, end)))
        if count:
            self.warn(f"{count} draft purchase bill(s) dated in this month are not included in the 3B credit.")


def gstr1(db: Session, month: str) -> dict:
    """{"return": <GSTR-1 JSON>, "warnings": [...]} for the month ("YYYY-MM")."""
    ctx = _Context(db, month)
    b2b: dict = OrderedDict()
    b2cl: dict = OrderedDict()
    b2cs: dict = OrderedDict()
    cdnr: dict = OrderedDict()
    cdnur: list = []
    nil = {k: ZERO for k in ("INTRB2B", "INTRAB2B", "INTRB2C", "INTRAB2C")}
    hsn = {"b2b": OrderedDict(), "b2c": OrderedDict()}

    def add_hsn(doc, items, registered: bool, sign: int):
        for item in items:
            product = item.product
            code = (product.hsn_sac_code or "").strip() if product else ""
            if not code:
                ctx.warn(f"{ctx._number(doc)}: line \"{item.description}\" has no HSN / SAC code "
                         "(set it on the product) - the portal needs one for every line.")
            service = code.startswith("99")
            uqc = "NA" if service else UQC.get((product.unit if product else "").strip().lower(), "OTH")
            key = (code, uqc, _rate(item))
            row = hsn["b2b" if registered else "b2c"].setdefault(
                key, {"desc": (product.name if product else item.description)[:30], "qty": ZERO, **_blank()})
            if not service:
                row["qty"] += sign * item.quantity
            _add(row, item, sign)

    def add_nil(items, registered: bool, interstate: bool, sign: int):
        for item in items:
            if _rate(item) <= 0:
                nil[("INTR" if interstate else "INTRA") + ("B2B" if registered else "B2C")] += sign * item.amount

    def add_b2cs(doc, items, pos: str, sign: int):
        for item in items:
            if _rate(item) > 0:
                key = ("INTER" if doc.is_interstate else "INTRA", pos, _rate(item))
                _add(b2cs.setdefault(key, _blank()), item, sign)

    def is_b2cl(doc, party) -> bool:
        return not party.gstin and doc.is_interstate and _doc_value(doc.items) > B2CL_LIMIT

    for inv in ctx.invoices:
        party = inv.client
        pos = ctx.pos(inv, party)
        registered = bool(party.gstin)
        if _taxed(inv.items):
            row = {"inum": inv.invoice_number, "idt": _dt(inv.invoice_date), "val": _n(inv.total), "pos": pos}
            if registered:
                b2b.setdefault(ctx.ctin(party), []).append(
                    {**row, "rchrg": "N", "inv_typ": "R", "itms": _items_json(inv.items, inv.is_interstate)})
            elif is_b2cl(inv, party):
                del row["pos"]
                b2cl.setdefault(pos, []).append({**row, "itms": _items_json(inv.items, True)})
            else:
                add_b2cs(inv, inv.items, pos, 1)
        add_nil(inv.items, registered, inv.is_interstate, 1)
        add_hsn(inv, inv.items, registered, 1)

    for note in ctx.notes:
        if note.kind != NoteKind.SALES:
            continue
        invoice, party = note.sales_invoice, note.sales_invoice.client
        pos = ctx.pos(note, party)
        registered = bool(party.gstin)
        if _taxed(note.items):
            row = {"ntty": "C", "nt_num": note.note_number, "nt_dt": _dt(note.note_date), "pos": pos,
                   "val": _n(note.total), "itms": _items_json(note.items, note.is_interstate)}
            if registered:
                cdnr.setdefault(ctx.ctin(party), []).append({**row, "rchrg": "N", "inv_typ": "R"})
            elif is_b2cl(invoice, party):
                cdnur.append({"typ": "B2CL", **row})
            else:
                add_b2cs(note, note.items, pos, -1)
        add_nil(note.items, registered, note.is_interstate, -1)
        add_hsn(note, note.items, registered, -1)

    def hsn_rows(rows: dict) -> list:
        return [{"num": i, "hsn_sc": code, "desc": r["desc"], "uqc": uqc, "qty": float(r["qty"]), "rt": float(rate),
                 **_tax_json(r)}
                for i, ((code, uqc, rate), r) in enumerate(sorted(rows.items(), key=lambda kv: kv[0]), start=1)]

    ctx.drafts_left_out()
    data = {
        "gstin": ctx.gstin,
        "fp": ctx.fp,
        "b2b": [{"ctin": ctin, "inv": invs} for ctin, invs in b2b.items()],
        "b2cl": [{"pos": pos, "inv": invs} for pos, invs in b2cl.items()],
        "b2cs": [{"sply_ty": sply, "pos": pos, "typ": "OE", "rt": float(rate),
                  **_tax_json(b, sply == "INTER")} for (sply, pos, rate), b in b2cs.items()],
        "cdnr": [{"ctin": ctin, "nt": nts} for ctin, nts in cdnr.items()],
        "cdnur": cdnur,
        "nil": {"inv": [{"sply_ty": k, "nil_amt": _n(v), "expt_amt": 0.0, "ngsup_amt": 0.0}
                        for k, v in nil.items() if v]},
        "hsn": {"hsn_b2b": hsn_rows(hsn["b2b"]), "hsn_b2c": hsn_rows(hsn["b2c"])},
    }
    return {"return": {k: v for k, v in data.items() if v not in ([], {"inv": []})}, "warnings": ctx.warnings}


def gstr3b(db: Session, month: str) -> dict:
    """{"return": <GSTR-3B JSON>, "warnings": [...]} for the month ("YYYY-MM")."""
    ctx = _Context(db, month)
    outward, nil_out = _blank(), ZERO
    unreg: dict = OrderedDict()   # 3.2: inter-state supplies to unregistered persons, by place of supply
    itc, ineligible = _blank(), _blank()
    exempt_in = {"inter": ZERO, "intra": ZERO}

    def out(doc, party, sign):
        nonlocal nil_out
        pos = ctx.pos(doc, party)
        for item in doc.items:
            if _rate(item) <= 0:
                nil_out += sign * item.amount
                continue
            _add(outward, item, sign)
            if doc.is_interstate and not party.gstin:
                _add(unreg.setdefault(pos, _blank()), item, sign)

    def inward(doc, sign):
        for item in doc.items:
            if _rate(item) <= 0:
                exempt_in["inter" if doc.is_interstate else "intra"] += sign * item.amount
            elif item.tax_rate.input_tax_account_id:
                _add(itc, item, sign)
            else:
                _add(ineligible, item, sign)

    for inv in ctx.invoices:
        out(inv, inv.client, 1)
    for bill in ctx.bills:
        inward(bill, 1)
    for note in ctx.notes:
        if note.kind == NoteKind.SALES:
            out(note, note.sales_invoice.client, -1)
        else:
            inward(note, -1)

    zero = {"txval": 0.0, "iamt": 0.0, "camt": 0.0, "samt": 0.0, "csamt": 0.0}
    tax_only = lambda b: {k: v for k, v in _tax_json(b).items() if k != "txval"}
    no_tax = {"iamt": 0.0, "camt": 0.0, "samt": 0.0, "csamt": 0.0}
    ctx.drafts_left_out()
    ctx.warn("Input tax credit is what the books claim - check it against GSTR-2B on the portal before filing.")
    data = {
        "gstin": ctx.gstin,
        "ret_period": ctx.fp,
        "sup_details": {
            "osup_det": _tax_json(outward),
            "osup_zero": {k: zero[k] for k in ("txval", "iamt", "csamt")},
            "osup_nil_exmp": {"txval": _n(nil_out)},
            "isup_rev": zero,
            "osup_nongst": {"txval": 0.0},
        },
        "inter_sup": {
            "unreg_details": [{"pos": pos, "txval": _n(b["txval"]), "iamt": _n(b["iamt"])} for pos, b in unreg.items()],
            "comp_details": [],
            "uin_details": [],
        },
        "itc_elg": {
            "itc_avl": [{"ty": ty, **no_tax} for ty in ("IMPG", "IMPS", "ISRC", "ISD")] +
                       [{"ty": "OTH", **tax_only(itc)}],
            "itc_rev": [{"ty": "RUL", **no_tax}, {"ty": "OTH", **no_tax}],
            "itc_net": tax_only(itc),
            "itc_inelg": [{"ty": "RUL", **no_tax}, {"ty": "OTH", **tax_only(ineligible)}],
        },
        "inward_sup": {
            "isup_details": [{"ty": "GST", "inter": _n(exempt_in["inter"]), "intra": _n(exempt_in["intra"])},
                             {"ty": "NONGST", "inter": 0.0, "intra": 0.0}],
        },
    }
    return {"return": data, "warnings": ctx.warnings}
