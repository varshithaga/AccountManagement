import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import SearchableSelect from './SearchableSelect'
import type { SearchableOption } from './SearchableSelect'
import { categoryLookupApi, subCategoriesApi, type CategoryOption, type SubCategoryOption } from '../api/resources'
import { Alert, Button, Modal, Select, TextField } from './tw'
import { useAuth } from '../context/AuthContext'

const toOption = (sc: SubCategoryOption): SearchableOption => ({
  id: sc.id,
  label: `${sc.name} — ${sc.category_name} (${sc.account_type_label})`,
})

/** Asset categories where a bank ledger usually lives come first ("Current Assets", "Bank..."). */
const rankCategory = (c: CategoryOption) => (/bank|current asset|cash/i.test(c.name) ? 0 : 1)

/**
 * Picks the Chart of Accounts account (sub-category) a bank account is booked to in journal
 * entries - its GL account. Each GL account belongs to one bank only, so ledgers already
 * linked to another bank are left out, and "Create a new ledger" adds one for this bank.
 */
export default function GlAccountSelect({
  value, label = 'GL Account (Chart of Accounts)', fallbackLabel, onChange, disabled,
  bankAccountId = null, newLedgerName = '',
}: {
  value: number | null | undefined
  label?: string
  /** Shown for the current value until its label is fetched (e.g. the bank account's gl_account_name). */
  fallbackLabel?: string | null
  onChange: (subCategoryId: number | null) => void
  disabled?: boolean
  /** The bank account being linked (null for one not saved yet) - its own ledger stays pickable. */
  bankAccountId?: number | null
  /** Suggested name for a new ledger, usually the bank account's name. */
  newLedgerName?: string
}) {
  const { canAddSubCategory } = useAuth()
  const [option, setOption] = useState<SearchableOption | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [assetCategories, setAssetCategories] = useState<CategoryOption[]>([])
  const [draftName, setDraftName] = useState('')
  const [draftCategory, setDraftCategory] = useState<number | ''>('')
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState('')

  useEffect(() => {
    if (!value) {
      setOption(null)
      return
    }
    if (option?.id === value) return
    setOption({ id: value, label: fallbackLabel || `Account #${value}` })
    let cancelled = false
    categoryLookupApi.subCategories({ ids: String(value) })
      .then((res) => { if (!cancelled && res.results[0]) setOption(toOption(res.results[0])) })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const fetchOptions = useCallback(async ({ search, page }: { search: string; page: number }) => {
    const res = await categoryLookupApi.subCategories({
      search: search.trim() || undefined, gl_free_for: bankAccountId ?? 0, page, limit: 20,
    })
    return { options: res.results.map(toOption), hasMore: Boolean(res.next) }
  }, [bankAccountId])

  const openCreate = async () => {
    setDraftName(newLedgerName.trim())
    setCreateError('')
    setCreateOpen(true)
    try {
      const res = await categoryLookupApi.categories({ account_type: 'ASSET', limit: 50 })
      const sorted = [...res.results].sort((a, b) => rankCategory(a) - rankCategory(b) || a.name.localeCompare(b.name))
      setAssetCategories(sorted)
      setDraftCategory((current) => current || sorted[0]?.id || '')
    } catch {
      setAssetCategories([])
    }
  }

  const createLedger = async () => {
    if (!draftName.trim() || !draftCategory) {
      setCreateError('Enter a name and choose a category.')
      return
    }
    setSaving(true)
    setCreateError('')
    try {
      const sub = await subCategoriesApi.create({ name: draftName.trim(), category: draftCategory })
      const category = assetCategories.find((c) => c.id === draftCategory)
      setOption({ id: sub.id, label: `${sub.name} — ${category?.name ?? ''} (Asset)` })
      onChange(sub.id)
      setCreateOpen(false)
    } catch (err) {
      const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data
      const nonField = data?.non_field_errors ?? data?.name
      setCreateError(
        Array.isArray(nonField) && String(nonField[0]).toLowerCase().includes('unique')
          ? `"${draftName.trim()}" already exists in that category - pick it from the list instead.`
          : 'Could not create the ledger account.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SearchableSelect
        label={label}
        placeholder="Search ledgers not linked to another bank"
        value={option}
        onChange={(opt) => { setOption(opt); onChange(opt ? opt.id : null) }}
        fetchOptions={fetchOptions}
        resetKey={bankAccountId ?? 0}
        disabled={disabled}
        onCreateNew={canAddSubCategory ? openCreate : undefined}
        createNewText="Create a new ledger for this bank"
      />

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        icon={<Plus className="h-4 w-4 text-primary" />}
        title="New bank ledger account"
        footer={
          <>
            <Button variant="outlined" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={createLedger} disabled={saving}>{saving ? 'Creating...' : 'Create & Link'}</Button>
          </>
        }
      >
        <p className="text-xs text-muted">
          Adds a sub-category to your Chart of Accounts for this bank's money. Each bank account needs its own
          ledger, so its journal entries can be reconciled against its statement.
        </p>
        {createError && <Alert>{createError}</Alert>}
        <TextField label="Ledger name" value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="e.g. HDFC Primary Account" autoFocus />
        <Select id="gl-new-category" label="Under category (Asset)" value={draftCategory} onChange={(e) => setDraftCategory(Number(e.target.value) || '')}>
          {assetCategories.length === 0 && <option value="">No asset categories found</option>}
          {assetCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Modal>
    </>
  )
}
