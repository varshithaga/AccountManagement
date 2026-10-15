import { useRef, useState } from 'react'
import {
  Download, UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle, Copy, X, SearchCheck, Check, Info,
} from 'lucide-react'
import { Button, Modal, Alert, Chip, Spinner } from './tw'
import { readWorkbookRows } from '../utils/excelImport'

export interface ImportExcelColumn {
  /** Internal field key the parsed row is keyed by. */
  key: string
  /** Column header text, matched case-insensitively against the uploaded file's header row. */
  header: string
  /** Optional custom column width. */
  width?: number
  /** Format the template column as Text, so Excel keeps values like "010" instead of turning them into 10. */
  text?: boolean
}

/** One entry in the column guide shown under the Download Template button. */
export interface ImportColumnGuide {
  /** Column header as it appears in the template (or a pattern such as "Sub-Category N"). */
  column: string
  required?: boolean
  /** What to enter in this column and how it is validated. */
  description: string
  example?: string
}

type RowStatus = 'accepted' | 'duplicate' | 'invalid'

interface ParsedImportRow<T> {
  rowNumber: number
  label: string
  status: RowStatus
  messages: string[]
  data: T | null
}

interface ImportExcelDialogProps<T> {
  open: boolean
  onClose: () => void
  title: string
  instructions?: string
  /** Singular noun for one imported row, e.g. "category", "keyword", "BAI code". Used in the success message. */
  itemLabel: string
  templateFilename: string
  templateColumns: ImportExcelColumn[]
  templateSampleRows: Record<string, string | number>[]
  /** Per-column help shown below the Download Template button. */
  columnGuide?: ImportColumnGuide[]
  /** Rules about rows (how rows are matched, skipped, repeated...) shown after the column guide. */
  rowGuide?: string[]
  /** Validates + shapes one raw Excel row. Return errors for a row that can't be accepted. */
  parseRow: (raw: Record<string, string>, rowNumber: number) => { data: T | null; label: string; errors: string[] }
  /** Returns a reason string if `data` duplicates something already accepted (in this file or already saved), or null if it's fine. */
  checkDuplicate: (data: T, acceptedSoFar: T[]) => string | null
  /** Commits the accepted rows (fileName is the uploaded file's name). Throw (or return a rejected promise) to surface a fatal error. */
  onSubmit: (accepted: T[], fileName: string) => Promise<void>
  /** Called once the import has been committed, so the caller can refresh its list. */
  onImported: () => void
}

const STATUS_META: Record<RowStatus, { label: string; tone: 'success' | 'warning' | 'error' }> = {
  accepted: { label: 'Accepted', tone: 'success' },
  duplicate: { label: 'Duplicate — skipped', tone: 'warning' },
  invalid: { label: 'Incorrect / unsupported', tone: 'error' },
}


