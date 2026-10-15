import type { ReactNode } from 'react'
import { X } from 'lucide-react'

/** Navy & Saffron dialog: navy overlay, 24px-radius card, icon tile + Sora title, scrolling body, footer bar. */
export function Modal({
  open, onClose, title, subtitle, icon, children, footer, footerHint, widthClassName = 'max-w-md',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** One muted line under the title. */
  subtitle?: ReactNode
  icon?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** Muted text on the left of the footer bar. */
  footerHint?: ReactNode
  widthClassName?: string
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(10,26,58,0.62)] p-4" role="dialog" aria-modal="true">
      <div className={`flex max-h-[calc(100dvh-2rem)] w-full ${widthClassName} flex-col overflow-hidden rounded-[24px] border border-border bg-surface shadow-[0_32px_80px_-20px_rgb(10_26_58/0.5)]`}>
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-soft px-6 py-5">
          <div className="flex min-w-0 items-center gap-3.5">
            {icon && (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary [&_svg]:h-5 [&_svg]:w-5 [&_svg]:stroke-[1.8]">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="font-display text-[22px] font-bold leading-tight tracking-[-0.01em] text-ink">{title}</h2>
              {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted hover:bg-surface-muted hover:text-ink"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        {/* Body scrolls on short screens (laptops, tablets in landscape); header and footer stay put. */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-soft bg-surface-muted px-6 py-4">
            <div className="min-w-0 text-[13px] text-muted">{footerHint}</div>
            <div className="flex flex-wrap items-center justify-end gap-2">{footer}</div>
          </div>
        )}
      </div>
    </div>
  )
}
