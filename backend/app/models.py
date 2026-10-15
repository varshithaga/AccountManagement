"""
SQLAlchemy 2.0 (typed, declarative) models for the FastAPI version of the
accounting app. Ported from backend_v2/app/models.py (Django).
"""
import enum
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

Money = Numeric(14, 2)


class IsoDate(TypeDecorator):
    """A DATE column that also accepts "YYYY-MM-DD" text in queries (e.g. date >= '2026-10-01').
    SQLite compares such text happily, but PostgreSQL refuses date-vs-text comparisons, so the
    text is turned into a real date before it is sent. Stored exactly like a plain Date."""
    impl = Date
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if isinstance(value, str):
            return date.fromisoformat(value.strip()[:10])
        if isinstance(value, datetime):
            return value.date()
        return value


class Base(DeclarativeBase):
    pass


def str_enum(enum_cls: type[enum.Enum]) -> Enum:
    """Store enums as plain VARCHAR values (not native DB enums) so adding a value needs no migration."""
    return Enum(enum_cls, native_enum=False, length=20, values_callable=lambda e: [m.value for m in e])


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class AccountType(str, enum.Enum):
    ASSET = "ASSET"
    LIABILITY = "LIABILITY"
    EQUITY = "EQUITY"
    INCOME = "INCOME"
    EXPENSE = "EXPENSE"


class StatementSourceType(str, enum.Enum):
    PDF = "PDF"
    EXCEL = "EXCEL"
    CSV = "CSV"


class CategorizationSource(str, enum.Enum):
    TRANSFER = "TRANSFER"          # Transfer between own bank accounts
    USER_RULE = "USER_RULE"        # User-defined rule
    HISTORY_EXACT = "HISTORY_EXACT"  # Exact match with a confirmed transaction's description
    SCORING = "SCORING"            # Scored against Chart of Accounts clues
    MANUAL = "MANUAL"              # Manually set by a user


class TransactionStatus(str, enum.Enum):
    AUTO_ASSIGNED = "AUTO_ASSIGNED"
    MANUAL = "MANUAL"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    UNCATEGORIZED = "UNCATEGORIZED"
    TRANSFER = "TRANSFER"


class JournalImportSource(str, enum.Enum):
    EXCEL = "EXCEL"
    JSON = "JSON"
    API = "API"


class MatchMethod(str, enum.Enum):
    AUTO = "AUTO"
    MANUAL = "MANUAL"
    OPENING = "OPENING"  # Opening-balance line, cleared by the first statement's opening balance


class ItemType(str, enum.Enum):
    PRODUCT = "PRODUCT"
    SERVICE = "SERVICE"


class DocumentStatus(str, enum.Enum):
    """Lifecycle of a sales invoice or purchase bill."""
    DRAFT = "DRAFT"                    # Editable, not yet posted to the journal
    POSTED = "POSTED"                  # Issued / recorded, nothing paid yet
    PARTIALLY_PAID = "PARTIALLY_PAID"
    PAID = "PAID"
    CANCELLED = "CANCELLED"


class Frequency(str, enum.Enum):
    """How often a recurring invoice is raised."""
    MONTHLY = "MONTHLY"
    QUARTERLY = "QUARTERLY"
    HALF_YEARLY = "HALF_YEARLY"
    YEARLY = "YEARLY"


class StockMovementKind(str, enum.Enum):
    OPENING = "OPENING"                  # stock on hand when tracking started
    PURCHASE = "PURCHASE"                # posted purchase bill (+)
    SALE = "SALE"                        # posted sales invoice (-)
    SALES_RETURN = "SALES_RETURN"        # credit note on an invoice (+)
    PURCHASE_RETURN = "PURCHASE_RETURN"  # debit note on a bill (-)
    ADJUSTMENT = "ADJUSTMENT"            # stock count, damage, samples... (+ or -)


class NoteKind(str, enum.Enum):
    SALES = "SALES"        # credit note to a client - reduces a sales invoice
    PURCHASE = "PURCHASE"  # debit note to a supplier - reduces a purchase bill


class PaymentDirection(str, enum.Enum):
    RECEIPT = "RECEIPT"  # Money received from a client
    PAYMENT = "PAYMENT"  # Money paid to a supplier


class PaymentMethod(str, enum.Enum):
    CASH = "CASH"
    BANK_TRANSFER = "BANK_TRANSFER"
    CHEQUE = "CHEQUE"
    UPI = "UPI"
    CARD = "CARD"


# ---------------------------------------------------------------------------
# Users & access
# ---------------------------------------------------------------------------

class Role(Base):
    """A named set of pages (sidebar menus) its users may open."""
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    description: Mapped[str] = mapped_column(String(255), default="")
    # Page keys this role may open
    pages: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Write rights per page: {page key: ["create", "edit", "delete"]}
    actions: Mapped[dict[str, list[str]]] = mapped_column(JSON, default=dict)
    # Full access to every page; the built-in Admin role cannot be edited or deleted
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)

    users: Mapped[list["User"]] = relationship(back_populates="role", passive_deletes="all")

    def __repr__(self) -> str:
        return f"<Role {self.name}>"


class User(Base):
    """
    Replaces Django's auth.User + UserProfile. A user without a role can sign in
    but has no page access until an administrator assigns one.
    """
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(254), default="")
    first_name: Mapped[str] = mapped_column(String(150), default="")
    last_name: Mapped[str] = mapped_column(String(150), default="")
    hashed_password: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False)
    date_joined: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    role_id: Mapped[Optional[int]] = mapped_column(ForeignKey("roles.id", ondelete="RESTRICT"))

    role: Mapped[Optional[Role]] = relationship(back_populates="users")

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    def __repr__(self) -> str:
        return f"<User {self.username}>"


