import axios from 'axios'
import { getAuthHeaders, createApiUrl } from '../../access/access'

export interface CashFlowLine {
  category_id: number
  category_name: string
  account_type: string
  sub_category_id: number | null
  sub_category_name: string
  inflow: string
  outflow: string
  net: string
}

export interface CashFlowSection {
  key: 'operating' | 'investing' | 'financing'
  label: string
  lines: CashFlowLine[]
  inflow: string
  outflow: string
  net: string
}

export interface CashFlowReport {
  period: string
  date_from: string | null
  date_to: string | null
  sections: CashFlowSection[]
  transfers_net: string
  transfers_count: number
  uncategorized_net: string
  uncategorized_count: number
  net_change: string
  opening_cash: string
  closing_cash: string
}

export const cashFlowApi = {
  get: async (params: { period?: string; date_from?: string; date_to?: string; account?: number }, signal?: AbortSignal): Promise<CashFlowReport> => {
    const response = await axios.get(createApiUrl('/reports/cash-flow/'), {
      headers: await getAuthHeaders(),
      params,
      signal,
    })
    return response.data
  },
}
