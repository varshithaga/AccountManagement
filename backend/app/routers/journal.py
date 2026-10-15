"""Journal entries and their import batches."""
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import exists, func, not_, or_, select
from sqlalchemy.orm import Session, joinedload

from .. import serializers as ser
from ..access import CREATE, DELETE, EDIT
from ..database import get_db
from ..deps import Access
from ..errors import APIError, bad_request, not_found
from ..models import BankAccount, JournalEntry, JournalEntryLine, JournalImportBatch, SubCategory
from ..schemas import JournalImportIn, ManualEntryIn, MonthScopeIn
from ..services import period_close
from ..services import reconciliation as recon
from ..services.filters import LINE_IS_BANK, LINE_MATCHED, LINE_UNMATCHED
from ..services.invoicing import guard_entry_not_from_document
from ..services.journal_import import (
    JournalImportError, analyse_import_request, import_journal_entries, resolve_bank_account, save_manual_entry,
)
from ..utils import apply_ordering, get_or_404, is_true, paginate
from .common import confirm_unmatch, period_guard, reconcile_guard

router = APIRouter(prefix="/api", tags=["journal entries"])
journal_access = Access("journal_entries")


def _line_exists(*where):
    return exists(select(JournalEntryLine.id).where(JournalEntryLine.entry_id == JournalEntry.id, *where))


def _filtered(request: Request, stmt=None):
    """?search=, ?date_from=, ?date_to=, ?source=EXCEL|JSON|API (imports) or an origin - MANUAL, BANK,
    SALES_INVOICE, PURCHASE_BILL, PAYMENT, CREDIT_NOTE, OPENING_BALANCE,
    ?account=<sub-category id>, ?batch=<id>, ?bank_account=<id>, ?reconciled=true|false."""
    p = request.query_params
    stmt = select(JournalEntry) if stmt is None else stmt
    if p.get("search"):
        for term in p["search"].replace(",", " ").split():
            like = f"%{term}%"
            stmt = stmt.where(or_(
                JournalEntry.entry_number.ilike(like), JournalEntry.narration.ilike(like),
                _line_exists(JournalEntryLine.description.ilike(like)),
                _line_exists(JournalEntryLine.sub_category_id.in_(select(SubCategory.id).where(SubCategory.name.ilike(like)))),
            ))
    if p.get("date_from"):
        stmt = stmt.where(JournalEntry.date >= p["date_from"])
    if p.get("date_to"):
        stmt = stmt.where(JournalEntry.date <= p["date_to"])
    if p.get("source"):
        source = p["source"]
        if source not in ("EXCEL", "JSON", "API"):  # entries the app posted carry their origin
            stmt = stmt.where(JournalEntry.origin == source)
        else:
            stmt = stmt.where(JournalEntry.batch_id.in_(select(JournalImportBatch.id)
                                                        .where(JournalImportBatch.source == source)))
    if p.get("account"):
        stmt = stmt.where(_line_exists(JournalEntryLine.sub_category_id == int(p["account"])))
    if p.get("batch"):
        stmt = stmt.where(JournalEntry.batch_id == int(p["batch"]))
    if p.get("bank_account"):
        stmt = stmt.where(JournalEntry.batch_id.in_(select(JournalImportBatch.id)
                                                    .where(JournalImportBatch.bank_account_id == int(p["bank_account"]))))
    if p.get("reconciled"):
        # Bank lines = lines on a bank account's GL account; only those can be reconciled.
        has_bank, has_open = _line_exists(LINE_IS_BANK), _line_exists(LINE_IS_BANK, LINE_UNMATCHED)
        stmt = stmt.where(has_bank, not_(has_open)) if is_true(p["reconciled"]) else stmt.where(has_open)
    return stmt


def _entries(db: Session, rows):
    return ser.journal_entries(db, rows)


