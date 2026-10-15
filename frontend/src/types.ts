export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'

export interface Paginated<T> {
  count: number
  next: number | null
  previous: number | null
  results: T[]
}

export interface SubCategory {
  id: number
  category: number
  category_name?: string
  code?: string | null
  name: string
  description?: string | null
  is_active?: boolean
}

export interface Category {
  id: number
  code?: string | null
  name: string
  account_type: AccountType
  description?: string | null
  is_active?: boolean
  subcategories: SubCategory[]
}

export interface BaiCode {
  id: number
  code: string
  description: string
  category: number | null
  category_name?: string | null
  sub_category: number | null
  sub_category_name?: string | null
}

export interface CategoryKeyword {
  id: number
  keyword: string
  sub_category: number
  sub_category_name?: string
  category?: number
  category_name?: string
  account_type?: AccountType
  priority?: number
  auto_assign?: boolean
  auto_created?: boolean
  is_active?: boolean
}

export interface CategorizationSettings {
  auto_assign_min_score: number
  auto_assign_min_gap: number
  review_min_score: number
  transfer_date_window_days: number
  fuzzy_match_min_ratio: number
}

export interface BankAccount {
  id: number
  name: string
  bank_name?: string | null
  account_number?: string | null
  is_active?: boolean
  /** Chart of Accounts sub-category this bank account is booked to - needed for bank reconciliation. */
  gl_account?: number | null
  gl_account_name?: string | null
  gl_account_category_name?: string | null
}

export type ContinuityIssue = 'OVERLAP' | 'MISSING_PERIOD' | 'BALANCE_GAP' | 'INTERNAL_MISMATCH'

/** A continuity problem found when uploading a statement (409 requires_continuity_confirmation):
 * with this statement itself, or with the statement after it. */
export interface ContinuityProblem {
  position: 'this' | 'next'
  file: string
  issue: ContinuityIssue
  message: string
}

export interface StatementContinuityStatus {
  start_date: string | null
  end_date: string | null
  is_continuous: boolean
  issues: ContinuityIssue[]
  primary_issue: ContinuityIssue | null
  balance_gap: number | null
  date_gap_days: number
  overlap_days: number
  missing_from: string | null
  missing_to: string | null
  is_internal_balanced: boolean
  internal_discrepancy: number | null
  gap_message: string | null
  has_previous: boolean
  previous_statement_id: number | null
  previous_closing_balance: number | null
}

export type ContinuityAccountStatus = 'issues' | 'continuous' | 'empty'

export type ContinuityPeriod =
  | 'this_quarter' | 'last_quarter' | 'this_year' | 'this_fiscal_year' | 'last_fiscal_year' | 'all_time' | 'custom'

/** Statement date window - the backend defaults to this_fiscal_year; date_from / date_to only with 'custom'. */
export interface ContinuityPeriodFilter {
  period?: ContinuityPeriod
  date_from?: string
  date_to?: string
}

export interface ContinuityFilters extends ContinuityPeriodFilter {
  search?: string
  bank_name?: string
  status?: ContinuityAccountStatus
  issue?: ContinuityIssue
}

/** Summary block of GET /continuity/page/ */
export interface ContinuitySummary {
  total_accounts: number
  accounts_with_statements: number
  accounts_continuous: number
  accounts_with_issues: number
  accounts_without_statements: number
  total_statements: number
  statements_with_issues: number
  issue_counts: Record<ContinuityIssue, number>
  total_missing_days: number
  unaccounted_balance: number
}

/** Bank filter option (GET /continuity/page/?include_banks=1) */
export interface ContinuityBank {
  bank_name: string
  account_count: number
}

/** One account row of GET /continuity/page/ - header info only, no statements. */
export interface ContinuityAccountRow {
  account_id: number
  account_name: string
  bank_name: string | null
  status: ContinuityAccountStatus
  total_statements: number
  continuous_count: number
  gap_count: number
  issue_counts: Record<ContinuityIssue, number>
  total_missing_days: number
  total_balance_gaps: number
  coverage_start: string | null
  coverage_end: string | null
  latest_closing_balance: number | null
  /** End of the account's newest statement (regardless of the period filter). */
  latest_end_date: string | null
}

