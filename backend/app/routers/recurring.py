"""Recurring invoices: templates that raise a sales invoice every month / quarter / half-year / year."""
from typing import Optional

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from .. import serializers as ser
from ..database import get_db
from ..deps import Access
from ..errors import bad_request
from ..models import Frequency, RecurringInvoice, SalesInvoice, User
from ..schemas import RecurringInvoiceIn
from ..services import audit, invoicing, recurring
from ..utils import apply_search, get_or_404, is_true, paginate, today

router = APIRouter(prefix="/api/recurring-invoices", tags=["recurring invoices"])
access = Access("recurring_invoices")


def _stmt():
    return select(RecurringInvoice).options(joinedload(RecurringInvoice.client), joinedload(RecurringInvoice.created_by))


def _apply(db: Session, template: RecurringInvoice, body: RecurringInvoiceIn) -> None:
    data = body.model_dump(exclude_unset=True)
    if "items" in data:
        data["items"] = [i.model_dump(exclude_unset=True, mode="json") for i in body.items or []]
    if "frequency" in data:
        try:
            data["frequency"] = Frequency(str(data["frequency"]).upper())
        except ValueError:
            raise bad_request("frequency must be MONTHLY, QUARTERLY, HALF_YEARLY or YEARLY.")
    for field in ("name", "notes"):
        if field in data:
            data[field] = (data[field] or "").strip()
    start_changed = "start_date" in data and data["start_date"] != template.start_date
    for field, value in data.items():
        setattr(template, field, value)
    if template.start_date is None:
        raise bad_request("start_date is required.")
    # A new template (or a moved start) begins at the start date unless next_date is given.
    if "next_date" not in data and (template.next_date is None or start_changed):
        template.next_date = template.start_date
    if template.next_date < template.start_date:
        raise bad_request("The next invoice date cannot be before the start date.")
    template.last_error = ""
    try:
        recurring.validate(db, template)
    except invoicing.InvoicingError as exc:
        raise bad_request(str(exc))


@router.get("/", dependencies=[Depends(access)])
def list_templates(search: Optional[str] = None, is_active: Optional[str] = None, page: Optional[str] = None,
                   limit: Optional[str] = None, db: Session = Depends(get_db)):
    stmt = apply_search(_stmt(), search, RecurringInvoice.name, RecurringInvoice.notes)
    if is_active is not None:
        stmt = stmt.where(RecurringInvoice.is_active.is_(is_true(is_active)))
    data = paginate(db, stmt.order_by(RecurringInvoice.next_date, RecurringInvoice.id), page, limit,
                    ser.recurring_invoice)
    data["due"] = recurring.due_count(db)
    return data


@router.post("/", status_code=201)
def create_template(body: RecurringInvoiceIn, db: Session = Depends(get_db), user: User = Depends(access)):
    template = RecurringInvoice(created_by_id=user.id, items=[], notes="", name="", is_active=True,
                                auto_post=False, invoices_created=0, frequency=Frequency.MONTHLY)
    _apply(db, template, body)
    db.add(template)
    db.commit()
    return ser.recurring_invoice(db.scalar(_stmt().where(RecurringInvoice.id == template.id)))


@router.get("/{template_id:int}/", dependencies=[Depends(access)])
def get_template(template_id: int, db: Session = Depends(get_db)):
    template = get_or_404(db, RecurringInvoice, template_id, "RecurringInvoice")
    data = ser.recurring_invoice(template)
    data["invoices"] = [{"id": i.id, "invoice_number": i.invoice_number, "invoice_date": i.invoice_date.isoformat(),
                         "total": str(i.total), "status": i.status.value}
                        for i in db.scalars(select(SalesInvoice).where(SalesInvoice.recurring_invoice_id == template.id)
                                            .order_by(SalesInvoice.invoice_date.desc()).limit(24))]
    return data


@router.put("/{template_id:int}/", dependencies=[Depends(access)])
@router.patch("/{template_id:int}/", dependencies=[Depends(access)])
def update_template(template_id: int, body: RecurringInvoiceIn, db: Session = Depends(get_db)):
    template = get_or_404(db, RecurringInvoice, template_id, "RecurringInvoice")
    _apply(db, template, body)
    db.commit()
    return ser.recurring_invoice(template)


@router.delete("/{template_id:int}/", status_code=204, dependencies=[Depends(access)])
def delete_template(template_id: int, db: Session = Depends(get_db)):
    """Invoices it already raised stay; they just lose the link."""
    db.delete(get_or_404(db, RecurringInvoice, template_id, "RecurringInvoice"))
    db.commit()
    return Response(status_code=204)


@router.post("/generate/")
def generate_due(db: Session = Depends(get_db), user: User = Depends(Access("recurring_invoices", action="create"))):
    """Raises every invoice that has fallen due (on or before today)."""
    result = recurring.generate_due(db, today(), user)
    if result["invoices_created"]:
        audit.record(db, "GENERATE", "RecurringInvoice", f"{result['invoices_created']} invoices", changes=result)
    db.commit()
    return result


@router.post("/{template_id:int}/generate/")
def generate_one(template_id: int, db: Session = Depends(get_db),
                 user: User = Depends(Access("recurring_invoices", action="create"))):
    """Raises this template's due invoices now."""
    template = get_or_404(db, RecurringInvoice, template_id, "RecurringInvoice")
    if not recurring.is_due(template, today()):
        raise bad_request(f'Nothing is due yet - the next invoice is on {template.next_date:%d %b %Y}.')
    ids = recurring.generate(db, template, today(), user)
    db.commit()
    if not ids and template.last_error:
        raise bad_request(template.last_error)
    return {"invoices_created": len(ids), "invoice_ids": ids, **ser.recurring_invoice(template)}
