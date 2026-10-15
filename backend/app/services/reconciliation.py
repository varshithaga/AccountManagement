"""
Bank reconciliation - agrees a bank account's statement transactions with the
journal lines booked to that account's GL account (BankAccount.gl_account).

Sides: a bank withdrawal (Transaction.debit) is a credit to the bank's GL
account in the books; a deposit (Transaction.credit) is a debit.

Reconciliation statement as of a date:
    Balance per bank statement
      + deposits in transit     (book debit lines not yet on the statement)
      - outstanding payments    (book credit lines not yet on the statement)
      = adjusted bank balance
    Balance per books (debits - credits on the GL account)
      + bank deposits not in books
      - bank withdrawals not in books
      = adjusted book balance
    The account is reconciled when the two adjusted balances agree.

Matching is account-wide (a cheque booked in March can clear in April); a period
(month, statement or date range) only chooses what is shown and what is signed off.
A month is signed off with close_month() once its difference is zero - see
ReconciliationPeriod for what that locks.
"""
import calendar
import re
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy import and_, delete, exists, func, or_, select
from sqlalchemy.orm import Session, aliased, joinedload

from ..models import (
    BankAccount, BankStatement, JournalEntry, JournalEntryLine, MatchMethod, ReconciliationMatch,
    ReconciliationPeriod, Transaction, User,
)
from ..utils import today as _today
from .filters import LINE_UNMATCHED, TXN_MATCHED, TXN_UNMATCHED, txn_of_account
from .settings import reconciliation_settings

ZERO = Decimal('0.00')
_TOKEN_RE = re.compile(r'[A-Z0-9]{3,}')


class ReconciliationError(Exception):
    pass


class UnmatchConfirmationRequired(ReconciliationError):
    """The change would delete reconciliation matches - the caller must confirm (confirm_unmatch=true)."""

    def __init__(self, message, reconciled):
        super().__init__(message)
        self.reconciled = reconciled


def bank_txn_filter(account: BankAccount):
    return txn_of_account(account.id)


def book_line_filter(account: BankAccount):
    """Journal lines booked to the bank account's GL account (none if it isn't linked)."""
    if not account.gl_account_id:
        return JournalEntryLine.id.is_(None)  # never true
    return JournalEntryLine.sub_category_id == account.gl_account_id


def _tokens(*texts) -> set:
    return set(_TOKEN_RE.findall(' '.join(t or '' for t in texts).upper()))


def _require_gl_account(account: BankAccount) -> None:
    if not account.gl_account_id:
        raise ReconciliationError(
            f'Bank account "{account.name}" is not linked to a Chart of Accounts account yet - '
            'set its GL account first so its journal lines can be found.'
        )


def locked_through(db: Session, account: BankAccount) -> Optional[date]:
    """Last day of the latest signed-off month, or None when no month is closed."""
    return db.scalar(select(func.max(ReconciliationPeriod.period_end))
                     .where(ReconciliationPeriod.bank_account_id == account.id))


def locks_by_account(db: Session) -> dict:
    """{bank account id: last signed-off day} for every account with a signed-off month."""
    rows = db.execute(select(ReconciliationPeriod.bank_account_id, func.max(ReconciliationPeriod.period_end))
                      .group_by(ReconciliationPeriod.bank_account_id)).all()
    return {account_id: end for account_id, end in rows}


def _plural(n, word):
    return f'{n} {word}{"" if n == 1 else "s"}'


def _count(db: Session, stmt) -> int:
    return db.scalar(select(func.count()).select_from(stmt.subquery())) or 0


# ---------------------------------------------------------------------------
# Guards for changes made outside Bank Reconciliation (edit / delete / re-parse / import)
# ---------------------------------------------------------------------------

def guard_bank_transactions(db: Session, txn_ids: list[int], confirm_unmatch: bool = False) -> None:
    """Before deleting or re-creating the bank transactions `txn_ids`: refuses when any is dated in a
    signed-off month of its account, and asks for confirmation when any is reconciled
    (deleting it deletes its matches)."""
    if not txn_ids:
        return
    locks = locks_by_account(db)
    if locks:
        in_closed = or_(*[and_(txn_of_account(account_id), Transaction.date <= end) for account_id, end in locks.items()])
        n = _count(db, select(Transaction.id).where(Transaction.id.in_(txn_ids), in_closed))
        if n:
            raise ReconciliationError(
                f'{_plural(n, "bank transaction")} {"is" if n == 1 else "are"} dated in a month already signed off '
                'as reconciled - reopen that month in Bank Reconciliation first.'
            )
    n = _count(db, select(Transaction.id).where(Transaction.id.in_(txn_ids), TXN_MATCHED))
    if n and not confirm_unmatch:
        raise UnmatchConfirmationRequired(
            f'{_plural(n, "bank transaction")} {"is" if n == 1 else "are"} reconciled - continuing removes '
            f'{"its" if n == 1 else "their"} reconciliation match{"" if n == 1 else "es"} and the journal lines '
            'become outstanding again.', n,
        )


def guard_bank_transaction_date(db: Session, account_id: int, *dates) -> None:
    """Refuses creating a bank transaction on, or moving one to or from, a date in a signed-off month."""
    end = locks_by_account(db).get(account_id)
    if end and any(d and d <= end for d in dates):
        raise ReconciliationError(
            f'This bank account is signed off as reconciled through {end:%d %b %Y} - '
            'reopen that month in Bank Reconciliation to change transactions dated in it.'
        )


def bank_gl_locks(db: Session) -> dict:
    """{GL sub-category id: (last signed-off day, bank account name)} for bank accounts with a signed-off month."""
    locks = locks_by_account(db)
    if not locks:
        return {}
    accounts = db.scalars(select(BankAccount).where(BankAccount.id.in_(locks), BankAccount.gl_account_id.is_not(None))).all()
    return {a.gl_account_id: (locks[a.id], a.name) for a in accounts}


