"""Statement continuity: does each bank statement follow on from the one before it?"""
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import BankAccount, BankStatement, Transaction
from ..utils import now

TOLERANCE = Decimal('0.01')

# Issue codes, most severe first - the first one present is a statement's headline issue.
ISSUE_OVERLAP = 'OVERLAP'                    # starts before the previous statement ended
ISSUE_MISSING_PERIOD = 'MISSING_PERIOD'      # days missing AND the balance jumped
ISSUE_BALANCE_GAP = 'BALANCE_GAP'            # opening != previous closing, no missing days
ISSUE_INTERNAL_MISMATCH = 'INTERNAL_MISMATCH'  # opening + credits - debits != closing
ISSUE_PRIORITY = [ISSUE_OVERLAP, ISSUE_MISSING_PERIOD, ISSUE_BALANCE_GAP, ISSUE_INTERNAL_MISMATCH]


def _fmt(amount):
    return f'{amount:,.2f}'


def file_name(stmt) -> str:
    path = getattr(stmt, 'file_path', '') or ''
    return path.rsplit('/', 1)[-1]


def _annotated_statements(db: Session, account_id=None, account_ids=None) -> list:
    """Statements with their transaction date range and totals, in chronological order."""
    stmt = (select(BankStatement, func.min(Transaction.date), func.max(Transaction.date),
                   func.sum(Transaction.debit), func.sum(Transaction.credit))
            .outerjoin(Transaction, Transaction.statement_id == BankStatement.id)
            .group_by(BankStatement.id))
    if account_id and str(account_id).upper() != 'ALL':
        stmt = stmt.where(BankStatement.account_id == int(account_id))
    if account_ids is not None:
        stmt = stmt.where(BankStatement.account_id.in_(account_ids))
    rows = []
    for s, min_date, max_date, tot_debit, tot_credit in db.execute(stmt):
        rows.append(SimpleNamespace(
            id=s.id, account_id=s.account_id, file_path=s.file_path, uploaded_at=s.uploaded_at,
            opening_balance=s.opening_balance, closing_balance=s.closing_balance,
            min_date=min_date, max_date=max_date, tot_debit=tot_debit, tot_credit=tot_credit,
        ))
    # Chronological by the statement's own transaction dates (not upload order), so a
    # late-uploaded older statement still slots in between the right neighbours.
    rows.sort(key=_chronological_key)
    return rows


def _chronological_key(s):
    # SQLite hands back naive datetimes, so compare upload times as plain timestamps.
    uploaded = s.uploaded_at.replace(tzinfo=None).timestamp() if s.uploaded_at else 0
    return (s.account_id, s.min_date is None, s.min_date or date.min, s.max_date or date.min, uploaded, s.id)


NEW_STATEMENT_ID = -1


def check_new_statement(db: Session, account_id, rows, opening_balance, closing_balance, name='') -> list[dict]:
    """Continuity problems a statement made of the parsed `rows` would have if it were uploaded
    to the account now - with the statement before it, and with the one after it.
    Returns [] when it fits in cleanly."""
    if not rows:
        return []
    new = SimpleNamespace(
        id=NEW_STATEMENT_ID, account_id=account_id, file_path=name, uploaded_at=now(),
        min_date=min(r.date for r in rows), max_date=max(r.date for r in rows),
        tot_debit=sum((r.debit for r in rows), Decimal('0')), tot_credit=sum((r.credit for r in rows), Decimal('0')),
        opening_balance=opening_balance, closing_balance=closing_balance,
    )
    stmts = sorted(_annotated_statements(db, account_id) + [new], key=_chronological_key)
    cmap = get_statement_continuity_map(db, statements=stmts)

    problems = []
    mine = cmap[NEW_STATEMENT_ID]
    if mine['issues']:
        problems.append({'position': 'this', 'file': name, 'issue': mine['primary_issue'], 'message': mine['gap_message']})
    after = next((s for s in stmts if cmap[s.id]['previous_statement_id'] == NEW_STATEMENT_ID), None)
    if after is not None and cmap[after.id]['issues']:
        c = cmap[after.id]
        problems.append({'position': 'next', 'file': file_name(after), 'issue': c['primary_issue'],
                         'message': f'The next statement ({file_name(after)}) would not follow on from this one: {c["gap_message"]}'})
    return problems


