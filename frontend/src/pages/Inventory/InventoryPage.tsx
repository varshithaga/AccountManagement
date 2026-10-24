import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Boxes, History, IndianRupee, PackagePlus, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { Alert, Button, Chip, DateField, Drawer, IconButton, Modal, Panel, Select, Spinner, Switch, TextField } from '../../components/tw'
import { EmptyState, KpiTile, PageHeader, RowAction, SearchBox } from '../../components/PageParts'
import Pagination, { DEFAULT_ROWS_PER_PAGE, clampPage, paginate } from '../../components/Pagination'
import { formatMoney } from '../../utils/periods'
import { errorText, inventoryApi } from '../Billing/billingapi'
import type { ProductMovements, StockItem, StockMovementKind, StockSummary } from '../Billing/billingapi'
import { TABLE_HEAD_ROW, TABLE_ROW, TD, TH, formatDate, todayIso } from '../Billing/billingParts'

const NUM = `${TD} num text-right`

const KIND_LABEL: Record<StockMovementKind, string> = {
  OPENING: 'Opening stock', ADJUSTMENT: 'Adjustment', PURCHASE: 'Purchase bill', SALE: 'Sales invoice',
  SALES_RETURN: 'Credit note (return in)', PURCHASE_RETURN: 'Debit note (return out)',
}

const qty = (n: number | string) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 })

/** Stock of the products marked "Track stock": posting bills, invoices and notes moves it; opening stock
 * and counts are adjustments. Quantities and value only - nothing here posts to the journal. */
export default function InventoryPage() {
  const { can } = useAuth()
  const canAdjust = can('inventory', 'create')
  const canDelete = can('inventory', 'delete')

  const [data, setData] = useState<StockSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [asOf, setAsOf] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [viewing, setViewing] = useState<StockItem | null>(null)
  const [adjusting, setAdjusting] = useState<{ product: number | null; opening: boolean } | null>(null)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      setData(await inventoryApi.stock({ search: search.trim() || undefined, as_of: asOf || undefined }, signal))
    } catch (err) {
      if (!signal?.aborted) setError(errorText(err, 'Failed to load the stock.'))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [search, asOf])

  useEffect(() => {
    const controller = new AbortController()
    const handle = setTimeout(() => load(controller.signal), 300)
    return () => { clearTimeout(handle); controller.abort() }
  }, [load])

  // The whole list comes at once (the tiles and the Adjust dialog need every product); it is paged here.
  const rows = (data?.products ?? []).filter((p) => !lowOnly || p.below_reorder_level || p.negative)
  const pageRows = paginate(rows, clampPage(page, rowsPerPage, rows.length), rowsPerPage)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inventory"
        description="Stock on hand of the products marked “Track stock”. Posting purchase bills adds stock, sales invoices take it out, and credit / debit notes move returns."
        actions={<>
          <IconButton title="Refresh" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-[18px] w-[18px] stroke-[1.8] ${loading ? 'animate-spin' : ''}`} />
          </IconButton>
          {canAdjust && <>
            <Button variant="outlined" icon={<PackagePlus />} onClick={() => setAdjusting({ product: null, opening: true })}>Opening stock</Button>
            <Button variant="contained" icon={<SlidersHorizontal />} onClick={() => setAdjusting({ product: null, opening: false })}>Adjust stock</Button>
          </>}
        </>}
      />

      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile dark icon={<IndianRupee />} label="Stock value" value={formatMoney(data?.total_value)}
          caption={`${data?.products.length ?? 0} tracked products, at average cost`} />
        <KpiTile tone="warning" icon={<AlertTriangle />} label="At or below reorder level" value={data?.below_reorder_level ?? 0}
          caption="Time to order more" />
        <KpiTile tone="danger" icon={<Boxes />} label="Negative stock" value={data?.negative ?? 0}
          caption="More sold than recorded in - check opening stock and bills" />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0) }} placeholder="Search by name, code or HSN…" className="flex-1" />
        <DateField id="stock-as-of" label="" value={asOf} onChange={setAsOf} className="lg:w-48" />
        {asOf && <Button variant="text" size="sm" onClick={() => setAsOf('')}>Today</Button>}
        <Switch checked={lowOnly} onChange={(v) => { setLowOnly(v); setPage(0) }} label="Low / negative only" />
      </div>

      <Panel className="overflow-hidden p-0">
        {loading && !data ? (
          <div className="flex justify-center p-16"><Spinner size={32} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Boxes />} title={data?.products.length ? 'Nothing matches.' : 'No products track stock yet.'}
            text={data?.products.length ? undefined : <>Turn on “Track stock” for a product on the <Link to="/products" className="font-semibold text-primary underline">Products</Link> page.</>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-sm">
              <thead>
                <tr className={TABLE_HEAD_ROW}>
                  <th className={TH}>Product</th>
                  <th className={`${TH} text-right`}>In</th>
                  <th className={`${TH} text-right`}>Out</th>
                  <th className={`${TH} text-right`}>On hand</th>
                  <th className={`${TH} text-right`}>Reorder at</th>
                  <th className={`${TH} text-right`}>Avg. cost</th>
                  <th className={`${TH} text-right`}>Value</th>
                  <th className={`${TH} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => (
                  <tr key={p.product} className={TABLE_ROW}>
                    <td className={TD}>
                      <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setViewing(p)}>{p.name}</button>
                      <p className="text-xs text-muted">
                        {[p.code, p.hsn_sac_code && `HSN ${p.hsn_sac_code}`].filter(Boolean).join(' · ') || '—'}
                        {!p.is_active && ' · inactive'}
                      </p>
                    </td>
                    <td className={NUM}>{qty(p.quantity_in)}</td>
                    <td className={NUM}>{qty(p.quantity_out)}</td>
                    <td className={`${NUM} font-semibold`}>
                      <span className="inline-flex items-center gap-2">
                        {p.negative ? <Chip tone="error">Negative</Chip> : p.below_reorder_level && <Chip tone="warning">Low</Chip>}
                        {qty(p.on_hand)} {p.unit}
                      </span>
                    </td>
                    <td className={NUM}>{p.reorder_level != null ? qty(p.reorder_level) : '—'}</td>
                    <td className={NUM}>{formatMoney(p.average_cost)}</td>
                    <td className={`${NUM} font-semibold`}>{formatMoney(p.value)}</td>
                    <td className={`${TD} text-right`}>
                      <div className="inline-flex items-center gap-1">
                        <RowAction onClick={() => setViewing(p)} title="Movements"><History /></RowAction>
                        {canAdjust && <RowAction onClick={() => setAdjusting({ product: p.product, opening: false })} title="Adjust stock"><SlidersHorizontal /></RowAction>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination count={rows.length} page={page} rowsPerPage={rowsPerPage} onPageChange={setPage}
              onRowsPerPageChange={(r) => { setRowsPerPage(r); setPage(0) }} />
          </div>
        )}
      </Panel>

      {viewing && (
        <MovementsDrawer item={viewing} canDelete={canDelete} onClose={() => setViewing(null)} onChanged={() => load()} />
      )}
      {adjusting && data && (
        <AdjustDialog products={data.products} productId={adjusting.product} opening={adjusting.opening}
          onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); load() }} />
      )}
    </div>
  )
}