class RevokedToken(Base):
    """Refresh tokens that were logged out or rotated - they can't be used again."""
    __tablename__ = "revoked_tokens"

    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


# ---------------------------------------------------------------------------
# Chart of Accounts
# ---------------------------------------------------------------------------

class Category(Base):
    """Top-level Chart of Accounts categories."""
    __tablename__ = "categories"
    __table_args__ = (
        UniqueConstraint("account_type", "name", name="unique_category_name_per_account_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[Optional[str]] = mapped_column(String(20), unique=True)  # e.g. 1000
    name: Mapped[str] = mapped_column(String(150))
    account_type: Mapped[AccountType] = mapped_column(str_enum(AccountType))
    description: Mapped[Optional[str]] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    subcategories: Mapped[list["SubCategory"]] = relationship(
        back_populates="category", passive_deletes="all", order_by="SubCategory.name"
    )

    def __repr__(self) -> str:
        return f"<Category {self.name}>"


class SubCategory(Base):
    """Second level of the Chart of Accounts (the postable account)."""
    __tablename__ = "sub_categories"
    __table_args__ = (
        UniqueConstraint("category_id", "name", name="unique_subcategory_name_per_category"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id", ondelete="RESTRICT"))
    code: Mapped[Optional[str]] = mapped_column(String(20), unique=True)  # e.g. 1010
    name: Mapped[str] = mapped_column(String(150))
    description: Mapped[Optional[str]] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    category: Mapped[Category] = relationship(back_populates="subcategories")
    keywords: Mapped[list["CategoryKeyword"]] = relationship(
        back_populates="sub_category", cascade="all, delete-orphan"
    )
    bank_account: Mapped[Optional["BankAccount"]] = relationship(back_populates="gl_account")

    def __repr__(self) -> str:
        return f"<SubCategory {self.name}>"


class CategoryKeyword(Base):
    """
    Text that, when found in a transaction's clean_description, points to a sub-category.
    - auto_assign=False: adds keyword points in Step 4 scoring.
    - auto_assign=True: assigns the sub-category directly and skips scoring (Step 2).
    """
    __tablename__ = "category_keywords"

    id: Mapped[int] = mapped_column(primary_key=True)
    keyword: Mapped[str] = mapped_column(String(200), unique=True)
    sub_category_id: Mapped[int] = mapped_column(ForeignKey("sub_categories.id", ondelete="CASCADE"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Higher priority wins; ties broken by the longer keyword
    priority: Mapped[int] = mapped_column(Integer, default=0)
    auto_assign: Mapped[bool] = mapped_column(Boolean, default=False)
    # True when auto-promoted from a history match rather than entered by a user
    auto_created: Mapped[bool] = mapped_column(Boolean, default=False)

    sub_category: Mapped[SubCategory] = relationship(back_populates="keywords")


class BaiCode(Base):
    """
    BAI transaction type codes, with an optional default Category / Sub-category
    the categorization engine falls back to when nothing else matches.
    """
    __tablename__ = "bai_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(10), unique=True)
    description: Mapped[str] = mapped_column(String(255))
    category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
    sub_category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sub_categories.id", ondelete="SET NULL"))

    category: Mapped[Optional[Category]] = relationship()
    sub_category: Mapped[Optional[SubCategory]] = relationship()


# ---------------------------------------------------------------------------
# Settings (singletons - always row id=1)
# ---------------------------------------------------------------------------

class CategorizationSettings(Base):
    """Tunables for the categorization engine."""
    __tablename__ = "categorization_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    auto_assign_min_score: Mapped[int] = mapped_column(SmallInteger, default=85)
    auto_assign_min_gap: Mapped[int] = mapped_column(SmallInteger, default=15)
    review_min_score: Mapped[int] = mapped_column(SmallInteger, default=50)
    transfer_date_window_days: Mapped[int] = mapped_column(SmallInteger, default=3)
    fuzzy_match_min_ratio: Mapped[int] = mapped_column(SmallInteger, default=85)


class ReconciliationSettings(Base):
    """Bank reconciliation auto-matching config."""
    __tablename__ = "reconciliation_settings"
    __table_args__ = (
        CheckConstraint("amount_tolerance_percent BETWEEN 0 AND 100", name="tolerance_percent_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    date_window_days: Mapped[int] = mapped_column(SmallInteger, default=5)
    amount_tolerance_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"))


class AccountingSettings(Base):
    """Company-wide accounting settings."""
    __tablename__ = "accounting_settings"
    __table_args__ = (
        CheckConstraint("fiscal_year_start_month BETWEEN 1 AND 12", name="fiscal_month_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    fiscal_year_start_month: Mapped[int] = mapped_column(SmallInteger, default=4)
    # Control accounts invoices, bills and cash payments post to when the client /
    # supplier / payment doesn't name its own. Empty = looked up by name
    # ("Accounts Receivable", "Accounts Payable", "Cash").
    default_receivable_account_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("sub_categories.id", ondelete="SET NULL")
    )
    default_payable_account_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("sub_categories.id", ondelete="SET NULL")
    )
    default_cash_account_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sub_categories.id", ondelete="SET NULL"))
    # The company itself - printed on invoices. company_state decides GST: a client / supplier
    # in the same state is charged CGST + SGST, one in another state IGST.
    company_name: Mapped[str] = mapped_column(String(200), default="", server_default="")
    company_gstin: Mapped[str] = mapped_column(String(15), default="", server_default="")
    company_state: Mapped[str] = mapped_column(String(100), default="", server_default="")
    company_address: Mapped[str] = mapped_column(Text, default="", server_default="")
    company_email: Mapped[str] = mapped_column(String(254), default="", server_default="")
    company_phone: Mapped[str] = mapped_column(String(30), default="", server_default="")


# ---------------------------------------------------------------------------
# Banking
# ---------------------------------------------------------------------------

class BankAccount(Base):
    """A bank account statements can be uploaded for."""
    __tablename__ = "bank_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), unique=True)
    bank_name: Mapped[Optional[str]] = mapped_column(String(150))
    account_number: Mapped[Optional[str]] = mapped_column(String(50))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # The COA account this bank account is booked to in journal entries
    gl_account_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("sub_categories.id", ondelete="SET NULL"), unique=True
    )

    gl_account: Mapped[Optional[SubCategory]] = relationship(back_populates="bank_account")
    statements: Mapped[list["BankStatement"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )
    reconciliation_periods: Mapped[list["ReconciliationPeriod"]] = relationship(
        back_populates="bank_account", cascade="all, delete-orphan"
    )


class BankStatement(Base):
    """A bank statement file uploaded for a bank account."""
    __tablename__ = "bank_statements"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("bank_accounts.id", ondelete="CASCADE"))
    file_path: Mapped[str] = mapped_column(String(500))  # e.g. bank_statements/2026/10/file.pdf
    source_type: Mapped[StatementSourceType] = mapped_column(str_enum(StatementSourceType))
    # Derived from the file's running balance column; null if the file didn't carry one
    opening_balance: Mapped[Optional[Decimal]] = mapped_column(Money)
    closing_balance: Mapped[Optional[Decimal]] = mapped_column(Money)
    # SHA-256 of the file bytes - detects the same file uploaded twice
    file_hash: Mapped[Optional[str]] = mapped_column(String(64), unique=True, index=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    account: Mapped[BankAccount] = relationship(back_populates="statements")
    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="statement", cascade="all, delete-orphan"
    )


class Transaction(Base):
    """A single transaction row extracted from a bank statement."""
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    statement_id: Mapped[int] = mapped_column(ForeignKey("bank_statements.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(IsoDate, index=True)
    # Raw description exactly as on the statement
    description: Mapped[str] = mapped_column(String(500))
    # Noise stripped + uppercased - what the engine matches against
    clean_description: Mapped[str] = mapped_column(String(500), default="")
    bai_code: Mapped[str] = mapped_column(String(10), default="")
    debit: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    credit: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    balance: Mapped[Optional[Decimal]] = mapped_column(Money)

    category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
    # Assigned (or, when NEEDS_REVIEW, suggested) COA account; final only once confirmed
    sub_category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sub_categories.id", ondelete="SET NULL"))
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    confidence_score: Mapped[Optional[int]] = mapped_column(SmallInteger)  # 0-100
    score_breakdown: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON)
    scoring_clues: Mapped[str] = mapped_column(String(255), default="")
    categorization_source: Mapped[Optional[CategorizationSource]] = mapped_column(str_enum(CategorizationSource))
    status: Mapped[Optional[TransactionStatus]] = mapped_column(str_enum(TransactionStatus))

    # Matching leg of a transfer on the other bank account (Step 1)
    transfer_pair_id: Mapped[Optional[int]] = mapped_column(ForeignKey("transactions.id", ondelete="SET NULL"))
    is_potential_duplicate: Mapped[bool] = mapped_column(Boolean, default=False)
    duplicate_of_id: Mapped[Optional[int]] = mapped_column(ForeignKey("transactions.id", ondelete="SET NULL"))
    # Locked by a human: can't be recategorized or deleted until reopened
    is_final: Mapped[bool] = mapped_column(Boolean, default=False)
    finalized_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    statement: Mapped[BankStatement] = relationship(back_populates="transactions")
    category: Mapped[Optional[Category]] = relationship()
    sub_category: Mapped[Optional[SubCategory]] = relationship()
    transfer_pair: Mapped[Optional["Transaction"]] = relationship(
        remote_side=[id], foreign_keys=[transfer_pair_id]
    )
    duplicate_of: Mapped[Optional["Transaction"]] = relationship(
        remote_side=[id], foreign_keys=[duplicate_of_id]
    )
    reconciliation_matches: Mapped[list["ReconciliationMatch"]] = relationship(
        back_populates="transaction", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# Journal
# ---------------------------------------------------------------------------

class JournalImportBatch(Base):
    """One import run of journal entries; deleting a batch undoes the import."""
    __tablename__ = "journal_import_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[JournalImportSource] = mapped_column(str_enum(JournalImportSource))
    # Uploaded file name, or the external system that pushed the entries
    source_name: Mapped[str] = mapped_column(String(255), default="")
    bank_account_id: Mapped[Optional[int]] = mapped_column(ForeignKey("bank_accounts.id", ondelete="SET NULL"))
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    bank_account: Mapped[Optional[BankAccount]] = relationship()
    entries: Mapped[list["JournalEntry"]] = relationship(back_populates="batch", cascade="all, delete-orphan")


class JournalEntry(Base):
    """A balanced double-entry voucher: total debits of its lines equal total credits."""
    __tablename__ = "journal_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Null for entries posted by the app itself (from an invoice, bill or payment)
    batch_id: Mapped[Optional[int]] = mapped_column(ForeignKey("journal_import_batches.id", ondelete="CASCADE"))
    # Voucher number from the source; unique so re-imports are skipped
    entry_number: Mapped[str] = mapped_column(String(100), unique=True)
    date: Mapped[date] = mapped_column(IsoDate, index=True)
    narration: Mapped[str] = mapped_column(String(500), default="")
    # SALES_INVOICE / PURCHASE_BILL / PAYMENT for entries the app posted; null for imported ones
    origin: Mapped[Optional[str]] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    batch: Mapped[Optional[JournalImportBatch]] = relationship(back_populates="entries")
    lines: Mapped[list["JournalEntryLine"]] = relationship(
        back_populates="entry", cascade="all, delete-orphan", order_by="JournalEntryLine.id"
    )


class JournalEntryLine(Base):
    """One debit or credit leg of a journal entry. Exactly one of debit / credit is non-zero."""
    __tablename__ = "journal_entry_lines"
    __table_args__ = (
        CheckConstraint(
            "(debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0)",
            name="journal_line_exactly_one_side",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("journal_entries.id", ondelete="CASCADE"), index=True)
    sub_category_id: Mapped[int] = mapped_column(ForeignKey("sub_categories.id", ondelete="RESTRICT"))
    description: Mapped[str] = mapped_column(String(500), default="")
    debit: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    credit: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))

    entry: Mapped[JournalEntry] = relationship(back_populates="lines")
    sub_category: Mapped[SubCategory] = relationship()
    reconciliation_match: Mapped[Optional["ReconciliationMatch"]] = relationship(
        back_populates="journal_line", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# Tax & products
# ---------------------------------------------------------------------------

class TaxRate(Base):
    """A GST rate, e.g. "GST 18%"."""
    __tablename__ = "tax_rates"
    __table_args__ = (
        CheckConstraint("rate BETWEEN 0 AND 100", name="tax_rate_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    rate: Mapped[Decimal] = mapped_column(Numeric(5, 2))  # percent, e.g. 18.00
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # GST collected on sales (liability) and GST paid on purchases (input credit)
    output_tax_account_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sub_categories.id", ondelete="SET NULL"))
    input_tax_account_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sub_categories.id", ondelete="SET NULL"))

    output_tax_account: Mapped[Optional[SubCategory]] = relationship(foreign_keys=[output_tax_account_id])
    input_tax_account: Mapped[Optional[SubCategory]] = relationship(foreign_keys=[input_tax_account_id])


class TdsSection(Base):
    """
    A TDS (tax deducted at source) section, e.g. 194C contractors 1% / 2%, 194J professional fees 10%.
    A purchase bill with a section keeps back rate% of its taxable value from the supplier and owes
    it to the government instead (credited to the section's account, usually "TDS Payable").
    """
    __tablename__ = "tds_sections"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20))                         # e.g. "194C"
    name: Mapped[str] = mapped_column(String(150), unique=True)           # e.g. "194C - Contractor (company)"
    rate: Mapped[Decimal] = mapped_column(Numeric(5, 2))                  # percent of the taxable value
    # Informational: the yearly / single-payment limit below which no TDS is due
    threshold: Mapped[Optional[Decimal]] = mapped_column(Money)
    account_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sub_categories.id", ondelete="SET NULL"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    account: Mapped[Optional[SubCategory]] = relationship()


class Product(Base):
    """A product or service that can be put on sales invoices and purchase bills."""
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[Optional[str]] = mapped_column(String(50), unique=True)  # SKU
    name: Mapped[str] = mapped_column(String(200), unique=True)
    item_type: Mapped[ItemType] = mapped_column(str_enum(ItemType), default=ItemType.PRODUCT)
    description: Mapped[str] = mapped_column(Text, default="")
    hsn_sac_code: Mapped[str] = mapped_column(String(20), default="")
    unit: Mapped[str] = mapped_column(String(20), default="Nos")  # Nos, Kg, Hrs, ...
    sale_price: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    purchase_price: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    tax_rate_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tax_rates.id", ondelete="SET NULL"))
    # Default COA accounts a sale / purchase of this item is booked to
    income_account_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sub_categories.id", ondelete="SET NULL"))
    expense_account_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sub_categories.id", ondelete="SET NULL"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Stock: posted invoices take it out, bills put it in (see StockMovement). Goods only.
    track_inventory: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    reorder_level: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 3))

    tax_rate: Mapped[Optional[TaxRate]] = relationship()
    income_account: Mapped[Optional[SubCategory]] = relationship(foreign_keys=[income_account_id])
    expense_account: Mapped[Optional[SubCategory]] = relationship(foreign_keys=[expense_account_id])


# ---------------------------------------------------------------------------
# Parties
# ---------------------------------------------------------------------------

class Client(Base):
    """A customer the business sells to."""
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[Optional[str]] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    contact_person: Mapped[str] = mapped_column(String(150), default="")
    email: Mapped[str] = mapped_column(String(254), default="")
    phone: Mapped[str] = mapped_column(String(30), default="")
    gstin: Mapped[Optional[str]] = mapped_column(String(15), unique=True)
    pan: Mapped[str] = mapped_column(String(10), default="")
    billing_address: Mapped[str] = mapped_column(Text, default="")
    shipping_address: Mapped[str] = mapped_column(Text, default="")
    state: Mapped[str] = mapped_column(String(100), default="")  # GST place of supply
    payment_terms_days: Mapped[int] = mapped_column(SmallInteger, default=30)
    # Amount the client owed when they were set up in the system
    opening_balance: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    # The day the opening balance is booked on (journal entry OB-C-<id> / OB-S-<id>); default: the day it was entered
    opening_balance_date: Mapped[Optional[date]] = mapped_column(IsoDate)
    # Accounts Receivable control account; falls back to the default one when empty
    receivable_account_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sub_categories.id", ondelete="SET NULL"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    receivable_account: Mapped[Optional[SubCategory]] = relationship()
    invoices: Mapped[list["SalesInvoice"]] = relationship(back_populates="client", passive_deletes="all")
    payments: Mapped[list["Payment"]] = relationship(back_populates="client", passive_deletes="all")


class Supplier(Base):
    """A vendor the business buys from."""
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[Optional[str]] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    contact_person: Mapped[str] = mapped_column(String(150), default="")
    email: Mapped[str] = mapped_column(String(254), default="")
    phone: Mapped[str] = mapped_column(String(30), default="")
    gstin: Mapped[Optional[str]] = mapped_column(String(15), unique=True)
    pan: Mapped[str] = mapped_column(String(10), default="")
    address: Mapped[str] = mapped_column(Text, default="")
    state: Mapped[str] = mapped_column(String(100), default="")
    payment_terms_days: Mapped[int] = mapped_column(SmallInteger, default=30)
    # Amount owed to the supplier when they were set up in the system
    opening_balance: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    # The day the opening balance is booked on (journal entry OB-C-<id> / OB-S-<id>); default: the day it was entered
    opening_balance_date: Mapped[Optional[date]] = mapped_column(IsoDate)
    # Accounts Payable control account; falls back to the default one when empty
    payable_account_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sub_categories.id", ondelete="SET NULL"))
    # TDS section new bills from this supplier start with
    tds_section_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tds_sections.id", ondelete="SET NULL"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    payable_account: Mapped[Optional[SubCategory]] = relationship()
    tds_section: Mapped[Optional[TdsSection]] = relationship()
    bills: Mapped[list["PurchaseBill"]] = relationship(back_populates="supplier", passive_deletes="all")
    payments: Mapped[list["Payment"]] = relationship(back_populates="supplier", passive_deletes="all")


# ---------------------------------------------------------------------------
# Sales invoices
# ---------------------------------------------------------------------------

class SalesInvoice(Base):
    """An invoice issued to a client. Posting it creates its journal entry."""
    __tablename__ = "sales_invoices"
    __table_args__ = (
        CheckConstraint("amount_paid >= 0 AND amount_credited >= 0 AND amount_paid + amount_credited <= total",
                        name="invoice_amount_paid_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="RESTRICT"), index=True)
    invoice_date: Mapped[date] = mapped_column(IsoDate, index=True)
    due_date: Mapped[date] = mapped_column(IsoDate)
    subtotal: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))    # sum of line amounts before tax
    tax_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))       # subtotal + tax_amount
    amount_paid: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))  # sum of its payment allocations
    # Reduced by posted credit notes
    amount_credited: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    status: Mapped[DocumentStatus] = mapped_column(str_enum(DocumentStatus), default=DocumentStatus.DRAFT)
    # GST: the party's state when the document was saved, and whether it is another state than
    # the company's (IGST) or the same one (CGST + SGST).
    place_of_supply: Mapped[str] = mapped_column(String(100), default="", server_default="")
    is_interstate: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    notes: Mapped[str] = mapped_column(Text, default="")
    journal_entry_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("journal_entries.id", ondelete="SET NULL"), unique=True
    )
    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Payment reminders sent (or marked sent) for this invoice
    reminder_count: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
    last_reminder_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # The recurring invoice that raised it, if any
    recurring_invoice_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("recurring_invoices.id", ondelete="SET NULL"), index=True
    )

    client: Mapped[Client] = relationship(back_populates="invoices")
    items: Mapped[list["SalesInvoiceItem"]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan", order_by="SalesInvoiceItem.id"
    )
    allocations: Mapped[list["PaymentAllocation"]] = relationship(back_populates="sales_invoice", passive_deletes="all")
    credit_notes: Mapped[list["CreditNote"]] = relationship(back_populates="sales_invoice", passive_deletes="all")
    journal_entry: Mapped[Optional[JournalEntry]] = relationship()
    created_by: Mapped[Optional[User]] = relationship()
    recurring_invoice: Mapped[Optional["RecurringInvoice"]] = relationship(foreign_keys="SalesInvoice.recurring_invoice_id")

    @hybrid_property
    def balance_due(self) -> Decimal:
        return self.total - self.amount_paid - (self.amount_credited or Decimal("0"))

    @balance_due.inplace.expression
    @classmethod
    def _balance_due_sql(cls):
        return cls.total - cls.amount_paid - cls.amount_credited


class SalesInvoiceItem(Base):
    """One line on a sales invoice."""
    __tablename__ = "sales_invoice_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="invoice_item_quantity_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("sales_invoices.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[Optional[int]] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"))
    description: Mapped[str] = mapped_column(String(500))
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("1"))
    unit_price: Mapped[Decimal] = mapped_column(Money)
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"))
    tax_rate_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tax_rates.id", ondelete="RESTRICT"))
    amount: Mapped[Decimal] = mapped_column(Money)                            # quantity x price - discount
    tax_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    cgst_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    sgst_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    igst_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    # Income account this line is credited to
    account_id: Mapped[int] = mapped_column(ForeignKey("sub_categories.id", ondelete="RESTRICT"))

    invoice: Mapped[SalesInvoice] = relationship(back_populates="items")
    product: Mapped[Optional[Product]] = relationship()
    tax_rate: Mapped[Optional[TaxRate]] = relationship()
    account: Mapped[SubCategory] = relationship()


