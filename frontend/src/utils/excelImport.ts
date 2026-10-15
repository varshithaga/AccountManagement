/** Reading uploaded .xlsx files - shared by every Excel import dialog. */

/** A cell's value as plain text. ExcelJS gives formula cells as {formula, result}, rich text as
 * {richText: [...]} and hyperlinks as {text, hyperlink}; dates stay Dates (stringified here). */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return String(value)
  if (typeof value === 'object') {
    const v = value as { result?: unknown; richText?: { text: string }[]; text?: unknown; error?: string }
    if ('result' in v || 'formula' in v || 'sharedFormula' in v) return cellText(v.result)
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('')
    if (v.text !== undefined) return cellText(v.text)
    if (v.error) return ''
  }
  return String(value)
}

/** Reads the first sheet of an .xlsx file into rows keyed by lower-cased header text. */
export async function readWorkbookRows(file: File): Promise<Record<string, string>[]> {
  const { default: ExcelJS } = await import('exceljs')
  const buffer = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) return []

  const headerRow = sheet.getRow(1)
  const columnIndexByHeader: Record<string, number> = {}
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = cellText(cell.value).trim().toLowerCase()
    if (text) columnIndexByHeader[text] = colNumber
  })

  const rows: Record<string, string>[] = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const raw: Record<string, string> = {}
    let hasValue = false
    for (const header of Object.keys(columnIndexByHeader)) {
      const text = cellText(row.getCell(columnIndexByHeader[header]).value).trim()
      raw[header] = text
      if (text) hasValue = true
    }
    if (hasValue) rows.push(raw)
  })
  return rows
}
