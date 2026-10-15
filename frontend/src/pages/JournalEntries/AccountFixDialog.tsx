import { useCallback, useEffect, useState } from 'react'
import { FolderPlus, Plus } from 'lucide-react'
import { Alert, Button, Modal, Select, TextField } from '../../components/tw'
import SearchableSelect, { type SearchableOption } from '../../components/SearchableSelect'
import { categoriesApi, categoryLookupApi, subCategoriesApi } from '../../api/resources'
import { ACCOUNT_TYPES } from '../../constants/accountTypes'
import { useAuth } from '../../context/AuthContext'
import { apiErrorText } from '../../utils/reconcileConfirm'
import type { AccountType } from '../../types'

/** A sub category the import file refers to that isn't in the Chart of Accounts. */
export interface UnknownAccount {
  key: string
  /** As written in the file ('' when the line gave none). */
  name: string
  categoryName: string
  subCategoryId: string
  reason: string
  /** How many lines of the file use it. */
  lines: number
  /** Where it is used - row, entry, description and amount of each line (the first few). */
  usedOn: string[]
}

/** The lines an unknown account is used on, a few at most. */
export function UsedOnList({ account, max = 3 }: { account: UnknownAccount; max?: number }) {
  if (!account.usedOn.length) return null
  return (
    <ul className="mt-0.5 space-y-0.5 text-muted">
      {account.usedOn.slice(0, max).map((u) => <li key={u}>• {u}</li>)}
      {account.lines > max && <li className="text-muted">+ {account.lines - max} more line{account.lines - max === 1 ? '' : 's'}</li>}
    </ul>
  )
}

const fetchCategories = async ({ search, page }: { search: string; page: number }) => {
  const res = await categoryLookupApi.categories({ search, page })
  return {
    options: res.results.map((c) => ({ id: c.id, label: `${c.code ? c.code + ' · ' : ''}${c.name} (${c.account_type_label})` })),
    hasMore: !!res.next,
  }
}

function Field({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-3 ">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{step}. {title}</p>
      {children}
    </div>
  )
}

/** Optional fix for a sub category the file names but the Chart of Accounts doesn't have: pick (or
 * create) the category, then pick a sub category from its list (or create one). Only this import
 * changes - the file itself stays as it is. */