export default function ImportExcelDialog<T>({
  open, onClose, title, instructions, itemLabel, templateFilename, templateColumns, templateSampleRows,
  columnGuide, rowGuide, parseRow, checkDuplicate, onSubmit, onImported,
}: ImportExcelDialogProps<T>) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  /** The file's rows as read, before analysis. */
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const [rows, setRows] = useState<ParsedImportRow<T>[]>([])
  /** Rows are only validated (and Submit enabled) once Analyse is clicked. */
  const [analysed, setAnalysed] = useState(false)
  const [showErrorsOnly, setShowErrorsOnly] = useState(false)
  const [fatalError, setFatalError] = useState('')
  const [downloadingTemplate, setDownloadingTemplate] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<{ imported: number; failed: number } | null>(null)

  const reset = () => {
    setFile(null)
    setParsing(false)
    setRawRows([])
    setRows([])
    setAnalysed(false)
    setShowErrorsOnly(false)
    setFatalError('')
    setSubmitting(false)
    setSubmitted(null)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleDownloadTemplate = async () => {
    setDownloadingTemplate(true)
    try {
      const { default: ExcelJS } = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('Template')

      sheet.columns = templateColumns.map((c) => ({
        header: c.header,
        key: c.key,
        width: c.width || Math.max(14, c.header.length + 4),
        style: c.text ? { numFmt: '@' } : undefined,
      }))

      const headerRow = sheet.getRow(1)
      headerRow.height = 24
      headerRow.eachCell((cell) => {
        cell.font = { name: 'Arial', bold: true, color: { argb: 'FF0F172A' }, size: 10 }
        cell.alignment = { vertical: 'middle', horizontal: 'left' }
      })

      templateSampleRows.forEach((r) => {
        const row = sheet.addRow(r)
        row.height = 20
        row.eachCell((cell) => {
          cell.font = { name: 'Arial', size: 10 }
          cell.alignment = { vertical: 'middle', horizontal: 'left' }
        })
      })

      if (columnGuide?.length || rowGuide?.length) {
        const help = workbook.addWorksheet('Instructions')
        help.columns = [
          { header: 'Column', key: 'column', width: 32 },
          { header: 'Required', key: 'required', width: 12 },
          { header: 'What to enter', key: 'description', width: 90 },
          { header: 'Example', key: 'example', width: 22 },
        ]
        help.getRow(1).font = { name: 'Arial', bold: true, size: 10 }
        ;(columnGuide || []).forEach((c) => {
          help.addRow({ column: c.column, required: c.required ? 'Required' : 'Optional', description: c.description, example: c.example || '' })
        })
        if (rowGuide?.length) {
          help.addRow({})
          help.addRow({ column: 'Rows' }).font = { name: 'Arial', bold: true, size: 10 }
          rowGuide.forEach((rule) => help.addRow({ column: '•', description: rule }))
        }
        help.eachRow((row) => row.eachCell((cell) => {
          cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true }
        }))
      }

      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = templateFilename
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } finally {
      setDownloadingTemplate(false)
    }
  }

  const handleFile = async (chosen: File) => {
    setFile(chosen)
    setFatalError('')
    setRawRows([])
    setRows([])
    setAnalysed(false)
    setSubmitted(null)
    setShowErrorsOnly(false)
    setParsing(true)
    try {
      const read = await readWorkbookRows(chosen)
      if (read.length === 0) {
        setFatalError('No data rows were found in this file — make sure it matches the template and has at least one filled row below the header.')
        return
      }
      setRawRows(read)
    } catch {
      setFatalError('Could not read this file — please check it is a valid .xlsx file matching the template.')
    } finally {
      setParsing(false)
    }
  }

  /** Checks every row (required fields, lookups, duplicates) - saves nothing. */
  const analyse = () => {
    setFatalError('')
    const accepted: T[] = []
    const parsed: ParsedImportRow<T>[] = rawRows.map((raw, idx) => {
      const rowNumber = idx + 2 // header is row 1
      const { data, label, errors } = parseRow(raw, rowNumber)

      if (!data || errors.length > 0) {
        return { rowNumber, label, status: 'invalid', messages: errors, data: null }
      }

      const dupReason = checkDuplicate(data, accepted)
      if (dupReason) {
        return { rowNumber, label, status: 'duplicate', messages: [dupReason], data: null }
      }

      accepted.push(data)
      return { rowNumber, label, status: 'accepted', messages: [], data }
    })
    setRows(parsed)
    setAnalysed(true)
    setShowErrorsOnly(parsed.some((r) => r.status !== 'accepted'))
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0]
    e.target.value = ''
    if (chosen) handleFile(chosen)
  }

  const acceptedRows = rows.filter((r) => r.status === 'accepted')
  const duplicateRows = rows.filter((r) => r.status === 'duplicate')
  const invalidRows = rows.filter((r) => r.status === 'invalid')
  const errorRows = [...duplicateRows, ...invalidRows]
  const visibleRows = showErrorsOnly ? errorRows : rows

  const handleSubmit = async () => {
    const toImport = acceptedRows.map((r) => r.data as T)
    if (!analysed || toImport.length === 0) return
    setSubmitting(true)
    setFatalError('')
    try {
      await onSubmit(toImport, file?.name ?? '')
      setSubmitted({ imported: toImport.length, failed: 0 })
      onImported()
    } catch (err) {
      // Bulk endpoints reply {"error": ["Row 3: ..."]} - nothing is saved, so show why.
      const details = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error
      // The server numbers rows within what was sent; point back at the Excel row instead.
      const toExcelRow = (msg: string) => msg.replace(/^Row (\d+):/, (m, n) => {
        const row = acceptedRows[Number(n) - 1]
        return row ? `Excel row ${row.rowNumber} (${row.label}):` : m
      })
      const reasons = Array.isArray(details) ? details.map(String).map(toExcelRow).join(' ') : typeof details === 'string' ? details : ''
      setFatalError(`Import failed - nothing was saved.${reasons ? ` ${reasons}` : ' Please try again.'}`)
    } finally {
      setSubmitting(false)
    }
  }

  // Where the user is in the four steps: template -> upload -> analyse -> submit.
  const doneSteps = [!!file, rawRows.length > 0, analysed, !!submitted]
  const currentStep = doneSteps.findIndex((d) => !d)
  const STEPS = ['Template', 'Upload', 'Analyse', 'Submit']

  const ruleTone = (rule: string): 'success' | 'warning' | 'info' =>
    /skip|duplicate|incorrect|not imported|without/i.test(rule) ? 'warning'
      : /example|replace|delete|afterwards|edit/i.test(rule) ? 'info'
        : 'success'
  const RULE_ICON = {
    success: <CheckCircle2 className="h-4 w-4 text-success" />,
    warning: <AlertTriangle className="h-4 w-4 text-warning" />,
    info: <Info className="h-4 w-4 text-primary" />,
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      icon={<FileSpreadsheet />}
      title={title}
      subtitle={instructions || 'Fill in your rows below the sample data, keeping the header row unchanged.'}
      widthClassName="max-w-[820px]"
      footerHint={submitted ? 'Import complete.' : analysed ? `${acceptedRows.length} row${acceptedRows.length === 1 ? '' : 's'} ready to import.` : 'Nothing is saved until you submit.'}
      footer={
        submitted ? (
          <Button variant="contained" onClick={handleClose}>Close</Button>
        ) : (
          <>
            <Button variant="outlined" onClick={handleClose}>Cancel</Button>
            <Button
              variant={analysed ? 'outlined' : 'contained'}
              icon={<SearchCheck className="h-4 w-4" />}
              onClick={analyse}
              disabled={!rawRows.length || parsing || submitting}
            >
              {analysed ? 'Re-analyse' : 'Analyse'}
            </Button>
            <Button
              variant="contained"
              onClick={handleSubmit}
              disabled={!analysed || submitting || acceptedRows.length === 0}
            >
              {submitting ? 'Submitting...' : `Submit${analysed ? ` (${acceptedRows.length})` : ''}`}
            </Button>
          </>
        )
      }
    >
      {/* Four-step progress */}
      <ol className="grid grid-cols-4 gap-2">
        {STEPS.map((label, i) => {
          const done = doneSteps[i]
          const current = i === currentStep
          return (
            <li key={label} className="flex flex-col gap-2">
              <div className={`h-1 rounded ${done ? 'bg-success' : current ? 'bg-primary' : 'bg-border-soft'}`} />
              <div className="flex items-center gap-2">
                <span className={`num flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  done ? 'bg-success text-white' : current ? 'bg-primary text-white' : 'border border-input text-muted'
                }`}>
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={`text-[13px] font-semibold ${done || current ? 'text-ink' : 'text-muted'}`}>{label}</span>
              </div>
            </li>
          )
        })}
      </ol>

      {/* Step 1: download template */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-display text-base font-semibold text-ink">Download the template</p>
            <p className="text-[13px] text-muted">Keep the header row as it is - your data starts on row 2.</p>
          </div>
          <Button variant="outlined" icon={<Download className="h-4 w-4" />} onClick={handleDownloadTemplate} disabled={downloadingTemplate}>
            {downloadingTemplate ? 'Preparing...' : 'Download template'}
          </Button>
        </div>

        {columnGuide && columnGuide.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-muted">Columns</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {columnGuide.map((c) => (
                <div key={c.column} className="rounded-2xl border border-border bg-surface-muted p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">{c.column}</p>
                    {c.required
                      ? <span className="shrink-0 rounded-[20px] bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-primary-hover dark:text-primary">Required</span>
                      : <span className="shrink-0 rounded-[20px] bg-surface px-2 py-0.5 text-[11px] font-bold text-muted ring-1 ring-border">Optional</span>}
                  </div>
                  <p className="mt-1.5 text-[13px] leading-snug text-muted">{c.description}</p>
                  {c.example && (
                    <p className="mt-2.5 text-xs text-muted">
                      e.g. <span className="num rounded-md bg-surface px-1.5 py-0.5 text-ink ring-1 ring-border">{c.example}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {rowGuide && rowGuide.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-muted">Rules</p>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {rowGuide.map((rule) => (
                <li key={rule} className="flex items-start gap-2.5 text-[13px] leading-snug text-ink">
                  <span className="mt-px shrink-0">{RULE_ICON[ruleTone(rule)]}</span>
                  {rule}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Step 2: upload */}
      <section>
        <p className="font-display text-base font-semibold text-ink">Upload your filled file</p>
        <p className="mb-3 text-[13px] text-muted">
          Then Analyse it to check for missing or invalid fields and duplicates. Nothing is saved until you Submit.
        </p>
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click() } }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const dropped = e.dataTransfer.files?.[0]
            if (dropped) handleFile(dropped)
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[18px] border-2 border-dashed px-6 py-10 text-center outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-primary-soft ${
            dragOver ? 'border-primary bg-primary-soft' : 'border-primary-border bg-primary-soft/40 hover:bg-primary-soft'
          }`}
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface text-primary shadow-[0_1px_2px_rgb(10_26_58/0.08)]">
            <UploadCloud className="h-6 w-6 stroke-[1.8]" />
          </span>
          <p className="text-sm font-semibold text-ink">
            {file ? file.name : <>Drag &amp; drop your .xlsx file here, or <span className="text-primary">browse</span></>}
          </p>
          {!file && <p className="text-xs text-muted">Accepts .xlsx / .xls</p>}
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleInputChange} />
        </div>
        {parsing && (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            <Spinner size={16} /> Reading file...
          </div>
        )}
      </section>

      {fatalError && <Alert>{fatalError}</Alert>}

      {submitted && (
        <div role="status" className="rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm font-medium text-success-text">
          Imported <span className="num">{submitted.imported}</span> {itemLabel}{submitted.imported === 1 ? '' : 's'} successfully.
        </div>
      )}

      {rawRows.length > 0 && !analysed && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-muted px-4 py-3 text-sm text-ink">
          <span className="font-semibold"><span className="num">{rawRows.length}</span> row{rawRows.length === 1 ? '' : 's'} read from the file.</span>
          <Chip tone="neutral">Not analysed yet - click Analyse</Chip>
        </div>
      )}

      {analysed && rows.length > 0 && (
        <div>
          {/* Summary + view errors toggle */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="success"><span className="num mr-1">{acceptedRows.length}</span> Accepted</Chip>
              <Chip tone="warning"><span className="num mr-1">{duplicateRows.length}</span> Duplicate</Chip>
              <Chip tone="error"><span className="num mr-1">{invalidRows.length}</span> Incorrect</Chip>
              <span className="text-xs text-muted">of <span className="num">{rows.length}</span> row{rows.length === 1 ? '' : 's'} read</span>
            </div>
            {errorRows.length > 0 && (
              <Button
                variant="outlined"
                size="sm"
                color="error"
                icon={<AlertTriangle className="h-4 w-4" />}
                onClick={() => setShowErrorsOnly((v) => !v)}
              >
                {showErrorsOnly ? 'Show all rows' : `View errors (${errorRows.length})`}
              </Button>
            )}
          </div>

          {/* Results table */}
          <div className="max-h-72 overflow-auto rounded-2xl border border-border">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead className="sticky top-0 bg-surface-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-left">Row</th>
                  <th className="px-4 py-2.5 text-left">Item</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                  <th className="px-4 py-2.5 text-left">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {visibleRows.map((r) => {
                  const meta = STATUS_META[r.status]
                  return (
                    <tr key={r.rowNumber}>
                      <td className="num px-4 py-2.5 text-muted">{r.rowNumber}</td>
                      <td className="px-4 py-2.5 font-semibold text-ink">{r.label || '—'}</td>
                      <td className="px-4 py-2.5">
                        <Chip tone={meta.tone}>
                          {r.status === 'accepted' && <CheckCircle2 className="mr-1 inline h-3 w-3" />}
                          {r.status === 'duplicate' && <Copy className="mr-1 inline h-3 w-3" />}
                          {r.status === 'invalid' && <X className="mr-1 inline h-3 w-3" />}
                          {meta.label}
                        </Chip>
                      </td>
                      <td className="px-4 py-2.5 text-[13px] text-muted">{r.messages.join('; ') || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}
