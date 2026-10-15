import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import SearchableSelect from './SearchableSelect'
import type { SearchableOption } from './SearchableSelect'
import { ACCOUNT_TYPES, categoryLabelWithType } from '../constants/accountTypes'
import { categoriesApi } from '../pages/Categories/categoriesapi'
import { fetchCategoryOptions, parentCategoryOf, plainSubCategoryOption, subCategoryOptionsFetcher } from '../utils/categoryLookup'
import type { Category, SubCategory, AccountType } from '../types'
import { Button, Modal, Select, TextField, IconButton } from './tw'
import { useAuth } from '../context/AuthContext'

interface CategorySubCategorySelectProps {
  /** Optional - only used to label the current selection. The dropdown options
   * themselves are always searched on the server, 20 per page. */
  categories?: Category[]
  categoryId: number | null
  subCategoryId: number | null
  /** Fallback labels for the current selection when `categories` doesn't contain it
   * (e.g. a transaction's own category_name / sub_category_name). */
  categoryLabel?: string | null
  subCategoryLabel?: string | null
  onChange: (categoryId: number | null, subCategoryId: number | null) => void
  onCreateCategory?: (payload: { name: string; account_type: string }) => Promise<Category>
  onCreateSubCategory: (payload: { name: string; category: number }) => Promise<SubCategory>
  size?: 'small' | 'medium'
  disabled?: boolean
}

const CATEGORY_SEARCH_PLACEHOLDER = 'Search name or type (asset, expense...)'