def journal_lock_error(entry_date: date, sub_category_ids, gl_locks: dict) -> Optional[str]:
    """The message when an entry dated entry_date with lines on sub_category_ids would change a
    signed-off month of a bank account (its GL account among the lines), else None."""
    for sub_id in sub_category_ids:
        if sub_id in gl_locks and entry_date <= gl_locks[sub_id][0]:
            end, name = gl_locks[sub_id]
            return (f'is dated on or before {end:%d %b %Y}, and {name} is signed off as reconciled through then - '
                    'reopen that month in Bank Reconciliation first')
    return None


def guard_journal_entries(db: Session, entry_ids: list[int], confirm_unmatch: bool = False) -> None:
    """Before deleting the journal entries `entry_ids`: refuses when any has a bank line in a
    signed-off month, and asks for confirmation when any bank line is reconciled."""
    if not entry_ids:
        return
    gl_locks = bank_gl_locks(db)
    if gl_locks:
        in_closed = or_(*[and_(JournalEntryLine.sub_category_id == gl_id, JournalEntry.date <= end)
                          for gl_id, (end, _) in gl_locks.items()])
        locked = db.execute(
            select(JournalEntryLine, JournalEntry).join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id)
            .where(in_closed, JournalEntry.id.in_(entry_ids)).limit(1)
        ).first()
        if locked:
            line, entry = locked
            raise ReconciliationError(f'Entry {entry.entry_number} '
                                      + journal_lock_error(entry.date, [line.sub_category_id], gl_locks) + '.')
    matched = (select(ReconciliationMatch.method)
               .join(JournalEntryLine, ReconciliationMatch.journal_line_id == JournalEntryLine.id)
               .where(JournalEntryLine.entry_id.in_(entry_ids)))
    methods = db.scalars(matched).all()
    n_opening = sum(1 for m in methods if m == MatchMethod.OPENING)
    n_bank = len(methods) - n_opening
    if (n_bank or n_opening) and not confirm_unmatch:
        parts = []
        if n_bank:
            parts.append(
                f'{_plural(n_bank, "journal line")} {"is" if n_bank == 1 else "are"} reconciled with bank transactions - '
                f'continuing removes {"its" if n_bank == 1 else "their"} match{"" if n_bank == 1 else "es"} and those bank '
                'transactions become outstanding again.'
            )
        if n_opening:
            parts.append(
                'This includes the opening-balance entry (the money already in the bank before the first statement) - '
                'without it the books start from zero again and the reconciliation shows that amount as a difference.'
            )
        raise UnmatchConfirmationRequired(' '.join(parts), n_bank + n_opening)


def matched_transactions_of_entries(db: Session, entry_ids: list[int]) -> set[int]:
    """Bank transactions matched to lines of these journal entries."""
    if not entry_ids:
        return set()
    return set(db.scalars(
        select(ReconciliationMatch.transaction_id)
        .join(JournalEntryLine, ReconciliationMatch.journal_line_id == JournalEntryLine.id)
        .where(JournalEntryLine.entry_id.in_(entry_ids), ReconciliationMatch.transaction_id.is_not(None))
    ).all())


def drop_partial_matches(db: Session, transaction_ids: set[int]) -> None:
    """A bank transaction is reconciled only when its matched lines add up to it exactly. When some of
    its matches disappeared (their journal entry was deleted), drop the rest too: the transaction and
    its remaining lines go back to outstanding, to be matched again."""
    if transaction_ids:
        db.execute(delete(ReconciliationMatch).where(ReconciliationMatch.transaction_id.in_(transaction_ids)))


def _is_locked(lock, txn_date, line_date) -> bool:
    """A match is part of a closed month's figures when both of its sides are dated inside it."""
    return lock is not None and txn_date <= lock and line_date <= lock


def _locked_error(lock) -> ReconciliationError:
    return ReconciliationError(
        f'Both sides are dated on or before {lock:%d %b %Y}, which is in a month already signed off as reconciled - '
        'reopen that month first.'
    )


def allowed_difference(bank_amount: Decimal, tolerance_percent) -> Decimal:
    """The most a journal amount may differ from bank_amount and still match it."""
    return (bank_amount * Decimal(tolerance_percent) / 100).quantize(Decimal('0.01'))


def within_tolerance(bank_amount, book_amount, tolerance_percent) -> bool:
    return abs(book_amount - bank_amount) <= allowed_difference(bank_amount, tolerance_percent)


def _pct(value) -> str:
    """A tolerance percent for messages: 2.50 -> "2.5%", 0 -> "0%"."""
    return f'{Decimal(value).normalize():f}%'


def _txn_side(txn: Transaction):
    """('W', amount) for a withdrawal, ('D', amount) for a deposit, None for a row that is neither."""
    if txn.debit > 0 and txn.credit == 0:
        return 'W', txn.debit
    if txn.credit > 0 and txn.debit == 0:
        return 'D', txn.credit
    return None


def _line_side(line: JournalEntryLine):
    """The bank side a journal line matches: a book credit is a withdrawal, a book debit a deposit."""
    return ('W', line.credit) if line.credit > 0 else ('D', line.debit)


def _unmatched_lines_stmt(account: BankAccount):
    return (select(JournalEntryLine).join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id)
            .options(joinedload(JournalEntryLine.entry))
            .where(book_line_filter(account), LINE_UNMATCHED))


