import type { ReactNode } from 'react'

export function Alert({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text ${className}`}>
      {children}
    </div>
  )
}
