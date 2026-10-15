"""Financial reports, built from the journal (the books).

Every report sums journal entry lines by Chart of Accounts account. Lines get into the journal from
manual entries, imports, sales invoices, purchase bills, payments, and bank transactions - a
categorized bank transaction is posted when it is made final (see services.posting), unless it is
already matched to a journal line in Bank Reconciliation.

Bank transactions that are not in the books yet (not posted and not matched) are in no total;
each report says how many there are and their net amount for the same filters, so the user knows
the figures may be incomplete. (The uncategorized_* fields carry that "not in the books" figure.)

The `account_id` filter (a bank account) narrows a report to journal entries with a line on that
bank's GL account.
"""
import calendar
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from ..models import (
    AccountType, BankAccount, Category, JournalEntry, JournalEntryLine, ReconciliationMatch, SubCategory, Transaction,
)
from ..utils import today as _today
from .filters import TXN_NOT_DUPLICATE_COPY, TXN_UNMATCHED, txn_of_account

ZERO = Decimal('0')

PERIOD_THIS_MONTH = 'this_month'
PERIOD_LAST_MONTH = 'last_month'
PERIOD_NEXT_MONTH = 'next_month'  # for lists of dated items, not reports
PERIOD_THIS_QUARTER = 'this_quarter'
PERIOD_THIS_YEAR = 'this_year'  # calendar year, Jan - Dec
PERIOD_THIS_FISCAL_YEAR = 'this_fiscal_year'  # financial year per AccountingSettings.fiscal_year_start_month
PERIOD_LAST_FISCAL_YEAR = 'last_fiscal_year'
PERIOD_CUSTOM = 'custom'
PERIOD_ALL_TIME = 'all_time'
VALID_PERIODS = {
    PERIOD_THIS_MONTH, PERIOD_LAST_MONTH, PERIOD_NEXT_MONTH, PERIOD_THIS_QUARTER, PERIOD_THIS_YEAR,
    PERIOD_THIS_FISCAL_YEAR, PERIOD_LAST_FISCAL_YEAR, PERIOD_CUSTOM, PERIOD_ALL_TIME,
}
DEFAULT_PERIOD = PERIOD_THIS_MONTH


def resolve_period(db: Session, period: Optional[str], date_from: Optional[str],
                   date_to: Optional[str]) -> tuple[str, Optional[str], Optional[str]]:
    """Turns a period preset into a concrete (date_from, date_to) pair from the server's date.
    'custom' passes date_from/date_to through unchanged; 'all_time' applies no date limit."""
    if period not in VALID_PERIODS:
        period = DEFAULT_PERIOD
    if period == PERIOD_CUSTOM:
        return period, date_from or None, date_to or None
    if period == PERIOD_ALL_TIME:
        return period, None, None

    today = _today()
    if period in (PERIOD_THIS_FISCAL_YEAR, PERIOD_LAST_FISCAL_YEAR):
        from .period_close import fiscal_year_bounds
        start, end = fiscal_year_bounds(db, today, years_back=1 if period == PERIOD_LAST_FISCAL_YEAR else 0)
        return period, start.isoformat(), end.isoformat()
    if period == PERIOD_THIS_YEAR:
        return period, date(today.year, 1, 1).isoformat(), date(today.year, 12, 31).isoformat()

    if period == PERIOD_THIS_MONTH:
        start = today.replace(day=1)
        end = today.replace(day=calendar.monthrange(today.year, today.month)[1])
    elif period == PERIOD_LAST_MONTH:
        end = today.replace(day=1) - timedelta(days=1)
        start = end.replace(day=1)
    elif period == PERIOD_NEXT_MONTH:
        start = today.replace(day=calendar.monthrange(today.year, today.month)[1]) + timedelta(days=1)
        end = start.replace(day=calendar.monthrange(start.year, start.month)[1])
    else:  # this_quarter
        q_start = ((today.month - 1) // 3) * 3 + 1
        start = date(today.year, q_start, 1)
        end = date(today.year, q_start + 2, calendar.monthrange(today.year, q_start + 2)[1])
    return period, start.isoformat(), end.isoformat()


def _d(value) -> Optional[date]:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def _type_value(t) -> str:
    return t.value if hasattr(t, 'value') else t


# ---------------------------------------------------------------------------
# Journal line queries
# ---------------------------------------------------------------------------

def _bank_gl(db: Session, account_id) -> Optional[int]:
    if not account_id:
        return None
    return db.scalar(select(BankAccount.gl_account_id).where(BankAccount.id == int(account_id)))


def _line_filters(db: Session, date_from=None, date_to=None, account_id=None) -> list:
    """Conditions on journal lines (joined to their entry) for a period and an optional bank account."""
    where = []
    if date_from:
        where.append(JournalEntry.date >= _d(date_from))
    if date_to:
        where.append(JournalEntry.date <= _d(date_to))
    if account_id:
        gl = _bank_gl(db, account_id)
        if gl:
            where.append(JournalEntryLine.entry_id.in_(
                select(JournalEntryLine.entry_id).where(JournalEntryLine.sub_category_id == gl).correlate(None)))
        else:
            where.append(JournalEntryLine.id.is_(None))  # a bank without a GL account has nothing in the books
    return where


def _lines_from(*columns):
    """A select over journal lines joined to their entry, account and category."""
    return (select(*columns).select_from(JournalEntryLine)
            .join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id)
            .join(SubCategory, JournalEntryLine.sub_category_id == SubCategory.id)
            .join(Category, SubCategory.category_id == Category.id))


