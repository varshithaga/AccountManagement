import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
  Wallet, CreditCard, PieChart, CheckCircle2, AlertTriangle, ArrowRight,
  ArrowLeftRight, HelpCircle, RefreshCw,
} from 'lucide-react'
import { balancesheetApi } from './balancesheetapi'
import type { BalanceSheetReport } from '../../types'
import {
  Button, Panel, Select, Accordion, Drawer, Chip, Spinner, Alert, IconButton,
} from '../../components/tw'
import BankAccountSelect from '../../components/BankAccountSelect'
import DatePicker2 from '../../components/DatePicker2'
import { exportBalanceSheetReportToExcel } from '../../utils/excelExport'
import { exportBalanceSheetReportToPdf } from '../../utils/pdfExport'
import { ReportExportButtons, FinancialPackButton } from '../../components/ReportExport'

type Period = 'this_month' | 'last_month' | 'this_quarter' | 'this_fiscal_year' | 'last_fiscal_year' | 'custom'

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'this_month', label: 'As of This Month' },
  { value: 'last_month', label: 'As of Last Month' },
  { value: 'this_quarter', label: 'As of This Quarter' },
  { value: 'this_fiscal_year', label: 'As of End of This Financial Year' },
  { value: 'last_fiscal_year', label: 'As of End of Last Financial Year' },
  { value: 'custom', label: 'Custom Date' },
]

function formatAmount(value: number | string | undefined | null): string {
  if (value === undefined || value === null) return '₹0.00'
  const n = Number(value)
  const formatted = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `−₹${formatted}` : `₹${formatted}`
}

// ---------------------------------------------------------------- Sub-Category / Account Drawer ----

interface SubCategoryDrawerData {
  subCategoryId: number | null
  categoryId: number
  name: string
  categoryName: string
  total: number
}

function SubCategoryDrawer({
  data,
  filterParams,
  onClose,
}: {
  data: SubCategoryDrawerData | null
  filterParams: {
    period: string
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
    date_to: filterParams.period === 'custom' ? filterParams.dateTo : undefined,
    account: filterParams.account || undefined,
  } : null), [data, filterParams])

  useEffect(() => {
    if (!lineItemParams) return
    let isMounted = true
    setLoading(true)
    setTransactions([])
    balancesheetApi.getLineItemTransactions({ ...lineItemParams, page: 1 }).then((res) => {
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
      const res = await balancesheetApi.getLineItemTransactions({ ...lineItemParams, page: nextPage })
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
          Balance Sheet Account Line Items
        </span>
      }
    >
      <div className="mb-4">
        <h2 className="text-xl font-bold text-ink">{data.name}</h2>
        <p className="mt-1 text-sm text-muted">
          Categorized under <strong className="font-bold">{data.categoryName}</strong>
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface-muted p-4 ">
        <p className="text-xs font-bold uppercase text-muted">STATEMENT PERIOD BALANCE</p>
        <p className="num mt-1 text-[26px] font-semibold text-ink">{formatAmount(data.total)}</p>
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
                <p className="text-sm font-bold text-ink">{formatAmount(t.amount)}</p>
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
            No line-item transactions recorded for this account up to this date.
          </p>
        </div>
      )}
    </Drawer>
  )
}

// ---------------------------------------------------------------- Line-item row (shared by all accordions) ----