def auto_match(db: Session, account: BankAccount, date_from=None, date_to=None) -> int:
    """Pairs unmatched bank transactions with unmatched journal lines of exactly the same amount
    on the opposite side, within the configured date window. The amount tolerance is deliberately
    not used here: a near match leaves its difference in the reconciliation (blocking sign-off
    until it is booked), so only a person may accept one. Among several candidates the closest
    date wins, then the most shared description words. Pairs are assigned globally best-first, so
    one transaction can't take the only candidate of another that fits it better. Potential
    duplicate bank rows are left alone. Returns the match count."""
    _require_gl_account(account)
    window = reconciliation_settings(db).date_window_days
    lock = locked_through(db, account)

    stmt = select(Transaction).where(bank_txn_filter(account), TXN_UNMATCHED,
                                     Transaction.is_potential_duplicate.is_(False))
    if date_from:
        stmt = stmt.where(Transaction.date >= date_from)
    if date_to:
        stmt = stmt.where(Transaction.date <= date_to)
    txns = db.scalars(stmt).all()
    if not txns:
        return 0

    lines = db.scalars(_unmatched_lines_stmt(account).where(
        JournalEntry.date >= min(t.date for t in txns) - timedelta(days=window),
        JournalEntry.date <= max(t.date for t in txns) + timedelta(days=window),
    )).unique().all()
    # Bank withdrawal <-> book credit, bank deposit <-> book debit.
    lines_by_key: dict = {}
    for line in lines:
        lines_by_key.setdefault(_line_side(line), []).append(line)

    candidates = []
    for txn in txns:
        key = _txn_side(txn)
        if not key:
            continue
        txn_tokens = _tokens(txn.clean_description or txn.description)
        for line in lines_by_key.get(key, []):
            days = abs((line.entry.date - txn.date).days)
            if days > window or _is_locked(lock, txn.date, line.entry.date):
                continue
            overlap = len(txn_tokens & _tokens(line.description, line.entry.narration, line.entry.entry_number))
            candidates.append((days, -overlap, txn.date, txn.id, line.id, txn, line))

    candidates.sort(key=lambda c: c[:5])
    used_txns, used_lines, matches = set(), set(), []
    for *_, txn, line in candidates:
        if txn.id in used_txns or line.id in used_lines:
            continue
        used_txns.add(txn.id)
        used_lines.add(line.id)
        matches.append(ReconciliationMatch(transaction_id=txn.id, journal_line_id=line.id, method=MatchMethod.AUTO))

    db.add_all(matches)
    db.commit()
    return len(matches)


def manual_match(db: Session, account: BankAccount, transaction_id, line_ids) -> int:
    """Matches one bank transaction to one or more journal lines whose amounts add up to it -
    exactly, or within the configured amount tolerance."""
    _require_gl_account(account)
    if not isinstance(line_ids, list) or not line_ids:
        raise ReconciliationError('Select at least one journal line.')
    try:
        transaction_id = int(transaction_id)
        line_ids = {int(i) for i in line_ids}
    except (TypeError, ValueError):
        raise ReconciliationError('Transaction and journal line ids must be numbers.')

    txn = db.scalars(select(Transaction).where(bank_txn_filter(account), Transaction.id == transaction_id)
                     .with_for_update()).first()
    if not txn:
        raise ReconciliationError('That bank transaction does not belong to this bank account.')
    if db.scalar(select(exists().where(ReconciliationMatch.transaction_id == txn.id))):
        raise ReconciliationError('That bank transaction is already matched - unmatch it first.')

    lines = db.scalars(select(JournalEntryLine).options(joinedload(JournalEntryLine.entry))
                       .where(book_line_filter(account), JournalEntryLine.id.in_(line_ids))).unique().all()
    if len(lines) != len(line_ids):
        raise ReconciliationError("Some selected journal lines aren't booked to this bank account's GL account.")
    lock = locked_through(db, account)
    if any(_is_locked(lock, txn.date, l.entry.date) for l in lines):
        raise _locked_error(lock)
    if db.scalar(select(exists().where(ReconciliationMatch.journal_line_id.in_(line_ids)))):
        raise ReconciliationError('Some selected journal lines are already matched to another bank transaction.')

    is_withdrawal = txn.debit > 0
    if any((l.credit > 0) != is_withdrawal for l in lines):
        raise ReconciliationError('A bank withdrawal can only match credit lines, and a deposit only debit lines.')
    amount = txn.debit if is_withdrawal else txn.credit
    total = sum((l.credit if is_withdrawal else l.debit for l in lines), ZERO)
    tolerance = reconciliation_settings(db).amount_tolerance_percent
    if not within_tolerance(amount, total, tolerance):
        if not tolerance:
            raise ReconciliationError(
                f'Selected journal lines total {total}, but the bank transaction is {amount} - they must be equal '
                '(the amount tolerance is 0%).'
            )
        raise ReconciliationError(
            f'Selected journal lines total {total}, but the bank transaction is {amount} - a difference of '
            f'{abs(total - amount)}, more than the {_pct(tolerance)} tolerance ({allowed_difference(amount, tolerance)}).'
        )

    db.add_all([ReconciliationMatch(transaction_id=txn.id, journal_line_id=l.id, method=MatchMethod.MANUAL)
                for l in lines])
    db.commit()
    return len(lines)


MAX_CANDIDATES = 50


def _amount_range(amount, tolerance):
    """Bounds on a bank amount b for which |b - amount| <= b * tolerance% can hold (checked exactly afterwards)."""
    p = Decimal(tolerance) / 100
    low = (amount / (1 + p)).quantize(Decimal('0.01')) - Decimal('0.01')
    high = None if p >= 1 else (amount / (1 - p)).quantize(Decimal('0.01')) + Decimal('0.01')
    return low, high


def _candidate(amount, other_amount, days, **fields):
    return {**fields, 'amount': other_amount, 'difference': other_amount - amount, 'days_apart': days}


