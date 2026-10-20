import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
  ArrowLeft, RefreshCw, UploadCloud, Eye, Landmark, AlertTriangle, Check, CalendarX, Layers, Wallet,
  ChevronDown, Search, X, FileText,
} from 'lucide-react'
import { bankStatementsApi } from './bankstatementsapi'
import ContinuityBadge, { ISSUE_LABEL, uploadLinkFor } from './ContinuityBadge'
import Badge from '../../components/Badge'
import Pagination from '../../components/Pagination'
import DatePicker2 from '../../components/DatePicker2'
import type {
  ContinuityAccountRow, ContinuityAccountStatus, ContinuityBank, ContinuityFilters, ContinuityIssue,
  ContinuityPeriod, ContinuityPeriodFilter, ContinuityStatementRow, ContinuitySummary,
} from '../../types'
import { Button, Panel, Alert, Spinner, TextField, Select } from '../../components/tw'
import { useAuth } from '../../context/AuthContext'

type Statement = ContinuityStatementRow

function formatAmount(val: number | null | undefined, signed = false): string {
  if (val === null || val === undefined) return '—'
  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 2,
  }).format(Math.abs(val))
  if (!signed) return val < 0 ? `-${formatted}` : formatted
  return `${val < 0 ? '−' : '+'}${formatted}`
}

const fmtDate = (d: string | null) => (d ? dayjs(d).format('DD MMM YYYY') : '—')

