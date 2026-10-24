import { useCallback, useEffect, useState, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import dayjs from 'dayjs'
import {
  Plus, Trash2, Download, Eye, Sparkles, Copy, AlertTriangle, X,
  MoreVertical, Receipt, UploadCloud, Landmark, Link2, PieChart,
} from 'lucide-react'
import { bankStatementsApi } from './bankstatementsapi'
import ContinuityBadge, { ISSUE_LABEL } from './ContinuityBadge'
import BankAccountSelect, { hasAnyBankAccount } from '../../components/BankAccountSelect'
import Pagination, { DEFAULT_ROWS_PER_PAGE } from '../../components/Pagination'
import Badge from '../../components/Badge'
import type { BadgeColor } from '../../components/Badge'
import type { BankStatement, ContinuityProblem, StatementProgress, Transaction } from '../../types'
import { exportToExcel } from '../../utils/excelExport'
import { useAuth } from '../../context/AuthContext'
import { apiErrorText, withUnmatchConfirm } from '../../utils/reconcileConfirm'
import {
  Button, Panel, Select, Modal, Alert, Spinner, IconButton,
} from '../../components/tw'
import { EmptyState, KpiTile, PageHeader, SearchBox } from '../../components/PageParts'

const SOURCE_TYPE_COLOR: Record<string, BadgeColor> = { PDF: 'error', EXCEL: 'success', CSV: 'info' }

function detectSourceType(filename: string): string | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.csv')) return 'CSV'
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'EXCEL'
  if (lower.endsWith('.pdf')) return 'PDF'
  return null
}

function formatBalance(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '') return '—'
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.-]+/g, ''))
  if (isNaN(num)) return String(val)
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(num)
}

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0)

