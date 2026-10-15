"""Step 1 of the categorization engine: detect transfers between the company's own bank accounts.

If the same amount leaves one bank account and enters a different bank account within a
configurable date window - and one of the descriptions names a registered company bank
account - both legs are marked as a Transfer and excluded from every further categorization
step. A transfer is neither income nor an expense, so it never gets a Category/SubCategory
and never counts towards the reports or the "uncategorized" metrics.

Runs globally (not scoped to one statement/account) since a transfer's matching leg is, by
definition, on a *different* bank account that may already be sitting in an earlier statement.
"""
import re
from collections import defaultdict
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..models import BankAccount, BankStatement, CategorizationSource, Transaction, TransactionStatus
from .filters import TXN_NOT_TRANSFER
from .settings import categorization_settings


def _get_bank_account_tokens(db: Session) -> set[str]:
    """Normalized bank names, account numbers and account-name words of every registered BankAccount."""
    tokens = set()
    for acct in db.scalars(select(BankAccount)):
        for text in (acct.name, acct.bank_name, acct.account_number):
            if text:
                tokens.update(re.findall(r'[A-Za-z0-9]{3,}', str(text).upper()))
    return tokens


def _has_transfer_signal(out_txn: Transaction, in_txn: Transaction, bank_tokens: set[str]) -> bool:
    desc_out = (out_txn.description or '').upper()
    desc_in = (in_txn.description or '').upper()
    return any(token in desc_out or token in desc_in for token in bank_tokens)


def detect_transfers(db: Session, window_days: Optional[int] = None) -> int:
    """Pairs unconfirmed, non-transfer withdrawals and deposits of the same amount on two different
    accounts within the window, when either description references a company bank account.
    Returns how many pairs were found."""
    if window_days is None:
        window_days = categorization_settings(db).transfer_date_window_days

    candidates = db.scalars(
        select(Transaction).where(Transaction.confirmed.is_(False), TXN_NOT_TRANSFER)
        .options(joinedload(Transaction.statement))
    ).all()
    account_of = {t.id: t.statement.account_id for t in candidates}
    bank_tokens = _get_bank_account_tokens(db)

    outs = [t for t in candidates if t.debit and t.debit > 0]
    ins_by_amount: dict[Decimal, list[Transaction]] = defaultdict(list)
    for t in candidates:
        if t.credit and t.credit > 0:
            ins_by_amount[t.credit].append(t)

    matched_ids: set[int] = set()
    pair_count = 0

    for out_txn in outs:
        if out_txn.id in matched_ids:
            continue
        best_in = None
        best_delta = None

        for in_txn in ins_by_amount.get(out_txn.debit, ()):
            if in_txn.id == out_txn.id or in_txn.id in matched_ids:
                continue
            if account_of[in_txn.id] == account_of[out_txn.id]:
                continue  # must be a DIFFERENT bank account
            delta = abs((in_txn.date - out_txn.date).days)
            if delta > window_days:
                continue
            if not _has_transfer_signal(out_txn, in_txn, bank_tokens):
                continue
            if best_delta is None or delta < best_delta:
                best_in, best_delta = in_txn, delta

        if best_in is None:
            continue

        matched_ids.update((out_txn.id, best_in.id))
        pair_count += 1
        for leg, other in ((out_txn, best_in), (best_in, out_txn)):
            leg.status = TransactionStatus.TRANSFER
            leg.categorization_source = CategorizationSource.TRANSFER
            leg.category_id = None
            leg.sub_category_id = None
            leg.confidence_score = None
            leg.score_breakdown = None
            leg.scoring_clues = ''
            leg.transfer_pair_id = other.id

    db.commit()
    return pair_count
