import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Landmark, ReceiptIndianRupee, RefreshCw, Scissors, Wallet } from 'lucide-react'
import { Alert, Button, IconButton, Panel, Select, Spinner, Tabs } from '../../components/tw'
import { EmptyState, KpiTile, PageHeader } from '../../components/PageParts'
import DatePicker2 from '../../components/DatePicker2'
import { REPORT_PERIOD_OPTIONS, formatMoney, type ReportPeriod } from '../../utils/periods'
import { errorText, tdsApi } from '../Billing/billingapi'
import type { GstParams, TdsSummary } from '../Billing/billingapi'
import { TABLE_HEAD_ROW, TABLE_ROW, TD, TH, formatDate } from '../Billing/billingParts'

type View = 'sections' | 'suppliers' | 'bills'

const NUM = `${TD} num text-right`

/** TDS kept back on posted supplier bills, by section and by supplier (with PAN) - the figures for the
 * quarterly TDS return - and how much of it has been paid to the government. */
export default function TdsSummaryPage() {
  const [period, setPeriod] = useState<ReportPeriod>('last_month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [view, setView] = useState<View>('sections')
  const [report, setReport] = useState<TdsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const awaitingDates = period === 'custom' && (!dateFrom || !dateTo)
  const params: GstParams = { period, ...(period === 'custom' ? { date_from: dateFrom, date_to: dateTo } : {}) }

  useEffect(() => {
    if (awaitingDates) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    tdsApi.summary(params, controller.signal)
      .then((data) => { setReport(data); setLoading(false) })
      .catch((err) => {
        if (controller.signal.aborted) return
        setError(errorText(err, 'Failed to load the TDS summary.'))
        setLoading(false)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, dateFrom, dateTo, reloadKey, awaitingDates])

  const exportCsv = async () => {
    try {
      const blob = await tdsApi.exportCsv(params)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tds_summary_${report?.date_from ?? period}_${report?.date_to ?? ''}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(errorText(err, 'Failed to export.'))
    }
  }

  const range = report?.date_from ? `${formatDate(report.date_from)} – ${formatDate(report.date_to)}` : 'All time'
  const missingPan = report?.by_supplier.filter((s) => !s.pan).length ?? 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="TDS Summary"
        description="Tax deducted at source on supplier bills, by section and by supplier, and what has been paid to the government. Only posted bills count."
        actions={<>
          <div className="min-w-[200px]">
            <Select id="tds-period" value={period} onChange={(e) => setPeriod(e.target.value as ReportPeriod)}>
              {REPORT_PERIOD_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </div>
          {period === 'custom' && <>
            <DatePicker2 id="tds-from" label="" value={dateFrom} onChange={setDateFrom} fullWidth={false} className="min-w-[150px]" />
            <DatePicker2 id="tds-to" label="" value={dateTo} onChange={setDateTo} fullWidth={false} className="min-w-[150px]" />
          </>}
          <Button variant="outlined" icon={<Download />} onClick={exportCsv} disabled={!report}>Export CSV</Button>
          <IconButton title="Refresh" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
            <RefreshCw className={`h-[18px] w-[18px] stroke-[1.8] ${loading ? 'animate-spin' : ''}`} />
          </IconButton>
        </>}
      />

      {error && <Alert>{error}</Alert>}
      {missingPan > 0 && (
        <div className="rounded-xl bg-warning-soft px-4 py-3 text-sm font-medium text-warning-text">
          {missingPan} supplier{missingPan > 1 ? 's have' : ' has'} no PAN - the return needs it. Add it on
          the <Link to="/suppliers" className="font-bold underline">Suppliers</Link> page.
        </div>
      )}

      {awaitingDates ? (
        <Panel><EmptyState icon={<ReceiptIndianRupee />} title="Pick both dates of the custom range." /></Panel>
      ) : loading && !report ? (
        <div className="flex justify-center p-16"><Spinner size={32} /></div>
      ) : report && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiTile tone="info" icon={<Scissors />} label="TDS kept back" value={formatMoney(report.total_deducted)}
              caption={`On ${formatMoney(report.total_taxable)} of bills · ${range}`} />
            <KpiTile tone="success" icon={<Landmark />} label="Paid to the government" value={formatMoney(report.books.paid)}
              caption="Debits to the TDS accounts in the period" />
            <KpiTile dark icon={<Wallet />} label="Still to pay" value={formatMoney(report.outstanding)}
              caption="Balance of the TDS accounts at the end of the period" />
          </div>

          <div>
            <Tabs<View> value={view} onChange={setView} options={[
              { value: 'sections', label: 'By section' },
              { value: 'suppliers', label: 'By supplier' },
              { value: 'bills', label: `Bills (${report.bills.length})` },
            ]} />
          </div>

          <Panel className="overflow-hidden p-0">
            {report.bills.length === 0 ? (
              <EmptyState icon={<ReceiptIndianRupee />} title="No TDS on posted bills in this period."
                text="Give a supplier a default TDS section, or pick one on the bill, and post it." />
            ) : (
              <div className="overflow-x-auto">
                {view === 'sections' && (
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className={TABLE_HEAD_ROW}>
                        <th className={TH}>Section</th>
                        <th className={`${TH} text-right`}>Rate</th>
                        <th className={`${TH} text-right`}>Bills</th>
                        <th className={`${TH} text-right`}>Taxable value</th>
                        <th className={`${TH} text-right`}>TDS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.by_section.map((s) => (
                        <tr key={s.section} className={TABLE_ROW}>
                          <td className={TD}><span className="num font-semibold">{s.code}</span> <span className="text-muted">· {s.name}</span></td>
                          <td className={NUM}>{Number(s.rate)}%</td>
                          <td className={NUM}>{s.bills}</td>
                          <td className={NUM}>{formatMoney(s.taxable)}</td>
                          <td className={`${NUM} font-semibold`}>{formatMoney(s.tds)}</td>
                        </tr>
                      ))}
                      <tr className="bg-surface-muted font-bold">
                        <td className={TD} colSpan={3}>Total</td>
                        <td className={NUM}>{formatMoney(report.total_taxable)}</td>
                        <td className={NUM}>{formatMoney(report.total_deducted)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}

                {view === 'suppliers' && (
                  <table className="w-full min-w-[720px] border-collapse text-sm">
                    <thead>
                      <tr className={TABLE_HEAD_ROW}>
                        <th className={TH}>Supplier</th>
                        <th className={TH}>PAN</th>
                        <th className={TH}>Section</th>
                        <th className={`${TH} text-right`}>Bills</th>
                        <th className={`${TH} text-right`}>Taxable value</th>
                        <th className={`${TH} text-right`}>TDS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.by_supplier.map((s) => (
                        <tr key={`${s.supplier}-${s.section_code}`} className={TABLE_ROW}>
                          <td className={`${TD} font-semibold`}>{s.supplier_name}</td>
                          <td className={`${TD} num`}>{s.pan || <span className="font-sans font-semibold text-danger-text">Missing</span>}</td>
                          <td className={`${TD} num`}>{s.section_code}</td>
                          <td className={NUM}>{s.bills}</td>
                          <td className={NUM}>{formatMoney(s.taxable)}</td>
                          <td className={`${NUM} font-semibold`}>{formatMoney(s.tds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {view === 'bills' && (
                  <table className="w-full min-w-[880px] border-collapse text-sm">
                    <thead>
                      <tr className={TABLE_HEAD_ROW}>
                        <th className={TH}>Bill</th>
                        <th className={TH}>Date</th>
                        <th className={TH}>Supplier</th>
                        <th className={TH}>Section</th>
                        <th className={`${TH} text-right`}>Rate</th>
                        <th className={`${TH} text-right`}>Taxable value</th>
                        <th className={`${TH} text-right`}>TDS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.bills.map((b) => (
                        <tr key={b.id} className={TABLE_ROW}>
                          <td className={`${TD} num font-semibold`}>{b.bill_number}</td>
                          <td className={`${TD} whitespace-nowrap`}>{formatDate(b.bill_date)}</td>
                          <td className={TD}>
                            <p>{b.supplier_name}</p>
                            {b.pan && <p className="num text-xs text-muted">{b.pan}</p>}
                          </td>
                          <td className={`${TD} num`}>{b.section_code}</td>
                          <td className={NUM}>{Number(b.rate)}%</td>
                          <td className={NUM}>{formatMoney(b.taxable)}</td>
                          <td className={`${NUM} font-semibold`}>{formatMoney(b.tds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
            <p className="border-t border-border-soft px-6 py-3 text-xs text-muted">
              Record a payment to the government as a journal entry: Dr TDS Payable / Cr Bank. Credited in the books this
              period (incl. manual entries): {formatMoney(report.books.credited)}.
            </p>
          </Panel>
        </>
      )}
    </div>
  )
}
