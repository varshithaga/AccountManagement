"""Inventory: stock on hand of tracked products, their movements, and adjustments."""
from typing import Optional

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Access
from ..errors import bad_request
from ..models import Product, StockMovement, User
from ..schemas import StockAdjustmentIn
from ..services import inventory
from ..utils import get_or_404, parse_date, today

router = APIRouter(prefix="/api/inventory", tags=["inventory"])
view = Access("inventory", "products")


@router.get("/", dependencies=[Depends(view)])
def stock(as_of: Optional[str] = None, search: Optional[str] = None, db: Session = Depends(get_db)):
    """Every tracked product: quantity in / out, on hand, average cost and value (?as_of=YYYY-MM-DD)."""
    return inventory.stock_summary(db, parse_date(as_of), search or "")


@router.get("/{product_id:int}/movements/", dependencies=[Depends(view)])
def product_movements(product_id: int, date_from: Optional[str] = None, date_to: Optional[str] = None,
                      page: Optional[str] = None, limit: Optional[str] = None, db: Session = Depends(get_db)):
    """One product's movements, oldest first, with the running stock - a page at a time (?page=, ?limit=,
    default 50 rows)."""
    return inventory.movements(db, get_or_404(db, Product, product_id), parse_date(date_from), parse_date(date_to),
                               page=page or 1, limit=limit)


@router.post("/adjustments/", status_code=201)
def create_adjustment(body: StockAdjustmentIn, db: Session = Depends(get_db),
                      user: User = Depends(Access("inventory", action="create"))):
    """{"product", "quantity" (+ in / - out), "movement_date", "unit_cost", "note", "opening": bool}."""
    product = get_or_404(db, Product, body.product)
    try:
        movement = inventory.adjust(db, product, body.quantity, body.movement_date or today(), user,
                                    note=body.note or "", unit_cost=body.unit_cost, opening=body.opening)
    except inventory.InventoryError as exc:
        db.rollback()
        raise bad_request(str(exc))
    db.commit()
    return {"id": movement.id, **inventory.movements(db, product)}


@router.delete("/adjustments/{movement_id:int}/", status_code=204,
               dependencies=[Depends(Access("inventory", action="delete"))])
def delete_adjustment(movement_id: int, db: Session = Depends(get_db)):
    try:
        inventory.delete_adjustment(db, get_or_404(db, StockMovement, movement_id, "StockMovement"))
    except inventory.InventoryError as exc:
        db.rollback()
        raise bad_request(str(exc))
    db.commit()
    return Response(status_code=204)