/** GET /continuity/accounts/<id>/statements/ */
export interface ContinuityStatementRow {
  id: number
  file: string
  uploaded_at: string
  opening_balance: number | null
  closing_balance: number | null
  continuity: StatementContinuityStatus
}

/** GET /continuity/page/ - the whole Statement Continuity page in one request. */
export interface ContinuityPage extends Paginated<ContinuityAccountRow> {
  summary: ContinuitySummary
  /** Timelines of this page's accounts with issues (the cards that open expanded), by account id. */
  statements: Record<string, ContinuityStatementRow[]>
  /** Only when requested with include_banks=1. */
  banks?: ContinuityBank[]
}

export interface BankStatement {
  id: number
  account: number
  account_name?: string
  file: string
  source_type: 'PDF' | 'EXCEL' | 'CSV'
  opening_balance: number | string | null
  closing_balance: number | string | null
  uploaded_at: string
  transaction_count?: number
  duplicate_count?: number
  continuity_status?: StatementContinuityStatus | null
  progress?: StatementProgress
  /** The bank account has a GL account - without one nothing can be reconciled yet. */
  gl_linked?: boolean
}

/** Per-statement categorization progress, returned inline by the bank statement list. */
export interface StatementProgress {
  total: number
  categorized: number
  uncategorized: number
  confirmed: number
  final: number
  /** Matched to journal line(s) in bank reconciliation. */
  reconciled: number
  unreconciled: number
}

export type CategorizationSource = 'TRANSFER' | 'USER_RULE' | 'HISTORY_EXACT' | 'SCORING' | 'MANUAL'
export type TransactionStatus = 'AUTO_ASSIGNED' | 'MANUAL' | 'NEEDS_REVIEW' | 'UNCATEGORIZED' | 'TRANSFER'

export interface Transaction {
  id: number
  statement: number
  account?: number
  account_name?: string
  date: string
  description: string
  clean_description?: string
  bai_code?: string
  bai_code_description?: string | null
  debit: number | string
  credit: number | string
  balance?: number | string | null
  category: number | null
  category_name?: string
  category_account_type?: AccountType
  sub_category: number | null
  sub_category_name?: string
  confirmed?: boolean
  confidence_score?: number | null
  score_breakdown?: Record<string, number> | null
  scoring_clues?: string
  categorization_source?: CategorizationSource | null
  status?: TransactionStatus | ''
  transfer_pair?: number | null
  transfer_pair_account_name?: string
  is_potential_duplicate?: boolean
  duplicate_of?: number | null
  duplicate_of_date?: string | null
  duplicate_of_description?: string | null
  duplicate_of_statement?: number | null
  /** Locked: no category change, confirm or delete until reopened. */
  is_final?: boolean
  finalized_at?: string | null
  /** Matched to journal line(s) in bank reconciliation. */
  is_reconciled?: boolean
  /** The journal entries it is matched to. */
  reconciled_with?: ReconciledJournalRef[]
}

export interface ReconciledJournalRef {
  entry: number
  entry_number: string
  entry_date: string
  narration: string
  amount: string
  method: 'AUTO' | 'MANUAL' | 'OPENING'
}

/** The bank statement transaction a journal line is matched to. */
export interface ReconciledBankRef {
  id: number
  date: string
  description: string
  amount: string
  statement: number
  bank_account_name: string
  method: 'AUTO' | 'MANUAL' | 'OPENING'
}

export interface ReportTransactionLine {
  id: number | null
  date: string | null
  description: string
  amount: number | string
}

export interface ProfitAndLossSubCategoryLine {
  sub_category_id: number | null
  sub_category_name: string
  amount: number | string
  transactions: ReportTransactionLine[]
}

export interface ProfitAndLossCategoryGroup {
  category_id: number
  category_name: string
  subcategories: ProfitAndLossSubCategoryLine[]
  total: number | string
}

export interface ProfitAndLossReport {
  period: 'this_month' | 'last_month' | 'this_quarter' | 'this_fiscal_year' | 'last_fiscal_year' | 'custom'
  date_from: string | null
  date_to: string | null
  income: { categories: ProfitAndLossCategoryGroup[]; total: number | string }
  expense: { categories: ProfitAndLossCategoryGroup[]; total: number | string }
  net_profit: number | string
  /** Headline numbers worked out by the backend (income / expenses as positive amounts). */
  summary: { total_income: number | string; total_expenses: number | string; net_profit: number | string; profit_margin: number | string }
  uncategorized_count: number
  uncategorized_net_amount: number | string
  duplicate_count: number
  duplicate_net_amount: number | string
}

