import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarClock, Eye, Pencil, Play, Plus, RefreshCw, Repeat, Trash2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import Pagination, { DEFAULT_ROWS_PER_PAGE } from '../../components/Pagination'
import { Alert, Button, Chip, DateField, Drawer, IconButton, Modal, Panel, Select, Spinner, Switch, Tabs, TextField } from '../../components/tw'
import { EmptyState, KpiTile, PageHeader, RowAction, SearchBox } from '../../components/PageParts'
import { formatMoney } from '../../utils/periods'
import { errorText, recurringApi, taxRatesApi } from './billingapi'
import type { Frequency, RecurringInvoice, TaxRate } from './billingapi'
import { Field, PartySelect, StatusChip, TABLE_HEAD_ROW, TABLE_ROW, TD, TH, formatDate, todayIso } from './billingParts'
import LineItemsEditor from './LineItemsEditor'
import { blankLine, lineTotals, linesFromPayload, linesToPayload } from './lineItems'
import type { Line } from './lineItems'

type ActiveFilter = 'all' | 'active' | 'paused'

const FREQUENCY_LABELS: Record<Frequency, string> = {
  MONTHLY: 'Every month', QUARTERLY: 'Every quarter', HALF_YEARLY: 'Every 6 months', YEARLY: 'Every year',
}

const isDue = (t: RecurringInvoice) => t.is_active && t.next_date <= todayIso() && (!t.end_date || t.next_date <= t.end_date)
const isFinished = (t: RecurringInvoice) => !!t.end_date && t.next_date > t.end_date

/** Templates that raise a sales invoice every month / quarter / half-year / year - as drafts, or posted
 * straight away. "Create due invoices" raises everything that has fallen due (missed periods too). */
