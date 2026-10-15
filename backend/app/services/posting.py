"""Posting categorized bank transactions to the journal (the books).

The reports are built from the journal, so a bank transaction counts in them once it is in the
books. That happens in one of two ways:

- its journal line already exists - imported from another system, or posted by a payment - and
  the two are matched in Bank Reconciliation; or
- it is posted from here: when a categorized transaction is made final, a journal entry
  "BT-<transaction id>" is created (withdrawal: Dr the category / Cr the bank's GL account;
  deposit: Dr the bank / Cr the category; transfer: Dr the receiving bank / Cr the paying bank)
  and matched to the transaction straight away, so it never shows as outstanding.

A transaction already matched to a journal line is never posted again, so nothing is counted
twice. Reopening a final transaction takes its BT entry out of the books again.
"""
from decimal import Decimal
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    BankAccount, JournalEntry, JournalEntryLine, MatchMethod, ReconciliationMatch, Transaction, TransactionStatus,
)
from .period_close import closed_through
from .reconciliation import bank_gl_locks, journal_lock_error

ORIGIN_BANK = 'BANK'
ZERO = Decimal('0.00')
NOT_READY = (TransactionStatus.NEEDS_REVIEW, TransactionStatus.UNCATEGORIZED)


def _entry_number(txn: Transaction) -> str:
    return f'BT-{txn.id}'


def post_transactions(db: Session, txns: Iterable[Transaction]) -> dict:
    """Posts each final, categorized transaction that isn't in the books yet. Does not commit.
    Returns how many were posted and why the rest weren't."""
    counts = {'posted': 0, 'already_in_books': 0, 'no_gl_account': 0, 'not_categorized': 0, 'locked': 0,
              'duplicate': 0}
    txns = list(txns)
    if not txns:
        return counts
    matched = set(db.scalars(select(ReconciliationMatch.transaction_id).where(
        ReconciliationMatch.transaction_id.in_([t.id for t in txns]))).all())
    gl_by_account = dict(db.execute(select(BankAccount.id, BankAccount.gl_account_id)).all())
    closed = closed_through(db)
    gl_locks = bank_gl_locks(db)
    done: set[int] = set()

    for txn in txns:
        if txn.id in done:
            continue
        if txn.id in matched:
            counts['already_in_books'] += 1
            continue
        if txn.duplicate_of_id:
            counts['duplicate'] += 1  # a copy of another row - never booked
            continue
        bank_gl = gl_by_account.get(txn.statement.account_id)
        if not bank_gl:
            counts['no_gl_account'] += 1
            continue
        withdrawal, deposit = txn.debit > 0 and txn.credit == 0, txn.credit > 0 and txn.debit == 0
        if not (withdrawal or deposit):
            counts['not_categorized'] += 1
            continue
        amount = txn.debit if withdrawal else txn.credit

        pair = None
        if txn.status == TransactionStatus.TRANSFER:
            pair = txn.transfer_pair
            pair_gl = gl_by_account.get(pair.statement.account_id) if pair else None
            if not pair or not pair_gl:
                counts['no_gl_account'] += 1
                continue
            if pair.id in matched:
                counts['already_in_books'] += 1
                continue
            # Money leaves the paying bank and arrives in the receiving one.
            out_txn, in_txn = (txn, pair) if withdrawal else (pair, txn)
            out_gl, in_gl = (bank_gl, pair_gl) if withdrawal else (pair_gl, bank_gl)
            lines = [(in_gl, amount, ZERO, in_txn), (out_gl, ZERO, amount, out_txn)]
        else:
            if not txn.sub_category_id or txn.status in NOT_READY:
                counts['not_categorized'] += 1
                continue
            if txn.sub_category_id == bank_gl:
                counts['not_categorized'] += 1  # categorized to its own bank ledger - nothing to book
                continue
            lines = ([(txn.sub_category_id, amount, ZERO, None), (bank_gl, ZERO, amount, txn)] if withdrawal
                     else [(bank_gl, amount, ZERO, txn), (txn.sub_category_id, ZERO, amount, None)])

        if (closed and txn.date <= closed) or journal_lock_error(txn.date, [l[0] for l in lines], gl_locks):
            counts['locked'] += 1
            continue
        number = _entry_number(txn)
        if db.scalar(select(JournalEntry.id).where(JournalEntry.entry_number == number)):
            counts['already_in_books'] += 1
            continue

        entry = JournalEntry(entry_number=number, date=txn.date, narration=(txn.description or '')[:500],
                             origin=ORIGIN_BANK)
        entry.lines = [JournalEntryLine(sub_category_id=sub, debit=dr, credit=cr,
                                        description=(t.description[:500] if t else ''))
                       for sub, dr, cr, t in lines]
        db.add(entry)
        db.flush()
        for line, (_, _, _, bank_txn) in zip(entry.lines, lines):
            if bank_txn is not None:
                db.add(ReconciliationMatch(transaction_id=bank_txn.id, journal_line_id=line.id, method=MatchMethod.AUTO))
                matched.add(bank_txn.id)
                done.add(bank_txn.id)
        counts['posted'] += 1
    db.flush()
    return counts


def unpost_transactions(db: Session, txn_ids: list[int]) -> int:
    """Takes the BT entries of these transactions out of the books (when they are reopened).
    Entries from other sources are left alone. Returns how many entries were removed. Does not commit."""
    if not txn_ids:
        return 0
    entry_ids = set(db.scalars(
        select(JournalEntryLine.entry_id)
        .join(ReconciliationMatch, ReconciliationMatch.journal_line_id == JournalEntryLine.id)
        .join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id)
        .where(ReconciliationMatch.transaction_id.in_(txn_ids), JournalEntry.origin == ORIGIN_BANK)
    ).all())
    if not entry_ids:
        return 0
    for entry in db.scalars(select(JournalEntry).where(JournalEntry.id.in_(entry_ids))):
        db.delete(entry)
    db.flush()
    return len(entry_ids)


def unposted_filter():
    """Bank transactions not in the books yet: not matched to any journal line, and not a duplicate copy."""
    from .filters import TXN_NOT_DUPLICATE_COPY, TXN_UNMATCHED
    return [TXN_UNMATCHED, TXN_NOT_DUPLICATE_COPY]
