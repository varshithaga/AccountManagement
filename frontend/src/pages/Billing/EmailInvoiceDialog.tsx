import { useEffect, useState } from 'react'
import { Mail, Paperclip } from 'lucide-react'
import { Alert, Button, Modal, Spinner, TextField } from '../../components/tw'
import { formatMoney } from '../../utils/periods'
import { emailApi, errorText } from './billingapi'
import type { BillingDoc, Company, EmailStatus } from './billingapi'
import { documentPdfBlob, pdfFilename, toPrintable } from './documentPdf'
import { formatDate } from './billingParts'

/** Emails a posted invoice to the client with its PDF attached. The PDF is made here, as for Download. */
export default function EmailInvoiceDialog({ invoice, company, onClose, onSent }: {
  invoice: BillingDoc
  company: Company
  onClose: () => void
  onSent: (sentTo: string[]) => void
}) {
  const from = company.name || 'Accounts'
  const [status, setStatus] = useState<EmailStatus | null>(null)
  const [to, setTo] = useState(invoice.party?.email ?? '')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(`Invoice ${invoice.invoice_number} from ${from}`)
  const [message, setMessage] = useState([
    `Dear ${invoice.party?.contact_person || invoice.client_name},`,
    '',
    `Please find attached invoice ${invoice.invoice_number} dated ${formatDate(invoice.invoice_date)} for ${formatMoney(invoice.total)}, `
      + `due on ${formatDate(invoice.due_date)}.`,
    '',
    'Regards,',
    from,
  ].join('\n'))
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => { emailApi.status().then(setStatus).catch(() => setStatus({ configured: false, from: '' })) }, [])

  const printable = toPrintable('sales', invoice)
  const send = async () => {
    if (!to.trim()) {
      setError('Enter the email address to send it to.')
      return
    }
    setSending(true)
    setError('')
    try {
      const pdf = await documentPdfBlob(printable, company)
      const r = await emailApi.sendInvoice(invoice.id, { to, cc, subject, message }, pdf, pdfFilename(printable))
      onSent(r.sent_to)
    } catch (err) {
      setError(errorText(err, 'Failed to send the email.'))
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal open onClose={onClose} icon={<Mail />} title={`Email invoice ${invoice.invoice_number}`}
      subtitle={status?.from ? `Sent from ${status.from}` : 'Sent with the invoice PDF attached.'}
      widthClassName="max-w-xl"
      footerHint={<span className="inline-flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" />{pdfFilename(printable)}</span>}
      footer={<>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        <Button variant="contained" icon={<Mail />} onClick={send} disabled={sending || !status?.configured}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </>}>
      {!status && <div className="flex justify-center p-6"><Spinner size={24} /></div>}
      {status && !status.configured && (
        <Alert>Email isn't set up on the server yet. Add SMTP_HOST and the other SMTP_ settings to backend/.env (see .env.example) and restart it.</Alert>
      )}
      {error && <Alert>{error}</Alert>}
      <TextField id="em-to" label="To" required value={to} onChange={(e) => setTo(e.target.value)} placeholder="accounts@client.com" />
      <TextField id="em-cc" label="Cc" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Separate addresses with commas" />
      <TextField id="em-subject" label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <TextField id="em-message" label="Message" multiline rows={8} value={message} onChange={(e) => setMessage(e.target.value)} />
    </Modal>
  )
}