# ---------------------------------------------------------------------------
# Purchase bills
# ---------------------------------------------------------------------------

class PurchaseBill(Base):
    """A bill received from a supplier. Posting it creates its journal entry."""
    __tablename__ = "purchase_bills"
    __table_args__ = (
        # Bill numbers are the supplier's own, so they're only unique per supplier
        UniqueConstraint("supplier_id", "bill_number", name="unique_bill_number_per_supplier"),
        CheckConstraint("amount_paid >= 0 AND amount_credited >= 0 AND tds_amount >= 0 "
                        "AND amount_paid + amount_credited + tds_amount <= total", name="bill_amount_paid_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    bill_number: Mapped[str] = mapped_column(String(50))
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id", ondelete="RESTRICT"), index=True)
    bill_date: Mapped[date] = mapped_column(IsoDate, index=True)
    due_date: Mapped[date] = mapped_column(IsoDate)
    subtotal: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    tax_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    amount_paid: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    # Reduced by posted debit notes
    amount_credited: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    status: Mapped[DocumentStatus] = mapped_column(str_enum(DocumentStatus), default=DocumentStatus.DRAFT)
    # GST: the party's state when the document was saved, and whether it is another state than
    # the company's (IGST) or the same one (CGST + SGST).
    place_of_supply: Mapped[str] = mapped_column(String(100), default="", server_default="")
    is_interstate: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    notes: Mapped[str] = mapped_column(Text, default="")
    # TDS kept back from the supplier: tds_rate% of the subtotal (taxable value), owed to the government
    tds_section_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tds_sections.id", ondelete="RESTRICT"))
    tds_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"), server_default="0")
    tds_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    file_path: Mapped[Optional[str]] = mapped_column(String(500))  # scanned copy of the bill
    journal_entry_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("journal_entries.id", ondelete="SET NULL"), unique=True
    )
    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    supplier: Mapped[Supplier] = relationship(back_populates="bills")
    items: Mapped[list["PurchaseBillItem"]] = relationship(
        back_populates="bill", cascade="all, delete-orphan", order_by="PurchaseBillItem.id"
    )
    allocations: Mapped[list["PaymentAllocation"]] = relationship(back_populates="purchase_bill", passive_deletes="all")
    credit_notes: Mapped[list["CreditNote"]] = relationship(back_populates="purchase_bill", passive_deletes="all")
    journal_entry: Mapped[Optional[JournalEntry]] = relationship()
    created_by: Mapped[Optional[User]] = relationship()
    tds_section: Mapped[Optional[TdsSection]] = relationship()

    @hybrid_property
    def balance_due(self) -> Decimal:
        """What is still to be paid to the supplier: the total less payments, debit notes and TDS kept back."""
        return self.total - self.amount_paid - (self.amount_credited or Decimal("0")) - (self.tds_amount or Decimal("0"))

    @balance_due.inplace.expression
    @classmethod
    def _balance_due_sql(cls):
        return cls.total - cls.amount_paid - cls.amount_credited - cls.tds_amount


class PurchaseBillItem(Base):
    """One line on a purchase bill."""
    __tablename__ = "purchase_bill_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="bill_item_quantity_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    bill_id: Mapped[int] = mapped_column(ForeignKey("purchase_bills.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[Optional[int]] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"))
    description: Mapped[str] = mapped_column(String(500))
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("1"))
    unit_price: Mapped[Decimal] = mapped_column(Money)
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"))
    tax_rate_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tax_rates.id", ondelete="RESTRICT"))
    amount: Mapped[Decimal] = mapped_column(Money)
    tax_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    cgst_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    sgst_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    igst_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    # Expense (or asset) account this line is debited to
    account_id: Mapped[int] = mapped_column(ForeignKey("sub_categories.id", ondelete="RESTRICT"))

    bill: Mapped[PurchaseBill] = relationship(back_populates="items")
    product: Mapped[Optional[Product]] = relationship()
    tax_rate: Mapped[Optional[TaxRate]] = relationship()
    account: Mapped[SubCategory] = relationship()


