import { useCallback, useEffect, useState, useMemo } from 'react'
import {
  Plus, Pencil, Trash2, ChevronDown, ChevronRight, Tag, Sparkles, FileSpreadsheet, Download,
  Copy, ChevronsUpDown, ChevronsDownUp, Check, Tags, Zap,
  Settings2, Save, Trash,
} from 'lucide-react'
import { categoryKeywordsApi, categorizationSettingsApi } from './categorykeywordsapi'
import { usePageSummary } from '../../hooks/usePageSummary'
import Pagination, { DEFAULT_ROWS_PER_PAGE } from '../../components/Pagination'
import SearchableSelect from '../../components/SearchableSelect'
import type { SearchableOption } from '../../components/SearchableSelect'
import ImportExcelDialog from '../../components/ImportExcelDialog'
import { ACCOUNT_TYPES, ACCOUNT_TYPE_STYLE, categoryLabelWithType } from '../../constants/accountTypes'
import TypeBadge from '../../components/TypeBadge'
import { EmptyState, IconTile, PageHeader, RowAction, SearchBox } from '../../components/PageParts'
import {
  fetchCategoryOptions, parentCategoryOf, plainSubCategoryOption, subCategoryOptionsFetcher,
} from '../../utils/categoryLookup'
import type { CategoryKeyword, CategorizationSettings, Category, SubCategory, AccountType } from '../../types'
import { exportToExcel } from '../../utils/excelExport'
import { useAuth } from '../../context/AuthContext'
import { Button, Panel, TextField, Modal, Switch, Alert } from '../../components/tw'
import { parseYesNo, IMPORT_TEMPLATE_COLUMNS, IMPORT_COLUMN_GUIDE, IMPORT_ROW_GUIDE, IMPORT_TEMPLATE_SAMPLE_ROWS } from './categoryKeywordsConfig'
import type { KeywordImportRow } from './categoryKeywordsConfig'

