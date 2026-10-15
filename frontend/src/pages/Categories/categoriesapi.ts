import axios from 'axios'
import { getAuthHeaders, createApiUrl } from '../../access/access'
import type { Category, SubCategory, Paginated } from '../../types'

/** Categories and sub categories per account type, over the whole Chart of Accounts. */
export interface ChartSummary {
  categories: number
  sub_categories: number
  by_type: Record<string, { categories: number; sub_categories: number }>
}

export const categoriesApi = {
  /** Fixed totals for the page - not affected by its search / type / status filters. */
  summary: async (): Promise<ChartSummary> => {
    const response = await axios.get(createApiUrl('/categories/summary/'), { headers: await getAuthHeaders() })
    return response.data
  },

  /** Deletes every account that isn't used by transactions, journal entries or bank accounts
   * (with its sub-categories and keyword rules); accounts in use are kept. */
  clearAll: async (): Promise<{ deleted_categories: number; kept_categories: number; message: string }> => {
    const response = await axios.post(createApiUrl('/categories/clear-all/'), {}, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  list: async (): Promise<Category[]> => {
    const response = await axios.get(createApiUrl('/categories/'), {
      headers: await getAuthHeaders(),
      params: { limit: 500 },
    })
    const data = response.data
    if (Array.isArray(data)) return data
    if (data?.results && Array.isArray(data.results)) return data.results
    return []
  },

  search: async (params: { search?: string; account_type?: string; page?: number; limit?: number } = {}): Promise<Paginated<Category>> => {
    const response = await axios.get(createApiUrl('/categories/'), {
      headers: await getAuthHeaders(),
      params: { limit: 20, ...params },
    })
    if (Array.isArray(response.data)) {
      return { count: response.data.length, next: null, previous: null, results: response.data }
    }
    return response.data
  },

  create: async (payload: { name: string; account_type: string; code?: string; description?: string }): Promise<Category> => {
    const response = await axios.post(createApiUrl('/categories/'), payload, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  update: async (id: number, payload: Partial<{ name: string; account_type: string; code?: string; description?: string }>): Promise<Category> => {
    const response = await axios.patch(createApiUrl(`/categories/${id}/`), payload, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  remove: async (id: number): Promise<void> => {
    await axios.delete(createApiUrl(`/categories/${id}/`), {
      headers: await getAuthHeaders(),
    })
  },

  /** Excel import in a single request; existing categories/sub-categories are reused. */
  bulkImport: async (rows: {
    name: string
    account_type: string
    code?: string
    description?: string
    sub_categories: { name: string; code?: string; description?: string }[]
  }[]): Promise<{ categories_created: number; subcategories_created: number }> => {
    const response = await axios.post(createApiUrl('/categories/bulk-import/'), { rows }, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },
}

export const subCategoriesApi = {
  list: async (): Promise<SubCategory[]> => {
    const response = await axios.get(createApiUrl('/subcategories/'), {
      headers: await getAuthHeaders(),
      params: { limit: 500 },
    })
    const data = response.data
    if (Array.isArray(data)) return data
    if (data?.results && Array.isArray(data.results)) return data.results
    return []
  },

  search: async (params: { search?: string; category?: number; page?: number; limit?: number } = {}): Promise<Paginated<SubCategory>> => {
    const response = await axios.get(createApiUrl('/subcategories/'), {
      headers: await getAuthHeaders(),
      params: { limit: 20, ...params },
    })
    if (Array.isArray(response.data)) {
      return { count: response.data.length, next: null, previous: null, results: response.data }
    }
    return response.data
  },

  create: async (payload: { name: string; category: number; code?: string; description?: string }): Promise<SubCategory> => {
    const response = await axios.post(createApiUrl('/subcategories/'), payload, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  update: async (id: number, payload: Partial<{ name: string; category?: number; code?: string; description?: string }>): Promise<SubCategory> => {
    const response = await axios.patch(createApiUrl(`/subcategories/${id}/`), payload, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  remove: async (id: number): Promise<void> => {
    await axios.delete(createApiUrl(`/subcategories/${id}/`), {
      headers: await getAuthHeaders(),
    })
  },
}