def candidates_for_transaction(db: Session, transaction_id: int) -> dict:
    """Unmatched journal lines a bank transaction can be matched to: on its bank account's GL
    account, on the opposite side, with an amount within the tolerance. Closest amount first,
    then closest date."""
    txn = db.get(Transaction, transaction_id)
    if not txn:
        raise ReconciliationError('That bank transaction does not exist.')
    account = txn.statement.account
    _require_gl_account(account)
    if db.scalar(select(exists().where(ReconciliationMatch.transaction_id == txn.id))):
        raise ReconciliationError('This bank transaction is already matched - unmatch it in Bank Reconciliation first.')
    key = _txn_side(txn)
    if not key:
        raise ReconciliationError('This bank row has both (or neither) a withdrawal and a deposit, so it cannot be matched.')
    side, amount = key
    tolerance = reconciliation_settings(db).amount_tolerance_percent
    allowed = allowed_difference(amount, tolerance)
    column = JournalEntryLine.credit if side == 'W' else JournalEntryLine.debit
    lock = locked_through(db, account)

    rows = []
    for line in db.scalars(_unmatched_lines_stmt(account).where(
            column >= max(amount - allowed, Decimal('0.01')), column <= amount + allowed)).unique():
        if _is_locked(lock, txn.date, line.entry.date):
            continue
        days = abs((line.entry.date - txn.date).days)
        rows.append(_candidate(
            amount, line.credit if side == 'W' else line.debit, days,
            journal_line=line.id, entry=line.entry_id, entry_number=line.entry.entry_number,
            date=line.entry.date.isoformat(), description=line.description or line.entry.narration,
            account=account.id, account_name=account.name,
        ))
    rows.sort(key=lambda r: (abs(r['difference']), r['days_apart'], r['journal_line']))
    return {
        'tolerance_percent': tolerance,
        'source': {
            'transaction': txn.id, 'date': txn.date.isoformat(), 'description': txn.description,
            'side': side, 'amount': amount, 'account': account.id, 'account_name': account.name,
            'allowed_difference': allowed,
        },
        'candidates': rows[:MAX_CANDIDATES],
        'total': len(rows),
    }


def candidates_for_line(db: Session, line_id: int) -> dict:
    """Unmatched bank transactions a journal line can be matched to: on a bank account whose GL
    account is the line's account, on the opposite side, with an amount within the tolerance
    (as a percent of the bank amount). Closest amount first, then closest date."""
    line = db.get(JournalEntryLine, line_id)
    if not line:
        raise ReconciliationError('That journal line does not exist.')
    accounts = db.scalars(select(BankAccount).where(BankAccount.gl_account_id == line.sub_category_id)).all()
    if not accounts:
        raise ReconciliationError(
            f'"{line.sub_category.name}" is not the GL account of any bank account, so this line has nothing to match.')
    if db.scalar(select(exists().where(ReconciliationMatch.journal_line_id == line.id))):
        raise ReconciliationError('This journal line is already matched - unmatch it in Bank Reconciliation first.')
    side, amount = _line_side(line)
    tolerance = reconciliation_settings(db).amount_tolerance_percent
    column, other = (Transaction.debit, Transaction.credit) if side == 'W' else (Transaction.credit, Transaction.debit)
    low, high = _amount_range(amount, tolerance)
    account_ids = [a.id for a in accounts]
    stmt = (select(Transaction).join(BankStatement, Transaction.statement_id == BankStatement.id)
            .where(BankStatement.account_id.in_(account_ids), TXN_UNMATCHED,
                   column >= max(low, Decimal('0.01')), other == 0))
    if high is not None:
        stmt = stmt.where(column <= high)
    locks = {a.id: locked_through(db, a) for a in accounts}

    rows = []
    for txn in db.scalars(stmt):
        bank_amount = txn.debit if side == 'W' else txn.credit
        if not within_tolerance(bank_amount, amount, tolerance):
            continue
        if _is_locked(locks[txn.statement.account_id], txn.date, line.entry.date):
            continue
        days = abs((line.entry.date - txn.date).days)
        rows.append({
            **_candidate(amount, bank_amount, days,
                         transaction=txn.id, statement=txn.statement_id, date=txn.date.isoformat(),
                         description=txn.description, account=txn.statement.account_id,
                         account_name=txn.statement.account.name, is_potential_duplicate=txn.is_potential_duplicate),
            'allowed_difference': allowed_difference(bank_amount, tolerance),
        })
    rows.sort(key=lambda r: (abs(r['difference']), r['days_apart'], r['transaction']))
    return {
        'tolerance_percent': tolerance,
        'source': {
            'journal_line': line.id, 'entry': line.entry_id, 'entry_number': line.entry.entry_number,
            'date': line.entry.date.isoformat(), 'description': line.description or line.entry.narration,
            'side': side, 'amount': amount, 'account_name': ', '.join(a.name for a in accounts),
        },
        'candidates': rows[:MAX_CANDIDATES],
        'total': len(rows),
    }


def match_pair(db: Session, transaction_id, line_id) -> int:
    """Matches one bank transaction to one journal line (from either side), within the tolerance."""
    try:
        txn = db.get(Transaction, int(transaction_id))
        line_id = int(line_id)
    except (TypeError, ValueError):
        raise ReconciliationError('Transaction and journal line ids must be numbers.')
    if not txn:
        raise ReconciliationError('That bank transaction does not exist.')
    return manual_match(db, txn.statement.account, txn.id, [line_id])


def unmatch(db: Session, account: BankAccount, transaction_ids) -> int:
    """Removes every match of the given bank transactions. Returns how many transactions were unmatched."""
    if not isinstance(transaction_ids, list) or not transaction_ids:
        raise ReconciliationError('Select at least one bank transaction.')
    try:
        transaction_ids = [int(i) for i in transaction_ids]
    except (TypeError, ValueError):
        raise ReconciliationError('Transaction ids must be numbers.')
    in_account = ReconciliationMatch.transaction_id.in_(
        select(Transaction.id).where(bank_txn_filter(account), Transaction.id.in_(transaction_ids)))
    lock = locked_through(db, account)
    if lock:
        locked = db.scalar(
            select(exists().where(
                in_account,
                ReconciliationMatch.transaction_id.in_(select(Transaction.id).where(Transaction.date <= lock)),
                ReconciliationMatch.journal_line_id.in_(
                    select(JournalEntryLine.id).join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id)
                    .where(JournalEntry.date <= lock)),
            )))
        if locked:
            raise _locked_error(lock)
    count = len(set(db.scalars(select(ReconciliationMatch.transaction_id).where(in_account)).all()))
    db.execute(delete(ReconciliationMatch).where(in_account))
    db.commit()
    return count


