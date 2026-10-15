"""General Ledger: bank transactions - categorize, confirm, finalize, delete."""
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from .. import serializers as ser
from ..access import DELETE, EDIT
from ..database import get_db
from ..deps import Access
from ..errors import APIError, bad_request, field_error
from ..models import (
    BankStatement, CategorizationSource, Category, SubCategory, Transaction, TransactionStatus,
)
from ..schemas import IdsIn, TransactionIn
from ..services import period_close
from ..services import reconciliation as recon
from ..services.categorization import clean_description, create_rule_from_transaction, propagate_manual_match
from ..services.posting import post_transactions, unpost_transactions
from ..services.filters import TXN_IS_TRANSFER, TXN_MATCHED, TXN_UNCATEGORIZED, TXN_UNMATCHED, txn_of_account
from ..services.reports import resolve_period
from ..services.transfers import detect_transfers
from ..utils import apply_ordering, apply_search, get_or_404, is_true, now, paginate
from .common import categorized_status, confirm_unmatch, period_guard, reconcile_guard, reject_if_final

router = APIRouter(prefix="/api/transactions", tags=["transactions"])
txn_access = Access("transactions", "bank_statements")


def _edit():
    return Depends(Access("transactions", "bank_statements", action=EDIT))


def _load(stmt):
    return stmt.options(
        joinedload(Transaction.statement).joinedload(BankStatement.account),
        joinedload(Transaction.category), joinedload(Transaction.sub_category),
        joinedload(Transaction.duplicate_of),
        joinedload(Transaction.transfer_pair).joinedload(Transaction.statement).joinedload(BankStatement.account),
    )


def _filtered(db: Session, request: Request, stmt=None):
    """`stmt` (default: transactions with their related rows) with every ?filter= the General Ledger uses."""
    p = request.query_params
    stmt = _load(select(Transaction)) if stmt is None else stmt
    if p.get("period"):
        # A named preset is resolved server-side, same as the reports; 'custom' passes the dates through.
        _, date_from, date_to = resolve_period(db, p.get("period"), p.get("date_from") or None, p.get("date_to") or None)
    else:
        date_from, date_to = p.get("date_from"), p.get("date_to")
    if p.get("statement"):
        stmt = stmt.where(Transaction.statement_id == int(p["statement"]))
    if p.get("account"):
        stmt = stmt.where(txn_of_account(int(p["account"])))
    if p.get("category"):
        stmt = stmt.where(Transaction.category_id == int(p["category"]))
    if p.get("sub_category"):
        stmt = stmt.where(Transaction.sub_category_id == int(p["sub_category"]))
    if date_from:
        stmt = stmt.where(Transaction.date >= date_from)
    if date_to:
        stmt = stmt.where(Transaction.date <= date_to)
    if p.get("uncategorized") is not None and is_true(p["uncategorized"]):
        stmt = stmt.where(TXN_UNCATEGORIZED)
    for name in ("is_potential_duplicate", "confirmed", "is_final"):
        if p.get(name) is not None:
            stmt = stmt.where(getattr(Transaction, name).is_(is_true(p[name])))
    if p.get("categorization_source"):
        stmt = stmt.where(Transaction.categorization_source == p["categorization_source"])
    if p.get("status"):
        stmt = stmt.where(Transaction.status == p["status"])
    if p.get("reconciled"):
        stmt = stmt.where(TXN_MATCHED if is_true(p["reconciled"]) else TXN_UNMATCHED)
    return apply_search(stmt, p.get("search"), Transaction.description, Transaction.bai_code)


@router.get("/", dependencies=[Depends(txn_access)])
def list_transactions(request: Request, db: Session = Depends(get_db), ordering: Optional[str] = None,
                      page: Optional[str] = None, limit: Optional[str] = None):
    stmt = apply_ordering(_filtered(db, request), ordering,
                          {"date": Transaction.date, "debit": Transaction.debit, "credit": Transaction.credit},
                          [Transaction.statement_id, Transaction.date, Transaction.id])
    return paginate(db, stmt, page, limit, serialize_many=ser.TransactionSerializer(db).many)