export default function CategorySubCategorySelect({
  categories = [],
  categoryId,
  subCategoryId,
  categoryLabel,
  subCategoryLabel,
  onChange,
  onCreateCategory,
  onCreateSubCategory,
  size = 'small',
  disabled = false,
}: CategorySubCategorySelectProps) {
  const { canAddCategory, canAddSubCategory } = useAuth()

  // Category dialog state
  const [newCategoryDialog, setNewCategoryDialog] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryAccountType, setNewCategoryAccountType] = useState<AccountType>('EXPENSE')
  const [savingCategory, setSavingCategory] = useState(false)

  // SubCategory dialog state
  const [newSubCategoryDialog, setNewSubCategoryDialog] = useState(false)
  const [newSubCategoryName, setNewSubCategoryName] = useState('')
  const [newSubCategoryParent, setNewSubCategoryParent] = useState<SearchableOption | null>(null)
  const [savingSubCategory, setSavingSubCategory] = useState(false)

  // Labels of what was picked here, so the selection displays correctly even when it
  // isn't in `categories` (it came from a server search, or was just created).
  const [picked, setPicked] = useState<{ cat?: SearchableOption; sub?: SearchableOption }>({})

  const knownCategory = categories.find((c) => c.id === categoryId)
  const knownSubCategory = knownCategory?.subcategories.find((sc) => sc.id === subCategoryId)

  const categoryOption: SearchableOption | null = categoryId == null ? null : {
    id: categoryId,
    label: knownCategory ? categoryLabelWithType(knownCategory)
      : picked.cat?.id === categoryId ? picked.cat.label
        : categoryLabel || `Category #${categoryId}`,
  }
  const subCategoryOption: SearchableOption | null = subCategoryId == null ? null : {
    id: subCategoryId,
    label: knownSubCategory ? knownSubCategory.name
      : picked.sub?.id === subCategoryId ? picked.sub.label
        : subCategoryLabel || `Sub-category #${subCategoryId}`,
  }

  const subCategoryFetchOptions = useMemo(() => subCategoryOptionsFetcher(categoryId), [categoryId])

  const handleCategoryChange = (option: SearchableOption | null) => {
    setPicked({ cat: option ?? undefined })
    onChange(option ? option.id : null, null)
  }

  const handleSubCategoryChange = (option: SearchableOption | null) => {
    if (!option) {
      onChange(categoryId, null)
      return
    }
    // Picking a sub-category fills in (or switches to) the category it belongs to.
    const parent = parentCategoryOf(option)
    const catId = parent?.id ?? categoryId
    setPicked({
      cat: parent ?? picked.cat,
      sub: plainSubCategoryOption(option),
    })
    onChange(catId, option.id)
  }

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return
    setSavingCategory(true)
    try {
      const creator = onCreateCategory ?? (async (p) => categoriesApi.create(p))
      const created = await creator({ name: newCategoryName.trim(), account_type: newCategoryAccountType })
      setPicked({ cat: { id: created.id, label: categoryLabelWithType(created) } })
      onChange(created.id, null)
      setNewCategoryDialog(false)
      setNewCategoryName('')
    } finally {
      setSavingCategory(false)
    }
  }

  const openNewSubCategoryDialog = () => {
    setNewSubCategoryParent(categoryOption)
    setNewSubCategoryDialog(true)
  }

  const handleCreateSubCategory = async () => {
    if (!newSubCategoryName.trim() || !newSubCategoryParent) return
    setSavingSubCategory(true)
    try {
      const created = await onCreateSubCategory({ name: newSubCategoryName.trim(), category: newSubCategoryParent.id })
      setPicked({ cat: newSubCategoryParent, sub: { id: created.id, label: created.name } })
      onChange(newSubCategoryParent.id, created.id)
      setNewSubCategoryDialog(false)
      setNewSubCategoryName('')
    } finally {
      setSavingSubCategory(false)
    }
  }

  return (
    <div className="flex min-w-[420px] items-center gap-2">
      {/* Category Dropdown + Add Category Button */}
      <div className="flex min-w-[190px] flex-1 items-center gap-1">
        <div className="flex-1">
          <SearchableSelect
            label="Category"
            placeholder={CATEGORY_SEARCH_PLACEHOLDER}
            value={categoryOption}
            onChange={handleCategoryChange}
            fetchOptions={fetchCategoryOptions}
            size={size}
            disabled={disabled}
            onCreateNew={canAddCategory ? () => setNewCategoryDialog(true) : undefined}
            createNewText="Create New Category"
          />
        </div>
        {canAddCategory && (
          <IconButton
            title="Add new Category"
            disabled={disabled}
            onClick={() => setNewCategoryDialog(true)}
            className="h-9 w-9 shrink-0"
          >
            <Plus className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      {/* Sub-Category Dropdown + Add Sub-Category Button - usable without a category;
          picking a sub-category fills the category in. */}
      <div className="flex min-w-[190px] flex-1 items-center gap-1">
        <div className="flex-1">
          <SearchableSelect
            label="Sub-Category"
            placeholder={categoryId ? 'Search sub-categories...' : 'Search all sub-categories...'}
            value={subCategoryOption}
            onChange={handleSubCategoryChange}
            fetchOptions={subCategoryFetchOptions}
            resetKey={categoryId}
            size={size}
            disabled={disabled}
            onCreateNew={canAddSubCategory ? openNewSubCategoryDialog : undefined}
            createNewText="Create New Sub-Category"
          />
        </div>
        {canAddSubCategory && (
          <IconButton
            title="Add new sub-category"
            disabled={disabled}
            onClick={openNewSubCategoryDialog}
            className="h-9 w-9 shrink-0"
          >
            <Plus className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      {/* Dialog for Adding New Category */}
      <Modal
        open={newCategoryDialog}
        onClose={() => setNewCategoryDialog(false)}
        title="Add New Category"
        widthClassName="max-w-xs"
        footer={
          <>
            <Button variant="outlined" onClick={() => setNewCategoryDialog(false)}>Cancel</Button>
            <Button variant="contained" onClick={handleCreateCategory} disabled={savingCategory}>Create Category</Button>
          </>
        }
      >
        <TextField
          label="Category Name (e.g. Software & Tools, Consulting)"
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          autoFocus
        />
        <Select
          id="new-category-account-type"
          label="Account Type"
          value={newCategoryAccountType}
          onChange={(e) => setNewCategoryAccountType(e.target.value as AccountType)}
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label} ({t.pluralLabel})</option>
          ))}
        </Select>
      </Modal>

      {/* Dialog for Adding New Sub-Category */}
      <Modal
        open={newSubCategoryDialog}
        onClose={() => setNewSubCategoryDialog(false)}
        title="Add New Sub-Category"
        widthClassName="max-w-xs"
        footer={
          <>
            <Button variant="outlined" onClick={() => setNewSubCategoryDialog(false)}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handleCreateSubCategory}
              disabled={savingSubCategory || !newSubCategoryName.trim() || !newSubCategoryParent}
            >
              Create Sub-Category
            </Button>
          </>
        }
      >
        <TextField
          label="Sub-category Name (e.g. Rent & Utilities, Sales Revenue)"
          value={newSubCategoryName}
          onChange={(e) => setNewSubCategoryName(e.target.value)}
          autoFocus
        />
        <SearchableSelect
          label="Under Category"
          placeholder={CATEGORY_SEARCH_PLACEHOLDER}
          value={newSubCategoryParent}
          onChange={setNewSubCategoryParent}
          fetchOptions={fetchCategoryOptions}
          required
        />
      </Modal>
    </div>
  )
}
