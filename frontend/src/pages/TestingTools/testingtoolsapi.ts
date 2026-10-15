import axios from 'axios'
import { getAuthHeaders, createApiUrl } from '../../access/access'
import { confirmParams } from '../../utils/reconcileConfirm'

/** Which journal entries the testing tool targets: one bank account, one month ("YYYY-MM") or "all".
 * includeLedger also takes entries from other banks' imports that post to this bank's ledger (transfers). */
export interface MonthScopeQuery {
  bankAccount: number
  month: string
  includeLedger: boolean
}

export interface MonthScopeEntry {
  id: number
  entry_number: string
  date: string
  narration: string
  total: string
  reconciled_lines: number
  source_name: string
}

export interface MonthScope {
  bank_account: { id: number; name: string }
  count: number
  reconciled_lines: number
  /** Every month the bank has entries in, with how many. */
  months: { month: string; count: number }[]
  entries: MonthScopeEntry[]
}

const params = (q: MonthScopeQuery) => ({ bank_account: q.bankAccount, month: q.month, include_ledger: q.includeLedger })

export const testingToolsApi = {
  monthScope: async (q: MonthScopeQuery): Promise<MonthScope> => {
    const response = await axios.get(createApiUrl('/journal-entries/month-scope/'), {
      headers: await getAuthHeaders(),
      params: params(q),
    })
    return response.data
  },

  /** Deletes every entry in the scope; imports left empty are removed too. */
  monthDelete: async (q: MonthScopeQuery, confirmUnmatch = false): Promise<{ deleted: number; batches_removed: number }> => {
    const response = await axios.post(createApiUrl('/journal-entries/month-delete/'),
      { ...params(q), ...confirmParams(confirmUnmatch) },
      { headers: await getAuthHeaders() })
    return response.data
  },
}
