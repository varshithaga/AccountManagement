import { useNavigate } from 'react-router-dom'
import { GitMerge, Link2 } from 'lucide-react'
import { Chip } from './tw'
import type { Transaction } from '../types'

const fmt = (v: string) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Reconciliation status of a bank transaction plus the journal entries it is matched to -
 * each one links to Journal Entries, opened on that entry. With onMatch, an unreconciled
 * transaction also gets a Match button. */
export default function ReconciledWith({ txn, onMatch }: { txn: Transaction; onMatch?: () => void }) {
  const navigate = useNavigate()
  const refs = txn.reconciled_with ?? []
  if (!txn.is_reconciled) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Chip tone="neutral" variant="outline" title="Not yet matched to a journal entry - see Bank Reconciliation">
          Not reconciled
        </Chip>
        {onMatch && (
          <button
            type="button"
            onClick={onMatch}
            title="Match this transaction to a journal entry (amount within the tolerance)"
            className="inline-flex items-center gap-1 rounded-md border border-violet-200 px-1.5 py-0.5 text-[0.7rem] font-bold text-violet-600 hover:bg-violet-50 dark:border-violet-400/30 dark:text-violet-400 dark:hover:bg-primary-soft"
          >
            <Link2 className="h-3 w-3" />Match
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <Chip tone="success" title="Matched to journal entry line(s) in Bank Reconciliation">
        <GitMerge className="mr-1 h-3 w-3" />Reconciled
      </Chip>
      {refs.map((r) => (
        <button
          key={`${r.entry}-${r.amount}`}
          type="button"
          onClick={() => navigate(`/journal-entries?entry=${encodeURIComponent(r.entry_number)}`)}
          title={`${r.narration || r.entry_number} - ${r.method === 'AUTO' ? 'auto-matched' : 'matched manually'}. Open the journal entry.`}
          className="text-left text-[0.7rem] leading-tight text-slate-500 hover:text-violet-600 dark:text-muted dark:hover:text-violet-400"
        >
          <span className="font-mono font-bold text-ink hover:underline ">{r.entry_number}</span>
          {' · '}{r.entry_date}
          {refs.length > 1 && ` · ${fmt(r.amount)}`}
        </button>
      ))}
    </div>
  )
}
