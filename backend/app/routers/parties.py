"""Clients, suppliers, tax rates and products / services."""
from typing import Optional

from fastapi import APIRouter, Depends, Response
from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session, joinedload

from .. import serializers as ser
from ..database import get_db
from ..deps import Access
from ..errors import APIError, bad_request, field_error
from ..models import (
    Client, ItemType, Payment, Product, PurchaseBill, PurchaseBillItem, SalesInvoice, SalesInvoiceItem, SubCategory,
    Supplier, TaxRate,
)
from ..schemas import ClientIn, ProductIn, SupplierIn, TaxRateIn
from ..services.invoicing import InvoicingError, party_statement, remove_opening_balance, sync_opening_balance
from ..utils import apply_ordering, apply_search, get_or_404, is_true, paginate, parse_date

router = APIRouter(prefix="/api", tags=["clients, suppliers & products"])


def _check_account(db: Session, field: str, account_id) -> None:
    if account_id is not None and not db.get(SubCategory, account_id):
        raise field_error(field, f'Invalid pk "{account_id}" - object does not exist.')


def _check_unique(db: Session, model, obj, **values) -> None:
    for field, value in values.items():
        if value and db.scalar(select(model.id).where(getattr(model, field) == value, model.id != (obj.id if obj else 0))):
            raise field_error(field, f"{model.__name__.lower()} with this {field} already exists.")


# ---------------------------------------------------------------------------
# Clients & suppliers
# ---------------------------------------------------------------------------

PARTIES = {
    "clients": (Client, ClientIn, ser.client, "receivable_account", SalesInvoice.client_id, Payment.client_id),
    "suppliers": (Supplier, SupplierIn, ser.supplier, "payable_account", PurchaseBill.supplier_id, Payment.supplier_id),
}


def _party_routes(path: str):
    model, schema, serialize, account_field, doc_col, pay_col = PARTIES[path]
    page_key = path  # "clients" / "suppliers"
    access = Access(page_key, "sales_invoices" if path == "clients" else "purchase_bills", "payments",
                    "receivables_payables", write_pages=(page_key,),
                    inline_create_pages=("sales_invoices",) if path == "clients" else ("purchase_bills",))

    def prepare(db: Session, data: dict, obj=None) -> dict:
        if obj is None and not (data.get("name") or "").strip():
            raise APIError(400, {"name": ["This field is required."]})
        if "name" in data:
            data["name"] = (data["name"] or "").strip()
        _check_unique(db, model, obj, name=data.get("name"), code=data.get("code"), gstin=data.get("gstin"))
        if account_field in data:
            _check_account(db, account_field, data[account_field])
            data[f"{account_field}_id"] = data.pop(account_field)
        # Text columns are NOT NULL - an explicit null means "clear it".
        nullable = {"code", "gstin", f"{account_field}_id", "opening_balance", "opening_balance_date"}
        return {k: ("" if v is None and k not in nullable else v) for k, v in data.items()
                if not (k == "opening_balance" and v is None)}

    def serialize_many(db: Session, rows):
        outstanding = ser.party_outstanding(db, model, [r.id for r in rows])
        return [serialize(r, outstanding.get(r.id)) for r in rows]

    @router.get(f"/{path}/", dependencies=[Depends(access)], name=f"list_{path}")
    def list_parties(db: Session = Depends(get_db), search: Optional[str] = None, is_active: Optional[str] = None,
                     ordering: Optional[str] = None, page: Optional[str] = None, limit: Optional[str] = None):
        """?search= matches name, code, contact, email, phone and GSTIN; ?is_active=true|false."""
        stmt = apply_search(select(model), search, model.name, model.code, model.contact_person, model.email,
                            model.phone, model.gstin)
        if is_active is not None:
            stmt = stmt.where(model.is_active.is_(is_true(is_active)))
        stmt = apply_ordering(stmt, ordering, {"name": model.name, "code": model.code, "created_at": model.created_at},
                              [model.name])
        return paginate(db, stmt, page, limit, serialize_many=lambda rows: serialize_many(db, rows))

    def save(db: Session, obj) -> None:
        """Commits, booking the opening balance (or removing it when zero) in the same transaction."""
        try:
            db.flush()
            sync_opening_balance(db, obj)
            db.commit()
        except InvoicingError as exc:
            db.rollback()
            raise bad_request(str(exc))

    @router.post(f"/{path}/", status_code=201, dependencies=[Depends(access)], name=f"create_{path}")
    def create_party(body: schema, db: Session = Depends(get_db)):
        obj = model(**prepare(db, body.model_dump(exclude_unset=True)))
        db.add(obj)
        save(db, obj)
        return serialize_many(db, [obj])[0]

    @router.get(f"/{path}/{{party_id:int}}/", dependencies=[Depends(access)], name=f"get_{path}")
    def get_party(party_id: int, db: Session = Depends(get_db)):
        return serialize_many(db, [get_or_404(db, model, party_id)])[0]

    @router.put(f"/{path}/{{party_id:int}}/", dependencies=[Depends(access)], name=f"update_{path}")
    @router.patch(f"/{path}/{{party_id:int}}/", dependencies=[Depends(access)], name=f"partial_update_{path}")
    def update_party(party_id: int, body: schema, db: Session = Depends(get_db)):
        obj = get_or_404(db, model, party_id)
        for field, value in prepare(db, body.model_dump(exclude_unset=True), obj).items():
            setattr(obj, field, value)
        save(db, obj)
        db.refresh(obj)
        return serialize_many(db, [obj])[0]

    @router.delete(f"/{path}/{{party_id:int}}/", status_code=204, dependencies=[Depends(access)],
                   name=f"delete_{path}")
    def delete_party(party_id: int, db: Session = Depends(get_db)):
        obj = get_or_404(db, model, party_id)
        if db.scalar(select(exists().where(doc_col == obj.id))) or db.scalar(select(exists().where(pay_col == obj.id))):
            raise bad_request(f'"{obj.name}" has invoices, bills or payments - mark it inactive instead of deleting it.')
        try:
            remove_opening_balance(db, obj)
        except InvoicingError as exc:
            db.rollback()
            raise bad_request(str(exc))
        db.delete(obj)
        db.commit()
        return Response(status_code=204)

    @router.get(f"/{path}/{{party_id:int}}/statement/", dependencies=[Depends(access)], name=f"statement_{path}")
    def statement(party_id: int, date_from: Optional[str] = None, date_to: Optional[str] = None,
                  db: Session = Depends(get_db)):
        """Every posted invoice / bill and payment, oldest first, with a running balance."""
        return party_statement(db, get_or_404(db, model, party_id), parse_date(date_from), parse_date(date_to))


