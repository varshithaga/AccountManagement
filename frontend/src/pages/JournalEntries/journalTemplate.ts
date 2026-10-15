/**
 * The journal entry Excel format - shared by the page's "Download Sample" button and the
 * import dialog's template, so both always describe the same columns.
 */
import { categoryLookupApi } from '../../api/resources'
import type { ImportExcelColumn } from '../../components/ImportExcelDialog'
import type { AccountType } from '../../types'

export const JOURNAL_TEMPLATE_COLUMNS: ImportExcelColumn[] = [
  { key: 'entry_number', header: 'Entry No', width: 14 },
  { key: 'date', header: 'Date', width: 14 },
  { key: 'narration', header: 'Narration', width: 30 },
  { key: 'category_name', header: 'Category', width: 22 },
  { key: 'sub_category_id', header: 'Sub Category ID', width: 16 },
  { key: 'sub_category_name', header: 'Sub Category Name', width: 28 },
  { key: 'debit', header: 'Debit', width: 14 },
  { key: 'credit', header: 'Credit', width: 14 },
  { key: 'description', header: 'Line Description', width: 28 },
]

/** What each column means - the "Format Guide" sheet. */
const COLUMN_GUIDE: { column: string; required: string; format: string; example: string; notes: string }[] = [
  { column: 'Entry No', required: 'Yes', format: 'Text, max 100 characters', example: 'JV-0001',
    notes: 'Voucher / reference number. Every row with the same Entry No is one journal entry. An Entry No that was already imported is skipped.' },
  { column: 'Date', required: 'Yes', format: 'YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY or an Excel date', example: '2026-03-31',
    notes: 'All rows of one entry must have the same date.' },
  { column: 'Narration', required: 'No', format: 'Text, max 500 characters', example: 'March office rent',
    notes: 'Describes the whole entry. Taken from the first row of the entry that has one.' },
  { column: 'Category', required: 'Only if needed', format: 'Chart of Accounts category name', example: 'Rent',
    notes: 'Needed only when the same Sub Category Name exists under more than one category (the analysis tells you which). '
      + 'If you fill it in, it must be an existing category and the sub category must be under it - otherwise the row is an error.' },
  { column: 'Sub Category ID', required: 'This or Sub Category Name', format: 'Chart of Accounts sub-category id (number)', example: '12',
    notes: 'When it exists, it decides the account. A Sub Category Name or Category on the same row must then match it, '
      + 'otherwise the row is an error. An id that does not exist falls back to the Sub Category Name.' },
  { column: 'Sub Category Name', required: 'If no Sub Category ID', format: 'Chart of Accounts sub-category name', example: 'Office Rent',
    notes: 'Used when Sub Category ID is empty. Must match an existing sub-category (not case-sensitive). Create missing ones in Chart of Accounts first. '
      + 'When importing for a bank account, "Bank" (or the bank account\'s name) means that bank\'s linked GL account.' },
  { column: 'Debit', required: 'One of Debit / Credit', format: 'Number > 0, up to 2 decimals', example: '25000',
    notes: 'Leave Credit empty on a debit row. Commas are allowed (25,000.00).' },
  { column: 'Credit', required: 'One of Debit / Credit', format: 'Number > 0, up to 2 decimals', example: '25000',
    notes: 'Leave Debit empty on a credit row.' },
  { column: 'Line Description', required: 'No', format: 'Text, max 500 characters', example: 'Paid by NEFT',
    notes: 'Describes this one line.' },
]

/** The import rules - the Format Guide sheet and the import dialog both show these. */
export const JOURNAL_IMPORT_RULES = [
  'One row = one debit or credit line. An entry needs at least 2 rows.',
  'Rows with the same Entry No form one entry; in each entry, total Debit must equal total Credit.',
  'Each row has exactly one amount - either Debit or Credit, never both, never neither.',
  'Give each row a Sub Category ID, or leave it empty and give a Sub Category Name; add Category only if the name exists under several categories.',
  'A Category or Sub Category Name that does not exist, or that contradicts the Sub Category ID, is an error - that entry is not imported.',
  'When importing for a bank account, write "Bank" as the Sub Category Name on the bank side - it becomes that bank\'s GL account.',
  'Keep the header row exactly as it is; column order does not matter.',
  'The file is analysed before anything is saved: only entries without errors are imported.',
  'Entry numbers that were already imported are skipped, so re-uploading the same file is safe.',
]
const RULES = JOURNAL_IMPORT_RULES

type SampleRow = Record<string, string | number>

/** Accounts for the sample - real ones from the Chart of Accounts when they exist, so the sample imports as-is. */
async function sampleAccounts() {
  const pick = async (account_type: AccountType, fallback: string, search?: string) => {
    try {
      let res = await categoryLookupApi.subCategories({ account_type, search, limit: 2 })
      if (search && res.results.length === 0) res = await categoryLookupApi.subCategories({ account_type, limit: 2 })
      return res.results.map((s) => s.name).concat([fallback, fallback])
    } catch {
      return [fallback, fallback]
    }
  }
  const [expense, asset, income] = await Promise.all([
    pick('EXPENSE', 'Office Rent'),
    pick('ASSET', 'HDFC Bank', 'bank'),
    pick('INCOME', 'Product Sales'),
  ])
  return { expense, asset, income }
}

/** Two balanced sample entries: a payment (expense / bank) and a split receipt (bank / income + expense).
 * With bankAlias the bank lines say "Bank" - for files imported against a chosen bank account. */
