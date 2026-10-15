"""Audit log: who created, changed, posted, cancelled or deleted what, and when.

Every flush is watched (after_flush): new, changed and deleted business records get an AuditLog
row in the same transaction, so a rolled-back request leaves no trace and a committed one
always has its log. The user comes from session.info["actor"], set by get_current_user for
every signed-in request; anything else (CLI, seeding) is logged as "system".

Bank transactions, journal lines and other bulk / derived rows are not logged one by one -
the actions that change them in bulk (make final, reopen, post to books) call record() with a
summary instead. When one flush touches many records of one kind (an import), they are logged
as a single row with the count.
"""
import enum
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import event, insert, inspect
from sqlalchemy.orm import Session

from ..models import (
    AccountingSettings, AuditLog, BaiCode, BankAccount, BankStatement, BookClosing, CategorizationSettings, Category,
    CategoryKeyword, Client, CreditNote, JournalEntry, JournalImportBatch, Payment, PaymentAllocation, Product,
    PurchaseBill, ReconciliationPeriod, ReconciliationSettings, Role, SalesInvoice, SubCategory, Supplier, TaxRate,
    User,
)

# Tracked models and the field that names a record in the log.
TRACKED: dict[type, Optional[str]] = {
    User: 'username', Role: 'name', Category: 'name', SubCategory: 'name', CategoryKeyword: 'keyword', BaiCode: 'code',
    BankAccount: 'name', BankStatement: 'file_path', JournalImportBatch: 'source_name', JournalEntry: 'entry_number',
    Client: 'name', Supplier: 'name', Product: 'name', TaxRate: 'name', SalesInvoice: 'invoice_number',
    PurchaseBill: 'bill_number', CreditNote: 'note_number', Payment: 'payment_number', PaymentAllocation: None,
    ReconciliationPeriod: 'period_end', BookClosing: 'closed_through', AccountingSettings: None,
    CategorizationSettings: None, ReconciliationSettings: None,
}
# Never written to the log; a change to one is logged as "changed" without the values.
SECRET_FIELDS = {'hashed_password', 'file_hash'}
# Bookkeeping columns that change by themselves.
SKIPPED_FIELDS = {'id', 'created_at', 'uploaded_at', 'imported_at', 'reconciled_at', 'closed_at', 'date_joined',
                  'last_login'}
# Child collections whose replacement counts as a change of the parent.
CHILD_COLLECTIONS = ('items', 'lines')
# More records of one kind than this in one flush are logged as one summary row.
BULK_THRESHOLD = 20
STATUS_ACTIONS = {'POSTED': 'POST', 'CANCELLED': 'CANCEL'}


def set_actor(db: Session, user: Optional[User]) -> None:
    """Records who the session's changes are made by."""
    db.info['actor'] = (user.id, user.username) if user else None


def _actor(db: Session) -> tuple[Optional[int], str]:
    return db.info.get('actor') or (None, 'system')


def _json(value: Any) -> Any:
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, str) and len(value) > 300:
        return value[:300] + '…'
    if isinstance(value, (list, dict, int, float, bool, str)) or value is None:
        return value
    return str(value)


def _is_tracked(obj) -> bool:
    if type(obj) not in TRACKED:
        return False
    # Only hand-made journal entries; posted documents and bank postings are logged through their document.
    if isinstance(obj, JournalEntry):
        return obj.origin == 'MANUAL'
    return True


def _label(obj) -> str:
    field = TRACKED.get(type(obj))
    loaded = obj.__dict__  # only what is already loaded - no queries in the middle of a flush
    if isinstance(obj, PaymentAllocation):
        doc = loaded.get('sales_invoice') or loaded.get('purchase_bill')
        fallback = f'invoice {obj.sales_invoice_id}' if obj.sales_invoice_id else f'bill {obj.purchase_bill_id}'
        number = getattr(doc, 'invoice_number', None) or getattr(doc, 'bill_number', None) or fallback
        payment = loaded.get('payment')
        return f'{payment.payment_number if payment else f"payment {obj.payment_id}"} → {number}'
    if isinstance(obj, ReconciliationPeriod):
        account = loaded.get('bank_account')
        return f'{account.name if account else f"bank account {obj.bank_account_id}"} · {obj.period_end}'
    value = getattr(obj, field, None) if field else None
    return str(_json(value) or '')[:200] if value is not None else ''