_party_routes("clients")
_party_routes("suppliers")


# ---------------------------------------------------------------------------
# Tax rates
# ---------------------------------------------------------------------------

product_access = Access("products", "sales_invoices", "purchase_bills", write_pages=("products",))


def _prepare_tax_rate(db: Session, data: dict, obj: Optional[TaxRate]) -> dict:
    if obj is None:
        missing = {f: ["This field is required."] for f in ("name", "rate") if data.get(f) in (None, "")}
        if missing:
            raise APIError(400, missing)
    _check_unique(db, TaxRate, obj, name=data.get("name"))
    for field in ("output_tax_account", "input_tax_account"):
        if field in data:
            _check_account(db, field, data[field])
            data[f"{field}_id"] = data.pop(field)
    return data


def _tax_rate_stmt():
    return select(TaxRate).options(joinedload(TaxRate.output_tax_account), joinedload(TaxRate.input_tax_account))


@router.get("/tax-rates/", dependencies=[Depends(product_access)])
def list_tax_rates(db: Session = Depends(get_db), is_active: Optional[str] = None, search: Optional[str] = None,
                   page: Optional[str] = None, limit: Optional[str] = None):
    stmt = apply_search(_tax_rate_stmt(), search, TaxRate.name)
    if is_active is not None:
        stmt = stmt.where(TaxRate.is_active.is_(is_true(is_active)))
    return paginate(db, stmt.order_by(TaxRate.rate, TaxRate.name), page, limit, ser.tax_rate)


@router.post("/tax-rates/", status_code=201, dependencies=[Depends(product_access)])
def create_tax_rate(body: TaxRateIn, db: Session = Depends(get_db)):
    rate = TaxRate(**_prepare_tax_rate(db, body.model_dump(exclude_unset=True), None))
    db.add(rate)
    db.commit()
    return ser.tax_rate(db.get(TaxRate, rate.id))


@router.get("/tax-rates/{rate_id:int}/", dependencies=[Depends(product_access)])
def get_tax_rate(rate_id: int, db: Session = Depends(get_db)):
    return ser.tax_rate(get_or_404(db, TaxRate, rate_id, "TaxRate"))


