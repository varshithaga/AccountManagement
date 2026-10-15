import type ExcelJS from 'exceljs'
import dayjs from 'dayjs'
import type { ProfitAndLossReport, BalanceSheetReport, ProfitAndLossCategoryGroup } from '../types'

/** exceljs is large, so it is loaded only when an export actually runs (its own chunk). */
const newWorkbook = async (): Promise<ExcelJS.Workbook> => {
  const { default: Excel } = await import('exceljs')
  return new Excel.Workbook()
}

/** Writes the workbook to an .xlsx file and starts the browser download. */
export async function downloadWorkbook(workbook: ExcelJS.Workbook, filename: string) {
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.URL.revokeObjectURL(url)
}

export interface ExcelColumn {
  header: string
  key: string
  width?: number
}

/**
 * Downloads formatted Excel (.xlsx) file directly in the browser using ExcelJS.
 */
export async function exportToExcel(
  filename: string,
  sheetName: string,
  columns: ExcelColumn[],
  data: Record<string, any>[]
) {
  const workbook = await newWorkbook()
  const worksheet = workbook.addWorksheet(sheetName)

  worksheet.columns = columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width || Math.max(col.header.length + 6, 16),
  }))

  // Header row formatting
  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF5B21B6' }, // Dark violet background
  }
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' }
  headerRow.height = 28

  // Add data rows
  data.forEach((item) => {
    worksheet.addRow(item)
  })

  // Format data rows
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.height = 22
      row.alignment = { vertical: 'middle' }
      if (rowNumber % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' }, // subtle alternating background
        }
      }
    }
  })

  // Generate buffer and trigger browser file download
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.URL.revokeObjectURL(url)
}

export interface CategoryComparisonRow {
  section: string
  categoryName: string
  subCategoryName: string
  amountA: number
  amountB: number
  change: number
  changePct: number | null
}

export function extractCategoryRows(
  sectionName: string,
  groupsA: ProfitAndLossCategoryGroup[] = [],
  groupsB: ProfitAndLossCategoryGroup[] = []
): CategoryComparisonRow[] {
  const map = new Map<string, CategoryComparisonRow>()

  const addGroup = (groups: ProfitAndLossCategoryGroup[], isB: boolean) => {
    groups.forEach((cat) => {
      const catName = cat.category_name || 'Uncategorized'
      const subs = cat.subcategories || []

      if (subs.length === 0) {
        const key = `${catName}||General`
        const existing = map.get(key) || {
          section: sectionName,
          categoryName: catName,
          subCategoryName: 'General',
          amountA: 0,
          amountB: 0,
          change: 0,
          changePct: null,
        }
        const val = Math.abs(Number(cat.total || 0))
        if (isB) existing.amountB = val
        else existing.amountA = val
        map.set(key, existing)
      } else {
        subs.forEach((sub) => {
          const subName = sub.sub_category_name || 'General'
          const key = `${catName}||${subName}`
          const existing = map.get(key) || {
            section: sectionName,
            categoryName: catName,
            subCategoryName: subName,
            amountA: 0,
            amountB: 0,
            change: 0,
            changePct: null,
          }
          const val = Math.abs(Number(sub.amount || 0))
          if (isB) existing.amountB = val
          else existing.amountA = val
          map.set(key, existing)
        })
      }
    })
  }

  addGroup(groupsA || [], false)
  addGroup(groupsB || [], true)

  const rows = Array.from(map.values())
  rows.forEach((r) => {
    r.change = r.amountB - r.amountA
    r.changePct = r.amountA !== 0 ? (r.change / Math.abs(r.amountA)) * 100 : null
  })

  rows.sort((x, y) => {
    const c = x.categoryName.localeCompare(y.categoryName)
    if (c !== 0) return c
    return x.subCategoryName.localeCompare(y.subCategoryName)
  })

  return rows
}

export interface ExportComparisonOptions {
  accountName: string
  labelA: string
  labelB: string
  dateRangeA?: string
  dateRangeB?: string
  metrics: { key: string; label: string; a: number; b: number }[]
  allTimePnl: ProfitAndLossReport | null
  allTimeBs: BalanceSheetReport | null
  pnlA: ProfitAndLossReport | null
  pnlB: ProfitAndLossReport | null
  bsA: BalanceSheetReport | null
  bsB: BalanceSheetReport | null
}

/**
 * Downloads an attractive, comprehensive multi-tab Excel workbook for Period Comparison & Financial Summary.
 */