def _sum(db: Session, column, *where) -> Decimal:
    return db.scalar(select(func.coalesce(func.sum(column), 0)).where(*where)) or ZERO


def reconciliation_statement(db: Session, account: BankAccount, as_of: date) -> dict:
    """The bank reconciliation statement for `account` as of `as_of` (see module docstring).
    An item counts as reconciled as of that date only if its counterpart is also dated on or before it."""
    txn_where = [bank_txn_filter(account), Transaction.date <= as_of]
    line_from = (select(JournalEntryLine.id).join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id)
                 .where(book_line_filter(account), JournalEntry.date <= as_of).correlate(None))
    line_where = [JournalEntryLine.id.in_(line_from)]

    # Aliased so the subquery never correlates with the match / line tables of an enclosing query.
    m2, l2, e2 = aliased(ReconciliationMatch), aliased(JournalEntryLine), aliased(JournalEntry)
    txn_settled = exists(select(m2.id).join(l2, m2.journal_line_id == l2.id).join(e2, l2.entry_id == e2.id)
                         .where(m2.transaction_id == Transaction.id, e2.date <= as_of))
    # An opening-balance line (no bank transaction) is settled by the statement's opening balance.
    settled_txn = select(Transaction.id).where(Transaction.date <= as_of)
    line_settled = exists(select(ReconciliationMatch.id).where(
        ReconciliationMatch.journal_line_id == JournalEntryLine.id,
        or_(ReconciliationMatch.transaction_id.is_(None), ReconciliationMatch.transaction_id.in_(settled_txn)),
    ))
    open_txn_where = txn_where + [~txn_settled]
    open_line_where = line_where + [~line_settled]

    last = db.scalars(select(Transaction).where(*txn_where, Transaction.balance.is_not(None))
                      .order_by(Transaction.date.desc(), Transaction.id.desc()).limit(1)).first()
    bank_balance = last.balance if last else None
    # The first statement's opening balance is money already in the bank before any uploaded
    # transaction. Unless the books carry an opening-balance entry, it shows up as the difference.
    first_statement = _first_statement(db, account, as_of=as_of)
    opening_entry = opening_line(db, account)
    candidate = opening_candidate(db, account, first_statement) if first_statement else None

    book_debits = _sum(db, JournalEntryLine.debit, *line_where)
    book_credits = _sum(db, JournalEntryLine.credit, *line_where)
    book_balance = book_debits - book_credits

    deposits_in_transit = _sum(db, JournalEntryLine.debit, *open_line_where)
    outstanding_payments = _sum(db, JournalEntryLine.credit, *open_line_where)
    bank_deposits_not_in_books = _sum(db, Transaction.credit, *open_txn_where)
    bank_withdrawals_not_in_books = _sum(db, Transaction.debit, *open_txn_where)

    # Pairs matched within the tolerance but not equal: each one's gap stays in the difference until booked.
    gap_rows = db.execute(
        select(Transaction.id, Transaction.debit, Transaction.credit,
               func.sum(JournalEntryLine.debit) - func.sum(JournalEntryLine.credit))
        .join(ReconciliationMatch, ReconciliationMatch.transaction_id == Transaction.id)
        .join(JournalEntryLine, ReconciliationMatch.journal_line_id == JournalEntryLine.id)
        .where(*txn_where, txn_settled, JournalEntryLine.id.in_(line_from))
        .group_by(Transaction.id, Transaction.debit, Transaction.credit)
    ).all()
    gaps = [credit - debit - Decimal(book) for _, debit, credit, book in gap_rows]
    matched_difference = sum(gaps, ZERO)

    adjusted_book = book_balance + bank_deposits_not_in_books - bank_withdrawals_not_in_books
    adjusted_bank = None if bank_balance is None else bank_balance + deposits_in_transit - outstanding_payments
    difference = None if adjusted_bank is None else adjusted_bank - adjusted_book

    def count(where):
        return db.scalar(select(func.count()).select_from(
            select(Transaction.id).where(*where).subquery())) or 0

    def count_lines(where):
        return db.scalar(select(func.count()).select_from(select(JournalEntryLine.id).where(*where).subquery())) or 0

    return {
        'account': account.id,
        'account_name': account.name,
        'gl_account': account.gl_account_id,
        'gl_account_name': account.gl_account.name if account.gl_account_id else None,
        'as_of': as_of.isoformat(),
        'bank_balance': bank_balance,
        'bank_balance_date': last.date.isoformat() if last else None,
        'deposits_in_transit': deposits_in_transit,
        'outstanding_payments': outstanding_payments,
        'adjusted_bank_balance': adjusted_bank,
        'book_balance': book_balance,
        'bank_deposits_not_in_books': bank_deposits_not_in_books,
        'bank_withdrawals_not_in_books': bank_withdrawals_not_in_books,
        'adjusted_book_balance': adjusted_book,
        'difference': difference,
        'is_reconciled': difference == 0 if difference is not None else False,
        # Part of the difference that comes from pairs matched within the amount tolerance (bank - books).
        'matched_difference': matched_difference,
        'matched_with_difference': sum(1 for g in gaps if g),
        'opening_balance': first_statement[0].opening_balance if first_statement else None,
        'opening_balance_date': first_statement[1].isoformat() if first_statement else None,
        'difference_is_opening_balance': bool(
            first_statement and difference and first_statement[0].opening_balance
            and difference == first_statement[0].opening_balance
        ),
        # For "Book opening balance": its date, the entry once it exists, or a hand-imported one to mark.
        'opening_entry_date': _iso(first_statement[1] - timedelta(days=1)) if first_statement else None,
        'opening_entry_number': opening_entry.entry.entry_number if opening_entry else None,
        'opening_candidate': {
            'journal_line': candidate.id, 'entry_number': candidate.entry.entry_number,
            'date': candidate.entry.date.isoformat(),
        } if candidate else None,
        'counts': {
            'bank_transactions': count(txn_where),
            'bank_unmatched': count(open_txn_where),
            'book_lines': count_lines(line_where),
            'book_unmatched': count_lines(open_line_where),
        },
        'locked_through': _iso(locked_through(db, account)),
    }


