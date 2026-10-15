import axios from 'axios'
import { getAuthHeaders, createApiUrl } from '../../access/access'
import type { BankAccount, Paginated } from '../../types'

export interface BankAccountsSummary {
  total: number
  active: number
  inactive: number
  linked: number
}

export const bankAccountsApi = {
  /** Fixed totals for the page cards - not affected by the page's search or filters. */
  summary: async (): Promise<BankAccountsSummary> => {
    const response = await axios.get(createApiUrl('/bank-accounts/summary/'), { headers: await getAuthHeaders() })
    return response.data
  },

  /** Every bank account (walks all pages) - for Excel import/export only. */
  list: async (): Promise<BankAccount[]> => {
    const all: BankAccount[] = []
    let page: number | null = 1
    while (page) {
      const response = await axios.get(createApiUrl('/bank-accounts/'), {
        headers: await getAuthHeaders(),
        params: { page, limit: 500 },
      })
      const data: Paginated<BankAccount> | BankAccount[] = response.data
      if (Array.isArray(data)) return data
      all.push(...(data?.results ?? []))
      page = data?.next ?? null
    }
    return all
  },

  search: async (params: { search?: string; page?: number; limit?: number } = {}): Promise<Paginated<BankAccount>> => {
    const response = await axios.get(createApiUrl('/bank-accounts/'), {
      headers: await getAuthHeaders(),
      params,
    })
    if (Array.isArray(response.data)) {
      return { count: response.data.length, next: null, previous: null, results: response.data }
    }
    return response.data
  },

  create: async (payload: Record<string, unknown>): Promise<BankAccount> => {
    const response = await axios.post(createApiUrl('/bank-accounts/'), payload, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  /** Excel import in a single request; all rows are saved or none are. */
  bulkCreate: async (rows: Record<string, unknown>[]): Promise<{ created: number }> => {
    const response = await axios.post(createApiUrl('/bank-accounts/bulk-create/'), { rows }, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  update: async (id: number, payload: Record<string, unknown>): Promise<BankAccount> => {
    const response = await axios.put(createApiUrl(`/bank-accounts/${id}/`), payload, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  remove: async (id: number): Promise<void> => {
    await axios.delete(createApiUrl(`/bank-accounts/${id}/`), {
      headers: await getAuthHeaders(),
    })
  },
}
