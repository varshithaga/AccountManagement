/** General Ledger page: small display components. */
import { useEffect, useRef, type ReactNode } from 'react'

export function StatTile({ label, value, valueClass, icon, iconBg, iconColor }: {
  label: string; value: string; valueClass?: string; icon: ReactNode; iconBg: string; iconColor: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[18px] border border-border bg-surface p-5">
      <div>
        <p className="text-[13px] font-semibold text-muted">{label}</p>
        <p className={`num mt-2 text-[22px] font-semibold leading-tight ${valueClass || 'text-ink'}`}>{value}</p>
      </div>
      <div className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] [&_svg]:h-[18px] [&_svg]:w-[18px] ${iconBg} ${iconColor}`}>
        {icon}
      </div>
    </div>
  )
}

export function IndeterminateCheckbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate?: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate)
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="h-4 w-4 rounded border-input accent-primary"
    />
  )
}
