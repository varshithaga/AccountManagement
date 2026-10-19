import { Fragment, useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Download, Hourglass, RefreshCw, Wallet, AlertTriangle, Clock } from 'lucide-react'
import { DateField, IconButton, Panel, Spinner, Tabs, Button, Alert } from '../../components/tw'
import { EmptyState, KpiTile, PageHeader } from '../../components/PageParts'
import { formatMoney } from '../../utils/periods'
import { exportToExcel } from '../../utils/excelExport'
import { AGING_BUCKETS, agingApi, errorText } from './billingapi'
import type { AgingBucket, AgingReport } from './billingapi'
import { TABLE_HEAD_ROW, TABLE_ROW, TD, TH, formatDate, todayIso } from './billingParts'
import { useAuth } from '../../context/AuthContext'
import RemindersPanel from './RemindersPanel'

type Kind = 'receivables' | 'payables' | 'reminders'

const BUCKET_LABELS: Record<AgingBucket, string> = {
  current: 'Not yet due', '1_30': '1–30 days', '31_60': '31–60 days', '61_90': '61–90 days', over_90: 'Over 90 days',
}

const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: 'receivables', label: 'Receivables' }, { value: 'payables', label: 'Payables' }, { value: 'reminders', label: 'Reminders' },
]

export default function ReceivablesPayablesPage() {
  const [kind, setKind] = useState<Kind>('receivables')
  const { can } = useAuth()
  if (kind === 'reminders') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Receivables & payables"
          description="Payment reminders for overdue invoices - copy the text, email it, or record that you reminded them another way."
          actions={<Tabs<Kind> value={kind} onChange={setKind} options={KIND_OPTIONS} />} />
        <RemindersPanel canSend={can('sales_invoices', 'edit')} />
      </div>
    )
  }
  return <AgingView kind={kind} setKind={setKind} />
}

