import axios from 'axios'
import { getAuthHeaders, createApiUrl } from '../../access/access'
import type { TrialBalanceReport } from '../../types'

export const trialBalanceApi = {
  trialBalance: async (params: {
    period?: string
    date_from?: string
    date_to?: string
    account?: number | string
  } = {}, signal?: AbortSignal): Promise<TrialBalanceReport> => {
    const response = await axios.get(createApiUrl('/reports/trial-balance/'), {
      headers: await getAuthHeaders(),
      params,
      signal,
    })
    return response.data
  },

  exportTrialBalanceUrl: (params: {
    period?: string
    date_from?: string
    date_to?: string
    account?: number | string
  } = {}): string => {
    const searchParams = new URLSearchParams()
    if (params.period) searchParams.set('period', params.period)
    if (params.date_from) searchParams.set('date_from', params.date_from)
    if (params.date_to) searchParams.set('date_to', params.date_to)
    if (params.account) searchParams.set('account', String(params.account))
    searchParams.set('format', 'csv')
    return createApiUrl(`/reports/trial-balance/?${searchParams.toString()}`)
  },
}
