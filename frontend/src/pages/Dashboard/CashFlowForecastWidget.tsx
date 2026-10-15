import { useState, type ReactNode } from 'react'
import {
  TrendingUp, TrendingDown, Flame, ShieldCheck, Hourglass,
  Calendar, ArrowUpRight, ArrowDownRight, Activity,
} from 'lucide-react'
import type { DashboardCashFlowForecast } from './dashboardapi'
import { Panel, Chip } from '../../components/tw'

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

/** Whole rupees, Indian grouping, real minus sign. */
function formatAmount(val: number): string {
  return val < 0 ? `−${INR.format(Math.abs(val))}` : INR.format(val)
}

function MetricTile({ label, icon, value, valueClass, text = false }: { label: string; icon: ReactNode; value: string; valueClass: string; text?: boolean }) {
  return (
    <div className="rounded-2xl bg-surface-muted p-4">
      <div className="flex items-center justify-between gap-2 text-[13px] font-semibold text-muted">
        <span>{label}</span>
        <span className="[&_svg]:h-4 [&_svg]:w-4 [&_svg]:stroke-[1.8]">{icon}</span>
      </div>
      <p className={`${text ? '' : 'num '}mt-1.5 text-lg font-semibold ${valueClass}`}>{value}</p>
    </div>
  )
}

