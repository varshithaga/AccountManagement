import axios from 'axios'
import { getAuthHeaders, createApiUrl } from '../../access/access'
import type {
  BankAccount, Paginated, ReconBankTransaction, ReconBookLine, ReconciliationPeriodsOverview, ReconciliationStatement,
} from '../../types'

export type ReconStatus = 'unmatched' | 'matched' | 'all'

export interface ReconListParams {
  account: number
  status?: ReconStatus
  date_from?: string
  date_to?: string
  search?: string
  page?: number
  limit?: number
}

export interface ReconciliationSettings {
  date_window_days: number
  /** Decimal string, e.g. "2.50" - how far (percent of the bank amount) matched amounts may differ. */
  amount_tolerance_percent: string
}

/** Start matching from a bank transaction or from a journal line. */
export type MatchTarget = { kind: 'transaction' | 'journal_line'; id: number }

export interface MatchCandidate {
  /** Set when the candidate is a bank transaction. */
  transaction?: number
  statement?: number
  is_potential_duplicate?: boolean
  /** Set when the candidate is a journal line. */
  journal_line?: number
  entry?: number
  entry_number?: string
  date: string
  description: string
  account: number
  account_name: string
  amount: string
  /** Candidate amount minus the source amount. */
  difference: string
  days_apart: number
}

export interface MatchCandidates {
  tolerance_percent: string
  source: {
    transaction?: number
    journal_line?: number
    entry_number?: string
    date: string
    description: string
    /** W = withdrawal / book credit, D = deposit / book debit. */
    side: 'W' | 'D'
    amount: string
    account_name: string
    allowed_difference?: string
  }
  candidates: MatchCandidate[]
  total: number
}

const cleanParams = (params: object) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null))

export const bankReconciliationApi = {
  /** Reconciliation statement at dateTo; with dateFrom also the period's movements and sign-off state. */
  summary: async (account: number, dateTo: string, dateFrom?: string): Promise<ReconciliationStatement> => {
    const response = await axios.get(createApiUrl('/reconciliation/summary/'), {
      headers: await getAuthHeaders(),
      params: cleanParams({ account, date_to: dateTo, date_from: dateFrom }),
    })
    return response.data
  },

  /** Months with items (newest first) and their sign-off, plus the uploaded statements' date ranges. */
  periods: async (account: number): Promise<ReconciliationPeriodsOverview> => {
    const response = await axios.get(createApiUrl('/reconciliation/periods/'), {
      headers: await getAuthHeaders(),
      params: { account },
    })
    return response.data
  },

  /** Books the first statement's opening balance: Dr the bank's GL account / Cr equityAccount. */
  createOpeningBalance: async (account: number, equityAccount: number): Promise<{ created: number }> => {
    const response = await axios.post(createApiUrl('/reconciliation/opening-balance/'),
      { account, equity_account: equityAccount }, { headers: await getAuthHeaders() })
    return response.data
  },

  /** Marks an already-imported journal line as the opening balance (cleared by the statement's opening balance). */
  markOpeningLine: async (account: number, journalLine: number): Promise<{ entry_number: string }> => {
    const response = await axios.post(createApiUrl('/reconciliation/opening-balance/'),
      { account, journal_line: journalLine }, { headers: await getAuthHeaders() })
    return response.data
  },

  closeMonth: async (account: number, month: string, note = ''): Promise<ReconciliationPeriodsOverview> => {
    const response = await axios.post(createApiUrl('/reconciliation/periods/close/'), { account, month, note },
      { headers: await getAuthHeaders() })
    return response.data
  },

  reopenMonth: async (account: number, month: string): Promise<ReconciliationPeriodsOverview> => {
    const response = await axios.post(createApiUrl('/reconciliation/periods/reopen/'), { account, month },
      { headers: await getAuthHeaders() })
    return response.data
  },

  bankTransactions: async (params: ReconListParams): Promise<Paginated<ReconBankTransaction>> => {
    const response = await axios.get(createApiUrl('/reconciliation/bank-transactions/'), {
      headers: await getAuthHeaders(),
      params: cleanParams(params),
    })
    return response.data
  },

  bookLines: async (params: ReconListParams): Promise<Paginated<ReconBookLine>> => {
    const response = await axios.get(createApiUrl('/reconciliation/book-lines/'), {
      headers: await getAuthHeaders(),
      params: cleanParams(params),
    })
    return response.data
  },

  autoMatch: async (account: number, dateFrom?: string, dateTo?: string): Promise<{ matched: number }> => {
    const response = await axios.post(createApiUrl('/reconciliation/auto-match/'),
      cleanParams({ account, date_from: dateFrom, date_to: dateTo }),
      { headers: await getAuthHeaders() })
    return response.data
  },

  match: async (account: number, transaction: number, journalLines: number[]): Promise<{ matched: number }> => {
    const response = await axios.post(createApiUrl('/reconciliation/match/'),
      { account, transaction, journal_lines: journalLines },
      { headers: await getAuthHeaders() })
    return response.data
  },

  /** What a bank transaction (or a journal line) can be matched to - opposite side, amount within the tolerance. */
  candidates: async (target: MatchTarget): Promise<MatchCandidates> => {
    const response = await axios.get(createApiUrl('/reconciliation/candidates/'), {
      headers: await getAuthHeaders(),
      params: target.kind === 'transaction' ? { transaction: target.id } : { journal_line: target.id },
    })
    return response.data
  },

  /** Matches one bank transaction to one journal line, from either side. */
  matchPair: async (transaction: number, journalLine: number): Promise<{ matched: number }> => {
    const response = await axios.post(createApiUrl('/reconciliation/match-pair/'),
      { transaction, journal_line: journalLine }, { headers: await getAuthHeaders() })
    return response.data
  },

  unmatch: async (account: number, transactions: number[]): Promise<{ unmatched: number }> => {
    const response = await axios.post(createApiUrl('/reconciliation/unmatch/'),
      { account, transactions },
      { headers: await getAuthHeaders() })
    return response.data
  },

  getSettings: async (): Promise<ReconciliationSettings> => {
    const response = await axios.get(createApiUrl('/reconciliation/settings/'), { headers: await getAuthHeaders() })
    return response.data
  },

  updateSettings: async (payload: Partial<ReconciliationSettings>): Promise<ReconciliationSettings> => {
    const response = await axios.put(createApiUrl('/reconciliation/settings/'), payload, { headers: await getAuthHeaders() })
    return response.data
  },

  /** Full bank account (with its GL account link). */
  getBankAccount: async (id: number): Promise<BankAccount> => {
    const response = await axios.get(createApiUrl(`/bank-accounts/${id}/`), { headers: await getAuthHeaders() })
    return response.data
  },

  /** Links a bank account to the Chart of Accounts account its journal lines are booked to. */
  setGlAccount: async (id: number, glAccount: number | null): Promise<BankAccount> => {
    const response = await axios.patch(createApiUrl(`/bank-accounts/${id}/`), { gl_account: glAccount }, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },
}

/** First message of a {"error": [...]} API response, or a fallback. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data
  const first = data?.error ?? data?.gl_account ?? data?.detail
  if (Array.isArray(first)) return String(first[0])
  if (typeof first === 'string') return first
  return fallback
}
