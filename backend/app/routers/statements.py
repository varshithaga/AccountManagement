"""Bank statements (upload, re-parse, categorize) and statement continuity."""
import calendar
import hashlib
import io
import secrets
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from sqlalchemy import exists, func, not_, or_, select
from sqlalchemy.orm import Session, joinedload

from .. import serializers as ser
from ..access import EDIT
from ..config import get_settings
from ..database import get_db
from ..deps import Access
from ..errors import APIError, bad_request, not_found
from ..models import BankAccount, BankStatement, StatementSourceType, Transaction, TransactionStatus
from ..schemas import ConfirmIn
from ..services import continuity as cont
from ..services import period_close
from ..services import reconciliation as recon
from ..services.categorization import categorize_transactions, clean_description
from ..services.duplicates import flag_duplicate_transactions
from ..services.parsing import StatementParsingError, derive_opening_closing_balance, parse_bank_statement
from ..services.reports import resolve_period
from ..services.transfers import detect_transfers
from ..utils import apply_ordering, get_or_404, is_true, now, paginate, paginate_list, today
from .common import confirm_unmatch, flag, period_guard, reconcile_guard, reject_if_statement_has_final

router = APIRouter(prefix="/api", tags=["bank statements"])
settings = get_settings()

statement_access = Access("bank_statements")
continuity_access = Access("statement_continuity", "bank_statements")


# ---------------------------------------------------------------------------
# Continuity
# ---------------------------------------------------------------------------

CONTINUITY_DEFAULT_PERIOD = "this_fiscal_year"
CONTINUITY_PERIODS = ("this_quarter", "last_quarter", "this_year", "this_fiscal_year", "last_fiscal_year",
                      "all_time", "custom")


