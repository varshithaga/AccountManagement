import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  FileSpreadsheet, UploadCloud, FileDown, CheckCircle2, AlertTriangle, XCircle, CopyCheck, Copy, ChevronDown,
  ChevronRight, Download, Landmark, SearchCheck, Clock, List, FileJson, FolderPlus, Undo2,
} from 'lucide-react'
import { Button, Modal, Alert, Chip, Spinner } from '../../components/tw'
import BankAccountSelect from '../../components/BankAccountSelect'
import { readWorkbookRows } from '../../utils/excelImport'
import { exportToExcel } from '../../utils/excelExport'
import { bankReconciliationApi } from '../BankReconciliation/bankreconciliationapi'
import type { BankAccount } from '../../types'
import {
  journalEntriesApi, type JournalAnalysisStatus, type JournalImportResult, type JournalLineAccount,
} from './journalentriesapi'
import AccountFixDialog, { UsedOnList, type UnknownAccount } from './AccountFixDialog'
import {
  JOURNAL_IMPORT_RULES, JOURNAL_JSON_FIELDS, JOURNAL_TEMPLATE_COLUMNS, buildJournalSampleJson, downloadJournalSample,
  downloadJournalSampleJson,
} from './journalTemplate'
import {
  accountRefKey, groupJournalRows, parseJournalJson, parseJournalRow, rowRangeLabel, toImportEntry,
  type JournalFileEntry,
} from './journalImportParsing'

/** Sub categories chosen or added in this dialog for accounts the file names but the Chart of Accounts lacks. */
type AccountOverrides = Map<string, { id: number; label: string }>

const overrideIds = (overrides: AccountOverrides) => new Map([...overrides].map(([k, v]) => [k, v.id]))

/** PENDING = passed the file checks, not analysed against the database yet. */
type RowStatus = JournalAnalysisStatus | 'PENDING'

interface EntryVerdict {
  status: RowStatus
  /** Problems about the entry as a whole (balance, duplicates, dates...). */
  entryMessages: string[]
  /** Problems about one of its lines, by the line's index within the entry. */
  lineMessages: Map<number, string[]>
}

type Severity = 'error' | 'duplicate' | 'warning' | 'info'

interface Issue {
  severity: Severity
  where: string
  entryNumber: string
  message: string
}

type StatusFilter = 'ALL' | RowStatus

const STATUS_META: Record<RowStatus, { label: string; tone: 'success' | 'warning' | 'error' | 'neutral' | 'info' | 'primary'; icon: ReactNode }> = {
  PENDING: { label: 'Not analysed', tone: 'neutral', icon: <Clock className="mr-1 inline h-3 w-3" /> },
  READY: { label: 'Ready', tone: 'success', icon: <CheckCircle2 className="mr-1 inline h-3 w-3" /> },
  WARNING: { label: 'Ready - check', tone: 'warning', icon: <AlertTriangle className="mr-1 inline h-3 w-3" /> },
  DUPLICATE: { label: 'Possible duplicate', tone: 'primary', icon: <Copy className="mr-1 inline h-3 w-3" /> },
  SKIPPED: { label: 'Already imported', tone: 'neutral', icon: <CopyCheck className="mr-1 inline h-3 w-3" /> },
  ERROR: { label: 'Error', tone: 'error', icon: <XCircle className="mr-1 inline h-3 w-3" /> },
}

const SEVERITY_OF: Record<RowStatus, Severity> = {
  ERROR: 'error', DUPLICATE: 'duplicate', WARNING: 'warning', SKIPPED: 'info', READY: 'warning', PENDING: 'warning',
}

const SEVERITY_META: Record<Severity, { title: string; className: string }> = {
  error: { title: 'Errors - not imported until fixed', className: 'text-danger-text' },
  duplicate: { title: 'Possible duplicates - left out unless you tick "import anyway"', className: 'text-primary' },
  warning: { title: 'Warnings - imported, but worth a look', className: 'text-warning-text' },
  info: { title: 'Already imported - skipped', className: 'text-muted' },
}

const fmt = (v: number | string) =>
  Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Splits server messages like "line 2: account not found" onto the entry's line 2. */
function splitMessages(messages: string[]) {
  const entryMessages: string[] = []
  const lineMessages = new Map<number, string[]>()
  for (const m of messages) {
    const match = m.match(/^line (\d+): (.*)$/)
    if (match) {
      const idx = Number(match[1]) - 1
      lineMessages.set(idx, [...(lineMessages.get(idx) ?? []), match[2]])
    } else {
      entryMessages.push(m)
    }
  }
  return { entryMessages, lineMessages }
}

function Step({ n, title, caption, children }: { n: number; title: string; caption?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-4 ">
      <p className="mb-0.5 text-sm font-bold text-ink">{n}. {title}</p>
      {caption && <p className="mb-2.5 text-xs text-muted">{caption}</p>}
      {children}
    </div>
  )
}

