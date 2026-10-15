/** Sales invoices, purchase bills and credit / debit notes as A4 PDFs - downloaded or printed.
 * The layout helpers (amountInWords, toPrintable, itemRows, totalRows) are plain functions, so
 * they are tested without a browser; jspdf itself loads only when a PDF is made. */
import type { jsPDF } from 'jspdf'
import type { BillingDoc, Company, CreditNote, DocItem, DocKind, PrintParty } from './billingapi'

export type PrintKind = 'invoice' | 'bill' | 'credit_note' | 'debit_note'

/** Everything a printed document shows, whatever kind it is. */
export interface PrintableDoc {
  kind: PrintKind
  number: string
  date: string
  dueDate?: string
  /** The invoice / bill a note is against. */
  reference?: string
  status: string
  party: PrintParty
  items: DocItem[]
  subtotal: number
  cgst: number
  sgst: number
  igst: number
  tax: number
  total: number
  isInterstate: boolean
  placeOfSupply: string
  amountPaid?: number
  amountCredited?: number
  balanceDue?: number
  notes?: string
}

export const TITLES: Record<PrintKind, string> = {
  invoice: 'Tax Invoice', bill: 'Purchase Bill', credit_note: 'Credit Note', debit_note: 'Debit Note',
}

const num = (v: string | number | null | undefined) => Number(v || 0)

const EMPTY_PARTY: PrintParty = { name: '', gstin: '', pan: '', address: '', state: '', email: '', phone: '', contact_person: '' }

export function toPrintable(kind: DocKind, doc: BillingDoc): PrintableDoc {
  const sales = kind === 'sales'
  return {
    kind: sales ? 'invoice' : 'bill',
    number: (sales ? doc.invoice_number : doc.bill_number) ?? '',
    date: (sales ? doc.invoice_date : doc.bill_date) ?? '',
    dueDate: doc.due_date,
    status: doc.status,
    party: doc.party ?? { ...EMPTY_PARTY, name: (sales ? doc.client_name : doc.supplier_name) ?? '' },
    items: doc.items ?? [],
    subtotal: num(doc.subtotal),
    cgst: num(doc.cgst_amount),
    sgst: num(doc.sgst_amount),
    igst: num(doc.igst_amount),
    tax: num(doc.tax_amount),
    total: num(doc.total),
    isInterstate: doc.is_interstate,
    placeOfSupply: doc.place_of_supply,
    amountPaid: num(doc.amount_paid),
    amountCredited: num(doc.amount_credited),
    balanceDue: num(doc.balance_due),
    notes: doc.notes,
  }
}

export function noteToPrintable(note: CreditNote): PrintableDoc {
  return {
    kind: note.kind === 'SALES' ? 'credit_note' : 'debit_note',
    number: note.note_number,
    date: note.note_date,
    reference: note.document_number,
    status: note.status,
    party: note.party,
    items: note.items,
    subtotal: num(note.subtotal),
    cgst: num(note.cgst_amount),
    sgst: num(note.sgst_amount),
    igst: num(note.igst_amount),
    tax: num(note.tax_amount),
    total: num(note.total),
    isInterstate: note.is_interstate,
    placeOfSupply: note.place_of_supply,
    notes: note.reason,
  }
}

// ---------------------------------------------------------------- amounts

/** 1,23,456.78 */
export const amount = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function belowThousand(n: number): string {
  const words: string[] = []
  if (n >= 100) {
    words.push(`${ONES[Math.floor(n / 100)]} Hundred`)
    n %= 100
  }
  if (n >= 20) {
    words.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''))
  } else if (n > 0) {
    words.push(ONES[n])
  }
  return words.join(' ')
}

/** A whole number in words, Indian style (crore, lakh, thousand). */
function integerWords(n: number): string {
  if (n === 0) return 'Zero'
  const parts: string[] = []
  const crore = Math.floor(n / 10_000_000)
  if (crore) parts.push(`${integerWords(crore)} Crore`)
  n %= 10_000_000
  for (const [size, name] of [[100_000, 'Lakh'], [1000, 'Thousand']] as const) {
    if (n >= size) parts.push(`${belowThousand(Math.floor(n / size))} ${name}`)
    n %= size
  }
  if (n) parts.push(belowThousand(n))
  return parts.join(' ')
}

/** 123456.5 -> "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only". */
export function amountInWords(value: number): string {
  const paiseTotal = Math.round(Math.abs(value) * 100)
  const paise = paiseTotal % 100
  return `Rupees ${integerWords(Math.floor(paiseTotal / 100))}${paise ? ` and ${belowThousand(paise)} Paise` : ''} Only`
}

// ---------------------------------------------------------------- table content

