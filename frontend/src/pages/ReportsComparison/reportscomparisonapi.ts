import axios from 'axios'
import { getAuthHeaders, createApiUrl } from '../../access/access'
import type { ProfitAndLossReport, BalanceSheetReport } from '../../types'

export type ComparisonPeriod = 'this_month' | 'last_month' | 'this_quarter' | 'this_fiscal_year' | 'last_fiscal_year' | 'all_time' | 'custom'

interface ReportRangeParams {
  period?: ComparisonPeriod
  date_from?: string
  date_to?: string
  account?: number | ''
}

function toQueryParams(params: ReportRangeParams): Record<string, unknown> {
  const cleanParams: Record<string, unknown> = {}
  if (params.period) cleanParams.period = params.period
  if (params.date_from) cleanParams.date_from = params.date_from
  if (params.date_to) cleanParams.date_to = params.date_to
  if (params.account) cleanParams.account = params.account
  return cleanParams
}

export interface ReportPair {
  profit_and_loss: ProfitAndLossReport
  balance_sheet: BalanceSheetReport
}

export interface ComparisonRange {
  period: ComparisonPeriod
  date_from?: string
  date_to?: string
}

/** One period's headline numbers (computed by the backend). */
export interface PeriodTotals {
  date_from: string | null
  date_to: string | null
  income: number
  expenses: number
  net_profit: number
  assets: number
  liabilities: number
  equity: number
}

type ComparisonParts = 'all_time' | 'a' | 'b'
interface ComparisonQuery { summary?: boolean; a?: ComparisonRange; b?: ComparisonRange; account?: number | '' }

function comparisonParams(parts: ComparisonQuery): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  if (parts.summary) params.summary = 1
  for (const side of ['a', 'b'] as const) {
    const range = parts[side]
    if (!range) continue
    params[`${side}_period`] = range.period
    if (range.date_from) params[`${side}_date_from`] = range.date_from
    if (range.date_to) params[`${side}_date_to`] = range.date_to
  }
  if (parts.account) params.account = parts.account
  return params
}

export const reportsComparisonApi = {
  /** The page's numbers in one request - just the totals - for the all-time summary and/or
   * Period A and/or Period B (only the parts asked for come back). */
  comparison: async (parts: ComparisonQuery, signal?: AbortSignal): Promise<Partial<Record<ComparisonParts, PeriodTotals>>> => {
    const response = await axios.get(createApiUrl('/reports/comparison/'), {
      headers: await getAuthHeaders(),
      params: comparisonParams(parts),
      signal,
    })
    return response.data
  },

  /** Full P&L + Balance Sheet (category breakdowns) for each part - only for Excel / PDF export. */
  comparisonExport: async (parts: ComparisonQuery): Promise<Partial<Record<ComparisonParts, ReportPair>>> => {
    const response = await axios.get(createApiUrl('/reports/comparison/export/'), {
      headers: await getAuthHeaders(),
      params: comparisonParams(parts),
    })
    return response.data
  },

  profitAndLoss: async (params: ReportRangeParams = {}): Promise<ProfitAndLossReport> => {
    const response = await axios.get(createApiUrl('/reports/profit-and-loss/'), {
      headers: await getAuthHeaders(),
      params: toQueryParams(params),
    })
    return response.data
  },

  balanceSheet: async (params: ReportRangeParams = {}): Promise<BalanceSheetReport> => {
    const response = await axios.get(createApiUrl('/reports/balance-sheet/'), {
      headers: await getAuthHeaders(),
      params: toQueryParams(params),
    })
    return response.data
  },

}
