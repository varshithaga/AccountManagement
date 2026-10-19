import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { AlarmClock, CalendarClock, FileText, Percent, Repeat, ShoppingCart } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import type { PageKey } from '../../access/pages'
import { Panel } from '../../components/tw'
import { IconTile, type KpiTone } from '../../components/PageParts'
import { formatMoney } from '../../utils/periods'
import { dashboardApi, type DashboardSalesOverview } from './dashboardapi'

/** Sales & purchases at a glance - always the current calendar month, whatever period the dashboard shows. */
export default function SalesOverviewWidget() {
  const navigate = useNavigate()
  const { hasPage } = useAuth()
  const [data, setData] = useState<DashboardSalesOverview | null>(null)

  // Hidden when the role can't see it (403) or it fails - the rest of the dashboard carries on.
  useEffect(() => { dashboardApi.getSalesOverview().then(setData).catch(() => setData(null)) }, [])
  if (!data) return null

  const go = (page: PageKey, path: string) => (hasPage(page) ? () => navigate(path) : undefined)
  const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`

  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-ink">Sales &amp; purchases · {dayjs(data.month.start).format('MMMM YYYY')}</h2>
        <span className="text-xs text-muted">Posted invoices and bills, before GST</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile tone="success" icon={<FileText />} label="Sales this month" value={formatMoney(data.sales)}
          onClick={go('sales_invoices', '/sales-invoices')} />
        <Tile tone="info" icon={<ShoppingCart />} label="Purchases this month" value={formatMoney(data.purchases)}
          onClick={go('purchase_bills', '/purchase-bills')} />
        <Tile tone="equity" icon={<Percent />} label={data.gst_payable >= 0 ? 'GST payable this month' : 'GST credit this month'}
          value={formatMoney(Math.abs(data.gst_payable))} onClick={go('gst_summary', '/gst-summary')} />
        <Tile tone={data.recurring_due ? 'warning' : 'neutral'} icon={<Repeat />} label="Recurring invoices due"
          value={data.recurring_due} caption={data.recurring_due ? 'Waiting to be raised' : 'All raised'}
          onClick={go('recurring_invoices', '/recurring-invoices')} />
        <Tile tone="primary" icon={<CalendarClock />} label="To receive in 7 days" value={formatMoney(data.receivable_next_7_days.amount)}
          caption={count(data.receivable_next_7_days.count, 'invoice')} onClick={go('receivables_payables', '/receivables-payables')} />
        <Tile tone="caution" icon={<CalendarClock />} label="To pay in 7 days" value={formatMoney(data.payable_next_7_days.amount)}
          caption={count(data.payable_next_7_days.count, 'bill')} onClick={go('receivables_payables', '/receivables-payables')} />
        <Tile tone="danger" icon={<AlarmClock />} label="Overdue from clients" value={formatMoney(data.receivable_overdue.amount)}
          caption={count(data.receivable_overdue.count, 'invoice')} onClick={go('receivables_payables', '/receivables-payables')} />
        <Tile tone="danger" icon={<AlarmClock />} label="Overdue to suppliers" value={formatMoney(data.payable_overdue.amount)}
          caption={count(data.payable_overdue.count, 'bill')} onClick={go('receivables_payables', '/receivables-payables')} />
      </div>
    </Panel>
  )
}

function Tile({ tone, icon, label, value, caption, onClick }: {
  tone: KpiTone
  icon: ReactNode
  label: string
  value: ReactNode
  caption?: string
  onClick?: () => void
}) {
  const body = (
    <>
      <IconTile tone={tone}>{icon}</IconTile>
      <div className="min-w-0 text-left">
        <p className="truncate text-xs font-semibold text-muted">{label}</p>
        <p className="num truncate text-lg font-semibold text-ink">{value}</p>
        {caption && <p className="text-xs text-muted">{caption}</p>}
      </div>
    </>
  )
  const cls = 'flex items-center gap-3 rounded-xl border border-border-soft p-3'
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} transition-colors hover:bg-surface-muted`}>{body}</button>
    : <div className={cls}>{body}</div>
}
