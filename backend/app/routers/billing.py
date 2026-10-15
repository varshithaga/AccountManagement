"""Sales invoices, purchase bills, and payments / receipts."""
from typing import Optional

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from .. import serializers as ser
from ..access import EDIT
from ..database import get_db
from ..deps import Access
from ..errors import bad_request
from ..models import (
    DocumentStatus, Payment, PaymentAllocation, PaymentDirection, PurchaseBill, PurchaseBillItem, SalesInvoice,
    SalesInvoiceItem, User,
)
from ..schemas import AllocateIn, ConfirmIn, PaymentIn, PaymentUpdateIn, PurchaseBillIn, SalesInvoiceIn
from ..services import invoicing
from ..services.invoicing import InvoicingError
from ..utils import apply_ordering, apply_search, get_or_404, paginate, today
from .common import confirm_unmatch

router = APIRouter(prefix="/api", tags=["invoices, bills & payments"])


def _run(db: Session, fn, *args, **kwargs):
    """Runs a service call in one transaction: committed when it works, rolled back with a 400 when it doesn't."""
    try:
        result = fn(*args, **kwargs)
        db.commit()
        return result
    except InvoicingError as exc:
        db.rollback()
        raise bad_request(str(exc))


def _items(body) -> dict:
    data = body.model_dump(exclude_unset=True, exclude={"post"})
    if body.items is not None:
        data["items"] = [i.model_dump(exclude_unset=True) for i in body.items]
    return data


def _status_summary(db: Session, model) -> dict:
    """Counts and amounts per status, plus what is overdue."""
    by_status = {s.value: {"count": 0, "total": 0, "balance_due": 0} for s in DocumentStatus}
    for status, n, total, paid in db.execute(select(model.status, func.count(model.id), func.sum(model.total),
                                                    func.sum(model.amount_paid)).group_by(model.status)):
        by_status[status.value] = {"count": n, "total": total or 0, "balance_due": (total or 0) - (paid or 0)}
    n, due = db.execute(select(func.count(model.id), func.coalesce(func.sum(model.total - model.amount_paid), 0))
                        .where(model.status.in_(invoicing.OPEN_STATUSES), model.due_date < today())).one()
    outstanding = db.scalar(select(func.coalesce(func.sum(model.total - model.amount_paid), 0))
                            .where(model.status.in_(invoicing.OPEN_STATUSES)))
    return {"by_status": by_status, "outstanding": outstanding, "overdue": {"count": n, "amount": due}}


# ---------------------------------------------------------------------------
# Sales invoices
# ---------------------------------------------------------------------------

invoice_access = Access("sales_invoices")
invoice_edit = Access("sales_invoices", action=EDIT)


def _invoice_stmt():
    return select(SalesInvoice).options(
        joinedload(SalesInvoice.client), joinedload(SalesInvoice.journal_entry), joinedload(SalesInvoice.created_by),
        selectinload(SalesInvoice.items).joinedload(SalesInvoiceItem.account),
        selectinload(SalesInvoice.items).joinedload(SalesInvoiceItem.tax_rate),
        selectinload(SalesInvoice.items).joinedload(SalesInvoiceItem.product),
        selectinload(SalesInvoice.allocations).joinedload(PaymentAllocation.payment),
    )


def _invoice(db: Session, invoice_id: int) -> SalesInvoice:
    return get_or_404(db, SalesInvoice, invoice_id, "SalesInvoice")


@router.get("/sales-invoices/", dependencies=[Depends(invoice_access)])
def list_invoices(request: Request, db: Session = Depends(get_db), search: Optional[str] = None,
                  client: Optional[int] = None, status: Optional[DocumentStatus] = None,
                  date_from: Optional[str] = None, date_to: Optional[str] = None, overdue: Optional[str] = None,
                  ordering: Optional[str] = None, page: Optional[str] = None, limit: Optional[str] = None):
    """?search= (number, notes), ?client=, ?status=, ?date_from=, ?date_to=, ?overdue=true."""
    stmt = apply_search(_invoice_stmt(), search, SalesInvoice.invoice_number, SalesInvoice.notes)
    if client:
        stmt = stmt.where(SalesInvoice.client_id == client)
    if status:
        stmt = stmt.where(SalesInvoice.status == status)
    if date_from:
        stmt = stmt.where(SalesInvoice.invoice_date >= date_from)
    if date_to:
        stmt = stmt.where(SalesInvoice.invoice_date <= date_to)
    if overdue in ("1", "true", "yes"):
        stmt = stmt.where(SalesInvoice.status.in_(invoicing.OPEN_STATUSES), SalesInvoice.due_date < today())
    stmt = apply_ordering(stmt, ordering, {"invoice_date": SalesInvoice.invoice_date, "due_date": SalesInvoice.due_date,
                                           "invoice_number": SalesInvoice.invoice_number, "total": SalesInvoice.total},
                          [SalesInvoice.invoice_date.desc(), SalesInvoice.id.desc()])
    return paginate(db, stmt, page, limit, lambda inv: ser.sales_invoice(inv, detail=False))


