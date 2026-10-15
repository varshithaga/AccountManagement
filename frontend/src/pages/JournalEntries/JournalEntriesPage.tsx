import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  BookOpenCheck, Search, X, Trash2, RefreshCw, FileSpreadsheet, Download, ChevronRight,
  ChevronDown, History, Undo2, ArrowDownLeft, ArrowUpRight, Layers, FileDown, GitMerge, FileJson, Link2,
} from 'lucide-react'
import { journalEntriesApi, type JournalImportResult, type JournalSummary } from './journalentriesapi'
import { downloadJournalSample, downloadJournalSampleJson } from './journalTemplate'
import JournalImportDialog from './JournalImportDialog'
import MatchDialog from '../BankReconciliation/MatchDialog'
import type { MatchTarget } from '../BankReconciliation/bankreconciliationapi'
import Pagination, { DEFAULT_ROWS_PER_PAGE } from '../../components/Pagination'
import BankAccountSelect from '../../components/BankAccountSelect'
import { Button, Panel, Chip, Modal, Alert, Select, Spinner } from '../../components/tw'
import DatePicker from '../../components/DatePicker'
import { PERIOD_OPTIONS, periodRange, type PeriodPreset } from '../../utils/periods'
import type { JournalEntry, JournalImportBatch, JournalReconcileStatus, JournalSource } from '../../types'
import { exportToExcel } from '../../utils/excelExport'
import { useAuth } from '../../context/AuthContext'
import { apiErrorText, withUnmatchConfirm } from '../../utils/reconcileConfirm'

const SOURCE_LABEL: Record<JournalSource, string> = { EXCEL: 'Excel', JSON: 'JSON file', API: 'External API' }

const RECONCILE_META: Record<JournalReconcileStatus, { label: string; tone: 'success' | 'warning' | 'neutral'; title: string }> = {
  RECONCILED: { label: 'Reconciled', tone: 'success', title: 'Every bank line is matched to a bank statement transaction' },
  PARTIAL: { label: 'Partly reconciled', tone: 'warning', title: 'Some bank lines are matched, some are still open' },
  UNRECONCILED: { label: 'Not reconciled', tone: 'neutral', title: 'Its bank line is not matched to a bank statement transaction yet' },
}

type Period = PeriodPreset

const fmtAmount = (value: string | number) =>
  Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function StatCard({ icon, label, value, caption }: { icon: ReactNode; label: string; value: ReactNode; caption: string }) {
  return (
    <div className="rounded-[18px] border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-muted">{label}</span>
        <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-surface-muted [&_svg]:h-[18px] [&_svg]:w-[18px]">{icon}</span>
      </div>
      <div className="num mt-3 text-[26px] font-semibold leading-tight text-ink">{value}</div>
      <div className="mt-1 text-xs text-muted">{caption}</div>
    </div>
  )
}

const TH = 'px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted'

