"""Reusable SQL conditions on transactions and journal lines."""
from sqlalchemy import and_, exists, not_, or_, select

from ..models import (
    BankAccount, BankStatement, JournalEntryLine, ReconciliationMatch, Transaction, TransactionStatus,
)

TXN_IS_TRANSFER = Transaction.status == TransactionStatus.TRANSFER
TXN_NOT_TRANSFER = or_(Transaction.status.is_(None), Transaction.status != TransactionStatus.TRANSFER)
TXN_NOT_REVIEW = or_(Transaction.status.is_(None), Transaction.status != TransactionStatus.NEEDS_REVIEW)
TXN_NOT_DUPLICATE_COPY = Transaction.duplicate_of_id.is_(None)

# No category or sub-category allotted (or explicitly UNCATEGORIZED), transfers excepted.
TXN_UNCATEGORIZED = and_(
    or_(Transaction.category_id.is_(None), Transaction.sub_category_id.is_(None),
        Transaction.status == TransactionStatus.UNCATEGORIZED),
    TXN_NOT_TRANSFER,
)

# What every report counts: not a duplicate copy, not a transfer, categorized and not in review.
TXN_REPORTABLE = and_(TXN_NOT_DUPLICATE_COPY, TXN_NOT_TRANSFER, Transaction.category_id.is_not(None), TXN_NOT_REVIEW)

# Not reportable yet (no category, or a suggestion still waiting in Needs Review) - transfers excepted.
TXN_UNREPORTED = and_(TXN_NOT_TRANSFER, or_(Transaction.category_id.is_(None),
                                             Transaction.status == TransactionStatus.NEEDS_REVIEW))

TXN_MATCHED = exists(select(ReconciliationMatch.id).where(ReconciliationMatch.transaction_id == Transaction.id))
TXN_UNMATCHED = not_(TXN_MATCHED)
LINE_MATCHED = exists(select(ReconciliationMatch.id).where(ReconciliationMatch.journal_line_id == JournalEntryLine.id))
LINE_UNMATCHED = not_(LINE_MATCHED)

# A line on some bank account's GL account (only those can be reconciled).
LINE_IS_BANK = JournalEntryLine.sub_category_id.in_(
    select(BankAccount.gl_account_id).where(BankAccount.gl_account_id.is_not(None)))


def txn_of_account(account_id):
    return Transaction.statement_id.in_(select(BankStatement.id).where(BankStatement.account_id == account_id))


def txn_of_accounts(account_ids):
    return Transaction.statement_id.in_(select(BankStatement.id).where(BankStatement.account_id.in_(account_ids)))
