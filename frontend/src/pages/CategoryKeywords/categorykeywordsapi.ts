import axios from 'axios'
import { getAuthHeaders, createApiUrl } from '../../access/access'
import type { CategoryKeyword, CategorizationSettings, Category, Paginated, AccountType } from '../../types'

export interface CoaTreeCategory extends Category {
  subcategories: (Category['subcategories'][0] & { keyword_count: number })[]
}

export interface RulesSummary {
  total: number
  active: number
  auto_assign: number
  expense: number
  income: number
}

export const categoryKeywordsApi = {
  /** Fixed totals for the page cards - not affected by the page's search or filters. */
  summary: async (): Promise<RulesSummary> => {
    const response = await axios.get(createApiUrl('/category-keywords/summary/'), { headers: await getAuthHeaders() })
    return response.data
  },

  coaTree: async (): Promise<CoaTreeCategory[]> => {
    const response = await axios.get(createApiUrl('/category-keywords/coa-tree/'), {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  list: async (): Promise<CategoryKeyword[]> => {
    const response = await axios.get(createApiUrl('/category-keywords/'), {
      headers: await getAuthHeaders(),
      params: { limit: 500 },
    })
    const data = response.data
    if (Array.isArray(data)) return data
    if (data?.results && Array.isArray(data.results)) return data.results
    return []
  },

  search: async (params: { search?: string; sub_category?: number; category?: number; account_type?: AccountType; page?: number; limit?: number } = {}): Promise<Paginated<CategoryKeyword>> => {
    const response = await axios.get(createApiUrl('/category-keywords/'), {
      headers: await getAuthHeaders(),
      params: { limit: 20, ...params },
    })
    if (Array.isArray(response.data)) {
      return { count: response.data.length, next: null, previous: null, results: response.data }
    }
    return response.data
  },

  create: async (payload: { keyword: string; sub_category: number | string; is_active?: boolean; auto_assign?: boolean; priority?: number }): Promise<CategoryKeyword> => {
    const response = await axios.post(createApiUrl('/category-keywords/'), payload, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  /** Excel import in a single request; all rows are saved or none are. */
  bulkCreate: async (rows: { keyword: string; sub_category: number | string; is_active?: boolean; auto_assign?: boolean; priority?: number }[]): Promise<{ created: number }> => {
    const response = await axios.post(createApiUrl('/category-keywords/bulk-create/'), { rows }, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  update: async (id: number, payload: Partial<{ keyword: string; sub_category: number | string; is_active?: boolean; auto_assign?: boolean; priority?: number }>): Promise<CategoryKeyword> => {
    const response = await axios.patch(createApiUrl(`/category-keywords/${id}/`), payload, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  remove: async (id: number): Promise<void> => {
    await axios.delete(createApiUrl(`/category-keywords/${id}/`), {
      headers: await getAuthHeaders(),
    })
  },

  /** Deletes every keyword rule. */
  clearAll: async (): Promise<{ deleted: number; message: string }> => {
    const response = await axios.post(createApiUrl('/category-keywords/clear-all/'), {}, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },
}

export const categorizationSettingsApi = {
  get: async (): Promise<CategorizationSettings> => {
    const response = await axios.get(createApiUrl('/categorization-settings/'), {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  update: async (payload: Partial<CategorizationSettings>): Promise<CategorizationSettings> => {
    const response = await axios.put(createApiUrl('/categorization-settings/'), payload, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },
}
