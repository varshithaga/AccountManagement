import type { AccountType } from '../types'
import type { BadgeColor } from '../components/Badge'

export const ACCOUNT_TYPES: { value: AccountType; label: string; pluralLabel: string; color: BadgeColor }[] = [
  { value: 'ASSET', label: 'Asset', pluralLabel: 'Assets', color: 'success' },
  { value: 'LIABILITY', label: 'Liability', pluralLabel: 'Liabilities', color: 'warning' },
  { value: 'EQUITY', label: 'Equity', pluralLabel: 'Equity', color: 'secondary' },
  { value: 'INCOME', label: 'Income', pluralLabel: 'Income', color: 'info' },
  { value: 'EXPENSE', label: 'Expense', pluralLabel: 'Expenses', color: 'error' },
]

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = ACCOUNT_TYPES.reduce(
  (acc, t) => { acc[t.value] = t.label; return acc },
  {} as Record<AccountType, string>,
)

export function categoryLabelWithType(c: { name: string; account_type: AccountType }): string {
  return `${c.name} (${ACCOUNT_TYPE_LABEL[c.account_type] || c.account_type})`
}

/** Navy & Saffron account-type colours: Asset teal, Liability amber, Equity violet,
 * Income green, Expense red - badge (soft bg + strong text), dot / bar fill, and tile. */
export const ACCOUNT_TYPE_STYLE: Record<AccountType, { badge: string; dot: string; tile: string }> = {
  ASSET: { badge: 'bg-info-soft text-info-text', dot: 'bg-info', tile: 'bg-info-soft text-info-text' },
  LIABILITY: { badge: 'bg-caution-soft text-caution-text', dot: 'bg-caution', tile: 'bg-caution-soft text-caution-text' },
  EQUITY: { badge: 'bg-equity-soft text-equity-text', dot: 'bg-equity', tile: 'bg-equity-soft text-equity-text' },
  INCOME: { badge: 'bg-success-soft text-success-text', dot: 'bg-success', tile: 'bg-success-soft text-success-text' },
  EXPENSE: { badge: 'bg-danger-soft text-danger-text', dot: 'bg-danger', tile: 'bg-danger-soft text-danger-text' },
}
