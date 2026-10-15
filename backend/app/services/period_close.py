"""Closing the books, and the financial year.

Closing the books through a date (BookClosing) freezes everything dated on or
before it: bank transactions can't be added, moved in or out, re-categorized or
deleted; statements with rows in it can't be uploaded, re-parsed or deleted; and
journal entries, invoices, bills and payments dated in it can't be created or deleted.
The reports for a closed period therefore stay exactly as they were when it was closed.

Bank transactions are frozen through their final lock (Transaction.is_final),
which every edit path already respects: the books can only be closed through a
date when every bank transaction up to it is final, and a final transaction
dated in a closed period can't be reopened. The guards below cover what the
final lock doesn't - new rows, and journal entries.

Closes move forward one date at a time; only the latest close can be reopened,
which puts the previous one (if any) back in force.
"""
import calendar
from datetime import date
from typing import Optional

from sqlalchemy import Select, and_, func, not_, or_, select
from sqlalchemy.orm import Session

from ..models import BankAccount, BankStatement, BookClosing, JournalEntry, Transaction, TransactionStatus, User
from ..utils import today as _today
from .settings import accounting_settings


class PeriodClosedError(Exception):
    pass


def closed_through(db: Session) -> Optional[date]:
    """Last day of the closed books, or None when the books have never been closed."""
    return db.scalar(select(func.max(BookClosing.closed_through)))


def _closed_message(end: date, what: str) -> str:
    return (f'The books are closed through {end:%d %b %Y} - {what}. '
            'Reopen the period in Period Close first.')


def guard_dates(db: Session, *dates, what: str = 'nothing dated in a closed period can be changed') -> None:
    """Refuses when any of `dates` (date objects, None ignored) is on or before the close."""
    end = closed_through(db)
    if end and any(d and d <= end for d in dates):
        raise PeriodClosedError(_closed_message(end, what))


def guard_transactions(db: Session, txn_ids_stmt: Select,
                       what: str = 'these bank transactions are dated in a closed period') -> None:
    """Refuses when any bank transaction selected by `txn_ids_stmt` (a select of Transaction.id)
    is dated on or before the close."""
    end = closed_through(db)
    if end and db.scalar(select(Transaction.id).where(Transaction.id.in_(txn_ids_stmt.correlate(None)),
                                                      Transaction.date <= end).limit(1)):
        raise PeriodClosedError(_closed_message(end, what))


def guard_journal_entries(db: Session, entry_ids: list[int],
                          what: str = 'entries dated in a closed period cannot be deleted') -> None:
    """Refuses when any of the journal entries is dated on or before the close."""
    end = closed_through(db)
    if end and entry_ids:
        locked = db.scalars(select(JournalEntry).where(JournalEntry.id.in_(entry_ids), JournalEntry.date <= end)
                            .order_by(JournalEntry.date).limit(1)).first()
        if locked:
            raise PeriodClosedError(_closed_message(
                end, f'entry {locked.entry_number} is dated {locked.date:%d %b %Y}, so {what}'))


def journal_entry_error(entry_date: Optional[date], end: Optional[date]) -> Optional[str]:
    """The import-analysis message for an entry dated in the closed period, else None."""
    if end and entry_date and entry_date <= end:
        return f'is dated on or before {end:%d %b %Y}, and the books are closed through then - reopen the period first'
    return None


# ---------------------------------------------------------------------------
# Financial year
# ---------------------------------------------------------------------------

def fiscal_year_bounds(db: Session, on: Optional[date] = None, years_back: int = 0) -> tuple[date, date]:
    """(first day, last day) of the financial year containing `on`, or `years_back` years before it."""
    on = on or _today()
    start_month = accounting_settings(db).fiscal_year_start_month
    start_year = on.year if on.month >= start_month else on.year - 1
    start_year -= years_back
    start = date(start_year, start_month, 1)
    end_year, end_month = (start_year, start_month - 1) if start_month > 1 else (start_year, 12)
    if start_month > 1:
        end_year += 1
    end = date(end_year, end_month, calendar.monthrange(end_year, end_month)[1])
    return start, end


# ---------------------------------------------------------------------------
# Close / reopen
# ---------------------------------------------------------------------------