def continuity_for_accounts(db: Session, account_ids) -> dict:
    """Continuity for several accounts in one query - {account_id: {statement_id: result}}."""
    account_ids = set(account_ids)
    by_account = {a: {} for a in account_ids}
    if not account_ids:
        return by_account
    stmts = _annotated_statements(db, account_ids=account_ids)
    cmap = get_statement_continuity_map(db, statements=stmts)
    for s in stmts:
        by_account[s.account_id][s.id] = cmap[s.id]
    return by_account


def get_statement_continuity_map(db: Session, account_id=None, statements=None) -> dict:
    """statement_id -> continuity result. Per account, in chronological order, checks:
    1. Balance continuity: previous statement's closing balance == this opening balance.
    2. Date continuity: missing days (an issue only when the balance also jumped) or an overlap.
    3. Internal running balance: opening + total credits - total debits == closing."""
    result = {}
    prev_by_account = {}

    for stmt in statements if statements is not None else _annotated_statements(db, account_id):
        prev_stmt = prev_by_account.get(stmt.account_id)
        start_date, end_date = stmt.min_date, stmt.max_date
        tot_debit = stmt.tot_debit or Decimal('0')
        tot_credit = stmt.tot_credit or Decimal('0')
        issues = []
        messages = []

        internal_discrepancy = None
        if stmt.opening_balance is not None and stmt.closing_balance is not None:
            diff = stmt.opening_balance + tot_credit - tot_debit - stmt.closing_balance
            if abs(diff) > TOLERANCE:
                internal_discrepancy = float(diff)
                issues.append(ISSUE_INTERNAL_MISMATCH)
                messages.append(
                    f'Internal math mismatch: opening + credits - debits differs from the closing '
                    f'balance by {diff:+,.2f}. Some rows may have been parsed into the wrong column.'
                )

        balance_gap = None
        date_gap_days = 0
        overlap_days = 0
        missing_from = missing_to = None
        prev_close = prev_stmt.closing_balance if prev_stmt else None

        if prev_stmt:
            if prev_close is not None and stmt.opening_balance is not None:
                gap = stmt.opening_balance - prev_close
                if abs(gap) > TOLERANCE:
                    balance_gap = float(gap)

            prev_end = prev_stmt.max_date
            if prev_end and start_date:
                delta_days = (start_date - prev_end).days - 1
                if delta_days > 0:
                    date_gap_days = delta_days
                    missing_from = prev_end + timedelta(days=1)
                    missing_to = start_date - timedelta(days=1)
                elif start_date < prev_end:
                    # Starting on the day the previous one ended is normal; starting earlier is an overlap.
                    overlap_days = (prev_end - start_date).days

            if overlap_days:
                issues.insert(0, ISSUE_OVERLAP)
                messages.insert(0,
                    f'Overlapping period: starts {start_date}, but the previous statement already runs '
                    f'to {prev_end} ({overlap_days} day(s) overlap). The same transactions may be '
                    f'uploaded twice.'
                    + (f' Balance difference: {balance_gap:+,.2f}.' if balance_gap is not None else ''))
            elif balance_gap is not None and date_gap_days:
                issues.insert(0, ISSUE_MISSING_PERIOD)
                messages.insert(0,
                    f'Missing statement: {date_gap_days} day(s) missing ({missing_from} to {missing_to}) '
                    f'and the balance moved by {balance_gap:+,.2f}. Upload the statement for that period.')
            elif balance_gap is not None:
                issues.insert(0, ISSUE_BALANCE_GAP)
                messages.insert(0,
                    f'Balance mismatch: previous statement closed at {_fmt(prev_close)}, but this one opens '
                    f'at {_fmt(stmt.opening_balance)} (difference {balance_gap:+,.2f}). A statement or '
                    f'transactions between them may be missing.')

        result[stmt.id] = {
            'start_date': start_date.isoformat() if start_date else None,
            'end_date': end_date.isoformat() if end_date else None,
            'is_continuous': not issues,
            'issues': issues,
            'primary_issue': issues[0] if issues else None,
            'balance_gap': balance_gap,
            'date_gap_days': date_gap_days,
            'overlap_days': overlap_days,
            'missing_from': missing_from.isoformat() if missing_from else None,
            'missing_to': missing_to.isoformat() if missing_to else None,
            'is_internal_balanced': internal_discrepancy is None,
            'internal_discrepancy': internal_discrepancy,
            'gap_message': ' | '.join(messages) or None,
            'has_previous': prev_stmt is not None,
            'previous_statement_id': prev_stmt.id if prev_stmt else None,
            'previous_closing_balance': float(prev_close) if prev_close is not None else None,
        }

        # A statement with no transactions has no period - don't chain the next one off it.
        if start_date is not None:
            prev_by_account[stmt.account_id] = stmt

    return result