export interface BalanceSheetReport {
  period: 'this_month' | 'last_month' | 'this_quarter' | 'this_fiscal_year' | 'last_fiscal_year' | 'custom'
  date_from: string | null
  date_to: string | null
  assets: { categories: ProfitAndLossCategoryGroup[]; total: number | string }
  liabilities: { categories: ProfitAndLossCategoryGroup[]; total: number | string }
  equity: { categories: ProfitAndLossCategoryGroup[]; total: number | string }
  retained_earnings: number | string
  total_equity: number | string
  total_assets: number | string
  total_liabilities_and_equity: number | string
  difference?: number | string
  is_balanced: boolean
  /** Current / Fixed Assets and Current / Long-term Liabilities, classified and totalled by the backend. */
  groups: Record<
    'current_assets' | 'fixed_assets' | 'current_liabilities' | 'long_term_liabilities',
    { category_ids: number[]; total: number | string }
  >
  uncategorized_count?: number
  uncategorized_net_amount?: number | string
}

export interface TrialBalanceItem {
  category_id: number
  category_name: string
  sub_category_id: number
  sub_category_name: string
  debit: number | string
  credit: number | string
}

export interface TrialBalanceReport {
  period: 'this_month' | 'last_month' | 'this_quarter' | 'this_fiscal_year' | 'last_fiscal_year' | 'custom'
  date_from: string | null
  date_to: string | null
  account_types: {
    ASSET: TrialBalanceItem[]
    LIABILITY: TrialBalanceItem[]
    EQUITY: TrialBalanceItem[]
    INCOME: TrialBalanceItem[]
    EXPENSE: TrialBalanceItem[]
  }
  total_debit: number | string
  total_credit: number | string
  /** Debit / credit subtotal per account type, worked out by the backend. */
  type_totals: Record<keyof TrialBalanceReport['account_types'], { debit: number | string; credit: number | string }>
  difference: number | string
  is_balanced: boolean
  uncategorized_count: number
  uncategorized_debit: number | string
  uncategorized_credit: number | string
}


/** Imports (EXCEL / JSON / API), keyed in by hand (MANUAL), or posted by an invoice, bill or payment. */
export type JournalSource = 'EXCEL' | 'JSON' | 'API' | 'MANUAL' | 'SALES_INVOICE' | 'PURCHASE_BILL' | 'PAYMENT' | 'BANK'
  | 'CREDIT_NOTE' | 'OPENING_BALANCE'

export interface JournalEntryLine {
  id: number
  sub_category: number
  sub_category_name: string
  category: number
  category_name: string
  account_type: string
  description: string
  debit: string
  credit: string
  /** true / false for a line on a bank account's GL account; null for other lines (nothing to reconcile). */
  reconciled: boolean | null
  /** Date of the bank transaction it was matched to. */
  reconciled_transaction_date: string | null
  /** Cleared by the bank statement's opening balance (the opening-balance entry), not a bank transaction. */
  reconciled_as_opening_balance: boolean
  reconciled_transaction: ReconciledBankRef | null
}

/** Over an entry's bank lines; null when it has none. */
export type JournalReconcileStatus = 'RECONCILED' | 'PARTIAL' | 'UNRECONCILED'

export interface JournalEntry {
  id: number
  entry_number: string
  date: string
  narration: string
  /** The import it arrived in; null for manual entries and entries posted from invoices, bills or payments. */
  batch: number | null
  source: JournalSource
  source_name: string
  /** MANUAL (editable here), SALES_INVOICE, PURCHASE_BILL or PAYMENT; null for imported entries. */
  origin: Exclude<JournalSource, 'EXCEL' | 'JSON' | 'API'> | null
  bank_account: number | null
  bank_account_name: string | null
  total_debit: string
  total_credit: string
  reconcile_status: JournalReconcileStatus | null
  lines: JournalEntryLine[]
  created_at: string
}