@router.get("/sales-invoices/summary/", dependencies=[Depends(invoice_access)])
def invoices_summary(db: Session = Depends(get_db)):
    return _status_summary(db, SalesInvoice)


@router.get("/sales-invoices/next-number/", dependencies=[Depends(invoice_access)])
def next_invoice_number(db: Session = Depends(get_db)):
    return {"invoice_number": invoicing.next_number(db, SalesInvoice.invoice_number, "INV")}


@router.post("/sales-invoices/", status_code=201)
def create_invoice(body: SalesInvoiceIn, db: Session = Depends(get_db), user: User = Depends(invoice_access)):
    """Creates a DRAFT invoice; "post": true posts it to the journal straight away. invoice_number is
    generated (INV-00001...) when left out; due_date defaults from the client's payment terms."""
    def create():
        invoice = invoicing.save_sales_invoice(db, _items(body), user)
        if body.post:
            invoicing.post_sales_invoice(db, invoice)
        return invoice
    invoice = _run(db, create)
    return ser.sales_invoice(_invoice(db, invoice.id))


@router.get("/sales-invoices/{invoice_id:int}/", dependencies=[Depends(invoice_access)])
def get_invoice(invoice_id: int, db: Session = Depends(get_db)):
    return ser.sales_invoice(_invoice(db, invoice_id))


@router.put("/sales-invoices/{invoice_id:int}/")
@router.patch("/sales-invoices/{invoice_id:int}/")
def update_invoice(invoice_id: int, body: SalesInvoiceIn, db: Session = Depends(get_db),
                   user: User = Depends(invoice_access)):
    """Drafts only. Sending "items" replaces every line."""
    invoice = _invoice(db, invoice_id)
    _run(db, invoicing.save_sales_invoice, db, _items(body), user, invoice)
    return ser.sales_invoice(_invoice(db, invoice_id))


@router.post("/sales-invoices/{invoice_id:int}/post/", dependencies=[Depends(invoice_edit)])
def post_invoice(invoice_id: int, db: Session = Depends(get_db)):
    """Posts a draft: creates its journal entry (Dr Receivable / Cr income and GST)."""
    _run(db, invoicing.post_sales_invoice, db, _invoice(db, invoice_id))
    return ser.sales_invoice(_invoice(db, invoice_id))


@router.post("/sales-invoices/{invoice_id:int}/cancel/", dependencies=[Depends(invoice_edit)])
def cancel_invoice(invoice_id: int, request: Request, body: Optional[ConfirmIn] = None, db: Session = Depends(get_db)):
    """Cancels a posted invoice (its journal entry is deleted). Refused once payments are allocated to it."""
    confirm = confirm_unmatch(request, body.model_dump() if body else None)
    _run(db, invoicing.cancel_document, db, _invoice(db, invoice_id), confirm)
    return ser.sales_invoice(_invoice(db, invoice_id))


@router.delete("/sales-invoices/{invoice_id:int}/", status_code=204, dependencies=[Depends(invoice_access)])
def delete_invoice(invoice_id: int, db: Session = Depends(get_db)):
    """Only drafts and cancelled invoices can be deleted."""
    _run(db, invoicing.delete_document, db, _invoice(db, invoice_id))
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Purchase bills
# ---------------------------------------------------------------------------

bill_access = Access("purchase_bills")
bill_edit = Access("purchase_bills", action=EDIT)


def _bill_stmt():
    return select(PurchaseBill).options(
        joinedload(PurchaseBill.supplier), joinedload(PurchaseBill.journal_entry), joinedload(PurchaseBill.created_by),
        selectinload(PurchaseBill.items).joinedload(PurchaseBillItem.account),
        selectinload(PurchaseBill.items).joinedload(PurchaseBillItem.tax_rate),
        selectinload(PurchaseBill.items).joinedload(PurchaseBillItem.product),
        selectinload(PurchaseBill.allocations).joinedload(PaymentAllocation.payment),
    )


def _bill(db: Session, bill_id: int) -> PurchaseBill:
    return get_or_404(db, PurchaseBill, bill_id, "PurchaseBill")