function Tile({ label, value, sub, className = 'text-ink' }: { label: string; value: ReactNode; sub?: string; className?: string }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2.5 ">
      <div className="text-[0.65rem] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${className}`}>{value}</div>
      {sub && <div className="text-[0.7rem] text-muted">{sub}</div>}
    </div>
  )
}

export default function JournalImportDialog({
  open, onClose, onImported, defaultBankAccount = null,
}: {
  open: boolean
  onClose: () => void
  /** Called after a successful import, with the server's result. */
  onImported: (result: JournalImportResult) => void
  defaultBankAccount?: number | null
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [bankAccountId, setBankAccountId] = useState<number | null>(defaultBankAccount)
  const [bankAccount, setBankAccount] = useState<BankAccount | null>(null)
  const [showFormat, setShowFormat] = useState(false)
  const [formatTab, setFormatTab] = useState<'excel' | 'json'>('excel')
  const [jsonSample, setJsonSample] = useState('')
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [entries, setEntries] = useState<JournalFileEntry[]>([])
  const [serverVerdicts, setServerVerdicts] = useState<Map<string, { status: JournalAnalysisStatus; messages: string[] }>>(new Map())
  const [analysed, setAnalysed] = useState(false)
  const [analysing, setAnalysing] = useState(false)
  /** Per entry key: the account each of its lines posts to, from the last analysis. */
  const [serverAccounts, setServerAccounts] = useState<Map<string, JournalLineAccount[]>>(new Map())
  const [overrides, setOverrides] = useState<AccountOverrides>(new Map())
  const [fixing, setFixing] = useState<UnknownAccount | null>(null)

  const [filter, setFilter] = useState<StatusFilter>('ALL')
  const [showErrors, setShowErrors] = useState(false)
  const [includeDuplicates, setIncludeDuplicates] = useState(false)
  const [fatalError, setFatalError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<JournalImportResult | null>(null)
  /** A JSON file numbers its lines 1, 2, 3...; an Excel file uses its sheet rows. */
  const isJson = Boolean(file?.name.toLowerCase().endsWith('.json'))
  const rowWord = isJson ? 'Line' : 'Row'

  useEffect(() => {
    if (open) setBankAccountId(defaultBankAccount)
  }, [open, defaultBankAccount])

  useEffect(() => {
    setBankAccount(null)
    if (!bankAccountId) return
    let cancelled = false
    bankReconciliationApi.getBankAccount(bankAccountId)
      .then((acc) => { if (!cancelled) setBankAccount(acc) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [bankAccountId])

  const clearAnalysis = () => {
    setServerVerdicts(new Map())
    setServerAccounts(new Map())
    setAnalysed(false)
    setIncludeDuplicates(false)
  }

  const reset = () => {
    setFile(null)
    setEntries([])
    setOverrides(new Map())
    clearAnalysis()
    setFilter('ALL')
    setShowErrors(false)
    setFatalError('')
    setResult(null)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  // The bank account decides what "Bank" means, so a new one needs a fresh analysis.
  const changeBankAccount = (id: number | null) => {
    setBankAccountId(id)
    clearAnalysis()
  }

  const handleFile = async (chosen: File) => {
    reset()
    setFile(chosen)
    if (chosen.name.toLowerCase().endsWith('.json')) {
      setParsing(true)
      try {
        const { lines, error } = parseJournalJson(await chosen.text())
        if (error) setFatalError(error)
        else setEntries(groupJournalRows(lines))
      } catch {
        setFatalError('Could not read this file - please check it is a valid .json file.')
      } finally {
        setParsing(false)
      }
      return
    }
    if (!chosen.name.toLowerCase().endsWith('.xlsx')) {
      setFatalError('Upload an Excel (.xlsx) or JSON (.json) file.')
      return
    }
    setParsing(true)
    try {
      const raw = await readWorkbookRows(chosen)
      if (raw.length === 0) {
        setFatalError('No data rows were found - make sure the first sheet has the header row and at least one filled row below it.')
        return
      }
      const headers = new Set(Object.keys(raw[0]))
      const missing = ['Entry No', 'Date', 'Debit', 'Credit'].filter((h) =>
        !headers.has(h.toLowerCase()) && !(h === 'Entry No' && headers.has('entry number')))
      if (!['sub category id', 'sub category name', 'account'].some((h) => headers.has(h))) {
        missing.push('Sub Category ID / Sub Category Name')
      }
      if (missing.length) {
        setFatalError(`The header row is missing: ${missing.map((h) => `"${h}"`).join(', ')}. Download the sample to see the expected columns.`)
        return
      }
      setEntries(groupJournalRows(raw.map((r, i) => parseJournalRow(r, i + 2))))
    } catch {
      setFatalError('Could not read this file - please check it is a valid .xlsx file.')
    } finally {
      setParsing(false)
    }
  }

  /** Checks every entry against the database - saves nothing. Entries with file errors are sent
   * too, so one already imported shows as such and their unknown / missing sub categories can be fixed. */
  const analyse = async (useOverrides: AccountOverrides = overrides) => {
    setFatalError('')
    setIncludeDuplicates(false)
    if (entries.length === 0) return
    setAnalysing(true)
    try {
      const ids = overrideIds(useOverrides)
      const analysis = await journalEntriesApi.analyse(entries.map((e) => toImportEntry(e, ids)), bankAccountId)
      const verdicts = new Map(analysis.entries.map((r, i) => [
        entries[i].key, { status: r.status, messages: [...r.errors, ...r.warnings] },
      ]))
      setServerVerdicts(verdicts)
      setServerAccounts(new Map(analysis.entries.map((r, i) => [entries[i].key, r.accounts ?? []])))
      setAnalysed(true)
      setFilter('ALL')
      if ([...verdicts.values()].some((v) => v.status === 'ERROR' || v.status === 'DUPLICATE') || entries.some((e) => e.errors.length)) {
        setShowErrors(true)
      }
    } catch (err) {
      const details = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error
      setFatalError(`Could not analyse the file. ${Array.isArray(details) ? details.join(' ') : 'Please try again.'}`)
    } finally {
      setAnalysing(false)
    }
  }

  const verdictOf = (e: JournalFileEntry): EntryVerdict => {
    const server = serverVerdicts.get(e.key)
    if (server?.status === 'SKIPPED') {
      // Already imported - skipped whatever else is wrong with it in the file.
      return { status: 'SKIPPED', ...splitMessages(server.messages) }
    }
    if (e.errors.length) {
      // File-level errors: row problems stay on their rows, the rest belong to the entry.
      const lineMessages = new Map<number, string[]>()
      e.rows.forEach((r, i) => { if (r.errors.length) lineMessages.set(i, r.errors) })
      return { status: 'ERROR', entryMessages: [...e.errors.filter((m) => !/^Row \d+:/.test(m)), ...e.warnings], lineMessages }
    }
    if (!server) return { status: 'PENDING', entryMessages: e.warnings, lineMessages: new Map() }
    const { entryMessages, lineMessages } = splitMessages(server.messages)
    const status: RowStatus = server.status === 'READY' && e.warnings.length ? 'WARNING' : server.status
    return { status, entryMessages: [...entryMessages, ...e.warnings], lineMessages }
  }

  const verdicts = useMemo(() => new Map(entries.map((e) => [e.key, verdictOf(e)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, serverVerdicts])

  /** Every row of the file, in sheet order, with its entry's status, its own problems and (once
   * analysed) the account it posts to. */
  const rows = useMemo(() => entries
    .flatMap((entry) => entry.rows.map((line, i) => ({
      line, entry, verdict: verdicts.get(entry.key)!, messages: verdicts.get(entry.key)!.lineMessages.get(i) ?? [],
      account: serverAccounts.get(entry.key)?.[i],
    })))
    .sort((a, b) => a.line.rowNumber - b.line.rowNumber), [entries, verdicts, serverAccounts])

  /** Accounts the file names that the Chart of Accounts doesn't have, one per reference. */
  const unknownAccounts = useMemo(() => {
    const byKey = new Map<string, UnknownAccount>()
    for (const { line, entry, verdict, account } of rows) {
      if (!account || account.sub_category_id || verdict.status === 'SKIPPED') continue
      const key = accountRefKey(line)
      const known = byKey.get(key)
      const empty = !line.sub_category_name && !line.sub_category_id
      const amount = line.debit ? `Dr ${fmt(line.debit)}` : line.credit ? `Cr ${fmt(line.credit)}` : ''
      const description = line.description || line.narration
      const usedOn = [`${rowWord} ${line.rowNumber}`, entry.entry_number || '—', description && `"${description}"`, amount]
        .filter(Boolean).join(' · ')
      if (known) {
        known.lines += 1
        known.usedOn.push(usedOn)
      } else byKey.set(key, {
        key, name: line.sub_category_name, categoryName: line.category_name, subCategoryId: line.sub_category_id,
        reason: empty ? 'No sub category in the file - enter one to import it.' : account.error || 'Not found in the Chart of Accounts.',
        lines: 1,
        usedOn: [usedOn],
      })
    }
    return [...byKey.values()]
  }, [rows, rowWord])

  /** Uses the chosen / new sub category for every line of that reference and re-checks the file. */
  const resolveAccount = (key: string, subCategory: { id: number; label: string }) => {
    const next = new Map(overrides).set(key, subCategory)
    setOverrides(next)
    setFixing(null)
    analyse(next)
  }

  const undoOverride = (key: string) => {
    const next = new Map(overrides)
    next.delete(key)
    setOverrides(next)
    analyse(next)
  }

  const entryCounts = useMemo(() => {
    const c: Record<RowStatus, number> = { PENDING: 0, READY: 0, WARNING: 0, DUPLICATE: 0, SKIPPED: 0, ERROR: 0 }
    entries.forEach((e) => { c[verdicts.get(e.key)!.status] += 1 })
    return c
  }, [entries, verdicts])

  const rowCounts = useMemo(() => {
    const c: Record<RowStatus, number> = { PENDING: 0, READY: 0, WARNING: 0, DUPLICATE: 0, SKIPPED: 0, ERROR: 0 }
    rows.forEach((r) => { c[r.verdict.status] += 1 })
    return c
  }, [rows])

  const issues = useMemo(() => {
    const list: Issue[] = []
    for (const entry of entries) {
      const v = verdicts.get(entry.key)!
      const severity = SEVERITY_OF[v.status]
      const entryNumber = entry.entry_number || '—'
      const where = rowRangeLabel(entry)
      v.entryMessages.forEach((message) => list.push({
        severity, where: isJson ? where.replace(/^Rows?/, (w) => (w === 'Rows' ? 'Lines' : 'Line')) : where, entryNumber, message,
      }))
      v.lineMessages.forEach((messages, i) => messages.forEach((message) =>
        list.push({ severity, where: `${rowWord} ${entry.rows[i]?.rowNumber ?? '?'}`, entryNumber, message })))
    }
    return list
  }, [entries, verdicts, isJson, rowWord])
  const errorCount = issues.filter((i) => i.severity === 'error').length

  const importableStatuses: RowStatus[] = includeDuplicates ? ['READY', 'WARNING', 'DUPLICATE'] : ['READY', 'WARNING']
  const toImport = entries.filter((e) => importableStatuses.includes(verdicts.get(e.key)!.status))
  const totals = {
    lines: toImport.reduce((s, e) => s + e.rows.length, 0),
    debit: toImport.reduce((s, e) => s + e.totalDebit, 0),
    credit: toImport.reduce((s, e) => s + e.totalCredit, 0),
  }
  const visible = filter === 'ALL' ? rows : rows.filter((r) => r.verdict.status === filter)

  const handleSubmit = async () => {
    if (!analysed || !toImport.length || !file) return
    setSubmitting(true)
    setFatalError('')
    try {
      const ids = overrideIds(overrides)
      const res = await journalEntriesApi.import(toImport.map((e) => toImportEntry(e, ids)), isJson ? 'JSON' : 'EXCEL', file.name, bankAccountId, includeDuplicates)
      setResult(res)
      onImported(res)
    } catch (err) {
      const details = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error
      setFatalError(`Import failed - nothing was saved. ${Array.isArray(details) ? details.join(' ') : 'Please try again.'}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDownloadSample = async (format: 'excel' | 'json') => {
    setDownloading(true)
    try {
      if (format === 'json') await downloadJournalSampleJson(Boolean(bankAccountId))
      else await downloadJournalSample(Boolean(bankAccountId))
    } finally {
      setDownloading(false)
    }
  }

  // The JSON example in the format guide uses real accounts, like the downloadable samples.
  useEffect(() => {
    if (!showFormat || formatTab !== 'json') return
    let cancelled = false
    buildJournalSampleJson(Boolean(bankAccountId)).then((s) => { if (!cancelled) setJsonSample(s) }).catch(() => {})
    return () => { cancelled = true }
  }, [showFormat, formatTab, bankAccountId])

  const copySample = async () => {
    try {
      await navigator.clipboard.writeText(jsonSample)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked - the example can still be selected by hand.
    }
  }

  /** Every row whose entry won't import cleanly, with the reasons - to fix in Excel. */
  const handleDownloadIssues = async () => {
    const problemRows = rows.filter((r) => !['READY', 'PENDING'].includes(r.verdict.status) || r.messages.length)
    await exportToExcel('journal_import_issues.xlsx', 'Issues', [
      { header: isJson ? 'JSON Line' : 'Excel Row', key: 'row', width: 10 },
      ...JOURNAL_TEMPLATE_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 14 })),
      { header: 'Status', key: 'status', width: 18 },
      { header: 'Row Issue', key: 'row_issue', width: 50 },
      { header: 'Entry Issue', key: 'entry_issue', width: 60 },
    ], problemRows.map(({ line, verdict, messages }) => ({
      row: line.rowNumber,
      entry_number: line.entry_number,
      date: line.date || line.rawDate,
      narration: line.narration,
      category_name: line.category_name,
      sub_category_id: line.sub_category_id,
      sub_category_name: line.sub_category_name,
      debit: line.debit,
      credit: line.credit,
      description: line.description,
      status: STATUS_META[verdict.status].label,
      row_issue: messages.join('; '),
      entry_issue: verdict.entryMessages.join('; '),
    })))
  }

  const gl = bankAccount?.gl_account_name
  const shownEntryMessages = new Set<string>()

  return (
    <>
    <Modal
      open={open}
      onClose={handleClose}
      icon={<FileSpreadsheet className="h-4 w-4 text-primary" />}
      title="Import Journal Entries (Excel or JSON)"
      widthClassName="max-w-6xl"
      footer={
        result ? (
          <Button variant="contained" onClick={handleClose}>Close</Button>
        ) : (
          <>
            {analysed && issues.length > 0 && (
              <Button variant="outlined" icon={<Download className="h-4 w-4" />} onClick={handleDownloadIssues} className="mr-auto">
                Download Issues
              </Button>
            )}
            <Button variant="outlined" onClick={handleClose}>Cancel</Button>
            <Button
              variant={analysed ? 'outlined' : 'contained'}
              icon={analysing ? <Spinner size={14} /> : <SearchCheck className="h-4 w-4" />}
              onClick={() => analyse()}
              disabled={!entries.length || parsing || analysing || submitting}
            >
              {analysing ? 'Analysing...' : analysed ? 'Re-analyse' : '1. Analyse'}
            </Button>
            <Button
              variant="contained"
              color="success"
              onClick={handleSubmit}
              disabled={!analysed || analysing || submitting || toImport.length === 0}
            >
              {submitting ? 'Submitting...' : `2. Submit ${analysed ? `${toImport.length} entr${toImport.length === 1 ? 'y' : 'ies'}` : ''}`}
            </Button>
          </>
        )
      }
    >
      <div className="-mr-2 flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-2">
        {/* SETUP: bank account, format, upload */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Step n={1} title="Bank account" caption="Which bank are these entries for? Leave empty for general journal entries (depreciation, accruals...).">
            <BankAccountSelect value={bankAccountId} onChange={(id) => changeBankAccount(id)} label="Bank Account" placeholder="None - general journal" disabled={Boolean(result)} />
            {bankAccountId && bankAccount && (
              gl ? (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
                  <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
                  <span>Write <b>Bank</b> as the Sub Category Name on the bank side of each entry - it posts to <b>{gl}</b>.</span>
                </p>
              ) : (
                <p className="mt-2 text-xs text-warning-text">
                  "{bankAccount.name}" isn't linked to a GL account, so "Bank" can't be used - link it on Bank Accounts, or write the ledger's name.
                </p>
              )
            )}
          </Step>

          <Step n={2} title="Upload the file" caption="Excel: one row per debit or credit line, rows with the same Entry No form one entry. JSON: a list of entries, each with its lines.">
            <div
              onClick={() => !result && fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                const dropped = e.dataTransfer.files?.[0]
                if (dropped && !result) handleFile(dropped)
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
                dragOver
                  ? 'border-violet-500 bg-primary-soft'
                  : 'border-input hover:border-violet-400 hover:bg-surface-muted '
              }`}
            >
              {isJson ? <FileJson className="h-6 w-6 text-muted" /> : <UploadCloud className="h-6 w-6 text-muted" />}
              <p className="text-sm font-semibold text-ink">
                {file ? file.name : 'Drag & drop your .xlsx or .json file, or click to browse'}
              </p>
              {file && !result && <p className="text-xs text-muted">Click to choose a different file</p>}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.json,application/json"
                className="hidden"
                onChange={(e) => {
                  const chosen = e.target.files?.[0]
                  e.target.value = ''
                  if (chosen) handleFile(chosen)
                }}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outlined" icon={<FileDown className="h-3.5 w-3.5" />} onClick={() => handleDownloadSample('excel')} disabled={downloading}>
                {downloading ? 'Preparing...' : 'Excel Sample & Guide'}
              </Button>
              <Button size="sm" variant="outlined" icon={<FileJson className="h-3.5 w-3.5" />} onClick={() => handleDownloadSample('json')} disabled={downloading}>
                JSON Sample
              </Button>
              <Button size="sm" variant="text" icon={showFormat ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} onClick={() => setShowFormat((v) => !v)}>
                How entries should look
              </Button>
            </div>
            {showFormat && (
              <div className="mt-2 text-xs text-muted">
                <div className="mb-2 inline-flex rounded-lg border border-border p-0.5 ">
                  {(['excel', 'json'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setFormatTab(tab)}
                      className={`rounded-md px-3 py-1 font-bold ${formatTab === tab ? 'bg-violet-600 text-white dark:bg-violet-500' : 'text-muted hover:bg-surface-muted '}`}
                    >
                      {tab === 'excel' ? 'Excel' : 'JSON'}
                    </button>
                  ))}
                </div>
                {formatTab === 'excel' ? (
                  <>
                    <p className="mb-1">Columns: {JOURNAL_TEMPLATE_COLUMNS.map((c) => c.header).join(', ')} (Narration, Category and Line Description optional).</p>
                    <ol className="list-decimal space-y-0.5 pl-5">{JOURNAL_IMPORT_RULES.map((r) => <li key={r}>{r}</li>)}</ol>
                  </>
                ) : (
                  <>
                    <p className="mb-1.5">
                      A list of entries (or <code className="font-mono">{'{"entries": [...]}'}</code> - the import API's own body). Each entry has its
                      debit and credit lines; the same checks as Excel apply.
                    </p>
                    <div className="relative">
                      <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[0.7rem] leading-relaxed text-slate-100">
                        {jsonSample || 'Loading example...'}
                      </pre>
                      {jsonSample && (
                        <button
                          type="button"
                          onClick={copySample}
                          className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[0.7rem] font-bold text-slate-100 hover:bg-white/20"
                        >
                          <Copy className="h-3 w-3" /> {copied ? 'Copied' : 'Copy'}
                        </button>
                      )}
                    </div>
                    <table className="mt-2 w-full border-collapse">
                      <tbody className="divide-y divide-border-soft">
                        {JOURNAL_JSON_FIELDS.map((f) => (
                          <tr key={f.field} className="align-top">
                            <td className="py-1 pr-2 font-mono font-bold text-ink">{f.field}</td>
                            <td className="whitespace-nowrap py-1 pr-2 text-slate-500">{f.required}</td>
                            <td className="py-1">{f.notes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            )}
          </Step>
        </div>

        {parsing && (
          <div className="flex items-center gap-2 text-sm text-muted"><Spinner size={16} /> Reading file...</div>
        )}
        {fatalError && <Alert>{fatalError}</Alert>}

        {result && (
          <Alert className="border-success/30 bg-success-soft text-success-text">
            Imported {result.created} journal entr{result.created === 1 ? 'y' : 'ies'} ({result.lines_created} lines){bankAccount ? ` for ${bankAccount.name}` : ''}.
            {result.skipped.length > 0 && ` ${result.skipped.length} already imported entr${result.skipped.length === 1 ? 'y was' : 'ies were'} skipped.`}
            {result.duplicates.length > 0 && ` ${result.duplicates.length} possible duplicate${result.duplicates.length === 1 ? ' was' : 's were'} left out.`}
            {entryCounts.ERROR > 0 && ` ${entryCounts.ERROR} entr${entryCounts.ERROR === 1 ? 'y' : 'ies'} with errors ${entryCounts.ERROR === 1 ? 'was' : 'were'} not imported.`}
          </Alert>
        )}

        {entries.length > 0 && (
          <div className="rounded-xl border border-border p-4 ">
            {/* SUMMARY */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
                <List className="h-4 w-4 text-violet-500" /> Transactions in the file
                {!analysed && <Chip tone="neutral" variant="outline" className="ml-1">Not analysed yet - click Analyse</Chip>}
                {analysed && <Chip tone="success" variant="outline" className="ml-1">Analysed</Chip>}
              </p>
              {issues.length > 0 && (
                <Button
                  variant={showErrors ? 'contained' : 'outlined'}
                  color="error"
                  icon={<AlertTriangle className="h-4 w-4" />}
                  onClick={() => setShowErrors((v) => !v)}
                >
                  {showErrors ? 'Hide Errors' : `View Errors (${errorCount}${issues.length > errorCount ? ` + ${issues.length - errorCount} other` : ''})`}
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Tile label={isJson ? 'Lines in file' : 'Rows in file'} value={rows.length} sub={`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`} />
              <Tile label="Will import" value={analysed ? toImport.length : '—'} sub={analysed ? `${totals.lines} lines` : 'after analysis'} className="text-success-text" />
              <Tile label="Errors" value={entryCounts.ERROR} sub="entries - not imported" className="text-danger-text" />
              <Tile label="Possible duplicates" value={analysed ? entryCounts.DUPLICATE : '—'} sub="same as another entry" className="text-primary" />
              <Tile label="Already imported" value={analysed ? entryCounts.SKIPPED : '—'} sub="skipped" />
              <Tile label="To be posted" value={<span className="text-sm">{analysed ? fmt(totals.debit) : '—'}</span>} sub={analysed ? `Dr = Cr ${fmt(totals.credit)}` : ''} />
            </div>

            {analysed && entryCounts.DUPLICATE > 0 && !result && (
              <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 text-xs text-violet-800 dark:border-violet-400/30 dark:bg-primary-soft dark:text-violet-200">
                <input type="checkbox" className="mt-0.5 accent-primary" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} />
                <span>
                  <b>Import the {entryCounts.DUPLICATE} possible duplicate{entryCounts.DUPLICATE === 1 ? '' : 's'} anyway.</b> They have the same date,
                  accounts and amounts as another entry, only a different Entry No - usually the same transaction exported twice.
                  Tick only if they really are separate transactions.
                </span>
              </label>
            )}

            {/* ALL ERRORS */}
            {showErrors && issues.length > 0 && (
              <div className="mt-3 max-h-64 space-y-3 overflow-y-auto rounded-xl border border-danger-border bg-danger-soft p-3 ">
                {(['error', 'duplicate', 'warning', 'info'] as Severity[]).map((sev) => {
                  const list = issues.filter((i) => i.severity === sev)
                  if (!list.length) return null
                  return (
                    <div key={sev}>
                      <p className={`mb-1 text-xs font-bold ${SEVERITY_META[sev].className}`}>{SEVERITY_META[sev].title} ({list.length})</p>
                      <ul className="space-y-0.5 text-xs text-ink">
                        {list.map((i, idx) => (
                          <li key={idx} className="flex gap-2">
                            <span className="w-24 shrink-0 font-semibold text-slate-500">{i.where}</span>
                            <span className="w-24 shrink-0 font-mono font-bold">{i.entryNumber}</span>
                            <span>{i.message}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}

            {/* SUB CATEGORIES NOT IN THE CHART OF ACCOUNTS */}
            {analysed && !result && (unknownAccounts.length > 0 || overrides.size > 0) && (
              <div className="mt-3 rounded-xl border border-warning/40 bg-warning-soft p-3 ">
                {unknownAccounts.length > 0 && (
                  <>
                    <p className="text-xs font-bold text-warning-text">
                      {unknownAccounts.length} sub categor{unknownAccounts.length === 1 ? 'y is' : 'ies are'} missing or not in the Chart of Accounts -
                      entries using {unknownAccounts.length === 1 ? 'it' : 'them'} will not be imported.
                    </p>
                    <p className="mb-2 text-xs text-warning-text">Optional: choose an existing sub category for each, or add a new one - then the entries can be imported.</p>
                    <ul className="space-y-1.5">
                      {unknownAccounts.map((a) => (
                        <li key={a.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-xs dark:bg-slate-900/40">
                          <span>
                            <b className="text-ink">
                              {a.name ? `"${a.name}"` : a.subCategoryId ? `id ${a.subCategoryId}` : 'Sub category empty'}
                            </b>
                            {a.categoryName && <span className="text-slate-500"> under "{a.categoryName}"</span>}
                            <span className="text-slate-500"> · {a.lines} line{a.lines === 1 ? '' : 's'} · {a.reason}</span>
                            <UsedOnList account={a} />
                          </span>
                          <Button size="sm" variant="outlined" icon={<FolderPlus className="h-3.5 w-3.5" />} onClick={() => setFixing(a)} disabled={analysing}>
                            {a.name || a.subCategoryId ? 'Add / choose' : 'Enter sub category'}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {overrides.size > 0 && (
                  <ul className={`space-y-1 text-xs ${unknownAccounts.length ? 'mt-2 border-t border-warning/40 pt-2 ' : ''}`}>
                    {[...overrides].map(([key, value]) => (
                      <li key={key} className="flex items-center justify-between gap-2 text-success-text">
                        <span>
                          <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                          {key.startsWith('name:') ? `"${key.slice(5).split('|')[0]}"` : key.startsWith('id:') ? `id ${key.slice(3)}` : 'Row without a sub category'} → <b>{value.label}</b>
                        </span>
                        <button type="button" onClick={() => undoOverride(key)} disabled={analysing}
                          className="flex items-center gap-1 text-slate-500 hover:text-danger-text"><Undo2 className="h-3 w-3" /> Undo</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* FILTER */}
            <div className="mt-4 flex flex-wrap gap-1.5">
              {(['ALL', 'PENDING', 'READY', 'WARNING', 'DUPLICATE', 'SKIPPED', 'ERROR'] as StatusFilter[]).map((f) => {
                const n = f === 'ALL' ? rows.length : rowCounts[f]
                if (f !== 'ALL' && n === 0) return null
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                      filter === f ? 'bg-violet-600 text-white dark:bg-violet-500' : 'border border-border text-muted hover:bg-surface-muted '
                    }`}
                  >
                    {f === 'ALL' ? 'All rows' : STATUS_META[f].label} ({n})
                  </button>
                )
              })}
            </div>

            {/* ALL ROWS */}
            <div className="mt-3 max-h-[26rem] overflow-auto rounded-xl border border-border">
              <table className="w-full min-w-[980px] border-collapse text-xs">
                <thead className="sticky top-0 z-[1] bg-surface-muted">
                  <tr className="border-b border-border text-left font-bold text-ink ">
                    <th className="px-2 py-2">{rowWord}</th>
                    <th className="px-2 py-2">Entry No</th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Sub Category</th>
                    <th className="px-2 py-2">Description</th>
                    <th className="px-2 py-2 text-right">Debit</th>
                    <th className="px-2 py-2 text-right">Credit</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Issues</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft">
                  {visible.map(({ line, entry, verdict, messages, account }) => {
                    const meta = STATUS_META[verdict.status]
                    // Entry-level problems are shown once, on the entry's first visible row.
                    const entryMsgs = shownEntryMessages.has(entry.key) ? [] : verdict.entryMessages
                    shownEntryMessages.add(entry.key)
                    const rowBad = messages.length > 0 && verdict.status === 'ERROR'
                    return (
                      <tr key={line.rowNumber} className={`align-top ${rowBad ? 'bg-danger-soft dark:bg-danger-soft' : ''}`}>
                        <td className="px-2 py-1.5 text-muted">{line.rowNumber}</td>
                        <td className="px-2 py-1.5 font-mono font-bold text-ink">{line.entry_number || '—'}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-muted">{line.date || line.rawDate || '—'}</td>
                        <td className="px-2 py-1.5 font-semibold text-ink">
                          {account?.sub_category_id ? (
                            <>
                              <span className="text-success-text"><CheckCircle2 className="mr-1 inline h-3 w-3" />{account.sub_category_name}</span>
                              <span className="block font-normal text-muted">
                                {account.category_name}
                                {overrides.has(accountRefKey(line))
                                  ? ` · chosen here (file: ${line.sub_category_name || line.sub_category_id || 'empty'})`
                                  : account.matched_by === 'bank' ? ' · bank account'
                                    : account.matched_by === 'name' && line.sub_category_id ? ` · by name (id ${line.sub_category_id} not found)` : ''}
                              </span>
                            </>
                          ) : account && verdict.status !== 'SKIPPED' ? (
                            <>
                              <span className="text-danger-text">
                                <XCircle className="mr-1 inline h-3 w-3" />{line.sub_category_name || (line.sub_category_id ? `ID ${line.sub_category_id}` : 'Empty')}
                              </span>
                              <span className="block font-normal text-rose-500">
                                {line.sub_category_name || line.sub_category_id ? 'Not in Chart of Accounts' : 'No sub category'} - not imported
                              </span>
                              {!result && (
                                <button type="button" className="mt-0.5 text-[0.7rem] font-bold text-violet-600 hover:underline dark:text-violet-400"
                                  onClick={() => setFixing(unknownAccounts.find((a) => a.key === accountRefKey(line)) ?? null)}>
                                  {line.sub_category_name || line.sub_category_id ? 'Add / choose sub category' : 'Enter sub category'}
                                </button>
                              )}
                            </>
                          ) : (
                            <>
                              {line.sub_category_name || (line.sub_category_id ? `ID ${line.sub_category_id}` : (
                                <span className="text-warning-text">Empty{analysed ? '' : ' - enter it after Analyse'}</span>
                              ))}
                              {line.category_name && <span className="block font-normal text-muted">{line.category_name}</span>}
                            </>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-muted">{line.description || line.narration || '—'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{line.debit ? fmt(line.debit) : ''}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{line.credit ? fmt(line.credit) : ''}</td>
                        <td className="whitespace-nowrap px-2 py-1.5"><Chip tone={meta.tone} variant="outline">{meta.icon}{meta.label}</Chip></td>
                        <td className="px-2 py-1.5">
                          {messages.map((m) => <div key={m} className="text-danger-text">{m}</div>)}
                          {entryMsgs.map((m) => (
                            <div key={m} className={verdict.status === 'ERROR' ? 'text-danger-text' : 'text-muted'}>
                              <span className="font-semibold">{entry.entry_number || 'Entry'}:</span> {m}
                            </div>
                          ))}
                          {!messages.length && !entryMsgs.length && <span className="text-slate-300 dark:text-slate-600">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">
              {analysed
                ? 'Only entries marked Ready (and possible duplicates, if ticked) are submitted. Fix errors in the file - Download Issues lists every row - and upload it again; entries imported now will then be skipped.'
                : 'File checks are done. Click Analyse to check accounts, balances, entries already imported and duplicates before submitting.'}
            </p>
          </div>
        )}
      </div>
    </Modal>
    <AccountFixDialog account={fixing} onClose={() => setFixing(null)} onResolved={resolveAccount} />
    </>
  )
}
