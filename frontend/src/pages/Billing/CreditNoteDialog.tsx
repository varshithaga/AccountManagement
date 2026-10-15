import { useEffect, useMemo, useState } from 'react'
import { FileMinus, X } from 'lucide-react'
import { Alert, Button, DateField, Modal, Select, TextField } from '../../components/tw'
import { formatMoney } from '../../utils/periods'
import { creditNotesApi, errorText, taxRatesApi } from './billingapi'
import type { BillingDoc, CreditNote, DocKind, TaxRate } from './billingapi'
import { AccountSelect, todayIso } from './billingParts'

interface Line {
  key: number
  description: string
  quantity: string
  unit_price: string
  tax_rate_id: number | null
  account_id: number | null
  account_label: string | null
}

let nextKey = 0
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Credit note (on a sales invoice) or debit note (on a purchase bill). Starts from the document's own
 * lines - change the quantities or prices to what is being returned / discounted, or remove lines.
 * Posted as soon as it is saved, and it lowers the document's balance due.
 */
export default function CreditNoteDialog({ kind, doc, onClose, onSaved }: {
  kind: DocKind
  doc: BillingDoc
  onClose: () => void
  onSaved: (note: CreditNote) => void
}) {
  const sales = kind === 'sales'
  const noteName = sales ? 'credit note' : 'debit note'
  const [date, setDate] = useState(todayIso())
  const [reason, setReason] = useState('')
  const [rates, setRates] = useState<TaxRate[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [lines, setLines] = useState<Line[]>(() => (doc.items ?? []).map((i) => ({
    key: ++nextKey, description: i.description, quantity: String(Number(i.quantity)), unit_price: i.unit_price,
    tax_rate_id: i.tax_rate, account_id: i.account, account_label: i.account_name,
  })))

  useEffect(() => { taxRatesApi.list().then(setRates).catch(() => {}) }, [])

  const amounts = (l: Line) => {
    const amount = round2((Number(l.quantity) || 0) * (Number(l.unit_price) || 0))
    const rate = rates.find((r) => r.id === l.tax_rate_id)
    return { amount, tax: rate ? round2(amount * Number(rate.rate) / 100) : 0 }
  }
  const total = useMemo(() => lines.reduce((s, l) => { const a = amounts(l); return s + a.amount + a.tax }, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, rates])
  const due = Number(doc.balance_due)
  const tooMuch = total - due > 0.001

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const save = async () => {
    const items = lines.filter((l) => Number(l.quantity) > 0 && Number(l.unit_price) > 0).map((l) => ({
      description: l.description, quantity: l.quantity, unit_price: l.unit_price, tax_rate_id: l.tax_rate_id,
      account_id: l.account_id,
    }))
    if (!items.length) return setError('Keep at least one line with a quantity and price.')
    setSaving(true)
    setError('')
    try {
      onSaved(await creditNotesApi.create({
        [sales ? 'sales_invoice_id' : 'purchase_bill_id']: doc.id, note_date: date, reason: reason.trim(), items,
      }))
    } catch (err) {
      setError(errorText(err, `Failed to save the ${noteName}.`))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} icon={<FileMinus />} widthClassName="max-w-4xl"
      title={`New ${noteName} on ${doc.invoice_number ?? doc.bill_number}`}
      subtitle={`For returns, discounts or corrections. Up to ${formatMoney(due)} can be credited (what is still due).`}
      footerHint={<span className={`num font-semibold ${tooMuch ? 'text-danger-text' : 'text-ink'}`}>
        Note total {formatMoney(total)}{tooMuch ? ` - more than the ${formatMoney(due)} still due` : ''}
      </span>}
      footer={<>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving || tooMuch || total <= 0}>
          {saving ? 'Saving…' : `Post ${noteName}`}
        </Button>
      </>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <DateField id="cn-date" label="Date" value={date} onChange={setDate} min={doc.invoice_date ?? doc.bill_date} />
        <TextField id="cn-reason" className="md:col-span-2" label="Reason" placeholder="e.g. 2 units returned damaged"
          value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>

      <div className="flex flex-col gap-3">
        {lines.map((l) => {
          const { amount, tax } = amounts(l)
          return (
            <div key={l.key} className="grid grid-cols-2 gap-3 rounded-xl border border-border-soft p-3 md:grid-cols-12">
              <TextField className="col-span-2 md:col-span-4" id={`cn-d-${l.key}`} label="Description" value={l.description}
                onChange={(e) => update(l.key, { description: e.target.value })} />
              <TextField className="md:col-span-1" id={`cn-q-${l.key}`} label="Qty" type="number" value={l.quantity} inputClassName="num"
                onChange={(e) => update(l.key, { quantity: e.target.value })} />
              <TextField className="md:col-span-2" id={`cn-p-${l.key}`} label="Unit price" type="number" value={l.unit_price}
                inputClassName="num" onChange={(e) => update(l.key, { unit_price: e.target.value })} />
              <div className="md:col-span-2">
                <Select id={`cn-t-${l.key}`} label="GST" value={l.tax_rate_id ?? ''}
                  onChange={(e) => update(l.key, { tax_rate_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">No tax</option>
                  {rates.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </div>
              <div className="col-span-2 md:col-span-2">
                <AccountSelect label="Account" value={l.account_id} valueLabel={l.account_label}
                  onChange={(id) => update(l.key, { account_id: id, account_label: null })} />
              </div>
              <div className="col-span-2 flex items-end justify-between gap-2 md:col-span-1 md:flex-col md:items-end">
                <span className="num text-sm font-semibold" title={`GST ${formatMoney(tax)}`}>{formatMoney(amount + tax)}</span>
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
      </div>
    </Modal>
  )
}