function LineItemRow({
  category, valueClassName, onViewSub,
}: {
  category: BalanceSheetReport['assets']['categories'][number]
  valueClassName: string
  onViewSub: (sub: BalanceSheetReport['assets']['categories'][number]['subcategories'][number]) => void
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-bold text-ink">{category.category_name}</span>
        <span className="text-sm font-bold text-ink">{formatAmount(category.total)}</span>
      </div>
      {category.subcategories.map((sub) => (
        <div key={sub.sub_category_id ?? sub.sub_category_name} className="flex items-center justify-between py-1 pl-3">
          <span className="text-xs font-semibold text-muted">{sub.sub_category_name}</span>
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-muted">{formatAmount(sub.amount)}</span>
            <button
              type="button"
              onClick={() => onViewSub(sub)}
              className={`text-xs font-bold hover:underline ${valueClassName}`}
            >
              View
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Balance Sheet Page ----

export default function BalanceSheetPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sectionFilter = searchParams.get('section')?.toUpperCase() // 'ASSETS' | 'LIABILITIES' | 'EQUITY'

  const [selectedAccountName, setSelectedAccountName] = useState<string | null>(null)
  const [account, setAccount] = useState<number | ''>('')
  const [period, setPeriod] = useState<Period>('this_month')
  const [dateTo, setDateTo] = useState('')
  const [report, setReport] = useState<BalanceSheetReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedSubCategory, setSelectedSubCategory] = useState<SubCategoryDrawerData | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // A custom period is fetched only once its "as of" date is picked.
  const awaitingDate = period === 'custom' && !dateTo

  // One request per filter change; a newer selection aborts the one still in flight, so a
  // slow older response can never overwrite the report for the current filters.
  useEffect(() => {
    if (awaitingDate) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    balancesheetApi.getReport({
      period,
      date_to: period === 'custom' ? dateTo : undefined,
      account: account || undefined,
    }, controller.signal)
      .then((data) => { setReport(data); setLoading(false) })
      .catch(() => {
        if (controller.signal.aborted) return
        setError('Failed to load the Balance Sheet report.')
        setLoading(false)
      })
    return () => controller.abort()
  }, [period, dateTo, account, awaitingDate, reloadKey])

  const handlePeriodChange = (value: Period) => {
    if (value === 'custom' && !dateTo) {
      setDateTo(dayjs().format('YYYY-MM-DD'))
    }
    setPeriod(value)
  }

  const pageTitle = sectionFilter === 'ASSETS'
    ? 'Assets Statement'
    : sectionFilter === 'LIABILITIES'
      ? 'Liabilities Statement'
      : sectionFilter === 'EQUITY'
        ? 'Equity & Retained Earnings Statement'
        : 'Balance Sheet'

  // Totals, the difference and the balance check all come from the backend.
  const totalAssets = Number(report?.total_assets || 0)
  const totalLiabilities = Number(report?.liabilities.total || 0)
  const totalEquity = Number(report?.total_equity || 0)
  const totalLiabilitiesAndEquity = Number(report?.total_liabilities_and_equity || 0)
  const difference = Number(report?.difference || 0)
  const isBalanced = report?.is_balanced ?? true

  // Current / Fixed Assets and Current / Long-term Liabilities: the backend says which
  // categories go in each group (report.groups) and gives each group's total.
  type GroupKey = keyof BalanceSheetReport['groups']
  const inGroup = (key: GroupKey, categories: BalanceSheetReport['assets']['categories'] = []) =>
    categories.filter((c) => report?.groups[key].category_ids.includes(c.category_id))
  const groupTotal = (key: GroupKey) => report?.groups[key].total ?? 0
  const currentAssetsCategories = inGroup('current_assets', report?.assets.categories)
  const fixedAssetsCategories = inGroup('fixed_assets', report?.assets.categories)
  const currentLiabilitiesCategories = inGroup('current_liabilities', report?.liabilities.categories)
  const longTermLiabilitiesCategories = inGroup('long_term_liabilities', report?.liabilities.categories)

  const exportOptions = () => {
    const accountName = selectedAccountName || (account ? `Account #${account}` : 'All Bank Accounts')
    const periodLabel = PERIOD_OPTIONS.find((p) => p.value === period)?.label || 'Selected Period'
    const asOfDateText = report?.date_to ? dayjs(report.date_to).format('DD MMM YYYY') : undefined

    return { report: report!, accountName, periodLabel, asOfDateText }
  }
  const handleExportExcel = () => exportBalanceSheetReportToExcel(exportOptions())
  const handleExportPdf = () => exportBalanceSheetReportToPdf(exportOptions())

  return (
    <div className="flex flex-col gap-6">
      {/* PAGE HEADER */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-ink">{pageTitle}</h1>
            {sectionFilter && (
              <Chip tone={sectionFilter === 'ASSETS' ? 'primary' : sectionFilter === 'LIABILITIES' ? 'warning' : 'info'}>
                {sectionFilter}
              </Chip>
            )}
          </div>
          <p className="mt-1.5 max-w-3xl text-[15px] text-muted">
            Financial position summary as of the selected period-end date
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <FinancialPackButton
            filters={{
              period,
              // The Balance Sheet page picks one "as of" date; the pack's P&L and TB run up to it.
              dateFrom: dateTo ? dayjs(dateTo).startOf('month').format('YYYY-MM-DD') : undefined,
              dateTo,
              account,
              accountName: selectedAccountName || (account ? `Account #${account}` : 'All Bank Accounts'),
              periodLabel: PERIOD_OPTIONS.find((p) => p.value === period)?.label.replace(/^As of /, '') || 'Selected Period',
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
      <Panel className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <IconButton title="Refresh Balance Sheet Report" onClick={() => setReloadKey((k) => k + 1)} disabled={loading || awaitingDate}>
            <RefreshCw className="h-4 w-4" />
          </IconButton>

          <Select
            id="period-select"
            label="As of Period"
            value={period}
            onChange={(e) => handlePeriodChange(e.target.value as Period)}
            className="min-w-[200px]"
          >
            {PERIOD_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>

          {period === 'custom' && (
            <DatePicker2 id="bs-date-to" label="As of Date" value={dateTo} onChange={setDateTo} fullWidth={false} className="min-w-[180px]" />
          )}

          <div className="min-w-[240px]">
            <BankAccountSelect label="Bank Account"
              value={account}
              onChange={(id, name) => { setAccount(id ?? ''); setSelectedAccountName(name) }}
            />
          </div>

          {report?.date_to && (
            <Chip tone="primary" variant="outline" className="self-center">
              As of {dayjs(report.date_to).format('DD MMM YYYY')}
            </Chip>
          )}
        </div>
      </Panel>

      {error && <Alert>{error}</Alert>}

      {awaitingDate ? (
        <Panel className="p-12 text-center text-sm font-semibold text-muted">
          Pick the &quot;As of&quot; date for the custom period.
        </Panel>
      ) : loading ? (
        <div className="flex items-center justify-center p-16"><Spinner size={32} /></div>
      ) : report && (
        <>
          {/* TOP SUMMARY CARDS (TOTAL ASSETS, LIABILITIES, EQUITY) */}
          <div className={`mb-6 grid grid-cols-1 gap-4 ${sectionFilter ? '' : 'sm:grid-cols-3'}`}>
            {(!sectionFilter || sectionFilter === 'ASSETS') && (
              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide text-info-text">TOTAL ASSETS</span>
                  <Wallet className="h-6 w-6 text-info-text" />
                </div>
                <p className="num mt-2 text-[26px] font-semibold text-info-text">{formatAmount(totalAssets)}</p>
                <p className="mt-1 text-xs text-muted">Bank, Liquid, &amp; Fixed Asset Balances</p>
              </div>
            )}

            {(!sectionFilter || sectionFilter === 'LIABILITIES') && (
              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide text-caution-text">TOTAL LIABILITIES</span>
                  <CreditCard className="h-6 w-6 text-caution-text" />
                </div>
                <p className="num mt-2 text-[26px] font-semibold text-caution-text">{formatAmount(totalLiabilities)}</p>
                <p className="mt-1 text-xs text-muted">Current &amp; Long-Term Obligations</p>
              </div>
            )}

            {(!sectionFilter || sectionFilter === 'EQUITY') && (
              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide text-equity-text">TOTAL EQUITY</span>
                  <PieChart className="h-6 w-6 text-equity-text" />
                </div>
                <p className="num mt-2 text-[26px] font-semibold text-equity-text">{formatAmount(totalEquity)}</p>
                <p className="mt-1 text-xs text-muted">Capital + Retained Earnings (Profit)</p>
              </div>
            )}
          </div>

          {/* OUT OF BALANCE WARNING BANNER OR BALANCED BANNER */}
          {!isBalanced ? (
            <div className="mb-6 rounded-2xl border-[1.5px] border-warning/40 bg-warning-soft p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <AlertTriangle className="h-6 w-6 text-warning-text" />
                    <h2 className="text-base font-bold text-warning-text">BALANCE SHEET IS OUT OF BALANCE</h2>
                  </div>
                  <p className="max-w-[640px] text-sm text-muted">
                    Some transactions/accounts may be incorrectly categorized or remain uncategorized.
                    The accounting equation <strong className="font-bold">Assets = Liabilities + Equity</strong> is currently not balanced.
                  </p>

                  <div className="mt-3 grid grid-cols-3 gap-4 border-t border-warning/20 pt-3">
                    <div>
                      <p className="text-xs font-semibold text-muted">Assets</p>
                      <p className="text-sm font-bold text-info-text">{formatAmount(totalAssets)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted">Liabilities + Equity</p>
                      <p className="text-sm font-bold text-ink">{formatAmount(totalLiabilitiesAndEquity)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted">Difference</p>
                      <p className="text-sm font-bold text-danger-text">{formatAmount(Math.abs(difference))}</p>
                    </div>
                  </div>
                </div>

                <Button
                  variant="contained"
                  color="warning"
                  endIcon={<ArrowRight className="h-4 w-4" />}
                  onClick={() => navigate('/transactions?uncategorized=true')}
                  className="shrink-0 px-4 py-2"
                >
                  Review Uncategorized Entries
                </Button>
              </div>
            </div>
          ) : (
            <div className="mb-6 rounded-2xl border border-success/40 bg-success-soft p-5 dark:bg-success-soft">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 shrink-0 text-success-text" />
                <div>
                  <p className="text-sm font-bold text-success-text">BALANCE SHEET IS BALANCED</p>
                  <p className="text-sm text-muted">
                    Assets ({formatAmount(totalAssets)}) = Liabilities ({formatAmount(totalLiabilities)}) + Equity ({formatAmount(totalEquity)}) — Difference: ₹0.00
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* MAIN HIERARCHICAL REPORT SECTIONS */}
          <div className={`grid grid-cols-1 gap-5 ${sectionFilter ? '' : 'md:grid-cols-3'}`}>
            {/* 1. ASSETS SECTION */}
            {(!sectionFilter || sectionFilter === 'ASSETS') && (
              <Panel>
                <div className="flex items-center justify-between border-b-2 border-info pb-3">
                  <h2 className="text-base font-bold text-info-text">ASSETS</h2>
                  <span className="text-base font-bold text-info-text">{formatAmount(report.assets.total)}</span>
                </div>

                <div className="mt-4">
                  <Accordion
                    defaultExpanded
                    header={
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-ink">▼ Current Assets</span>
                        <span className="text-sm font-bold text-ink">
                          {formatAmount(groupTotal('current_assets'))}
                        </span>
                      </div>
                    }
                  >
                    {currentAssetsCategories.length === 0 ? (
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted">Cash</span>
                          <span className="text-sm font-semibold text-ink">{formatAmount(report.assets.total)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => navigate('/transactions')}
                          className="mt-1 text-xs font-bold text-violet-700 hover:underline dark:text-violet-300"
                        >
                          View Ledger →
                        </button>
                      </div>
                    ) : (
                      currentAssetsCategories.map((cat) => (
                        <LineItemRow
                          key={cat.category_id}
                          category={cat}
                          valueClassName="text-info-text"
                          onViewSub={(sub) => setSelectedSubCategory({
                            subCategoryId: sub.sub_category_id,
                            categoryId: cat.category_id,
                            name: sub.sub_category_name,
                            categoryName: cat.category_name,
                            total: Number(sub.amount),
                          })}
                        />
                      ))
                    )}
                  </Accordion>

                  <Accordion
                    defaultExpanded
                    header={
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-ink">▼ Fixed Assets</span>
                        <span className="text-sm font-bold text-ink">
                          {formatAmount(groupTotal('fixed_assets'))}
                        </span>
                      </div>
                    }
                  >
                    {fixedAssetsCategories.length === 0 ? (
                      <p className="text-xs italic text-muted">No fixed assets recorded in this period.</p>
                    ) : (
                      fixedAssetsCategories.map((cat) => (
                        <LineItemRow
                          key={cat.category_id}
                          category={cat}
                          valueClassName="text-info-text"
                          onViewSub={(sub) => setSelectedSubCategory({
                            subCategoryId: sub.sub_category_id,
                            categoryId: cat.category_id,
                            name: sub.sub_category_name,
                            categoryName: cat.category_name,
                            total: Number(sub.amount),
                          })}
                        />
                      ))
                    )}
                  </Accordion>
                </div>
              </Panel>
            )}

            {/* 2. LIABILITIES SECTION */}
            {(!sectionFilter || sectionFilter === 'LIABILITIES') && (
              <Panel>
                <div className="flex items-center justify-between border-b-2 border-caution pb-3">
                  <h2 className="text-base font-bold text-caution-text">LIABILITIES</h2>
                  <span className="text-base font-bold text-caution-text">{formatAmount(report.liabilities.total)}</span>
                </div>

                <div className="mt-4">
                  <Accordion
                    defaultExpanded
                    header={
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-ink">▼ Current Liabilities</span>
                        <span className="text-sm font-bold text-ink">
                          {formatAmount(groupTotal('current_liabilities'))}
                        </span>
                      </div>
                    }
                  >
                    {currentLiabilitiesCategories.length === 0 ? (
                      <p className="text-xs italic text-muted">No current liabilities recorded.</p>
                    ) : (
                      currentLiabilitiesCategories.map((cat) => (
                        <LineItemRow
                          key={cat.category_id}
                          category={cat}
                          valueClassName="text-caution-text"
                          onViewSub={(sub) => setSelectedSubCategory({
                            subCategoryId: sub.sub_category_id,
                            categoryId: cat.category_id,
                            name: sub.sub_category_name,
                            categoryName: cat.category_name,
                            total: Number(sub.amount),
                          })}
                        />
                      ))
                    )}
                  </Accordion>

                  <Accordion
                    defaultExpanded
                    header={
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-ink">▼ Other / Long-Term Liabilities</span>
                        <span className="text-sm font-bold text-ink">
                          {formatAmount(groupTotal('long_term_liabilities'))}
                        </span>
                      </div>
                    }
                  >
                    {longTermLiabilitiesCategories.length === 0 ? (
                      <p className="text-xs italic text-muted">No long-term liabilities recorded.</p>
                    ) : (
                      longTermLiabilitiesCategories.map((cat) => (
                        <LineItemRow
                          key={cat.category_id}
                          category={cat}
                          valueClassName="text-caution-text"
                          onViewSub={(sub) => setSelectedSubCategory({
                            subCategoryId: sub.sub_category_id,
                            categoryId: cat.category_id,
                            name: sub.sub_category_name,
                            categoryName: cat.category_name,
                            total: Number(sub.amount),
                          })}
                        />
                      ))
                    )}
                  </Accordion>
                </div>
              </Panel>
            )}

            {/* 3. EQUITY SECTION */}
            {(!sectionFilter || sectionFilter === 'EQUITY') && (
              <Panel>
                <div className="flex items-center justify-between border-b-2 border-equity pb-3">
                  <h2 className="text-base font-bold text-equity-text">EQUITY</h2>
                  <span className="text-base font-bold text-equity-text">{formatAmount(report.total_equity)}</span>
                </div>

                <div className="mt-4 flex flex-col gap-3">
                  {/* Owner's Equity */}
                  <div className="rounded-xl border border-border p-3.5 ">
                    <p className="mb-2 text-sm font-bold text-ink">▼ Owner's Equity</p>
                    {report.equity.categories.length === 0 ? (
                      <p className="text-xs italic text-muted">Owner Capital: ₹0.00</p>
                    ) : (
                      report.equity.categories.map((cat) => (
                        <LineItemRow
                          key={cat.category_id}
                          category={cat}
                          valueClassName="text-equity-text"
                          onViewSub={(sub) => setSelectedSubCategory({
                            subCategoryId: sub.sub_category_id,
                            categoryId: cat.category_id,
                            name: sub.sub_category_name,
                            categoryName: cat.category_name,
                            total: Number(sub.amount),
                          })}
                        />
                      ))
                    )}
                  </div>

                  {/* Retained Earnings (Connected to P&L Net Profit) */}
                  <div className="rounded-xl border border-equity/30 bg-equity-soft p-4 ">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-equity-text">▼ Retained Earnings</span>
                      <span className="text-sm font-bold text-equity-text">{formatAmount(report.retained_earnings)}</span>
                    </div>
                    <hr className="my-2 border-equity/30" />
                    <div className="flex items-center justify-between py-0.5">
                      <div className="flex items-center gap-1.5">
                        <ArrowLeftRight className="h-4 w-4 text-equity-text" />
                        <span className="text-xs font-bold text-ink">Current Period Profit (P&amp;L)</span>
                      </div>
                      <Chip tone={Number(report.retained_earnings) >= 0 ? 'success' : 'error'}>
                        {formatAmount(report.retained_earnings)}
                      </Chip>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('/profit-and-loss')}
                      className="mt-1 text-xs font-semibold text-equity-text hover:underline dark:text-equity-text"
                    >
                      View Profit &amp; Loss Report →
                    </button>
                  </div>

                  {/* Drawings */}
                  <div className="rounded-xl border border-border p-3.5 ">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-ink">▼ Owner Drawings</span>
                      <span className="text-sm font-bold text-ink">₹0.00</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">Identified owner withdrawal entries</p>
                  </div>

                  {/* Uncategorized Balance Notice Box (DO NOT put uncategorized into Drawings) */}
                  {(report.uncategorized_count ?? 0) > 0 && (
                    <div className="rounded-xl border border-dashed border-warning/50 bg-warning-soft p-4">
                      <div className="mb-1 flex items-center gap-1.5">
                        <HelpCircle className="h-5 w-5 text-warning-text" />
                        <span className="text-sm font-bold text-warning-text">
                          Uncategorized Balance ({report.uncategorized_count} entries)
                        </span>
                      </div>
                      <p className="my-1 text-sm font-bold text-warning-text">
                        {formatAmount(report.uncategorized_net_amount)}
                      </p>
                      <p className="mb-2 text-xs text-muted">
                        These transactions have not been assigned to a valid Balance Sheet account.
                      </p>
                      <Button
                        variant="outlined"
                        color="warning"
                        size="sm"
                        endIcon={<ArrowRight className="h-3.5 w-3.5" />}
                        onClick={() => navigate('/transactions?uncategorized=true')}
                      >
                        Review Transactions
                      </Button>
                    </div>
                  )}
                </div>
              </Panel>
            )}
          </div>

          {/* BOTTOM BALANCE CHECK SUMMARY CARD */}
          <div className={`mt-6 rounded-2xl border-[1.5px] p-6 ${isBalanced ? 'border-success/50' : 'border-warning/50'} bg-surface`}>
            <h2 className="mb-4 text-base font-bold text-ink">BALANCE CHECK &amp; SUMMARY</h2>

            <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs font-semibold text-muted">TOTAL ASSETS</p>
                <p className="num text-lg font-semibold text-info-text">{formatAmount(totalAssets)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted">TOTAL LIABILITIES</p>
                <p className="num text-lg font-semibold text-caution-text">{formatAmount(totalLiabilities)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted">TOTAL EQUITY</p>
                <p className="num text-lg font-semibold text-equity-text">{formatAmount(totalEquity)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted">LIABILITIES + EQUITY</p>
                <p className="num text-lg font-semibold text-ink">{formatAmount(totalLiabilitiesAndEquity)}</p>
              </div>
            </div>

            <hr className="mb-4 border-border" />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-ink">BALANCE CHECK DIFFERENCE:</span>
                  <span className={`text-sm font-bold ${isBalanced ? 'text-success-text' : 'text-danger-text'}`}>
                    {formatAmount(difference)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {isBalanced
                    ? 'Balanced: Assets equal Liabilities plus Equity.'
                    : 'Transactions still need review before this report can be considered complete.'}
                </p>
              </div>

              <Button
                variant={isBalanced ? 'outlined' : 'contained'}
                color={isBalanced ? 'success' : 'warning'}
                endIcon={<ArrowRight className="h-4 w-4" />}
                onClick={() => navigate('/transactions')}
              >
                {isBalanced ? 'View Transactions' : 'Review Accounting Entries'}
              </Button>
            </div>
          </div>

          {/* SUB-CATEGORY / ACCOUNT LINE ITEMS DRAWER */}
          <SubCategoryDrawer
            data={selectedSubCategory}
            filterParams={{ period, dateTo, account }}
            onClose={() => setSelectedSubCategory(null)}
          />
        </>
      )}
    </div>
  )
}
