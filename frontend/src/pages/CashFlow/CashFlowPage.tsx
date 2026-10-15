import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, RefreshCw, Wallet } from 'lucide-react'
import { cashFlowApi, type CashFlowLine, type CashFlowReport } from './cashflowapi'
import { Alert, Button, Chip, IconButton, Panel, Select, Spinner } from '../../components/tw'
import BankAccountSelect from '../../components/BankAccountSelect'
import DatePicker2 from '../../components/DatePicker2'
import { useAuth } from '../../context/AuthContext'
import { exportToExcel } from '../../utils/excelExport'
import { exportTableToPdf } from '../../utils/pdfExport'
import { ReportExportButtons } from '../../components/ReportExport'
import { REPORT_PERIOD_OPTIONS, formatMoney, type ReportPeriod } from '../../utils/periods'

const SECTION_HINTS: Record<string, string> = {
  operating: 'Income and expense accounts - the day-to-day business',
  investing: 'Asset accounts - equipment, investments, deposits',
  financing: 'Liability and equity accounts - loans, owner capital, drawings',
}

const netClass = (value: number | string) =>
  Number(value) < 0 ? 'text-danger-text' : 'text-success-text'

/** Cash Flow Statement (direct method) built from the categorized bank transactions. */
export default function CashFlowPage() {
  const navigate = useNavigate()
  const { hasPage } = useAuth()
  const [period, setPeriod] = useState<ReportPeriod>('this_month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [account, setAccount] = useState<number | ''>('')
  const [accountName, setAccountName] = useState<string | null>(null)
  const [report, setReport] = useState<CashFlowReport | null>(null)
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
    cashFlowApi.get({
      period,
      date_from: period === 'custom' ? dateFrom : undefined,
      date_to: period === 'custom' ? dateTo : undefined,
      account: account || undefined,
    }, controller.signal)
      .then((data) => { setReport(data); setLoading(false) })
      .catch(() => {
        if (controller.signal.aborted) return
        setError('Failed to load the Cash Flow Statement.')
        setLoading(false)
      })
    return () => controller.abort()
  }, [period, dateFrom, dateTo, account, awaitingDates, reloadKey])

  const changePeriod = (value: ReportPeriod) => {
    if (value === 'custom' && (!dateFrom || !dateTo)) {
      setDateFrom(dayjs().startOf('month').format('YYYY-MM-DD'))
      setDateTo(dayjs().format('YYYY-MM-DD'))
    }
    setPeriod(value)
  }

  const canOpenLedger = hasPage('account_ledger')
  const openLedger = (line: CashFlowLine) => {
    if (!canOpenLedger || !line.sub_category_id || !report) return
    const params = new URLSearchParams({ sub_category: String(line.sub_category_id), period: 'custom' })
    if (report.date_from) params.set('date_from', report.date_from)
    if (report.date_to) params.set('date_to', report.date_to)
    if (!report.date_from && !report.date_to) params.set('period', 'all_time')
    navigate(`/account-ledger?${params.toString()}`)
  }

  const rangeText = report?.date_from && report?.date_to
    ? `${dayjs(report.date_from).format('DD MMM YYYY')} – ${dayjs(report.date_to).format('DD MMM YYYY')}`
    : 'All dates'

  const exportData = () => {
    if (!report) return { rows: [], columns: [] }
    const rows: Record<string, string | number>[] = [
      { section: 'Cash at beginning of period', net: Number(report.opening_cash) },
    ]
    for (const section of report.sections) {
      for (const line of section.lines) {
        rows.push({
          section: section.label, category: line.category_name, sub_category: line.sub_category_name,
          inflow: Number(line.inflow), outflow: Number(line.outflow), net: Number(line.net),
        })
      }
      rows.push({ section: `Net cash from ${section.label.toLowerCase()}`, inflow: Number(section.inflow), outflow: Number(section.outflow), net: Number(section.net) })
    }
    rows.push(
      { section: 'Transfers between own accounts (net)', net: Number(report.transfers_net) },
      { section: 'Uncategorized / needs review (net)', net: Number(report.uncategorized_net) },
      { section: 'Net change in cash', net: Number(report.net_change) },
      { section: 'Cash at end of period', net: Number(report.closing_cash) },
    )
    const columns = [
      { header: `Cash Flow Statement — ${rangeText}`, key: 'section', width: 44 },
      { header: 'Category', key: 'category', width: 26 },
      { header: 'Sub-Category', key: 'sub_category', width: 26 },
      { header: 'Money In', key: 'inflow', width: 16 },
      { header: 'Money Out', key: 'outflow', width: 16 },
      { header: 'Net', key: 'net', width: 16 },
    ]
    return { rows, columns }
  }
  const exportBaseName = () => `Cash_Flow_${(accountName || 'All_Accounts').replace(/\W+/g, '_')}_${period}`
  const handleExport = async () => {
    const { rows, columns } = exportData()
    await exportToExcel(`${exportBaseName()}.xlsx`, 'Cash Flow', columns, rows)
  }
  const handleExportPdf = async () => {
    const { rows, columns } = exportData()
    await exportTableToPdf(
      `${exportBaseName()}.pdf`,
      'Cash Flow Statement',
      [['Bank Account', accountName || 'All Bank Accounts'], ['Period', rangeText]],
      [{ ...columns[0], header: 'Section' }, ...columns.slice(1)],
      rows,
      {
        amountKeys: ['inflow', 'outflow', 'net'],
        // Lines carry a category; everything else is an opening / subtotal / closing line.
        rowStyle: (r) => (r.category ? 'normal' : String(r.section).startsWith('Cash at end') ? 'grand' : 'total'),
        landscape: true,
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-ink">Cash Flow Statement</h1>
          <p className="mt-1.5 max-w-3xl text-[15px] text-muted">
            Where the money in the bank came from and went to - operating, investing and financing activities
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReportExportButtons onExcel={handleExport} onPdf={handleExportPdf} disabled={!report} onError={setError} />
        </div>
      </div>

      <Panel className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <IconButton title="Refresh" onClick={() => setReloadKey((k) => k + 1)} disabled={loading || awaitingDates}>
            <RefreshCw className="h-4 w-4" />
          </IconButton>
          <Select id="cf-period" label="Report Period" value={period} onChange={(e) => changePeriod(e.target.value as ReportPeriod)} className="min-w-[180px]">
            {REPORT_PERIOD_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
          {period === 'custom' && (
            <>
              <DatePicker2 id="cf-from" label="From Date" value={dateFrom} onChange={(d: string) => setDateFrom(d)} fullWidth={false} className="min-w-[160px]" />
              <DatePicker2 id="cf-to" label="To Date" value={dateTo} onChange={(d: string) => setDateTo(d)} fullWidth={false} className="min-w-[160px]" />
            </>
          )}
          <div className="min-w-[240px]">
            <BankAccountSelect value={account} onChange={(id, name) => { setAccount(id ?? ''); setAccountName(name) }} />
          </div>
          {report && <Chip tone="primary" variant="outline" className="mb-2">{rangeText}</Chip>}
        </div>
      </Panel>

      {error && <Alert>{error}</Alert>}

      {awaitingDates ? (
        <Panel className="p-12 text-center text-sm font-semibold text-muted">
          Pick both a From and a To date for the custom range.
        </Panel>
      ) : loading ? (
        <div className="flex items-center justify-center p-16"><Spinner size={32} /></div>
      ) : report && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              { label: 'Cash at Beginning', value: report.opening_cash, icon: <Wallet className="h-6 w-6 text-muted" />, hint: 'Per bank statements' },
              { label: 'Net Change in Cash', value: report.net_change, icon: Number(report.net_change) < 0 ? <ArrowDownLeft className="h-6 w-6 text-rose-500" /> : <ArrowUpRight className="h-6 w-6 text-emerald-500" />, hint: 'Money in minus money out' },
              { label: 'Cash at End', value: report.closing_cash, icon: <Wallet className="h-6 w-6 text-violet-500" />, hint: 'Beginning + net change' },
            ].map((card) => (
              <div key={card.label} className="rounded-2xl border border-border bg-surface p-5 ">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">{card.label}</span>
                  {card.icon}
                </div>
                <p className="num mt-2 text-[26px] font-semibold text-ink">{formatMoney(card.value)}</p>
                <p className="mt-1 text-xs text-muted">{card.hint}</p>
              </div>
            ))}
          </div>

          {report.uncategorized_count > 0 && (
            <div className="mb-6 flex flex-col items-start justify-between gap-3 rounded-2xl border border-warning/40 bg-warning-soft p-4 sm:flex-row sm:items-center dark:bg-warning-soft">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 shrink-0 text-warning-text" />
                <p className="text-sm text-warning-text">
                  {report.uncategorized_count} bank transaction{report.uncategorized_count === 1 ? ' is' : 's are'} not in the books yet
                  ({formatMoney(report.uncategorized_net)} net) - categorize and finalize them (or match them in Bank Reconciliation) to include them.
                </p>
              </div>
              {hasPage('transactions') && (
                <Button variant="outlined" color="warning" onClick={() => navigate('/transactions?uncategorized=true')}>Review</Button>
              )}
            </div>
          )}

          <div className="space-y-6">
            {report.sections.map((section) => (
              <Panel key={section.key} className="overflow-hidden p-0">
                <div className="flex flex-col gap-1 border-b border-border bg-surface-muted px-6 py-4 sm:flex-row sm:items-center sm:justify-between ">
                  <div>
                    <h2 className="text-base font-bold text-ink">{section.label}</h2>
                    <p className="text-xs text-muted">{SECTION_HINTS[section.key]}</p>
                  </div>
                  <span className={`text-lg font-bold ${netClass(section.net)}`}>{formatMoney(section.net)}</span>
                </div>
                {section.lines.length === 0 ? (
                  <div className="p-6 text-center text-sm italic text-muted">No cash movement in this period.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-border bg-slate-100/50 text-xs font-bold uppercase text-slate-500 dark:bg-white/5 dark:text-muted">
                        <tr>
                          <th className="px-6 py-3">Category</th>
                          <th className="px-6 py-3">Account</th>
                          <th className="px-6 py-3 text-right">Money In</th>
                          <th className="px-6 py-3 text-right">Money Out</th>
                          <th className="px-6 py-3 text-right">Net</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {section.lines.map((line) => (
                          <tr
                            key={`${line.category_id}-${line.sub_category_id}`}
                            onClick={() => openLedger(line)}
                            className={`hover:bg-surface-muted ${canOpenLedger && line.sub_category_id ? 'cursor-pointer' : ''}`}
                            title={canOpenLedger && line.sub_category_id ? 'Open this account\'s ledger' : undefined}
                          >
                            <td className="px-6 py-3 font-bold text-ink">{line.category_name}</td>
                            <td className="px-6 py-3 font-semibold text-muted">{line.sub_category_name}</td>
                            <td className="px-6 py-3 text-right text-success-text">{Number(line.inflow) ? formatMoney(line.inflow) : '—'}</td>
                            <td className="px-6 py-3 text-right text-danger-text">{Number(line.outflow) ? formatMoney(line.outflow) : '—'}</td>
                            <td className={`px-6 py-3 text-right font-bold ${netClass(line.net)}`}>{formatMoney(line.net)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t-2 border-border bg-slate-50 font-bold dark:bg-slate-900/60">
                        <tr>
                          <td colSpan={2} className="px-6 py-3 text-xs uppercase tracking-wider text-slate-500">Net cash from {section.label.toLowerCase()}</td>
                          <td className="px-6 py-3 text-right text-success-text">{formatMoney(section.inflow)}</td>
                          <td className="px-6 py-3 text-right text-danger-text">{formatMoney(section.outflow)}</td>
                          <td className={`px-6 py-3 text-right ${netClass(section.net)}`}>{formatMoney(section.net)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </Panel>
            ))}
          </div>

          <Panel className="mt-6 border-2 border-input p-0 ">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {[
                  { label: 'Cash at beginning of period', value: report.opening_cash },
                  ...report.sections.map((s) => ({ label: `Net cash from ${s.label.toLowerCase()}`, value: s.net })),
                  { label: `Transfers between own accounts (${report.transfers_count} transaction${report.transfers_count === 1 ? '' : 's'})`, value: report.transfers_net },
                ].map((row) => (
                  <tr key={row.label}>
                    <td className="px-6 py-3 text-muted">{row.label}</td>
                    <td className="px-6 py-3 text-right font-semibold text-ink">{formatMoney(row.value)}</td>
                  </tr>
                ))}
                <tr className="bg-surface-muted/60">
                  <td className="px-6 py-4 text-base font-bold text-ink">Cash at end of period</td>
                  <td className="px-6 py-4 text-right text-base font-bold text-ink">{formatMoney(report.closing_cash)}</td>
                </tr>
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  )
}
