import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, Pencil, Trash2, Hash, Sparkles, Trash, CheckCircle2, AlertCircle, FileSpreadsheet, Download,
} from 'lucide-react'
import { baiCodesApi } from './baicodesapi'
import { usePageSummary } from '../../hooks/usePageSummary'
import { categoriesApi } from '../Categories/categoriesapi'
import Pagination, { DEFAULT_ROWS_PER_PAGE } from '../../components/Pagination'
import SearchableSelect from '../../components/SearchableSelect'
import type { SearchableOption } from '../../components/SearchableSelect'
import ImportExcelDialog from '../../components/ImportExcelDialog'
import { categoryLabelWithType } from '../../constants/accountTypes'
import {
  fetchCategoryOptions, parentCategoryOf, plainSubCategoryOption, subCategoryOptionsFetcher,
} from '../../utils/categoryLookup'
import type { BaiCode, Category } from '../../types'
import { exportToExcel } from '../../utils/excelExport'
import { useAuth } from '../../context/AuthContext'
import {
  Button, Panel, TextField, Modal, Alert,
} from '../../components/tw'
import { EmptyState, IconTile, PageHeader, RowAction, SearchBox } from '../../components/PageParts'
import { IMPORT_TEMPLATE_COLUMNS, IMPORT_COLUMN_GUIDE, IMPORT_ROW_GUIDE, IMPORT_TEMPLATE_SAMPLE_ROWS } from './baiCodesConfig'
import type { BaiCodeImportRow } from './baiCodesConfig'

/** Donut: mapped share in green on a light orange track. */
function CoverageRing({ pct }: { pct: number }) {
  const r = 42
  const c = 2 * Math.PI * r
  return (
    <div className="relative h-[108px] w-[108px] shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="10" className="stroke-warning-soft" />
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="10" strokeLinecap="round" className="stroke-success transition-[stroke-dashoffset] duration-500" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-xl font-semibold text-ink">{pct}%</span>
        <span className="text-[11px] font-semibold text-muted">mapped</span>
      </div>
    </div>
  )
}

