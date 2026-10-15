import axios from 'axios'
import { getAuthHeaders, createApiUrl } from '../../access/access'
import type { JournalEntry, JournalImportBatch, JournalSource, Paginated } from '../../types'
import { confirmParams } from '../../utils/reconcileConfirm'

export interface JournalEntryFilters {
  search?: string
  date_from?: string
  date_to?: string
  source?: JournalSource | ''
  bank_account?: number | null
  /** 'true' = every bank line reconciled, 'false' = some bank line still open. */
  reconciled?: 'true' | 'false' | ''
  page?: number
  limit?: number
}

export interface JournalImportLine {
  /** Used when given; otherwise the sub category is looked up by name (+ category_name). */
  sub_category_id?: number
  sub_category_name?: string
  category_name?: string
  debit?: string
  credit?: string
  description?: string
}

export interface JournalImportEntry {
  entry_number: string
  date: string
  narration: string
  lines: JournalImportLine[]
}

export interface JournalImportResult {
  batch_id: number | null
  created: number
  lines_created: number
  /** Entry numbers that were already imported earlier and so were left untouched. */
  skipped: string[]
  /** Possible duplicates (same date, accounts and amounts under another number) that were left out. */
  duplicates: string[]
  warnings: string[]
}

/** DUPLICATE: same date, accounts and amounts as another entry under a different number. */
export type JournalAnalysisStatus = 'READY' | 'WARNING' | 'DUPLICATE' | 'SKIPPED' | 'ERROR'

/** One entry's result from a dry-run import, in the order the entries were sent. */
/** The account a line of an analysed entry posts to, in line order. matched_by: found by its
 * sub category id, its name, or "Bank" (the chosen bank account's GL account); null = not found. */
export interface JournalLineAccount {
  line: number
  matched_by: 'id' | 'name' | 'bank' | null
  sub_category_id: number | null
  sub_category_name: string | null
  category_name: string | null
  error: string | null
}

export interface JournalAnalysisEntry {
  index: number
  entry_number: string
  date: string | null
  narration: string
  status: JournalAnalysisStatus
  errors: string[]
  warnings: string[]
  line_count: number
  total_debit: string
  total_credit: string
  accounts: JournalLineAccount[]
}

export interface JournalAnalysis {
  summary: {
    entries: number
    ready: number
    warnings: number
    skipped: number
    duplicates: number
    errors: number
    importable: number
    lines: number
    total_debit: string
    total_credit: string
    date_from: string | null
    date_to: string | null
    bank_account: { id: number; name: string; gl_account: number | null; gl_account_name: string | null } | null
  }
  entries: JournalAnalysisEntry[]
}

export interface JournalSummary {
  entries: number
  total_debit: string
  total_credit: string
  batches: number
  /** Entries by the state of their bank lines; entries without one are in none of these. */
  reconciled: number
  partial: number
  unreconciled: number
}

const cleanParams = (filters: JournalEntryFilters) =>
  Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== undefined && v !== null))

export const journalEntriesApi = {
  search: async (filters: JournalEntryFilters = {}): Promise<Paginated<JournalEntry>> => {
    const response = await axios.get(createApiUrl('/journal-entries/'), {
      headers: await getAuthHeaders(),
      params: cleanParams(filters),
    })
    return response.data
  },

  /** Every entry matching the filters (walks all pages) - for Excel export only. */
  listAll: async (filters: JournalEntryFilters = {}): Promise<JournalEntry[]> => {
    const all: JournalEntry[] = []
    let page: number | null = 1
    while (page) {
      const data: Paginated<JournalEntry> = await journalEntriesApi.search({ ...filters, page, limit: 500 })
      all.push(...data.results)
      page = data.next
    }
    return all
  },

  summary: async (filters: JournalEntryFilters = {}): Promise<JournalSummary> => {
    const { page: _page, limit: _limit, ...rest } = filters
    const response = await axios.get(createApiUrl('/journal-entries/summary/'), {
      headers: await getAuthHeaders(),
      params: cleanParams(rest),
    })
    return response.data
  },

  /** Same endpoint external systems use (source EXCEL / JSON = a file uploaded here). All-or-nothing;
   * already-imported entry numbers are skipped. */
  import: async (
    entries: JournalImportEntry[], source: JournalSource, sourceName = '', bankAccount: number | null = null,
    includeDuplicates = false,
  ): Promise<JournalImportResult> => {
    const response = await axios.post(createApiUrl('/journal-entries/import/'), {
      source, source_name: sourceName, bank_account: bankAccount, include_duplicates: includeDuplicates, entries,
    }, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  /** Dry run: checks every entry against the database (accounts, balance, already imported) - saves nothing. */
  analyse: async (entries: JournalImportEntry[], bankAccount: number | null = null): Promise<JournalAnalysis> => {
    const response = await axios.post(createApiUrl('/journal-entries/import/'), {
      source: 'EXCEL', bank_account: bankAccount, dry_run: true, entries,
    }, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },

  remove: async (id: number, confirmUnmatch = false): Promise<void> => {
    await axios.delete(createApiUrl(`/journal-entries/${id}/`), {
      headers: await getAuthHeaders(),
      params: confirmParams(confirmUnmatch),
    })
  },

  batches: async (): Promise<JournalImportBatch[]> => {
    const response = await axios.get(createApiUrl('/journal-import-batches/'), {
      headers: await getAuthHeaders(),
      params: { limit: 100 },
    })
    return response.data.results ?? response.data
  },

  /** Undoes a whole import - deletes every entry that arrived in it. */
  removeBatch: async (id: number, confirmUnmatch = false): Promise<void> => {
    await axios.delete(createApiUrl(`/journal-import-batches/${id}/`), {
      headers: await getAuthHeaders(),
      params: confirmParams(confirmUnmatch),
    })
  },
}
