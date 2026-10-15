"""Request bodies. Updates use the same models with every field optional (PATCH semantics for
both PUT and PATCH): only the fields sent are changed (model_dump(exclude_unset=True))."""
from datetime import date
from decimal import Decimal
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .models import AccountType, DocumentStatus, ItemType, PaymentDirection, PaymentMethod

Money = Field(default=None, max_digits=14, decimal_places=2)


class Body(BaseModel):
    model_config = ConfigDict(extra="ignore")


def _strip_code(value):
    """Blank codes are stored as NULL so any number of records can leave the code empty."""
    if value is None:
        return None
    value = str(value).strip()
    return value or None


# ---------------------------------------------------------------------------
# Auth & users
# ---------------------------------------------------------------------------

class LoginIn(Body):
    username: str
    password: str


class RegisterIn(Body):
    username: Optional[str] = ""
    password: Optional[str] = ""
    email: Optional[str] = ""
    first_name: Optional[str] = ""
    last_name: Optional[str] = ""


class RefreshIn(Body):
    refresh: Optional[str] = None


class ProfileIn(Body):
    first_name: Optional[str] = Field(default=None, max_length=150)
    last_name: Optional[str] = Field(default=None, max_length=150)
    email: Optional[str] = Field(default=None, max_length=254)


class ChangePasswordIn(Body):
    current_password: Optional[str] = ""
    new_password: Optional[str] = ""


class ResetPasswordIn(Body):
    new_password: Optional[str] = ""


class RoleIn(Body):
    name: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = Field(default=None, max_length=255)
    pages: Optional[list[str]] = None
    actions: Optional[dict[str, list[str]]] = None


class UserIn(Body):
    username: Optional[str] = Field(default=None, max_length=150)
    first_name: Optional[str] = Field(default=None, max_length=150)
    last_name: Optional[str] = Field(default=None, max_length=150)
    email: Optional[str] = Field(default=None, max_length=254)
    is_active: Optional[bool] = None
    role: Optional[int] = None
    password: Optional[str] = None


# ---------------------------------------------------------------------------
# Masters
# ---------------------------------------------------------------------------

class CategoryIn(Body):
    code: Optional[str] = Field(default=None, max_length=20)
    name: Optional[str] = Field(default=None, max_length=150)
    account_type: Optional[AccountType] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

    _code = field_validator("code")(_strip_code)


class SubCategoryIn(Body):
    category: Optional[int] = None
    code: Optional[str] = Field(default=None, max_length=20)
    name: Optional[str] = Field(default=None, max_length=150)
    description: Optional[str] = None
    is_active: Optional[bool] = None

    _code = field_validator("code")(_strip_code)


class KeywordIn(Body):
    keyword: Optional[str] = Field(default=None, max_length=200)
    sub_category: Optional[int] = None
    is_active: Optional[bool] = None
    priority: Optional[int] = None
    auto_assign: Optional[bool] = None


class BaiCodeIn(Body):
    code: Optional[str] = Field(default=None, max_length=10)
    description: Optional[str] = Field(default=None, max_length=255)
    category: Optional[int] = None
    sub_category: Optional[int] = None


class BankAccountIn(Body):
    name: Optional[str] = Field(default=None, max_length=150)
    bank_name: Optional[str] = Field(default=None, max_length=150)
    account_number: Optional[str] = Field(default=None, max_length=50)
    is_active: Optional[bool] = None
    gl_account: Optional[int] = None


class RowsIn(Body):
    rows: Any = None


class CategorizationSettingsIn(Body):
    auto_assign_min_score: Optional[int] = Field(default=None, ge=0, le=32767)
    auto_assign_min_gap: Optional[int] = Field(default=None, ge=0, le=32767)
    review_min_score: Optional[int] = Field(default=None, ge=0, le=32767)
    transfer_date_window_days: Optional[int] = Field(default=None, ge=0, le=32767)
    fuzzy_match_min_ratio: Optional[int] = Field(default=None, ge=0, le=32767)