STATUS_ISSUES = 'issues'
STATUS_CONTINUOUS = 'continuous'
STATUS_EMPTY = 'empty'


def _blank_account(account: BankAccount) -> dict:
    return {
        'account_id': account.id,
        'account_name': account.name,
        'bank_name': account.bank_name,
        'total_statements': 0,
        'continuous_count': 0,
        'gap_count': 0,
        'issue_counts': {code: 0 for code in ISSUE_PRIORITY},
        'total_missing_days': 0,
        'total_balance_gaps': 0.0,
        'coverage_start': None,
        'coverage_end': None,
        'latest_closing_balance': None,
        'latest_end_date': None,
    }


def in_window(stmt, date_from=None, date_to=None) -> bool:
    """Whether a statement's period overlaps [date_from, date_to]. No window means every statement;
    with a window, statements with no transactions (no period) are left out."""
    if date_from is None and date_to is None:
        return True
    if stmt.min_date is None:
        return False
    if date_from is not None and stmt.max_date < date_from:
        return False
    if date_to is not None and stmt.min_date > date_to:
        return False
    return True


def _rollups_and_chain(db: Session, date_from=None, date_to=None):
    """(per-account rollups, all statements, continuity map). Counts are limited to statements
    overlapping the window, but continuity is worked out over each account's full chain."""
    all_stmts = _annotated_statements(db)
    cmap = get_statement_continuity_map(db, statements=all_stmts)
    stmts = [s for s in all_stmts if in_window(s, date_from, date_to)]

    accounts = {a.id: _blank_account(a) for a in db.scalars(select(BankAccount).where(BankAccount.is_active.is_(True)))}
    missing_ids = {s.account_id for s in all_stmts} - accounts.keys()
    if missing_ids:
        for a in db.scalars(select(BankAccount).where(BankAccount.id.in_(missing_ids))):
            accounts[a.id] = _blank_account(a)

    for stmt in stmts:
        acct = accounts[stmt.account_id]
        c = cmap[stmt.id]
        acct['total_statements'] += 1
        if c['is_continuous']:
            acct['continuous_count'] += 1
        else:
            acct['gap_count'] += 1
        for code in c['issues']:
            acct['issue_counts'][code] += 1
        if ISSUE_MISSING_PERIOD in c['issues']:
            acct['total_missing_days'] += c['date_gap_days']
        if c['balance_gap'] is not None:
            acct['total_balance_gaps'] += abs(c['balance_gap'])
        if c['start_date']:
            acct['coverage_start'] = acct['coverage_start'] or c['start_date']
            acct['coverage_end'] = c['end_date']

    for stmt in all_stmts:
        if stmt.min_date is not None:
            acct = accounts[stmt.account_id]
            acct['latest_end_date'] = stmt.max_date.isoformat()
            acct['latest_closing_balance'] = float(stmt.closing_balance) if stmt.closing_balance is not None else None

    for acct in accounts.values():
        acct['status'] = (STATUS_EMPTY if not acct['total_statements']
                          else STATUS_ISSUES if acct['gap_count'] else STATUS_CONTINUOUS)
    return sorted(accounts.values(), key=lambda a: a['account_name'].lower()), all_stmts, cmap


