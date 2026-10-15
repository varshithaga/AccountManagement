import type { ReactNode } from 'react'
import type { Tone } from './types'

/** Pills: a soft status background with strong text ("solid"), or just a coloured outline. */
const SOLID: Record<Tone, string> = {
  primary: 'bg-primary-soft text-primary-hover dark:text-primary',
  secondary: 'bg-info-soft text-info-text',
  success: 'bg-success-soft text-success-text',
  error: 'bg-danger-soft text-danger-text',
  warning: 'bg-warning-soft text-warning-text',
  info: 'bg-info-soft text-info-text',
  neutral: 'bg-surface-muted text-muted',
}

const OUTLINE: Record<Tone, string> = {
  primary: 'border border-primary-border text-primary-hover dark:text-primary',
  secondary: 'border border-border text-info-text',
  success: 'border border-success/40 text-success-text',
  error: 'border border-danger-border text-danger-text',
  warning: 'border border-warning/40 text-warning-text',
  info: 'border border-info/40 text-info-text',
  neutral: 'border border-border text-muted',
}

export function Chip({
  tone = 'primary', variant = 'solid', className = '', title, children,
}: {
  tone?: Tone
  variant?: 'solid' | 'outline'
  className?: string
  /** Native tooltip on hover. */
  title?: string
  children: ReactNode
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-[20px] px-2.5 py-0.5 text-xs font-bold ${variant === 'solid' ? SOLID[tone] : OUTLINE[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
