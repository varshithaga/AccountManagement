import api from './client'
import { confirmParams } from '../utils/reconcileConfirm'
import type { FinalizeResult } from '../utils/finalizeMessage'
import type {
  Category, SubCategory, CategoryKeyword, BankAccount, BankStatement, Transaction, Paginated, AccountType,
  ProfitAndLossReport, BalanceSheetReport, TrialBalanceReport,
} from '../types'

export function extractResults<T>(data: unknown): T[] {
  if (!data) return []
  if (Array.isArray(data)) return data
  if (typeof data === 'object' && data !== null && 'results' in data && Array.isArray((data as { results: T[] }).results)) {
    return (data as { results: T[] }).results
  }
  return []
}

async function fetchAll<T>(url: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const results: T[] = []
  let page: number | string | null = 1
  while (page) {
    const { data } = await api.get(url, { params: { ...params, page } })
    if (Array.isArray(data)) return data
    if (data?.results && Array.isArray(data.results)) {
      results.push(...data.results)
      page = data.next || null
    } else {
      break
    }
  }
  return results
}

async function fetchPage<T>(url: string, params: Record<string, unknown> = {}): Promise<Paginated<T>> {
  const { data } = await api.get(url, { params })
  if (Array.isArray(data)) {
    return { count: data.length, next: null, previous: null, results: data }
  }
  return data
}

export const categoriesApi = {
  list: (): Promise<Category[]> => fetchAll('/categories/', { limit: 500 }),
  search: (params: { search?: string; account_type?: AccountType; is_active?: boolean; page?: number; limit?: number } = {}): Promise<Paginated<Category>> =>
    fetchPage('/categories/', params),
  create: (payload: Record<string, unknown>) => api.post('/categories/', payload).then((r) => r.data),
  update: (id: number, payload: Record<string, unknown>) => api.put(`/categories/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/categories/${id}/`),
}

export const subCategoriesApi = {
  list: (params: Record<string, unknown> = {}): Promise<SubCategory[]> => fetchAll('/subcategories/', { limit: 500, ...params }),
  search: (params: { search?: string; category?: number; is_active?: boolean; page?: number; limit?: number } = {}): Promise<Paginated<SubCategory>> =>
    fetchPage('/subcategories/', params),
  create: (payload: Record<string, unknown>) => api.post('/subcategories/', payload).then((r) => r.data),
  update: (id: number, payload: Record<string, unknown>) => api.put(`/subcategories/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/subcategories/${id}/`),
}

export const categoryKeywordsApi = {
  list: (params: Record<string, unknown> = {}): Promise<CategoryKeyword[]> => fetchAll('/category-keywords/', { limit: 500, ...params }),
  search: (params: { search?: string; sub_category?: number; category?: number; account_type?: AccountType; page?: number; limit?: number } = {}): Promise<Paginated<CategoryKeyword>> =>
    fetchPage('/category-keywords/', params),
  coaTree: (): Promise<any> => api.get('/category-keywords/coa-tree/').then((r) => r.data),
  create: (payload: Record<string, unknown>) => api.post('/category-keywords/', payload).then((r) => r.data),
  update: (id: number, payload: Record<string, unknown>) => api.put(`/category-keywords/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/category-keywords/${id}/`),
}

export const bankAccountsApi = {
  /** Every bank account (walks all pages) - for Excel import/export; dropdowns use BankAccountSelect. */
  list: (): Promise<BankAccount[]> => fetchAll('/bank-accounts/', { limit: 500 }),
  search: (params: { search?: string; page?: number; limit?: number } = {}): Promise<Paginated<BankAccount>> =>
    fetchPage('/bank-accounts/', params),
  create: (payload: Record<string, unknown>) => api.post('/bank-accounts/', payload).then((r) => r.data),
  update: (id: number, payload: Record<string, unknown>) => api.put(`/bank-accounts/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/bank-accounts/${id}/`),
}

