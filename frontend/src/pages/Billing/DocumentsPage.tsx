import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FileText, ShoppingCart, Plus, Pencil, Trash2, RefreshCw, Send, Ban, Eye, AlertTriangle, Wallet, FilePen,
  CheckCircle2, X, HandCoins, FileMinus,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import Pagination, { DEFAULT_ROWS_PER_PAGE } from '../../components/Pagination'
import SearchableSelect from '../../components/SearchableSelect'
import type { SearchableOption } from '../../components/SearchableSelect'
import { Alert, Button, DateField, Drawer, IconButton, Modal, Panel, Select, Spinner, Switch, Tabs, TextField } from '../../components/tw'
import { EmptyState, KpiTile, PageHeader, RowAction, SearchBox } from '../../components/PageParts'
import { formatMoney } from '../../utils/periods'
import { withUnmatchConfirm } from '../../utils/reconcileConfirm'
import { creditNotesApi, docsApi, errorText, productsApi, taxRatesApi } from './billingapi'
import type { BillingDoc, DocKind, DocStatus, DocSummary, ItemPayload, Product, TaxRate } from './billingapi'
import {
  AccountSelect, Field, PartySelect, StatusChip, TABLE_HEAD_ROW, TABLE_ROW, TD, TH, formatDate, isOverdue, todayIso,
} from './billingParts'
import { PaymentEditor } from './PaymentsPage'
import CreditNoteDialog from './CreditNoteDialog'

type StatusFilter = 'ALL' | DocStatus

const TEXT = {
  sales: {
    title: 'Sales invoices', single: 'invoice', partyKind: 'clients' as const, partyLabel: 'Client',
    description: 'Invoices to clients. Posting one books it (Dr Receivable / Cr income and GST); receipts mark it paid.',
    page: 'sales_invoices' as const, pay: 'Record receipt',
  },
  purchase: {
    title: 'Purchase bills', single: 'bill', partyKind: 'suppliers' as const, partyLabel: 'Supplier',
    description: 'Bills from suppliers. Posting one books it (Dr expense and input GST / Cr Payable); payments mark it paid.',
    page: 'purchase_bills' as const, pay: 'Record payment',
  },
}

const docNumber = (d: BillingDoc) => d.invoice_number ?? d.bill_number ?? ''
const docDate = (d: BillingDoc) => d.invoice_date ?? d.bill_date ?? ''
const docParty = (d: BillingDoc) => d.client_name ?? d.supplier_name ?? ''
const docPartyId = (d: BillingDoc) => d.client ?? d.supplier ?? null