# ---------------------------------------------------------------------------
# Credit notes (sales) and debit notes (purchases)
# ---------------------------------------------------------------------------

class CreditNote(Base):
    """Reduces a posted sales invoice (credit note to the client) or purchase bill (debit note to the
    supplier) - for returns, discounts or corrections. Posted when created: its journal entry reverses
    the lines it covers. Cancelling it deletes that entry and gives the amount back to the document."""
    __tablename__ = "credit_notes"
    __table_args__ = (
        CheckConstraint(
            "(kind = 'SALES' AND sales_invoice_id IS NOT NULL AND purchase_bill_id IS NULL) OR "
            "(kind = 'PURCHASE' AND purchase_bill_id IS NOT NULL AND sales_invoice_id IS NULL)",
            name="credit_note_document_matches_kind",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    note_number: Mapped[str] = mapped_column(String(50), unique=True)  # CN-00001 / DN-00001
    kind: Mapped[NoteKind] = mapped_column(str_enum(NoteKind))
    sales_invoice_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sales_invoices.id", ondelete="RESTRICT"), index=True)
    purchase_bill_id: Mapped[Optional[int]] = mapped_column(ForeignKey("purchase_bills.id", ondelete="RESTRICT"), index=True)
    note_date: Mapped[date] = mapped_column(IsoDate, index=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    subtotal: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    tax_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    # POSTED or CANCELLED
    status: Mapped[DocumentStatus] = mapped_column(str_enum(DocumentStatus), default=DocumentStatus.POSTED)
    # GST: the party's state when the document was saved, and whether it is another state than
    # the company's (IGST) or the same one (CGST + SGST).
    place_of_supply: Mapped[str] = mapped_column(String(100), default="", server_default="")
    is_interstate: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    journal_entry_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("journal_entries.id", ondelete="SET NULL"), unique=True
    )
    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sales_invoice: Mapped[Optional["SalesInvoice"]] = relationship(back_populates="credit_notes")
    purchase_bill: Mapped[Optional["PurchaseBill"]] = relationship(back_populates="credit_notes")
    items: Mapped[list["CreditNoteItem"]] = relationship(
        back_populates="note", cascade="all, delete-orphan", order_by="CreditNoteItem.id"
    )
    journal_entry: Mapped[Optional[JournalEntry]] = relationship()
    created_by: Mapped[Optional[User]] = relationship()


class CreditNoteItem(Base):
    """One line of a credit / debit note - the same shape as an invoice or bill line."""
    __tablename__ = "credit_note_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="note_item_quantity_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("credit_notes.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[Optional[int]] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"))
    description: Mapped[str] = mapped_column(String(500))
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("1"))
    unit_price: Mapped[Decimal] = mapped_column(Money)
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"))
    tax_rate_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tax_rates.id", ondelete="RESTRICT"))
    amount: Mapped[Decimal] = mapped_column(Money)
    tax_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    cgst_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    sgst_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    igst_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    account_id: Mapped[int] = mapped_column(ForeignKey("sub_categories.id", ondelete="RESTRICT"))

    note: Mapped[CreditNote] = relationship(back_populates="items")
    product: Mapped[Optional[Product]] = relationship()
    tax_rate: Mapped[Optional[TaxRate]] = relationship()
    account: Mapped[SubCategory] = relationship()


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------