function ProgressRow({ label, value, total, barColor }: {
  label: string; value: number; total: number; barColor: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-muted">{label}</span>
        <span className="font-bold text-ink">
          {value} <span className="font-medium text-muted">/ {total} · {pct(value, total)}%</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct(value, total)}%` }} />
      </div>
    </div>
  )
}

/** Card shown from the per-row progress icon: categorization, confirmation and lock counts. */
function StatementProgressCard({ progress }: { progress: StatementProgress }) {
  const { total } = progress
  return (
    <div className="flex flex-col gap-3">
      <ProgressRow label="Categorized" value={progress.categorized} total={total} barColor="bg-success" />
      <ProgressRow label="Uncategorized" value={progress.uncategorized} total={total} barColor="bg-warning" />      <hr className="border-border-soft" />
      <ProgressRow label="Confirmed" value={progress.confirmed} total={total} barColor="bg-primary" />
      <ProgressRow label="Final (Locked)" value={progress.final} total={total} barColor="bg-sidebar" />
      <hr className="border-border-soft" />
      <ProgressRow label="Reconciled" value={progress.reconciled} total={total} barColor="bg-success" />
      <ProgressRow label="Not reconciled" value={progress.unreconciled} total={total} barColor="bg-warning" />
    </div>
  )
}

export default function BankStatementsPage() {
  const { can } = useAuth()
  const canCreate = can('bank_statements', 'create')
  const canEdit = can('bank_statements', 'edit')
  const canDelete = can('bank_statements', 'delete')
  const navigate = useNavigate()
  const [statements, setStatements] = useState<BankStatement[]>([])
  // Whether any bank account exists (null = still checking) - a 1-row lookup, not the full list.
  const [hasAccounts, setHasAccounts] = useState<boolean | null>(null)
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [checkingDuplicates, setCheckingDuplicates] = useState(false)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE)

  // KPI Summary State
  const [summaryKpis, setSummaryKpis] = useState({
    totalImports: 0,
    totalTransactions: 0,
    totalDuplicates: 0,
    uniqueAccounts: 0,
    gapCount: 0,
  })

  // Filters state
  const [searchAccount, setSearchAccount] = useState('')
  const [selectedAccount, setSelectedAccount] = useState<string | number>('ALL')
  const [selectedSource, setSelectedSource] = useState<string>('ALL')
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL')
  const [dateSort, setDateSort] = useState<'desc' | 'asc'>('desc')

  // Row menu state [⋮]
  const [menuStmtId, setMenuStmtId] = useState<number | null>(null)
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)

  // Opens above the anchor when there isn't `height` px of room below it.
  const popoverPos = (anchor: HTMLElement, height: number) => {
    const rect = anchor.getBoundingClientRect()
    const right = window.innerWidth - rect.right
    return window.innerHeight - rect.bottom < height
      ? { bottom: window.innerHeight - rect.top + 6, right }
      : { top: rect.bottom + 6, right }
  }

  const handleOpenMenu = (e: React.MouseEvent<HTMLButtonElement>, stmtId: number) => {
    if (menuStmtId === stmtId) {
      setMenuStmtId(null)
      setMenuPos(null)
    } else {
      setMenuPos(popoverPos(e.currentTarget, 220))
      setMenuStmtId(stmtId)
    }
  }

  // Progress card popover (categorized / confirmed / final counts)
  const [progressStmt, setProgressStmt] = useState<BankStatement | null>(null)
  const [progressPos, setProgressPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)

  const handleOpenProgress = (e: React.MouseEvent<HTMLButtonElement>, stmt: BankStatement) => {
    if (progressStmt?.id === stmt.id) {
      setProgressStmt(null)
    } else {
      setProgressPos(popoverPos(e.currentTarget, 300))
      setProgressStmt(stmt)
    }
  }

  // Duplicate transactions modal state
  const [dupDialogStmt, setDupDialogStmt] = useState<BankStatement | null>(null)
  const [dupTransactions, setDupTransactions] = useState<Transaction[]>([])
  const [loadingDupTx, setLoadingDupTx] = useState(false)

  // Upload modal state
  const [dialog, setDialog] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [form, setForm] = useState<{ account: number | ''; source_type: string | null }>({
    account: '', source_type: null,
  })
  const [file, setFile] = useState<File | null>(null)
  // Set when the server says this statement doesn't follow on from its neighbours - the user
  // must confirm before it is imported.
  const [continuityIssues, setContinuityIssues] = useState<ContinuityProblem[] | null>(null)

  const handleFileSelect = (selected: File | null) => {
    setFile(selected)
    setContinuityIssues(null)
    if (!selected) {
      setForm((f) => ({ ...f, source_type: null }))
      return
    }
    const detected = detectSourceType(selected.name)
    setForm((f) => ({ ...f, source_type: detected }))
    setError(detected ? '' : 'Unsupported file type. Please choose a .csv, .xlsx or .pdf bank statement.')
  }

  const filterParams = useMemo(() => {
    return {
      search: searchAccount.trim() || undefined,
      account: selectedAccount !== 'ALL' ? selectedAccount : undefined,
      source_type: selectedSource !== 'ALL' ? selectedSource : undefined,
      status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
    }
  }, [searchAccount, selectedAccount, selectedSource, selectedStatus])

  const fetchSummary = useCallback(async () => {
    try {
      const data = await bankStatementsApi.summary(filterParams)
      setSummaryKpis({
        totalImports: data.total_imports,
        totalTransactions: data.total_transactions,
        totalDuplicates: data.total_duplicates,
        uniqueAccounts: data.unique_accounts,
        gapCount: data.gap_count || 0,
      })
    } catch (e) {
      console.error('Failed to fetch statement summary KPIs', e)
    }
  }, [filterParams])

  const fetchStatements = useCallback(async () => {
    const ordering = dateSort === 'desc' ? '-uploaded_at' : 'uploaded_at'
    const data = await bankStatementsApi.search({
      ...filterParams,
      ordering,
      page: page + 1,
      limit: rowsPerPage,
    })
    setStatements(data.results)
    setCount(data.count)
  }, [filterParams, dateSort, page, rowsPerPage])

  useEffect(() => {
    const handle = setTimeout(fetchStatements, 300)
    return () => clearTimeout(handle)
  }, [fetchStatements])

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  useEffect(() => {
    hasAnyBankAccount().then(setHasAccounts).catch(() => setHasAccounts(null))
  }, [])

  const openCreate = useCallback((accountId?: number) => {
    setForm({ account: accountId ?? '', source_type: null })
    setFile(null)
    setError('')
    setContinuityIssues(null)
    setDialog(true)
  }, [])

  // ?upload=<accountId> (from the Statement Continuity page) opens the import dialog
  // preselected to that account.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const uploadFor = Number(searchParams.get('upload'))
    if (!uploadFor) return
    if (canCreate) openCreate(uploadFor)
    setSearchParams((p) => { p.delete('upload'); return p }, { replace: true })
  }, [searchParams, openCreate, setSearchParams, canCreate])

  const upload = async (confirmContinuity = false) => {
    if (!form.account || !file || !form.source_type) {
      setError('Please select a bank account and a valid statement file.')
      return
    }
    setError('')
    setUploading(true)
    try {
      const created = await bankStatementsApi.upload({
        account: Number(form.account), file, source_type: form.source_type, confirmContinuity,
      })
      setContinuityIssues(null)
      setDialog(false)
      try {
        await bankStatementsApi.categorize(created.id)
      } catch {
        // ignore - user can re-run auto-categorization
      }
      const warnings: string[] = []
      if (created.duplicate_count) {
        warnings.push(
          `${created.duplicate_count} transaction(s) in this statement look like duplicates of `
          + 'existing transactions on this account. They are flagged in the list.'
        )
      }
      if (warnings.length) window.alert(`Heads up:\n\n${warnings.join('\n\n')}`)
      navigate(`/bank-statements/${created.id}`)
    } catch (err: any) {
      const data = err.response?.data
      if (err.response?.status === 409 && data?.requires_continuity_confirmation) {
        setContinuityIssues(data.continuity || [])
        return
      }
      setError(data?.file?.[0] || data?.account?.[0] || 'Failed to upload statement.')
    } finally {
      setUploading(false)
    }
  }

  const handleSearchChange = (val: string) => {
    setSearchAccount(val)
    setPage(0)
  }

  const handleAccountChange = (val: string) => {
    setSelectedAccount(val)
    setPage(0)
  }

  const handleSourceChange = (val: string) => {
    setSelectedSource(val)
    setPage(0)
  }

  const handleStatusChange = (val: string) => {
    setSelectedStatus(val)
    setPage(0)
  }

  const handleDateSortChange = (val: 'asc' | 'desc') => {
    setDateSort(val)
    setPage(0)
  }

  const categorize = async (stmt: BankStatement) => {
    setBusyId(stmt.id)
    try {
      const result = await bankStatementsApi.categorize(stmt.id)
      window.alert(`Categorized: ${result.matched} matched, ${result.unmatched} unmatched.`)
      await fetchStatements()
      await fetchSummary()
    } catch {
      window.alert('Failed to categorize this statement.')
    } finally {
      setBusyId(null)
    }
  }

  const checkDuplicates = async () => {
    setCheckingDuplicates(true)
    try {
      const result = await bankStatementsApi.checkDuplicates()
      if (result.flagged > 0) {
        window.alert(`Found ${result.flagged} potential duplicate transaction(s) - opening the Transactions page filtered to show them.`)
        navigate('/transactions?duplicate=true')
      } else {
        window.alert('No potential duplicate transactions found.')
      }
    } catch {
      window.alert('Failed to check for duplicate transactions.')
    } finally {
      setCheckingDuplicates(false)
    }
  }

  const remove = async (stmt: BankStatement) => {
    if (!window.confirm('Delete this bank statement and all its transactions?')) return
    try {
      if (!await withUnmatchConfirm((confirm) => bankStatementsApi.remove(stmt.id, confirm))) return
    } catch (err) {
      window.alert(apiErrorText(err, 'Failed to delete the bank statement.'))
      return
    }
    await fetchStatements()
    await fetchSummary()
  }

  const openDuplicateModal = async (stmt: BankStatement) => {
    setDupDialogStmt(stmt)
    setLoadingDupTx(true)
    try {
      const res = await bankStatementsApi.searchTransactions({ statement: stmt.id, is_potential_duplicate: true })
      setDupTransactions(res.results)
    } catch {
      setDupTransactions([])
    } finally {
      setLoadingDupTx(false)
    }
  }

  const handleExportExcel = async () => {
    try {
      const all = await bankStatementsApi.listAll(filterParams)
      const rows = all.map((stmt) => ({
        account_name: stmt.account_name || '',
        source_type: stmt.source_type,
        opening_balance: stmt.opening_balance ?? '',
        closing_balance: stmt.closing_balance ?? '',
        transaction_count: stmt.transaction_count ?? 0,
        duplicate_count: stmt.duplicate_count ?? 0,
        continuity: !stmt.continuity_status ? ''
          : stmt.continuity_status.is_continuous ? 'Continuous'
            : stmt.continuity_status.issues.map((i) => ISSUE_LABEL[i]).join(', '),
        continuity_detail: stmt.continuity_status?.gap_message ?? '',
        reconciled: stmt.progress?.reconciled ?? 0,
        not_reconciled: stmt.progress?.unreconciled ?? 0,
        uploaded_at: dayjs(stmt.uploaded_at).format('YYYY-MM-DD HH:mm'),
      }))

      const columns = [
        { header: 'Account Name', key: 'account_name', width: 25 },
        { header: 'Source Type', key: 'source_type', width: 15 },
        { header: 'Opening Balance', key: 'opening_balance', width: 18 },
        { header: 'Closing Balance', key: 'closing_balance', width: 18 },
        { header: 'Transaction Count', key: 'transaction_count', width: 18 },
        { header: 'Duplicates', key: 'duplicate_count', width: 15 },
        { header: 'Continuity', key: 'continuity', width: 22 },
        { header: 'Continuity Detail', key: 'continuity_detail', width: 60 },
        { header: 'Reconciled', key: 'reconciled', width: 12 },
        { header: 'Not Reconciled', key: 'not_reconciled', width: 15 },
        { header: 'Uploaded At', key: 'uploaded_at', width: 20 },
      ]

      await exportToExcel('Bank_Statements_List.xlsx', 'Bank Statements', columns, rows)
    } catch {
      window.alert('Failed to export bank statements list to Excel.')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bank statements"
        description="Imported bank statements with their balances, transactions, gaps and duplicates."
        actions={
          <>
            <Button variant="outlined" onClick={handleExportExcel} icon={<Download className="h-4 w-4" />}>
              Export
            </Button>
            <Button variant="outlined" onClick={() => navigate('/bank-statements/continuity')} icon={<Link2 className="h-4 w-4" />}>
              Continuity Check
            </Button>
            {canEdit && (
              <Button
                variant="outlined"
                onClick={checkDuplicates}
                disabled={checkingDuplicates}
                icon={checkingDuplicates ? <Spinner size={16} /> : <Copy className="h-4 w-4" />}
              >
                Check Duplicates
              </Button>
            )}
            {canCreate && (
              <Button variant="contained" onClick={() => openCreate()} disabled={hasAccounts === false} icon={<Plus className="h-4 w-4" />}>
                Import Statement
              </Button>
            )}
          </>
        }
      />

      {error && !dialog && <Alert>{error}</Alert>}
      {hasAccounts === false && (
        <Alert className="border-primary-border bg-primary-soft text-primary-hover dark:text-primary">
          Create a bank account first before uploading a statement.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiTile dark label="Total imports" value={summaryKpis.totalImports} icon={<UploadCloud />} caption="Statement files" />
        <KpiTile label="Transactions" value={summaryKpis.totalTransactions} icon={<Receipt />} tone="primary" caption="Parsed from statements" />
        <KpiTile
          label="Statement gaps"
          value={summaryKpis.gapCount}
          icon={<AlertTriangle />}
          tone={summaryKpis.gapCount > 0 ? 'caution' : 'success'}
          valueClassName={summaryKpis.gapCount > 0 ? '!text-caution-text' : ''}
          caption={summaryKpis.gapCount > 0 ? 'Check continuity' : 'No gaps'}
        />
        <KpiTile
          label="Duplicates"
          value={summaryKpis.totalDuplicates}
          icon={<Copy />}
          tone={summaryKpis.totalDuplicates > 0 ? 'danger' : 'neutral'}
          valueClassName={summaryKpis.totalDuplicates > 0 ? '!text-danger-text' : ''}
          caption="Flagged across uploads"
        />
        <KpiTile label="Bank accounts" value={summaryKpis.uniqueAccounts} icon={<Landmark />} tone="info" caption="With statements" />
      </div>

      {/* Filter Bar Toolbar */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox className="min-w-[220px] flex-1" placeholder="Search account..." value={searchAccount} onChange={handleSearchChange} />

          <div className="min-w-[210px]">
            <BankAccountSelect
              label=""
              placeholder="Account: All"
              value={selectedAccount === 'ALL' ? null : Number(selectedAccount)}
              onChange={(id) => handleAccountChange(id ? String(id) : 'ALL')}
            />
          </div>

          <Select
            id="filter-source"
            value={selectedSource}
            onChange={(e) => handleSourceChange(e.target.value)}
            className="min-w-[150px]"
          >
            <option value="ALL">Source: All</option>
            <option value="EXCEL">EXCEL</option>
            <option value="PDF">PDF</option>
            <option value="CSV">CSV</option>
          </Select>

          <Select
            id="filter-status"
            value={selectedStatus}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="min-w-[170px]"
          >
            <option value="ALL">Status: All</option>
            <option value="DUPLICATES">Has Duplicates</option>
            <option value="CLEAN">Clean (No Dups)</option>
          </Select>

          <Select
            id="filter-date-sort"
            value={dateSort}
            onChange={(e) => handleDateSortChange(e.target.value as 'asc' | 'desc')}
            className="min-w-[180px]"
          >
            <option value="desc">Date: Newest First</option>
            <option value="asc">Date: Oldest First</option>
          </Select>
        </div>
      </div>

      {/* Main Statement Imports Data Table */}
      {statements.length > 0 ? (
        <Panel className="overflow-hidden p-0">
          <Pagination
            position="top"
            count={count} page={page} rowsPerPage={rowsPerPage}
            onPageChange={setPage} onRowsPerPageChange={(rpp) => { setRowsPerPage(rpp); setPage(0) }}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[950px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-xs font-bold text-ink">Account</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Source</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Opening</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Closing</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Continuity & Gaps</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Transactions</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Progress</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Reconciled</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Duplicates</th>
                  <th className="px-4 py-3 pr-6 text-right text-xs font-bold text-ink">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {statements.map((stmt) => {
                  return (
                    <tr key={stmt.id} className="hover:bg-surface-muted">
                      <td className="px-4 py-3">
                        <div className="whitespace-nowrap font-semibold text-ink">{stmt.account_name}</div>
                        <div className="mt-0.5 text-xs text-muted">
                          {dayjs(stmt.uploaded_at).format('DD MMM YYYY, HH:mm')}
                        </div>
                      </td>

                      <td className="px-3 py-3">
                        <Badge size="sm" color={SOURCE_TYPE_COLOR[stmt.source_type] || 'default'}>
                          {stmt.source_type}
                        </Badge>
                      </td>

                      <td className="num px-3 py-3 text-ink">
                        {formatBalance(stmt.opening_balance)}
                      </td>

                      <td className="num px-3 py-3 font-semibold text-ink">
                        {formatBalance(stmt.closing_balance)}
                      </td>

                      <td className="px-3 py-3">
                        <ContinuityBadge status={stmt.continuity_status} />
                      </td>

                      <td className="num px-3 py-3 font-semibold text-ink">
                        {stmt.transaction_count ?? 0}
                      </td>

                      <td className="px-3 py-3">
                        {stmt.progress && stmt.progress.total > 0 ? (
                          <button
                            type="button"
                            title="Show categorization progress"
                            onClick={(e) => handleOpenProgress(e, stmt)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-surface-muted px-2 py-1 text-xs font-bold text-ink hover:bg-slate-200 dark:hover:bg-white/10"
                          >
                            <PieChart className={`h-3.5 w-3.5 ${
                              stmt.progress.final === stmt.progress.total ? 'text-primary'
                                : stmt.progress.categorized === stmt.progress.total ? 'text-success-text'
                                  : 'text-warning-text'
                            }`} />
                            {pct(stmt.progress.categorized, stmt.progress.total)}%
                          </button>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>

                      <td className="px-3 py-3">
                        {stmt.progress && stmt.progress.total > 0 && stmt.gl_linked === false ? (
                          <button
                            type="button"
                            title="This bank account has no GL account yet, so nothing can be reconciled - link it on Bank Reconciliation"
                            onClick={() => navigate(`/bank-reconciliation?account=${stmt.account}`)}
                            className="inline-flex items-center gap-1 rounded-lg bg-surface-muted px-2 py-1 text-xs font-bold text-muted hover:bg-slate-200 dark:hover:bg-white/10"
                          >
                            <Link2 className="h-3.5 w-3.5" />Link GL account
                          </button>
                        ) : stmt.progress && stmt.progress.total > 0 ? (
                          <button
                            type="button"
                            title={`${stmt.progress.reconciled} reconciled, ${stmt.progress.unreconciled} not reconciled - reconcile this statement`}
                            onClick={() => navigate(`/bank-reconciliation?account=${stmt.account}&statement=${stmt.id}`)}
                            className="group w-28 text-left"
                          >
                            <div className="flex items-baseline justify-between text-xs">
                              <span className={`font-bold ${stmt.progress.unreconciled === 0 ? 'text-success-text' : 'text-ink'}`}>
                                {stmt.progress.reconciled}/{stmt.progress.total}
                              </span>
                              <span className="num text-muted group-hover:text-primary">
                                {pct(stmt.progress.reconciled, stmt.progress.total)}%
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded bg-warning-soft">
                              <div className="h-full rounded bg-success" style={{ width: `${pct(stmt.progress.reconciled, stmt.progress.total)}%` }} />
                            </div>
                            {stmt.progress.unreconciled > 0 && (
                              <div className="mt-0.5 text-[0.65rem] font-semibold text-warning-text">{stmt.progress.unreconciled} not reconciled</div>
                            )}
                          </button>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>

                      <td className="px-3 py-3">
                        {stmt.duplicate_count ? (
                          <button
                            type="button"
                            onClick={() => openDuplicateModal(stmt)}
                            className="inline-flex items-center gap-1 rounded-[20px] bg-danger-soft px-2.5 py-0.5 text-xs font-bold text-danger-text hover:brightness-95"
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                            <span className="num">{stmt.duplicate_count}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>

                      <td className="relative px-4 py-3 pr-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outlined"
                            size="sm"
                            icon={<Eye className="h-3.5 w-3.5" />}
                            onClick={() => navigate(`/bank-statements/${stmt.id}`)}
                          >
                            View
                          </Button>
                          <IconButton
                            className="h-8 w-8"
                            onClick={(e) => handleOpenMenu(e, stmt.id)}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </IconButton>
                        </div>

                        {menuStmtId === stmt.id && menuPos && (
                          <>
                            <div className="fixed inset-0 z-[60]" onClick={() => { setMenuStmtId(null); setMenuPos(null) }} />
                            <div
                              style={{
                                position: 'fixed',
                                right: `${menuPos.right}px`,
                                ...(menuPos.top !== undefined ? { top: `${menuPos.top}px` } : { bottom: `${menuPos.bottom}px` }),
                              }}
                              className="z-[70] w-52 rounded-xl border border-border bg-surface py-1.5 text-left shadow-xl "
                            >
                              <button
                                type="button"
                                onClick={() => { setMenuStmtId(null); setMenuPos(null); navigate(`/bank-statements/${stmt.id}`) }}
                                className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold text-ink hover:bg-surface-muted "
                              >
                                <Eye className="h-4 w-4 text-muted" />
                                View Details
                              </button>
                              {canEdit && (
                                <button
                                  type="button"
                                  disabled={busyId === stmt.id}
                                  onClick={() => { setMenuStmtId(null); setMenuPos(null); categorize(stmt) }}
                                  className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold text-ink hover:bg-surface-muted disabled:opacity-50 "
                                >
                                  <Sparkles className="h-4 w-4 text-primary" />
                                  Auto-Categorize
                                </button>
                              )}
                              {stmt.file && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuStmtId(null)
                                    setMenuPos(null)
                                    bankStatementsApi.downloadFile(stmt.id, stmt.file ?? 'statement')
                                      .catch(() => alert('The file could not be downloaded - it may no longer be on the server.'))
                                  }}
                                  className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold text-ink hover:bg-surface-muted "
                                >
                                  <Download className="h-4 w-4 text-muted" />
                                  Download File
                                </button>
                              )}
                              {canDelete && (
                                <>
                                  <hr className="my-1 border-border-soft" />
                                  <button
                                    type="button"
                                    onClick={() => { setMenuStmtId(null); setMenuPos(null); remove(stmt) }}
                                    className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold text-danger-text hover:bg-danger-soft dark:hover:bg-danger-soft"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    Delete Import
                                  </button>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            count={count} page={page} rowsPerPage={rowsPerPage}
            onPageChange={setPage} onRowsPerPageChange={(rpp) => { setRowsPerPage(rpp); setPage(0) }}
          />
        </Panel>
      ) : (
        <Panel className="p-0">
          <EmptyState
            icon={<Receipt />}
            title="No bank statement imports found."
            action={hasAccounts && canCreate && (
              <Button variant="contained" icon={<Plus className="h-4 w-4" />} onClick={() => openCreate()}>
                Import your first statement
              </Button>
            )}
          />
        </Panel>
      )}

      {/* Categorization progress card (opened from a row's Progress icon) */}
      {progressStmt?.progress && progressPos && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setProgressStmt(null)} />
          <div
            style={{
              position: 'fixed',
              right: `${progressPos.right}px`,
              ...(progressPos.top !== undefined ? { top: `${progressPos.top}px` } : { bottom: `${progressPos.bottom}px` }),
            }}
            className="z-[70] w-72 rounded-xl border border-border bg-surface p-4 shadow-xl "
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-ink">{progressStmt.account_name}</p>
                <p className="text-xs text-muted">
                  {progressStmt.progress.total} transactions · {dayjs(progressStmt.uploaded_at).format('DD MMM YYYY')}
                </p>
              </div>
              <button type="button" onClick={() => setProgressStmt(null)} className="text-muted hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <StatementProgressCard progress={progressStmt.progress} />
            <Button
              variant="outlined"
              size="sm"
              className="mt-4 w-full"
              icon={<Eye className="h-3.5 w-3.5" />}
              onClick={() => { setProgressStmt(null); navigate(`/bank-statements/${progressStmt.id}`) }}
            >
              Open Statement
            </Button>
          </div>
        </>
      )}

      {/* Duplicate Transactions Modal Dialog */}
      <Modal
        open={Boolean(dupDialogStmt)}
        onClose={() => setDupDialogStmt(null)}
        icon={<Copy />}
        title="Duplicate transactions"
        widthClassName="max-w-lg"
        footer={
          <>
            <Button variant="outlined" onClick={() => setDupDialogStmt(null)}>Keep Original</Button>
            <Button
              variant="contained"
              onClick={() => {
                if (dupDialogStmt) navigate(`/bank-statements/${dupDialogStmt.id}`)
                setDupDialogStmt(null)
              }}
            >
              Review Transactions
            </Button>
          </>
        }
      >
        <Alert className="border-warning/30 bg-warning-soft text-warning-text">
          <strong>{dupDialogStmt?.duplicate_count || dupTransactions.length || 0} duplicate transactions detected</strong> in {dupDialogStmt?.account_name}
        </Alert>

        {loadingDupTx ? (
          <div className="flex justify-center p-6"><Spinner size={24} /></div>
        ) : dupTransactions.length > 0 ? (
          <div className="max-h-64 overflow-auto rounded-xl border border-border">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-surface-muted font-bold text-ink ">
                <tr>
                  <th className="px-3 py-2">Transaction</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {dupTransactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="px-3 py-2 font-semibold text-ink">{tx.description}</td>
                    <td className="px-3 py-2 text-slate-500">{dayjs(tx.date).format('DD MMM')}</td>
                    <td className="px-3 py-2 text-right font-bold text-ink">
                      {formatBalance(Number(tx.debit) || Number(tx.credit))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-2 text-center text-xs text-slate-500">
            Potential duplicate transactions are flagged for review in the statement details.
          </p>
        )}
      </Modal>

      {/* Upload Statement Modal */}
      <Modal
        open={dialog}
        onClose={() => !uploading && setDialog(false)}
        icon={<UploadCloud />}
        title="Import bank statement"
        subtitle="Excel, CSV or PDF - one statement per file."
        widthClassName="max-w-xl"
        footer={
          <>
            <Button variant="outlined" onClick={() => setDialog(false)} disabled={uploading}>
              Cancel
            </Button>
            {continuityIssues ? (
              <Button variant="contained" color="error" onClick={() => upload(true)} disabled={uploading}>
                {uploading ? <Spinner size={18} className="mr-2" /> : null}
                {uploading ? 'Importing...' : 'Yes, import anyway'}
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={() => upload()}
                disabled={uploading || !file || !form.account || !form.source_type}
              >
                {uploading ? <Spinner size={18} className="mr-2" /> : null}
                {uploading ? 'Parsing...' : 'Upload & Parse Statement'}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {error && <Alert>{error}</Alert>}

          {continuityIssues && (
            <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning-text">
              <p className="mb-2 flex items-center gap-2 font-bold">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                This statement does not follow on from the account's other statements
              </p>
              <ul className="mb-2 space-y-1.5">
                {continuityIssues.map((p, i) => (
                  <li key={i}>
                    <span className="font-bold">{ISSUE_LABEL[p.issue] || p.issue}:</span> {p.message}
                  </li>
                ))}
              </ul>
              <p className="font-bold">Do you want to import it anyway? Nothing has been imported yet.</p>
            </div>
          )}

          <BankAccountSelect
            label="Bank Account"
            placeholder="Search bank account..."
            required
            value={form.account || null}
            onChange={(id) => { setForm((f) => ({ ...f, account: id ?? '' })); setContinuityIssues(null) }}
          />

          {/* Interactive Drag & Drop Box */}
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[18px] border-2 border-dashed border-primary-border bg-primary-soft/40 px-6 py-8 text-center transition-colors hover:bg-primary-soft">
            <input
              type="file"
              className="hidden"
              accept=".csv,.xlsx,.xls,.pdf"
              onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
            />
            <span className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-surface text-primary shadow-[0_1px_2px_rgb(11_46_43/0.08)]"><UploadCloud className="h-6 w-6 stroke-[1.8]" /></span>
            <p className="text-sm font-bold text-ink">
              {file ? file.name : 'Click or Drag & Drop Statement File'}
            </p>
            <p className="mt-1 text-xs text-muted">
              Supports Excel (.xlsx, .xls), CSV (.csv) and PDF (.pdf) statements
            </p>
            {file && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="font-bold text-slate-500">{(file.size / 1024).toFixed(1)} KB</span>
                {form.source_type && (
                  <Badge size="sm" color={SOURCE_TYPE_COLOR[form.source_type] || 'default'}>
                    {form.source_type} Format
                  </Badge>
                )}
              </div>
            )}
          </label>

          <div className="rounded-xl border border-border p-3 text-xs text-muted ">
            <p className="mb-1 font-bold text-ink">Expected columns (Excel / CSV / PDF table)</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li><strong>Date</strong> - also read as Txn Date, Value Date, Posting Date</li>
              <li><strong>Description</strong> - or Narration, Particulars, Transaction Details, Remarks</li>
              <li><strong>Debit</strong> and/or <strong>Credit</strong> (Withdrawal / Deposit, Dr / Cr) - or one <strong>Amount</strong> column with a Dr/Cr type column, or signed (negative = money out)</li>
              <li>Optional: <strong>Balance</strong> (gives the opening/closing balance) and <strong>BAI Code</strong></li>
            </ul>
            <p className="mt-1.5 text-muted">
              Title rows above the header, "Opening Balance" / "Total" rows and repeated PDF headers are ignored automatically.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}


