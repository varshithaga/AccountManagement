"""Sales invoices, purchase bills and payments - and the journal entries they post.

    Sales invoice (posted)   Dr Accounts Receivable (client's, or the default)   total
                             Cr each line's income account                       line amounts
                             Cr the tax rate's output GST account                tax
    Purchase bill (posted)   Dr each line's expense / asset account              line amounts
                             Dr the tax rate's input GST account                 tax (added to the line's
                                                                                 account when there is none)
                             Cr Accounts Payable (supplier's, or the default)    total
    Receipt from a client    Dr bank account's GL account (or Cash)             amount
                             Cr the client's receivable account                  amount
    Payment to a supplier    Dr the supplier's payable account                   amount
                             Cr bank account's GL account (or Cash)             amount

Invoices and bills start as DRAFT (editable, no journal entry). Posting creates the entry;
cancelling deletes it again. A payment posts its entry when it's created and is split across
invoices / bills by PaymentAllocation - whatever isn't allocated stays as an advance on the
party's account. Every posting goes through the same closed-period and reconciliation guards
as an imported journal entry.
"""
import re
from collections import OrderedDict
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from ..models import (
    BankAccount, Client, CreditNote, CreditNoteItem, DocumentStatus, NoteKind, JournalEntry, JournalEntryLine, Payment, PaymentAllocation,
    PaymentDirection, PaymentMethod, Product, PurchaseBill, PurchaseBillItem, SalesInvoice, SalesInvoiceItem,
    SubCategory, Supplier, TaxRate, User,
)
from ..utils import ZERO, q2, today as _today
from . import period_close
from . import reconciliation as recon
from .settings import accounting_settings

ORIGIN_SALES_INVOICE = 'SALES_INVOICE'
ORIGIN_PURCHASE_BILL = 'PURCHASE_BILL'
ORIGIN_PAYMENT = 'PAYMENT'
ORIGIN_MANUAL = 'MANUAL'  # keyed in on the Journal Entries page - edited and deleted there
ORIGIN_CREDIT_NOTE = 'CREDIT_NOTE'
ORIGIN_OPENING_BALANCE = 'OPENING_BALANCE'
OPEN_STATUSES = (DocumentStatus.POSTED, DocumentStatus.PARTIALLY_PAID)


class InvoicingError(Exception):
    pass


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------

_DEFAULT_NAMES = {
    'receivable': ('default_receivable_account_id', 'Accounts Receivable'),
    'payable': ('default_payable_account_id', 'Accounts Payable'),
    'cash': ('default_cash_account_id', 'Cash'),
}


def control_account(db: Session, kind: str) -> SubCategory:
    """The default receivable / payable / cash account: the one set in Accounting Settings,
    else the sub-category with the standard name."""
    field, name = _DEFAULT_NAMES[kind]
    account_id = getattr(accounting_settings(db), field)
    sub = db.get(SubCategory, account_id) if account_id else None
    if sub is None:
        sub = db.scalars(select(SubCategory).where(func.lower(SubCategory.name) == name.lower())).first()
    if sub is None:
        raise InvoicingError(f'No {name} account - add a "{name}" sub-category to the Chart of Accounts, '
                             f'or choose the default {kind} account in Accounting Settings.')
    return sub


def _named_account(db: Session, name: str) -> Optional[SubCategory]:
    return db.scalars(select(SubCategory).where(func.lower(SubCategory.name) == name.lower())).first()


def _account(db: Session, account_id, label: str) -> SubCategory:
    sub = db.get(SubCategory, account_id) if account_id else None
    if sub is None:
        raise InvoicingError(f'{label}: account {account_id} does not exist in the Chart of Accounts.')
    return sub


# ---------------------------------------------------------------------------
# Numbering
# ---------------------------------------------------------------------------

def next_number(db: Session, column, prefix: str, width: int = 5) -> str:
    """The next PREFIX-00001 style number after the highest one already used."""
    highest = 0
    pattern = re.compile(rf'^{re.escape(prefix)}-(\d+)$')
    for value in db.scalars(select(column).where(column.like(f'{prefix}-%'))):
        m = pattern.match(value or '')
        if m:
            highest = max(highest, int(m.group(1)))
    return f'{prefix}-{highest + 1:0{width}d}'


# ---------------------------------------------------------------------------
# Line items
# ---------------------------------------------------------------------------

