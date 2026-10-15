import { useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { Infinity as InfinityIcon, ArrowLeftRight, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { reportsComparisonApi, type ComparisonPeriod, type ComparisonRange, type PeriodTotals } from './reportscomparisonapi'
import { Panel, Select, Chip, Spinner, Alert } from '../../components/tw'
import BankAccountSelect from '../../components/BankAccountSelect'
import DatePicker2 from '../../components/DatePicker2'
import { exportComparisonReportToExcel } from '../../utils/excelExport'
import { exportComparisonReportToPdf } from '../../utils/pdfExport'
import { ReportExportButtons } from '../../components/ReportExport'

const PERIOD_OPTIONS: { value: ComparisonPeriod; label: string }[] = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'this_fiscal_year', label: 'This Financial Year' },
  { value: 'last_fiscal_year', label: 'Last Financial Year' },
  { value: 'custom', label: 'Custom Range' },
]

function formatAmount(value: number | string | undefined | null): string {
  if (value === undefined || value === null) return '₹0.00'
  const n = Number(value)
  const formatted = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `−₹${formatted}` : `₹${formatted}`
}

function formatSigned(value: number): string {
  const formatted = Math.abs(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (value > 0) return `+₹${formatted}`
  if (value < 0) return `−₹${formatted}`
  return '₹0.00'
}

// Whether an increase in this metric is a good thing (income/profit/assets/equity
// growing) or a bad thing (expenses/liabilities growing), so deltas can be
// colored by real-world meaning rather than just "up = green".
type MetricKey = 'income' | 'expenses' | 'net_profit' | 'assets' | 'liabilities' | 'equity'
const INCREASE_IS_GOOD: Record<MetricKey, boolean> = {
  income: true,
  expenses: false,
  net_profit: true,
  assets: true,
  liabilities: false,
  equity: true,
}

interface ComparisonMetric {
  key: MetricKey
  label: string
  a: number
  b: number
}

interface PeriodFilterState {
  period: ComparisonPeriod
  dateFrom: string
  dateTo: string
}

function PeriodFilterPanel({
  title,
  value,
  onChange,
  resolvedLabel,
}: {
  title: string
  value: PeriodFilterState
  onChange: (next: PeriodFilterState) => void
  resolvedLabel?: string
}) {
  return (
    <div className="flex-1 rounded-2xl border border-border p-4 ">
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">{title}</p>
      <div className="flex flex-col gap-3">
        <Select
          id={`${title}-period`}
          label="Period"
          value={value.period}
          onChange={(e) => onChange({ ...value, period: e.target.value as ComparisonPeriod })}
        >
          {PERIOD_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>

        {value.period === 'custom' && (
          <div className="flex gap-3">
            <DatePicker2
              id={`${title}-date-from`}
              label="From"
              value={value.dateFrom}
              onChange={(d) => onChange({ ...value, dateFrom: d })}
              maxDate={value.dateTo || undefined}
              className="flex-1"
            />
            <DatePicker2
              id={`${title}-date-to`}
              label="To"
              value={value.dateTo}
              onChange={(d) => onChange({ ...value, dateTo: d })}
              minDate={value.dateFrom || undefined}
              className="flex-1"
            />
          </div>
        )}

        {resolvedLabel && (
          <p className="text-xs font-semibold text-muted">{resolvedLabel}</p>
        )}
      </div>
    </div>
  )
}

type Part = 'all_time' | 'a' | 'b'

/** The period as the API takes it, or null while a custom range is missing a date. */
const rangeOf = ({ period, dateFrom, dateTo }: PeriodFilterState): ComparisonRange | null => {
  if (period !== 'custom') return { period }
  return dateFrom && dateTo ? { period, date_from: dateFrom, date_to: dateTo } : null
}

function DeltaCell({ metricKey, delta, deltaPct }: { metricKey: MetricKey; delta: number; deltaPct: number | null }) {
  const isGoodDirection = INCREASE_IS_GOOD[metricKey]
  const isFlat = Math.abs(delta) < 0.005
  const isPositiveChange = delta > 0
  const colorClass = isFlat
    ? 'text-muted'
    : (isPositiveChange === isGoodDirection ? 'text-success-text' : 'text-danger-text')
  const Icon = isFlat ? Minus : (isPositiveChange ? TrendingUp : TrendingDown)

  return (
    <div className={`flex items-center justify-end gap-1.5 ${colorClass}`}>
      <Icon className="h-4 w-4 shrink-0" />
      <div className="text-right">
        <p className="text-sm font-bold">{formatSigned(delta)}</p>
        {deltaPct !== null && (
          <p className="text-xs font-semibold leading-none">
            {delta >= 0 ? '+' : ''}{deltaPct.toFixed(1)}%
          </p>
        )}
      </div>
    </div>
  )
}

export default function ReportsComparisonPage() {
  const [selectedAccountName, setSelectedAccountName] = useState<string | null>(null)
  const [account, setAccount] = useState<number | ''>('')

  const [filterA, setFilterA] = useState<PeriodFilterState>({ period: 'this_month', dateFrom: '', dateTo: '' })
  const [filterB, setFilterB] = useState<PeriodFilterState>({ period: 'last_month', dateFrom: '', dateTo: '' })
  const rangeA = useMemo(() => rangeOf(filterA), [filterA])
  const rangeB = useMemo(() => rangeOf(filterB), [filterB])
  const awaitingDates = !rangeA || !rangeB

  // All three parts (all-time summary, Period A, Period B) come from ONE request to
  // /reports/comparison/ - totals only, worked out by the backend. Each part remembers what
  // it was loaded for, and a request asks only for the parts that are out of date - page
  // load: all three; changing Period A: just A; changing the bank account: all three.
  // The full reports are fetched only on export.
  const [totals, setTotals] = useState<Partial<Record<Part, PeriodTotals>>>({})
  const [loadingParts, setLoadingParts] = useState<Part[]>([])
  const [loadError, setLoadError] = useState('')
  const [exportError, setExportError] = useState('')
  const loadedFor = useRef<Partial<Record<Part, string>>>({})

  const wantedKey: Record<Part, string | null> = {
    all_time: String(account),
    a: rangeA && JSON.stringify([rangeA, account]),
    b: rangeB && JSON.stringify([rangeB, account]),
  }

  useEffect(() => {
    const stale = (Object.keys(wantedKey) as Part[])
      .filter((p) => wantedKey[p] !== null && loadedFor.current[p] !== wantedKey[p])
    if (stale.length === 0) return
    const keys = { ...wantedKey }
    const controller = new AbortController()
    setLoadingParts(stale)
    setLoadError('')
    reportsComparisonApi.comparison({
      summary: stale.includes('all_time'),
      a: stale.includes('a') && rangeA ? rangeA : undefined,
      b: stale.includes('b') && rangeB ? rangeB : undefined,
      account,
    }, controller.signal)
      .then((data) => {
        setTotals((prev) => ({ ...prev, ...data }))
        for (const p of stale) loadedFor.current[p] = keys[p] ?? undefined
        setLoadingParts([])
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setLoadError('Failed to load the reports.')
        setLoadingParts([])
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey.all_time, wantedKey.a, wantedKey.b])

  const allTime = totals.all_time ?? null
  const totalsA = totals.a ?? null
  const totalsB = totals.b ?? null
  const summaryLoading = loadingParts.includes('all_time') || (!allTime && !loadError)
  const summaryError = allTime ? '' : loadError
  const compareLoading = loadingParts.includes('a') || loadingParts.includes('b')
    || (!awaitingDates && (!totalsA || !totalsB) && !loadError)
  const compareError = (allTime ? loadError : '') || exportError

  const summaryIncome = allTime?.income ?? 0
  const summaryExpenses = allTime?.expenses ?? 0
  const summaryNetProfit = allTime?.net_profit ?? 0
  const summaryIsProfit = summaryNetProfit >= 0

  const metrics: ComparisonMetric[] = useMemo(() => {
    if (!totalsA || !totalsB || awaitingDates) return []
    return [
      { key: 'income', label: 'Total Income', a: totalsA.income, b: totalsB.income },
      { key: 'expenses', label: 'Total Expenses', a: totalsA.expenses, b: totalsB.expenses },
      { key: 'net_profit', label: 'Net Profit', a: totalsA.net_profit, b: totalsB.net_profit },
      { key: 'assets', label: 'Total Assets', a: totalsA.assets, b: totalsB.assets },
      { key: 'liabilities', label: 'Total Liabilities', a: totalsA.liabilities, b: totalsB.liabilities },
      { key: 'equity', label: 'Total Equity', a: totalsA.equity, b: totalsB.equity },
    ]
  }, [totalsA, totalsB, awaitingDates])

  const resolvedLabelFor = (t: PeriodTotals | null) =>
    t?.date_from && t?.date_to
      ? `${dayjs(t.date_from).format('DD MMM YYYY')} – ${dayjs(t.date_to).format('DD MMM YYYY')}`
      : undefined

  // The category breakdowns in the export come from /reports/comparison/export/, fetched
  // only when the user exports.
  const exportOptions = async () => {
    const full = await reportsComparisonApi.comparisonExport({ summary: true, a: rangeA ?? undefined, b: rangeB ?? undefined, account })
    const accountName = account === ''
      ? 'All Bank Accounts'
      : selectedAccountName || `Account #${account}`

    const labelA = filterA.period === 'custom' ? 'Custom Range' : PERIOD_OPTIONS.find((p) => p.value === filterA.period)?.label || 'Period A'
    const labelB = filterB.period === 'custom' ? 'Custom Range' : PERIOD_OPTIONS.find((p) => p.value === filterB.period)?.label || 'Period B'

    return {
      accountName,
      labelA,
      labelB,
      dateRangeA: resolvedLabelFor(totalsA),
      dateRangeB: resolvedLabelFor(totalsB),
      metrics,
      allTimePnl: full.all_time?.profit_and_loss ?? null,
      allTimeBs: full.all_time?.balance_sheet ?? null,
      pnlA: full.a?.profit_and_loss ?? null,
      pnlB: full.b?.profit_and_loss ?? null,
      bsA: full.a?.balance_sheet ?? null,
      bsB: full.b?.balance_sheet ?? null,
    }
  }
  const handleExportExcel = async () => exportComparisonReportToExcel(await exportOptions())
  const handleExportPdf = async () => exportComparisonReportToPdf(await exportOptions())

  return (
    <div className="flex flex-col gap-6">
      {/* PAGE HEADER */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-ink">
            Period Comparison &amp; Summary
          </h1>
          <p className="mt-1.5 max-w-3xl text-[15px] text-muted">
            All-time totals since inception, plus side-by-side comparison across any two periods
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[240px]">
            <BankAccountSelect label=""
              value={account}
              onChange={(id, name) => { setAccount(id ?? ''); setSelectedAccountName(name) }}
            />
          </div>
        </div>
      </div>

      {/* ALL-TIME SUMMARY */}
      <Panel className="mb-6">
        <div className="mb-4 flex items-center gap-2.5">
          <InfinityIcon className="h-5 w-5 text-primary" />
          <h2 className="text-base font-bold text-ink">All-Time Summary</h2>
          <Chip tone="primary" variant="outline">Since Inception</Chip>
        </div>

        {summaryError && <Alert className="mb-4">{summaryError}</Alert>}

        {summaryLoading ? (
          <div className="flex items-center justify-center p-8"><Spinner size={28} /></div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">TOTAL INCOME</p>
              <p className="num mt-1 text-xl font-semibold text-success-text">{formatAmount(summaryIncome)}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">TOTAL EXPENSES</p>
              <p className="num mt-1 text-xl font-semibold text-danger-text">{formatAmount(summaryExpenses)}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">NET PROFIT</p>
              <p className={`mt-1 text-xl font-bold ${summaryIsProfit ? 'text-success-text' : 'text-danger-text'}`}>
                {formatAmount(summaryNetProfit)}
              </p>
            </div>

            <div className="sm:col-span-3"><hr className="border-border" /></div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">TOTAL ASSETS</p>
              <p className="num mt-1 text-xl font-semibold text-info-text">{formatAmount(allTime?.assets)}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">TOTAL LIABILITIES</p>
              <p className="num mt-1 text-xl font-semibold text-caution-text">{formatAmount(allTime?.liabilities)}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">TOTAL EQUITY</p>
              <p className="num mt-1 text-xl font-semibold text-equity-text">{formatAmount(allTime?.equity)}</p>
            </div>
          </div>
        )}
      </Panel>

      {/* PERIOD COMPARISON */}
      <Panel>
        <div className="mb-4 flex items-center gap-2.5">
          <ArrowLeftRight className="h-5 w-5 text-primary" />
          <h2 className="text-base font-bold text-ink">Period Comparison</h2>
        </div>

        <div className="mb-5 flex flex-col gap-3 md:flex-row">
          <PeriodFilterPanel title="Period A" value={filterA} onChange={setFilterA} resolvedLabel={resolvedLabelFor(totalsA)} />
          <PeriodFilterPanel title="Period B" value={filterB} onChange={setFilterB} resolvedLabel={resolvedLabelFor(totalsB)} />
        </div>

        {compareError && <Alert className="mb-4">{compareError}</Alert>}

        {awaitingDates ? (
          <p className="p-8 text-center text-sm font-semibold text-muted">
            Pick both a From and a To date for the custom range to compare.
          </p>
        ) : compareLoading ? (
          <div className="flex items-center justify-center p-8"><Spinner size={28} /></div>
        ) : (
          <>
            <div className="mb-2 flex justify-end gap-2">
              <ReportExportButtons
                onExcel={handleExportExcel}
                onPdf={handleExportPdf}
                disabled={metrics.length === 0}
                onError={setExportError}
                size="sm"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-3 py-2.5 text-left text-xs font-bold text-ink">Metric</th>
                    <th className="px-3 py-2.5 text-right text-xs font-bold text-ink">Period A</th>
                    <th className="px-3 py-2.5 text-right text-xs font-bold text-ink">Period B</th>
                    <th className="px-3 py-2.5 text-right text-xs font-bold text-ink">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft">
                  {metrics.map((m) => {
                    const delta = m.b - m.a
                    const deltaPct = m.a !== 0 ? (delta / Math.abs(m.a)) * 100 : null
                    return (
                      <tr key={m.key}>
                        <td className="px-3 py-3 font-bold text-ink">{m.label}</td>
                        <td className="px-3 py-3 text-right text-ink">{formatAmount(m.a)}</td>
                        <td className="px-3 py-3 text-right text-ink">{formatAmount(m.b)}</td>
                        <td className="px-3 py-3 text-right">
                          <DeltaCell metricKey={m.key} delta={delta} deltaPct={deltaPct} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
    </div>
  )
}
