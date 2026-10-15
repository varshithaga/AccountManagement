import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import dayjs from 'dayjs'
import {
  ArrowLeft, Trash2, Download, Sparkles, AlertTriangle, Search, X, Landmark, Receipt, Check, Lock, LockOpen,
  GitMerge, Scale,
} from 'lucide-react'
import { transactionsApi, subCategoriesApi } from '../../api/resources'
import { bankStatementsApi } from './bankstatementsapi'
import { uploadLinkFor } from './ContinuityBadge'
import CategorySubCategorySelect from '../../components/CategorySubCategorySelect'
import Pagination, { DEFAULT_ROWS_PER_PAGE } from '../../components/Pagination'
import Badge from '../../components/Badge'
import type { BadgeColor } from '../../components/Badge'
import type { BankStatement, Transaction, CategorizationSource } from '../../types'
import { categoryLabelWithType } from '../../constants/accountTypes'
import { formatClueLabels } from '../../utils/categorizationUtils'
import ReconciledWith from '../../components/ReconciledWith'
import MatchDialog from '../BankReconciliation/MatchDialog'
import type { MatchTarget } from '../BankReconciliation/bankreconciliationapi'
import { useAuth } from '../../context/AuthContext'
import { PageHeader } from '../../components/PageParts'
import { apiErrorText, withUnmatchConfirm } from '../../utils/reconcileConfirm'
import {
  Button, Panel, Select, DateField, TextField, Modal, Alert, Spinner, IconButton,
} from '../../components/tw'

const SOURCE_LABEL: Record<CategorizationSource, string> = {
  TRANSFER: 'Transfer',
  USER_RULE: 'User rule',
  HISTORY_EXACT: 'History match',
  SCORING: 'Scored',
  MANUAL: 'Manual',
}

const SOURCE_BADGE_COLOR: Record<CategorizationSource, BadgeColor> = {
  TRANSFER: 'secondary',
  USER_RULE: 'success',
  HISTORY_EXACT: 'info',
  SCORING: 'warning',
  MANUAL: 'primary',
}

function formatAmount(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '') return '—'
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.-]+/g, ''))
  if (isNaN(num)) return String(val)
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(num)
}

