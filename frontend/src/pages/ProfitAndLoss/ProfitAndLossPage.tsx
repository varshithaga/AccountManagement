import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
  TrendingUp, TrendingDown, AlertTriangle, RefreshCw,
} from 'lucide-react'
import { reportsApi } from './profitandlossapi'
import type { ProfitAndLossReport, ProfitAndLossCategoryGroup } from '../../types'
import {
  Button, Panel, Select, Accordion, Drawer, Chip, Spinner, Alert, IconButton,
} from '../../components/tw'
import BankAccountSelect from '../../components/BankAccountSelect'
import DatePicker2 from '../../components/DatePicker2'
import { exportProfitAndLossReportToExcel } from '../../utils/excelExport'
import { exportProfitAndLossReportToPdf } from '../../utils/pdfExport'
import { ReportExportButtons, FinancialPackButton } from '../../components/ReportExport'

type Period = 'this_month' | 'last_month' | 'this_quarter' | 'this_fiscal_year' | 'last_fiscal_year' | 'custom'

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'this_fiscal_year', label: 'This Financial Year' },
  { value: 'last_fiscal_year', label: 'Last Financial Year' },
  { value: 'custom', label: 'Custom Range' },
]

function formatAmount(value: number | string): string {
  const n = Number(value)
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ---------------------------------------------------------------- Sub-Category Drawer ----

interface SubCategoryData {
  subCategoryId?: number | null
  categoryId?: number
  name: string
  categoryName: string
  total: number
}

function SubCategoryDrawer({
  data,
  filterParams,
  onClose,
}: {
  data: SubCategoryData | null
  filterParams: {
    period: string
    dateFrom?: string
    dateTo?: string
    account?: number | ''
  }
  onClose: () => void
}) {
  const [transactions, setTransactions] = useState<{ id?: number; date?: string; description: string; amount: number }[]>([])
  const [loading, setLoading] = useState(false)
  // Line items come 20 at a time; "Load more" fetches the next page.
  const [total, setTotal] = useState(0)
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const lineItemParams = useMemo(() => (data ? {
    category: data.categoryId,
    sub_category: data.subCategoryId ?? undefined,
    period: filterParams.period,
    date_from: filterParams.period === 'custom' ? filterParams.dateFrom : undefined,
    date_to: filterParams.period === 'custom' ? filterParams.dateTo : undefined,
    account: filterParams.account || undefined,
  } : null), [data, filterParams])

  useEffect(() => {
    if (!lineItemParams) return
    let isMounted = true
    setLoading(true)
    setTransactions([])
    reportsApi.getLineItemTransactions({ ...lineItemParams, page: 1 }).then((res) => {
      if (isMounted) {
        setTransactions(res.results || [])
        setTotal(res.count ?? (res.results || []).length)
        setNextPage(res.next ?? null)
        setLoading(false)
      }
    }).catch(() => {
      if (isMounted) setLoading(false)
    })
    return () => { isMounted = false }
  }, [lineItemParams])

  const loadMore = async () => {
    if (!lineItemParams || !nextPage) return
    setLoadingMore(true)
    try {
      const res = await reportsApi.getLineItemTransactions({ ...lineItemParams, page: nextPage })
      setTransactions((prev) => [...prev, ...(res.results || [])])
      setNextPage(res.next ?? null)
    } finally {
      setLoadingMore(false)
    }
  }

  if (!data) return null

  return (
    <Drawer
      onClose={onClose}
      title={
        <span className="text-xs font-bold uppercase tracking-wide text-muted">
          Sub-Category Line Items
        </span>
      }
    >
      <div className="mb-4">
        <h2 className="text-xl font-bold text-ink">{data.name}</h2>
        <p className="mt-1 text-sm text-muted">
          Categorized under <strong className="font-bold">{data.categoryName}</strong>
        </p>
      </div>

      <div className="mb-4 rounded-xl border border-border bg-surface-muted p-4 ">
        <p className="text-xs font-bold uppercase text-muted">STATEMENT PERIOD TOTAL</p>
        <p className="num mt-1 text-[26px] font-semibold text-ink">₹{formatAmount(Math.abs(data.total))}</p>
      </div>

      <hr className="mb-4 border-border" />

      <p className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">
        TRANSACTIONS ({loading ? '...' : transactions.length < total ? `${transactions.length} of ${total}` : total})
      </p>

      {loading ? (
        <div className="p-8 text-center">
          <Spinner size={28} className="mx-auto" />
          <p className="mt-3 text-sm text-muted">Fetching line items...</p>
        </div>
      ) : transactions.length > 0 ? (
        <div className="mb-4 flex-1 overflow-y-auto">
          {transactions.map((t, idx) => (
            <div key={t.id ?? idx} className="mb-3 rounded-xl border border-border p-3.5 ">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-ink">{t.description || 'Transaction'}</p>
                  <p className="text-xs text-muted">{t.date ? dayjs(t.date).format('DD MMM YYYY') : '—'}</p>
                </div>
                <p className="text-sm font-bold text-ink">₹{formatAmount(Math.abs(t.amount))}</p>
              </div>
            </div>
          ))}
          {nextPage && (
            <div className="flex justify-center">
              <Button variant="outlined" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading...' : `Load more (${total - transactions.length} left)`}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="mb-4 rounded-xl border border-dashed border-input p-6 text-center ">
          <p className="text-sm text-muted">
            No line-item transactions recorded for this sub-category in the selected period.
          </p>
        </div>
      )}
    </Drawer>
  )
}

// ---------------------------------------------------------------- Statement Section ----

function StatementSection({
  title,
  type,
  categories,
  total,
  onViewSubCategory,
}: {
  title: string
  type: 'INCOME' | 'EXPENSE'
  categories: ProfitAndLossCategoryGroup[]
  total: number | string
  onViewSubCategory: (sub: SubCategoryData) => void
}) {
  const isIncome = type === 'INCOME'
  const totalNum = Math.abs(Number(total))

  return (
    <Panel className="h-full">
      <div className={`mb-4 flex items-center justify-between border-b-2 pb-4 ${isIncome ? 'border-success/40' : 'border-danger-border'}`}>
        <h2 className="text-base font-bold tracking-tight text-ink">{title}</h2>
        <span className={`text-xl font-bold ${isIncome ? 'text-success-text' : 'text-danger-text'}`}>
          ₹{formatAmount(totalNum)}
        </span>
      </div>

      {categories.length === 0 ? (
        <p className="py-6 text-center text-sm italic text-muted">
          No categorized {title.toLowerCase()} recorded for this period.
        </p>
      ) : (
        categories.map((cat) => (
          <Accordion
            key={cat.category_id}
            defaultExpanded
            headerClassName="bg-surface-muted "
            header={
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-ink">{cat.category_name}</span>
                <span className={`text-sm font-bold ${isIncome ? 'text-success-text' : 'text-ink'}`}>
                  ₹{formatAmount(Math.abs(Number(cat.total)))}
                </span>
              </div>
            }
          >
            <div className="flex flex-col gap-1">
              {cat.subcategories.map((sub) => (
                <div
                  key={sub.sub_category_id ?? sub.sub_category_name}
                  className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-surface-muted"
                >
                  <span className="text-sm font-semibold text-muted">{sub.sub_category_name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-ink">
                      ₹{formatAmount(Math.abs(Number(sub.amount)))}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onViewSubCategory({
                          subCategoryId: sub.sub_category_id,
                          categoryId: cat.category_id,
                          name: sub.sub_category_name,
                          categoryName: cat.category_name,
                          total: Number(sub.amount),
                        })
                      }
                      className="text-xs font-bold text-violet-700 hover:underline dark:text-violet-300"
                    >
                      View
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Accordion>
        ))
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------- Main Page ----

export default function ProfitAndLossPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sectionFilter = searchParams.get('section')?.toUpperCase() // 'INCOME' | 'EXPENSE'

  const [selectedAccountName, setSelectedAccountName] = useState<string | null>(null)
  const [account, setAccount] = useState<number | ''>('')
  const [period, setPeriod] = useState<Period>('this_month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [report, setReport] = useState<ProfitAndLossReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [selectedSubCategory, setSelectedSubCategory] = useState<SubCategoryData | null>(null)


  // A custom range is fetched only once both dates are picked.
  const awaitingDates = period === 'custom' && (!dateFrom || !dateTo)

  // One request per filter change; a newer selection aborts the one still in flight, so a
  // slow older response can never overwrite the report for the current filters.
  useEffect(() => {
    if (awaitingDates) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    reportsApi.profitAndLoss({
      period,
      date_from: period === 'custom' ? dateFrom : undefined,
      date_to: period === 'custom' ? dateTo : undefined,
      account: account || undefined,
    }, controller.signal)
      .then((data) => { setReport(data); setLoading(false) })
      .catch(() => {
        if (controller.signal.aborted) return
        setError('Failed to load the Profit & Loss report.')
        setLoading(false)
      })
    return () => controller.abort()
  }, [period, dateFrom, dateTo, account, awaitingDates, reloadKey])

  const handlePeriodChange = (value: Period) => {
    if (value === 'custom' && !dateFrom && !dateTo) {
      setDateFrom(dayjs().startOf('month').format('YYYY-MM-DD'))
      setDateTo(dayjs().format('YYYY-MM-DD'))
    }
    setPeriod(value)
  }

  // Totals come worked out from the backend (report.summary).
  const incomeTotal = Number(report?.summary.total_income ?? 0)
  const expensesTotal = Number(report?.summary.total_expenses ?? 0)
  const netProfit = Number(report?.summary.net_profit ?? 0)
  const isProfit = netProfit >= 0
  const profitMargin = Number(report?.summary.profit_margin ?? 0).toFixed(2)

  const pageTitle = sectionFilter === 'INCOME'
    ? 'Income Statement'
    : sectionFilter === 'EXPENSE'
      ? 'Expenses Statement'
      : 'Profit & Loss Statement'

  const exportOptions = () => {
    const accountName = selectedAccountName || (account ? `Account #${account}` : 'All Bank Accounts')
    const periodLabel = PERIOD_OPTIONS.find((p) => p.value === period)?.label || 'Selected Period'
    const dateRangeText = report?.date_from && report?.date_to
      ? `${dayjs(report.date_from).format('DD MMM YYYY')} – ${dayjs(report.date_to).format('DD MMM YYYY')}`
      : undefined

    return { report: report!, accountName, periodLabel, dateRangeText }
  }
  const handleExportExcel = () => exportProfitAndLossReportToExcel(exportOptions())
  const handleExportPdf = () => exportProfitAndLossReportToPdf(exportOptions())

  return (
    <div className="fade-in pb-12">
      {/* PAGE HEADER */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-ink">{pageTitle}</h1>
            {sectionFilter && <Chip tone={sectionFilter === 'INCOME' ? 'success' : 'error'}>{sectionFilter}</Chip>}
          </div>
          <p className="mt-1 text-sm font-medium text-muted">
            Income and expenses summarized by category and sub-category
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <FinancialPackButton
            filters={{
              period,
              dateFrom,
              dateTo,
              account,
              accountName: selectedAccountName || (account ? `Account #${account}` : 'All Bank Accounts'),
              periodLabel: PERIOD_OPTIONS.find((p) => p.value === period)?.label || 'Selected Period',
            }}
            disabled={!report}
            onError={setError}
          />
          <ReportExportButtons
            onExcel={handleExportExcel}
            onPdf={handleExportPdf}
            disabled={!report}
            onError={setError}
          />
        </div>
      </div>

      {/* FILTER TOOLBAR */}
      <Panel className="mb-6 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <IconButton title="Refresh Profit & Loss Report" onClick={() => setReloadKey((k) => k + 1)} disabled={loading || awaitingDates}>
            <RefreshCw className="h-4 w-4" />
          </IconButton>

          <Select
            id="pnl-period-select"
            label="Period"
            value={period}
            onChange={(e) => handlePeriodChange(e.target.value as Period)}
            className="min-w-[200px]"
          >
            {PERIOD_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>

          {period === 'custom' && (
            <>
              <DatePicker2 id="pnl-date-from" label="From" value={dateFrom} onChange={setDateFrom} maxDate={dateTo || undefined} fullWidth={false} className="min-w-[160px]" />
              <DatePicker2 id="pnl-date-to" label="To" value={dateTo} onChange={setDateTo} minDate={dateFrom || undefined} fullWidth={false} className="min-w-[160px]" />
            </>
          )}

          <div className="min-w-[240px]">
            <BankAccountSelect label="Bank Account"
              value={account}
              onChange={(id, name) => { setAccount(id ?? ''); setSelectedAccountName(name) }}
            />
          </div>

          {report?.date_from && report?.date_to && (
            <span className="text-sm font-semibold text-muted">
              Period: {dayjs(report.date_from).format('01 MMM YYYY')} – {dayjs(report.date_to).format('DD MMM YYYY')}
            </span>
          )}
        </div>
      </Panel>

      {error && <Alert className="mb-6">{error}</Alert>}

      {awaitingDates ? (
        <Panel className="p-12 text-center text-sm font-semibold text-muted">
          Pick both a From and a To date for the custom range.
        </Panel>
      ) : loading ? (
        <div className="p-16 text-center">
          <Spinner size={36} className="mx-auto" />
          <p className="mt-3 text-sm text-muted">Generating Profit &amp; Loss Report...</p>
        </div>
      ) : report && (
        <>
          {/* HERO SUMMARY CARDS (3 KPI METRICS) */}
          <div className={`mb-6 grid grid-cols-1 gap-4 ${sectionFilter ? '' : 'sm:grid-cols-3'}`}>
            {(!sectionFilter || sectionFilter === 'INCOME') && (
              <div className="rounded-2xl border border-border bg-surface p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">TOTAL INCOME</p>
                <p className="num mt-1 text-[26px] font-semibold text-success-text">₹{formatAmount(incomeTotal)}</p>
              </div>
            )}

            {(!sectionFilter || sectionFilter === 'EXPENSE') && (
              <div className="rounded-2xl border border-border bg-surface p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">TOTAL EXPENSES</p>
                <p className="num mt-1 text-[26px] font-semibold text-danger-text">₹{formatAmount(expensesTotal)}</p>
              </div>
            )}

            {!sectionFilter && (
              <div
                className={`rounded-2xl border border-slate-200 p-5 dark:border-white/10 ${isProfit ? 'bg-success-soft' : 'bg-danger-soft'
                  }`}
              >
                <p className="text-xs font-bold uppercase tracking-wide text-muted">
                  {isProfit ? 'NET PROFIT' : 'NET LOSS'}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  {isProfit ? (
                    <TrendingUp className="h-6 w-6 text-success-text" />
                  ) : (
                    <TrendingDown className="h-6 w-6 text-danger-text" />
                  )}
                  <span className={`text-3xl font-bold ${isProfit ? 'text-success-text' : 'text-danger-text'}`}>
                    ₹{formatAmount(Math.abs(netProfit))}
                  </span>
                </div>
                <p className="mt-1 text-xs font-semibold text-muted">Margin: {profitMargin}%</p>
              </div>
            )}
          </div>

          {/* ACTIONABLE UNCATEGORIZED WARNING */}
          {report.uncategorized_count > 0 && (
            <div className="mb-4 rounded-2xl border border-warning/40 bg-warning-soft p-5 dark:bg-warning-soft">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-warning-text" />
                  <div>
                    <p className="text-sm font-bold text-warning-text ">
                      {report.uncategorized_count} Bank Transaction{report.uncategorized_count === 1 ? '' : 's'} Not in the Books Yet
                    </p>
                    <p className="text-sm text-muted">
                      Not in this report until categorized and made final (or matched in Bank Reconciliation) • Net amount: <strong className="font-bold">{formatAmount(report.uncategorized_net_amount)}</strong>
                    </p>
                  </div>
                </div>
                <Button variant="contained" color="warning" size="sm" onClick={() => navigate('/transactions')}>
                  Review in General Ledger
                </Button>
              </div>
            </div>
          )}

          {/* ACTIONABLE DUPLICATE WARNING */}
          {report.duplicate_count > 0 && (
            <div className="mb-6 rounded-2xl border border-info/40 bg-info-soft/60 p-5 dark:border-info/40 dark:bg-info-soft">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-info-text" />
                  <div>
                    <p className="text-sm font-bold text-info-text dark:text-info-text">
                      {report.duplicate_count} Potential Duplicate Transaction{report.duplicate_count === 1 ? '' : 's'}
                    </p>
                    <p className="text-sm text-muted">
                      Excluded from this report • Net amount: <strong className="font-bold">-₹{formatAmount(Math.abs(Number(report.duplicate_net_amount)))}</strong>
                    </p>
                  </div>
                </div>
                <Button variant="contained" color="info" size="sm" onClick={() => navigate('/bank-statements')}>
                  Review Bank Statements
                </Button>
              </div>
            </div>
          )}

          {/* REPORT BREAKDOWN SECTIONS (Side-by-Side Grid) */}
          <div className={!sectionFilter ? 'grid grid-cols-1 gap-6 md:grid-cols-2 items-start mb-6' : ''}>
            {(!sectionFilter || sectionFilter === 'INCOME') && (
              <StatementSection
                title="INCOME"
                type="INCOME"
                categories={report.income.categories}
                total={report.income.total}
                onViewSubCategory={setSelectedSubCategory}
              />
            )}

            {(!sectionFilter || sectionFilter === 'EXPENSE') && (
              <StatementSection
                title="EXPENSES"
                type="EXPENSE"
                categories={report.expense.categories}
                total={report.expense.total}
                onViewSubCategory={setSelectedSubCategory}
              />
            )}
          </div>

          {/* NET PROFIT STATEMENT FOOTER */}
          {!sectionFilter && (
            <Panel className="bg-slate-50/80 dark:bg-slate-900/60">
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold uppercase text-muted">TOTAL INCOME</span>
                  <span className="text-sm font-bold text-success-text">₹{formatAmount(incomeTotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold uppercase text-muted">TOTAL EXPENSES</span>
                  <span className="text-sm font-bold text-danger-text">₹{formatAmount(expensesTotal)}</span>
                </div>
              </div>

              <hr className="my-4 border-t-2 border-border" />

              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-xl font-bold ${isProfit ? 'text-success-text' : 'text-danger-text'}`}>
                    NET PROFIT
                  </p>
                  <p className="text-sm font-semibold text-muted">
                    Profit Margin: <strong className="font-bold">{profitMargin}%</strong>
                  </p>
                </div>
                <span className={`text-3xl font-bold ${isProfit ? 'text-success-text' : 'text-danger-text'}`}>
                  ₹{formatAmount(Math.abs(netProfit))}
                </span>
              </div>
            </Panel>
          )}

          {/* SUB-CATEGORY TRANSACTIONS INSPECTION DRAWER */}
          <SubCategoryDrawer
            data={selectedSubCategory}
            filterParams={{ period, dateFrom, dateTo, account }}
            onClose={() => setSelectedSubCategory(null)}
          />
        </>
      )}
    </div>
  )
}
