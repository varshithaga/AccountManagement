import { describe, expect, it } from 'vitest'
import type { BillingDoc, Company, DocItem } from './billingapi'
import { amountInWords, itemColumns, itemRows, parties, pdfFilename, toPrintable, totalRows } from './documentPdf'

const item = (over: Partial<DocItem> = {}): DocItem => ({
  id: 1, product: null, product_name: null, description: 'Consulting', quantity: '2.000', unit_price: '1000.00',
  discount_percent: '0.00', tax_rate: 3, tax_rate_name: 'GST 18%', tax_percent: '18.00', amount: '2000.00',
  tax_amount: '360.00', line_total: '2360.00', cgst_amount: '180.00', sgst_amount: '180.00', igst_amount: '0.00',
  hsn_sac_code: '998222', unit: 'Hrs', account: 9, account_name: 'Consulting Revenue', ...over,
})

const invoice = (over: Partial<BillingDoc> = {}): BillingDoc => ({
  id: 7, invoice_number: 'INV-00007', client: 1, client_name: 'Acme', invoice_date: '2026-10-01', due_date: '2026-10-31',
  subtotal: '2000.00', tax_amount: '360.00', total: '2360.00', amount_paid: '1000.00', amount_credited: '360.00',
  balance_due: '1000.00', status: 'PARTIALLY_PAID', notes: '', journal_entry: 3, journal_entry_number: 'SI-INV-00007',
  created_by: 'owner', created_at: '2026-10-01T10:00:00Z', place_of_supply: 'Karnataka', is_interstate: false,
  cgst_amount: '180.00', sgst_amount: '180.00', igst_amount: '0.00', items: [item()],
  party: { name: 'Acme', gstin: '29ABCDE1234F1Z5', pan: '', address: '1 MG Road', state: 'Karnataka', email: '', phone: '', contact_person: '' },
  ...over,
})

const company: Company = { name: 'Ledgerline', gstin: '29AAACA1234A1Z5', state: 'Karnataka', address: '', email: '', phone: '' }

describe('amountInWords', () => {
  it.each([
    [0, 'Rupees Zero Only'],
    [1, 'Rupees One Only'],
    [15, 'Rupees Fifteen Only'],
    [2360, 'Rupees Two Thousand Three Hundred Sixty Only'],
    [100000, 'Rupees One Lakh Only'],
    [123456.5, 'Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only'],
    [10000001, 'Rupees One Crore One Only'],
    [1234567890.05, 'Rupees One Hundred Twenty Three Crore Forty Five Lakh Sixty Seven Thousand Eight Hundred Ninety and Five Paise Only'],
  ])('%s -> %s', (value, words) => {
    expect(amountInWords(value)).toBe(words)
  })

  it('rounds to whole paise', () => {
    expect(amountInWords(10.999)).toBe('Rupees Eleven Only')
  })
})

describe('GST columns', () => {
  it('shows CGST and SGST within the state, each at half the rate', () => {
    expect(itemColumns(false)).toEqual(['#', 'Description', 'HSN/SAC', 'Qty', 'Rate', 'Disc %', 'Taxable value', 'CGST', 'SGST', 'Total'])
    expect(itemRows([item()], false)[0]).toEqual(
      ['1', 'Consulting', '998222', '2 Hrs', '1,000.00', '', '2,000.00', '9% 180.00', '9% 180.00', '2,360.00'])
  })

  it('shows one IGST column across states', () => {
    const row = itemRows([item({ cgst_amount: '0.00', sgst_amount: '0.00', igst_amount: '360.00', discount_percent: '10.00' })], true)[0]
    expect(itemColumns(true)).toContain('IGST')
    expect(itemColumns(true)).not.toContain('CGST')
    expect(row[5]).toBe('10')
    expect(row[7]).toBe('18% 360.00')
  })

  it('handles a half percent rate and an untaxed line', () => {
    const [half, none] = itemRows([
      item({ tax_percent: '5.00', cgst_amount: '50.00', sgst_amount: '50.00' }),
      item({ tax_percent: null, tax_amount: '0.00', cgst_amount: '0.00', sgst_amount: '0.00' }),
    ], false)
    expect(half[7]).toBe('2.5% 50.00')
    expect(none.slice(7, 9)).toEqual(['-', '-'])
  })
})

describe('totals', () => {
  it('takes notes and payments off an open invoice', () => {
    expect(totalRows(toPrintable('sales', invoice()))).toEqual([
      ['Taxable value', '2,000.00'], ['CGST', '180.00'], ['SGST', '180.00'], ['Total (INR)', '2,360.00'],
      ['Less: credit notes', '360.00'], ['Less: paid', '1,000.00'], ['Balance due', '1,000.00'],
    ])
  })

  it('has no balance on a draft, and IGST across states', () => {
    const rows = totalRows(toPrintable('sales', invoice({ status: 'DRAFT', is_interstate: true, igst_amount: '360.00' })))
    expect(rows.map((r) => r[0])).toEqual(['Taxable value', 'IGST', 'Total (INR)'])
  })
})

describe('who issues the document', () => {
  it('the company issues an invoice; the supplier issues a bill', () => {
    const inv = parties(toPrintable('sales', invoice()), company)
    expect([inv.from.name, inv.to.name]).toEqual(['Ledgerline', 'Acme'])
    const bill = parties(toPrintable('purchase', invoice({ bill_number: 'PC-1', supplier_name: 'Paper Co', party: undefined })), company)
    expect([bill.from.name, bill.to.name]).toEqual(['Paper Co', 'Ledgerline'])
  })

  it('names the file after the document', () => {
    expect(pdfFilename(toPrintable('sales', invoice()))).toBe('Tax_Invoice_INV-00007.pdf')
    expect(pdfFilename(toPrintable('purchase', invoice({ bill_number: 'A/12 3' })))).toBe('Purchase_Bill_A_12_3.pdf')
  })
})
