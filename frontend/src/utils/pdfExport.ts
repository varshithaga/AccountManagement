import type { jsPDF } from 'jspdf'
import dayjs from 'dayjs'
import type { ProfitAndLossCategoryGroup } from '../types'
import {
  extractCategoryRows,
  type ExcelColumn,
  type ExportBalanceSheetOptions,
  type ExportComparisonOptions,
  type ExportFinancialPackOptions,
  type ExportPnlOptions,
  type ExportTrialBalanceOptions,
} from './excelExport'

/*
 * PDF versions of the report exports. Same data and layout ideas as excelExport.ts:
 * a title bar, the report details, a summary block and the itemised table(s).
 * The built-in PDF fonts have no ₹ glyph, so amounts are printed as plain numbers
 * under "(INR)" column headers.
 */

type Cell = string | number | null | undefined
type RowStyle = 'normal' | 'subtotal' | 'total' | 'grand'

export interface PdfRow {
  cells: Cell[]
  style?: RowStyle
}

export interface PdfColumn {
  header: string
  align?: 'left' | 'right'
}

export interface PdfTable {
  title?: string
  columns: PdfColumn[]
  rows: PdfRow[]
}

export interface PdfReportSpec {
  title: string
  /** Label / value lines under the title, e.g. ["Bank Account", "All Bank Accounts"]. */
  meta: [string, string][]
  /** Small two-column summary table (KPI / total). */
  summary?: { label: string; value: Cell; tone?: 'good' | 'bad' | 'neutral' }[]
  /** One line shown under the summary, e.g. "BALANCED" / "OUT OF BALANCE". */
  status?: { text: string; ok: boolean }
  tables: PdfTable[]
}

const VIOLET: [number, number, number] = [76, 29, 149]
const SLATE_900: [number, number, number] = [15, 23, 42]
const SLATE_800: [number, number, number] = [30, 41, 59]
const SLATE_500: [number, number, number] = [100, 116, 139]
const GREEN: [number, number, number] = [5, 150, 105]
const RED: [number, number, number] = [225, 29, 72]
const AMBER: [number, number, number] = [217, 119, 6]

const ROW_FILL: Record<RowStyle, [number, number, number] | null> = {
  normal: null,
  subtotal: [241, 245, 249],
  total: [237, 233, 254],
  grand: SLATE_800,
}

/** 1,23,456.78 - negative amounts in brackets, the accounting way. */
export function pdfAmount(value: Cell): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string' && Number.isNaN(Number(value))) return value
  const n = Number(value)
  const s = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `(${s})` : s
}

/** jspdf and its table plugin are large, so they load only when a PDF export runs. */
async function loadPdf() {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  return { jsPDF, autoTable }
}

type AutoTable = Awaited<ReturnType<typeof loadPdf>>['autoTable']

const lastY = (doc: jsPDF): number => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

function renderReport(doc: jsPDF, autoTable: AutoTable, spec: PdfReportSpec) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 14

  // Title bar
  doc.setFillColor(...VIOLET)
  doc.rect(0, 0, pageWidth, 22, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text(spec.title.toUpperCase(), margin, 14)

  // Report details
  let y = 31
  doc.setFontSize(9.5)
  for (const [label, value] of spec.meta) {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...SLATE_500)
    doc.text(`${label}:`, margin, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...SLATE_900)
    doc.text(value, margin + 32, y)
    y += 5.5
  }

  if (spec.status) {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...(spec.status.ok ? GREEN : AMBER))
    doc.text(spec.status.text, margin, y + 1)
    y += 6.5
  }

  if (spec.summary?.length) {
    autoTable(doc, {
      startY: y + 2,
      margin: { left: margin, right: margin },
      tableWidth: Math.min(120, pageWidth - margin * 2),
      head: [['Summary', 'Amount (INR)']],
      body: spec.summary.map((s) => [s.label, typeof s.value === 'number' ? pdfAmount(s.value) : (s.value ?? '')]),
      theme: 'grid',
      styles: { fontSize: 9.5, cellPadding: 2.2, lineColor: [226, 232, 240], lineWidth: 0.2 },
      headStyles: { fillColor: SLATE_800, textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0: { fontStyle: 'bold', textColor: SLATE_900 }, 1: { halign: 'right', fontStyle: 'bold' } },
      didParseCell: (hook) => {
        if (hook.section !== 'body' || hook.column.index !== 1) return
        const tone = spec.summary![hook.row.index].tone
        if (tone === 'good') hook.cell.styles.textColor = GREEN
        if (tone === 'bad') hook.cell.styles.textColor = RED
      },
    })
    y = lastY(doc) + 4
  }

  for (const table of spec.tables) {
    if (table.title) {
      // Keep a heading together with at least a few rows of its table.
      if (y > doc.internal.pageSize.getHeight() - 40) {
        doc.addPage()
        y = 18
      }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...VIOLET)
      doc.text(table.title, margin, y + 5)
      y += 7
    }
    const columnStyles: Record<number, { halign: 'left' | 'right' }> = {}
    table.columns.forEach((c, i) => { columnStyles[i] = { halign: c.align || 'left' } })
    autoTable(doc, {
      startY: y + 1,
      margin: { left: margin, right: margin, top: 16 },
      head: [table.columns.map((c) => c.header)],
      body: table.rows.map((r) => r.cells.map((c, i) => (table.columns[i]?.align === 'right' ? pdfAmount(c) : (c ?? '')))),
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 2, lineColor: [226, 232, 240], lineWidth: 0.2, textColor: SLATE_900 },
      headStyles: { fillColor: SLATE_800, textColor: 255, fontStyle: 'bold' },
      columnStyles,
      didParseCell: (hook) => {
        if (hook.section === 'head') {
          hook.cell.styles.halign = table.columns[hook.column.index]?.align || 'left'
          return
        }
        if (hook.section !== 'body') return
        const style = table.rows[hook.row.index]?.style || 'normal'
        if (style === 'normal') return
        hook.cell.styles.fontStyle = 'bold'
        hook.cell.styles.fillColor = ROW_FILL[style]!
        if (style === 'grand') hook.cell.styles.textColor = 255
      },
    })
    y = lastY(doc) + 6
  }
}

