"""Bank reconciliation: matching, opening balance, month sign-off."""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from .. import serializers as ser
from ..access import EDIT
from ..database import get_db
from ..deps import Access
from ..errors import APIError, bad_request
from ..models import BankAccount, JournalEntry, JournalEntryLine, ReconciliationMatch, Transaction, User
from ..schemas import ReconAccountIn, ReconciliationSettingsIn
from ..services import reconciliation as recon
from ..services.filters import LINE_UNMATCHED, TXN_UNMATCHED
from ..services.settings import reconciliation_settings
from ..utils import money, paginate, today

router = APIRouter(prefix="/api/reconciliation", tags=["bank reconciliation"])
view = Access("bank_reconciliation")
edit = Access("bank_reconciliation", action=EDIT)


def _account(db: Session, account_id) -> BankAccount:
    try:
        account = db.get(BankAccount, int(account_id))
    except (TypeError, ValueError):
        account = None
    if account is None:
        raise bad_request("A valid bank account is required.")
    return account


def _date(value, name) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise bad_request(f"{name} must be a YYYY-MM-DD date.")


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except recon.ReconciliationError as exc:
        raise bad_request(str(exc))


@router.get("/summary/", dependencies=[Depends(view)])
def summary(request: Request, db: Session = Depends(get_db)):
    """?account=<id>&date_to= (or as_of; default today)&date_from= - the reconciliation statement at date_to;
    with date_from also the period's movements and, for a whole month, its sign-off state."""
    p = request.query_params
    account = _account(db, p.get("account"))
    date_to = _date(p.get("date_to"), "date_to") or _date(p.get("as_of"), "as_of") or today()
    date_from = _date(p.get("date_from"), "date_from")
    if date_from and date_from > date_to:
        raise bad_request("date_from must be on or before date_to.")
    return recon.period_summary(db, account, date_from, date_to)


@router.post("/opening-balance/", status_code=201, dependencies=[Depends(edit)])
def opening_balance(body: ReconAccountIn, db: Session = Depends(get_db)):
    """{"account", "equity_account"} books the first statement's opening balance as entry OB-<account id>;
    {"account", "journal_line"} instead marks an already-imported line as that opening balance."""
    account = _account(db, body.account)
    if body.journal_line is not None:
        line = _run(recon.mark_opening_line, db, account, body.journal_line)
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=200, content={"entry_number": line.entry.entry_number})
    return _run(recon.create_opening_balance_entry, db, account, body.equity_account)


@router.get("/periods/", dependencies=[Depends(view)])
def periods(account: Optional[str] = None, db: Session = Depends(get_db)):
    return recon.month_overview(db, _account(db, account))


@router.post("/periods/close/", status_code=201)
def close_month(body: ReconAccountIn, db: Session = Depends(get_db), user: User = Depends(edit)):
    account = _account(db, body.account)
    _run(recon.close_month, db, account, body.month, user, body.note or "")
    return recon.month_overview(db, account)


@router.post("/periods/reopen/", dependencies=[Depends(edit)])
def reopen_month(body: ReconAccountIn, db: Session = Depends(get_db)):
    account = _account(db, body.account)
    _run(recon.reopen_month, db, account, body.month)
    return recon.month_overview(db, account)


def _status_filter(stmt, status: Optional[str], unmatched):
    if status == "unmatched":
        return stmt.where(unmatched)
    if status == "matched":
        return stmt.where(~unmatched)
    return stmt


@router.get("/bank-transactions/", dependencies=[Depends(view)])
def bank_transactions(request: Request, db: Session = Depends(get_db), page: Optional[str] = None,
                      limit: Optional[str] = None):
    """?account=&status=unmatched|matched|all&date_from=&date_to=&search= - the statement side with its matches."""
    p = request.query_params
    account = _account(db, p.get("account"))
    stmt = select(Transaction).where(recon.bank_txn_filter(account)).options(
        selectinload(Transaction.reconciliation_matches).joinedload(ReconciliationMatch.journal_line)
        .joinedload(JournalEntryLine.entry))
    stmt = _status_filter(stmt, p.get("status"), TXN_UNMATCHED)
    if p.get("date_from"):
        stmt = stmt.where(Transaction.date >= _date(p["date_from"], "date_from"))
    if p.get("date_to"):
        stmt = stmt.where(Transaction.date <= _date(p["date_to"], "date_to"))
    if p.get("search"):
        stmt = stmt.where(Transaction.description.ilike(f'%{p["search"].strip()}%'))
    return paginate(db, stmt.order_by(Transaction.date, Transaction.id), page, limit, ser.recon_bank_transaction)


