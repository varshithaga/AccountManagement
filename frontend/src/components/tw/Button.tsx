import type { ReactNode } from 'react'
import type { Tone } from './types'

/** Navy & Saffron buttons. Blue is for actions; green and red only where the action itself is
 * good / destructive. "outlined" is the white bordered secondary button (red-tinted for error,
 * orange for warning); "text" is the quiet link-style button. */
const SECONDARY = 'border border-border bg-surface text-ink hover:bg-surface-muted'
const LINK = 'text-primary hover:bg-primary-soft'

export const BTN: Record<Tone, { solid: string; outline: string; text: string }> = {
  primary: {
    solid: 'bg-primary text-white hover:bg-primary-hover',
    outline: SECONDARY,
    text: LINK,
  },
  secondary: {
    solid: 'bg-primary-soft text-primary-hover hover:bg-primary-border/60 dark:text-primary',
    outline: SECONDARY,
    text: LINK,
  },
  success: {
    solid: 'bg-success text-white hover:brightness-95',
    outline: 'border border-border bg-surface text-success-text hover:bg-success-soft',
    text: 'text-success-text hover:bg-success-soft',
  },
  error: {
    solid: 'bg-danger text-white hover:brightness-95',
    outline: 'border border-danger-border bg-surface text-danger-text hover:bg-danger-soft',
    text: 'text-danger-text hover:bg-danger-soft',
  },
  warning: {
    solid: 'bg-warning text-white hover:brightness-95',
    outline: 'border border-border bg-surface text-warning-text hover:bg-warning-soft',
    text: 'text-warning-text hover:bg-warning-soft',
  },
  info: {
    solid: 'bg-info text-white hover:brightness-95',
    outline: SECONDARY,
    text: 'text-info-text hover:bg-info-soft',
  },
  neutral: {
    solid: 'bg-ink text-surface hover:opacity-90',
    outline: SECONDARY,
    text: 'text-muted hover:bg-surface-muted hover:text-ink',
  },
}

export function Button({
  variant = 'text',
  color = 'primary',
  size = 'md',
  icon,
  endIcon,
  onClick,
  disabled,
  children,
  className = '',
  href,
  target,
  rel,
}: {
  variant?: 'contained' | 'outlined' | 'text'
  color?: Tone
  size?: 'sm' | 'md'
  icon?: ReactNode
  endIcon?: ReactNode
  onClick?: () => void
  disabled?: boolean
  children: ReactNode
  className?: string
  href?: string
  target?: string
  rel?: string
}) {
  const styleKey = variant === 'contained' ? 'solid' : variant === 'outlined' ? 'outline' : 'text'
  const sizeClasses = size === 'sm' ? 'h-10 px-3 text-[13px]' : 'h-[46px] px-4 text-sm'
  const classes = `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizeClasses} ${BTN[color][styleKey]} ${className}`

  if (href) {
    return (
      <a href={href} target={target} rel={rel} className={classes}>
        {icon}
        {children}
        {endIcon}
      </a>
    )
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={classes}>
      {icon}
      {children}
      {endIcon}
    </button>
  )
}
