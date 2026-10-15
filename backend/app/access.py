"""Role-based page access.

Every sidebar page has a key. A Role lists the page keys its users may open, and
each endpoint names the pages it serves - a user may call it when their role
includes at least one of them.

Opening a page is the "view" right. On top of it a role holds, per page, the write
rights create / edit / delete (Role.actions). A request's right comes from its HTTP
method (POST create, PUT/PATCH edit, DELETE delete) unless the endpoint names it -
e.g. a POST that re-parses a statement is an edit, not a create."""
from typing import Optional

from .models import Role, User

# (key, label) in sidebar order.
PAGES = [
    ("dashboard", "Dashboard"),
    ("workflow", "Workflow"),
    ("menu_guide", "Menu Guide"),
    ("categories", "Chart of Accounts"),
    ("category_keywords", "Auto-Categorization Rules"),
    ("bai_codes", "BAI Codes"),
    ("bank_accounts", "Bank Accounts"),
    ("bank_statements", "Bank Statements"),
    ("statement_continuity", "Statement Continuity"),
    ("transactions", "General Ledger"),
    ("journal_entries", "Journal Entries"),
    ("clients", "Clients"),
    ("suppliers", "Suppliers"),
    ("products", "Products & Tax Rates"),
    ("sales_invoices", "Sales Invoices"),
    ("purchase_bills", "Purchase Bills"),
    ("payments", "Payments & Receipts"),
    ("bank_reconciliation", "Bank Reconciliation"),
    ("period_close", "Period Close"),
    ("profit_and_loss", "Profit & Loss"),
    ("balance_sheet", "Balance Sheet"),
    ("cash_flow", "Cash Flow Statement"),
    ("trial_balance", "Trial Balance"),
    ("account_ledger", "Account Ledger"),
    ("reports_comparison", "Period Comparison"),
    ("receivables_payables", "Receivables & Payables"),
    ("user_management", "User Management"),
]
PAGE_KEYS = [key for key, _ in PAGES]

CREATE, EDIT, DELETE = "create", "edit", "delete"
ACTIONS = (CREATE, EDIT, DELETE)

# Write rights each page offers. A page that isn't listed only shows data (view only).
PAGE_ACTIONS = {
    "categories": ACTIONS,
    "category_keywords": ACTIONS,
    "bai_codes": ACTIONS,
    "bank_accounts": ACTIONS,
    "bank_statements": ACTIONS,
    "transactions": ACTIONS,
    "journal_entries": ACTIONS,  # edit = change a manual entry; imported and posted ones are never edited
    "clients": ACTIONS,
    "suppliers": ACTIONS,
    "products": ACTIONS,
    "sales_invoices": ACTIONS,  # edit also covers posting and cancelling
    "purchase_bills": ACTIONS,
    "payments": ACTIONS,
    "bank_reconciliation": (EDIT,),  # matching and sign-off change existing items
    "period_close": (EDIT,),  # closing / reopening the books and the financial-year setting
    "user_management": ACTIONS,
}

METHOD_ACTIONS = {"POST": CREATE, "PUT": EDIT, "PATCH": EDIT, "DELETE": DELETE}

# Starter roles created on first run. Admin is fixed (full access); the others can be
# edited or deleted on the User Management page.
_ALL_BUT_USERS = [k for k in PAGE_KEYS if k != "user_management"]
DEFAULT_ROLES = [
    ("Admin", "Full access to every page, including User Management.", True, [], {}),
    ("Accountant", "Everything except User Management.", False, _ALL_BUT_USERS,
     {k: list(v) for k, v in PAGE_ACTIONS.items() if k != "user_management"}),
    ("Bookkeeper", "Day-to-day bookkeeping: statements, ledger, journals, invoices, bills, payments and reconciliation.",
     False,
     ["dashboard", "workflow", "menu_guide", "bank_statements", "statement_continuity", "transactions",
      "journal_entries", "clients", "suppliers", "products", "sales_invoices", "purchase_bills", "payments",
      "bank_reconciliation", "receivables_payables"],
     {k: list(PAGE_ACTIONS[k]) for k in ("bank_statements", "transactions", "journal_entries", "clients", "suppliers",
                                         "sales_invoices", "purchase_bills", "payments", "bank_reconciliation")}),
    ("Viewer", "Dashboard and financial reports only.", False,
     ["dashboard", "menu_guide", "profit_and_loss", "balance_sheet", "cash_flow", "trial_balance", "account_ledger",
      "reports_comparison", "receivables_payables"], {}),
]


def is_admin(user: User) -> bool:
    """Superusers and users whose role has full access."""
    if user.is_superuser:
        return True
    return bool(user.role and user.role.is_admin)


def user_pages(user: User) -> list[str]:
    """Page keys the user may open, in sidebar order."""
    if is_admin(user):
        return list(PAGE_KEYS)
    allowed = set(user.role.pages or []) if user.role else set()
    return [key for key in PAGE_KEYS if key in allowed]


def clean_actions(actions, pages) -> dict:
    """Role.actions reduced to what can apply: pages the role opens, rights the page offers."""
    actions = actions if isinstance(actions, dict) else {}
    cleaned = {}
    for page in PAGE_KEYS:
        granted = actions.get(page)
        if page in (pages or []) and isinstance(granted, (list, tuple)):
            kept = [a for a in PAGE_ACTIONS.get(page, ()) if a in granted]
            if kept:
                cleaned[page] = kept
    return cleaned


def user_actions(user: User) -> dict:
    """{page key: [write rights]} for the pages the user may change."""
    if is_admin(user):
        return {page: list(actions) for page, actions in PAGE_ACTIONS.items()}
    role: Optional[Role] = user.role
    return clean_actions(role.actions, role.pages) if role else {}


def role_actions(role: Role) -> dict:
    if role.is_admin:
        return {page: list(actions) for page, actions in PAGE_ACTIONS.items()}
    return role.actions or {}