export const bankStatementsApi = {
  list: (params: Record<string, unknown> = {}): Promise<BankStatement[]> => fetchAll('/bank-statements/', { limit: 20, ...params }),
  summary: (params: Record<string, unknown> = {}): Promise<{ total_imports: number; total_transactions: number; total_duplicates: number; unique_accounts: number }> =>
    api.get('/bank-statements/summary/', { params }).then((r) => r.data),
  search: (params: { search?: string; account?: number | string; source_type?: string; status?: string; ordering?: string; page?: number; limit?: number } = {}): Promise<Paginated<BankStatement>> =>
    fetchPage('/bank-statements/', { limit: 20, ...params }),
  get: (id: number | string): Promise<BankStatement> => api.get(`/bank-statements/${id}/`).then((r) => r.data),
  upload: (payload: { account: number; file: File; source_type: string }): Promise<BankStatement> => {
    const form = new FormData()
    form.append('account', String(payload.account))
    form.append('file', payload.file)
    form.append('source_type', payload.source_type)
    return api.post('/bank-statements/', form).then((r) => r.data)
  },
  categorize: (id: number | string): Promise<{ matched: number; unmatched: number }> =>
    api.post(`/bank-statements/${id}/categorize/`).then((r) => r.data),
  remove: (id: number | string, confirmUnmatch = false) =>
    api.delete(`/bank-statements/${id}/`, { params: confirmParams(confirmUnmatch) }),
  checkDuplicates: (): Promise<{ flagged: number }> =>
    api.post('/bank-statements/check-duplicates/').then((r) => r.data),
}

export const transactionsApi = {
  summary: (params: Record<string, unknown> = {}): Promise<{
    total_transactions: number; uncategorized_count: number; duplicates_count: number
    total_debits: number; total_credits: number; accounts_count: number
    by_source?: Record<string, number>
  }> => api.get('/transactions/summary/', { params }).then((r) => r.data),
  list: (params: Record<string, unknown> = {}): Promise<Transaction[]> => fetchAll('/transactions/', { limit: 500, ...params }),
  search: (params: {
    search?: string; statement?: number; account?: number; category?: number; sub_category?: number
    uncategorized?: boolean; is_potential_duplicate?: boolean; page?: number; limit?: number; ordering?: string
    period?: 'this_month' | 'next_month' | 'last_month' | 'this_quarter' | 'all_time' | 'custom'; date_from?: string; date_to?: string
    categorization_source?: string; confirmed?: boolean | string; status?: string
    /** 'true' = matched in bank reconciliation, 'false' = not matched yet. */
    reconciled?: 'true' | 'false'
  } = {}): Promise<Paginated<Transaction>> => fetchPage('/transactions/', params),
  create: (payload: Record<string, unknown>) => api.post('/transactions/', payload).then((r) => r.data),
  update: (id: number, payload: Record<string, unknown>) => api.patch(`/transactions/${id}/`, payload).then((r) => r.data),
  remove: (id: number, confirmUnmatch = false) =>
    api.delete(`/transactions/${id}/`, { params: confirmParams(confirmUnmatch) }),
  bulkUpdate: (ids: number[], category: number | null, sub_category: number | null): Promise<{ updated: number }> =>
    api.post('/transactions/bulk-update/', { ids, category, sub_category }).then((r) => r.data),
  bulkConfirm: (payload: { ids?: number[]; statement?: number }): Promise<{ confirmed: number }> =>
    api.post('/transactions/bulk-confirm/', payload).then((r) => r.data),
  confirm: (id: number): Promise<Transaction> =>
    api.post(`/transactions/${id}/confirm/`).then((r) => r.data),
  /** Lock transactions as final (only categorized ones / transfers are locked). */
  finalize: (payload: { ids?: number[]; statement?: number }): Promise<FinalizeResult> =>
    api.post('/transactions/finalize/', payload).then((r) => r.data),
  /** Remove the final lock. */
  reopen: (ids: number[]): Promise<{ reopened: number }> =>
    api.post('/transactions/reopen/', { ids }).then((r) => r.data),
  acceptSuggestion: (id: number): Promise<Transaction> =>
    api.post(`/transactions/${id}/accept-suggestion/`).then((r) => r.data),
  createRule: (id: number): Promise<unknown> =>
    api.post(`/transactions/${id}/create-rule/`).then((r) => r.data),
  detectTransfers: (): Promise<{ transfer_pairs_detected: number }> =>
    api.post('/transactions/detect-transfers/').then((r) => r.data),
  bulkDelete: (ids: number[], confirmUnmatch = false): Promise<{ deleted: number; skipped_final: number }> =>
    api.post('/transactions/bulk-delete/', { ids, ...confirmParams(confirmUnmatch) }).then((r) => r.data),
}