def _sums(db: Session, *where) -> tuple[Decimal, Decimal]:
    d, c = db.execute(_lines_from(func.coalesce(func.sum(JournalEntryLine.debit), 0),
                                  func.coalesce(func.sum(JournalEntryLine.credit), 0)).where(*where)).one()
    return Decimal(d), Decimal(c)


def _grouped(db: Session, *where):
    """(account_type, category_id, category_name, sub_category_id, sub_category_name, debit, credit) per account."""
    return db.execute(
        _lines_from(Category.account_type, Category.id, Category.name, SubCategory.id, SubCategory.name,
                    func.sum(JournalEntryLine.debit), func.sum(JournalEntryLine.credit))
        .where(*where)
        .group_by(Category.account_type, Category.id, Category.name, SubCategory.id, SubCategory.name)
        .order_by(Category.account_type, Category.name, SubCategory.name)
    ).all()


def _build_section(db: Session, where: list, account_type: AccountType, credit_normal: bool):
    """[{category_id, category_name, subcategories: [...], total}], grand_total for one account type."""
    categories_by_id: dict = {}
    order = []
    grand_total = ZERO
    for _, cat_id, cat_name, sub_id, sub_name, debit, credit in _grouped(db, *where, Category.account_type == account_type):
        debit, credit = Decimal(debit or 0), Decimal(credit or 0)
        amount = (credit - debit) if credit_normal else (debit - credit)
        if amount == 0:
            continue
        if cat_id not in categories_by_id:
            categories_by_id[cat_id] = {'category_id': cat_id, 'category_name': cat_name, 'subcategories': [], 'total': ZERO}
            order.append(cat_id)
        categories_by_id[cat_id]['subcategories'].append({
            'sub_category_id': sub_id, 'sub_category_name': sub_name, 'amount': amount, 'transactions': [],
        })
        categories_by_id[cat_id]['total'] += amount
        grand_total += amount
    return [categories_by_id[cid] for cid in order], grand_total


def not_in_books(db: Session, date_from=None, date_to=None, account_id=None) -> tuple[int, Decimal, Decimal]:
    """(count, debits, credits) of bank transactions not in the books yet - not posted, not matched to a
    journal line, and not a duplicate copy - for the same filters as a report."""
    where = [TXN_UNMATCHED, TXN_NOT_DUPLICATE_COPY]
    if date_from:
        where.append(Transaction.date >= _d(date_from))
    if date_to:
        where.append(Transaction.date <= _d(date_to))
    if account_id:
        where.append(txn_of_account(int(account_id)))
    n, debit, credit = db.execute(select(func.count(Transaction.id), func.coalesce(func.sum(Transaction.debit), 0),
                                         func.coalesce(func.sum(Transaction.credit), 0)).where(*where)).one()
    return n, Decimal(debit), Decimal(credit)


