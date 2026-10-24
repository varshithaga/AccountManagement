import type { ReactNode } from 'react'

type BadgeVariant = 'light' | 'solid'
type BadgeSize = 'sm' | 'md'
export type BadgeColor = 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info' | 'default'

interface BadgeProps {
  variant?: BadgeVariant
  size?: BadgeSize
  color?: BadgeColor
  children: ReactNode
  className?: string
  onClick?: () => void
}

const LIGHT_CLASSES: Record<BadgeColor, string> = {
  primary: 'bg-primary-soft text-primary-hover dark:text-primary',
  secondary: 'bg-surface-muted text-muted',
  success: 'bg-success-soft text-success-text',
  error: 'bg-danger-soft text-danger-text',
  warning: 'bg-warning-soft text-warning-text',
  info: 'bg-info-soft text-info-text',
  default: 'bg-surface-muted text-muted',
}

const SOLID_CLASSES: Record<BadgeColor, string> = {
  primary: 'bg-primary text-on-primary',
  secondary: 'bg-ink text-surface',
  success: 'bg-emerald-700 text-white',
  error: 'bg-rose-700 text-white',
  warning: 'bg-orange-700 text-white',
  info: 'bg-info text-white',
  default: 'bg-ink text-surface',
}

export default function Badge({
  variant = 'light',
  size = 'md',
  color = 'default',
  children,
  className = '',
  onClick,
}: BadgeProps) {
  const colorClass = variant === 'solid' ? SOLID_CLASSES[color] : LIGHT_CLASSES[color]
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'

  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-[20px] font-bold leading-none ${sizeClass} ${colorClass} ${className}`}
    >
      {children}
    </span>
  )
}

