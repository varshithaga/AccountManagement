import { useCallback, useEffect, useState, useMemo } from 'react'
import { describeFinalize } from '../../utils/finalizeMessage'
import { useSearchParams, useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
  Plus, Trash2, AlertTriangle, Receipt, Search, X, MoreVertical, HelpCircle,
  ArrowDown, ArrowUp, Landmark, Tag, Sparkles, ArrowRightLeft, Check,
  Download, Lock, LockOpen, GitMerge, BookOpenCheck,
} from 'lucide-react'
import { transactionsApi } from './transactionsapi'
import { categoriesApi, subCategoriesApi } from '../Categories/categoriesapi'
import BankAccountSelect from '../../components/BankAccountSelect'
import CategorySubCategorySelect from '../../components/CategorySubCategorySelect'
import {
  fetchCategoryOptions, parentCategoryOf, plainSubCategoryOption, resolveCategoryOption, resolveSubCategoryOption,
  subCategoryOptionsFetcher,
} from '../../utils/categoryLookup'
import SearchableSelect from '../../components/SearchableSelect'
import type { SearchableOption } from '../../components/SearchableSelect'
import { categoryLabelWithType } from '../../constants/accountTypes'
import Pagination, { DEFAULT_ROWS_PER_PAGE } from '../../components/Pagination'
import type { Transaction } from '../../types'
import { exportToExcel } from '../../utils/excelExport'
import ReconciledWith from '../../components/ReconciledWith'
import { useAuth } from '../../context/AuthContext'
import { apiErrorText, withUnmatchConfirm } from '../../utils/reconcileConfirm'
import { formatClueLabels } from '../../utils/categorizationUtils'
import {
  Button, Panel, Select, TextField, Modal, Alert, Spinner, Chip, IconButton,
} from '../../components/tw'
import DatePicker2 from '../../components/DatePicker2'
import { SOURCE_LABEL, SOURCE_TONE, STATUS_LABEL, STATUS_TONE, PERIOD_OPTIONS, formatAmount, formatK } from './transactionDisplay'
import { StatTile, IndeterminateCheckbox } from './TransactionWidgets'
import type { Period } from './transactionDisplay'

