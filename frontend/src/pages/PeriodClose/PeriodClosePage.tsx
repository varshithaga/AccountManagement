import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { AlertTriangle, CalendarRange, CheckCircle2, Lock, LockOpen, XCircle } from 'lucide-react'
import { periodCloseApi, apiError, type CloseReadiness, type PeriodCloseState } from './periodcloseapi'
import { Alert, Button, Chip, Modal, Panel, Select, Spinner, TextField } from '../../components/tw'
import DatePicker2 from '../../components/DatePicker2'
import { useAuth } from '../../context/AuthContext'

const MONTHS = Array.from({ length: 12 }, (_, i) => dayjs().month(i).format('MMMM'))
const fmt = (d: string | null | undefined) => (d ? dayjs(d).format('DD MMM YYYY') : '—')

function CheckRow({ ok, warn, title, detail, action }: {
  ok: boolean; warn?: boolean; title: string; detail: string; action?: React.ReactNode
}) {
  const icon = ok
    ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
    : warn
      ? <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
      : <XCircle className="h-5 w-5 shrink-0 text-rose-500" />
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        {icon}
        <div>
          <p className="text-sm font-bold text-ink">{title}</p>
          <p className="text-xs text-muted">{detail}</p>
        </div>
      </div>
      {action}
    </div>
  )
}

/** Close the books through a date (freezing everything dated in it), reopen the latest close,
 * and set the month the financial year starts in. */