const percent = (rate: string | null, half: boolean) => {
  if (!rate) return ''
  const n = Number(rate) / (half ? 2 : 1)
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, '')}%`
}

/** Column headings of the items table: CGST + SGST columns, or one IGST column. */
export function itemColumns(isInterstate: boolean): string[] {
  return ['#', 'Description', 'HSN/SAC', 'Qty', 'Rate', 'Disc %', 'Taxable value',
    ...(isInterstate ? ['IGST'] : ['CGST', 'SGST']), 'Total']
}

/** One row per item, matching itemColumns. A tax cell reads "9% 90.00". */
export function itemRows(items: DocItem[], isInterstate: boolean): string[][] {
  return items.map((item, i) => {
    const qty = `${Number(item.quantity)}${item.unit ? ` ${item.unit}` : ''}`
    const tax = (value: string, half: boolean) => (num(value) ? `${percent(item.tax_percent, half)} ${amount(num(value))}` : '-')
    return [
      String(i + 1), item.description, item.hsn_sac_code || '', qty, amount(num(item.unit_price)),
      num(item.discount_percent) ? String(Number(item.discount_percent)) : '', amount(num(item.amount)),
      ...(isInterstate ? [tax(item.igst_amount, false)] : [tax(item.cgst_amount, true), tax(item.sgst_amount, true)]),
      amount(num(item.line_total)),
    ]
  })
}

/** The totals block: taxable value, the GST components, total and - for invoices / bills - what is left to pay. */
export function totalRows(doc: PrintableDoc): [string, string][] {
  const rows: [string, string][] = [['Taxable value', amount(doc.subtotal)]]
  if (doc.isInterstate) rows.push(['IGST', amount(doc.igst)])
  else rows.push(['CGST', amount(doc.cgst)], ['SGST', amount(doc.sgst)])
  rows.push(['Total (INR)', amount(doc.total)])
  const isDocument = doc.kind === 'invoice' || doc.kind === 'bill'
  if (isDocument && doc.status !== 'DRAFT' && doc.status !== 'CANCELLED') {
    if (doc.amountCredited) rows.push([doc.kind === 'invoice' ? 'Less: credit notes' : 'Less: debit notes', amount(doc.amountCredited)])
    if (doc.amountPaid) rows.push(['Less: paid', amount(doc.amountPaid)])
    rows.push(['Balance due', amount(doc.balanceDue ?? 0)])
  }
  return rows
}

/** Who issues the document and who receives it: the company sells (invoice, credit note);
 * the supplier sells to the company (bill, debit note). */
export function parties(doc: PrintableDoc, company: Company): { from: PrintParty; to: PrintParty; toLabel: string } {
  const us: PrintParty = { ...EMPTY_PARTY, ...company }
  return doc.kind === 'invoice' || doc.kind === 'credit_note'
    ? { from: us, to: doc.party, toLabel: 'Bill to' }
    : { from: doc.party, to: us, toLabel: 'Billed to' }
}

// ---------------------------------------------------------------- the PDF

const VIOLET: [number, number, number] = [91, 33, 182]
const SLATE_900: [number, number, number] = [15, 23, 42]
const SLATE_500: [number, number, number] = [100, 116, 139]
const SLATE_800: [number, number, number] = [30, 41, 59]

const fmtDate = (v?: string) => (v ? new Date(`${v.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric',
}) : '')

function partyLines(p: PrintParty): string[] {
  return [
    ...p.address.split('\n').map((l) => l.trim()).filter(Boolean),
    p.state && `State: ${p.state}`,
    p.gstin && `GSTIN: ${p.gstin}`,
    !p.gstin && p.pan && `PAN: ${p.pan}`,
    [p.phone, p.email].filter(Boolean).join(' · '),
  ].filter(Boolean) as string[]
}