export default function TransactionsPage() {
  const { can } = useAuth()
  const canEdit = can('transactions', 'edit')
  const canDelete = can('transactions', 'delete')
  const canSelect = canEdit || canDelete
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()


  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [bulkCatDialog, setBulkCatDialog] = useState(false)
  const [bulkCatId, setBulkCatId] = useState<number | null>(null)
  const [bulkSubCatId, setBulkSubCatId] = useState<number | null>(null)

  // Single transaction category dialog
  const [singleCatDialog, setSingleCatDialog] = useState<Transaction | null>(null)
  const [singleCatId, setSingleCatId] = useState<number | null>(null)
  const [singleSubCatId, setSingleSubCatId] = useState<number | null>(null)

  useEffect(() => {
    if (singleCatDialog) {
      setSingleCatId(singleCatDialog.category)
      setSingleSubCatId(singleCatDialog.sub_category)
    }
  }, [singleCatDialog])

  // Row options menu [⋮]
  const [menuTxnId, setMenuTxnId] = useState<number | null>(null)
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)

  const handleOpenTxnMenu = (e: React.MouseEvent<HTMLButtonElement>, txnId: number) => {
    if (menuTxnId === txnId) {
      setMenuTxnId(null)
      setMenuPos(null)
    } else {
      const rect = e.currentTarget.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const right = window.innerWidth - rect.right
      if (spaceBelow < 220) {
        setMenuPos({ bottom: window.innerHeight - rect.top + 6, right })
      } else {
        setMenuPos({ top: rect.bottom + 6, right })
      }
      setMenuTxnId(txnId)
    }
  }

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
    await fetchTransactions()
    await fetchSummaryMetrics()
  }

  const handleBulkCategorize = async () => {
    if (!selectedIds.length || !bulkCatId || !bulkSubCatId) return
    await transactionsApi.bulkUpdate(selectedIds, bulkCatId, bulkSubCatId)
    setBulkCatDialog(false)
    setBulkCatId(null)
    setBulkSubCatId(null)
    setSelectedIds([])
    await fetchTransactions()
    await fetchSummaryMetrics()
  }

  const handleBulkConfirmSelected = async () => {
    if (!selectedIds.length) return
    try {
      const res = await transactionsApi.bulkConfirm({ ids: selectedIds })
      window.alert(`Successfully confirmed ${res.confirmed} selected transaction(s).`)
      setSelectedIds([])
      await fetchTransactions()
      await fetchSummaryMetrics()
    } catch {
      window.alert('Failed to confirm selected transactions.')
    }
  }


  const handleFinalizeSelected = async () => {
    if (!selectedIds.length) return
    if (!window.confirm(
      `Make ${selectedIds.length} selected transaction(s) final?\n\n`
      + 'Final transactions are locked: their category cannot be changed and they cannot be deleted until reopened.'
    )) return
    try {
      window.alert(describeFinalize(await transactionsApi.finalize({ ids: selectedIds })))
      setSelectedIds([])
      await fetchTransactions()
      await fetchSummaryMetrics()
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
      await fetchTransactions()
      await fetchSummaryMetrics()
    } catch {
      window.alert('Failed to reopen the selected transactions.')
    }
  }

  const handleFinalizeOne = async (txn: Transaction) => {
    if (!window.confirm('Make this transaction final? Its category will be locked until you reopen it.')) return
    try {
      const res = await transactionsApi.finalize({ ids: [txn.id] })
      if (!res.finalized) window.alert(describeFinalize(res))
      await fetchTransactions()
      await fetchSummaryMetrics()
    } catch {
      window.alert('Failed to make this transaction final.')
    }
  }

  const handleReopenOne = async (txn: Transaction) => {
    if (!window.confirm('Reopen this transaction? It can be edited again.')) return
    try {
      await transactionsApi.reopen([txn.id])
      await fetchTransactions()
      await fetchSummaryMetrics()
    } catch {
      window.alert('Failed to reopen this transaction.')
    }
  }

  const handleConfirmOne = async (txn: Transaction) => {
    try {
      await transactionsApi.confirm(txn.id)
      await fetchTransactions()
      await fetchSummaryMetrics()
    } catch {
      window.alert('Failed to confirm transaction.')
    }
  }

  const account = searchParams.get('account') || ''
  const categoryFilter = searchParams.get('category') || ''
  const subCategoryFilter = searchParams.get('sub_category') || ''
  const uncategorizedOnly = searchParams.get('uncategorized') === 'true'
  const duplicatesOnly = searchParams.get('duplicate') === 'true'
  const confirmedOnly = searchParams.get('confirmed') === 'true'
  const finalOnly = searchParams.get('final') === 'true'
  const search = searchParams.get('search') || ''
  const period = (searchParams.get('period') as Period | null) || 'this_month'
  const dateFrom = searchParams.get('date_from') || ''
  const dateTo = searchParams.get('date_to') || ''
  const categorizationSourceFilter = searchParams.get('categorization_source') || ''
  const statusFilter = searchParams.get('status') || ''
  const reconciledFilter = searchParams.get('reconciled') || ''

  const [categoryOption, setCategoryOption] = useState<SearchableOption | null>(null)
  const [subCategoryOption, setSubCategoryOption] = useState<SearchableOption | null>(null)

  // Filters restored from the URL (links, reload) only carry ids - fetch just that option's label.
  useEffect(() => {
    if (!categoryFilter) {
      setCategoryOption(null)
      return
    }
    const catId = Number(categoryFilter)
    if (categoryOption?.id === catId) return
    setCategoryOption({ id: catId, label: `Category #${catId}` })
    resolveCategoryOption(catId).then((opt) => { if (opt) setCategoryOption(opt) }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter])

  useEffect(() => {
    if (!subCategoryFilter) {
      setSubCategoryOption(null)
      return
    }
    const subId = Number(subCategoryFilter)
    if (subCategoryOption?.id === subId) return
    setSubCategoryOption({ id: subId, label: `Sub-Category #${subId}` })
    resolveSubCategoryOption(subId).then((opt) => { if (opt) setSubCategoryOption(opt) }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subCategoryFilter])

  const fetchSubCategoryOptions = useMemo(
    () => subCategoryOptionsFetcher(categoryFilter ? Number(categoryFilter) : null),
    [categoryFilter],
  )

  const handleCategoryOptionChange = (opt: SearchableOption | null) => {
    setCategoryOption(opt)
    setSubCategoryOption(null)
    const next = new URLSearchParams(searchParams)
    if (opt) next.set('category', String(opt.id))
    else next.delete('category')
    next.delete('sub_category')
    setSearchParams(next)
    setPage(0)
  }

  const handleSubCategoryOptionChange = (opt: SearchableOption | null) => {
    setSubCategoryOption(opt ? plainSubCategoryOption(opt) : null)
    const next = new URLSearchParams(searchParams)
    if (opt) next.set('sub_category', String(opt.id))
    else next.delete('sub_category')
    // Picking a sub-category with no category chosen fills its category in too.
    const parent = parentCategoryOf(opt)
    if (parent && !categoryFilter) {
      setCategoryOption(parent)
      next.set('category', String(parent.id))
    }
    setSearchParams(next)
    setPage(0)
  }

  const setFilter = (key: string, value: string | boolean) => {
    const next = new URLSearchParams(searchParams)
    if (!value) next.delete(key)
    else next.set(key, String(value))
    setSearchParams(next)
    setPage(0)
  }

  const handlePeriodChange = (value: Period) => {
    const next = new URLSearchParams(searchParams)
    if (value === 'this_month') next.delete('period')
    else next.set('period', value)
    if (value !== 'custom') {
      next.delete('date_from')
      next.delete('date_to')
    }
    setSearchParams(next)
    setPage(0)
  }

  const clearFilters = () => {
    setSearchParams(new URLSearchParams())
    setCategoryOption(null)
    setSubCategoryOption(null)
    setPage(0)
  }


  const filterParams = useMemo(() => {
    return {
      account: account ? Number(account) : undefined,
      category: categoryFilter ? Number(categoryFilter) : undefined,
      sub_category: subCategoryFilter ? Number(subCategoryFilter) : undefined,
      uncategorized: uncategorizedOnly || undefined,
      is_potential_duplicate: duplicatesOnly || undefined,
      confirmed: confirmedOnly || undefined,
      is_final: finalOnly || undefined,
      categorization_source: categorizationSourceFilter || undefined,
      status: statusFilter || undefined,
      reconciled: reconciledFilter || undefined,
      search: search || undefined,
      period,
      date_from: period === 'custom' ? (dateFrom || undefined) : undefined,
      date_to: period === 'custom' ? (dateTo || undefined) : undefined,
    }
  }, [account, categoryFilter, subCategoryFilter, uncategorizedOnly, duplicatesOnly, confirmedOnly, finalOnly, categorizationSourceFilter, statusFilter, reconciledFilter, search, period, dateFrom, dateTo])

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await transactionsApi.search({
        ...filterParams,
        page: page + 1,
        limit: rowsPerPage,
        ordering: '-date',
      })
      setTransactions(data.results)
      setCount(data.count)
    } catch {
      setError('Failed to load transactions.')
    } finally {
      setLoading(false)
    }
  }, [filterParams, page, rowsPerPage])

  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  const [summaryMetrics, setSummaryMetrics] = useState({
    totalTransactions: 0,
    uncategorizedCount: 0,
    duplicatesCount: 0,
    reconciledCount: 0,
    totalDebits: 0,
    totalCredits: 0,
    accountsCount: 1,
  })

  const fetchSummaryMetrics = useCallback(async () => {
    try {
      const res = await transactionsApi.summary(filterParams)
      setSummaryMetrics({
        totalTransactions: res.total_transactions,
        uncategorizedCount: res.uncategorized_count,
        duplicatesCount: res.duplicates_count,
        reconciledCount: res.reconciled_count,
        totalDebits: res.total_debits,
        totalCredits: res.total_credits,
        accountsCount: res.accounts_count || 1,
      })
    } catch {
      // ignore error
    }
  }, [filterParams])

  useEffect(() => {
    fetchSummaryMetrics()
  }, [fetchSummaryMetrics])

  const changeCategory = async (txn: Transaction, categoryId: number | null, subCategoryId: number | null) => {
    await transactionsApi.update(txn.id, { category: categoryId, sub_category: subCategoryId })
    await fetchTransactions()
    await fetchSummaryMetrics()
  }

  const createCategory = async (payload: { name: string; account_type: string }) => {
    return categoriesApi.create(payload)
  }

  const createSubCategory = async (payload: { name: string; category: number }) => {
    return subCategoriesApi.create(payload)
  }

  const removeTransaction = async (txn: Transaction) => {
    if (!window.confirm('Delete this transaction?')) return
    try {
      if (!await withUnmatchConfirm((confirm) => transactionsApi.remove(txn.id, confirm))) return
    } catch (err) {
      window.alert(apiErrorText(err, 'Failed to delete the transaction.'))
      return
    }
    await fetchTransactions()
    await fetchSummaryMetrics()
  }

  const hasActiveFilters = Boolean(search || account || categoryFilter || uncategorizedOnly || duplicatesOnly || confirmedOnly || finalOnly || categorizationSourceFilter || statusFilter || reconciledFilter || period !== 'this_month')

  const [postingToBooks, setPostingToBooks] = useState(false)
  const handlePostToBooks = async () => {
    setPostingToBooks(true)
    try {
      const res = await transactionsApi.postToBooks()
      window.alert(res.posted
        ? `${res.posted} final transaction(s) posted to the books.`
          + (res.no_gl_account ? `
${res.no_gl_account} still waiting - their bank account has no GL account.` : '')
        : 'Every final transaction is already in the books.'
          + (res.no_gl_account ? `
${res.no_gl_account} can't be posted - their bank account has no GL account.` : ''))
      await fetchTransactions()
      await fetchSummaryMetrics()
    } catch {
      window.alert('Failed to post transactions to the books.')
    } finally {
      setPostingToBooks(false)
    }
  }

  const [detectingTransfers, setDetectingTransfers] = useState(false)
  const handleDetectTransfers = async () => {
    setDetectingTransfers(true)
    try {
      const res = await transactionsApi.detectTransfers()
      window.alert(`Detected ${res.transfer_pairs_detected} new transfer pair(s).`)
      await fetchTransactions()
      await fetchSummaryMetrics()
    } catch {
      window.alert('Failed to run transfer detection.')
    } finally {
      setDetectingTransfers(false)
    }
  }

  const [acceptingId, setAcceptingId] = useState<number | null>(null)
  const handleAcceptSuggestion = async (txn: Transaction) => {
    setAcceptingId(txn.id)
    try {
      await transactionsApi.acceptSuggestion(txn.id)
      await fetchTransactions()
      await fetchSummaryMetrics()
    } catch {
      window.alert('Failed to accept the suggested account.')
    } finally {
      setAcceptingId(null)
    }
  }

  const handleExportExcel = async () => {
    try {
      const all = await transactionsApi.listAll({ ...filterParams, ordering: '-date' })

      const rows = all.map((t) => ({
        date: t.date ? dayjs(t.date).format('YYYY-MM-DD') : '',
        account_name: t.account_name || '',
        description: t.description || '',
        bai_code: t.bai_code || '',
        debit: t.debit ? Number(t.debit) : 0,
        credit: t.credit ? Number(t.credit) : 0,
        category: t.category_name || '',
        sub_category: t.sub_category_name || '',
        status: STATUS_LABEL[t.status as keyof typeof STATUS_LABEL] || t.status || '',
        matched_via: t.categorization_source ? (SOURCE_LABEL[t.categorization_source as keyof typeof SOURCE_LABEL] || t.categorization_source) : '',
        confirmed: t.confirmed ? 'Confirmed' : 'Pending',
        final: t.is_final ? 'Final' : '',
        reconciled: t.is_reconciled
          ? `Reconciled with ${(t.reconciled_with ?? []).map((r) => `${r.entry_number} (${r.entry_date})`).join(', ')}`
          : 'Not reconciled',
      }))

      const columns = [
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Account Name', key: 'account_name', width: 22 },
        { header: 'Description', key: 'description', width: 35 },
        { header: 'BAI Code', key: 'bai_code', width: 12 },
        { header: 'Debit (₹)', key: 'debit', width: 15 },
        { header: 'Credit (₹)', key: 'credit', width: 15 },
        { header: 'Category', key: 'category', width: 22 },
        { header: 'Sub-Category', key: 'sub_category', width: 22 },
        { header: 'Status', key: 'status', width: 16 },
        { header: 'Matched Via', key: 'matched_via', width: 16 },
        { header: 'Confirmed State', key: 'confirmed', width: 16 },
        { header: 'Final', key: 'final', width: 10 },
        { header: 'Reconciliation', key: 'reconciled', width: 40 },
      ]

      await exportToExcel('Transactions.xlsx', 'Transactions', columns, rows)
    } catch {
      window.alert('Failed to export transactions to Excel.')
    }
  }


  return (
    <div className="flex flex-col gap-6">
      {/* Top Banner Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2.5">
            <h1 className="text-ink">Transactions</h1>
          </div>
          <p className="mt-1.5 max-w-3xl text-[15px] text-muted">All bank transactions and journal entries in one place</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outlined" icon={<Download className="h-4 w-4" />} onClick={handleExportExcel}>
            Export
          </Button>
          {canEdit && (
            <Button variant="outlined" icon={<ArrowRightLeft className="h-4 w-4" />} onClick={handleDetectTransfers} disabled={detectingTransfers}>
              {detectingTransfers ? 'Detecting...' : 'Detect Transfers'}
            </Button>
          )}
          {canEdit && (
            <Button variant="outlined" icon={<BookOpenCheck className="h-4 w-4" />} onClick={handlePostToBooks} disabled={postingToBooks}>
              {postingToBooks ? 'Posting...' : 'Post to books'}
            </Button>
          )}
          {can('bank_statements', 'create') && (
            <Button variant="contained" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/bank-statements')} className="px-4 py-2.5">
              Import Statement
            </Button>
          )}
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <Panel className="p-4">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Select
            id="txn-period"
            label="Period"
            value={period}
            onChange={(e) => handlePeriodChange(e.target.value as Period)}
            className="min-w-[180px]"
          >
            {PERIOD_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>

          {period === 'custom' && (
            <>
              <DatePicker2 id="txn-date-from" label="From" value={dateFrom} onChange={(v) => setFilter('date_from', v)} maxDate={dateTo || undefined} fullWidth={false} className="min-w-[150px]" />
              <DatePicker2 id="txn-date-to" label="To" value={dateTo} onChange={(v) => setFilter('date_to', v)} minDate={dateFrom || undefined} fullWidth={false} className="min-w-[150px]" />
            </>
          )}

          <TextField
            className="min-w-[220px] flex-1"
            value={search}
            onChange={(e) => setFilter('search', e.target.value)}
            placeholder="Search description..."
            startIcon={<Search className="h-4 w-4" />}
            endIcon={search ? (
              <button type="button" onClick={() => setFilter('search', '')} className="pointer-events-auto text-muted hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            ) : undefined}
          />

          <div className="min-w-[200px]">
            <BankAccountSelect label="Account" value={account ? Number(account) : null} onChange={(id) => setFilter('account', id ? String(id) : '')} />
          </div>

          <Select
            id="txn-status"
            label="Status"
            value={statusFilter}
            onChange={(e) => setFilter('status', e.target.value)}
            className="min-w-[170px]"
          >
            <option value="">All Statuses</option>
            <option value="AUTO_ASSIGNED">Auto-assigned</option>
            <option value="MANUAL">Manually assigned</option>
            <option value="NEEDS_REVIEW">Needs review</option>
            <option value="UNCATEGORIZED">Uncategorized</option>
            <option value="TRANSFER">Transfer</option>
          </Select>

          <Select
            id="txn-matched-via"
            label="Matched Via"
            value={categorizationSourceFilter}
            onChange={(e) => setFilter('categorization_source', e.target.value)}
            className="min-w-[180px]"
          >
            <option value="">All Matched Via</option>
            <option value="USER_RULE">User rule</option>
            <option value="HISTORY_EXACT">History match</option>
            <option value="SCORING">Scored</option>
            <option value="TRANSFER">Transfer</option>
            <option value="MANUAL">Manual choice</option>
          </Select>

          <Select
            id="txn-reconciled"
            label="Reconciliation"
            value={reconciledFilter}
            onChange={(e) => setFilter('reconciled', e.target.value)}
            className="min-w-[170px]"
          >
            <option value="">All</option>
            <option value="true">Reconciled</option>
            <option value="false">Not reconciled</option>
          </Select>

          <div className="min-w-[190px]">
            <SearchableSelect
              label="Category"
              placeholder="Search name or type (asset, expense...)"
              value={categoryOption}
              onChange={handleCategoryOptionChange}
              fetchOptions={fetchCategoryOptions}
              size="small"
            />
          </div>

          <div className="min-w-[190px]">
            <SearchableSelect
              label="Sub-Category"
              placeholder={categoryFilter ? 'Search sub-category...' : 'Search all sub-categories...'}
              value={subCategoryOption}
              onChange={handleSubCategoryOptionChange}
              fetchOptions={fetchSubCategoryOptions}
              resetKey={categoryFilter}
              size="small"
            />
          </div>
        </div>

        {/* Checkbox Options & Clear Filters Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 ">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={uncategorizedOnly}
                onChange={(e) => setFilter('uncategorized', e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Uncategorized only
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={duplicatesOnly}
                onChange={(e) => setFilter('duplicate', e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Potential duplicates only
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={confirmedOnly}
                onChange={(e) => setFilter('confirmed', e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Confirmed only
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={finalOnly}
                onChange={(e) => setFilter('final', e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Final only
            </label>
          </div>

          {hasActiveFilters && (
            <Button variant="text" onClick={clearFilters}>Clear Filters</Button>
          )}
        </div>
      </Panel>

      {/* SUMMARY METRICS CARDS */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <StatTile
          label="Transactions"
          value={summaryMetrics.totalTransactions.toLocaleString()}
          icon={<Receipt className="h-4 w-4" />}
          iconBg="bg-primary-soft"
          iconColor="text-primary"
        />
        <StatTile
          label="Reconciled"
          value={`${summaryMetrics.reconciledCount.toLocaleString()} / ${summaryMetrics.totalTransactions.toLocaleString()}`}
          valueClass={summaryMetrics.totalTransactions > 0 && summaryMetrics.reconciledCount === summaryMetrics.totalTransactions
            ? 'text-info-text' : undefined}
          icon={<GitMerge className="h-4 w-4" />}
          iconBg="bg-info-soft"
          iconColor="text-info-text"
        />
        <StatTile
          label="Uncategorized"
          value={summaryMetrics.uncategorizedCount.toLocaleString()}
          valueClass={summaryMetrics.uncategorizedCount > 0 ? 'text-warning-text' : undefined}
          icon={<HelpCircle className="h-4 w-4" />}
          iconBg="bg-warning-soft"
          iconColor="text-warning-text"
        />
        <StatTile
          label="Duplicates"
          value={summaryMetrics.duplicatesCount.toLocaleString()}
          valueClass={summaryMetrics.duplicatesCount > 0 ? 'text-danger-text' : undefined}
          icon={<AlertTriangle className="h-4 w-4" />}
          iconBg="bg-danger-soft"
          iconColor="text-danger-text"
        />
        <StatTile
          label="Debits"
          value={formatK(summaryMetrics.totalDebits)}
          valueClass="text-danger-text"
          icon={<ArrowDown className="h-4 w-4" />}
          iconBg="bg-danger-soft"
          iconColor="text-danger-text"
        />
        <StatTile
          label="Credits"
          value={formatK(summaryMetrics.totalCredits)}
          valueClass="text-success-text"
          icon={<ArrowUp className="h-4 w-4" />}
          iconBg="bg-success-soft"
          iconColor="text-success-text"
        />
        <StatTile
          label="Accounts"
          value={summaryMetrics.accountsCount.toLocaleString()}
          icon={<Landmark className="h-4 w-4" />}
          iconBg="bg-info-soft"
          iconColor="text-info-text"
        />
      </div>

      {error && <Alert>{error}</Alert>}

      {/* Selected Items Action Bar */}
      {canSelect && selectedIds.length > 0 && (
        <Panel className="mb-4 flex items-center justify-between border-violet-500 bg-violet-50 p-4 dark:bg-primary-soft">
          <p className="text-sm font-bold text-ink">{selectedIds.length} transaction(s) selected</p>
          <div className="flex items-center gap-2.5">
            {canEdit && (
              <>
                <Button variant="contained" onClick={handleBulkConfirmSelected}>
                  Confirm Selected
                </Button>
                <Button variant="contained" onClick={() => setBulkCatDialog(true)}>Assign Category</Button>
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

      {/* Transactions Data Table */}
      {loading ? (
        <div className="p-16 text-center">
          <Spinner size={36} className="mx-auto" />
          <p className="mt-3 text-sm text-muted">Loading transactions...</p>
        </div>
      ) : transactions.length === 0 ? (
        <Panel className="border-dashed py-12 text-center">
          <Receipt className="mx-auto mb-3 h-12 w-12 text-slate-300 opacity-60 dark:text-slate-600" />
          <h3 className="mb-2 text-base font-bold text-muted">No transactions match your search filters.</h3>
          {hasActiveFilters && <Button variant="outlined" onClick={clearFilters}>Clear Filters</Button>}
        </Panel>
      ) : (
        <Panel className="overflow-hidden p-0">
          <Pagination
            position="top"
            count={count}
            page={page}
            rowsPerPage={rowsPerPage}
            onPageChange={setPage}
            onRowsPerPageChange={(rpp) => {
              setRowsPerPage(rpp)
              setPage(0)
            }}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  {canSelect && (
                    <th className="w-10 px-4 py-3">
                      <IndeterminateCheckbox
                        checked={selectedIds.length === transactions.length && transactions.length > 0}
                        indeterminate={selectedIds.length > 0 && selectedIds.length < transactions.length}
                        onChange={toggleSelectAll}
                      />
                    </th>
                  )}
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Date</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Description</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Account</th>
                  <th className="px-3 py-3 text-right text-xs font-bold text-ink">Debit</th>
                  <th className="px-3 py-3 text-right text-xs font-bold text-ink">Credit</th>
                  <th className="min-w-[280px] px-3 py-3 text-left text-xs font-bold text-ink">Category</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Status</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-ink">Matched By</th>
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
                        {dayjs(t.date).format('DD MMM')}
                      </td>

                      <td className="max-w-[280px] px-3 py-3 font-semibold text-ink">
                        {t.description || <span className="italic text-muted">(no description)</span>}
                        {t.is_potential_duplicate && (
                          <span title="Same date, narration, debit and credit detected on another transaction.">
                            <AlertTriangle className="ml-1.5 inline h-3.5 w-3.5 align-middle text-amber-500" />
                          </span>
                        )}
                        {t.bai_code && (
                          <span
                            title={t.bai_code_description || 'BAI transaction type code'}
                            className="ml-1.5 inline-flex items-center rounded bg-surface-muted px-1.5 py-0.5 align-middle font-mono text-[0.65rem] font-bold text-slate-500 dark:text-muted"
                          >
                            BAI {t.bai_code}
                          </span>
                        )}
                      </td>

                      <td className="px-3 py-3 font-medium text-muted">{t.account_name}</td>

                      <td className={`px-3 py-3 text-right font-bold ${isDebit ? 'text-danger-text' : 'text-muted'}`}>
                        {formatAmount(t.debit)}
                      </td>

                      <td className={`px-3 py-3 text-right font-bold ${isCredit ? 'text-success-text' : 'text-muted'}`}>
                        {formatAmount(t.credit)}
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
                          onCreateCategory={createCategory}
                          onCreateSubCategory={createSubCategory}
                          disabled={t.is_final || !canEdit}
                        />
                        {t.status === 'NEEDS_REVIEW' && !t.confirmed && t.sub_category_name && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span
                              title={t.scoring_clues || (t.score_breakdown ? formatClueLabels(t.score_breakdown) : undefined)}
                              className="inline-flex items-center gap-1 rounded-md bg-warning-soft px-2 py-1 text-[0.7rem] font-bold text-warning-text dark:bg-warning-soft "
                            >
                              <Sparkles className="h-3 w-3" />
                              Suggested: {t.sub_category_name} ({t.confidence_score}%)
                            </span>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => handleAcceptSuggestion(t)}
                                disabled={acceptingId === t.id}
                                className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[0.7rem] font-bold text-on-primary hover:bg-primary-hover disabled:opacity-50"
                              >
                                <Check className="h-3 w-3" />
                                Accept
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {t.status ? (
                            <Chip
                              tone={STATUS_TONE[t.status as keyof typeof STATUS_TONE] || 'neutral'}
                              title={(t.scoring_clues || t.score_breakdown) ? `Scoring Clues: ${t.scoring_clues || formatClueLabels(t.score_breakdown)}` : undefined}
                            >
                              {STATUS_LABEL[t.status as keyof typeof STATUS_LABEL] || t.status}
                            </Chip>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                          {t.confirmed && !t.is_final && (
                            <span title="Confirmed by a human - Auto-Categorize won't change it" className="inline-flex items-center gap-0.5 text-success-text">
                              <Check className="h-3.5 w-3.5" />
                            </span>
                          )}
                          {t.is_final && (
                            <span
                              title={`Final${t.finalized_at ? ` since ${dayjs(t.finalized_at).format('DD MMM YYYY')}` : ''} - locked until reopened`}
                              className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[0.65rem] font-bold text-white dark:bg-slate-200 dark:text-slate-900"
                            >
                              <Lock className="h-3 w-3" /> Final
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-3 py-3">
                        {t.categorization_source ? (
                          <Chip
                            tone={SOURCE_TONE[t.categorization_source] || 'neutral'}
                            title={(t.scoring_clues || t.score_breakdown) ? `Scoring Clues: ${t.scoring_clues || formatClueLabels(t.score_breakdown)}` : undefined}
                          >
                            {t.categorization_source === 'SCORING'
                              ? (t.scoring_clues || formatClueLabels(t.score_breakdown) || 'Scored')
                              : (SOURCE_LABEL[t.categorization_source] || t.categorization_source)}
                          </Chip>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-3 py-3">
                        <ReconciledWith txn={t} />
                      </td>

                      <td className="relative px-3 py-3 pr-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {canEdit && t.sub_category && !t.confirmed && !t.is_final && (
                            <button
                              type="button"
                              onClick={() => handleConfirmOne(t)}
                              title="Confirm this category choice"
                              className="inline-flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-xs font-bold text-on-primary hover:bg-primary-hover shadow-sm"
                            >
                              <Check className="h-3 w-3" /> Confirm
                            </button>
                          )}
                          {canSelect && (
                            <IconButton
                              className="h-8 w-8"
                              onClick={(e) => handleOpenTxnMenu(e, t.id)}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </IconButton>
                          )}
                        </div>

                        {menuTxnId === t.id && menuPos && (
                          <>
                            <div className="fixed inset-0 z-[60]" onClick={() => { setMenuTxnId(null); setMenuPos(null) }} />
                            <div
                              style={{
                                position: 'fixed',
                                right: `${menuPos.right}px`,
                                ...(menuPos.top !== undefined ? { top: `${menuPos.top}px` } : { bottom: `${menuPos.bottom}px` }),
                              }}
                              className="z-[70] w-56 rounded-xl border border-border bg-surface py-1.5 text-left shadow-xl "
                            >
                              {canEdit && !t.is_final && (
                                <button
                                  type="button"
                                  onClick={() => { setMenuTxnId(null); setMenuPos(null); setSingleCatDialog(t) }}
                                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm font-semibold text-ink hover:bg-surface-muted "
                                >
                                  <Tag className="h-4 w-4 text-primary" />
                                  Assign / Edit Category
                                </button>
                              )}
                              {!canEdit ? null : t.is_final ? (
                                <button
                                  type="button"
                                  onClick={() => { setMenuTxnId(null); setMenuPos(null); handleReopenOne(t) }}
                                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm font-semibold text-ink hover:bg-surface-muted "
                                >
                                  <LockOpen className="h-4 w-4 text-slate-500" />
                                  Reopen (unlock)
                                </button>
                              ) : (t.sub_category && t.status !== 'NEEDS_REVIEW') || t.status === 'TRANSFER' ? (
                                <button
                                  type="button"
                                  onClick={() => { setMenuTxnId(null); setMenuPos(null); handleFinalizeOne(t) }}
                                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm font-semibold text-ink hover:bg-surface-muted "
                                >
                                  <Lock className="h-4 w-4 text-ink" />
                                  Make Final
                                </button>
                              ) : null}
                              {canDelete && !t.is_final && (
                                <>
                                  {canEdit && <hr className="my-1.5 border-border-soft" />}
                                  <button
                                    type="button"
                                    onClick={() => { setMenuTxnId(null); setMenuPos(null); removeTransaction(t) }}
                                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm font-semibold text-danger-text hover:bg-danger-soft dark:hover:bg-danger-soft"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    Delete Entry
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
            count={count}
            page={page}
            rowsPerPage={rowsPerPage}
            onPageChange={setPage}
            onRowsPerPageChange={(rpp) => {
              setRowsPerPage(rpp)
              setPage(0)
            }}
          />
        </Panel>
      )}

      {/* Single Transaction Assign Category Dialog */}
      <Modal
        open={!!singleCatDialog}
        onClose={() => setSingleCatDialog(null)}
        title="Assign / Edit Category"
        widthClassName="max-w-lg"
        footer={
          <>
            <Button variant="outlined" onClick={() => setSingleCatDialog(null)}>Cancel</Button>
            <Button
              variant="contained"
              onClick={async () => {
                if (singleCatDialog) {
                  await changeCategory(singleCatDialog, singleCatId, singleSubCatId)
                  setSingleCatDialog(null)
                }
              }}
            >
              Save Category
            </Button>
          </>
        }
      >
        {singleCatDialog && (
          <div className="rounded-xl border border-border bg-surface-muted p-3 ">
            <p className="text-sm font-bold text-ink">{singleCatDialog.description}</p>
            <p className="mt-1 text-xs text-muted">
              Date: {dayjs(singleCatDialog.date).format('DD MMM YYYY')} • Account: {singleCatDialog.account_name} • Debit: ₹{formatAmount(singleCatDialog.debit)} • Credit: ₹{formatAmount(singleCatDialog.credit)}
            </p>
          </div>
        )}

        <CategorySubCategorySelect
          categoryId={singleCatId}
          subCategoryId={singleSubCatId}
          categoryLabel={singleCatDialog?.category === singleCatId && singleCatDialog?.category_name && singleCatDialog.category_account_type
            ? categoryLabelWithType({ name: singleCatDialog.category_name, account_type: singleCatDialog.category_account_type })
            : null}
          subCategoryLabel={singleCatDialog?.sub_category === singleSubCatId ? singleCatDialog?.sub_category_name : null}
          onChange={(catId, subId) => { setSingleCatId(catId); setSingleSubCatId(subId) }}
          onCreateCategory={createCategory}
          onCreateSubCategory={createSubCategory}
        />
      </Modal>

      {/* Bulk Categorize Dialog */}
      <Modal
        open={bulkCatDialog}
        onClose={() => setBulkCatDialog(false)}
        title={`Bulk Assign Category (${selectedIds.length} items)`}
        footer={
          <>
            <Button variant="outlined" onClick={() => setBulkCatDialog(false)}>Cancel</Button>
            <Button variant="contained" disabled={!bulkCatId || !bulkSubCatId} onClick={handleBulkCategorize}>Apply Changes</Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Select a category and sub-category to apply to all selected transactions.
        </p>
        <CategorySubCategorySelect
          categoryId={bulkCatId}
          subCategoryId={bulkSubCatId}
          onChange={(c, s) => { setBulkCatId(c); setBulkSubCatId(s) }}
          onCreateCategory={createCategory}
          onCreateSubCategory={createSubCategory}
        />
      </Modal>
    </div>
  )
}
