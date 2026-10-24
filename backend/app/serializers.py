"""Model -> JSON dicts, in the same shapes the Django serializers produced
(model DecimalFields as "123.45" strings, foreign keys as ids plus *_name helpers)."""
from collections import defaultdict
from decimal import Decimal
from pathlib import PurePosixPath
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .access import is_admin, role_actions, user_actions, user_pages
from .config import get_settings
from .models import (
    BaiCode, BankAccount, BankStatement, Category, CategoryKeyword, Client, JournalEntry, JournalEntryLine,
    JournalImportBatch, Payment, Product, PurchaseBill, ReconciliationMatch, Role, SalesInvoice, SubCategory,
    Supplier, TaxRate, Transaction, User,
)
from .utils import iso, money

ACCOUNT_TYPE_LABELS = {'ASSET': 'Asset', 'LIABILITY': 'Liability', 'EQUITY': 'Equity', 'INCOME': 'Income',
                       'EXPENSE': 'Expense'}


def _v(enum_value):
    """An enum's value (or None / plain strings unchanged)."""
    return getattr(enum_value, 'value', enum_value)


# ---------------------------------------------------------------------------
# Users & roles
# ---------------------------------------------------------------------------

def role(r: Role, user_count: int = 0) -> dict:
    return {'id': r.id, 'name': r.name, 'description': r.description, 'pages': r.pages or [],
            'actions': role_actions(r), 'is_admin': r.is_admin, 'user_count': user_count}


def user(u: User) -> dict:
    return {
        'id': u.id, 'username': u.username, 'first_name': u.first_name, 'last_name': u.last_name,
        'email': u.email, 'is_active': u.is_active, 'is_superuser': u.is_superuser,
        'role': u.role_id, 'role_name': u.role.name if u.role else None, 'is_admin': is_admin(u),
        'last_login': iso(u.last_login), 'date_joined': iso(u.date_joined),
    }


def current_user(u: User) -> dict:
    return {
        'id': u.id, 'username': u.username, 'first_name': u.first_name, 'last_name': u.last_name,
        'email': u.email, 'role_name': u.role.name if u.role else None, 'is_admin': is_admin(u),
        'pages': user_pages(u), 'actions': user_actions(u), 'date_joined': iso(u.date_joined),
        'testing_tools': get_settings().testing_tools and is_admin(u),
    }


# ---------------------------------------------------------------------------
# Chart of Accounts, rules, bank accounts
# ---------------------------------------------------------------------------

def sub_category(s: SubCategory) -> dict:
    return {'id': s.id, 'category': s.category_id, 'category_name': s.category.name, 'code': s.code,
            'name': s.name, 'description': s.description, 'is_active': s.is_active}


def category(c: Category) -> dict:
    return {'id': c.id, 'code': c.code, 'name': c.name, 'account_type': _v(c.account_type),
            'description': c.description, 'is_active': c.is_active,
            'subcategories': [sub_category(s) for s in c.subcategories]}


def category_lookup(c: Category) -> dict:
    t = _v(c.account_type)
    return {'id': c.id, 'code': c.code, 'name': c.name, 'account_type': t, 'account_type_label': ACCOUNT_TYPE_LABELS[t]}


def sub_category_lookup(s: SubCategory) -> dict:
    t = _v(s.category.account_type)
    return {
        'id': s.id, 'code': s.code, 'name': s.name, 'category': s.category_id, 'category_name': s.category.name,
        'category_code': s.category.code, 'account_type': t, 'account_type_label': ACCOUNT_TYPE_LABELS[t],
        'linked_bank_account': s.bank_account.id if s.bank_account else None,
        'linked_bank_account_name': s.bank_account.name if s.bank_account else None,
    }


def keyword(k: CategoryKeyword) -> dict:
    s = k.sub_category
    return {
        'id': k.id, 'keyword': k.keyword, 'sub_category': k.sub_category_id, 'sub_category_name': s.name,
        'category': s.category_id, 'category_name': s.category.name, 'account_type': _v(s.category.account_type),
        'is_active': k.is_active, 'priority': k.priority, 'auto_assign': k.auto_assign, 'auto_created': k.auto_created,
    }


