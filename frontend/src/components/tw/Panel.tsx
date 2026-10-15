import type { ReactNode } from 'react'

export function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-[18px] border border-border bg-surface p-6 ${className}`}>
      {children}
    </div>
  )
}
