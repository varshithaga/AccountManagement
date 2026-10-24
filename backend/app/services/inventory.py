"""Stock of the products marked "track inventory".

Every change is a StockMovement: posting a purchase bill adds its quantities, posting a sales
invoice takes them out, credit notes (returns from clients) add back and debit notes (returns to
suppliers) take out; cancelling the document removes its movements again. Opening stock and
counts / damage / samples are adjustments. Stock on hand is the sum of the movements, and the
average cost is the weighted average of everything that came in with a cost.

This tracks quantities and their value; it does not post cost of goods sold to the journal -
purchases are expensed when the bill is posted, as before.
"""
from datetime import date
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import case, delete, func, select
from sqlalchemy.orm import Session

from ..models import (
    CreditNote, ItemType, NoteKind, Product, PurchaseBill, SalesInvoice, StockMovement, StockMovementKind, User,
)
from ..errors import APIError
from ..utils import ZERO, page_params, page_response, q2
from . import period_close

QTY = Decimal('0.001')


class InventoryError(Exception):
    pass


def _tracked(db: Session, product_id: Optional[int]) -> Optional[Product]:
    if not product_id:
        return None
    product = db.get(Product, product_id)
    return product if product and product.track_inventory else None


def record_document(db: Session, doc) -> int:
    """Adds the stock movements of a posted invoice, bill or note (tracked products only)."""
    if isinstance(doc, SalesInvoice):
        kind, sign, day, link = StockMovementKind.SALE, -1, doc.invoice_date, {'sales_invoice_id': doc.id}
    elif isinstance(doc, PurchaseBill):
        kind, sign, day, link = StockMovementKind.PURCHASE, 1, doc.bill_date, {'purchase_bill_id': doc.id}
    elif isinstance(doc, CreditNote):
        if doc.kind == NoteKind.SALES:
            kind, sign = StockMovementKind.SALES_RETURN, 1
        else:
            kind, sign = StockMovementKind.PURCHASE_RETURN, -1
        day, link = doc.note_date, {'credit_note_id': doc.id}
    else:
        raise TypeError(doc)
    created = 0
    for item in doc.items:
        product = _tracked(db, item.product_id)
        if product is None:
            continue
        # Stock coming in carries its cost (the line amount after discount, before GST).
        cost = q2(item.amount / item.quantity) if sign > 0 and item.quantity else None
        db.add(StockMovement(product_id=product.id, date=day, kind=kind, quantity=sign * item.quantity,
                             unit_cost=cost, note=item.description[:500], **link))
        created += 1
    db.flush()
    return created


def remove_document(db: Session, doc) -> None:
    """Takes a cancelled document's movements out again."""
    column = {SalesInvoice: StockMovement.sales_invoice_id, PurchaseBill: StockMovement.purchase_bill_id,
              CreditNote: StockMovement.credit_note_id}[type(doc)]
    db.execute(delete(StockMovement).where(column == doc.id))
    db.flush()


def adjust(db: Session, product: Product, quantity: Decimal, day: date, user: Optional[User], note: str = '',
           unit_cost: Optional[Decimal] = None, opening: bool = False) -> StockMovement:
    """Opening stock, or a correction after a count / damage / samples (+ or -)."""
    if not product.track_inventory:
        raise InventoryError(f'"{product.name}" is not tracked - turn on "Track stock" for it first.')
    quantity = Decimal(str(quantity)).quantize(QTY)
    if quantity == 0:
        raise InventoryError('The quantity cannot be zero.')
    if opening and quantity < 0:
        raise InventoryError('Opening stock cannot be negative.')
    if unit_cost is not None and Decimal(str(unit_cost)) < 0:
        raise InventoryError('The cost cannot be negative.')
    try:
        period_close.guard_dates(db, day, what=f'stock cannot be adjusted on {day:%d %b %Y}')
    except period_close.PeriodClosedError as exc:
        raise InventoryError(str(exc))
    movement = StockMovement(
        product=product, date=day, quantity=quantity, note=(note or '').strip()[:500],
        kind=StockMovementKind.OPENING if opening else StockMovementKind.ADJUSTMENT,
        unit_cost=q2(Decimal(str(unit_cost))) if unit_cost is not None and quantity > 0 else None,
        created_by_id=user.id if user else None)
    db.add(movement)
    db.flush()
    return movement


def delete_adjustment(db: Session, movement: StockMovement) -> None:
    if movement.kind not in (StockMovementKind.OPENING, StockMovementKind.ADJUSTMENT):
        raise InventoryError('This movement comes from an invoice, bill or note - cancel that document instead.')
    try:
        period_close.guard_dates(db, movement.date, what='this adjustment is in a closed period')
    except period_close.PeriodClosedError as exc:
        raise InventoryError(str(exc))
    db.delete(movement)
    db.flush()


