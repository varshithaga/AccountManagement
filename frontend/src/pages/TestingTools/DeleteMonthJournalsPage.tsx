/**
 * Testing tool: delete one bank account's journal entries for one month, so a month's journal
 * file can be imported again. Uses the journal_entries page access and its delete right.
 */
import { useCallback, useEffect, useState } from 'react'
import { FlaskConical, Trash2 } from 'lucide-react'
import BankAccountSelect from '../../components/BankAccountSelect'
import { PageHeader, EmptyState } from '../../components/PageParts'
import { Alert, Button, Chip, Spinner, Switch } from '../../components/tw'
import { useAuth } from '../../context/AuthContext'
import { formatMoney } from '../../utils/periods'
import { apiErrorText, withUnmatchConfirm } from '../../utils/reconcileConfirm'
import { testingToolsApi } from './testingtoolsapi'
import type { MonthScope, MonthScopeQuery } from './testingtoolsapi'

const TH = 'px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted'

const monthLabel = (m: string) =>
  m === 'all' ? 'All months' : new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

export default function DeleteMonthJournalsPage() {
  const { can } = useAuth()
  const canDelete = can('journal_entries', 'delete')
  const [bankAccount, setBankAccount] = useState<number | null>(null)
  const [month, setMonth] = useState('')
  const [includeLedger, setIncludeLedger] = useState(false)
  const [scope, setScope] = useState<MonthScope | null>(null)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const query: MonthScopeQuery | null = bankAccount ? { bankAccount, month: month || 'all', includeLedger } : null

  const load = useCallback(async () => {
    if (!bankAccount) {
      setScope(null)
      return
    }
    setLoading(true)
    setError('')
    try {
      setScope(await testingToolsApi.monthScope({ bankAccount, month: month || 'all', includeLedger }))
    } catch (err) {
      setError(apiErrorText(err, 'Could not load the journal entries.'))
    } finally {
      setLoading(false)
    }
  }, [bankAccount, month, includeLedger])

  useEffect(() => { load() }, [load])

  const handleDelete = async () => {
    if (!query || !scope?.count) return
    const what = `${scope.count} journal ${scope.count === 1 ? 'entry' : 'entries'} of ${scope.bank_account.name} - ${monthLabel(query.month)}`
    if (!window.confirm(`Delete ${what}?\n\nThis cannot be undone.`)) return
    setDeleting(true)
    setError('')
    setDone('')
    try {
      const results: { deleted: number; batches_removed: number }[] = []
      const finished = await withUnmatchConfirm(async (confirm) => {
        results.push(await testingToolsApi.monthDelete(query, confirm))
      })
      const r = results[results.length - 1]
      if (finished && r) {
        setDone(`Deleted ${r.deleted} ${r.deleted === 1 ? 'entry' : 'entries'}`
          + (r.batches_removed ? ` and ${r.batches_removed} empty import${r.batches_removed === 1 ? '' : 's'}` : '')
          + ` - ${scope.bank_account.name}, ${monthLabel(query.month)}.`)
      }
      await load()
    } catch (err) {
      setError(apiErrorText(err, 'Could not delete the journal entries.'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-1.5"><FlaskConical className="h-3.5 w-3.5" /> Testing only</span>}
        title="Delete Month Journals"
        description="Remove every journal entry of one bank account for one month, so that month's journal file can be imported again."
      />

      {!canDelete && <Alert>Your role does not have the delete right on Journal Entries.</Alert>}

      <div className="rounded-[18px] border border-border bg-surface p-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <BankAccountSelect
            value={bankAccount}
            onChange={(id) => { setBankAccount(id); setMonth(''); setDone('') }}
            label="Bank Account"
            placeholder="Choose a bank account"
            size="medium"
            required
          />
          <div>
            <p className="mb-1.5 text-[13px] font-semibold text-ink">Month</p>
            {!bankAccount ? (
              <p className="text-sm text-muted">Choose a bank account first.</p>
            ) : scope && scope.months.length === 0 && !month ? (
              <p className="text-sm text-muted">This bank account has no journal entries.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(scope?.months ?? []).map((m) => (
                  <button
                    key={m.month}
                    type="button"
                    onClick={() => { setMonth(m.month); setDone('') }}
                    className={`rounded-xl border px-3 py-2 text-[13px] font-semibold transition-colors ${
                      month === m.month
                        ? 'border-primary bg-primary text-white'
                        : 'border-border bg-surface text-ink hover:bg-surface-muted'}`}
                  >
                    {monthLabel(m.month)} <span className={month === m.month ? 'text-white/80' : 'text-muted'}>· {m.count}</span>
                  </button>
                ))}
                {(scope?.months.length ?? 0) > 1 && (
                  <button
                    type="button"
                    onClick={() => { setMonth(''); setDone('') }}
                    className={`rounded-xl border px-3 py-2 text-[13px] font-semibold transition-colors ${
                      !month ? 'border-primary bg-primary text-white' : 'border-border bg-surface text-ink hover:bg-surface-muted'}`}
                  >
                    All months
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <Switch
          className="mt-4"
          checked={includeLedger}
          onChange={setIncludeLedger}
          label="Also include entries from other banks' imports that post to this bank's ledger (transfers booked by the other bank)"
        />
      </div>

      {error && <Alert>{error}</Alert>}
      {done && (
        <div className="rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm font-medium text-success-text">{done}</div>
      )}

      {bankAccount && (
        <div className="rounded-[18px] border border-border bg-surface">
          <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-base font-bold text-ink">
                {scope ? `${scope.bank_account.name} · ${monthLabel(month || 'all')}` : 'Loading…'}
              </p>
              {scope && (
                <p className="mt-0.5 text-sm text-muted">
                  {scope.count} {scope.count === 1 ? 'entry' : 'entries'}
                  {scope.reconciled_lines > 0 && ` · ${scope.reconciled_lines} reconciled bank line${scope.reconciled_lines === 1 ? '' : 's'} (their matches are removed too)`}
                </p>
              )}
            </div>
            <Button
              variant="contained"
              color="error"
              icon={deleting ? <Spinner size={16} /> : <Trash2 className="h-4 w-4" />}
              onClick={handleDelete}
              disabled={!canDelete || deleting || loading || !scope?.count}
            >
              Delete {scope?.count ?? 0} {scope?.count === 1 ? 'entry' : 'entries'}
            </Button>
          </div>

          {loading && !scope ? (
            <div className="flex justify-center p-10"><Spinner /></div>
          ) : !scope?.count ? (
            <EmptyState icon={<FlaskConical />} title="Nothing to delete" text="No journal entries for this bank account in this month." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-slate-50 dark:bg-slate-900/80">
                    <th className={TH}>Entry No</th>
                    <th className={TH}>Date</th>
                    <th className={TH}>Narration</th>
                    <th className={TH}>Imported from</th>
                    <th className={TH}>Reconciled</th>
                    <th className={`${TH} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {scope.entries.map((e) => (
                    <tr key={e.id} className="hover:bg-surface-muted">
                      <td className="px-4 py-3 font-mono font-bold text-ink">{e.entry_number}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">{e.date}</td>
                      <td className="px-4 py-3 text-muted">{e.narration || '—'}</td>
                      <td className="px-4 py-3 text-muted">{e.source_name || '—'}</td>
                      <td className="px-4 py-3">
                        {e.reconciled_lines > 0
                          ? <Chip tone="success">Reconciled</Chip>
                          : <Chip tone="neutral" variant="outline">Open</Chip>}
                      </td>
                      <td className="num whitespace-nowrap px-4 py-3 text-right text-ink">{formatMoney(e.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
