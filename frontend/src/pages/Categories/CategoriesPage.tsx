import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, Pencil, Trash, Trash2, X, FolderTree, FileSpreadsheet, Download, Wallet, ChevronsUpDown,
  ChevronsDownUp,
} from 'lucide-react'
import { categoriesApi, subCategoriesApi, type ChartSummary } from './categoriesapi'
import Pagination, { DEFAULT_ROWS_PER_PAGE } from '../../components/Pagination'
import { ACCOUNT_TYPES, ACCOUNT_TYPE_STYLE } from '../../constants/accountTypes'
import TypeBadge from '../../components/TypeBadge'
import { EmptyState, PageHeader, RowAction, SearchBox } from '../../components/PageParts'
import ImportExcelDialog from '../../components/ImportExcelDialog'
import type { Category, SubCategory, AccountType } from '../../types'
import { exportToExcel } from '../../utils/excelExport'
import { useAuth } from '../../context/AuthContext'
import { Button, Panel, Select, TextField, Modal, Accordion, Alert } from '../../components/tw'
import {
  IMPORT_TEMPLATE_COLUMNS, IMPORT_COLUMN_GUIDE, IMPORT_ROW_GUIDE, IMPORT_TEMPLATE_SAMPLE_ROWS, TYPE_CONFIGS,
  subCategoryCells, subCategoryColumns,
} from './categoriesConfig'
import type { CategoryImportSubCategory, CategoryImportRow } from './categoriesConfig'

