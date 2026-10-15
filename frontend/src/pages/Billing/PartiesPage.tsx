import { useCallback, useEffect, useState } from 'react'
import { Contact, Truck, Plus, Pencil, Trash2, RefreshCw, FileText, Wallet, CheckCircle2, Download } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import Pagination, { DEFAULT_ROWS_PER_PAGE } from '../../components/Pagination'
import { Alert, Button, DateField, Drawer, IconButton, Modal, Panel, Select, Spinner, Switch, Tabs, TextField } from '../../components/tw'
import { stateFromGstin, stateOptions } from '../../constants/indianStates'
import { EmptyState, KpiTile, PageHeader, RowAction, SearchBox } from '../../components/PageParts'
import { formatMoney } from '../../utils/periods'
import { exportToExcel } from '../../utils/excelExport'
import { errorText, partiesApi } from './billingapi'
import type { Party, PartyKind, PartyStatement } from './billingapi'
import { AccountSelect, Field, TABLE_HEAD_ROW, TABLE_ROW, TD, TH, formatDate } from './billingParts'

type ActiveFilter = 'all' | 'active' | 'inactive'

interface FormState {
  name: string
  code: string
  contact_person: string
  email: string
  phone: string
  gstin: string
  pan: string
  state: string
  payment_terms_days: string
  opening_balance: string
  opening_balance_date: string
  address: string
  shipping_address: string
  account: number | null
  is_active: boolean
}

const EMPTY: FormState = {
  name: '', code: '', contact_person: '', email: '', phone: '', gstin: '', pan: '', state: '',
  payment_terms_days: '30', opening_balance: '0', opening_balance_date: '', address: '', shipping_address: '', account: null, is_active: true,
}

const TEXT = {
  clients: {
    title: 'Clients', single: 'client', description: 'Customers you invoice. Their outstanding balance comes from posted invoices and receipts.',
    accountLabel: 'Receivable account (optional)', accountHint: 'Leave empty to use the default Accounts Receivable.',
    owe: 'They owe you', addressLabel: 'Billing address',
  },
  suppliers: {
    title: 'Suppliers', single: 'supplier', description: 'Vendors you buy from. Their outstanding balance comes from posted bills and payments.',
    accountLabel: 'Payable account (optional)', accountHint: 'Leave empty to use the default Accounts Payable.',
    owe: 'You owe them', addressLabel: 'Address',
  },
} as const

