"""GST Summary: the output GST on sales, the input tax credit on purchases and what is payable,
split CGST / SGST / IGST - the figures behind GSTR-1 and GSTR-3B.

Only posted documents count (drafts and cancelled ones don't). Credit notes lower the output
tax and debit notes the input credit, in the period of the note's own date. Tax on a bill line
whose tax rate has no input-tax account was added to the expense when posted (no credit taken),
so it is shown as ineligible and kept out of the credit.
"""
from collections import OrderedDict
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import (
    CreditNote, CreditNoteItem, DocumentStatus, NoteKind, PurchaseBill, PurchaseBillItem, SalesInvoice, SalesInvoiceItem,
)
from ..utils import ZERO
from .settings import accounting_settings

POSTED = (DocumentStatus.POSTED, DocumentStatus.PARTIALLY_PAID, DocumentStatus.PAID)
COMPONENTS = ('cgst', 'sgst', 'igst')


def _blank() -> dict:
    return {'taxable': ZERO, 'cgst': ZERO, 'sgst': ZERO, 'igst': ZERO, 'tax': ZERO}


def _add(bucket: dict, item, sign: int) -> None:
    bucket['taxable'] += sign * item.amount
    for c in COMPONENTS:
        bucket[c] += sign * (getattr(item, f'{c}_amount') or ZERO)
    bucket['tax'] += sign * item.tax_amount


def _in_range(column, date_from: Optional[str], date_to: Optional[str]) -> list:
    where = []
    if date_from:
        where.append(column >= date_from)
    if date_to:
        where.append(column <= date_to)
    return where


def _with_items(relationship, item_model) -> list:
    return [selectinload(relationship).selectinload(item_model.tax_rate),
            selectinload(relationship).selectinload(item_model.product)]


def _rate_key(item) -> tuple:
    rate = item.tax_rate
    return (rate.rate if rate else ZERO, rate.name if rate else 'No GST')


def posted_documents(db: Session, date_from: Optional[str] = None, date_to: Optional[str] = None) -> tuple:
    """(invoices, bills, notes) posted in the period, with their lines, tax rates, products and parties."""
    invoices = db.scalars(select(SalesInvoice).where(SalesInvoice.status.in_(POSTED),
                                                     *_in_range(SalesInvoice.invoice_date, date_from, date_to))
                          .options(*_with_items(SalesInvoice.items, SalesInvoiceItem), selectinload(SalesInvoice.client))
                          .order_by(SalesInvoice.invoice_date, SalesInvoice.id)).all()
    bills = db.scalars(select(PurchaseBill).where(PurchaseBill.status.in_(POSTED),
                                                  *_in_range(PurchaseBill.bill_date, date_from, date_to))
                       .options(*_with_items(PurchaseBill.items, PurchaseBillItem), selectinload(PurchaseBill.supplier))
                       .order_by(PurchaseBill.bill_date, PurchaseBill.id)).all()
    notes = db.scalars(select(CreditNote).where(CreditNote.status == DocumentStatus.POSTED,
                                                *_in_range(CreditNote.note_date, date_from, date_to))
                       .options(*_with_items(CreditNote.items, CreditNoteItem),
                                selectinload(CreditNote.sales_invoice).selectinload(SalesInvoice.client),
                                selectinload(CreditNote.purchase_bill).selectinload(PurchaseBill.supplier))
                       .order_by(CreditNote.note_date, CreditNote.id)).all()
    return invoices, bills, notes


def gst_summary(db: Session, date_from: Optional[str] = None, date_to: Optional[str] = None) -> dict:
    settings = accounting_settings(db)
    invoices, bills, notes = posted_documents(db, date_from, date_to)

    outward, inward, itc = _blank(), _blank(), _blank()
    out_rates: dict = OrderedDict()
    in_rates: dict = OrderedDict()
    supply = {'b2b': _blank(), 'b2c': _blank(), 'intra_state': _blank(), 'inter_state': _blank()}
    hsn: dict = OrderedDict()
    ineligible = ZERO
    documents = []

    def document(kind, doc, number, day, party, sign):
        row = {'kind': kind, 'id': doc.id, 'number': number, 'date': day.isoformat(), 'party': party.name,
               'gstin': party.gstin or '', 'place_of_supply': doc.place_of_supply, 'is_interstate': doc.is_interstate,
               **{k: sign * v for k, v in _sum_items(doc.items).items()}}
        row['total'] = row['taxable'] + row['tax']
        documents.append(row)

    def outward_doc(doc, party, sign):
        for item in doc.items:
            _add(outward, item, sign)
            _add(out_rates.setdefault(_rate_key(item), _blank()), item, sign)
            _add(supply['b2b' if party.gstin else 'b2c'], item, sign)
            _add(supply['inter_state' if doc.is_interstate else 'intra_state'], item, sign)
            code = item.product.hsn_sac_code if item.product and item.product.hsn_sac_code else ''
            unit = item.product.unit if item.product else ''
            row = hsn.setdefault((code, unit), {'hsn_sac_code': code, 'unit': unit, 'quantity': ZERO, **_blank()})
            row['quantity'] += sign * item.quantity
            _add(row, item, sign)

    def inward_doc(doc, sign):
        nonlocal ineligible
        for item in doc.items:
            _add(inward, item, sign)
            _add(in_rates.setdefault(_rate_key(item), _blank()), item, sign)
            if item.tax_rate and item.tax_rate.input_tax_account_id:
                _add(itc, item, sign)
            else:
                ineligible += sign * item.tax_amount

    for inv in invoices:
        outward_doc(inv, inv.client, 1)
        document('INVOICE', inv, inv.invoice_number, inv.invoice_date, inv.client, 1)
    for bill in bills:
        inward_doc(bill, 1)
        document('BILL', bill, bill.bill_number, bill.bill_date, bill.supplier, 1)
    for note in notes:
        if note.kind == NoteKind.SALES:
            outward_doc(note, note.sales_invoice.client, -1)
            document('CREDIT_NOTE', note, note.note_number, note.note_date, note.sales_invoice.client, -1)
        else:
            inward_doc(note, -1)
            document('DEBIT_NOTE', note, note.note_number, note.note_date, note.purchase_bill.supplier, -1)

    net = {c: outward[c] - itc[c] for c in COMPONENTS}
    net['total'] = sum(net.values(), ZERO)
    rates = lambda d: [{'rate': rate, 'name': name, **v} for (rate, name), v in sorted(d.items(), key=lambda kv: kv[0][0])]
    return {
        'date_from': date_from, 'date_to': date_to,
        'company': {'state': settings.company_state, 'gstin': settings.company_gstin},
        'outward': {**outward, 'by_rate': rates(out_rates), **supply},
        'inward': {**inward, 'by_rate': rates(in_rates)},
        'input_tax_credit': itc,
        'ineligible_input_tax': ineligible,
        # positive = to pay; negative = credit carried forward
        'net_payable': net,
        'hsn_summary': sorted(hsn.values(), key=lambda r: (r['hsn_sac_code'] == '', r['hsn_sac_code'])),
        'documents': documents,
    }


def _sum_items(items) -> dict:
    total = _blank()
    for item in items:
        _add(total, item, 1)
    return total
