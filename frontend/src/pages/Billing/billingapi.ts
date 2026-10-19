/** Clients, suppliers, products, tax rates, sales invoices, purchase bills, payments and aging. */
import api from '../../api/client'
import { confirmParams } from '../../utils/reconcileConfirm'
import type { Paginated } from '../../types'

export type PartyKind = 'clients' | 'suppliers'
export type DocKind = 'sales' | 'purchase'
export type DocStatus = 'DRAFT' | 'POSTED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED'
export type PaymentDirection = 'RECEIPT' | 'PAYMENT'
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'UPI' | 'CARD'

export interface Party {
  id: number
  code: string | null
  name: string
  contact_person: string
  email: string
  phone: string
  gstin: string | null
  pan: string
  state: string
  payment_terms_days: number
  opening_balance: string
  /** The day the opening balance is booked on (journal entry OB-C-<id> / OB-S-<id>). */
  opening_balance_date: string | null
  is_active: boolean
  created_at: string
  outstanding: string | null
  // clients
  billing_address?: string
  shipping_address?: string
  receivable_account?: number | null
  receivable_account_name?: string | null
  // suppliers
  address?: string
  payable_account?: number | null
  payable_account_name?: string | null
  /** Default TDS section for this supplier's bills. */
  tds_section?: number | null
  tds_section_name?: string | null
}

export interface TaxRate {
  id: number
  name: string
  rate: string
  is_active: boolean
  output_tax_account: number | null
  output_tax_account_name: string | null
  input_tax_account: number | null
  input_tax_account_name: string | null
}

export interface Product {
  id: number
  code: string | null
  name: string
  item_type: 'PRODUCT' | 'SERVICE'
  description: string
  hsn_sac_code: string
  unit: string
  sale_price: string
  purchase_price: string
  tax_rate: number | null
  tax_rate_name: string | null
  income_account: number | null
  income_account_name: string | null
  expense_account: number | null
  expense_account_name: string | null
  is_active: boolean
  /** Goods only: posting invoices, bills and notes moves its stock. */
  track_inventory: boolean
  reorder_level: string | null
}

/** A TDS section (194C, 194J ...): a bill under it keeps back rate% of its taxable value. */
export interface TdsSection {
  id: number
  code: string
  name: string
  rate: string
  threshold: string | null
  /** Where the TDS kept back is credited; none = the "TDS Payable" sub-category. */
  account: number | null
  account_name: string | null
  is_active: boolean
}

export interface DocItem {
  id: number
  product: number | null
  product_name: string | null
  description: string
  quantity: string
  unit_price: string
  discount_percent: string
  tax_rate: number | null
  tax_rate_name: string | null
  tax_percent: string | null
  amount: string
  tax_amount: string
  line_total: string
  /** tax_amount split: CGST + SGST within the company's state, IGST across states. */
  cgst_amount: string
  sgst_amount: string
  igst_amount: string
  hsn_sac_code: string
  unit: string
  account: number
  account_name: string
}

/** GST fields shared by invoices, bills and notes. Detail responses carry the split totals. */
export interface GstFields {
  /** The party's state when the document was saved. */
  place_of_supply: string
  /** Another state than the company's: IGST instead of CGST + SGST. */
  is_interstate: boolean
  cgst_amount?: string
  sgst_amount?: string
  igst_amount?: string
}

/** What a document prints about its client / supplier. */
export interface PrintParty {
  name: string
  gstin: string
  pan: string
  address: string
  state: string
  email: string
  phone: string
  contact_person: string
}

/** The company itself (Period Close → Company details). */
export interface Company {
  name: string
  gstin: string
  state: string
  address: string
  email: string
  phone: string
}

export interface DocPayment {
  id: number
  payment: number
  payment_number: string
  payment_date: string
  method: PaymentMethod
  amount: string
}