class Payment(Base):
    """
    Money received from a client (RECEIPT) or paid to a supplier (PAYMENT).
    Split across invoices / bills through PaymentAllocation; any amount not
    allocated stays as an advance on the party's account.
    """
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("amount > 0", name="payment_amount_positive"),
        CheckConstraint(
            "(direction = 'RECEIPT' AND client_id IS NOT NULL AND supplier_id IS NULL) OR "
            "(direction = 'PAYMENT' AND supplier_id IS NOT NULL AND client_id IS NULL)",
            name="payment_party_matches_direction",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    payment_number: Mapped[str] = mapped_column(String(50), unique=True)
    direction: Mapped[PaymentDirection] = mapped_column(str_enum(PaymentDirection))
    client_id: Mapped[Optional[int]] = mapped_column(ForeignKey("clients.id", ondelete="RESTRICT"), index=True)
    supplier_id: Mapped[Optional[int]] = mapped_column(ForeignKey("suppliers.id", ondelete="RESTRICT"), index=True)
    payment_date: Mapped[date] = mapped_column(IsoDate, index=True)
    amount: Mapped[Decimal] = mapped_column(Money)
    method: Mapped[PaymentMethod] = mapped_column(str_enum(PaymentMethod))
    # Empty for cash payments
    bank_account_id: Mapped[Optional[int]] = mapped_column(ForeignKey("bank_accounts.id", ondelete="RESTRICT"))
    reference_number: Mapped[str] = mapped_column(String(100), default="")  # cheque / UTR / UPI ref
    notes: Mapped[str] = mapped_column(Text, default="")
    journal_entry_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("journal_entries.id", ondelete="SET NULL"), unique=True
    )
    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    client: Mapped[Optional[Client]] = relationship(back_populates="payments")
    supplier: Mapped[Optional[Supplier]] = relationship(back_populates="payments")
    bank_account: Mapped[Optional[BankAccount]] = relationship()
    allocations: Mapped[list["PaymentAllocation"]] = relationship(
        back_populates="payment", cascade="all, delete-orphan"
    )
    journal_entry: Mapped[Optional[JournalEntry]] = relationship()
    created_by: Mapped[Optional[User]] = relationship()