def build_items(db: Session, items: list, kind: str, model=None) -> tuple[list, Decimal, Decimal]:
    """Validates line items (dicts) and works out each line's amount and tax.
    kind 'sale' defaults price / account from a product's sale side, 'purchase' from its purchase side.
    Returns ([item model], subtotal, tax_amount)."""
    if not items:
        raise InvoicingError('Add at least one line item.')
    model = model or (SalesInvoiceItem if kind == 'sale' else PurchaseBillItem)
    built, subtotal, tax_total = [], ZERO, ZERO
    for n, item in enumerate(items, start=1):
        product = None
        if item.get('product_id'):
            product = db.get(Product, item['product_id'])
            if product is None:
                raise InvoicingError(f'Line {n}: product {item["product_id"]} does not exist.')
        description = (item.get('description') or (product.name if product else '')).strip()
        if not description:
            raise InvoicingError(f'Line {n}: a description (or a product) is required.')
        quantity = Decimal(str(item.get('quantity') if item.get('quantity') is not None else 1))
        if quantity <= 0:
            raise InvoicingError(f'Line {n}: quantity must be greater than 0.')
        price = item.get('unit_price')
        if price is None:
            if product is None:
                raise InvoicingError(f'Line {n}: unit_price is required.')
            price = product.sale_price if kind == 'sale' else product.purchase_price
        price = q2(Decimal(str(price)))
        if price < 0:
            raise InvoicingError(f'Line {n}: unit_price cannot be negative.')
        discount = Decimal(str(item.get('discount_percent') or 0))
        if not 0 <= discount <= 100:
            raise InvoicingError(f'Line {n}: discount_percent must be between 0 and 100.')

        # An explicit tax_rate_id (even null = no tax) wins over the product's default.
        tax_rate_id = item['tax_rate_id'] if 'tax_rate_id' in item else (product.tax_rate_id if product else None)
        tax_rate = None
        if tax_rate_id:
            tax_rate = db.get(TaxRate, tax_rate_id)
            if tax_rate is None:
                raise InvoicingError(f'Line {n}: tax rate {tax_rate_id} does not exist.')

        account_id = item.get('account_id')
        if not account_id and product:
            account_id = product.income_account_id if kind == 'sale' else product.expense_account_id
        if not account_id:
            raise InvoicingError(f'Line {n}: choose the {"income" if kind == "sale" else "expense"} account '
                                 '(account_id), or a product that has one.')
        _account(db, account_id, f'Line {n}')

        amount = q2(quantity * price * (Decimal(100) - discount) / Decimal(100))
        tax = q2(amount * tax_rate.rate / Decimal(100)) if tax_rate else ZERO
        built.append(model(product_id=product.id if product else None, description=description[:500],
                           quantity=quantity, unit_price=price, discount_percent=discount,
                           tax_rate_id=tax_rate.id if tax_rate else None, amount=amount, tax_amount=tax,
                           account_id=account_id))
        subtotal += amount
        tax_total += tax
    return built, subtotal, tax_total


# ---------------------------------------------------------------------------
# Journal entries
# ---------------------------------------------------------------------------

def _post_entry(db: Session, entry_number: str, entry_date: date, narration: str, origin: str,
                lines: list[tuple[int, Decimal, Decimal, str]]) -> JournalEntry:
    """Creates a balanced entry from (sub_category_id, debit, credit, description) lines; lines on the
    same account and side are merged. Refused in a closed period or a reconciled bank month."""
    merged: OrderedDict = OrderedDict()
    for sub_id, debit, credit, description in lines:
        if debit < 0 or credit < 0:
            raise InvoicingError('Amounts cannot be negative.')
        if debit == 0 and credit == 0:
            continue
        key = (sub_id, 'D' if debit else 'C')
        if key in merged:
            merged[key][1] += debit
            merged[key][2] += credit
        else:
            merged[key] = [sub_id, debit, credit, description]
    total_debit = sum((l[1] for l in merged.values()), ZERO)
    total_credit = sum((l[2] for l in merged.values()), ZERO)
    if total_debit != total_credit or total_debit == 0:
        raise InvoicingError(f'The journal entry does not balance (debit {total_debit}, credit {total_credit}).')
    try:
        period_close.guard_dates(db, entry_date, what=f'nothing dated {entry_date:%d %b %Y} can be posted')
    except period_close.PeriodClosedError as exc:
        raise InvoicingError(str(exc))
    locked = recon.journal_lock_error(entry_date, [l[0] for l in merged.values()], recon.bank_gl_locks(db))
    if locked:
        raise InvoicingError(f'This posting {locked}.')
    if db.scalar(select(exists().where(JournalEntry.entry_number == entry_number))):
        raise InvoicingError(f'Journal entry {entry_number} already exists.')

    entry = JournalEntry(entry_number=entry_number, date=entry_date, narration=narration[:500], origin=origin)
    entry.lines = [JournalEntryLine(sub_category_id=s, debit=d, credit=c, description=(desc or '')[:500])
                   for s, d, c, desc in merged.values()]
    db.add(entry)
    db.flush()
    return entry


def _remove_entry(db: Session, entry_id: Optional[int], confirm_unmatch: bool) -> None:
    """Deletes a posted entry, with the same guards as deleting an imported one."""
    if not entry_id:
        return
    try:
        period_close.guard_journal_entries(db, [entry_id], 'it cannot be reversed')
        recon.guard_journal_entries(db, [entry_id], confirm_unmatch)
    except period_close.PeriodClosedError as exc:
        raise InvoicingError(str(exc))
    matched = recon.matched_transactions_of_entries(db, [entry_id])
    entry = db.get(JournalEntry, entry_id)
    if entry:
        db.delete(entry)
        db.flush()
    recon.drop_partial_matches(db, matched)


# ---------------------------------------------------------------------------
# Sales invoices
# ---------------------------------------------------------------------------

def _receivable_account_id(db: Session, client: Client) -> int:
    return client.receivable_account_id or control_account(db, 'receivable').id


def _payable_account_id(db: Session, supplier: Supplier) -> int:
    return supplier.payable_account_id or control_account(db, 'payable').id