export default function AccountFixDialog({ account, onClose, onResolved }: {
  account: UnknownAccount | null
  onClose: () => void
  /** The sub category the account's lines should post to, with a label to show. */
  onResolved: (key: string, subCategory: { id: number; label: string }) => void
}) {
  const { canAddCategory, canAddSubCategory } = useAuth()
  const [category, setCategory] = useState<SearchableOption | null>(null)
  const [newCategory, setNewCategory] = useState(false)
  const [categoryName, setCategoryName] = useState('')
  const [accountType, setAccountType] = useState<AccountType>('EXPENSE')
  const [categoryCode, setCategoryCode] = useState('')
  const [sub, setSub] = useState<SearchableOption | null>(null)
  const [newSub, setNewSub] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Start from what the file says each time a different account is opened.
  useEffect(() => {
    if (!account) return
    setCategory(null)
    setNewCategory(false)
    setCategoryName(account.categoryName)
    setAccountType('EXPENSE')
    setCategoryCode('')
    setSub(null)
    setNewSub(false)
    setName(account.name)
    setCode('')
    setError('')
    if (!account.categoryName) return
    // The file's Category: pick it when it exists, otherwise offer it as a new category.
    let cancelled = false
    categoryLookupApi.categories({ search: account.categoryName, limit: 5 })
      .then((res) => {
        if (cancelled) return
        const match = res.results.find((c) => c.name.toLowerCase() === account.categoryName.toLowerCase())
        if (match) setCategory({ id: match.id, label: `${match.name} (${match.account_type_label})` })
        else if (canAddCategory && canAddSubCategory) {
          setNewCategory(true)
          setNewSub(true)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [account, canAddCategory, canAddSubCategory])

  // The sub categories of the chosen category (every sub category when none is chosen).
  const fetchSubCategories = useCallback(async ({ search, page }: { search: string; page: number }) => {
    const res = await categoryLookupApi.subCategories({ search, page, category: category?.id })
    return {
      options: res.results.map((s) => ({
        id: s.id,
        label: category ? `${s.code ? s.code + ' · ' : ''}${s.name}` : `${s.name} — ${s.category_name} (${s.account_type_label})`,
      })),
      hasMore: !!res.next,
    }
  }, [category])

  const chooseCategory = (option: SearchableOption | null) => {
    setCategory(option)
    setSub(null)
  }

  const startNewCategory = () => {
    setNewCategory(true)
    setCategory(null)
    // A new category has no sub categories yet, so the sub category is new too.
    setSub(null)
    setNewSub(true)
  }

  const save = async () => {
    if (!account) return
    if (!newSub) {
      if (sub) onResolved(account.key, { id: sub.id, label: category ? `${sub.label} — ${category.label}` : sub.label })
      return
    }
    setSaving(true)
    setError('')
    try {
      let categoryId = category?.id
      if (newCategory) {
        const created = await categoriesApi.create({ name: categoryName.trim(), account_type: accountType, code: categoryCode.trim() || null })
        categoryId = created.id
        // Keep it chosen, so a failed sub category save can be retried without creating it twice.
        setCategory({ id: created.id, label: `${created.name} (new)` })
        setNewCategory(false)
      }
      const createdSub = await subCategoriesApi.create({ category: categoryId, name: name.trim(), code: code.trim() || null })
      onResolved(account.key, { id: createdSub.id, label: `${createdSub.name} — ${createdSub.category_name} (new)` })
    } catch (err) {
      setError(apiErrorText(err, 'Could not add it to the Chart of Accounts.'))
    } finally {
      setSaving(false)
    }
  }

  const categoryReady = newCategory ? !!categoryName.trim() : !!category
  const canSave = !saving && (newSub ? categoryReady && !!name.trim() : !!sub)
  const buttonText = saving ? 'Adding...'
    : newCategory ? 'Add category & sub category'
      : newSub ? 'Add sub category & use it'
        : 'Use this sub category'

  return (
    <Modal
      open={account !== null}
      onClose={onClose}
      title={account && !account.name && !account.subCategoryId ? 'Enter a sub category' : 'Sub category not found'}
      icon={<FolderPlus className="h-5 w-5 text-violet-500" />}
      widthClassName="max-w-lg"
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="text" onClick={onClose} disabled={saving}>Skip - leave it out</Button>
          <Button variant="contained" onClick={save} disabled={!canSave}>{buttonText}</Button>
        </div>
      )}
    >
      {account && (
        <div className="mt-3 space-y-3 text-sm">
          <div className="rounded-xl border border-warning/40 bg-warning-soft p-3 text-xs text-warning-text dark:bg-warning-soft ">
            <p className="font-bold">
              {account.name ? <>"{account.name}"{account.categoryName ? ` under "${account.categoryName}"` : ''}</> : account.subCategoryId ? `Sub category id ${account.subCategoryId}` : 'Sub category is empty'}
              {' '}- used on {account.lines} line{account.lines === 1 ? '' : 's'}
            </p>
            <p className="mt-0.5">{account.reason}</p>
            <UsedOnList account={account} max={5} />
            <p className="mt-1">
              Entries with these lines are <b>not imported</b> as they are. Fixing it is optional: choose the category and sub
              category to post them to, or create new ones. The file itself isn't changed.
            </p>
          </div>

          {/* 1. CATEGORY */}
          <Field step={1} title="Category">
            {newCategory ? (
              <div className="space-y-2">
                <TextField id="fix-category-name" label="New category name" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="e.g. Pantry & Refreshments" />
                <div className="grid grid-cols-2 gap-2">
                  <Select id="fix-category-type" label="Account type" value={accountType} onChange={(e) => setAccountType(e.target.value as AccountType)}>
                    {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Select>
                  <TextField id="fix-category-code" label="Code (optional)" value={categoryCode} onChange={(e) => setCategoryCode(e.target.value)} placeholder="e.g. 5600" />
                </div>
                <button type="button" className="text-xs font-bold text-violet-600 hover:underline dark:text-violet-400"
                  onClick={() => { setNewCategory(false); setNewSub(false) }}>
                  Choose an existing category instead
                </button>
              </div>
            ) : (
              <>
                <SearchableSelect
                  label=""
                  placeholder="Choose a category"
                  value={category}
                  onChange={chooseCategory}
                  fetchOptions={fetchCategories}
                  onCreateNew={canAddCategory && canAddSubCategory ? startNewCategory : undefined}
                  createNewText="Create a new category"
                />
                {!category && <p className="mt-1 text-xs text-muted">Optional when choosing an existing sub category - it narrows the list below.</p>}
              </>
            )}
          </Field>

          {/* 2. SUB CATEGORY */}
          <Field step={2} title="Sub category">
            {newSub ? (
              <div className="space-y-2">
                <TextField id="fix-name" label="New sub category name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Coffee & Snacks" />
                <TextField id="fix-code" label="Code (optional)" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 5610" />
                {!newCategory && !category && <p className="text-xs text-warning-text">Choose its category above.</p>}
                {!newCategory && (
                  <button type="button" className="text-xs font-bold text-violet-600 hover:underline dark:text-violet-400" onClick={() => setNewSub(false)}>
                    Choose an existing sub category instead
                  </button>
                )}
              </div>
            ) : (
              <>
                <SearchableSelect
                  label=""
                  placeholder={category ? 'Choose a sub category of this category' : 'Choose a sub category'}
                  value={sub}
                  onChange={setSub}
                  fetchOptions={fetchSubCategories}
                  resetKey={category?.id ?? 0}
                  onCreateNew={canAddSubCategory ? () => { setNewSub(true); setSub(null) } : undefined}
                  createNewText="Create a new sub category"
                />
                {canAddSubCategory && account.name && (
                  <button type="button" onClick={() => { setNewSub(true); setSub(null) }}
                    className="mt-1.5 flex items-center gap-1 text-xs font-bold text-violet-600 hover:underline dark:text-violet-400">
                    <Plus className="h-3 w-3" /> Not in the list? Create "{account.name}"
                  </button>
                )}
              </>
            )}
          </Field>
          {error && <Alert>{error}</Alert>}
        </div>
      )}
    </Modal>
  )
}
