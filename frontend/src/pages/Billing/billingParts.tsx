/** Small building blocks shared by the sales & purchases pages. */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import SearchableSelect from '../../components/SearchableSelect'
import type { SearchableOption } from '../../components/SearchableSelect'
import { Chip } from '../../components/tw'
import type { Tone } from '../../components/tw'
import { subCategoryOptionsFetcher } from '../../utils/categoryLookup'
import { categoryLookupApi } from '../../api/resources'
import type { AccountType } from '../../types'
import { partiesApi } from './billingapi'
import type { DocStatus, PartyKind } from './billingapi'

export const TH = 'px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted'
export const TD = 'px-4 py-3 align-middle text-ink'
export const TABLE_HEAD_ROW = 'border-b border-border bg-slate-50 dark:bg-slate-900/80'
export const TABLE_ROW = 'border-b border-border-soft last:border-0 hover:bg-surface-muted/60'

const STATUS: Record<DocStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  POSTED: { label: 'Unpaid', tone: 'warning' },
  PARTIALLY_PAID: { label: 'Partly paid', tone: 'info' },
  PAID: { label: 'Paid', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'error' },
}

export function StatusChip({ status, overdue = false }: { status: DocStatus; overdue?: boolean }) {
  if (overdue) return <Chip tone="error">Overdue</Chip>
  return <Chip tone={STATUS[status].tone}>{STATUS[status].label}</Chip>
}

export const statusLabel = (status: DocStatus) => STATUS[status].label

export const METHOD_LABELS = {
  CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', CHEQUE: 'Cheque', UPI: 'UPI', CARD: 'Card',
} as const

/** "2026-10-15" -> "15 Oct 2026". */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const todayIso = () => new Date().toISOString().slice(0, 10)

export const isOverdue = (status: DocStatus, dueDate: string) =>
  (status === 'POSTED' || status === 'PARTIALLY_PAID') && dueDate < todayIso()

/** Searchable client / supplier dropdown (active ones, 20 per page). */
export function PartySelect({ kind, value, valueLabel, onChange, label, required, disabled }: {
  kind: PartyKind
  value: number | null
  /** Shown for a preselected value until the user opens the list. */
  valueLabel?: string | null
  onChange: (id: number | null, name: string | null) => void
  label?: string
  required?: boolean
  disabled?: boolean
}) {
  const [option, setOption] = useState<SearchableOption | null>(null)
  useEffect(() => {
    if (!value) setOption(null)
    else if (option?.id !== value) setOption({ id: value, label: valueLabel || `#${value}` })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, valueLabel])

  return (
    <SearchableSelect
      label={label ?? (kind === 'clients' ? 'Client' : 'Supplier')}
      value={option}
      required={required}
      disabled={disabled}
      placeholder={kind === 'clients' ? 'Search clients…' : 'Search suppliers…'}
      onChange={(opt) => {
        setOption(opt)
        onChange(opt?.id ?? null, opt?.label ?? null)
      }}
      fetchOptions={async ({ search, page }) => {
        const res = await partiesApi(kind).search({ search: search.trim() || undefined, is_active: true, page, limit: 20 })
        return { options: res.results.map((p) => ({ id: p.id, label: p.name })), hasMore: Boolean(res.next) }
      }}
    />
  )
}

/** Searchable Chart of Accounts account (sub-category) dropdown, by id. */
export function AccountSelect({ value, valueLabel, onChange, label, required, accountType }: {
  value: number | null
  valueLabel?: string | null
  onChange: (id: number | null) => void
  label: string
  required?: boolean
  /** Limit the list to one account type. */
  accountType?: AccountType
}) {
  const [option, setOption] = useState<SearchableOption | null>(null)
  useEffect(() => {
    if (!value) {
      setOption(null)
      return
    }
    if (option?.id === value) return
    setOption({ id: value, label: valueLabel || `Account #${value}` })
    if (valueLabel) return
    let cancelled = false
    categoryLookupApi.subCategories({ ids: String(value) })
      .then((res) => { if (!cancelled && res.results[0]) setOption({ id: value, label: res.results[0].name }) })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, valueLabel])

  const fetcher = subCategoryOptionsFetcher(null)
  return (
    <SearchableSelect
      label={label}
      value={option}
      required={required}
      placeholder="Search accounts…"
      resetKey={accountType ?? null}
      onChange={(opt) => {
        setOption(opt)
        onChange(opt?.id ?? null)
      }}
      fetchOptions={accountType
        ? async ({ search, page }) => {
          const res = await categoryLookupApi.subCategories({
            search: search.trim() || undefined, account_type: accountType, page, limit: 20,
          })
          return {
            options: res.results.map((s) => ({ id: s.id, label: `${s.name} — ${s.category_name}` })),
            hasMore: Boolean(res.next),
          }
        }
        : fetcher}
    />
  )
}

/** A label above a read-only value, for detail drawers. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">{label}</p>
      <div className="mt-0.5 truncate text-sm font-semibold text-ink">{children}</div>
    </div>
  )
}