export default function PeriodClosePage() {
  const navigate = useNavigate()
  const { can, hasPage } = useAuth()
  const canEdit = can('period_close', 'edit')

  const [state, setState] = useState<PeriodCloseState | null>(null)
  const [asOf, setAsOf] = useState(dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD'))
  const [readiness, setReadiness] = useState<CloseReadiness | null>(null)
  const [checking, setChecking] = useState(false)
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState<'close' | 'reopen' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const loadState = useCallback(async () => {
    try {
      setState(await periodCloseApi.state())
    } catch (err) {
      setError(apiError(err, 'Failed to load the period close status.'))
    }
  }, [])

  const loadReadiness = useCallback(async () => {
    if (!asOf) return
    setChecking(true)
    try {
      setReadiness(await periodCloseApi.readiness(asOf))
    } catch (err) {
      setError(apiError(err, 'Failed to check the period.'))
    } finally {
      setChecking(false)
    }
  }, [asOf])

  useEffect(() => { loadState() }, [loadState])
  useEffect(() => { loadReadiness() }, [loadReadiness])

  const run = async (action: () => Promise<PeriodCloseState>, done: string) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      setState(await action())
      setMessage(done)
      setNote('')
      await loadReadiness()
    } catch (err) {
      setError(apiError(err, 'The request failed.'))
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const closedThrough = state?.closed_through ?? null
  const latest = state?.history[0]
  const periodStart = closedThrough ? dayjs(closedThrough).add(1, 'day').format('YYYY-MM-DD') : ''
  const ledgerLink = readiness
    ? `/transactions?period=custom&date_to=${readiness.as_of}${periodStart ? `&date_from=${periodStart}` : ''}`
    : '/transactions'

  return (
    <div className="flex flex-col gap-6">
      <div className="mb-6">
        <h1 className="text-ink">Period Close</h1>
        <p className="mt-1.5 max-w-3xl text-[15px] text-muted">
          Closing the books through a date freezes everything dated on or before it - bank transactions, statements and
          journal entries - so the reports for that period can't change afterwards.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}
      {message && (
        <div className="mb-4 rounded-xl border border-success/40 bg-success-soft px-4 py-3 text-sm font-semibold text-success-text dark:bg-success-soft ">
          {message}
        </div>
      )}

      {!state ? (
        <div className="flex items-center justify-center p-16"><Spinner size={32} /></div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* STATUS */}
            <Panel className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className={`rounded-2xl p-3 ${closedThrough ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' : 'bg-surface-muted text-slate-500 '}`}>
                  {closedThrough ? <Lock className="h-7 w-7" /> : <LockOpen className="h-7 w-7" />}
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Books closed through</p>
                  <p className="font-display text-2xl font-semibold text-ink">{closedThrough ? fmt(closedThrough) : 'Not closed yet'}</p>
                  {latest && (
                    <p className="text-xs text-muted">
                      by {latest.closed_by || 'unknown'} on {dayjs(latest.closed_at).format('DD MMM YYYY, HH:mm')}
                    </p>
                  )}
                </div>
              </div>
              {canEdit && closedThrough && (
                <Button variant="outlined" color="warning" icon={<LockOpen className="h-4 w-4" />} onClick={() => setConfirm('reopen')} disabled={busy}>
                  Reopen {fmt(closedThrough)}
                </Button>
              )}
            </Panel>

            {/* CLOSE */}
            <Panel>
              <h2 className="text-base font-bold text-ink">Close the books</h2>
              <p className="mb-4 text-xs text-muted">
                Every bank transaction up to the date must be final (categorized and locked in the General Ledger).
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <DatePicker2
                  id="close-as-of" label="Close through" value={asOf} onChange={(d: string) => setAsOf(d)}
                  minDate={periodStart || undefined} maxDate={dayjs().format('YYYY-MM-DD')} fullWidth={false} className="min-w-[180px]"
                />
                {[
                  { label: 'End of last month', value: dayjs().startOf('month').subtract(1, 'day') },
                  { label: 'End of last quarter', value: dayjs().startOf('month').month(dayjs().month() - (dayjs().month() % 3)).subtract(1, 'day') },
                  { label: 'End of last financial year', value: dayjs(state.current_fiscal_year.start).subtract(1, 'day') },
                ].map((preset) => (
                  <Button key={preset.label} variant="text" size="sm" onClick={() => setAsOf(preset.value.format('YYYY-MM-DD'))}>
                    {preset.label}
                  </Button>
                ))}
              </div>

              <div className="mt-4 divide-y divide-border-soft rounded-xl border border-border px-4 ">
                {checking || !readiness ? (
                  <div className="flex justify-center py-6"><Spinner size={24} /></div>
                ) : (
                  <>
                    <CheckRow
                      ok={readiness.not_final === 0}
                      title={readiness.not_final === 0
                        ? `All ${readiness.transactions_in_period} bank transactions are final`
                        : `${readiness.not_final} bank transaction${readiness.not_final === 1 ? ' is' : 's are'} not final`}
                      detail={readiness.not_final === 0
                        ? `Dated ${periodStart ? `${fmt(periodStart)} – ` : 'up to '}${fmt(readiness.as_of)}.`
                        : `${readiness.not_final_ready} ready to finalize, ${readiness.not_final_not_ready} still need a category or review.`}
                      action={readiness.not_final > 0 && hasPage('transactions') && (
                        <Button variant="outlined" size="sm" onClick={() => navigate(ledgerLink)}>Open General Ledger</Button>
                      )}
                    />
                    <CheckRow
                      ok={readiness.unreconciled_accounts.length === 0}
                      warn
                      title={readiness.unreconciled_accounts.length === 0
                        ? 'Every bank account is reconciled through this date'
                        : `${readiness.unreconciled_accounts.length} bank account${readiness.unreconciled_accounts.length === 1 ? ' is' : 's are'} not reconciled through this date`}
                      detail={readiness.unreconciled_accounts.length === 0
                        ? 'Recommended before closing, but not required.'
                        : readiness.unreconciled_accounts.map((a) => `${a.name} (${a.reconciled_through ? `through ${fmt(a.reconciled_through)}` : 'never'})`).join(', ') + ' - recommended, not required.'}
                      action={readiness.unreconciled_accounts.length > 0 && hasPage('bank_reconciliation') && (
                        <Button variant="outlined" size="sm" onClick={() => navigate('/bank-reconciliation')}>Bank Reconciliation</Button>
                      )}
                    />
                    <CheckRow
                      ok={readiness.potential_duplicates === 0}
                      warn
                      title={readiness.potential_duplicates === 0 ? 'No unresolved possible duplicates' : `${readiness.potential_duplicates} possible duplicate${readiness.potential_duplicates === 1 ? '' : 's'} not final yet`}
                      detail="Review them before the period is frozen."
                    />
                    <CheckRow
                      ok
                      title={`${readiness.journal_entries_in_period} journal entr${readiness.journal_entries_in_period === 1 ? 'y' : 'ies'} in the period`}
                      detail="They can no longer be imported or deleted once closed."
                    />
                  </>
                )}
              </div>

              {canEdit && (
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <TextField
                    id="close-note" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Q2 signed off by the auditor" className="flex-1"
                  />
                  <Button
                    variant="contained" icon={<Lock className="h-4 w-4" />}
                    disabled={!readiness?.can_close || busy || checking}
                    onClick={() => setConfirm('close')}
                  >
                    Close through {fmt(asOf)}
                  </Button>
                </div>
              )}
            </Panel>
          </div>

          <div className="space-y-6">
            {/* FINANCIAL YEAR */}
            <Panel>
              <div className="mb-3 flex items-center gap-2">
                <CalendarRange className="h-5 w-5 text-violet-500" />
                <h2 className="text-base font-bold text-ink">Financial year</h2>
              </div>
              <Select
                id="fy-start" label="Starts in" value={state.fiscal_year_start_month}
                onChange={(e) => run(() => periodCloseApi.setFiscalYearStart(Number(e.target.value)), 'Financial year updated.')}
              >
                {MONTHS.map((m, i) => <option key={m} value={i + 1} disabled={!canEdit}>{m}</option>)}
              </Select>
              <p className="mt-3 text-xs text-muted">
                Current financial year: <span className="font-bold">{fmt(state.current_fiscal_year.start)} – {fmt(state.current_fiscal_year.end)}</span>.
                The reports' "This / Last Financial Year" periods follow this.
              </p>
            </Panel>

            {/* HISTORY */}
            <Panel className="p-0">
              <h2 className="border-b border-border px-6 py-4 text-base font-bold text-ink ">Close history</h2>
              {state.history.length === 0 ? (
                <p className="px-6 py-6 text-sm italic text-muted">The books have never been closed.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {state.history.map((c, i) => (
                    <li key={c.id} className="px-6 py-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-ink">Through {fmt(c.closed_through)}</span>
                        {i === 0 && <Chip tone="primary">In force</Chip>}
                      </div>
                      <p className="text-xs text-muted">
                        {c.closed_by || 'unknown'} · {dayjs(c.closed_at).format('DD MMM YYYY, HH:mm')}
                      </p>
                      {c.note && <p className="mt-1 text-xs italic text-muted">{c.note}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'close' ? `Close the books through ${fmt(asOf)}?` : `Reopen the period through ${fmt(closedThrough)}?`}
        icon={confirm === 'close' ? <Lock className="h-5 w-5 text-violet-500" /> : <LockOpen className="h-5 w-5 text-amber-500" />}
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="text" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
            <Button
              variant="contained" color={confirm === 'close' ? 'primary' : 'warning'} disabled={busy}
              onClick={() => (confirm === 'close'
                ? run(() => periodCloseApi.close(asOf, note), `The books are closed through ${fmt(asOf)}.`)
                : run(() => periodCloseApi.reopen(), 'The latest close was reopened.'))}
            >
              {confirm === 'close' ? 'Close the books' : 'Reopen'}
            </Button>
          </div>
        )}
      >
        <p className="mt-3 text-sm text-muted">
          {confirm === 'close'
            ? 'Bank transactions, statements and journal entries dated on or before this date can no longer be added, changed or deleted until the period is reopened.'
            : `Everything dated after ${state?.history[1] ? fmt(state.history[1].closed_through) : 'the start of your records'} becomes editable again. Reports for the reopened period may change.`}
        </p>
      </Modal>
    </div>
  )
}