/** Page numbers and the generated time on every page. */
function addFooters(doc: jsPDF) {
  const pages = doc.getNumberOfPages()
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...SLATE_500)
    doc.text(`Generated ${dayjs().format('DD MMM YYYY, HH:mm')}`, 14, h - 8)
    doc.text(`Page ${i} of ${pages}`, w - 14, h - 8, { align: 'right' })
  }
}

/** Renders each spec starting on its own page and downloads the PDF. */
export async function savePdf(specs: PdfReportSpec[], filename: string, orientation: 'portrait' | 'landscape' = 'portrait') {
  const { jsPDF, autoTable } = await loadPdf()
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  specs.forEach((spec, i) => {
    if (i > 0) doc.addPage()
    renderReport(doc, autoTable, spec)
  })
  addFooters(doc)
  doc.save(filename)
}

const today = () => dayjs().format('YYYY-MM-DD')

function categoryRows(sectionLabel: string, groups: ProfitAndLossCategoryGroup[], abs: boolean): PdfRow[] {
  const rows: PdfRow[] = []
  groups.forEach((cat) => {
    cat.subcategories.forEach((sub) => {
      const amount = Number(sub.amount)
      rows.push({ cells: [sectionLabel, cat.category_name, sub.sub_category_name, abs ? Math.abs(amount) : amount] })
    })
  })
  return rows
}

const SECTION_COLUMNS = (first: string): PdfColumn[] => [
  { header: first }, { header: 'Category' }, { header: 'Sub-Category' }, { header: 'Amount (INR)', align: 'right' },
]

// ---------------------------------------------------------------------------
// Profit & Loss

export function profitAndLossPdfSpec({ report, accountName, periodLabel, dateRangeText }: ExportPnlOptions): PdfReportSpec {
  const income = Math.abs(Number(report.income.total))
  const expense = Math.abs(Number(report.expense.total))
  const net = income - expense
  const margin = income > 0 ? ((net / income) * 100).toFixed(2) : '0.00'
  return {
    title: 'Profit & Loss Statement',
    meta: [
      ['Bank Account', accountName],
      ['Report Period', `${periodLabel}${dateRangeText ? ` (${dateRangeText})` : ''}`],
    ],
    summary: [
      { label: 'Total Income', value: income, tone: 'good' },
      { label: 'Total Expenses', value: expense, tone: 'bad' },
      { label: net >= 0 ? 'Net Profit' : 'Net Loss', value: net, tone: net >= 0 ? 'good' : 'bad' },
      { label: 'Profit Margin', value: `${margin}%` },
    ],
    tables: [{
      title: 'Itemised Breakdown',
      columns: SECTION_COLUMNS('Type'),
      rows: [
        ...categoryRows('Income', report.income.categories, true),
        { cells: ['TOTAL INCOME', '', '', income], style: 'total' },
        ...categoryRows('Expense', report.expense.categories, true),
        { cells: ['TOTAL EXPENSES', '', '', expense], style: 'total' },
        { cells: ['NET PROFIT / (LOSS)', '', '', net], style: 'grand' },
      ],
    }],
  }
}