@router.get("/summary/", dependencies=[Depends(txn_access)])
def transactions_summary(request: Request, db: Session = Depends(get_db)):
    in_filter = Transaction.id.in_(_filtered(db, request, select(Transaction.id)).correlate(None))
    total, debits, credits = db.execute(select(func.count(Transaction.id), func.sum(Transaction.debit),
                                               func.sum(Transaction.credit)).where(in_filter)).one()

    def count(*where):
        return db.scalar(select(func.count(Transaction.id)).where(in_filter, *where)) or 0

    accounts = db.scalar(select(func.count(func.distinct(BankStatement.account_id)))
                         .join(Transaction, Transaction.statement_id == BankStatement.id).where(in_filter)) or 0
    by_source = {s.value: n for s, n in db.execute(
        select(Transaction.categorization_source, func.count(Transaction.id))
        .where(in_filter, Transaction.categorization_source.is_not(None))
        .group_by(Transaction.categorization_source))}
    return {
        "total_transactions": total,
        "uncategorized_count": count(TXN_UNCATEGORIZED),
        "duplicates_count": count(Transaction.is_potential_duplicate.is_(True)),
        "final_count": count(Transaction.is_final.is_(True)),
        "reconciled_count": count(TXN_MATCHED),
        "total_debits": float(debits or 0),
        "total_credits": float(credits or 0),
        "accounts_count": accounts,
        "by_source": by_source,
    }


def _resolve_category(db: Session, data: dict, txn: Optional[Transaction]) -> None:
    """category / sub_category ids -> *_id fields; a sub-category always brings its own category."""
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
            raise field_error("sub_category", f'Sub-category "{sub.name}" does not belong to category "{category.name}".')
        data["category"] = sub.category_id
    for field in ("category", "sub_category"):
        if field in data:
            data[f"{field}_id"] = data.pop(field)


def _save_as_confirmed(db: Session, txn: Transaction, old_sub_id: Optional[int], is_new: bool) -> None:
    """A human picking / editing the category is a confirmed choice: future categorize runs never
    overwrite it, it becomes history, and it cascades to similar unconfirmed transactions."""
    changed = old_sub_id != txn.sub_category_id
    manual = changed or is_new or not txn.categorization_source
    if manual:
        txn.categorization_source = CategorizationSource.MANUAL
        txn.confidence_score = None
        txn.score_breakdown = None
        txn.scoring_clues = ""
    txn.status = categorized_status(txn.sub_category_id, txn.categorization_source == CategorizationSource.MANUAL)
    txn.confirmed = True
    db.flush()
    propagate_manual_match(db, txn)


