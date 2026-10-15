import { useState } from 'react'
import { Building2 } from 'lucide-react'
import { Alert, Button, Panel, Select, TextField } from '../../components/tw'
import { stateFromGstin, stateOptions } from '../../constants/indianStates'
import { errorText } from '../Billing/billingapi'
import { periodCloseApi, type Company, type PeriodCloseState } from './periodcloseapi'

/** The company's own details: printed on every invoice and bill, and its state decides GST
 * (CGST + SGST for a party in the same state, IGST otherwise). */
export default function CompanyPanel({ company, canEdit, onSaved }: {
  company: Company
  canEdit: boolean
  onSaved: (state: PeriodCloseState) => void
}) {
  const [form, setForm] = useState<Company>(company)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const set = (patch: Partial<Company>) => {
    setForm((f) => ({ ...f, ...patch }))
    setSaved(false)
  }
  const changed = (Object.keys(form) as (keyof Company)[]).some((k) => form[k] !== company[k])

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const state = await periodCloseApi.saveCompany(form)
      onSaved(state)
      setForm(state.company)  // as the server cleaned it up (spacing, GSTIN in capitals)
      setSaved(true)
    } catch (err) {
      setError(errorText(err, 'Failed to save the company details.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel>
      <div className="mb-1 flex items-center gap-2">
        <Building2 className="h-5 w-5 text-violet-500" />
        <h2 className="text-base font-bold text-ink">Company details</h2>
      </div>
      <p className="mb-4 text-xs text-muted">
        Printed on invoices and bills. The state decides GST: clients and suppliers in the same state are charged
        CGST + SGST, anyone in another state IGST.
      </p>
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-col gap-3">
        <TextField id="co-name" label="Company name" value={form.name} disabled={!canEdit}
          onChange={(e) => set({ name: e.target.value })} />
        <TextField id="co-gstin" label="GSTIN" value={form.gstin} inputClassName="num uppercase" disabled={!canEdit}
          onChange={(e) => set({ gstin: e.target.value, state: form.state || stateFromGstin(e.target.value) })} />
        <Select id="co-state" label="State" value={form.state} onChange={(e) => set({ state: e.target.value })}>
          <option value="" disabled={!canEdit}>Not set</option>
          {stateOptions(form.state).map((name) => <option key={name} value={name} disabled={!canEdit}>{name}</option>)}
        </Select>
        <TextField id="co-address" label="Address" multiline rows={3} value={form.address} disabled={!canEdit}
          onChange={(e) => set({ address: e.target.value })} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField id="co-email" label="Email" type="email" value={form.email} disabled={!canEdit}
            onChange={(e) => set({ email: e.target.value })} />
          <TextField id="co-phone" label="Phone" value={form.phone} disabled={!canEdit}
            onChange={(e) => set({ phone: e.target.value })} />
        </div>
        {canEdit && (
          <div className="flex items-center justify-end gap-3">
            {saved && !changed && <span className="text-xs font-semibold text-success-text">Saved</span>}
            <Button variant="contained" onClick={save} disabled={saving || !changed}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        )}
      </div>
    </Panel>
  )
}
