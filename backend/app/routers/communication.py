"""Email: sending an invoice to the client, and payment reminders for overdue invoices."""
from collections import defaultdict
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..deps import Access, get_current_user
from ..errors import bad_request
from ..models import DocumentStatus, SalesInvoice, User
from ..schemas import ReminderIn
from ..services import audit, mailer
from ..services.settings import accounting_settings
from ..utils import get_or_404, now, parse_date, today

router = APIRouter(prefix="/api", tags=["email & reminders"])
OPEN = (DocumentStatus.POSTED, DocumentStatus.PARTIALLY_PAID)


def _money(value) -> str:
    return f"Rs. {value:,.2f}"


@router.get("/email/status/", dependencies=[Depends(get_current_user)])
def email_status():
    """Whether outgoing email is set up on the server, and the address it is sent from."""
    return mailer.status()


@router.post("/sales-invoices/{invoice_id:int}/email/")
async def email_invoice(invoice_id: int, to: str = Form(...), subject: str = Form(""), message: str = Form(""),
                        cc: str = Form(""), file: Optional[UploadFile] = File(None), db: Session = Depends(get_db),
                        user: User = Depends(Access("sales_invoices", action="edit"))):
    """Multipart: to, cc, subject, message and the invoice PDF (made by the app) as `file`."""
    invoice = get_or_404(db, SalesInvoice, invoice_id, "SalesInvoice")
    if invoice.status in (DocumentStatus.DRAFT, DocumentStatus.CANCELLED):
        raise bad_request(f"A {invoice.status.value.lower()} invoice can't be emailed - post it first.")
    attachments = []
    if file is not None:
        content = await file.read()
        if not content.startswith(b"%PDF"):
            raise bad_request("The attachment must be the invoice PDF.")
        attachments.append((file.filename or f"{invoice.invoice_number}.pdf", content, "application/pdf"))
    try:
        to_list = mailer.parse_addresses(to, "To", required=True)
        cc_list = mailer.parse_addresses(cc, "Cc")
        mailer.send(to_list, subject or f"Invoice {invoice.invoice_number}", message, cc=cc_list,
                    reply_to=accounting_settings(db).company_email, attachments=attachments)
    except mailer.EmailError as exc:
        raise bad_request(str(exc))
    audit.record(db, "EMAIL", "SalesInvoice", invoice.invoice_number, entity_id=invoice.id,
                 changes={"to": to_list, "cc": cc_list, "subject": subject, "attachment": bool(attachments)}, user=user)
    db.commit()
    return {"sent_to": to_list + cc_list}


# ---------------------------------------------------------------------------
# Payment reminders
# ---------------------------------------------------------------------------

def _reminder_text(company: str, client_name: str, invoices: list[SalesInvoice], as_of) -> tuple[str, str]:
    total = sum((i.balance_due for i in invoices), 0)
    lines = [f"  {i.invoice_number}  dated {i.invoice_date:%d %b %Y}, due {i.due_date:%d %b %Y} "
             f"({(as_of - i.due_date).days} days overdue): {_money(i.balance_due)}" for i in invoices]
    subject = f"Payment reminder - {_money(total)} overdue" + (f" - {company}" if company else "")
    body = "\n".join([
        f"Dear {client_name},",
        "",
        "This is a friendly reminder that the following invoice(s) are past their due date:",
        "",
        *lines,
        "",
        f"Total overdue: {_money(total)}",
        "",
        "If you have already paid, please ignore this message and accept our thanks. Otherwise we would "
        "be grateful if you could arrange the payment at the earliest.",
        "",
        "Regards,",
        company or "Accounts",
    ])
    return subject, body


@router.get("/reminders/", dependencies=[Depends(Access("receivables_payables", "sales_invoices"))])
def list_reminders(as_of: Optional[str] = None, min_days: int = 1, db: Session = Depends(get_db)):
    """Clients with overdue invoices (?min_days= overdue at least; default 1), each with a ready-made
    reminder subject and message."""
    day = parse_date(as_of) or today()
    company = accounting_settings(db).company_name
    invoices = db.scalars(select(SalesInvoice).options(joinedload(SalesInvoice.client))
                          .where(SalesInvoice.status.in_(OPEN), SalesInvoice.due_date <= day - timedelta(days=max(min_days, 0)))
                          .order_by(SalesInvoice.due_date, SalesInvoice.id)).all()
    by_client: dict[int, list[SalesInvoice]] = defaultdict(list)
    for inv in invoices:
        if inv.balance_due > 0:
            by_client[inv.client_id].append(inv)
    clients = []
    for invs in by_client.values():
        client = invs[0].client
        subject, message = _reminder_text(company, client.contact_person or client.name, invs, day)
        reminded = [i.last_reminder_at for i in invs if i.last_reminder_at]
        clients.append({
            "client": client.id, "client_name": client.name, "email": client.email, "phone": client.phone,
            "total_overdue": sum((i.balance_due for i in invs), 0),
            "oldest_days_overdue": max((day - i.due_date).days for i in invs),
            "last_reminder_at": max(reminded).isoformat() if reminded else None,
            "invoices": [{"id": i.id, "invoice_number": i.invoice_number, "invoice_date": i.invoice_date.isoformat(),
                          "due_date": i.due_date.isoformat(), "balance_due": i.balance_due,
                          "days_overdue": (day - i.due_date).days, "reminder_count": i.reminder_count or 0,
                          "last_reminder_at": i.last_reminder_at.isoformat() if i.last_reminder_at else None}
                         for i in invs],
            "subject": subject, "message": message,
        })
    clients.sort(key=lambda c: -c["total_overdue"])
    return {"as_of": day.isoformat(), "email": mailer.status(), "clients": clients,
            "total_overdue": sum((c["total_overdue"] for c in clients), 0)}


@router.post("/reminders/send/")
def send_reminder(body: ReminderIn, db: Session = Depends(get_db),
                  user: User = Depends(Access("receivables_payables", "sales_invoices", action="edit",
                                              write_pages=("sales_invoices",)))):
    """Emails the reminder (send_email: true), or only records that one was sent another way. Either way
    the invoices' reminder count and date are updated."""
    invoices = db.scalars(select(SalesInvoice).where(SalesInvoice.id.in_(body.invoice_ids),
                                                     SalesInvoice.client_id == body.client_id)).all()
    if not invoices or len(invoices) != len(set(body.invoice_ids)):
        raise bad_request("Choose invoices of this client.")
    sent_to: list[str] = []
    if body.send_email:
        try:
            to_list = mailer.parse_addresses(body.to or "", "To", required=True)
            cc_list = mailer.parse_addresses(body.cc or "", "Cc")
            mailer.send(to_list, body.subject or "Payment reminder", body.message or "", cc=cc_list,
                        reply_to=accounting_settings(db).company_email)
        except mailer.EmailError as exc:
            raise bad_request(str(exc))
        sent_to = to_list + cc_list
    stamp = now()
    for inv in invoices:
        inv.reminder_count = (inv.reminder_count or 0) + 1
        inv.last_reminder_at = stamp
    audit.record(db, "REMIND", "Client", invoices[0].client.name, entity_id=body.client_id,
                 changes={"invoices": [i.invoice_number for i in invoices], "emailed_to": sent_to}, user=user)
    db.commit()
    return {"reminded": len(invoices), "sent_to": sent_to, "last_reminder_at": stamp.isoformat()}