class PaymentAllocation(Base):
    """
    The part of a payment applied to one invoice (for a receipt) or one bill
    (for a supplier payment). The allocations of a payment never add up to more
    than its amount.
    """
    __tablename__ = "payment_allocations"
    __table_args__ = (
        CheckConstraint("amount > 0", name="allocation_amount_positive"),
        CheckConstraint(
            "(sales_invoice_id IS NOT NULL AND purchase_bill_id IS NULL) OR "
            "(sales_invoice_id IS NULL AND purchase_bill_id IS NOT NULL)",
            name="allocation_exactly_one_document",
        ),
        UniqueConstraint("payment_id", "sales_invoice_id", name="unique_allocation_per_invoice"),
        UniqueConstraint("payment_id", "purchase_bill_id", name="unique_allocation_per_bill"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    payment_id: Mapped[int] = mapped_column(ForeignKey("payments.id", ondelete="CASCADE"), index=True)
    sales_invoice_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("sales_invoices.id", ondelete="RESTRICT"), index=True
    )
    purchase_bill_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("purchase_bills.id", ondelete="RESTRICT"), index=True
    )
    amount: Mapped[Decimal] = mapped_column(Money)

    payment: Mapped[Payment] = relationship(back_populates="allocations")
    sales_invoice: Mapped[Optional[SalesInvoice]] = relationship(back_populates="allocations")
    purchase_bill: Mapped[Optional[PurchaseBill]] = relationship(back_populates="allocations")