def bai_code(b: BaiCode) -> dict:
    return {'id': b.id, 'code': b.code, 'description': b.description,
            'category': b.category_id, 'category_name': b.category.name if b.category else None,
            'sub_category': b.sub_category_id, 'sub_category_name': b.sub_category.name if b.sub_category else None}


def bank_account(a: BankAccount) -> dict:
    gl = a.gl_account
    return {'id': a.id, 'name': a.name, 'bank_name': a.bank_name, 'account_number': a.account_number,
            'is_active': a.is_active, 'gl_account': a.gl_account_id,
            'gl_account_name': gl.name if gl else None, 'gl_account_category_name': gl.category.name if gl else None}


def bank_account_lookup(a: BankAccount) -> dict:
    return {'id': a.id, 'name': a.name, 'bank_name': a.bank_name, 'is_active': a.is_active}


# ---------------------------------------------------------------------------
# Statements & transactions
# ---------------------------------------------------------------------------

def statement_counts(db: Session, statement_ids: list[int]) -> dict:
    """{statement id: {transactions, duplicates, uncategorized, confirmed, final, reconciled}} in two queries."""
    if not statement_ids:
        return {}
    counts = defaultdict(lambda: dict(transactions=0, duplicates=0, uncategorized=0, confirmed=0, final=0, reconciled=0))
    matched = set(db.scalars(select(ReconciliationMatch.transaction_id)
                             .join(Transaction, ReconciliationMatch.transaction_id == Transaction.id)
                             .where(Transaction.statement_id.in_(statement_ids))).all())
    rows = db.execute(select(Transaction.id, Transaction.statement_id, Transaction.is_potential_duplicate,
                             Transaction.category_id, Transaction.sub_category_id, Transaction.confirmed,
                             Transaction.is_final).where(Transaction.statement_id.in_(statement_ids)))
    for txn_id, stmt_id, dup, cat, sub, confirmed, final in rows:
        c = counts[stmt_id]
        c['transactions'] += 1
        c['duplicates'] += bool(dup)
        c['uncategorized'] += cat is None or sub is None
        c['confirmed'] += bool(confirmed)
        c['final'] += bool(final)
        c['reconciled'] += txn_id in matched
    return counts


def statement(s: BankStatement, counts: dict, continuity: Optional[dict]) -> dict:
    total = counts.get('transactions', 0)
    return {
        'id': s.id, 'account': s.account_id, 'account_name': s.account.name,
        # The file's name; download it from /api/bank-statements/<id>/file/ (signed in)
        'file': PurePosixPath(s.file_path).name if s.file_path else None,
        'source_type': _v(s.source_type), 'opening_balance': money(s.opening_balance),
        'closing_balance': money(s.closing_balance), 'uploaded_at': iso(s.uploaded_at),
        'transaction_count': total, 'duplicate_count': counts.get('duplicates', 0),
        'continuity_status': continuity,
        'progress': {
            'total': total,
            'categorized': total - counts.get('uncategorized', 0),
            'uncategorized': counts.get('uncategorized', 0),
            'confirmed': counts.get('confirmed', 0),
            'final': counts.get('final', 0),
            'reconciled': counts.get('reconciled', 0),
            'unreconciled': total - counts.get('reconciled', 0),
        },
        'gl_linked': s.account.gl_account_id is not None,
    }