def _columns(obj):
    return [attr for attr in inspect(obj).mapper.column_attrs if attr.key not in SKIPPED_FIELDS]


def _snapshot(obj) -> dict:
    data = {}
    for attr in _columns(obj):
        if attr.key in SECRET_FIELDS:
            continue
        value = getattr(obj, attr.key, None)
        if value not in (None, '', [], {}):
            data[attr.key] = _json(value)
    return data


def _changes(obj) -> dict:
    state = inspect(obj)
    changes = {}
    for attr in _columns(obj):
        history = state.attrs[attr.key].history
        if not history.has_changes():
            continue
        old = history.deleted[0] if history.deleted else None
        new = history.added[0] if history.added else None
        if old == new:
            continue
        changes[attr.key] = 'changed' if attr.key in SECRET_FIELDS else [_json(old), _json(new)]
    for name in CHILD_COLLECTIONS:
        if name in state.mapper.relationships and state.attrs[name].history.has_changes():
            changes[name] = 'changed'
    return changes


def _update_action(changes: dict) -> str:
    status = changes.get('status')
    if isinstance(status, list) and status[1] in STATUS_ACTIONS and status[0] != status[1]:
        return STATUS_ACTIONS[status[1]]
    if set(changes) == {'hashed_password'}:
        return 'PASSWORD'
    return 'UPDATE'


@event.listens_for(Session, 'after_flush')
def _log_flush(session: Session, _flush_context) -> None:
    rows = []
    for obj in session.new:
        if _is_tracked(obj):
            rows.append(('CREATE', obj, _snapshot(obj)))
    for obj in session.dirty:
        if _is_tracked(obj) and session.is_modified(obj):
            changes = _changes(obj)
            if changes:
                rows.append((_update_action(changes), obj, changes))
    for obj in session.deleted:
        if _is_tracked(obj):
            rows.append(('DELETE', obj, _snapshot(obj)))
    if not rows:
        return

    user_id, username = _actor(session)
    groups: dict[tuple[str, str], list] = {}
    for action, obj, changes in rows:
        groups.setdefault((action, type(obj).__name__), []).append((obj, changes))
    values = []
    for (action, entity), members in groups.items():
        if len(members) > BULK_THRESHOLD:
            values.append({'user_id': user_id, 'username': username, 'action': action, 'entity': entity,
                           'entity_id': None, 'label': f'{len(members)} records',
                           'changes': {'count': len(members), 'ids': [o.id for o, _ in members[:200]]}})
            continue
        for obj, changes in members:
            values.append({'user_id': user_id, 'username': username, 'action': action, 'entity': entity,
                           'entity_id': obj.id, 'label': _label(obj), 'changes': changes or None})
    session.connection().execute(insert(AuditLog.__table__), values)


def record(db: Session, action: str, entity: str, label: str = '', entity_id: Optional[int] = None,
           changes: Optional[dict] = None, user: Optional[User] = None, username: Optional[str] = None) -> None:
    """Logs something the automatic tracking doesn't see - a sign-in, a bulk action. Part of the
    caller's transaction: it is saved with the caller's commit."""
    actor_id, actor_name = (user.id, user.username) if user else _actor(db)
    db.add(AuditLog(user_id=actor_id, username=username or actor_name, action=action, entity=entity,
                    entity_id=entity_id, label=label[:200], changes={k: _json(v) for k, v in (changes or {}).items()} or None))