/** A sales invoice or a purchase bill - the shared fields plus each one's own number / party / date. */
export interface BillingDoc extends GstFields {
  id: number
  invoice_number?: string
  client?: number
  client_name?: string
  invoice_date?: string
  bill_number?: string
  supplier?: number
  supplier_name?: string
  bill_date?: string
  due_date: string
  subtotal: string
  tax_amount: string
  total: string
  amount_paid: string
  /** Taken off by posted credit / debit notes. */
  amount_credited: string
  balance_due: string
  status: DocStatus
  notes: string
  journal_entry: number | null
  journal_entry_number: string | null
  created_by: string | null
  created_at: string
  items?: DocItem[]
  payments?: DocPayment[]
  credit_notes?: NoteSummary[]
  party?: PrintParty
  // sales invoices
  reminder_count?: number
  last_reminder_at?: string | null
  /** The recurring invoice that raised it. */
  recurring_invoice?: number | null
  // purchase bills: balance due = total - TDS - paid - credited
  tds_section?: number | null
  tds_section_name?: string | null
  tds_rate?: string
  tds_amount?: string
}

export interface NoteSummary {
  id: number
  note_number: string
  note_date: string
  total: string
  status: 'POSTED' | 'CANCELLED'
  reason: string
}

/** A credit note (on a sales invoice) or debit note (on a purchase bill). Posted when created. */
export interface CreditNote extends NoteSummary, GstFields {
  kind: 'SALES' | 'PURCHASE'
  sales_invoice: number | null
  purchase_bill: number | null
  document_number: string
  party_name: string
  subtotal: string
  tax_amount: string
  journal_entry: number | null
  journal_entry_number: string | null
  items: DocItem[]
  party: PrintParty
}

export interface DocSummary {
  by_status: Record<DocStatus, { count: number; total: number; balance_due: number }>
  outstanding: number
  overdue: { count: number; amount: number }
}

export interface Allocation {
  id: number
  amount: string
  sales_invoice: number | null
  invoice_number: string | null
  purchase_bill: number | null
  bill_number: string | null
}

export interface Payment {
  id: number
  payment_number: string
  direction: PaymentDirection
  client: number | null
  supplier: number | null
  party_name: string | null
  payment_date: string
  amount: string
  method: PaymentMethod
  bank_account: number | null
  bank_account_name: string | null
  reference_number: string
  notes: string
  allocated: string
  unallocated: string
  allocations: Allocation[]
  journal_entry: number | null
  journal_entry_number: string | null
  created_by: string | null
  created_at: string
}

export interface StatementRow {
  date: string
  type: 'INVOICE' | 'BILL' | 'RECEIPT' | 'PAYMENT' | 'CREDIT_NOTE' | 'DEBIT_NOTE'
  id: number
  number: string
  due_date: string | null
  increase: number
  decrease: number
  balance: number
}

export interface PartyStatement {
  party: { id: number; name: string; kind: 'client' | 'supplier' }
  date_from: string | null
  date_to: string | null
  opening_balance: number
  total_increase: number
  total_decrease: number
  closing_balance: number
  rows: StatementRow[]
}

export const AGING_BUCKETS = ['current', '1_30', '31_60', '61_90', 'over_90'] as const
export type AgingBucket = typeof AGING_BUCKETS[number]

export interface AgingParty extends Record<AgingBucket, number> {
  party_id: number
  party_name: string
  opening_balance: number
  advances: number
  total: number
  documents: {
    id: number
    number: string
    date: string
    due_date: string
    total: number
    balance_due: number
    days_overdue: number
    bucket: AgingBucket
  }[]
}

export interface AgingReport {
  kind: 'receivables' | 'payables'
  as_of: string
  buckets: AgingBucket[]
  parties: AgingParty[]
  totals: Record<AgingBucket | 'opening_balance' | 'advances' | 'total', number>
}

export interface ItemPayload {
  product_id?: number | null
  description?: string
  quantity?: string
  unit_price?: string
  discount_percent?: string
  tax_rate_id?: number | null
  account_id?: number | null
}

type Params = Record<string, unknown>

const page = async <T>(url: string, params: Params = {}): Promise<Paginated<T>> => (await api.get(url, { params })).data