class TransactionSerializer:
    """Serializes transactions with what the General Ledger shows next to each: BAI code meaning,
    duplicate / transfer partner, and the journal lines it is reconciled with."""

    def __init__(self, db: Session):
        self.db = db
        self._bai = None

    @property
    def bai_map(self):
        if self._bai is None:
            self._bai = {b.code: b.description for b in self.db.scalars(select(BaiCode))}
        return self._bai

    def many(self, txns) -> list[dict]:
        ids = [t.id for t in txns]
        matches = defaultdict(list)
        if ids:
            rows = self.db.execute(
                select(ReconciliationMatch, JournalEntryLine, JournalEntry)
                .join(JournalEntryLine, ReconciliationMatch.journal_line_id == JournalEntryLine.id)
                .join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id)
                .where(ReconciliationMatch.transaction_id.in_(ids))
            ).all()
            for m, line, entry in rows:
                matches[m.transaction_id].append({
                    'entry': entry.id, 'entry_number': entry.entry_number, 'entry_date': entry.date.isoformat(),
                    'narration': entry.narration, 'amount': money(line.debit or line.credit), 'method': _v(m.method),
                })
        return [self.one(t, matches.get(t.id, [])) for t in txns]

    def one(self, t: Transaction, reconciled_with: Optional[list] = None) -> dict:
        if reconciled_with is None:
            return self.many([t])[0]
        dup, pair = t.duplicate_of, t.transfer_pair
        return {
            'id': t.id, 'statement': t.statement_id, 'account': t.statement.account_id,
            'account_name': t.statement.account.name, 'date': t.date.isoformat(), 'description': t.description,
            'clean_description': t.clean_description, 'bai_code': t.bai_code,
            'bai_code_description': self.bai_map.get(t.bai_code) if t.bai_code else None,
            'debit': money(t.debit), 'credit': money(t.credit), 'balance': money(t.balance),
            'category': t.category_id, 'category_name': t.category.name if t.category else None,
            'category_account_type': _v(t.category.account_type) if t.category else None,
            'sub_category': t.sub_category_id, 'sub_category_name': t.sub_category.name if t.sub_category else None,
            'confirmed': t.confirmed, 'confidence_score': t.confidence_score, 'score_breakdown': t.score_breakdown,
            'scoring_clues': t.scoring_clues, 'categorization_source': _v(t.categorization_source),
            'status': _v(t.status) or '',
            'transfer_pair': t.transfer_pair_id,
            'transfer_pair_account_name': pair.statement.account.name if pair else None,
            'is_potential_duplicate': t.is_potential_duplicate, 'duplicate_of': t.duplicate_of_id,
            'duplicate_of_date': dup.date.isoformat() if dup else None,
            'duplicate_of_description': dup.description if dup else None,
            'duplicate_of_statement': dup.statement_id if dup else None,
            'is_final': t.is_final, 'finalized_at': iso(t.finalized_at),
            'is_reconciled': bool(reconciled_with), 'reconciled_with': reconciled_with,
        }


# ---------------------------------------------------------------------------
# Journal entries
# ---------------------------------------------------------------------------

def journal_entries(db: Session, entries: list[JournalEntry]) -> list[dict]:
    """Entries with their lines and each bank line's reconciliation status, in a few queries."""
    entry_ids = [e.id for e in entries]
    if not entry_ids:
        return []
    bank_gl = {gl: name for gl, name in db.execute(
        select(BankAccount.gl_account_id, BankAccount.id).where(BankAccount.gl_account_id.is_not(None)))}
    lines_by_entry = defaultdict(list)
    line_rows = db.scalars(select(JournalEntryLine).where(JournalEntryLine.entry_id.in_(entry_ids))
                           .order_by(JournalEntryLine.id)).all()
    line_ids = [l.id for l in line_rows]
    match_info = {}
    if line_ids:
        for m, txn, stmt, acct in db.execute(
                select(ReconciliationMatch, Transaction, BankStatement, BankAccount)
                .outerjoin(Transaction, ReconciliationMatch.transaction_id == Transaction.id)
                .outerjoin(BankStatement, Transaction.statement_id == BankStatement.id)
                .outerjoin(BankAccount, BankStatement.account_id == BankAccount.id)
                .where(ReconciliationMatch.journal_line_id.in_(line_ids))):
            match_info[m.journal_line_id] = (m, txn, stmt, acct)
    for l in line_rows:
        lines_by_entry[l.entry_id].append(l)

    result = []
    for e in entries:
        lines, flags = [], []
        total_debit = total_credit = Decimal('0.00')
        for l in lines_by_entry[e.id]:
            total_debit += l.debit
            total_credit += l.credit
            is_bank = l.sub_category_id in bank_gl
            info = match_info.get(l.id)
            m, txn, stmt, acct = info if info else (None, None, None, None)
            reconciled = (info is not None) if is_bank else None
            if reconciled is not None:
                flags.append(reconciled)
            lines.append({
                'id': l.id, 'sub_category': l.sub_category_id, 'sub_category_name': l.sub_category.name,
                'category': l.sub_category.category_id, 'category_name': l.sub_category.category.name,
                'account_type': _v(l.sub_category.category.account_type), 'description': l.description,
                'debit': money(l.debit), 'credit': money(l.credit), 'reconciled': reconciled,
                'reconciled_transaction_date': iso(txn.date) if txn else None,
                'reconciled_as_opening_balance': bool(m and _v(m.method) == 'OPENING'),
                'reconciled_transaction': {
                    'id': txn.id, 'date': txn.date.isoformat(), 'description': txn.description,
                    'amount': money(txn.debit or txn.credit), 'statement': stmt.id, 'bank_account_name': acct.name,
                    'method': _v(m.method),
                } if txn else None,
            })
        status = None
        if flags:
            status = 'RECONCILED' if all(flags) else ('PARTIAL' if any(flags) else 'UNRECONCILED')
        batch = e.batch
        result.append({
            'id': e.id, 'entry_number': e.entry_number, 'date': e.date.isoformat(), 'narration': e.narration,
            'batch': e.batch_id, 'source': _v(batch.source) if batch else e.origin,
            'source_name': batch.source_name if batch else '', 'origin': e.origin,
            'bank_account': batch.bank_account_id if batch else None,
            'bank_account_name': batch.bank_account.name if batch and batch.bank_account else None,
            'total_debit': money(total_debit), 'total_credit': money(total_credit), 'reconcile_status': status,
            'lines': lines, 'created_at': iso(e.created_at),
        })
    return result


