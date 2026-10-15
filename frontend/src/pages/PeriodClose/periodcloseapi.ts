import axios from 'axios'
import { getAuthHeaders, createApiUrl } from '../../access/access'

export interface BookClosing {
  id: number
  closed_through: string
  closed_by: string | null
  closed_at: string
  note: string
}

export interface PeriodCloseState {
  closed_through: string | null
  history: BookClosing[]
  fiscal_year_start_month: number
  current_fiscal_year: { start: string; end: string }
}

export interface CloseReadiness {
  as_of: string
  closed_through: string | null
  transactions_in_period: number
  not_final: number
  not_final_not_ready: number
  not_final_ready: number
  potential_duplicates: number
  unreconciled_accounts: { id: number; name: string; reconciled_through: string | null }[]
  journal_entries_in_period: number
  can_close: boolean
}

const url = (path = '') => createApiUrl(`/period-close/${path}`)

export const periodCloseApi = {
  state: async (): Promise<PeriodCloseState> =>
    (await axios.get(url(), { headers: await getAuthHeaders() })).data,
  readiness: async (asOf: string): Promise<CloseReadiness> =>
    (await axios.get(url('readiness/'), { headers: await getAuthHeaders(), params: { as_of: asOf } })).data,
  close: async (asOf: string, note: string): Promise<PeriodCloseState> =>
    (await axios.post(url('close/'), { as_of: asOf, note }, { headers: await getAuthHeaders() })).data,
  reopen: async (): Promise<PeriodCloseState> =>
    (await axios.post(url('reopen/'), {}, { headers: await getAuthHeaders() })).data,
  setFiscalYearStart: async (month: number): Promise<PeriodCloseState> =>
    (await axios.put(url(), { fiscal_year_start_month: month }, { headers: await getAuthHeaders() })).data,
}

/** The first message of a DRF {"error": [...]} response, or the fallback. */
export function apiError(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { error?: string[] } } })?.response?.data
  return data?.error?.[0] || fallback
}
