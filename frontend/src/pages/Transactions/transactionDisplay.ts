/** General Ledger page: labels, colours and number formatting. */
import type { CategorizationSource, TransactionStatus } from '../../types'
import type { Tone } from '../../components/tw'

export const SOURCE_LABEL: Record<CategorizationSource, string> = {
  TRANSFER: 'Transfer',
  USER_RULE: 'User rule',
  HISTORY_EXACT: 'History match',
  SCORING: 'Scored',
  MANUAL: 'Manual',
}

export const SOURCE_TONE: Record<CategorizationSource, Tone> = {
  TRANSFER: 'secondary',
  USER_RULE: 'success',
  HISTORY_EXACT: 'info',
  SCORING: 'warning',
  MANUAL: 'primary',
}

export const STATUS_LABEL: Record<TransactionStatus, string> = {
  AUTO_ASSIGNED: 'Auto-assigned',
  MANUAL: 'Manually assigned',
  NEEDS_REVIEW: 'Needs review',
  UNCATEGORIZED: 'Uncategorized',
  TRANSFER: 'Transfer',
}

export const STATUS_TONE: Record<TransactionStatus, Tone> = {
  AUTO_ASSIGNED: 'success',
  MANUAL: 'primary',
  NEEDS_REVIEW: 'warning',
  UNCATEGORIZED: 'neutral',
  TRANSFER: 'secondary',
}

export type Period = 'this_month' | 'next_month' | 'last_month' | 'this_quarter' | 'this_year' | 'all_time' | 'custom'

export const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'this_month', label: 'This Month' },
  { value: 'next_month', label: 'Next Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'this_year', label: 'This Year' },
  { value: 'all_time', label: 'All' },
  { value: 'custom', label: 'Custom Range' },
]

export function formatAmount(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '' || Number(val) === 0) return '—'
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.-]+/g, ''))
  if (isNaN(num) || num === 0) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(num)
}

export function formatK(val: number): string {
  if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`
  if (val >= 1000) return `₹${(val / 1000).toFixed(1)}k`
  if (val === 0) return '₹0'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val)
}