def batch(b: JournalImportBatch, entry_count: int) -> dict:
    return {'id': b.id, 'source': _v(b.source), 'source_name': b.source_name, 'bank_account': b.bank_account_id,
            'bank_account_name': b.bank_account.name if b.bank_account else None,
            'imported_at': iso(b.imported_at), 'entry_count': entry_count}


# ---------------------------------------------------------------------------
# Reconciliation lists
# ---------------------------------------------------------------------------

def recon_bank_transaction(t: Transaction) -> dict:
    return {
        'id': t.id, 'statement': t.statement_id, 'date': t.date.isoformat(), 'description': t.description,
        'debit': money(t.debit), 'credit': money(t.credit), 'balance': money(t.balance),
        'sub_category': t.sub_category_id, 'is_potential_duplicate': t.is_potential_duplicate,
        'matches': [{
            'id': m.id, 'journal_line': m.journal_line_id, 'entry': m.journal_line.entry_id,
            'entry_number': m.journal_line.entry.entry_number, 'entry_date': m.journal_line.entry.date.isoformat(),
            'narration': m.journal_line.entry.narration, 'debit': money(m.journal_line.debit),
            'credit': money(m.journal_line.credit), 'method': _v(m.method), 'matched_at': iso(m.matched_at),
        } for m in t.reconciliation_matches],
    }


def recon_book_line(l: JournalEntryLine) -> dict:
    m = l.reconciliation_match
    return {
        'id': l.id, 'entry': l.entry_id, 'entry_number': l.entry.entry_number, 'date': l.entry.date.isoformat(),
        'narration': l.entry.narration, 'description': l.description, 'debit': money(l.debit),
        'credit': money(l.credit),
        'match': {
            'id': m.id, 'transaction': m.transaction_id,
            'transaction_date': iso(m.transaction.date) if m.transaction else None,
            'transaction_description': m.transaction.description if m.transaction else None,
            'method': _v(m.method), 'matched_at': iso(m.matched_at),
        } if m else None,
    }


# ---------------------------------------------------------------------------
# Tax rates, products, clients, suppliers
# ---------------------------------------------------------------------------

def tax_rate(t: TaxRate) -> dict:
    return {'id': t.id, 'name': t.name, 'rate': money(t.rate), 'is_active': t.is_active,
            'output_tax_account': t.output_tax_account_id,
            'output_tax_account_name': t.output_tax_account.name if t.output_tax_account else None,
            'input_tax_account': t.input_tax_account_id,
            'input_tax_account_name': t.input_tax_account.name if t.input_tax_account else None}


