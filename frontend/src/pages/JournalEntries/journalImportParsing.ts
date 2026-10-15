/**
 * Turns the rows of a journal entry Excel file into entries for the import API,
 * keeping each row's Excel row number so every problem can be traced back to the sheet.
 */
import type { JournalImportEntry } from './journalentriesapi'

/** One Excel row = one debit or credit line. */
export interface JournalExcelLine {
  rowNumber: number
  entry_number: string
  date: string
  rawDate: string
  narration: string
  category_name: string
  sub_category_id: string
  sub_category_name: string
  debit: string
  credit: string
  description: string
  /** Problems found in this row on its own (missing account, bad amount...). */
  errors: string[]
}

/** Rows grouped by Entry No - one journal entry as it appears in the file. */
export interface JournalFileEntry {
  key: string
  entry_number: string
  date: string
  narration: string
  rows: JournalExcelLine[]
  /** Problems found in the file itself; entries with any are not sent for server analysis. */
  errors: string[]
  /** Things in the file worth a look that don't block the import. */
  warnings: string[]
  totalDebit: number
  totalCredit: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Excel dates arrive as ISO text, DD-MM-YYYY / DD/MM/YYYY text, or a stringified JS Date
 * (ExcelJS reads real date cells as UTC midnight). Returns YYYY-MM-DD, or '' if unreadable. */
export function normalizeDate(text: string): string {
  const t = text.trim()
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`
  const d = new Date(t)
  if (!t || Number.isNaN(d.getTime())) return ''
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** '' for blank, the cleaned number text if valid, or null if not a valid non-negative amount. */
function normalizeAmount(text: string): string | null {
  const t = text.replace(/,/g, '').trim()
  if (!t) return ''
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? t : null
}

export function parseJournalRow(raw: Record<string, string>, rowNumber: number): JournalExcelLine {
  const entry_number = (raw['entry no'] || raw['entry number'] || raw['voucher no'] || '').trim()
  const rawDate = (raw['date'] || '').trim()
  const sub_category_id = (raw['sub category id'] || raw['sub_category_id'] || '').trim()
  const sub_category_name = (raw['sub category name'] || raw['sub_category_name'] || raw['sub category']
    || raw['account'] || '').trim()
  const debit = normalizeAmount(raw['debit'] || '')
  const credit = normalizeAmount(raw['credit'] || '')
  const date = normalizeDate(rawDate)

  const errors: string[] = []
  if (!entry_number) errors.push('Entry No is empty')
  if (!rawDate) errors.push('Date is empty')
  else if (!date) errors.push(`Date "${rawDate}" is not a valid date`)
  // An empty sub category is not a file error: Analyse reports it and the dialog lets the user choose one.
  if (sub_category_id && !/^\d+$/.test(sub_category_id)) errors.push(`Sub Category ID "${sub_category_id}" is not a number`)
  if (debit === null) errors.push('Debit is not a valid amount')
  if (credit === null) errors.push('Credit is not a valid amount')
  if (debit !== null && credit !== null && (Number(debit || 0) > 0) === (Number(credit || 0) > 0)) {
    errors.push('needs either a Debit or a Credit amount (exactly one)')
  }

  return {
    rowNumber,
    entry_number,
    date,
    rawDate,
    narration: (raw['narration'] || '').trim(),
    category_name: (raw['category'] || '').trim(),
    sub_category_id,
    sub_category_name,
    debit: debit || '',
    credit: credit || '',
    description: (raw['line description'] || raw['description'] || '').trim(),
    errors,
  }
}

/** Groups rows by Entry No (rows without one each become their own entry, flagged as an error). */
export function groupJournalRows(lines: JournalExcelLine[]): JournalFileEntry[] {
  const byKey = new Map<string, JournalFileEntry>()
  for (const line of lines) {
    const key = line.entry_number || `#row-${line.rowNumber}`
    let entry = byKey.get(key)
    if (!entry) {
      entry = { key, entry_number: line.entry_number, date: line.date, narration: line.narration, rows: [], errors: [], warnings: [], totalDebit: 0, totalCredit: 0 }
      byKey.set(key, entry)
    }
    entry.rows.push(line)
    if (!entry.narration && line.narration) entry.narration = line.narration
    if (!entry.date && line.date) entry.date = line.date
    entry.totalDebit += Number(line.debit || 0)
    entry.totalCredit += Number(line.credit || 0)
  }

  for (const entry of byKey.values()) {
    for (const line of entry.rows) {
      for (const err of line.errors) entry.errors.push(`Row ${line.rowNumber}: ${err}`)
    }
    const dates = new Set(entry.rows.map((r) => r.date).filter(Boolean))
    if (dates.size > 1) entry.errors.push(`its rows have different dates (${[...dates].join(', ')})`)
    if (entry.rows.length < 2) entry.errors.push('needs at least 2 rows (a debit and a credit)')
    const nums = entry.rows.map((r) => r.rowNumber)
    if (entry.entry_number && nums.some((n, i) => i > 0 && n !== nums[i - 1] + 1)) {
      entry.warnings.push(
        `its rows are not together (rows ${nums.join(', ')}) - they are imported as ONE entry; `
        + 'if these are different transactions, give them different Entry Nos',
      )
    }
  }
  return [...byKey.values()]
}

