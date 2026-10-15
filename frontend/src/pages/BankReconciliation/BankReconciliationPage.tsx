import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Scale, Wand2, RefreshCw, Link2, Unlink, CheckCircle2, AlertTriangle, Search, X, Settings2, Landmark, BookOpenCheck,
  Lock, LockOpen, CalendarCheck, Circle,
} from 'lucide-react'
import { bankReconciliationApi, apiErrorMessage, type MatchTarget, type ReconStatus } from './bankreconciliationapi'
import MatchDialog from './MatchDialog'
import { categoryLookupApi, type SubCategoryOption } from '../../api/resources'
import BankAccountSelect from '../../components/BankAccountSelect'
import GlAccountSelect from '../../components/GlAccountSelect'
import Pagination from '../../components/Pagination'
import { Button, Panel, Chip, Modal, Alert, Select, Spinner, TextField } from '../../components/tw'
import DatePicker from '../../components/DatePicker'
import { useAuth } from '../../context/AuthContext'
import { PERIOD_OPTIONS, periodRange, presetMonth, type PeriodPreset } from '../../utils/periods'
import type {
  BankAccount, ReconBankTransaction, ReconBookLine, ReconciliationPeriodsOverview, ReconciliationStatement,
} from '../../types'

const DEFAULT_PAGE_SIZE = 50

const num = (v: string | number | null | undefined) => Number(v || 0)
const fmt = (v: string | number | null | undefined) =>
  num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cents = (v: string | number | null | undefined) => Math.round(num(v) * 100)
const pad = (n: number) => String(n).padStart(2, '0')
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const currentMonth = () => today().slice(0, 7)
/** [first day, last day] of a 'YYYY-MM' month. */
const monthBounds = (month: string): [string, string] => {
  const [y, m] = month.split('-').map(Number)
  return [`${month}-01`, `${month}-${pad(new Date(y, m, 0).getDate())}`]
}
const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' })
}
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** The shared presets, plus an uploaded statement's dates, plus a month picked from the month strip. */
type ReconPeriod = PeriodPreset | 'statement' | 'month'

/** Amount on the bank side: withdrawals are debits on the statement, deposits credits. */
const txnAmount = (t: ReconBankTransaction) => (num(t.debit) > 0 ? num(t.debit) : num(t.credit))
const isWithdrawal = (t: ReconBankTransaction) => num(t.debit) > 0
/** A journal line on the bank's GL account: a credit is money out, a debit money in. */
const lineAmount = (l: ReconBookLine) => (num(l.credit) > 0 ? num(l.credit) : num(l.debit))
const isPayment = (l: ReconBookLine) => num(l.credit) > 0