@router.get("/journal-entries/", dependencies=[Depends(journal_access)])
def list_entries(request: Request, db: Session = Depends(get_db), ordering: Optional[str] = None,
                 page: Optional[str] = None, limit: Optional[str] = None):
    stmt = _filtered(request).options(joinedload(JournalEntry.batch).joinedload(JournalImportBatch.bank_account))
    stmt = apply_ordering(stmt, ordering, {"date": JournalEntry.date, "entry_number": JournalEntry.entry_number,
                                           "created_at": JournalEntry.created_at},
                          [JournalEntry.date.desc(), JournalEntry.id.desc()])
    return paginate(db, stmt, page, limit, serialize_many=lambda rows: _entries(db, rows))


@router.get("/journal-entries/summary/", dependencies=[Depends(journal_access)])
def entries_summary(request: Request, db: Session = Depends(get_db)):
    """Totals for the entries matching the filters, and how many are reconciled (over their bank lines)."""
    ids = _filtered(request, select(JournalEntry.id)).correlate(None)
    total_debit, total_credit = db.execute(select(func.sum(JournalEntryLine.debit), func.sum(JournalEntryLine.credit))
                                           .where(JournalEntryLine.entry_id.in_(ids))).one()
    has_bank, has_open = _line_exists(LINE_IS_BANK), _line_exists(LINE_IS_BANK, LINE_UNMATCHED)
    has_matched = _line_exists(LINE_IS_BANK, LINE_MATCHED)

    def count(*where):
        return db.scalar(select(func.count(JournalEntry.id)).where(JournalEntry.id.in_(ids), *where)) or 0

    return {
        "entries": count(),
        "total_debit": total_debit or Decimal("0.00"),
        "total_credit": total_credit or Decimal("0.00"),
        "batches": db.scalar(select(func.count(JournalImportBatch.id))),
        "reconciled": count(has_matched, not_(has_open)),
        "partial": count(has_matched, has_open),
        "unreconciled": count(not_(has_matched), has_open),
    }


@router.post("/journal-entries/import/", dependencies=[Depends(Access("journal_entries", action=CREATE))])
def import_entries(body: JournalImportIn, response: Response, db: Session = Depends(get_db)):
    """{"source": "EXCEL"|"JSON"|"API", "source_name", "bank_account" (optional), "dry_run", "include_duplicates",
    "entries": [{"entry_number", "date", "narration", "lines": [{"sub_category_id" | "sub_category_name"
    (+ "category_name"), "debit", "credit", "description"}]}]}. dry_run=true analyses every entry and saves
    nothing. Otherwise all-or-nothing; existing entry numbers are skipped and possible duplicates left out
    unless include_duplicates is true."""
    source = body.source or "API"
    try:
        bank_account = resolve_bank_account(db, body.bank_account)
        if is_true(body.dry_run):
            return analyse_import_request(db, body.entries, source, bank_account)
        result = import_journal_entries(db, body.entries, source=source, source_name=body.source_name or "",
                                        bank_account=bank_account, include_duplicates=is_true(body.include_duplicates))
    except JournalImportError as exc:
        db.rollback()
        raise APIError(400, {"error": exc.errors})
    response.status_code = 201 if result["created"] else 200
    return result


def _manual_lines(body: ManualEntryIn) -> dict:
    data = body.model_dump()
    data["lines"] = [l.model_dump() for l in body.lines]
    return data


@router.post("/journal-entries/manual/", status_code=201, dependencies=[Depends(Access("journal_entries", action=CREATE))])
def create_manual_entry(body: ManualEntryIn, db: Session = Depends(get_db)):
    """A double-entry voucher keyed in by hand: {"entry_number"? (default JV-00001...), "date", "narration",
    "lines": [{"sub_category_id", "debit" | "credit", "description"}]}. At least two lines, each a debit or a
    credit, and total debits must equal total credits. Returns the entry plus any "warnings"."""
    try:
        entry, warnings = save_manual_entry(db, _manual_lines(body))
        db.commit()
    except JournalImportError as exc:
        db.rollback()
        raise APIError(400, {"error": exc.errors})
    return {**_entries(db, [entry])[0], "warnings": warnings}