def _due_date(doc_date: date, terms_days: int, given: Optional[date]) -> date:
    due = given or doc_date + timedelta(days=terms_days or 0)
    if due < doc_date:
        raise InvoicingError('The due date cannot be before the document date.')
    return due


def save_sales_invoice(db: Session, data: dict, user: Optional[User], invoice: Optional[SalesInvoice] = None) -> SalesInvoice:
    """Creates a DRAFT invoice, or replaces a draft's fields and items."""
    if invoice is not None and invoice.status != DocumentStatus.DRAFT:
        raise InvoicingError('Only a draft invoice can be edited - cancel it first to change a posted invoice.')
    client_id = data.get('client_id', invoice.client_id if invoice else None)
    client = db.get(Client, client_id) if client_id else None
    if client is None:
        raise InvoicingError('Choose a valid client.')
    if invoice is None:
        invoice = SalesInvoice(created_by_id=user.id if user else None, status=DocumentStatus.DRAFT)
        db.add(invoice)
    number = (data.get('invoice_number') or '').strip() or invoice.invoice_number \
        or next_number(db, SalesInvoice.invoice_number, 'INV')
    clash = db.scalar(select(SalesInvoice.id).where(SalesInvoice.invoice_number == number,
                                                    SalesInvoice.id != (invoice.id or 0)))
    if clash:
        raise InvoicingError(f'Invoice number {number} is already used.')
    invoice.invoice_number = number
    invoice.client_id = client.id
    invoice.invoice_date = data.get('invoice_date') or invoice.invoice_date or _today()
    invoice.due_date = _due_date(invoice.invoice_date, client.payment_terms_days,
                                 data.get('due_date') or (invoice.due_date if 'invoice_date' not in data else None))
    if 'notes' in data:
        invoice.notes = data.get('notes') or ''
    if 'items' in data or not invoice.items:
        items, subtotal, tax = build_items(db, data.get('items') or [], 'sale')
        invoice.items = items
        invoice.subtotal, invoice.tax_amount, invoice.total = subtotal, tax, subtotal + tax
    db.flush()
    return invoice


def post_sales_invoice(db: Session, invoice: SalesInvoice) -> SalesInvoice:
    if invoice.status != DocumentStatus.DRAFT:
        raise InvoicingError(f'Invoice {invoice.invoice_number} is already {invoice.status.value.lower()}.')
    if invoice.total <= 0:
        raise InvoicingError('An invoice must total more than zero to be posted.')
    client = invoice.client
    lines = [(_receivable_account_id(db, client), invoice.total, ZERO, f'Invoice {invoice.invoice_number}')]
    for item in invoice.items:
        lines.append((item.account_id, ZERO, item.amount, item.description))
        if item.tax_amount:
            tax_account = item.tax_rate.output_tax_account_id if item.tax_rate else None
            if not tax_account:
                fallback = _named_account(db, 'GST Payable')
                if not fallback:
                    raise InvoicingError(f'Tax rate "{item.tax_rate.name}" has no output tax account - set one, or add '
                                         'a "GST Payable" sub-category.')
                tax_account = fallback.id
            lines.append((tax_account, ZERO, item.tax_amount, f'{item.tax_rate.name} on {invoice.invoice_number}'))
    entry = _post_entry(db, f'SI-{invoice.invoice_number}', invoice.invoice_date,
                        f'Sales invoice {invoice.invoice_number} - {client.name}', ORIGIN_SALES_INVOICE, lines)
    invoice.journal_entry_id = entry.id
    invoice.status = DocumentStatus.POSTED
    refresh_status(invoice)
    db.flush()
    return invoice


def cancel_document(db: Session, doc, confirm_unmatch: bool = False):
    """Cancels a posted invoice / bill (its journal entry is deleted). Refused once it has payments."""
    label = 'invoice' if isinstance(doc, SalesInvoice) else 'bill'
    if doc.status == DocumentStatus.CANCELLED:
        raise InvoicingError(f'This {label} is already cancelled.')
    if doc.allocations:
        raise InvoicingError(f'This {label} has payments allocated to it - remove those allocations first.')
    if any(n.status == DocumentStatus.POSTED for n in doc.credit_notes):
        raise InvoicingError(f'This {label} has credit / debit notes - cancel those first.')
    _remove_entry(db, doc.journal_entry_id, confirm_unmatch)
    doc.journal_entry_id = None
    doc.status = DocumentStatus.CANCELLED
    db.flush()
    return doc


def delete_document(db: Session, doc) -> None:
    label = 'invoice' if isinstance(doc, SalesInvoice) else 'bill'
    if doc.status not in (DocumentStatus.DRAFT, DocumentStatus.CANCELLED):
        raise InvoicingError(f'Only a draft or cancelled {label} can be deleted - cancel it first.')
    db.delete(doc)
    db.flush()


# ---------------------------------------------------------------------------
# Purchase bills
# ---------------------------------------------------------------------------

