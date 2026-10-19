import { describe, expect, it, vi } from 'vitest'
import { importConfig, parseImportDate } from './billingImport'

vi.mock('./billingapi', () => ({ bulkImport: vi.fn() }))

describe('parseImportDate', () => {
  it('reads ISO, day-first and Excel date cells', () => {
    expect(parseImportDate('2026-04-01')).toBe('2026-04-01')
    expect(parseImportDate('1/4/2026')).toBe('2026-04-01')
    expect(parseImportDate('01-04-2026')).toBe('2026-04-01')
    expect(parseImportDate(String(new Date(2026, 3, 1)))).toBe('2026-04-01')
    expect(parseImportDate('next week')).toBeNull()
  })
})

describe('importConfig', () => {
  it('maps supplier columns to API fields', () => {
    const { parseRow } = importConfig('suppliers')
    const r = parseRow({
      name: ' Paper Co ', gstin: '29abcde1234f1z5', 'payment terms (days)': '15', 'opening balance': '1,200.50',
      'opening balance date': '31/03/2026', 'tds section': 'Professional fees', 'payable account': '',
    })
    expect(r.errors).toEqual([])
    expect(r.data).toEqual({
      name: 'Paper Co', gstin: '29ABCDE1234F1Z5', payment_terms_days: 15, opening_balance: '1200.5',
      opening_balance_date: '2026-03-31', tds_section_name: 'Professional fees',
    })
  })

  it('lists every problem in a row', () => {
    const { parseRow } = importConfig('products')
    const r = parseRow({ name: '', 'sale price': 'abc', 'track stock': 'maybe' })
    expect(r.data).toBeNull()
    expect(r.errors).toEqual(['Name is required.', 'Sale Price "abc" is not a number.', 'Track Stock: enter Yes or No.'])
    expect(parseRow({ name: 'Pen', 'track stock': 'yes' }).data).toEqual({ name: 'Pen', track_inventory: true })
  })

  it('skips rows repeating a name, code or GSTIN', () => {
    const { checkDuplicate } = importConfig('clients')
    const accepted = [{ name: 'Acme', code: 'A1' }]
    expect(checkDuplicate({ name: 'ACME ' }, accepted)).toMatch(/name/)
    expect(checkDuplicate({ name: 'Other', code: 'a1' }, accepted)).toMatch(/code/)
    expect(checkDuplicate({ name: 'Other' }, accepted)).toBeNull()
  })

  it('turns server row errors into the dialog\'s "Row N:" shape', async () => {
    const { bulkImport } = await import('./billingapi')
    vi.mocked(bulkImport).mockResolvedValue({ created: 0, valid_rows: 1, dry_run: false, errors: [{ row: 2, message: 'tax rate "X" does not exist' }] })
    await expect(importConfig('products').onSubmit([{ name: 'a' }, { name: 'b' }]))
      .rejects.toEqual({ response: { data: { error: ['Row 2: tax rate "X" does not exist'] } } })
  })
})