/** Which account reference a line uses - lines naming the same unknown account share one fix.
 * A line with neither a name nor an id is its own reference. */
export function accountRefKey(line: JournalExcelLine): string {
  if (line.sub_category_name) return `name:${line.sub_category_name.toLowerCase()}|${line.category_name.toLowerCase()}`
  if (line.sub_category_id) return `id:${line.sub_category_id}`
  return `row:${line.rowNumber}`
}

/** The API payload for an entry from the file. accountOverrides (by accountRefKey) replaces a
 * line's account with one the user picked or created in the import dialog. */
export function toImportEntry(entry: JournalFileEntry, accountOverrides?: Map<string, number>): JournalImportEntry {
  return {
    entry_number: entry.entry_number,
    date: entry.date,
    narration: entry.narration,
    lines: entry.rows.map((r) => {
      const override = accountOverrides?.get(accountRefKey(r))
      return {
        sub_category_id: override ?? (r.sub_category_id ? Number(r.sub_category_id) : undefined),
        sub_category_name: override ? undefined : r.sub_category_name || undefined,
        category_name: override ? undefined : r.category_name || undefined,
        debit: r.debit || undefined,
        credit: r.credit || undefined,
        description: r.description,
      }
    }),
  }
}

/** "Rows 4-6" / "Row 4" / "Rows 4, 9" - where an entry sits in the sheet. */
export function rowRangeLabel(entry: JournalFileEntry): string {
  const nums = entry.rows.map((r) => r.rowNumber)
  if (nums.length === 1) return `Row ${nums[0]}`
  const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1)
  return contiguous ? `Rows ${nums[0]}–${nums[nums.length - 1]}` : `Rows ${nums.join(', ')}`
}

/**
 * A JSON file in the import API's own format - either the full request body
 * ({"entries": [...]}) or just the list of entries:
 *
 *   [{ "entry_number": "JV-0001", "date": "2026-03-31", "narration": "March rent",
 *      "lines": [{ "sub_category_name": "Office Rent", "debit": 25000 },
 *                { "sub_category_name": "Bank", "credit": 25000, "description": "Paid by NEFT" }] }]
 *
 * Every line becomes a JournalExcelLine numbered 1, 2, 3... through the file, so the same
 * checks and messages as an Excel upload apply. Returns the lines, or an error describing a
 * file whose structure can't be read at all.
 */
export function parseJournalJson(text: string): { lines: JournalExcelLine[]; error?: string } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    return { lines: [], error: `This is not valid JSON - ${(err as Error).message}.` }
  }
  const entries = Array.isArray(data) ? data : (data as { entries?: unknown })?.entries
  if (!Array.isArray(entries)) {
    return { lines: [], error: 'Expected a list of entries, or an object with an "entries" list.' }
  }
  if (entries.length === 0) return { lines: [], error: 'The file has no entries.' }

  const asText = (v: unknown) => (v === undefined || v === null ? '' : String(v))
  const problems: string[] = []
  const lines: JournalExcelLine[] = []
  entries.forEach((entry, i) => {
    const label = `Entry ${i + 1}${entry && typeof entry === 'object' && (entry as { entry_number?: unknown }).entry_number ? ` (${asText((entry as { entry_number?: unknown }).entry_number)})` : ''}`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${label} is not an object`)
      return
    }
    const e = entry as Record<string, unknown>
    if (!Array.isArray(e.lines) || e.lines.length === 0) {
      problems.push(`${label} has no "lines" list`)
      return
    }
    e.lines.forEach((line, j) => {
      if (!line || typeof line !== 'object' || Array.isArray(line)) {
        problems.push(`${label}, line ${j + 1} is not an object`)
        return
      }
      const l = line as Record<string, unknown>
      // Same keys parseJournalRow reads from an Excel header row.
      lines.push(parseJournalRow({
        'entry no': asText(e.entry_number),
        date: asText(e.date),
        narration: asText(e.narration),
        category: asText(l.category_name),
        'sub category id': asText(l.sub_category_id),
        'sub category name': asText(l.sub_category_name),
        debit: asText(l.debit),
        credit: asText(l.credit),
        'line description': asText(l.description),
      }, lines.length + 1))
    })
  })
  if (problems.length) {
    const shown = problems.slice(0, 5).join('; ')
    return { lines: [], error: `The file's structure is wrong: ${shown}${problems.length > 5 ? `; and ${problems.length - 5} more` : ''}.` }
  }
  return { lines }
}