function StatementRow({ label, value, sign, strong, hint }: {
  label: string; value: string | number | null; sign?: '+' | '-'; strong?: boolean; hint?: string
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? 'border-t border-border pt-2.5 font-bold ' : ''}`}>
      <span className={strong ? 'text-ink' : 'text-muted'}>
        {sign && <span className="mr-1.5 inline-block w-3 text-muted">{sign}</span>}
        {label}
        {hint && <span className="ml-1.5 text-xs font-normal text-muted">{hint}</span>}
      </span>
      <span className={`num ${strong ? 'font-semibold text-ink' : 'text-ink'}`}>
        {value === null ? '—' : fmt(value)}
      </span>
    </div>
  )
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={`flex items-start gap-2 ${ok ? 'text-ink' : 'text-muted'}`}>
      {ok
        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />}
      <span>{children}</span>
    </li>
  )
}

function SideHeader({ icon, title, caption, count }: { icon: ReactNode; title: string; caption: string; count?: number }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border-soft px-4 py-3 ">
      <div className="flex items-center gap-2">
        {icon}
        <div>
          <div className="text-sm font-bold text-ink">{title}</div>
          <div className="text-xs text-muted">{caption}</div>
        </div>
      </div>
      {count !== undefined && <Chip tone="neutral" variant="outline">{count}</Chip>}
    </div>
  )
}

function Amounts({ debit, credit }: { debit: string; credit: string }) {
  return (
    <>
      <td className="px-3 py-2 text-right tabular-nums text-danger-text">{num(debit) > 0 ? fmt(debit) : ''}</td>
      <td className="px-3 py-2 text-right tabular-nums text-success-text">{num(credit) > 0 ? fmt(credit) : ''}</td>
    </>
  )
}

function RowMatchButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={title}
      className="inline-flex items-center gap-1 rounded-md border border-violet-200 px-1.5 py-0.5 text-xs font-bold text-violet-600 hover:bg-violet-50 dark:border-violet-400/30 dark:text-violet-400 dark:hover:bg-primary-soft"
    >
      <Link2 className="h-3 w-3" />Match
    </button>
  )
}

const TH = 'px-3 py-2 text-left text-[0.7rem] font-bold uppercase tracking-wider text-muted'

export default function BankReconciliationPage() {
  // Without the edit right the page is read-only: the statement and both sides show, nothing can be matched.
  const canEdit = useAuth().can('bank_reconciliation', 'edit')
  const [searchParams, setSearchParams] = useSearchParams()
  const accountId = Number(searchParams.get('account')) || null

  // ---- period: a preset (This Month by default), an uploaded statement's dates, or a strip month.
  // Whole-month periods (This / Next / Last Month, a strip month) can be signed off. ----
  const [period, setPeriod] = useState<ReconPeriod>('this_month')
  const [month, setMonth] = useState(currentMonth())
  const [statementId, setStatementId] = useState<number | null>(null)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [overview, setOverview] = useState<ReconciliationPeriodsOverview | null>(null)
  const chosenStatement = overview?.statements.find((s) => s.id === statementId) ?? null
  const [dateFrom, dateTo]: [string, string] = period === 'month' ? monthBounds(month)
    : period === 'statement' ? (chosenStatement ? [chosenStatement.date_from, chosenStatement.date_to] : ['', today()])
      : period === 'all_time' ? ['', '']  // every date; the statement is then as of today
        : (([from, to]) => [from, to || today()])(periodRange(period, customFrom, customTo))
  /** The month the period covers exactly, if it is one whole month - the month that can be signed off. */
  const signMonth = period === 'month' ? month : period === 'statement' ? null : presetMonth(period)
  const lockedThrough = overview?.locked_through ?? null

  const [account, setAccount] = useState<BankAccount | null>(null)
  const [statement, setStatement] = useState<ReconciliationStatement | null>(null)
  const [view, setView] = useState<'open' | 'matched'>('open')
  const [search, setSearch] = useState('')

  const [txns, setTxns] = useState<ReconBankTransaction[]>([])
  const [txnCount, setTxnCount] = useState(0)
  const [txnPage, setTxnPage] = useState(0)
  const [lines, setLines] = useState<ReconBookLine[]>([])
  const [lineCount, setLineCount] = useState(0)
  const [linePage, setLinePage] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const changePageSize = (size: number) => {
    setPageSize(size)
    setTxnPage(0)
    setLinePage(0)
  }

  const [selectedTxn, setSelectedTxn] = useState<ReconBankTransaction | null>(null)
  const [selectedLines, setSelectedLines] = useState<Map<number, ReconBookLine>>(new Map())
  /** One bank transaction or journal line being matched by hand to a single item on the other side. */
  const [matching, setMatching] = useState<MatchTarget | null>(null)

  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [glDraft, setGlDraft] = useState<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [windowDays, setWindowDays] = useState('')
  const [tolerancePct, setTolerancePct] = useState('')
  /** Amount tolerance in force (percent of the bank amount) - the Match bar allows totals within it. */
  const [tolerance, setTolerance] = useState(0)
  useEffect(() => {
    bankReconciliationApi.getSettings().then((s) => setTolerance(Number(s.amount_tolerance_percent) || 0)).catch(() => {})
  }, [])

  const linked = Boolean(account?.gl_account)

  const setAccountId = (id: number | null) => {
    setSearchParams(id ? { account: String(id) } : {})
    setTxnPage(0)
    setLinePage(0)
    setNotice('')
    setError('')
  }

  const clearSelection = () => {
    setSelectedTxn(null)
    setSelectedLines(new Map())
  }

  // The account itself (for its GL link) - refetched when it changes.
  useEffect(() => {
    setAccount(null)
    setStatement(null)
    setOverview(null)
    setStatementId(null)
    clearSelection()
    if (!accountId) return
    bankReconciliationApi.getBankAccount(accountId)
      .then((acc) => { setAccount(acc); setGlDraft(acc.gl_account ?? null) })
      .catch(() => setError('Failed to load the bank account.'))
    // Coming from a statement (?statement=) opens on that statement; a statement period of the
    // previous account doesn't carry over (the other periods do).
    const wantedStatement = Number(searchParams.get('statement')) || null
    bankReconciliationApi.periods(accountId)
      .then((ov) => {
        setOverview(ov)
        if (wantedStatement && ov.statements.some((s) => s.id === wantedStatement)) {
          setPeriod('statement')
          setStatementId(wantedStatement)
        } else {
          setPeriod((p) => (p === 'statement' ? 'this_month' : p))
        }
      })
      .catch(() => setError('Failed to load the reconciliation months.'))
    // Only on account change - ?statement= is read once, when arriving from a statement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  const reloadOverview = useCallback(async () => {
    if (accountId) setOverview(await bankReconciliationApi.periods(accountId))
  }, [accountId])

  const load = useCallback(async () => {
    if (!accountId || !account) return
    setLoading(true)
    setError('')
    const status: ReconStatus = view === 'open' ? 'unmatched' : 'matched'
    // Open items: everything still unmatched up to the period end, including older carried-forward
    // ones (they need clearing too). Matched: only what the bank shows inside the period.
    const common = {
      account: accountId, status, date_to: dateTo, date_from: view === 'matched' ? dateFrom : undefined,
      search: search.trim() || undefined, limit: pageSize,
    }
    try {
      const [summary, bank, book] = await Promise.all([
        bankReconciliationApi.summary(accountId, dateTo, dateFrom),
        bankReconciliationApi.bankTransactions({ ...common, page: txnPage + 1 }),
        view === 'open' && account.gl_account
          ? bankReconciliationApi.bookLines({ ...common, page: linePage + 1 })
          : Promise.resolve(null),
      ])
      setStatement(summary)
      setTxns(bank.results)
      setTxnCount(bank.count)
      setLines(book?.results ?? [])
      setLineCount(book?.count ?? 0)
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load reconciliation data.'))
    } finally {
      setLoading(false)
    }
  }, [accountId, account, dateFrom, dateTo, view, search, txnPage, linePage, pageSize])

  useEffect(() => {
    const handle = setTimeout(load, 250)
    return () => clearTimeout(handle)
  }, [load])

  const run = async (action: () => Promise<string>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      setNotice(await action())
      clearSelection()
      await Promise.all([load(), reloadOverview()])
    } catch (err) {
      setError(apiErrorMessage(err, 'Something went wrong - please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const autoMatch = () => run(async () => {
    const { matched } = await bankReconciliationApi.autoMatch(accountId!, undefined, dateTo)
    return matched
      ? `Auto-matched ${matched} bank transaction${matched === 1 ? '' : 's'} to journal lines.`
      : 'No new matches found - review the remaining items manually.'
  })

  const saveGlAccount = () => run(async () => {
    const acc = await bankReconciliationApi.setGlAccount(accountId!, glDraft)
    setAccount(acc)
    return `Linked to GL account "${acc.gl_account_name}".`
  })

  const matchSelected = () => run(async () => {
    const { matched } = await bankReconciliationApi.match(accountId!, selectedTxn!.id, [...selectedLines.keys()])
    return `Matched the bank transaction to ${matched} journal line${matched === 1 ? '' : 's'}.`
  })

  const unmatch = (txn: ReconBankTransaction) => run(async () => {
    await bankReconciliationApi.unmatch(accountId!, [txn.id])
    return 'Match removed - both sides are outstanding again.'
  })

  // ---- opening balance entry (offered when the difference is exactly the first statement's opening balance) ----
  const [equityOptions, setEquityOptions] = useState<SubCategoryOption[]>([])
  const [equityId, setEquityId] = useState<number | null>(null)
  const offerOpeningEntry = Boolean(statement?.difference_is_opening_balance && !statement.opening_entry_number)
  const openingCandidate = statement?.opening_candidate ?? null
  useEffect(() => {
    if (!offerOpeningEntry || openingCandidate || equityOptions.length) return
    categoryLookupApi.subCategories({ account_type: 'EQUITY', limit: 50 })
      .then((res) => {
        setEquityOptions(res.results)
        const preferred = res.results.find((s) => s.name.toLowerCase() === 'owner capital') ?? res.results[0]
        setEquityId(preferred?.id ?? null)
      })
      .catch(() => setEquityOptions([]))
  }, [offerOpeningEntry, openingCandidate, equityOptions.length])

  const markOpeningCandidate = () => run(async () => {
    const { entry_number } = await bankReconciliationApi.markOpeningLine(accountId!, openingCandidate!.journal_line)
    return `Journal entry ${entry_number} is marked as the opening balance and cleared.`
  })

  const createOpeningEntry = () => run(async () => {
    await bankReconciliationApi.createOpeningBalance(accountId!, equityId!)
    return `Opening balance of ${fmt(statement?.opening_balance)} booked on ${statement?.opening_entry_date} and marked as cleared.`
  })

  const [signOffNote, setSignOffNote] = useState('')
  const closeMonth = () => signMonth && run(async () => {
    await bankReconciliationApi.closeMonth(accountId!, signMonth, signOffNote.trim())
    setSignOffNote('')
    return `${monthLabel(signMonth)} is signed off as reconciled. Its matches are locked until it is reopened.`
  })

  const reopenMonth = () => {
    if (!signMonth) return
    if (!window.confirm(`Reopen ${monthLabel(signMonth)}? Its sign-off is removed and its matches can be changed again.`)) return
    run(async () => {
      await bankReconciliationApi.reopenMonth(accountId!, signMonth)
      return `${monthLabel(signMonth)} is reopened.`
    })
  }

  /** A match is part of a signed-off month when the bank transaction and its journal line are both inside it. */
  const isLocked = (t: ReconBankTransaction) =>
    Boolean(lockedThrough && t.date <= lockedThrough && t.matches.some((m) => m.entry_date <= lockedThrough))

  const choosePeriod = (apply: () => void) => {
    apply()
    setTxnPage(0)
    setLinePage(0)
    clearSelection()
  }

  const pickMonth = (m: string) => choosePeriod(() => { setPeriod('month'); setMonth(m) })

  const changePeriod = (value: ReconPeriod) => choosePeriod(() => {
    // Custom starts from the range currently shown; Statement starts on the newest statement.
    if (value === 'custom' && period !== 'custom') {
      setCustomFrom(dateFrom)
      setCustomTo(dateTo)
    }
    if (value === 'statement' && !statementId && overview?.statements[0]) setStatementId(overview.statements[0].id)
    setPeriod(value)
  })

  const openSettings = async () => {
    setSettingsOpen(true)
    try {
      const s = await bankReconciliationApi.getSettings()
      setWindowDays(String(s.date_window_days))
      setTolerancePct(String(Number(s.amount_tolerance_percent)))
    } catch {
      setWindowDays('')
      setTolerancePct('')
    }
  }

  const saveSettings = async () => {
    const days = Number(windowDays)
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      setError('Date window must be a whole number of days between 0 and 365.')
      return
    }
    const pct = Number(tolerancePct || 0)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100 || Math.round(pct * 100) !== pct * 100) {
      setError('Amount tolerance must be a percent between 0 and 100, with at most 2 decimals.')
      return
    }
    await run(async () => {
      const saved = await bankReconciliationApi.updateSettings({ date_window_days: days, amount_tolerance_percent: pct.toFixed(2) })
      setTolerance(Number(saved.amount_tolerance_percent))
      setSettingsOpen(false)
      return `Matching now pairs items up to ${days} day${days === 1 ? '' : 's'} apart, `
        + (pct ? `with amounts up to ${pct}% apart.` : 'with equal amounts only.')
    })
  }

  // ---- manual matching selection ----
  const selectTxn = (txn: ReconBankTransaction) => {
    if (selectedTxn?.id === txn.id) {
      clearSelection()
      return
    }
    setSelectedTxn(txn)
    // Keep only lines that fit the new transaction's side.
    setSelectedLines((prev) => new Map([...prev].filter(([, l]) => isPayment(l) === isWithdrawal(txn))))
  }

  const toggleLine = (line: ReconBookLine) => setSelectedLines((prev) => {
    const next = new Map(prev)
    if (next.has(line.id)) next.delete(line.id)
    else next.set(line.id, line)
    return next
  })

  const lineFits = (line: ReconBookLine) => !selectedTxn || isPayment(line) === isWithdrawal(selectedTxn)

  const selection = useMemo(() => {
    const target = selectedTxn ? cents(txnAmount(selectedTxn)) : 0
    const total = [...selectedLines.values()].reduce((s, l) => s + cents(lineAmount(l)), 0)
    // Same rule as the server: the difference may be at most tolerance% of the bank amount (rounded to cents).
    const allowed = Math.round(target * tolerance / 100)
    const withinTolerance = Math.abs(total - target) <= allowed
    return {
      target: target / 100, total: total / 100, diff: (total - target) / 100, allowed: allowed / 100,
      ready: Boolean(selectedTxn) && selectedLines.size > 0 && withinTolerance,
    }
  }, [selectedTxn, selectedLines, tolerance])

  const diff = statement?.difference === null || statement?.difference === undefined ? null : num(statement.difference)
  const periodInfo = statement?.period ?? null
  // Oldest first for the month strip.
  const months = useMemo(() => [...(overview?.months ?? [])].reverse(), [overview])
  const earlierOpen = signMonth ? months.filter((m) => m.month < signMonth && !m.closed && (m.bank + m.book) > 0) : []

  return (
    <div className="flex flex-col gap-6">
      {/* HEADER */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-ink">Bank Reconciliation</h1>
            <p className="mt-1.5 max-w-3xl text-[15px] text-muted">
              Agree the bank statement with the journal entries booked to the bank's GL account.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-64">
            <BankAccountSelect value={accountId} onChange={(id) => setAccountId(id)} placeholder="Choose a bank account" />
          </div>
          <button
            type="button"
            title="Refresh"
            onClick={load}
            disabled={!accountId || loading}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 "
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canEdit && (
            <>
              <button
                type="button"
                title="Auto-match settings"
                onClick={openSettings}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:bg-surface-muted "
              >
                <Settings2 className="h-4 w-4" />
              </button>
              <Button variant="contained" icon={<Wand2 className="h-4 w-4" />} onClick={autoMatch} disabled={!linked || busy} className="h-11 px-4">
                Auto-Match
              </Button>
            </>
          )}
        </div>
      </div>

      {notice && (
        <Alert className="mb-4 border-success/30 bg-success-soft text-success-text">
          <div className="flex items-start justify-between gap-3">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice('')} className="shrink-0 opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
          </div>
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}

      {!accountId ? (
        <Panel className="py-14 text-center">
          <Landmark className="mx-auto mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" />
          <h3 className="text-base font-bold text-ink">Choose a bank account to reconcile.</h3>
          <p className="mt-1 text-xs text-muted">
            Its uploaded statement transactions are matched against imported journal entries booked to its GL account.
          </p>
        </Panel>
      ) : !account ? (
        <div className="flex justify-center p-16"><Spinner /></div>
      ) : (
        <>
          {/* PERIOD PICKER + MONTH STRIP */}
          <Panel className="mb-6 py-4">
            <div className="flex flex-wrap items-end gap-3">
              <Select id="recon-period" label="Period" value={period} onChange={(e) => changePeriod(e.target.value as ReconPeriod)} className="min-w-[180px]">
                {PERIOD_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                <option value="statement">Uploaded Statement</option>
                {/* A month picked from the strip below. */}
                {period === 'month' && <option value="month">{monthLabel(month)}</option>}
              </Select>

              {period === 'statement' && (
                overview && overview.statements.length > 0 ? (
                  <Select
                    id="recon-statement"
                    label="Uploaded statement"
                    value={statementId ?? ''}
                    onChange={(e) => choosePeriod(() => setStatementId(Number(e.target.value) || null))}
                    className="min-w-[320px]"
                  >
                    {overview.statements.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} · {s.date_from} → {s.date_to} ({s.transactions} txns)</option>
                    ))}
                  </Select>
                ) : (
                  <p className="pb-3 text-sm text-muted">No statements uploaded for this account yet.</p>
                )
              )}
              {period === 'custom' && (
                <>
                  <DatePicker id="recon-from" label="Start date" value={customFrom} maxDate={customTo || undefined}
                    onChange={(v) => choosePeriod(() => setCustomFrom(v))} fullWidth={false} className="min-w-[150px]" />
                  <DatePicker id="recon-to" label="End date" value={customTo} minDate={customFrom || undefined}
                    onChange={(v) => choosePeriod(() => setCustomTo(v))} fullWidth={false} className="min-w-[150px]" />
                </>
              )}
              {lockedThrough && (
                <p className="pb-3 text-xs text-muted">
                  <Lock className="mr-1 inline h-3.5 w-3.5" />Signed off through {lockedThrough}
                </p>
              )}
            </div>

            {months.length > 0 && (
              <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                {months.map((m) => {
                  const active = signMonth === m.month
                  const open = m.bank_open + m.book_open
                  return (
                    <button
                      key={m.month}
                      type="button"
                      onClick={() => pickMonth(m.month)}
                      title={m.closed
                        ? `Signed off${m.closed.reconciled_by ? ` by ${m.closed.reconciled_by}` : ''} on ${fmtDateTime(m.closed.reconciled_at)}${m.closed.note ? ` - ${m.closed.note}` : ''}`
                        : `${m.bank_open} of ${m.bank} bank transactions and ${m.book_open} of ${m.book} book lines open`}
                      className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors ${active
                        ? 'border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-400 dark:bg-violet-500/15 dark:text-violet-200'
                        : 'border-border text-muted hover:bg-surface-muted '}`}
                    >
                      {m.label}
                      {m.closed ? (
                        <Lock className="h-3 w-3 text-success-text" />
                      ) : open > 0 ? (
                        <span className="rounded-full bg-warning-soft px-1.5 text-[0.65rem] text-warning-text ">{open} open</span>
                      ) : (
                        <CheckCircle2 className="h-3 w-3 text-muted" />
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </Panel>

          {/* PERIOD: movements + sign-off */}
          {periodInfo && (
            <Panel className="mb-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-ink">
                    {signMonth ? monthLabel(signMonth) : `${periodInfo.date_from} → ${periodInfo.date_to}`}
                  </h2>
                  <p className="text-xs text-muted">
                    {periodInfo.bank_matched} of {periodInfo.bank_transactions} bank transactions and {periodInfo.book_matched} of {periodInfo.book_lines} book lines in this period are matched
                  </p>
                </div>
                {periodInfo.closed && (
                  <Chip tone="success"><Lock className="mr-1 inline h-3.5 w-3.5" />Signed off</Chip>
                )}
              </div>

              <div className="grid gap-6 text-sm md:grid-cols-2">
                <div>
                  <StatementRow label="Opening bank balance" value={periodInfo.bank_opening_balance} hint={`(${periodInfo.date_from})`} />
                  <StatementRow sign="+" label="Money in" value={periodInfo.bank_money_in} hint="deposits" />
                  <StatementRow sign="-" label="Money out" value={periodInfo.bank_money_out} hint="withdrawals" />
                  <StatementRow strong label="Closing bank balance" value={periodInfo.bank_closing_balance} hint={`(${periodInfo.date_to})`} />
                </div>
                <div>
                  <StatementRow label="Book debits" value={periodInfo.book_debits} hint="money in per books" />
                  <StatementRow label="Book credits" value={periodInfo.book_credits} hint="money out per books" />
                  {(periodInfo.carried_forward_bank > 0 || periodInfo.carried_forward_book > 0) && (
                    <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-text dark:bg-warning-soft ">
                      Still open from before {periodInfo.date_from}: {periodInfo.carried_forward_bank} bank transaction{periodInfo.carried_forward_bank === 1 ? '' : 's'} and{' '}
                      {periodInfo.carried_forward_book} book line{periodInfo.carried_forward_book === 1 ? '' : 's'} - they are listed under To Reconcile, marked "Earlier".
                    </p>
                  )}
                </div>
              </div>

              {/* SIGN-OFF */}
              {periodInfo.is_month && signMonth && (
                <div className="mt-5 border-t border-border pt-4 ">
                  {periodInfo.closed ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-muted">
                        <CalendarCheck className="mr-1.5 inline h-4 w-4 text-emerald-500" />
                        Signed off{periodInfo.closed.reconciled_by ? ` by ${periodInfo.closed.reconciled_by}` : ''} on {fmtDateTime(periodInfo.closed.reconciled_at)} ·
                        bank {fmt(periodInfo.closed.bank_balance)} · books {fmt(periodInfo.closed.book_balance)}
                        {num(periodInfo.closed.deposits_in_transit) > 0 && ` · deposits in transit ${fmt(periodInfo.closed.deposits_in_transit)}`}
                        {num(periodInfo.closed.outstanding_payments) > 0 && ` · outstanding payments ${fmt(periodInfo.closed.outstanding_payments)}`}
                        {periodInfo.closed.note && (
                          <span className="mt-1 block text-xs italic text-muted">Note: {periodInfo.closed.note}</span>
                        )}
                      </p>
                      {!canEdit ? null : periodInfo.can_reopen ? (
                        <Button variant="outlined" icon={<LockOpen className="h-4 w-4" />} onClick={reopenMonth} disabled={busy}>Reopen</Button>
                      ) : (
                        <span className="text-xs text-muted">Reopen later months first</span>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-end justify-between gap-4">
                      <ul className="space-y-1.5 text-sm">
                        <Check ok={dateTo <= today()}>The month has ended</Check>
                        <Check ok={earlierOpen.length === 0}>
                          Earlier months are signed off
                          {earlierOpen.length > 0 && (
                            <button type="button" onClick={() => pickMonth(earlierOpen[0].month)} className="ml-1.5 font-semibold text-violet-600 hover:underline dark:text-violet-400">
                              go to {earlierOpen[0].label}
                            </button>
                          )}
                        </Check>
                        <Check ok={(statement?.counts.bank_unmatched ?? 1) === 0}>
                          Every bank transaction up to {periodInfo.date_to} is in the books
                          {(statement?.counts.bank_unmatched ?? 0) > 0 && ` (${statement!.counts.bank_unmatched} open)`}
                        </Check>
                        <Check ok={Boolean(statement?.is_reconciled)}>
                          Adjusted bank and book balances agree{diff !== null && diff !== 0 && ` (difference ${fmt(diff)})`}
                        </Check>
                      </ul>
                      {canEdit && (
                        <div className="flex w-full max-w-md flex-col gap-2 sm:w-auto">
                          <TextField
                            value={signOffNote}
                            onChange={(e) => setSignOffNote(e.target.value.slice(0, 500))}
                            placeholder="Note (optional) - e.g. cheque 1042 outstanding, cleared 3 Apr"
                          />
                          <Button
                            variant="contained"
                            icon={<CalendarCheck className="h-4 w-4" />}
                            onClick={closeMonth}
                            disabled={busy || !periodInfo.can_close || !statement?.is_reconciled || statement.counts.bank_unmatched > 0}
                          >
                            Sign off {monthLabel(signMonth)}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Panel>
          )}

          {/* GL LINK */}
          {!linked && (
            <Panel className="mb-6 border-warning/40 bg-warning-soft ">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-ink">Link "{account.name}" to its GL account</p>
                  <p className="mt-0.5 text-xs text-muted">
                    Pick the Chart of Accounts account your journal entries book this bank to (e.g. "HDFC Current Account").
                    Only journal lines on that account are reconciled against the statement.
                  </p>
                  {canEdit && (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <div className="w-80 max-w-full"><GlAccountSelect value={glDraft} onChange={setGlDraft} bankAccountId={accountId} newLedgerName={account.name} /></div>
                      <Button variant="contained" icon={<Link2 className="h-4 w-4" />} onClick={saveGlAccount} disabled={!glDraft || busy} className="h-11">
                        Link Account
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Panel>
          )}

          {/* RECONCILIATION STATEMENT */}
          {statement && (
            <Panel className="mb-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-ink">Reconciliation statement</h2>
                  <p className="text-xs text-muted">
                    {account.name}{statement.gl_account_name ? ` ↔ ${statement.gl_account_name}` : ''} · as of {statement.as_of}
                  </p>
                </div>
                {diff === null ? (
                  <Chip tone="neutral">No statement balance on or before {statement.as_of}</Chip>
                ) : statement.is_reconciled ? (
                  <Chip tone="success"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />Reconciled</Chip>
                ) : (
                  <Chip tone="warning"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />Difference {fmt(diff)}</Chip>
                )}
              </div>
              <div className="grid gap-6 text-sm md:grid-cols-2">
                <div>
                  <StatementRow label="Balance per bank statement" value={statement.bank_balance} hint={statement.bank_balance_date ? `(${statement.bank_balance_date})` : undefined} />
                  <StatementRow sign="+" label="Deposits in transit" value={statement.deposits_in_transit} hint="in books, not on statement" />
                  <StatementRow sign="-" label="Outstanding payments" value={statement.outstanding_payments} hint="in books, not on statement" />
                  <StatementRow strong label="Adjusted bank balance" value={statement.adjusted_bank_balance} />
                </div>
                <div>
                  <StatementRow label="Balance per books" value={statement.book_balance} hint={statement.gl_account_name ? `(${statement.gl_account_name})` : undefined} />
                  <StatementRow sign="+" label="Bank credits not in books" value={statement.bank_deposits_not_in_books} hint="interest, receipts" />
                  <StatementRow sign="-" label="Bank debits not in books" value={statement.bank_withdrawals_not_in_books} hint="charges, payments" />
                  <StatementRow strong label="Adjusted book balance" value={statement.adjusted_book_balance} />
                </div>
              </div>
              {statement.matched_with_difference > 0 && (
                <Alert className="mt-4 border-warning/30 bg-warning-soft text-warning-text">
                  <b>{fmt(statement.matched_difference)}</b> of the difference comes from {statement.matched_with_difference} matched
                  pair{statement.matched_with_difference === 1 ? '' : 's'} whose amounts differ (matched within the amount tolerance).
                  Book the gap - e.g. as bank charges - to clear it before signing off.
                </Alert>
              )}
              {offerOpeningEntry && (
                <Alert className="mt-4 border-warning/30 bg-warning-soft text-warning-text">
                  <p>
                    The difference is exactly the opening balance of the first statement: <b>{fmt(statement.opening_balance)}</b> was
                    already in the bank before {statement.opening_balance_date}, but the books start from zero.
                    Book it once and the books carry it forward every month.
                  </p>
                  {!canEdit ? null : openingCandidate ? (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <span>
                        Journal entry <b className="font-mono">{openingCandidate.entry_number}</b> ({openingCandidate.date}) already books this
                        amount, but it is listed as a deposit in transit because it isn't marked as the opening balance.
                      </span>
                      <Button variant="contained" onClick={markOpeningCandidate} disabled={busy}>
                        Mark {openingCandidate.entry_number} as opening balance
                      </Button>
                    </div>
                  ) : (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <Select
                      id="recon-equity-account"
                      label="Comes from (equity account)"
                      value={equityId ?? ''}
                      onChange={(e) => setEquityId(Number(e.target.value) || null)}
                      className="min-w-[240px]"
                    >
                      {equityOptions.length === 0 && <option value="">No equity accounts - add one in Chart of Accounts</option>}
                      {equityOptions.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.category_name})</option>)}
                    </Select>
                    <Button variant="contained" onClick={createOpeningEntry} disabled={busy || !equityId}>
                      Book opening balance: Dr {statement.gl_account_name ?? 'Bank'} / Cr {equityOptions.find((s) => s.id === equityId)?.name ?? '…'} · {fmt(statement.opening_balance)} on {statement.opening_entry_date}
                    </Button>
                  </div>
                  )}
                </Alert>
              )}
              {statement.opening_entry_number && (
                <p className="mt-3 text-xs text-muted">
                  Opening balance booked as journal entry <b className="font-mono">{statement.opening_entry_number}</b> and marked as cleared.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted">
                <span>{statement.counts.bank_unmatched} of {statement.counts.bank_transactions} bank transactions outstanding</span>
                <span>·</span>
                <span>{statement.counts.book_unmatched} of {statement.counts.book_lines} book lines outstanding</span>
              </div>
            </Panel>
          )}

          {/* VIEW SWITCH + SEARCH */}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex rounded-xl border border-border p-1 ">
              {(['open', 'matched'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => { setView(v); setTxnPage(0); setLinePage(0); clearSelection() }}
                  className={`rounded-lg px-4 py-1.5 text-sm font-bold transition-colors ${view === v ? 'bg-violet-600 text-white dark:bg-violet-500' : 'text-muted hover:bg-surface-muted '}`}
                >
                  {v === 'open' ? 'To Reconcile' : 'Matched'}
                </button>
              ))}
            </div>
            <div className="w-full sm:w-80">
              <TextField
                value={search}
                onChange={(e) => { setSearch(e.target.value); setTxnPage(0); setLinePage(0) }}
                placeholder="Search descriptions..."
                startIcon={<Search className="h-4 w-4 text-muted" />}
              />
            </div>
          </div>

          {view === 'open' ? (
            <>
              {/* MATCH BAR */}
              {linked && canEdit && (
                <div className="sticky top-2 z-10 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur dark:border-violet-400/30 dark:bg-slate-900/95">
                  <div className="text-sm text-muted">
                    {selectedTxn ? (
                      <>
                        Bank <b className="tabular-nums">{fmt(selection.target)}</b>
                        <span className="mx-2 text-slate-300">vs</span>
                        Books <b className="tabular-nums">{fmt(selection.total)}</b>
                        {selectedLines.size > 0 && selection.diff !== 0 && (
                          <span className={`ml-3 ${selection.ready ? 'text-info-text' : 'text-warning-text'}`}>
                            difference {fmt(selection.diff)}
                            {tolerance > 0 && (selection.ready ? ` - within the ${tolerance}% tolerance` : ` - more than the ${tolerance}% tolerance (${fmt(selection.allowed)})`)}
                          </span>
                        )}
                      </>
                    ) : (
                      `Select a bank transaction on the left, then the journal line(s) that make it up on the right${tolerance ? ` (total within ${tolerance}%)` : ''} - or use Match on any row to pair it with one item.`
                    )}
                  </div>
                  <div className="flex gap-2">
                    {(selectedTxn || selectedLines.size > 0) && <Button variant="text" onClick={clearSelection}>Clear</Button>}
                    <Button variant="contained" icon={<Link2 className="h-4 w-4" />} onClick={matchSelected} disabled={!selection.ready || busy}>
                      Match
                    </Button>
                  </div>
                </div>
              )}

              <div className="grid gap-4 xl:grid-cols-2">
                {/* BANK SIDE */}
                <Panel className="overflow-hidden p-0">
                  <SideHeader icon={<Landmark className="h-5 w-5 text-info" />} title="Bank statement" caption="Not yet in the books" count={txnCount} />
                  <div className="max-h-[560px] overflow-auto">
                    <table className="w-full min-w-[520px] border-collapse text-sm">
                      <thead className="sticky top-0 bg-surface-muted">
                        <tr><th className={`${TH} w-8`} /><th className={TH}>Date</th><th className={TH}>Description</th><th className={`${TH} text-right`}>Withdrawal</th><th className={`${TH} text-right`}>Deposit</th>{linked && canEdit && <th className={TH} />}</tr>
                      </thead>
                      <tbody className="divide-y divide-border-soft">
                        {txns.map((t) => {
                          const selected = selectedTxn?.id === t.id
                          return (
                            <tr
                              key={t.id}
                              onClick={() => linked && canEdit && selectTxn(t)}
                              className={`${linked && canEdit ? 'cursor-pointer' : ''} transition-colors ${selected ? 'bg-primary-soft' : 'hover:bg-surface-muted'}`}
                            >
                              <td className="px-3 py-2"><input type="radio" readOnly checked={selected} disabled={!linked || !canEdit} className="accent-primary" /></td>
                              <td className="whitespace-nowrap px-3 py-2 text-muted">
                                {t.date}
                                {t.date < dateFrom && <Chip tone="warning" variant="outline" className="ml-1.5" title="Open from before this period">Earlier</Chip>}
                              </td>
                              <td className="px-3 py-2 text-ink">
                                {t.description}
                                {t.is_potential_duplicate && <Chip tone="warning" variant="outline" className="ml-2">Possible duplicate</Chip>}
                              </td>
                              <Amounts debit={t.debit} credit={t.credit} />
                              {linked && canEdit && (
                                <td className="px-3 py-2 text-right">
                                  <RowMatchButton
                                    title="Match this bank transaction to one journal line (closest amounts listed first)"
                                    onClick={() => setMatching({ kind: 'transaction', id: t.id })}
                                  />
                                </td>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {!loading && txns.length === 0 && (
                      <p className="p-8 text-center text-sm text-muted">Every bank transaction{dateTo ? ` up to ${dateTo}` : ''} is matched.</p>
                    )}
                  </div>
                  {txnCount > pageSize && (
                    <Pagination count={txnCount} page={txnPage} rowsPerPage={pageSize} onPageChange={setTxnPage} onRowsPerPageChange={changePageSize} />
                  )}
                </Panel>

                {/* BOOK SIDE */}
                <Panel className="overflow-hidden p-0">
                  <SideHeader icon={<BookOpenCheck className="h-5 w-5 text-violet-500" />} title="Books" caption={`Journal lines on ${account.gl_account_name ?? 'the GL account'} not yet on the statement`} count={linked ? lineCount : undefined} />
                  {!linked ? (
                    <p className="p-8 text-center text-sm text-muted">Link a GL account above to see the book side.</p>
                  ) : (
                    <div className="max-h-[560px] overflow-auto">
                      <table className="w-full min-w-[520px] border-collapse text-sm">
                        <thead className="sticky top-0 bg-surface-muted">
                          <tr><th className={`${TH} w-8`} /><th className={TH}>Date</th><th className={TH}>Entry</th><th className={`${TH} text-right`}>Debit</th><th className={`${TH} text-right`}>Credit</th>{canEdit && <th className={TH} />}</tr>
                        </thead>
                        <tbody className="divide-y divide-border-soft">
                          {lines.map((l) => {
                            const fits = canEdit && lineFits(l)
                            const checked = selectedLines.has(l.id)
                            return (
                              <tr
                                key={l.id}
                                onClick={() => fits && toggleLine(l)}
                                className={`transition-colors ${!fits ? 'opacity-40' : 'cursor-pointer'} ${checked ? 'bg-primary-soft' : fits ? 'hover:bg-surface-muted' : ''}`}
                              >
                                <td className="px-3 py-2"><input type="checkbox" readOnly checked={checked} disabled={!fits} className="accent-primary" /></td>
                                <td className="whitespace-nowrap px-3 py-2 text-muted">
                                  {l.date}
                                  {l.date < dateFrom && <Chip tone="warning" variant="outline" className="ml-1.5" title="Open from before this period">Earlier</Chip>}
                                </td>
                                <td className="px-3 py-2">
                                  <span className="font-mono text-xs font-bold text-ink">{l.entry_number}</span>
                                  <span className="block text-xs text-muted">{l.description || l.narration || '—'}</span>
                                </td>
                                <Amounts debit={l.debit} credit={l.credit} />
                                {canEdit && (
                                  <td className="px-3 py-2 text-right">
                                    <RowMatchButton
                                      title="Match this journal line to one bank statement transaction (closest amounts listed first)"
                                      onClick={() => setMatching({ kind: 'journal_line', id: l.id })}
                                    />
                                  </td>
                                )}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      {!loading && lines.length === 0 && (
                        <p className="p-8 text-center text-sm text-muted">Every journal line{dateTo ? ` up to ${dateTo}` : ''} is matched.</p>
                      )}
                    </div>
                  )}
                  {linked && lineCount > pageSize && (
                    <Pagination count={lineCount} page={linePage} rowsPerPage={pageSize} onPageChange={setLinePage} onRowsPerPageChange={changePageSize} />
                  )}
                </Panel>
              </div>
            </>
          ) : (
            /* MATCHED */
            <Panel className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead className="bg-surface-muted">
                    <tr>
                      <th className={TH}>Bank date</th><th className={TH}>Bank description</th>
                      <th className={`${TH} text-right`}>Withdrawal</th><th className={`${TH} text-right`}>Deposit</th>
                      <th className={TH}>Matched journal line(s)</th><th className={TH} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-soft">
                    {txns.map((t) => (
                      <tr key={t.id} className="align-top">
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted">{t.date}</td>
                        <td className="px-3 py-2.5 text-ink">{t.description}</td>
                        <Amounts debit={t.debit} credit={t.credit} />
                        <td className="px-3 py-2.5">
                          {t.matches.map((m) => (
                            <div key={m.id} className="flex flex-wrap items-center gap-2 py-0.5">
                              <span className="font-mono text-xs font-bold text-ink">{m.entry_number}</span>
                              <span className="text-xs text-muted">{m.entry_date}</span>
                              <span className="text-xs tabular-nums text-ink">{fmt(num(m.debit) || num(m.credit))}</span>
                              <Chip tone={m.method === 'AUTO' ? 'info' : 'primary'} variant="outline">{m.method === 'AUTO' ? 'Auto' : 'Manual'}</Chip>
                            </div>
                          ))}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {!canEdit ? null : isLocked(t) ? (
                            <span className="inline-flex items-center gap-1 text-xs text-muted" title="Part of a signed-off month - reopen it to change this match">
                              <Lock className="h-3.5 w-3.5" />Locked
                            </span>
                          ) : (
                            <Button size="sm" variant="outlined" color="error" icon={<Unlink className="h-3.5 w-3.5" />} onClick={() => unmatch(t)} disabled={busy}>
                              Unmatch
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!loading && txns.length === 0 && (
                  <p className="p-8 text-center text-sm text-muted">Nothing matched in this period yet - try Auto-Match.</p>
                )}
              </div>
              {txnCount > pageSize && (
                <Pagination count={txnCount} page={txnPage} rowsPerPage={pageSize} onPageChange={setTxnPage} onRowsPerPageChange={changePageSize} />
              )}
            </Panel>
          )}
        </>
      )}

      <MatchDialog
        target={matching}
        onClose={() => setMatching(null)}
        onMatched={(message) => { setMatching(null); run(async () => message) }}
      />

      {/* SETTINGS */}
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        icon={<Settings2 className="h-4 w-4 text-primary" />}
        title="Matching Settings"
        footer={
          <>
            <Button variant="outlined" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={saveSettings} disabled={busy}>Save</Button>
          </>
        }
      >
        <TextField
          label="Date window (days)"
          type="number"
          value={windowDays}
          onChange={(e) => setWindowDays(e.target.value)}
        />
        <p className="text-xs text-muted">
          Auto-match pairs a bank transaction with a journal line of the same amount on the opposite side
          when their dates are at most this many days apart (cheques clear late, entries are booked early).
        </p>
        <div className="mt-3">
          <TextField
            label="Amount tolerance (%)"
            type="number"
            value={tolerancePct}
            onChange={(e) => setTolerancePct(e.target.value)}
            placeholder="0"
          />
        </div>
        <p className="text-xs text-muted">
          How far apart, as a percent of the bank amount, the bank transaction and its journal line(s) may be and still
          be matched by hand - by Match here, and by Match on Journal Entries and Bank Statements. Outside it they
          can't be matched. 0 = amounts must be equal. Auto-Match always needs equal amounts. Any difference stays in
          the reconciliation until it is booked.
        </p>
      </Modal>
    </div>
  )
}