function AgingView({ kind, setKind }: { kind: 'receivables' | 'payables'; setKind: (k: Kind) => void }) {
  const [asOf, setAsOf] = useState(todayIso())
  const [report, setReport] = useState<AgingReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setReport(kind === 'receivables' ? await agingApi.receivables(asOf) : await agingApi.payables(asOf))
    } catch (err) {
      setError(errorText(err, 'Failed to load the report.'))
    } finally {
      setLoading(false)
    }
  }, [kind, asOf])
  useEffect(() => { load() }, [load])

  const toggle = (id: number) => setExpanded((s) => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const exportExcel = async () => {
    if (!report) return
    await exportToExcel(`${kind}_aging_${report.as_of}.xlsx`, kind === 'receivables' ? 'Receivables' : 'Payables', [
      { header: kind === 'receivables' ? 'Client' : 'Supplier', key: 'party_name', width: 30 },
      { header: 'Opening balance', key: 'opening_balance', width: 16 },
      ...AGING_BUCKETS.map((b) => ({ header: BUCKET_LABELS[b], key: b, width: 14 })),
      { header: 'Advances', key: 'advances', width: 14 },
      { header: 'Total', key: 'total', width: 16 },
    ], report.parties.map((p) => ({ ...p })))
  }

  const t = report?.totals
  const overdue = t ? t['1_30'] + t['31_60'] + t['61_90'] + t.over_90 : 0
  const partyLabel = kind === 'receivables' ? 'Client' : 'Supplier'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Receivables & payables"
        description="What clients owe you and what you owe suppliers, by how long it has been due."
        actions={<>
          <Tabs<Kind> value={kind} onChange={setKind} options={KIND_OPTIONS} />
          <div className="w-44"><DateField id="aging-as-of" value={asOf} onChange={setAsOf} /></div>
          <Button variant="outlined" icon={<Download />} onClick={exportExcel} disabled={!report}>Export</Button>
          <IconButton title="Refresh" onClick={load} disabled={loading}>
            <RefreshCw className={`h-[18px] w-[18px] stroke-[1.8] ${loading ? 'animate-spin' : ''}`} />
          </IconButton>
        </>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile dark icon={<Wallet />} label={kind === 'receivables' ? 'Total receivable' : 'Total payable'}
          value={formatMoney(t?.total)} caption={`As of ${formatDate(report?.as_of)}`} />
        <KpiTile tone="danger" icon={<AlertTriangle />} label="Overdue" value={formatMoney(overdue)} caption={`Over 90 days: ${formatMoney(t?.over_90)}`} />
        <KpiTile tone="info" icon={<Clock />} label="Not yet due" value={formatMoney(t?.current)} caption={`Advances: ${formatMoney(t?.advances)}`} />
      </div>

      {error && <Alert>{error}</Alert>}

      <Panel className="overflow-hidden p-0">
        {loading && !report ? (
          <div className="flex justify-center p-16"><Spinner size={32} /></div>
        ) : !report || report.parties.length === 0 ? (
          <EmptyState icon={<Hourglass />} title={`Nothing ${kind === 'receivables' ? 'receivable' : 'payable'} as of this date.`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className={TABLE_HEAD_ROW}>
                  <th className={TH}>{partyLabel}</th>
                  <th className={`${TH} text-right`}>Opening</th>
                  {AGING_BUCKETS.map((b) => <th key={b} className={`${TH} text-right`}>{BUCKET_LABELS[b]}</th>)}
                  <th className={`${TH} text-right`}>Advances</th>
                  <th className={`${TH} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {report.parties.map((p) => (
                  <Fragment key={p.party_id}>
                    <tr className={`${TABLE_ROW} cursor-pointer`} onClick={() => toggle(p.party_id)}>
                      <td className={`${TD} font-semibold`}>
                        <span className="inline-flex items-center gap-1.5">
                          {expanded.has(p.party_id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          {p.party_name}
                        </span>
                      </td>
                      <td className={`${TD} num text-right`}>{amount(p.opening_balance)}</td>
                      {AGING_BUCKETS.map((b) => (
                        <td key={b} className={`${TD} num text-right ${b === 'over_90' && p[b] > 0 ? 'font-semibold text-danger-text' : ''}`}>{amount(p[b])}</td>
                      ))}
                      <td className={`${TD} num text-right`}>{p.advances ? formatMoney(-p.advances) : ''}</td>
                      <td className={`${TD} num text-right font-bold`}>{formatMoney(p.total)}</td>
                    </tr>
                    {expanded.has(p.party_id) && p.documents.map((d) => (
                      <tr key={`${p.party_id}-${d.id}`} className="border-b border-border-soft bg-surface-muted/50 text-[13px]">
                        <td className={`${TD} pl-10`}>
                          <span className="num font-semibold">{d.number}</span>
                          <span className="text-muted"> · {formatDate(d.date)} · due {formatDate(d.due_date)}{d.days_overdue ? ` · ${d.days_overdue} days late` : ''}</span>
                        </td>
                        <td />
                        {AGING_BUCKETS.map((b) => <td key={b} className={`${TD} num text-right`}>{d.bucket === b ? formatMoney(d.balance_due) : ''}</td>)}
                        <td />
                        <td className={`${TD} num text-right text-muted`}>of {formatMoney(d.total)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                <tr className="bg-slate-50 font-bold dark:bg-slate-900/80">
                  <td className={TD}>Total</td>
                  <td className={`${TD} num text-right`}>{formatMoney(t?.opening_balance)}</td>
                  {AGING_BUCKETS.map((b) => <td key={b} className={`${TD} num text-right`}>{formatMoney(t?.[b])}</td>)}
                  <td className={`${TD} num text-right`}>{formatMoney(t?.advances)}</td>
                  <td className={`${TD} num text-right`}>{formatMoney(t?.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

const amount = (n: number) => (n ? formatMoney(n) : '')
