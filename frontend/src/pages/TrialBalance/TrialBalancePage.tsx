import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
  Scale, RefreshCw, CheckCircle2, AlertTriangle, ArrowRight,
} from 'lucide-react'
import { trialBalanceApi } from './trialbalanceapi'
import type { TrialBalanceReport, TrialBalanceItem } from '../../types'
import {
  Button, Panel, Select, Chip, Spinner, Alert, IconButton,
} from '../../components/tw'
import BankAccountSelect from '../../components/BankAccountSelect'
import DatePicker2 from '../../components/DatePicker2'
import { exportTrialBalanceReportToExcel } from '../../utils/excelExport'
import { exportTrialBalanceReportToPdf } from '../../utils/pdfExport'
import { ReportExportButtons, FinancialPackButton } from '../../components/ReportExport'

type Period = 'this_month' | 'last_month' | 'this_quarter' | 'this_fiscal_year' | 'last_fiscal_year' | 'custom'

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'this_fiscal_year', label: 'This Financial Year' },
  { value: 'last_fiscal_year', label: 'Last Financial Year' },
  { value: 'custom', label: 'Custom Date Range' },
]

const ACCOUNT_TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  ASSET: { label: 'Asset Accounts', color: 'text-primary', bg: 'border-violet-500' },
  LIABILITY: { label: 'Liability Accounts', color: 'text-warning-text', bg: 'border-warning/40' },
  EQUITY: { label: 'Equity Accounts', color: 'text-info-text', bg: 'border-info/40' },
  INCOME: { label: 'Revenue / Income Accounts', color: 'text-success-text', bg: 'border-success/40' },
  EXPENSE: { label: 'Expense Accounts', color: 'text-danger-text', bg: 'border-danger-border' },
}

function formatAmount(value: number | string | undefined | null): string {
  if (value === undefined || value === null) return '₹0.00'
  const n = Number(value)
  const formatted = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `−₹${formatted}` : `₹${formatted}`
}

