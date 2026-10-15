import { ACCOUNT_TYPE_LABEL, ACCOUNT_TYPE_STYLE } from '../constants/accountTypes'
import type { AccountType } from '../types'

/** Account-type pill in the type's colour (Asset teal, Liability amber, Equity violet, Income green, Expense red). */
export default function TypeBadge({ type, label, className = '' }: { type: AccountType; label?: string; className?: string }) {
  const style = ACCOUNT_TYPE_STYLE[type]
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-[20px] px-2.5 py-0.5 text-xs font-bold ${style?.badge ?? 'bg-surface-muted text-muted'} ${className}`}>
      {label ?? ACCOUNT_TYPE_LABEL[type] ?? type}
    </span>
  )
}