# ---------------------------------------------------------------------------
# Profit & Loss, Balance Sheet, Trial Balance
# ---------------------------------------------------------------------------

def build_profit_and_loss(db: Session, *, period=None, date_from=None, date_to=None, account_id=None) -> dict:
    where = _line_filters(db, date_from, date_to, account_id)
    income_categories, income_total = _build_section(db, where, AccountType.INCOME, credit_normal=True)
    expense_categories, expense_total = _build_section(db, where, AccountType.EXPENSE, credit_normal=False)
    n, debit, credit = not_in_books(db, date_from, date_to, account_id)
    total_income, total_expenses = abs(income_total), abs(expense_total)
    summary_net = total_income - total_expenses
    return {
        'period': period,
        'date_from': date_from,
        'date_to': date_to,
        'basis': 'journal',
        'income': {'categories': income_categories, 'total': income_total},
        'expense': {'categories': expense_categories, 'total': expense_total},
        'net_profit': income_total - expense_total,
        'summary': {
            'total_income': total_income,
            'total_expenses': total_expenses,
            'net_profit': summary_net,
            'profit_margin': round(summary_net / total_income * 100, 2) if total_income else ZERO,
        },
        # Bank transactions not in the books yet - in no figure above.
        'uncategorized_count': n,
        'uncategorized_net_amount': credit - debit,
        'duplicate_count': 0,
        'duplicate_net_amount': ZERO,
    }


# Words in a category name that put it in the "current" group of its section on the Balance Sheet
# page; every other asset is fixed, every other liability long-term.
CURRENT_ASSET_WORDS = ('current', 'cash', 'bank', 'receivable')
CURRENT_LIABILITY_WORDS = ('current', 'salary', 'salaries', 'payable', 'interest')


def _split_groups(categories, current_words, current_key, other_key) -> dict:
    groups = {current_key: {'category_ids': [], 'total': ZERO}, other_key: {'category_ids': [], 'total': ZERO}}
    for cat in categories:
        name = (cat['category_name'] or '').lower()
        group = groups[current_key if any(w in name for w in current_words) else other_key]
        group['category_ids'].append(cat['category_id'])
        group['total'] += Decimal(str(cat['total']))
    return groups


def build_balance_sheet(db: Session, *, period=None, date_from=None, date_to=None, account_id=None) -> dict:
    """Balances as of date_to (everything posted up to then). Retained earnings = all income minus all
    expenses up to date_to, so assets always equal liabilities plus equity."""
    where = _line_filters(db, None, date_to, account_id)
    assets_categories, assets_total = _build_section(db, where, AccountType.ASSET, credit_normal=False)
    liabilities_categories, liabilities_total = _build_section(db, where, AccountType.LIABILITY, credit_normal=True)
    equity_categories, equity_total = _build_section(db, where, AccountType.EQUITY, credit_normal=True)
    retained_earnings = build_profit_and_loss(db, period=period, date_from=None, date_to=date_to,
                                              account_id=account_id)['net_profit']
    total_equity = equity_total + retained_earnings
    total_liabilities_and_equity = liabilities_total + total_equity
    n, debit, credit = not_in_books(db, None, date_to, account_id)
    return {
        'period': period,
        'date_from': date_from,
        'date_to': date_to,
        'basis': 'journal',
        'assets': {'categories': assets_categories, 'total': assets_total},
        'liabilities': {'categories': liabilities_categories, 'total': liabilities_total},
        'equity': {'categories': equity_categories, 'total': equity_total},
        'retained_earnings': retained_earnings,
        'total_equity': total_equity,
        'total_assets': assets_total,
        'total_liabilities_and_equity': total_liabilities_and_equity,
        'difference': assets_total - total_liabilities_and_equity,
        'is_balanced': assets_total == total_liabilities_and_equity,
        'groups': {
            **_split_groups(assets_categories, CURRENT_ASSET_WORDS, 'current_assets', 'fixed_assets'),
            **_split_groups(liabilities_categories, CURRENT_LIABILITY_WORDS, 'current_liabilities', 'long_term_liabilities'),
        },
        'uncategorized_count': n,
        'uncategorized_net_amount': credit - debit,
    }