def _iso(d):
    return d.isoformat() if d else None


# ---------------------------------------------------------------------------
# Opening balance: money already in the bank before the first uploaded transaction
# ---------------------------------------------------------------------------

def opening_entry_number(account: BankAccount) -> str:
    return f'OB-{account.id}'


def _first_statement(db: Session, account: BankAccount, as_of: Optional[date] = None):
    """(statement, its first transaction date) - the account's earliest statement (by its first
    transaction) that carries an opening balance; or None."""
    first_date = func.min(Transaction.date)
    stmt = (select(BankStatement, first_date)
            .join(Transaction, Transaction.statement_id == BankStatement.id)
            .where(BankStatement.account_id == account.id, BankStatement.opening_balance.is_not(None))
            .group_by(BankStatement.id))
    if as_of:
        stmt = stmt.having(first_date <= as_of)
    row = db.execute(stmt.order_by(first_date, BankStatement.id).limit(1)).first()
    return (row[0], row[1]) if row else None


def opening_line(db: Session, account: BankAccount) -> Optional[JournalEntryLine]:
    """The bank line already marked as the opening balance (cleared by the statement's opening balance), or None."""
    if not account.gl_account_id:
        return None
    return db.scalars(
        select(JournalEntryLine).join(ReconciliationMatch, ReconciliationMatch.journal_line_id == JournalEntryLine.id)
        .where(JournalEntryLine.sub_category_id == account.gl_account_id, ReconciliationMatch.method == MatchMethod.OPENING)
        .limit(1)
    ).first()


def opening_candidate(db: Session, account: BankAccount, first=None) -> Optional[JournalEntryLine]:
    """An unmatched bank line that looks like a hand-imported opening balance: dated before the first
    bank transaction, for exactly the first statement's opening balance on the matching side."""
    first = first or _first_statement(db, account)
    if not account.gl_account_id or not first or not first[0].opening_balance or opening_line(db, account):
        return None
    statement, first_date = first
    amount = abs(statement.opening_balance)
    side = JournalEntryLine.debit == amount if statement.opening_balance > 0 else JournalEntryLine.credit == amount
    return db.scalars(_unmatched_lines_stmt(account).where(side, JournalEntry.date < first_date)
                      .order_by(JournalEntry.date.desc(), JournalEntryLine.id.desc()).limit(1)).first()


def mark_opening_line(db: Session, account: BankAccount, line_id) -> JournalEntryLine:
    """Marks an existing journal line (e.g. an opening entry imported by hand) as the opening balance,
    so it isn't listed as a deposit in transit."""
    _require_gl_account(account)
    candidate = opening_candidate(db, account)
    try:
        line_id = int(line_id)
    except (TypeError, ValueError):
        raise ReconciliationError('journal_line must be a number.')
    if not candidate or candidate.id != line_id:
        raise ReconciliationError(
            "That journal line can't be the opening balance - it must be an unmatched line on the bank's GL account, "
            "dated before the first bank transaction, for exactly the first statement's opening balance."
        )
    db.add(ReconciliationMatch(journal_line_id=candidate.id, transaction_id=None, method=MatchMethod.OPENING))
    db.commit()
    return candidate


def create_opening_balance_entry(db: Session, account: BankAccount, equity_sub_category_id) -> dict:
    """Books the first statement's opening balance as a journal entry dated the day before its first
    transaction: Dr the bank's GL account / Cr the chosen equity account (reversed for an overdraft).
    Goes through the journal import, so a signed-off month, an unknown account or an entry already
    created are refused like any import. Returns the import result."""
    from .journal_import import JournalImportError, import_journal_entries

    _require_gl_account(account)
    first = _first_statement(db, account)
    if not first or not first[0].opening_balance:
        raise ReconciliationError(f'"{account.name}" has no uploaded statement with an opening balance to book.')
    statement, first_date = first
    try:
        equity_id = int(equity_sub_category_id)
    except (TypeError, ValueError):
        raise ReconciliationError('Choose the equity account the opening balance comes from (e.g. Owner Capital).')
    if equity_id == account.gl_account_id:
        raise ReconciliationError("The equity account can't be the bank's own GL account.")
    existing = opening_line(db, account)
    number = opening_entry_number(account)
    if existing or db.scalar(select(exists().where(JournalEntry.entry_number == number))):
        raise ReconciliationError(f'The opening balance entry {existing.entry.entry_number if existing else number} '
                                  'already exists - delete it on Journal Entries first to book a different one.')
    candidate = opening_candidate(db, account, first)
    if candidate:
        raise ReconciliationError(f'Journal entry {candidate.entry.entry_number} already books this opening balance - '
                                  'mark it as the opening balance instead of booking it twice.')

    amount = abs(statement.opening_balance)
    in_credit = statement.opening_balance > 0  # money in the bank; negative = overdraft
    entry = {
        'entry_number': number,
        'date': (first_date - timedelta(days=1)).isoformat(),
        'narration': f'Opening balance - {account.name}',
        'lines': [
            {'sub_category_id': account.gl_account_id, 'debit' if in_credit else 'credit': str(amount),
             'description': f'Balance before {first_date:%d %b %Y} per bank statement'},
            {'sub_category_id': equity_id, 'credit' if in_credit else 'debit': str(amount)},
        ],
    }
    try:
        result = import_journal_entries(db, [entry], source='API', source_name='Opening balance', bank_account=account,
                                        include_duplicates=True, commit=False)
    except JournalImportError as exc:
        db.rollback()
        raise ReconciliationError(' '.join(exc.errors))
    # Its bank line is the money already in the bank - cleared by the statement's opening balance,
    # not by any bank transaction, so it must not show as a deposit in transit.
    bank_line = db.scalars(select(JournalEntryLine).join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id)
                           .where(JournalEntry.entry_number == number,
                                  JournalEntryLine.sub_category_id == account.gl_account_id)).first()
    db.add(ReconciliationMatch(journal_line_id=bank_line.id, transaction_id=None, method=MatchMethod.OPENING))
    db.commit()
    return result


