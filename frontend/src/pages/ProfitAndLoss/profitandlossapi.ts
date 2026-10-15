import axios from 'axios'
import { getAuthHeaders, createApiUrl } from '../../access/access'
import type { BalanceSheetReport, ProfitAndLossReport, TrialBalanceReport } from '../../types'

interface ReportParams {
  period?: string
  date_from?: string
  date_to?: string
  account?: number | string
}

export const reportsApi = {
  profitAndLoss: async (params: ReportParams = {}, signal?: AbortSignal): Promise<ProfitAndLossReport> => {
    const response = await axios.get(createApiUrl('/reports/profit-and-loss/'), {
      headers: await getAuthHeaders(),
      params,
      signal,
    })
    return response.data
  },

  /** Trial Balance + P&L + Balance Sheet in one request, for the Financial Pack export. */
  financialPack: async (params: ReportParams = {}): Promise<{
    trial_balance: TrialBalanceReport
    profit_and_loss: ProfitAndLossReport
    balance_sheet: BalanceSheetReport
  }> => {
    const response = await axios.get(createApiUrl('/reports/financial-pack/'), {
      headers: await getAuthHeaders(),
      params,
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
      params,
    })
    return response.data
  },

  exportProfitAndLossUrl: (params: {
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
    return createApiUrl(`/reports/profit-and-loss/?${searchParams.toString()}`)
  },
}
