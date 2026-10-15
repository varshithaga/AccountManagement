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
  account: number
  account_name: string
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
export interface BillingDoc {
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
export interface CreditNote extends NoteSummary {
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