/** Every row of a list endpoint (walks the pages) - for dropdowns that need the full set. */
async function all<T>(url: string, params: Params = {}): Promise<T[]> {
  const rows: T[] = []
  let p: number | null = 1
  while (p) {
    const data: Paginated<T> = (await api.get(url, { params: { ...params, page: p, limit: 500 } })).data
    rows.push(...data.results)
    p = data.next ?? null
  }
  return rows
}

export const partiesApi = (kind: PartyKind) => ({
  search: (params: Params = {}) => page<Party>(`/${kind}/`, params),
  get: async (id: number): Promise<Party> => (await api.get(`/${kind}/${id}/`)).data,
  create: async (payload: Params): Promise<Party> => (await api.post(`/${kind}/`, payload)).data,
  update: async (id: number, payload: Params): Promise<Party> => (await api.patch(`/${kind}/${id}/`, payload)).data,
  remove: (id: number) => api.delete(`/${kind}/${id}/`),
  statement: async (id: number, params: Params = {}): Promise<PartyStatement> =>
    (await api.get(`/${kind}/${id}/statement/`, { params })).data,
})

export const taxRatesApi = {
  list: (params: Params = {}) => all<TaxRate>('/tax-rates/', params),
  create: async (payload: Params): Promise<TaxRate> => (await api.post('/tax-rates/', payload)).data,
  update: async (id: number, payload: Params): Promise<TaxRate> => (await api.patch(`/tax-rates/${id}/`, payload)).data,
  remove: (id: number) => api.delete(`/tax-rates/${id}/`),
}

export const productsApi = {
  search: (params: Params = {}) => page<Product>('/products/', params),
  create: async (payload: Params): Promise<Product> => (await api.post('/products/', payload)).data,
  update: async (id: number, payload: Params): Promise<Product> => (await api.patch(`/products/${id}/`, payload)).data,
  remove: (id: number) => api.delete(`/products/${id}/`),
}

/** Sales invoices and purchase bills share one API shape. */
export const docsApi = (kind: DocKind) => {
  const base = kind === 'sales' ? '/sales-invoices' : '/purchase-bills'
  return {
    search: (params: Params = {}) => page<BillingDoc>(`${base}/`, params),
    summary: async (): Promise<DocSummary> => (await api.get(`${base}/summary/`)).data,
    get: async (id: number): Promise<BillingDoc> => (await api.get(`${base}/${id}/`)).data,
    create: async (payload: Params): Promise<BillingDoc> => (await api.post(`${base}/`, payload)).data,
    update: async (id: number, payload: Params): Promise<BillingDoc> => (await api.patch(`${base}/${id}/`, payload)).data,
    post: async (id: number): Promise<BillingDoc> => (await api.post(`${base}/${id}/post/`)).data,
    cancel: async (id: number, confirmUnmatch = false): Promise<BillingDoc> =>
      (await api.post(`${base}/${id}/cancel/`, confirmParams(confirmUnmatch))).data,
    remove: (id: number) => api.delete(`${base}/${id}/`),
    nextNumber: async (): Promise<string | null> =>
      kind === 'sales' ? (await api.get(`${base}/next-number/`)).data.invoice_number : null,
  }
}

export const paymentsApi = {
  search: (params: Params = {}) => page<Payment>('/payments/', params),
  get: async (id: number): Promise<Payment> => (await api.get(`/payments/${id}/`)).data,
  create: async (payload: Params): Promise<Payment> => (await api.post('/payments/', payload)).data,
  update: async (id: number, payload: Params): Promise<Payment> => (await api.patch(`/payments/${id}/`, payload)).data,
  remove: (id: number, confirmUnmatch = false) => api.delete(`/payments/${id}/`, { params: confirmParams(confirmUnmatch) }),
  allocate: async (id: number, allocations: Params[]): Promise<Payment> =>
    (await api.post(`/payments/${id}/allocate/`, { allocations })).data,
  removeAllocation: async (id: number, allocationId: number): Promise<Payment> =>
    (await api.delete(`/payments/${id}/allocations/${allocationId}/`)).data,
}