export default function TrialBalancePage() {
  const navigate = useNavigate()

  const [selectedAccountName, setSelectedAccountName] = useState<string | null>(null)
  const [account, setAccount] = useState<number | ''>('')
  const [period, setPeriod] = useState<Period>('this_month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [report, setReport] = useState<TrialBalanceReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [reloadKey, setReloadKey] = useState(0)

  // A custom range is fetched only once both dates are picked.
  const awaitingDates = period === 'custom' && (!dateFrom || !dateTo)

  // One request per filter change; a newer selection aborts the one still in flight, so a
  // slow older response can never overwrite the report for the current filters.
  useEffect(() => {
    if (awaitingDates) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    trialBalanceApi.trialBalance({
      period,
      date_from: period === 'custom' ? dateFrom : undefined,
      date_to: period === 'custom' ? dateTo : undefined,
      account: account || undefined,
    }, controller.signal)
      .then((data) => { setReport(data); setLoading(false) })
      .catch(() => {
        if (controller.signal.aborted) return
        setError('Failed to load Trial Balance report.')
        setLoading(false)
      })
    return () => controller.abort()
  }, [period, dateFrom, dateTo, account, awaitingDates, reloadKey])

  const handlePeriodChange = (value: Period) => {
    if (value === 'custom' && (!dateFrom || !dateTo)) {
      setDateFrom(dayjs().startOf('month').format('YYYY-MM-DD'))
      setDateTo(dayjs().format('YYYY-MM-DD'))
    }
    setPeriod(value)
  }

  // Totals, the difference and the balance check all come from the backend.
  const totalDebit = Number(report?.total_debit || 0)
  const totalCredit = Number(report?.total_credit || 0)
  const difference = Number(report?.difference || 0)
  const isBalanced = report?.is_balanced ?? true

  const exportOptions = () => {
    const accountName = selectedAccountName || (account ? `Account #${account}` : 'All Bank Accounts')
    const periodLabel = PERIOD_OPTIONS.find((p) => p.value === period)?.label || 'Selected Period'
    const dateRangeText = report.date_from && report.date_to
      ? `${dayjs(report.date_from).format('DD MMM YYYY')} – ${dayjs(report.date_to).format('DD MMM YYYY')}`
      : undefined

    return { report: report!, accountName, periodLabel, dateRangeText }
  }
  const handleExportExcel = () => exportTrialBalanceReportToExcel(exportOptions())
  const handleExportPdf = () => exportTrialBalanceReportToPdf(exportOptions())

  return (
    <div className="flex flex-col gap-6">
      {/* PAGE HEADER */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-ink">Trial Balance Report</h1>
            <Chip tone={isBalanced ? 'success' : 'warning'}>
              {isBalanced ? 'Balanced' : 'Out of Balance'}
            </Chip>
          </div>
          <p className="mt-1.5 max-w-3xl text-[15px] text-muted">
            Summary of all Chart of Accounts debit and credit balances verifying double-entry equilibrium
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
      <Panel className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <IconButton title="Refresh Report" onClick={() => setReloadKey((k) => k + 1)} disabled={loading || awaitingDates}>
            <RefreshCw className="h-4 w-4" />
          </IconButton>

          <Select
            id="tb-period-select"
            label="Report Period"
            value={period}
            onChange={(e) => handlePeriodChange(e.target.value as Period)}
            className="min-w-[180px]"
          >
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </Select>

          {period === 'custom' && (
            <>
              <DatePicker2 id="tb-date-from" label="From Date" value={dateFrom} onChange={setDateFrom} fullWidth={false} className="min-w-[160px]" />
              <DatePicker2 id="tb-date-to" label="To Date" value={dateTo} onChange={setDateTo} fullWidth={false} className="min-w-[160px]" />
            </>
          )}

          <div className="min-w-[240px]">
            <BankAccountSelect label="Bank Account"
              value={account}
              onChange={(id, name) => { setAccount(id ?? ''); setSelectedAccountName(name) }}
            />
          </div>

          {report?.date_from && report?.date_to && (
            <Chip tone="primary" variant="outline" className="self-center">
              {dayjs(report.date_from).format('DD MMM YYYY')} – {dayjs(report.date_to).format('DD MMM YYYY')}
            </Chip>
          )}
        </div>
      </Panel>

      {error && <Alert>{error}</Alert>}

      {awaitingDates ? (
        <Panel className="p-12 text-center text-sm font-semibold text-muted">
          Pick both a From and a To date for the custom range.
        </Panel>
      ) : loading ? (
        <div className="flex items-center justify-center p-16">
          <Spinner size={32} />
        </div>
      ) : report && (
        <>
          {/* TOP SUMMARY CARDS */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-primary">TOTAL DEBITS</span>
                <Scale className="h-6 w-6 text-primary" />
              </div>
              <p className="num mt-2 text-[26px] font-semibold text-ink">{formatAmount(totalDebit)}</p>
              <p className="mt-1 text-xs text-muted">Sum of all debit account balances</p>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-success-text">TOTAL CREDITS</span>
                <Scale className="h-6 w-6 text-success-text" />
              </div>
              <p className="num mt-2 text-[26px] font-semibold text-ink">{formatAmount(totalCredit)}</p>
              <p className="mt-1 text-xs text-muted">Sum of all credit account balances</p>
            </div>

            <div className={`rounded-2xl border ${isBalanced ? 'border-success/40 bg-success-soft dark:bg-success-soft' : 'border-warning/40 bg-warning-soft dark:bg-warning-soft'} p-5`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-ink">DIFFERENCE</span>
                {isBalanced ? (
                  <CheckCircle2 className="h-6 w-6 text-success-text" />
                ) : (
                  <AlertTriangle className="h-6 w-6 text-warning-text" />
                )}
              </div>
              <p className={`mt-2 text-3xl font-bold ${isBalanced ? 'text-success-text' : 'text-warning-text'}`}>
                {formatAmount(difference)}
              </p>
              <p className="mt-1 text-xs text-muted">
                {isBalanced ? 'Debits & Credits are equal' : 'Out of balance equation'}
              </p>
            </div>
          </div>

          {/* UNBALANCED WARNING BANNER */}
          {!isBalanced && (
            <div className="mb-6 rounded-2xl border-[1.5px] border-warning/40 bg-warning-soft p-5 dark:bg-warning-soft flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-6 w-6 shrink-0 text-warning-text" />
                <div>
                  <p className="text-sm font-bold text-warning-text">Trial Balance is Out of Balance</p>
                  <p className="text-xs text-muted">
                    Uncategorized or unconfirmed transactions exist ({report.uncategorized_count} entries). Assign category to equalize debits and credits.
                  </p>
                </div>
              </div>
              <Button
                variant="contained"
                color="warning"
                endIcon={<ArrowRight className="h-4 w-4" />}
                onClick={() => navigate('/transactions?uncategorized=true')}
                className="shrink-0"
              >
                Review Uncategorized Entries
              </Button>
            </div>
          )}

          {/* TRIAL BALANCE TABLE BY ACCOUNT TYPE */}
          <div className="space-y-6">
            {Object.entries(report.account_types).map(([acctType, items]) => {
              const meta = ACCOUNT_TYPE_LABELS[acctType] || { label: acctType, color: 'text-slate-900', bg: 'border-slate-300' }
              const subTotalDebit = Number(report.type_totals[acctType as keyof typeof report.type_totals]?.debit ?? 0)
              const subTotalCredit = Number(report.type_totals[acctType as keyof typeof report.type_totals]?.credit ?? 0)

              return (
                <Panel key={acctType} className="overflow-hidden p-0">
                  <div className={`flex items-center justify-between border-b-2 ${meta.bg} px-6 py-4 bg-surface-muted `}>
                    <h2 className={`text-base font-bold ${meta.color}`}>{meta.label}</h2>
                    <div className="flex gap-6 text-sm font-bold">
                      <span className="text-ink">Debit: {formatAmount(subTotalDebit)}</span>
                      <span className="text-ink">Credit: {formatAmount(subTotalCredit)}</span>
                    </div>
                  </div>

                  {items.length === 0 ? (
                    <div className="p-6 text-center text-sm italic text-muted">
                      No categorized transactions recorded for {meta.label.toLowerCase()} in this period.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="border-b border-border bg-slate-100/50 text-xs uppercase font-bold text-slate-500 dark:bg-white/5 dark:text-muted">
                          <tr>
                            <th className="px-6 py-3">Category</th>
                            <th className="px-6 py-3">Sub-Category</th>
                            <th className="px-6 py-3 text-right">Debit Balance</th>
                            <th className="px-6 py-3 text-right">Credit Balance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {items.map((item: TrialBalanceItem, idx: number) => (
                            <tr key={`${item.category_id}-${item.sub_category_id}-${idx}`} className="hover:bg-surface-muted">
                              <td className="px-6 py-3.5 font-bold text-ink">{item.category_name}</td>
                              <td className="px-6 py-3.5 font-semibold text-muted">{item.sub_category_name}</td>
                              <td className="px-6 py-3.5 text-right font-bold text-primary">
                                {Number(item.debit) > 0 ? formatAmount(item.debit) : '—'}
                              </td>
                              <td className="px-6 py-3.5 text-right font-bold text-success-text">
                                {Number(item.credit) > 0 ? formatAmount(item.credit) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t-2 border-border bg-slate-50 font-bold dark:bg-slate-900/60">
                          <tr>
                            <td colSpan={2} className="px-6 py-3 text-xs uppercase tracking-wider text-muted">
                              Subtotal — {meta.label}
                            </td>
                            <td className="px-6 py-3 text-right text-primary">{formatAmount(subTotalDebit)}</td>
                            <td className="px-6 py-3 text-right text-success-text">{formatAmount(subTotalCredit)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </Panel>
              )
            })}
          </div>

          {/* FINAL GRAND TOTAL FOOTER */}
          <Panel className="mt-6 border-2 border-input p-6 ">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-bold text-ink">GRAND TOTALS SUMMARY</h3>
                <p className="text-xs text-muted">
                  Equilibrium: {isBalanced ? 'Balanced (Total Debits = Total Credits)' : `Unbalanced by ${formatAmount(difference)}`}
                </p>
              </div>
              <div className="flex items-center gap-8 text-base font-bold">
                <div className="text-right">
                  <span className="block text-xs uppercase text-muted">Grand Total Debit</span>
                  <span className="text-ink">{formatAmount(totalDebit)}</span>
                </div>
                <div className="text-right">
                  <span className="block text-xs uppercase text-muted">Grand Total Credit</span>
                  <span className="text-ink">{formatAmount(totalCredit)}</span>
                </div>
              </div>
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}
