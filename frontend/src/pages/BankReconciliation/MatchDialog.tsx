import { useEffect, useState } from 'react'
import { Link2, Landmark, BookOpenCheck } from 'lucide-react'
import { Alert, Button, Chip, Modal, Spinner } from '../../components/tw'
import { apiErrorMessage, bankReconciliationApi, type MatchCandidates, type MatchTarget } from './bankreconciliationapi'

const fmt = (v: string | number) =>
  Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const pct = (v: string) => `${Number(v)}%`

/** Matches one bank transaction to one journal line, started from either side. Lists only the
 * other side's open items whose amount is within the reconciliation amount tolerance - anything
 * further apart can't be matched. Several journal lines for one bank transaction: Bank Reconciliation. */
export default function MatchDialog({ target, onClose, onMatched }: {
  target: MatchTarget | null
  onClose: () => void
  onMatched: (message: string) => void
}) {
  const [data, setData] = useState<MatchCandidates | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [chosen, setChosen] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setData(null)
    setChosen(null)
    setError('')
    if (!target) return
    let cancelled = false
    setLoading(true)
    bankReconciliationApi.candidates(target)
      .then((res) => {
        if (cancelled) return
        setData(res)
        // The closest candidate is preselected when it is an exact amount.
        const best = res.candidates[0]
        if (best && Number(best.difference) === 0) setChosen(best.transaction ?? best.journal_line ?? null)
      })
      .catch((err) => { if (!cancelled) setError(apiErrorMessage(err, 'Could not load what this can be matched to.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [target])

  const fromBank = target?.kind === 'transaction'
  const source = data?.source
  const tolerance = data ? Number(data.tolerance_percent) : 0

  const match = async () => {
    if (!target || chosen === null) return
    setSaving(true)
    setError('')
    try {
      await (fromBank ? bankReconciliationApi.matchPair(target.id, chosen) : bankReconciliationApi.matchPair(chosen, target.id))
      onMatched(fromBank ? 'Bank transaction matched to the journal entry.' : 'Journal line matched to the bank transaction.')
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not match them.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      icon={<Link2 className="h-4 w-4 text-primary" />}
      title={fromBank ? 'Match to a journal entry' : 'Match to a bank transaction'}
      widthClassName="max-w-3xl"
      footer={(
        <>
          <Button variant="outlined" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="contained" icon={<Link2 className="h-4 w-4" />} onClick={match} disabled={chosen === null || saving}>
            {saving ? 'Matching...' : 'Match'}
          </Button>
        </>
      )}
    >
      <div className="mt-3 space-y-3 text-sm">
        {source && (
          <div className="rounded-xl border border-border p-3 ">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
              {fromBank ? <Landmark className="h-3.5 w-3.5 text-info" /> : <BookOpenCheck className="h-3.5 w-3.5 text-violet-500" />}
              {fromBank ? `Bank transaction · ${source.account_name}` : `Journal line · ${source.entry_number}`}
            </p>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-ink">
                <span className="text-slate-500">{source.date}</span> · {source.description || '—'}
              </span>
              <span className="font-bold tabular-nums text-ink">
                {fromBank ? (source.side === 'W' ? 'Withdrawal ' : 'Deposit ') : (source.side === 'W' ? 'Cr ' : 'Dr ')}{fmt(source.amount)}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {tolerance
                ? <>Amount tolerance <b>{pct(data!.tolerance_percent)}</b>{fromBank && source.allowed_difference ? <> - up to <b>{fmt(source.allowed_difference)}</b> apart</> : ' of the bank amount'}. Only items within it are listed and can be matched.</>
                : <>Amount tolerance is <b>0%</b> - only equal amounts can be matched. Change it in Bank Reconciliation → Settings.</>}
            </p>
          </div>
        )}

        {loading && <div className="flex items-center gap-2 text-slate-500"><Spinner size={16} /> Finding matches...</div>}
        {error && <Alert>{error}</Alert>}

        {data && (data.candidates.length === 0 ? (
          <p className="rounded-xl border border-dashed border-input p-6 text-center text-slate-500 dark:text-muted">
            No open {fromBank ? 'journal line on this bank account' : 'bank transaction'} on the {fromBank ? (source?.side === 'W' ? 'credit' : 'debit') : (source?.side === 'W' ? 'withdrawal' : 'deposit')} side
            {tolerance ? ` within ${pct(data.tolerance_percent)} of this amount` : ' with exactly this amount'}.
          </p>
        ) : (
          <div className="max-h-80 overflow-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-surface-muted">
                <tr className="text-left font-bold text-muted">
                  <th className="w-8 px-2 py-2" />
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">{fromBank ? 'Journal entry' : 'Bank transaction'}</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="px-2 py-2 text-right">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {data.candidates.map((c) => {
                  const id = (c.transaction ?? c.journal_line)!
                  const diff = Number(c.difference)
                  const selected = chosen === id
                  return (
                    <tr key={id} onClick={() => setChosen(id)}
                      className={`cursor-pointer align-top transition-colors ${selected ? 'bg-primary-soft' : 'hover:bg-surface-muted'}`}>
                      <td className="px-2 py-2"><input type="radio" readOnly checked={selected} className="accent-primary" /></td>
                      <td className="whitespace-nowrap px-2 py-2 text-muted">
                        {c.date}
                        <span className="block text-[0.7rem] text-muted">{c.days_apart === 0 ? 'same day' : `${c.days_apart} day${c.days_apart === 1 ? '' : 's'} apart`}</span>
                      </td>
                      <td className="px-2 py-2 text-ink">
                        {fromBank ? <span className="font-mono font-bold">{c.entry_number}</span> : <span className="text-slate-500">{c.account_name}</span>}
                        <span className="block">{c.description || '—'}</span>
                        {c.is_potential_duplicate && <Chip tone="warning" variant="outline" className="mt-0.5">Possible duplicate</Chip>}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">{fmt(c.amount)}</td>
                      <td className={`px-2 py-2 text-right tabular-nums ${diff === 0 ? 'text-success-text' : 'text-warning-text'}`}>
                        {diff === 0 ? 'Exact' : `${diff > 0 ? '+' : ''}${fmt(diff)}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {data.total > data.candidates.length && (
              <p className="p-2 text-center text-xs text-muted">Showing the {data.candidates.length} closest of {data.total}.</p>
            )}
          </div>
        ))}
        {data && chosen !== null && Number(data.candidates.find((c) => (c.transaction ?? c.journal_line) === chosen)?.difference) !== 0 && (
          <p className="text-xs text-warning-text">
            The amounts differ - the difference stays in the reconciliation (book it, e.g. as bank charges, to clear it).
          </p>
        )}
      </div>
    </Modal>
  )
}
