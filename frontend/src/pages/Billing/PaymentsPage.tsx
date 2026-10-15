import { useCallback, useEffect, useMemo, useState } from 'react'
import { HandCoins, ArrowDownLeft, ArrowUpRight, Trash2, RefreshCw, Eye, X, Link2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import Pagination, { DEFAULT_ROWS_PER_PAGE } from '../../components/Pagination'
import BankAccountSelect from '../../components/BankAccountSelect'
import { Alert, Button, Chip, DateField, Drawer, IconButton, Modal, Panel, Select, Spinner, Tabs, TextField } from '../../components/tw'
import { EmptyState, KpiTile, PageHeader, RowAction, SearchBox } from '../../components/PageParts'
import { formatMoney } from '../../utils/periods'
import { withUnmatchConfirm } from '../../utils/reconcileConfirm'
import { errorText, openDocuments, paymentsApi } from './billingapi'
import type { BillingDoc, Payment, PaymentDirection, PaymentMethod } from './billingapi'
import { Field, METHOD_LABELS, PartySelect, TABLE_HEAD_ROW, TABLE_ROW, TD, TH, formatDate, todayIso } from './billingParts'

type DirectionFilter = 'ALL' | PaymentDirection

const docNumberOf = (d: BillingDoc) => d.invoice_number ?? d.bill_number ?? ''
const docDateOf = (d: BillingDoc) => d.invoice_date ?? d.bill_date ?? ''

export default function PaymentsPage() {
  const { can } = useAuth()
  const [rows, setRows] = useState<Payment[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [direction, setDirection] = useState<DirectionFilter>('ALL')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE)
  const [creating, setCreating] = useState<PaymentDirection | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await paymentsApi.search({
        search: search.trim() || undefined, direction: direction === 'ALL' ? undefined : direction,
        page: page + 1, limit: rowsPerPage,
      })
      setRows(data.results)
      setCount(data.count)
    } finally {
      setLoading(false)
    }
  }, [search, direction, page, rowsPerPage])

  useEffect(() => {
    const handle = setTimeout(load, 300)
    return () => clearTimeout(handle)
  }, [load])

  const remove = async (p: Payment) => {
    if (!window.confirm(`Delete ${p.payment_number} (${formatMoney(p.amount)})? Its journal entry is removed and the invoices / bills it paid become unpaid again.`)) return
    try {
      await withUnmatchConfirm((confirm) => paymentsApi.remove(p.id, confirm))
      load()
    } catch (err) {
      alert(errorText(err, 'Failed to delete the payment.'))
    }
  }

  const received = rows.filter((p) => p.direction === 'RECEIPT').reduce((s, p) => s + Number(p.amount), 0)
  const paid = rows.filter((p) => p.direction === 'PAYMENT').reduce((s, p) => s + Number(p.amount), 0)
  const unallocated = rows.reduce((s, p) => s + Number(p.unallocated), 0)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payments & receipts"
        description="Money received from clients and paid to suppliers. Each one is booked to the journal and can be split across invoices or bills."
        actions={<>
          <IconButton title="Refresh" onClick={load} disabled={loading}>
            <RefreshCw className={`h-[18px] w-[18px] stroke-[1.8] ${loading ? 'animate-spin' : ''}`} />
          </IconButton>
          {can('payments', 'create') && <>
            <Button variant="outlined" icon={<ArrowUpRight />} onClick={() => setCreating('PAYMENT')}>Pay a supplier</Button>
            <Button variant="contained" icon={<ArrowDownLeft />} onClick={() => setCreating('RECEIPT')}>Record a receipt</Button>
          </>}
        </>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile tone="success" icon={<ArrowDownLeft />} label="Received (this page)" value={formatMoney(received)} caption="Receipts from clients" />
        <KpiTile tone="danger" icon={<ArrowUpRight />} label="Paid (this page)" value={formatMoney(paid)} caption="Payments to suppliers" />
        <KpiTile tone="warning" icon={<Link2 />} label="Not allocated" value={formatMoney(unallocated)} caption="Advances not applied to a document" />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0) }}
          placeholder="Search by number, reference or notes…" className="flex-1" />
        <Tabs<DirectionFilter> value={direction} onChange={(v) => { setDirection(v); setPage(0) }}
          options={[{ value: 'ALL', label: 'All' }, { value: 'RECEIPT', label: 'Receipts' }, { value: 'PAYMENT', label: 'Payments' }]} />
      </div>

      <Panel className="overflow-hidden p-0">
        {loading && rows.length === 0 ? (
          <div className="flex justify-center p-16"><Spinner size={32} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<HandCoins />} title="No payments here yet." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className={TABLE_HEAD_ROW}>
                    <th className={TH}>Number</th>
                    <th className={TH}>Party</th>
                    <th className={TH}>Date</th>
                    <th className={TH}>Method</th>
                    <th className={`${TH} text-right`}>Amount</th>
                    <th className={`${TH} text-right`}>Not allocated</th>
                    <th className={`${TH} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className={TABLE_ROW}>
                      <td className={TD}>
                        <button type="button" className="num font-semibold text-primary hover:underline" onClick={() => setViewing(p.id)}>
                          {p.payment_number}
                        </button>
                        <div><Chip tone={p.direction === 'RECEIPT' ? 'success' : 'warning'}>{p.direction === 'RECEIPT' ? 'Receipt' : 'Payment'}</Chip></div>
                      </td>
                      <td className={TD}>{p.party_name}</td>
                      <td className={`${TD} whitespace-nowrap`}>{formatDate(p.payment_date)}</td>
                      <td className={TD}>
                        <p>{METHOD_LABELS[p.method]}</p>
                        <p className="text-xs text-muted">{p.bank_account_name ?? 'Cash'}{p.reference_number ? ` · ${p.reference_number}` : ''}</p>
                      </td>
                      <td className={`${TD} num text-right font-semibold`}>{formatMoney(p.amount)}</td>
                      <td className={`${TD} num text-right ${Number(p.unallocated) > 0 ? 'text-warning-text' : 'text-muted'}`}>{formatMoney(p.unallocated)}</td>
                      <td className={`${TD} text-right`}>
                        <div className="inline-flex gap-1">
                          <RowAction onClick={() => setViewing(p.id)} title="View"><Eye /></RowAction>
                          {can('payments', 'delete') && <RowAction danger onClick={() => remove(p)} title="Delete"><Trash2 /></RowAction>}
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

      {creating && (
        <PaymentEditor open direction={creating} onClose={() => setCreating(null)}
          onSaved={(p) => { setCreating(null); load(); setViewing(p.id) }} />
      )}
      {viewing && <PaymentDrawer id={viewing} onClose={() => setViewing(null)} onChanged={load} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail drawer: allocations, allocate the rest, take an allocation off
// ---------------------------------------------------------------------------

function PaymentDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { can } = useAuth()
  const [payment, setPayment] = useState<Payment | null>(null)
  const [error, setError] = useState('')
  const [allocating, setAllocating] = useState(false)

  const reload = useCallback(() => {
    paymentsApi.get(id).then(setPayment).catch((err) => setError(errorText(err, 'Failed to load.')))
  }, [id])
  useEffect(reload, [reload])

  const removeAllocation = async (allocationId: number) => {
    if (!payment || !window.confirm('Take this allocation off? The document becomes unpaid by that amount.')) return
    try {
      setPayment(await paymentsApi.removeAllocation(payment.id, allocationId))
      onChanged()
    } catch (err) {
      alert(errorText(err, 'Failed to remove the allocation.'))
    }
  }

  const canEdit = can('payments', 'edit')
  return (
    <Drawer onClose={onClose} widthClassName="w-full sm:w-[560px]"
      title={<div>
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-primary">{payment?.direction === 'PAYMENT' ? 'Payment' : 'Receipt'}</p>
        <h2 className="num font-display text-xl font-bold text-ink">{payment?.payment_number ?? '…'}</h2>
      </div>}>
      {error && <Alert>{error}</Alert>}
      {!payment && !error && <div className="flex justify-center p-10"><Spinner size={28} /></div>}
      {payment && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4 rounded-xl bg-surface-muted p-4">
            <Field label={payment.direction === 'RECEIPT' ? 'From' : 'To'}>{payment.party_name}</Field>
            <Field label="Date">{formatDate(payment.payment_date)}</Field>
            <Field label="Amount">{formatMoney(payment.amount)}</Field>
            <Field label="Not allocated">{formatMoney(payment.unallocated)}</Field>
            <Field label="Method">{METHOD_LABELS[payment.method]}</Field>
            <Field label="Through">{payment.bank_account_name ?? 'Cash'}</Field>
            <Field label="Reference">{payment.reference_number || '—'}</Field>
            <Field label="Journal entry">{payment.journal_entry_number ?? '—'}</Field>
          </div>
          {payment.notes && <p className="whitespace-pre-wrap text-sm text-muted">{payment.notes}</p>}

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-muted">Applied to</p>
            {payment.allocations.length === 0 ? (
              <p className="text-sm text-muted">Not applied to any {payment.direction === 'RECEIPT' ? 'invoice' : 'bill'} yet.</p>
            ) : payment.allocations.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 border-b border-border-soft py-2 text-sm last:border-0">
                <span className="num font-semibold">{a.invoice_number ?? a.bill_number}</span>
                <span className="flex items-center gap-2">
                  <span className="num">{formatMoney(a.amount)}</span>
                  {canEdit && (
                    <button type="button" title="Remove allocation" onClick={() => removeAllocation(a.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-danger-text hover:bg-danger-soft">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>

          {canEdit && Number(payment.unallocated) > 0 && (
            <div><Button variant="contained" icon={<Link2 />} onClick={() => setAllocating(true)}>Allocate the rest</Button></div>
          )}
        </div>
      )}
      {allocating && payment && (
        <AllocateDialog payment={payment} onClose={() => setAllocating(false)}
          onSaved={(p) => { setAllocating(false); setPayment(p); onChanged() }} />
      )}
    </Drawer>
  )
}

function AllocateDialog({ payment, onClose, onSaved }: { payment: Payment; onClose: () => void; onSaved: (p: Payment) => void }) {
  const kind = payment.direction === 'RECEIPT' ? 'sales' : 'purchase'
  const partyId = payment.client ?? payment.supplier ?? 0
  const [docs, setDocs] = useState<BillingDoc[] | null>(null)
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    openDocuments(kind, partyId).then((list) => {
      setDocs(list)
      setAmounts(autoAllocate(list, Number(payment.unallocated)))
    }).catch(() => setDocs([]))
  }, [kind, partyId, payment.unallocated])

  const save = async () => {
    const allocations = allocationPayload(kind, amounts)
    if (!allocations.length) {
      setError('Enter an amount against at least one document.')
      return
    }
    try {
      onSaved(await paymentsApi.allocate(payment.id, allocations))
    } catch (err) {
      setError(errorText(err, 'Failed to allocate.'))
    }
  }

  return (
    <Modal open onClose={onClose} icon={<Link2 />} title={`Allocate ${payment.payment_number}`}
      subtitle={`${formatMoney(payment.unallocated)} left to apply`} widthClassName="max-w-2xl"
      footer={<><Button variant="outlined" onClick={onClose}>Cancel</Button><Button variant="contained" onClick={save}>Allocate</Button></>}>
      {error && <Alert>{error}</Alert>}
      <AllocationTable docs={docs} amounts={amounts} onChange={setAmounts} />
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Allocation helpers + table
// ---------------------------------------------------------------------------

/** Spreads `amount` over the documents oldest first, up to each one's balance due. */
function autoAllocate(docs: BillingDoc[], amount: number, focusId?: number | null): Record<number, string> {
  let left = Math.round(amount * 100) / 100
  const result: Record<number, string> = {}
  const ordered = focusId ? [...docs.filter((d) => d.id === focusId), ...docs.filter((d) => d.id !== focusId)] : docs
  for (const d of ordered) {
    if (left <= 0) break
    const take = Math.min(left, Number(d.balance_due))
    if (take > 0) {
      result[d.id] = take.toFixed(2)
      left = Math.round((left - take) * 100) / 100
    }
  }
  return result
}

function allocationPayload(kind: 'sales' | 'purchase', amounts: Record<number, string>) {
  return Object.entries(amounts)
    .filter(([, v]) => Number(v) > 0)
    .map(([docId, v]) => ({ [kind === 'sales' ? 'sales_invoice_id' : 'purchase_bill_id']: Number(docId), amount: Number(v).toFixed(2) }))
}

function AllocationTable({ docs, amounts, onChange }: {
  docs: BillingDoc[] | null
  amounts: Record<number, string>
  onChange: (amounts: Record<number, string>) => void
}) {
  if (docs === null) return <div className="flex justify-center p-6"><Spinner size={24} /></div>
  if (docs.length === 0) return <p className="text-sm text-muted">No open documents - the whole amount stays as an advance.</p>
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className={TABLE_HEAD_ROW}>
          <th className={TH}>Document</th>
          <th className={TH}>Due</th>
          <th className={`${TH} text-right`}>Balance due</th>
          <th className={`${TH} w-40 text-right`}>Apply</th>
        </tr>
      </thead>
      <tbody>
        {docs.map((d) => (
          <tr key={d.id} className={TABLE_ROW}>
            <td className={TD}><p className="num font-semibold">{docNumberOf(d)}</p><p className="text-xs text-muted">{formatDate(docDateOf(d))}</p></td>
            <td className={`${TD} whitespace-nowrap`}>{formatDate(d.due_date)}</td>
            <td className={`${TD} num text-right`}>{formatMoney(d.balance_due)}</td>
            <td className={`${TD} text-right`}>
              <input type="number" min={0} max={Number(d.balance_due)} step="0.01" value={amounts[d.id] ?? ''}
                onChange={(e) => onChange({ ...amounts, [d.id]: e.target.value })}
                className="num h-10 w-32 rounded-[10px] border border-input bg-surface px-2 text-right text-sm text-ink outline-none focus:border-primary focus:ring-[3px] focus:ring-primary-soft" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Payment editor (also opened from an invoice / bill)
// ---------------------------------------------------------------------------

export function PaymentEditor({ open, direction, partyId = null, partyName = null, focusDocId = null, onClose, onSaved }: {
  open: boolean
  direction: PaymentDirection
  partyId?: number | null
  partyName?: string | null
  /** The invoice / bill the payment was started from - allocated first. */
  focusDocId?: number | null
  onClose: () => void
  onSaved: (payment: Payment) => void
}) {
  const kind = direction === 'RECEIPT' ? 'sales' : 'purchase'
  const [party, setParty] = useState<number | null>(partyId)
  const [date, setDate] = useState(todayIso())
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER')
  const [bankAccount, setBankAccount] = useState<number | null>(null)
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [docs, setDocs] = useState<BillingDoc[] | null>(null)
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!party) {
      setDocs(null)
      return
    }
    setDocs(null)
    openDocuments(kind, party).then((list) => {
      setDocs(list)
      // Started from a document: pay its balance by default.
      const focus = list.find((d) => d.id === focusDocId)
      if (focus) {
        setAmount(focus.balance_due)
        setAmounts({ [focus.id]: focus.balance_due })
      } else {
        setAmounts({})
      }
    }).catch(() => setDocs([]))
  }, [kind, party, focusDocId])

  const allocated = useMemo(() => Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0), [amounts])

  const save = async () => {
    if (!party) return setError(`Choose the ${kind === 'sales' ? 'client' : 'supplier'}.`)
    if (!(Number(amount) > 0)) return setError('Enter an amount greater than 0.')
    if (method !== 'CASH' && !bankAccount) return setError('Choose the bank account (or pick Cash).')
    if (allocated - Number(amount) > 0.001) return setError('The allocations add up to more than the amount.')
    setSaving(true)
    setError('')
    try {
      const saved = await paymentsApi.create({
        direction, [direction === 'RECEIPT' ? 'client_id' : 'supplier_id']: party, payment_date: date,
        amount: Number(amount).toFixed(2), method, bank_account_id: method === 'CASH' ? bankAccount || null : bankAccount,
        reference_number: reference.trim(), notes, allocations: allocationPayload(kind, amounts),
      })
      onSaved(saved)
    } catch (err) {
      setError(errorText(err, 'Failed to save the payment.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} icon={direction === 'RECEIPT' ? <ArrowDownLeft /> : <ArrowUpRight />}
      title={direction === 'RECEIPT' ? 'Record a receipt' : 'Pay a supplier'}
      subtitle="Booked to the journal right away; anything not allocated stays as an advance."
      widthClassName="max-w-3xl"
      footerHint={<span className="num">Allocated {formatMoney(allocated)} of {formatMoney(amount)}</span>}
      footer={<>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PartySelect kind={kind === 'sales' ? 'clients' : 'suppliers'} value={party} valueLabel={partyName} required
          disabled={Boolean(partyId)} onChange={(id) => setParty(id)} />
        <DateField id="pay-date" label="Date" value={date} onChange={setDate} />
        <TextField id="pay-amount" label="Amount" required type="number" value={amount} inputClassName="num"
          onChange={(e) => setAmount(e.target.value)} />
        <Select id="pay-method" label="Method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {Object.entries(METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <BankAccountSelect value={bankAccount} onChange={(id) => setBankAccount(id)} required={method !== 'CASH'}
          label={method === 'CASH' ? 'Bank account (empty = Cash)' : 'Bank account'} placeholder="Choose a bank account" />
        <TextField id="pay-ref" label="Reference (cheque / UTR / UPI ref)" value={reference} onChange={(e) => setReference(e.target.value)} />
      </div>

      {party && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-muted">Apply to {kind === 'sales' ? 'invoices' : 'bills'}</p>
            {docs && docs.length > 0 && Number(amount) > 0 && (
              <Button variant="text" size="sm" onClick={() => setAmounts(autoAllocate(docs, Number(amount), focusDocId))}>
                Fill oldest first
              </Button>
            )}
          </div>
          <AllocationTable docs={docs} amounts={amounts} onChange={setAmounts} />
        </div>
      )}
      <TextField id="pay-notes" label="Notes" multiline rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
    </Modal>
  )
}