export const creditNotesApi = {
  create: async (payload: Params): Promise<CreditNote> => (await api.post('/credit-notes/', payload)).data,
  get: async (id: number): Promise<CreditNote> => (await api.get(`/credit-notes/${id}/`)).data,
  cancel: async (id: number, confirmUnmatch = false): Promise<CreditNote> =>
    (await api.post(`/credit-notes/${id}/cancel/`, confirmParams(confirmUnmatch))).data,
  remove: (id: number) => api.delete(`/credit-notes/${id}/`),
}

export const tdsSectionsApi = {
  list: (params: Params = {}) => all<TdsSection>('/tds-sections/', params),
  create: async (payload: Params): Promise<TdsSection> => (await api.post('/tds-sections/', payload)).data,
  update: async (id: number, payload: Params): Promise<TdsSection> => (await api.patch(`/tds-sections/${id}/`, payload)).data,
  remove: (id: number) => api.delete(`/tds-sections/${id}/`),
}

export interface BulkImportResult {
  created: number
  valid_rows: number
  /** Row numbers count from 1 (the first data row). */
  errors: { row: number; message: string }[]
  dry_run: boolean
}

/** All or nothing: nothing is saved unless every row is valid; dryRun only checks. */
export const bulkImport = async (target: PartyKind | 'products', rows: Params[], dryRun: boolean): Promise<BulkImportResult> =>
  (await api.post(`/${target}/bulk-import/`, { rows, dry_run: dryRun })).data

export const companyApi = {
  get: async (): Promise<Company> => (await api.get('/period-close/company/')).data,
}

export interface GstTotals {
  taxable: number
  cgst: number
  sgst: number
  igst: number
  tax: number
}

export interface GstRateRow extends GstTotals {
  rate: number
  name: string
}

export interface GstDocument extends GstTotals {
  kind: 'INVOICE' | 'CREDIT_NOTE' | 'BILL' | 'DEBIT_NOTE'
  id: number
  number: string
  date: string
  party: string
  gstin: string
  place_of_supply: string
  is_interstate: boolean
  total: number
}

export interface GstSummary {
  period: string
  date_from: string | null
  date_to: string | null
  company: { state: string; gstin: string }
  outward: GstTotals & {
    by_rate: GstRateRow[]
    b2b: GstTotals
    b2c: GstTotals
    intra_state: GstTotals
    inter_state: GstTotals
  }
  inward: GstTotals & { by_rate: GstRateRow[] }
  input_tax_credit: GstTotals
  ineligible_input_tax: number
  /** Positive = to pay; negative = credit carried forward. */
  net_payable: { cgst: number; sgst: number; igst: number; total: number }
  hsn_summary: (GstTotals & { hsn_sac_code: string; unit: string; quantity: number })[]
  documents: GstDocument[]
}

export interface GstParams {
  period: string
  date_from?: string
  date_to?: string
}

export const gstApi = {
  summary: async (params: GstParams, signal?: AbortSignal): Promise<GstSummary> =>
    (await api.get('/reports/gst-summary/', { params, signal })).data,
  exportCsv: async (params: GstParams): Promise<Blob> =>
    (await api.get('/reports/gst-summary/', { params: { ...params, format: 'csv' }, responseType: 'blob' })).data,
}

export interface TdsSectionRow {
  section: number
  code: string
  name: string
  rate: number
  bills: number
  taxable: number
  tds: number
}

export interface TdsSummary {
  period: string
  date_from: string | null
  date_to: string | null
  total_deducted: number
  total_taxable: number
  /** The TDS accounts in the period: credited (kept back, incl. manual entries) and debited (paid to the government). */
  books: { credited: number; paid: number }
  /** Still to be paid to the government at the end of the period. */
  outstanding: number
  by_section: TdsSectionRow[]
  by_supplier: { supplier: number; supplier_name: string; pan: string; section_code: string; bills: number; taxable: number; tds: number }[]
  bills: { id: number; bill_number: string; bill_date: string; supplier_name: string; pan: string; section_code: string; rate: number; taxable: number; tds: number }[]
}

