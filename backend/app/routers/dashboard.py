"""Dashboard widgets and the Workflow progress page."""
import calendar
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy import and_, exists, func, not_, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Access
from ..models import (
    BaiCode, BankAccount, BankStatement, Category, CategoryKeyword, DocumentStatus, JournalEntryLine,
    PurchaseBill, SalesInvoice, SubCategory, Transaction, TransactionStatus,
)
from ..services.continuity import get_continuity_summary
from ..services.filters import (
    LINE_UNMATCHED, TXN_NOT_DUPLICATE_COPY, TXN_NOT_TRANSFER, TXN_UNCATEGORIZED, TXN_UNMATCHED,
    txn_of_account,
)
from ..services.reconciliation import locks_by_account
from ..services.reports import build_balance_sheet, build_profit_and_loss, resolve_period
from ..utils import today

router = APIRouter(prefix="/api", tags=["dashboard"])
dashboard = Access("dashboard")
ZERO = Decimal("0")

# A bank transaction still unmatched after this many days is flagged on the dashboard.
UNRECONCILED_AGE_DAYS = 30


def _account_param(request: Request) -> Optional[int]:
    raw = request.query_params.get("account")
    return int(raw) if raw and str(raw).isdigit() else None


def _period(db: Session, request: Request):
    p = request.query_params
    return resolve_period(db, p.get("period"), p.get("date_from") or None, p.get("date_to") or None)


def _sums(db: Session, *where) -> tuple[Decimal, Decimal]:
    d, c = db.execute(select(func.coalesce(func.sum(Transaction.debit), 0), func.coalesce(func.sum(Transaction.credit), 0))
                      .where(*where)).one()
    return Decimal(d), Decimal(c)


def _income_and_expense(db: Session, date_from, date_to, account_id=None) -> tuple[Decimal, Decimal]:
    """(income, expense) in the books (the journal) for [date_from, date_to] - the same figures as the P&L."""
    pnl = build_profit_and_loss(db, date_from=date_from, date_to=date_to, account_id=account_id)
    return pnl['income']['total'], pnl['expense']['total']