export async function exportComparisonReportToExcel(data: ExportComparisonOptions) {
  const workbook = await newWorkbook()

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  }

  const totalBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FF0F172A' } },
    bottom: { style: 'double', color: { argb: 'FF0F172A' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  }

  // ==========================================
  // SHEET 1: EXECUTIVE SUMMARY
  // ==========================================
  const sheet1 = workbook.addWorksheet('Executive Summary')

  // Banner Row 1
  sheet1.mergeCells('A1:F1')
  const bannerCell = sheet1.getCell('A1')
  bannerCell.value = 'PERIOD COMPARISON & ALL-TIME FINANCIAL REPORT'
  bannerCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  bannerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } }
  bannerCell.alignment = { vertical: 'middle', horizontal: 'center' }
  sheet1.getRow(1).height = 36

  // Metadata Block (Rows 3..6)
  sheet1.getCell('A3').value = 'Bank Account:'
  sheet1.getCell('B3').value = data.accountName
  sheet1.getCell('A3').font = { bold: true, color: { argb: 'FF475569' } }
  sheet1.getCell('B3').font = { bold: true, color: { argb: 'FF0F172A' } }

  sheet1.getCell('A4').value = 'Period A:'
  sheet1.getCell('B4').value = `${data.labelA}${data.dateRangeA ? ' (' + data.dateRangeA + ')' : ''}`
  sheet1.getCell('A4').font = { bold: true, color: { argb: 'FF475569' } }

  sheet1.getCell('A5').value = 'Period B:'
  sheet1.getCell('B5').value = `${data.labelB}${data.dateRangeB ? ' (' + data.dateRangeB + ')' : ''}`
  sheet1.getCell('A5').font = { bold: true, color: { argb: 'FF475569' } }

  sheet1.getCell('A6').value = 'Export Date:'
  sheet1.getCell('B6').value = dayjs().format('DD MMM YYYY, HH:mm')
  sheet1.getCell('A6').font = { bold: true, color: { argb: 'FF475569' } }

  // Section 1 Header Row 8
  sheet1.mergeCells('A8:F8')
  const sec1 = sheet1.getCell('A8')
  sec1.value = '1. PERIOD COMPARISON METRICS'
  sec1.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
  sec1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D28D9' } }
  sec1.alignment = { vertical: 'middle', horizontal: 'left' }
  sheet1.getRow(8).height = 26

  // Table Headers Row 9
  const headers1 = ['Financial Metric', `Period A: ${data.labelA}`, `Period B: ${data.labelB}`, 'Variance / Change', 'Change %', 'Trend Indicator']
  const row9 = sheet1.getRow(9)
  headers1.forEach((h, i) => {
    const cell = row9.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
    cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'right' }
  })
  row9.height = 24

  // Metrics Data Rows 10..15
  data.metrics.forEach((m, idx) => {
    const rowNum = 10 + idx
    const row = sheet1.getRow(rowNum)
    row.height = 22

    const delta = m.b - m.a
    const deltaPct = m.a !== 0 ? (delta / Math.abs(m.a)) * 100 : null

    let trend = '— Flat'
    if (Math.abs(delta) >= 0.01) {
      if (delta > 0) trend = deltaPct !== null ? `▲ +${deltaPct.toFixed(1)}% Growth` : '▲ Increase'
      else trend = deltaPct !== null ? `▼ ${deltaPct.toFixed(1)}% Decrease` : '▼ Decrease'
    }

    row.getCell(1).value = m.label
    row.getCell(1).font = { bold: true, color: { argb: 'FF0F172A' } }

    row.getCell(2).value = m.a
    row.getCell(2).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'

    row.getCell(3).value = m.b
    row.getCell(3).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'

    row.getCell(4).value = delta
    row.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'

    row.getCell(5).value = deltaPct !== null ? deltaPct / 100 : 'N/A'
    if (deltaPct !== null) row.getCell(5).numFmt = '+0.0%;-0.0%;0.0%'

    row.getCell(6).value = trend
    row.getCell(6).font = { bold: true, color: { argb: delta >= 0 ? 'FF059669' : 'FFE11D48' } }

    for (let c = 1; c <= 6; c++) {
      const cell = row.getCell(c)
      cell.border = thinBorder
      cell.alignment = { vertical: 'middle', horizontal: c === 1 ? 'left' : 'right' }
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
    }
  })

  // Section 2 Header Row 17
  sheet1.mergeCells('A17:B17')
  const sec2 = sheet1.getCell('A17')
  sec2.value = '2. ALL-TIME FINANCIAL SUMMARY (SINCE INCEPTION)'
  sec2.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
  sec2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }
  sec2.alignment = { vertical: 'middle', horizontal: 'left' }
  sheet1.getRow(17).height = 26

  const row18 = sheet1.getRow(18)
  row18.getCell(1).value = 'All-Time Financial Metric'
  row18.getCell(2).value = 'Total Amount (₹)'
  for (let c = 1; c <= 2; c++) {
    const cell = row18.getCell(c)
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }
    cell.alignment = { vertical: 'middle', horizontal: c === 1 ? 'left' : 'right' }
  }
  row18.height = 24

  const summaryIncome = data.allTimePnl ? Math.abs(Number(data.allTimePnl.income.total)) : 0
  const summaryExpenses = data.allTimePnl ? Math.abs(Number(data.allTimePnl.expense.total)) : 0
  const summaryNetProfit = summaryIncome - summaryExpenses
  const summaryAssets = data.allTimeBs ? Number(data.allTimeBs.total_assets) : 0
  const summaryLiabilities = data.allTimeBs ? Number(data.allTimeBs.liabilities.total) : 0
  const summaryEquity = data.allTimeBs ? Number(data.allTimeBs.total_equity) : 0

  const allTimeRows = [
    { label: 'Total Income (Since Inception)', val: summaryIncome },
    { label: 'Total Expenses (Since Inception)', val: summaryExpenses },
    { label: 'Net Profit / Loss (Since Inception)', val: summaryNetProfit },
    { label: 'Total Assets (Current Holdings)', val: summaryAssets },
    { label: 'Total Liabilities (Current Debt)', val: summaryLiabilities },
    { label: 'Total Equity (Current Net Worth)', val: summaryEquity },
  ]

  allTimeRows.forEach((item, idx) => {
    const rowNum = 19 + idx
    const row = sheet1.getRow(rowNum)
    row.height = 22

    row.getCell(1).value = item.label
    row.getCell(1).font = { bold: true, color: { argb: 'FF0F172A' } }
    row.getCell(1).border = thinBorder

    row.getCell(2).value = item.val
    row.getCell(2).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
    row.getCell(2).font = { bold: true }
    row.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' }
    row.getCell(2).border = thinBorder

    if (idx % 2 === 1) {
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
    }
  })

  // ==========================================
  // SHEET 2: PROFIT & LOSS BREAKDOWN
  // ==========================================
  const sheet2 = workbook.addWorksheet('Profit & Loss Breakdown')

  sheet2.mergeCells('A1:G1')
  const banner2 = sheet2.getCell('A1')
  banner2.value = 'PROFIT & LOSS DETAILED CATEGORY COMPARISON'
  banner2.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  banner2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } }
  banner2.alignment = { vertical: 'middle', horizontal: 'center' }
  sheet2.getRow(1).height = 36

  sheet2.getCell('A2').value = `Account: ${data.accountName} | Period A: ${data.labelA} | Period B: ${data.labelB}`
  sheet2.getCell('A2').font = { italic: true, color: { argb: 'FF64748B' }, size: 10 }

  const headers2 = ['Type', 'Category', 'Sub-Category', `Period A: ${data.labelA}`, `Period B: ${data.labelB}`, 'Variance / Change', 'Change %']
  const row3 = sheet2.getRow(3)
  headers2.forEach((h, i) => {
    const cell = row3.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
    cell.alignment = { vertical: 'middle', horizontal: i < 3 ? 'left' : 'right' }
  })
  row3.height = 24

  let curRow = 4

  // Income Breakdown
  const incomeRows = extractCategoryRows('Income', data.pnlA?.income.categories, data.pnlB?.income.categories)
  let totalIncomeA = 0
  let totalIncomeB = 0

  incomeRows.forEach((r, idx) => {
    totalIncomeA += r.amountA
    totalIncomeB += r.amountB
    const row = sheet2.getRow(curRow)
    row.height = 20
    row.getCell(1).value = 'Income'
    row.getCell(2).value = r.categoryName
    row.getCell(3).value = r.subCategoryName
    row.getCell(4).value = r.amountA
    row.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
    row.getCell(5).value = r.amountB
    row.getCell(5).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
    row.getCell(6).value = r.change
    row.getCell(6).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
    row.getCell(7).value = r.changePct !== null ? r.changePct / 100 : 'N/A'
    if (r.changePct !== null) row.getCell(7).numFmt = '+0.0%;-0.0%;0.0%'

    for (let c = 1; c <= 7; c++) {
      const cell = row.getCell(c)
      cell.border = thinBorder
      cell.alignment = { vertical: 'middle', horizontal: c < 4 ? 'left' : 'right' }
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
    }
    curRow++
  })

  // Total Income Row
  const rowTotIncome = sheet2.getRow(curRow)
  rowTotIncome.height = 24
  rowTotIncome.getCell(1).value = 'TOTAL INCOME'
  rowTotIncome.getCell(4).value = totalIncomeA
  rowTotIncome.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  rowTotIncome.getCell(5).value = totalIncomeB
  rowTotIncome.getCell(5).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  const totIncChange = totalIncomeB - totalIncomeA
  rowTotIncome.getCell(6).value = totIncChange
  rowTotIncome.getCell(6).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  const totIncPct = totalIncomeA !== 0 ? totIncChange / Math.abs(totalIncomeA) : null
  rowTotIncome.getCell(7).value = totIncPct !== null ? totIncPct : 'N/A'
  if (totIncPct !== null) rowTotIncome.getCell(7).numFmt = '+0.0%;-0.0%;0.0%'

  for (let c = 1; c <= 7; c++) {
    const cell = rowTotIncome.getCell(c)
    cell.font = { bold: true, color: { argb: 'FF065F46' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }
    cell.border = totalBorder
    cell.alignment = { vertical: 'middle', horizontal: c < 4 ? 'left' : 'right' }
  }
  curRow += 2

  // Expense Breakdown
  const expenseRows = extractCategoryRows('Expense', data.pnlA?.expense.categories, data.pnlB?.expense.categories)
  let totalExpA = 0
  let totalExpB = 0

  expenseRows.forEach((r, idx) => {
    totalExpA += r.amountA
    totalExpB += r.amountB
    const row = sheet2.getRow(curRow)
    row.height = 20
    row.getCell(1).value = 'Expense'
    row.getCell(2).value = r.categoryName
    row.getCell(3).value = r.subCategoryName
    row.getCell(4).value = r.amountA
    row.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
    row.getCell(5).value = r.amountB
    row.getCell(5).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
    row.getCell(6).value = r.change
    row.getCell(6).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
    row.getCell(7).value = r.changePct !== null ? r.changePct / 100 : 'N/A'
    if (r.changePct !== null) row.getCell(7).numFmt = '+0.0%;-0.0%;0.0%'

    for (let c = 1; c <= 7; c++) {
      const cell = row.getCell(c)
      cell.border = thinBorder
      cell.alignment = { vertical: 'middle', horizontal: c < 4 ? 'left' : 'right' }
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
    }
    curRow++
  })

  // Total Expense Row
  const rowTotExp = sheet2.getRow(curRow)
  rowTotExp.height = 24
  rowTotExp.getCell(1).value = 'TOTAL EXPENSES'
  rowTotExp.getCell(4).value = totalExpA
  rowTotExp.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  rowTotExp.getCell(5).value = totalExpB
  rowTotExp.getCell(5).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  const totExpChange = totalExpB - totalExpA
  rowTotExp.getCell(6).value = totExpChange
  rowTotExp.getCell(6).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  const totExpPct = totalExpA !== 0 ? totExpChange / Math.abs(totalExpA) : null
  rowTotExp.getCell(7).value = totExpPct !== null ? totExpPct : 'N/A'
  if (totExpPct !== null) rowTotExp.getCell(7).numFmt = '+0.0%;-0.0%;0.0%'

  for (let c = 1; c <= 7; c++) {
    const cell = rowTotExp.getCell(c)
    cell.font = { bold: true, color: { argb: 'FF991B1B' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
    cell.border = totalBorder
    cell.alignment = { vertical: 'middle', horizontal: c < 4 ? 'left' : 'right' }
  }
  curRow += 2

  // NET PROFIT SUMMARY ROW
  const netProfitA = totalIncomeA - totalExpA
  const netProfitB = totalIncomeB - totalExpB
  const netProfitChange = netProfitB - netProfitA
  const netProfitPct = netProfitA !== 0 ? netProfitChange / Math.abs(netProfitA) : null

  const rowNetProfit = sheet2.getRow(curRow)
  rowNetProfit.height = 26
  rowNetProfit.getCell(1).value = 'NET PROFIT / (LOSS)'
  rowNetProfit.getCell(4).value = netProfitA
  rowNetProfit.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  rowNetProfit.getCell(5).value = netProfitB
  rowNetProfit.getCell(5).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  rowNetProfit.getCell(6).value = netProfitChange
  rowNetProfit.getCell(6).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  rowNetProfit.getCell(7).value = netProfitPct !== null ? netProfitPct : 'N/A'
  if (netProfitPct !== null) rowNetProfit.getCell(7).numFmt = '+0.0%;-0.0%;0.0%'

  for (let c = 1; c <= 7; c++) {
    const cell = rowNetProfit.getCell(c)
    cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } }
    cell.alignment = { vertical: 'middle', horizontal: c < 4 ? 'left' : 'right' }
  }

  // ==========================================
  // SHEET 3: BALANCE SHEET BREAKDOWN
  // ==========================================
  const sheet3 = workbook.addWorksheet('Balance Sheet Breakdown')

  sheet3.mergeCells('A1:G1')
  const banner3 = sheet3.getCell('A1')
  banner3.value = 'BALANCE SHEET DETAILED CATEGORY COMPARISON'
  banner3.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  banner3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } }
  banner3.alignment = { vertical: 'middle', horizontal: 'center' }
  sheet3.getRow(1).height = 36

  sheet3.getCell('A2').value = `Account: ${data.accountName} | Period A: ${data.labelA} | Period B: ${data.labelB}`
  sheet3.getCell('A2').font = { italic: true, color: { argb: 'FF64748B' }, size: 10 }

  const headers3 = ['Section', 'Category', 'Sub-Category', `Period A: ${data.labelA}`, `Period B: ${data.labelB}`, 'Variance / Change', 'Change %']
  const row3_bs = sheet3.getRow(3)
  headers3.forEach((h, i) => {
    const cell = row3_bs.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
    cell.alignment = { vertical: 'middle', horizontal: i < 3 ? 'left' : 'right' }
  })
  row3_bs.height = 24

  let curRow3 = 4

  const renderBSSection = (
    sectionTitle: string,
    groupsA: ProfitAndLossCategoryGroup[] = [],
    groupsB: ProfitAndLossCategoryGroup[] = [],
    overrideTotalA?: number,
    overrideTotalB?: number,
    headerBg = 'FFD1FAE5',
    headerText = 'FF065F46'
  ) => {
    const rows = extractCategoryRows(sectionTitle, groupsA, groupsB)
    let sectionTotA = overrideTotalA !== undefined ? overrideTotalA : 0
    let sectionTotB = overrideTotalB !== undefined ? overrideTotalB : 0

    rows.forEach((r, idx) => {
      if (overrideTotalA === undefined) sectionTotA += r.amountA
      if (overrideTotalB === undefined) sectionTotB += r.amountB

      const row = sheet3.getRow(curRow3)
      row.height = 20
      row.getCell(1).value = sectionTitle
      row.getCell(2).value = r.categoryName
      row.getCell(3).value = r.subCategoryName
      row.getCell(4).value = r.amountA
      row.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
      row.getCell(5).value = r.amountB
      row.getCell(5).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
      row.getCell(6).value = r.change
      row.getCell(6).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
      row.getCell(7).value = r.changePct !== null ? r.changePct / 100 : 'N/A'
      if (r.changePct !== null) row.getCell(7).numFmt = '+0.0%;-0.0%;0.0%'

      for (let c = 1; c <= 7; c++) {
        const cell = row.getCell(c)
        cell.border = thinBorder
        cell.alignment = { vertical: 'middle', horizontal: c < 4 ? 'left' : 'right' }
        if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
      }
      curRow3++
    })

    // Total Row for section
    const rowTot = sheet3.getRow(curRow3)
    rowTot.height = 24
    rowTot.getCell(1).value = `TOTAL ${sectionTitle.toUpperCase()}`
    rowTot.getCell(4).value = sectionTotA
    rowTot.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
    rowTot.getCell(5).value = sectionTotB
    rowTot.getCell(5).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
    const chg = sectionTotB - sectionTotA
    rowTot.getCell(6).value = chg
    rowTot.getCell(6).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
    const pct = sectionTotA !== 0 ? chg / Math.abs(sectionTotA) : null
    rowTot.getCell(7).value = pct !== null ? pct : 'N/A'
    if (pct !== null) rowTot.getCell(7).numFmt = '+0.0%;-0.0%;0.0%'

    for (let c = 1; c <= 7; c++) {
      const cell = rowTot.getCell(c)
      cell.font = { bold: true, color: { argb: headerText } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerBg } }
      cell.border = totalBorder
      cell.alignment = { vertical: 'middle', horizontal: c < 4 ? 'left' : 'right' }
    }
    curRow3 += 2
  }

  // 1. Assets Section
  const assetsTotA = data.bsA ? Number(data.bsA.total_assets || 0) : undefined
  const assetsTotB = data.bsB ? Number(data.bsB.total_assets || 0) : undefined
  renderBSSection('Assets', data.bsA?.assets.categories, data.bsB?.assets.categories, assetsTotA, assetsTotB, 'FFEDE9FE', 'FF5B21B6')

  // 2. Liabilities Section
  const liabTotA = data.bsA ? Number(data.bsA.liabilities.total || 0) : undefined
  const liabTotB = data.bsB ? Number(data.bsB.liabilities.total || 0) : undefined
  renderBSSection('Liabilities', data.bsA?.liabilities.categories, data.bsB?.liabilities.categories, liabTotA, liabTotB, 'FFFEF3C7', 'FFB45309')

  // 3. Equity Section
  const eqTotA = data.bsA ? Number(data.bsA.total_equity || 0) : undefined
  const eqTotB = data.bsB ? Number(data.bsB.total_equity || 0) : undefined
  renderBSSection('Equity', data.bsA?.equity.categories, data.bsB?.equity.categories, eqTotA, eqTotB, 'FFE0F2FE', 'FF0369A1')

  // Adjust column widths across all sheets
  ;[sheet1, sheet2, sheet3].forEach((sheet) => {
    sheet.columns.forEach((col) => {
      let maxLen = 14
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const val = cell.value ? cell.value.toString() : ''
        if (val.length > maxLen) maxLen = Math.min(val.length, 50)
      })
      col.width = maxLen + 4
    })
  })

  // Write buffer & download file
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `Period_Comparison_Financial_Report_${dayjs().format('YYYY-MM-DD')}.xlsx`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.URL.revokeObjectURL(url)
}