export default function DocumentsPage({ kind }: { kind: DocKind }) {
  const text = TEXT[kind]
  const api = docsApi(kind)
  const { can, hasPage } = useAuth()
  const canCreate = can(text.page, 'create')
  const canEdit = can(text.page, 'edit')
  const canDelete = can(text.page, 'delete')
  const canPay = can('payments', 'create')

  const [rows, setRows] = useState<BillingDoc[]>([])
  const [count, setCount] = useState(0)
  const [summary, setSummary] = useState<DocSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('ALL')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [party, setParty] = useState<number | null>(null)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE)

  const [editorDoc, setEditorDoc] = useState<BillingDoc | null | 'new'>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const [paying, setPaying] = useState<BillingDoc | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [data, sum] = await Promise.all([
        api.search({
          search: search.trim() || undefined, status: status === 'ALL' ? undefined : status,
          overdue: overdueOnly || undefined, [kind === 'sales' ? 'client' : 'supplier']: party ?? undefined,
          page: page + 1, limit: rowsPerPage,
        }),
        api.summary(),
      ])
      setRows(data.results)
      setCount(data.count)
      setSummary(sum)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, search, status, overdueOnly, party, page, rowsPerPage])

  useEffect(() => {
    const handle = setTimeout(load, 300)
    return () => clearTimeout(handle)
  }, [load])

  const act = async (fn: () => Promise<unknown>, fallback: string) => {
    try {
      await fn()
      load()
      return true
    } catch (err) {
      alert(errorText(err, fallback))
      return false
    }
  }

  const post = (d: BillingDoc) => {
    if (!window.confirm(`Post ${text.single} ${docNumber(d)} for ${formatMoney(d.total)}? It is booked to the journal and can no longer be edited.`)) return
    return act(() => api.post(d.id), `Failed to post the ${text.single}.`)
  }
  const cancel = (d: BillingDoc) => {
    if (!window.confirm(`Cancel ${text.single} ${docNumber(d)}? Its journal entry is removed.`)) return
    return act(() => withUnmatchConfirm((confirm) => api.cancel(d.id, confirm)), `Failed to cancel the ${text.single}.`)
  }
  const remove = (d: BillingDoc) => {
    if (!window.confirm(`Delete ${text.single} ${docNumber(d)}?`)) return
    return act(() => api.remove(d.id), `Failed to delete the ${text.single}.`)
  }

  const Icon = kind === 'sales' ? FileText : ShoppingCart
  const s = summary?.by_status

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={text.title}
        description={text.description}
        actions={<>
          <IconButton title="Refresh" onClick={load} disabled={loading}>
            <RefreshCw className={`h-[18px] w-[18px] stroke-[1.8] ${loading ? 'animate-spin' : ''}`} />
          </IconButton>
          {canCreate && <Button variant="contained" icon={<Plus />} onClick={() => setEditorDoc('new')}>New {text.single}</Button>}
        </>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile dark icon={<Wallet />} label="Outstanding" value={formatMoney(summary?.outstanding)}
          caption={kind === 'sales' ? 'Still to be received' : 'Still to be paid'} />
        <KpiTile tone="danger" icon={<AlertTriangle />} label="Overdue" value={formatMoney(summary?.overdue.amount)}
          caption={`${summary?.overdue.count ?? 0} past their due date`} />
        <KpiTile tone="neutral" icon={<FilePen />} label="Drafts" value={s?.DRAFT.count ?? 0} caption="Not posted yet" />
        <KpiTile tone="success" icon={<CheckCircle2 />} label="Paid" value={s?.PAID.count ?? 0} caption={formatMoney(s?.PAID.total)} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0) }}
            placeholder={`Search by ${text.single} number or notes…`} className="flex-1" />
          <div className="w-full lg:w-72">
            <PartySelect kind={text.partyKind} value={party} label={`Filter by ${text.partyLabel.toLowerCase()}`}
              onChange={(id) => { setParty(id); setPage(0) }} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Tabs<StatusFilter> value={status} onChange={(v) => { setStatus(v); setPage(0) }} options={[
            { value: 'ALL', label: 'All' }, { value: 'DRAFT', label: 'Draft' }, { value: 'POSTED', label: 'Unpaid' },
            { value: 'PARTIALLY_PAID', label: 'Partly paid' }, { value: 'PAID', label: 'Paid' }, { value: 'CANCELLED', label: 'Cancelled' },
          ]} />
          <Switch checked={overdueOnly} onChange={(v) => { setOverdueOnly(v); setPage(0) }} label="Overdue only" />
        </div>
      </div>

      <Panel className="overflow-hidden p-0">
        {loading && rows.length === 0 ? (
          <div className="flex justify-center p-16"><Spinner size={32} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Icon />} title={`No ${text.title.toLowerCase()} here.`}
            action={canCreate && status === 'ALL' && !search && <Button variant="contained" icon={<Plus />} onClick={() => setEditorDoc('new')}>New {text.single}</Button>} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-sm">
                <thead>
                  <tr className={TABLE_HEAD_ROW}>
                    <th className={TH}>Number</th>
                    <th className={TH}>{text.partyLabel}</th>
                    <th className={TH}>Date</th>
                    <th className={TH}>Due</th>
                    <th className={`${TH} text-right`}>Total</th>
                    <th className={`${TH} text-right`}>Balance due</th>
                    <th className={TH}>Status</th>
                    <th className={`${TH} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => {
                    const open = d.status === 'POSTED' || d.status === 'PARTIALLY_PAID'
                    return (
                      <tr key={d.id} className={TABLE_ROW}>
                        <td className={TD}>
                          <button type="button" className="num font-semibold text-primary hover:underline" onClick={() => setViewing(d.id)}>
                            {docNumber(d)}
                          </button>
                        </td>
                        <td className={TD}>{docParty(d)}</td>
                        <td className={`${TD} whitespace-nowrap`}>{formatDate(docDate(d))}</td>
                        <td className={`${TD} whitespace-nowrap ${isOverdue(d.status, d.due_date) ? 'font-semibold text-danger-text' : ''}`}>{formatDate(d.due_date)}</td>
                        <td className={`${TD} num text-right`}>{formatMoney(d.total)}</td>
                        <td className={`${TD} num text-right font-semibold`}>{open ? formatMoney(d.balance_due) : '—'}</td>
                        <td className={TD}><StatusChip status={d.status} overdue={isOverdue(d.status, d.due_date)} /></td>
                        <td className={`${TD} text-right`}>
                          <div className="inline-flex items-center gap-1">
                            <RowAction onClick={() => setViewing(d.id)} title="View"><Eye /></RowAction>
                            {d.status === 'DRAFT' && canEdit && <RowAction onClick={() => setEditorDoc(d)} title="Edit draft"><Pencil /></RowAction>}
                            {d.status === 'DRAFT' && canEdit && <RowAction onClick={() => post(d)} title="Post"><Send /></RowAction>}
                            {open && canPay && hasPage('payments') && <RowAction onClick={() => setPaying(d)} title={text.pay}><HandCoins /></RowAction>}
                            {(d.status === 'DRAFT' || d.status === 'CANCELLED') && canDelete && <RowAction danger onClick={() => remove(d)} title="Delete"><Trash2 /></RowAction>}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination count={count} page={page} rowsPerPage={rowsPerPage} onPageChange={setPage}
              onRowsPerPageChange={(r) => { setRowsPerPage(r); setPage(0) }} />
          </>
        )}
      </Panel>

      {editorDoc && (
        <DocEditor kind={kind} doc={editorDoc === 'new' ? null : editorDoc} onClose={() => setEditorDoc(null)}
          onSaved={(saved) => { setEditorDoc(null); load(); setViewing(saved.id) }} />
      )}

      {viewing && (
        <DocDrawer kind={kind} id={viewing} onClose={() => setViewing(null)}
          onEdit={(d) => { setViewing(null); setEditorDoc(d) }}
          onPost={async (d) => { await post(d) }}
          onCancel={async (d) => { await cancel(d) }}
          onPay={(d) => setPaying(d)}
          canEdit={canEdit} canCreate={canCreate} canPay={canPay && hasPage('payments')}
          onChanged={load} />
      )}

      {paying && (
        <PaymentEditor open direction={kind === 'sales' ? 'RECEIPT' : 'PAYMENT'}
          partyId={docPartyId(paying)} partyName={docParty(paying)} focusDocId={paying.id}
          onClose={() => setPaying(null)} onSaved={() => { setPaying(null); load() }} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------

function DocDrawer({ kind, id, onClose, onEdit, onPost, onCancel, onPay, onChanged, canEdit, canCreate, canPay }: {
  kind: DocKind
  id: number
  onClose: () => void
  onEdit: (d: BillingDoc) => void
  onPost: (d: BillingDoc) => Promise<void>
  onCancel: (d: BillingDoc) => Promise<void>
  onPay: (d: BillingDoc) => void
  /** Something changed the document (a note) - refresh the list behind the drawer. */
  onChanged: () => void
  canEdit: boolean
  canCreate: boolean
  canPay: boolean
}) {
  const text = TEXT[kind]
  const noteName = kind === 'sales' ? 'Credit note' : 'Debit note'
  const [doc, setDoc] = useState<BillingDoc | null>(null)
  const [error, setError] = useState('')
  const [noting, setNoting] = useState(false)

  const cancelNote = async (noteId: number, number: string) => {
    if (!window.confirm(`Cancel ${number}? Its journal entry is removed and the amount goes back onto the ${text.single}.`)) return
    try {
      await withUnmatchConfirm((confirm) => creditNotesApi.cancel(noteId, confirm))
      reload()
      onChanged()
    } catch (err) {
      alert(errorText(err, 'Failed to cancel the note.'))
    }
  }
  const reload = useCallback(() => {
    docsApi(kind).get(id).then(setDoc).catch((err) => setError(errorText(err, 'Failed to load.')))
  }, [kind, id])
  useEffect(reload, [reload])

  const open = doc && (doc.status === 'POSTED' || doc.status === 'PARTIALLY_PAID')

  return (
    <Drawer onClose={onClose} widthClassName="w-full sm:w-[620px] md:w-[720px]"
      title={<div>
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-primary">{text.single}</p>
        <h2 className="num font-display text-xl font-bold text-ink">{doc ? docNumber(doc) : '…'}</h2>
      </div>}>
      {error && <Alert>{error}</Alert>}
      {!doc && !error && <div className="flex justify-center p-10"><Spinner size={28} /></div>}
      {doc && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={doc.status} overdue={isOverdue(doc.status, doc.due_date)} />
            {doc.journal_entry_number && <span className="num text-xs text-muted">Journal entry {doc.journal_entry_number}</span>}
          </div>

          <div className="grid grid-cols-2 gap-4 rounded-xl bg-surface-muted p-4 sm:grid-cols-4">
            <Field label={text.partyLabel}>{docParty(doc)}</Field>
            <Field label="Date">{formatDate(docDate(doc))}</Field>
            <Field label="Due">{formatDate(doc.due_date)}</Field>
            <Field label="Created by">{doc.created_by ?? '—'}</Field>
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className={TABLE_HEAD_ROW}>
                <th className={TH}>Item</th>
                <th className={`${TH} text-right`}>Qty</th>
                <th className={`${TH} text-right`}>Price</th>
                <th className={`${TH} text-right`}>GST</th>
                <th className={`${TH} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {doc.items?.map((i) => (
                <tr key={i.id} className={TABLE_ROW}>
                  <td className={TD}>
                    <p className="font-semibold">{i.description}</p>
                    <p className="text-xs text-muted">{i.account_name}{Number(i.discount_percent) ? ` · ${Number(i.discount_percent)}% off` : ''}</p>
                  </td>
                  <td className={`${TD} num text-right`}>{i.quantity}</td>
                  <td className={`${TD} num text-right`}>{formatMoney(i.unit_price)}</td>
                  <td className={`${TD} num text-right`}>{i.tax_percent ? `${Number(i.tax_percent)}%` : '—'}</td>
                  <td className={`${TD} num text-right`}>{formatMoney(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="ml-auto flex w-full max-w-xs flex-col gap-1.5 text-sm">
            <Row label="Subtotal" value={formatMoney(doc.subtotal)} />
            <Row label="GST" value={formatMoney(doc.tax_amount)} />
            <Row label="Total" value={formatMoney(doc.total)} strong />
            <Row label="Paid" value={formatMoney(doc.amount_paid)} />
            {Number(doc.amount_credited) > 0 && <Row label={kind === 'sales' ? 'Credited' : 'Debit notes'} value={formatMoney(doc.amount_credited)} />}
            <Row label="Balance due" value={formatMoney(doc.balance_due)} strong />
          </div>

          {doc.notes && <p className="whitespace-pre-wrap rounded-xl border border-border-soft p-3 text-sm text-muted">{doc.notes}</p>}

          {!!doc.credit_notes?.length && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-muted">{noteName}s</p>
              {doc.credit_notes.map((n) => (
                <div key={n.id} className="flex items-center justify-between gap-2 border-b border-border-soft py-2 text-sm last:border-0">
                  <span className={n.status === 'CANCELLED' ? 'text-muted line-through' : ''}>
                    <span className="num font-semibold">{n.note_number}</span> · {formatDate(n.note_date)}
                    {n.reason && <span className="text-muted"> · {n.reason}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="num">{formatMoney(n.total)}</span>
                    {n.status === 'POSTED' && canEdit && (
                      <button type="button" title="Cancel note" onClick={() => cancelNote(n.id, n.note_number)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-danger-text hover:bg-danger-soft">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!!doc.payments?.length && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-muted">Payments</p>
              {doc.payments.map((p) => (
                <div key={p.id} className="flex justify-between border-b border-border-soft py-2 text-sm last:border-0">
                  <span><span className="num font-semibold">{p.payment_number}</span> · {formatDate(p.payment_date)}</span>
                  <span className="num">{formatMoney(p.amount)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-border-soft pt-4">
            {doc.status === 'DRAFT' && canEdit && <>
              <Button variant="outlined" icon={<Pencil />} onClick={() => onEdit(doc)}>Edit</Button>
              <Button variant="contained" icon={<Send />} onClick={async () => { await onPost(doc); reload() }}>Post</Button>
            </>}
            {open && canPay && <Button variant="contained" icon={<HandCoins />} onClick={() => onPay(doc)}>{text.pay}</Button>}
            {open && canCreate && Number(doc.balance_due) > 0 && (
              <Button variant="outlined" icon={<FileMinus />} onClick={() => setNoting(true)}>{noteName}</Button>
            )}
            {doc.status !== 'DRAFT' && doc.status !== 'CANCELLED' && canEdit && !doc.payments?.length
              && !doc.credit_notes?.some((n) => n.status === 'POSTED') && (
              <Button variant="outlined" color="error" icon={<Ban />} onClick={async () => { await onCancel(doc); reload() }}>Cancel {text.single}</Button>
            )}
          </div>
        </div>
      )}
      {noting && doc && (
        <CreditNoteDialog kind={kind} doc={doc} onClose={() => setNoting(false)}
          onSaved={() => { setNoting(false); reload(); onChanged() }} />
      )}
    </Drawer>
  )
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'border-t border-border-soft pt-1.5 font-bold text-ink' : 'text-muted'}`}>
      <span>{label}</span><span className="num">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editor (create / edit a draft)
// ---------------------------------------------------------------------------

interface Line {
  key: number
  product: SearchableOption | null
  description: string
  quantity: string
  unit_price: string
  discount_percent: string
  tax_rate_id: number | null
  account_id: number | null
  account_label: string | null
}

let lineKey = 0
const blankLine = (): Line => ({
  key: ++lineKey, product: null, description: '', quantity: '1', unit_price: '', discount_percent: '0',
  tax_rate_id: null, account_id: null, account_label: null,
})

const round2 = (n: number) => Math.round(n * 100) / 100

function lineAmounts(line: Line, rates: TaxRate[]) {
  const amount = round2((Number(line.quantity) || 0) * (Number(line.unit_price) || 0) * (100 - (Number(line.discount_percent) || 0)) / 100)
  const rate = rates.find((r) => r.id === line.tax_rate_id)
  const tax = rate ? round2(amount * Number(rate.rate) / 100) : 0
  return { amount, tax }
}

function DocEditor({ kind, doc, onClose, onSaved }: {
  kind: DocKind
  doc: BillingDoc | null
  onClose: () => void
  onSaved: (doc: BillingDoc) => void
}) {
  const text = TEXT[kind]
  const api = docsApi(kind)
  const [party, setParty] = useState<number | null>(doc ? docPartyId(doc) : null)
  const [number, setNumber] = useState(doc ? docNumber(doc) : '')
  const [date, setDate] = useState(doc ? docDate(doc) : todayIso())
  const [dueDate, setDueDate] = useState(doc?.due_date ?? '')
  const [notes, setNotes] = useState(doc?.notes ?? '')
  const [lines, setLines] = useState<Line[]>(() => doc?.items?.length
    ? doc.items.map((i) => ({
      key: ++lineKey, product: i.product ? { id: i.product, label: i.product_name ?? '' } : null,
      description: i.description, quantity: String(Number(i.quantity)), unit_price: i.unit_price,
      discount_percent: String(Number(i.discount_percent)), tax_rate_id: i.tax_rate, account_id: i.account,
      account_label: i.account_name,
    }))
    : [blankLine()])
  const [rates, setRates] = useState<TaxRate[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { taxRatesApi.list({ is_active: true }).then(setRates).catch(() => {}) }, [])
  useEffect(() => {
    if (!doc && kind === 'sales') api.nextNumber().then((n) => setNumber((cur) => cur || n || '')).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totals = useMemo(() => lines.reduce((acc, l) => {
    const { amount, tax } = lineAmounts(l, rates)
    return { subtotal: acc.subtotal + amount, tax: acc.tax + tax }
  }, { subtotal: 0, tax: 0 }), [lines, rates])

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const pickProduct = (key: number, opt: SearchableOption | null) => {
    const p = opt?.meta as Product | undefined
    if (!p) {
      update(key, { product: null })
      return
    }
    update(key, {
      product: opt,
      description: p.name,
      unit_price: kind === 'sales' ? p.sale_price : p.purchase_price,
      tax_rate_id: p.tax_rate,
      account_id: kind === 'sales' ? p.income_account : p.expense_account,
      account_label: kind === 'sales' ? p.income_account_name : p.expense_account_name,
    })
  }

  const save = async (postToo: boolean) => {
    if (!party) {
      setError(`Choose the ${text.partyLabel.toLowerCase()}.`)
      return
    }
    if (kind === 'purchase' && !number.trim()) {
      setError("Enter the supplier's bill number.")
      return
    }
    const items: ItemPayload[] = lines
      .filter((l) => l.description.trim() || l.product)
      .map((l) => ({
        product_id: l.product?.id ?? null, description: l.description.trim(), quantity: l.quantity || '1',
        unit_price: l.unit_price || '0', discount_percent: l.discount_percent || '0', tax_rate_id: l.tax_rate_id,
        account_id: l.account_id,
      }))
    if (!items.length) {
      setError('Add at least one line.')
      return
    }
    const payload: Record<string, unknown> = {
      [kind === 'sales' ? 'client_id' : 'supplier_id']: party,
      [kind === 'sales' ? 'invoice_number' : 'bill_number']: number.trim() || undefined,
      [kind === 'sales' ? 'invoice_date' : 'bill_date']: date,
      due_date: dueDate || null,
      notes,
      items,
    }
    setSaving(true)
    setError('')
    try {
      let saved = doc ? await api.update(doc.id, payload) : await api.create(payload)
      if (postToo) saved = await api.post(saved.id)
      onSaved(saved)
    } catch (err) {
      setError(errorText(err, `Failed to save the ${text.single}.`))
    } finally {
      setSaving(false)
    }
  }

  const fetchProducts = async ({ search, page }: { search: string; page: number }) => {
    const res = await productsApi.search({ search: search.trim() || undefined, is_active: true, page, limit: 20 })
    return { options: res.results.map((p) => ({ id: p.id, label: p.name, meta: p })), hasMore: Boolean(res.next) }
  }

  return (
    <Modal open onClose={onClose} icon={kind === 'sales' ? <FileText /> : <ShoppingCart />}
      title={doc ? `Edit ${text.single} ${docNumber(doc)}` : `New ${text.single}`}
      subtitle="Saved as a draft until you post it."
      widthClassName="max-w-5xl"
      footerHint={<span className="num">Subtotal {formatMoney(totals.subtotal)} · GST {formatMoney(totals.tax)} · <b className="text-ink">Total {formatMoney(totals.subtotal + totals.tax)}</b></span>}
      footer={<>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        <Button variant="outlined" onClick={() => save(false)} disabled={saving}>Save draft</Button>
        <Button variant="contained" icon={<Send />} onClick={() => save(true)} disabled={saving}>Save & post</Button>
      </>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="md:col-span-2">
          <PartySelect kind={text.partyKind} value={party} valueLabel={doc ? docParty(doc) : null} required
            onChange={(id) => setParty(id)} />
        </div>
        <TextField id="doc-number" label={kind === 'sales' ? 'Invoice number' : "Supplier's bill number"} required={kind === 'purchase'}
          value={number} inputClassName="num" onChange={(e) => setNumber(e.target.value)}
          placeholder={kind === 'sales' ? 'Auto' : 'e.g. PC-778'} />
        <DateField id="doc-date" label={kind === 'sales' ? 'Invoice date' : 'Bill date'} value={date} onChange={setDate} />
        <DateField id="doc-due" label="Due date (default: payment terms)" value={dueDate} onChange={setDueDate} min={date} />
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.06em] text-muted">Lines</p>
        {lines.map((l, idx) => {
          const { amount, tax } = lineAmounts(l, rates)
          return (
            <div key={l.key} className="grid grid-cols-2 gap-3 rounded-xl border border-border-soft p-3 md:grid-cols-12">
              <div className="col-span-2 md:col-span-4">
                <SearchableSelect label={`Line ${idx + 1} · product (optional)`} value={l.product}
                  onChange={(opt) => pickProduct(l.key, opt)} fetchOptions={fetchProducts} placeholder="Pick a product…" />
              </div>
              <TextField className="col-span-2 md:col-span-8" id={`l-desc-${l.key}`} label="Description" value={l.description}
                onChange={(e) => update(l.key, { description: e.target.value })} />
              <TextField className="md:col-span-2" id={`l-qty-${l.key}`} label="Qty" type="number" value={l.quantity} inputClassName="num"
                onChange={(e) => update(l.key, { quantity: e.target.value })} />
              <TextField className="md:col-span-2" id={`l-price-${l.key}`} label="Unit price" type="number" value={l.unit_price} inputClassName="num"
                onChange={(e) => update(l.key, { unit_price: e.target.value })} />
              <TextField className="md:col-span-1" id={`l-disc-${l.key}`} label="Disc %" type="number" value={l.discount_percent} inputClassName="num"
                onChange={(e) => update(l.key, { discount_percent: e.target.value })} />
              <div className="md:col-span-2">
                <Select id={`l-tax-${l.key}`} label="GST" value={l.tax_rate_id ?? ''}
                  onChange={(e) => update(l.key, { tax_rate_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">No tax</option>
                  {rates.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </div>
              <div className="col-span-2 md:col-span-4">
                <AccountSelect label={kind === 'sales' ? 'Income account' : 'Expense account'} required
                  accountType={kind === 'sales' ? 'INCOME' : undefined}
                  value={l.account_id} valueLabel={l.account_label}
                  onChange={(id) => update(l.key, { account_id: id, account_label: null })} />
              </div>
              <div className="col-span-2 flex items-end justify-between gap-2 md:col-span-1 md:flex-col md:items-end">
                <span className="num text-sm font-semibold text-ink" title={`GST ${formatMoney(tax)}`}>{formatMoney(amount)}</span>
                {lines.length > 1 && (
                  <button type="button" title="Remove line" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-danger-text hover:bg-danger-soft">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
        <div>
          <Button variant="outlined" size="sm" icon={<Plus />} onClick={() => setLines((ls) => [...ls, blankLine()])}>Add line</Button>
        </div>
      </div>

      <TextField id="doc-notes" label="Notes" multiline rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
    </Modal>
  )
}