# ---------------------------------------------------------------------------
# Periods: month / statement / date range views, and month sign-off
# ---------------------------------------------------------------------------

def month_bounds(month) -> tuple[date, date]:
    """(first day, last day) for 'YYYY-MM', or a ReconciliationError."""
    try:
        year, mon = (int(p) for p in str(month).split('-'))
        start = date(year, mon, 1)
    except (TypeError, ValueError):
        raise ReconciliationError('month must be YYYY-MM.')
    return start, start.replace(day=calendar.monthrange(year, mon)[1])


def _whole_month(date_from: date, date_to: date) -> Optional[date]:
    """The month's first day when [date_from, date_to] is exactly one calendar month, else None."""
    if date_from and date_from.day == 1 and (date_from.year, date_from.month) == (date_to.year, date_to.month):
        if date_to == month_bounds(f'{date_from:%Y-%m}')[1]:
            return date_from
    return None


def _opening_bank_balance(db: Session, account: BankAccount, date_from: date):
    """Bank balance at the start of date_from: the running balance of the last transaction before it,
    or - for the account's first transactions - worked back from the first one on or after it."""
    before = db.scalars(select(Transaction).where(bank_txn_filter(account), Transaction.date < date_from,
                                                  Transaction.balance.is_not(None))
                        .order_by(Transaction.date.desc(), Transaction.id.desc()).limit(1)).first()
    if before:
        return before.balance
    first = db.scalars(select(Transaction).where(bank_txn_filter(account), Transaction.date >= date_from,
                                                 Transaction.balance.is_not(None))
                       .order_by(Transaction.date, Transaction.id).limit(1)).first()
    if first:
        return first.balance - first.credit + first.debit
    return None


def period_summary(db: Session, account: BankAccount, date_from: Optional[date], date_to: date) -> dict:
    """The reconciliation statement at date_to plus what happened inside [date_from, date_to]."""
    result = reconciliation_statement(db, account, date_to)
    if not date_from:
        result['period'] = None
        return result

    txn_where = [bank_txn_filter(account), Transaction.date >= date_from, Transaction.date <= date_to]
    bank = db.execute(select(func.sum(Transaction.credit), func.sum(Transaction.debit), func.count(Transaction.id))
                      .where(*txn_where)).one()
    bank_matched = db.scalar(select(func.count()).select_from(
        select(Transaction.id).where(*txn_where, TXN_MATCHED).subquery())) or 0
    line_where = [book_line_filter(account), JournalEntry.date >= date_from, JournalEntry.date <= date_to]
    book = db.execute(select(func.sum(JournalEntryLine.debit), func.sum(JournalEntryLine.credit),
                             func.count(JournalEntryLine.id))
                      .join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id).where(*line_where)).one()
    book_matched = db.scalar(select(func.count(JournalEntryLine.id))
                             .join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id)
                             .where(*line_where, ~LINE_UNMATCHED)) or 0
    opening = _opening_bank_balance(db, account, date_from)
    money_in, money_out = bank[0] or ZERO, bank[1] or ZERO

    month = _whole_month(date_from, date_to)
    closed = db.scalars(select(ReconciliationPeriod).where(
        ReconciliationPeriod.bank_account_id == account.id, ReconciliationPeriod.period_start == month)).first() \
        if month else None
    lock = locked_through(db, account)
    result['period'] = {
        'date_from': date_from.isoformat(),
        'date_to': date_to.isoformat(),
        'is_month': month is not None,
        'bank_opening_balance': opening,
        'bank_money_in': money_in,
        'bank_money_out': money_out,
        'bank_closing_balance': None if opening is None else opening + money_in - money_out,
        'book_debits': book[0] or ZERO,
        'book_credits': book[1] or ZERO,
        'bank_transactions': bank[2],
        'bank_matched': bank_matched,
        'book_lines': book[2],
        'book_matched': book_matched,
        # Open items dated before the period - they still need clearing, so the lists show them too.
        'carried_forward_bank': db.scalar(select(func.count(Transaction.id)).where(
            bank_txn_filter(account), TXN_UNMATCHED, Transaction.date < date_from)) or 0,
        'carried_forward_book': db.scalar(select(func.count(JournalEntryLine.id))
                                          .join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id)
                                          .where(book_line_filter(account), LINE_UNMATCHED,
                                                 JournalEntry.date < date_from)) or 0,
        'closed': _period_data(closed) if closed else None,
        # Order and timing rules of close_month(); whether it balances is result['is_reconciled'].
        'can_close': bool(month and not closed and date_to <= _today()
                          and not _open_months_before(db, account, month)),
        'can_reopen': bool(closed and closed.period_end == lock),
    }
    return result


def _period_data(p: ReconciliationPeriod) -> dict:
    return {
        'month': f'{p.period_start:%Y-%m}',
        'period_start': p.period_start.isoformat(),
        'period_end': p.period_end.isoformat(),
        'bank_balance': p.bank_balance,
        'book_balance': p.book_balance,
        'deposits_in_transit': p.deposits_in_transit,
        'outstanding_payments': p.outstanding_payments,
        'reconciled_by': (p.reconciled_by.full_name or p.reconciled_by.username) if p.reconciled_by else None,
        'reconciled_at': p.reconciled_at.isoformat() if p.reconciled_at else None,
        'note': p.note,
    }


