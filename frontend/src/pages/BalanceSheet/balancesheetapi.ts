import axios from 'axios'
import { getAuthHeaders, createApiUrl } from '../../access/access'
import type { BalanceSheetReport } from '../../types'

export const balancesheetApi = {
  getReport: async (params: {
    period?: 'this_month' | 'last_month' | 'this_quarter' | 'this_fiscal_year' | 'last_fiscal_year' | 'custom'
    date_from?: string
    date_to?: string
    account?: number | ''
  } = {}, signal?: AbortSignal): Promise<BalanceSheetReport> => {
    const cleanParams: Record<string, unknown> = {}
    if (params.period) cleanParams.period = params.period
    if (params.date_from) cleanParams.date_from = params.date_from
    if (params.date_to) cleanParams.date_to = params.date_to
    if (params.account) cleanParams.account = params.account

    const response = await axios.get(createApiUrl('/reports/balance-sheet/'), {
      headers: await getAuthHeaders(),
      params: cleanParams,
      signal,
    })
    return response.data
  },

  getLineItemTransactions: async (params: {
    category?: number | string
    sub_category?: number | string
    period?: string
    date_from?: string
    date_to?: string
    account?: number | string
    page?: number
    limit?: number
  } = {}): Promise<{ count: number; next: number | null; results: { id?: number; date?: string; description: string; amount: number; debit?: number; credit?: number }[] }> => {
    const response = await axios.get(createApiUrl('/reports/line-item-transactions/'), {
      headers: await getAuthHeaders(),
      // as_of: a balance is everything up to the date, so list every transaction up to it, not just this period's.
      params: { ...params, as_of: 1 },
    })
    return response.data
  },

  exportUrl: (params: {
    period?: string
    date_from?: string
    date_to?: string
    account?: number | ''
  } = {}): string => {
    const query = new URLSearchParams()
    if (params.period) query.set('period', params.period)
    if (params.date_from) query.set('date_from', params.date_from)
    if (params.date_to) query.set('date_to', params.date_to)
    if (params.account) query.set('account', String(params.account))
    query.set('format', 'csv')
    return createApiUrl(`/reports/balance-sheet/?${query.toString()}`)
  },

}
