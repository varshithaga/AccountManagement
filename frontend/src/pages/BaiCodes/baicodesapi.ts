import axios from 'axios'
import { getAuthHeaders, createApiUrl } from '../../access/access'
import type { BaiCode, Paginated } from '../../types'

export interface BaiCodesSummary {
  total: number
  mapped: number
  unmapped: number
}

export const baiCodesApi = {
  /** Fixed totals for the page cards - not affected by the page's search or filters. */
  summary: async (): Promise<BaiCodesSummary> => {
    const response = await axios.get(createApiUrl('/bai-codes/summary/'), { headers: await getAuthHeaders() })
    return response.data
  },

  list: async (): Promise<BaiCode[]> => {
    const response = await axios.get(createApiUrl('/bai-codes/'), {
      headers: await getAuthHeaders(),
      params: { limit: 500 },
    })
    const data = response.data
    if (Array.isArray(data)) return data
    if (data?.results && Array.isArray(data.results)) return data.results
    return []
  },

  search: async (params: { search?: string; page?: number; limit?: number } = {}): Promise<Paginated<BaiCode>> => {
    const response = await axios.get(createApiUrl('/bai-codes/'), {
      headers: await getAuthHeaders(),
      params: { limit: 20, ...params },
    })
    if (Array.isArray(response.data)) {
      return { count: response.data.length, next: null, previous: null, results: response.data }
    }
    return response.data
  },

  create: async (payload: { code: string; description: string; category?: number | null; sub_category?: number | null }): Promise<BaiCode> => {
    const response = await axios.post(createApiUrl('/bai-codes/'), payload, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  /** Excel import in a single request; all rows are saved or none are. */
  bulkCreate: async (rows: { code: string; description: string; category?: number | null; sub_category?: number | null }[]): Promise<{ created: number }> => {
    const response = await axios.post(createApiUrl('/bai-codes/bulk-create/'), { rows }, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  update: async (id: number, payload: Partial<{ code: string; description: string; category: number | null; sub_category: number | null }>): Promise<BaiCode> => {
    const response = await axios.patch(createApiUrl(`/bai-codes/${id}/`), payload, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  remove: async (id: number): Promise<void> => {
    await axios.delete(createApiUrl(`/bai-codes/${id}/`), {
      headers: await getAuthHeaders(),
    })
  },

  seedDefaults: async (): Promise<void> => {
    await axios.post(createApiUrl('/bai-codes/seed-defaults/'), {}, {
      headers: await getAuthHeaders(),
    })
  },

  clearAll: async (): Promise<void> => {
    await axios.post(createApiUrl('/bai-codes/clear-all/'), {}, {
      headers: await getAuthHeaders(),
    })
  },
}