def product(p: Product) -> dict:
    return {
        'id': p.id, 'code': p.code, 'name': p.name, 'item_type': _v(p.item_type), 'description': p.description,
        'hsn_sac_code': p.hsn_sac_code, 'unit': p.unit, 'sale_price': money(p.sale_price),
        'purchase_price': money(p.purchase_price), 'tax_rate': p.tax_rate_id,
        'tax_rate_name': p.tax_rate.name if p.tax_rate else None,
        'income_account': p.income_account_id, 'income_account_name': p.income_account.name if p.income_account else None,
        'expense_account': p.expense_account_id,
        'expense_account_name': p.expense_account.name if p.expense_account else None,
        'is_active': p.is_active, 'track_inventory': p.track_inventory,
        'reorder_level': f'{p.reorder_level.normalize():f}' if p.reorder_level is not None else None,
    }


def tds_section(t) -> dict:
    return {'id': t.id, 'code': t.code, 'name': t.name, 'rate': money(t.rate),
            'threshold': money(t.threshold) if t.threshold is not None else None,
            'account': t.account_id, 'account_name': t.account.name if t.account else None, 'is_active': t.is_active}


def recurring_invoice(r) -> dict:
    return {
        'id': r.id, 'name': r.name, 'client': r.client_id, 'client_name': r.client.name,
        'frequency': _v(r.frequency), 'start_date': r.start_date.isoformat(), 'next_date': r.next_date.isoformat(),
        'end_date': r.end_date.isoformat() if r.end_date else None, 'items': r.items or [], 'notes': r.notes,
        'auto_post': r.auto_post, 'is_active': r.is_active, 'invoices_created': r.invoices_created,
        'last_error': r.last_error, 'created_by': r.created_by.username if r.created_by else None,
        'created_at': iso(r.created_at),
    }


def _party(p) -> dict:
    return {
        'id': p.id, 'code': p.code, 'name': p.name, 'contact_person': p.contact_person, 'email': p.email,
        'phone': p.phone, 'gstin': p.gstin, 'pan': p.pan, 'state': p.state,
        'payment_terms_days': p.payment_terms_days, 'opening_balance': money(p.opening_balance),
        'opening_balance_date': iso(p.opening_balance_date),
        'is_active': p.is_active, 'created_at': iso(p.created_at),
    }


def client(c: Client, outstanding: Optional[Decimal] = None) -> dict:
    return {**_party(c), 'billing_address': c.billing_address, 'shipping_address': c.shipping_address,
            'receivable_account': c.receivable_account_id,
            'receivable_account_name': c.receivable_account.name if c.receivable_account else None,
            'outstanding': money(outstanding) if outstanding is not None else None}


def supplier(s: Supplier, outstanding: Optional[Decimal] = None) -> dict:
    return {**_party(s), 'address': s.address, 'payable_account': s.payable_account_id,
            'payable_account_name': s.payable_account.name if s.payable_account else None,
            'tds_section': s.tds_section_id, 'tds_section_name': s.tds_section.name if s.tds_section else None,
            'outstanding': money(outstanding) if outstanding is not None else None}


def party_outstanding(db: Session, model, ids: list[int]) -> dict:
    """{party id: opening balance + open document balances - unallocated payments}."""
    from .models import DocumentStatus, PaymentAllocation
    if not ids:
        return {}
    is_client = model is Client
    doc = SalesInvoice if is_client else PurchaseBill
    party_col = SalesInvoice.client_id if is_client else PurchaseBill.supplier_id
    pay_col = Payment.client_id if is_client else Payment.supplier_id
    result = {p.id: p.opening_balance or Decimal('0') for p in db.scalars(select(model).where(model.id.in_(ids)))}
    for pid, due in db.execute(select(party_col, func.sum(doc.balance_due))
                               .where(party_col.in_(ids), doc.status.in_([DocumentStatus.POSTED,
                                                                          DocumentStatus.PARTIALLY_PAID]))
                               .group_by(party_col)):
        result[pid] += Decimal(due or 0)
    allocated = (select(PaymentAllocation.payment_id, func.sum(PaymentAllocation.amount).label('n'))
                 .group_by(PaymentAllocation.payment_id).subquery())
    for pid, unallocated in db.execute(
            select(pay_col, func.sum(Payment.amount - func.coalesce(allocated.c.n, 0)))
            .outerjoin(allocated, allocated.c.payment_id == Payment.id)
            .where(pay_col.in_(ids)).group_by(pay_col)):
        result[pid] -= Decimal(unallocated or 0)
    return result