def build_trial_balance(db: Session, *, period=None, date_from=None, date_to=None, account_id=None) -> dict:
    """Each account's net balance for the period - on the debit side for a debit balance, the credit side
    for a credit balance. Total debits always equal total credits, because every entry balances."""
    where = _line_filters(db, date_from, date_to, account_id)
    account_types = {t.value: [] for t in AccountType}
    type_totals = {t: {'debit': ZERO, 'credit': ZERO} for t in account_types}
    grand_debit = grand_credit = ZERO
    for acct_type, cat_id, cat_name, sub_id, sub_name, debit, credit in _grouped(db, *where):
        key = _type_value(acct_type)
        net = Decimal(debit or 0) - Decimal(credit or 0)
        if net == 0:
            continue
        dr, cr = (net, ZERO) if net > 0 else (ZERO, -net)
        grand_debit += dr
        grand_credit += cr
        type_totals[key]['debit'] += dr
        type_totals[key]['credit'] += cr
        account_types[key].append({'category_id': cat_id, 'category_name': cat_name, 'sub_category_id': sub_id,
                                   'sub_category_name': sub_name, 'debit': dr, 'credit': cr})
    n, debit, credit = not_in_books(db, date_from, date_to, account_id)
    return {
        'period': period,
        'date_from': date_from,
        'date_to': date_to,
        'basis': 'journal',
        'account_types': account_types,
        'type_totals': type_totals,
        'total_debit': grand_debit,
        'total_credit': grand_credit,
        'difference': abs(grand_debit - grand_credit),
        'is_balanced': grand_debit == grand_credit,
        'uncategorized_count': n,
        'uncategorized_debit': debit,
        'uncategorized_credit': credit,
    }


# ---------------------------------------------------------------------------
# Account ledger
# ---------------------------------------------------------------------------

DEBIT_NORMAL_TYPES = (AccountType.ASSET, AccountType.EXPENSE)


def _to_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


class AccountNotFound(Exception):
    pass


def _statements_of_entries(db: Session, entry_ids: list[int]) -> dict:
    """{entry id: bank statement id} for entries matched to a bank transaction (to link a row to it)."""
    if not entry_ids:
        return {}
    rows = db.execute(select(JournalEntryLine.entry_id, Transaction.statement_id)
                      .join(ReconciliationMatch, ReconciliationMatch.journal_line_id == JournalEntryLine.id)
                      .join(Transaction, ReconciliationMatch.transaction_id == Transaction.id)
                      .where(JournalEntryLine.entry_id.in_(entry_ids))).all()
    return {entry_id: stmt for entry_id, stmt in rows}