def save_purchase_bill(db: Session, data: dict, user: Optional[User], bill: Optional[PurchaseBill] = None) -> PurchaseBill:
    if bill is not None and bill.status != DocumentStatus.DRAFT:
        raise InvoicingError('Only a draft bill can be edited - cancel it first to change a posted bill.')
    supplier_id = data.get('supplier_id', bill.supplier_id if bill else None)
    supplier = db.get(Supplier, supplier_id) if supplier_id else None
    if supplier is None:
        raise InvoicingError('Choose a valid supplier.')
    number = (data.get('bill_number') or (bill.bill_number if bill else '') or '').strip()
    if not number:
        raise InvoicingError("bill_number is required - use the supplier's own bill number.")
    clash = db.scalar(select(PurchaseBill.id).where(PurchaseBill.supplier_id == supplier.id,
                                                    PurchaseBill.bill_number == number,
                                                    PurchaseBill.id != (bill.id if bill else 0)))
    if clash:
        raise InvoicingError(f'Bill {number} from {supplier.name} is already recorded.')
    if bill is None:
        bill = PurchaseBill(created_by_id=user.id if user else None, status=DocumentStatus.DRAFT)
        db.add(bill)
    bill.bill_number = number
    bill.supplier_id = supplier.id
    bill.bill_date = data.get('bill_date') or bill.bill_date or _today()
    bill.due_date = _due_date(bill.bill_date, supplier.payment_terms_days,
                              data.get('due_date') or (bill.due_date if 'bill_date' not in data else None))
    if 'notes' in data:
        bill.notes = data.get('notes') or ''
    if 'items' in data or not bill.items:
        items, subtotal, tax = build_items(db, data.get('items') or [], 'purchase')
        bill.items = items
        bill.subtotal, bill.tax_amount, bill.total = subtotal, tax, subtotal + tax
    db.flush()
    return bill


def post_purchase_bill(db: Session, bill: PurchaseBill) -> PurchaseBill:
    if bill.status != DocumentStatus.DRAFT:
        raise InvoicingError(f'Bill {bill.bill_number} is already {bill.status.value.lower()}.')
    if bill.total <= 0:
        raise InvoicingError('A bill must total more than zero to be posted.')
    supplier = bill.supplier
    lines = []
    for item in bill.items:
        tax_account = item.tax_rate.input_tax_account_id if item.tax_rate else None
        if item.tax_amount and tax_account:
            lines.append((item.account_id, item.amount, ZERO, item.description))
            lines.append((tax_account, item.tax_amount, ZERO, f'{item.tax_rate.name} on {bill.bill_number}'))
        else:
            # No input-credit account: the tax is part of the cost.
            lines.append((item.account_id, item.amount + item.tax_amount, ZERO, item.description))
    lines.append((_payable_account_id(db, supplier), ZERO, bill.total, f'Bill {bill.bill_number}'))
    entry = _post_entry(db, f'PB-{supplier.id}-{bill.bill_number}', bill.bill_date,
                        f'Purchase bill {bill.bill_number} - {supplier.name}', ORIGIN_PURCHASE_BILL, lines)
    bill.journal_entry_id = entry.id
    bill.status = DocumentStatus.POSTED
    refresh_status(bill)
    db.flush()
    return bill


# ---------------------------------------------------------------------------
# Payments and allocations
# ---------------------------------------------------------------------------

def refresh_status(doc) -> None:
    """amount_paid from the document's allocations, amount_credited from its posted notes, and the
    matching status (posted documents only): settled = paid + credited."""
    paid = sum((a.amount for a in doc.allocations), ZERO)
    doc.amount_paid = paid
    doc.amount_credited = sum((n.total for n in doc.credit_notes if n.status == DocumentStatus.POSTED), ZERO)
    if doc.status in (DocumentStatus.DRAFT, DocumentStatus.CANCELLED):
        return
    settled = paid + doc.amount_credited
    if settled <= 0:
        doc.status = DocumentStatus.POSTED
    elif settled >= doc.total:
        doc.status = DocumentStatus.PAID
    else:
        doc.status = DocumentStatus.PARTIALLY_PAID


def _money_account_id(db: Session, method: PaymentMethod, bank_account: Optional[BankAccount]) -> int:
    if bank_account is not None:
        if not bank_account.gl_account_id:
            raise InvoicingError(f'Bank account "{bank_account.name}" is not linked to a GL account yet - '
                                 'set its GL account on the Bank Accounts page first.')
        return bank_account.gl_account_id
    if method != PaymentMethod.CASH:
        raise InvoicingError('Choose the bank account the money moved through (only cash payments can leave it empty).')
    return control_account(db, 'cash').id


def allocated_total(payment: Payment) -> Decimal:
    return sum((a.amount for a in payment.allocations), ZERO)