def _previous_window(date_from, date_to):
    """The period just before [date_from, date_to]: whole months step back by the same number of months,
    any other range by the same number of days. None for an open-ended range."""
    if not date_from or not date_to:
        return None
    start, end = date.fromisoformat(str(date_from)), date.fromisoformat(str(date_to))
    if start > end:
        return None
    if start.day == 1 and end.day == calendar.monthrange(end.year, end.month)[1]:
        n_months = (end.year - start.year) * 12 + end.month - start.month + 1
        prev_end = start - timedelta(days=1)
        months_back = prev_end.year * 12 + prev_end.month - 1 - (n_months - 1)
        return date(months_back // 12, months_back % 12 + 1, 1), prev_end
    prev_end = start - timedelta(days=1)
    return prev_end - (end - start), prev_end


def _statements_not_auto_categorized(db: Session, account_id=None) -> int:
    """Statements none of whose transactions has been through Auto-Categorize (or a person) yet."""
    categorized = exists(select(Transaction.id).where(
        Transaction.statement_id == BankStatement.id,
        or_(Transaction.categorization_source.is_not(None), Transaction.confirmed.is_(True))))
    has_txns = exists(select(Transaction.id).where(Transaction.statement_id == BankStatement.id))
    stmt = select(func.count(BankStatement.id)).where(has_txns, not_(categorized))
    if account_id:
        stmt = stmt.where(BankStatement.account_id == account_id)
    return db.scalar(stmt) or 0


def _latest_closing(db: Session, account_ids: list[int]) -> dict:
    """{account id: closing balance of its most recently uploaded statement}."""
    result = {}
    for account_id, closing in db.execute(select(BankStatement.account_id, BankStatement.closing_balance)
                                          .where(BankStatement.account_id.in_(account_ids))
                                          .order_by(BankStatement.uploaded_at, BankStatement.id)):
        result[account_id] = closing
    return result


@router.get("/dashboard/kpis/", dependencies=[Depends(dashboard)])
def kpis(request: Request, db: Session = Depends(get_db)):
    """Period income, expense, net profit, margin, cash balance and account count (+ the previous period)."""
    period, date_from, date_to = _period(db, request)
    account_id = _account_param(request)
    income, expense = _income_and_expense(db, date_from, date_to, account_id)
    net = income - expense
    margin = f"{(net / income * 100):.1f}" if income > 0 else "0.0"
    bs = build_balance_sheet(db, period=period, date_from=None, date_to=date_to, account_id=account_id)
    accounts = select(func.count(BankAccount.id)).where(BankAccount.is_active.is_(True))
    if account_id:
        accounts = accounts.where(BankAccount.id == account_id)

    previous = None
    window = _previous_window(date_from, date_to)
    if window:
        prev_income, prev_expense = _income_and_expense(db, *window, account_id)
        previous = {"date_from": window[0].isoformat(), "date_to": window[1].isoformat(),
                    "income_total": prev_income, "expense_total": prev_expense,
                    "net_profit": prev_income - prev_expense}
    return {
        "period": period, "income_total": income, "expense_total": expense, "net_profit": abs(net),
        "is_profit": net >= 0, "profit_margin": margin, "cash_balance": bs["total_assets"],
        "accounts_count": db.scalar(accounts), "previous": previous,
    }


@router.get("/dashboard/cash-position/", dependencies=[Depends(dashboard)])
def cash_position(request: Request, db: Session = Depends(get_db)):
    """Balance per bank account (its latest statement's closing balance) and the total."""
    account_id = _account_param(request)
    stmt = select(BankAccount).order_by(BankAccount.name)
    if account_id:
        stmt = stmt.where(BankAccount.id == account_id)
    accounts = db.scalars(stmt).all()
    closing = _latest_closing(db, [a.id for a in accounts])
    rows = [{"id": a.id, "name": a.name, "bank_name": a.bank_name, "account_number": a.account_number,
             "balance": closing.get(a.id) or ZERO} for a in accounts]
    return {"accounts": rows, "total_cash_balance": sum((r["balance"] for r in rows), ZERO)}


@router.get("/dashboard/attention/", dependencies=[Depends(dashboard)])
def attention(request: Request, db: Session = Depends(get_db)):
    """Uncategorized, duplicates, long-unreconciled, continuity issues, statements not auto-categorized,
    and overdue invoices / bills."""
    account_id = _account_param(request)
    scope = [txn_of_account(account_id)] if account_id else []

    unc_where = scope + [TXN_NOT_DUPLICATE_COPY, TXN_UNCATEGORIZED]
    unc_count = db.scalar(select(func.count(Transaction.id)).where(*unc_where))
    d, c = _sums(db, *unc_where)
    dup_where = scope + [Transaction.is_potential_duplicate.is_(True)]
    dup_count = db.scalar(select(func.count(Transaction.id)).where(*dup_where))
    dd, dc = _sums(db, *dup_where)

    cutoff = today() - timedelta(days=UNRECONCILED_AGE_DAYS)
    linked = BankStatement.account_id.in_(select(BankAccount.id).where(BankAccount.gl_account_id.is_not(None)))
    unrec_where = scope + [Transaction.statement_id.in_(select(BankStatement.id).where(linked)), TXN_UNMATCHED,
                           Transaction.date < cutoff]
    unrec_count = db.scalar(select(func.count(Transaction.id)).where(*unrec_where))
    ud, uc = _sums(db, *unrec_where)

    continuity = get_continuity_summary(db, account_id=account_id)
    not_categorized = _statements_not_auto_categorized(db, account_id)

    overdue = {}
    for key, model, date_col in (("overdue_invoices", SalesInvoice, SalesInvoice.due_date),
                                 ("overdue_bills", PurchaseBill, PurchaseBill.due_date)):
        n, amount = db.execute(select(func.count(model.id), func.coalesce(func.sum(model.total - model.amount_paid - model.amount_credited), 0))
                               .where(model.status.in_([DocumentStatus.POSTED, DocumentStatus.PARTIALLY_PAID]),
                                      date_col < today())).one()
        overdue[key] = {"count": n, "amount": Decimal(amount)}

    counts = (unc_count, dup_count, unrec_count, continuity["statements_with_issues"], not_categorized)
    return {
        "uncategorized": {"count": unc_count, "amount": abs(c - d)},
        "duplicates": {"count": dup_count, "amount": abs(dd + dc)},
        "unreconciled": {"count": unrec_count, "amount": ud + uc, "older_than_days": UNRECONCILED_AGE_DAYS},
        "continuity_issues": {"count": continuity["statements_with_issues"], "amount": continuity["unaccounted_balance"]},
        "not_auto_categorized": {"count": not_categorized},
        **overdue,
        "pending_attention_count": sum(1 for n in counts if n > 0)
                                   + sum(1 for v in overdue.values() if v["count"] > 0),
    }


@router.get("/dashboard/top-expenses/", dependencies=[Depends(dashboard)])
def top_expenses(request: Request, db: Session = Depends(get_db)):
    period, date_from, date_to = _period(db, request)
    try:
        limit = int(request.query_params.get("limit", 4))
    except (TypeError, ValueError):
        limit = 4
    pnl = build_profit_and_loss(db, period=period, date_from=date_from, date_to=date_to,
                                account_id=_account_param(request))
    top = sorted(pnl["expense"]["categories"], key=lambda c: float(c["total"]), reverse=True)[:limit]
    return {
        "top_expenses": [{"category_id": c["category_id"], "category_name": c["category_name"], "total": abs(c["total"])}
                         for c in top],
        "max_expense": abs(top[0]["total"]) if top else ZERO,
    }


@router.get("/dashboard/recent-statements/", dependencies=[Depends(dashboard)])
def recent_statements(request: Request, db: Session = Depends(get_db)):
    try:
        limit = int(request.query_params.get("limit", 5))
    except (TypeError, ValueError):
        limit = 5
    account_id = _account_param(request)
    where = [BankStatement.account_id == account_id] if account_id else []
    n_txns = (select(func.count(Transaction.id)).where(Transaction.statement_id == BankStatement.id)
              .correlate(BankStatement).scalar_subquery())
    rows = db.execute(select(BankStatement, BankAccount.name, n_txns)
                      .join(BankAccount, BankStatement.account_id == BankAccount.id).where(*where)
                      .order_by(BankStatement.uploaded_at.desc()).limit(limit)).all()
    return {
        "count": db.scalar(select(func.count(BankStatement.id)).where(*where)),
        "results": [{"id": s.id, "account_name": name, "source_type": s.source_type.value,
                     "uploaded_at": s.uploaded_at.isoformat() if s.uploaded_at else None, "transaction_count": n}
                    for s, name, n in rows],
    }


@router.get("/dashboard/reconciliation-status/", dependencies=[Depends(dashboard)])
def reconciliation_status(request: Request, db: Session = Depends(get_db)):
    """Per active bank account: last signed-off month, matched share of bank transactions, open items.
    status: NOT_LINKED, NO_ACTIVITY, UP_TO_DATE or OPEN."""
    locks = locks_by_account(db)
    stmt = select(BankAccount).where(BankAccount.is_active.is_(True)).order_by(BankAccount.name)
    account_id = _account_param(request)
    if account_id:
        stmt = stmt.where(BankAccount.id == account_id)
    result = []
    for acct in db.scalars(stmt):
        total = db.scalar(select(func.count(Transaction.id)).where(txn_of_account(acct.id))) or 0
        open_txns = db.scalar(select(func.count(Transaction.id)).where(txn_of_account(acct.id), TXN_UNMATCHED)) or 0
        open_book = (db.scalar(select(func.count(JournalEntryLine.id)).where(
            JournalEntryLine.sub_category_id == acct.gl_account_id, LINE_UNMATCHED)) or 0) if acct.gl_account_id else 0
        matched = total - open_txns
        if not acct.gl_account_id:
            status = "NOT_LINKED"
        elif total == 0 and open_book == 0:
            status = "NO_ACTIVITY"
        elif open_txns == 0 and open_book == 0:
            status = "UP_TO_DATE"
        else:
            status = "OPEN"
        lock = locks.get(acct.id)
        result.append({
            "id": acct.id, "name": acct.name, "bank_name": acct.bank_name, "status": status,
            "locked_through": lock.isoformat() if lock else None, "bank_transactions": total,
            "bank_matched": matched, "matched_percent": round(matched * 100 / total, 1) if total else None,
            "open_bank": open_txns, "open_book": open_book,
        })
    return {"accounts": result}


@router.get("/dashboard/cash-flow-forecast/", dependencies=[Depends(dashboard)])
def cash_flow_forecast(request: Request, db: Session = Depends(get_db)):
    """Six months of bank inflows / outflows, averages from the completed months, burn rate, runway and
    a 3-month projection. Transfers between own accounts are left out."""
    now_month = today().replace(day=1)
    months = []
    for i in range(5, -1, -1):
        y, m = now_month.year, now_month.month - i
        while m < 1:
            m += 12
            y -= 1
        start = date(y, m, 1)
        months.append((start, start.replace(day=calendar.monthrange(y, m)[1])))

    account_id = _account_param(request)
    base = [TXN_NOT_DUPLICATE_COPY, TXN_NOT_TRANSFER] + ([txn_of_account(account_id)] if account_id else [])
    accounts = select(BankAccount.id) if not account_id else select(BankAccount.id).where(BankAccount.id == account_id)
    current_cash = sum((v or ZERO for v in _latest_closing(db, list(db.scalars(accounts))).values()), ZERO)

    historical = []
    total_in = total_out = ZERO
    valid_months = 0
    current_flows = None
    for start, end in months:
        outflow, inflow = _sums(db, *base, Transaction.date >= start, Transaction.date <= end)
        if inflow > 0 or outflow > 0:
            if start == now_month:
                current_flows = (inflow, outflow)
            else:
                total_in += inflow
                total_out += outflow
                valid_months += 1
        historical.append({"month": start.strftime("%Y-%m"), "month_name": start.strftime("%b %Y"),
                           "inflow": float(inflow), "outflow": float(outflow), "net": float(inflow - outflow),
                           "is_forecast": False})
    if valid_months == 0 and current_flows:
        total_in, total_out = current_flows
        valid_months = 1

    denom = Decimal(max(1, valid_months))
    avg_in, avg_out = total_in / denom, total_out / denom
    avg_net = avg_in - avg_out
    burn = avg_out - avg_in
    if valid_months == 0:
        runway, burn_status = None, "NO_DATA"
    elif burn > 0:
        runway, burn_status = round(float(max(current_cash, ZERO) / burn), 1), "BURNING"
    else:
        runway, burn_status = None, "SURPLUS"

    forecast = []
    balance = current_cash
    last = months[-1][0]
    for i in range(1, 4):
        m, y = last.month + i, last.year
        while m > 12:
            m -= 12
            y += 1
        f = date(y, m, 1)
        balance += avg_net
        forecast.append({"month": f.strftime("%Y-%m"), "month_name": f.strftime("%b %Y") + " (Est)",
                         "inflow": float(avg_in), "outflow": float(avg_out), "net": float(avg_net),
                         "projected_balance": float(balance), "is_forecast": True})
    return {
        "historical": historical, "forecast": forecast,
        "metrics": {"current_balance": float(current_cash), "avg_monthly_inflow": float(avg_in),
                    "avg_monthly_outflow": float(avg_out), "avg_net_flow": float(avg_net),
                    "net_burn_rate": float(max(ZERO, burn)), "runway_months": runway, "burn_status": burn_status},
    }


@router.get("/dashboard/overview/", dependencies=[Depends(dashboard)])
def overview(request: Request, db: Session = Depends(get_db)):
    """Every dashboard widget in one request (each narrowed to ?account= when given)."""
    return {
        "reconciliation_status": reconciliation_status(request, db),
        "kpis": kpis(request, db),
        "cash_position": cash_position(request, db),
        "attention": attention(request, db),
        "top_expenses": top_expenses(request, db),
        "recent_statements": recent_statements(request, db),
        "cash_flow_forecast": cash_flow_forecast(request, db),
    }


@router.get("/workflow/status/", dependencies=[Depends(Access("workflow"))])
def workflow_status(db: Session = Depends(get_db)):
    """Live counts behind each step of the Workflow page (all-time)."""
    def count(model, *where):
        return db.scalar(select(func.count(model.id)).where(*where)) or 0

    not_ready = Transaction.status.in_([TransactionStatus.NEEDS_REVIEW, TransactionStatus.UNCATEGORIZED])
    categorized = and_(Transaction.sub_category_id.is_not(None), or_(Transaction.status.is_(None), not_(not_ready)))
    continuity = get_continuity_summary(db)
    return {
        "setup": {
            "categories": count(Category, Category.is_active.is_(True)),
            "sub_categories": count(SubCategory, SubCategory.is_active.is_(True)),
            "keywords": count(CategoryKeyword, CategoryKeyword.is_active.is_(True)),
            "bai_codes": count(BaiCode),
            "bai_codes_mapped": count(BaiCode, BaiCode.sub_category_id.is_not(None)),
            "bank_accounts": count(BankAccount, BankAccount.is_active.is_(True)),
        },
        "statements": {
            "total": count(BankStatement),
            "not_auto_categorized": _statements_not_auto_categorized(db),
            "continuity_issues": continuity["statements_with_issues"],
            "unaccounted_balance": continuity["unaccounted_balance"],
        },
        "transactions": {
            "total": count(Transaction),
            "needs_review": count(Transaction, Transaction.status == TransactionStatus.NEEDS_REVIEW),
            "uncategorized": count(Transaction, TXN_UNCATEGORIZED),
            "duplicates": count(Transaction, Transaction.is_potential_duplicate.is_(True)),
            # categorized by the engine but not yet confirmed by a person
            "unconfirmed": count(Transaction, categorized, Transaction.confirmed.is_(False)),
            # ready to lock: confirmed (or a transfer) but not final yet
            "ready_to_finalize": count(Transaction, Transaction.is_final.is_(False), or_(
                Transaction.status == TransactionStatus.TRANSFER, and_(categorized, Transaction.confirmed.is_(True)))),
            "final": count(Transaction, Transaction.is_final.is_(True)),
        },
    }