class ReconciliationSettingsIn(Body):
    date_window_days: Optional[int] = Field(default=None, ge=0, le=32767)
    amount_tolerance_percent: Optional[Decimal] = Field(default=None, ge=0, le=100, max_digits=5, decimal_places=2)


class AccountingSettingsIn(Body):
    fiscal_year_start_month: Optional[Any] = None
    default_receivable_account: Optional[int] = None
    default_payable_account: Optional[int] = None
    default_cash_account: Optional[int] = None
    company_name: Optional[str] = None
    company_gstin: Optional[str] = None
    company_state: Optional[str] = None
    company_address: Optional[str] = None
    company_email: Optional[str] = None
    company_phone: Optional[str] = None


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------

class TransactionIn(Body):
    statement: Optional[int] = None
    date: Optional[date] = None
    description: Optional[str] = Field(default=None, max_length=500)
    debit: Optional[Decimal] = Money
    credit: Optional[Decimal] = Money
    balance: Optional[Decimal] = Money
    category: Optional[int] = None
    sub_category: Optional[int] = None


class IdsIn(Body):
    ids: Any = None
    statement: Optional[int] = None
    category: Optional[int] = None
    sub_category: Optional[int] = None
    confirm_unmatch: Any = None


# ---------------------------------------------------------------------------
# Journal entries & reconciliation
# ---------------------------------------------------------------------------

class JournalImportIn(Body):
    source: Optional[str] = None
    source_name: Optional[str] = ""
    bank_account: Any = None
    dry_run: Any = False
    include_duplicates: Any = False
    entries: Any = None


class ManualLineIn(Body):
    sub_category_id: Optional[int] = None
    description: Optional[str] = ""
    debit: Any = None
    credit: Any = None


class ManualEntryIn(Body):
    """A manual double-entry voucher: entry_number is generated (JV-00001...) when left empty."""
    entry_number: Optional[str] = None
    date: Optional[str] = None
    narration: Optional[str] = ""
    lines: list[ManualLineIn] = []


class MonthScopeIn(Body):
    bank_account: Any = None
    month: Optional[str] = None
    include_ledger: Any = None
    confirm_unmatch: Any = None


class ReconAccountIn(Body):
    """Any reconciliation POST body - each endpoint reads the fields it needs."""
    account: Any = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    transaction: Any = None
    journal_lines: Any = None
    journal_line: Any = None
    transactions: Any = None
    equity_account: Any = None
    month: Optional[str] = None
    note: Optional[str] = ""


class PeriodCloseIn(Body):
    as_of: Optional[str] = None
    note: Optional[str] = ""


# ---------------------------------------------------------------------------
# Tax rates, products, clients, suppliers
# ---------------------------------------------------------------------------

class TaxRateIn(Body):
    name: Optional[str] = Field(default=None, max_length=100)
    rate: Optional[Decimal] = Field(default=None, ge=0, le=100, max_digits=5, decimal_places=2)
    is_active: Optional[bool] = None
    output_tax_account: Optional[int] = None
    input_tax_account: Optional[int] = None


class ProductIn(Body):
    code: Optional[str] = Field(default=None, max_length=50)
    name: Optional[str] = Field(default=None, max_length=200)
    item_type: Optional[ItemType] = None
    description: Optional[str] = None
    hsn_sac_code: Optional[str] = Field(default=None, max_length=20)
    unit: Optional[str] = Field(default=None, max_length=20)
    sale_price: Optional[Decimal] = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    purchase_price: Optional[Decimal] = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    tax_rate: Optional[int] = None
    income_account: Optional[int] = None
    expense_account: Optional[int] = None
    is_active: Optional[bool] = None

    _code = field_validator("code")(_strip_code)