export const exportProfitAndLossReportToPdf = (data: ExportPnlOptions) =>
  savePdf([profitAndLossPdfSpec(data)], `Profit_and_Loss_Statement_${today()}.pdf`)

// ---------------------------------------------------------------------------
// Balance Sheet

export function balanceSheetPdfSpec({ report, accountName, periodLabel, asOfDateText }: ExportBalanceSheetOptions): PdfReportSpec {
  const assets = Number(report.total_assets || 0)
  const liabilities = Number(report.liabilities.total || 0)
  const equity = Number(report.total_equity || 0)
  const liabEq = Number(report.total_liabilities_and_equity || 0)
  const diff = assets - liabEq
  return {
    title: 'Balance Sheet',
    meta: [
      ['Bank Account', accountName],
      ['As of', `${periodLabel}${asOfDateText ? ` (${asOfDateText})` : ''}`],
    ],
    status: report.is_balanced
      ? { text: 'BALANCED - Assets = Liabilities + Equity', ok: true }
      : { text: `OUT OF BALANCE by ${pdfAmount(Math.abs(diff))}`, ok: false },
    summary: [
      { label: 'Total Assets', value: assets },
      { label: 'Total Liabilities', value: liabilities },
      { label: 'Retained Earnings', value: Number(report.retained_earnings || 0) },
      { label: 'Total Equity', value: equity },
      { label: 'Total Liabilities & Equity', value: liabEq },
    ],
    tables: [{
      title: 'Itemised Breakdown',
      columns: SECTION_COLUMNS('Section'),
      rows: [
        ...categoryRows('Assets', report.assets.categories, false),
        { cells: ['TOTAL ASSETS', '', '', assets], style: 'total' },
        ...categoryRows('Liabilities', report.liabilities.categories, false),
        { cells: ['TOTAL LIABILITIES', '', '', liabilities], style: 'total' },
        ...categoryRows('Equity', report.equity.categories, false),
        { cells: ['Equity', 'Retained Earnings', 'Current Period Profit (P&L)', Number(report.retained_earnings || 0)] },
        { cells: ['TOTAL EQUITY', '', '', equity], style: 'total' },
        { cells: ['TOTAL LIABILITIES & EQUITY', '', '', liabEq], style: 'grand' },
      ],
    }],
  }
}

export const exportBalanceSheetReportToPdf = (data: ExportBalanceSheetOptions) =>
  savePdf([balanceSheetPdfSpec(data)], `Balance_Sheet_Report_${today()}.pdf`)

// ---------------------------------------------------------------------------
// Trial Balance

export function trialBalancePdfSpec({ report, accountName, periodLabel, dateRangeText }: ExportTrialBalanceOptions): PdfReportSpec {
  const totalDebit = Number(report.total_debit || 0)
  const totalCredit = Number(report.total_credit || 0)
  const diff = Math.abs(totalDebit - totalCredit)
  const rows: PdfRow[] = []
  Object.entries(report.account_types).forEach(([type, items]) => {
    let d = 0
    let c = 0
    items.forEach((item) => {
      const debit = Number(item.debit) || 0
      const credit = Number(item.credit) || 0
      d += debit
      c += credit
      rows.push({ cells: [type, item.category_name, item.sub_category_name, debit > 0 ? debit : 0, credit > 0 ? credit : 0] })
    })
    rows.push({ cells: [`Subtotal - ${type}`, '', '', d, c], style: 'subtotal' })
  })
  rows.push({ cells: ['GRAND TOTALS', '', '', totalDebit, totalCredit], style: 'grand' })
  return {
    title: 'Trial Balance',
    meta: [
      ['Bank Account', accountName],
      ['Report Period', `${periodLabel}${dateRangeText ? ` (${dateRangeText})` : ''}`],
    ],
    status: report.is_balanced
      ? { text: 'BALANCED - Total Debits = Total Credits', ok: true }
      : { text: `OUT OF BALANCE by ${pdfAmount(diff)}`, ok: false },
    summary: [
      { label: 'Total Debits', value: totalDebit },
      { label: 'Total Credits', value: totalCredit },
      { label: 'Difference', value: diff, tone: report.is_balanced ? 'good' : 'bad' },
    ],
    tables: [{
      title: 'Account Balances',
      columns: [
        { header: 'Account Type' }, { header: 'Category' }, { header: 'Sub-Category' },
        { header: 'Debit (INR)', align: 'right' }, { header: 'Credit (INR)', align: 'right' },
      ],
      rows,
    }],
  }
}

