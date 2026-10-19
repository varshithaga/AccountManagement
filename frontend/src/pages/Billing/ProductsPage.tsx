import { useCallback, useEffect, useState } from 'react'
import { Package, Percent, Plus, Pencil, Trash2, RefreshCw, FileSpreadsheet, ReceiptIndianRupee } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import Pagination, { DEFAULT_ROWS_PER_PAGE } from '../../components/Pagination'
import { Alert, Button, Chip, IconButton, Modal, Panel, Select, Spinner, Switch, Tabs, TextField } from '../../components/tw'
import { EmptyState, PageHeader, RowAction, SearchBox } from '../../components/PageParts'
import { formatMoney } from '../../utils/periods'
import { errorText, productsApi, taxRatesApi, tdsSectionsApi } from './billingapi'
import type { Product, TaxRate, TdsSection } from './billingapi'
import BillingImportDialog from './BillingImportDialog'
import { AccountSelect, TABLE_HEAD_ROW, TABLE_ROW, TD, TH } from './billingParts'

type Tab = 'products' | 'tax_rates' | 'tds_sections'

export default function ProductsPage() {
  const [tab, setTab] = useState<Tab>('products')
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Products & tax rates"
        description="What you sell and buy, with default prices, GST rate and the accounts each line posts to."
        actions={<Tabs<Tab> value={tab} onChange={setTab}
          options={[{ value: 'products', label: 'Products & services' }, { value: 'tax_rates', label: 'Tax rates' },
            { value: 'tds_sections', label: 'TDS sections' }]} />}
      />
      {tab === 'products' ? <ProductsTab /> : tab === 'tax_rates' ? <TaxRatesTab /> : <TdsSectionsTab />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Products & services
// ---------------------------------------------------------------------------

interface ProductForm {
  name: string
  code: string
  item_type: 'PRODUCT' | 'SERVICE'
  description: string
  hsn_sac_code: string
  unit: string
  sale_price: string
  purchase_price: string
  tax_rate: number | null
  income_account: number | null
  expense_account: number | null
  is_active: boolean
  track_inventory: boolean
  reorder_level: string
}

const EMPTY_PRODUCT: ProductForm = {
  name: '', code: '', item_type: 'PRODUCT', description: '', hsn_sac_code: '', unit: 'Nos',
  sale_price: '0', purchase_price: '0', tax_rate: null, income_account: null, expense_account: null, is_active: true,
  track_inventory: false, reorder_level: '',
}

function ProductsTab() {
  const { can } = useAuth()
  const [rows, setRows] = useState<Product[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE)
  const [taxRates, setTaxRates] = useState<TaxRate[]>([])

  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<ProductForm>(EMPTY_PRODUCT)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await productsApi.search({ search: search.trim() || undefined, page: page + 1, limit: rowsPerPage })
      setRows(data.results)
      setCount(data.count)
    } finally {
      setLoading(false)
    }
  }, [search, page, rowsPerPage])

  useEffect(() => {
    const handle = setTimeout(load, 300)
    return () => clearTimeout(handle)
  }, [load])

  useEffect(() => { taxRatesApi.list({ is_active: true }).then(setTaxRates).catch(() => {}) }, [])

  const openEdit = (p: Product | null) => {
    setEditing(p)
    setForm(p ? {
      name: p.name, code: p.code ?? '', item_type: p.item_type, description: p.description, hsn_sac_code: p.hsn_sac_code,
      unit: p.unit, sale_price: p.sale_price, purchase_price: p.purchase_price, tax_rate: p.tax_rate,
      income_account: p.income_account, expense_account: p.expense_account, is_active: p.is_active,
      track_inventory: p.track_inventory, reorder_level: p.reorder_level ?? '',
    } : EMPTY_PRODUCT)
    setError('')
    setDialog(true)
  }

  const save = async () => {
    if (!form.name.trim()) {
      setError('Please enter a name.')
      return
    }
    try {
      const tracked = form.item_type === 'PRODUCT' && form.track_inventory
      const payload = {
        ...form, name: form.name.trim(), code: form.code.trim() || null, track_inventory: tracked,
        reorder_level: tracked && form.reorder_level !== '' ? form.reorder_level : null,
      }
      if (editing) await productsApi.update(editing.id, payload)
      else await productsApi.create(payload)
      setDialog(false)
      load()
    } catch (err) {
      setError(errorText(err, 'Failed to save the product.'))
    }
  }

  const remove = async (p: Product) => {
    if (!window.confirm(`Delete "${p.name}"? Invoices and bills that used it keep their own lines.`)) return
    try {
      await productsApi.remove(p.id)
      load()
    } catch (err) {
      alert(errorText(err, 'Failed to delete.'))
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0) }}
          placeholder="Search by name, code, HSN/SAC or description…" className="flex-1" />
        <IconButton title="Refresh" onClick={load} disabled={loading}>
          <RefreshCw className={`h-[18px] w-[18px] stroke-[1.8] ${loading ? 'animate-spin' : ''}`} />
        </IconButton>
        {can('products', 'create') && <Button variant="outlined" icon={<FileSpreadsheet />} onClick={() => setImporting(true)}>Import from Excel</Button>}
        {can('products', 'create') && <Button variant="contained" icon={<Plus />} onClick={() => openEdit(null)}>Add product</Button>}
      </div>

      <Panel className="overflow-hidden p-0">
        {loading && rows.length === 0 ? (
          <div className="flex justify-center p-16"><Spinner size={32} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Package />} title={search ? 'No products match your search.' : 'No products or services yet.'}
            text="Products are optional - invoice lines can also be typed in directly." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead>
                  <tr className={TABLE_HEAD_ROW}>
                    <th className={TH}>Name</th>
                    <th className={TH}>HSN / SAC</th>
                    <th className={`${TH} text-right`}>Sale price</th>
                    <th className={`${TH} text-right`}>Purchase price</th>
                    <th className={TH}>GST</th>
                    <th className={TH}>Accounts</th>
                    <th className={`${TH} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className={TABLE_ROW}>
                      <td className={TD}>
                        <p className="font-semibold">
                          {p.name} {!p.is_active && <Chip tone="neutral">Inactive</Chip>} {p.track_inventory && <Chip tone="info">Stock</Chip>}
                        </p>
                        <p className="text-xs text-muted">{p.item_type === 'SERVICE' ? 'Service' : 'Product'}{p.code ? ` · ${p.code}` : ''} · per {p.unit}</p>
                      </td>
                      <td className={`${TD} num`}>{p.hsn_sac_code || '—'}</td>
                      <td className={`${TD} num text-right`}>{formatMoney(p.sale_price)}</td>
                      <td className={`${TD} num text-right`}>{formatMoney(p.purchase_price)}</td>
                      <td className={TD}>{p.tax_rate_name ?? '—'}</td>
                      <td className={`${TD} text-xs text-muted`}>
                        <p>Sales: {p.income_account_name ?? '—'}</p>
                        <p>Purchases: {p.expense_account_name ?? '—'}</p>
                      </td>
                      <td className={`${TD} text-right`}>
                        <div className="inline-flex gap-1">
                          {can('products', 'edit') && <RowAction onClick={() => openEdit(p)} title="Edit"><Pencil /></RowAction>}
                          {can('products', 'delete') && <RowAction danger onClick={() => remove(p)} title="Delete"><Trash2 /></RowAction>}
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

      <Modal open={dialog} onClose={() => setDialog(false)} icon={<Package />} widthClassName="max-w-2xl"
        title={editing ? 'Edit product' : 'Add product or service'}
        footer={<>
          <Button variant="outlined" onClick={() => setDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={save}>Save</Button>
        </>}>
        {error && <Alert>{error}</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField id="pr-name" label="Name" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select id="pr-type" label="Type" value={form.item_type}
            onChange={(e) => setForm({ ...form, item_type: e.target.value as ProductForm['item_type'] })}>
            <option value="PRODUCT">Product</option>
            <option value="SERVICE">Service</option>
          </Select>
          <TextField id="pr-code" label="Code / SKU" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <TextField id="pr-hsn" label="HSN / SAC code" value={form.hsn_sac_code} inputClassName="num"
            onChange={(e) => setForm({ ...form, hsn_sac_code: e.target.value })} />
          <TextField id="pr-unit" label="Unit" placeholder="Nos, Kg, Hrs…" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          <Select id="pr-tax" label="GST rate" value={form.tax_rate ?? ''}
            onChange={(e) => setForm({ ...form, tax_rate: e.target.value ? Number(e.target.value) : null })}>
            <option value="">No tax</option>
            {taxRates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <TextField id="pr-sale" label="Sale price" type="number" value={form.sale_price} inputClassName="num"
            onChange={(e) => setForm({ ...form, sale_price: e.target.value })} />
          <TextField id="pr-purchase" label="Purchase price" type="number" value={form.purchase_price} inputClassName="num"
            onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} />
        </div>
        <AccountSelect label="Income account (when sold)" accountType="INCOME" value={form.income_account}
          valueLabel={editing?.income_account_name} onChange={(id) => setForm({ ...form, income_account: id })} />
        <AccountSelect label="Expense account (when bought)" value={form.expense_account}
          valueLabel={editing?.expense_account_name} onChange={(id) => setForm({ ...form, expense_account: id })} />
        <TextField id="pr-desc" label="Description" multiline rows={2} value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
        {form.item_type === 'PRODUCT' && (
          <div className="flex flex-col gap-3 rounded-xl border border-border-soft p-4">
            <Switch checked={form.track_inventory} onChange={(v) => setForm({ ...form, track_inventory: v })}
              disabled={!!editing?.track_inventory} label="Track stock" />
            <p className="-mt-1 text-xs text-muted">
              {editing?.track_inventory
                ? "Stock is tracked. Once it has movements it can't be turned off - mark the product inactive instead."
                : 'Posting bills adds stock and invoices take it out. Enter opening stock on the Inventory page.'}
            </p>
            {form.track_inventory && (
              <TextField id="pr-reorder" label="Reorder level (optional)" type="number" value={form.reorder_level} inputClassName="num"
                className="sm:max-w-[240px]" onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} />
            )}
          </div>
        )}
        <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Active" />
      </Modal>

      <BillingImportDialog target="products" open={importing} onClose={() => setImporting(false)} onImported={load} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Tax rates
// ---------------------------------------------------------------------------

function TaxRatesTab() {
  const { can } = useAuth()
  const [rows, setRows] = useState<TaxRate[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<TaxRate | null>(null)
  const [form, setForm] = useState({ name: '', rate: '', output: null as number | null, input: null as number | null, is_active: true })
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    taxRatesApi.list().then(setRows).finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const openEdit = (t: TaxRate | null) => {
    setEditing(t)
    setForm(t ? { name: t.name, rate: t.rate, output: t.output_tax_account, input: t.input_tax_account, is_active: t.is_active }
      : { name: '', rate: '', output: null, input: null, is_active: true })
    setError('')
    setDialog(true)
  }

  const save = async () => {
    if (!form.name.trim() || form.rate === '') {
      setError('Name and rate are required.')
      return
    }
    try {
      const payload = { name: form.name.trim(), rate: form.rate, output_tax_account: form.output,
        input_tax_account: form.input, is_active: form.is_active }
      if (editing) await taxRatesApi.update(editing.id, payload)
      else await taxRatesApi.create(payload)
      setDialog(false)
      load()
    } catch (err) {
      setError(errorText(err, 'Failed to save the tax rate.'))
    }
  }

  const remove = async (t: TaxRate) => {
    if (!window.confirm(`Delete tax rate "${t.name}"?`)) return
    try {
      await taxRatesApi.remove(t.id)
      load()
    } catch (err) {
      alert(errorText(err, 'Failed to delete.'))
    }
  }

  return (
    <>
      <div className="flex justify-end">
        {can('products', 'create') && <Button variant="contained" icon={<Plus />} onClick={() => openEdit(null)}>Add tax rate</Button>}
      </div>
      <Panel className="overflow-hidden p-0">
        {loading ? (
          <div className="flex justify-center p-16"><Spinner size={32} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Percent />} title="No tax rates yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] border-collapse text-sm">
              <thead>
                <tr className={TABLE_HEAD_ROW}>
                  <th className={TH}>Name</th>
                  <th className={`${TH} text-right`}>Rate</th>
                  <th className={TH}>GST collected on sales →</th>
                  <th className={TH}>GST paid on purchases →</th>
                  <th className={`${TH} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className={TABLE_ROW}>
                    <td className={`${TD} font-semibold`}>{t.name} {!t.is_active && <Chip tone="neutral">Inactive</Chip>}</td>
                    <td className={`${TD} num text-right`}>{Number(t.rate)}%</td>
                    <td className={TD}>{t.output_tax_account_name ?? <span className="text-muted">GST Payable (default)</span>}</td>
                    <td className={TD}>{t.input_tax_account_name ?? <span className="text-muted">Added to the expense</span>}</td>
                    <td className={`${TD} text-right`}>
                      <div className="inline-flex gap-1">
                        {can('products', 'edit') && <RowAction onClick={() => openEdit(t)} title="Edit"><Pencil /></RowAction>}
                        {can('products', 'delete') && <RowAction danger onClick={() => remove(t)} title="Delete"><Trash2 /></RowAction>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal open={dialog} onClose={() => setDialog(false)} icon={<Percent />} title={editing ? 'Edit tax rate' : 'Add tax rate'}
        subtitle="A rate already used on invoices or bills can't change - add a new one instead."
        widthClassName="max-w-lg"
        footer={<>
          <Button variant="outlined" onClick={() => setDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={save}>Save</Button>
        </>}>
        {error && <Alert>{error}</Alert>}
        <div className="grid grid-cols-2 gap-4">
          <TextField id="tr-name" label="Name" required placeholder="GST 18%" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField id="tr-rate" label="Rate %" required type="number" value={form.rate} inputClassName="num"
            onChange={(e) => setForm({ ...form, rate: e.target.value })} />
        </div>
        <AccountSelect label="Output GST account (sales)" accountType="LIABILITY" value={form.output}
          valueLabel={editing?.output_tax_account_name} onChange={(id) => setForm({ ...form, output: id })} />
        <AccountSelect label="Input GST account (purchases)" accountType="ASSET" value={form.input}
          valueLabel={editing?.input_tax_account_name} onChange={(id) => setForm({ ...form, input: id })} />
        <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Active" />
      </Modal>
    </>
  )
}

// ---------------------------------------------------------------------------
// TDS sections
// ---------------------------------------------------------------------------

const EMPTY_TDS = { code: '', name: '', rate: '', threshold: '', account: null as number | null, is_active: true }

function TdsSectionsTab() {
  const { can } = useAuth()
  const [rows, setRows] = useState<TdsSection[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<TdsSection | null>(null)
  const [form, setForm] = useState(EMPTY_TDS)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    tdsSectionsApi.list().then(setRows).finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const openEdit = (t: TdsSection | null) => {
    setEditing(t)
    setForm(t ? { code: t.code, name: t.name, rate: t.rate, threshold: t.threshold ?? '', account: t.account, is_active: t.is_active }
      : EMPTY_TDS)
    setError('')
    setDialog(true)
  }

  const save = async () => {
    if (!form.code.trim() || !form.name.trim() || form.rate === '') {
      setError('Section, name and rate are required.')
      return
    }
    try {
      const payload = { code: form.code.trim(), name: form.name.trim(), rate: form.rate,
        threshold: form.threshold === '' ? null : form.threshold, account: form.account, is_active: form.is_active }
      if (editing) await tdsSectionsApi.update(editing.id, payload)
      else await tdsSectionsApi.create(payload)
      setDialog(false)
      load()
    } catch (err) {
      setError(errorText(err, 'Failed to save the TDS section.'))
    }
  }

  const remove = async (t: TdsSection) => {
    if (!window.confirm(`Delete TDS section "${t.name}"?`)) return
    try {
      await tdsSectionsApi.remove(t.id)
      load()
    } catch (err) {
      alert(errorText(err, 'Failed to delete.'))
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          A bill under a section keeps back its rate of the taxable value (before GST): the supplier is paid the rest and
          the TDS is owed to the government. Check rates against the current rules before use.
        </p>
        {can('products', 'create') && <Button variant="contained" icon={<Plus />} onClick={() => openEdit(null)}>Add TDS section</Button>}
      </div>
      <Panel className="overflow-hidden p-0">
        {loading ? (
          <div className="flex justify-center p-16"><Spinner size={32} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<ReceiptIndianRupee />} title="No TDS sections yet."
            text="e.g. 194C Contractors, 194J Professional fees, 194I Rent." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] border-collapse text-sm">
              <thead>
                <tr className={TABLE_HEAD_ROW}>
                  <th className={TH}>Section</th>
                  <th className={`${TH} text-right`}>Rate</th>
                  <th className={`${TH} text-right`}>Threshold</th>
                  <th className={TH}>Credited to</th>
                  <th className={`${TH} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className={TABLE_ROW}>
                    <td className={TD}>
                      <span className="num font-semibold">{t.code}</span> · {t.name} {!t.is_active && <Chip tone="neutral">Inactive</Chip>}
                    </td>
                    <td className={`${TD} num text-right`}>{Number(t.rate)}%</td>
                    <td className={`${TD} num text-right`}>{t.threshold != null ? formatMoney(t.threshold) : '—'}</td>
                    <td className={TD}>{t.account_name ?? <span className="text-muted">TDS Payable (default)</span>}</td>
                    <td className={`${TD} text-right`}>
                      <div className="inline-flex gap-1">
                        {can('products', 'edit') && <RowAction onClick={() => openEdit(t)} title="Edit"><Pencil /></RowAction>}
                        {can('products', 'delete') && <RowAction danger onClick={() => remove(t)} title="Delete"><Trash2 /></RowAction>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal open={dialog} onClose={() => setDialog(false)} icon={<ReceiptIndianRupee />} title={editing ? 'Edit TDS section' : 'Add TDS section'}
        subtitle="A rate already used on bills can't change - add a new section instead."
        widthClassName="max-w-lg"
        footer={<>
          <Button variant="outlined" onClick={() => setDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={save}>Save</Button>
        </>}>
        {error && <Alert>{error}</Alert>}
        <div className="grid grid-cols-3 gap-4">
          <TextField id="tds-code" label="Section" required placeholder="194J" value={form.code} inputClassName="num"
            onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <TextField id="tds-name" label="Name" required placeholder="Professional fees" value={form.name} className="col-span-2"
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField id="tds-rate" label="Rate %" required type="number" value={form.rate} inputClassName="num"
            onChange={(e) => setForm({ ...form, rate: e.target.value })} />
          <TextField id="tds-threshold" label="Threshold (for reference)" type="number" value={form.threshold} inputClassName="num"
            className="col-span-2" onChange={(e) => setForm({ ...form, threshold: e.target.value })} />
        </div>
        <AccountSelect label="TDS account (optional)" accountType="LIABILITY" value={form.account}
          valueLabel={editing?.account_name} onChange={(id) => setForm({ ...form, account: id })} />
        <p className="-mt-2 text-xs text-muted">Leave empty to use the "TDS Payable" sub-category.</p>
        <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Active" />
      </Modal>
    </>
  )
}
