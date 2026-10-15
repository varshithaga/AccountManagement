"""Financial reports built from the categorized bank transactions.

Only categorized transactions can be placed on a report (an uncategorized row could be
either income or an expense), so each report also says how many / how much is still
uncategorized for the same filters.

Excluded from every total:
- duplicate copies (Transaction.duplicate_of set) - only the copy, never the original;
- transfers between the company's own bank accounts (status=TRANSFER) - neither income
  nor expense, and never counted as uncategorized;
- NEEDS_REVIEW rows - their category is only a suggestion until a human confirms it,
  so they're counted with the uncategorized rows.
"""
import calendar
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from ..models import AccountType, BankStatement, Category, SubCategory, Transaction
from ..utils import today as _today
from .filters import (
    TXN_IS_TRANSFER, TXN_NOT_DUPLICATE_COPY, TXN_NOT_REVIEW, TXN_NOT_TRANSFER, TXN_REPORTABLE, TXN_UNREPORTED,
    txn_of_account,
)

UNCATEGORIZED_SUBCATEGORY_LABEL = 'Uncategorized (category only)'
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


def _base_filters(date_from=None, date_to=None, account_id=None) -> list:
    where = []
    if date_from:
        where.append(Transaction.date >= _d(date_from))
    if date_to:
        where.append(Transaction.date <= _d(date_to))
    if account_id:
        where.append(txn_of_account(int(account_id)))
    return where


def _totals(db: Session, *where) -> tuple[Decimal, Decimal, int]:
    debit, credit, n = db.execute(select(func.coalesce(func.sum(Transaction.debit), 0),
                                         func.coalesce(func.sum(Transaction.credit), 0),
                                         func.count(Transaction.id)).where(*where)).one()
    return Decimal(debit), Decimal(credit), n


