import type { MouseEvent, ReactNode } from 'react'

export function IconButton({
  onClick, disabled, title, children, className = '',
}: {
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  title?: string
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}