export default function JournalEntriesPage() {
  const { can } = useAuth()
  const canCreate = can('journal_entries', 'create')
  const canDelete = can('journal_entries', 'delete')
  const canMatch = can('bank_reconciliation', 'edit')
  const [matching, setMatching] = useState<MatchTarget | null>(null)
  const navigate = useNavigate()
  // ?entry=<entry number> (from a reconciled bank transaction) opens on that entry: searched, all dates, expanded.
  const [searchParams] = useSearchParams()
  const linkedEntry = searchParams.get('entry') || ''
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [count, setCount] = useState(0)
  const [summary, setSummary] = useState<JournalSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const [search, setSearch] = useState(linkedEntry)
  const [period, setPeriod] = useState<Period>(linkedEntry ? 'all_time' : 'this_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [dateFrom, dateTo] = periodRange(period, customFrom, customTo)
  const [source, setSource] = useState<JournalSource | ''>('')
  const [bankAccount, setBankAccount] = useState<number | null>(null)
  const [reconciled, setReconciled] = useState<'true' | 'false' | ''>('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE)

  const [importOpen, setImportOpen] = useState(false)
  const [downloadingSample, setDownloadingSample] = useState(false)

  const handleDownloadSample = async (format: 'excel' | 'json' = 'excel') => {
    setDownloadingSample(true)
    try {
      if (format === 'json') await downloadJournalSampleJson()
      else await downloadJournalSample()
    } catch {
      alert('Failed to prepare the sample file.')
    } finally {
      setDownloadingSample(false)
    }
  }
  const [historyOpen, setHistoryOpen] = useState(false)
  const [batches, setBatches] = useState<JournalImportBatch[]>([])
  const [batchesLoading, setBatchesLoading] = useState(false)

  const filters = { search: search.trim() || undefined, date_from: dateFrom, date_to: dateTo, source, bank_account: bankAccount, reconciled }

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [data, totals] = await Promise.all([
        journalEntriesApi.search({ ...filters, page: page + 1, limit: rowsPerPage }),
        journalEntriesApi.summary(filters),
      ])
      setEntries(data.results)
      setCount(data.count)
      setSummary(totals)
      const linked = linkedEntry && data.results.find((e) => e.entry_number === linkedEntry)
      if (linked) setExpanded((prev) => new Set(prev).add(linked.id))
    } catch {
      setError('Failed to load journal entries.')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, dateFrom, dateTo, source, bankAccount, reconciled, page, rowsPerPage])

  useEffect(() => {
    const handle = setTimeout(fetchEntries, 300)
    return () => clearTimeout(handle)
  }, [fetchEntries])

  const setFilter = <V,>(setter: (v: V) => void) => (value: V) => {
    setter(value)
    setPage(0)
  }

  const changePeriod = (value: Period) => {
    // Custom starts from the range currently shown, so the list doesn't jump.
    if (value === 'custom' && period !== 'custom') {
      setCustomFrom(dateFrom)
      setCustomTo(dateTo)
    }
    setFilter(setPeriod)(value)
  }

  const hasFilters = Boolean(search || period !== 'this_month' || source || bankAccount || reconciled)
  // What is shown: the period (always, unless All) plus any other filter.
  const otherFilters = Boolean(search || source || bankAccount || reconciled)
  const periodText = period === 'custom'
    ? `${dateFrom || '…'} → ${dateTo || '…'}`
    : PERIOD_OPTIONS.find((p) => p.value === period)!.label
  const narrowed = otherFilters || period !== 'all_time'
  const clearFilters = () => {
    setSearch('')
    setPeriod('this_month')
    setCustomFrom('')
    setCustomTo('')
    setSource('')
    setBankAccount(null)
    setReconciled('')
    setPage(0)
  }

  const toggleExpanded = (id: number) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const remove = async (entry: JournalEntry) => {
    if (!window.confirm(`Delete journal entry "${entry.entry_number}" and its ${entry.lines.length} lines?`)) return
    try {
      if (!await withUnmatchConfirm((confirm) => journalEntriesApi.remove(entry.id, confirm))) return
      await fetchEntries()
    } catch (err) {
      alert(apiErrorText(err, 'Failed to delete journal entry.'))
    }
  }

  const openHistory = async () => {
    setHistoryOpen(true)
    setBatchesLoading(true)
    try {
      setBatches(await journalEntriesApi.batches())
    } catch {
      setBatches([])
    } finally {
      setBatchesLoading(false)
    }
  }

  const undoBatch = async (batch: JournalImportBatch) => {
    const name = batch.source_name || SOURCE_LABEL[batch.source]
    if (!window.confirm(`Undo import "${name}"? This deletes all ${batch.entry_count} journal entries it brought in.`)) return
    try {
      if (!await withUnmatchConfirm((confirm) => journalEntriesApi.removeBatch(batch.id, confirm))) return
      setBatches((prev) => prev.filter((b) => b.id !== batch.id))
      await fetchEntries()
    } catch (err) {
      alert(apiErrorText(err, 'Failed to undo this import.'))
    }
  }

  const handleImported = useCallback((result: JournalImportResult) => {
    const parts = [`Imported ${result.created} journal entr${result.created === 1 ? 'y' : 'ies'} (${result.lines_created} lines).`]
    if (result.skipped.length) {
      const shown = result.skipped.slice(0, 10).join(', ')
      parts.push(`Skipped ${result.skipped.length} already imported: ${shown}${result.skipped.length > 10 ? ', …' : ''}.`)
    }
    setNotice(parts.join(' '))
    fetchEntries()
  }, [fetchEntries])

  const handleExportExcel = async () => {
    try {
      const all = await journalEntriesApi.listAll(filters)
      const rows = all.flatMap((e) => e.lines.map((l) => ({
        entry_number: e.entry_number,
        date: e.date,
        narration: e.narration,
        category_name: l.category_name,
        sub_category_id: l.sub_category,
        sub_category_name: l.sub_category_name,
        debit: Number(l.debit) || '',
        credit: Number(l.credit) || '',
        description: l.description,
        bank_account: e.bank_account_name || '',
        source: SOURCE_LABEL[e.source],
        reconciled: l.reconciled === null ? ''
          : l.reconciled_as_opening_balance ? 'Opening balance (cleared)'
          : l.reconciled && l.reconciled_transaction
            ? `Reconciled with ${l.reconciled_transaction.bank_account_name} ${l.reconciled_transaction.date} - ${l.reconciled_transaction.description}`
          : l.reconciled ? 'Reconciled'
            : 'Not reconciled',
      })))
      await exportToExcel('Journal_Entries.xlsx', 'Journal Entries', [
        { header: 'Entry No', key: 'entry_number', width: 16 },
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Narration', key: 'narration', width: 32 },
        { header: 'Category', key: 'category_name', width: 24 },
        { header: 'Sub Category ID', key: 'sub_category_id', width: 16 },
        { header: 'Sub Category Name', key: 'sub_category_name', width: 26 },
        { header: 'Debit', key: 'debit', width: 14 },
        { header: 'Credit', key: 'credit', width: 14 },
        { header: 'Line Description', key: 'description', width: 30 },
        { header: 'Bank Account', key: 'bank_account', width: 24 },
        { header: 'Source', key: 'source', width: 14 },
        { header: 'Reconciliation', key: 'reconciled', width: 60 },
      ], rows)
    } catch {
      alert('Failed to export journal entries to Excel.')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* HEADER & ACTIONS */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-ink">Journal Entries</h1>
            <p className="mt-1.5 max-w-3xl text-[15px] text-muted">
              Balanced double-entry vouchers imported from an Excel or JSON file, or pushed by external systems via the import API.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCreate && (
            <Button variant="outlined" icon={<FileDown className="h-4 w-4" />} onClick={() => handleDownloadSample('excel')} disabled={downloadingSample}>
              {downloadingSample ? 'Preparing...' : 'Excel Sample'}
            </Button>
          )}
          {canCreate && (
            <Button variant="outlined" icon={<FileJson className="h-4 w-4" />} onClick={() => handleDownloadSample('json')} disabled={downloadingSample}>
              JSON Sample
            </Button>
          )}
          <Button variant="outlined" icon={<History className="h-4 w-4" />} onClick={openHistory}>Import History</Button>
          <Button variant="outlined" icon={<Download className="h-4 w-4" />} onClick={handleExportExcel}>Export Excel</Button>
          <button
            type="button"
            title="Refresh"
            onClick={() => fetchEntries()}
            disabled={loading}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 "
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canCreate && (
            <Button
              variant="contained"
              icon={<FileSpreadsheet className="h-4 w-4" />}
              onClick={() => setImportOpen(true)}
              className="px-4 py-2.5"
            >
              Import Excel / JSON
            </Button>
          )}
        </div>
      </div>

      {notice && (
        <Alert className="mb-4 border-success/30 bg-success-soft text-success-text">
          <div className="flex items-start justify-between gap-3">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice('')} className="shrink-0 opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
          </div>
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}

      {/* SUMMARY */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={<Layers className="h-5 w-5 text-violet-500" />} label="Entries" value={summary?.entries ?? '—'} caption={`${periodText}${otherFilters ? ' · filtered' : ''}`} />
        <StatCard
          icon={<GitMerge className="h-5 w-5 text-info" />}
          label="Reconciled"
          value={summary ? `${summary.reconciled} / ${summary.reconciled + summary.partial + summary.unreconciled}` : '—'}
          caption={summary
            ? `${summary.partial} partly · ${summary.unreconciled} not reconciled · entries with a bank line`
            : 'Entries with a bank line'}
        />
        <StatCard icon={<ArrowDownLeft className="h-5 w-5 text-emerald-500" />} label="Total Debit" value={summary ? fmtAmount(summary.total_debit) : '—'} caption="Sum of debit lines" />
        <StatCard icon={<ArrowUpRight className="h-5 w-5 text-rose-500" />} label="Total Credit" value={summary ? fmtAmount(summary.total_credit) : '—'} caption="Sum of credit lines" />
        <StatCard icon={<History className="h-5 w-5 text-info" />} label="Imports" value={summary?.batches ?? '—'} caption="Excel uploads & API pushes" />
      </div>

      {/* FILTERS */}
      <Panel className="py-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative flex min-w-[260px] flex-1 items-center">
            <Search className="absolute left-3.5 h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder="Search entry no, narration, account or line description..."
              value={search}
              onChange={(e) => setFilter(setSearch)(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-surface pl-10 pr-3 text-sm font-medium text-ink outline-none transition-colors placeholder:text-muted focus:border-primary focus:ring-[3px] focus:ring-primary-soft "
            />
          </div>
          <div className="w-64"><BankAccountSelect value={bankAccount} onChange={(id) => setFilter(setBankAccount)(id)} placeholder="All bank accounts" /></div>
          <Select id="je-period" label="Period" value={period} onChange={(e) => changePeriod(e.target.value as Period)} className="min-w-[160px]">
            {PERIOD_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
          {period === 'custom' && (
            <>
              <DatePicker id="je-date-from" label="Start date" value={customFrom} maxDate={customTo || undefined}
                onChange={setFilter(setCustomFrom)} fullWidth={false} className="min-w-[150px]" />
              <DatePicker id="je-date-to" label="End date" value={customTo} minDate={customFrom || undefined}
                onChange={setFilter(setCustomTo)} fullWidth={false} className="min-w-[150px]" />
            </>
          )}
          <Select id="je-source" label="Source" value={source} onChange={(e) => setFilter(setSource)(e.target.value as JournalSource | '')}>
            <option value="">All sources</option>
            <option value="EXCEL">Excel</option>
            <option value="JSON">JSON file</option>
            <option value="API">External API</option>
          </Select>
          <Select id="je-reconciled" label="Reconciliation" value={reconciled} onChange={(e) => setFilter(setReconciled)(e.target.value as 'true' | 'false' | '')}>
            <option value="">All</option>
            <option value="true">Reconciled</option>
            <option value="false">Not reconciled</option>
          </Select>
          <Button variant="text" icon={<X className="h-4 w-4" />} onClick={clearFilters} disabled={!hasFilters} className="h-11">Clear</Button>
        </div>
      </Panel>

      {/* TABLE */}
      <Panel className="overflow-hidden p-0">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center p-16"><Spinner size={32} /></div>
        ) : entries.length > 0 ? (
          <div>
            <Pagination
              position="top"
              count={count}
              page={page}
              rowsPerPage={rowsPerPage}
              onPageChange={setPage}
              onRowsPerPageChange={(rpp) => { setRowsPerPage(rpp); setPage(0) }}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-slate-50 dark:bg-slate-900/80">
                    <th className={`${TH} w-10`} />
                    <th className={TH}>Entry No</th>
                    <th className={TH}>Date</th>
                    <th className={TH}>Narration</th>
                    <th className={TH}>Bank Account</th>
                    <th className={TH}>Source</th>
                    <th className={TH}>Reconciled</th>
                    <th className={`${TH} text-right`}>Debit</th>
                    <th className={`${TH} text-right`}>Credit</th>
                    <th className={`${TH} text-right`}>{canDelete && 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft">
                  {entries.map((entry) => {
                    const open = expanded.has(entry.id)
                    return (
                      <Fragment key={entry.id}>
                        <tr
                          onClick={() => toggleExpanded(entry.id)}
                          className="cursor-pointer transition-colors hover:bg-surface-muted"
                        >
                          <td className="px-4 py-3 text-muted">
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </td>
                          <td className="px-4 py-3 font-mono font-bold text-ink">{entry.entry_number}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-muted">{entry.date}</td>
                          <td className="px-4 py-3 text-muted">
                            {entry.narration || '—'}
                            <span className="ml-2 text-xs text-muted">({entry.lines.length} lines)</span>
                          </td>
                          <td className="px-4 py-3 text-muted">{entry.bank_account_name || '—'}</td>
                          <td className="px-4 py-3">
                            <Chip tone={entry.source === 'EXCEL' ? 'success' : entry.source === 'JSON' ? 'primary' : 'info'} variant="outline" title={entry.source_name || undefined}>
                              {SOURCE_LABEL[entry.source]}
                            </Chip>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {entry.reconcile_status ? (
                              <Chip
                                tone={RECONCILE_META[entry.reconcile_status].tone}
                                variant={entry.reconcile_status === 'UNRECONCILED' ? 'outline' : 'solid'}
                                title={RECONCILE_META[entry.reconcile_status].title}
                              >
                                {entry.reconcile_status === 'RECONCILED' && <GitMerge className="mr-1 h-3 w-3" />}
                                {RECONCILE_META[entry.reconcile_status].label}
                              </Chip>
                            ) : (
                              <span className="text-xs text-muted" title="No line on a bank account - nothing to reconcile">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">{fmtAmount(entry.total_debit)}</td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">{fmtAmount(entry.total_credit)}</td>
                          <td className="px-4 py-3 text-right">
                            {canDelete && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); remove(entry) }}
                                title="Delete entry"
                                className="rounded-lg p-2 text-muted transition-colors hover:bg-danger-soft hover:text-danger-text dark:hover:bg-danger-soft "
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-slate-50/60 dark:bg-white/[0.02]">
                            <td />
                            <td colSpan={9} className="px-4 pb-4 pt-1">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-muted">
                                    <th className="py-1.5 text-left font-bold">Sub Category</th>
                                    <th className="py-1.5 text-left font-bold">Category</th>
                                    <th className="py-1.5 text-left font-bold">Description</th>
                                    <th className="py-1.5 text-right font-bold">Debit</th>
                                    <th className="py-1.5 text-right font-bold">Credit</th>
                                    <th className="py-1.5 pl-4 text-left font-bold">Reconciled</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200/70 dark:divide-white/5">
                                  {entry.lines.map((line) => (
                                    <tr key={line.id}>
                                      <td className={`py-1.5 font-semibold text-ink ${Number(line.credit) > 0 ? 'pl-6' : ''}`}>
                                        {line.sub_category_name}
                                      </td>
                                      <td className="py-1.5 text-muted">{line.category_name}</td>
                                      <td className="py-1.5 text-muted">{line.description || '—'}</td>
                                      <td className="py-1.5 text-right tabular-nums text-ink">{Number(line.debit) > 0 ? fmtAmount(line.debit) : ''}</td>
                                      <td className="py-1.5 text-right tabular-nums text-ink">{Number(line.credit) > 0 ? fmtAmount(line.credit) : ''}</td>
                                      <td className="py-1.5 pl-4">
                                        {line.reconciled === true && (line.reconciled_transaction ? (
                                          <button
                                            type="button"
                                            onClick={() => navigate(`/bank-statements/${line.reconciled_transaction!.statement}`)}
                                            title={`${line.reconciled_transaction.method === 'AUTO' ? 'Auto-matched' : 'Matched manually'} to this bank transaction - open its bank statement`}
                                            className="max-w-[300px] text-left"
                                          >
                                            <span className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-success-text">
                                              <GitMerge className="h-3 w-3" />Matched · {line.reconciled_transaction.bank_account_name}
                                            </span>
                                            <span className="block truncate text-[0.7rem] text-slate-500 hover:text-violet-600 hover:underline dark:text-muted">
                                              {line.reconciled_transaction.date} · {line.reconciled_transaction.description} · {fmtAmount(line.reconciled_transaction.amount)}
                                            </span>
                                          </button>
                                        ) : (
                                          <span className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-success-text"
                                            title="Cleared by the bank statement's opening balance - the money already in the bank">
                                            <GitMerge className="h-3 w-3" />Opening balance
                                          </span>
                                        ))}
                                        {line.reconciled === false && (
                                          <span className="inline-flex items-center gap-2 whitespace-nowrap">
                                            <span className="font-semibold text-warning-text">Open</span>
                                            {canMatch && (
                                              <button
                                                type="button"
                                                onClick={() => setMatching({ kind: 'journal_line', id: line.id })}
                                                title="Match this line to a bank statement transaction (amount within the tolerance)"
                                                className="inline-flex items-center gap-1 rounded-md border border-violet-200 px-1.5 py-0.5 font-bold text-violet-600 hover:bg-violet-50 dark:border-violet-400/30 dark:text-violet-400 dark:hover:bg-primary-soft"
                                              >
                                                <Link2 className="h-3 w-3" />Match
                                              </button>
                                            )}
                                          </span>
                                        )}
                                        {line.reconciled === null && <span className="text-muted" title="Not a bank line - nothing to reconcile">—</span>}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              count={count}
              page={page}
              rowsPerPage={rowsPerPage}
              onPageChange={setPage}
              onRowsPerPageChange={(rpp) => { setRowsPerPage(rpp); setPage(0) }}
            />
          </div>
        ) : (
          <div className="py-14 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-muted text-muted dark:text-slate-500">
              <BookOpenCheck className="h-7 w-7" />
            </div>
            <h3 className="text-base font-bold text-ink">
              {narrowed
                ? `No journal entries in ${period === 'custom' ? periodText : periodText.toLowerCase()}${otherFilters ? ' that match your filters' : ''}.`
                : 'No journal entries imported yet.'}
            </h3>
            <p className="mt-1 text-xs text-muted">
              {narrowed
                ? 'Choose another period (or All) in the Period filter.'
                : canCreate
                  ? 'Import them from an Excel or JSON file, or push them from another system via POST /api/journal-entries/import/.'
                  : 'Nothing to show yet.'}
            </p>
            {!narrowed && canCreate && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button variant="outlined" icon={<FileDown className="h-4 w-4" />} onClick={() => handleDownloadSample('excel')} disabled={downloadingSample} className="px-4 py-2">
                  Excel Sample
                </Button>
                <Button variant="outlined" icon={<FileJson className="h-4 w-4" />} onClick={() => handleDownloadSample('json')} disabled={downloadingSample} className="px-4 py-2">
                  JSON Sample
                </Button>
                <Button variant="contained" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => setImportOpen(true)} className="px-4 py-2">
                  Import Excel / JSON
                </Button>
              </div>
            )}
          </div>
        )}
      </Panel>

      <MatchDialog
        target={matching}
        onClose={() => setMatching(null)}
        onMatched={(message) => { setMatching(null); setNotice(message); fetchEntries() }}
      />

      {/* IMPORT HISTORY */}
      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        icon={<History className="h-4 w-4 text-primary" />}
        title="Import History"
        widthClassName="max-w-2xl"
        footer={<Button variant="contained" onClick={() => setHistoryOpen(false)}>Close</Button>}
      >
        {batchesLoading ? (
          <div className="flex justify-center p-8"><Spinner size={24} /></div>
        ) : batches.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No imports yet.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left text-xs font-bold text-ink">Imported</th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-ink">Source</th>
                  <th className="px-3 py-2 text-right text-xs font-bold text-ink">Entries</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">{new Date(b.imported_at).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-ink">{b.source_name || '—'}</div>
                      <div className="text-xs text-muted">
                        {SOURCE_LABEL[b.source]}{b.bank_account_name ? ` · ${b.bank_account_name}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{b.entry_count}</td>
                    <td className="px-3 py-2 text-right">
                      {canDelete && (
                        <Button size="sm" variant="outlined" color="error" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => undoBatch(b)}>
                          Undo
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* EXCEL IMPORT */}
      <JournalImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={handleImported}
        defaultBankAccount={bankAccount}
      />
    </div>
  )
}
