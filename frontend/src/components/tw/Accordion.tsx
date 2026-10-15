import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export function Accordion({
  header, defaultExpanded = false, children, className = '', headerClassName = '',
}: {
  header: ReactNode
  defaultExpanded?: boolean
  children: ReactNode
  className?: string
  headerClassName?: string
}) {
  const [open, setOpen] = useState(defaultExpanded)
  return (
    <div className={`mb-3 overflow-hidden rounded-[18px] border border-border bg-surface last:mb-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-muted ${headerClassName}`}
      >
        <div className="flex-1">{header}</div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-border-soft px-5 pb-4 pt-3">{children}</div>}
    </div>
  )
}
