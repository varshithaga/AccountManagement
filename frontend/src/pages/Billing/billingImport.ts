/** Excel import of clients, suppliers and products: template columns, the column guide and row parsing.
 * Rows are checked here first (required fields, numbers, dates, repeats); the server then checks the
 * rest (account / tax rate / TDS section names, names already in use) and saves all or nothing. */
import type { ImportColumnGuide, ImportExcelColumn } from '../../components/ImportExcelDialog'
import { bulkImport } from './billingapi'
import type { PartyKind } from './billingapi'

export type ImportTarget = PartyKind | 'products'
export type ImportRow = Record<string, string | number | boolean | null>

interface ColumnDef extends ImportExcelColumn {
  /** API field the value is sent as. */
  field: string
  kind?: 'text' | 'number' | 'date' | 'yesno'
  required?: boolean
  description: string
  example?: string | number
}

const PARTY_COLUMNS: ColumnDef[] = [
  { key: 'name', header: 'Name', field: 'name', required: true, description: 'Must be unique.', example: 'Acme Traders' },
  { key: 'code', header: 'Code', field: 'code', description: 'Your own short code. Must be unique.', example: 'ACME' },
  { key: 'contact', header: 'Contact Person', field: 'contact_person', description: 'Used in reminders ("Dear …").', example: 'Ravi Kumar' },
  { key: 'email', header: 'Email', field: 'email', description: 'Where invoices and reminders go.', example: 'accounts@acme.in' },
  { key: 'phone', header: 'Phone', field: 'phone', description: '', example: '9876543210', text: true },
  { key: 'gstin', header: 'GSTIN', field: 'gstin', description: '15 characters. Empty for unregistered parties.', example: '29ABCDE1234F1Z5', text: true },
  { key: 'pan', header: 'PAN', field: 'pan', description: '10 characters. Needed for TDS returns.', example: 'ABCDE1234F', text: true },
  { key: 'state', header: 'State', field: 'state', description: 'Place of supply - decides CGST + SGST or IGST.', example: 'Karnataka' },
  { key: 'terms', header: 'Payment Terms (days)', field: 'payment_terms_days', kind: 'number', description: 'Days until an invoice / bill is due. Default 30.', example: 30 },
  { key: 'opening', header: 'Opening Balance', field: 'opening_balance', kind: 'number', description: 'What they owe (client) / you owe (supplier) on the start date. Booked against Opening Balance Equity.', example: 0 },
  { key: 'opening_date', header: 'Opening Balance Date', field: 'opening_balance_date', kind: 'date', description: 'YYYY-MM-DD or DD/MM/YYYY. Default: today.', example: '2026-04-01', text: true },
]

const COLUMNS: Record<ImportTarget, ColumnDef[]> = {
  clients: [
    ...PARTY_COLUMNS,
    { key: 'billing', header: 'Billing Address', field: 'billing_address', description: '', example: '1 MG Road, Bengaluru' },
    { key: 'shipping', header: 'Shipping Address', field: 'shipping_address', description: '' },
    { key: 'account', header: 'Receivable Account', field: 'receivable_account_name', description: 'Name of a Chart of Accounts sub-category. Empty: Accounts Receivable.' },
  ],
  suppliers: [
    ...PARTY_COLUMNS,
    { key: 'address', header: 'Address', field: 'address', description: '', example: '12 Industrial Area, Pune' },
    { key: 'account', header: 'Payable Account', field: 'payable_account_name', description: 'Name of a Chart of Accounts sub-category. Empty: Accounts Payable.' },
    { key: 'tds', header: 'TDS Section', field: 'tds_section_name', description: 'Name of a TDS section (Products & Tax Rates → TDS sections), used on their bills by default.' },
  ],
  products: [
    { key: 'name', header: 'Name', field: 'name', required: true, description: 'Must be unique.', example: 'A4 Paper Ream' },
    { key: 'code', header: 'Code', field: 'code', description: 'SKU / item code. Must be unique.', example: 'PAP-A4' },
    { key: 'type', header: 'Type', field: 'item_type', description: '"Goods" or "Service". Default: Goods.', example: 'Goods' },
    { key: 'hsn', header: 'HSN / SAC', field: 'hsn_sac_code', description: 'Printed on invoices and in the GST HSN summary.', example: '4802', text: true },
    { key: 'unit', header: 'Unit', field: 'unit', description: 'e.g. Nos, Kg, Hrs.', example: 'Nos' },
    { key: 'sale', header: 'Sale Price', field: 'sale_price', kind: 'number', description: 'Before GST.', example: 320 },
    { key: 'purchase', header: 'Purchase Price', field: 'purchase_price', kind: 'number', description: 'Before GST.', example: 250 },
    { key: 'tax', header: 'Tax Rate', field: 'tax_rate_name', description: 'Name of a tax rate, e.g. "GST 18%".', example: 'GST 12%' },
    { key: 'income', header: 'Income Account', field: 'income_account_name', description: 'Sub-category its sales are booked to.', example: 'Product Sales' },
    { key: 'expense', header: 'Expense Account', field: 'expense_account_name', description: 'Sub-category its purchases are booked to.', example: 'Office Supplies' },
    { key: 'track', header: 'Track Stock', field: 'track_inventory', kind: 'yesno', description: '"Yes" to keep stock of it (goods only). Default: No.', example: 'Yes' },
    { key: 'reorder', header: 'Reorder Level', field: 'reorder_level', kind: 'number', description: 'Flagged on the Inventory page at or below this.', example: 20 },
  ],
}

