"""Masters: Chart of Accounts, lookups, auto-categorization rules, BAI codes, bank accounts."""
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import and_, case, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from .. import serializers as ser
from ..access import CREATE, DELETE, EDIT
from ..database import get_db
from ..deps import Access
from ..errors import APIError, bad_request, field_error
from ..models import (
    AccountType, BaiCode, BankAccount, Category, CategoryKeyword, JournalEntryLine, SubCategory, Transaction,
)
from ..schemas import BaiCodeIn, BankAccountIn, CategorizationSettingsIn, CategoryIn, KeywordIn, RowsIn, SubCategoryIn
from ..services import period_close
from ..services.seed import seed_bai_codes
from ..services.settings import categorization_settings
from ..utils import apply_ordering, apply_search, get_or_404, int_list, is_true, paginate
from .common import bulk_row_errors, period_guard

router = APIRouter(prefix="/api", tags=["masters"])


def _exists(db: Session, *where) -> bool:
    return bool(db.scalar(select(func.count()).where(*where)))


def _guard_closed_usage(db: Session, column, value, what: str) -> None:
    """Deleting an account, or moving it to another type / category, changes every report it
    appears on - refused while transactions dated in a closed period are posted to it."""
    period_guard(period_close.guard_transactions, db, select(Transaction.id).where(column == value), what)


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

category_access = Access("categories", "bai_codes", "transactions", "bank_statements", "journal_entries",
                         write_pages=("categories",),
                         inline_create_pages=("transactions", "bank_statements", "journal_entries"))


def _check_category(db: Session, data: dict, obj: Optional[Category] = None) -> None:
    name = data.get("name", obj.name if obj else None)
    account_type = data.get("account_type", obj.account_type if obj else None)
    if obj is None:
        missing = {f: ["This field is required."] for f in ("name", "account_type") if not data.get(f)}
        if missing:
            raise APIError(400, missing)
    if data.get("code"):
        clash = select(Category.id).where(Category.code == data["code"], Category.id != (obj.id if obj else 0))
        if db.scalar(clash):
            raise field_error("code", "category with this code already exists.")
    clash = select(Category.id).where(Category.name == name, Category.account_type == account_type,
                                      Category.id != (obj.id if obj else 0))
    if db.scalar(clash):
        raise field_error("non_field_errors", "The fields account_type, name must make a unique set.")


def _category_stmt(search, account_type, is_active):
    stmt = select(Category).options(selectinload(Category.subcategories).joinedload(SubCategory.category))
    stmt = apply_search(
        stmt, search, Category.name, Category.code, Category.account_type,
        lambda t: Category.subcategories.any(or_(SubCategory.name.ilike(f"%{t}%"), SubCategory.code.ilike(f"%{t}%"))),
    )
    if account_type:
        stmt = stmt.where(Category.account_type == account_type)
    if is_active is not None:
        stmt = stmt.where(Category.is_active.is_(is_true(is_active)))
    return stmt


@router.get("/categories/", dependencies=[Depends(category_access)])
def list_categories(db: Session = Depends(get_db), search: Optional[str] = None, account_type: Optional[str] = None,
                    is_active: Optional[str] = None, ordering: Optional[str] = None,
                    page: Optional[str] = None, limit: Optional[str] = None):
    stmt = apply_ordering(_category_stmt(search, account_type, is_active), ordering,
                          {"name": Category.name, "code": Category.code, "account_type": Category.account_type},
                          [Category.account_type, Category.name])
    return paginate(db, stmt, page, limit, ser.category)