export async function buildJournalSampleRows(bankAlias = false): Promise<SampleRow[]> {
  const { expense, asset, income } = await sampleAccounts()
  const bank = bankAlias ? 'Bank' : asset[0]
  const row = (entry_number: string, narration: string, sub_category_name: string, debit: number | '', credit: number | '', description = ''): SampleRow =>
    ({ entry_number, date: '2026-03-31', narration, category_name: '', sub_category_id: '', sub_category_name, debit, credit, description })
  return [
    row('JV-0001', 'March office rent', expense[0], 25000, ''),
    row('JV-0001', 'March office rent', bank, '', 25000, 'Paid by NEFT'),
    row('JV-0002', 'Customer receipt less bank charges', bank, 11800, ''),
    row('JV-0002', 'Customer receipt less bank charges', expense[1], 200, '', 'Bank charges'),
    row('JV-0002', 'Customer receipt less bank charges', income[0], '', 12000),
  ]
}

/** Downloads journal_entries_sample.xlsx: a filled "Sample" sheet plus a "Format Guide" sheet. */
export async function downloadJournalSample(bankAlias = false): Promise<void> {
  const [{ default: ExcelJS }, rows] = await Promise.all([import('exceljs'), buildJournalSampleRows(bankAlias)])
  const workbook = new ExcelJS.Workbook()
  const bold = { name: 'Arial', bold: true, size: 10, color: { argb: 'FF0F172A' } }
  const plain = { name: 'Arial', size: 10 }

  const sample = workbook.addWorksheet('Sample')
  sample.columns = JOURNAL_TEMPLATE_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }))
  rows.forEach((r) => sample.addRow(r))
  sample.eachRow((row, n) => row.eachCell((cell) => { cell.font = n === 1 ? bold : plain }))
  sample.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } }
  sample.views = [{ state: 'frozen', ySplit: 1 }]

  const guide = workbook.addWorksheet('Format Guide')
  guide.columns = [
    { header: 'Column', key: 'column', width: 18 },
    { header: 'Required', key: 'required', width: 20 },
    { header: 'Format', key: 'format', width: 40 },
    { header: 'Example', key: 'example', width: 18 },
    { header: 'Notes', key: 'notes', width: 70 },
  ]
  COLUMN_GUIDE.forEach((g) => guide.addRow(g))
  guide.addRow({})
  guide.addRow({ column: 'Rules' }).getCell(1).font = bold
  RULES.forEach((rule, i) => guide.addRow({ column: `${i + 1}.`, required: rule }))
  guide.eachRow((row, n) => row.eachCell((cell) => {
    cell.font = n === 1 ? bold : cell.font?.bold ? bold : plain
    cell.alignment = { vertical: 'top', wrapText: n > 1 && n <= COLUMN_GUIDE.length + 1 }
  }))
  guide.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } }

  const buffer = await workbook.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'journal_entries_sample.xlsx'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** The JSON format: what each field of an entry and of a line means (shown in the import dialog). */
export const JOURNAL_JSON_FIELDS: { field: string; required: string; notes: string }[] = [
  { field: 'entry_number', required: 'Yes', notes: 'Voucher / reference number, max 100 characters. An entry_number already imported is skipped.' },
  { field: 'date', required: 'Yes', notes: '"YYYY-MM-DD" (DD-MM-YYYY and DD/MM/YYYY are read too).' },
  { field: 'narration', required: 'No', notes: 'Describes the whole entry, max 500 characters.' },
  { field: 'lines', required: 'Yes, 2 or more', notes: 'The debit and credit lines; total debit must equal total credit.' },
  { field: 'lines[].sub_category_id', required: 'This or sub_category_name', notes: 'Chart of Accounts sub-category id (number). When it exists it decides the account, and any sub_category_name / category_name on the line must match it; an unknown id falls back to sub_category_name.' },
  { field: 'lines[].sub_category_name', required: 'If no sub_category_id', notes: 'Sub-category name (not case-sensitive). "Bank" = the chosen bank account\'s GL account.' },
  { field: 'lines[].category_name', required: 'Only if needed', notes: 'Only when the same sub-category name exists under several categories.' },
  { field: 'lines[].debit / credit', required: 'Exactly one', notes: 'A number (or numeric text) greater than 0 - give debit or credit, never both.' },
  { field: 'lines[].description', required: 'No', notes: 'Describes this one line, max 500 characters.' },
]

/** The sample entries in the JSON format - the same two entries as the Excel sample. */
export async function buildJournalSampleJson(bankAlias = false): Promise<string> {
  const rows = await buildJournalSampleRows(bankAlias)
  const entries: { entry_number: string; date: string; narration: string; lines: Record<string, string | number>[] }[] = []
  for (const r of rows) {
    let entry = entries.find((e) => e.entry_number === r.entry_number)
    if (!entry) {
      entry = { entry_number: String(r.entry_number), date: String(r.date), narration: String(r.narration), lines: [] }
      entries.push(entry)
    }
    const line: Record<string, string | number> = { sub_category_name: r.sub_category_name }
    if (r.debit !== '') line.debit = r.debit
    if (r.credit !== '') line.credit = r.credit
    if (r.description) line.description = r.description
    entry.lines.push(line)
  }
  return JSON.stringify({ entries }, null, 2)
}

/** Downloads journal_entries_sample.json. */
export async function downloadJournalSampleJson(bankAlias = false): Promise<void> {
  const url = URL.createObjectURL(new Blob([await buildJournalSampleJson(bankAlias)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'journal_entries_sample.json'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