export default function RecurringInvoicesPage() {
  const { can } = useAuth()
  const canCreate = can('recurring_invoices', 'create')
  const canEdit = can('recurring_invoices', 'edit')
  const canDelete = can('recurring_invoices', 'delete')

  const [rows, setRows] = useState<RecurringInvoice[]>([])
  const [count, setCount] = useState(0)
  const [due, setDue] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [active, setActive] = useState<ActiveFilter>('all')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE)
  const [editing, setEditing] = useState<RecurringInvoice | 'new' | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const [running, setRunning] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await recurringApi.search({
        search: search.trim() || undefined, is_active: active === 'all' ? undefined : active === 'active',
        page: page + 1, limit: rowsPerPage,
      })
      setRows(data.results)
      setCount(data.count)
      setDue(data.due)
      setError('')
    } catch (err) {
      setError(errorText(err, 'Failed to load the recurring invoices.'))
    } finally {
      setLoading(false)
    }
  }, [search, active, page, rowsPerPage])

  useEffect(() => {
    const handle = setTimeout(load, 300)
    return () => clearTimeout(handle)
  }, [load])

  const generateDue = async () => {
    setRunning(true)
    setNotice('')
    try {
      const r = await recurringApi.generateDue()
      const made = r.invoices_created ? `${r.invoices_created} invoice${r.invoices_created > 1 ? 's' : ''} created.` : 'Nothing was due.'
      setNotice(r.errors.length ? `${made} ${r.errors.length} template(s) failed - see the warning on each.` : made)
      load()
    } catch (err) {
      setError(errorText(err, 'Failed to create the due invoices.'))
    } finally {
      setRunning(false)
    }
  }

  const generateOne = async (t: RecurringInvoice) => {
    try {
      const r = await recurringApi.generateOne(t.id)
      setNotice(`${t.name}: ${r.invoices_created} invoice${r.invoices_created === 1 ? '' : 's'} created.`)
      load()
    } catch (err) {
      alert(errorText(err, 'Failed to create the invoice.'))
      load()
    }
  }

  const remove = async (t: RecurringInvoice) => {
    if (!window.confirm(`Delete "${t.name}"? The invoices it already created stay.`)) return
    try {
      await recurringApi.remove(t.id)
      load()
    } catch (err) {
      alert(errorText(err, 'Failed to delete.'))
    }
  }

  const failing = rows.filter((t) => t.last_error).length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Recurring invoices"
        description="Invoices raised on a schedule - rent, retainers, AMCs, subscriptions. Each run creates the invoices that have fallen due, dated on their own day."
        actions={<>
          <IconButton title="Refresh" onClick={load} disabled={loading}>
            <RefreshCw className={`h-[18px] w-[18px] stroke-[1.8] ${loading ? 'animate-spin' : ''}`} />
          </IconButton>
          {canCreate && <Button variant="outlined" icon={<Play />} onClick={generateDue} disabled={running || !due}>
            Create due invoices{due ? ` (${due})` : ''}
          </Button>}
          {canCreate && <Button variant="contained" icon={<Plus />} onClick={() => setEditing('new')}>New recurring invoice</Button>}
        </>}
      />

      {error && <Alert>{error}</Alert>}
      {notice && (
        <div role="status" className="rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm font-medium text-success-text">
          {notice} <Link to="/sales-invoices" className="font-bold underline">Open sales invoices</Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile dark icon={<CalendarClock />} label="Due now" value={due} caption="Templates with an invoice to raise" />
        <KpiTile tone="primary" icon={<Repeat />} label="Templates" value={count} caption="Matching the filters below" />
        <KpiTile tone="danger" icon={<AlertTriangle />} label="Failed last run" value={failing} caption="Fix them and run again" />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0) }} placeholder="Search by name or notes…" className="flex-1" />
        <Tabs<ActiveFilter> value={active} onChange={(v) => { setActive(v); setPage(0) }} options={[
          { value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' },
        ]} />
      </div>

      <Panel className="overflow-hidden p-0">
        {loading && rows.length === 0 ? (
          <div className="flex justify-center p-16"><Spinner size={32} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Repeat />} title="No recurring invoices here."
            action={canCreate && !search && active === 'all' && <Button variant="contained" icon={<Plus />} onClick={() => setEditing('new')}>New recurring invoice</Button>} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] border-collapse text-sm">
                <thead>
                  <tr className={TABLE_HEAD_ROW}>
                    <th className={TH}>Name</th>
                    <th className={TH}>Client</th>
                    <th className={TH}>Schedule</th>
                    <th className={TH}>Next invoice</th>
                    <th className={`${TH} text-right`}>Created</th>
                    <th className={TH}>Status</th>
                    <th className={`${TH} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id} className={TABLE_ROW}>
                      <td className={TD}>
                        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setViewing(t.id)}>{t.name}</button>
                        {t.last_error && <p className="mt-0.5 max-w-xs text-xs font-medium text-danger-text">{t.last_error}</p>}
                      </td>
                      <td className={TD}>{t.client_name}</td>
                      <td className={TD}>
                        {FREQUENCY_LABELS[t.frequency]}
                        <p className="text-xs text-muted">{t.auto_post ? 'Posted automatically' : 'As drafts'}</p>
                      </td>
                      <td className={`${TD} whitespace-nowrap ${isDue(t) ? 'font-semibold text-warning-text' : ''}`}>
                        {isFinished(t) ? '—' : formatDate(t.next_date)}
                        {t.end_date && <p className="text-xs font-normal text-muted">until {formatDate(t.end_date)}</p>}
                      </td>
                      <td className={`${TD} num text-right`}>{t.invoices_created}</td>
                      <td className={TD}><TemplateChip t={t} /></td>
                      <td className={`${TD} text-right`}>
                        <div className="inline-flex items-center gap-1">
                          <RowAction onClick={() => setViewing(t.id)} title="View"><Eye /></RowAction>
                          {isDue(t) && canCreate && <RowAction onClick={() => generateOne(t)} title="Create due invoice now"><Play /></RowAction>}
                          {canEdit && <RowAction onClick={() => setEditing(t)} title="Edit"><Pencil /></RowAction>}
                          {canDelete && <RowAction danger onClick={() => remove(t)} title="Delete"><Trash2 /></RowAction>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination count={count} page={page} rowsPerPage={rowsPerPage} onPageChange={setPage}
              onRowsPerPageChange={(r) => { setRowsPerPage(r); setPage(0) }} />
          </>
        )}
      </Panel>

      {editing && (
        <RecurringEditor template={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={(t) => { setEditing(null); load(); setViewing(t.id) }} />
      )}
      {viewing && (
        <RecurringDrawer id={viewing} onClose={() => setViewing(null)}
          onEdit={canEdit ? (t) => { setViewing(null); setEditing(t) } : undefined} />
      )}
    </div>
  )
}

function TemplateChip({ t }: { t: RecurringInvoice }) {
  if (t.last_error) return <Chip tone="error">Failed</Chip>
  if (!t.is_active) return <Chip tone="neutral">Paused</Chip>
  if (isFinished(t)) return <Chip tone="neutral">Finished</Chip>
  if (isDue(t)) return <Chip tone="warning">Due</Chip>
  return <Chip tone="success">Active</Chip>
}

function RecurringDrawer({ id, onClose, onEdit }: {
  id: number
  onClose: () => void
  onEdit?: (t: RecurringInvoice) => void
}) {
  const [t, setT] = useState<RecurringInvoice | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { recurringApi.get(id).then(setT).catch((err) => setError(errorText(err, 'Failed to load.'))) }, [id])

  return (
    <Drawer onClose={onClose} widthClassName="w-full sm:w-[560px] md:w-[640px]"
      title={<div>
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-primary">Recurring invoice</p>
        <h2 className="font-display text-xl font-bold text-ink">{t?.name ?? '…'}</h2>
      </div>}>
      {error && <Alert>{error}</Alert>}
      {!t && !error && <div className="flex justify-center p-10"><Spinner size={28} /></div>}
      {t && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2"><TemplateChip t={t} /></div>
          {t.last_error && <Alert>{t.last_error}</Alert>}
          <div className="grid grid-cols-2 gap-4 rounded-xl bg-surface-muted p-4 sm:grid-cols-3">
            <Field label="Client">{t.client_name}</Field>
            <Field label="Schedule">{FREQUENCY_LABELS[t.frequency]}</Field>
            <Field label="Invoices">{t.auto_post ? 'Posted' : 'Drafts'}</Field>
            <Field label="Started">{formatDate(t.start_date)}</Field>
            <Field label="Next">{isFinished(t) ? '—' : formatDate(t.next_date)}</Field>
            <Field label="Ends">{t.end_date ? formatDate(t.end_date) : 'Never'}</Field>
          </div>
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-muted">Lines</p>
            {t.items.map((i, n) => (
              <div key={n} className="flex justify-between gap-3 border-b border-border-soft py-2 text-sm last:border-0">
                <span>{i.description || `Product #${i.product_id}`} <span className="text-muted">× {Number(i.quantity ?? 1)}</span></span>
                <span className="num">{i.unit_price ? formatMoney(i.unit_price) : 'product price'}</span>
              </div>
            ))}
          </div>
          {t.notes && <p className="whitespace-pre-wrap rounded-xl border border-border-soft p-3 text-sm text-muted">{t.notes}</p>}
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-muted">Invoices created ({t.invoices_created})</p>
            {!t.invoices?.length ? <p className="text-sm text-muted">None yet.</p> : t.invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-2 border-b border-border-soft py-2 text-sm last:border-0">
                <span><span className="num font-semibold">{inv.invoice_number}</span> · {formatDate(inv.invoice_date)}</span>
                <span className="flex items-center gap-2"><span className="num">{formatMoney(inv.total)}</span><StatusChip status={inv.status} /></span>
              </div>
            ))}
          </div>
          {onEdit && (
            <div className="flex gap-2 border-t border-border-soft pt-4">
              <Button variant="outlined" icon={<Pencil />} onClick={() => onEdit(t)}>Edit</Button>
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}

function RecurringEditor({ template, onClose, onSaved }: {
  template: RecurringInvoice | null
  onClose: () => void
  onSaved: (t: RecurringInvoice) => void
}) {
  const [name, setName] = useState(template?.name ?? '')
  const [client, setClient] = useState<number | null>(template?.client ?? null)
  const [frequency, setFrequency] = useState<Frequency>(template?.frequency ?? 'MONTHLY')
  const [startDate, setStartDate] = useState(template?.start_date ?? todayIso())
  const [nextDate, setNextDate] = useState(template?.next_date ?? '')
  const [endDate, setEndDate] = useState(template?.end_date ?? '')
  const [autoPost, setAutoPost] = useState(template?.auto_post ?? false)
  const [isActive, setIsActive] = useState(template?.is_active ?? true)
  const [notes, setNotes] = useState(template?.notes ?? '')
  const [lines, setLines] = useState<Line[]>(() => (template?.items.length ? linesFromPayload(template.items) : [blankLine()]))
  const [rates, setRates] = useState<TaxRate[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { taxRatesApi.list({ is_active: true }).then(setRates).catch(() => {}) }, [])
  const totals = useMemo(() => lineTotals(lines, rates), [lines, rates])

  const save = async () => {
    if (!name.trim()) return setError('Give it a name, e.g. "Office rent - Acme".')
    if (!client) return setError('Choose the client.')
    const items = linesToPayload(lines)
    if (!items.length) return setError('Add at least one line.')
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(), client_id: client, frequency, start_date: startDate, end_date: endDate || null,
        auto_post: autoPost, is_active: isActive, notes, items,
        // Only sent when changed by hand - otherwise a new template (or a moved start) begins at the start date.
        ...(template && nextDate && nextDate !== template.next_date ? { next_date: nextDate } : {}),
      }
      onSaved(template ? await recurringApi.update(template.id, payload) : await recurringApi.create(payload))
    } catch (err) {
      setError(errorText(err, 'Failed to save the recurring invoice.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} icon={<Repeat />}
      title={template ? `Edit ${template.name}` : 'New recurring invoice'}
      subtitle="Each due date raises one invoice with these lines."
      widthClassName="max-w-5xl"
      footerHint={<span className="num">Each invoice: <b className="text-ink">{formatMoney(totals.subtotal + totals.tax)}</b> (incl. GST {formatMoney(totals.tax)})</span>}
      footer={<>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}>Save</Button>
      </>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <TextField className="md:col-span-2" id="rec-name" label="Name" required value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Office rent - Acme" />
        <div className="md:col-span-2">
          <PartySelect kind="clients" value={client} valueLabel={template?.client_name} required onChange={(id) => setClient(id)} />
        </div>
        <Select id="rec-frequency" label="Repeats" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
          {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
        </Select>
        <DateField id="rec-start" label="First invoice on" value={startDate} onChange={setStartDate} />
        {template && <DateField id="rec-next" label="Next invoice on" value={nextDate} onChange={setNextDate} min={startDate} />}
        <DateField id="rec-end" label="Last invoice by (optional)" value={endDate} onChange={setEndDate} min={startDate} />
      </div>
      <p className="-mt-2 text-xs text-muted">
        Invoices fall on the start date's day of the month - on the 29th–31st, the month's last day when it is shorter.
      </p>
      <div className="flex flex-wrap gap-6">
        <Switch checked={autoPost} onChange={setAutoPost} label="Post the invoices straight away" />
        <Switch checked={isActive} onChange={setIsActive} label="Active" />
      </div>

      <LineItemsEditor kind="sales" lines={lines} onChange={setLines} rates={rates} />

      <TextField id="rec-notes" label="Notes (printed on each invoice)" multiline rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
    </Modal>
  )
}