class PartyIn(Body):
    code: Optional[str] = Field(default=None, max_length=20)
    name: Optional[str] = Field(default=None, max_length=200)
    contact_person: Optional[str] = Field(default=None, max_length=150)
    email: Optional[str] = Field(default=None, max_length=254)
    phone: Optional[str] = Field(default=None, max_length=30)
    gstin: Optional[str] = Field(default=None, max_length=15)
    pan: Optional[str] = Field(default=None, max_length=10)
    state: Optional[str] = Field(default=None, max_length=100)
    payment_terms_days: Optional[int] = Field(default=None, ge=0, le=3650)
    opening_balance: Optional[Decimal] = Money
    # The day the opening balance is booked on (default: today)
    opening_balance_date: Optional[date] = None
    is_active: Optional[bool] = None

    _code = field_validator("code")(_strip_code)
    _gstin = field_validator("gstin")(_strip_code)

    @field_validator("gstin")
    @classmethod
    def _gstin_format(cls, value):
        if value and len(value) != 15:
            raise ValueError("A GSTIN has 15 characters.")
        return value.upper() if value else value


class ClientIn(PartyIn):
    billing_address: Optional[str] = None
    shipping_address: Optional[str] = None
    receivable_account: Optional[int] = None


class SupplierIn(PartyIn):
    address: Optional[str] = None
    payable_account: Optional[int] = None


# ---------------------------------------------------------------------------
# Invoices, bills, payments
# ---------------------------------------------------------------------------

class ItemIn(Body):
    product_id: Optional[int] = None
    description: Optional[str] = Field(default=None, max_length=500)
    quantity: Optional[Decimal] = Field(default=None, gt=0, max_digits=12, decimal_places=3)
    unit_price: Optional[Decimal] = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    discount_percent: Optional[Decimal] = Field(default=None, ge=0, le=100, max_digits=5, decimal_places=2)
    tax_rate_id: Optional[int] = None
    account_id: Optional[int] = None


class SalesInvoiceIn(Body):
    invoice_number: Optional[str] = Field(default=None, max_length=50)
    client_id: Optional[int] = None
    invoice_date: Optional[date] = None
    due_date: Optional[date] = None
    notes: Optional[str] = None
    items: Optional[list[ItemIn]] = None
    post: bool = False


class PurchaseBillIn(Body):
    bill_number: Optional[str] = Field(default=None, max_length=50)
    supplier_id: Optional[int] = None
    bill_date: Optional[date] = None
    due_date: Optional[date] = None
    notes: Optional[str] = None
    items: Optional[list[ItemIn]] = None
    post: bool = False


class CreditNoteIn(Body):
    """A credit note (on a sales invoice) or debit note (on a purchase bill) - posted when created."""
    sales_invoice_id: Optional[int] = None
    purchase_bill_id: Optional[int] = None
    note_number: Optional[str] = Field(default=None, max_length=50)
    note_date: Optional[date] = None
    reason: Optional[str] = None
    items: list[ItemIn] = []


class AllocationIn(Body):
    sales_invoice_id: Optional[int] = None
    purchase_bill_id: Optional[int] = None
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)


class PaymentIn(Body):
    payment_number: Optional[str] = Field(default=None, max_length=50)
    direction: PaymentDirection
    client_id: Optional[int] = None
    supplier_id: Optional[int] = None
    payment_date: Optional[date] = None
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    method: PaymentMethod = PaymentMethod.BANK_TRANSFER
    bank_account_id: Optional[int] = None
    reference_number: Optional[str] = Field(default=None, max_length=100)
    notes: Optional[str] = None
    allocations: list[AllocationIn] = []


class PaymentUpdateIn(Body):
    reference_number: Optional[str] = Field(default=None, max_length=100)
    notes: Optional[str] = None


class AllocateIn(Body):
    allocations: list[AllocationIn]


class ConfirmIn(Body):
    confirm_unmatch: Any = None


DocumentStatusFilter = Optional[DocumentStatus]
DirectionFilter = Optional[Literal["RECEIPT", "PAYMENT"]]