def _activity_months(db: Session, account: BankAccount) -> dict:
    """{month start: {'bank': n, 'bank_open': n, 'book': n, 'book_open': n}} for every month with items."""
    months: dict = {}

    def bump(d, key):
        m = d.replace(day=1)
        months.setdefault(m, {'bank': 0, 'bank_open': 0, 'book': 0, 'book_open': 0})[key] += 1

    matched_txns = set(db.scalars(select(ReconciliationMatch.transaction_id)
                                  .where(ReconciliationMatch.transaction_id.is_not(None))).all())
    for txn_id, d in db.execute(select(Transaction.id, Transaction.date).where(bank_txn_filter(account))):
        bump(d, 'bank')
        if txn_id not in matched_txns:
            bump(d, 'bank_open')
    matched_lines = set(db.scalars(select(ReconciliationMatch.journal_line_id)).all())
    for line_id, d in db.execute(select(JournalEntryLine.id, JournalEntry.date)
                                 .join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id)
                                 .where(book_line_filter(account))):
        bump(d, 'book')
        if line_id not in matched_lines:
            bump(d, 'book_open')
    return months


def _closed_periods(db: Session, account: BankAccount) -> list[ReconciliationPeriod]:
    return db.scalars(select(ReconciliationPeriod).where(ReconciliationPeriod.bank_account_id == account.id)).all()


def _open_months_before(db: Session, account: BankAccount, month_start: date) -> list[date]:
    """Months before month_start that have items but aren't signed off, oldest first."""
    closed = {p.period_start for p in _closed_periods(db, account)}
    return sorted(m for m in _activity_months(db, account) if m < month_start and m not in closed)


def month_overview(db: Session, account: BankAccount) -> dict:
    """Every month with bank transactions or book lines (plus signed-off ones), newest first, with its
    item counts and sign-off; and the account's uploaded statements with the dates they cover."""
    activity = _activity_months(db, account)
    closed = {p.period_start: p for p in _closed_periods(db, account)}
    lock = locked_through(db, account)
    months = []
    for m in sorted(set(activity) | set(closed), reverse=True):
        counts = activity.get(m, {'bank': 0, 'bank_open': 0, 'book': 0, 'book_open': 0})
        p = closed.get(m)
        months.append({
            'month': f'{m:%Y-%m}',
            'label': f'{m:%b %Y}',
            **counts,
            'closed': _period_data(p) if p else None,
            'can_reopen': bool(p and p.period_end == lock),
        })
    rows = db.execute(
        select(BankStatement, func.min(Transaction.date), func.max(Transaction.date), func.count(Transaction.id))
        .join(Transaction, Transaction.statement_id == BankStatement.id)
        .where(BankStatement.account_id == account.id)
        .group_by(BankStatement.id)
        .order_by(func.max(Transaction.date).desc(), BankStatement.id.desc())
    ).all()
    return {
        'locked_through': _iso(lock),
        'months': months,
        'statements': [{
            'id': s.id,
            'name': s.file_path.rsplit('/', 1)[-1],
            'date_from': first.isoformat(),
            'date_to': last.isoformat(),
            'transactions': n,
            'closing_balance': s.closing_balance,
        } for s, first, last, n in rows],
    }


def close_month(db: Session, account: BankAccount, month, user: Optional[User] = None, note: str = '') -> ReconciliationPeriod:
    """Signs off a month as reconciled. Refused unless the GL account is linked, the month has ended,
    every earlier month with items is already signed off, and the statement at its last day balances."""
    _require_gl_account(account)
    start, end = month_bounds(month)
    label = f'{start:%B %Y}'
    if end > _today():
        raise ReconciliationError(f'{label} has not ended yet - it can be signed off from {end:%d %b %Y}.')
    if db.scalar(select(exists().where(ReconciliationPeriod.bank_account_id == account.id,
                                       ReconciliationPeriod.period_start == start))):
        raise ReconciliationError(f'{label} is already signed off.')
    earlier = _open_months_before(db, account, start)
    if earlier:
        raise ReconciliationError(f'Sign off {earlier[0]:%B %Y} first - months are closed in order.')

    st = reconciliation_statement(db, account, end)
    if st['bank_balance'] is None:
        raise ReconciliationError(f'There is no bank statement balance on or before {end:%d %b %Y} to reconcile against.')
    if not st['is_reconciled']:
        raise ReconciliationError(
            f'{label} does not balance yet - the difference at {end:%d %b %Y} is {st["difference"]}. '
            + (f'{st["matched_difference"]} of it comes from {st["matched_with_difference"]} matched pair(s) whose amounts '
               'differ - book the gap (e.g. as bank charges). ' if st['matched_with_difference'] else '')
            + 'Match or book the outstanding items first.'
        )
    # Book items may stay open (deposits in transit, uncleared cheques), but everything the bank
    # shows up to month end must be in the books - otherwise the books are incomplete.
    if st['counts']['bank_unmatched']:
        n = st['counts']['bank_unmatched']
        raise ReconciliationError(
            f'{n} bank transaction{"s" if n != 1 else ""} up to {end:%d %b %Y} '
            f'{"are" if n != 1 else "is"} not in the books yet - book and match {"them" if n != 1 else "it"} '
            '(or delete a duplicate bank row) before signing off.'
        )
    period = ReconciliationPeriod(
        bank_account_id=account.id, period_start=start, period_end=end,
        bank_balance=st['bank_balance'], book_balance=st['book_balance'],
        deposits_in_transit=st['deposits_in_transit'], outstanding_payments=st['outstanding_payments'],
        reconciled_by_id=user.id if user else None, note=str(note or '')[:500],
    )
    db.add(period)
    db.commit()
    return period


def reopen_month(db: Session, account: BankAccount, month) -> None:
    """Removes a month's sign-off. Only the latest signed-off month can be reopened."""
    start, _ = month_bounds(month)
    period = db.scalars(select(ReconciliationPeriod).where(ReconciliationPeriod.bank_account_id == account.id,
                                                           ReconciliationPeriod.period_start == start)).first()
    if not period:
        raise ReconciliationError(f'{start:%B %Y} is not signed off.')
    if period.period_end != locked_through(db, account):
        raise ReconciliationError('Only the latest signed-off month can be reopened - reopen the later months first.')
    db.delete(period)
    db.commit()