@router.get("/book-lines/", dependencies=[Depends(view)])
def book_lines(request: Request, db: Session = Depends(get_db), page: Optional[str] = None,
               limit: Optional[str] = None):
    """?account=&status=&date_from=&date_to=&search= - journal lines booked to the bank's GL account."""
    p = request.query_params
    account = _account(db, p.get("account"))
    stmt = (select(JournalEntryLine).join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id)
            .where(recon.book_line_filter(account))
            .options(joinedload(JournalEntryLine.entry),
                     joinedload(JournalEntryLine.reconciliation_match).joinedload(ReconciliationMatch.transaction)))
    stmt = _status_filter(stmt, p.get("status"), LINE_UNMATCHED)
    if p.get("date_from"):
        stmt = stmt.where(JournalEntry.date >= _date(p["date_from"], "date_from"))
    if p.get("date_to"):
        stmt = stmt.where(JournalEntry.date <= _date(p["date_to"], "date_to"))
    if p.get("search"):
        like = f'%{p["search"].strip()}%'
        stmt = stmt.where(or_(JournalEntryLine.description.ilike(like), JournalEntry.narration.ilike(like),
                              JournalEntry.entry_number.ilike(like)))
    return paginate(db, stmt.order_by(JournalEntry.date, JournalEntryLine.id), page, limit, ser.recon_book_line)


@router.post("/auto-match/", dependencies=[Depends(edit)])
def auto_match(body: ReconAccountIn, db: Session = Depends(get_db)):
    account = _account(db, body.account)
    matched = _run(recon.auto_match, db, account, date_from=_date(body.date_from, "date_from"),
                   date_to=_date(body.date_to, "date_to"))
    return {"matched": matched}


@router.post("/match/", status_code=201, dependencies=[Depends(edit)])
def match(body: ReconAccountIn, db: Session = Depends(get_db)):
    """{"account", "transaction", "journal_lines": [ids]} - one bank transaction to lines that add up to it."""
    account = _account(db, body.account)
    return {"matched": _run(recon.manual_match, db, account, body.transaction, body.journal_lines)}


@router.get("/candidates/", dependencies=[Depends(view)])
def candidates(request: Request, db: Session = Depends(get_db)):
    """?transaction=<id> - journal lines it can match; ?journal_line=<id> - bank transactions it can match."""
    p = request.query_params
    try:
        if p.get("transaction"):
            return _run(recon.candidates_for_transaction, db, int(p["transaction"]))
        if p.get("journal_line"):
            return _run(recon.candidates_for_line, db, int(p["journal_line"]))
    except ValueError:
        pass
    raise bad_request('Give a numeric "transaction" or "journal_line".')


@router.post("/match-pair/", status_code=201, dependencies=[Depends(edit)])
def match_pair(body: ReconAccountIn, db: Session = Depends(get_db)):
    """{"transaction", "journal_line"} - the bank account comes from the transaction."""
    return {"matched": _run(recon.match_pair, db, body.transaction, body.journal_line)}


@router.post("/unmatch/", dependencies=[Depends(edit)])
def unmatch(body: ReconAccountIn, db: Session = Depends(get_db)):
    account = _account(db, body.account)
    return {"unmatched": _run(recon.unmatch, db, account, body.transactions)}


def _settings_data(s) -> dict:
    return {"date_window_days": s.date_window_days, "amount_tolerance_percent": money(s.amount_tolerance_percent)}


@router.get("/settings/", dependencies=[Depends(view)])
def get_settings_(db: Session = Depends(get_db)):
    s = reconciliation_settings(db)
    db.commit()
    return _settings_data(s)


@router.put("/settings/", dependencies=[Depends(Access("bank_reconciliation", action=EDIT))])
def update_settings(body: ReconciliationSettingsIn, db: Session = Depends(get_db)):
    s = reconciliation_settings(db)
    for field, value in body.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(s, field, value)
    db.commit()
    return _settings_data(s)
