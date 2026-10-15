export function Switch({
  checked, onChange, label, disabled, className = '',
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <label className={`inline-flex cursor-pointer items-center gap-2 ${disabled ? 'cursor-not-allowed opacity-50' : ''} ${className}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${checked ? 'bg-success' : 'bg-input'}`}
      >
        <span className={`absolute left-0 top-[3px] h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
      </button>
      {label && <span className="text-sm font-semibold text-ink">{label}</span>}
    </label>
  )
}