export interface ExportPnlOptions {
  report: ProfitAndLossReport
  accountName: string
  periodLabel: string
  dateRangeText?: string
}

/**
 * Downloads an attractive, comprehensive multi-tab Excel workbook for Profit & Loss Statement.
 */
/** Adds the ProfitAndLoss sheets to a workbook (also used by the Financial Pack). */
function addProfitAndLossSheets(workbook: ExcelJS.Workbook, data: ExportPnlOptions) {
  const { report, accountName, periodLabel, dateRangeText } = data

  const incomeTotal = Math.abs(Number(report.income.total))
  const expenseTotal = Math.abs(Number(report.expense.total))
  const netProfit = incomeTotal - expenseTotal
  const isProfit = netProfit >= 0
  const margin = incomeTotal > 0 ? ((netProfit / incomeTotal) * 100).toFixed(2) : '0.00'

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  }

  const totalBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FF0F172A' } },
    bottom: { style: 'double', color: { argb: 'FF0F172A' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  }

  // SHEET 1: Executive Summary
  const sheet1 = workbook.addWorksheet('P&L Summary')

  sheet1.mergeCells('A1:D1')
  const b1 = sheet1.getCell('A1')
  b1.value = 'PROFIT & LOSS STATEMENT REPORT'
  b1.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  b1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } }
  b1.alignment = { vertical: 'middle', horizontal: 'center' }
  sheet1.getRow(1).height = 36

  sheet1.getCell('A3').value = 'Bank Account:'
  sheet1.getCell('B3').value = accountName
  sheet1.getCell('A3').font = { bold: true, color: { argb: 'FF475569' } }
  sheet1.getCell('B3').font = { bold: true, color: { argb: 'FF0F172A' } }

  sheet1.getCell('A4').value = 'Report Period:'
  sheet1.getCell('B4').value = `${periodLabel}${dateRangeText ? ' (' + dateRangeText + ')' : ''}`
  sheet1.getCell('A4').font = { bold: true, color: { argb: 'FF475569' } }

  sheet1.getCell('A5').value = 'Generated:'
  sheet1.getCell('B5').value = dayjs().format('DD MMM YYYY, HH:mm')
  sheet1.getCell('A5').font = { bold: true, color: { argb: 'FF475569' } }

  // KPI Summary Block
  sheet1.mergeCells('A7:D7')
  const kpiH = sheet1.getCell('A7')
  kpiH.value = 'FINANCIAL PERFORMANCE SUMMARY'
  kpiH.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
  kpiH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D28D9' } }
  sheet1.getRow(7).height = 26

  const kpis = [
    { label: 'TOTAL INCOME', val: incomeTotal, color: 'FF059669' },
    { label: 'TOTAL EXPENSES', val: expenseTotal, color: 'FFE11D48' },
    { label: isProfit ? 'NET PROFIT' : 'NET LOSS', val: netProfit, color: isProfit ? 'FF059669' : 'FFE11D48' },
    { label: 'PROFIT MARGIN (%)', val: `${margin}%`, color: 'FF475569', isString: true },
  ]

  const kpiHeaders = ['KPI Metric', 'Amount (₹)']
  const row8 = sheet1.getRow(8)
  kpiHeaders.forEach((h, i) => {
    const cell = row8.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
  })
  row8.height = 24

  kpis.forEach((k, idx) => {
    const row = sheet1.getRow(9 + idx)
    row.height = 22
    row.getCell(1).value = k.label
    row.getCell(1).font = { bold: true, color: { argb: 'FF0F172A' } }
    row.getCell(1).border = thinBorder

    if (k.isString) {
      row.getCell(2).value = k.val
    } else {
      row.getCell(2).value = k.val
      row.getCell(2).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
    }
    row.getCell(2).font = { bold: true, color: { argb: k.color } }
    row.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' }
    row.getCell(2).border = thinBorder
  })

  // SHEET 2: Detailed P&L
  const sheet2 = workbook.addWorksheet('P&L Breakdown')

  sheet2.mergeCells('A1:D1')
  const b2 = sheet2.getCell('A1')
  b2.value = 'PROFIT & LOSS ITEMIZED BREAKDOWN'
  b2.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  b2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } }
  b2.alignment = { vertical: 'middle', horizontal: 'center' }
  sheet2.getRow(1).height = 36

  sheet2.getCell('A2').value = `Account: ${accountName} | Period: ${periodLabel}`
  sheet2.getCell('A2').font = { italic: true, color: { argb: 'FF64748B' }, size: 10 }

  const headers2 = ['Type', 'Category', 'Sub-Category', 'Amount (₹)']
  const r3 = sheet2.getRow(3)
  headers2.forEach((h, i) => {
    const cell = r3.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
    cell.alignment = { vertical: 'middle', horizontal: i === 3 ? 'right' : 'left' }
  })
  r3.height = 24

  let curR = 4

  // Income
  report.income.categories.forEach((cat) => {
    cat.subcategories.forEach((sub) => {
      const row = sheet2.getRow(curR)
      row.height = 20
      row.getCell(1).value = 'Income'
      row.getCell(2).value = cat.category_name
      row.getCell(3).value = sub.sub_category_name
      row.getCell(4).value = Math.abs(Number(sub.amount))
      row.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
      row.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' }
      for (let c = 1; c <= 4; c++) row.getCell(c).border = thinBorder
      curR++
    })
  })

  // Total Income
  const rIncTot = sheet2.getRow(curR)
  rIncTot.height = 24
  rIncTot.getCell(1).value = 'TOTAL INCOME'
  rIncTot.getCell(4).value = incomeTotal
  rIncTot.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  rIncTot.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' }
  for (let c = 1; c <= 4; c++) {
    const cell = rIncTot.getCell(c)
    cell.font = { bold: true, color: { argb: 'FF065F46' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }
    cell.border = totalBorder
  }
  curR += 2

  // Expenses
  report.expense.categories.forEach((cat) => {
    cat.subcategories.forEach((sub) => {
      const row = sheet2.getRow(curR)
      row.height = 20
      row.getCell(1).value = 'Expense'
      row.getCell(2).value = cat.category_name
      row.getCell(3).value = sub.sub_category_name
      row.getCell(4).value = Math.abs(Number(sub.amount))
      row.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
      row.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' }
      for (let c = 1; c <= 4; c++) row.getCell(c).border = thinBorder
      curR++
    })
  })

  // Total Expenses
  const rExpTot = sheet2.getRow(curR)
  rExpTot.height = 24
  rExpTot.getCell(1).value = 'TOTAL EXPENSES'
  rExpTot.getCell(4).value = expenseTotal
  rExpTot.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  rExpTot.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' }
  for (let c = 1; c <= 4; c++) {
    const cell = rExpTot.getCell(c)
    cell.font = { bold: true, color: { argb: 'FF991B1B' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
    cell.border = totalBorder
  }
  curR += 2

  // Net Profit
  const rNP = sheet2.getRow(curR)
  rNP.height = 26
  rNP.getCell(1).value = 'NET PROFIT / (LOSS)'
  rNP.getCell(4).value = netProfit
  rNP.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  rNP.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' }
  for (let c = 1; c <= 4; c++) {
    const cell = rNP.getCell(c)
    cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } }
  }

  // Adjust column widths
  ;[sheet1, sheet2].forEach((sheet) => {
    sheet.columns.forEach((col) => {
      let maxLen = 14
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const val = cell.value ? cell.value.toString() : ''
        if (val.length > maxLen) maxLen = Math.min(val.length, 50)
      })
      col.width = maxLen + 4
    })
  })

}