@router.get("/purchase-bills/", dependencies=[Depends(bill_access)])
def list_bills(db: Session = Depends(get_db), search: Optional[str] = None, supplier: Optional[int] = None,
               status: Optional[DocumentStatus] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
               overdue: Optional[str] = None, ordering: Optional[str] = None, page: Optional[str] = None,
               limit: Optional[str] = None):
    stmt = apply_search(_bill_stmt(), search, PurchaseBill.bill_number, PurchaseBill.notes)
    if supplier:
        stmt = stmt.where(PurchaseBill.supplier_id == supplier)
    if status:
        stmt = stmt.where(PurchaseBill.status == status)
    if date_from:
        stmt = stmt.where(PurchaseBill.bill_date >= date_from)
    if date_to:
        stmt = stmt.where(PurchaseBill.bill_date <= date_to)
    if overdue in ("1", "true", "yes"):
        stmt = stmt.where(PurchaseBill.status.in_(invoicing.OPEN_STATUSES), PurchaseBill.due_date < today())
    stmt = apply_ordering(stmt, ordering, {"bill_date": PurchaseBill.bill_date, "due_date": PurchaseBill.due_date,
                                           "bill_number": PurchaseBill.bill_number, "total": PurchaseBill.total},
                          [PurchaseBill.bill_date.desc(), PurchaseBill.id.desc()])
    return paginate(db, stmt, page, limit, lambda bill: ser.purchase_bill(bill, detail=False))


@router.get("/purchase-bills/summary/", dependencies=[Depends(bill_access)])
def bills_summary(db: Session = Depends(get_db)):
    return _status_summary(db, PurchaseBill)


@router.post("/purchase-bills/", status_code=201)
def create_bill(body: PurchaseBillIn, db: Session = Depends(get_db), user: User = Depends(bill_access)):
    """Creates a DRAFT bill (bill_number is the supplier's own); "post": true posts it straight away."""
    def create():
        bill = invoicing.save_purchase_bill(db, _items(body), user)
        if body.post:
            invoicing.post_purchase_bill(db, bill)
        return bill
    bill = _run(db, create)
    return ser.purchase_bill(_bill(db, bill.id))


@router.get("/purchase-bills/{bill_id:int}/", dependencies=[Depends(bill_access)])
def get_bill(bill_id: int, db: Session = Depends(get_db)):
    return ser.purchase_bill(_bill(db, bill_id))


@router.put("/purchase-bills/{bill_id:int}/")
@router.patch("/purchase-bills/{bill_id:int}/")
def update_bill(bill_id: int, body: PurchaseBillIn, db: Session = Depends(get_db), user: User = Depends(bill_access)):
    _run(db, invoicing.save_purchase_bill, db, _items(body), user, _bill(db, bill_id))
    return ser.purchase_bill(_bill(db, bill_id))


@router.post("/purchase-bills/{bill_id:int}/post/", dependencies=[Depends(bill_edit)])
def post_bill(bill_id: int, db: Session = Depends(get_db)):
    """Posts a draft: creates its journal entry (Dr expense and input GST / Cr Payable)."""
    _run(db, invoicing.post_purchase_bill, db, _bill(db, bill_id))
    return ser.purchase_bill(_bill(db, bill_id))


@router.post("/purchase-bills/{bill_id:int}/cancel/", dependencies=[Depends(bill_edit)])
def cancel_bill(bill_id: int, request: Request, body: Optional[ConfirmIn] = None, db: Session = Depends(get_db)):
    confirm = confirm_unmatch(request, body.model_dump() if body else None)
    _run(db, invoicing.cancel_document, db, _bill(db, bill_id), confirm)
    return ser.purchase_bill(_bill(db, bill_id))


@router.delete("/purchase-bills/{bill_id:int}/", status_code=204, dependencies=[Depends(bill_access)])
def delete_bill(bill_id: int, db: Session = Depends(get_db)):
    _run(db, invoicing.delete_document, db, _bill(db, bill_id))
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Payments & receipts
# ---------------------------------------------------------------------------

payment_access = Access("payments")
payment_edit = Access("payments", action=EDIT)


def _payment_stmt():
    return select(Payment).options(
        joinedload(Payment.client), joinedload(Payment.supplier), joinedload(Payment.bank_account),
        joinedload(Payment.journal_entry), joinedload(Payment.created_by),
        selectinload(Payment.allocations).joinedload(PaymentAllocation.sales_invoice),
        selectinload(Payment.allocations).joinedload(PaymentAllocation.purchase_bill),
    )