export default function CashFlowForecastWidget({ data }: { data: DashboardCashFlowForecast }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [activeView, setActiveView] = useState<'chart' | 'projection'>('chart')

  const { historical, forecast, metrics } = data
  const combined = [...historical, ...forecast]

  const maxVal = Math.max(
    ...combined.flatMap((item) => [item.inflow, item.outflow, Math.abs(item.net)])
  , 1000)

  const isBurning = metrics.burn_status === 'BURNING'
  const noData = metrics.burn_status === 'NO_DATA'
  const runway = metrics.runway_months
  let runwayText = 'Net surplus'
  if (noData) runwayText = 'No data yet'
  else if (isBurning && runway !== null) runwayText = runway > 0 ? `${runway} months` : 'No cash runway'

  let runwayTone: 'success' | 'warning' | 'error' = 'success'
  if (noData) runwayTone = 'warning'
  else if (isBurning && runway !== null) {
    if (runway < 6) runwayTone = 'error'
    else if (runway < 12) runwayTone = 'warning'
  }
  const runwayClass = runwayTone === 'success' ? 'text-success-text' : runwayTone === 'warning' ? 'text-warning-text' : 'text-danger-text'

  const toggleBtn = (on: boolean) =>
    `h-9 whitespace-nowrap rounded-[9px] px-3.5 text-[13px] font-semibold transition-colors ${
      on ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(10_26_58/0.08)] ring-1 ring-border' : 'text-muted hover:text-ink'
    }`

  return (
    <Panel className="overflow-hidden">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-info-soft text-info-text">
            <Activity className="h-[18px] w-[18px] stroke-[1.8]" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base text-ink">Cash flow &amp; runway</h2>
              <Chip tone={runwayTone} variant="solid">
                {isBurning ? <Flame className="mr-1 inline h-3 w-3" /> : <ShieldCheck className="mr-1 inline h-3 w-3" />}
                {runwayText}
              </Chip>
            </div>
            <p className="mt-0.5 text-[13px] text-muted">
              Six months of cash movement and a three-month projection
            </p>
          </div>
        </div>

        {/* View Toggle */}
        <div className="flex self-start rounded-xl border border-border bg-surface-muted p-1">
          <button type="button" onClick={() => setActiveView('chart')} className={toggleBtn(activeView === 'chart')}>
            Chart
          </button>
          <button type="button" onClick={() => setActiveView('projection')} className={toggleBtn(activeView === 'projection')}>
            Runway table
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="Avg. monthly inflow" icon={<ArrowDownRight className="text-success" />} value={formatAmount(metrics.avg_monthly_inflow)} valueClass="text-ink" />
        <MetricTile label="Avg. monthly outflow" icon={<ArrowUpRight className="text-danger" />} value={formatAmount(metrics.avg_monthly_outflow)} valueClass="text-ink" />
        <MetricTile
          label="Net monthly flow"
          icon={metrics.avg_net_flow >= 0 ? <TrendingUp className="text-success" /> : <TrendingDown className="text-danger" />}
          value={formatAmount(metrics.avg_net_flow)}
          valueClass={metrics.avg_net_flow >= 0 ? 'text-success-text' : 'text-danger-text'}
        />
        <MetricTile label="Est. cash runway" icon={<Hourglass className="text-info" />} value={runwayText} valueClass={runwayClass} text={runway === null || !isBurning} />
      </div>

      {/* Chart View */}
      {activeView === 'chart' ? (
        <div>
          {/* Chart Legend */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <span className="flex items-center gap-1.5 font-semibold text-ink">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-success" /> Cash inflow
              </span>
              <span className="flex items-center gap-1.5 font-semibold text-ink">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-danger" /> Cash outflow
              </span>
              <span className="flex items-center gap-1.5 font-semibold text-ink">
                <span className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-muted" /> Forecast (est.)
              </span>
            </div>
            <span className="text-muted">Hover or tap a month to see its breakdown</span>
          </div>

          <div className="relative h-64 w-full">
            <div className="flex h-full items-end justify-between gap-2 border-b border-border pt-6">
              {combined.map((item, idx) => {
                const inflowPct = maxVal > 0 ? (item.inflow / maxVal) * 100 : 0
                const outflowPct = maxVal > 0 ? (item.outflow / maxVal) * 100 : 0
                const isHovered = hoveredIdx === idx

                return (
                  <div
                    key={item.month}
                    tabIndex={0}
                    aria-label={`${item.month_name}: inflow ${formatAmount(item.inflow)}, outflow ${formatAmount(item.outflow)}, net ${formatAmount(item.net)}`}
                    onMouseEnter={() => setHoveredIdx(idx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    onFocus={() => setHoveredIdx(idx)}
                    onBlur={() => setHoveredIdx(null)}
                    onClick={() => setHoveredIdx(idx)}
                    className={`group relative flex h-full flex-1 flex-col items-center justify-end rounded-t-xl outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-primary-soft ${
                      item.is_forecast ? 'bg-primary/[0.06]' : ''
                    } ${isHovered ? 'bg-surface-muted' : ''}`}
                  >
                    {/* Tooltip */}
                    {isHovered && (
                      <div className="absolute -top-24 z-20 whitespace-nowrap rounded-xl bg-sidebar p-3 text-xs text-white shadow-xl">
                        <div className="mb-1 flex items-center justify-between gap-2 border-b border-white/10 pb-1 font-semibold">
                          <span>{item.month_name}</span>
                          {item.is_forecast && <span className="text-[0.65rem] font-normal text-sidebar-label">(Forecast)</span>}
                        </div>
                        <div className="num text-mint">In: {formatAmount(item.inflow)}</div>
                        <div className="num text-[#FF8C9B]">Out: {formatAmount(item.outflow)}</div>
                        <div className="num mt-0.5 font-semibold text-white">Net: {formatAmount(item.net)}</div>
                      </div>
                    )}

                    {/* Bars Container */}
                    <div className="flex h-[80%] w-full items-end justify-center gap-1 px-1.5">
                      <div
                        className={`w-1/2 max-w-[22px] rounded-t-[4px] transition-all duration-300 ${
                          item.is_forecast ? 'border-[1.5px] border-dashed border-success bg-success/10' : 'bg-success'
                        }`}
                        style={{ height: `${item.inflow > 0 ? Math.max(inflowPct, 4) : 0}%` }}
                      />
                      <div
                        className={`w-1/2 max-w-[22px] rounded-t-[4px] transition-all duration-300 ${
                          item.is_forecast ? 'border-[1.5px] border-dashed border-danger bg-danger/10' : 'bg-danger'
                        }`}
                        style={{ height: `${item.outflow > 0 ? Math.max(outflowPct, 4) : 0}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          {/* Month labels under the axis */}
          <div className="mt-2 flex justify-between gap-2">
            {combined.map((item) => (
              <span key={item.month} className={`flex-1 truncate text-center text-[11px] font-semibold ${item.is_forecast ? 'text-primary' : 'text-muted'}`}>
                {item.month_name.replace(' (Est)', '*')}
              </span>
            ))}
          </div>
        </div>
      ) : (
        /* 3-Month Projection Table View */
        <div className="-mx-6 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-6 py-2.5 text-left">Forecast period</th>
                <th className="px-3 py-2.5 text-right">Projected inflow</th>
                <th className="px-3 py-2.5 text-right">Projected outflow</th>
                <th className="px-3 py-2.5 text-right">Est. net flow</th>
                <th className="px-6 py-2.5 text-right">Est. closing cash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {forecast.map((item) => (
                <tr key={item.month} className="hover:bg-surface-muted">
                  <td className="px-6 py-[13px] font-semibold text-ink">
                    <span className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 stroke-[1.8] text-muted" />
                      {item.month_name}
                    </span>
                  </td>
                  <td className="px-3 py-[13px] text-right text-success-text">{formatAmount(item.inflow)}</td>
                  <td className="px-3 py-[13px] text-right text-danger-text">{formatAmount(item.outflow)}</td>
                  <td className={`px-3 py-[13px] text-right font-semibold ${item.net >= 0 ? 'text-success-text' : 'text-danger-text'}`}>
                    {formatAmount(item.net)}
                  </td>
                  <td className="px-6 py-[13px] text-right font-semibold text-ink">
                    {item.projected_balance !== undefined ? formatAmount(item.projected_balance) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
