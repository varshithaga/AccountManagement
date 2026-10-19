/** The line items of an invoice, bill or recurring invoice: product, description, qty, price, discount, GST, account. */
import { Plus, X } from 'lucide-react'
import SearchableSelect from '../../components/SearchableSelect'
import type { SearchableOption } from '../../components/SearchableSelect'
import { Button, Select, TextField } from '../../components/tw'
import { formatMoney } from '../../utils/periods'
import { productsApi } from './billingapi'
import type { DocKind, Product, TaxRate } from './billingapi'
import { blankLine, lineAmounts } from './lineItems'
import type { Line } from './lineItems'
import { AccountSelect } from './billingParts'

const fetchProducts = async ({ search, page }: { search: string; page: number }) => {
  const res = await productsApi.search({ search: search.trim() || undefined, is_active: true, page, limit: 20 })
  return { options: res.results.map((p) => ({ id: p.id, label: p.name, meta: p })), hasMore: Boolean(res.next) }
}

export default function LineItemsEditor({ kind, lines, onChange, rates }: {
  kind: DocKind
  lines: Line[]
  onChange: (update: (lines: Line[]) => Line[]) => void
  rates: TaxRate[]
}) {
  const update = (key: number, patch: Partial<Line>) => onChange((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

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

  return (
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
                <button type="button" title="Remove line" onClick={() => onChange((ls) => ls.filter((x) => x.key !== l.key))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-danger-text hover:bg-danger-soft">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )
      })}
      <div>
        <Button variant="outlined" size="sm" icon={<Plus />} onClick={() => onChange((ls) => [...ls, blankLine()])}>Add line</Button>
      </div>
    </div>
  )
}
