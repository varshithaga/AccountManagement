import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
  TrendingUp, TrendingDown, ArrowRight, HelpCircle, Copy,
  Wallet, Receipt, UploadCloud, ArrowLeftRight, AlertTriangle,
  RefreshCw, BarChart3, CheckCircle2, Scale, FileWarning, Wand2, Clock, FileText, ShoppingCart,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { dashboardApi, DashboardOverview, type ReconciliationAccountStatus } from './dashboardapi'
import { Button, Panel, Spinner, Alert, IconButton, type Tone } from '../../components/tw'
import DatePicker2 from '../../components/DatePicker2'
import BankAccountSelect from '../../components/BankAccountSelect'
import CashFlowForecastWidget from './CashFlowForecastWidget'
import SalesOverviewWidget from './SalesOverviewWidget'

type Period = 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'custom'

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_quarter', label: 'Quarter' },
  { value: 'this_year', label: 'Year' },
  { value: 'custom', label: 'Custom' },
]

const PERIOD_LABEL: Record<Period, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  this_year: 'This year',
  custom: 'Custom period',
}

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })

/** ₹52,84,613.54 - negatives with a real minus sign: −₹2,24,129.25. */
function formatAmount(value: number | string | undefined | null): string {
  if (value === undefined || value === null) return INR.format(0)
  const n = Number(value)
  return n < 0 ? `−${INR.format(Math.abs(n))}` : INR.format(n)
}

const SOURCE_TYPE_CLASS: Record<string, string> = {
  PDF: 'bg-danger-soft text-danger-text',
  EXCEL: 'bg-success-soft text-success-text',
  CSV: 'bg-info-soft text-info-text',
}

/** Status colours: a soft tile background with a strong icon / text colour. */
const TONE: Record<'success' | 'danger' | 'warning' | 'caution' | 'info' | 'primary', { soft: string; text: string }> = {
  success: { soft: 'bg-success-soft', text: 'text-success-text' },
  danger: { soft: 'bg-danger-soft', text: 'text-danger-text' },
  warning: { soft: 'bg-warning-soft', text: 'text-warning-text' },
  caution: { soft: 'bg-caution-soft', text: 'text-caution-text' },
  info: { soft: 'bg-info-soft', text: 'text-info-text' },
  primary: { soft: 'bg-primary-soft', text: 'text-primary' },
}

/** Account-share colours on the navy cash card. */
const SHARE_COLORS = ['bg-mint', 'bg-highlight', 'bg-[#7C9BFF]', 'bg-[#4FD6D4]', 'bg-[#C9B8FF]', 'bg-[#FF9F6E]']

/** "Sep 2026", "Jul – Sep 2026" for whole months, otherwise "05 Sep – 14 Sep 2026". */
function rangeLabel(from: string, to: string): string {
  const f = dayjs(from)
  const t = dayjs(to)
  if (f.date() === 1 && t.date() === t.daysInMonth()) {
    if (f.isSame(t, 'month')) return f.format('MMM YYYY')
    return f.isSame(t, 'year') ? `${f.format('MMM')} – ${t.format('MMM YYYY')}` : `${f.format('MMM YYYY')} – ${t.format('MMM YYYY')}`
  }
  return `${f.format('DD MMM')} – ${t.format('DD MMM YYYY')}`
}

/** ▲/▼ % change against the previous period, as a pill. upIsGood decides the colour (up in expenses is bad). */
function ChangeIndicator({ current, previous, upIsGood, vsLabel }: {
  current: number
  previous: number
  upIsGood: boolean
  vsLabel: string
}) {
  const diff = current - previous
  if (previous === 0 && current === 0) {
    return <span className="text-xs text-muted">No change vs {vsLabel}</span>
  }
  if (previous === 0) {
    return <span className="text-xs text-muted">Nothing in {vsLabel} to compare</span>
  }
  const pct = (diff / Math.abs(previous)) * 100
  const up = diff > 0
  const good = diff === 0 ? null : up === upIsGood
  const cls = good === null ? 'bg-surface-muted text-muted' : good ? 'bg-success-soft text-success-text' : 'bg-danger-soft text-danger-text'
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted" title={`${vsLabel}: ${formatAmount(previous)}`}>
      <span className={`num rounded-[20px] px-2 py-0.5 text-xs font-semibold ${cls}`}>
        {diff === 0 ? '■ 0%' : `${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`}
      </span>
      vs {vsLabel}
    </span>
  )
}

