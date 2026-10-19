/** Line items of an invoice, bill or recurring invoice, as edited in LineItemsEditor. */
import type { SearchableOption } from '../../components/SearchableSelect'
import type { DocItem, ItemPayload, TaxRate } from './billingapi'

export interface Line {
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
export const blankLine = (): Line => ({
  key: ++lineKey, product: null, description: '', quantity: '1', unit_price: '', discount_percent: '0',
  tax_rate_id: null, account_id: null, account_label: null,
})

const round2 = (n: number) => Math.round(n * 100) / 100

export function lineAmounts(line: Line, rates: TaxRate[]) {
  const amount = round2((Number(line.quantity) || 0) * (Number(line.unit_price) || 0) * (100 - (Number(line.discount_percent) || 0)) / 100)
  const rate = rates.find((r) => r.id === line.tax_rate_id)
  const tax = rate ? round2(amount * Number(rate.rate) / 100) : 0
  return { amount, tax }
}

export const lineTotals = (lines: Line[], rates: TaxRate[]) => lines.reduce((acc, l) => {
  const { amount, tax } = lineAmounts(l, rates)
  return { subtotal: acc.subtotal + amount, tax: acc.tax + tax }
}, { subtotal: 0, tax: 0 })

/** Lines of a saved document. */
export const linesFromItems = (items: DocItem[]): Line[] => items.map((i) => ({
  key: ++lineKey, product: i.product ? { id: i.product, label: i.product_name ?? '' } : null,
  description: i.description, quantity: String(Number(i.quantity)), unit_price: i.unit_price,
  discount_percent: String(Number(i.discount_percent)), tax_rate_id: i.tax_rate, account_id: i.account,
  account_label: i.account_name,
}))

/** Lines of a recurring invoice, stored as the payload they are sent as. */
export const linesFromPayload = (items: ItemPayload[]): Line[] => items.map((i) => ({
  key: ++lineKey, product: i.product_id ? { id: i.product_id, label: i.description || `#${i.product_id}` } : null,
  description: i.description ?? '', quantity: String(Number(i.quantity ?? 1)), unit_price: i.unit_price ?? '',
  discount_percent: String(Number(i.discount_percent ?? 0)), tax_rate_id: i.tax_rate_id ?? null,
  account_id: i.account_id ?? null, account_label: null,
}))

/** The filled-in lines, as the API takes them. */
export const linesToPayload = (lines: Line[]): ItemPayload[] => lines
  .filter((l) => l.description.trim() || l.product)
  .map((l) => ({
    product_id: l.product?.id ?? null, description: l.description.trim(), quantity: l.quantity || '1',
    unit_price: l.unit_price || '0', discount_percent: l.discount_percent || '0', tax_rate_id: l.tax_rate_id,
    account_id: l.account_id,
  }))