def add_allocations(db: Session, payment: Payment, allocations: list[dict]) -> None:
    """Applies parts of `payment` to invoices (receipt) or bills (payment to a supplier)."""
    available = payment.amount - allocated_total(payment)
    for n, alloc in enumerate(allocations, start=1):
        amount = q2(Decimal(str(alloc.get('amount') or 0)))
        if amount <= 0:
            raise InvoicingError(f'Allocation {n}: the amount must be greater than 0.')
        if payment.direction == PaymentDirection.RECEIPT:
            doc = db.get(SalesInvoice, alloc.get('sales_invoice_id') or 0)
            if doc is None or doc.client_id != payment.client_id:
                raise InvoicingError(f'Allocation {n}: choose an invoice of this client.')
            label = f'invoice {doc.invoice_number}'
        else:
            doc = db.get(PurchaseBill, alloc.get('purchase_bill_id') or 0)
            if doc is None or doc.supplier_id != payment.supplier_id:
                raise InvoicingError(f'Allocation {n}: choose a bill of this supplier.')
            label = f'bill {doc.bill_number}'
        if doc.status not in OPEN_STATUSES:
            raise InvoicingError(f'Allocation {n}: {label} is {doc.status.value.lower()} - only posted, unpaid '
                                 'documents can take a payment.')
        doc_field = 'sales_invoice_id' if payment.direction == PaymentDirection.RECEIPT else 'purchase_bill_id'
        existing = next((a for a in payment.allocations if getattr(a, doc_field) == doc.id), None)
        if amount > doc.balance_due:
            raise InvoicingError(f'Allocation {n}: {amount} is more than the {doc.balance_due} still due on {label}.')
        if amount > available:
            raise InvoicingError(f'Allocation {n}: only {available} of this payment is left to allocate.')
        if existing:
            existing.amount += amount
        else:
            alloc_row = PaymentAllocation(amount=amount)
            if payment.direction == PaymentDirection.RECEIPT:
                alloc_row.sales_invoice = doc
            else:
                alloc_row.purchase_bill = doc
            payment.allocations.append(alloc_row)
        db.flush()
        available -= amount
        db.refresh(doc, ['allocations'])
        refresh_status(doc)
    db.flush()


def remove_allocation(db: Session, payment: Payment, allocation: PaymentAllocation) -> None:
    doc = allocation.sales_invoice or allocation.purchase_bill
    payment.allocations.remove(allocation)
    db.flush()
    db.refresh(doc, ['allocations'])
    refresh_status(doc)
    db.flush()


def create_payment(db: Session, data: dict, user: Optional[User]) -> Payment:
    direction = PaymentDirection(data['direction'])
    amount = q2(Decimal(str(data['amount'])))
    if amount <= 0:
        raise InvoicingError('The amount must be greater than 0.')
    method = PaymentMethod(data.get('method') or PaymentMethod.BANK_TRANSFER)
    payment_date = data.get('payment_date') or _today()

    if direction == PaymentDirection.RECEIPT:
        party = db.get(Client, data.get('client_id') or 0)
        if party is None:
            raise InvoicingError('A receipt needs a valid client.')
        party_account = _receivable_account_id(db, party)
        prefix = 'RCPT'
    else:
        party = db.get(Supplier, data.get('supplier_id') or 0)
        if party is None:
            raise InvoicingError('A payment to a supplier needs a valid supplier.')
        party_account = _payable_account_id(db, party)
        prefix = 'PAY'

    bank_account = None
    if data.get('bank_account_id'):
        bank_account = db.get(BankAccount, data['bank_account_id'])
        if bank_account is None:
            raise InvoicingError('That bank account does not exist.')
    money_account = _money_account_id(db, method, bank_account)

    number = (data.get('payment_number') or '').strip() or next_number(db, Payment.payment_number, prefix)
    if db.scalar(select(exists().where(Payment.payment_number == number))):
        raise InvoicingError(f'Payment number {number} is already used.')

    payment = Payment(
        payment_number=number, direction=direction, payment_date=payment_date, amount=amount, method=method,
        client_id=party.id if direction == PaymentDirection.RECEIPT else None,
        supplier_id=party.id if direction == PaymentDirection.PAYMENT else None,
        bank_account_id=bank_account.id if bank_account else None,
        reference_number=(data.get('reference_number') or '').strip()[:100], notes=data.get('notes') or '',
        created_by_id=user.id if user else None,
    )
    db.add(payment)
    db.flush()

    reference = f' ({payment.reference_number})' if payment.reference_number else ''
    if direction == PaymentDirection.RECEIPT:
        lines = [(money_account, amount, ZERO, f'Receipt from {party.name}{reference}'),
                 (party_account, ZERO, amount, f'Receipt {number}')]
        narration = f'Receipt {number} - {party.name}'
    else:
        lines = [(party_account, amount, ZERO, f'Payment {number}'),
                 (money_account, ZERO, amount, f'Payment to {party.name}{reference}')]
        narration = f'Payment {number} - {party.name}'
    entry = _post_entry(db, f'{number}', payment_date, narration, ORIGIN_PAYMENT, lines)
    payment.journal_entry_id = entry.id

    if data.get('allocations'):
        add_allocations(db, payment, data['allocations'])
    db.flush()
    return payment


def delete_payment(db: Session, payment: Payment, confirm_unmatch: bool = False) -> None:
    """Deletes a payment, its journal entry and its allocations (the documents become unpaid again)."""
    docs = [a.sales_invoice or a.purchase_bill for a in payment.allocations]
    _remove_entry(db, payment.journal_entry_id, confirm_unmatch)
    db.delete(payment)
    db.flush()
    for doc in docs:
        db.refresh(doc, ['allocations'])
        refresh_status(doc)
    db.flush()


