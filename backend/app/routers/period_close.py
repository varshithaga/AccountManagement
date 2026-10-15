"""Period Close: closing / reopening the books, the financial year and the default control accounts."""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from ..access import EDIT
from ..database import get_db
from ..deps import Access
from ..errors import bad_request, field_error
from ..models import SubCategory, User
from ..schemas import AccountingSettingsIn, PeriodCloseIn
from ..services import period_close
from ..services.settings import accounting_settings

router = APIRouter(prefix="/api/period-close", tags=["period close"])
view = Access("period_close")
edit = Access("period_close", action=EDIT)

COMPANY_FIELDS = {  # field: max length
    "company_name": 200, "company_gstin": 15, "company_state": 100, "company_address": 2000,
    "company_email": 254, "company_phone": 30,
}


def _company(settings) -> dict:
    return {field.removeprefix("company_"): getattr(settings, field) or "" for field in COMPANY_FIELDS}


def _as_of(value) -> Optional[date]:
    try:
        return date.fromisoformat(str(value or "").strip())
    except ValueError:
        return None


def _state(db: Session) -> dict:
    settings = accounting_settings(db)
    start, end = period_close.fiscal_year_bounds(db)
    closed = period_close.closed_through(db)
    db.commit()
    return {
        "closed_through": closed.isoformat() if closed else None,
        "history": period_close.closing_history(db),
        "fiscal_year_start_month": settings.fiscal_year_start_month,
        "current_fiscal_year": {"start": start.isoformat(), "end": end.isoformat()},
        "default_receivable_account": settings.default_receivable_account_id,
        "default_payable_account": settings.default_payable_account_id,
        "default_cash_account": settings.default_cash_account_id,
        "company": _company(settings),
    }


@router.get("/company/", dependencies=[Depends(Access())])
def company(db: Session = Depends(get_db)):
    """The company's name, GSTIN, state and contact details - printed on invoices (any signed-in user)."""
    return _company(accounting_settings(db))


@router.get("/", dependencies=[Depends(view)])
def get_state(db: Session = Depends(get_db)):
    """How far the books are closed, the close history, the financial year and the default accounts."""
    return _state(db)


@router.put("/", dependencies=[Depends(edit)])
def update_settings(body: AccountingSettingsIn, db: Session = Depends(get_db)):
    """{"fiscal_year_start_month": 1-12, "default_receivable_account", "default_payable_account",
    "default_cash_account"} - every field optional."""
    settings = accounting_settings(db)
    data = body.model_dump(exclude_unset=True)
    if "fiscal_year_start_month" in data:
        try:
            month = int(data["fiscal_year_start_month"])
        except (TypeError, ValueError):
            month = 0
        if not 1 <= month <= 12:
            raise bad_request("fiscal_year_start_month must be a month number from 1 to 12.")
        settings.fiscal_year_start_month = month
    for field in ("default_receivable_account", "default_payable_account", "default_cash_account"):
        if field in data:
            if data[field] is not None and not db.get(SubCategory, data[field]):
                raise field_error(field, f'Invalid pk "{data[field]}" - object does not exist.')
            setattr(settings, f"{field}_id", data[field])
    for field, limit in COMPANY_FIELDS.items():
        if field in data:
            value = " ".join(str(data[field] or "").split()) if field != "company_address" else str(data[field] or "").strip()
            if len(value) > limit:
                raise field_error(field, f"Ensure this field has no more than {limit} characters.")
            if field == "company_gstin":
                value = value.upper()
                if value and len(value) != 15:
                    raise field_error(field, "A GSTIN has 15 characters.")
            setattr(settings, field, value)
    db.commit()
    return _state(db)


@router.get("/readiness/", dependencies=[Depends(view)])
def readiness(as_of: Optional[str] = None, db: Session = Depends(get_db)):
    """What would stop (or deserves a look before) closing the books through ?as_of=YYYY-MM-DD."""
    day = _as_of(as_of)
    if not day:
        raise bad_request("as_of must be a YYYY-MM-DD date.")
    return period_close.readiness(db, day)


@router.post("/close/", status_code=201)
def close(body: PeriodCloseIn, db: Session = Depends(get_db), user: User = Depends(edit)):
    """{"as_of": "YYYY-MM-DD", "note": ""} - closes the books through as_of."""
    day = _as_of(body.as_of)
    if not day:
        raise bad_request("as_of must be a YYYY-MM-DD date.")
    try:
        period_close.close_books(db, day, user=user, note=body.note or "")
    except period_close.PeriodClosedError as exc:
        raise bad_request(str(exc))
    return _state(db)


@router.post("/reopen/", dependencies=[Depends(edit)])
def reopen(db: Session = Depends(get_db)):
    """Reopens the latest close (the previous one, if any, applies again)."""
    try:
        period_close.reopen_books(db)
    except period_close.PeriodClosedError as exc:
        raise bad_request(str(exc))
    return _state(db)