export const tdsApi = {
  summary: async (params: GstParams, signal?: AbortSignal): Promise<TdsSummary> =>
    (await api.get('/reports/tds-summary/', { params, signal })).data,
  exportCsv: async (params: GstParams): Promise<Blob> =>
    (await api.get('/reports/tds-summary/', { params: { ...params, format: 'csv' }, responseType: 'blob' })).data,
}

export interface StockItem {
  product: number
  name: string
  code: string | null
  unit: string
  hsn_sac_code: string
  is_active: boolean
  quantity_in: number
  quantity_out: number
  on_hand: number
  /** Weighted average of everything that came in with a cost (else the product's purchase price). */
  average_cost: number
  value: number
  reorder_level: string | null
  below_reorder_level: boolean
  negative: boolean
}

export interface StockSummary {
  as_of: string | null
  products: StockItem[]
  total_value: number
  below_reorder_level: number
  negative: number
}

export type StockMovementKind = 'OPENING' | 'ADJUSTMENT' | 'PURCHASE' | 'SALE' | 'SALES_RETURN' | 'PURCHASE_RETURN'

export interface StockMovement {
  id: number
  date: string
  kind: StockMovementKind
  /** + in, - out */
  quantity: number
  unit_cost: number | null
  note: string
  document: { type: 'sales_invoice' | 'purchase_bill' | 'credit_note'; id: number; number: string } | null
  /** Stock after this movement. */
  balance: number
  created_by: string | null
}

export interface ProductMovements {
  product: { id: number; name: string; unit: string }
  opening: number
  closing: number
  rows: StockMovement[]
}

export const inventoryApi = {
  stock: async (params: { as_of?: string; search?: string } = {}, signal?: AbortSignal): Promise<StockSummary> =>
    (await api.get('/inventory/', { params, signal })).data,
  movements: async (productId: number, params: { date_from?: string; date_to?: string } = {}): Promise<ProductMovements> =>
    (await api.get(`/inventory/${productId}/movements/`, { params })).data,
  /** Opening stock (opening: true) or a correction after a count / damage (+ or -). */
  adjust: async (payload: { product: number; quantity: string; movement_date?: string; unit_cost?: string | null; note?: string; opening?: boolean }): Promise<ProductMovements & { id: number }> =>
    (await api.post('/inventory/adjustments/', payload)).data,
  removeAdjustment: (id: number) => api.delete(`/inventory/adjustments/${id}/`),
}

export type Frequency = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY'

export interface RecurringInvoice {
  id: number
  name: string
  client: number
  client_name: string
  frequency: Frequency
  start_date: string
  /** The date of the next invoice it will raise. */
  next_date: string
  end_date: string | null
  items: ItemPayload[]
  notes: string
  /** Post the invoices straight away instead of leaving drafts. */
  auto_post: boolean
  is_active: boolean
  invoices_created: number
  /** Why the last run failed ("" when fine) - the template is skipped until it is fixed. */
  last_error: string
  created_by: string | null
  created_at: string
  /** Detail only: the latest invoices it raised. */
  invoices?: { id: number; invoice_number: string; invoice_date: string; total: string; status: DocStatus }[]
}

export interface GenerateResult {
  invoices_created: number
  templates: number
  errors: { id: number; name: string; error: string }[]
}

export const recurringApi = {
  search: async (params: Params = {}): Promise<Paginated<RecurringInvoice> & { due: number }> =>
    (await api.get('/recurring-invoices/', { params })).data,
  get: async (id: number): Promise<RecurringInvoice> => (await api.get(`/recurring-invoices/${id}/`)).data,
  create: async (payload: Params): Promise<RecurringInvoice> => (await api.post('/recurring-invoices/', payload)).data,
  update: async (id: number, payload: Params): Promise<RecurringInvoice> =>
    (await api.patch(`/recurring-invoices/${id}/`, payload)).data,
  remove: (id: number) => api.delete(`/recurring-invoices/${id}/`),
  /** Raises every invoice that has fallen due. */
  generateDue: async (): Promise<GenerateResult> => (await api.post('/recurring-invoices/generate/')).data,
  generateOne: async (id: number): Promise<RecurringInvoice & { invoices_created: number; invoice_ids: number[] }> =>
    (await api.post(`/recurring-invoices/${id}/generate/`)).data,
}

