import { useState } from 'react'
import { FileJson } from 'lucide-react'
import { Alert, Button, Panel, Select } from '../../components/tw'
import { errorText, gstApi, type GstReturnForm } from '../Billing/billingapi'

const FORMS: { form: GstReturnForm; label: string }[] = [
  { form: 'gstr1', label: 'GSTR-1' },
  { form: 'gstr3b', label: 'GSTR-3B' },
]

/** The last 24 months, newest first, as { value: "2026-09", label: "September 2026" }. */
function recentMonths(today = new Date()) {
  return Array.from({ length: 24 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return { value, label: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) }
  })
}

/** Downloads GSTR-1 / GSTR-3B for a month as the JSON file the GST portal's offline tool takes,
 * and lists what to fix before filing (missing HSN codes, bad GSTINs, drafts left out...). */
export default function GstReturnsPanel() {
  const months = recentMonths()
  const [month, setMonth] = useState(months[1].value) // returns are filed for the month just ended
  const [busy, setBusy] = useState<GstReturnForm | null>(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ label: string; warnings: string[] } | null>(null)

  const download = async (form: GstReturnForm, label: string) => {
    setBusy(form)
    setError('')
    setResult(null)
    try {
      const data = await gstApi.gstReturn(form, month)
      const blob = new Blob([JSON.stringify(data.return, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${form.toUpperCase()}_${data.return.gstin}_${month}.json`
      a.click()
      URL.revokeObjectURL(url)
      setResult({ label, warnings: data.warnings })
    } catch (err) {
      setError(errorText(err, `Failed to build ${label}.`))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-ink">GST returns</h2>
          <p className="mt-1 text-sm text-muted">
            GSTR-1 and GSTR-3B for one month as a JSON file - open it in the GST offline tool (or upload it on the
            portal), check it there, then file. Built from posted invoices, bills and notes only.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[180px]">
            <Select id="gst-return-month" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </div>
          {FORMS.map(({ form, label }) => (
            <Button key={form} variant="outlined" icon={<FileJson />} onClick={() => download(form, label)}
              disabled={busy !== null}>
              {busy === form ? 'Building...' : `${label} JSON`}
            </Button>
          ))}
        </div>
      </div>
      {error && <Alert className="mt-4">{error}</Alert>}
      {result && (result.warnings.length ? (
        <div className="mt-4 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-text">
          <p className="font-bold">{result.label} downloaded - check these before filing:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {result.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-sm font-medium text-muted">{result.label} downloaded - nothing to fix.</p>
      ))}
    </Panel>
  )
}
