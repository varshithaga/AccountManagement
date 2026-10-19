import axios from 'axios'
import { getAuthHeaders, getAuthHeadersFile, createApiUrl } from '../../access/access'
import type {
  BankStatement, Transaction, Paginated,
  ContinuityFilters, ContinuityPeriodFilter, ContinuityPage, ContinuityStatementRow,
} from '../../types'
import { confirmParams } from '../../utils/reconcileConfirm'

export const bankStatementsApi = {
  list: async (params: Record<string, unknown> = {}): Promise<BankStatement[]> => {
    const response = await axios.get(createApiUrl('/bank-statements/'), {
      headers: await getAuthHeaders(),
      params: { limit: 500, ...params },
    })
    const data = response.data
    if (Array.isArray(data)) return data
    if (data?.results && Array.isArray(data.results)) return data.results
    return []
  },

  summary: async (params: { search?: string; account?: number | string; source_type?: string; status?: string } = {}): Promise<{ total_imports: number; total_transactions: number; total_duplicates: number; unique_accounts: number; gap_count?: number }> => {
    const response = await axios.get(createApiUrl('/bank-statements/summary/'), {
      headers: await getAuthHeaders(),
      params,
    })
    return response.data
  },

  /** Summary, one page of accounts and the expanded cards' timelines in a single request. */
  continuityPage: async (
    params: ContinuityFilters & { page?: number; limit?: number; include_banks?: 1 } = {},
    signal?: AbortSignal,
  ): Promise<ContinuityPage> => {
    const response = await axios.get(createApiUrl('/continuity/page/'), {
      headers: await getAuthHeaders(),
      params,
      signal,
    })
    return response.data
  },

  /** One account's timeline - only for a card the user expands that the page didn't preload. */
  continuityAccountStatements: async (accountId: number, period: ContinuityPeriodFilter = {}, signal?: AbortSignal): Promise<ContinuityStatementRow[]> => {
    const response = await axios.get(createApiUrl(`/continuity/accounts/${accountId}/statements/`), {
      headers: await getAuthHeaders(),
      params: period,
      signal,
    })
    return response.data
  },

  search: async (params: { search?: string; account?: number | string; source_type?: string; status?: string; ordering?: string; page?: number; limit?: number } = {}): Promise<Paginated<BankStatement>> => {
    const response = await axios.get(createApiUrl('/bank-statements/'), {
      headers: await getAuthHeaders(),
      params: { limit: 20, ...params },
    })
    if (Array.isArray(response.data)) {
      return { count: response.data.length, next: null, previous: null, results: response.data }
    }
    return response.data
  },

  /** Every statement matching the filters (walks all pages - the server caps a page at 500) - for Excel export. */
  listAll: async (params: { search?: string; account?: number | string; source_type?: string; status?: string; ordering?: string } = {}): Promise<BankStatement[]> => {
    const all: BankStatement[] = []
    let page: number | null = 1
    while (page) {
      const data: Paginated<BankStatement> = await bankStatementsApi.search({ ...params, page, limit: 500 })
      all.push(...data.results)
      page = data.next
    }
    return all
  },

  get: async (id: number | string): Promise<BankStatement> => {
    const response = await axios.get(createApiUrl(`/bank-statements/${id}/`), {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  /** Saves the uploaded statement file. It is only served to signed-in users, so it is fetched with the
   * token rather than opened as a plain link. */
  downloadFile: async (id: number | string, filename: string): Promise<void> => {
    const response = await axios.get(createApiUrl(`/bank-statements/${id}/file/`), {
      headers: await getAuthHeaders(),
      responseType: 'blob',
    })
    const url = URL.createObjectURL(response.data)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },

  /** A statement that doesn't follow on from its neighbours is refused with 409
   * {requires_continuity_confirmation, continuity: [...]} until resent with confirmContinuity. */
  upload: async (payload: { account: number; file: File; source_type: string; confirmContinuity?: boolean }): Promise<BankStatement> => {
    const form = new FormData()
    form.append('account', String(payload.account))
    form.append('file', payload.file)
    form.append('source_type', payload.source_type)
    if (payload.confirmContinuity) form.append('confirm_continuity', 'true')
    const response = await axios.post(createApiUrl('/bank-statements/'), form, {
      headers: await getAuthHeadersFile(),
    })
    return response.data
  },

  categorize: async (id: number | string): Promise<{ matched: number; unmatched: number; needs_review: number; transfers_detected: number }> => {
    const response = await axios.post(createApiUrl(`/bank-statements/${id}/categorize/`), {}, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  remove: async (id: number | string, confirmUnmatch = false): Promise<void> => {
    await axios.delete(createApiUrl(`/bank-statements/${id}/`), {
      headers: await getAuthHeaders(),
      params: confirmParams(confirmUnmatch),
    })
  },

  checkDuplicates: async (): Promise<{ flagged: number }> => {
    const response = await axios.post(createApiUrl('/bank-statements/check-duplicates/'), {}, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  reparse: async (id: number | string, confirmUnmatch = false): Promise<{ parsed: number }> => {
    const response = await axios.post(createApiUrl(`/bank-statements/${id}/reparse/`), confirmParams(confirmUnmatch), {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  searchTransactions: async (params: Record<string, unknown> = {}): Promise<Paginated<Transaction>> => {
    const response = await axios.get(createApiUrl('/transactions/'), {
      headers: await getAuthHeaders(),
      params,
    })
    if (Array.isArray(response.data)) {
      return { count: response.data.length, next: null, previous: null, results: response.data }
    }
    return response.data
  },
}
