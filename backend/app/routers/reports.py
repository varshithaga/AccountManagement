"""Financial reports: P&L, Balance Sheet, Trial Balance, Cash Flow, Account Ledger, comparisons,
drill-downs, and receivables / payables aging."""
import csv
import io
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..access import user_pages
from ..database import get_db
from ..deps import Access
from ..errors import APIError, bad_request, forbidden
from ..models import Transaction, User
from ..services.invoicing import aging_report
from ..services.reports import (
    AccountNotFound, build_account_ledger, build_balance_sheet, build_cash_flow, build_profit_and_loss,
    build_trial_balance, line_item_filters, resolve_period,
)
from ..utils import paginate, parse_date

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _period(db: Session, request: Request):
    p = request.query_params
    return resolve_period(db, p.get("period"), p.get("date_from") or None, p.get("date_to") or None)


def _csv(filename: str, rows: list[list]) -> StreamingResponse:
    buffer = io.StringIO()
    csv.writer(buffer).writerows(rows)
    return StreamingResponse(iter([buffer.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def _section_rows(label: str, categories: list) -> list[list]:
    rows = []
    for cat in categories:
        for sub in cat["subcategories"]:
            rows.append([label, cat["category_name"], sub["sub_category_name"], sub["amount"]])
        rows.append([f"{label} TOTAL", cat["category_name"], "", cat["total"]])
    return rows


@router.get("/trial-balance/", dependencies=[Depends(Access("trial_balance"))])
def trial_balance(request: Request, db: Session = Depends(get_db), account: Optional[str] = None,
                  format: Optional[str] = None):
    period, date_from, date_to = _period(db, request)
    report = build_trial_balance(db, period=period, date_from=date_from, date_to=date_to, account_id=account or None)
    if format == "csv":
        rows = [["Account Type", "Category", "Sub-Category", "Debit", "Credit"]]
        for acct_type, lines in report["account_types"].items():
            rows += [[acct_type, l["category_name"], l["sub_category_name"], l["debit"], l["credit"]] for l in lines]
        rows += [[], ["TOTALS", "", "", report["total_debit"], report["total_credit"]],
                 ["DIFFERENCE", "", "", report["difference"]], ["IS BALANCED", "", "", report["is_balanced"]]]
        return _csv(f"trial_balance_{period}.csv", rows)
    return report


@router.get("/profit-and-loss/", dependencies=[Depends(Access("profit_and_loss", "reports_comparison"))])
def profit_and_loss(request: Request, db: Session = Depends(get_db), account: Optional[str] = None,
                    format: Optional[str] = None):
    period, date_from, date_to = _period(db, request)
    report = build_profit_and_loss(db, period=period, date_from=date_from, date_to=date_to, account_id=account or None)
    if format == "csv":
        rows = [["Section", "Category", "Sub-Category", "Amount"]]
        rows += _section_rows("INCOME", report["income"]["categories"])
        rows += [["TOTAL INCOME", "", "", report["income"]["total"]], []]
        rows += _section_rows("EXPENSE", report["expense"]["categories"])
        rows += [["TOTAL EXPENSES", "", "", report["expense"]["total"]], [],
                 ["NET PROFIT / LOSS", "", "", report["net_profit"]]]
        return _csv(f"profit_and_loss_{period}.csv", rows)
    return report


@router.get("/balance-sheet/", dependencies=[Depends(Access("balance_sheet", "reports_comparison"))])
def balance_sheet(request: Request, db: Session = Depends(get_db), account: Optional[str] = None,
                  format: Optional[str] = None):
    period, date_from, date_to = _period(db, request)
    report = build_balance_sheet(db, period=period, date_from=date_from, date_to=date_to, account_id=account or None)
    if format == "csv":
        rows = [["Section", "Category", "Sub-Category", "Amount"]]
        rows += _section_rows("ASSETS", report["assets"]["categories"])
        rows += [["TOTAL ASSETS", "", "", report["total_assets"]], []]
        rows += _section_rows("LIABILITIES", report["liabilities"]["categories"])
        rows += [["TOTAL LIABILITIES", "", "", report["liabilities"]["total"]], []]
        rows += _section_rows("EQUITY", report["equity"]["categories"])
        rows += [["RETAINED EARNINGS (NET PROFIT)", "", "", report["retained_earnings"]],
                 ["TOTAL EQUITY", "", "", report["total_equity"]],
                 ["TOTAL LIABILITIES & EQUITY", "", "", report["total_liabilities_and_equity"]]]
        return _csv(f"balance_sheet_{period}.csv", rows)
    return report


def _comparison_parts(db: Session, request: Request, totals_only: bool) -> dict:
    p = request.query_params
    account_id = p.get("account") or None

    def part(period, date_from=None, date_to=None):
        period, date_from, date_to = resolve_period(db, period, date_from, date_to)
        kwargs = dict(period=period, date_from=date_from, date_to=date_to, account_id=account_id)
        pnl, bs = build_profit_and_loss(db, **kwargs), build_balance_sheet(db, **kwargs)
        if not totals_only:
            return {"profit_and_loss": pnl, "balance_sheet": bs}
        income, expenses = abs(Decimal(pnl["income"]["total"])), abs(Decimal(pnl["expense"]["total"]))
        return {"date_from": date_from, "date_to": date_to, "income": float(income), "expenses": float(expenses),
                "net_profit": float(income - expenses), "assets": float(bs["total_assets"]),
                "liabilities": float(bs["liabilities"]["total"]), "equity": float(bs["total_equity"])}

    result = {}
    if p.get("summary") in ("1", "true"):
        result["all_time"] = part("all_time")
    for side in ("a", "b"):
        if p.get(f"{side}_period"):
            result[side] = part(p[f"{side}_period"], p.get(f"{side}_date_from") or None, p.get(f"{side}_date_to") or None)
    return result


@router.get("/comparison/", dependencies=[Depends(Access("reports_comparison"))])
def comparison(request: Request, db: Session = Depends(get_db)):
    """?summary=1&a_period=&a_date_from=&a_date_to=&b_period=&b_date_from=&b_date_to=&account= - totals only."""
    return _comparison_parts(db, request, totals_only=True)


@router.get("/comparison/export/", dependencies=[Depends(Access("reports_comparison"))])
def comparison_export(request: Request, db: Session = Depends(get_db)):
    """Same query as /comparison/, but each part is the full P&L and Balance Sheet."""
    return _comparison_parts(db, request, totals_only=False)


@router.get("/financial-pack/")
def financial_pack(request: Request, db: Session = Depends(get_db),
                   user: User = Depends(Access("trial_balance", "profit_and_loss", "balance_sheet"))):
    """Trial Balance, P&L and Balance Sheet for one period in one request (for the export)."""
    pages = set(user_pages(user))
    if not ("trial_balance" in pages and pages & {"profit_and_loss", "reports_comparison"}
            and pages & {"balance_sheet", "reports_comparison"}):
        raise forbidden("Your role needs the Trial Balance, Profit & Loss and Balance Sheet pages for the financial pack.")
    p = request.query_params
    account_id = p.get("account") or None
    period, date_from, date_to = _period(db, request)
    kwargs = dict(period=period, date_from=date_from, date_to=date_to, account_id=account_id)
    # The Balance Sheet is "as of" the period end - for a custom range only date_to applies.
    bs_period, bs_from, bs_to = resolve_period(db, p.get("period"), None, p.get("date_to") or None)
    return {
        "trial_balance": build_trial_balance(db, **kwargs),
        "profit_and_loss": build_profit_and_loss(db, **kwargs),
        "balance_sheet": build_balance_sheet(db, period=bs_period, date_from=bs_from, date_to=bs_to, account_id=account_id),
    }


@router.get("/line-item-transactions/", dependencies=[Depends(Access("profit_and_loss", "balance_sheet"))])
def line_item_transactions(request: Request, db: Session = Depends(get_db), page: Optional[str] = None,
                           limit: Optional[str] = None):
    """?category=&sub_category=&period=&date_from=&date_to=&account=&as_of=1 - the transactions behind one
    report line, 20 per page. as_of=1 (Balance Sheet): everything up to the period end."""
    p = request.query_params
    _, date_from, date_to = _period(db, request)
    where = line_item_filters(date_from, date_to, p.get("account") or None, p.get("category") or None,
                              p.get("sub_category") or None, as_of=p.get("as_of") in ("1", "true"))
    stmt = (select(Transaction).where(*where)
            .options(joinedload(Transaction.category), joinedload(Transaction.sub_category))
            .order_by(Transaction.date.desc(), Transaction.id.desc()))

    def row(t: Transaction):
        account_type = t.category.account_type.value if t.category else "EXPENSE"
        if account_type in ("INCOME", "LIABILITY", "EQUITY"):
            amount = (t.credit or 0) - (t.debit or 0)
        else:
            amount = (t.debit or 0) - (t.credit or 0)
        return {
            "id": t.id, "date": t.date.isoformat(), "description": t.description, "amount": float(amount),
            "debit": float(t.debit or 0), "credit": float(t.credit or 0),
            "category_id": t.category_id, "category_name": t.category.name if t.category else "",
            "sub_category_id": t.sub_category_id, "sub_category_name": t.sub_category.name if t.sub_category else "",
        }

    return paginate(db, stmt, page, limit, row, default_size=20)


@router.get("/account-ledger/", dependencies=[Depends(Access("account_ledger"))])
def account_ledger(request: Request, db: Session = Depends(get_db)):
    """?sub_category=<id> | category=<id>&period=&date_from=&date_to=&account=&page=&page_size= (up to 5000)."""
    p = request.query_params
    if not p.get("sub_category") and not p.get("category"):
        raise bad_request("Choose an account (sub_category or category).")
    period, date_from, date_to = _period(db, request)
    try:
        return build_account_ledger(db, sub_category_id=p.get("sub_category") or None,
                                    category_id=p.get("category") or None, period=period, date_from=date_from,
                                    date_to=date_to, account_id=p.get("account") or None,
                                    page=p.get("page") or 1, page_size=p.get("page_size") or 50)
    except (AccountNotFound, ValueError):
        raise APIError(404, {"error": ["That account does not exist."]})


@router.get("/cash-flow/", dependencies=[Depends(Access("cash_flow"))])
def cash_flow(request: Request, db: Session = Depends(get_db), account: Optional[str] = None):
    period, date_from, date_to = _period(db, request)
    return build_cash_flow(db, period=period, date_from=date_from, date_to=date_to, account_id=account or None)


@router.get("/receivables-aging/", dependencies=[Depends(Access("receivables_payables", "clients", "sales_invoices"))])
def receivables_aging(as_of: Optional[str] = None, db: Session = Depends(get_db)):
    """What each client owes, by days past due (current, 1-30, 31-60, 61-90, over 90) as of ?as_of= (default today)."""
    return aging_report(db, "receivables", parse_date(as_of))


@router.get("/payables-aging/", dependencies=[Depends(Access("receivables_payables", "suppliers", "purchase_bills"))])
def payables_aging(as_of: Optional[str] = None, db: Session = Depends(get_db)):
    """What is owed to each supplier, by days past due, as of ?as_of= (default today)."""
    return aging_report(db, "payables", parse_date(as_of))