def filter_account_rollups(rollups, search=None, bank_name=None, status=None, issue=None, account_id=None):
    if account_id:
        rollups = [a for a in rollups if a['account_id'] == int(account_id)]
    if search:
        term = search.strip().lower()
        rollups = [a for a in rollups if term in a['account_name'].lower() or term in (a['bank_name'] or '').lower()]
    if bank_name:
        rollups = [a for a in rollups if (a['bank_name'] or '') == bank_name]
    if status:
        rollups = [a for a in rollups if a['status'] == status]
    if issue:
        rollups = [a for a in rollups if a['issue_counts'].get(issue)]
    return rollups


def list_account_continuity(db: Session, date_from=None, date_to=None, **filters) -> list[dict]:
    return filter_account_rollups(_rollups_and_chain(db, date_from, date_to)[0], **filters)


def get_continuity_summary(db: Session, date_from=None, date_to=None, **filters) -> dict:
    return _summarize(filter_account_rollups(_rollups_and_chain(db, date_from, date_to)[0], **filters))


def _summarize(accounts) -> dict:
    with_statements = [a for a in accounts if a['total_statements']]
    return {
        'total_accounts': len(accounts),
        'accounts_with_statements': len(with_statements),
        'accounts_continuous': sum(1 for a in with_statements if a['status'] == STATUS_CONTINUOUS),
        'accounts_with_issues': sum(1 for a in accounts if a['status'] == STATUS_ISSUES),
        'accounts_without_statements': len(accounts) - len(with_statements),
        'total_statements': sum(a['total_statements'] for a in accounts),
        'statements_with_issues': sum(a['gap_count'] for a in accounts),
        'issue_counts': {code: sum(a['issue_counts'][code] for a in accounts) for code in ISSUE_PRIORITY},
        'total_missing_days': sum(a['total_missing_days'] for a in accounts),
        'unaccounted_balance': round(sum(a['total_balance_gaps'] for a in accounts), 2),
    }


def list_continuity_banks(db: Session) -> list[dict]:
    counts: dict = {}
    for name in db.scalars(select(BankAccount.bank_name)):
        if name:
            counts[name] = counts.get(name, 0) + 1
    return [{'bank_name': name, 'account_count': n} for name, n in sorted(counts.items(), key=lambda kv: kv[0].lower())]


def get_continuity_page(db: Session, date_from=None, date_to=None, **filters):
    """(filtered account rollups, summary over them, a timeline builder) from one pass."""
    rollups, all_stmts, cmap = _rollups_and_chain(db, date_from, date_to)
    accounts = filter_account_rollups(rollups, **filters)

    def timeline(account_id):
        return _timeline_rows([s for s in all_stmts if s.account_id == account_id], cmap, date_from, date_to)

    return accounts, _summarize(accounts), timeline


def get_account_timeline(db: Session, account_id, date_from=None, date_to=None) -> list[dict]:
    stmts = _annotated_statements(db, account_id)
    return _timeline_rows(stmts, get_statement_continuity_map(db, statements=stmts), date_from, date_to)


def _timeline_rows(stmts, cmap, date_from, date_to) -> list[dict]:
    return [{
        'id': stmt.id,
        'file': file_name(stmt),
        'uploaded_at': stmt.uploaded_at.isoformat() if stmt.uploaded_at else None,
        'opening_balance': float(stmt.opening_balance) if stmt.opening_balance is not None else None,
        'closing_balance': float(stmt.closing_balance) if stmt.closing_balance is not None else None,
        'continuity': cmap[stmt.id],
    } for stmt in stmts if in_window(stmt, date_from, date_to)]