def stock_summary(db: Session, as_of: Optional[date] = None, search: str = '') -> dict:
    """On hand, average cost and value of every tracked product as of a date (default: all movements)."""
    where = [StockMovement.date <= as_of] if as_of else []
    incoming = StockMovement.quantity > 0
    with_cost = incoming & StockMovement.unit_cost.is_not(None)
    rows = db.execute(
        select(StockMovement.product_id,
               func.sum(StockMovement.quantity),
               func.sum(case((incoming, StockMovement.quantity), else_=0)),
               func.sum(case((~incoming, -StockMovement.quantity), else_=0)),
               func.sum(case((with_cost, StockMovement.quantity * StockMovement.unit_cost), else_=0)),
               func.sum(case((with_cost, StockMovement.quantity), else_=0)))
        .where(*where).group_by(StockMovement.product_id)).all()
    totals = {r[0]: r[1:] for r in rows}
    products = select(Product).where(Product.track_inventory.is_(True)).order_by(Product.name)
    if search:
        term = f'%{search.strip()}%'
        products = products.where(Product.name.ilike(term) | Product.code.ilike(term) | Product.hsn_sac_code.ilike(term))
    items, total_value = [], ZERO
    low = 0
    for p in db.scalars(products):
        on_hand, qty_in, qty_out, cost_value, cost_qty = (Decimal(str(v or 0)) for v in totals.get(p.id, (0,) * 5))
        avg = q2(cost_value / cost_qty) if cost_qty else (p.purchase_price or ZERO)
        value = q2(on_hand * avg) if on_hand > 0 else ZERO
        below = p.reorder_level is not None and on_hand <= p.reorder_level
        low += 1 if below else 0
        total_value += value
        items.append({
            'product': p.id, 'name': p.name, 'code': p.code, 'unit': p.unit, 'hsn_sac_code': p.hsn_sac_code,
            'is_active': p.is_active, 'quantity_in': qty_in, 'quantity_out': qty_out, 'on_hand': on_hand,
            'average_cost': avg, 'value': value,
            'reorder_level': p.reorder_level, 'below_reorder_level': below, 'negative': on_hand < 0,
        })
    return {'as_of': as_of.isoformat() if as_of else None, 'products': items, 'total_value': total_value,
            'below_reorder_level': low, 'negative': sum(1 for i in items if i['negative'])}


def movements(db: Session, product: Product, date_from: Optional[date] = None, date_to: Optional[date] = None,
              page: Any = None, limit: Any = None) -> dict:
    """A product's movements, oldest first, with the running stock. With `page` (1, 2, ... or "last") only
    that page of rows is returned, plus the usual count / next / previous / total_pages; the balance column
    still runs from the opening, and opening / closing are for the whole range."""
    total = lambda stmt: Decimal(str(db.scalar(select(func.coalesce(func.sum(stmt.c.quantity), 0)).select_from(stmt))))
    opening = ZERO
    if date_from:
        opening = Decimal(str(db.scalar(select(func.coalesce(func.sum(StockMovement.quantity), 0))
                                        .where(StockMovement.product_id == product.id, StockMovement.date < date_from))))
    stmt = select(StockMovement).where(StockMovement.product_id == product.id)
    if date_from:
        stmt = stmt.where(StockMovement.date >= date_from)
    if date_to:
        stmt = stmt.where(StockMovement.date <= date_to)
    stmt = stmt.order_by(StockMovement.date, StockMovement.id)
    quantities = stmt.with_only_columns(StockMovement.quantity)
    closing = opening + total(quantities.subquery())

    paging = None
    running = opening
    if page is not None:
        number, size = page_params(page, limit, default_size=50)
        count = db.scalar(select(func.count()).select_from(quantities.order_by(None).subquery())) or 0
        total_pages = max(1, -(-count // size))
        number = total_pages if number == -1 else number
        if number > total_pages:
            raise APIError(404, {"detail": "Invalid page."})
        offset = (number - 1) * size
        running += total(quantities.limit(offset).subquery()) if offset else ZERO  # what earlier pages moved
        stmt = stmt.offset(offset).limit(size)
        paging = page_response([], count, number, size)
        del paging['results']

    rows = []
    for m in db.scalars(stmt):
        running += m.quantity
        doc = None
        if m.sales_invoice_id:
            inv = db.get(SalesInvoice, m.sales_invoice_id)
            doc = {'type': 'sales_invoice', 'id': inv.id, 'number': inv.invoice_number}
        elif m.purchase_bill_id:
            bill = db.get(PurchaseBill, m.purchase_bill_id)
            doc = {'type': 'purchase_bill', 'id': bill.id, 'number': bill.bill_number}
        elif m.credit_note_id:
            note = db.get(CreditNote, m.credit_note_id)
            doc = {'type': 'credit_note', 'id': note.id, 'number': note.note_number}
        rows.append({'id': m.id, 'date': m.date.isoformat(), 'kind': m.kind.value, 'quantity': m.quantity,
                     'unit_cost': m.unit_cost, 'note': m.note, 'document': doc, 'balance': running,
                     'created_by': m.created_by.username if m.created_by else None})
    return {'product': {'id': product.id, 'name': product.name, 'unit': product.unit},
            'opening': opening, 'closing': closing, 'rows': rows, **(paging or {})}


def can_track(product: Product) -> bool:
    return product.item_type == ItemType.PRODUCT