function StatTile({ label, value, tone, icon }: {
  label: string; value: string | number; tone: 'indigo' | 'emerald' | 'rose' | 'amber'; icon: React.ReactNode
}) {
  const TONE = {
    indigo: 'bg-primary-soft text-primary',
    emerald: 'bg-success-soft text-success-text',
    rose: 'bg-danger-soft text-danger-text',
    amber: 'bg-warning-soft text-warning-text',
  }[tone]
  return (
    <div className="flex items-start justify-between gap-3 rounded-[18px] border border-border bg-surface p-5">
      <div>
        <p className="text-[13px] font-semibold text-muted">{label}</p>
        <p className="num mt-2 text-[26px] font-semibold leading-tight text-ink">{value}</p>
      </div>
      <div className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] [&_svg]:h-[18px] [&_svg]:w-[18px] ${TONE}`}>{icon}</div>
    </div>
  )
}

/** Highlighted row drawn *between* two statements when something is wrong with the hand-off. */
function GapRow({ stmt, prevEnd, onUpload }: { stmt: Statement; prevEnd: string | null; onUpload: () => void }) {
  const canUpload = useAuth().can('bank_statements', 'create')
  const c = stmt.continuity
  let title: string
  let detail: string
  let icon = <AlertTriangle className="h-4 w-4" />
  let showUpload = true

  if (c.primary_issue === 'OVERLAP') {
    icon = <Layers className="h-4 w-4" />
    title = `Overlaps the previous statement by ${c.overlap_days} day(s)`
    detail = `This statement starts ${fmtDate(c.start_date)}, but the previous one already runs to ${fmtDate(prevEnd)}. `
      + 'The same transactions may be uploaded twice - check and delete the duplicate statement.'
    showUpload = false
  } else if (c.primary_issue === 'MISSING_PERIOD') {
    icon = <CalendarX className="h-4 w-4" />
    title = `Missing statement: ${fmtDate(c.missing_from)} – ${fmtDate(c.missing_to)} (${c.date_gap_days} day(s))`
    detail = `The balance moved by ${formatAmount(c.balance_gap, true)} with no statement covering it. Upload the statement for this period.`
  } else {
    title = `Unaccounted difference of ${formatAmount(c.balance_gap, true)}`
    detail = `Previous statement closed at ${formatAmount(c.previous_closing_balance)}, but the next one opens at `
      + `${formatAmount(stmt.opening_balance)}. A statement or some transactions between them may be missing.`
  }

  return (
    <tr className="bg-danger-soft /[0.07]">
      <td colSpan={7} className="px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2 text-danger-text">
            <span className="mt-0.5 text-danger-text">{icon}</span>
            <div>
              <p className="text-xs font-bold">{title}</p>
              <p className="mt-0.5 text-xs">{detail}</p>
            </div>
          </div>
          {showUpload && canUpload && (
            <Button size="sm" variant="outlined" color="error" icon={<UploadCloud className="h-3.5 w-3.5" />} onClick={onUpload}>
              Upload missing statement
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

/** The statement that continues from this one (skips statements with no transactions,
 * which the backend leaves out of the chain). */
const nextStatement = (statements: Statement[], stmt: Statement) =>
  statements.find((s) => s.continuity.previous_statement_id === stmt.id) ?? null

function DiffChip({ value }: { value: number }) {
  if (!value) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-md bg-emerald-500/15 px-1.5 py-px font-bold text-success-text">
        <Check className="h-3 w-3" /> matches
      </span>
    )
  }
  return (
    <span className="rounded-md bg-rose-500/15 px-1.5 py-px font-bold text-danger-text">
      {formatAmount(value, true)}
    </span>
  )
}

/** One card per statement, linked left-to-right; each link shows how the next
 * statement's opening compares with this one's closing. */
function BalanceChain({ statements }: { statements: Statement[] }) {
  const chained = statements.filter((s) => s.continuity.start_date)
  return (
    <div className="overflow-x-auto border-b border-border px-5 py-4 ">
      <div className="flex min-w-max items-stretch">
        {chained.map((stmt, i) => {
          const c = stmt.continuity
          const bad = c.issues.length > 0
          const next = chained[i + 1]
          const nc = next?.continuity
          const link = !nc ? null
            : nc.primary_issue === 'OVERLAP' ? { tone: 'rose', text: `overlap ${nc.overlap_days}d`, sub: nc.balance_gap ? formatAmount(nc.balance_gap, true) : '' }
              : nc.primary_issue === 'MISSING_PERIOD' ? { tone: 'rose', text: `missing ${nc.date_gap_days}d`, sub: formatAmount(nc.balance_gap, true) }
                : nc.balance_gap ? { tone: 'rose', text: 'difference', sub: formatAmount(nc.balance_gap, true) }
                  : { tone: 'emerald', text: 'matches', sub: '' }
          return (
            <Fragment key={stmt.id}>
              <div className={`w-44 shrink-0 rounded-xl border px-3 py-2 ${bad
                ? 'border-danger-border bg-danger-soft  /[0.06]'
                : 'border-border bg-slate-50/60 dark:bg-white/[0.03]'}`}
              >
                <p className="text-xs font-bold text-ink">
                  {dayjs(c.start_date).format('MMM YYYY')}
                </p>
                <p className="text-[11px] text-muted">{dayjs(c.start_date).format('DD MMM')} – {dayjs(c.end_date).format('DD MMM')}</p>
                <div className="mt-1.5 space-y-0.5 text-[11px]">
                  <div className="flex justify-between gap-2"><span className="text-muted">Open</span><span className="font-semibold text-ink">{formatAmount(stmt.opening_balance)}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted">Close</span><span className="font-semibold text-ink">{formatAmount(stmt.closing_balance)}</span></div>
                </div>
              </div>
              {link && (
                <div className="flex w-28 shrink-0 flex-col items-center justify-center px-1 text-center">
                  <span className={`text-[11px] font-bold ${link.tone === 'rose' ? 'text-danger-text' : 'text-success-text'}`}>
                    {link.text}
                  </span>
                  <div className={`my-1 h-0.5 w-full rounded ${link.tone === 'rose' ? 'bg-rose-400/70' : 'bg-emerald-400/70'}`} />
                  <span className="text-[11px] font-semibold text-danger-text">{link.sub}</span>
                </div>
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

function StatementTimeline({ acct, statements, onUpload }: {
  acct: ContinuityAccountRow; statements: Statement[]; onUpload: () => void
}) {
  const navigate = useNavigate()
  return (
    <>
      <BalanceChain statements={statements} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-bold text-slate-600 dark:text-muted">
              <th className="px-4 py-2.5">Period</th>
              <th className="px-3 py-2.5">File</th>
              <th className="px-3 py-2.5 text-right">Opening <span className="font-semibold text-muted">vs prev. closing</span></th>
              <th className="px-3 py-2.5 text-right">Closing <span className="font-semibold text-muted">vs next opening</span></th>
              <th className="px-3 py-2.5 text-right">Net change</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {statements.map((stmt, i) => {
              const c = stmt.continuity
              const handOffIssue = c.issues.some((x) => x !== 'INTERNAL_MISMATCH')
              const prevEnd = i > 0 ? statements[i - 1].continuity.end_date : null
              const next = nextStatement(statements, stmt)
              const net = stmt.opening_balance !== null && stmt.closing_balance !== null
                ? stmt.closing_balance - stmt.opening_balance : null
              return (
                <Fragment key={stmt.id}>
                  {handOffIssue && <GapRow stmt={stmt} prevEnd={prevEnd} onUpload={onUpload} />}
                  <tr className="hover:bg-surface-muted">
                    <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-ink">
                      {c.start_date ? `${fmtDate(c.start_date)} → ${fmtDate(c.end_date)}` : 'No transactions'}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2.5 text-xs text-muted" title={stmt.file}>
                      {stmt.file}
                      <div className="text-[11px] text-muted">uploaded {dayjs(stmt.uploaded_at).format('DD MMM YYYY')}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="font-semibold text-ink">{formatAmount(stmt.opening_balance)}</div>
                      {c.has_previous ? (
                        <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[11px] text-muted">
                          <span>prev. closed {formatAmount(c.previous_closing_balance)}</span>
                          <DiffChip value={c.balance_gap ?? 0} />
                        </div>
                      ) : (
                        <div className="mt-0.5 text-[11px] text-muted">first statement</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="font-semibold text-ink">{formatAmount(stmt.closing_balance)}</div>
                      {next ? (
                        <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[11px] text-muted">
                          <span>next opens {formatAmount(next.opening_balance)}</span>
                          <DiffChip value={next.continuity.balance_gap ?? 0} />
                        </div>
                      ) : (
                        <div className="mt-0.5 text-[11px] text-muted">latest statement</div>
                      )}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-semibold ${net === null ? 'text-muted' : net < 0 ? 'text-danger-text' : 'text-success-text'}`}>
                      {net === null ? '—' : formatAmount(net, true)}
                    </td>
                    <td className="px-3 py-2.5">
                      <ContinuityBadge status={c} />
                      {c.issues.includes('INTERNAL_MISMATCH') && (
                        <p className="mt-1 max-w-[260px] text-[11px] leading-snug text-danger-text">
                          Opening + credits − debits is off by {formatAmount(c.internal_discrepancy, true)} from the closing balance. Re-check this file.
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="text" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => navigate(`/bank-statements/${stmt.id}`)}>
                        View
                      </Button>
                    </td>
                  </tr>
                </Fragment>
              )
            })}
            {acct.latest_closing_balance !== null && statements.at(-1)?.continuity.end_date === acct.latest_end_date && (
              <tr>
                <td colSpan={7} className="px-4 py-2.5 text-xs text-muted">
                  Next statement for this account should open at <strong className="text-ink">{formatAmount(acct.latest_closing_balance)}</strong>
                  {acct.latest_end_date && <> and start on or after {fmtDate(acct.latest_end_date)}</>}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** One bank account. Its header comes from the page request, which also preloads the
 * timeline of accounts with issues (they open expanded). Any other card fetches its
 * timeline from its own endpoint only when the user expands it. */
function AccountCard({ acct, preloaded, periodFilter, reloadKey }: {
  acct: ContinuityAccountRow; preloaded?: Statement[]; periodFilter: ContinuityPeriodFilter; reloadKey: number
}) {
  const navigate = useNavigate()
  const canUpload = useAuth().can('bank_statements', 'create')
  const upload = () => navigate(uploadLinkFor(acct.account_id))
  const hasStatements = acct.total_statements > 0
  // Has statements, just none in the selected period.
  const outsidePeriod = !hasStatements && acct.latest_end_date !== null
  const [expanded, setExpanded] = useState(acct.status === 'issues')
  const [fetched, setFetched] = useState<Statement[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const statements = preloaded ?? fetched

  useEffect(() => {
    if (!expanded || !hasStatements || preloaded) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    bankStatementsApi.continuityAccountStatements(acct.account_id, periodFilter, controller.signal)
      .then((rows) => { setFetched(rows); setLoading(false) })
      .catch(() => {
        if (controller.signal.aborted) return
        setError('Failed to load this account\'s statements.')
        setLoading(false)
      })
    return () => controller.abort()
  }, [expanded, hasStatements, preloaded, acct.account_id, periodFilter, reloadKey])

  const statusBadge = acct.status === 'empty'
    ? <Badge size="sm" color="default">{outsidePeriod ? 'No statements in this period' : 'No statements yet'}</Badge>
    : acct.status === 'continuous'
      ? <Badge size="sm" color="success">All continuous</Badge>
      : <Badge size="sm" color="error">{acct.gap_count} issue{acct.gap_count > 1 ? 's' : ''}</Badge>
  const issueTags = (Object.keys(acct.issue_counts) as ContinuityIssue[]).filter((k) => acct.issue_counts[k] > 0)

  return (
    <Panel className="mb-4 overflow-hidden p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <button
          type="button"
          disabled={!hasStatements}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-start gap-2 text-left disabled:cursor-default"
        >
          <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform ${expanded ? '' : '-rotate-90'} ${hasStatements ? '' : 'invisible'}`} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Landmark className="h-4 w-4 text-muted" />
              <h2 className="text-base font-bold text-ink">{acct.account_name}</h2>
              {statusBadge}
              {issueTags.map((k) => (
                <span key={k} className="rounded-md bg-danger-soft px-1.5 py-px text-[11px] font-bold text-danger-text">
                  {ISSUE_LABEL[k]} × {acct.issue_counts[k]}
                </span>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">
              {acct.bank_name ? `${acct.bank_name} · ` : ''}
              {hasStatements
                ? <>
                    {acct.total_statements} statement(s) · covers {fmtDate(acct.coverage_start)} → {fmtDate(acct.coverage_end)}
                    {acct.latest_closing_balance !== null && <> · latest closing <strong>{formatAmount(acct.latest_closing_balance)}</strong></>}
                    {acct.total_balance_gaps > 0 && <> · unaccounted <strong className="text-danger-text">{formatAmount(acct.total_balance_gaps)}</strong></>}
                  </>
                : outsidePeriod
                  ? <>No statements in this period · latest statement ends {fmtDate(acct.latest_end_date)}</>
                  : 'Upload this account\'s first statement to start the continuity check.'}
            </p>
          </div>
        </button>
        {canUpload && (
          <Button size="sm" variant={hasStatements ? 'outlined' : 'contained'} icon={<UploadCloud className="h-3.5 w-3.5" />} onClick={upload}>
            Upload statement
          </Button>
        )}
      </div>

      {expanded && hasStatements && (
        <div className="border-t border-border">
          {loading && !statements ? (
            <div className="flex justify-center p-8"><Spinner size={22} /></div>
          ) : error ? (
            <Alert className="m-4">{error}</Alert>
          ) : statements ? (
            <StatementTimeline acct={acct} statements={statements} onUpload={upload} />
          ) : null}
        </div>
      )}
    </Panel>
  )
}

/** Single summary card - the summary block of /continuity/page/. Clicking an issue type filters the list. */
function SummaryCard({ summary, activeIssue, onIssueClick }: {
  summary: ContinuitySummary | null; activeIssue?: ContinuityIssue; onIssueClick: (issue: ContinuityIssue) => void
}) {
  if (!summary) return <Panel className="mb-6 flex justify-center p-8"><Spinner size={24} /></Panel>
  const issues = Object.keys(summary.issue_counts) as ContinuityIssue[]
  return (
    <Panel className="mb-6 p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Accounts with statements" value={`${summary.accounts_with_statements} / ${summary.total_accounts}`} tone="indigo" icon={<Landmark className="h-5 w-5" />} />
        <StatTile label="Fully continuous" value={`${summary.accounts_continuous} / ${summary.accounts_with_statements}`} tone="emerald" icon={<Check className="h-5 w-5" />} />
        <StatTile label="Statements with issues" value={`${summary.statements_with_issues} / ${summary.total_statements}`} tone={summary.statements_with_issues ? 'rose' : 'emerald'} icon={<AlertTriangle className="h-5 w-5" />} />
        <StatTile label="Unaccounted balance" value={formatAmount(summary.unaccounted_balance)} tone={summary.unaccounted_balance ? 'amber' : 'emerald'} icon={<Wallet className="h-5 w-5" />} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-bold text-muted">Issues by type:</span>
        {issues.map((k) => (
          <button
            key={k}
            type="button"
            disabled={!summary.issue_counts[k]}
            onClick={() => onIssueClick(k)}
            className={`rounded-lg border px-2.5 py-1 font-bold transition-colors disabled:cursor-default disabled:opacity-50 ${activeIssue === k
              ? 'border-danger-border bg-rose-500 text-white'
              : 'border-border text-ink hover:border-danger-border hover:bg-danger-soft dark:hover:bg-danger-soft'}`}
          >
            {ISSUE_LABEL[k]} <span className="ml-1 opacity-80">{summary.issue_counts[k]}</span>
          </button>
        ))}
        {summary.total_missing_days > 0 && (
          <span className="ml-auto text-muted">
            <CalendarX className="mr-1 inline h-3.5 w-3.5" />{summary.total_missing_days} day(s) with no statement
          </span>
        )}
        {summary.accounts_without_statements > 0 && (
          <span className="text-muted">
            <FileText className="mr-1 inline h-3.5 w-3.5" />{summary.accounts_without_statements} account(s) with no statements
          </span>
        )}
      </div>
    </Panel>
  )
}

const STATUS_OPTIONS: { value: ContinuityAccountStatus | ''; label: string }[] = [
  { value: '', label: 'Status: All' },
  { value: 'issues', label: 'Needs attention' },
  { value: 'continuous', label: 'All continuous' },
  { value: 'empty', label: 'No statements yet' },
]

const PERIOD_OPTIONS: { value: ContinuityPeriod; label: string }[] = [
  { value: 'this_fiscal_year', label: 'This Financial Year' },
  { value: 'last_fiscal_year', label: 'Last Financial Year' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'last_quarter', label: 'Last Quarter' },
  { value: 'this_year', label: 'This Year' },
  { value: 'all_time', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
]
const DEFAULT_PERIOD: ContinuityPeriod = 'this_fiscal_year'

export default function StatementContinuityPage() {
  const navigate = useNavigate()
  const [banks, setBanks] = useState<ContinuityBank[]>([])
  const [summary, setSummary] = useState<ContinuitySummary | null>(null)
  const [accounts, setAccounts] = useState<ContinuityAccountRow[]>([])
  const [preloaded, setPreloaded] = useState<Record<string, Statement[]>>({})
  // The bank list doesn't depend on the filters - ask for it only until it has arrived once.
  const banksLoaded = useRef(false)
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [bankName, setBankName] = useState('')
  const [status, setStatus] = useState<ContinuityAccountStatus | ''>('')
  const [issue, setIssue] = useState<ContinuityIssue | ''>('')
  const [period, setPeriod] = useState<ContinuityPeriod>(DEFAULT_PERIOD)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const periodFilter = useMemo<ContinuityPeriodFilter>(() => ({
    period,
    date_from: period === 'custom' ? dateFrom || undefined : undefined,
    date_to: period === 'custom' ? dateTo || undefined : undefined,
  }), [period, dateFrom, dateTo])

  const filters = useMemo<ContinuityFilters>(() => ({
    ...periodFilter,
    search: search || undefined,
    bank_name: bankName || undefined,
    status: status || undefined,
    issue: issue || undefined,
  }), [periodFilter, search, bankName, status, issue])

  // One request per filter / page change: summary, the page of accounts, the expanded cards'
  // timelines (and the bank list the first time). A newer selection aborts the one in flight.
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    bankStatementsApi.continuityPage({
      ...filters,
      page: page + 1,
      limit: rowsPerPage,
      include_banks: banksLoaded.current ? undefined : 1,
    }, controller.signal)
      .then((res) => {
        setSummary(res.summary)
        setAccounts(res.results)
        setCount(res.count)
        setPreloaded(res.statements)
        if (res.banks) { setBanks(res.banks); banksLoaded.current = true }
        setLoading(false)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setError('Failed to load the continuity check.')
        setLoading(false)
      })
    return () => controller.abort()
  }, [filters, page, rowsPerPage, reloadKey])

  const setFilter = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(0) }
  const hasFilters = Boolean(searchInput || bankName || status || issue || period !== DEFAULT_PERIOD)
  const clearFilters = () => {
    setSearchInput(''); setBankName(''); setStatus(''); setIssue(''); setPeriod(DEFAULT_PERIOD); setPage(0)
  }

  const changePeriod = (value: ContinuityPeriod) => {
    if (value === 'custom' && (!dateFrom || !dateTo)) {
      setDateFrom(dayjs().startOf('month').format('YYYY-MM-DD'))
      setDateTo(dayjs().format('YYYY-MM-DD'))
    }
    setPeriod(value)
    setPage(0)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2.5">
            <h1 className="text-ink">Statement Continuity</h1>
          </div>
          <p className="mt-1.5 max-w-3xl text-[15px] text-muted">
            For each bank account, every statement's opening balance should equal the previous statement's closing balance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outlined" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/bank-statements')}>
            Bank Statements
          </Button>
          <Button variant="outlined" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      <SummaryCard
        summary={summary}
        activeIssue={issue || undefined}
        onIssueClick={(k) => setFilter(setIssue)(issue === k ? '' : k)}
      />

      <Panel className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <TextField
            className="min-w-[220px] flex-1"
            placeholder="Search account or bank..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            startIcon={<Search className="h-4 w-4" />}
            endIcon={searchInput ? (
              <button type="button" onClick={() => setSearchInput('')} className="pointer-events-auto text-muted hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            ) : undefined}
          />
          <Select id="continuity-period" value={period} onChange={(e) => changePeriod(e.target.value as ContinuityPeriod)} className="min-w-[180px]">
            {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          {period === 'custom' && (
            <>
              <DatePicker2 id="continuity-from" label="From Date" value={dateFrom} onChange={(d: string) => { setDateFrom(d); setPage(0) }} fullWidth={false} className="min-w-[160px]" />
              <DatePicker2 id="continuity-to" label="To Date" value={dateTo} onChange={(d: string) => { setDateTo(d); setPage(0) }} fullWidth={false} className="min-w-[160px]" />
            </>
          )}
          <Select id="continuity-bank" value={bankName} onChange={(e) => setFilter(setBankName)(e.target.value)} className="min-w-[170px]">
            <option value="">Bank: All</option>
            {banks.map((b) => <option key={b.bank_name} value={b.bank_name}>{b.bank_name} ({b.account_count})</option>)}
          </Select>
          <Select id="continuity-status" value={status} onChange={(e) => setFilter(setStatus)(e.target.value as ContinuityAccountStatus | '')} className="min-w-[170px]">
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select id="continuity-issue" value={issue} onChange={(e) => setFilter(setIssue)(e.target.value as ContinuityIssue | '')} className="min-w-[180px]">
            <option value="">Issue: Any</option>
            {(Object.keys(ISSUE_LABEL) as ContinuityIssue[]).map((k) => <option key={k} value={k}>{ISSUE_LABEL[k]}</option>)}
          </Select>
          {hasFilters && (
            <Button variant="text" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={clearFilters}>Clear</Button>
          )}
        </div>
      </Panel>

      {loading && accounts.length === 0 ? (
        <div className="flex justify-center p-12"><Spinner size={28} /></div>
      ) : accounts.length === 0 ? (
        <Panel className="border-dashed py-12 text-center text-sm font-semibold text-muted">
          {hasFilters ? 'No bank accounts match these filters.' : 'No bank accounts yet - create one under Bank Accounts first.'}
        </Panel>
      ) : (
        <>
          <Panel className="p-0">
            <Pagination
              position="top"
              count={count} page={page} rowsPerPage={rowsPerPage}
              onPageChange={setPage} onRowsPerPageChange={(rpp) => { setRowsPerPage(rpp); setPage(0) }}
              className="border-b-0"
            />
          </Panel>
          {accounts.map((acct) => (
            <AccountCard
              key={acct.account_id}
              acct={acct}
              preloaded={preloaded[acct.account_id]}
              periodFilter={periodFilter}
              reloadKey={reloadKey}
            />
          ))}
          <Panel className="p-0">
            <Pagination
              count={count} page={page} rowsPerPage={rowsPerPage}
              onPageChange={setPage} onRowsPerPageChange={(rpp) => { setRowsPerPage(rpp); setPage(0) }}
            />
          </Panel>
        </>
      )}
    </div>
  )
}