@router.post("/", status_code=201, dependencies=[Depends(txn_access)])
def create_transaction(body: TransactionIn, request: Request, db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    missing = {f: ["This field is required."] for f in ("statement", "date", "description") if data.get(f) in (None, "")}
    if missing:
        raise APIError(400, missing)
    statement = db.get(BankStatement, data["statement"])
    if not statement:
        raise field_error("statement", f'Invalid pk "{data["statement"]}" - object does not exist.')
    period_guard(period_close.guard_dates, db, data["date"], what="a transaction cannot be added on that date")
    reconcile_guard(recon.guard_bank_transaction_date, db, statement.account_id, data["date"])
    touches_category = "category" in data or "sub_category" in data
    _resolve_category(db, data, None)
    data["statement_id"] = data.pop("statement")
    txn = Transaction(**{k: v for k, v in data.items() if v is not None or k.endswith("_id")})
    txn.clean_description = clean_description(txn.description)
    txn.status = TransactionStatus.UNCATEGORIZED
    db.add(txn)
    db.flush()
    if touches_category:
        _save_as_confirmed(db, txn, None, is_new=True)
    db.commit()
    return ser.TransactionSerializer(db).one(db.get(Transaction, txn.id))


@router.get("/{txn_id:int}/", dependencies=[Depends(txn_access)])
def get_transaction(txn_id: int, db: Session = Depends(get_db)):
    return ser.TransactionSerializer(db).one(get_or_404(db, Transaction, txn_id))


@router.put("/{txn_id:int}/", dependencies=[Depends(txn_access)])
@router.patch("/{txn_id:int}/", dependencies=[Depends(txn_access)])
def update_transaction(txn_id: int, body: TransactionIn, db: Session = Depends(get_db)):
    txn = get_or_404(db, Transaction, txn_id)
    data = body.model_dump(exclude_unset=True)
    data.pop("statement", None)
    period_guard(period_close.guard_dates, db, txn.date, data.get("date"),
                 what="a transaction dated in that period cannot be changed or moved into it")
    reject_if_final(txn)
    if any(f in data and data[f] is not None and data[f] != getattr(txn, f) for f in ("date", "debit", "credit")):
        # Its match (and a signed-off month's figures) rest on the date and amount.
        if db.scalar(select(func.count()).where(TXN_MATCHED, Transaction.id == txn.id)):
            raise bad_request("This transaction is reconciled - unmatch it in Bank Reconciliation before changing "
                              "its date or amount.")
        reconcile_guard(recon.guard_bank_transaction_date, db, txn.statement.account_id, txn.date, data.get("date"))
    touches_category = "category" in data or "sub_category" in data
    old_sub = txn.sub_category_id
    _resolve_category(db, data, txn)
    for field, value in data.items():
        if value is None and field in ("date", "description", "debit", "credit"):
            continue
        setattr(txn, field, value)
    if "description" in data and data["description"]:
        txn.clean_description = clean_description(txn.description)
    if touches_category:
        _save_as_confirmed(db, txn, old_sub, is_new=False)
    db.commit()
    db.refresh(txn)
    return ser.TransactionSerializer(db).one(txn)


@router.delete("/{txn_id:int}/", status_code=204, dependencies=[Depends(txn_access)])
def delete_transaction(txn_id: int, request: Request, db: Session = Depends(get_db)):
    txn = get_or_404(db, Transaction, txn_id)
    reject_if_final(txn)
    reconcile_guard(recon.guard_bank_transactions, db, [txn.id], confirm_unmatch(request))
    db.delete(txn)
    db.commit()
    return Response(status_code=204)


def _id_list(value) -> list[int]:
    if not isinstance(value, list) or not value:
        raise bad_request("List of transaction IDs required.")
    try:
        return [int(i) for i in value]
    except (TypeError, ValueError):
        raise bad_request("Transaction IDs must be numbers.")


@router.post("/bulk-update/", dependencies=[_edit()])
def bulk_update(body: IdsIn, db: Session = Depends(get_db)):
    """Sets category / sub_category on many transactions as MANUAL, confirmed choices, propagating history."""
    ids = _id_list(body.ids)
    category = db.get(Category, body.category) if body.category else None
    sub = db.get(SubCategory, body.sub_category) if body.sub_category else None
    txns = db.scalars(select(Transaction).where(Transaction.id.in_(ids), Transaction.is_final.is_(False))).all()
    skipped_final = len(set(ids)) - len(txns)
    for t in txns:
        changed = t.sub_category_id != (sub.id if sub else None)
        t.category_id = category.id if category else (sub.category_id if sub else None)
        t.sub_category_id = sub.id if sub else None
        if changed or not t.categorization_source:
            t.categorization_source = CategorizationSource.MANUAL
            t.confidence_score = None
            t.score_breakdown = None
            t.scoring_clues = ""
        t.status = categorized_status(t.sub_category_id, t.categorization_source == CategorizationSource.MANUAL)
        t.confirmed = True
    db.flush()
    for t in txns:
        propagate_manual_match(db, t)
    db.commit()
    return {"updated": len(txns), "skipped_final": skipped_final}


@router.post("/bulk-confirm/", dependencies=[_edit()])
def bulk_confirm(body: IdsIn, db: Session = Depends(get_db)):
    """Confirms categorized transactions (by ids, or every unconfirmed one of a statement), keeping
    their categorization source and clues, and propagating history."""
    where = [Transaction.sub_category_id.is_not(None), Transaction.is_final.is_(False)]
    if body.ids:
        where.append(Transaction.id.in_(_id_list(body.ids)))
    elif body.statement:
        where += [Transaction.statement_id == body.statement, Transaction.confirmed.is_(False)]
    else:
        raise bad_request("List of transaction IDs or statement ID required.")
    txns = db.scalars(select(Transaction).where(*where)).all()
    for t in txns:
        t.confirmed = True
        if t.status != TransactionStatus.TRANSFER:
            t.status = categorized_status(t.sub_category_id, t.categorization_source == CategorizationSource.MANUAL)
    db.flush()
    for t in txns:
        propagate_manual_match(db, t)
    db.commit()
    return {"confirmed": len(txns)}


@router.post("/{txn_id:int}/confirm/", dependencies=[_edit()])
def confirm_transaction(txn_id: int, db: Session = Depends(get_db)):
    txn = get_or_404(db, Transaction, txn_id)
    reject_if_final(txn)
    if not txn.sub_category_id:
        raise bad_request("Transaction must have a category assigned to confirm.")
    if txn.status != TransactionStatus.TRANSFER:
        txn.status = categorized_status(txn.sub_category_id, txn.categorization_source == CategorizationSource.MANUAL)
    txn.confirmed = True
    db.flush()
    propagate_manual_match(db, txn)
    db.commit()
    return ser.TransactionSerializer(db).one(txn)


@router.post("/{txn_id:int}/accept-suggestion/", dependencies=[_edit()])
def accept_suggestion(txn_id: int, db: Session = Depends(get_db)):
    """Accepts a NEEDS_REVIEW transaction's suggested category."""
    txn = get_or_404(db, Transaction, txn_id)
    reject_if_final(txn)
    if txn.status != TransactionStatus.NEEDS_REVIEW or txn.confirmed:
        raise bad_request("This transaction has no pending suggestion to accept.")
    txn.status = TransactionStatus.AUTO_ASSIGNED
    txn.confirmed = True
    db.flush()
    propagate_manual_match(db, txn)
    db.commit()
    return ser.TransactionSerializer(db).one(txn)


@router.post("/{txn_id:int}/create-rule/", status_code=201, dependencies=[_edit()])
def create_rule(txn_id: int, db: Session = Depends(get_db)):
    """Turns this transaction's description -> sub-category into a permanent auto-assign keyword rule."""
    txn = get_or_404(db, Transaction, txn_id)
    try:
        keyword = create_rule_from_transaction(db, txn)
    except ValueError as exc:
        raise bad_request(str(exc))
    return ser.keyword(keyword)


@router.post("/detect-transfers/", dependencies=[_edit()])
def detect_transfers_action(db: Session = Depends(get_db)):
    """Re-runs transfer detection across every transaction."""
    return {"transfer_pairs_detected": detect_transfers(db)}


@router.post("/bulk-delete/", dependencies=[Depends(Access("transactions", "bank_statements", action=DELETE))])
def bulk_delete(body: IdsIn, request: Request, db: Session = Depends(get_db)):
    ids = _id_list(body.ids)
    requested = db.scalars(select(Transaction).where(Transaction.id.in_(ids))).all()
    deletable = [t for t in requested if not t.is_final]
    reconcile_guard(recon.guard_bank_transactions, db, [t.id for t in deletable],
                    confirm_unmatch(request, {"confirm_unmatch": body.confirm_unmatch}))
    for t in deletable:
        db.delete(t)
    db.commit()
    return {"deleted": len(deletable), "skipped_final": len(requested) - len(deletable)}


@router.post("/finalize/", dependencies=[_edit()])
def finalize(body: IdsIn, db: Session = Depends(get_db)):
    """Locks transactions (ids, or a whole statement) as final. Only ready ones are locked: categorized
    and not still in Needs Review, or a detected transfer. Locking also confirms them."""
    if body.ids:
        if not isinstance(body.ids, list):
            raise bad_request("ids must be a list.")
        where = [Transaction.id.in_(_id_list(body.ids))]
    elif body.statement:
        where = [Transaction.statement_id == body.statement]
    else:
        raise bad_request("List of transaction IDs or statement ID required.")
    txns = db.scalars(select(Transaction).where(*where)).all()
    already_final = sum(1 for t in txns if t.is_final)
    candidates = [t for t in txns if not t.is_final]
    ready = [t for t in candidates if t.status == TransactionStatus.TRANSFER or (
        t.sub_category_id and t.status not in (TransactionStatus.NEEDS_REVIEW, TransactionStatus.UNCATEGORIZED))]
    stamp = now()
    newly_confirmed = []
    for t in ready:
        if not t.confirmed and t.status != TransactionStatus.TRANSFER:
            newly_confirmed.append(t)
        t.is_final = True
        t.finalized_at = stamp
        t.confirmed = True
    db.flush()
    for t in newly_confirmed:
        propagate_manual_match(db, t)  # same as confirming: teaches similar narrations
    # Final = in the books: post each one to the journal unless it is already matched to a journal line.
    posting = post_transactions(db, ready)
    db.commit()
    return {"finalized": len(ready), "already_final": already_final, "not_ready": len(candidates) - len(ready),
            "posting": posting}


@router.post("/post-to-books/", dependencies=[_edit()])
def post_to_books(body: IdsIn, db: Session = Depends(get_db)):
    """Posts final transactions (ids, a statement, or - with neither - every final one) that aren't in the
    books yet, e.g. ones finalized before their bank account had a GL account. Already-matched ones are
    left alone, so it is safe to run again."""
    where = [Transaction.is_final.is_(True)]
    if body.ids:
        where.append(Transaction.id.in_(_id_list(body.ids)))
    elif body.statement:
        where.append(Transaction.statement_id == body.statement)
    txns = db.scalars(select(Transaction).where(*where).order_by(Transaction.date, Transaction.id)).all()
    posting = post_transactions(db, txns)
    db.commit()
    return posting


@router.post("/reopen/", dependencies=[_edit()])
def reopen(body: IdsIn, db: Session = Depends(get_db)):
    """Removes the final lock (the transactions stay confirmed) and takes their posted journal entries out
    of the books. Entries they are matched to from elsewhere (imports, payments) are left alone."""
    ids = _id_list(body.ids)
    # A closed period's transactions stay final - that is what keeps its reports unchanged.
    period_guard(period_close.guard_transactions, db, select(Transaction.id).where(Transaction.id.in_(ids)),
                 "transactions dated in that period cannot be reopened")
    txns = db.scalars(select(Transaction).where(Transaction.id.in_(ids), Transaction.is_final.is_(True))).all()
    # Reopened = out of the books again until it is made final once more (its category may change).
    unposted = unpost_transactions(db, [t.id for t in txns])
    for t in txns:
        t.is_final = False
        t.finalized_at = None
    db.commit()
    return {"reopened": len(txns), "removed_from_books": unposted}
