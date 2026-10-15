"""TDS Summary: tax deducted at source on supplier bills, by section and by supplier, and how much of
it has been paid to the government (debits to the TDS accounts in the journal)."""
from collections import OrderedDict
from typing import Optional

from sqlalchemy import false, func, select
from sqlalchemy.orm import Session, joinedload

from ..models import DocumentStatus, JournalEntry, JournalEntryLine, PurchaseBill, SubCategory, TdsSection
from ..utils import ZERO

POSTED = (DocumentStatus.POSTED, DocumentStatus.PARTIALLY_PAID, DocumentStatus.PAID)


def tds_summary(db: Session, date_from: Optional[str] = None, date_to: Optional[str] = None) -> dict:
    where = [PurchaseBill.status.in_(POSTED), PurchaseBill.tds_amount > 0]
    if date_from:
        where.append(PurchaseBill.bill_date >= date_from)
    if date_to:
        where.append(PurchaseBill.bill_date <= date_to)
    bills = db.scalars(select(PurchaseBill).where(*where)
                       .options(joinedload(PurchaseBill.supplier), joinedload(PurchaseBill.tds_section))
                       .order_by(PurchaseBill.bill_date, PurchaseBill.id)).all()

    sections: dict = OrderedDict()
    suppliers: dict = OrderedDict()
    for b in bills:
        sec = sections.setdefault(b.tds_section_id, {
            'section': b.tds_section_id, 'code': b.tds_section.code, 'name': b.tds_section.name,
            'rate': b.tds_rate, 'bills': 0, 'taxable': ZERO, 'tds': ZERO})
        sec['bills'] += 1
        sec['taxable'] += b.subtotal
        sec['tds'] += b.tds_amount
        sup = suppliers.setdefault((b.supplier_id, b.tds_section_id), {
            'supplier': b.supplier_id, 'supplier_name': b.supplier.name, 'pan': b.supplier.pan,
            'section_code': b.tds_section.code, 'bills': 0, 'taxable': ZERO, 'tds': ZERO})
        sup['bills'] += 1
        sup['taxable'] += b.subtotal
        sup['tds'] += b.tds_amount

    # Paid to the government = debits to the TDS accounts (a payment entry: Dr TDS Payable / Cr Bank).
    account_ids = {sid for sid in db.scalars(select(TdsSection.account_id).where(TdsSection.account_id.is_not(None)))}
    named = db.scalar(select(SubCategory.id).where(func.lower(SubCategory.name) == 'tds payable'))
    if named:
        account_ids.add(named)
    line_where = [JournalEntryLine.sub_category_id.in_(account_ids)] if account_ids else [false()]
    if date_from:
        line_where.append(JournalEntry.date >= date_from)
    if date_to:
        line_where.append(JournalEntry.date <= date_to)
    deducted_books, paid = db.execute(
        select(func.coalesce(func.sum(JournalEntryLine.credit), 0), func.coalesce(func.sum(JournalEntryLine.debit), 0))
        .join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id).where(*line_where)).one()
    balance = db.scalar(select(func.coalesce(func.sum(JournalEntryLine.credit - JournalEntryLine.debit), 0))
                        .join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id)
                        .where(*([JournalEntryLine.sub_category_id.in_(account_ids)] if account_ids else [false()]),
                               *([JournalEntry.date <= date_to] if date_to else [])))
    total = sum((s['tds'] for s in sections.values()), ZERO)
    return {
        'date_from': date_from, 'date_to': date_to,
        'total_deducted': total,
        'total_taxable': sum((s['taxable'] for s in sections.values()), ZERO),
        # In the TDS accounts for the period: credited (deducted, incl. manual entries) and debited (paid)
        'books': {'credited': deducted_books, 'paid': paid},
        # Still to be paid to the government at the end of the period
        'outstanding': balance,
        'by_section': list(sections.values()),
        'by_supplier': sorted(suppliers.values(), key=lambda s: (s['section_code'], s['supplier_name'])),
        'bills': [{'id': b.id, 'bill_number': b.bill_number, 'bill_date': b.bill_date.isoformat(),
                   'supplier_name': b.supplier.name, 'pan': b.supplier.pan, 'section_code': b.tds_section.code,
                   'rate': b.tds_rate, 'taxable': b.subtotal, 'tds': b.tds_amount} for b in bills],
    }