def _count(db: Session, stmt: Select) -> int:
    return db.scalar(select(func.count()).select_from(stmt.subquery())) or 0


def readiness(db: Session, as_of: date) -> dict:
    """What stands between the books and a close through `as_of`.
    blocking: bank transactions up to as_of that aren't final (broken down by why).
    warnings: bank accounts whose reconciliation isn't signed off through as_of, and flagged duplicates."""
    from .reconciliation import locks_by_account

    end = closed_through(db)
    in_period = [Transaction.date <= as_of]
    if end:
        in_period.append(Transaction.date > end)
    txns = select(Transaction.id).where(*in_period)
    open_txns = txns.where(Transaction.is_final.is_(False))
    not_ready = or_(
        Transaction.status.in_([TransactionStatus.NEEDS_REVIEW, TransactionStatus.UNCATEGORIZED]),
        and_(Transaction.sub_category_id.is_(None),
             or_(Transaction.status.is_(None), Transaction.status != TransactionStatus.TRANSFER)),
    )

    recon_locks = locks_by_account(db)
    unreconciled = []
    active_accounts = db.scalars(
        select(BankAccount).where(BankAccount.id.in_(
            select(BankStatement.account_id).join(Transaction, Transaction.statement_id == BankStatement.id)
            .where(Transaction.date <= as_of)
        )).order_by(BankAccount.name)
    ).all()
    for account in active_accounts:
        lock = recon_locks.get(account.id)
        if not lock or lock < as_of:
            unreconciled.append({'id': account.id, 'name': account.name,
                                 'reconciled_through': lock.isoformat() if lock else None})

    not_final = _count(db, open_txns)
    je_filters = [JournalEntry.date <= as_of] + ([JournalEntry.date > end] if end else [])
    return {
        'as_of': as_of.isoformat(),
        'closed_through': end.isoformat() if end else None,
        'transactions_in_period': _count(db, txns),
        'not_final': not_final,
        'not_final_not_ready': _count(db, open_txns.where(not_ready)),
        'not_final_ready': _count(db, open_txns.where(not_(not_ready))),
        'potential_duplicates': _count(db, open_txns.where(Transaction.is_potential_duplicate.is_(True))),
        'unreconciled_accounts': unreconciled,
        'journal_entries_in_period': _count(db, select(JournalEntry.id).where(*je_filters)),
        'can_close': not_final == 0 and (end is None or as_of > end) and as_of <= _today(),
    }


def close_books(db: Session, as_of: date, user: Optional[User] = None, note: str = '') -> BookClosing:
    """Closes the books through `as_of`. Raises PeriodClosedError when it can't."""
    end = closed_through(db)
    if end and as_of <= end:
        raise PeriodClosedError(f'The books are already closed through {end:%d %b %Y} - pick a later date.')
    if as_of > _today():
        raise PeriodClosedError('The books can only be closed through today or an earlier date.')
    state = readiness(db, as_of)
    if state['not_final']:
        n = state['not_final']
        raise PeriodClosedError(
            f'{n} bank transaction{"" if n == 1 else "s"} dated on or before {as_of:%d %b %Y} '
            f'{"is" if n == 1 else "are"} not final yet - categorize and finalize them in the General Ledger first.'
        )
    closing = BookClosing(closed_through=as_of, closed_by_id=user.id if user else None, note=str(note or '').strip()[:500])
    db.add(closing)
    db.commit()
    return closing


def reopen_books(db: Session) -> Optional[date]:
    """Deletes the latest close. Returns the date the books are now closed through (or None)."""
    latest = db.scalars(select(BookClosing).order_by(BookClosing.closed_through.desc()).limit(1)).first()
    if not latest:
        raise PeriodClosedError('The books are not closed.')
    db.delete(latest)
    db.commit()
    return closed_through(db)


def closing_history(db: Session) -> list[dict]:
    rows = db.scalars(select(BookClosing).order_by(BookClosing.closed_through.desc())).all()
    return [{
        'id': c.id,
        'closed_through': c.closed_through.isoformat(),
        'closed_by': (c.closed_by.full_name or c.closed_by.username) if c.closed_by else None,
        'closed_at': c.closed_at.isoformat() if c.closed_at else None,
        'note': c.note,
    } for c in rows]