export async function exportProfitAndLossReportToExcel(data: ExportPnlOptions) {
  const workbook = await newWorkbook()
  addProfitAndLossSheets(workbook, data)
  await downloadWorkbook(workbook, `Profit_and_Loss_Statement_${dayjs().format('YYYY-MM-DD')}.xlsx`)
}

export interface ExportBalanceSheetOptions {
  report: BalanceSheetReport
  accountName: string
  periodLabel: string
  asOfDateText?: string
}

/**
 * Downloads an attractive, comprehensive multi-tab Excel workbook for Balance Sheet.
 */
/** Adds the BalanceSheet sheets to a workbook (also used by the Financial Pack). */
function addBalanceSheetSheets(workbook: ExcelJS.Workbook, data: ExportBalanceSheetOptions) {
  const { report, accountName, periodLabel, asOfDateText } = data

  const totalAssets = Number(report.total_assets || 0)
  const totalLiabilities = Number(report.liabilities.total || 0)
  const totalEquity = Number(report.total_equity || 0)
  const totalLiabEq = Number(report.total_liabilities_and_equity || 0)
  const diff = totalAssets - totalLiabEq
  const isBalanced = report.is_balanced

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  }

  const totalBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FF0F172A' } },
    bottom: { style: 'double', color: { argb: 'FF0F172A' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  }

  // SHEET 1: Summary
  const sheet1 = workbook.addWorksheet('Balance Sheet Summary')

  sheet1.mergeCells('A1:D1')
  const b1 = sheet1.getCell('A1')
  b1.value = 'BALANCE SHEET STATEMENT REPORT'
  b1.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  b1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } }
  b1.alignment = { vertical: 'middle', horizontal: 'center' }
  sheet1.getRow(1).height = 36

  sheet1.getCell('A3').value = 'Bank Account:'
  sheet1.getCell('B3').value = accountName
  sheet1.getCell('A3').font = { bold: true, color: { argb: 'FF475569' } }
  sheet1.getCell('B3').font = { bold: true, color: { argb: 'FF0F172A' } }

  sheet1.getCell('A4').value = 'As of Period:'
  sheet1.getCell('B4').value = `${periodLabel}${asOfDateText ? ' (' + asOfDateText + ')' : ''}`
  sheet1.getCell('A4').font = { bold: true, color: { argb: 'FF475569' } }

  sheet1.getCell('A5').value = 'Equilibrium Status:'
  sheet1.getCell('B5').value = isBalanced ? '✓ BALANCED (Assets = Liabilities + Equity)' : `⚠ OUT OF BALANCE by ₹${Math.abs(diff).toFixed(2)}`
  sheet1.getCell('A5').font = { bold: true, color: { argb: 'FF475569' } }
  sheet1.getCell('B5').font = { bold: true, color: { argb: isBalanced ? 'FF059669' : 'FFD97706' } }

  sheet1.mergeCells('A7:D7')
  const kpiH = sheet1.getCell('A7')
  kpiH.value = 'FINANCIAL POSITION SUMMARY'
  kpiH.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
  kpiH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D28D9' } }
  sheet1.getRow(7).height = 26

  const kpis = [
    { label: 'TOTAL ASSETS', val: totalAssets, color: 'FF6D28D9' },
    { label: 'TOTAL LIABILITIES', val: totalLiabilities, color: 'FFB45309' },
    { label: 'RETAINED EARNINGS (PROFIT)', val: Number(report.retained_earnings || 0), color: 'FF0369A1' },
    { label: 'TOTAL EQUITY', val: totalEquity, color: 'FF0369A1' },
    { label: 'TOTAL LIABILITIES & EQUITY', val: totalLiabEq, color: 'FF0F172A' },
  ]

  const row8 = sheet1.getRow(8)
  row8.getCell(1).value = 'Balance Sheet Component'
  row8.getCell(2).value = 'Amount (₹)'
  row8.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  row8.getCell(2).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  row8.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
  row8.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
  row8.height = 24

  kpis.forEach((k, idx) => {
    const row = sheet1.getRow(9 + idx)
    row.height = 22
    row.getCell(1).value = k.label
    row.getCell(1).font = { bold: true, color: { argb: 'FF0F172A' } }
    row.getCell(1).border = thinBorder

    row.getCell(2).value = k.val
    row.getCell(2).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
    row.getCell(2).font = { bold: true, color: { argb: k.color } }
    row.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' }
    row.getCell(2).border = thinBorder
  })

  // SHEET 2: Detailed Balance Sheet Breakdown
  const sheet2 = workbook.addWorksheet('Balance Sheet Breakdown')

  sheet2.mergeCells('A1:D1')
  const b2 = sheet2.getCell('A1')
  b2.value = 'BALANCE SHEET ITEMIZED BREAKDOWN'
  b2.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  b2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } }
  b2.alignment = { vertical: 'middle', horizontal: 'center' }
  sheet2.getRow(1).height = 36

  sheet2.getCell('A2').value = `Account: ${accountName} | As of: ${periodLabel}`
  sheet2.getCell('A2').font = { italic: true, color: { argb: 'FF64748B' }, size: 10 }

  const headers2 = ['Section', 'Category', 'Sub-Category', 'Amount (₹)']
  const r3 = sheet2.getRow(3)
  headers2.forEach((h, i) => {
    const cell = r3.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
    cell.alignment = { vertical: 'middle', horizontal: i === 3 ? 'right' : 'left' }
  })
  r3.height = 24

  let curR = 4

  // Assets
  report.assets.categories.forEach((cat) => {
    cat.subcategories.forEach((sub) => {
      const row = sheet2.getRow(curR)
      row.height = 20
      row.getCell(1).value = 'Assets'
      row.getCell(2).value = cat.category_name
      row.getCell(3).value = sub.sub_category_name
      row.getCell(4).value = Number(sub.amount)
      row.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
      row.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' }
      for (let c = 1; c <= 4; c++) row.getCell(c).border = thinBorder
      curR++
    })
  })

  const rAssTot = sheet2.getRow(curR)
  rAssTot.height = 24
  rAssTot.getCell(1).value = 'TOTAL ASSETS'
  rAssTot.getCell(4).value = totalAssets
  rAssTot.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  rAssTot.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' }
  for (let c = 1; c <= 4; c++) {
    const cell = rAssTot.getCell(c)
    cell.font = { bold: true, color: { argb: 'FF5B21B6' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } }
    cell.border = totalBorder
  }
  curR += 2

  // Liabilities
  report.liabilities.categories.forEach((cat) => {
    cat.subcategories.forEach((sub) => {
      const row = sheet2.getRow(curR)
      row.height = 20
      row.getCell(1).value = 'Liabilities'
      row.getCell(2).value = cat.category_name
      row.getCell(3).value = sub.sub_category_name
      row.getCell(4).value = Number(sub.amount)
      row.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
      row.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' }
      for (let c = 1; c <= 4; c++) row.getCell(c).border = thinBorder
      curR++
    })
  })

  const rLiabTot = sheet2.getRow(curR)
  rLiabTot.height = 24
  rLiabTot.getCell(1).value = 'TOTAL LIABILITIES'
  rLiabTot.getCell(4).value = totalLiabilities
  rLiabTot.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  rLiabTot.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' }
  for (let c = 1; c <= 4; c++) {
    const cell = rLiabTot.getCell(c)
    cell.font = { bold: true, color: { argb: 'FFB45309' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
    cell.border = totalBorder
  }
  curR += 2

  // Equity
  report.equity.categories.forEach((cat) => {
    cat.subcategories.forEach((sub) => {
      const row = sheet2.getRow(curR)
      row.height = 20
      row.getCell(1).value = 'Equity'
      row.getCell(2).value = cat.category_name
      row.getCell(3).value = sub.sub_category_name
      row.getCell(4).value = Number(sub.amount)
      row.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
      row.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' }
      for (let c = 1; c <= 4; c++) row.getCell(c).border = thinBorder
      curR++
    })
  })

  // Retained Earnings
  const rRE = sheet2.getRow(curR)
  rRE.height = 20
  rRE.getCell(1).value = 'Equity'
  rRE.getCell(2).value = 'Retained Earnings'
  rRE.getCell(3).value = 'Current Period Profit (P&L)'
  rRE.getCell(4).value = Number(report.retained_earnings || 0)
  rRE.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  rRE.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' }
  for (let c = 1; c <= 4; c++) rRE.getCell(c).border = thinBorder
  curR++

  const rEqTot = sheet2.getRow(curR)
  rEqTot.height = 24
  rEqTot.getCell(1).value = 'TOTAL EQUITY'
  rEqTot.getCell(4).value = totalEquity
  rEqTot.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  rEqTot.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' }
  for (let c = 1; c <= 4; c++) {
    const cell = rEqTot.getCell(c)
    cell.font = { bold: true, color: { argb: 'FF0369A1' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } }
    cell.border = totalBorder
  }
  curR += 2

  // Total Liab + Eq
  const rLiabEq = sheet2.getRow(curR)
  rLiabEq.height = 26
  rLiabEq.getCell(1).value = 'TOTAL LIABILITIES & EQUITY'
  rLiabEq.getCell(4).value = totalLiabEq
  rLiabEq.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  rLiabEq.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' }
  for (let c = 1; c <= 4; c++) {
    const cell = rLiabEq.getCell(c)
    cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }
  }

  // Column width auto
  ;[sheet1, sheet2].forEach((sheet) => {
    sheet.columns.forEach((col) => {
      let maxLen = 14
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const val = cell.value ? cell.value.toString() : ''
        if (val.length > maxLen) maxLen = Math.min(val.length, 50)
      })
      col.width = maxLen + 4
    })
  })

}

