/** Menu Guide examples for Sales & Purchases, GST Summary and the Audit Log. */
import type { ReactNode } from 'react'

function HowItWorks({ tone = 'primary', children }: { tone?: 'primary' | 'success' | 'info' | 'warning'; children: ReactNode }) {
  const cls = {
    primary: 'bg-primary-soft text-ink',
    success: 'bg-success-soft text-success-text',
    info: 'bg-info-soft text-info-text',
    warning: 'bg-warning-soft text-warning-text',
  }[tone]
  return <div className={`p-3 rounded-xl font-medium ${cls}`}><strong>How it works:</strong> {children}</div>
}

function Rows({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="rounded-xl border border-border divide-y divide-border">
      {rows.map(([label, value], i) => (
        <div key={i} className="flex justify-between gap-4 px-3 py-2">
          <span className="text-muted">{label}</span><span className="font-bold text-ink text-right">{value}</span>
        </div>
      ))}
    </div>
  )
}

function Entry({ title, lines }: { title: string; lines: { account: string; dr?: string; cr?: string }[] }) {
  return (
    <div className="rounded-xl border border-border bg-slate-50 p-3 dark:bg-slate-800/40 space-y-2">
      <div className="font-bold text-ink">{title}</div>
      {lines.map((l) => (
        <div key={l.account} className="flex justify-between gap-2 font-mono">
          <span className="font-sans font-semibold text-ink">{l.account}</span>
          <span>
            <span className="text-danger-text">Dr {l.dr ?? '—'}</span>
            <span className="ml-3 text-success-text">Cr {l.cr ?? '—'}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

export default function SalesExamples({ id }: { id: string }) {
  switch (id) {
    case 'clients_suppliers':
      return (
        <div className="space-y-4 text-xs">
          <HowItWorks tone="info">Add the client once; every invoice picks up its state (for GST) and payment terms (for the due date). An opening balance is booked so the Balance Sheet includes it.</HowItWorks>
          <Rows rows={[
            ['Client', 'Acme Retail Pvt Ltd'],
            ['GSTIN / State', '29ABCDE1234F1Z5 · Karnataka'],
            ['Payment terms', '30 days'],
            ['Opening balance (1 Apr 2026)', '₹25,000.00 receivable'],
          ]} />
          <Entry title="OB-C-12 • 2026-04-01 • Opening balance - Acme Retail" lines={[
            { account: 'Accounts Receivable', dr: '₹25,000.00' },
            { account: 'Opening Balance Equity', cr: '₹25,000.00' },
          ]} />
        </div>
      )
    case 'products':
      return (
        <div className="space-y-4 text-xs">
          <HowItWorks>Pick a product on an invoice line and its description, price, GST rate and income account fill in.</HowItWorks>
          <Rows rows={[
            ['Product', 'Annual maintenance (Service)'],
            ['HSN / SAC', '998713'],
            ['Sale price', '₹12,000.00 per year'],
            ['GST rate', 'GST 18% → output to "GST Payable", input to "GST Input Credit"'],
            ['Income account', 'Service Revenue'],
          ]} />
        </div>
      )
    case 'sales_invoices':
      return (
        <div className="space-y-4 text-xs">
          <HowItWorks tone="success">Draft → <strong>Post</strong> (booked, locked) → receipts make it Partly paid / Paid. Your company is in Karnataka: a Karnataka client pays CGST + SGST, a Kerala client IGST.</HowItWorks>
          <Rows rows={[
            ['INV-00042 · Acme Retail (Karnataka)', 'Taxable ₹10,000.00'],
            ['CGST 9% + SGST 9%', '₹900.00 + ₹900.00'],
            ['Total', '₹11,800.00'],
            ['Same invoice to a Kerala client', 'IGST 18% ₹1,800.00'],
          ]} />
          <Entry title="SI-INV-00042 • Sales invoice - Acme Retail" lines={[
            { account: 'Accounts Receivable', dr: '₹11,800.00' },
            { account: 'Service Revenue', cr: '₹10,000.00' },
            { account: 'GST Payable (CGST + SGST)', cr: '₹1,800.00' },
          ]} />
          <div className="p-3 rounded-xl bg-surface-muted text-ink">PDF / Print gives a tax invoice with your company details, HSN codes, the GST split and the amount in words. A credit note (CN-00001) for 2 returned units reverses their income and GST.</div>
        </div>
      )
    case 'purchase_bills':
      return (
        <div className="space-y-4 text-xs">
          <HowItWorks>Record the supplier's bill under their number and post it. The GST you paid becomes input tax credit.</HowItWorks>
          <Entry title="PB-7-PC-778 • Purchase bill PC-778 - Paper Co" lines={[
            { account: 'Office Supplies', dr: '₹5,000.00' },
            { account: 'GST Input Credit (CGST + SGST)', dr: '₹900.00' },
            { account: 'Accounts Payable', cr: '₹5,900.00' },
          ]} />
        </div>
      )
    case 'payments':
      return (
        <div className="space-y-4 text-xs">
          <HowItWorks tone="info">One receipt can settle several invoices; what isn't allocated stays as an advance.</HowItWorks>
          <Rows rows={[
            ['RCPT-00008 · Acme Retail · NEFT', '₹20,000.00'],
            ['→ INV-00040', '₹8,200.00 (now Paid)'],
            ['→ INV-00042', '₹11,800.00 (now Paid)'],
          ]} />
          <Entry title="RCPT-00008 • Receipt - Acme Retail" lines={[
            { account: 'HDFC Current Account', dr: '₹20,000.00' },
            { account: 'Accounts Receivable', cr: '₹20,000.00' },
          ]} />
        </div>
      )
    case 'receivables_payables':
      return (
        <div className="space-y-4 text-xs">
          <HowItWorks tone="warning">Chase the right-hand columns first - the older a debt, the harder it is to collect.</HowItWorks>
          <Rows rows={[
            ['Acme Retail', 'Not due ₹11,800 · 1–30 days ₹8,200'],
            ['Brightline Media', '61–90 days ₹45,000'],
            ['Total receivable', '₹65,000.00'],
          ]} />
        </div>
      )
    case 'gst_summary':
      return (
        <div className="space-y-4 text-xs">
          <HowItWorks tone="success">Output GST on sales minus the input tax credit on purchases, per component. A negative figure is credit carried forward.</HowItWorks>
          <Rows rows={[
            ['CGST: output ₹9,000 − credit ₹2,700', '₹6,300.00'],
            ['SGST: output ₹9,000 − credit ₹2,700', '₹6,300.00'],
            ['IGST: output ₹5,400 − credit ₹0', '₹5,400.00'],
            ['Net GST payable', '₹18,000.00'],
          ]} />
        </div>
      )
    case 'audit_log':
      return (
        <div className="space-y-4 text-xs">
          <HowItWorks>Filter by user, action, record type or date; click a row to see every field that changed.</HowItWorks>
          <Rows rows={[
            ['15 Oct 10:42 · priya · Posted', 'Sales invoice INV-00042'],
            ['15 Oct 10:40 · priya · Changed', 'Client Acme Retail - phone: 98450… → 98860…'],
            ['15 Oct 09:15 · rahul · Made final', '212 bank transactions'],
            ['15 Oct 09:02 · unknown · Sign-in failed', 'User "admin"'],
          ]} />
        </div>
      )
    default:
      return null
  }
}