def build_account_ledger(db: Session, *, sub_category_id=None, category_id=None, period=None, date_from=None,
                         date_to=None, account_id=None, page=1, page_size=50) -> dict:
    """Every journal line posted to one account (a sub-category, or a whole category), oldest first, with
    a running balance on the account's normal side. The opening balance is everything posted before
    date_from. Rows are paged; a page's running balance carries on from the rows before it."""
    if sub_category_id:
        sub = db.get(SubCategory, _to_int(sub_category_id, 0))
        if not sub:
            raise AccountNotFound()
        category = sub.category
        where = [JournalEntryLine.sub_category_id == sub.id]
        account = {'kind': 'sub_category', 'id': sub.id, 'code': sub.code, 'name': sub.name}
    else:
        category = db.get(Category, _to_int(category_id, 0))
        if not category:
            raise AccountNotFound()
        where = [SubCategory.category_id == category.id]
        account = {'kind': 'category', 'id': category.id, 'code': category.code, 'name': category.name}
    account.update(category_id=category.id, category_name=category.name, account_type=category.account_type.value)
    debit_normal = category.account_type in DEBIT_NORMAL_TYPES
    sign = Decimal('1') if debit_normal else Decimal('-1')

    where += _line_filters(db, None, None, account_id)
    opening = ZERO
    if date_from:
        d, c = _sums(db, *where, JournalEntry.date < _d(date_from))
        opening = sign * (d - c)
        where.append(JournalEntry.date >= _d(date_from))
    if date_to:
        where.append(JournalEntry.date <= _d(date_to))

    order = (JournalEntry.date, JournalEntry.id, JournalEntryLine.id)
    amounts = db.execute(_lines_from(JournalEntryLine.debit, JournalEntryLine.credit).where(*where).order_by(*order)).all()
    total_debit = sum((d for d, _ in amounts), ZERO)
    total_credit = sum((c for _, c in amounts), ZERO)
    closing = opening + sign * (total_debit - total_credit)

    count = len(amounts)
    page_size = max(1, min(_to_int(page_size, 50), 5000))
    pages = max(1, -(-count // page_size))
    page = max(1, min(_to_int(page, 1), pages))
    offset = (page - 1) * page_size
    running = opening + sign * sum((d - c for d, c in amounts[:offset]), ZERO)

    page_rows = db.execute(_lines_from(JournalEntryLine, JournalEntry, SubCategory)
                           .where(*where).order_by(*order).offset(offset).limit(page_size)).all()
    statements = _statements_of_entries(db, [e.id for _, e, _ in page_rows])
    rows = []
    for line, entry, sub in page_rows:
        running += sign * (line.debit - line.credit)
        rows.append({
            'id': line.id,
            'entry_id': entry.id,
            'entry_number': entry.entry_number,
            'date': entry.date.isoformat(),
            'description': line.description or entry.narration,
            'narration': entry.narration,
            'source': entry.origin or 'IMPORT',
            # The page's "Bank account" column shows the voucher the line belongs to.
            'bank_account': entry.entry_number,
            'statement_id': statements.get(entry.id),
            'sub_category_name': sub.name,
            'debit': line.debit,
            'credit': line.credit,
            'balance': running,
            'is_final': False,
        })

    return {
        'period': period, 'date_from': date_from, 'date_to': date_to,
        'basis': 'journal',
        'account': account,
        'normal_balance': 'DEBIT' if debit_normal else 'CREDIT',
        'opening_balance': opening,
        'total_debit': total_debit,
        'total_credit': total_credit,
        'closing_balance': closing,
        'count': count, 'page': page, 'pages': pages, 'page_size': page_size,
        'rows': rows,
    }


# ---------------------------------------------------------------------------
# Cash flow (direct method, from the journal)
# ---------------------------------------------------------------------------

CASH_FLOW_SECTIONS = (
    ('operating', 'Operating Activities', (AccountType.INCOME, AccountType.EXPENSE)),
    ('investing', 'Investing Activities', (AccountType.ASSET,)),
    ('financing', 'Financing Activities', (AccountType.LIABILITY, AccountType.EQUITY)),
)


def cash_account_ids(db: Session, account_id=None) -> set[int]:
    """The accounts that hold money: every bank account's GL account plus the cash account - or just the
    chosen bank's GL account."""
    if account_id:
        gl = _bank_gl(db, account_id)
        return {gl} if gl else set()
    ids = set(db.scalars(select(BankAccount.gl_account_id).where(BankAccount.gl_account_id.is_not(None))).all())
    from .settings import accounting_settings
    cash_id = accounting_settings(db).default_cash_account_id or db.scalar(
        select(SubCategory.id).where(func.lower(SubCategory.name) == 'cash'))
    if cash_id:
        ids.add(cash_id)
    return ids


def build_cash_flow(db: Session, *, period=None, date_from=None, date_to=None, account_id=None) -> dict:
    """Money in and out of the bank and cash accounts, grouped by the account on the other side of each
    journal entry: income and expense accounts are operating activities, other assets investing,
    liabilities and equity financing. Entries that only move money between the company's own bank /
    cash accounts are transfers. The sections add up to the change in the cash balance."""
    cash_ids = cash_account_ids(db, account_id)
    rows = []
    if cash_ids:
        cash_entries = (select(JournalEntryLine.entry_id)
                        .where(JournalEntryLine.sub_category_id.in_(cash_ids)).correlate(None))
        rows = db.execute(_lines_from(
            JournalEntryLine.entry_id, JournalEntryLine.sub_category_id, JournalEntryLine.debit, JournalEntryLine.credit,
            Category.account_type, Category.id, Category.name, SubCategory.name)
            .where(*_line_filters(db, date_from, date_to, None), JournalEntryLine.entry_id.in_(cash_entries))).all()

    by_entry = defaultdict(list)
    for row in rows:
        by_entry[row[0]].append(row)
    per_account: dict = {}
    transfers_count = 0
    for lines in by_entry.values():
        counter = [l for l in lines if l[1] not in cash_ids]
        if not counter:
            transfers_count += 1  # money moved between own accounts only
            continue
        for _, sub_id, debit, credit, acct_type, cat_id, cat_name, sub_name in counter:
            if sub_id not in per_account:
                per_account[sub_id] = {'category_id': cat_id, 'category_name': cat_name,
                                       'account_type': _type_value(acct_type), 'sub_category_id': sub_id,
                                       'sub_category_name': sub_name, 'inflow': ZERO, 'outflow': ZERO}
            # The other side of a cash entry: a credit there is money coming in, a debit money going out.
            per_account[sub_id]['inflow'] += credit
            per_account[sub_id]['outflow'] += debit

    sections = []
    for key, label, types in CASH_FLOW_SECTIONS:
        type_values = {t.value for t in types}
        lines = sorted((dict(v, net=v['inflow'] - v['outflow']) for v in per_account.values()
                        if v['account_type'] in type_values),
                       key=lambda v: (v['account_type'], v['category_name'], v['sub_category_name']))
        inflow = sum((l['inflow'] for l in lines), ZERO)
        outflow = sum((l['outflow'] for l in lines), ZERO)
        sections.append({'key': key, 'label': label, 'lines': lines, 'inflow': inflow, 'outflow': outflow,
                         'net': inflow - outflow})

    net_change = sum((s['net'] for s in sections), ZERO)
    opening_cash = ZERO
    if cash_ids and date_from:
        d, c = _sums(db, JournalEntryLine.sub_category_id.in_(cash_ids), JournalEntry.date < _d(date_from))
        opening_cash = d - c
    n, debit, credit = not_in_books(db, date_from, date_to, account_id)
    return {
        'period': period, 'date_from': date_from, 'date_to': date_to,
        'basis': 'journal',
        'sections': sections,
        'transfers_net': ZERO,
        'transfers_count': transfers_count,
        # Bank transactions not in the books yet - not part of the figures above.
        'uncategorized_net': credit - debit,
        'uncategorized_count': n,
        'net_change': net_change,
        'opening_cash': opening_cash,
        'closing_cash': opening_cash + net_change,
    }


# ---------------------------------------------------------------------------
# Report drill-down
# ---------------------------------------------------------------------------

def line_items(db: Session, date_from, date_to, account_id, category_id, sub_category_id, as_of: bool):
    """A select of the journal lines behind one report line, newest first.
    as_of: everything up to date_to (a Balance Sheet balance), not just the period."""
    where = _line_filters(db, None if as_of else date_from, date_to, account_id)
    if category_id:
        where.append(SubCategory.category_id == int(category_id))
    if sub_category_id:
        where.append(JournalEntryLine.sub_category_id == int(sub_category_id))
    return (_lines_from(JournalEntryLine).where(*where)
            .options(joinedload(JournalEntryLine.entry), joinedload(JournalEntryLine.sub_category).joinedload(SubCategory.category))
            .order_by(JournalEntry.date.desc(), JournalEntry.id.desc(), JournalEntryLine.id))
