import { AlertTriangle, Check, Layers, CalendarX, Calculator } from 'lucide-react'
import type { ContinuityIssue, StatementContinuityStatus } from '../../types'

export const ISSUE_LABEL: Record<ContinuityIssue, string> = {
  OVERLAP: 'Overlapping period',
  MISSING_PERIOD: 'Missing statement',
  BALANCE_GAP: 'Balance mismatch',
  INTERNAL_MISMATCH: 'Math mismatch',
}

const ISSUE_ICON: Record<ContinuityIssue, React.ReactNode> = {
  OVERLAP: <Layers className="h-3.5 w-3.5" />,
  MISSING_PERIOD: <CalendarX className="h-3.5 w-3.5" />,
  BALANCE_GAP: <AlertTriangle className="h-3.5 w-3.5" />,
  INTERNAL_MISMATCH: <Calculator className="h-3.5 w-3.5" />,
}

/** Link that opens the Import Statement dialog preselected to this account. */
export const uploadLinkFor = (accountId: number) => `/bank-statements?upload=${accountId}`

export default function ContinuityBadge({ status }: { status: StatementContinuityStatus | null | undefined }) {
  if (!status) return <span className="text-xs text-muted">—</span>

  if (status.is_continuous) {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-success-text">
        <Check className="h-3.5 w-3.5" />
        <span>{status.has_previous ? 'Continuous' : 'First statement'}</span>
      </span>
    )
  }

  const issue = status.primary_issue ?? 'BALANCE_GAP'
  const suffix = issue === 'MISSING_PERIOD' ? ` · ${status.date_gap_days}d`
    : issue === 'OVERLAP' ? ` · ${status.overlap_days}d` : ''
  const more = status.issues.length > 1 ? ` +${status.issues.length - 1}` : ''

  return (
    <span
      title={status.gap_message || ISSUE_LABEL[issue]}
      className="inline-flex cursor-help items-center gap-1 whitespace-nowrap rounded-lg bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-danger-text hover:bg-rose-500/25 "
    >
      {ISSUE_ICON[issue]}
      <span>{ISSUE_LABEL[issue]}{suffix}{more}</span>
    </span>
  )
}