function DetailTile({ label, value, valueClass, badge, icon, iconBg, iconColor }: {
  label: string; value: React.ReactNode; valueClass?: string; badge?: React.ReactNode; icon?: React.ReactNode; iconBg?: string; iconColor?: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[18px] border border-border bg-surface p-5">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-muted">{label}</p>
        <div className={`${typeof value === 'string' && /^[₹\d−-]/.test(value) ? 'num ' : 'font-display '}mt-2 truncate text-xl font-semibold ${valueClass || 'text-ink'}`}>{value}</div>
        {badge && <div className="mt-1">{badge}</div>}
      </div>
      {icon && (
        <div className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] [&_svg]:h-[18px] [&_svg]:w-[18px] ${iconBg || 'bg-primary-soft'} ${iconColor || 'text-primary'}`}>
          {icon}
        </div>
      )}
    </div>
  )
}

export default function BankStatementDetailPage() {
  const { can } = useAuth()
  // The statement's transactions are the ledger's: either page's right lets the user change them.
  const canEdit = can('bank_statements', 'edit') || can('transactions', 'edit')
  const canDelete = can('bank_statements', 'delete') || can('transactions', 'delete')
  const canSelect = canEdit || canDelete
  const canMatch = can('bank_reconciliation', 'edit')
  const [matchTxn, setMatchTxn] = useState<MatchTarget | null>(null)
  const { id } = useParams()
  const navigate = useNavigate()
  const [statement, setStatement] = useState<BankStatement | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [count, setCount] = useState(0)
  const [missingCategoryCount, setMissingCategoryCount] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE)
  const [searchQuery, setSearchQuery] = useState('')
  const [uncategorizedOnly, setUncategorizedOnly] = useState(false)
  const [matchedViaFilter, setMatchedViaFilter] = useState<string>('')
  const [confirmedFilter, setConfirmedFilter] = useState<string>('')
  const [reconciledFilter, setReconciledFilter] = useState<'' | 'true' | 'false'>('')
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({})

  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [bulkCatDialog, setBulkCatDialog] = useState(false)
  const [bulkCatId, setBulkCatId] = useState<number | null>(null)
  const [bulkSubCatId, setBulkSubCatId] = useState<number | null>(null)

  const toggleSelectAll = () => {
    if (selectedIds.length === transactions.length) setSelectedIds([])
    else setSelectedIds(transactions.map((t) => t.id))
  }

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  const handleBulkDelete = async () => {
    if (!selectedIds.length) return
    if (!window.confirm(`Delete ${selectedIds.length} selected transaction(s)?`)) return
    try {
      if (!await withUnmatchConfirm((confirm) => transactionsApi.bulkDelete(selectedIds, confirm))) return
    } catch (err) {
      window.alert(apiErrorText(err, 'Failed to delete the selected transactions.'))
      return
    }
    setSelectedIds([])
    await refresh(true)
  }

  const handleBulkCategorize = async () => {
    if (!selectedIds.length || !bulkCatId || !bulkSubCatId) return
    await transactionsApi.bulkUpdate(selectedIds, bulkCatId, bulkSubCatId)
    setBulkCatDialog(false)
    setBulkCatId(null)
    setBulkSubCatId(null)
    setSelectedIds([])
    await refresh()
  }

  const [dialog, setDialog] = useState(false)
  const [form, setForm] = useState<{ date: string; description: string; debit: string; credit: string; balance: string }>({
    date: dayjs().format('YYYY-MM-DD'), description: '', debit: '0', credit: '0', balance: '',
  })

  // Three independent loads, so each action refetches only what it can change:
  // the statement header (opening/closing, counts, continuity) only when rows are added or
  // deleted; the uncategorized / source counts after any categorization change; the
  // transactions page after anything, and on its own when paging or filtering.
  const fetchStatement = useCallback(async () => {
    if (!id) return
    setStatement(await bankStatementsApi.get(id))
  }, [id])

  const fetchCounts = useCallback(async () => {
    if (!id) return
    const summaryRes = await transactionsApi.summary({ statement: Number(id) })
    setMissingCategoryCount(summaryRes.uncategorized_count)
    setSourceCounts(summaryRes.by_source || {})
  }, [id])

  const fetchTransactions = useCallback(async () => {
    if (!id) return
    const txnPage = await transactionsApi.search({
      statement: Number(id),
      page: page + 1,
      limit: rowsPerPage,
      search: searchQuery.trim() || undefined,
      uncategorized: uncategorizedOnly || undefined,
      categorization_source: matchedViaFilter || undefined,
      confirmed: confirmedFilter || undefined,
      reconciled: reconciledFilter || undefined,
    })
    setTransactions(txnPage.results)
    setCount(txnPage.count)
  }, [id, page, rowsPerPage, searchQuery, uncategorizedOnly, matchedViaFilter, confirmedFilter, reconciledFilter])

  useEffect(() => { fetchStatement(); fetchCounts() }, [fetchStatement, fetchCounts])
  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  /** After an action: transactions + counts; rowsChanged also reloads the statement header. */
  const refresh = async (rowsChanged = false) => {
    await Promise.all([fetchTransactions(), fetchCounts(), rowsChanged ? fetchStatement() : undefined])
  }

  const saveTransaction = async () => {
    if (!id) return
    setError('')
    try {
      await transactionsApi.create({
        statement: Number(id), date: form.date, description: form.description,
        debit: form.debit || 0, credit: form.credit || 0, balance: form.balance || null,
      })
      setDialog(false)
      await refresh(true)
    } catch (err: any) {
      const data = err.response?.data
      setError(data?.description?.[0] || data?.date?.[0] || data?.error?.[0] || 'Failed to add transaction.')
    }
  }

  const removeTransaction = async (txn: Transaction) => {
    if (!window.confirm('Delete this transaction?')) return
    try {
      if (!await withUnmatchConfirm((confirm) => transactionsApi.remove(txn.id, confirm))) return
    } catch (err) {
      window.alert(apiErrorText(err, 'Failed to delete the transaction.'))
      return
    }
    await refresh(true)
  }

  const changeCategory = async (txn: Transaction, categoryId: number | null, subCategoryId: number | null) => {
    await transactionsApi.update(txn.id, { category: categoryId, sub_category: subCategoryId })
    await refresh()
  }

  const createSubCategory = async (payload: { name: string; category: number }) => {
    return subCategoriesApi.create(payload)
  }

  const runCategorize = async () => {
    if (!id) return
    setBusy(true)
    try {
      const result = await bankStatementsApi.categorize(id)
      window.alert(
        `Categorized: ${result.matched} matched, ${result.needs_review} need review, `
        + `${result.unmatched} unmatched, ${result.transfers_detected} transfer pair(s) detected.`
      )
      await refresh()
    } catch {
      window.alert('Failed to categorize this statement.')
    } finally {
      setBusy(false)
    }
  }

  const describeFinalize = (res: { finalized: number; already_final: number; not_ready: number }) => {
    const parts = [`${res.finalized} transaction(s) made final.`]
    if (res.already_final) parts.push(`${res.already_final} were already final.`)
    if (res.not_ready) parts.push(`${res.not_ready} skipped - still Needs Review or Uncategorized; categorize them first.`)
    return parts.join('\n')
  }

  const FINAL_WARNING = 'Final transactions are locked: their category cannot be changed and they cannot be deleted '
    + '(nor this statement deleted or re-parsed) until reopened.'

  const handleFinalizeAll = async () => {
    if (!id) return
    if (!window.confirm(`Make every categorized transaction in this statement final?\n\n${FINAL_WARNING}`)) return
    setBusy(true)
    try {
      window.alert(describeFinalize(await transactionsApi.finalize({ statement: Number(id) })))
      await refresh()
    } catch {
      window.alert('Failed to make this statement\'s transactions final.')
    } finally {
      setBusy(false)
    }
  }

  const handleFinalizeSelected = async () => {
    if (!selectedIds.length) return
    if (!window.confirm(`Make ${selectedIds.length} selected transaction(s) final?\n\n${FINAL_WARNING}`)) return
    try {
      window.alert(describeFinalize(await transactionsApi.finalize({ ids: selectedIds })))
      setSelectedIds([])
      await refresh()
    } catch {
      window.alert('Failed to make the selected transactions final.')
    }
  }

  const handleReopenSelected = async () => {
    if (!selectedIds.length) return
    if (!window.confirm(`Reopen ${selectedIds.length} selected transaction(s)? They can be edited again.`)) return
    try {
      const res = await transactionsApi.reopen(selectedIds)
      window.alert(`${res.reopened} transaction(s) reopened.`)
      setSelectedIds([])
      await refresh()
    } catch {
      window.alert('Failed to reopen the selected transactions.')
    }
  }

  const handleFinalizeOne = async (txn: Transaction) => {
    if (!window.confirm('Make this transaction final? Its category will be locked until you reopen it.')) return
    try {
      const res = await transactionsApi.finalize({ ids: [txn.id] })
      if (!res.finalized) window.alert(describeFinalize(res))
      await refresh()
    } catch {
      window.alert('Failed to make this transaction final.')
    }
  }

  const handleReopenOne = async (txn: Transaction) => {
    if (!window.confirm('Reopen this transaction? It can be edited again.')) return
    try {
      await transactionsApi.reopen([txn.id])
      await refresh()
    } catch {
      window.alert('Failed to reopen this transaction.')
    }
  }

  const handleConfirmAll = async () => {
    if (!id) return
    setBusy(true)
    try {
      const res = await transactionsApi.bulkConfirm({ statement: Number(id) })
      window.alert(`Successfully confirmed ${res.confirmed} categorized transaction(s) as final.`)
      await refresh()
    } catch {
      window.alert('Failed to confirm statement transactions.')
    } finally {
      setBusy(false)
    }
  }

  const handleBulkConfirmSelected = async () => {
    if (!selectedIds.length) return
    try {
      const res = await transactionsApi.bulkConfirm({ ids: selectedIds })
      window.alert(`Successfully confirmed ${res.confirmed} selected transaction(s) as final.`)
      setSelectedIds([])
      await refresh()
    } catch {
      window.alert('Failed to confirm selected transactions.')
    }
  }

  const handleConfirmOne = async (txn: Transaction) => {
    try {
      await transactionsApi.confirm(txn.id)
      await refresh()
    } catch {
      window.alert('Failed to confirm transaction.')
    }
  }

  if (!statement) {
    return (
      <div className="p-16 text-center">
        <Spinner size={36} className="mx-auto" />
        <p className="mt-3 text-sm text-muted">Loading bank statement details...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* TOP HEADER */}
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => navigate('/bank-statements')}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Back to statements
        </button>
        <PageHeader
          eyebrow="Bank statement"
          title={statement.account_name}
          description={<>Uploaded {dayjs(statement.uploaded_at).format('DD MMM YYYY, HH:mm')} · <span className="num">{count}</span> transactions</>}
          actions={
            <>
          {can('bank_statements', 'edit') && (
            <Button
              variant="outlined"
              onClick={runCategorize}
              disabled={busy || count === 0}
              icon={busy ? <Spinner size={16} /> : <Sparkles className="h-4 w-4 text-primary" />}
            >
              Auto-Categorize
            </Button>
          )}
          {canEdit && (
            <>
              <Button
                variant="contained"
                onClick={handleConfirmAll}
                disabled={busy || count === 0}
               
              >
                Confirm All Categorized
              </Button>
              <Button
                variant="contained"
                color="neutral"
                onClick={handleFinalizeAll}
                disabled={busy || count === 0}
                icon={<Lock className="h-4 w-4" />}
              >
                Make All Final
              </Button>
            </>
          )}
          {statement.file && (
            <a
              href={statement.file}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-[46px] items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-muted"
            >
              <Download className="h-4 w-4" />
              Download File
            </a>
          )}
            </>
          }
        />
      </div>

      {/* STATEMENT CONTINUITY & RECONCILIATION BANNER */}
      {statement.continuity_status && !statement.continuity_status.is_continuous && (
        <Alert className="border-danger-border bg-danger-soft text-danger-text">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger-text" />
            <div>
              <h4 className="font-bold text-danger-text">
                Statement Discrepancy / Gap Warning
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-danger-text">
                {statement.continuity_status.gap_message || 'Opening balance does not match the previous statement closing balance or transaction running totals.'}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {can('bank_statements', 'create') && statement.continuity_status.issues.some((i) => i === 'MISSING_PERIOD' || i === 'BALANCE_GAP') && (
                  <Button size="sm" variant="outlined" color="error" onClick={() => navigate(uploadLinkFor(statement.account))}>
                    Upload missing statement
                  </Button>
                )}
                <Button size="sm" variant="text" color="error" onClick={() => navigate('/bank-statements/continuity')}>
                  View account timeline
                </Button>
              </div>
            </div>
          </div>
        </Alert>
      )}
      {statement.continuity_status && statement.continuity_status.is_continuous && statement.continuity_status.has_previous && (
        <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success-soft px-4 py-2.5 text-xs font-bold text-success-text">
          <Check className="h-4 w-4 text-success-text" />
          <span>Verified Continuous Statement: Opening balance matches previous statement closing balance ({formatAmount(statement.opening_balance)}).</span>
        </div>
      )}

      {/* STATEMENT OVERVIEW KPI CARDS */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DetailTile
          label="Bank Account"
          value={statement.account_name}
          badge={
            <Badge size="sm" color="info">
              {statement.source_type} Format
            </Badge>
          }
          icon={<Landmark className="h-5 w-5" />}
          iconBg="bg-primary-soft"
          iconColor="text-primary"
        />
        <DetailTile
          label="Opening Balance"
          value={formatAmount(statement.opening_balance)}
          icon={<Receipt className="h-5 w-5" />}
          iconBg="bg-info-soft"
          iconColor="text-info-text"
        />
        <DetailTile
          label="Closing Balance"
          value={formatAmount(statement.closing_balance)}
          valueClass="text-success-text"
          icon={<Receipt className="h-5 w-5" />}
          iconBg="bg-success-soft"
          iconColor="text-success-text"
        />
        <DetailTile
          label="Transactions"
          value={`${count} total`}
          badge={
            missingCategoryCount > 0 ? (
              <Badge size="sm" color="error">
                {missingCategoryCount} Uncategorized
              </Badge>
            ) : undefined
          }
          icon={<Receipt className="h-5 w-5" />}
          iconBg="bg-primary-soft"
          iconColor="text-primary"
        />
      </div>

      {/* CATEGORIZATION MATCHED SOURCES BREAKDOWN CARD */}
      <Panel className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-ink">
              Categorization Matched Sources Breakdown
            </h3>
          </div>
          {matchedViaFilter && (
            <button
              type="button"
              onClick={() => { setMatchedViaFilter(''); setPage(0) }}
              className="text-xs font-semibold text-primary hover:text-primary-hover"
            >
              Clear Source Filter
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {(
            [
              { key: 'HISTORY_EXACT', label: 'History Match', color: 'info' },
              { key: 'USER_RULE', label: 'User Rule', color: 'success' },
              { key: 'SCORING', label: 'Scored Match', color: 'warning' },
              { key: 'TRANSFER', label: 'Transfer Pair', color: 'secondary' },
              { key: 'MANUAL', label: 'Manual Choice', color: 'primary' },
            ] as const
          ).map((src) => {
            const countVal = sourceCounts[src.key] || 0
            const isSelected = matchedViaFilter === src.key
            return (
              <button
                key={src.key}
                type="button"
                onClick={() => {
                  setMatchedViaFilter(isSelected ? '' : src.key)
                  setPage(0)
                }}
                className={`flex items-center justify-between rounded-xl border p-3 text-left transition-all ${isSelected
                  ? 'border-primary bg-primary-soft ring-[3px] ring-primary-soft'
                  : 'border-border bg-surface hover:border-primary-border'
                  }`}
              >
                <div>
                  <p className="text-[0.68rem] font-bold text-muted">{src.label}</p>
                  <p className="num mt-0.5 text-lg font-semibold text-ink">{countVal}</p>
                </div>
                <Badge size="sm" color={src.color as BadgeColor}>
                  {src.key === 'HISTORY_EXACT' ? 'History' : src.key === 'USER_RULE' ? 'Rule' : src.key === 'SCORING' ? 'Scored' : src.key === 'TRANSFER' ? 'Transfer' : 'Manual'}
                </Badge>
              </button>
            )
          })}
        </div>
      </Panel>

      {/* RECONCILIATION */}
      {statement?.progress && statement.progress.total > 0 && (() => {
        const { total, reconciled, unreconciled } = statement.progress
        const pctDone = Math.round((reconciled / total) * 100)
        const pick = (value: '' | 'true' | 'false') => { setReconciledFilter(reconciledFilter === value ? '' : value); setPage(0) }
        return (
          <Panel className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GitMerge className="h-4 w-4 text-info-text" />
                <h3 className="text-sm font-bold text-ink">Bank Reconciliation</h3>
                <span className="text-xs text-muted">matched to journal entries</span>
              </div>
              <Button
                variant="outlined"
                size="sm"
                icon={<Scale className="h-3.5 w-3.5" />}
                onClick={() => navigate(statement.gl_linked === false
                  ? `/bank-reconciliation?account=${statement.account}`
                  : `/bank-reconciliation?account=${statement.account}&statement=${statement.id}`)}
              >
                {statement.gl_linked === false ? 'Link GL Account' : 'Reconcile This Statement'}
              </Button>
            </div>
            {statement.gl_linked === false && (
              <Alert className="mb-3 border-warning/30 bg-warning-soft text-warning-text">
                {statement.account_name} isn't linked to a GL account yet, so none of these transactions can be reconciled.
                Link it on Bank Reconciliation first.
              </Alert>
            )}
            <div className="mb-3 flex items-baseline justify-between text-sm">
              <span className="font-bold text-ink">{reconciled} of {total} reconciled</span>
              <span className={`font-bold ${unreconciled === 0 ? 'text-info-text' : 'text-ink'}`}>{pctDone}%</span>
            </div>
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-warning-soft">
              <div className="h-full rounded-full bg-success" style={{ width: `${pctDone}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {([
                { value: 'true', label: 'Reconciled', n: reconciled, tone: 'text-info-text' },
                { value: 'false', label: 'Not reconciled', n: unreconciled, tone: 'text-warning-text' },
              ] as const).map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => pick(c.value)}
                  title={reconciledFilter === c.value ? 'Show all transactions' : `Show only ${c.label.toLowerCase()} transactions`}
                  className={`rounded-xl border p-3 text-left transition-all ${reconciledFilter === c.value
                    ? 'border-primary bg-primary-soft ring-[3px] ring-primary-soft'
                    : 'border-border bg-surface hover:border-primary-border'}`}
                >
                  <p className="text-[0.68rem] font-bold text-muted">{c.label}</p>
                  <p className={`mt-0.5 text-lg font-bold ${c.tone}`}>{c.n}</p>
                </button>
              ))}
            </div>
          </Panel>
        )
      })()}

      {/* TRANSACTION SEARCH & FILTER TOOLBAR */}
      <Panel className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <TextField
            className="min-w-[280px] flex-1"
            placeholder="Search statement transactions by description or narration..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(0) }}
            startIcon={<Search className="h-4 w-4" />}
            endIcon={searchQuery ? (
              <button type="button" onClick={() => { setSearchQuery(''); setPage(0) }} className="pointer-events-auto text-muted hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            ) : undefined}
          />

          <Select
            id="matched-via-select"
            value={matchedViaFilter}
            onChange={(e) => { setMatchedViaFilter(e.target.value); setPage(0) }}
            className="min-w-[190px]"
          >
            <option value="">All Matched Via</option>
            <option value="USER_RULE">User rule</option>
            <option value="HISTORY_EXACT">History match</option>
            <option value="SCORING">Scored</option>
            <option value="TRANSFER">Transfer</option>
            <option value="MANUAL">Manual choice</option>
          </Select>

          <Select
            id="confirmed-status-select"
            value={confirmedFilter}
            onChange={(e) => { setConfirmedFilter(e.target.value); setPage(0) }}
            className="min-w-[200px]"
          >
            <option value="">All Confirmation Statuses</option>
            <option value="true">Confirmed Only</option>
            <option value="false">⏳ Pending Confirmation Only</option>
          </Select>

          <Select
            id="reconciled-select"
            value={reconciledFilter}
            onChange={(e) => { setReconciledFilter(e.target.value as '' | 'true' | 'false'); setPage(0) }}
            className="min-w-[190px]"
          >
            <option value="">All Reconciliation</option>
            <option value="true">Reconciled</option>
            <option value="false">Not reconciled</option>
          </Select>

          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              checked={uncategorizedOnly}
              onChange={(e) => { setUncategorizedOnly(e.target.checked); setPage(0) }}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            Uncategorized Only (No Category Allotted)
          </label>
        </div>
      </Panel>

      {/* BULK ACTION BAR */}
      {canSelect && selectedIds.length > 0 && (
        <Panel className="flex items-center justify-between border-primary-border bg-primary-soft p-4">
          <p className="text-sm font-bold text-ink">{selectedIds.length} transaction(s) selected</p>
          <div className="flex items-center gap-2.5">
            {canEdit && (
              <>
                <Button variant="contained" onClick={handleBulkConfirmSelected}>
                  Confirm Selected
                </Button>
                <Button variant="contained" onClick={() => setBulkCatDialog(true)}>Bulk Assign Category</Button>
                <Button variant="contained" color="neutral" icon={<Lock className="h-3.5 w-3.5" />} onClick={handleFinalizeSelected}>Make Final</Button>
                <Button variant="outlined" color="neutral" icon={<LockOpen className="h-3.5 w-3.5" />} onClick={handleReopenSelected}>Reopen</Button>
              </>
            )}
            {canDelete && (
              <Button variant="outlined" color="error" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={handleBulkDelete}>Delete Selected</Button>
            )}
          </div>
        </Panel>
      )}

      {/* MAIN TRANSACTIONS TABLE */}
      {transactions.length > 0 ? (
        <Panel className="overflow-hidden p-0">
          <Pagination
            position="top"
            count={count} page={page} rowsPerPage={rowsPerPage}
            onPageChange={setPage} onRowsPerPageChange={(rpp) => { setRowsPerPage(rpp); setPage(0) }}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  {canSelect && (
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={transactions.length > 0 && selectedIds.length === transactions.length}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 rounded border-input accent-primary"
                      />
                    </th>
                  )}
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Date</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Description</th>
                  <th className="px-3 py-3 text-right text-xs font-bold text-ink">Debit (Paid)</th>
                  <th className="px-3 py-3 text-right text-xs font-bold text-ink">Credit (Received)</th>
                  <th className="px-3 py-3 text-right text-xs font-bold text-ink">Balance</th>
                  <th className="min-w-[280px] px-3 py-3 text-left text-xs font-bold text-ink">Category / Sub-Category</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Matched Via</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Scoring Clues</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Status</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Duplicate</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Reconciled</th>
                  <th className="px-3 py-3 pr-6 text-right text-xs font-bold text-ink">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {transactions.map((t) => {
                  const isDebit = Number(t.debit) > 0
                  const isCredit = Number(t.credit) > 0
                  const isSelected = selectedIds.includes(t.id)

                  return (
                    <tr key={t.id} className={`hover:bg-surface-muted ${isSelected ? 'bg-violet-50/50 dark:bg-violet-500/5' : ''}`}>
                      {canSelect && (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(t.id)}
                            className="h-4 w-4 rounded border-input accent-primary"
                          />
                        </td>
                      )}

                      <td className="whitespace-nowrap px-3 py-3 font-semibold text-ink">
                        {dayjs(t.date).format('DD MMM YYYY')}
                      </td>

                      <td className="max-w-[280px] px-3 py-3 font-semibold text-ink">
                        {t.description || <span className="italic text-muted">(no description)</span>}
                        {t.bai_code && (
                          <span
                            title={t.bai_code_description || 'BAI transaction type code'}
                            className="ml-1.5 inline-flex items-center rounded bg-surface-muted px-1.5 py-0.5 align-middle font-mono text-[0.65rem] font-bold text-slate-500 dark:text-muted"
                          >
                            BAI {t.bai_code}
                          </span>
                        )}
                      </td>

                      <td className={`px-3 py-3 text-right font-bold ${isDebit ? 'text-danger-text' : 'text-muted'}`}>
                        {isDebit ? formatAmount(t.debit) : '—'}
                      </td>

                      <td className={`px-3 py-3 text-right font-bold ${isCredit ? 'text-success-text' : 'text-muted'}`}>
                        {isCredit ? formatAmount(t.credit) : '—'}
                      </td>

                      <td className="px-3 py-3 text-right font-semibold text-ink">
                        {formatAmount(t.balance)}
                      </td>

                      <td className="px-3 py-3">
                        <CategorySubCategorySelect
                          categoryId={t.category}
                          subCategoryId={t.sub_category}
                          categoryLabel={t.category_name && t.category_account_type
                            ? categoryLabelWithType({ name: t.category_name, account_type: t.category_account_type })
                            : t.category_name}
                          subCategoryLabel={t.sub_category_name}
                          onChange={(catId, subId) => changeCategory(t, catId, subId)}
                          disabled={t.is_final || !canEdit}
                          onCreateSubCategory={createSubCategory}
                        />
                      </td>

                      <td className="px-3 py-3">
                        {t.categorization_source ? (
                          <Badge size="sm" color={SOURCE_BADGE_COLOR[t.categorization_source] || 'default'}>
                            {SOURCE_LABEL[t.categorization_source] || t.categorization_source}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>

                      <td className="px-3 py-3">
                        {(t.scoring_clues || t.score_breakdown) ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning-soft px-2 py-1 text-xs font-semibold text-warning-text dark:bg-warning-soft ">
                            <Sparkles className="h-3 w-3 shrink-0" />
                            {t.scoring_clues || formatClueLabels(t.score_breakdown)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>

                      <td className="px-3 py-3">
                        {t.is_final ? (
                          <span title="Final - locked until reopened" className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[0.65rem] font-bold text-white dark:bg-slate-200 dark:text-slate-900">
                            <Lock className="h-3 w-3" /> Final
                          </span>
                        ) : t.confirmed ? (
                          <Badge size="sm" color="success">Confirmed</Badge>
                        ) : t.sub_category ? (
                          <Badge size="sm" color="warning">Pending Confirm</Badge>
                        ) : (
                          <Badge size="sm" color="default">Uncategorized</Badge>
                        )}
                      </td>

                      <td className="px-3 py-3">
                        {t.is_potential_duplicate ? (
                          <div
                            title={
                              t.duplicate_of
                                ? `Possible duplicate of "${t.duplicate_of_description}" on ${dayjs(t.duplicate_of_date).format('DD MMM YYYY')} (statement #${t.duplicate_of_statement})`
                                : 'Another transaction on this account has the same date, description, debit and credit.'
                            }
                            className="inline-flex items-center gap-1 text-xs text-warning-text"
                          >
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            <Badge size="sm" color="warning">Duplicate</Badge>
                          </div>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-3 py-3">
                        <ReconciledWith txn={t} onMatch={canMatch && statement.gl_linked !== false ? () => setMatchTxn({ kind: 'transaction', id: t.id }) : undefined} />
                      </td>

                      <td className="px-3 py-3 pr-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {canEdit && t.sub_category && !t.confirmed && !t.is_final && (
                            <button
                              type="button"
                              onClick={() => handleConfirmOne(t)}
                              title="Confirm this category choice"
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm"
                            >
                              Confirm
                            </button>
                          )}
                          {!canEdit ? null : t.is_final ? (
                            <IconButton className="h-8 w-8 text-muted" title="Reopen (unlock)" onClick={() => handleReopenOne(t)}>
                              <LockOpen className="h-4 w-4" />
                            </IconButton>
                          ) : ((t.sub_category && t.status !== 'NEEDS_REVIEW') || t.status === 'TRANSFER') ? (
                            <IconButton className="h-8 w-8 text-ink" title="Make final (lock)" onClick={() => handleFinalizeOne(t)}>
                              <Lock className="h-4 w-4" />
                            </IconButton>
                          ) : null}
                          {canDelete && !t.is_final && (
                            <IconButton
                              className="h-8 w-8 text-danger-text"
                              title="Delete transaction"
                              onClick={() => removeTransaction(t)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </IconButton>
                          )}
                        </div>
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
        <Panel className="border-dashed py-12 text-center">
          <Receipt className="mx-auto mb-3 h-12 w-12 text-slate-300 opacity-60 dark:text-slate-600" />
          <h3 className="mb-2 text-base font-bold text-muted">
            {searchQuery || uncategorizedOnly ? 'No transactions match your search/filter.' : 'No transactions yet on this statement.'}
          </h3>
        </Panel>
      )}

      {/* ADD TRANSACTION DIALOG */}
      <Modal
        open={dialog}
        onClose={() => setDialog(false)}
        title="Add Transaction"
        widthClassName="max-w-md"
        footer={
          <>
            <Button variant="outlined" onClick={() => setDialog(false)}>Cancel</Button>
            <Button variant="contained" onClick={saveTransaction}>Save Transaction</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {error && <Alert>{error}</Alert>}
          <DateField
            id="txn-add-date"
            label="Date"
            value={form.date}
            onChange={(v) => setForm({ ...form, date: v })}
          />
          <TextField
            label="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            autoFocus
          />
          <TextField
            label="Debit Amount (Paid Out)"
            type="number"
            value={form.debit}
            onChange={(e) => setForm({ ...form, debit: e.target.value })}
          />
          <TextField
            label="Credit Amount (Received In)"
            type="number"
            value={form.credit}
            onChange={(e) => setForm({ ...form, credit: e.target.value })}
          />
          <TextField
            label="Balance (optional)"
            type="number"
            value={form.balance}
            onChange={(e) => setForm({ ...form, balance: e.target.value })}
          />
        </div>
      </Modal>

      {/* BULK CATEGORIZE DIALOG */}
      <Modal
        open={bulkCatDialog}
        onClose={() => setBulkCatDialog(false)}
        title={`Bulk Assign Category (${selectedIds.length} items)`}
        widthClassName="max-w-md"
        footer={
          <>
            <Button variant="outlined" onClick={() => setBulkCatDialog(false)}>Cancel</Button>
            <Button variant="contained" disabled={!bulkCatId || !bulkSubCatId} onClick={handleBulkCategorize}>
              Apply Category
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-xs text-muted">
            Select a category and sub-category to apply to all selected transactions.
          </p>
          <CategorySubCategorySelect
            categoryId={bulkCatId}
            subCategoryId={bulkSubCatId}
            onChange={(catId, subId) => { setBulkCatId(catId); setBulkSubCatId(subId) }}
            onCreateSubCategory={createSubCategory}
          />
        </div>
      </Modal>

      <MatchDialog
        target={matchTxn}
        onClose={() => setMatchTxn(null)}
        onMatched={() => { setMatchTxn(null); refresh(true) }}
      />
    </div>
  )
}


