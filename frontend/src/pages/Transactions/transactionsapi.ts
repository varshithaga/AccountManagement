import axios from 'axios'
import type { FinalizeResult } from '../../utils/finalizeMessage'
import { getAuthHeaders, createApiUrl } from '../../access/access'
import type { Transaction, Paginated } from '../../types'
import { confirmParams } from '../../utils/reconcileConfirm'

export const transactionsApi = {
  summary: async (params: Record<string, unknown> = {}): Promise<{
    total_transactions: number
    uncategorized_count: number
    duplicates_count: number
    reconciled_count: number
    total_debits: number
    total_credits: number
    accounts_count: number
    by_source?: Record<string, number>
  }> => {
    const response = await axios.get(createApiUrl('/transactions/summary/'), {
      headers: await getAuthHeaders(),
      params,
    })
    return response.data
  },
  search: async (params: Record<string, unknown> = {}): Promise<Paginated<Transaction>> => {
    const response = await axios.get(createApiUrl('/transactions/'), {
      headers: await getAuthHeaders(),
      params: { limit: 20, ...params },
    })
    if (Array.isArray(response.data)) {
      return { count: response.data.length, next: null, previous: null, results: response.data }
    }
    return response.data
  },

  /** Every transaction matching the filters (walks all pages - the server caps a page at 500) - for Excel export. */
  listAll: async (params: Record<string, unknown> = {}): Promise<Transaction[]> => {
    const all: Transaction[] = []
    let page: number | null = 1
    while (page) {
      const data: Paginated<Transaction> = await transactionsApi.search({ ...params, page, limit: 500 })
      all.push(...data.results)
      page = data.next
    }
    return all
  },

  get: async (id: number | string): Promise<Transaction> => {
    const response = await axios.get(createApiUrl(`/transactions/${id}/`), {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  create: async (payload: Record<string, unknown>): Promise<Transaction> => {
    const response = await axios.post(createApiUrl('/transactions/'), payload, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  update: async (id: number | string, payload: Record<string, unknown>): Promise<Transaction> => {
    const response = await axios.patch(createApiUrl(`/transactions/${id}/`), payload, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  remove: async (id: number | string, confirmUnmatch = false): Promise<void> => {
    await axios.delete(createApiUrl(`/transactions/${id}/`), {
      headers: await getAuthHeaders(),
      params: confirmParams(confirmUnmatch),
    })
  },

  bulkDelete: async (ids: number[], confirmUnmatch = false): Promise<{ deleted: number; skipped_final: number }> => {
    const response = await axios.post(createApiUrl('/transactions/bulk-delete/'), { ids, ...confirmParams(confirmUnmatch) }, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  bulkUpdate: async (ids: number[], category: number, sub_category: number): Promise<void> => {
    await axios.post(createApiUrl('/transactions/bulk-update/'), { ids, category, sub_category }, {
      headers: await getAuthHeaders(),
    })
  },

  bulkConfirm: async (payload: { ids?: number[]; statement?: number }): Promise<{ confirmed: number }> => {
    const response = await axios.post(createApiUrl('/transactions/bulk-confirm/'), payload, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  /** Lock transactions as final (only categorized ones / transfers are locked). */
  finalize: async (payload: { ids?: number[]; statement?: number }): Promise<FinalizeResult> => {
    const response = await axios.post(createApiUrl('/transactions/finalize/'), payload, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  /** Remove the final lock. */
  reopen: async (ids: number[]): Promise<{ reopened: number }> => {
    const response = await axios.post(createApiUrl('/transactions/reopen/'), { ids }, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  confirm: async (id: number | string): Promise<Transaction> => {
    const response = await axios.post(createApiUrl(`/transactions/${id}/confirm/`), {}, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  acceptSuggestion: async (id: number | string): Promise<Transaction> => {
    const response = await axios.post(createApiUrl(`/transactions/${id}/accept-suggestion/`), {}, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  createRule: async (id: number | string): Promise<unknown> => {
    const response = await axios.post(createApiUrl(`/transactions/${id}/create-rule/`), {}, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  /** Posts final transactions that are not in the books yet (e.g. finalized before the bank had a GL account). */
  postToBooks: async (payload: { ids?: number[]; statement?: number } = {}): Promise<NonNullable<FinalizeResult['posting']>> => {
    const response = await axios.post(createApiUrl('/transactions/post-to-books/'), payload, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  detectTransfers: async (): Promise<{ transfer_pairs_detected: number }> => {
    const response = await axios.post(createApiUrl('/transactions/detect-transfers/'), {}, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },
}