# ---------------------------------------------------------------------------
# Invoices, bills, payments
# ---------------------------------------------------------------------------

def _item(i) -> dict:
    return {
        'id': i.id, 'product': i.product_id, 'product_name': i.product.name if i.product else None,
        'description': i.description, 'quantity': f'{i.quantity.normalize():f}' if i.quantity is not None else None,
        'unit_price': money(i.unit_price), 'discount_percent': money(i.discount_percent),
        'tax_rate': i.tax_rate_id, 'tax_rate_name': i.tax_rate.name if i.tax_rate else None,
        'tax_percent': money(i.tax_rate.rate) if i.tax_rate else None,
        'amount': money(i.amount), 'tax_amount': money(i.tax_amount), 'line_total': money(i.amount + i.tax_amount),
        'cgst_amount': money(i.cgst_amount), 'sgst_amount': money(i.sgst_amount), 'igst_amount': money(i.igst_amount),
        'hsn_sac_code': i.product.hsn_sac_code if i.product else '', 'unit': i.product.unit if i.product else '',
        'account': i.account_id, 'account_name': i.account.name,
    }


def _gst(doc) -> dict:
    """Place of supply and the document's tax split into CGST / SGST / IGST."""
    total = lambda field: money(sum((getattr(i, field) or Decimal('0') for i in doc.items), Decimal('0')))
    return {'place_of_supply': doc.place_of_supply, 'is_interstate': doc.is_interstate,
            'cgst_amount': total('cgst_amount'), 'sgst_amount': total('sgst_amount'), 'igst_amount': total('igst_amount')}


def _print_party(party, address: str) -> dict:
    """What an invoice / bill prints about the client or supplier."""
    return {'name': party.name, 'gstin': party.gstin or '', 'pan': party.pan, 'address': address, 'state': party.state,
            'email': party.email, 'phone': party.phone, 'contact_person': party.contact_person}


def _allocation(a) -> dict:
    p = a.payment
    return {'id': a.id, 'payment': a.payment_id, 'payment_number': p.payment_number,
            'payment_date': p.payment_date.isoformat(), 'method': _v(p.method), 'amount': money(a.amount)}


def credit_note(n) -> dict:
    doc = n.sales_invoice or n.purchase_bill
    return {
        'id': n.id, 'note_number': n.note_number, 'kind': _v(n.kind),
        'sales_invoice': n.sales_invoice_id, 'purchase_bill': n.purchase_bill_id,
        'document_number': doc.invoice_number if n.sales_invoice else doc.bill_number,
        'party_name': doc.client.name if n.sales_invoice else doc.supplier.name,
        'note_date': n.note_date.isoformat(), 'reason': n.reason, 'subtotal': money(n.subtotal),
        'tax_amount': money(n.tax_amount), 'total': money(n.total), 'status': _v(n.status),
        'journal_entry': n.journal_entry_id,
        'journal_entry_number': n.journal_entry.entry_number if n.journal_entry else None,
        'items': [_item(i) for i in n.items], **_gst(n),
        'party': _print_party(doc.client, doc.client.billing_address) if n.sales_invoice
        else _print_party(doc.supplier, doc.supplier.address),
        'created_by': n.created_by.username if n.created_by else None, 'created_at': iso(n.created_at),
    }


def _note_summary(n) -> dict:
    return {'id': n.id, 'note_number': n.note_number, 'note_date': n.note_date.isoformat(), 'total': money(n.total),
            'status': _v(n.status), 'reason': n.reason}


def sales_invoice(inv: SalesInvoice, detail: bool = True) -> dict:
    data = {
        'id': inv.id, 'invoice_number': inv.invoice_number, 'client': inv.client_id, 'client_name': inv.client.name,
        'invoice_date': inv.invoice_date.isoformat(), 'due_date': inv.due_date.isoformat(),
        'subtotal': money(inv.subtotal), 'tax_amount': money(inv.tax_amount), 'total': money(inv.total),
        'amount_paid': money(inv.amount_paid), 'amount_credited': money(inv.amount_credited),
        'balance_due': money(inv.balance_due), 'status': _v(inv.status),
        'notes': inv.notes, 'journal_entry': inv.journal_entry_id,
        'journal_entry_number': inv.journal_entry.entry_number if inv.journal_entry else None,
        'created_by': inv.created_by.username if inv.created_by else None, 'created_at': iso(inv.created_at),
        'reminder_count': inv.reminder_count or 0, 'last_reminder_at': iso(inv.last_reminder_at),
        'recurring_invoice': inv.recurring_invoice_id,
    }
    if detail:
        data['items'] = [_item(i) for i in inv.items]
        data['payments'] = [_allocation(a) for a in inv.allocations]
        data['credit_notes'] = [_note_summary(n) for n in inv.credit_notes]
        data['party'] = _print_party(inv.client, inv.client.billing_address)
        data.update(_gst(inv))
    else:
        data.update(place_of_supply=inv.place_of_supply, is_interstate=inv.is_interstate)
    return data