@router.put("/journal-entries/{entry_id:int}/", dependencies=[Depends(Access("journal_entries", action=EDIT))])
def update_manual_entry(entry_id: int, body: ManualEntryIn, db: Session = Depends(get_db)):
    """Replaces a manual entry's number, date, narration and lines (same rules as creating one).
    Imported entries and entries posted from invoices, bills or payments can't be edited."""
    entry = get_or_404(db, JournalEntry, entry_id, "JournalEntry")
    try:
        entry, warnings = save_manual_entry(db, _manual_lines(body), entry)
        db.commit()
    except JournalImportError as exc:
        db.rollback()
        raise APIError(400, {"error": exc.errors})
    db.refresh(entry)
    return {**_entries(db, [entry])[0], "warnings": warnings}


# ---- Testing tool: delete one bank's journal entries for one month ---------------------------

def _month_scope(db: Session, params: dict):
    """The imported entries for bank_account=<id>&month=YYYY-MM (or "all"), plus - with
    include_ledger=true - any entry with a line on the bank's GL account."""
    if not params.get("bank_account"):
        raise bad_request("Choose a bank account.")
    try:
        bank = db.get(BankAccount, int(params["bank_account"]))
    except (TypeError, ValueError):
        bank = None
    if not bank:
        raise not_found()
    scope = JournalEntry.batch_id.in_(select(JournalImportBatch.id).where(JournalImportBatch.bank_account_id == bank.id))
    if is_true(params.get("include_ledger")) and bank.gl_account_id:
        scope = or_(scope, _line_exists(JournalEntryLine.sub_category_id == bank.gl_account_id))
    # Entries posted from invoices, bills and payments are removed through their documents.
    stmt = select(JournalEntry).where(scope, JournalEntry.origin.is_(None))
    month = str(params.get("month") or "").strip()
    if month.lower() != "all":
        try:
            year, mon = (int(x) for x in month.split("-"))
            start = date(year, mon, 1)
        except ValueError:
            raise bad_request('Month must be YYYY-MM or "all".')
        end = date(year + mon // 12, mon % 12 + 1, 1)
        stmt = stmt.where(JournalEntry.date >= start, JournalEntry.date < end)
    return bank, stmt


@router.get("/journal-entries/month-scope/", dependencies=[Depends(journal_access)])
def month_scope(request: Request, db: Session = Depends(get_db)):
    """Preview: what month-delete would remove, plus a per-month entry count for the bank."""
    params = dict(request.query_params)
    bank, stmt = _month_scope(db, params)
    entries = db.scalars(stmt.options(joinedload(JournalEntry.batch))
                         .order_by(JournalEntry.date, JournalEntry.entry_number)).unique().all()
    ids = [e.id for e in entries]
    totals = dict(db.execute(select(JournalEntryLine.entry_id, func.sum(JournalEntryLine.debit))
                             .where(JournalEntryLine.entry_id.in_(ids)).group_by(JournalEntryLine.entry_id)).all())
    reconciled = dict(db.execute(select(JournalEntryLine.entry_id, func.count(JournalEntryLine.id))
                                 .where(JournalEntryLine.entry_id.in_(ids), LINE_MATCHED)
                                 .group_by(JournalEntryLine.entry_id)).all())
    _, all_stmt = _month_scope(db, {**params, "month": "all"})
    months: dict = {}
    for d in db.scalars(all_stmt.with_only_columns(JournalEntry.date)):
        months[f"{d:%Y-%m}"] = months.get(f"{d:%Y-%m}", 0) + 1
    return {
        "bank_account": {"id": bank.id, "name": bank.name},
        "count": len(entries),
        "reconciled_lines": sum(reconciled.values()),
        "months": [{"month": k, "count": v} for k, v in sorted(months.items())],
        "entries": [{
            "id": e.id, "entry_number": e.entry_number, "date": e.date.isoformat(), "narration": e.narration,
            "total": totals.get(e.id) or Decimal("0.00"), "reconciled_lines": reconciled.get(e.id, 0),
            "source_name": e.batch.source_name if e.batch else "",
        } for e in entries],
    }


def _delete_entries(db: Session, entry_ids: list[int], confirm: bool, what: str = None) -> None:
    """Deletes journal entries with the closed-period and reconciliation guards; a bank transaction left
    partly matched by the deletion goes back to outstanding."""
    message = guard_entry_not_from_document(db, entry_ids)
    if message:
        raise bad_request(message)
    if what:
        period_guard(period_close.guard_journal_entries, db, entry_ids, what)
    else:
        period_guard(period_close.guard_journal_entries, db, entry_ids)
    reconcile_guard(recon.guard_journal_entries, db, entry_ids, confirm)
    matched = recon.matched_transactions_of_entries(db, entry_ids)
    for entry in db.scalars(select(JournalEntry).where(JournalEntry.id.in_(entry_ids))):
        db.delete(entry)
    db.flush()
    recon.drop_partial_matches(db, matched)


@router.post("/journal-entries/month-delete/", dependencies=[Depends(Access("journal_entries", action=DELETE))])
def month_delete(body: MonthScopeIn, request: Request, db: Session = Depends(get_db)):
    """Deletes every entry month-scope lists, with the same guards as a single delete. Imports left with
    no entries are removed too, so the files can be imported again."""
    params = body.model_dump()
    _, stmt = _month_scope(db, params)
    entries = db.scalars(stmt).all()
    if not entries:
        return {"deleted": 0, "batches_removed": 0}
    ids = [e.id for e in entries]
    batch_ids = {e.batch_id for e in entries if e.batch_id}
    _delete_entries(db, ids, confirm_unmatch(request, params))
    empty = db.scalars(select(JournalImportBatch).where(
        JournalImportBatch.id.in_(batch_ids),
        not_(exists(select(JournalEntry.id).where(JournalEntry.batch_id == JournalImportBatch.id))))).all()
    for b in empty:
        db.delete(b)
    db.commit()
    return {"deleted": len(ids), "batches_removed": len(empty)}


@router.get("/journal-entries/{entry_id:int}/", dependencies=[Depends(journal_access)])
def get_entry(entry_id: int, db: Session = Depends(get_db)):
    return _entries(db, [get_or_404(db, JournalEntry, entry_id, "JournalEntry")])[0]


@router.delete("/journal-entries/{entry_id:int}/", status_code=204, dependencies=[Depends(journal_access)])
def delete_entry(entry_id: int, request: Request, db: Session = Depends(get_db)):
    get_or_404(db, JournalEntry, entry_id, "JournalEntry")
    _delete_entries(db, [entry_id], confirm_unmatch(request))
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Import batches (import history). Deleting a batch undoes that import.
# ---------------------------------------------------------------------------

def _batch_counts(db: Session, ids: list[int]) -> dict:
    return dict(db.execute(select(JournalEntry.batch_id, func.count(JournalEntry.id))
                           .where(JournalEntry.batch_id.in_(ids)).group_by(JournalEntry.batch_id)).all())


def _batches(db: Session, rows):
    counts = _batch_counts(db, [b.id for b in rows])
    return [ser.batch(b, counts.get(b.id, 0)) for b in rows]


@router.get("/journal-import-batches/", dependencies=[Depends(journal_access)])
def list_batches(db: Session = Depends(get_db), page: Optional[str] = None, limit: Optional[str] = None):
    stmt = (select(JournalImportBatch).options(joinedload(JournalImportBatch.bank_account))
            .order_by(JournalImportBatch.imported_at.desc(), JournalImportBatch.id.desc()))
    return paginate(db, stmt, page, limit, serialize_many=lambda rows: _batches(db, rows))


@router.get("/journal-import-batches/{batch_id:int}/", dependencies=[Depends(journal_access)])
def get_batch(batch_id: int, db: Session = Depends(get_db)):
    return _batches(db, [get_or_404(db, JournalImportBatch, batch_id, "JournalImportBatch")])[0]


@router.delete("/journal-import-batches/{batch_id:int}/", status_code=204, dependencies=[Depends(journal_access)])
def delete_batch(batch_id: int, request: Request, db: Session = Depends(get_db)):
    batch = get_or_404(db, JournalImportBatch, batch_id, "JournalImportBatch")
    ids = list(db.scalars(select(JournalEntry.id).where(JournalEntry.batch_id == batch.id)).all())
    _delete_entries(db, ids, confirm_unmatch(request), "this import cannot be undone")
    db.delete(batch)
    db.commit()
    return Response(status_code=204)