# ---------------------------------------------------------------------------
# Reconciliation & period close
# ---------------------------------------------------------------------------

class ReconciliationMatch(Base):
    """
    Pairs a bank transaction with a journal line on that bank account's GL account.
    A journal line is matched at most once; a transaction can match several lines.
    """
    __tablename__ = "reconciliation_matches"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Empty only for an opening-balance line
    transaction_id: Mapped[Optional[int]] = mapped_column(ForeignKey("transactions.id", ondelete="CASCADE"))
    journal_line_id: Mapped[int] = mapped_column(
        ForeignKey("journal_entry_lines.id", ondelete="CASCADE"), unique=True
    )
    method: Mapped[MatchMethod] = mapped_column(str_enum(MatchMethod))
    matched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    transaction: Mapped[Optional[Transaction]] = relationship(back_populates="reconciliation_matches")
    journal_line: Mapped[JournalEntryLine] = relationship(back_populates="reconciliation_match")


class ReconciliationPeriod(Base):
    """
    A month signed off as reconciled for a bank account. Months close in order;
    only the latest closed month can be reopened (by deleting this row).
    """
    __tablename__ = "reconciliation_periods"
    __table_args__ = (
        UniqueConstraint("bank_account_id", "period_start", name="unique_reconciliation_period"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    bank_account_id: Mapped[int] = mapped_column(ForeignKey("bank_accounts.id", ondelete="CASCADE"))
    period_start: Mapped[date] = mapped_column(IsoDate)  # first day of the month
    period_end: Mapped[date] = mapped_column(IsoDate)    # last day of the month
    bank_balance: Mapped[Optional[Decimal]] = mapped_column(Money)
    book_balance: Mapped[Decimal] = mapped_column(Money)
    deposits_in_transit: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    outstanding_payments: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    reconciled_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reconciled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    note: Mapped[str] = mapped_column(String(500), default="")

    bank_account: Mapped[BankAccount] = relationship(back_populates="reconciliation_periods")
    reconciled_by: Mapped[Optional[User]] = relationship()


class BookClosing(Base):
    """
    Books closed through a date: nothing dated on or before closed_through can be
    added, changed or deleted. The latest row is in force; reopening deletes it.
    """
    __tablename__ = "book_closings"

    id: Mapped[int] = mapped_column(primary_key=True)
    closed_through: Mapped[date] = mapped_column(IsoDate, unique=True)
    closed_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    note: Mapped[str] = mapped_column(String(500), default="")

    closed_by: Mapped[Optional[User]] = relationship()


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

class AuditLog(Base):
    """
    Who changed what, and when. Written automatically for the business records (invoices, bills,
    payments, journal entries, chart of accounts, users, settings, ...) whenever they are
    created, changed or deleted, plus sign-ins and bulk actions. Never edited.
    """
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    username: Mapped[str] = mapped_column(String(150), default="")  # kept when the user is deleted
    action: Mapped[str] = mapped_column(String(20), index=True)      # CREATE, UPDATE, DELETE, POST, CANCEL, LOGIN, ...
    entity: Mapped[str] = mapped_column(String(50), index=True)      # e.g. "SalesInvoice"
    entity_id: Mapped[Optional[int]] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(String(200), default="")      # e.g. "INV-00012"
    # UPDATE: {field: [old, new]}; CREATE / DELETE: the record's fields; others: free-form
    changes: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON)

    user: Mapped[Optional[User]] = relationship()


# ---------------------------------------------------------------------------
# Document numbering
# ---------------------------------------------------------------------------

class NumberSequence(Base):
    """The last number handed out per prefix (INV, RCPT, PAY, CN, DN, JV). The row is locked while a
    number is taken, so two documents saved at the same moment never get the same number."""
    __tablename__ = "number_sequences"

    prefix: Mapped[str] = mapped_column(String(20), primary_key=True)
    last_value: Mapped[int] = mapped_column(Integer, default=0)


# ---------------------------------------------------------------------------
# Recurring invoices
# ---------------------------------------------------------------------------

class RecurringInvoice(Base):
    """
    A template that raises a sales invoice every month / quarter / half-year / year on the same
    day, from next_date until end_date (if any). The invoices are created as drafts - or posted
    straight away with auto_post - by the background check, the "Create due invoices" button or
    `python cli.py run-recurring`.
    """
    __tablename__ = "recurring_invoices"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))                       # e.g. "Office rent - Acme"
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="RESTRICT"), index=True)
    frequency: Mapped[Frequency] = mapped_column(str_enum(Frequency), default=Frequency.MONTHLY)
    start_date: Mapped[date] = mapped_column(IsoDate)
    next_date: Mapped[date] = mapped_column(IsoDate, index=True)         # the next invoice's date
    end_date: Mapped[Optional[date]] = mapped_column(IsoDate)
    # Line items in the shape of the invoice API's "items" (product_id, description, quantity, ...)
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
    auto_post: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    invoices_created: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str] = mapped_column(Text, default="")             # why the last run failed, if it did
    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    client: Mapped[Client] = relationship()
    created_by: Mapped[Optional[User]] = relationship()


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------

