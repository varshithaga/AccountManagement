import { Fragment, useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, History, RefreshCw } from 'lucide-react'
import { Alert, Chip, IconButton, Panel, Select, Spinner } from '../../components/tw'
import { EmptyState, PageHeader, SearchBox } from '../../components/PageParts'
import Pagination, { DEFAULT_ROWS_PER_PAGE } from '../../components/Pagination'
import DatePicker2 from '../../components/DatePicker2'
import { errorText } from '../Billing/billingapi'
import { TABLE_HEAD_ROW, TABLE_ROW, TD, TH } from '../Billing/billingParts'
import { auditLogApi, type AuditEntry, type AuditFilters } from './auditlogapi'
import { ACTIONS, actionLabel, changeLines, entityLabel } from './auditFormat'

const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

/** Who created, changed, posted, cancelled or deleted what, and when - plus sign-ins and bulk actions. */
export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditEntry[]>([])
  const [count, setCount] = useState(0)
  const [filters, setFilters] = useState<AuditFilters>({ actions: [], entities: [], users: [] })
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const [user, setUser] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { auditLogApi.filters().then(setFilters).catch(() => {}) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await auditLogApi.list({
        page: page + 1, limit: rowsPerPage, search: search.trim() || undefined, action: action || undefined,
        entity: entity || undefined, user: user ? Number(user) : undefined, date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      })
      setRows(data.results)
      setCount(data.count)
    } catch (err) {
      setError(errorText(err, 'Failed to load the audit log.'))
    } finally {
      setLoading(false)
    }
  }, [page, rowsPerPage, search, action, entity, user, dateFrom, dateTo])

  useEffect(() => {
    const handle = setTimeout(load, 300)
    return () => clearTimeout(handle)
  }, [load])

  // Any filter change starts again at the first page.
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(0) }

  const toggle = (id: number) => setExpanded((s) => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit Log"
        description="Who created, changed, posted, cancelled or deleted what, and when - with the old and new values. Sign-ins and bulk actions are here too. Entries can't be edited or removed."
        actions={
          <IconButton title="Refresh" onClick={load} disabled={loading}>
            <RefreshCw className={`h-[18px] w-[18px] stroke-[1.8] ${loading ? 'animate-spin' : ''}`} />
          </IconButton>
        }
      />

      <Panel className="flex flex-wrap items-end gap-3">
        <SearchBox className="min-w-[220px] flex-1" value={search} onChange={filter(setSearch)} placeholder="Search number, name or user" />
        <div className="w-44">
          <Select id="audit-action" value={action} onChange={(e) => filter(setAction)(e.target.value)}>
            <option value="">All actions</option>
            {filters.actions.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
          </Select>
        </div>
        <div className="w-52">
          <Select id="audit-entity" value={entity} onChange={(e) => filter(setEntity)(e.target.value)}>
            <option value="">All records</option>
            {filters.entities.map((e) => <option key={e} value={e}>{entityLabel(e)}</option>)}
          </Select>
        </div>
        <div className="w-44">
          <Select id="audit-user" value={user} onChange={(e) => filter(setUser)(e.target.value)}>
            <option value="">All users</option>
            {filters.users.map((u) => <option key={u.id} value={String(u.id)}>{u.username}</option>)}
          </Select>
        </div>
        <DatePicker2 id="audit-from" label="From" value={dateFrom} onChange={filter(setDateFrom)} fullWidth={false} className="min-w-[150px]" />
        <DatePicker2 id="audit-to" label="To" value={dateTo} onChange={filter(setDateTo)} fullWidth={false} className="min-w-[150px]" />
      </Panel>

      {error && <Alert>{error}</Alert>}

      <Panel className="overflow-hidden p-0">
        {loading && !rows.length ? (
          <div className="flex justify-center p-16"><Spinner size={32} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<History />} title="Nothing in the log matches." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead>
                  <tr className={TABLE_HEAD_ROW}>
                    <th className={TH}>When</th>
                    <th className={TH}>User</th>
                    <th className={TH}>Action</th>
                    <th className={TH}>Record</th>
                    <th className={TH}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const lines = changeLines(r)
                    const open = expanded.has(r.id)
                    return (
                      <Fragment key={r.id}>
                        <tr className={`${TABLE_ROW} ${lines.length ? 'cursor-pointer' : ''}`} onClick={() => lines.length && toggle(r.id)}>
                          <td className={`${TD} whitespace-nowrap text-muted`}>{fmtTime(r.at)}</td>
                          <td className={`${TD} font-semibold`}>{r.username || '—'}</td>
                          <td className={TD}><Chip tone={ACTIONS[r.action]?.tone ?? 'neutral'}>{actionLabel(r.action)}</Chip></td>
                          <td className={TD}>
                            <p className="font-semibold">{r.label || (r.entity_id ? `#${r.entity_id}` : '—')}</p>
                            <p className="text-xs text-muted">{entityLabel(r.entity)}</p>
                          </td>
                          <td className={`${TD} text-muted`}>
                            {lines.length > 0 && (
                              <span className="inline-flex items-center gap-1">
                                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                {r.action === 'UPDATE' ? lines.slice(0, 2).join(' · ') : `${lines.length} field${lines.length === 1 ? '' : 's'}`}
                                {r.action === 'UPDATE' && lines.length > 2 && ` · +${lines.length - 2} more`}
                              </span>
                            )}
                          </td>
                        </tr>
                        {open && (
                          <tr className="border-b border-border-soft bg-surface-muted/50">
                            <td colSpan={5} className="px-6 py-3">
                              <ul className="num space-y-1 text-[13px] text-ink">
                                {lines.map((line) => <li key={line} className="break-all">{line}</li>)}
                              </ul>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination count={count} page={page} rowsPerPage={rowsPerPage} onPageChange={setPage}
              onRowsPerPageChange={(n) => { setRowsPerPage(n); setPage(0) }} />
          </>
        )}
      </Panel>
    </div>
  )
}