export interface JournalImportBatch {
  id: number
  source: JournalSource
  source_name: string
  bank_account: number | null
  bank_account_name: string | null
  imported_at: string
  entry_count: number
}

export type ReconMatchMethod = 'AUTO' | 'MANUAL'

/** A bank transaction's match - the journal line it pairs with. */
export interface ReconBankMatch {
  id: number
  journal_line: number
  entry: number
  entry_number: string
  entry_date: string
  narration: string
  debit: string
  credit: string
  method: ReconMatchMethod
  matched_at: string
}

export interface ReconBankTransaction {
  id: number
  statement: number
  date: string
  description: string
  debit: string
  credit: string
  balance: string | null
  sub_category: number | null
  is_potential_duplicate: boolean
  matches: ReconBankMatch[]
}

export interface ReconBookLine {
  id: number
  entry: number
  entry_number: string
  date: string
  narration: string
  description: string
  debit: string
  credit: string
  match: {
    id: number
    transaction: number
    transaction_date: string
    transaction_description: string
    method: ReconMatchMethod
    matched_at: string
  } | null
}

/** GET /reconciliation/summary/ - the bank reconciliation statement. Amounts arrive as decimal strings. */
export interface ReconciliationStatement {
  account: number
  account_name: string
  gl_account: number | null
  gl_account_name: string | null
  as_of: string
  bank_balance: string | null
  bank_balance_date: string | null
  deposits_in_transit: string
  outstanding_payments: string
  adjusted_bank_balance: string | null
  book_balance: string
  bank_deposits_not_in_books: string
  bank_withdrawals_not_in_books: string
  adjusted_book_balance: string
  difference: string | null
  is_reconciled: boolean
  /** Part of the difference from pairs matched within the amount tolerance but not equal (bank - books). */
  matched_difference: string
  /** How many matched bank transactions have a book total that differs from them. */
  matched_with_difference: number
  /** Opening balance of the account's first statement - money in the bank before any uploaded transaction. */
  opening_balance: string | null
  opening_balance_date: string | null
  /** True when the whole difference is that opening balance, i.e. the books have no opening-balance entry. */
  difference_is_opening_balance: boolean
  counts: { bank_transactions: number; bank_unmatched: number; book_lines: number; book_unmatched: number }
  /** Last day of the latest signed-off month: matches with both sides on or before it are locked. */
  locked_through: string | null
  /** Date an opening-balance entry gets (day before the first bank transaction). */
  opening_entry_date: string | null
  /** Entry number of the opening-balance entry once it exists. */
  opening_entry_number: string | null
  /** An imported entry that looks like the opening balance but isn't marked as cleared yet. */
  opening_candidate: { journal_line: number; entry_number: string; date: string } | null
  /** Present when the summary was asked for a date range (date_from). */
  period?: ReconciliationPeriodSummary | null
}

export interface ReconciliationSignOff {
  month: string
  period_start: string
  period_end: string
  bank_balance: string | null
  book_balance: string
  deposits_in_transit: string
  outstanding_payments: string
  reconciled_by: string | null
  reconciled_at: string
  note: string
}

export interface ReconciliationPeriodSummary {
  date_from: string
  date_to: string
  /** The range is exactly one calendar month - only then can it be signed off. */
  is_month: boolean
  bank_opening_balance: string | null
  bank_money_in: string
  bank_money_out: string
  bank_closing_balance: string | null
  book_debits: string
  book_credits: string
  bank_transactions: number
  bank_matched: number
  book_lines: number
  book_matched: number
  /** Open items dated before the period, still to clear. */
  carried_forward_bank: number
  carried_forward_book: number
  closed: ReconciliationSignOff | null
  /** Month ended, not signed off, every earlier month signed off. */
  can_close: boolean
  can_reopen: boolean
}

export interface ReconciliationMonth {
  month: string
  label: string
  bank: number
  bank_open: number
  book: number
  book_open: number
  closed: ReconciliationSignOff | null
  can_reopen: boolean
}

export interface ReconciliationStatementFile {
  id: number
  name: string
  date_from: string
  date_to: string
  transactions: number
  closing_balance: string | null
}

export interface ReconciliationPeriodsOverview {
  locked_through: string | null
  months: ReconciliationMonth[]
  statements: ReconciliationStatementFile[]
}