function IconTile({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <span className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] ${TONE[tone].soft} ${TONE[tone].text} [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:stroke-[1.8]`}>
      {children}
    </span>
  )
}

function StatCard({
  tone, icon, label, value, valueClass = 'text-ink', caption, change,
}: {
  tone: keyof typeof TONE
  icon: ReactNode
  label: string
  value: string
  valueClass?: string
  caption: string
  change?: ReactNode
}) {
  return (
    <div className="flex flex-col rounded-[18px] border border-border bg-surface p-6">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-muted">{label}</span>
        <IconTile tone={tone}>{icon}</IconTile>
      </div>
      <div className={`num mt-3 text-[26px] font-semibold leading-tight ${valueClass}`}>{value}</div>
      <p className="mt-1 text-xs text-muted">{caption}</p>
      {change && <div className="mt-auto pt-3">{change}</div>}
    </div>
  )
}

const RECON_STATUS: Record<ReconciliationAccountStatus, { label: string; cls: string }> = {
  OPEN: { label: 'Open items', cls: 'bg-warning-soft text-warning-text' },
  UP_TO_DATE: { label: 'Up to date', cls: 'bg-success-soft text-success-text' },
  NO_ACTIVITY: { label: 'No activity', cls: 'bg-surface text-muted' },
  NOT_LINKED: { label: 'GL not linked', cls: 'bg-danger-soft text-danger-text' },
}

function ExpenseProgressBar({ label, amount, max }: { label: string; amount: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.max((amount / max) * 100, 4)) : 0
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-ink">{label}</span>
        <span className="num text-sm font-semibold text-ink">{formatAmount(amount)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-border-soft">
        <div className="h-full rounded bg-danger transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function AttentionItem({
  tone, icon, count, title, subtitle, amount, buttonLabel, buttonColor, onClick,
}: {
  tone: keyof typeof TONE
  icon: ReactNode
  count: number
  title: string
  subtitle: string
  amount: string
  buttonLabel: string
  buttonColor: Tone
  /** Left out when the user's role can't open the page the button leads to. */
  onClick?: () => void
}) {
  const clear = count === 0
  const t = clear ? TONE.success : TONE[tone]
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <span className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${t.soft} ${t.text}`}>
          <span className="num text-base font-semibold">{count}</span>
          <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface [&_svg]:h-3 [&_svg]:w-3 [&_svg]:stroke-[2]">
            {clear ? <CheckCircle2 className="text-success" /> : icon}
          </span>
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="text-[13px] leading-snug text-muted">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 pl-[58px] sm:justify-end sm:pl-0">
        {clear
          ? <span className="rounded-[20px] bg-success-soft px-2.5 py-0.5 text-xs font-bold text-success-text">All clear</span>
          : <span className={`num text-sm font-semibold ${t.text}`}>{amount}</span>}
        {onClick && (
          <Button variant="outlined" size="sm" color={buttonColor} endIcon={<ArrowRight className="h-4 w-4" />} onClick={onClick}>
            {buttonLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

function SourceBadge({ type }: { type: string }) {
  const cls = SOURCE_TYPE_CLASS[type] || 'bg-surface-muted text-muted'
  return <span className={`inline-flex items-center rounded-[20px] px-2.5 py-0.5 text-xs font-bold ${cls}`}>{type}</span>
}

/** "HDFC Bank" -> "HB", "ICICI" -> "IC". */
function monogram(name: string): string {
  const words = name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0] ?? '?').slice(0, 2).toUpperCase()
}

function CardHeader({ title, subtitle, action, icon }: { title: string; subtitle: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        {icon}
        <div>
          <h2 className="text-base text-ink">{title}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>
        </div>
      </div>
      {action}
    </div>
  )
}

function QuickTile({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[88px] flex-col items-start justify-between gap-3 rounded-2xl border border-border bg-surface p-4 text-left transition-colors hover:border-primary-border hover:bg-surface-muted"
    >
      <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-primary-soft text-primary [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:stroke-[1.8]">
        {icon}
      </span>
      <span className="text-[13px] font-semibold leading-snug text-ink">{label}</span>
    </button>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { user, can, hasPage } = useAuth()
  const canUpload = can('bank_statements', 'create')
  const canImportJournal = can('journal_entries', 'create')
  const canOpenLedger = hasPage('transactions')
  const canOpenStatements = hasPage('bank_statements')
  const [period, setPeriod] = useState<Period>('this_month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  // Bank account filter: '' = all accounts. Narrows every widget on the page.
  const [account, setAccount] = useState<number | ''>('')
  const [accountName, setAccountName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dashData, setDashData] = useState<DashboardOverview | null>(null)

  const fetchDashboardData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const overview = await dashboardApi.getOverview({
        period,
        date_from: period === 'custom' ? (dateFrom || undefined) : undefined,
        date_to: period === 'custom' ? (dateTo || undefined) : undefined,
        account: account || undefined,
      })
      setDashData(overview)
    } catch {
      setError('Failed to load dashboard control center metrics.')
    } finally {
      setLoading(false)
    }
  }, [period, dateFrom, dateTo, account])

  useEffect(() => { fetchDashboardData() }, [fetchDashboardData])

  const handlePeriodChange = (val: Period) => {
    if (val === 'custom' && !dateFrom && !dateTo) {
      setDateFrom(dayjs().startOf('month').format('YYYY-MM-DD'))
      setDateTo(dayjs().format('YYYY-MM-DD'))
    }
    setPeriod(val)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Spinner size={32} />
      </div>
    )
  }
  if (error || !dashData) {
    return <Alert className="m-4">{error || 'Failed to load dashboard control center metrics.'}</Alert>
  }

  const { kpis, cash_position, attention, top_expenses, recent_statements } = dashData

  const incomeTotal = Number(kpis.income_total)
  const expenseTotal = Number(kpis.expense_total)
  const netProfit = Number(kpis.net_profit)
  const isProfit = kpis.is_profit
  const profitMargin = kpis.profit_margin
  const cashBalance = Number(kpis.cash_balance)

  const accounts = cash_position.accounts
  const pendingAttentionCount = attention.pending_attention_count

  const uncategorizedCount = attention.uncategorized.count
  const uncategorizedAmount = Number(attention.uncategorized.amount)
  const duplicateCount = attention.duplicates.count
  const duplicateAmount = Number(attention.duplicates.amount)
  const unreconciledCount = attention.unreconciled.count
  const continuityCount = attention.continuity_issues.count
  const notAutoCategorizedCount = attention.not_auto_categorized.count
  const overdueInvoices = attention.overdue_invoices ?? { count: 0, amount: 0 }
  const overdueBills = attention.overdue_bills ?? { count: 0, amount: 0 }

  const previous = kpis.previous
  const vsLabel = previous ? rangeLabel(previous.date_from, previous.date_to) : ''
  const reconAccounts = dashData.reconciliation_status.accounts
  const canOpenReconciliation = hasPage('bank_reconciliation')

  const topExpenses = top_expenses.top_expenses
  const maxExpense = Number(top_expenses.max_expense)

  const recentStatementsList = recent_statements.results
  const statementCount = recent_statements.count

  const periodSentence = period === 'this_month' ? 'this month' : period === 'last_month' ? 'last month' : period === 'this_quarter' ? 'this quarter' : period === 'this_year' ? 'this year' : 'in the custom period'

  // Each account's share of the money held - the bars on the cash card and in Cash position.
  const positiveTotal = accounts.reduce((s, a) => s + Math.max(0, Number(a.balance)), 0)
  const shareOf = (balance: number | string) => (positiveTotal > 0 ? (Math.max(0, Number(balance)) / positiveTotal) * 100 : 0)

  return (
    <div className="flex flex-col gap-6">
      {/* 1. HEADER & PERIOD CONTROL */}
      <div className="flex flex-col gap-5 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-primary">{dayjs().format('dddd, D MMMM YYYY')}</p>
          <h1 className="mt-1.5 text-ink">
            Welcome back{user?.username ? `, ${user.username}` : ''}
          </h1>
          <p className="mt-1.5 text-[15px] text-muted">
            {account
              ? <>Here's what's happening in <span className="font-semibold text-ink">{accountName || `Account #${account}`}</span> {periodSentence}.</>
              : <>Here's what's happening across your {accounts.length} bank account{accounts.length === 1 ? '' : 's'} {periodSentence}.</>}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-ink">Period</span>
            <div id="dash-period" role="radiogroup" aria-label="Period" className="flex overflow-x-auto rounded-xl border border-border bg-surface-muted p-1">
              {PERIOD_OPTIONS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={period === p.value}
                  onClick={() => handlePeriodChange(p.value)}
                  className={`h-[38px] whitespace-nowrap rounded-[9px] px-3.5 text-[13px] font-semibold transition-colors ${
                    period === p.value ? 'bg-ink text-surface' : 'text-muted hover:text-ink'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-w-[220px]">
            <BankAccountSelect
              label="Bank account"
              value={account}
              onChange={(id, name) => { setAccount(id ?? ''); setAccountName(name) }}
            />
          </div>

          <IconButton title="Refresh Dashboard Data" onClick={() => fetchDashboardData()} disabled={loading} className="self-end">
            <RefreshCw className="h-[18px] w-[18px] stroke-[1.8]" />
          </IconButton>

          {period === 'custom' && (
            <div className="flex gap-3">
              <DatePicker2
                id="dash-date-from"
                label="From"
                value={dateFrom}
                maxDate={dateTo || undefined}
                onChange={(dateStr) => setDateFrom(dateStr)}
                fullWidth={false}
                className="min-w-[150px]"
              />
              <DatePicker2
                id="dash-date-to"
                label="To"
                value={dateTo}
                minDate={dateFrom || undefined}
                onChange={(dateStr) => setDateTo(dateStr)}
                fullWidth={false}
                className="min-w-[150px]"
              />
            </div>
          )}
        </div>
      </div>

      {/* 2. KPI CARDS - cash first, on navy */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex flex-col rounded-[18px] bg-sidebar p-6 text-white">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-sidebar-label">Cash &amp; bank balance</span>
            <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-white/[0.08] text-highlight">
              <Wallet className="h-[18px] w-[18px] stroke-[1.8]" />
            </span>
          </div>
          <div className={`num mt-3 text-[28px] font-semibold leading-tight ${cashBalance < 0 ? 'text-[#FF8C9B]' : 'text-white'}`}>
            {formatAmount(cashBalance)}
          </div>
          <p className="mt-1 text-xs text-sidebar-label">
            {account ? (accountName || `Account #${account}`) : `${accounts.length} linked account${accounts.length === 1 ? '' : 's'}`}
          </p>
          {accounts.length > 0 && positiveTotal > 0 && (
            <div className="mt-auto pt-4">
              <div className="flex h-1.5 gap-0.5 overflow-hidden rounded">
                {accounts.map((a, i) => (
                  <div
                    key={a.id}
                    title={`${a.name}: ${formatAmount(a.balance)}`}
                    className={SHARE_COLORS[i % SHARE_COLORS.length]}
                    style={{ width: `${shareOf(a.balance)}%` }}
                  />
                ))}
              </div>
              <p className="mt-2 text-[11px] text-sidebar-label">Share of balance by account</p>
            </div>
          )}
        </div>
        <StatCard
          tone="success"
          icon={<TrendingUp />}
          label="Income"
          value={formatAmount(incomeTotal)}
          caption={`${PERIOD_LABEL[period]} · total inflows`}
          change={previous && (
            <ChangeIndicator current={incomeTotal} previous={Number(previous.income_total)} upIsGood vsLabel={vsLabel} />
          )}
        />
        <StatCard
          tone="danger"
          icon={<TrendingDown />}
          label="Expenses"
          value={formatAmount(expenseTotal)}
          caption={`${PERIOD_LABEL[period]} · total outflows`}
          change={previous && (
            <ChangeIndicator current={expenseTotal} previous={Number(previous.expense_total)} upIsGood={false} vsLabel={vsLabel} />
          )}
        />
        <StatCard
          tone={isProfit ? 'success' : 'danger'}
          icon={<ArrowLeftRight />}
          label={isProfit ? 'Net profit' : 'Net loss'}
          value={isProfit ? formatAmount(Math.abs(netProfit)) : formatAmount(-Math.abs(netProfit))}
          valueClass={isProfit ? 'text-ink' : 'text-danger-text'}
          caption={`${profitMargin}% margin · income − expenses`}
          change={previous && (
            <ChangeIndicator
              current={isProfit ? netProfit : -netProfit}
              previous={Number(previous.net_profit)}
              upIsGood
              vsLabel={vsLabel}
            />
          )}
        />
      </div>

      {/* SALES & PURCHASES THIS MONTH */}
      <SalesOverviewWidget />

      {/* CASH FLOW FORECAST & RUNWAY ANALYTICS WIDGET */}
      {dashData.cash_flow_forecast && (
        <CashFlowForecastWidget data={dashData.cash_flow_forecast} />
      )}

      {/* 3. NEEDS YOUR ATTENTION & CASH POSITION */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.25fr_1fr]">
        <Panel>
          <CardHeader
            title="Needs your attention"
            subtitle={pendingAttentionCount > 0
              ? 'Items to review before closing the period.'
              : 'All statement transactions are categorized and reconciled.'}
            action={pendingAttentionCount > 0
              ? <span className="inline-flex items-center gap-1.5 self-start rounded-[20px] bg-warning-soft px-2.5 py-0.5 text-xs font-bold text-warning-text"><AlertTriangle className="h-3.5 w-3.5" /> <span className="num">{pendingAttentionCount}</span> open</span>
              : <span className="inline-flex items-center gap-1.5 self-start rounded-[20px] bg-success-soft px-2.5 py-0.5 text-xs font-bold text-success-text"><CheckCircle2 className="h-3.5 w-3.5" /> All clear</span>}
          />

          <div className="divide-y divide-border-soft">
            {/* UNCATEGORIZED */}
            <AttentionItem
              tone="warning"
              icon={<HelpCircle className="text-warning" />}
              count={uncategorizedCount}
              title={`Uncategorized transaction${uncategorizedCount === 1 ? '' : 's'}`}
              subtitle="Need a P&L or Balance Sheet category"
              amount={formatAmount(uncategorizedAmount)}
              buttonLabel="Review"
              buttonColor="warning"
              onClick={canOpenLedger ? () => navigate('/transactions?uncategorized=true') : undefined}
            />

            {/* POTENTIAL DUPLICATES */}
            <AttentionItem
              tone="danger"
              icon={<Copy className="text-danger" />}
              count={duplicateCount}
              title={`Potential duplicate${duplicateCount === 1 ? '' : 's'}`}
              subtitle="Overlapping transactions across statement uploads"
              amount={formatAmount(duplicateAmount)}
              buttonLabel="Review"
              buttonColor="error"
              onClick={canOpenLedger ? () => navigate('/transactions?is_potential_duplicate=true') : undefined}
            />

            {/* UNRECONCILED (OLD) BANK TRANSACTIONS */}
            {unreconciledCount > 0 && (
              <AttentionItem
                tone="warning"
                icon={<Clock className="text-warning" />}
                count={unreconciledCount}
                title={`Unreconciled transaction${unreconciledCount === 1 ? '' : 's'}`}
                subtitle={`Older than ${attention.unreconciled.older_than_days} days and not matched to a journal entry`}
                amount={formatAmount(attention.unreconciled.amount)}
                buttonLabel="Reconcile"
                buttonColor="warning"
                onClick={canOpenReconciliation ? () => navigate('/bank-reconciliation') : undefined}
              />
            )}

            {/* STATEMENT CONTINUITY GAPS */}
            {continuityCount > 0 && (
              <AttentionItem
                tone="caution"
                icon={<FileWarning className="text-caution" />}
                count={continuityCount}
                title={`Statement continuity gap${continuityCount === 1 ? '' : 's'}`}
                subtitle="Missing days or balances that don't carry over"
                amount={formatAmount(attention.continuity_issues.amount)}
                buttonLabel="Check"
                buttonColor="warning"
                onClick={hasPage('statement_continuity') ? () => navigate('/bank-statements/continuity') : undefined}
              />
            )}

            {/* STATEMENTS NOT YET AUTO-CATEGORIZED */}
            {notAutoCategorizedCount > 0 && (
              <AttentionItem
                tone="primary"
                icon={<Wand2 className="text-primary" />}
                count={notAutoCategorizedCount}
                title={`Statement${notAutoCategorizedCount === 1 ? '' : 's'} not auto-categorized`}
                subtitle="Uploaded but not yet run through Auto-Categorize"
                amount={`${notAutoCategorizedCount} file${notAutoCategorizedCount === 1 ? '' : 's'}`}
                buttonLabel="Open"
                buttonColor="primary"
                onClick={canOpenStatements ? () => navigate('/bank-statements') : undefined}
              />
            )}

            {/* OVERDUE SALES INVOICES */}
            {overdueInvoices.count > 0 && (
              <AttentionItem
                tone="danger"
                icon={<FileText className="text-danger" />}
                count={overdueInvoices.count}
                title={`Overdue invoice${overdueInvoices.count === 1 ? '' : 's'}`}
                subtitle="Past their due date and not fully paid by the client"
                amount={formatAmount(overdueInvoices.amount)}
                buttonLabel="Follow up"
                buttonColor="error"
                onClick={hasPage('receivables_payables') ? () => navigate('/receivables-payables')
                  : hasPage('sales_invoices') ? () => navigate('/sales-invoices') : undefined}
              />
            )}

            {/* OVERDUE PURCHASE BILLS */}
            {overdueBills.count > 0 && (
              <AttentionItem
                tone="warning"
                icon={<ShoppingCart className="text-warning" />}
                count={overdueBills.count}
                title={`Overdue bill${overdueBills.count === 1 ? '' : 's'}`}
                subtitle="Supplier bills past their due date and not fully paid"
                amount={formatAmount(overdueBills.amount)}
                buttonLabel="Pay"
                buttonColor="warning"
                onClick={hasPage('purchase_bills') ? () => navigate('/purchase-bills') : undefined}
              />
            )}
          </div>
        </Panel>

        {/* CASH POSITION */}
        <Panel>
          <CardHeader
            title="Cash position"
            subtitle="Latest balance of each bank account"
            action={hasPage('balance_sheet') && (
              <Button endIcon={<ArrowRight className="h-4 w-4" />} size="sm" onClick={() => navigate('/balance-sheet?section=ASSETS')}>
                View Cash Flow
              </Button>
            )}
          />

          {accounts.length === 0 ? (
            <div className="py-8 text-center">
              <Wallet className="mx-auto mb-2 h-9 w-9 stroke-[1.8] text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-muted">No active bank accounts linked yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-border-soft">
              {accounts.map((acct) => (
                <div key={acct.id} className="py-3.5 first:pt-0">
                  <div className="flex items-center gap-3">
                    <span className="num flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-[13px] font-semibold text-primary-hover dark:text-primary">
                      {monogram(acct.bank_name || acct.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{acct.name}</p>
                      <p className="text-xs text-muted">
                        {acct.bank_name || 'Bank account'}
                        {acct.account_number && <> · <span className="num">•••• {acct.account_number.slice(-4)}</span></>}
                      </p>
                    </div>
                    <p className={`num text-sm font-semibold ${Number(acct.balance) < 0 ? 'text-danger-text' : 'text-ink'}`}>{formatAmount(acct.balance)}</p>
                  </div>
                  <div className="ml-[52px] mt-2 h-1.5 overflow-hidden rounded bg-border-soft">
                    <div className="h-full rounded bg-primary transition-[width] duration-300" style={{ width: `${shareOf(acct.balance)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between rounded-xl bg-surface-muted px-4 py-3">
            <span className="text-sm font-semibold text-ink">Total cash &amp; bank</span>
            <span className={`num text-base font-semibold ${cashBalance < 0 ? 'text-danger-text' : 'text-ink'}`}>{formatAmount(cashBalance)}</span>
          </div>
        </Panel>
      </div>

      {/* 4. RECONCILIATION STATUS PER BANK ACCOUNT */}
      <Panel>
        <CardHeader
          title="Reconciliation status"
          subtitle="Bank transactions matched to journal entries, per account (all time)"
          icon={<span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-primary-soft text-primary"><Scale className="h-[18px] w-[18px] stroke-[1.8]" /></span>}
          action={canOpenReconciliation && (
            <Button endIcon={<ArrowRight className="h-4 w-4" />} size="sm" onClick={() => navigate('/bank-reconciliation')}>
              Bank Reconciliation
            </Button>
          )}
        />

        {reconAccounts.length === 0 ? (
          <p className="py-4 text-sm text-muted">No active bank accounts linked yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {reconAccounts.map((a) => {
              const st = RECON_STATUS[a.status]
              const pct = a.matched_percent ?? 0
              return (
                <div
                  key={a.id}
                  onClick={canOpenReconciliation ? () => navigate(`/bank-reconciliation?account=${a.id}`) : undefined}
                  className={`flex flex-col rounded-2xl border border-border bg-surface-muted p-4 ${
                    canOpenReconciliation ? 'cursor-pointer transition-colors hover:border-primary-border' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold text-ink">{a.name}</p>
                    <span className={`shrink-0 rounded-[20px] px-2 py-0.5 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                  </div>

                  {a.status === 'NOT_LINKED' ? (
                    <p className="mt-3 flex-1 text-xs text-muted">
                      Link this bank account to a Chart of Accounts account to reconcile it.
                    </p>
                  ) : a.bank_transactions === 0 ? (
                    <p className="mt-3 flex-1 text-xs text-muted">
                      No bank transactions yet{a.open_book > 0 ? ` · ${a.open_book} journal line${a.open_book === 1 ? '' : 's'} waiting` : ''}.
                    </p>
                  ) : (
                    <div className="flex-1">
                      <p className="num mt-3 text-[26px] font-semibold leading-none text-ink">{pct}%</p>
                      <p className="mt-1.5 text-xs text-muted">
                        <span className="num">{a.bank_matched} / {a.bank_transactions}</span> matched
                      </p>
                      <div className="mt-3 h-2 overflow-hidden rounded bg-border-soft">
                        <div
                          className={`h-full rounded transition-[width] duration-300 ${pct >= 100 ? 'bg-success' : pct >= 75 ? 'bg-primary' : 'bg-warning'}`}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <p className="mt-3 border-t border-border pt-2.5 text-[11px] text-muted">
                    {a.locked_through ? `Signed off through ${dayjs(a.locked_through).format('MMM YYYY')}` : 'No month signed off yet'}
                    {a.status !== 'NOT_LINKED' && a.bank_transactions > 0 && (
                      <> · <span className="num">{a.open_bank}</span> open bank · <span className="num">{a.open_book}</span> open journal</>
                    )}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      {/* 5. INCOME VS EXPENSE & TOP EXPENSE CATEGORIES */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel>
          <CardHeader
            title="Income vs Expense"
            subtitle="Performance summary for the selected period"
            action={hasPage('profit_and_loss') && (
              <Button endIcon={<ArrowRight className="h-4 w-4" />} size="sm" onClick={() => navigate('/profit-and-loss')}>
                View P&amp;L
              </Button>
            )}
          />

          <div className="mb-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-success-soft p-4">
              <p className="text-xs font-bold uppercase tracking-[0.06em] text-success-text">Income</p>
              <p className="num mt-1.5 text-lg font-semibold text-ink">{formatAmount(incomeTotal)}</p>
            </div>
            <div className="rounded-xl bg-danger-soft p-4">
              <p className="text-xs font-bold uppercase tracking-[0.06em] text-danger-text">Expenses</p>
              <p className="num mt-1.5 text-lg font-semibold text-ink">{formatAmount(expenseTotal)}</p>
            </div>
          </div>

          {/* Income vs Expense Ratio Bar Visualizer */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-muted">Operating expenses ratio</span>
              <span className="text-[13px] text-ink">
                <span className="num font-semibold">{incomeTotal > 0 ? ((expenseTotal / incomeTotal) * 100).toFixed(1) : 0}%</span> of income spent
              </span>
            </div>
            <div className="flex h-2 gap-0.5 overflow-hidden rounded">
              <div
                className="rounded-l bg-success transition-[width] duration-300"
                style={{ width: `${Math.min(100, Math.max(5, (incomeTotal / ((incomeTotal + expenseTotal) || 1)) * 100))}%` }}
              />
              <div
                className="rounded-r bg-danger transition-[width] duration-300"
                style={{ width: `${Math.min(100, Math.max(5, (expenseTotal / ((incomeTotal + expenseTotal) || 1)) * 100))}%` }}
              />
            </div>
          </div>
        </Panel>

        <Panel>
          <CardHeader title="Top Expense Categories" subtitle="Largest expenditure categories for the selected period" />
          {topExpenses.length === 0 ? (
            <div className="py-6 text-center">
              <BarChart3 className="mx-auto mb-2 h-9 w-9 stroke-[1.8] text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-muted">No categorized expenses recorded for this period yet.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {topExpenses.map((cat) => (
                <ExpenseProgressBar key={cat.category_id} label={cat.category_name} amount={Math.abs(Number(cat.total))} max={maxExpense} />
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* 6. RECENT BANK STATEMENTS & QUICK ACTIONS */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Panel>
          <CardHeader
            title="Recent Bank Statements"
            subtitle="Latest statement uploads and their parsed transactions"
            action={
              <div className="flex shrink-0 items-center gap-2">
                {canUpload && (
                  <Button variant="contained" size="sm" icon={<UploadCloud className="h-4 w-4" />} onClick={() => navigate('/bank-statements')}>
                    Upload
                  </Button>
                )}
                {canOpenStatements && (
                  <Button variant="outlined" size="sm" endIcon={<ArrowRight className="h-4 w-4" />} onClick={() => navigate('/bank-statements')}>
                    View all ({statementCount})
                  </Button>
                )}
              </div>
            }
          />

          {recentStatementsList.length === 0 ? (
            <div className="py-8 text-center">
              <Receipt className="mx-auto mb-2 h-9 w-9 stroke-[1.8] text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-muted">No bank statements uploaded yet.</p>
              {canUpload && (
                <Button variant="contained" className="mt-3" onClick={() => navigate('/bank-statements')}>
                  Upload Statement
                </Button>
              )}
            </div>
          ) : (
            <div className="-mx-6 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-6 py-2.5 text-left">Account</th>
                    <th className="px-3 py-2.5 text-left">Source</th>
                    <th className="px-3 py-2.5 text-right">Transactions</th>
                    <th className="px-6 py-2.5 text-right">Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {recentStatementsList.map((s) => (
                    <tr
                      key={s.id}
                      onClick={canOpenStatements ? () => navigate(`/bank-statements/${s.id}`) : undefined}
                      className={`${canOpenStatements ? 'cursor-pointer ' : ''}border-b border-border-soft last:border-0 hover:bg-surface-muted`}
                    >
                      <td className="px-6 py-[13px] font-semibold text-ink">{s.account_name}</td>
                      <td className="px-3 py-[13px]"><SourceBadge type={s.source_type} /></td>
                      <td className="px-3 py-[13px] text-right text-ink">{s.transaction_count ?? '—'}</td>
                      <td className="px-6 py-[13px] text-right text-[13px] text-muted">{dayjs(s.uploaded_at).format('DD MMM YYYY')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* 7. QUICK ACTIONS */}
        <Panel>
          <CardHeader title="Quick actions" subtitle="Shortcuts to common accounting tasks" />

          <div className="flex flex-col gap-3">
            {canUpload && (
              <Button
                variant="contained"
                icon={<UploadCloud className="h-[18px] w-[18px]" />}
                onClick={() => navigate('/bank-statements')}
                className="w-full"
              >
                Import Bank Statement
              </Button>
            )}

            <div className="grid grid-cols-2 gap-3">
              {canImportJournal && (
                <QuickTile icon={<Receipt />} label="Import Journal Entries" onClick={() => navigate('/journal-entries')} />
              )}
              {canOpenLedger && (
                <QuickTile icon={<HelpCircle />} label="Review Uncategorized" onClick={() => navigate('/transactions?uncategorized=true')} />
              )}
              {canOpenLedger && (
                <QuickTile icon={<Copy />} label="Review Duplicates" onClick={() => navigate('/transactions?is_potential_duplicate=true')} />
              )}
              {hasPage('profit_and_loss') && (
                <QuickTile icon={<BarChart3 />} label="View P&L Report" onClick={() => navigate('/profit-and-loss')} />
              )}
              {hasPage('balance_sheet') && (
                <QuickTile icon={<Wallet />} label="View Balance Sheet" onClick={() => navigate('/balance-sheet')} />
              )}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}