export async function exportBalanceSheetReportToExcel(data: ExportBalanceSheetOptions) {
  const workbook = await newWorkbook()
  addBalanceSheetSheets(workbook, data)
  await downloadWorkbook(workbook, `Balance_Sheet_Report_${dayjs().format('YYYY-MM-DD')}.xlsx`)
}

export interface ExportTrialBalanceOptions {
  report: import('../types').TrialBalanceReport
  accountName: string
  periodLabel: string
  dateRangeText?: string
}

/**
 * Downloads an attractive, comprehensive multi-tab Excel workbook for Trial Balance.
 */
/** Adds the TrialBalance sheets to a workbook (also used by the Financial Pack). */
function addTrialBalanceSheets(workbook: ExcelJS.Workbook, data: ExportTrialBalanceOptions) {
  const { report, accountName, periodLabel, dateRangeText } = data

  const totalDebit = Number(report.total_debit || 0)
  const totalCredit = Number(report.total_credit || 0)
  const diff = Math.abs(totalDebit - totalCredit)
  const isBalanced = report.is_balanced

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  }

  // SHEET 1: Summary & Equilibrium
  const sheet1 = workbook.addWorksheet('Trial Balance Summary')

  sheet1.mergeCells('A1:D1')
  const b1 = sheet1.getCell('A1')
  b1.value = 'TRIAL BALANCE STATEMENT REPORT'
  b1.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  b1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } }
  b1.alignment = { vertical: 'middle', horizontal: 'center' }
  sheet1.getRow(1).height = 36

  sheet1.getCell('A3').value = 'Bank Account:'
  sheet1.getCell('B3').value = accountName
  sheet1.getCell('A3').font = { bold: true, color: { argb: 'FF475569' } }
  sheet1.getCell('B3').font = { bold: true, color: { argb: 'FF0F172A' } }

  sheet1.getCell('A4').value = 'Report Period:'
  sheet1.getCell('B4').value = `${periodLabel}${dateRangeText ? ' (' + dateRangeText + ')' : ''}`
  sheet1.getCell('A4').font = { bold: true, color: { argb: 'FF475569' } }

  sheet1.getCell('A5').value = 'Equilibrium Status:'
  sheet1.getCell('B5').value = isBalanced ? '✓ BALANCED (Total Debits = Total Credits)' : `⚠ OUT OF BALANCE by ₹${diff.toFixed(2)}`
  sheet1.getCell('A5').font = { bold: true, color: { argb: 'FF475569' } }
  sheet1.getCell('B5').font = { bold: true, color: { argb: isBalanced ? 'FF059669' : 'FFD97706' } }

  sheet1.mergeCells('A7:D7')
  const kpiH = sheet1.getCell('A7')
  kpiH.value = 'DOUBLE-ENTRY EQUILIBRIUM SUMMARY'
  kpiH.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
  kpiH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D28D9' } }
  sheet1.getRow(7).height = 26

  const kpis = [
    { label: 'TOTAL DEBITS', val: totalDebit, color: 'FF6D28D9' },
    { label: 'TOTAL CREDITS', val: totalCredit, color: 'FF059669' },
    { label: 'DIFFERENCE', val: diff, color: isBalanced ? 'FF059669' : 'FFD97706' },
  ]

  const row8 = sheet1.getRow(8)
  row8.getCell(1).value = 'Equilibrium Component'
  row8.getCell(2).value = 'Amount (₹)'
  row8.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  row8.getCell(2).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  row8.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
  row8.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
  row8.height = 24

  kpis.forEach((k, idx) => {
    const row = sheet1.getRow(9 + idx)
    row.height = 22
    row.getCell(1).value = k.label
    row.getCell(1).font = { bold: true, color: { argb: 'FF0F172A' } }
    row.getCell(1).border = thinBorder

    row.getCell(2).value = k.val
    row.getCell(2).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
    row.getCell(2).font = { bold: true, color: { argb: k.color } }
    row.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' }
    row.getCell(2).border = thinBorder
  })

  // SHEET 2: Detailed Trial Balance Ledger
  const sheet2 = workbook.addWorksheet('Trial Balance Ledger')

  sheet2.mergeCells('A1:E1')
  const b2 = sheet2.getCell('A1')
  b2.value = 'TRIAL BALANCE ITEMIZED LEDGER'
  b2.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  b2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } }
  b2.alignment = { vertical: 'middle', horizontal: 'center' }
  sheet2.getRow(1).height = 36

  sheet2.getCell('A2').value = `Account: ${accountName} | Period: ${periodLabel}`
  sheet2.getCell('A2').font = { italic: true, color: { argb: 'FF64748B' }, size: 10 }

  const headers2 = ['Account Type', 'Category Name', 'Sub-Category Name', 'Debit Balance (₹)', 'Credit Balance (₹)']
  const r3 = sheet2.getRow(3)
  headers2.forEach((h, i) => {
    const cell = r3.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
    cell.alignment = { vertical: 'middle', horizontal: i >= 3 ? 'right' : 'left' }
  })
  r3.height = 24

  let curR = 4

  Object.entries(report.account_types).forEach(([acctType, items]) => {
    let subTotDebit = 0
    let subTotCredit = 0

    items.forEach((item) => {
      const d = Number(item.debit) || 0
      const c = Number(item.credit) || 0
      subTotDebit += d
      subTotCredit += c

      const row = sheet2.getRow(curR)
      row.height = 20
      row.getCell(1).value = acctType
      row.getCell(2).value = item.category_name
      row.getCell(3).value = item.sub_category_name
      row.getCell(4).value = d > 0 ? d : 0
      row.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
      row.getCell(5).value = c > 0 ? c : 0
      row.getCell(5).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'

      for (let i = 1; i <= 5; i++) {
        const cell = row.getCell(i)
        cell.border = thinBorder
        cell.alignment = { vertical: 'middle', horizontal: i >= 4 ? 'right' : 'left' }
      }
      curR++
    })

    // Account type subtotal
    const rowSub = sheet2.getRow(curR)
    rowSub.height = 22
    rowSub.getCell(1).value = `Subtotal — ${acctType}`
    rowSub.getCell(4).value = subTotDebit
    rowSub.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
    rowSub.getCell(5).value = subTotCredit
    rowSub.getCell(5).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'

    for (let i = 1; i <= 5; i++) {
      const cell = rowSub.getCell(i)
      cell.font = { bold: true, color: { argb: 'FF334155' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
      cell.border = thinBorder
      cell.alignment = { vertical: 'middle', horizontal: i >= 4 ? 'right' : 'left' }
    }
    curR++
  })

  // Grand Total Row
  const rowGrand = sheet2.getRow(curR)
  rowGrand.height = 26
  rowGrand.getCell(1).value = 'GRAND TOTALS'
  rowGrand.getCell(4).value = totalDebit
  rowGrand.getCell(4).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'
  rowGrand.getCell(5).value = totalCredit
  rowGrand.getCell(5).numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00;"₹"0.00'

  for (let i = 1; i <= 5; i++) {
    const cell = rowGrand.getCell(i)
    cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
    cell.alignment = { vertical: 'middle', horizontal: i >= 4 ? 'right' : 'left' }
  }

  // Adjust widths
  ;[sheet1, sheet2].forEach((sheet) => {
    sheet.columns.forEach((col) => {
      let maxLen = 14
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const val = cell.value ? cell.value.toString() : ''
        if (val.length > maxLen) maxLen = Math.min(val.length, 50)
      })
      col.width = maxLen + 4
    })
  })

}

export async function exportTrialBalanceReportToExcel(data: ExportTrialBalanceOptions) {
  const workbook = await newWorkbook()
  addTrialBalanceSheets(workbook, data)
  await downloadWorkbook(workbook, `Trial_Balance_Report_${dayjs().format('YYYY-MM-DD')}.xlsx`)
}

export interface ExportFinancialPackOptions {
  trialBalance: ExportTrialBalanceOptions
  profitAndLoss: ExportPnlOptions
  balanceSheet: ExportBalanceSheetOptions
}

/**
 * Downloads one workbook with the Trial Balance, Profit & Loss and Balance Sheet for the same period.
 */
export async function exportFinancialPackToExcel(data: ExportFinancialPackOptions) {
  const workbook = await newWorkbook()
  addTrialBalanceSheets(workbook, data.trialBalance)
  addProfitAndLossSheets(workbook, data.profitAndLoss)
  addBalanceSheetSheets(workbook, data.balanceSheet)
  await downloadWorkbook(workbook, `Financial_Pack_${dayjs().format('YYYY-MM-DD')}.xlsx`)
}