export default function PartiesPage({ kind }: { kind: PartyKind }) {
  const text = TEXT[kind]
  const api = partiesApi(kind)
  const { can } = useAuth()
  const canCreate = can(kind, 'create')
  const canEdit = can(kind, 'edit')
  const canDelete = can(kind, 'delete')

  const [rows, setRows] = useState<Party[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [active, setActive] = useState<ActiveFilter>('active')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE)

  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<Party | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [statementFor, setStatementFor] = useState<Party | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const data = await api.search({
        search: search.trim() || undefined,
        is_active: active === 'all' ? undefined : active === 'active',
        page: page + 1,
        limit: rowsPerPage,
      })
      setRows(data.results)
      setCount(data.count)
    } catch {
      setLoadError(`Failed to load ${text.title.toLowerCase()}.`)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, search, active, page, rowsPerPage])

  useEffect(() => {
    const handle = setTimeout(load, 300)
    return () => clearTimeout(handle)
  }, [load])

  useEffect(() => { setPage(0) }, [kind])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY)
    setFormError('')
    setDialog(true)
  }

  const openEdit = (p: Party) => {
    setEditing(p)
    setForm({
      name: p.name, code: p.code ?? '', contact_person: p.contact_person, email: p.email, phone: p.phone,
      gstin: p.gstin ?? '', pan: p.pan, state: p.state, payment_terms_days: String(p.payment_terms_days),
      opening_balance: p.opening_balance, opening_balance_date: p.opening_balance_date ?? '', address: (kind === 'clients' ? p.billing_address : p.address) ?? '',
      shipping_address: p.shipping_address ?? '',
      account: (kind === 'clients' ? p.receivable_account : p.payable_account) ?? null, is_active: p.is_active,
    })
    setFormError('')
    setDialog(true)
  }

  const save = async () => {
    if (!form.name.trim()) {
      setFormError('Please enter a name.')
      return
    }
    const payload: Record<string, unknown> = {
      name: form.name.trim(), code: form.code.trim() || null, contact_person: form.contact_person.trim(),
      email: form.email.trim(), phone: form.phone.trim(), gstin: form.gstin.trim() || null, pan: form.pan.trim(),
      state: form.state.trim(), payment_terms_days: Number(form.payment_terms_days) || 0,
      opening_balance: form.opening_balance || '0', opening_balance_date: form.opening_balance_date || null,
      is_active: form.is_active,
    }
    if (kind === 'clients') {
      payload.billing_address = form.address
      payload.shipping_address = form.shipping_address
      payload.receivable_account = form.account
    } else {
      payload.address = form.address
      payload.payable_account = form.account
    }
    setSaving(true)
    setFormError('')
    try {
      if (editing) await api.update(editing.id, payload)
      else await api.create(payload)
      setDialog(false)
      load()
    } catch (err) {
      setFormError(errorText(err, `Failed to save the ${text.single}.`))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (p: Party) => {
    if (!window.confirm(`Delete ${text.single} "${p.name}"?`)) return
    try {
      await api.remove(p.id)
      load()
    } catch (err) {
      alert(errorText(err, `Failed to delete the ${text.single}.`))
    }
  }

  const exportExcel = async () => {
    try {
      const data = await api.search({ limit: 500, is_active: active === 'all' ? undefined : active === 'active' })
      await exportToExcel(`${text.title}.xlsx`, text.title, [
        { header: 'Name', key: 'name', width: 30 },
        { header: 'Code', key: 'code', width: 12 },
        { header: 'Contact', key: 'contact_person', width: 22 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'Phone', key: 'phone', width: 16 },
        { header: 'GSTIN', key: 'gstin', width: 18 },
        { header: 'Payment terms (days)', key: 'payment_terms_days', width: 18 },
        { header: 'Outstanding', key: 'outstanding', width: 16 },
      ], data.results.map((p) => ({ ...p, code: p.code ?? '', gstin: p.gstin ?? '', outstanding: Number(p.outstanding ?? 0) })))
    } catch {
      alert('Failed to export.')
    }
  }

  const totalOutstanding = rows.reduce((sum, p) => sum + Number(p.outstanding ?? 0), 0)
  const Icon = kind === 'clients' ? Contact : Truck

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={text.title}
        description={text.description}
        actions={
          <>
            <Button variant="outlined" icon={<Download />} onClick={exportExcel}>Export</Button>
            <IconButton title="Refresh" onClick={load} disabled={loading}>
              <RefreshCw className={`h-[18px] w-[18px] stroke-[1.8] ${loading ? 'animate-spin' : ''}`} />
            </IconButton>
            {canCreate && <Button variant="contained" icon={<Plus />} onClick={openCreate}>Add {text.single}</Button>}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile tone="primary" icon={<Icon />} label={`${text.title} (this filter)`} value={count} caption="Matching the search and status" />
        <KpiTile tone="warning" icon={<Wallet />} label="Outstanding on this page" value={formatMoney(totalOutstanding)} caption={text.owe} />
        <KpiTile tone="success" icon={<CheckCircle2 />} label="With nothing due" value={rows.filter((p) => Number(p.outstanding ?? 0) === 0).length} caption="On this page" />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0) }}
          placeholder="Search by name, code, contact, email, phone or GSTIN…" className="flex-1" />
        <Tabs<ActiveFilter> value={active} onChange={(v) => { setActive(v); setPage(0) }}
          options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'all', label: 'All' }]} />
      </div>

      {loadError && <Alert>{loadError}</Alert>}

      <Panel className="overflow-hidden p-0">
        {loading && rows.length === 0 ? (
          <div className="flex justify-center p-16"><Spinner size={32} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Icon />} title={search ? `No ${text.title.toLowerCase()} match your search.` : `No ${text.title.toLowerCase()} yet.`}
            action={!search && canCreate && <Button variant="contained" icon={<Plus />} onClick={openCreate}>Add your first {text.single}</Button>} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className={TABLE_HEAD_ROW}>
                    <th className={TH}>Name</th>
                    <th className={TH}>Contact</th>
                    <th className={TH}>GSTIN</th>
                    <th className={`${TH} text-right`}>Terms</th>
                    <th className={`${TH} text-right`}>Outstanding</th>
                    <th className={`${TH} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className={TABLE_ROW}>
                      <td className={TD}>
                        <p className="font-semibold">{p.name}</p>
                        <p className="text-xs text-muted">
                          {p.code ? `${p.code} · ` : ''}{p.state || '—'}{!p.is_active && ' · Inactive'}
                        </p>
                      </td>
                      <td className={TD}>
                        <p>{p.contact_person || '—'}</p>
                        <p className="text-xs text-muted">{[p.email, p.phone].filter(Boolean).join(' · ') || '—'}</p>
                      </td>
                      <td className={`${TD} num text-[13px]`}>{p.gstin || '—'}</td>
                      <td className={`${TD} num text-right`}>{p.payment_terms_days} days</td>
                      <td className={`${TD} num text-right font-semibold ${Number(p.outstanding) > 0 ? 'text-warning-text' : ''}`}>
                        {formatMoney(p.outstanding)}
                      </td>
                      <td className={`${TD} text-right`}>
                        <div className="inline-flex items-center gap-1">
                          <RowAction onClick={() => setStatementFor(p)} title="Statement"><FileText /></RowAction>
                          {canEdit && <RowAction onClick={() => openEdit(p)} title="Edit"><Pencil /></RowAction>}
                          {canDelete && <RowAction danger onClick={() => remove(p)} title="Delete"><Trash2 /></RowAction>}
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

      <Modal
        open={dialog}
        onClose={() => setDialog(false)}
        icon={<Icon />}
        title={editing ? `Edit ${text.single}` : `Add ${text.single}`}
        widthClassName="max-w-2xl"
        footer={
          <>
            <Button variant="outlined" onClick={() => setDialog(false)}>Cancel</Button>
            <Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        {formError && <Alert>{formError}</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField id="p-name" label="Name" required autoFocus value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField id="p-code" label="Code (optional)" value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <TextField id="p-contact" label="Contact person" value={form.contact_person}
            onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
          <TextField id="p-email" label="Email" type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <TextField id="p-phone" label="Phone" value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Select id="p-state" label="State (place of supply)" value={form.state}
            onChange={(e) => setForm({ ...form, state: e.target.value })}>
            <option value="">Not set</option>
            {stateOptions(form.state).map((name) => <option key={name} value={name}>{name}</option>)}
          </Select>
          {/* The GSTIN's first two digits are the state code - fill the state in when it is still empty. */}
          <TextField id="p-gstin" label="GSTIN" placeholder="15 characters" value={form.gstin} inputClassName="num uppercase"
            onChange={(e) => setForm({ ...form, gstin: e.target.value, state: form.state || stateFromGstin(e.target.value) })} />
          <TextField id="p-pan" label="PAN" value={form.pan} inputClassName="num uppercase"
            onChange={(e) => setForm({ ...form, pan: e.target.value })} />
          <TextField id="p-terms" label="Payment terms (days)" type="number" value={form.payment_terms_days} inputClassName="num"
            onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })} />
          <TextField id="p-opening" label="Opening balance" type="number" value={form.opening_balance} inputClassName="num"
            onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} />
          <DateField id="p-opening-date" label="Opening balance as of (default: today)" value={form.opening_balance_date}
            onChange={(v) => setForm({ ...form, opening_balance_date: v })} />
        </div>
        {Number(form.opening_balance) !== 0 && (
          <p className="-mt-2 text-xs text-muted">
            The opening balance is booked in the journal against "Opening Balance Equity", so it shows in the
            Balance Sheet and in this {text.single}'s statement.
          </p>
        )}
        <TextField id="p-address" label={text.addressLabel} multiline rows={2} value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })} />
        {kind === 'clients' && (
          <TextField id="p-ship" label="Shipping address" multiline rows={2} value={form.shipping_address}
            onChange={(e) => setForm({ ...form, shipping_address: e.target.value })} />
        )}
        <div>
          <AccountSelect label={text.accountLabel} value={form.account}
            valueLabel={editing ? (kind === 'clients' ? editing.receivable_account_name : editing.payable_account_name) : null}
            accountType={kind === 'clients' ? 'ASSET' : 'LIABILITY'}
            onChange={(id) => setForm({ ...form, account: id })} />
          <p className="mt-1.5 text-xs text-muted">{text.accountHint}</p>
        </div>
        <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Active" />
      </Modal>

      {statementFor && <StatementDrawer kind={kind} party={statementFor} onClose={() => setStatementFor(null)} />}
    </div>
  )
}

function StatementDrawer({ kind, party, onClose }: { kind: PartyKind; party: Party; onClose: () => void }) {
  const [data, setData] = useState<PartyStatement | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    partiesApi(kind).statement(party.id).then(setData).catch((err) => setError(errorText(err, 'Failed to load the statement.')))
  }, [kind, party.id])

  const increaseLabel = kind === 'clients' ? 'Invoiced' : 'Billed'
  const decreaseLabel = kind === 'clients' ? 'Received' : 'Paid'

  return (
    <Drawer onClose={onClose} widthClassName="w-full sm:w-[560px] md:w-[640px]"
      title={<div><p className="text-xs font-bold uppercase tracking-[0.08em] text-primary">Statement</p>
        <h2 className="font-display text-xl font-bold text-ink">{party.name}</h2></div>}>
      {error && <Alert>{error}</Alert>}
      {!data && !error && <div className="flex justify-center p-10"><Spinner size={28} /></div>}
      {data && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-surface-muted p-4 sm:grid-cols-4">
            <Field label="Opening">{formatMoney(data.opening_balance)}</Field>
            <Field label={increaseLabel}>{formatMoney(data.total_increase)}</Field>
            <Field label={decreaseLabel}>{formatMoney(data.total_decrease)}</Field>
            <Field label="Balance">{formatMoney(data.closing_balance)}</Field>
          </div>
          {data.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No posted documents or payments yet.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className={TABLE_HEAD_ROW}>
                  <th className={TH}>Date</th>
                  <th className={TH}>Document</th>
                  <th className={`${TH} text-right`}>{increaseLabel}</th>
                  <th className={`${TH} text-right`}>{decreaseLabel}</th>
                  <th className={`${TH} text-right`}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={`${r.type}-${r.id}`} className={TABLE_ROW}>
                    <td className={`${TD} whitespace-nowrap`}>{formatDate(r.date)}</td>
                    <td className={TD}>
                      <p className="font-semibold">{r.number}</p>
                      <p className="text-xs text-muted">{(r.type.charAt(0) + r.type.slice(1).toLowerCase()).replace('_', ' ')}{r.due_date ? ` · due ${formatDate(r.due_date)}` : ''}</p>
                    </td>
                    <td className={`${TD} num text-right`}>{r.increase ? formatMoney(r.increase) : ''}</td>
                    <td className={`${TD} num text-right`}>{r.decrease ? formatMoney(r.decrease) : ''}</td>
                    <td className={`${TD} num text-right font-semibold`}>{formatMoney(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Drawer>
  )
}