const LABELS: Record<ImportTarget, { title: string; item: string }> = {
  clients: { title: 'Clients', item: 'client' },
  suppliers: { title: 'Suppliers', item: 'supplier' },
  products: { title: 'Products', item: 'product' },
}

/** "2026-04-01", "01/04/2026", "1-4-2026" or a date cell (read as a date string) -> "2026-04-01". */
export function parseImportDate(value: string): string | null {
  const v = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  const dmy = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function importConfig(target: ImportTarget) {
  const columns = COLUMNS[target]
  const { title, item } = LABELS[target]

  const parseRow = (raw: Record<string, string>) => {
    const errors: string[] = []
    const data: ImportRow = {}
    for (const c of columns) {
      const value = (raw[c.header.toLowerCase()] ?? '').trim()
      if (!value) {
        if (c.required) errors.push(`${c.header} is required.`)
        continue
      }
      if (c.kind === 'number') {
        const n = Number(value.replace(/,/g, ''))
        if (Number.isNaN(n)) errors.push(`${c.header} "${value}" is not a number.`)
        else data[c.field] = c.field === 'payment_terms_days' ? Math.round(n) : String(n)
      } else if (c.kind === 'date') {
        const iso = parseImportDate(value)
        if (!iso) errors.push(`${c.header} "${value}" is not a date.`)
        else data[c.field] = iso
      } else if (c.kind === 'yesno') {
        const yes = /^(y|yes|true|1)$/i.test(value)
        if (!yes && !/^(n|no|false|0)$/i.test(value)) errors.push(`${c.header}: enter Yes or No.`)
        data[c.field] = yes
      } else {
        data[c.field] = c.field === 'gstin' || c.field === 'pan' ? value.toUpperCase() : value
      }
    }
    return { data: errors.length ? null : data, label: String(data.name ?? raw.name ?? '—'), errors }
  }

  const checkDuplicate = (row: ImportRow, accepted: ImportRow[]) => {
    const key = (r: ImportRow, f: string) => String(r[f] ?? '').trim().toLowerCase()
    for (const f of ['name', 'code', 'gstin']) {
      if (key(row, f) && accepted.some((a) => key(a, f) === key(row, f))) return `Same ${f.toUpperCase() === 'GSTIN' ? 'GSTIN' : f} as an earlier row.`
    }
    return null
  }

  /** Saves all rows or none. Server row errors are thrown in the shape the dialog shows ("Row N: …"). */
  const onSubmit = async (rows: ImportRow[]) => {
    const result = await bulkImport(target, rows, false)
    if (result.errors.length) {
      throw { response: { data: { error: result.errors.map((e) => `Row ${e.row}: ${e.message}`) } } }
    }
  }

  const sample = Object.fromEntries(columns.filter((c) => c.example !== undefined).map((c) => [c.key, c.example as string | number]))
  const guide: ImportColumnGuide[] = columns.map((c) => ({
    column: c.header, required: c.required, description: c.description, example: c.example !== undefined ? String(c.example) : undefined,
  }))

  return {
    title: `Import ${title.toLowerCase()} from Excel`,
    itemLabel: item,
    templateFilename: `${target}_template.xlsx`,
    templateColumns: columns.map(({ key, header, width, text }) => ({ key, header, width, text })),
    templateSampleRows: [sample],
    columnGuide: guide,
    rowGuide: [
      `One ${item} per row; the sample row is an example - replace it.`,
      `Rows with the same name, code or GSTIN as an earlier row are skipped as duplicates.`,
      `Nothing is saved unless every row can be imported - fix the rows listed and submit again.`,
      ...(target === 'products' ? [] : ['Opening balances are booked to the journal, as when you add one by hand.']),
    ],
    parseRow,
    checkDuplicate,
    onSubmit,
  }
}
