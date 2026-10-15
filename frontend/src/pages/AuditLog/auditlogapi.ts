import api from '../../api/client'
import type { Paginated } from '../../types'

export interface AuditEntry {
  id: number
  at: string
  user: number | null
  username: string
  /** CREATE, UPDATE, DELETE, POST, CANCEL, PASSWORD, LOGIN, LOGIN_FAILED, FINALIZE, REOPEN */
  action: string
  /** The kind of record, e.g. "SalesInvoice". */
  entity: string
  entity_id: number | null
  label: string
  /** UPDATE: {field: [old, new]}; CREATE / DELETE: the record's fields; bulk rows: {count, ids}. */
  changes: Record<string, unknown> | null
}

export interface AuditFilters {
  actions: string[]
  entities: string[]
  users: { id: number; username: string }[]
}

export interface AuditQuery {
  page?: number
  limit?: number
  search?: string
  action?: string
  entity?: string
  user?: number
  date_from?: string
  date_to?: string
}

export const auditLogApi = {
  list: async (params: AuditQuery): Promise<Paginated<AuditEntry>> => (await api.get('/audit-log/', { params })).data,
  filters: async (): Promise<AuditFilters> => (await api.get('/audit-log/filters/')).data,
}