export default function BaiCodesPage() {
  const { can } = useAuth()
  const canCreate = can('bai_codes', 'create')
  const canEdit = can('bai_codes', 'edit')
  const canDelete = can('bai_codes', 'delete')
  const [baiCodes, setBaiCodes] = useState<BaiCode[]>([])
  const [count, setCount] = useState(0)
  // Card totals cover every BAI code, not just the filtered page.
  const [summary, refreshSummary] = usePageSummary(baiCodesApi.summary)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE)

  const [categories, setCategories] = useState<Category[]>([])

  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<BaiCode | null>(null)
  const [form, setForm] = useState<{ code: string; description: string }>({ code: '', description: '' })
  const [categoryOption, setCategoryOption] = useState<SearchableOption | null>(null)
  const [subCategoryOption, setSubCategoryOption] = useState<SearchableOption | null>(null)

  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [existingCodes, setExistingCodes] = useState<Set<string>>(new Set())


  const fetchBaiCodes = useCallback(async () => {
    try {
      const data = await baiCodesApi.search({
        search: search.trim() || undefined,
        page: page + 1,
        limit: rowsPerPage,
      })
      setBaiCodes(data.results || [])
      setCount(data.count || 0)
    } catch {
      setError('Failed to load BAI codes.')
    }
  }, [search, page, rowsPerPage])

  useEffect(() => {
    const handle = setTimeout(fetchBaiCodes, 300)
    return () => clearTimeout(handle)
  }, [fetchBaiCodes])

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setPage(0)
  }

  const handleSeedDefaults = async () => {
    setBusy(true)
    setError('')
    try {
      await baiCodesApi.seedDefaults()
      await fetchBaiCodes()
      refreshSummary()
    } catch {
      setError('Failed to seed standard BAI codes.')
    } finally {
      setBusy(false)
    }
  }

  const handleClearAll = async () => {
    if (!window.confirm('Are you sure you want to delete ALL BAI codes?')) return
    setBusy(true)
    setError('')
    try {
      await baiCodesApi.clearAll()
      await fetchBaiCodes()
      refreshSummary()
    } catch {
      setError('Failed to clear BAI codes.')
    } finally {
      setBusy(false)
    }
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ code: '', description: '' })
    setCategoryOption(null)
    setSubCategoryOption(null)
    setError('')
    setDialog(true)
  }

  const openEdit = (bc: BaiCode) => {
    setEditing(bc)
    setForm({ code: bc.code, description: bc.description })
    const category = categories.find((c) => c.id === bc.category)
    setCategoryOption(
      bc.category ? { id: bc.category, label: category ? categoryLabelWithType(category) : (bc.category_name || String(bc.category)) } : null
    )
    setSubCategoryOption(bc.sub_category ? { id: bc.sub_category, label: bc.sub_category_name || String(bc.sub_category) } : null)
    setError('')
    setDialog(true)
  }

  const handleCategoryChange = (option: SearchableOption | null) => {
    setCategoryOption(option)
    setSubCategoryOption(null)
  }

  // Picking a sub-category with no category chosen fills its category in too.
  const handleSubCategoryChange = (option: SearchableOption | null) => {
    setSubCategoryOption(option ? plainSubCategoryOption(option) : null)
    const parent = parentCategoryOf(option)
    if (parent && !categoryOption) setCategoryOption(parent)
  }

  const save = async () => {
    if (!form.code.trim()) {
      setError('Please enter a BAI code.')
      return
    }
    if (!form.description.trim()) {
      setError('Please enter a description.')
      return
    }
    setError('')
    const payload = {
      code: form.code.trim(),
      description: form.description.trim(),
      category: categoryOption?.id ?? null,
      sub_category: subCategoryOption?.id ?? null,
    }
    try {
      if (editing) await baiCodesApi.update(editing.id, payload)
      else await baiCodesApi.create(payload)
      setDialog(false)
      await fetchBaiCodes()
      refreshSummary()
    } catch (err: any) {
      const data = err.response?.data
      setError(data?.code?.[0] || data?.description?.[0] || 'Failed to save BAI code (it may already exist).')
    }
  }

  const remove = async (bc: BaiCode) => {
    if (!window.confirm(`Delete BAI code "${bc.code} - ${bc.description}"?`)) return
    try {
      await baiCodesApi.remove(bc.id)
      await fetchBaiCodes()
      refreshSummary()
    } catch {
      window.alert('Could not delete this BAI code.')
    }
  }

  const subCategoryFetchOptions = useMemo(() => subCategoryOptionsFetcher(categoryOption?.id), [categoryOption?.id])

  const openImportDialog = useCallback(async () => {
    // Import matches category / sub-category names from the file, so it needs the full
    // chart of accounts - loaded only here, not for the dropdowns.
    const [codes, cats] = await Promise.all([
      baiCodesApi.list().catch(() => []),
      categoriesApi.list().catch(() => []),
    ])
    setExistingCodes(new Set(codes.map((b) => b.code.trim().toLowerCase())))
    setCategories(cats)
    setImportDialogOpen(true)
  }, [])

  const parseImportRow = useCallback((raw: Record<string, string>, rowNumber: number) => {
    const code = (raw['code'] || '').trim()
    const description = (raw['description'] || '').trim()
    const categoryName = (raw['category'] || raw['accounting_category'] || raw['coa_type'] || '').trim()
    const subCategoryName = (
      raw['sub-category'] || raw['sub_category'] || raw['subcategory'] || raw['accounting_subcategory'] || raw['account'] || ''
    ).trim()

    const errors: string[] = []
    if (!code) errors.push('Code is required.')
    if (!description) errors.push('Description is required.')

    let categoryId: number | null = null
    let subCategoryId: number | null = null
    if (categoryName) {
      const cat = categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase())
      if (!cat) {
        errors.push(`Category "${categoryName}" not found.`)
      } else {
        categoryId = cat.id
        if (subCategoryName) {
          const sub = (cat.subcategories || []).find((s) => s.name.toLowerCase() === subCategoryName.toLowerCase())
          if (!sub) errors.push(`Sub-category "${subCategoryName}" not found under "${categoryName}".`)
          else subCategoryId = sub.id
        }
      }
    } else if (subCategoryName) {
      errors.push('A sub-category was given without a category.')
    }

    const label = code ? `${code}${description ? ' - ' + description : ''}` : (description || `Row ${rowNumber}`)

    if (errors.length > 0) return { data: null, label, errors }

    return {
      data: { code, description, category: categoryId, sub_category: subCategoryId } as BaiCodeImportRow,
      label,
      errors: [],
    }
  }, [categories])

  const checkImportDuplicate = useCallback((data: BaiCodeImportRow, acceptedSoFar: BaiCodeImportRow[]) => {
    const codeLower = data.code.trim().toLowerCase()
    if (existingCodes.has(codeLower)) return 'A BAI code with this code already exists.'
    if (acceptedSoFar.some((d) => d.code.trim().toLowerCase() === codeLower)) return 'Duplicate code within this file.'
    return null
  }, [existingCodes])

  const submitImportRows = useCallback(async (accepted: BaiCodeImportRow[]) => {
    await baiCodesApi.bulkCreate(accepted)
  }, [])

  const mappedCount = summary?.mapped ?? 0
  const unmappedCount = summary?.unmapped ?? 0
  const coveragePct = mappedCount + unmappedCount > 0 ? Math.round((mappedCount / (mappedCount + unmappedCount)) * 100) : 0

  const handleExportExcel = async () => {
    try {
      const allCodes = await baiCodesApi.list()
      const rows = allCodes.map((b) => ({
        code: b.code,
        description: b.description,
        category: b.category_name || '',
        sub_category: b.sub_category_name || '',
      }))

      const columns = [
        { header: 'BAI Code', key: 'code', width: 15 },
        { header: 'Standard Description', key: 'description', width: 35 },
        { header: 'Mapped Category', key: 'category', width: 25 },
        { header: 'Mapped Sub-Category', key: 'sub_category', width: 25 },
      ]

      await exportToExcel('BAI_Codes_Mapping.xlsx', 'BAI Codes', columns, rows)
    } catch {
      window.alert('Failed to export BAI codes to Excel.')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* HEADER & ACTIONS */}
      <PageHeader
        title="BAI codes"
        description="BAI2 transaction type codes. A code mapped to a Category / Sub-category is a categorization fallback when a transaction has no keyword match."
        actions={
          <>
            {canDelete && (
              <Button variant="outlined" color="error" icon={<Trash className="h-4 w-4" />} onClick={handleClearAll} disabled={busy || count === 0}>
                Delete all
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
              <Button variant="contained" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                Add BAI code
              </Button>
            )}
          </>
        }
      />

      {/* COVERAGE */}
      <Panel>
        <div className="flex flex-col gap-6 md:flex-row md:items-center">
          <div className="flex items-center gap-5">
            <CoverageRing pct={coveragePct} />
            <div>
              <h2 className="text-base text-ink">Mapping coverage</h2>
              <p className="mt-0.5 max-w-[260px] text-[13px] text-muted">
                Share of codes with a default category. Unmapped codes give no categorization hint.
              </p>
            </div>
          </div>
          <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-surface-muted p-4">
              <div className="flex items-center justify-between"><span className="text-[13px] font-semibold text-muted">Total</span><IconTile><Hash /></IconTile></div>
              <p className="num mt-2 text-[26px] font-semibold text-ink">{summary?.total ?? count}</p>
              <p className="text-xs text-muted">BAI2 transaction type codes</p>
            </div>
            <div className="rounded-2xl bg-surface-muted p-4">
              <div className="flex items-center justify-between"><span className="text-[13px] font-semibold text-muted">Mapped</span><IconTile tone="success"><CheckCircle2 /></IconTile></div>
              <p className="num mt-2 text-[26px] font-semibold text-success-text">{mappedCount}</p>
              <p className="text-xs text-muted">Have a default category</p>
            </div>
            <div className="rounded-2xl bg-surface-muted p-4">
              <div className="flex items-center justify-between"><span className="text-[13px] font-semibold text-muted">Need a category</span><IconTile tone="warning"><AlertCircle /></IconTile></div>
              <p className="num mt-2 text-[26px] font-semibold text-warning-text">{unmappedCount}</p>
              <p className="text-xs text-muted">No default category yet</p>
            </div>
          </div>
        </div>
      </Panel>

      {error && !dialog && <Alert>{error}</Alert>}

      <SearchBox value={search} onChange={handleSearchChange} placeholder="Search by code or description..." />

      {/* DATA TABLE */}
      {baiCodes.length > 0 ? (
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
                  <th className="px-6 py-3 text-left">Code</th>
                  <th className="px-4 py-3 text-left">Description</th>
                  <th className="px-4 py-3 text-left">Default category / sub-category</th>
                  {(canEdit || canDelete) && <th className="px-6 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {baiCodes.map((bc) => (
                  <tr key={bc.id} className="hover:bg-surface-muted">
                    <td className="px-6 py-[13px]">
                      <span className="num inline-flex min-w-[48px] items-center justify-center rounded-lg bg-sidebar px-2 py-1 text-[13px] font-semibold text-white">
                        {bc.code}
                      </span>
                    </td>
                    <td className="px-4 py-[13px] text-ink">{bc.description}</td>
                    <td className="px-4 py-[13px]">
                      {bc.category ? (
                        <div>
                          <p className="font-semibold text-ink">{bc.sub_category_name || bc.category_name}</p>
                          {bc.sub_category && <p className="text-xs text-muted">{bc.category_name}</p>}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-[20px] bg-warning-soft px-2.5 py-0.5 text-xs font-bold text-warning-text">
                            <span className="h-1.5 w-1.5 rounded-full bg-warning" /> Not mapped
                          </span>
                          {canEdit && (
                            <Button variant="contained" color="secondary" size="sm" onClick={() => openEdit(bc)}>
                              Map category
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                    {(canEdit || canDelete) && (
                      <td className="whitespace-nowrap px-6 py-[13px] text-right">
                        {canEdit && <RowAction onClick={() => openEdit(bc)} title="Edit BAI code"><Pencil /></RowAction>}
                        {canDelete && <RowAction danger onClick={() => remove(bc)} title="Delete BAI code"><Trash2 /></RowAction>}
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
            icon={<Hash />}
            title={search ? 'No BAI codes match your search.' : 'No BAI codes yet.'}
            text={search
              ? 'Try clearing your search.'
              : canCreate ? 'Load the standard BAI2 codes, or add one yourself.' : 'No codes have been added yet.'}
            action={!search && canCreate && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="outlined" icon={<Sparkles className="h-4 w-4" />} onClick={handleSeedDefaults} disabled={busy}>
                  Seed standard codes
                </Button>
                <Button variant="contained" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                  Add BAI code
                </Button>
              </div>
            )}
          />
        </Panel>
      )}
      {/* Modal Dialog for BAI Code Creation / Editing */}
      <Modal
        open={dialog}
        onClose={() => setDialog(false)}
        icon={<Hash />}
        title={editing ? 'Edit BAI code' : 'Add BAI code'}
        subtitle="A transaction type code and its default account."
        footer={
          <>
            <Button variant="outlined" onClick={() => setDialog(false)}>Cancel</Button>
            <Button variant="contained" onClick={save}>Save</Button>
          </>
        }
      >
        {error && <Alert>{error}</Alert>}
        <TextField
          label="BAI Code (e.g. 464)"
          placeholder="Numeric transaction type code"
          value={form.code}
          autoFocus
          onChange={(e) => setForm({ ...form, code: e.target.value })}
        />
        <TextField
          label="Description (e.g. Corporate Trade Payment Debit)"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <p className="-mt-1 text-xs text-muted">
          Default Category / Sub-Category (both optional)
        </p>
        <SearchableSelect
          label="Category"
          placeholder="Search name or type (asset, expense...)"
          value={categoryOption}
          onChange={handleCategoryChange}
          fetchOptions={fetchCategoryOptions}
        />
        <SearchableSelect
          label="Sub-Category"
          placeholder={categoryOption ? 'Search sub-categories...' : 'Search all sub-categories...'}
          value={subCategoryOption}
          onChange={handleSubCategoryChange}
          fetchOptions={subCategoryFetchOptions}
          resetKey={categoryOption?.id}
        />
      </Modal>

      {/* Import Excel Dialog */}
      <ImportExcelDialog<BaiCodeImportRow>
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        title="Import BAI Codes from Excel"
        instructions="One BAI code per row. See the column and row guide below."
        itemLabel="BAI code"
        templateFilename="bai_codes_import_template.xlsx"
        templateColumns={IMPORT_TEMPLATE_COLUMNS}
        templateSampleRows={IMPORT_TEMPLATE_SAMPLE_ROWS}
        columnGuide={IMPORT_COLUMN_GUIDE}
        rowGuide={IMPORT_ROW_GUIDE}
        parseRow={parseImportRow}
        checkDuplicate={checkImportDuplicate}
        onSubmit={submitImportRows}
        onImported={() => { fetchBaiCodes(); refreshSummary() }}
      />
    </div>
  )
}
