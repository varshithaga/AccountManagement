/** Deep Teal & Amber page building blocks shared by every screen: the page header, KPI tiles,
 * the search box and the empty state. */
import type { ReactNode } from 'react'
import { Search, X } from 'lucide-react'

/** Sora title + one muted line on the left; actions on the right
 * (order: Delete all → Import Excel → Export → primary "+ Add …"). */
export function PageHeader({ title, description, eyebrow, actions }: {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.08em] text-primary">{eyebrow}</p>}
        <h1 className="text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-[15px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div>}
    </div>
  )
}

export type KpiTone = 'primary' | 'success' | 'danger' | 'warning' | 'caution' | 'info' | 'equity' | 'neutral'

export const TONE_SOFT: Record<KpiTone, string> = {
  primary: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success-text',
  danger: 'bg-danger-soft text-danger-text',
  warning: 'bg-warning-soft text-warning-text',
  caution: 'bg-caution-soft text-caution-text',
  info: 'bg-info-soft text-info-text',
  equity: 'bg-equity-soft text-equity-text',
  neutral: 'bg-surface-muted text-muted',
}

/** 34px rounded icon tile in a soft status colour. */
export function IconTile({ tone = 'primary', children, className = '' }: { tone?: KpiTone; children: ReactNode; className?: string }) {
  return (
    <span className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] ${TONE_SOFT[tone]} [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:stroke-[1.8] ${className}`}>
      {children}
    </span>
  )
}

/** KPI card: label + icon tile, a big mono value, then a caption. `dark` is the dark-teal hero variant. */
export function KpiTile({ label, value, caption, icon, tone = 'primary', dark = false, valueClassName = '', children }: {
  label: ReactNode
  value: ReactNode
  caption?: ReactNode
  icon?: ReactNode
  tone?: KpiTone
  dark?: boolean
  valueClassName?: string
  children?: ReactNode
}) {
  return (
    <div className={`flex flex-col rounded-[18px] p-5 ${dark ? 'bg-sidebar text-white' : 'border border-border bg-surface'}`}>
      <div className="flex items-center justify-between gap-3">
        <span className={`text-[13px] font-semibold ${dark ? 'text-sidebar-label' : 'text-muted'}`}>{label}</span>
        {icon && (dark
          ? <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-white/[0.08] text-highlight [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:stroke-[1.8]">{icon}</span>
          : <IconTile tone={tone}>{icon}</IconTile>)}
      </div>
      <div className={`num mt-3 text-[26px] font-semibold leading-tight ${dark ? 'text-white' : 'text-ink'} ${valueClassName}`}>{value}</div>
      {caption && <p className={`mt-1 text-xs ${dark ? 'text-sidebar-label' : 'text-muted'}`}>{caption}</p>}
      {children}
    </div>
  )
}

/** 48px search input with a leading icon and a clear button. */
export function SearchBox({ value, onChange, placeholder, className = '' }: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  className?: string
}) {
  return (
    <div className={`relative flex items-center ${className}`}>
      <Search className="pointer-events-none absolute left-3.5 h-[18px] w-[18px] stroke-[1.8] text-muted" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 w-full rounded-xl border border-input bg-surface pl-11 pr-10 text-sm font-medium text-ink outline-none transition-colors placeholder:text-muted focus:border-primary focus:ring-[3px] focus:ring-primary-soft"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

/** Centred muted icon, one line, one optional action. */
export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-muted text-muted [&_svg]:h-7 [&_svg]:w-7 [&_svg]:stroke-[1.8]">
        {icon}
      </div>
      <p className="font-display text-base font-semibold text-ink">{title}</p>
      {text && <p className="mt-1 text-sm text-muted">{text}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

/** 36px icon buttons for table rows: edit (muted) and delete (red). */
export function RowAction({ onClick, title, danger = false, disabled = false, children }: {
  onClick: () => void
  title: string
  danger?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:stroke-[1.8] ${
        danger ? 'text-danger-text hover:bg-danger-soft' : 'text-muted hover:bg-surface-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}