export const reportsApi = {
  profitAndLoss: (params: {
    period?: 'this_month' | 'last_month' | 'this_quarter' | 'this_fiscal_year' | 'last_fiscal_year' | 'custom'
    date_from?: string; date_to?: string; account?: number
  } = {}): Promise<ProfitAndLossReport> =>
    api.get('/reports/profit-and-loss/', { params }).then((r) => r.data),
  exportProfitAndLossUrl: (params: {
    period?: 'this_month' | 'last_month' | 'this_quarter' | 'this_fiscal_year' | 'last_fiscal_year' | 'custom'
    date_from?: string; date_to?: string; account?: number
  } = {}): string => {
    const query = new URLSearchParams()
    if (params.period) query.set('period', params.period)
    if (params.date_from) query.set('date_from', params.date_from)
    if (params.date_to) query.set('date_to', params.date_to)
    if (params.account) query.set('account', String(params.account))
    query.set('format', 'csv')
    return `/api/reports/profit-and-loss/?${query.toString()}`
  },
  balanceSheet: (params: {
    period?: 'this_month' | 'last_month' | 'this_quarter' | 'this_fiscal_year' | 'last_fiscal_year' | 'custom'
    date_from?: string; date_to?: string; account?: number
  } = {}): Promise<BalanceSheetReport> =>
    api.get('/reports/balance-sheet/', { params }).then((r) => r.data),
  exportBalanceSheetUrl: (params: {
    period?: 'this_month' | 'last_month' | 'this_quarter' | 'this_fiscal_year' | 'last_fiscal_year' | 'custom'
    date_from?: string; date_to?: string; account?: number
  } = {}): string => {
    const query = new URLSearchParams()
    if (params.period) query.set('period', params.period)
    if (params.date_from) query.set('date_from', params.date_from)
    if (params.date_to) query.set('date_to', params.date_to)
    if (params.account) query.set('account', String(params.account))
    query.set('format', 'csv')
    return `/api/reports/balance-sheet/?${query.toString()}`
  },
  trialBalance: (params: {
    period?: 'this_month' | 'last_month' | 'this_quarter' | 'this_fiscal_year' | 'last_fiscal_year' | 'custom'
    date_from?: string; date_to?: string; account?: number
  } = {}): Promise<TrialBalanceReport> =>
    api.get('/reports/trial-balance/', { params }).then((r) => r.data),
  exportTrialBalanceUrl: (params: {
    period?: 'this_month' | 'last_month' | 'this_quarter' | 'this_fiscal_year' | 'last_fiscal_year' | 'custom'
    date_from?: string; date_to?: string; account?: number
  } = {}): string => {
    const query = new URLSearchParams()
    if (params.period) query.set('period', params.period)
    if (params.date_from) query.set('date_from', params.date_from)
    if (params.date_to) query.set('date_to', params.date_to)
    if (params.account) query.set('account', String(params.account))
    query.set('format', 'csv')
    return `/api/reports/trial-balance/?${query.toString()}`
  },
}



export interface CategoryOption {
  id: number
  code?: string | null
  name: string
  account_type: AccountType
  account_type_label: string
}

export interface SubCategoryOption extends CategoryOption {
  category: number
  category_name: string
  category_code?: string | null
  /** The bank account using this sub-category as its GL account, if any. */
  linked_bank_account?: number | null
  linked_bank_account_name?: string | null
}

/** Paged (20 per page by default), server-searched options for category / sub-category dropdowns.
 * search also matches account types - "assets", "liab", "expenses", "revenue"... */
export const categoryLookupApi = {
  categories: (params: { search?: string; account_type?: AccountType; ids?: string; page?: number; limit?: number } = {}): Promise<Paginated<CategoryOption>> =>
    fetchPage('/lookups/categories/', params),
  /** gl_free_for: only sub-categories not already another bank account's GL account (0 = a bank not saved yet). */
  subCategories: (params: { search?: string; category?: number; account_type?: AccountType; ids?: string; gl_free_for?: number; page?: number; limit?: number } = {}): Promise<Paginated<SubCategoryOption>> =>
    fetchPage('/lookups/subcategories/', params),
}

export interface BankAccountOption {
  id: number
  name: string
  bank_name: string | null
  is_active: boolean
}

/** Paged (20 per page), server-searched bank accounts for filter / upload dropdowns. */
export const bankAccountLookupApi = {
  search: (params: { search?: string; ids?: string; page?: number; limit?: number } = {}): Promise<Paginated<BankAccountOption>> =>
    fetchPage('/lookups/bank-accounts/', params),
}

/** GET /workflow/status/ - live counts behind each Workflow step (all time). */
export interface WorkflowStatus {
  setup: {
    categories: number
    sub_categories: number
    keywords: number
    bai_codes: number
    bai_codes_mapped: number
    bank_accounts: number
  }
  statements: {
    total: number
    not_auto_categorized: number
    continuity_issues: number
    unaccounted_balance: number
  }
  transactions: {
    total: number
    needs_review: number
    uncategorized: number
    duplicates: number
    unconfirmed: number
    ready_to_finalize: number
    final: number
  }
}

export const workflowApi = {
  status: (): Promise<WorkflowStatus> => api.get('/workflow/status/').then((r) => r.data),
}
