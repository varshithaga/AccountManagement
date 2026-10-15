/** Every page a role can be given access to, grouped as in the sidebar.
 * The keys must match PAGES in backend/app/access.py - the backend is what
 * enforces access; here they hide menu items and guard routes. */

export type PageKey =
  | 'dashboard' | 'workflow' | 'menu_guide'
  | 'categories' | 'category_keywords' | 'bai_codes' | 'bank_accounts'
  | 'bank_statements' | 'statement_continuity' | 'transactions' | 'journal_entries' | 'bank_reconciliation'
  | 'period_close'
  | 'clients' | 'suppliers' | 'products' | 'sales_invoices' | 'purchase_bills' | 'payments' | 'receivables_payables'
  | 'profit_and_loss' | 'balance_sheet' | 'cash_flow' | 'trial_balance' | 'account_ledger' | 'reports_comparison'
  | 'user_management'

export interface PageDef {
  key: PageKey
  label: string
  path: string
}

export const PAGE_GROUPS: { title: string; pages: PageDef[] }[] = [
  {
    title: 'Overview',
    pages: [
      { key: 'dashboard', label: 'Dashboard', path: '/dashboard' },
      { key: 'workflow', label: 'Workflow', path: '/workflow' },
      { key: 'menu_guide', label: 'Menu Guide', path: '/menu-guide' },
    ],
  },
  {
    title: 'Masters',
    pages: [
      { key: 'categories', label: 'Chart of Accounts', path: '/categories' },
      { key: 'category_keywords', label: 'Auto-Categorization Rules', path: '/category-keywords' },
      { key: 'bai_codes', label: 'BAI Codes', path: '/bai-codes' },
      { key: 'bank_accounts', label: 'Bank Accounts', path: '/bank-accounts' },
    ],
  },
  {
    title: 'Operations & Bookkeeping',
    pages: [
      { key: 'bank_statements', label: 'Bank Statements', path: '/bank-statements' },
      { key: 'statement_continuity', label: 'Statement Continuity', path: '/bank-statements/continuity' },
      { key: 'transactions', label: 'General Ledger', path: '/transactions' },
      { key: 'journal_entries', label: 'Journal Entries', path: '/journal-entries' },
      { key: 'bank_reconciliation', label: 'Bank Reconciliation', path: '/bank-reconciliation' },
      { key: 'period_close', label: 'Period Close', path: '/period-close' },
    ],
  },
  {
    title: 'Sales & Purchases',
    pages: [
      { key: 'clients', label: 'Clients', path: '/clients' },
      { key: 'suppliers', label: 'Suppliers', path: '/suppliers' },
      { key: 'products', label: 'Products & Tax Rates', path: '/products' },
      { key: 'sales_invoices', label: 'Sales Invoices', path: '/sales-invoices' },
      { key: 'purchase_bills', label: 'Purchase Bills', path: '/purchase-bills' },
      { key: 'payments', label: 'Payments & Receipts', path: '/payments' },
      { key: 'receivables_payables', label: 'Receivables & Payables', path: '/receivables-payables' },
    ],
  },
  {
    title: 'Financial Statements & Insights',
    pages: [
      { key: 'profit_and_loss', label: 'Profit & Loss', path: '/profit-and-loss' },
      { key: 'balance_sheet', label: 'Balance Sheet', path: '/balance-sheet' },
      { key: 'cash_flow', label: 'Cash Flow Statement', path: '/cash-flow' },
      { key: 'trial_balance', label: 'Trial Balance', path: '/trial-balance' },
      { key: 'account_ledger', label: 'Account Ledger', path: '/account-ledger' },
      { key: 'reports_comparison', label: 'Period Comparison', path: '/reports/comparison' },
    ],
  },
  {
    title: 'Administration',
    pages: [
      { key: 'user_management', label: 'User Management', path: '/users' },
    ],
  },
]

export const ALL_PAGES: PageDef[] = PAGE_GROUPS.flatMap((g) => g.pages)

/** What a role may do on a page beyond opening it. Must match PAGE_ACTIONS in
 * backend/app/access.py. */
export type PageAction = 'create' | 'edit' | 'delete'

export const ALL_ACTIONS: PageAction[] = ['create', 'edit', 'delete']

export const ACTION_LABELS: Record<PageAction, string> = { create: 'Create', edit: 'Edit', delete: 'Delete' }

/** Rights each page offers. A page that isn't listed only shows data (view only). */
export const PAGE_ACTIONS: Partial<Record<PageKey, PageAction[]>> = {
  categories: ALL_ACTIONS,
  category_keywords: ALL_ACTIONS,
  bai_codes: ALL_ACTIONS,
  bank_accounts: ALL_ACTIONS,
  bank_statements: ALL_ACTIONS,
  transactions: ALL_ACTIONS,
  journal_entries: ['create', 'delete'], // entries are imported and deleted, never edited
  clients: ALL_ACTIONS,
  suppliers: ALL_ACTIONS,
  products: ALL_ACTIONS,
  sales_invoices: ALL_ACTIONS, // edit also covers posting and cancelling
  purchase_bills: ALL_ACTIONS,
  payments: ALL_ACTIONS,
  bank_reconciliation: ['edit'], // matching and sign-off change existing items
  period_close: ['edit'], // closing / reopening the books and the financial-year setting
  user_management: ALL_ACTIONS,
}

export type RoleActions = Partial<Record<PageKey, PageAction[]>>

/** Pages where creating or editing also lets the user add a missing category / sub-category
 * from a dropdown, without Chart of Accounts rights. */
export const INLINE_CATEGORY_PAGES: PageKey[] = ['transactions', 'bank_statements', 'journal_entries']
export const INLINE_SUB_CATEGORY_PAGES: PageKey[] = [
  'transactions', 'bank_statements', 'bank_accounts', 'bank_reconciliation', 'journal_entries',
]
