import { useEffect, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { ChevronDown, Download, FileSpreadsheet, FileText, Layers } from 'lucide-react'
import { Button } from './tw'
import { reportsApi } from '../pages/ProfitAndLoss/profitandlossapi'
import { exportFinancialPackToExcel, type ExportFinancialPackOptions } from '../utils/excelExport'
import { exportFinancialPackToPdf } from '../utils/pdfExport'

/**
 * "Export Excel" + "Export PDF" buttons for a report page. Each handler builds and
 * downloads its file; the buttons show progress and report a failure via onError.
 */
export function ReportExportButtons({ onExcel, onPdf, disabled, onError, size }: {
  onExcel: () => Promise<void> | void
  onPdf: () => Promise<void> | void
  disabled?: boolean
  onError?: (message: string) => void
  size?: 'sm' | 'md'
}) {
  const [busy, setBusy] = useState<'excel' | 'pdf' | null>(null)

  const run = async (kind: 'excel' | 'pdf', fn: () => Promise<void> | void) => {
    setBusy(kind)
    try {
      await fn()
    } catch {
      onError?.(`Failed to export the ${kind === 'excel' ? 'Excel' : 'PDF'} file.`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Button
        variant="contained"
        size={size}
        icon={<FileSpreadsheet className="h-4 w-4" />}
        onClick={() => run('excel', onExcel)}
        disabled={disabled || busy !== null}
      >
        {busy === 'excel' ? 'Exporting…' : 'Export Excel'}
      </Button>
      <Button
        variant="outlined"
        size={size}
        icon={<FileText className="h-4 w-4" />}
        onClick={() => run('pdf', onPdf)}
        disabled={disabled || busy !== null}
      >
        {busy === 'pdf' ? 'Exporting…' : 'Export PDF'}
      </Button>
    </>
  )
}

export interface FinancialPackFilters {
  period: string
  /** Only used for a custom period. */
  dateFrom?: string
  /** Only used for a custom period; the Balance Sheet is taken as of this date. */
  dateTo?: string
  account?: number | ''
  accountName: string
  periodLabel: string
}

const rangeText = (from: string | null, to: string | null) =>
  from && to ? `${dayjs(from).format('DD MMM YYYY')} – ${dayjs(to).format('DD MMM YYYY')}` : undefined

/** Loads the Trial Balance, Profit & Loss and Balance Sheet for the same filters - one
 * request to /reports/financial-pack/, made only when the user exports. */
async function loadFinancialPack(f: FinancialPackFilters): Promise<ExportFinancialPackOptions> {
  const custom = f.period === 'custom'
  const { trial_balance: tb, profit_and_loss: pnl, balance_sheet: bs } = await reportsApi.financialPack({
    period: f.period,
    date_from: custom ? (f.dateFrom || undefined) : undefined,
    date_to: custom ? (f.dateTo || undefined) : undefined,
    account: f.account || undefined,
  })
  return {
    trialBalance: { report: tb, accountName: f.accountName, periodLabel: f.periodLabel, dateRangeText: rangeText(tb.date_from, tb.date_to) },
    profitAndLoss: { report: pnl, accountName: f.accountName, periodLabel: f.periodLabel, dateRangeText: rangeText(pnl.date_from, pnl.date_to) },
    balanceSheet: {
      report: bs,
      accountName: f.accountName,
      periodLabel: bs.date_to ? `As of ${dayjs(bs.date_to).format('DD MMM YYYY')}` : 'As of today',
      asOfDateText: undefined,
    },
  }
}

/**
 * "Financial Pack" menu: one Excel workbook or one PDF holding the Trial Balance,
 * Profit & Loss and Balance Sheet for the page's current period and bank account.
 */
export function FinancialPackButton({ filters, disabled, onError, size }: {
  filters: FinancialPackFilters
  disabled?: boolean
  onError?: (message: string) => void
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const run = async (format: 'excel' | 'pdf') => {
    setOpen(false)
    setBusy(true)
    try {
      const pack = await loadFinancialPack(filters)
      await (format === 'excel' ? exportFinancialPackToExcel(pack) : exportFinancialPackToPdf(pack))
    } catch {
      onError?.('Failed to export the Financial Pack.')
    } finally {
      setBusy(false)
    }
  }

  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-ink hover:bg-surface-muted '

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outlined"
        color="secondary"
        size={size}
        icon={<Layers className="h-4 w-4" />}
        endIcon={<ChevronDown className="h-4 w-4" />}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || busy}
      >
        {busy ? 'Preparing…' : 'Financial Pack'}
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg ">
          <p className="px-3 pb-1 pt-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-muted">
            Trial Balance + P&amp;L + Balance Sheet
          </p>
          <button type="button" className={item} onClick={() => run('excel')}>
            <FileSpreadsheet className="h-4 w-4 text-success-text" /> Download as Excel
          </button>
          <button type="button" className={item} onClick={() => run('pdf')}>
            <Download className="h-4 w-4 text-danger-text" /> Download as PDF
          </button>
        </div>
      )}
    </div>
  )
}
