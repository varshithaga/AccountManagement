import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Download, Percent, RefreshCw, Scale } from 'lucide-react'
import { Alert, Button, IconButton, Panel, Select, Spinner, Tabs } from '../../components/tw'
import { EmptyState, KpiTile, PageHeader } from '../../components/PageParts'
import DatePicker2 from '../../components/DatePicker2'
import { REPORT_PERIOD_OPTIONS, formatMoney, type ReportPeriod } from '../../utils/periods'
import { errorText, gstApi } from '../Billing/billingapi'
import type { GstDocument, GstParams, GstRateRow, GstSummary, GstTotals } from '../Billing/billingapi'
import { TABLE_HEAD_ROW, TABLE_ROW, TD, TH, formatDate } from '../Billing/billingParts'

type View = 'rates' | 'supplies' | 'hsn' | 'documents'

const KIND_LABEL: Record<GstDocument['kind'], string> = {
  INVOICE: 'Invoice', CREDIT_NOTE: 'Credit note', BILL: 'Bill', DEBIT_NOTE: 'Debit note',
}

const NUM = `${TD} num text-right`

/** Output GST on sales, input tax credit on purchases and the net payable for a period - the
 * figures for GSTR-1 and GSTR-3B. Only posted documents count; notes count in their own month. */
export default function GstSummaryPage() {
  const [period, setPeriod] = useState<ReportPeriod>('last_month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [view, setView] = useState<View>('rates')
  const [report, setReport] = useState<GstSummary | null>(null)
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
    gstApi.summary(params, controller.signal)
      .then((data) => { setReport(data); setLoading(false) })
      .catch((err) => {
        if (controller.signal.aborted) return
        setError(errorText(err, 'Failed to load the GST summary.'))
        setLoading(false)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, dateFrom, dateTo, reloadKey, awaitingDates])

  const exportCsv = async () => {
    try {
      const blob = await gstApi.exportCsv(params)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `gst_summary_${report?.date_from ?? period}_${report?.date_to ?? ''}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(errorText(err, 'Failed to export.'))
    }
  }

  const net = report?.net_payable
  const range = report?.date_from ? `${formatDate(report.date_from)} – ${formatDate(report.date_to)}` : 'All time'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="GST Summary"
        description="Output GST on your sales, the input tax credit on purchases and what is payable - split CGST, SGST and IGST. Only posted invoices, bills and notes count."
        actions={<>
          <div className="min-w-[200px]">
            <Select id="gst-period" value={period} onChange={(e) => setPeriod(e.target.value as ReportPeriod)}>
              {REPORT_PERIOD_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </div>
          {period === 'custom' && <>
            <DatePicker2 id="gst-from" label="" value={dateFrom} onChange={setDateFrom} fullWidth={false} className="min-w-[150px]" />
            <DatePicker2 id="gst-to" label="" value={dateTo} onChange={setDateTo} fullWidth={false} className="min-w-[150px]" />
          </>}
          <Button variant="outlined" icon={<Download />} onClick={exportCsv} disabled={!report}>Export CSV</Button>
          <IconButton title="Refresh" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
            <RefreshCw className={`h-[18px] w-[18px] stroke-[1.8] ${loading ? 'animate-spin' : ''}`} />
          </IconButton>
        </>}
      />

      {error && <Alert>{error}</Alert>}
      {report && !report.company.state && (
        <div className="rounded-xl bg-warning-soft px-4 py-3 text-sm font-medium text-warning-text">
          Your company's state isn't set, so every sale and purchase is treated as within the state (CGST + SGST).
          Set it under <Link to="/period-close" className="font-bold underline">Period Close → Company details</Link>.
        </div>
      )}

      {awaitingDates ? (
        <Panel><EmptyState icon={<Percent />} title="Pick both dates of the custom range." /></Panel>
      ) : loading && !report ? (
        <div className="flex justify-center p-16"><Spinner size={32} /></div>
      ) : report && net && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiTile tone="success" icon={<ArrowUpRight />} label="Output GST (on sales)" value={formatMoney(report.outward.tax)}
              caption={`On ${formatMoney(report.outward.taxable)} of sales · ${range}`} />
            <KpiTile tone="info" icon={<ArrowDownLeft />} label="Input tax credit" value={formatMoney(report.input_tax_credit.tax)}
              caption={report.ineligible_input_tax
                ? `${formatMoney(report.ineligible_input_tax)} not claimable (no input-tax account)`
                : `On ${formatMoney(report.inward.taxable)} of purchases`} />
            <KpiTile dark icon={<Scale />} label={net.total >= 0 ? 'Net GST payable' : 'Credit carried forward'}
              value={formatMoney(Math.abs(net.total))} caption="Output GST minus input tax credit" />
          </div>

          <Panel className="overflow-hidden p-0">
            <h2 className="border-b border-border px-6 py-4 text-base font-bold text-ink">Payable by component</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className={TABLE_HEAD_ROW}>
                    <th className={TH}>Component</th>
                    <th className={`${TH} text-right`}>Output GST</th>
                    <th className={`${TH} text-right`}>Input tax credit</th>
                    <th className={`${TH} text-right`}>Net payable</th>
                  </tr>
                </thead>
                <tbody>
                  {(['cgst', 'sgst', 'igst'] as const).map((c) => (
                    <tr key={c} className={TABLE_ROW}>
                      <td className={`${TD} font-semibold uppercase`}>{c}</td>
                      <td className={NUM}>{formatMoney(report.outward[c])}</td>
                      <td className={NUM}>{formatMoney(report.input_tax_credit[c])}</td>
                      <td className={`${NUM} font-semibold`}>{formatMoney(net[c])}</td>
                    </tr>
                  ))}
                  <tr className="bg-surface-muted font-bold">
                    <td className={TD}>Total</td>
                    <td className={NUM}>{formatMoney(report.outward.tax)}</td>
                    <td className={NUM}>{formatMoney(report.input_tax_credit.tax)}</td>
                    <td className={NUM}>{formatMoney(net.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="px-6 py-3 text-xs text-muted">
              A negative figure is credit carried forward. The order in which credit is set off between components
              (IGST first, then CGST / SGST) is applied when you file - this is the total for each.
            </p>
          </Panel>

          <div>
            <Tabs<View> value={view} onChange={setView} options={[
              { value: 'rates', label: 'By rate' },
              { value: 'supplies', label: 'B2B / B2C' },
              { value: 'hsn', label: 'HSN / SAC' },
              { value: 'documents', label: `Documents (${report.documents.length})` },
            ]} />
          </div>

          {view === 'rates' && (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <RateTable title="Outward supplies (sales)" rows={report.outward.by_rate} total={report.outward} />
              <RateTable title="Inward supplies (purchases)" rows={report.inward.by_rate} total={report.inward} />
            </div>
          )}

          {view === 'supplies' && (
            <Panel className="overflow-hidden p-0">
              <TotalsTable rows={[
                ['B2B - registered clients (with a GSTIN)', report.outward.b2b],
                ['B2C - unregistered clients', report.outward.b2c],
                ['Within the state (CGST + SGST)', report.outward.intra_state],
                ['To other states (IGST)', report.outward.inter_state],
              ]} />
            </Panel>
          )}

          {view === 'hsn' && (
            <Panel className="overflow-hidden p-0">
              {report.hsn_summary.length === 0 ? (
                <EmptyState icon={<Percent />} title="No sales in this period." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-sm">
                    <thead>
                      <tr className={TABLE_HEAD_ROW}>
                        <th className={TH}>HSN / SAC</th>
                        <th className={`${TH} text-right`}>Quantity</th>
                        <TaxHeads />
                      </tr>
                    </thead>
                    <tbody>
                      {report.hsn_summary.map((h) => (
                        <tr key={`${h.hsn_sac_code}-${h.unit}`} className={TABLE_ROW}>
                          <td className={`${TD} num font-semibold`}>
                            {h.hsn_sac_code || <span className="font-sans font-normal text-muted">No code (item without a product)</span>}
                          </td>
                          <td className={NUM}>{Number(h.quantity)} {h.unit}</td>
                          <TaxCells t={h} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          {view === 'documents' && (
            <Panel className="overflow-hidden p-0">
              {report.documents.length === 0 ? (
                <EmptyState icon={<Percent />} title="No posted invoices, bills or notes in this period." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1100px] border-collapse text-sm">
                    <thead>
                      <tr className={TABLE_HEAD_ROW}>
                        <th className={TH}>Document</th>
                        <th className={TH}>Date</th>
                        <th className={TH}>Party</th>
                        <th className={TH}>Place of supply</th>
                        <TaxHeads />
                        <th className={`${TH} text-right`}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.documents.map((doc) => (
                        <tr key={`${doc.kind}-${doc.id}`} className={TABLE_ROW}>
                          <td className={TD}>
                            <p className="num font-semibold">{doc.number}</p>
                            <p className="text-xs text-muted">{KIND_LABEL[doc.kind]}</p>
                          </td>
                          <td className={TD}>{formatDate(doc.date)}</td>
                          <td className={TD}>
                            <p>{doc.party}</p>
                            {doc.gstin && <p className="num text-xs text-muted">{doc.gstin}</p>}
                          </td>
                          <td className={TD}>
                            {doc.place_of_supply || '—'}
                            <span className="block text-xs text-muted">{doc.is_interstate ? 'IGST' : 'CGST + SGST'}</span>
                          </td>
                          <TaxCells t={doc} />
                          <td className={`${NUM} font-semibold`}>{formatMoney(doc.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}
        </>
      )}
    </div>
  )
}

function TaxHeads() {
  return <>
    {['Taxable value', 'CGST', 'SGST', 'IGST', 'Total tax'].map((h) => <th key={h} className={`${TH} text-right`}>{h}</th>)}
  </>
}

function TaxCells({ t }: { t: GstTotals }) {
  return <>
    <td className={NUM}>{formatMoney(t.taxable)}</td>
    <td className={NUM}>{formatMoney(t.cgst)}</td>
    <td className={NUM}>{formatMoney(t.sgst)}</td>
    <td className={NUM}>{formatMoney(t.igst)}</td>
    <td className={`${NUM} font-semibold`}>{formatMoney(t.tax)}</td>
  </>
}

function RateTable({ title, rows, total }: { title: string; rows: GstRateRow[]; total: GstTotals }) {
  return (
    <Panel className="overflow-hidden p-0">
      <h2 className="border-b border-border px-6 py-4 text-base font-bold text-ink">{title}</h2>
      {rows.length === 0 ? (
        <EmptyState icon={<Percent />} title="Nothing in this period." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead><tr className={TABLE_HEAD_ROW}><th className={TH}>Rate</th><TaxHeads /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className={TABLE_ROW}>
                  <td className={`${TD} font-semibold`}>{r.name}</td>
                  <TaxCells t={r} />
                </tr>
              ))}
              <tr className="bg-surface-muted font-bold">
                <td className={TD}>Total</td>
                <TaxCells t={total} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function TotalsTable({ rows }: { rows: [string, GstTotals][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead><tr className={TABLE_HEAD_ROW}><th className={TH}>Outward supplies</th><TaxHeads /></tr></thead>
        <tbody>
          {rows.map(([label, t]) => (
            <tr key={label} className={TABLE_ROW}>
              <td className={`${TD} font-semibold`}>{label}</td>
              <TaxCells t={t} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