@router.post("/categories/", status_code=201, dependencies=[Depends(category_access)])
def create_category(body: CategoryIn, db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    _check_category(db, data)
    category = Category(**data)
    db.add(category)
    db.commit()
    return ser.category(category)


@router.get("/categories/summary/", dependencies=[Depends(category_access)])
def categories_summary(db: Session = Depends(get_db)):
    """How many categories and sub categories each account type has, over the whole Chart of Accounts."""
    by_type = {t.value: {"categories": 0, "sub_categories": 0} for t in AccountType}
    for t, n in db.execute(select(Category.account_type, func.count(Category.id)).group_by(Category.account_type)):
        by_type[t.value]["categories"] = n
    for t, n in db.execute(select(Category.account_type, func.count(SubCategory.id))
                           .join(SubCategory, SubCategory.category_id == Category.id).group_by(Category.account_type)):
        by_type[t.value]["sub_categories"] = n
    return {
        "categories": sum(v["categories"] for v in by_type.values()),
        "sub_categories": sum(v["sub_categories"] for v in by_type.values()),
        "by_type": by_type,
    }


@router.post("/categories/clear-all/", dependencies=[Depends(Access(*category_access.pages, write_pages=("categories",),
                                                                      action=DELETE))])
def clear_all_categories(db: Session = Depends(get_db)):
    """Deletes every account and sub-category that is not in use, with their keyword rules. Kept:
    sub-categories used by a transaction, a journal line, a bank account, a product, an invoice /
    bill line or a tax rate, and the accounts holding them or used by a transaction."""
    from ..models import Product, PurchaseBillItem, SalesInvoiceItem, TaxRate
    used_sub_ids = set()
    for column in (Transaction.sub_category_id, JournalEntryLine.sub_category_id, BankAccount.gl_account_id,
                   Product.income_account_id, Product.expense_account_id, SalesInvoiceItem.account_id,
                   PurchaseBillItem.account_id, TaxRate.output_tax_account_id, TaxRate.input_tax_account_id):
        used_sub_ids |= set(db.scalars(select(column).where(column.is_not(None)).distinct()).all())
    used_cat_ids = set(db.scalars(select(Transaction.category_id).where(Transaction.category_id.is_not(None))
                                  .distinct()).all())
    used_cat_ids |= set(db.scalars(select(SubCategory.category_id).where(SubCategory.id.in_(used_sub_ids))).all())

    subs = db.scalars(select(SubCategory).where(SubCategory.id.not_in(used_sub_ids))).all()
    deleted_subs = len(subs)
    for sub in subs:
        db.delete(sub)  # cascades to their keyword rules
    db.flush()
    deletable = db.scalars(select(Category).where(Category.id.not_in(used_cat_ids))).all()
    deleted_categories = len(deletable)
    for cat in deletable:
        db.delete(cat)
    db.commit()
    kept = db.scalar(select(func.count(Category.id)))
    kept_subs = db.scalar(select(func.count(SubCategory.id)))
    message = f'Deleted {deleted_categories} account(s) and {deleted_subs} sub-categor{"y" if deleted_subs == 1 else "ies"}.'
    if kept:
        message += (f' Kept {kept} account(s) with {kept_subs} sub-categor{"y" if kept_subs == 1 else "ies"} '
                    'that are used by transactions, journal entries or bank accounts.')
    return {"deleted_categories": deleted_categories, "kept_categories": kept,
            "deleted_sub_categories": deleted_subs, "kept_sub_categories": kept_subs, "message": message}


@router.post("/categories/bulk-import/", status_code=201,
             dependencies=[Depends(Access(*category_access.pages, write_pages=("categories",), action=CREATE))])
def bulk_import_categories(body: RowsIn, db: Session = Depends(get_db)):
    """Excel import. {"rows": [{"name", "account_type", "code", "description", "sub_categories": [{"name", "code",
    "description"}]}]}. Existing categories / sub-categories are matched case-insensitively and reused; only missing
    ones are created (codes only applied to new records). All-or-nothing."""
    rows = body.rows
    if not isinstance(rows, list) or not rows:
        raise bad_request("A non-empty list of rows is required.")
    valid_types = {t.value for t in AccountType}

    def clean_code(value):
        return value.strip() if isinstance(value, str) else ""

    errors = []
    for i, row in enumerate(rows, start=1):
        subs = row.get("sub_categories") if isinstance(row, dict) else None
        if not isinstance(row, dict) or not isinstance(row.get("name"), str) or not row["name"].strip():
            errors.append(f"Row {i}: category name is required.")
        elif len(row["name"].strip()) > 150:
            errors.append(f"Row {i}: category name is longer than 150 characters.")
        elif row.get("account_type") not in valid_types:
            errors.append(f'Row {i}: invalid account type "{row.get("account_type")}".')
        elif subs is not None and not isinstance(subs, list):
            errors.append(f"Row {i}: sub_categories must be a list.")
        elif any(not isinstance(s, dict) or not isinstance(s.get("name"), str) or not s["name"].strip() for s in subs or []):
            errors.append(f"Row {i}: sub-category name is required.")
        elif any(len(s["name"].strip()) > 150 for s in subs or []):
            errors.append(f"Row {i}: sub-category name is longer than 150 characters.")
        elif any(len(clean_code(x.get("code"))) > 20 for x in [row, *(subs or [])]):
            errors.append(f"Row {i}: code is longer than 20 characters.")
    if errors:
        raise APIError(400, {"error": errors})

    def code_conflicts(model, objs, label):
        codes = [o.code for o in objs if o.code]
        clashes = {c for c in codes if codes.count(c) > 1}
        clashes |= set(db.scalars(select(model.code).where(model.code.in_(codes))).all())
        if clashes:
            db.rollback()
            raise APIError(400, {"error": [f'{label} code "{c}" is already used.' for c in sorted(clashes)]})

    categories = {(c.account_type.value, c.name.lower()): c for c in db.scalars(select(Category))}
    new_categories = {}
    for row in rows:
        key = (row["account_type"], row["name"].strip().lower())
        if key not in categories and key not in new_categories:
            new_categories[key] = Category(code=clean_code(row.get("code")) or None, name=row["name"].strip(),
                                           account_type=row["account_type"],
                                           description=(row.get("description") or "").strip() or None)
    code_conflicts(Category, new_categories.values(), "Category")
    db.add_all(new_categories.values())
    db.flush()
    categories.update(new_categories)

    existing_subs = {(s.category_id, s.name.lower()) for s in db.scalars(select(SubCategory))}
    new_subs = {}
    for row in rows:
        category = categories[(row["account_type"], row["name"].strip().lower())]
        for sub in row.get("sub_categories") or []:
            key = (category.id, sub["name"].strip().lower())
            if key not in existing_subs and key not in new_subs:
                new_subs[key] = SubCategory(category_id=category.id, code=clean_code(sub.get("code")) or None,
                                            name=sub["name"].strip(),
                                            description=(sub.get("description") or "").strip() or None)
    code_conflicts(SubCategory, new_subs.values(), "Sub-category")
    db.add_all(new_subs.values())
    db.commit()
    return {"categories_created": len(new_categories), "subcategories_created": len(new_subs)}


@router.get("/categories/{category_id:int}/", dependencies=[Depends(category_access)])
def get_category(category_id: int, db: Session = Depends(get_db)):
    return ser.category(get_or_404(db, Category, category_id))


@router.put("/categories/{category_id:int}/", dependencies=[Depends(category_access)])
@router.patch("/categories/{category_id:int}/", dependencies=[Depends(category_access)])
def update_category(category_id: int, body: CategoryIn, db: Session = Depends(get_db)):
    category = get_or_404(db, Category, category_id)
    data = body.model_dump(exclude_unset=True)
    _check_category(db, data, category)
    if data.get("account_type") and data["account_type"] != category.account_type:
        _guard_closed_usage(db, Transaction.category_id, category.id,
                            "this account has transactions dated in that period, so its type cannot change")
    for field, value in data.items():
        setattr(category, field, value)
    db.commit()
    return ser.category(category)


@router.delete("/categories/{category_id:int}/", status_code=204, dependencies=[Depends(category_access)])
def delete_category(category_id: int, db: Session = Depends(get_db)):
    category = get_or_404(db, Category, category_id)
    _guard_closed_usage(db, Transaction.category_id, category.id,
                        "this account has transactions dated in that period, so it cannot be deleted")
    if category.subcategories:
        raise bad_request(f'"{category.name}" still has {len(category.subcategories)} sub-categor'
                          f'{"y" if len(category.subcategories) == 1 else "ies"} - delete or move them first.')
    db.delete(category)
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Sub-categories
# ---------------------------------------------------------------------------

sub_access = Access("categories", "transactions", "bank_statements", "bank_accounts", "bank_reconciliation",
                    "journal_entries", "clients", "suppliers", "products", "sales_invoices", "purchase_bills",
                    write_pages=("categories",),
                    inline_create_pages=("transactions", "bank_statements", "bank_accounts", "bank_reconciliation",
                                         "journal_entries", "products"))


def _check_sub_category(db: Session, data: dict, obj: Optional[SubCategory] = None) -> None:
    if obj is None:
        missing = {f: ["This field is required."] for f in ("category", "name") if not data.get(f)}
        if missing:
            raise APIError(400, missing)
    if "category" in data and not db.get(Category, data["category"] or 0):
        raise field_error("category", f'Invalid pk "{data["category"]}" - object does not exist.')
    if data.get("code") and db.scalar(select(SubCategory.id).where(SubCategory.code == data["code"],
                                                                   SubCategory.id != (obj.id if obj else 0))):
        raise field_error("code", "sub category with this code already exists.")
    category_id = data.get("category", obj.category_id if obj else None)
    name = data.get("name", obj.name if obj else None)
    if db.scalar(select(SubCategory.id).where(SubCategory.category_id == category_id, SubCategory.name == name,
                                              SubCategory.id != (obj.id if obj else 0))):
        raise field_error("non_field_errors", "The fields category, name must make a unique set.")


def _sub_fields(data: dict) -> dict:
    if "category" in data:
        data["category_id"] = data.pop("category")
    return data


@router.get("/subcategories/", dependencies=[Depends(sub_access)])
def list_sub_categories(db: Session = Depends(get_db), search: Optional[str] = None, category: Optional[int] = None,
                        is_active: Optional[str] = None, ordering: Optional[str] = None,
                        page: Optional[str] = None, limit: Optional[str] = None):
    stmt = select(SubCategory).join(Category, SubCategory.category_id == Category.id)
    stmt = apply_search(stmt, search, SubCategory.name, SubCategory.code, Category.name)
    if category:
        stmt = stmt.where(SubCategory.category_id == category)
    if is_active is not None:
        stmt = stmt.where(SubCategory.is_active.is_(is_true(is_active)))
    stmt = apply_ordering(stmt, ordering, {"name": SubCategory.name, "code": SubCategory.code},
                          [Category.account_type, SubCategory.name])
    return paginate(db, stmt, page, limit, ser.sub_category)


@router.post("/subcategories/", status_code=201, dependencies=[Depends(sub_access)])
def create_sub_category(body: SubCategoryIn, db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    _check_sub_category(db, data)
    sub = SubCategory(**_sub_fields(data))
    db.add(sub)
    db.commit()
    return ser.sub_category(sub)


@router.get("/subcategories/{sub_id:int}/", dependencies=[Depends(sub_access)])
def get_sub_category(sub_id: int, db: Session = Depends(get_db)):
    return ser.sub_category(get_or_404(db, SubCategory, sub_id, "SubCategory"))


@router.put("/subcategories/{sub_id:int}/", dependencies=[Depends(sub_access)])
@router.patch("/subcategories/{sub_id:int}/", dependencies=[Depends(sub_access)])
def update_sub_category(sub_id: int, body: SubCategoryIn, db: Session = Depends(get_db)):
    sub = get_or_404(db, SubCategory, sub_id, "SubCategory")
    data = body.model_dump(exclude_unset=True)
    _check_sub_category(db, data, sub)
    if data.get("category") and data["category"] != sub.category_id:
        _guard_closed_usage(db, Transaction.sub_category_id, sub.id,
                            "this account has transactions dated in that period, so it cannot move to another category")
    for field, value in _sub_fields(data).items():
        setattr(sub, field, value)
    db.commit()
    db.refresh(sub)
    return ser.sub_category(sub)


@router.delete("/subcategories/{sub_id:int}/", status_code=204, dependencies=[Depends(sub_access)])
def delete_sub_category(sub_id: int, db: Session = Depends(get_db)):
    sub = get_or_404(db, SubCategory, sub_id, "SubCategory")
    _guard_closed_usage(db, Transaction.sub_category_id, sub.id,
                        "this account has transactions dated in that period, so it cannot be deleted")
    if db.scalar(select(func.count(JournalEntryLine.id)).where(JournalEntryLine.sub_category_id == sub.id)):
        raise bad_request(f'"{sub.name}" has journal entry lines posted to it, so it cannot be deleted.')
    db.delete(sub)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise bad_request(f'"{sub.name}" is still used (by an invoice, bill, product or tax rate), so it cannot be deleted.')
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Lookups for searchable dropdowns
# ---------------------------------------------------------------------------

ACCOUNT_TYPE_SEARCH_WORDS = {
    "ASSET": ["asset", "assets"],
    "LIABILITY": ["liability", "liabilities"],
    "EQUITY": ["equity", "capital"],
    "INCOME": ["income", "revenue"],
    "EXPENSE": ["expense", "expenses", "expenditure"],
}


def _account_types_matching(term: str) -> list[str]:
    """Account types a search term refers to - 'liab', 'Liabilities' and 'LIABILITY' all mean LIABILITY.
    Terms under 3 letters don't match a type."""
    term = term.lower()
    if len(term) < 3:
        return []
    return [code for code, words in ACCOUNT_TYPE_SEARCH_WORDS.items()
            if any(w.startswith(term) or term.startswith(w) for w in words)]


def _word_start(column, term: str):
    """`term` at the start of a word in `column` - so 'rent' doesn't match 'Current Assets'."""
    return or_(column.ilike(f"{term}%"), *(column.ilike(f"%{sep}{term}%") for sep in (" ", "-", "/", "(", "&")))


def _lookup_search(stmt, search: str, name_col, code_col, type_col, parent_col=None):
    """Every term must match the name (anywhere), the parent's name (at a word start), the code
    (prefix) or the account type. Items whose own name matches sort first."""
    terms = (search or "").split()
    own = []
    for term in terms:
        clauses = [name_col.ilike(f"%{term}%"), code_col.ilike(f"{term}%")]
        types = _account_types_matching(term)
        if types:
            clauses.append(type_col.in_(types))
        if parent_col is not None:
            clauses.append(_word_start(parent_col, term))
        stmt = stmt.where(or_(*clauses))
        own.append(or_(name_col.ilike(f"%{term}%"), code_col.ilike(f"{term}%")))
    rank = case((and_(*own), 0), else_=1) if own else None
    return stmt, rank


@router.get("/lookups/categories/", dependencies=[Depends(Access())])
def lookup_categories(db: Session = Depends(get_db), search: str = "", account_type: Optional[str] = None,
                      ids: Optional[str] = None, page: Optional[str] = None, limit: Optional[str] = None):
    """Active categories for searchable dropdowns, 20 per page (limit up to 50)."""
    stmt = select(Category).where(Category.is_active.is_(True))
    if ids:
        stmt = stmt.where(Category.id.in_(int_list(ids)))
    if account_type:
        stmt = stmt.where(Category.account_type == account_type)
    stmt, rank = _lookup_search(stmt, search, Category.name, Category.code, Category.account_type)
    order = ([rank] if rank is not None else []) + [Category.account_type, Category.name, Category.id]
    return paginate(db, stmt.order_by(*order), page, limit, ser.category_lookup, default_size=20, max_size=50)


@router.get("/lookups/subcategories/", dependencies=[Depends(Access())])
def lookup_sub_categories(db: Session = Depends(get_db), search: str = "", category: Optional[int] = None,
                          account_type: Optional[str] = None, ids: Optional[str] = None,
                          gl_free_for: Optional[str] = None, page: Optional[str] = None, limit: Optional[str] = None):
    """Active sub-categories, 20 per page. gl_free_for=<bank account id> leaves out sub-categories already
    linked as another bank account's GL account."""
    stmt = (select(SubCategory).join(Category, SubCategory.category_id == Category.id)
            .where(SubCategory.is_active.is_(True), Category.is_active.is_(True))
            .options(joinedload(SubCategory.category), joinedload(SubCategory.bank_account)))
    if ids:
        stmt = stmt.where(SubCategory.id.in_(int_list(ids)))
    if category:
        stmt = stmt.where(SubCategory.category_id == category)
    if account_type:
        stmt = stmt.where(Category.account_type == account_type)
    if gl_free_for is not None:
        linked = select(BankAccount.gl_account_id).where(BankAccount.gl_account_id.is_not(None))
        if gl_free_for.isdigit() and int(gl_free_for):
            linked = linked.where(BankAccount.id != int(gl_free_for))
        stmt = stmt.where(SubCategory.id.not_in(linked))
    stmt, rank = _lookup_search(stmt, search, SubCategory.name, SubCategory.code, Category.account_type, Category.name)
    order = ([rank] if rank is not None else []) + [Category.account_type, Category.name, SubCategory.name, SubCategory.id]
    return paginate(db, stmt.order_by(*order), page, limit, ser.sub_category_lookup, default_size=20, max_size=50)


@router.get("/lookups/bank-accounts/", dependencies=[Depends(Access())])
def lookup_bank_accounts(db: Session = Depends(get_db), search: str = "", ids: Optional[str] = None,
                         page: Optional[str] = None, limit: Optional[str] = None):
    """Bank accounts for filter / upload dropdowns, 20 per page. Inactive ones are included and flagged."""
    stmt = select(BankAccount)
    if ids:
        stmt = stmt.where(BankAccount.id.in_(int_list(ids)))
    stmt = apply_search(stmt, search, BankAccount.name, BankAccount.bank_name, BankAccount.account_number)
    stmt = stmt.order_by(BankAccount.is_active.desc(), BankAccount.name, BankAccount.id)
    return paginate(db, stmt, page, limit, ser.bank_account_lookup, default_size=20, max_size=50)


# ---------------------------------------------------------------------------
# Generic CRUD helpers for keywords, BAI codes and bank accounts
# ---------------------------------------------------------------------------

def _bulk_create(db: Session, rows, schema, prepare, model):
    """POST <resource>/bulk-create/ {"rows": [...]} - every row validated; nothing saved unless all are valid."""
    if not isinstance(rows, list) or not rows:
        raise bad_request("A non-empty list of rows is required.")
    try:
        parsed = TypeAdapter(list[schema]).validate_python(rows)
    except ValidationError as exc:
        raise APIError(400, {"error": bulk_row_errors(exc)})
    errors, objects = [], []
    for i, item in enumerate(parsed, start=1):
        try:
            objects.append(model(**prepare(db, item.model_dump(exclude_unset=True), None)))
        except APIError as exc:
            detail = "; ".join(f'{k}: {" ".join(map(str, v if isinstance(v, list) else [v]))}'
                               for k, v in exc.payload.items())
            errors.append(f"Row {i}: {detail}")
    if errors:
        raise APIError(400, {"error": errors})
    db.add_all(objects)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise bad_request("The file contains duplicate rows.")
    return {"created": len(objects)}


# ---------------------------------------------------------------------------
# Auto-categorization keyword rules
# ---------------------------------------------------------------------------

keyword_access = Access("category_keywords")


def _prepare_keyword(db: Session, data: dict, obj: Optional[CategoryKeyword]) -> dict:
    if obj is None:
        missing = {f: ["This field is required."] for f in ("keyword", "sub_category") if not data.get(f)}
        if missing:
            raise APIError(400, missing)
    if "sub_category" in data:
        if not db.get(SubCategory, data["sub_category"] or 0):
            raise field_error("sub_category", f'Invalid pk "{data["sub_category"]}" - object does not exist.')
        data["sub_category_id"] = data.pop("sub_category")
    if data.get("keyword") and db.scalar(select(CategoryKeyword.id).where(
            CategoryKeyword.keyword == data["keyword"], CategoryKeyword.id != (obj.id if obj else 0))):
        raise field_error("keyword", "category keyword with this keyword already exists.")
    return data


def _keyword_stmt():
    return select(CategoryKeyword).options(joinedload(CategoryKeyword.sub_category).joinedload(SubCategory.category))


@router.get("/category-keywords/", dependencies=[Depends(keyword_access)])
def list_keywords(db: Session = Depends(get_db), search: Optional[str] = None, sub_category: Optional[int] = None,
                  category: Optional[int] = None, account_type: Optional[str] = None, auto_assign: Optional[str] = None,
                  ordering: Optional[str] = None, page: Optional[str] = None, limit: Optional[str] = None):
    stmt = apply_search(_keyword_stmt(), search, CategoryKeyword.keyword)
    if sub_category:
        stmt = stmt.where(CategoryKeyword.sub_category_id == sub_category)
    if category or account_type:
        subs = select(SubCategory.id).join(Category, SubCategory.category_id == Category.id)
        if category:
            subs = subs.where(SubCategory.category_id == category)
        if account_type:
            subs = subs.where(Category.account_type == account_type.upper())
        stmt = stmt.where(CategoryKeyword.sub_category_id.in_(subs))
    if auto_assign is not None:
        stmt = stmt.where(CategoryKeyword.auto_assign.is_(is_true(auto_assign)))
    stmt = apply_ordering(stmt, ordering, {"keyword": CategoryKeyword.keyword}, [CategoryKeyword.keyword])
    return paginate(db, stmt, page, limit, ser.keyword)


@router.post("/category-keywords/", status_code=201, dependencies=[Depends(keyword_access)])
def create_keyword(body: KeywordIn, db: Session = Depends(get_db)):
    kw = CategoryKeyword(**_prepare_keyword(db, body.model_dump(exclude_unset=True), None))
    db.add(kw)
    db.commit()
    return ser.keyword(db.get(CategoryKeyword, kw.id))


@router.post("/category-keywords/bulk-create/", status_code=201, dependencies=[Depends(keyword_access)])
def bulk_create_keywords(body: RowsIn, db: Session = Depends(get_db)):
    return _bulk_create(db, body.rows, KeywordIn, _prepare_keyword, CategoryKeyword)


@router.post("/category-keywords/clear-all/", dependencies=[Depends(Access("category_keywords", action=DELETE))])
def clear_keywords(db: Session = Depends(get_db)):
    """Deletes every keyword rule. Already-categorized transactions are unaffected."""
    count = db.execute(delete(CategoryKeyword)).rowcount
    db.commit()
    return {"deleted": count, "message": f"Deleted {count} keyword rule(s)."}


@router.get("/category-keywords/coa-tree/", dependencies=[Depends(keyword_access)])
def keywords_coa_tree(db: Session = Depends(get_db)):
    counts = dict(db.execute(select(CategoryKeyword.sub_category_id, func.count(CategoryKeyword.id))
                             .group_by(CategoryKeyword.sub_category_id)).all())
    categories = db.scalars(select(Category).options(selectinload(Category.subcategories))
                            .order_by(Category.account_type, Category.name)).all()
    return [{
        "id": c.id, "name": c.name, "account_type": c.account_type.value, "description": c.description,
        "is_active": c.is_active,
        "subcategories": [{"id": s.id, "name": s.name, "description": s.description, "is_active": s.is_active,
                           "keyword_count": counts.get(s.id, 0)} for s in c.subcategories],
    } for c in categories]


@router.get("/category-keywords/summary/", dependencies=[Depends(keyword_access)])
def keywords_summary(db: Session = Depends(get_db)):
    rows = db.execute(select(CategoryKeyword.is_active, CategoryKeyword.auto_assign, Category.account_type)
                      .join(SubCategory, CategoryKeyword.sub_category_id == SubCategory.id)
                      .join(Category, SubCategory.category_id == Category.id)).all()
    return {
        "total": len(rows),
        "active": sum(1 for r in rows if r[0]),
        "auto_assign": sum(1 for r in rows if r[1]),
        "expense": sum(1 for r in rows if r[2] == AccountType.EXPENSE),
        "income": sum(1 for r in rows if r[2] == AccountType.INCOME),
    }


@router.get("/category-keywords/{kw_id:int}/", dependencies=[Depends(keyword_access)])
def get_keyword(kw_id: int, db: Session = Depends(get_db)):
    return ser.keyword(get_or_404(db, CategoryKeyword, kw_id, "CategoryKeyword"))


@router.put("/category-keywords/{kw_id:int}/", dependencies=[Depends(keyword_access)])
@router.patch("/category-keywords/{kw_id:int}/", dependencies=[Depends(keyword_access)])
def update_keyword(kw_id: int, body: KeywordIn, db: Session = Depends(get_db)):
    kw = get_or_404(db, CategoryKeyword, kw_id, "CategoryKeyword")
    for field, value in _prepare_keyword(db, body.model_dump(exclude_unset=True), kw).items():
        setattr(kw, field, value)
    db.commit()
    db.refresh(kw)
    return ser.keyword(kw)


@router.delete("/category-keywords/{kw_id:int}/", status_code=204, dependencies=[Depends(keyword_access)])
def delete_keyword(kw_id: int, db: Session = Depends(get_db)):
    db.delete(get_or_404(db, CategoryKeyword, kw_id, "CategoryKeyword"))
    db.commit()
    return Response(status_code=204)


@router.get("/categorization-settings/", dependencies=[Depends(keyword_access)])
def get_categorization_settings(db: Session = Depends(get_db)):
    s = categorization_settings(db)
    db.commit()
    return {f: getattr(s, f) for f in CategorizationSettingsIn.model_fields}


@router.put("/categorization-settings/", dependencies=[Depends(Access("category_keywords", action=EDIT))])
def update_categorization_settings(body: CategorizationSettingsIn, db: Session = Depends(get_db)):
    s = categorization_settings(db)
    for field, value in body.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(s, field, value)
    db.commit()
    return {f: getattr(s, f) for f in CategorizationSettingsIn.model_fields}


# ---------------------------------------------------------------------------
# BAI codes
# ---------------------------------------------------------------------------

bai_access = Access("bai_codes")


def _prepare_bai(db: Session, data: dict, obj: Optional[BaiCode]) -> dict:
    if obj is None:
        missing = {f: ["This field is required."] for f in ("code", "description") if not data.get(f)}
        if missing:
            raise APIError(400, missing)
    if data.get("code") and db.scalar(select(BaiCode.id).where(BaiCode.code == data["code"],
                                                               BaiCode.id != (obj.id if obj else 0))):
        raise field_error("code", "bai code with this code already exists.")
    category = sub = None
    if data.get("category"):
        category = db.get(Category, data["category"])
        if not category:
            raise field_error("category", f'Invalid pk "{data["category"]}" - object does not exist.')
    if data.get("sub_category"):
        sub = db.get(SubCategory, data["sub_category"])
        if not sub:
            raise field_error("sub_category", f'Invalid pk "{data["sub_category"]}" - object does not exist.')
        if category and sub.category_id != category.id:
            raise field_error("sub_category",
                              f'Sub-category "{sub.name}" does not belong to category "{category.name}".')
        data["category"] = sub.category_id
    for field in ("category", "sub_category"):
        if field in data:
            data[f"{field}_id"] = data.pop(field)
    return data


@router.get("/bai-codes/", dependencies=[Depends(bai_access)])
def list_bai_codes(db: Session = Depends(get_db), search: Optional[str] = None, ordering: Optional[str] = None,
                   page: Optional[str] = None, limit: Optional[str] = None):
    stmt = apply_search(select(BaiCode), search, BaiCode.code, BaiCode.description)
    stmt = apply_ordering(stmt, ordering, {"code": BaiCode.code}, [BaiCode.code])
    return paginate(db, stmt, page, limit, ser.bai_code)


@router.post("/bai-codes/", status_code=201, dependencies=[Depends(bai_access)])
def create_bai_code(body: BaiCodeIn, db: Session = Depends(get_db)):
    bai = BaiCode(**_prepare_bai(db, body.model_dump(exclude_unset=True), None))
    db.add(bai)
    db.commit()
    return ser.bai_code(db.get(BaiCode, bai.id))


@router.post("/bai-codes/bulk-create/", status_code=201, dependencies=[Depends(bai_access)])
def bulk_create_bai_codes(body: RowsIn, db: Session = Depends(get_db)):
    return _bulk_create(db, body.rows, BaiCodeIn, _prepare_bai, BaiCode)


@router.post("/bai-codes/clear-all/", dependencies=[Depends(Access("bai_codes", action=DELETE))])
def clear_bai_codes(db: Session = Depends(get_db)):
    count = db.execute(delete(BaiCode)).rowcount
    db.commit()
    return {"message": f"Cleared {count} BAI codes."}


@router.post("/bai-codes/seed-defaults/", dependencies=[Depends(bai_access)])
def seed_default_bai_codes(db: Session = Depends(get_db)):
    seed_bai_codes(db)
    return {"message": "Standard BAI codes seeded."}


@router.get("/bai-codes/summary/", dependencies=[Depends(bai_access)])
def bai_codes_summary(db: Session = Depends(get_db)):
    total = db.scalar(select(func.count(BaiCode.id)))
    mapped = db.scalar(select(func.count(BaiCode.id)).where(BaiCode.category_id.is_not(None)))
    return {"total": total, "mapped": mapped, "unmapped": total - mapped}


@router.get("/bai-codes/{bai_id:int}/", dependencies=[Depends(bai_access)])
def get_bai_code(bai_id: int, db: Session = Depends(get_db)):
    return ser.bai_code(get_or_404(db, BaiCode, bai_id, "BaiCode"))


@router.put("/bai-codes/{bai_id:int}/", dependencies=[Depends(bai_access)])
@router.patch("/bai-codes/{bai_id:int}/", dependencies=[Depends(bai_access)])
def update_bai_code(bai_id: int, body: BaiCodeIn, db: Session = Depends(get_db)):
    bai = get_or_404(db, BaiCode, bai_id, "BaiCode")
    for field, value in _prepare_bai(db, body.model_dump(exclude_unset=True), bai).items():
        setattr(bai, field, value)
    db.commit()
    db.refresh(bai)
    return ser.bai_code(bai)


@router.delete("/bai-codes/{bai_id:int}/", status_code=204, dependencies=[Depends(bai_access)])
def delete_bai_code(bai_id: int, db: Session = Depends(get_db)):
    db.delete(get_or_404(db, BaiCode, bai_id, "BaiCode"))
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Bank accounts
# ---------------------------------------------------------------------------

# Bank Reconciliation links an account to its GL account, which is an edit of the account.
bank_access = Access("bank_accounts", "bank_reconciliation", "journal_entries", "payments",
                     write_pages={CREATE: ("bank_accounts",), EDIT: ("bank_accounts", "bank_reconciliation"),
                                  DELETE: ("bank_accounts",)})


def _prepare_bank_account(db: Session, data: dict, obj: Optional[BankAccount]) -> dict:
    if obj is None and not data.get("name"):
        raise APIError(400, {"name": ["This field is required."]})
    if data.get("name") and db.scalar(select(BankAccount.id).where(BankAccount.name == data["name"],
                                                                   BankAccount.id != (obj.id if obj else 0))):
        raise field_error("name", "bank account with this name already exists.")
    if "gl_account" in data:
        gl = data.pop("gl_account")
        if gl is not None:
            if not db.get(SubCategory, gl):
                raise field_error("gl_account", f'Invalid pk "{gl}" - object does not exist.')
            if db.scalar(select(BankAccount.id).where(BankAccount.gl_account_id == gl,
                                                      BankAccount.id != (obj.id if obj else 0))):
                raise field_error("gl_account", "bank account with this gl account already exists.")
        data["gl_account_id"] = gl
    return data


@router.get("/bank-accounts/", dependencies=[Depends(bank_access)])
def list_bank_accounts(db: Session = Depends(get_db), search: Optional[str] = None, ordering: Optional[str] = None,
                       page: Optional[str] = None, limit: Optional[str] = None):
    stmt = apply_search(select(BankAccount), search, BankAccount.name, BankAccount.bank_name, BankAccount.account_number)
    stmt = apply_ordering(stmt, ordering, {"name": BankAccount.name}, [BankAccount.name])
    return paginate(db, stmt, page, limit, ser.bank_account)


@router.post("/bank-accounts/", status_code=201, dependencies=[Depends(bank_access)])
def create_bank_account(body: BankAccountIn, db: Session = Depends(get_db)):
    account = BankAccount(**_prepare_bank_account(db, body.model_dump(exclude_unset=True), None))
    db.add(account)
    db.commit()
    return ser.bank_account(db.get(BankAccount, account.id))


@router.post("/bank-accounts/bulk-create/", status_code=201, dependencies=[Depends(bank_access)])
def bulk_create_bank_accounts(body: RowsIn, db: Session = Depends(get_db)):
    return _bulk_create(db, body.rows, BankAccountIn, _prepare_bank_account, BankAccount)


@router.get("/bank-accounts/summary/", dependencies=[Depends(bank_access)])
def bank_accounts_summary(db: Session = Depends(get_db)):
    rows = db.execute(select(BankAccount.is_active, BankAccount.gl_account_id)).all()
    return {"total": len(rows), "active": sum(1 for a, _ in rows if a), "inactive": sum(1 for a, _ in rows if not a),
            "linked": sum(1 for _, gl in rows if gl)}


@router.get("/bank-accounts/{account_id:int}/", dependencies=[Depends(bank_access)])
def get_bank_account(account_id: int, db: Session = Depends(get_db)):
    return ser.bank_account(get_or_404(db, BankAccount, account_id, "BankAccount"))


@router.put("/bank-accounts/{account_id:int}/", dependencies=[Depends(bank_access)])
@router.patch("/bank-accounts/{account_id:int}/", dependencies=[Depends(bank_access)])
def update_bank_account(account_id: int, body: BankAccountIn, db: Session = Depends(get_db)):
    account = get_or_404(db, BankAccount, account_id, "BankAccount")
    for field, value in _prepare_bank_account(db, body.model_dump(exclude_unset=True), account).items():
        setattr(account, field, value)
    db.commit()
    db.refresh(account)
    return ser.bank_account(account)


@router.delete("/bank-accounts/{account_id:int}/", status_code=204, dependencies=[Depends(bank_access)])
def delete_bank_account(account_id: int, db: Session = Depends(get_db)):
    account = get_or_404(db, BankAccount, account_id, "BankAccount")
    db.delete(account)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise bad_request(f'"{account.name}" is used by payments, so it cannot be deleted - mark it inactive instead.')
    return Response(status_code=204)
