"""Helpers shared by the routers: service errors -> API errors, confirmation flags, final-lock guards."""
from typing import Optional

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..errors import APIError, bad_request
from ..models import Transaction, TransactionStatus
from ..services import period_close
from ..services import reconciliation as recon
from ..utils import is_true


def period_guard(check, *args, **kwargs) -> None:
    """Runs a services.period_close guard, turning a closed-period refusal into a 400."""
    try:
        check(*args, **kwargs)
    except period_close.PeriodClosedError as exc:
        raise bad_request(str(exc))


def reconcile_guard(check, *args, **kwargs) -> None:
    """Runs a reconciliation guard: a signed-off month -> 400, reconciled items without
    confirmation -> 409 {"error", "requires_confirmation", "reconciled"}."""
    try:
        check(*args, **kwargs)
    except recon.UnmatchConfirmationRequired as exc:
        raise APIError(409, {'error': [str(exc)], 'requires_confirmation': True, 'reconciled': exc.reconciled})
    except recon.ReconciliationError as exc:
        raise bad_request(str(exc))


def flag(request: Request, name: str, body: Optional[dict] = None) -> bool:
    """A true/false option given as ?name= or in the JSON / form body."""
    value = request.query_params.get(name)
    if value is None and body:
        value = body.get(name)
    return is_true(value)


def confirm_unmatch(request: Request, body: Optional[dict] = None) -> bool:
    return flag(request, 'confirm_unmatch', body)


def reject_if_statement_has_final(db: Session, statement_id: int) -> None:
    n = db.scalar(select(func.count(Transaction.id)).where(Transaction.statement_id == statement_id,
                                                            Transaction.is_final.is_(True)))
    if n:
        raise bad_request(f'This statement has {n} final transaction(s). Reopen them first to delete or re-parse the statement.')


def reject_if_final(txn: Transaction) -> None:
    if txn.is_final:
        raise bad_request('This transaction is final. Reopen it first to change or delete it.')


def categorized_status(sub_category_id, manual: bool) -> TransactionStatus:
    """Status for a transaction a human has categorized or confirmed: MANUAL when picked by hand,
    AUTO_ASSIGNED when it confirms the engine's own pick, UNCATEGORIZED when the sub-category was cleared."""
    if not sub_category_id:
        return TransactionStatus.UNCATEGORIZED
    return TransactionStatus.MANUAL if manual else TransactionStatus.AUTO_ASSIGNED


def bulk_row_errors(exc) -> list[str]:
    """Pydantic errors for a list of rows -> ['Row 2: name: Field required', ...]."""
    messages = []
    for err in exc.errors():
        loc = err.get('loc', ())
        row = loc[0] + 1 if loc and isinstance(loc[0], int) else '?'
        field = '.'.join(str(p) for p in loc[1:]) or 'row'
        messages.append(f'Row {row}: {field}: {err.get("msg")}')
    return messages