def guard_entry_not_from_document(db: Session, entry_ids: list[int]) -> Optional[str]:
    """The message when one of the journal entries was posted by an invoice, bill or payment
    (those are removed by cancelling / deleting the document), else None."""
    if not entry_ids:
        return None
    entry = db.scalars(select(JournalEntry).where(JournalEntry.id.in_(entry_ids), JournalEntry.origin.is_not(None),
                                                  JournalEntry.origin != ORIGIN_MANUAL).limit(1)).first()
    if entry is None:
        return None
    if entry.origin == ORIGIN_CREDIT_NOTE:
        return (f'Entry {entry.entry_number} was posted from a credit / debit note - cancel the note instead of '
                'deleting its journal entry.')
    if entry.origin == ORIGIN_OPENING_BALANCE:
        return (f'Entry {entry.entry_number} books a client / supplier opening balance - change or clear the opening '
                'balance on the Clients / Suppliers page instead.')
    if entry.origin == 'BANK':
        return (f'Entry {entry.entry_number} was posted from a final bank transaction - reopen that transaction in the '
                'General Ledger to take it out of the books.')
    what = {ORIGIN_SALES_INVOICE: 'a sales invoice', ORIGIN_PURCHASE_BILL: 'a purchase bill',
            ORIGIN_PAYMENT: 'a payment'}.get(entry.origin, 'another document')
    return (f'Entry {entry.entry_number} was posted from {what} - cancel or delete that document instead '
            'of deleting its journal entry.')


# ---------------------------------------------------------------------------
# Party statements and aging
# ---------------------------------------------------------------------------

def party_statement(db: Session, party, date_from: Optional[date] = None, date_to: Optional[date] = None) -> dict:
    """Every posted invoice/bill and payment of a client or supplier, oldest first, with a running
    balance of what they owe (client) or are owed (supplier). Starts from the party's opening balance."""
    is_client = isinstance(party, Client)
    doc_model = SalesInvoice if is_client else PurchaseBill
    doc_date = SalesInvoice.invoice_date if is_client else PurchaseBill.bill_date
    party_col = SalesInvoice.client_id if is_client else PurchaseBill.supplier_id
    pay_col = Payment.client_id if is_client else Payment.supplier_id

    docs = db.scalars(select(doc_model).where(party_col == party.id, doc_model.status.in_(
        [DocumentStatus.POSTED, DocumentStatus.PARTIALLY_PAID, DocumentStatus.PAID]))).all()
    payments = db.scalars(select(Payment).where(pay_col == party.id)).all()
    note_doc = CreditNote.sales_invoice_id if is_client else CreditNote.purchase_bill_id
    notes = db.scalars(select(CreditNote).where(CreditNote.status == DocumentStatus.POSTED, note_doc.in_(
        select(doc_model.id).where(party_col == party.id)))).all()

    events = []
    for cn in notes:
        events.append({'date': cn.note_date, 'type': 'CREDIT_NOTE' if is_client else 'DEBIT_NOTE', 'id': cn.id,
                       'number': cn.note_number, 'due_date': None, 'increase': ZERO, 'decrease': cn.total})
    for d in docs:
        events.append({
            'date': d.invoice_date if is_client else d.bill_date,
            'type': 'INVOICE' if is_client else 'BILL',
            'id': d.id,
            'number': d.invoice_number if is_client else d.bill_number,
            'due_date': d.due_date.isoformat(),
            'increase': d.total, 'decrease': ZERO,
        })
    for p in payments:
        events.append({'date': p.payment_date, 'type': p.direction.value, 'id': p.id, 'number': p.payment_number,
                       'due_date': None, 'increase': ZERO, 'decrease': p.amount})
    events.sort(key=lambda e: (e['date'], 0 if e['decrease'] == 0 else 1, e['id']))

    opening = party.opening_balance or ZERO
    if date_from:
        opening += sum((e['increase'] - e['decrease'] for e in events if e['date'] < date_from), ZERO)
    running = opening
    rows = []
    for e in events:
        if (date_from and e['date'] < date_from) or (date_to and e['date'] > date_to):
            continue
        running += e['increase'] - e['decrease']
        rows.append({**e, 'date': e['date'].isoformat(), 'balance': running})
    return {
        'party': {'id': party.id, 'name': party.name, 'kind': 'client' if is_client else 'supplier'},
        'date_from': date_from.isoformat() if date_from else None,
        'date_to': date_to.isoformat() if date_to else None,
        'opening_balance': opening,
        'total_increase': sum((r['increase'] for r in rows), ZERO),
        'total_decrease': sum((r['decrease'] for r in rows), ZERO),
        'closing_balance': running,
        'rows': rows,
    }


AGING_BUCKETS = (('current', None, 0), ('1_30', 1, 30), ('31_60', 31, 60), ('61_90', 61, 90), ('over_90', 91, None))


def _bucket(days_overdue: int) -> str:
    for key, low, high in AGING_BUCKETS:
        if (low is None or days_overdue >= low) and (high is None or days_overdue <= high):
            return key
    return 'over_90'


