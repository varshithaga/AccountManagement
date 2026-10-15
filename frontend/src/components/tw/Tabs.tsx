export function Tabs<T extends string>({
  value, onChange, options, className = '',
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
  className?: string
}) {
  return (
    <div className={`inline-flex items-center gap-1 rounded-xl border border-border bg-surface-muted p-1 ${className}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-[9px] px-4 py-1.5 text-sm font-semibold transition-colors ${
            value === opt.value
              ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(10_26_58/0.08)] ring-1 ring-border'
              : 'text-muted hover:text-ink'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
