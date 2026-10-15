import { describe, expect, it } from 'vitest'
import {
  accountRefKey, groupJournalRows, normalizeDate, parseJournalJson, parseJournalRow, rowRangeLabel, toImportEntry,
} from './journalImportParsing'

const row = (over: Record<string, string>, n: number) => parseJournalRow({
  'entry no': 'JV-1', date: '31-03-2026', narration: 'March rent', 'sub category name': 'Office Rent', debit: '', credit: '',
  ...over,
}, n)

describe('normalizeDate', () => {
  it.each([
    ['2026-3-5', '2026-03-05'],
    ['05/03/2026', '2026-03-05'],
    ['5.3.2026', '2026-03-05'],
    ['Tue Mar 31 2026 05:30:00 GMT+0530', '2026-03-31'],
    ['not a date', ''],
    ['', ''],
  ])('%s -> %s', (text, iso) => {
    expect(normalizeDate(text)).toBe(iso)
  })
})

describe('parseJournalRow', () => {
  it('reads amounts with thousands separators', () => {
    const line = row({ debit: '25,000.00' }, 2)
    expect(line.errors).toEqual([])
    expect(line.debit).toBe('25000.00')
    expect(line.date).toBe('2026-03-31')
  })

  it('needs exactly one of debit and credit', () => {
    expect(row({ debit: '10', credit: '10' }, 2).errors).toContain('needs either a Debit or a Credit amount (exactly one)')
    expect(row({}, 2).errors).toContain('needs either a Debit or a Credit amount (exactly one)')
    expect(row({ debit: '-5' }, 2).errors).toContain('Debit is not a valid amount')
  })
})

describe('groupJournalRows', () => {
  it('groups by entry number and totals each side', () => {
    const [entry] = groupJournalRows([
      row({ debit: '25000' }, 2),
      row({ 'sub category name': 'HDFC Bank', credit: '25000' }, 3),
    ])
    expect(entry.totalDebit).toBe(25000)
    expect(entry.totalCredit).toBe(25000)
    expect(entry.errors).toEqual([])
    expect(rowRangeLabel(entry)).toBe('Rows 2–3')
  })

  it('flags single-row entries, mixed dates and rows that are apart', () => {
    const entries = groupJournalRows([
      row({ debit: '10' }, 2),
      row({ 'entry no': 'JV-2', credit: '10' }, 3),
      row({ credit: '10', date: '01-04-2026' }, 4),
    ])
    const jv1 = entries.find((e) => e.entry_number === 'JV-1')!
    expect(jv1.errors.some((e) => e.includes('different dates'))).toBe(true)
    expect(jv1.warnings[0]).toContain('rows 2, 4')
    expect(entries.find((e) => e.entry_number === 'JV-2')!.errors).toContain('needs at least 2 rows (a debit and a credit)')
  })
})

describe('toImportEntry', () => {
  it('replaces an unknown account with the one picked in the dialog', () => {
    const lines = [row({ debit: '5' }, 2), row({ 'sub category name': 'Bank', credit: '5' }, 3)]
    const [entry] = groupJournalRows(lines)
    const payload = toImportEntry(entry, new Map([[accountRefKey(lines[0]), 42]]))
    expect(payload.lines[0]).toMatchObject({ sub_category_id: 42, sub_category_name: undefined, debit: '5' })
    expect(payload.lines[1]).toMatchObject({ sub_category_name: 'Bank', credit: '5' })
  })
})

describe('parseJournalJson', () => {
  it('rejects text that is not a list of entries', () => {
    expect(parseJournalJson('{').error).toMatch(/not valid JSON/)
    expect(parseJournalJson('{"x": 1}').error).toMatch(/Expected a list/)
    expect(parseJournalJson('[]').error).toBe('The file has no entries.')
  })

  it('numbers every line through the file', () => {
    const { lines, error } = parseJournalJson(JSON.stringify({ entries: [{
      entry_number: 'JV-9', date: '2026-03-31', narration: 'Rent',
      lines: [{ sub_category_name: 'Office Rent', debit: 100 }, { sub_category_name: 'Bank', credit: 100 }],
    }] }))
    expect(error).toBeUndefined()
    expect(lines.map((l) => l.rowNumber)).toEqual([1, 2])
    expect(groupJournalRows(lines)[0].errors).toEqual([])
  })
})