def purchase_bill(bill: PurchaseBill, detail: bool = True) -> dict:
    data = {
        'id': bill.id, 'bill_number': bill.bill_number, 'supplier': bill.supplier_id,
        'supplier_name': bill.supplier.name, 'bill_date': bill.bill_date.isoformat(),
        'due_date': bill.due_date.isoformat(), 'subtotal': money(bill.subtotal), 'tax_amount': money(bill.tax_amount),
        'total': money(bill.total), 'amount_paid': money(bill.amount_paid),
        'amount_credited': money(bill.amount_credited), 'balance_due': money(bill.balance_due),
        'status': _v(bill.status), 'notes': bill.notes, 'file': bill.file_path, 'journal_entry': bill.journal_entry_id,
        'tds_section': bill.tds_section_id, 'tds_section_name': bill.tds_section.name if bill.tds_section else None,
        'tds_rate': money(bill.tds_rate), 'tds_amount': money(bill.tds_amount),
        'journal_entry_number': bill.journal_entry.entry_number if bill.journal_entry else None,
        'created_by': bill.created_by.username if bill.created_by else None, 'created_at': iso(bill.created_at),
    }
    if detail:
        data['items'] = [_item(i) for i in bill.items]
        data['payments'] = [_allocation(a) for a in bill.allocations]
        data['credit_notes'] = [_note_summary(n) for n in bill.credit_notes]
        data['party'] = _print_party(bill.supplier, bill.supplier.address)
        data.update(_gst(bill))
    else:
        data.update(place_of_supply=bill.place_of_supply, is_interstate=bill.is_interstate)
    return data


def payment(p: Payment) -> dict:
    allocated = sum((a.amount for a in p.allocations), Decimal('0'))
    party = p.client or p.supplier
    return {
        'id': p.id, 'payment_number': p.payment_number, 'direction': _v(p.direction),
        'client': p.client_id, 'supplier': p.supplier_id, 'party_name': party.name if party else None,
        'payment_date': p.payment_date.isoformat(), 'amount': money(p.amount), 'method': _v(p.method),
        'bank_account': p.bank_account_id, 'bank_account_name': p.bank_account.name if p.bank_account else None,
        'reference_number': p.reference_number, 'notes': p.notes,
        'allocated': money(allocated), 'unallocated': money(p.amount - allocated),
        'allocations': [{
            'id': a.id, 'amount': money(a.amount),
            'sales_invoice': a.sales_invoice_id,
            'invoice_number': a.sales_invoice.invoice_number if a.sales_invoice else None,
            'purchase_bill': a.purchase_bill_id,
            'bill_number': a.purchase_bill.bill_number if a.purchase_bill else None,
        } for a in p.allocations],
        'journal_entry': p.journal_entry_id,
        'journal_entry_number': p.journal_entry.entry_number if p.journal_entry else None,
        'created_by': p.created_by.username if p.created_by else None, 'created_at': iso(p.created_at),
    }


# ---------------------------------------------------------------------------
# AI Assistant
# ---------------------------------------------------------------------------

def ai_message(m) -> dict:
    return {'id': m.id, 'role': m.role, 'content': m.content, 'provider': m.provider, 'tools': m.tools or [],
            'created_at': iso(m.created_at)}


def ai_conversation(c, messages: bool = False) -> dict:
    data = {'id': c.id, 'title': c.title, 'created_at': iso(c.created_at), 'updated_at': iso(c.updated_at)}
    if messages:
        data['messages'] = [ai_message(m) for m in c.messages]
    return data
