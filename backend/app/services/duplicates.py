"""Transaction-level duplicate detection.

Separate from the file-hash check on upload (which only catches the exact same file being
uploaded twice). This catches the same real transaction appearing more than once on an
account - two overlapping statement exports, or an export that repeats a row.

    - Scope: same BANK ACCOUNT only.
    - Key: (date, description, debit, credit) - the description only case/whitespace-normalized
      (NOT reference-number-stripped), so two genuinely separate payments to the same vendor
      on the same day, each with its own reference, aren't flagged.
    - Never deletes, merges or blocks anything - only flags `is_potential_duplicate` (and
      `duplicate_of`, pointing to the earliest occurrence) so a human decides.
"""
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import BankStatement, Transaction
from .filters import txn_of_account
from .period_close import closed_through

_WHITESPACE_RE = re.compile(r'\s+')


def _normalize_for_duplicate_check(text: str) -> str:
    return _WHITESPACE_RE.sub(' ', (text or '').upper()).strip()


def flag_duplicate_transactions(db: Session, statement: BankStatement) -> int:
    """Re-checks `statement`'s own transactions against every other transaction on the same
    account (and against each other), flagging matches. Returns how many were newly flagged.
    (Does not commit.)"""
    new_txns = db.scalars(select(Transaction).where(Transaction.statement_id == statement.id)
                          .order_by(Transaction.id)).all()
    existing = db.scalars(select(Transaction).where(txn_of_account(statement.account_id),
                                                    Transaction.statement_id != statement.id)
                          .order_by(Transaction.id)).all()

    def key_for(t):
        return (t.date, _normalize_for_duplicate_check(t.description), t.debit, t.credit)

    earliest_by_key = {}
    for t in existing:
        earliest_by_key.setdefault(key_for(t), t)

    flagged_count = 0
    closed = closed_through(db)
    for t in new_txns:
        key = key_for(t)
        original = earliest_by_key.get(key)
        if original and closed and t.date <= closed:
            continue  # the books are closed through this date - its figures can't change
        if original:
            t.is_potential_duplicate = True
            t.duplicate_of_id = original.id
            original.is_potential_duplicate = True
            flagged_count += 1
        else:
            earliest_by_key[key] = t  # first occurrence - later repeats point back to it
    return flagged_count