def _payment(db: Session, payment_id: int) -> Payment:
    return get_or_404(db, Payment, payment_id)


@router.get("/payments/", dependencies=[Depends(payment_access)])
def list_payments(db: Session = Depends(get_db), search: Optional[str] = None,
                  direction: Optional[PaymentDirection] = None, client: Optional[int] = None,
                  supplier: Optional[int] = None, bank_account: Optional[int] = None, date_from: Optional[str] = None,
                  date_to: Optional[str] = None, ordering: Optional[str] = None, page: Optional[str] = None,
                  limit: Optional[str] = None):
    """?direction=RECEIPT|PAYMENT, ?client=, ?supplier=, ?bank_account=, ?date_from=, ?date_to=, ?search=."""
    stmt = apply_search(_payment_stmt(), search, Payment.payment_number, Payment.reference_number, Payment.notes)
    if direction:
        stmt = stmt.where(Payment.direction == direction)
    if client:
        stmt = stmt.where(Payment.client_id == client)
    if supplier:
        stmt = stmt.where(Payment.supplier_id == supplier)
    if bank_account:
        stmt = stmt.where(Payment.bank_account_id == bank_account)
    if date_from:
        stmt = stmt.where(Payment.payment_date >= date_from)
    if date_to:
        stmt = stmt.where(Payment.payment_date <= date_to)
    stmt = apply_ordering(stmt, ordering, {"payment_date": Payment.payment_date, "amount": Payment.amount,
                                           "payment_number": Payment.payment_number},
                          [Payment.payment_date.desc(), Payment.id.desc()])
    return paginate(db, stmt, page, limit, ser.payment)


@router.post("/payments/", status_code=201)
def create_payment(body: PaymentIn, db: Session = Depends(get_db), user: User = Depends(payment_access)):
    """A receipt from a client (direction RECEIPT, client_id) or a payment to a supplier (PAYMENT,
    supplier_id), through bank_account_id (or cash). Posts its journal entry right away; "allocations"
    applies it to invoices / bills - anything left over stays as an advance."""
    data = body.model_dump()
    data["allocations"] = [a.model_dump() for a in body.allocations]
    payment = _run(db, invoicing.create_payment, db, data, user)
    return ser.payment(_payment(db, payment.id))


@router.get("/payments/{payment_id:int}/", dependencies=[Depends(payment_access)])
def get_payment(payment_id: int, db: Session = Depends(get_db)):
    return ser.payment(_payment(db, payment_id))


@router.put("/payments/{payment_id:int}/", dependencies=[Depends(payment_access)])
@router.patch("/payments/{payment_id:int}/", dependencies=[Depends(payment_access)])
def update_payment(payment_id: int, body: PaymentUpdateIn, db: Session = Depends(get_db)):
    """Only the reference number and notes can change - delete and re-enter a payment to change its amount."""
    payment = _payment(db, payment_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(payment, field, value or "")
    db.commit()
    return ser.payment(_payment(db, payment_id))


@router.delete("/payments/{payment_id:int}/", status_code=204, dependencies=[Depends(payment_access)])
def delete_payment(payment_id: int, request: Request, db: Session = Depends(get_db)):
    """Deletes the payment, its journal entry and its allocations (the invoices / bills become unpaid again)."""
    _run(db, invoicing.delete_payment, db, _payment(db, payment_id), confirm_unmatch(request))
    return Response(status_code=204)


@router.post("/payments/{payment_id:int}/allocate/", dependencies=[Depends(payment_edit)])
def allocate(payment_id: int, body: AllocateIn, db: Session = Depends(get_db)):
    """{"allocations": [{"sales_invoice_id" | "purchase_bill_id", "amount"}]} - applies more of the payment."""
    payment = _payment(db, payment_id)
    _run(db, invoicing.add_allocations, db, payment, [a.model_dump() for a in body.allocations])
    return ser.payment(_payment(db, payment_id))


@router.delete("/payments/{payment_id:int}/allocations/{allocation_id:int}/", dependencies=[Depends(payment_edit)])
def remove_allocation(payment_id: int, allocation_id: int, db: Session = Depends(get_db)):
    """Takes one allocation off (the amount becomes unallocated again)."""
    payment = _payment(db, payment_id)
    allocation = next((a for a in payment.allocations if a.id == allocation_id), None)
    if allocation is None:
        raise bad_request("That allocation is not part of this payment.")
    _run(db, invoicing.remove_allocation, db, payment, allocation)
    return ser.payment(_payment(db, payment_id))