def _grouped(db: Session, *where):
    """Rows of (account_type, category_id, category_name, sub_category_id, sub_category_name, debit, credit)."""
    return db.execute(
        select(Category.account_type, Category.id, Category.name, SubCategory.id, SubCategory.name,
               func.sum(Transaction.debit), func.sum(Transaction.credit))
        .select_from(Transaction)
        .join(Category, Transaction.category_id == Category.id)
        .outerjoin(SubCategory, Transaction.sub_category_id == SubCategory.id)
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
        if cat_id not in categories_by_id:
            categories_by_id[cat_id] = {'category_id': cat_id, 'category_name': cat_name, 'subcategories': [], 'total': ZERO}
            order.append(cat_id)
        categories_by_id[cat_id]['subcategories'].append({
            'sub_category_id': sub_id,
            'sub_category_name': sub_name or UNCATEGORIZED_SUBCATEGORY_LABEL,
            'amount': amount,
            'transactions': [],
        })
        categories_by_id[cat_id]['total'] += amount
        grand_total += amount
    return [categories_by_id[cid] for cid in order], grand_total


def build_profit_and_loss(db: Session, *, period=None, date_from=None, date_to=None, account_id=None) -> dict:
    base = _base_filters(date_from, date_to, account_id)
    dup_debit, dup_credit, dup_count = _totals(db, *base, Transaction.duplicate_of_id.is_not(None))
    reportable = base + [TXN_REPORTABLE]
    income_categories, income_total = _build_section(db, reportable, AccountType.INCOME, credit_normal=True)
    expense_categories, expense_total = _build_section(db, reportable, AccountType.EXPENSE, credit_normal=False)
    unc_debit, unc_credit, unc_count = _totals(db, *base, TXN_NOT_DUPLICATE_COPY, TXN_UNREPORTED)

    total_income, total_expenses = abs(income_total), abs(expense_total)
    summary_net = total_income - total_expenses
    return {
        'period': period,
        'date_from': date_from,
        'date_to': date_to,
        'income': {'categories': income_categories, 'total': income_total},
        'expense': {'categories': expense_categories, 'total': expense_total},
        'net_profit': income_total - expense_total,
        'summary': {
            'total_income': total_income,
            'total_expenses': total_expenses,
            'net_profit': summary_net,
            'profit_margin': round(summary_net / total_income * 100, 2) if total_income else ZERO,
        },
        'uncategorized_count': unc_count,
        'uncategorized_net_amount': unc_credit - unc_debit,
        'duplicate_count': dup_count,
        'duplicate_net_amount': dup_credit - dup_debit,
    }


# Words in a category name that put it in the "current" group of its section on the Balance
# Sheet page; every other asset is fixed, every other liability long-term.
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
    base = _base_filters(None, date_to, account_id)
    reportable = base + [TXN_REPORTABLE]
    assets_categories, assets_total = _build_section(db, reportable, AccountType.ASSET, credit_normal=False)
    liabilities_categories, liabilities_total = _build_section(db, reportable, AccountType.LIABILITY, credit_normal=True)
    equity_categories, equity_total = _build_section(db, reportable, AccountType.EQUITY, credit_normal=True)

    retained_earnings = build_profit_and_loss(db, period=period, date_from=None, date_to=date_to,
                                              account_id=account_id)['net_profit']
    total_equity = equity_total + retained_earnings
    total_liabilities_and_equity = liabilities_total + total_equity
    unc_debit, unc_credit, unc_count = _totals(db, *base, TXN_NOT_DUPLICATE_COPY, TXN_UNREPORTED)

    return {
        'period': period,
        'date_from': date_from,
        'date_to': date_to,
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
        'uncategorized_count': unc_count,
        'uncategorized_net_amount': unc_credit - unc_debit,
    }


def build_trial_balance(db: Session, *, period=None, date_from=None, date_to=None, account_id=None) -> dict:
    base = _base_filters(date_from, date_to, account_id)
    account_types = {t.value: [] for t in AccountType}
    type_totals = {t: {'debit': ZERO, 'credit': ZERO} for t in account_types}
    grand_debit = grand_credit = ZERO

    for acct_type, cat_id, cat_name, sub_id, sub_name, debit, credit in _grouped(db, *base, TXN_REPORTABLE):
        key = acct_type.value if hasattr(acct_type, 'value') else acct_type
        debit, credit = Decimal(debit or 0), Decimal(credit or 0)
        grand_debit += debit
        grand_credit += credit
        type_totals[key]['debit'] += debit
        type_totals[key]['credit'] += credit
        account_types[key].append({
            'category_id': cat_id, 'category_name': cat_name,
            'sub_category_id': sub_id, 'sub_category_name': sub_name or UNCATEGORIZED_SUBCATEGORY_LABEL,
            'debit': debit, 'credit': credit,
        })

    unc_debit, unc_credit, unc_count = _totals(db, *base, TXN_NOT_DUPLICATE_COPY, TXN_UNREPORTED)
    return {
        'period': period,
        'date_from': date_from,
        'date_to': date_to,
        'account_types': account_types,
        'type_totals': type_totals,
        'total_debit': grand_debit,
        'total_credit': grand_credit,
        'difference': abs(grand_debit - grand_credit),
        'is_balanced': grand_debit == grand_credit,
        'uncategorized_count': unc_count,
        'uncategorized_debit': unc_debit,
        'uncategorized_credit': unc_credit,
    }


DEBIT_NORMAL_TYPES = (AccountType.ASSET, AccountType.EXPENSE)


def _to_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


class AccountNotFound(Exception):
    pass


def build_account_ledger(db: Session, *, sub_category_id=None, category_id=None, period=None, date_from=None,
                         date_to=None, account_id=None, page=1, page_size=50) -> dict:
    """Every reportable transaction posted to one account (a sub-category, or a whole category),
    oldest first, with a running balance on the account's normal side. The opening balance is
    everything posted before date_from. Rows are paged; a page's running balance carries on
    from the rows before it."""
    if sub_category_id:
        sub = db.get(SubCategory, _to_int(sub_category_id, 0))
        if not sub:
            raise AccountNotFound()
        category = sub.category
        where = [Transaction.sub_category_id == sub.id]
        account = {'kind': 'sub_category', 'id': sub.id, 'code': sub.code, 'name': sub.name}
    else:
        category = db.get(Category, _to_int(category_id, 0))
        if not category:
            raise AccountNotFound()
        where = [Transaction.category_id == category.id]
        account = {'kind': 'category', 'id': category.id, 'code': category.code, 'name': category.name}
    account.update(category_id=category.id, category_name=category.name, account_type=category.account_type.value)
    debit_normal = category.account_type in DEBIT_NORMAL_TYPES
    sign = Decimal('1') if debit_normal else Decimal('-1')

    where.append(TXN_REPORTABLE)
    if account_id:
        where.append(txn_of_account(int(account_id)))

    opening = ZERO
    if date_from:
        d, c, _ = _totals(db, *where, Transaction.date < _d(date_from))
        opening = sign * (d - c)
        where.append(Transaction.date >= _d(date_from))
    if date_to:
        where.append(Transaction.date <= _d(date_to))

    order = (Transaction.date, Transaction.id)
    amounts = db.execute(select(Transaction.debit, Transaction.credit).where(*where).order_by(*order)).all()
    total_debit = sum((d for d, _ in amounts), ZERO)
    total_credit = sum((c for _, c in amounts), ZERO)
    closing = opening + sign * (total_debit - total_credit)

    count = len(amounts)
    page_size = max(1, min(_to_int(page_size, 50), 5000))
    pages = max(1, -(-count // page_size))
    page = max(1, min(_to_int(page, 1), pages))
    offset = (page - 1) * page_size
    running = opening + sign * sum((d - c for d, c in amounts[:offset]), ZERO)

    rows = []
    txns = db.scalars(select(Transaction).where(*where).order_by(*order).offset(offset).limit(page_size)
                      .options(joinedload(Transaction.statement).joinedload(BankStatement.account),
                               joinedload(Transaction.sub_category))).all()
    for t in txns:
        running += sign * (t.debit - t.credit)
        rows.append({
            'id': t.id,
            'date': t.date.isoformat(),
            'description': t.description,
            'bank_account': t.statement.account.name,
            'statement_id': t.statement_id,
            'sub_category_name': t.sub_category.name if t.sub_category else UNCATEGORIZED_SUBCATEGORY_LABEL,
            'debit': t.debit,
            'credit': t.credit,
            'balance': running,
            'is_final': t.is_final,
        })

    return {
        'period': period, 'date_from': date_from, 'date_to': date_to,
        'account': account,
        'normal_balance': 'DEBIT' if debit_normal else 'CREDIT',
        'opening_balance': opening,
        'total_debit': total_debit,
        'total_credit': total_credit,
        'closing_balance': closing,
        'count': count, 'page': page, 'pages': pages, 'page_size': page_size,
        'rows': rows,
    }


CASH_FLOW_SECTIONS = (
    ('operating', 'Operating Activities', (AccountType.INCOME, AccountType.EXPENSE)),
    ('investing', 'Investing Activities', (AccountType.ASSET,)),
    ('financing', 'Financing Activities', (AccountType.LIABILITY, AccountType.EQUITY)),
)


def _opening_cash(db: Session, account_id, date_from) -> Decimal:
    """Cash in the bank before date_from: each account's opening balance on the statement holding
    its earliest transaction, plus every bank movement before date_from (duplicate copies left out)."""
    where = [TXN_NOT_DUPLICATE_COPY]
    if account_id:
        where.append(txn_of_account(int(account_id)))
    first_statement = {}
    for acct, stmt_id in db.execute(select(BankStatement.account_id, Transaction.statement_id)
                                    .join(BankStatement, Transaction.statement_id == BankStatement.id)
                                    .where(*where).order_by(Transaction.date, Transaction.id)):
        first_statement.setdefault(acct, stmt_id)
    total = sum((b or ZERO for b in db.scalars(select(BankStatement.opening_balance)
                                               .where(BankStatement.id.in_(first_statement.values())))), ZERO)
    if date_from:
        d, c, _ = _totals(db, *where, Transaction.date < _d(date_from))
        total += c - d
    return total


def build_cash_flow(db: Session, *, period=None, date_from=None, date_to=None, account_id=None) -> dict:
    """Cash Flow Statement (direct method) from the bank transactions: money in (credits) and out
    (debits) grouped by what they were categorized as - income and expense accounts are operating,
    assets investing, liabilities and equity financing. Transfers and uncategorized rows get lines
    of their own, so everything adds up to the actual change in the bank balance."""
    base = _base_filters(date_from, date_to, account_id) + [TXN_NOT_DUPLICATE_COPY]
    sections = []
    for key, label, types in CASH_FLOW_SECTIONS:
        lines = []
        inflow_total = outflow_total = ZERO
        for acct_type, cat_id, cat_name, sub_id, sub_name, debit, credit in _grouped(
                db, *base, TXN_REPORTABLE, Category.account_type.in_(types)):
            inflow, outflow = Decimal(credit or 0), Decimal(debit or 0)
            inflow_total += inflow
            outflow_total += outflow
            lines.append({
                'category_id': cat_id, 'category_name': cat_name,
                'account_type': acct_type.value if hasattr(acct_type, 'value') else acct_type,
                'sub_category_id': sub_id, 'sub_category_name': sub_name or UNCATEGORIZED_SUBCATEGORY_LABEL,
                'inflow': inflow, 'outflow': outflow, 'net': inflow - outflow,
            })
        sections.append({'key': key, 'label': label, 'lines': lines, 'inflow': inflow_total,
                         'outflow': outflow_total, 'net': inflow_total - outflow_total})

    t_debit, t_credit, t_count = _totals(db, *base, TXN_IS_TRANSFER)
    u_debit, u_credit, u_count = _totals(db, *base, TXN_UNREPORTED)
    transfers_net, uncategorized_net = t_credit - t_debit, u_credit - u_debit
    net_change = sum((s['net'] for s in sections), ZERO) + transfers_net + uncategorized_net
    opening_cash = _opening_cash(db, account_id, date_from)
    return {
        'period': period, 'date_from': date_from, 'date_to': date_to,
        'sections': sections,
        'transfers_net': transfers_net, 'transfers_count': t_count,
        'uncategorized_net': uncategorized_net, 'uncategorized_count': u_count,
        'net_change': net_change,
        'opening_cash': opening_cash,
        'closing_cash': opening_cash + net_change,
    }


def line_item_filters(date_from, date_to, account_id, category_id, sub_category_id, as_of: bool) -> list:
    """The rows behind one report line (no duplicates, transfers or rows still in review)."""
    where = [TXN_NOT_DUPLICATE_COPY, TXN_NOT_TRANSFER, TXN_NOT_REVIEW]
    where += _base_filters(None if as_of else date_from, date_to, account_id)
    if category_id:
        where.append(Transaction.category_id == int(category_id))
    if sub_category_id:
        where.append(Transaction.sub_category_id == int(sub_category_id))
    return where