class StockMovement(Base):
    """
    One change in the stock of a tracked product: + for stock coming in, - for stock going out.
    Posting an invoice / bill / note creates its movements; cancelling it removes them.
    Stock on hand = the sum of a product's movements.
    """
    __tablename__ = "stock_movements"
    __table_args__ = (CheckConstraint("quantity <> 0", name="stock_movement_nonzero"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(IsoDate, index=True)
    kind: Mapped[StockMovementKind] = mapped_column(str_enum(StockMovementKind))
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3))
    # Cost per unit for stock coming in (purchases, opening, adjustments) - used for the average cost
    unit_cost: Mapped[Optional[Decimal]] = mapped_column(Money)
    sales_invoice_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sales_invoices.id", ondelete="CASCADE"), index=True)
    purchase_bill_id: Mapped[Optional[int]] = mapped_column(ForeignKey("purchase_bills.id", ondelete="CASCADE"), index=True)
    credit_note_id: Mapped[Optional[int]] = mapped_column(ForeignKey("credit_notes.id", ondelete="CASCADE"), index=True)
    note: Mapped[str] = mapped_column(String(500), default="")
    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    product: Mapped[Product] = relationship()
    created_by: Mapped[Optional[User]] = relationship()


# ---------------------------------------------------------------------------
# Companies
# ---------------------------------------------------------------------------

class Company(Base):
    """
    The companies of this installation - each one's books live in a database of its own, so they are
    completely separate (users, accounts, invoices, everything). Kept only in the main database
    (DATABASE_URL), which is itself the company with key "default". Added with `python cli.py
    create-company`.
    """
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(40), unique=True)       # e.g. "acme" - sent as the X-Company header
    name: Mapped[str] = mapped_column(String(200))
    database_url: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
