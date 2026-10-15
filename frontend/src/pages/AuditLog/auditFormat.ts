/** Readable labels for the audit log's actions, record types and changes. */
import type { Tone } from '../../components/tw'
import type { AuditEntry } from './auditlogapi'

/** Friendly names for the record types in the log. */
export const ENTITY_LABELS: Record<string, string> = {
  User: 'User', Role: 'Role', Category: 'Category', SubCategory: 'Sub-category', CategoryKeyword: 'Keyword rule',
  BaiCode: 'BAI code', BankAccount: 'Bank account', BankStatement: 'Bank statement', Transaction: 'Bank transactions',
  JournalImportBatch: 'Journal import', JournalEntry: 'Journal entry', Client: 'Client', Supplier: 'Supplier',
  Product: 'Product', TaxRate: 'Tax rate', SalesInvoice: 'Sales invoice', PurchaseBill: 'Purchase bill',
  CreditNote: 'Credit / debit note', Payment: 'Payment', PaymentAllocation: 'Payment allocation',
  ReconciliationPeriod: 'Reconciled month', BookClosing: 'Books closed', AccountingSettings: 'Accounting settings',
  CategorizationSettings: 'Categorization settings', ReconciliationSettings: 'Reconciliation settings',
}

export const ACTIONS: Record<string, { label: string; tone: Tone }> = {
  CREATE: { label: 'Created', tone: 'success' },
  UPDATE: { label: 'Changed', tone: 'info' },
  DELETE: { label: 'Deleted', tone: 'error' },
  POST: { label: 'Posted', tone: 'primary' },
  CANCEL: { label: 'Cancelled', tone: 'warning' },
  PASSWORD: { label: 'Password changed', tone: 'neutral' },
  LOGIN: { label: 'Signed in', tone: 'neutral' },
  LOGIN_FAILED: { label: 'Sign-in failed', tone: 'error' },
  FINALIZE: { label: 'Made final', tone: 'primary' },
  REOPEN: { label: 'Reopened', tone: 'warning' },
}

export const actionLabel = (action: string) => ACTIONS[action]?.label ?? action
export const entityLabel = (entity: string) => ENTITY_LABELS[entity] ?? entity

const fieldLabel = (key: string) => key.replace(/_id$/, '').replace(/_/g, ' ')

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** The changes of one entry as readable lines: "phone: 123 → 999", "name: Acme". */
export function changeLines(entry: Pick<AuditEntry, 'action' | 'changes'>): string[] {
  const changes = entry.changes
  if (!changes) return []
  return Object.entries(changes).map(([key, value]) => {
    if (Array.isArray(value) && value.length === 2 && key !== 'ids') return `${fieldLabel(key)}: ${show(value[0])} → ${show(value[1])}`
    if (key === 'ids' && Array.isArray(value)) return `ids: ${value.slice(0, 20).join(', ')}${value.length > 20 ? '…' : ''}`
    return `${fieldLabel(key)}: ${show(value)}`
  })
}