function MovementsDrawer({ item, canDelete, onClose, onChanged }: {
  item: StockItem
  canDelete: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [data, setData] = useState<ProductMovements | null>(null)
  const [error, setError] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE)

  const reload = useCallback(() => {
    inventoryApi.movements(item.product, {
      date_from: dateFrom || undefined, date_to: dateTo || undefined, page: page + 1, limit: rowsPerPage,
    }).then(setData).catch((err) => setError(errorText(err, 'Failed to load the movements.')))
  }, [item.product, dateFrom, dateTo, page, rowsPerPage])
  useEffect(reload, [reload])

  const remove = async (id: number) => {
    if (!window.confirm('Delete this adjustment? The stock goes back to what it was without it.')) return
    try {
      await inventoryApi.removeAdjustment(id)
      // The last row of the last page: go back a page (changing the page reloads), else reload this one.
      if (page > 0 && data?.rows.length === 1) setPage(page - 1)
      else reload()
      onChanged()
    } catch (err) {
      alert(errorText(err, 'Failed to delete the adjustment.'))
    }
  }

  const docLink = (doc: NonNullable<ProductMovements['rows'][number]['document']>) =>
    doc.type === 'sales_invoice' ? '/sales-invoices' : doc.type === 'purchase_bill' ? '/purchase-bills' : null

  return (
    <Drawer onClose={onClose} widthClassName="w-full sm:w-[620px] md:w-[760px]"
      title={<div>
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-primary">Stock movements</p>
        <h2 className="font-display text-xl font-bold text-ink">{item.name}</h2>
      </div>}>
      {error && <Alert>{error}</Alert>}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <DateField id="mv-from" label="From" value={dateFrom} onChange={(v) => { setDateFrom(v); setPage(0) }} />
        <DateField id="mv-to" label="To" value={dateTo} onChange={(v) => { setDateTo(v); setPage(0) }} min={dateFrom || undefined} />
      </div>
      {!data && !error && <div className="flex justify-center p-10"><Spinner size={28} /></div>}
      {data && (
        <div className="flex flex-col gap-3">
          <div className="flex justify-between rounded-xl bg-surface-muted px-4 py-3 text-sm">
            <span className="text-muted">Opening {dateFrom ? `on ${formatDate(dateFrom)}` : ''}</span>
            <span className="num font-semibold">{qty(data.opening)} {data.product.unit}</span>
          </div>
          {data.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No movements in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-sm">
                <thead>
                  <tr className={TABLE_HEAD_ROW}>
                    <th className={TH}>Date</th>
                    <th className={TH}>What</th>
                    <th className={`${TH} text-right`}>Qty</th>
                    <th className={`${TH} text-right`}>Cost</th>
                    <th className={`${TH} text-right`}>Balance</th>
                    <th className={TH} />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((m) => {
                    const link = m.document && docLink(m.document)
                    const manual = m.kind === 'OPENING' || m.kind === 'ADJUSTMENT'
                    return (
                      <tr key={m.id} className={TABLE_ROW}>
                        <td className={`${TD} whitespace-nowrap`}>{formatDate(m.date)}</td>
                        <td className={TD}>
                          <p className="font-semibold">{KIND_LABEL[m.kind]}</p>
                          <p className="text-xs text-muted">
                            {m.document && (link
                              ? <Link to={link} className="num text-primary hover:underline">{m.document.number}</Link>
                              : <span className="num">{m.document.number}</span>)}
                            {m.document && m.note && ' · '}
                            {m.note}
                            {manual && m.created_by && ` · by ${m.created_by}`}
                          </p>
                        </td>
                        <td className={`${NUM} font-semibold ${m.quantity < 0 ? 'text-danger-text' : 'text-success-text'}`}>
                          {m.quantity > 0 ? '+' : ''}{qty(m.quantity)}
                        </td>
                        <td className={NUM}>{m.unit_cost != null ? formatMoney(m.unit_cost) : '—'}</td>
                        <td className={NUM}>{qty(m.balance)}</td>
                        <td className={`${TD} text-right`}>
                          {manual && canDelete && <RowAction danger onClick={() => remove(m.id)} title="Delete adjustment"><Trash2 /></RowAction>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <Pagination count={data.count} page={data.current_page - 1} rowsPerPage={rowsPerPage} onPageChange={setPage}
                onRowsPerPageChange={(r) => { setRowsPerPage(r); setPage(0) }} />
            </div>
          )}
          <div className="flex justify-between rounded-xl bg-surface-muted px-4 py-3 text-sm font-bold">
            <span>Closing</span>
            <span className="num">{qty(data.closing)} {data.product.unit}</span>
          </div>
          <p className="text-xs text-muted">Movements from invoices, bills and notes go away when that document is cancelled.</p>
        </div>
      )}
    </Drawer>
  )
}

function AdjustDialog({ products, productId, opening: initialOpening, onClose, onSaved }: {
  products: StockItem[]
  productId: number | null
  opening: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [product, setProduct] = useState<number | null>(productId)
  const [opening, setOpening] = useState(initialOpening)
  const [direction, setDirection] = useState<'in' | 'out'>('in')
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [date, setDate] = useState(todayIso())
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const current = products.find((p) => p.product === product)
  const incoming = opening || direction === 'in'

  const save = async () => {
    if (!product) {
      setError('Choose the product.')
      return
    }
    if (!(Number(quantity) > 0)) {
      setError('Enter a quantity above zero.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await inventoryApi.adjust({
        product, opening, movement_date: date, note,
        quantity: incoming ? quantity : `-${quantity}`,
        unit_cost: incoming && unitCost ? unitCost : null,
      })
      onSaved()
    } catch (err) {
      setError(errorText(err, 'Failed to save the adjustment.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} icon={opening ? <PackagePlus /> : <SlidersHorizontal />}
      title={opening ? 'Opening stock' : 'Adjust stock'}
      subtitle={opening ? 'What was in stock when you started using LedgerDesk.' : 'After a count, damage, samples or a correction.'}
      footer={<>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}>Save</Button>
      </>}>
      {error && <Alert>{error}</Alert>}
      <Select id="adj-product" label="Product" value={product ?? ''}
        onChange={(e) => setProduct(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Choose…</option>
        {products.map((p) => <option key={p.product} value={p.product}>{p.name}</option>)}
      </Select>
      {current && <p className="-mt-2 text-xs text-muted">On hand now: <span className="num font-semibold">{qty(current.on_hand)} {current.unit}</span></p>}
      <Switch checked={opening} onChange={setOpening} label="This is opening stock" />
      {!opening && (
        <Select id="adj-direction" label="Direction" value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
          <option value="in">Add to stock (found more, returned…)</option>
          <option value="out">Take out of stock (damaged, samples, missing…)</option>
        </Select>
      )}
      <div className="grid grid-cols-2 gap-3">
        <TextField id="adj-qty" label="Quantity" type="number" required value={quantity} inputClassName="num"
          onChange={(e) => setQuantity(e.target.value)} />
        {incoming && (
          <TextField id="adj-cost" label="Cost per unit (optional)" type="number" value={unitCost} inputClassName="num"
            onChange={(e) => setUnitCost(e.target.value)} />
        )}
      </div>
      <DateField id="adj-date" label="Date" value={date} onChange={setDate} />
      <TextField id="adj-note" label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Stock count 31 Mar" />
    </Modal>
  )
}
