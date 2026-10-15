import { useMemo, useState } from 'react'
import { BookOpenCheck, CheckCircle2, Plus, Scale, X } from 'lucide-react'
import { Alert, Button, DateField, Modal, TextField } from '../../components/tw'
import { AccountSelect } from '../Billing/billingParts'
import { journalEntriesApi, type ManualEntryLine } from './journalentriesapi'
import { apiErrorText } from '../../utils/reconcileConfirm'
import type { JournalEntry } from '../../types'

interface Line extends ManualEntryLine {
  key: number
  account_label: string | null
}

let nextKey = 0
const blank = (): Line => ({ key: ++nextKey, sub_category_id: null, account_label: null, description: '', debit: '', credit: '' })

/** Amounts are compared in paise, so 0.1 + 0.2 style float noise never unbalances an entry. */
const paise = (v: string) => Math.round((Number(v) || 0) * 100)
const rupees = (p: number) => (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const todayIso = () => new Date().toISOString().slice(0, 10)

/**
 * Create or edit a manual journal entry - a double-entry voucher: every line is a debit or a
 * credit on a Chart of Accounts account, and total debits must equal total credits.
 */
export default function ManualEntryDialog({ entry, onClose, onSaved }: {
  /** The manual entry to edit, or null for a new one. */
  entry: JournalEntry | null
  onClose: () => void
  onSaved: (saved: JournalEntry, warnings: string[]) => void
}) {
  const [number, setNumber] = useState(entry?.entry_number ?? '')
  const [date, setDate] = useState(entry?.date ?? todayIso())
  const [narration, setNarration] = useState(entry?.narration ?? '')
  const [lines, setLines] = useState<Line[]>(() => entry
    ? entry.lines.map((l) => ({
      key: ++nextKey, sub_category_id: l.sub_category, account_label: l.sub_category_name, description: l.description,
      debit: Number(l.debit) > 0 ? String(Number(l.debit)) : '', credit: Number(l.credit) > 0 ? String(Number(l.credit)) : '',
    }))
    : [blank(), blank()])
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + paise(l.debit), 0)
    const credit = lines.reduce((s, l) => s + paise(l.credit), 0)
    return { debit, credit, difference: debit - credit }
  }, [lines])

  const filled = lines.filter((l) => l.sub_category_id || paise(l.debit) || paise(l.credit) || l.description.trim())
  const lineProblems = filled.filter((l) => !l.sub_category_id || (paise(l.debit) > 0) === (paise(l.credit) > 0)).length
  const balanced = totals.debit > 0 && totals.difference === 0
  const canSave = balanced && filled.length >= 2 && lineProblems === 0 && Boolean(date)

  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  /** A line is either a debit or a credit: typing one clears the other. */
  const setAmount = (key: number, side: 'debit' | 'credit', value: string) =>
    update(key, side === 'debit' ? { debit: value, credit: value ? '' : lines.find((l) => l.key === key)?.credit ?? '' }
      : { credit: value, debit: value ? '' : lines.find((l) => l.key === key)?.debit ?? '' })

  /** Puts the current difference on this line (on whichever side closes it). */
  const balanceLine = (line: Line) => {
    const others = lines.filter((l) => l.key !== line.key)
    const diff = others.reduce((s, l) => s + paise(l.debit) - paise(l.credit), 0)
    if (diff === 0) return
    update(line.key, diff > 0 ? { credit: (diff / 100).toFixed(2), debit: '' } : { debit: (-diff / 100).toFixed(2), credit: '' })
  }

  const save = async () => {
    setSaving(true)
    setErrors([])
    const payload = {
      entry_number: number.trim(), date, narration: narration.trim(),
      lines: filled.map(({ sub_category_id, description, debit, credit }) => ({
        sub_category_id, description: description.trim(), debit: paise(debit) ? debit : '', credit: paise(credit) ? credit : '',
      })),
    }
    try {
      const saved = entry ? await journalEntriesApi.updateManual(entry.id, payload) : await journalEntriesApi.createManual(payload)
      onSaved(saved, saved.warnings ?? [])
    } catch (err) {
      const data = (err as { response?: { data?: { error?: unknown } } }).response?.data
      setErrors(Array.isArray(data?.error) ? data.error.map(String) : [apiErrorText(err, 'Failed to save the entry.')])
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} icon={<BookOpenCheck />} widthClassName="max-w-5xl"
      title={entry ? `Edit ${entry.entry_number}` : 'New journal entry'}
      subtitle="Double entry: every line is a debit or a credit, and total debits must equal total credits."
      footerHint={balanced
        ? <span className="flex items-center gap-1.5 font-semibold text-success-text"><CheckCircle2 className="h-4 w-4" /> Balanced</span>
        : <span className="font-semibold text-danger-text">
          {totals.debit === 0 && totals.credit === 0 ? 'Enter the amounts' : `Out of balance by ${rupees(Math.abs(totals.difference))}`}
        </span>}
      footer={<>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={!canSave || saving}>{saving ? 'Saving…' : entry ? 'Save changes' : 'Save entry'}</Button>
      </>}>
      {errors.length > 0 && (
        <Alert>
          {errors.length === 1 ? errors[0] : <ul className="list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <TextField id="mj-number" label="Entry number" value={number} inputClassName="num" placeholder="Auto (JV-00001…)"
          onChange={(e) => setNumber(e.target.value)} />
        <DateField id="mj-date" label="Date" value={date} onChange={setDate} />
        <TextField id="mj-narration" className="md:col-span-2" label="Narration" placeholder="e.g. Office rent for October paid in cash"
          value={narration} onChange={(e) => setNarration(e.target.value)} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-slate-50 dark:bg-slate-900/80">
              <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-muted">Account</th>
              <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-muted">Description</th>
              <th className="w-36 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wider text-muted">Debit (Dr)</th>
              <th className="w-36 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wider text-muted">Credit (Cr)</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {lines.map((l) => {
              const oneSided = (paise(l.debit) > 0) !== (paise(l.credit) > 0)
              return (
                <tr key={l.key} className="align-top">
                  <td className="min-w-[240px] px-3 py-2">
                    <AccountSelect label="" value={l.sub_category_id} valueLabel={l.account_label}
                      onChange={(id) => update(l.key, { sub_category_id: id, account_label: null })} />
                  </td>
                  <td className="px-3 py-2">
                    <input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })}
                      placeholder="Optional" className={INPUT} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} step="0.01" value={l.debit} onChange={(e) => setAmount(l.key, 'debit', e.target.value)}
                      className={`${INPUT} num text-right`} placeholder="0.00" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} step="0.01" value={l.credit} onChange={(e) => setAmount(l.key, 'credit', e.target.value)}
                      className={`${INPUT} num text-right`} placeholder="0.00" />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex h-12 items-center justify-end gap-1">
                      {!balanced && !oneSided && totals.debit + totals.credit > 0 && (
                        <button type="button" title="Put the difference on this line" onClick={() => balanceLine(l)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-primary hover:bg-primary-soft">
                          <Scale className="h-4 w-4" />
                        </button>
                      )}
                      {lines.length > 2 && (
                        <button type="button" title="Remove line" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-danger-text hover:bg-danger-soft">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-surface-muted font-bold text-ink">
              <td className="px-3 py-2.5" colSpan={2}>Total</td>
              <td className="num px-3 py-2.5 text-right">{rupees(totals.debit)}</td>
              <td className="num px-3 py-2.5 text-right">{rupees(totals.credit)}</td>
              <td />
            </tr>
            {!balanced && totals.debit + totals.credit > 0 && (
              <tr className="text-danger-text">
                <td className="px-3 py-2 text-[13px] font-semibold" colSpan={2}>Difference</td>
                <td className="num px-3 py-2 text-right text-[13px] font-semibold">{totals.difference < 0 ? rupees(-totals.difference) : ''}</td>
                <td className="num px-3 py-2 text-right text-[13px] font-semibold">{totals.difference > 0 ? rupees(totals.difference) : ''}</td>
                <td />
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outlined" size="sm" icon={<Plus />} onClick={() => setLines((ls) => [...ls, blank()])}>Add line</Button>
        {lineProblems > 0 && (
          <span className="text-[13px] text-muted">Each line needs an account and either a debit or a credit.</span>
        )}
      </div>
    </Modal>
  )
}

const INPUT = 'h-12 w-full rounded-xl border border-input bg-surface px-3 text-sm font-medium text-ink outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-[3px] focus:ring-primary-soft'