export default function CategoryKeywordsPage() {
  const { can } = useAuth()
  const canCreate = can('category_keywords', 'create')
  const canEdit = can('category_keywords', 'edit')
  const canDelete = can('category_keywords', 'delete')
  const [keywords, setKeywords] = useState<CategoryKeyword[]>([])
  const [count, setCount] = useState(0)
  // Card totals cover every rule, not just the filtered page.
  const [summary, refreshSummary] = usePageSummary(categoryKeywordsApi.summary)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [coaSearch, setCoaSearch] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  const [categories, setCategories] = useState<Category[]>([])
  const [selectedSubCatId, setSelectedSubCatId] = useState<number | null>(null)
  const [selectedSubCatObj, setSelectedSubCatObj] = useState<{ id: number; name: string; categoryName: string; accountType: AccountType } | null>(null)

  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<CategoryKeyword | null>(null)
  const [form, setForm] = useState<{ keyword: string; is_active: boolean; auto_assign: boolean }>({ keyword: '', is_active: true, auto_assign: false })
  const [categoryOption, setCategoryOption] = useState<SearchableOption | null>(null)
  const [subCategoryOption, setSubCategoryOption] = useState<SearchableOption | null>(null)

  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [existingKeywords, setExistingKeywords] = useState<Set<string>>(new Set())

  const [settings, setSettings] = useState<CategorizationSettings | null>(null)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)

  useEffect(() => {
    categorizationSettingsApi.get().then(setSettings)
      .catch((e) => console.error('Failed to load categorization settings', e))
  }, [])

  const saveSettings = async () => {
    if (!settings) return
    setSettingsSaving(true)
    setSettingsSaved(false)
    try {
      setSettings(await categorizationSettingsApi.update(settings))
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 2000)
    } catch {
      window.alert('Could not save categorization settings.')
    } finally {
      setSettingsSaving(false)
    }
  }

  const loadCoaData = useCallback(() => categoryKeywordsApi.coaTree()
    .then((tree) => setCategories((tree as any) || []))
    .catch((e) => console.error('Failed to load COA tree', e)), [])

  useEffect(() => {
    loadCoaData()
  }, [loadCoaData])

  const subCatKwCounts = useMemo(() => {
    const counts: Record<number, number> = {}
    categories.forEach((cat) => {
      cat.subcategories?.forEach((sub: any) => {
        counts[sub.id] = sub.keyword_count || 0
      })
    })
    return counts
  }, [categories])

  const fetchKeywords = useCallback(async () => {
    try {
      const data = await categoryKeywordsApi.search({
        search: search.trim() || undefined,
        sub_category: selectedSubCatId || undefined,
        page: page + 1,
        limit: rowsPerPage,
      })
      setKeywords(data.results || [])
      setCount(data.count || 0)
    } catch {
      setError('Failed to load categorization rule keywords.')
    }
  }, [search, selectedSubCatId, page, rowsPerPage])

  useEffect(() => {
    const handle = setTimeout(fetchKeywords, 300)
    return () => clearTimeout(handle)
  }, [fetchKeywords])

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setPage(0)
  }

  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set(['EXPENSE', 'INCOME', 'ASSET']))
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set())

  const isAllTreeExpanded = useMemo(() => {
    return ACCOUNT_TYPES.every((t) => expandedTypes.has(t.value))
  }, [expandedTypes])

  const toggleAllTree = () => {
    if (isAllTreeExpanded) {
      setExpandedTypes(new Set())
      setExpandedCategories(new Set())
    } else {
      setExpandedTypes(new Set(ACCOUNT_TYPES.map((t) => t.value)))
      setExpandedCategories(new Set(categories.map((c) => c.id)))
    }
  }

  const toggleType = (typeVal: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(typeVal)) next.delete(typeVal)
      else next.add(typeVal)
      return next
    })
  }

  const toggleCategory = (catId: number) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      return next
    })
  }

  const handleSelectSubCategory = (
    subId: number | null,
    subName?: string,
    categoryName?: string,
    accountType?: AccountType,
    categoryId?: number
  ) => {
    setSelectedSubCatId(subId)
    if (subId && subName && categoryName && accountType) {
      setSelectedSubCatObj({ id: subId, name: subName, categoryName, accountType })
      if (accountType) {
        setExpandedTypes((prev) => new Set(prev).add(accountType))
      }
      if (categoryId) {
        setExpandedCategories((prev) => new Set(prev).add(categoryId))
      }
    } else {
      setSelectedSubCatObj(null)
    }
    setPage(0)
  }

  const openCreate = (prefillSubCatId?: number) => {
    setEditing(null)
    setForm({ keyword: '', is_active: true, auto_assign: false })

    if (prefillSubCatId && selectedSubCatObj) {
      const cat = categories.find((c) => c.subcategories?.some((s) => s.id === prefillSubCatId))
      if (cat) {
        setCategoryOption({ id: cat.id, label: categoryLabelWithType(cat) })
        setSubCategoryOption({ id: prefillSubCatId, label: selectedSubCatObj.name })
      } else {
        setCategoryOption(null)
        setSubCategoryOption(null)
      }
    } else {
      setCategoryOption(null)
      setSubCategoryOption(null)
    }
    setError('')
    setDialog(true)
  }

  const openEdit = (kw: CategoryKeyword) => {
    setEditing(kw)
    setForm({ keyword: kw.keyword, is_active: kw.is_active ?? true, auto_assign: kw.auto_assign ?? false })
    const category = categories.find((c) => c.id === kw.category)
    setCategoryOption(
      kw.category ? { id: kw.category, label: category ? categoryLabelWithType(category) : (kw.category_name || String(kw.category)) } : null
    )
    setSubCategoryOption(kw.sub_category ? { id: kw.sub_category, label: kw.sub_category_name || String(kw.sub_category) } : null)
    setError('')
    setDialog(true)
  }

  const handleCategoryChange = (option: SearchableOption | null) => {
    setCategoryOption(option)
    setSubCategoryOption(null)
  }

  const save = async () => {
    if (!form.keyword.trim()) {
      setError('Please enter a keyword pattern.')
      return
    }
    if (!categoryOption) {
      setError('Please select a category.')
      return
    }
    if (!subCategoryOption) {
      setError('Please select a sub-category.')
      return
    }
    setError('')
    const payload = { ...form, sub_category: subCategoryOption.id }
    try {
      if (editing) await categoryKeywordsApi.update(editing.id, payload)
      else await categoryKeywordsApi.create(payload)
      setDialog(false)
      await fetchKeywords()
      refreshSummary()
      await loadCoaData()
    } catch (err: any) {
      const data = err.response?.data
      setError(data?.keyword?.[0] || data?.sub_category?.[0] || 'Failed to save keyword (it may already exist).')
    }
  }

  const remove = async (kw: CategoryKeyword) => {
    if (!window.confirm(`Delete keyword "${kw.keyword}"?`)) return
    await categoryKeywordsApi.remove(kw.id)
    await fetchKeywords()
    refreshSummary()
    await loadCoaData()
  }

  const copyKeyword = (kw: CategoryKeyword) => {
    navigator.clipboard.writeText(kw.keyword)
    setCopiedId(kw.id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  const subCategoryFetchOptions = useMemo(() => subCategoryOptionsFetcher(categoryOption?.id), [categoryOption?.id])

  // Picking a sub-category with no category chosen fills its category in too.
  const handleSubCategoryChange = (option: SearchableOption | null) => {
    setSubCategoryOption(option ? plainSubCategoryOption(option) : null)
    const parent = parentCategoryOf(option)
    if (parent && !categoryOption) setCategoryOption(parent)
  }

  // Group categories by Account Type for the left COA tree
  const coaTree = useMemo(() => {
    const term = coaSearch.trim().toLowerCase()
    const groups: Record<AccountType, { category: Category; matchingSubs: SubCategory[] }[]> = {
      ASSET: [],
      LIABILITY: [],
      EQUITY: [],
      INCOME: [],
      EXPENSE: [],
    }

    categories.forEach((cat) => {
      const subs = cat.subcategories || []
      const catMatches = term ? cat.name.toLowerCase().includes(term) : true
      const matchingSubs = term ? subs.filter((s) => s.name.toLowerCase().includes(term)) : subs

      if (catMatches || matchingSubs.length > 0) {
        if (groups[cat.account_type]) {
          groups[cat.account_type].push({
            category: cat,
            matchingSubs: catMatches ? subs : matchingSubs,
          })
        }
      }
    })

    return groups
  }, [categories, coaSearch])

  // Get active keywords for selected sub-category
  const currentSubCatKeywords = useMemo(() => {
    if (!selectedSubCatId) return keywords
    return keywords.filter((k) => k.sub_category === selectedSubCatId)
  }, [keywords, selectedSubCatId])

  const activeRulesCount = summary?.active ?? 0
  const expenseRulesCount = summary?.expense ?? 0
  const incomeRulesCount = summary?.income ?? 0


  const openImportDialog = useCallback(async () => {
    try {
      const all = await categoryKeywordsApi.list()
      setExistingKeywords(new Set(all.map((k) => k.keyword.trim().toLowerCase())))
    } catch {
      setExistingKeywords(new Set())
    }
    setImportDialogOpen(true)
  }, [])

  const parseImportRow = useCallback((raw: Record<string, string>, rowNumber: number) => {
    const keyword = (
      raw['keyword / pattern'] ||
      raw['keyword'] ||
      raw['pattern'] ||
      raw['keyword pattern'] ||
      raw['keyword_pattern'] ||
      ''
    ).trim()
    const categoryName = (raw['category'] || raw['category_name'] || '').trim()
    const subCategoryName = (
      raw['sub-category'] ||
      raw['sub_category'] ||
      raw['subcategory'] ||
      raw['sub category'] ||
      raw['sub-category 1'] ||
      raw['subcategory 1'] ||
      ''
    ).trim()
    const activeRaw = raw['active'] || raw['is_active'] || raw['is active'] || raw['status'] || ''
    const autoAssignRaw = raw['auto assign'] || raw['auto_assign'] || raw['auto-assign'] || raw['mode'] || ''

    const errors: string[] = []
    if (!keyword) errors.push('Keyword / Pattern is required.')
    if (!subCategoryName) errors.push('Sub-Category is required.')

    let subCategoryId: number | null = null
    if (categoryName) {
      const cat = categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase())
      if (cat && subCategoryName) {
        const sub = (cat.subcategories || []).find((s) => s.name.toLowerCase() === subCategoryName.toLowerCase())
        if (sub) {
          subCategoryId = sub.id
        }
      }
    }

    if (!subCategoryId && subCategoryName) {
      const globalSub = categories.flatMap((c) => c.subcategories || []).find((s) => s.name.toLowerCase() === subCategoryName.toLowerCase())
      if (globalSub) {
        subCategoryId = globalSub.id
      } else if (categoryName) {
        errors.push(`Sub-category "${subCategoryName}" not found under category "${categoryName}" or anywhere in Chart of Accounts.`)
      } else {
        errors.push(`Sub-category "${subCategoryName}" not found in Chart of Accounts.`)
      }
    }

    const is_active = parseYesNo(activeRaw, true)
    if (is_active === null) errors.push(`Active "${activeRaw}" is not valid - use TRUE or FALSE.`)
    const auto_assign = parseYesNo(autoAssignRaw, false)
    if (auto_assign === null) errors.push(`Auto Assign "${autoAssignRaw}" is not valid - use TRUE or FALSE.`)
    const label = keyword || `Row ${rowNumber}`

    if (errors.length > 0 || !subCategoryId) return { data: null, label, errors }

    return {
      data: { keyword, sub_category: subCategoryId, is_active, auto_assign } as KeywordImportRow,
      label,
      errors: [],
    }
  }, [categories])

  const checkImportDuplicate = useCallback((data: KeywordImportRow, acceptedSoFar: KeywordImportRow[]) => {
    const kwLower = data.keyword.trim().toLowerCase()
    if (existingKeywords.has(kwLower)) return 'A keyword with this exact text already exists.'
    if (acceptedSoFar.some((d) => d.keyword.trim().toLowerCase() === kwLower)) return 'Duplicate keyword within this file.'
    return null
  }, [existingKeywords])

  const submitImportRows = useCallback(async (accepted: KeywordImportRow[]) => {
    await categoryKeywordsApi.bulkCreate(accepted)
  }, [])

  const [clearing, setClearing] = useState(false)
  const handleClearAll = async () => {
    if (!window.confirm(`Delete ALL ${summary?.total ?? count} keyword rules? This cannot be undone.`)) return
    setClearing(true)
    setError('')
    try {
      await categoryKeywordsApi.clearAll()
      setPage(0)
      await Promise.all([fetchKeywords(), loadCoaData()])
      refreshSummary()
    } catch {
      setError('Failed to delete keyword rules.')
    } finally {
      setClearing(false)
    }
  }

  const handleExportExcel = async () => {
    try {
      const allKeywords = await categoryKeywordsApi.list()
      const rows = allKeywords.map((k) => ({
        keyword: k.keyword,
        category: k.category_name || '',
        sub_category: k.sub_category_name || '',
        account_type: k.account_type || '',
        auto_assign: k.auto_assign ? 'TRUE' : 'FALSE',
        status: k.is_active !== false ? 'Active' : 'Paused',
      }))

      const columns = [
        { header: 'Keyword Pattern', key: 'keyword', width: 25 },
        { header: 'Sub-Category', key: 'sub_category', width: 25 },
        { header: 'Category', key: 'category', width: 25 },
        { header: 'Account Type', key: 'account_type', width: 16 },
        { header: 'Auto Assign', key: 'auto_assign', width: 14 },
        { header: 'Status', key: 'status', width: 12 },
      ]

      await exportToExcel('Auto_Categorization_Rules.xlsx', 'Rules', columns, rows)
    } catch {
      window.alert('Failed to export categorization rules to Excel.')
    }
  }

  // Rules per account type, from the tree's keyword counts - the stacked bar in the summary card.
  const typeCounts = ACCOUNT_TYPES.map((t) => ({
    ...t,
    count: categories
      .filter((c) => c.account_type === t.value)
      .reduce((acc, c) => acc + (c.subcategories || []).reduce((s, sub) => s + (subCatKwCounts[sub.id] || 0), 0), 0),
  })).sort((a, b) => b.count - a.count)
  const typeTotal = typeCounts.reduce((s, t) => s + t.count, 0)
  const totalRules = summary?.total ?? count

  const toggleActive = async (kw: CategoryKeyword, isActive: boolean) => {
    try {
      await categoryKeywordsApi.update(kw.id, { is_active: isActive })
      await fetchKeywords()
      refreshSummary()
    } catch {
      setError('Failed to update the rule.')
    }
  }

  const THRESHOLDS: { key: keyof CategorizationSettings; label: string; unit: string; max: number }[] = [
    { key: 'auto_assign_min_score', label: 'Auto-assign min score', unit: 'pts', max: 100 },
    { key: 'auto_assign_min_gap', label: 'Auto-assign min gap', unit: 'pts', max: 100 },
    { key: 'review_min_score', label: 'Review min score', unit: 'pts', max: 100 },
    { key: 'transfer_date_window_days', label: 'Transfer date window', unit: 'days', max: 14 },
    { key: 'fuzzy_match_min_ratio', label: 'Fuzzy match min ratio', unit: '%', max: 100 },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* 1. HEADER & ACTIONS */}
      <PageHeader
        title="Auto-categorization rules"
        description="Map statement transactions to Chart of Accounts sub-categories with case-insensitive keyword patterns."
        actions={
          <>
            {canDelete && (
              <Button variant="outlined" color="error" icon={<Trash className="h-4 w-4" />} onClick={handleClearAll} disabled={clearing || !totalRules}>
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
              <Button variant="contained" icon={<Plus className="h-4 w-4" />} onClick={() => openCreate(selectedSubCatId || undefined)}>
                Add rule keyword
              </Button>
            )}
          </>
        }
      />

      {/* 2. SUMMARY + THRESHOLDS */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <Panel>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-muted">Total rules</p>
              <p className="num mt-1 text-[40px] font-semibold leading-none text-ink">{totalRules}</p>
            </div>
            <span className={`rounded-[20px] px-2.5 py-0.5 text-xs font-bold ${activeRulesCount === totalRules ? 'bg-success-soft text-success-text' : 'bg-warning-soft text-warning-text'}`}>
              {activeRulesCount === totalRules ? <>All <span className="num">{totalRules}</span> active</> : <><span className="num">{activeRulesCount}</span> active</>}
            </span>
          </div>
          <p className="mt-2 text-[13px] text-muted">
            <span className="num">{expenseRulesCount}</span> expense and <span className="num">{incomeRulesCount}</span> income rules run during Auto-Categorize.
          </p>

          <div className="mt-5 flex h-2.5 gap-0.5 overflow-hidden rounded">
            {typeCounts.filter((t) => t.count > 0).map((t) => (
              <div key={t.value} title={`${t.label}: ${t.count}`} className={ACCOUNT_TYPE_STYLE[t.value].dot} style={{ width: `${typeTotal ? (t.count / typeTotal) * 100 : 0}%` }} />
            ))}
            {typeTotal === 0 && <div className="w-full bg-border-soft" />}
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {typeCounts.map((t) => (
              <li key={t.value} className="flex items-center gap-2 text-[13px]">
                <span className={`h-2 w-2 shrink-0 rounded-full ${ACCOUNT_TYPE_STYLE[t.value].dot}`} />
                <span className="text-muted">{t.label}</span>
                <span className="num ml-auto font-semibold text-ink">{t.count}</span>
              </li>
            ))}
          </ul>
        </Panel>

        {settings && (
          <Panel>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <IconTile><Settings2 /></IconTile>
                <div>
                  <h2 className="text-base text-ink">Decision thresholds</h2>
                  <p className="mt-0.5 text-[13px] text-muted">Scores that decide auto-assign, review or uncategorized.</p>
                </div>
              </div>
              {canEdit && (
                <div className="flex items-center gap-3">
                  {settingsSaved && <span className="text-xs font-semibold text-success-text">Saved.</span>}
                  <Button variant="contained" color="neutral" size="sm" icon={<Save className="h-4 w-4" />} onClick={saveSettings} disabled={settingsSaving}>
                    {settingsSaving ? 'Saving...' : 'Save thresholds'}
                  </Button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {THRESHOLDS.map((t) => {
                const value = Number(settings[t.key])
                return (
                  <label key={t.key} className="flex flex-col rounded-2xl bg-surface-muted p-3.5">
                    <span className="text-xs font-semibold leading-tight text-muted">{t.label}</span>
                    <span className="mt-2 flex items-baseline gap-1.5">
                      <input
                        type="number"
                        value={String(settings[t.key])}
                        disabled={!canEdit}
                        onChange={(e) => setSettings({ ...settings, [t.key]: Number(e.target.value) })}
                        className="num h-9 w-full min-w-0 rounded-lg border border-input bg-surface px-2 text-base font-semibold text-ink outline-none focus:border-primary focus:ring-[3px] focus:ring-primary-soft disabled:opacity-70"
                      />
                      <span className="text-xs font-semibold text-muted">{t.unit}</span>
                    </span>
                    <span className="mt-3 h-1.5 overflow-hidden rounded bg-border-soft">
                      <span className="block h-full rounded bg-primary" style={{ width: `${Math.min(100, Math.max(0, (value / t.max) * 100))}%` }} />
                    </span>
                  </label>
                )
              })}
            </div>
          </Panel>
        )}
      </div>

      {error && !dialog && <Alert>{error}</Alert>}

      {/* 3. CHART OF ACCOUNTS TREE + RULES */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)]">
        {/* Left: chart of accounts tree */}
        <Panel className="flex max-h-[calc(100vh-140px)] flex-col p-4 md:sticky md:top-[129px]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Chart of accounts</p>
            <div className="flex items-center gap-1">
              {selectedSubCatId && (
                <Button size="sm" onClick={() => handleSelectSubCategory(null)}>Clear filter</Button>
              )}
              <RowAction title={isAllTreeExpanded ? 'Collapse All Tree Nodes' : 'Expand All Tree Nodes'} onClick={toggleAllTree}>
                {isAllTreeExpanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
              </RowAction>
            </div>
          </div>

          <SearchBox className="mb-3" value={coaSearch} onChange={setCoaSearch} placeholder="Search COA accounts..." />

          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
            {/* All Rules Item */}
            <button
              type="button"
              onClick={() => handleSelectSubCategory(null)}
              className={`flex shrink-0 items-center justify-between rounded-[10px] px-3 py-2.5 text-left transition-colors ${
                selectedSubCatId === null ? 'bg-sidebar text-white' : 'text-ink hover:bg-surface-muted'
              }`}
            >
              <span className="text-sm font-semibold">All rules</span>
              <span className={`num rounded-[20px] px-2 py-0.5 text-xs font-semibold ${selectedSubCatId === null ? 'bg-white/15 text-white' : 'bg-surface-muted text-muted'}`}>{count}</span>
            </button>

            {ACCOUNT_TYPES.map((typeObj) => {
              const groupCategories = coaTree[typeObj.value] || []
              if (groupCategories.length === 0 && coaSearch) return null

              const isTypeExpanded = expandedTypes.has(typeObj.value) || Boolean(coaSearch)
              const typeKwCount = groupCategories.reduce(
                (acc, c) => acc + c.matchingSubs.reduce((sAcc, sub) => sAcc + (subCatKwCounts[sub.id] || 0), 0),
                0
              )

              return (
                <div key={typeObj.value} className="shrink-0">
                  {/* Level 1: Account Type */}
                  <button
                    type="button"
                    onClick={() => toggleType(typeObj.value)}
                    className="flex w-full select-none items-center gap-2.5 rounded-[10px] px-3 py-2 text-left transition-colors hover:bg-surface-muted"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${ACCOUNT_TYPE_STYLE[typeObj.value].dot}`} />
                    <span className="flex-1 text-sm font-semibold text-ink">{typeObj.pluralLabel}</span>
                    <span className="num text-xs font-semibold text-muted">{typeKwCount}</span>
                    <ChevronDown className={`h-4 w-4 text-muted transition-transform ${isTypeExpanded ? '' : '-rotate-90'}`} />
                  </button>

                  {/* Level 2: Categories */}
                  {isTypeExpanded && (
                    <div className="mb-1 ml-[15px] border-l border-border pl-2">
                      {groupCategories.map(({ category, matchingSubs }) => {
                        const isCatExpanded = expandedCategories.has(category.id) || Boolean(coaSearch)
                        const catKwCount = matchingSubs.reduce((acc, sub) => acc + (subCatKwCounts[sub.id] || 0), 0)

                        return (
                          <div key={category.id}>
                            <button
                              type="button"
                              onClick={() => toggleCategory(category.id)}
                              className="flex w-full select-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-muted"
                            >
                              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${isCatExpanded && matchingSubs.length > 0 ? 'rotate-90' : ''} ${matchingSubs.length > 0 ? '' : 'opacity-30'}`} />
                              <span className="flex-1 truncate text-[13px] font-semibold text-ink">{category.name}</span>
                              <span className="num text-[11px] text-muted">{catKwCount}</span>
                            </button>

                            {/* Level 3: Sub-Categories */}
                            {isCatExpanded && (
                              <div className="flex flex-col pl-5">
                                {matchingSubs.map((sub) => {
                                  const isSelected = selectedSubCatId === sub.id
                                  const subKwCount = subCatKwCounts[sub.id] || 0
                                  return (
                                    <button
                                      key={sub.id}
                                      type="button"
                                      onClick={() => handleSelectSubCategory(sub.id, sub.name, category.name, category.account_type, category.id)}
                                      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] ${
                                        isSelected ? 'bg-primary-soft font-semibold text-primary-hover dark:text-primary' : 'text-muted hover:bg-surface-muted hover:text-ink'
                                      }`}
                                    >
                                      <span className="flex-1 truncate">{sub.name}</span>
                                      <span className="num text-[11px]">{subKwCount}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Panel>

        {/* Right: selected sub-category + rules */}
        <div className="flex min-w-0 flex-col gap-6">
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  {selectedSubCatObj && <TypeBadge type={selectedSubCatObj.accountType} />}
                  <span className="text-xs font-bold uppercase tracking-[0.06em] text-muted">
                    {selectedSubCatObj ? selectedSubCatObj.categoryName : 'All account categories'}
                  </span>
                </div>
                <h2 className="text-xl text-ink">
                  {selectedSubCatObj ? selectedSubCatObj.name : 'All transaction keywords'}
                </h2>
              </div>
              {canCreate && (
                <Button variant="contained" color="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => openCreate(selectedSubCatId || undefined)}>
                  Add keyword
                </Button>
              )}
            </div>

            <p className="mb-2.5 mt-5 text-xs font-bold uppercase tracking-[0.06em] text-muted">
              Keyword phrases (<span className="num">{currentSubCatKeywords.length}</span>)
            </p>
            <div className="flex flex-wrap gap-2">
              {currentSubCatKeywords.map((kw) => (
                <button
                  key={kw.id}
                  type="button"
                  title={copiedId === kw.id ? 'Copied!' : canEdit ? 'Click to edit keyword' : undefined}
                  disabled={!canEdit}
                  onClick={() => openEdit(kw)}
                  className={`num inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold ${
                    kw.is_active !== false ? 'bg-primary-soft text-primary-hover hover:bg-primary-border/60 dark:text-primary' : 'border border-border text-muted hover:bg-surface-muted'
                  }`}
                >
                  <Tag className="h-3.5 w-3.5" />
                  {kw.keyword}
                </button>
              ))}
              {currentSubCatKeywords.length === 0 && (
                <p className="text-sm text-muted">
                  No keywords assigned to this category yet.{canCreate && ' Click "Add keyword" to create one.'}
                </p>
              )}
            </div>
          </Panel>

          <SearchBox value={search} onChange={handleSearchChange} placeholder="Search rule keywords..." />

          {/* Rules table */}
          {keywords.length > 0 ? (
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
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-6 py-3 text-left">Keyword</th>
                      <th className="px-4 py-3 text-left">Maps to</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-left">Mode</th>
                      <th className="px-4 py-3 text-left">Active</th>
                      {(canEdit || canDelete) && <th className="px-6 py-3 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-soft">
                    {keywords.map((kw) => (
                      <tr key={kw.id} className="hover:bg-surface-muted">
                        <td className="px-6 py-[13px]">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() => openEdit(kw)}
                              className="num inline-flex items-center whitespace-nowrap rounded-lg bg-surface-muted px-2.5 py-1 text-[13px] font-semibold text-ink ring-1 ring-border hover:ring-primary-border"
                            >
                              {kw.keyword}
                            </button>
                            <button
                              type="button"
                              title={copiedId === kw.id ? 'Copied!' : 'Copy keyword'}
                              aria-label="Copy keyword"
                              onClick={() => copyKeyword(kw)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-ink"
                            >
                              {copiedId === kw.id ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-[13px]">
                          <p className="whitespace-nowrap font-semibold text-ink">{kw.sub_category_name || '—'}</p>
                          <p className="whitespace-nowrap text-xs text-muted">{kw.category_name || '—'}</p>
                        </td>
                        <td className="px-4 py-[13px]">
                          {kw.account_type ? <TypeBadge type={kw.account_type} /> : <span className="text-xs text-muted">—</span>}
                        </td>
                        <td className="px-4 py-[13px]">
                          {kw.auto_assign ? (
                            <span className="inline-flex items-center gap-1 rounded-[20px] bg-primary-soft px-2.5 py-0.5 text-xs font-bold text-primary-hover dark:text-primary">
                              <Zap className="h-3 w-3" /> Direct
                            </span>
                          ) : (
                            <span className="rounded-[20px] bg-surface-muted px-2.5 py-0.5 text-xs font-bold text-muted">Scoring</span>
                          )}
                        </td>
                        <td className="px-4 py-[13px]">
                          {canEdit ? (
                            <Switch
                              checked={kw.is_active !== false}
                              onChange={(v) => toggleActive(kw, v)}
                              label={kw.is_active !== false ? undefined : 'Paused'}
                            />
                          ) : (
                            <span className={`rounded-[20px] px-2.5 py-0.5 text-xs font-bold ${kw.is_active !== false ? 'bg-success-soft text-success-text' : 'bg-surface-muted text-muted'}`}>
                              {kw.is_active !== false ? 'Active' : 'Paused'}
                            </span>
                          )}
                        </td>
                        {(canEdit || canDelete) && (
                          <td className="whitespace-nowrap px-6 py-[13px] text-right">
                            {canEdit && <RowAction onClick={() => openEdit(kw)} title="Edit keyword"><Pencil /></RowAction>}
                            {canDelete && <RowAction danger onClick={() => remove(kw)} title="Delete keyword"><Trash2 /></RowAction>}
                          </td>
                        )}
                      </tr>
                    ))}
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
          ) : (
            <Panel className="p-0">
              <EmptyState
                icon={<Tags />}
                title={search ? 'No keywords match your search.' : 'No auto-categorization keywords found.'}
                text="Keywords match text in transaction descriptions to assign Chart of Accounts categories automatically."
                action={!search && canCreate && (
                  <Button variant="contained" icon={<Plus className="h-4 w-4" />} onClick={() => openCreate(selectedSubCatId || undefined)}>
                    Add rule keyword
                  </Button>
                )}
              />
            </Panel>
          )}
        </div>
      </div>
      {/* Modal Dialog for Keyword Creation / Editing */}
      <Modal
        open={dialog}
        onClose={() => setDialog(false)}
        icon={<Sparkles />}
        title={editing ? 'Edit rule keyword' : 'Add rule keyword'}
        subtitle="A case-insensitive phrase that points to one sub-category."
        footer={
          <>
            <Button variant="outlined" onClick={() => setDialog(false)}>Cancel</Button>
            <Button variant="contained" onClick={save}>Save Rule</Button>
          </>
        }
      >
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Keyword Pattern (e.g. STARBUCKS or UBER)"
          placeholder="Case-insensitive text match"
          value={form.keyword}
          autoFocus
          onChange={(e) => setForm({ ...form, keyword: e.target.value })}
        />
        <SearchableSelect
          label="Category"
          placeholder="Search name or type (asset, expense...)"
          value={categoryOption}
          onChange={handleCategoryChange}
          fetchOptions={fetchCategoryOptions}
          required
        />
        <SearchableSelect
          label="Sub-Category"
          placeholder={categoryOption ? 'Search sub-categories...' : 'Search all sub-categories...'}
          value={subCategoryOption}
          onChange={handleSubCategoryChange}
          fetchOptions={subCategoryFetchOptions}
          resetKey={categoryOption?.id}
          required
        />
        <Switch
          checked={form.auto_assign}
          onChange={(v) => setForm({ ...form, auto_assign: v })}
          label="Auto-assign directly (skip scoring)"
        />
        <p className="-mt-1 text-xs text-muted">
          {form.auto_assign
            ? 'A match assigns this account immediately and skips Step 4 scoring entirely.'
            : 'A match adds points toward this account during Step 4 scoring, alongside other clues.'}
        </p>
        <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Active Rule" />
      </Modal>

      {/* Import Excel Dialog */}
      <ImportExcelDialog<KeywordImportRow>
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        title="Import Rule Keywords from Excel"
        instructions="One keyword per row. See the column and row guide below."
        itemLabel="keyword"
        templateFilename="category_keywords_import_template.xlsx"
        templateColumns={IMPORT_TEMPLATE_COLUMNS}
        templateSampleRows={IMPORT_TEMPLATE_SAMPLE_ROWS}
        columnGuide={IMPORT_COLUMN_GUIDE}
        rowGuide={IMPORT_ROW_GUIDE}
        parseRow={parseImportRow}
        checkDuplicate={checkImportDuplicate}
        onSubmit={submitImportRows}
        onImported={async () => { await fetchKeywords(); await loadCoaData(); refreshSummary() }}
      />
    </div>
  )
}