export const exportTrialBalanceReportToPdf = (data: ExportTrialBalanceOptions) =>
  savePdf([trialBalancePdfSpec(data)], `Trial_Balance_Report_${today()}.pdf`)

// ---------------------------------------------------------------------------
// Financial Pack: Trial Balance + Profit & Loss + Balance Sheet in one file

export const exportFinancialPackToPdf = (data: ExportFinancialPackOptions) =>
  savePdf(
    [trialBalancePdfSpec(data.trialBalance), profitAndLossPdfSpec(data.profitAndLoss), balanceSheetPdfSpec(data.balanceSheet)],
    `Financial_Pack_${today()}.pdf`,
  )

// ---------------------------------------------------------------------------
// Period Comparison

export function exportComparisonReportToPdf(data: ExportComparisonOptions) {
  const { accountName, labelA, labelB, dateRangeA, dateRangeB, metrics, pnlA, pnlB, bsA, bsB } = data
  const pct = (a: number, b: number) => (a !== 0 ? `${(((b - a) / Math.abs(a)) * 100).toFixed(1)}%` : '-')
  const cmpColumns: PdfColumn[] = [
    { header: 'Section' }, { header: 'Category' }, { header: 'Sub-Category' },
    { header: labelA, align: 'right' }, { header: labelB, align: 'right' },
    { header: 'Change', align: 'right' }, { header: '% Change' },
  ]
  const cmpRows = (section: string, a: ProfitAndLossCategoryGroup[] = [], b: ProfitAndLossCategoryGroup[] = []): PdfRow[] =>
    extractCategoryRows(section, a, b).map((r) => ({
      cells: [r.section, r.categoryName, r.subCategoryName, r.amountA, r.amountB, r.change,
        r.changePct === null ? '-' : `${r.changePct.toFixed(1)}%`],
    }))

  const tables: PdfTable[] = [{
    title: 'Key Metrics',
    columns: [
      { header: 'Metric' }, { header: labelA, align: 'right' }, { header: labelB, align: 'right' },
      { header: 'Change', align: 'right' }, { header: '% Change' },
    ],
    rows: metrics.map((m) => ({ cells: [m.label, m.a, m.b, m.b - m.a, pct(m.a, m.b)] })),
  }]
  if (pnlA || pnlB) {
    tables.push({
      title: 'Profit & Loss by Category',
      columns: cmpColumns,
      rows: [
        ...cmpRows('Income', pnlA?.income.categories, pnlB?.income.categories),
        ...cmpRows('Expense', pnlA?.expense.categories, pnlB?.expense.categories),
      ],
    })
  }
  if (bsA || bsB) {
    tables.push({
      title: 'Balance Sheet by Category',
      columns: cmpColumns,
      rows: [
        ...cmpRows('Assets', bsA?.assets.categories, bsB?.assets.categories),
        ...cmpRows('Liabilities', bsA?.liabilities.categories, bsB?.liabilities.categories),
        ...cmpRows('Equity', bsA?.equity.categories, bsB?.equity.categories),
      ],
    })
  }
  return savePdf([{
    title: 'Period Comparison',
    meta: [
      ['Bank Account', accountName],
      ['Period A', `${labelA}${dateRangeA ? ` (${dateRangeA})` : ''}`],
      ['Period B', `${labelB}${dateRangeB ? ` (${dateRangeB})` : ''}`],
    ],
    tables,
  }], `Period_Comparison_${today()}.pdf`, 'landscape')
}

// ---------------------------------------------------------------------------
// Simple tables (Cash Flow, Account Ledger) - same columns and rows as their Excel export

export function exportTableToPdf(
  filename: string,
  title: string,
  meta: [string, string][],
  columns: ExcelColumn[],
  data: Record<string, Cell>[],
  options: { amountKeys: string[]; rowStyle?: (row: Record<string, Cell>) => RowStyle; landscape?: boolean },
) {
  const amount = new Set(options.amountKeys)
  return savePdf([{
    title,
    meta,
    tables: [{
      columns: columns.map((c) => ({ header: amount.has(c.key) ? `${c.header} (INR)` : c.header, align: amount.has(c.key) ? 'right' : 'left' })),
      rows: data.map((row) => ({ cells: columns.map((c) => row[c.key]), style: options.rowStyle?.(row) })),
    }],
  }], filename, options.landscape ? 'landscape' : 'portrait')
}
