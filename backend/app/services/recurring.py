"""Recurring invoices: a template raises a sales invoice every month / quarter / half-year / year.

Each run creates the invoices that have fallen due (next_date on or before today, up to end_date),
dated on their own due day, as drafts - or posted straight away with auto_post. A template that
missed several periods (the server was off) catches up, at most MAX_CATCH_UP invoices per run.
A failure (e.g. the period is closed, an account was deleted) is kept in last_error and that
template is skipped until it is fixed; the others carry on.

The server runs it every RECURRING_CHECK_MINUTES (app/main.py); `python cli.py run-recurring` runs it once.
"""
import calendar
from datetime import date
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..models import Client, Frequency, RecurringInvoice, User
from ..utils import today as _today
from . import audit, invoicing

MONTHS = {Frequency.MONTHLY: 1, Frequency.QUARTERLY: 3, Frequency.HALF_YEARLY: 6, Frequency.YEARLY: 12}
MAX_CATCH_UP = 24
# PostgreSQL advisory lock: one scheduled run at a time across server processes and the CLI.
RUN_LOCK_KEY = 7_316_001


def advance(day: date, frequency: Frequency, anchor_day: int) -> date:
    """The next date: `frequency` months on, on the anchor day of the month (or the month's last day -
    a template started on the 31st runs on 28/29 Feb, 30 Apr...)."""
    months = day.month - 1 + MONTHS[frequency]
    year, month = day.year + months // 12, months % 12 + 1
    return date(year, month, min(anchor_day, calendar.monthrange(year, month)[1]))


def validate(db: Session, template: RecurringInvoice) -> None:
    """Checks the template's client and items by building them as an invoice would (nothing is saved)."""
    if not db.get(Client, template.client_id):
        raise invoicing.InvoicingError('Choose a valid client.')
    if not template.name.strip():
        raise invoicing.InvoicingError('Give the recurring invoice a name.')
    if template.end_date and template.end_date < template.start_date:
        raise invoicing.InvoicingError('The end date cannot be before the start date.')
    with db.no_autoflush:
        invoicing.build_items(db, template.items or [], 'sale')


def is_due(template: RecurringInvoice, as_of: date) -> bool:
    return template.is_active and template.next_date <= as_of and (
        template.end_date is None or template.next_date <= template.end_date)


def generate(db: Session, template: RecurringInvoice, as_of: Optional[date] = None,
             user: Optional[User] = None) -> list[int]:
    """Raises the template's due invoices in a savepoint each; returns the new invoice ids.
    Stops at the first failure and records it in last_error."""
    as_of = as_of or _today()
    created = []
    while len(created) < MAX_CATCH_UP and is_due(template, as_of):
        try:
            with db.begin_nested():
                invoice = invoicing.save_sales_invoice(db, {
                    'client_id': template.client_id, 'invoice_date': template.next_date,
                    'notes': template.notes or '', 'items': [dict(i) for i in template.items or []],
                }, user)
                invoice.recurring_invoice_id = template.id
                if template.auto_post:
                    invoicing.post_sales_invoice(db, invoice)
        except invoicing.InvoicingError as exc:
            template.last_error = f'{template.next_date:%d %b %Y}: {exc}'
            break
        created.append(invoice.id)
        template.invoices_created += 1
        template.last_error = ''
        template.next_date = advance(template.next_date, template.frequency, template.start_date.day)
    db.flush()
    return created


def generate_due(db: Session, as_of: Optional[date] = None, user: Optional[User] = None) -> dict:
    """Runs every active template that is due. Commits nothing - the caller does."""
    as_of = as_of or _today()
    result = {'invoices_created': 0, 'templates': 0, 'errors': []}
    templates = db.scalars(select(RecurringInvoice).where(RecurringInvoice.is_active.is_(True),
                                                          RecurringInvoice.next_date <= as_of)
                           .order_by(RecurringInvoice.next_date, RecurringInvoice.id)).all()
    for template in templates:
        ids = generate(db, template, as_of, user)
        if ids:
            result['templates'] += 1
            result['invoices_created'] += len(ids)
        if template.last_error:
            result['errors'].append({'id': template.id, 'name': template.name, 'error': template.last_error})
    return result


def due_count(db: Session, as_of: Optional[date] = None) -> int:
    as_of = as_of or _today()
    return sum(1 for t in db.scalars(select(RecurringInvoice).where(RecurringInvoice.is_active.is_(True),
                                                                    RecurringInvoice.next_date <= as_of))
               if is_due(t, as_of))


def run_scheduled(db: Session, as_of: Optional[date] = None) -> Optional[dict]:
    """One scheduled run of every due template, committed. Returns None when another process is
    already running it (PostgreSQL only - SQLite has a single writer anyway)."""
    postgres = db.get_bind().dialect.name == 'postgresql'
    if postgres and not db.scalar(text('SELECT pg_try_advisory_xact_lock(:key)'), {'key': RUN_LOCK_KEY}):
        db.rollback()
        return None
    result = generate_due(db, as_of)
    if result['invoices_created'] or result['errors']:
        audit.record(db, 'GENERATE', 'RecurringInvoice', f"{result['invoices_created']} invoices (scheduled)",
                     changes=result, username='scheduler')
    db.commit()
    return result