export default function CategoriesPage() {
  const { can } = useAuth()
  const canCreate = can('categories', 'create')
  const canEdit = can('categories', 'edit')
  const canDelete = can('categories', 'delete')
  const [categories, setCategories] = useState<Category[]>([])
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')
  const [selectedTypeTab, setSelectedTypeTab] = useState<AccountType | 'ALL'>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE)

  const [expandedCats, setExpandedCats] = useState<Record<number, boolean>>({})

  const [catDialog, setCatDialog] = useState(false)
  const [catEditing, setCatEditing] = useState<Category | null>(null)
  const [catForm, setCatForm] = useState<{ code: string; name: string; account_type: AccountType; description: string }>({
    code: '', name: '', account_type: 'EXPENSE', description: '',
  })

  const [subDialog, setSubDialog] = useState(false)
  const [subEditing, setSubEditing] = useState<SubCategory | null>(null)
  const [subForm, setSubForm] = useState<{ code: string; name: string; description: string; category: number | null }>({
    code: '', name: '', description: '', category: null,
  })

  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importCategoriesSnapshot, setImportCategoriesSnapshot] = useState<Category[]>([])

  const fetchCategories = useCallback(async () => {
    try {
      const data = await categoriesApi.search({
        search: search.trim() || undefined,
        account_type: selectedTypeTab !== 'ALL' ? selectedTypeTab : undefined,
        page: page + 1,
        limit: rowsPerPage,
      })
      setCategories(data.results || [])
      setCount(data.count || 0)
      setExpandedCats({})  // every category starts expanded again after a reload

    } catch {
      setError('Failed to load chart of accounts categories.')
    }
  }, [search, selectedTypeTab, page, rowsPerPage])

  useEffect(() => {
    const handle = setTimeout(fetchCategories, 300)
    return () => clearTimeout(handle)
  }, [fetchCategories])

  // Totals for the cards and the sidebar: the whole Chart of Accounts, whatever the filters show.
  const [summary, setSummary] = useState<ChartSummary | null>(null)
  const fetchSummary = useCallback(() => categoriesApi.summary().then(setSummary).catch(() => {
    // The totals are only informational - the list itself still works.
  }), [])

  useEffect(() => { fetchSummary() }, [fetchSummary])

  /** After a change: the list as filtered, and the fixed totals. */
  const [clearing, setClearing] = useState(false)
  const [clearMessage, setClearMessage] = useState('')
  const handleClearAll = async () => {
    if (!window.confirm(
      'Delete ALL Chart of Accounts accounts, with their sub-categories and keyword rules?\n\n'
      + 'Accounts used by transactions, journal entries or bank accounts are kept. This cannot be undone.',
    )) return
    setClearing(true)
    setError('')
    setClearMessage('')
    try {
      const result = await categoriesApi.clearAll()
      setClearMessage(result.message)
      setPage(0)
      await Promise.all([fetchCategories(), fetchSummary()])
    } catch {
      setError('Failed to delete the chart of accounts.')
    } finally {
      setClearing(false)
    }
  }

  const reload = useCallback(async () => {
    await Promise.all([fetchCategories(), fetchSummary()])
  }, [fetchCategories, fetchSummary])

  const isAllExpanded = categories.length > 0 && categories.every((cat) => expandedCats[cat.id] !== false)

  const toggleExpandAll = () => {
    const next: Record<number, boolean> = {}
    const targetState = !isAllExpanded
    categories.forEach((cat) => {
      next[cat.id] = targetState
    })
    setExpandedCats(next)
  }

  const openCreateCategory = () => {
    setCatEditing(null)
    setCatForm({
      code: '',
      name: '',
      account_type: selectedTypeTab !== 'ALL' ? selectedTypeTab : 'EXPENSE',
      description: '',
    })
    setError('')
    setCatDialog(true)
  }

  const openEditCategory = (cat: Category) => {
    setCatEditing(cat)
    setCatForm({ code: cat.code || '', name: cat.name, account_type: cat.account_type, description: cat.description || '' })
    setError('')
    setCatDialog(true)
  }

  const saveCategory = async () => {
    setError('')
    try {
      if (catEditing) await categoriesApi.update(catEditing.id, catForm)
      else await categoriesApi.create(catForm)
      setCatDialog(false)
      await reload()
    } catch (err: any) {
      const data = err.response?.data
      setError(data?.code?.[0] || data?.name?.[0] || data?.account_type?.[0] || data?.non_field_errors?.[0] || 'Failed to save category.')
    }
  }

  const deleteCategory = async (cat: Category) => {
    if (!window.confirm(`Delete category "${cat.name}" and all its sub-categories?`)) return
    try {
      await categoriesApi.remove(cat.id)
      await reload()
    } catch {
      window.alert('Could not delete: this category is in use by statement transactions.')
    }
  }

  const openCreateSub = (category: Category) => {
    setSubEditing(null)
    setSubForm({ code: '', name: '', description: '', category: category.id })
    setError('')
    setSubDialog(true)
  }

  const openEditSub = (sub: SubCategory) => {
    setSubEditing(sub)
    setSubForm({ code: sub.code || '', name: sub.name, description: sub.description || '', category: sub.category })
    setError('')
    setSubDialog(true)
  }

  const saveSub = async () => {
    setError('')
    try {
      if (subEditing) await subCategoriesApi.update(subEditing.id, subForm)
      else await subCategoriesApi.create(subForm)
      setSubDialog(false)
      await reload()
    } catch (err: any) {
      const data = err.response?.data
      setError(data?.code?.[0] || data?.name?.[0] || 'Failed to save sub-category (name may already exist under this category).')
    }
  }

  const deleteSub = async (sub: SubCategory) => {
    if (!window.confirm(`Delete sub-category "${sub.name}"?`)) return
    try {
      await subCategoriesApi.remove(sub.id)
      await reload()
    } catch {
      window.alert('Could not delete: this sub-category is in use by transactions.')
    }
  }

  const handleTabChange = (val: AccountType | 'ALL') => {
    setSelectedTypeTab(val)
    setPage(0)
  }

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setPage(0)
  }

  const filtersActive = !!(search || selectedTypeTab !== 'ALL' || statusFilter !== 'ALL')

  const clearFilters = () => {
    setSearch('')
    setSelectedTypeTab('ALL')
    setStatusFilter('ALL')
    setPage(0)
  }

  const filteredCategories = categories.filter((cat) => {
    if (statusFilter === 'ACTIVE') return cat.is_active !== false
    if (statusFilter === 'INACTIVE') return cat.is_active === false
    return true
  })

  // Fixed per-type totals (not the filtered page).
  const countsByType: Record<string, number> = Object.fromEntries(
    Object.entries(summary?.by_type ?? {}).map(([type, n]) => [type, n.categories]),
  )
  const subCountsByType: Record<string, number> = Object.fromEntries(
    Object.entries(summary?.by_type ?? {}).map(([type, n]) => [type, n.sub_categories]),
  )


  const openImportDialog = useCallback(async () => {
    try {
      const all = await categoriesApi.list()
      setImportCategoriesSnapshot(all)
    } catch {
      setImportCategoriesSnapshot([])
    }
    setImportDialogOpen(true)
  }, [])

  // key helpers: category keys are scoped by account type (matches the backend's unique constraint);
  // sub-category keys are scoped by their parent category, since sub-category names aren't globally unique.
  const categoryKey = (accountType: AccountType, name: string) => `${accountType}||${name.trim().toLowerCase()}`
  const subCategoryKey = (accountType: AccountType, categoryName: string, subName: string) =>
    `${categoryKey(accountType, categoryName)}||${subName.trim().toLowerCase()}`

  const existingCategoryKeys = useMemo(
    () => new Set(importCategoriesSnapshot.map((c) => categoryKey(c.account_type, c.name))),
    [importCategoriesSnapshot]
  )
  const existingSubCategoryKeys = useMemo(() => {
    const set = new Set<string>()
    importCategoriesSnapshot.forEach((c) => {
      (c.subcategories || []).forEach((s) => set.add(subCategoryKey(c.account_type, c.name, s.name)))
    })
    return set
  }, [importCategoriesSnapshot])

  const parseImportRow = useCallback((raw: Record<string, string>, rowNumber: number) => {
    const accountTypeRaw = (raw['account type'] || raw['account_type'] || '').trim()
    const name = (raw['category'] || raw['category name'] || raw['name'] || '').trim()
    const code = (raw['category code'] || raw['code'] || '').trim()
    const description = (raw['category description'] || raw['description'] || '').trim()

    const errors: string[] = []
    let accountType: AccountType | null = null
    if (!accountTypeRaw) {
      errors.push('Account Type is required.')
    } else {
      const match = ACCOUNT_TYPES.find(
        (t) => t.value.toLowerCase() === accountTypeRaw.toLowerCase() || t.label.toLowerCase() === accountTypeRaw.toLowerCase()
      )
      if (!match) errors.push(`Account Type "${accountTypeRaw}" is not one of Asset, Liability, Equity, Income, Expense.`)
      else accountType = match.value
    }
    if (!name) errors.push('Category name is required.')

    const subCategories: CategoryImportSubCategory[] = []

    // Sub-Category 1..N: every numbered sub-category column in the sheet ("Sub-Category 4", "Sub-Category 4 Name", ...).
    const subNumbers = Object.keys(raw)
      .map((key) => key.match(/^sub[-_ ]?category[-_ ](\d+)/)?.[1])
      .filter((n): n is string => !!n)
      .map(Number)
    const subCount = Math.max(1, ...subNumbers)
    for (let i = 1; i <= subCount; i++) {
      const col = (suffix: string) =>
        (raw[`sub-category ${i}${suffix}`] || raw[`sub_category_${i}${suffix.replace(' ', '_')}`] || raw[`sub category ${i}${suffix}`] || '').trim()
      // Unnumbered "Sub-Category" columns are still accepted as sub-category 1.
      const legacy = (key: string) => (i === 1 ? (raw[`sub-category${key}`] || raw[`sub_category${key.replace(' ', '_')}`] || '').trim() : '')
      const subName = col('') || col(' name') || legacy('') || (i === 1 ? (raw['subcategory'] || '').trim() : '')
      if (!subName) continue
      const subCode = col(' code') || legacy(' code')
      const subDesc = col(' description') || legacy(' description')
      subCategories.push({ name: subName, code: subCode || undefined, description: subDesc || undefined })
    }

    const subNamesStr = subCategories.map((s) => s.name).join(', ')
    const label = subNamesStr ? `${name || `Row ${rowNumber}`} / [${subNamesStr}]` : (name || `Row ${rowNumber}`)
    if (errors.length > 0 || !accountType) return { data: null, label, errors }

    return {
      data: {
        category_name: name,
        account_type: accountType,
        category_code: code,
        category_description: description,
        sub_categories: subCategories,
      } as CategoryImportRow,
      label,
      errors: [],
    }
  }, [])

  const checkImportDuplicate = useCallback((data: CategoryImportRow, acceptedSoFar: CategoryImportRow[]) => {
    const catKey = categoryKey(data.account_type, data.category_name)

    if (data.sub_categories.length === 0) {
      if (existingCategoryKeys.has(catKey)) return 'A category with this name already exists for this account type.'
      if (acceptedSoFar.some((d) => categoryKey(d.account_type, d.category_name) === catKey)) {
        return 'This category was already added earlier in this file.'
      }
      return null
    }

    let newSubCount = 0
    for (const sub of data.sub_categories) {
      const subKey = subCategoryKey(data.account_type, data.category_name, sub.name)
      const existsInDb = existingSubCategoryKeys.has(subKey)
      const existsInFile = acceptedSoFar.some((d) =>
        d.sub_categories.some((s) => subCategoryKey(d.account_type, d.category_name, s.name) === subKey)
      )
      if (!existsInDb && !existsInFile) {
        newSubCount++
      }
    }

    if (newSubCount === 0) {
      return 'All sub-categories in this row already exist or were added earlier in this file.'
    }

    return null
  }, [existingCategoryKeys, existingSubCategoryKeys])

  // One request for the whole file - the backend reuses existing categories/sub-categories
  // and creates the rest in a single transaction.
  const submitImportRows = useCallback(async (accepted: CategoryImportRow[]) => {
    await categoriesApi.bulkImport(accepted.map((row) => ({
      name: row.category_name,
      account_type: row.account_type,
      code: row.category_code || undefined,
      description: row.category_description || undefined,
      sub_categories: row.sub_categories,
    })))
  }, [])

  const handleExportExcel = async () => {
    try {
      const allCategories = await categoriesApi.list()
      // One row per category, with each sub-category in its own Code / Name / Description columns.
      const rows: Record<string, string>[] = allCategories.map((cat) => ({
        account_type: cat.account_type,
        code: cat.code || '',
        name: cat.name,
        description: cat.description || '',
        ...subCategoryCells(cat.subcategories || []),
        status: cat.is_active !== false ? 'Active' : 'Inactive',
      }))
      const maxSubs = Math.max(1, ...allCategories.map((cat) => cat.subcategories?.length || 0))
      const columns = [
        ...IMPORT_TEMPLATE_COLUMNS.slice(0, 4),
        ...subCategoryColumns(maxSubs),
        { header: 'Status', key: 'status', width: 12 },
      ]

      await exportToExcel('Chart_of_Accounts.xlsx', 'Chart of Accounts', columns, rows)
    } catch {
      window.alert('Failed to export Chart of Accounts to Excel.')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 1. HEADER & ACTIONS */}
      <PageHeader
        title="Chart of accounts"
        description="Double-entry accounts in five types: Assets (1000s), Liabilities (2000s), Equity (3000s), Income (4000s) and Expenses (5000s)."
        actions={
          <>
            {canDelete && (
              <Button variant="outlined" color="error" icon={<Trash className="h-4 w-4" />} onClick={handleClearAll} disabled={clearing || !summary?.categories}>
                {clearing ? 'Deleting...' : 'Delete all'}
              </Button>
            )}
            {canCreate && (
              <Button variant="outlined" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={openImportDialog}>
                Import Excel
              </Button>
            )}
            <Button variant="outlined" icon={<Download className="h-4 w-4" />} onClick={handleExportExcel}>
              Export
            </Button>
            {canCreate && (
              <Button variant="contained" icon={<Plus className="h-4 w-4" />} onClick={openCreateCategory}>
                Add category
              </Button>
            )}
          </>
        }
      />

      {/* 2. FIVE ACCOUNT-TYPE TILES */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {ACCOUNT_TYPES.map((t) => {
          const config = TYPE_CONFIGS[t.value]
          const isSelected = selectedTypeTab === t.value
          const typeCatCount = countsByType[t.value] || 0

          return (
            <button
              key={t.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => handleTabChange(isSelected ? 'ALL' : t.value)}
              className={`flex flex-col rounded-[18px] border-[1.5px] bg-surface p-5 text-left transition-colors ${
                isSelected ? config.border : 'border-border hover:border-primary-border'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-muted">{t.pluralLabel}</span>
                <span className={`flex h-[34px] w-[34px] items-center justify-center rounded-[10px] ${config.iconBg} ${config.text} [&_svg]:h-[18px] [&_svg]:w-[18px]`}>{config.icon}</span>
              </div>
              <p className="num mt-3 text-[26px] font-semibold leading-tight text-ink">{typeCatCount}</p>
              <p className="mt-1 text-xs text-muted">
                categor{typeCatCount === 1 ? 'y' : 'ies'} · <span className="num">{subCountsByType[t.value] || 0}</span> sub
              </p>
              <p className={`num mt-2 text-[11px] font-semibold ${config.text}`}>{config.codeRange}</p>
            </button>
          )
        })}
      </div>

      {error && <Alert>{error}</Alert>}
      {clearMessage && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-primary-border bg-primary-soft px-4 py-3 text-sm font-medium text-primary-hover dark:text-primary">
          <span>{clearMessage}</span>
          <button type="button" onClick={() => setClearMessage('')} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 3. SEARCH & FILTERS */}
      <div className="flex flex-wrap items-end gap-3">
        <SearchBox
          className="min-w-[240px] flex-1"
          value={search}
          onChange={handleSearchChange}
          placeholder="Search categories or sub-categories by name or code..."
        />
        <Select
          id="cat-type-filter"
          value={selectedTypeTab}
          onChange={(e) => handleTabChange(e.target.value as AccountType | 'ALL')}
          className="min-w-[200px]"
        >
          <option value="ALL">All account types</option>
          {ACCOUNT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.pluralLabel}</option>
          ))}
        </Select>
        <Select
          id="cat-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="min-w-[170px]"
        >
          <option value="ALL">All statuses</option>
          <option value="ACTIVE">Active only</option>
          <option value="INACTIVE">Inactive only</option>
        </Select>
        {filtersActive && (
          <Button variant="text" color="error" onClick={clearFilters}>Reset filters</Button>
        )}
      </div>

      {/* 4. TYPE FILTER LIST + HIERARCHY */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]">
        <Panel className="h-fit p-4 md:sticky md:top-[129px]">
          <p className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.08em] text-muted">Account types</p>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => handleTabChange('ALL')}
              className={`flex items-center justify-between rounded-[10px] px-3 py-2.5 text-left transition-colors ${
                selectedTypeTab === 'ALL' ? 'bg-sidebar text-white' : 'text-ink hover:bg-surface-muted'
              }`}
            >
              <span className="text-sm font-semibold">All categories</span>
              <span className={`num rounded-[20px] px-2 py-0.5 text-xs font-semibold ${selectedTypeTab === 'ALL' ? 'bg-white/15 text-white' : 'bg-surface-muted text-muted'}`}>{summary?.categories ?? count}</span>
            </button>

            {ACCOUNT_TYPES.map((t) => {
              const isSelected = selectedTypeTab === t.value
              const catTypeCount = countsByType[t.value] || 0
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => handleTabChange(t.value)}
                  className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left transition-colors ${
                    isSelected ? 'bg-primary-soft' : 'hover:bg-surface-muted'
                  }`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${ACCOUNT_TYPE_STYLE[t.value].dot}`} />
                  <span className={`flex-1 text-sm ${isSelected ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>{t.pluralLabel}</span>
                  <span className="num text-xs font-semibold text-muted">{catTypeCount}</span>
                </button>
              )
            })}
          </div>
        </Panel>

        <div className="min-w-0">
          {filteredCategories.length > 0 ? (
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted">
                  Account hierarchy · <span className="num">{filteredCategories.length}</span> categories
                </p>
                <Button
                  variant="outlined"
                  size="sm"
                  icon={isAllExpanded ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
                  onClick={toggleExpandAll}
                >
                  {isAllExpanded ? 'Collapse all' : 'Expand all'}
                </Button>
              </div>

              {count > 0 && (
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
                  className="mb-3 rounded-[18px] border border-border bg-surface"
                />
              )}

              {filteredCategories.map((cat) => {
                const config = TYPE_CONFIGS[cat.account_type] || TYPE_CONFIGS['EXPENSE']
                const subCount = cat.subcategories?.length || 0
                const isExpanded = expandedCats[cat.id] !== false

                return (
                  <Accordion
                    key={cat.id}
                    defaultExpanded={isExpanded}
                    header={
                      <div className="flex flex-wrap items-center gap-3">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${config.iconBg} ${config.text}`}>
                          {config.icon}
                        </span>
                        <div className="min-w-[150px]">
                          <p className="font-display text-[15px] font-semibold leading-tight text-ink">
                            {cat.code && <span className="num mr-2 text-[13px] text-muted">{cat.code}</span>}
                            {cat.name}
                          </p>
                          {cat.description && <p className="mt-0.5 text-xs text-muted">{cat.description}</p>}
                        </div>
                        <TypeBadge type={cat.account_type} />
                        <span className="rounded-[20px] bg-surface-muted px-2.5 py-0.5 text-xs font-bold text-muted">
                          <span className="num">{subCount}</span> sub-categor{subCount === 1 ? 'y' : 'ies'}
                        </span>
                        {!cat.is_active && <span className="rounded-[20px] bg-surface-muted px-2.5 py-0.5 text-xs font-bold text-muted">Inactive</span>}
                        <div className="flex-1" />
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {canCreate && (
                            <Button variant="contained" color="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => openCreateSub(cat)}>
                              Add sub
                            </Button>
                          )}
                          {canEdit && <RowAction onClick={() => openEditCategory(cat)} title="Edit category"><Pencil /></RowAction>}
                          {canDelete && <RowAction danger onClick={() => deleteCategory(cat)} title="Delete category"><Trash2 /></RowAction>}
                        </div>
                      </div>
                    }
                  >
                    <div className="flex flex-col">
                      {(cat.subcategories || []).map((sub) => (
                        <div
                          key={sub.id}
                          className="flex items-center gap-3 border-b border-border-soft py-2.5 pl-12 last:border-0"
                        >
                          <span className="num w-12 shrink-0 text-[13px] text-muted">{sub.code || '—'}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-ink">{sub.name}</p>
                            {sub.description && <p className="truncate text-xs text-muted">{sub.description}</p>}
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            {canEdit && <RowAction onClick={() => openEditSub(sub)} title="Edit sub-category"><Pencil /></RowAction>}
                            {canDelete && <RowAction danger onClick={() => deleteSub(sub)} title="Delete sub-category"><Trash2 /></RowAction>}
                          </div>
                        </div>
                      ))}

                      {(!cat.subcategories || cat.subcategories.length === 0) && (
                        <div className="rounded-2xl border border-dashed border-input p-4 text-center">
                          <p className="mb-2 text-sm text-muted">No sub-categories under {cat.name} yet.</p>
                          {canCreate && (
                            <Button variant="outlined" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => openCreateSub(cat)}>
                              Add sub-category
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </Accordion>
                )
              })}

              {count > 0 && (
                <Pagination
                  count={count}
                  page={page}
                  rowsPerPage={rowsPerPage}
                  onPageChange={setPage}
                  onRowsPerPageChange={(rpp) => {
                    setRowsPerPage(rpp)
                    setPage(0)
                  }}
                  className="mt-4 rounded-[18px] border border-border bg-surface"
                />
              )}
            </div>
          ) : (
            <Panel className="p-0">
              <EmptyState
                icon={<FolderTree />}
                title={filtersActive ? 'No categories match your filters.' : 'No chart of accounts categories yet.'}
                text="Categories group your sub-categories under the five account types."
                action={filtersActive ? (
                  <Button variant="outlined" onClick={clearFilters}>Clear filters</Button>
                ) : canCreate && (
                  <Button variant="contained" icon={<Plus className="h-4 w-4" />} onClick={openCreateCategory}>
                    Add your first category
                  </Button>
                )}
              />
            </Panel>
          )}
        </div>
      </div>
      {/* Category Modal */}
      <Modal
        open={catDialog}
        onClose={() => setCatDialog(false)}
        icon={<Wallet />}
        title={catEditing ? 'Edit category' : 'Add category'}
        subtitle="A group of accounts under one account type."
        footer={
          <>
            <Button variant="outlined" onClick={() => setCatDialog(false)}>Cancel</Button>
            <Button variant="contained" onClick={saveCategory}>Save Category</Button>
          </>
        }
      >
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Category Code (optional)"
          placeholder={`e.g. ${TYPE_CONFIGS[catForm.account_type]?.codeRange.split('–')[0] || '1000'}`}
          value={catForm.code}
          autoFocus
          onChange={(e) => setCatForm({ ...catForm, code: e.target.value })}
        />
        <TextField
          label="Category Name"
          placeholder="e.g. Current Assets, Operating Expenses"
          value={catForm.name}
          onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
        />
        <Select
          id="cat-account-type"
          label="Account Type"
          value={catForm.account_type}
          onChange={(e) => setCatForm({ ...catForm, account_type: e.target.value as AccountType })}
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label} ({TYPE_CONFIGS[t.value]?.codeRange || ''})</option>
          ))}
        </Select>
        <TextField
          label="Description (optional)"
          value={catForm.description}
          multiline
          rows={2}
          onChange={(e) => setCatForm({ ...catForm, description: e.target.value })}
        />
      </Modal>

      {/* Subcategory Modal */}
      <Modal
        open={subDialog}
        onClose={() => setSubDialog(false)}
        icon={<FolderTree />}
        title={subEditing ? 'Edit sub-category' : 'Add sub-category'}
        subtitle="The account transactions are categorized into."
        footer={
          <>
            <Button variant="outlined" onClick={() => setSubDialog(false)}>Cancel</Button>
            <Button variant="contained" onClick={saveSub}>Save Sub-Category</Button>
          </>
        }
      >
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Sub-Category Code (optional)"
          placeholder="e.g. 1010"
          value={subForm.code}
          autoFocus
          onChange={(e) => setSubForm({ ...subForm, code: e.target.value })}
        />
        <TextField
          label="Sub-Category Name"
          placeholder="e.g. Cash, Office Supplies"
          value={subForm.name}
          onChange={(e) => setSubForm({ ...subForm, name: e.target.value })}
        />
        <TextField
          label="Description (optional)"
          value={subForm.description}
          multiline
          rows={2}
          onChange={(e) => setSubForm({ ...subForm, description: e.target.value })}
        />
      </Modal>

      {/* Import Excel Dialog */}
      <ImportExcelDialog<CategoryImportRow>
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        title="Import Categories from Excel"
        instructions="One row per category, with all its sub-categories in the same row. See the column and row guide below."
        itemLabel="category"
        templateFilename="categories_import_template.xlsx"
        templateColumns={IMPORT_TEMPLATE_COLUMNS}
        templateSampleRows={IMPORT_TEMPLATE_SAMPLE_ROWS}
        columnGuide={IMPORT_COLUMN_GUIDE}
        rowGuide={IMPORT_ROW_GUIDE}
        parseRow={parseImportRow}
        checkDuplicate={checkImportDuplicate}
        onSubmit={submitImportRows}
        onImported={reload}
      />
    </div>
  )
}