async function render(doc: PrintableDoc, company: Company): Promise<jsPDF> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const width = pdf.internal.pageSize.getWidth()
  const height = pdf.internal.pageSize.getHeight()
  const margin = 14
  const { from, to, toLabel } = parties(doc, company)

  // Header: issuer on the left, document title and number on the right.
  pdf.setTextColor(...SLATE_900)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(15)
  pdf.text(from.name || '(Company name - set it under Period Close)', margin, 18, { maxWidth: width / 2 })
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.5)
  pdf.setTextColor(...SLATE_500)
  let y = 23
  for (const line of partyLines(from)) {
    pdf.text(line, margin, y, { maxWidth: width / 2 })
    y += 4
  }
  pdf.setTextColor(...VIOLET)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(17)
  pdf.text(TITLES[doc.kind].toUpperCase(), width - margin, 18, { align: 'right' })
  const meta: [string, string][] = [
    ['Number', doc.number],
    ['Date', fmtDate(doc.date)],
    ...(doc.dueDate ? [['Due date', fmtDate(doc.dueDate)] as [string, string]] : []),
    ...(doc.reference ? [[doc.kind === 'credit_note' ? 'Against invoice' : 'Against bill', doc.reference] as [string, string]] : []),
    ['Place of supply', doc.placeOfSupply || '-'],
  ]
  pdf.setFontSize(9)
  meta.forEach(([label, value], i) => {
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(...SLATE_500)
    pdf.text(label, width - margin - 48, 25 + i * 4.6)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(...SLATE_900)
    pdf.text(value, width - margin, 25 + i * 4.6, { align: 'right' })
  })
  y = Math.max(y, 25 + meta.length * 4.6) + 4
  pdf.setDrawColor(226, 232, 240)
  pdf.line(margin, y, width - margin, y)

  // Recipient.
  y += 6
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.setTextColor(...SLATE_500)
  pdf.text(toLabel.toUpperCase(), margin, y)
  pdf.setFontSize(10.5)
  pdf.setTextColor(...SLATE_900)
  pdf.text(to.name || '-', margin, y + 5)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.5)
  pdf.setTextColor(...SLATE_500)
  y += 9
  for (const line of partyLines(to)) {
    pdf.text(line, margin, y, { maxWidth: width - margin * 2 })
    y += 4
  }

  // Items.
  const columns = itemColumns(doc.isInterstate)
  const right = new Set(['Qty', 'Rate', 'Disc %', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Total'])
  autoTable(pdf, {
    startY: y + 3,
    margin: { left: margin, right: margin },
    head: [columns],
    body: itemRows(doc.items, doc.isInterstate),
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.8, lineColor: [226, 232, 240], lineWidth: 0.2, textColor: SLATE_900 },
    headStyles: { fillColor: SLATE_800, textColor: 255, fontStyle: 'bold' },
    columnStyles: Object.fromEntries(columns.map((c, i) => [i, {
      halign: right.has(c) ? 'right' : 'left', ...(c === 'Description' ? { cellWidth: 'auto' } : {}),
    }])),
    didParseCell: (hook) => {
      if (hook.section === 'head' && right.has(columns[hook.column.index])) hook.cell.styles.halign = 'right'
    },
  })
  y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4

  // Totals on the right, amount in words on the left.
  const totals = totalRows(doc)
  autoTable(pdf, {
    startY: y,
    margin: { left: width - margin - 75, right: margin },
    body: totals,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 1.4, textColor: SLATE_900 },
    columnStyles: { 0: { textColor: SLATE_500 }, 1: { halign: 'right', fontStyle: 'bold' } },
    didParseCell: (hook) => {
      const label = totals[hook.row.index]?.[0]
      if (label === 'Total (INR)' || label === 'Balance due') {
        hook.cell.styles.fontStyle = 'bold'
        hook.cell.styles.textColor = SLATE_900
        hook.cell.styles.fillColor = [241, 245, 249]
      }
    },
  })
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.setTextColor(...SLATE_500)
  pdf.text('AMOUNT IN WORDS', margin, y + 4)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(...SLATE_900)
  pdf.text(amountInWords(doc.total), margin, y + 9, { maxWidth: width - margin * 2 - 82 })
  if (doc.notes) {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(...SLATE_500)
    pdf.text(doc.kind.endsWith('note') ? 'REASON' : 'NOTES', margin, y + 20)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(...SLATE_900)
    pdf.text(doc.notes, margin, y + 25, { maxWidth: width - margin * 2 - 82 })
  }
  y = Math.max((pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY, y + 30) + 14

  // Signature (the issuer signs).
  if (y > height - 30) {
    pdf.addPage()
    y = 30
  }
  pdf.setFontSize(9)
  pdf.setTextColor(...SLATE_900)
  pdf.text(`For ${from.name || ''}`.trim(), width - margin, y, { align: 'right' })
  pdf.setTextColor(...SLATE_500)
  pdf.text('Authorised signatory', width - margin, y + 16, { align: 'right' })

  // Draft / cancelled watermark.
  if (doc.status === 'DRAFT' || doc.status === 'CANCELLED') {
    const pages = pdf.getNumberOfPages()
    for (let i = 1; i <= pages; i++) {
      pdf.setPage(i)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(70)
      pdf.setTextColor(226, 232, 240)
      pdf.text(doc.status, width / 2, height / 2, { align: 'center', angle: 30 })
    }
  }
  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(...SLATE_500)
    pdf.text(`${TITLES[doc.kind]} ${doc.number}`, margin, height - 8)
    pdf.text(`Page ${i} of ${pages}`, width - margin, height - 8, { align: 'right' })
  }
  return pdf
}

export const pdfFilename = (doc: PrintableDoc) => `${TITLES[doc.kind].replace(' ', '_')}_${doc.number.replace(/[^\w.-]+/g, '_')}.pdf`

export async function downloadDocumentPdf(doc: PrintableDoc, company: Company): Promise<void> {
  (await render(doc, company)).save(pdfFilename(doc))
}

/** Opens the PDF in a new tab with the print dialog up. Call it straight from a click (pop-up blockers). */
export async function printDocumentPdf(doc: PrintableDoc, company: Company): Promise<void> {
  const tab = window.open('', '_blank')
  const pdf = await render(doc, company)
  pdf.autoPrint()
  const url = URL.createObjectURL(pdf.output('blob'))
  if (tab) tab.location.href = url
  else window.location.assign(url)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
