/** Period presets shared by the filters on Journal Entries and Bank Reconciliation. */
export type PeriodPreset = 'this_month' | 'next_month' | 'last_month' | 'this_quarter' | 'this_year' | 'all_time' | 'custom'

export const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: 'this_month', label: 'This Month' },
  { value: 'next_month', label: 'Next Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'this_year', label: 'This Year' },
  { value: 'all_time', label: 'All' },
  { value: 'custom', label: 'Custom Range' },
]

export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const MONTH_OFFSET: Partial<Record<PeriodPreset, number>> = { this_month: 0, next_month: 1, last_month: -1 }

/** 'YYYY-MM' for the one-month presets (This / Next / Last Month), else null. */
export function presetMonth(period: PeriodPreset): string | null {
  const offset = MONTH_OFFSET[period]
  if (offset === undefined) return null
  const now = new Date()
  return isoDate(new Date(now.getFullYear(), now.getMonth() + offset, 1)).slice(0, 7)
}

/** [date_from, date_to] for a preset ('' = no limit); custom returns the picked dates. */
export function periodRange(period: PeriodPreset, customFrom = '', customTo = ''): [string, string] {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const offset = MONTH_OFFSET[period]
  // new Date(y, n, 0) is the last day of month n-1 (JS rolls month overflow into the next year).
  if (offset !== undefined) return [isoDate(new Date(y, m + offset, 1)), isoDate(new Date(y, m + offset + 1, 0))]
  if (period === 'this_quarter') {
    const q = m - (m % 3)
    return [isoDate(new Date(y, q, 1)), isoDate(new Date(y, q + 3, 0))]
  }
  if (period === 'this_year') return [`${y}-01-01`, `${y}-12-31`]
  if (period === 'custom') return [customFrom, customTo]
  return ['', '']
}

/** Period presets the report endpoints resolve server-side (Account Ledger, Cash Flow). */
export type ReportPeriod =
  | 'this_month' | 'last_month' | 'this_quarter' | 'this_fiscal_year' | 'last_fiscal_year' | 'all_time' | 'custom'

export const REPORT_PERIOD_OPTIONS: { value: ReportPeriod; label: string }[] = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'this_fiscal_year', label: 'This Financial Year' },
  { value: 'last_fiscal_year', label: 'Last Financial Year' },
  { value: 'all_time', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
]

export const isReportPeriod = (value: string | null): value is ReportPeriod =>
  REPORT_PERIOD_OPTIONS.some((p) => p.value === value)

/** ₹ amount with two decimals; negative amounts get a leading minus. */
export function formatMoney(value: number | string | null | undefined): string {
  const n = Number(value || 0)
  const formatted = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `−₹${formatted}` : `₹${formatted}`
}
