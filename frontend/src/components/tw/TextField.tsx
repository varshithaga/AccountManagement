import type { ChangeEvent, ReactNode } from 'react'

export function TextField({
  id, label, value, onChange, placeholder, type = 'text', autoFocus, required, disabled,
  className = '', inputClassName = '', startIcon, endIcon, multiline, rows = 3,
}: {
  id?: string
  label?: string
  value: string
  onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  placeholder?: string
  type?: string
  autoFocus?: boolean
  required?: boolean
  disabled?: boolean
  className?: string
  inputClassName?: string
  startIcon?: ReactNode
  endIcon?: ReactNode
  multiline?: boolean
  rows?: number
}) {
  const baseClasses = `w-full rounded-xl border border-input bg-surface text-sm font-medium text-ink outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-[3px] focus:ring-primary-soft disabled:cursor-not-allowed disabled:opacity-50 ${startIcon ? 'pl-10' : 'px-3'} ${endIcon ? 'pr-10' : 'pr-3'}`

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label htmlFor={id} className="text-[13px] font-semibold text-ink">
          {label}
          {required && <span className="text-danger-text"> *</span>}
        </label>
      )}
      <div className="relative flex items-center">
        {startIcon && <span className="pointer-events-none absolute left-3 flex text-slate-400">{startIcon}</span>}
        {multiline ? (
          <textarea
            id={id}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            autoFocus={autoFocus}
            disabled={disabled}
            rows={rows}
            className={`${baseClasses} resize-y py-2.5 ${inputClassName}`}
          />
        ) : (
          <input
            id={id}
            type={type}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            autoFocus={autoFocus}
            disabled={disabled}
            className={`h-12 ${baseClasses} ${inputClassName}`}
          />
        )}
        {endIcon && <span className="absolute right-3 flex text-slate-400">{endIcon}</span>}
      </div>
    </div>
  )
}