def _continuity_window(db: Session, request: Request) -> dict:
    """?period=&date_from=&date_to= -> {'date_from', 'date_to'} (dates or None); default this financial year."""
    params = request.query_params
    period = params.get("period")
    if period not in CONTINUITY_PERIODS:
        period = CONTINUITY_DEFAULT_PERIOD
    if period == "last_quarter":
        t = today()
        this_q_month = ((t.month - 1) // 3) * 3 + 1
        y, m = (t.year, this_q_month - 3) if this_q_month > 3 else (t.year - 1, 10)
        return {"date_from": date(y, m, 1), "date_to": date(y, m + 2, calendar.monthrange(y, m + 2)[1])}
    _, date_from, date_to = resolve_period(db, period, params.get("date_from"), params.get("date_to"))

    def parse(value):
        try:
            return date.fromisoformat(value) if value else None
        except ValueError:
            return None

    return {"date_from": parse(date_from), "date_to": parse(date_to)}


def _continuity_filters(db: Session, request: Request) -> dict:
    params = request.query_params
    status_value, issue = params.get("status"), params.get("issue")
    return {
        **_continuity_window(db, request),
        "search": params.get("search") or None,
        "bank_name": params.get("bank_name") or None,
        "status": status_value if status_value in (cont.STATUS_ISSUES, cont.STATUS_CONTINUOUS, cont.STATUS_EMPTY) else None,
        "issue": issue if issue in cont.ISSUE_PRIORITY else None,
    }


@router.get("/continuity/summary/", dependencies=[Depends(continuity_access)])
def continuity_summary(request: Request, db: Session = Depends(get_db)):
    return cont.get_continuity_summary(db, **_continuity_filters(db, request))


@router.get("/continuity/banks/", dependencies=[Depends(continuity_access)])
def continuity_banks(db: Session = Depends(get_db)):
    return cont.list_continuity_banks(db)


@router.get("/continuity/accounts/", dependencies=[Depends(continuity_access)])
def continuity_accounts(request: Request, db: Session = Depends(get_db), page: Optional[str] = None,
                        limit: Optional[str] = None):
    return paginate_list(cont.list_account_continuity(db, **_continuity_filters(db, request)), page, limit)


@router.get("/continuity/page/", dependencies=[Depends(continuity_access)])
def continuity_page(request: Request, db: Session = Depends(get_db), page: Optional[str] = None,
                    limit: Optional[str] = None):
    """The whole Statement Continuity page in one request: summary, one page of account rows, and the
    statement timelines of that page's accounts with issues. include_banks=1 adds the bank filter options."""
    accounts, summary, timeline = cont.get_continuity_page(db, **_continuity_filters(db, request))
    data = paginate_list(accounts, page, limit)
    data["summary"] = summary
    data["statements"] = {str(a["account_id"]): timeline(a["account_id"])
                          for a in data["results"] if a["status"] == cont.STATUS_ISSUES}
    if flag(request, "include_banks"):
        data["banks"] = cont.list_continuity_banks(db)
    return data


@router.get("/continuity/accounts/{account_id:int}/statements/", dependencies=[Depends(continuity_access)])
def continuity_account_statements(account_id: int, request: Request, db: Session = Depends(get_db)):
    if not db.get(BankAccount, account_id):
        raise not_found("Bank account not found.")
    return cont.get_account_timeline(db, account_id, **_continuity_window(db, request))


# ---------------------------------------------------------------------------
# Bank statements
# ---------------------------------------------------------------------------

def _statement_filters(stmt, account, source_type, status, search):
    if account and str(account).upper() != "ALL":
        stmt = stmt.where(BankStatement.account_id == int(account))
    if source_type and str(source_type).upper() != "ALL":
        stmt = stmt.where(BankStatement.source_type == str(source_type).upper())
    has_duplicates = exists(select(Transaction.id).where(Transaction.statement_id == BankStatement.id,
                                                         Transaction.is_potential_duplicate.is_(True)))
    if status == "DUPLICATES":
        stmt = stmt.where(has_duplicates)
    elif status == "CLEAN":
        stmt = stmt.where(not_(has_duplicates))
    if search:
        term = search.strip()
        stmt = stmt.where(or_(BankStatement.file_path.ilike(f"%{term}%"),
                              BankStatement.account_id.in_(select(BankAccount.id)
                                                           .where(BankAccount.name.ilike(f"%{term}%")))))
    return stmt


def _serialize_statements(db: Session, request: Request, statements: list[BankStatement]) -> list[dict]:
    counts = ser.statement_counts(db, [s.id for s in statements])
    continuity = cont.continuity_for_accounts(db, {s.account_id for s in statements})
    base = str(request.base_url)
    return [ser.statement(s, counts.get(s.id, {}), continuity.get(s.account_id, {}).get(s.id), base) for s in statements]


@router.get("/bank-statements/", dependencies=[Depends(statement_access)])
def list_statements(request: Request, db: Session = Depends(get_db), account: Optional[str] = None,
                    source_type: Optional[str] = None, status: Optional[str] = None, search: Optional[str] = None,
                    ordering: Optional[str] = None, page: Optional[str] = None, limit: Optional[str] = None):
    stmt = _statement_filters(select(BankStatement).options(joinedload(BankStatement.account)),
                              account, source_type, status, search)
    stmt = apply_ordering(stmt, ordering, {"uploaded_at": BankStatement.uploaded_at},
                          [BankStatement.uploaded_at.desc(), BankStatement.id.desc()])
    return paginate(db, stmt, page, limit, serialize_many=lambda rows: _serialize_statements(db, request, rows))


@router.get("/bank-statements/summary/", dependencies=[Depends(statement_access)])
def statements_summary(db: Session = Depends(get_db), account: Optional[str] = None,
                       source_type: Optional[str] = None, status: Optional[str] = None, search: Optional[str] = None):
    rows = db.execute(_statement_filters(select(BankStatement.id, BankStatement.account_id),
                                         account, source_type, status, search)).all()
    ids = [r[0] for r in rows]
    total, duplicates = (0, 0)
    if ids:
        total, duplicates = db.execute(select(func.count(Transaction.id),
                                              func.count(Transaction.id).filter(Transaction.is_potential_duplicate.is_(True)))
                                       .where(Transaction.statement_id.in_(ids))).one()
    account_ids = {r[1] for r in rows}
    continuity = {}
    for per_account in cont.continuity_for_accounts(db, account_ids).values():
        continuity.update(per_account)
    return {
        "total_imports": len(rows),
        "total_transactions": total,
        "total_duplicates": duplicates,
        "unique_accounts": len(account_ids),
        "gap_count": sum(1 for sid, _ in rows if not continuity.get(sid, {}).get("is_continuous", True)),
    }


def _save_parsed_transactions(db: Session, statement: BankStatement, rows) -> None:
    for txn in db.scalars(select(Transaction).where(Transaction.statement_id == statement.id)):
        db.delete(txn)
    db.flush()
    db.add_all([Transaction(
        statement_id=statement.id, date=r.date, description=r.description[:500],
        clean_description=clean_description(r.description), status=TransactionStatus.UNCATEGORIZED,
        bai_code=(r.bai_code or "")[:10], debit=r.debit, credit=r.credit, balance=r.balance,
    ) for r in rows])
    db.flush()
    flag_duplicate_transactions(db, statement)


def _store_file(content: bytes, filename: str) -> str:
    """Saves an upload under media/bank_statements/YYYY/MM/ and returns its path relative to media/."""
    stamp = now()
    folder = Path("bank_statements") / f"{stamp:%Y}" / f"{stamp:%m}"
    name = Path(filename or "statement").name
    target = settings.media_root / folder / name
    if target.exists():
        target = target.with_name(f"{target.stem}_{secrets.token_hex(4)}{target.suffix}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return (folder / target.name).as_posix()


@router.post("/bank-statements/", status_code=201, dependencies=[Depends(statement_access)])
def upload_statement(request: Request, db: Session = Depends(get_db), account: Optional[int] = Form(None),
                     source_type: Optional[str] = Form(None), file: Optional[UploadFile] = File(None),
                     confirm_continuity: Optional[str] = Form(None)):
    """Parses the uploaded file into transactions before saving the statement, so an unparseable file
    is rejected with a 400. Opening / closing balance come from the file's own running balance. The
    exact same file uploaded twice (even to another account) is refused with a 409, and a statement
    that doesn't follow on from its neighbours needs confirm_continuity=true."""
    errors = {}
    if file is None:
        errors["file"] = ["No file was submitted."]
    if account is None:
        errors["account"] = ["This field is required."]
    if not source_type:
        errors["source_type"] = ["This field is required."]
    elif source_type.upper() not in StatementSourceType.__members__:
        errors["source_type"] = [f'"{source_type}" is not a valid choice.']
    if errors:
        raise APIError(400, errors)
    bank_account = db.get(BankAccount, account)
    if bank_account is None:
        raise APIError(400, {"account": [f'Invalid pk "{account}" - object does not exist.']})

    content = file.file.read()
    file_hash = hashlib.sha256(content).hexdigest()
    duplicate = db.scalars(select(BankStatement).where(BankStatement.file_hash == file_hash)).first()
    if duplicate:
        raise APIError(409, {"file": [
            f'This exact file was already uploaded on {duplicate.uploaded_at:%d %b %Y, %H:%M} '
            f'for account "{duplicate.account.name}" (statement #{duplicate.id}). '
            'Delete that statement first if you really want to re-upload it.'
        ]})

    try:
        rows = parse_bank_statement(io.BytesIO(content), file.filename)
    except StatementParsingError as exc:
        raise APIError(400, {"file": [str(exc)]})
    try:
        # New bank rows inside a closed period / signed-off month would change its figures.
        period_close.guard_dates(db, *(r.date for r in rows), what="this file has transactions dated in that period")
        recon.guard_bank_transaction_date(db, bank_account.id, *(r.date for r in rows))
    except (recon.ReconciliationError, period_close.PeriodClosedError) as exc:
        raise APIError(400, {"file": [str(exc)]})

    opening_balance, closing_balance = derive_opening_closing_balance(rows)
    if not is_true(confirm_continuity or request.query_params.get("confirm_continuity")):
        problems = cont.check_new_statement(db, bank_account.id, rows, opening_balance, closing_balance,
                                            name=file.filename or "")
        if problems:
            raise APIError(409, {"error": [problems[0]["message"]], "requires_continuity_confirmation": True,
                                 "continuity": problems})

    statement = BankStatement(account_id=bank_account.id, file_path=_store_file(content, file.filename),
                              source_type=StatementSourceType(source_type.upper()), opening_balance=opening_balance,
                              closing_balance=closing_balance, file_hash=file_hash)
    db.add(statement)
    db.flush()
    _save_parsed_transactions(db, statement, rows)
    db.commit()
    return _serialize_statements(db, request, [statement])[0]


@router.post("/bank-statements/check-duplicates/", dependencies=[Depends(Access("bank_statements", action=EDIT))])
def check_duplicates(db: Session = Depends(get_db)):
    """Re-runs transaction-level duplicate detection across every statement, oldest first."""
    flagged = 0
    for statement in db.scalars(select(BankStatement).order_by(BankStatement.id)).all():
        flagged += flag_duplicate_transactions(db, statement)
        db.flush()
    db.commit()
    return {"flagged": flagged}


@router.get("/bank-statements/{statement_id:int}/", dependencies=[Depends(statement_access)])
def get_statement(statement_id: int, request: Request, db: Session = Depends(get_db)):
    return _serialize_statements(db, request, [get_or_404(db, BankStatement, statement_id, "BankStatement")])[0]


@router.put("/bank-statements/{statement_id:int}/", dependencies=[Depends(statement_access)])
@router.patch("/bank-statements/{statement_id:int}/", dependencies=[Depends(statement_access)])
async def update_statement(statement_id: int, request: Request, db: Session = Depends(get_db)):
    """Only the account and source type can change (the file and balances come from the upload)."""
    statement = get_or_404(db, BankStatement, statement_id, "BankStatement")
    data = await request.json() if "json" in request.headers.get("content-type", "") else dict(await request.form())
    if data.get("account"):
        if not db.get(BankAccount, int(data["account"])):
            raise APIError(400, {"account": [f'Invalid pk "{data["account"]}" - object does not exist.']})
        statement.account_id = int(data["account"])
    if data.get("source_type"):
        if str(data["source_type"]).upper() not in StatementSourceType.__members__:
            raise APIError(400, {"source_type": [f'"{data["source_type"]}" is not a valid choice.']})
        statement.source_type = StatementSourceType(str(data["source_type"]).upper())
    db.commit()
    return _serialize_statements(db, request, [statement])[0]


@router.delete("/bank-statements/{statement_id:int}/", status_code=204, dependencies=[Depends(statement_access)])
def delete_statement(statement_id: int, request: Request, db: Session = Depends(get_db)):
    statement = get_or_404(db, BankStatement, statement_id, "BankStatement")
    txn_ids = select(Transaction.id).where(Transaction.statement_id == statement.id)
    period_guard(period_close.guard_transactions, db, txn_ids,
                 "this statement has transactions dated in that period, so it cannot be deleted")
    reject_if_statement_has_final(db, statement.id)
    reconcile_guard(recon.guard_bank_transactions, db, db.scalars(txn_ids).all(), confirm_unmatch(request))
    db.delete(statement)
    db.commit()
    return Response(status_code=204)


@router.post("/bank-statements/{statement_id:int}/reparse/", dependencies=[Depends(Access("bank_statements", action=EDIT))])
def reparse_statement(statement_id: int, request: Request, body: Optional[ConfirmIn] = None,
                      db: Session = Depends(get_db)):
    """Re-runs the parser on the stored file, replacing the transactions and re-deriving the balances.
    confirm_unmatch may come as ?confirm_unmatch=true or in the JSON body."""
    statement = get_or_404(db, BankStatement, statement_id, "BankStatement")
    txn_ids = select(Transaction.id).where(Transaction.statement_id == statement.id)
    period_guard(period_close.guard_transactions, db, txn_ids,
                 "this statement has transactions dated in that period, so it cannot be re-parsed")
    reject_if_statement_has_final(db, statement.id)
    # Re-parsing deletes and re-creates every transaction, and with them their reconciliation matches.
    reconcile_guard(recon.guard_bank_transactions, db, db.scalars(txn_ids).all(),
                    confirm_unmatch(request, body.model_dump() if body else None))
    path = settings.media_root / statement.file_path
    if not path.exists():
        raise APIError(400, {"file": ["The uploaded file is no longer on the server - upload it again."]})
    try:
        rows = parse_bank_statement(io.BytesIO(path.read_bytes()), path.name)
    except StatementParsingError as exc:
        raise APIError(400, {"file": [str(exc)]})
    period_guard(period_close.guard_dates, db, *(r.date for r in rows), what="the file has transactions dated in that period")
    reconcile_guard(recon.guard_bank_transaction_date, db, statement.account_id, *(r.date for r in rows))
    _save_parsed_transactions(db, statement, rows)
    statement.opening_balance, statement.closing_balance = derive_opening_closing_balance(rows)
    db.commit()
    return {"parsed": len(rows)}


@router.post("/bank-statements/{statement_id:int}/categorize/", dependencies=[Depends(Access("bank_statements", action=EDIT))])
def categorize_statement(statement_id: int, db: Session = Depends(get_db)):
    """Runs the categorization engine on this statement: transfer detection across every account, then
    user rules -> exact history -> scoring -> decide. Never touches a confirmed or transfer transaction."""
    statement = get_or_404(db, BankStatement, statement_id, "BankStatement")
    transfers_detected = detect_transfers(db)
    txns = db.scalars(select(Transaction).where(Transaction.statement_id == statement.id)).all()
    counts = categorize_transactions(db, txns)
    matched = sum(v for k, v in counts.items() if k not in ("UNCATEGORIZED", "NEEDS_REVIEW"))
    return {"matched": matched, "needs_review": counts["NEEDS_REVIEW"], "unmatched": counts["UNCATEGORIZED"],
            "transfers_detected": transfers_detected, "by_source": counts}
