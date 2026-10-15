import axios from 'axios'
import { getAuthHeaders, createApiUrl } from '../../access/access'

export interface LedgerRow {
  id: number
  date: string
  description: string
  /** The journal voucher the line belongs to (kept as bank_account for the page's column / export). */
  bank_account: string
  entry_id: number
  entry_number: string
  /** The bank statement behind it, when the entry is matched to a bank transaction. */
  statement_id: number | null
  sub_category_name: string
  debit: string
  credit: string
  balance: string
  is_final: boolean
}

export interface AccountLedgerReport {
  period: string
  date_from: string | null
  date_to: string | null
  account: {
    kind: 'sub_category' | 'category'
    id: number
    code: string | null
    name: string
    category_id: number
    category_name: string
    account_type: string
  }
  normal_balance: 'DEBIT' | 'CREDIT'
  opening_balance: string
  total_debit: string
  total_credit: string
  closing_balance: string
  count: number
  page: number
  pages: number
  page_size: number
  rows: LedgerRow[]
}

export interface AccountLedgerParams {
  sub_category?: number
  category?: number
  period?: string
  date_from?: string
  date_to?: string
  account?: number
  page?: number
  page_size?: number
}

export const accountLedgerApi = {
  get: async (params: AccountLedgerParams): Promise<AccountLedgerReport> => {
    const response = await axios.get(createApiUrl('/reports/account-ledger/'), {
      headers: await getAuthHeaders(),
      params,
    })
    return response.data
  },
}