@router.put("/tax-rates/{rate_id:int}/", dependencies=[Depends(product_access)])
@router.patch("/tax-rates/{rate_id:int}/", dependencies=[Depends(product_access)])
def update_tax_rate(rate_id: int, body: TaxRateIn, db: Session = Depends(get_db)):
    rate = get_or_404(db, TaxRate, rate_id, "TaxRate")
    data = _prepare_tax_rate(db, body.model_dump(exclude_unset=True), rate)
    if "rate" in data and data["rate"] != rate.rate:
        used = db.scalar(select(exists().where(SalesInvoiceItem.tax_rate_id == rate.id))) or \
            db.scalar(select(exists().where(PurchaseBillItem.tax_rate_id == rate.id)))
        if used:
            raise bad_request(f'"{rate.name}" is used on invoices or bills, so its rate cannot change - '
                              'add a new tax rate and mark this one inactive.')
    for field, value in data.items():
        setattr(rate, field, value)
    db.commit()
    db.refresh(rate)
    return ser.tax_rate(rate)


@router.delete("/tax-rates/{rate_id:int}/", status_code=204, dependencies=[Depends(product_access)])
def delete_tax_rate(rate_id: int, db: Session = Depends(get_db)):
    rate = get_or_404(db, TaxRate, rate_id, "TaxRate")
    if db.scalar(select(exists().where(SalesInvoiceItem.tax_rate_id == rate.id))) or \
            db.scalar(select(exists().where(PurchaseBillItem.tax_rate_id == rate.id))):
        raise bad_request(f'"{rate.name}" is used on invoices or bills - mark it inactive instead.')
    db.delete(rate)
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Products & services
# ---------------------------------------------------------------------------

def _prepare_product(db: Session, data: dict, obj: Optional[Product]) -> dict:
    if obj is None and not (data.get("name") or "").strip():
        raise APIError(400, {"name": ["This field is required."]})
    _check_unique(db, Product, obj, name=data.get("name"), code=data.get("code"))
    if "tax_rate" in data:
        if data["tax_rate"] is not None and not db.get(TaxRate, data["tax_rate"]):
            raise field_error("tax_rate", f'Invalid pk "{data["tax_rate"]}" - object does not exist.')
        data["tax_rate_id"] = data.pop("tax_rate")
    for field in ("income_account", "expense_account"):
        if field in data:
            _check_account(db, field, data[field])
            data[f"{field}_id"] = data.pop(field)
    for field in ("description", "hsn_sac_code"):
        if field in data and data[field] is None:
            data[field] = ""
    return data


def _product_stmt():
    return select(Product).options(joinedload(Product.tax_rate), joinedload(Product.income_account),
                                   joinedload(Product.expense_account))


@router.get("/products/", dependencies=[Depends(product_access)])
def list_products(db: Session = Depends(get_db), search: Optional[str] = None, item_type: Optional[ItemType] = None,
                  is_active: Optional[str] = None, ordering: Optional[str] = None, page: Optional[str] = None,
                  limit: Optional[str] = None):
    stmt = apply_search(_product_stmt(), search, Product.name, Product.code, Product.hsn_sac_code, Product.description)
    if item_type:
        stmt = stmt.where(Product.item_type == item_type)
    if is_active is not None:
        stmt = stmt.where(Product.is_active.is_(is_true(is_active)))
    stmt = apply_ordering(stmt, ordering, {"name": Product.name, "code": Product.code,
                                           "sale_price": Product.sale_price}, [Product.name])
    return paginate(db, stmt, page, limit, ser.product)


@router.post("/products/", status_code=201, dependencies=[Depends(product_access)])
def create_product(body: ProductIn, db: Session = Depends(get_db)):
    product = Product(**_prepare_product(db, body.model_dump(exclude_unset=True), None))
    db.add(product)
    db.commit()
    return ser.product(db.get(Product, product.id))


@router.get("/products/{product_id:int}/", dependencies=[Depends(product_access)])
def get_product(product_id: int, db: Session = Depends(get_db)):
    return ser.product(get_or_404(db, Product, product_id))


@router.put("/products/{product_id:int}/", dependencies=[Depends(product_access)])
@router.patch("/products/{product_id:int}/", dependencies=[Depends(product_access)])
def update_product(product_id: int, body: ProductIn, db: Session = Depends(get_db)):
    product = get_or_404(db, Product, product_id)
    for field, value in _prepare_product(db, body.model_dump(exclude_unset=True), product).items():
        setattr(product, field, value)
    db.commit()
    db.refresh(product)
    return ser.product(product)


@router.delete("/products/{product_id:int}/", status_code=204, dependencies=[Depends(product_access)])
def delete_product(product_id: int, db: Session = Depends(get_db)):
    # Invoice / bill lines keep their own description and prices, so they just lose the product link.
    db.delete(get_or_404(db, Product, product_id))
    db.commit()
    return Response(status_code=204)