def aging_report(db: Session, kind: str, as_of: Optional[date] = None) -> dict:
    """Outstanding receivables (kind='receivables') or payables ('payables') per party, by how
    many days past the due date each open document is as of `as_of`. Opening balances and
    unallocated payments (advances) are shown in their own columns."""
    as_of = as_of or _today()
    is_client = kind == 'receivables'
    party_model = Client if is_client else Supplier
    doc_model = SalesInvoice if is_client else PurchaseBill
    party_attr = 'client_id' if is_client else 'supplier_id'
    doc_date = SalesInvoice.invoice_date if is_client else PurchaseBill.bill_date

    def blank(party):
        return {'party_id': party.id, 'party_name': party.name, 'opening_balance': party.opening_balance or ZERO,
                **{key: ZERO for key, *_ in AGING_BUCKETS}, 'advances': ZERO, 'total': ZERO, 'documents': []}

    parties = {p.id: blank(p) for p in db.scalars(select(party_model).order_by(party_model.name))}
    for doc in db.scalars(select(doc_model).where(doc_model.status.in_(OPEN_STATUSES), doc_date <= as_of)):
        due = doc.balance_due
        if due <= 0:
            continue
        row = parties[getattr(doc, party_attr)]
        days = (as_of - doc.due_date).days
        key = _bucket(days)
        row[key] += due
        row['documents'].append({
            'id': doc.id, 'number': doc.invoice_number if is_client else doc.bill_number,
            'date': (doc.invoice_date if is_client else doc.bill_date).isoformat(),
            'due_date': doc.due_date.isoformat(), 'total': doc.total, 'balance_due': due,
            'days_overdue': max(days, 0), 'bucket': key,
        })
    pay_col = Payment.client_id if is_client else Payment.supplier_id
    for payment in db.scalars(select(Payment).where(pay_col.is_not(None), Payment.payment_date <= as_of)):
        unallocated = payment.amount - allocated_total(payment)
        if unallocated > 0:
            parties[getattr(payment, party_attr)]['advances'] += unallocated

    rows = []
    for row in parties.values():
        row['total'] = row['opening_balance'] + sum((row[key] for key, *_ in AGING_BUCKETS), ZERO) - row['advances']
        if row['total'] or row['documents'] or row['advances'] or row['opening_balance']:
            rows.append(row)
    totals = {key: sum((r[key] for r in rows), ZERO) for key in
              ['opening_balance', *(k for k, *_ in AGING_BUCKETS), 'advances', 'total']}
    return {'kind': kind, 'as_of': as_of.isoformat(), 'buckets': [k for k, *_ in AGING_BUCKETS],
            'parties': rows, 'totals': totals}


# ---------------------------------------------------------------------------
# Credit notes (sales) and debit notes (purchases)
# ---------------------------------------------------------------------------

def create_credit_note(db: Session, data: dict, user: Optional[User]) -> CreditNote:
    """Creates and posts a note against a posted invoice (credit note) or bill (debit note): its lines
    reverse the income / expense and GST they cover, and it lowers the document's balance due.
    data: {"sales_invoice_id" | "purchase_bill_id", "note_date", "reason", "note_number"?, "items": [...]}"""
    if data.get('sales_invoice_id'):
        kind, doc = NoteKind.SALES, db.get(SalesInvoice, data['sales_invoice_id'])
    elif data.get('purchase_bill_id'):
        kind, doc = NoteKind.PURCHASE, db.get(PurchaseBill, data['purchase_bill_id'])
    else:
        raise InvoicingError('Choose the invoice or bill the note is for.')
    if doc is None:
        raise InvoicingError('That invoice / bill does not exist.')
    label = 'invoice' if kind == NoteKind.SALES else 'bill'
    if doc.status not in (DocumentStatus.POSTED, DocumentStatus.PARTIALLY_PAID, DocumentStatus.PAID):
        raise InvoicingError(f'Only a posted {label} can get a {"credit" if kind == NoteKind.SALES else "debit"} note.')

    items, subtotal, tax = build_items(db, data.get('items') or [], 'sale' if kind == NoteKind.SALES else 'purchase',
                                       model=CreditNoteItem)
    total = subtotal + tax
    if total <= 0:
        raise InvoicingError('A note must total more than zero.')
    # Only what is still owed can be credited; anything already paid would need a refund payment instead.
    if total > doc.balance_due:
        raise InvoicingError(f'The note totals {total}, but only {doc.balance_due} is still due on this {label}. '
                             'Remove a payment allocation first if the paid part is being refunded.')
    note_date = data.get('note_date') or _today()
    doc_date = doc.invoice_date if kind == NoteKind.SALES else doc.bill_date
    if note_date < doc_date:
        raise InvoicingError(f'The note cannot be dated before the {label} ({doc_date:%d %b %Y}).')

    prefix = 'CN' if kind == NoteKind.SALES else 'DN'
    number = (data.get('note_number') or '').strip() or next_number(db, CreditNote.note_number, prefix)
    if db.scalar(select(exists().where(CreditNote.note_number == number))):
        raise InvoicingError(f'Note number {number} is already used.')

    note = CreditNote(note_number=number, kind=kind, note_date=note_date, reason=(data.get('reason') or '').strip(),
                      subtotal=subtotal, tax_amount=tax, total=total, status=DocumentStatus.POSTED,
                      created_by_id=user.id if user else None)
    note.items = items
    if kind == NoteKind.SALES:
        note.sales_invoice = doc
        party = doc.client
        lines = []
        for item in items:
            lines.append((item.account_id, item.amount, ZERO, item.description))
            if item.tax_amount:
                tax_rate = db.get(TaxRate, item.tax_rate_id)
                tax_account = tax_rate.output_tax_account_id or getattr(_named_account(db, 'GST Payable'), 'id', None)
                if not tax_account:
                    raise InvoicingError(f'Tax rate "{tax_rate.name}" has no output tax account.')
                lines.append((tax_account, item.tax_amount, ZERO, f'{tax_rate.name} on {number}'))
        lines.append((_receivable_account_id(db, party), ZERO, total, f'Credit note {number}'))
        narration = f'Credit note {number} on invoice {doc.invoice_number} - {party.name}'
    else:
        note.purchase_bill = doc
        party = doc.supplier
        lines = [(_payable_account_id(db, party), total, ZERO, f'Debit note {number}')]
        for item in items:
            tax_rate = db.get(TaxRate, item.tax_rate_id) if item.tax_rate_id else None
            tax_account = tax_rate.input_tax_account_id if tax_rate else None
            if item.tax_amount and tax_account:
                lines.append((item.account_id, ZERO, item.amount, item.description))
                lines.append((tax_account, ZERO, item.tax_amount, f'{tax_rate.name} on {number}'))
            else:
                lines.append((item.account_id, ZERO, item.amount + item.tax_amount, item.description))
        narration = f'Debit note {number} on bill {doc.bill_number} - {party.name}'
    db.add(note)
    entry = _post_entry(db, number, note_date, narration, ORIGIN_CREDIT_NOTE, lines)
    note.journal_entry_id = entry.id
    db.flush()
    db.refresh(doc, ['credit_notes'])
    refresh_status(doc)
    db.flush()
    return note


