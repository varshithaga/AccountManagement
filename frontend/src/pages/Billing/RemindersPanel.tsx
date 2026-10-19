import { useCallback, useEffect, useState } from 'react'
import { BellRing, Check, Copy, Mail, MailCheck, RefreshCw } from 'lucide-react'
import { Alert, Button, Chip, IconButton, Modal, Panel, Select, Spinner, TextField } from '../../components/tw'
import { EmptyState, KpiTile } from '../../components/PageParts'
import { formatMoney } from '../../utils/periods'
import { errorText, remindersApi } from './billingapi'
import type { ReminderClient, Reminders } from './billingapi'
import { formatDate } from './billingParts'

const MIN_DAYS = [1, 7, 15, 30, 60, 90]

/** Clients with overdue invoices, each with a ready-made reminder: copy it, email it, or mark it as sent
 * when it went another way (phone, WhatsApp). Each reminder is counted on the invoices. */
export default function RemindersPanel({ canSend }: { canSend: boolean }) {
  const [data, setData] = useState<Reminders | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [minDays, setMinDays] = useState(1)
  const [sending, setSending] = useState<ReminderClient | null>(null)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await remindersApi.list({ min_days: minDays }))
    } catch (err) {
      setError(errorText(err, 'Failed to load the reminders.'))
    } finally {
      setLoading(false)
    }
  }, [minDays])
  useEffect(() => { load() }, [load])

  const markSent = async (c: ReminderClient) => {
    try {
      await remindersApi.send({ client_id: c.client, invoice_ids: c.invoices.map((i) => i.id), send_email: false })
      setNotice(`Recorded a reminder to ${c.client_name}.`)
      load()
    } catch (err) {
      alert(errorText(err, 'Failed to record the reminder.'))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile dark icon={<BellRing />} label="Overdue" value={formatMoney(data?.total_overdue)}
          caption={`${data?.clients.length ?? 0} clients · ${minDays}+ days late`} />
        <KpiTile tone={data?.email.configured ? 'success' : 'warning'} icon={<Mail />} label="Email"
          value={data ? (data.email.configured ? 'Set up' : 'Not set up') : '…'}
          caption={data?.email.configured ? `From ${data.email.from}` : 'Copy the text, or set SMTP_ in backend/.env'} />
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Select id="rem-min" label="Overdue by at least" value={minDays} onChange={(e) => setMinDays(Number(e.target.value))}>
              {MIN_DAYS.map((d) => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}
            </Select>
          </div>
          <IconButton title="Refresh" onClick={load} disabled={loading}>
            <RefreshCw className={`h-[18px] w-[18px] stroke-[1.8] ${loading ? 'animate-spin' : ''}`} />
          </IconButton>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <div role="status" className="rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm font-medium text-success-text">{notice}</div>}

      {loading && !data ? (
        <div className="flex justify-center p-16"><Spinner size={32} /></div>
      ) : !data?.clients.length ? (
        <Panel><EmptyState icon={<MailCheck />} title="No overdue invoices - nobody to remind." /></Panel>
      ) : data.clients.map((c) => (
        <Panel key={c.client} className="p-0">
          <div className="flex flex-col gap-3 border-b border-border-soft px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-base font-bold text-ink">{c.client_name}</p>
              <p className="text-xs text-muted">
                {[c.email || 'no email', c.phone].filter(Boolean).join(' · ')}
                {' · '}up to {c.oldest_days_overdue} days late
                {c.last_reminder_at && ` · last reminded ${formatDate(c.last_reminder_at)}`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="num mr-2 text-lg font-bold text-danger-text">{formatMoney(c.total_overdue)}</span>
              <CopyButton text={`${c.subject}\n\n${c.message}`} />
              {canSend && <Button variant="outlined" size="sm" icon={<Check />} onClick={() => markSent(c)}>Mark as sent</Button>}
              {canSend && data.email.configured && (
                <Button variant="contained" size="sm" icon={<Mail />} onClick={() => setSending(c)}>Send email</Button>
              )}
            </div>
          </div>
          <div className="divide-y divide-border-soft">
            {c.invoices.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-2.5 text-sm">
                <span>
                  <span className="num font-semibold">{i.invoice_number}</span>
                  <span className="text-muted"> · {formatDate(i.invoice_date)} · due {formatDate(i.due_date)} · {i.days_overdue} days late</span>
                </span>
                <span className="flex items-center gap-2">
                  {i.reminder_count > 0 && <Chip tone="neutral">Reminded {i.reminder_count}×</Chip>}
                  <span className="num font-semibold">{formatMoney(i.balance_due)}</span>
                </span>
              </div>
            ))}
          </div>
        </Panel>
      ))}

      {sending && (
        <SendReminderDialog client={sending} onClose={() => setSending(null)}
          onSent={(to) => { setSending(null); setNotice(`Reminder emailed to ${to.join(', ')}.`); load() }} />
      )}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert('Could not copy - your browser blocked the clipboard.')
    }
  }
  return <Button variant="outlined" size="sm" icon={copied ? <Check /> : <Copy />} onClick={copy}>{copied ? 'Copied' : 'Copy text'}</Button>
}

function SendReminderDialog({ client, onClose, onSent }: {
  client: ReminderClient
  onClose: () => void
  onSent: (sentTo: string[]) => void
}) {
  const [to, setTo] = useState(client.email)
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(client.subject)
  const [message, setMessage] = useState(client.message)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const send = async () => {
    setSaving(true)
    setError('')
    try {
      const r = await remindersApi.send({ client_id: client.client, invoice_ids: client.invoices.map((i) => i.id),
        to, cc, subject, message, send_email: true })
      onSent(r.sent_to)
    } catch (err) {
      setError(errorText(err, 'Failed to send the reminder.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} icon={<BellRing />} title={`Remind ${client.client_name}`}
      subtitle={`${client.invoices.length} overdue invoice${client.invoices.length > 1 ? 's' : ''} · ${formatMoney(client.total_overdue)}`}
      widthClassName="max-w-xl"
      footer={<>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        <Button variant="contained" icon={<Mail />} onClick={send} disabled={saving}>{saving ? 'Sending…' : 'Send'}</Button>
      </>}>
      {error && <Alert>{error}</Alert>}
      <TextField id="rm-to" label="To" required value={to} onChange={(e) => setTo(e.target.value)} />
      <TextField id="rm-cc" label="Cc" value={cc} onChange={(e) => setCc(e.target.value)} />
      <TextField id="rm-subject" label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <TextField id="rm-message" label="Message" multiline rows={12} value={message} onChange={(e) => setMessage(e.target.value)} />
    </Modal>
  )
}