export interface EmailStatus {
  configured: boolean
  from: string
}

export interface ReminderClient {
  client: number
  client_name: string
  email: string
  phone: string
  total_overdue: number
  oldest_days_overdue: number
  last_reminder_at: string | null
  invoices: { id: number; invoice_number: string; invoice_date: string; due_date: string; balance_due: number; days_overdue: number; reminder_count: number; last_reminder_at: string | null }[]
  /** Ready-made reminder text. */
  subject: string
  message: string
}

export interface Reminders {
  as_of: string
  email: EmailStatus
  clients: ReminderClient[]
  total_overdue: number
}

export const emailApi = {
  status: async (): Promise<EmailStatus> => (await api.get('/email/status/')).data,
  /** Sends a posted invoice with its PDF attached. */
  sendInvoice: async (invoiceId: number, form: { to: string; cc?: string; subject?: string; message?: string }, pdf?: Blob, filename?: string): Promise<{ sent_to: string[] }> => {
    const body = new FormData()
    Object.entries(form).forEach(([k, v]) => body.append(k, v ?? ''))
    if (pdf) body.append('file', pdf, filename ?? 'invoice.pdf')
    return (await api.post(`/sales-invoices/${invoiceId}/email/`, body)).data
  },
}

export const remindersApi = {
  list: async (params: { as_of?: string; min_days?: number } = {}): Promise<Reminders> =>
    (await api.get('/reminders/', { params })).data,
  /** send_email false: it was sent another way (phone, WhatsApp) - only record it. */
  send: async (payload: { client_id: number; invoice_ids: number[]; to?: string; cc?: string; subject?: string; message?: string; send_email: boolean }): Promise<{ reminded: number; sent_to: string[]; last_reminder_at: string }> =>
    (await api.post('/reminders/send/', payload)).data,
}

export const agingApi = {
  receivables: async (asOf?: string): Promise<AgingReport> =>
    (await api.get('/reports/receivables-aging/', { params: { as_of: asOf || undefined } })).data,
  payables: async (asOf?: string): Promise<AgingReport> =>
    (await api.get('/reports/payables-aging/', { params: { as_of: asOf || undefined } })).data,
}

/** Open (posted, not fully paid) invoices or bills of one party - what a payment can be allocated to. */
export async function openDocuments(kind: DocKind, partyId: number): Promise<BillingDoc[]> {
  const partyParam = kind === 'sales' ? 'client' : 'supplier'
  const [posted, partial] = await Promise.all([
    all<BillingDoc>(kind === 'sales' ? '/sales-invoices/' : '/purchase-bills/', { [partyParam]: partyId, status: 'POSTED' }),
    all<BillingDoc>(kind === 'sales' ? '/sales-invoices/' : '/purchase-bills/', { [partyParam]: partyId, status: 'PARTIALLY_PAID' }),
  ])
  const dateOf = (d: BillingDoc) => d.invoice_date ?? d.bill_date ?? ''
  return [...posted, ...partial].sort((a, b) => dateOf(a).localeCompare(dateOf(b)) || a.id - b.id)
}

/** First message of an API error: {"error": [...]}, {"detail": ...} or {field: [...]}. */
export function errorText(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: unknown } }).response?.data
  if (!data || typeof data !== 'object') return fallback
  const d = data as Record<string, unknown>
  const first = d.error ?? d.detail
  if (Array.isArray(first) && first.length) return String(first[0])
  if (typeof first === 'string') return first
  for (const [field, value] of Object.entries(d)) {
    if (Array.isArray(value) && value.length) return `${field.replace(/_/g, ' ')}: ${value[0]}`
  }
  return fallback
}