def cancel_credit_note(db: Session, note: CreditNote, confirm_unmatch: bool = False) -> CreditNote:
    """Deletes the note's journal entry and gives its amount back to the invoice / bill."""
    if note.status == DocumentStatus.CANCELLED:
        raise InvoicingError('This note is already cancelled.')
    _remove_entry(db, note.journal_entry_id, confirm_unmatch)
    note.journal_entry_id = None
    note.status = DocumentStatus.CANCELLED
    db.flush()
    doc = note.sales_invoice or note.purchase_bill
    db.refresh(doc, ['credit_notes'])
    refresh_status(doc)
    db.flush()
    return note


def delete_credit_note(db: Session, note: CreditNote) -> None:
    if note.status != DocumentStatus.CANCELLED:
        raise InvoicingError('Only a cancelled note can be deleted - cancel it first.')
    db.delete(note)
    db.flush()


# ---------------------------------------------------------------------------
# Opening balances of clients and suppliers
# ---------------------------------------------------------------------------

OPENING_EQUITY_NAME = 'Opening Balance Equity'


def opening_equity_account(db: Session) -> SubCategory:
    """The equity account opening balances are booked against - "Opening Balance Equity", created under
    the first equity category when it doesn't exist yet."""
    from ..models import AccountType, Category
    sub = _named_account(db, OPENING_EQUITY_NAME)
    if sub:
        return sub
    category = db.scalars(select(Category).where(Category.account_type == AccountType.EQUITY)
                          .order_by(Category.id).limit(1)).first()
    if category is None:
        raise InvoicingError('Add an Equity category to the Chart of Accounts first - opening balances are booked '
                             f'against an "{OPENING_EQUITY_NAME}" account under it.')
    sub = SubCategory(category_id=category.id, name=OPENING_EQUITY_NAME,
                      description='Balancing account for opening balances entered when the books were set up.')
    db.add(sub)
    db.flush()
    return sub


def opening_entry_number(party) -> str:
    return f'OB-{"C" if isinstance(party, Client) else "S"}-{party.id}'


def sync_opening_balance(db: Session, party) -> Optional[JournalEntry]:
    """Books the client / supplier's opening balance as journal entry OB-C-<id> / OB-S-<id> (replacing
    the previous one), or removes it when the balance is zero:
        client:   Dr their receivable account / Cr Opening Balance Equity
        supplier: Dr Opening Balance Equity / Cr their payable account
    (a negative balance books the other way round). Dated opening_balance_date, default today."""
    number = opening_entry_number(party)
    existing = db.scalars(select(JournalEntry).where(JournalEntry.entry_number == number)).first()
    amount = Decimal(party.opening_balance or 0)
    on = party.opening_balance_date or _today()
    if existing is not None:
        unchanged = (existing.date == on and existing.lines and
                     sum((l.debit for l in existing.lines), ZERO) == abs(amount) and amount != 0)
        if unchanged:
            party_account = (_receivable_account_id(db, party) if isinstance(party, Client)
                             else _payable_account_id(db, party))
            if any(l.sub_category_id == party_account for l in existing.lines):
                return existing
        _remove_entry(db, existing.id, confirm_unmatch=False)
    if amount == 0:
        return None
    equity = opening_equity_account(db).id
    if isinstance(party, Client):
        dr, cr = _receivable_account_id(db, party), equity
    else:
        dr, cr = equity, _payable_account_id(db, party)
    if amount < 0:
        dr, cr = cr, dr
    value = abs(amount)
    kind = 'client' if isinstance(party, Client) else 'supplier'
    return _post_entry(db, number, on, f'Opening balance - {kind} {party.name}', ORIGIN_OPENING_BALANCE,
                       [(dr, value, ZERO, f'Opening balance of {party.name}'), (cr, ZERO, value, '')])


def remove_opening_balance(db: Session, party) -> None:
    entry = db.scalars(select(JournalEntry).where(JournalEntry.entry_number == opening_entry_number(party))).first()
    if entry is not None:
        _remove_entry(db, entry.id, confirm_unmatch=False)
