/**
 * Shared server-side search for every category / sub-category dropdown.
 *
 * All dropdowns page through /lookups/categories/ and /lookups/subcategories/
 * (page=N, limit=20) instead of downloading the full chart of accounts. Search matches
 * names and account types ("assets", "liab", "expenses", "revenue"...).
 */
import { categoryLookupApi } from '../api/resources'
import type { SubCategoryOption } from '../api/resources'
import type { SearchableOption } from '../components/SearchableSelect'
import { categoryLabelWithType } from '../constants/accountTypes'

export const LOOKUP_PAGE_SIZE = 20

/** Carried in a sub-category option's SearchableOption.meta. */
export interface SubCategoryMeta {
  name: string
  category: SearchableOption
}

type FetchParams = { search: string; page: number }

export async function fetchCategoryOptions({ search, page }: FetchParams) {
  const res = await categoryLookupApi.categories({ search: search.trim() || undefined, page, limit: LOOKUP_PAGE_SIZE })
  return { options: res.results.map((c) => ({ id: c.id, label: categoryLabelWithType(c) })), hasMore: Boolean(res.next) }
}

const parentCategoryOption = (sc: SubCategoryOption): SearchableOption => ({
  id: sc.category,
  label: categoryLabelWithType({ name: sc.category_name, account_type: sc.account_type }),
})

const subCategoryOption = (sc: SubCategoryOption, withCategory: boolean): SearchableOption => ({
  id: sc.id,
  // Without a category chosen the list spans every category, so show which one each belongs to.
  label: withCategory ? `${sc.name} — ${sc.category_name} (${sc.account_type_label})` : sc.name,
  meta: { name: sc.name, category: parentCategoryOption(sc) } satisfies SubCategoryMeta,
})

/** Fetcher for a sub-category dropdown - limited to `categoryId` when one is chosen,
 * otherwise across all categories. Use `resetKey={categoryId}` on the SearchableSelect. */
export function subCategoryOptionsFetcher(categoryId?: number | null) {
  return async ({ search, page }: FetchParams) => {
    const res = await categoryLookupApi.subCategories({
      search: search.trim() || undefined, category: categoryId ?? undefined, page, limit: LOOKUP_PAGE_SIZE,
    })
    return { options: res.results.map((sc) => subCategoryOption(sc, !categoryId)), hasMore: Boolean(res.next) }
  }
}

/** The parent category of a picked sub-category option, so picking a sub-category can fill in its category. */
export const parentCategoryOf = (option: SearchableOption | null): SearchableOption | null =>
  (option?.meta as SubCategoryMeta | undefined)?.category ?? null

/** A picked sub-category option as { id, label: its plain name } - for showing it once selected. */
export const plainSubCategoryOption = (option: SearchableOption): SearchableOption => ({
  id: option.id,
  label: (option.meta as SubCategoryMeta | undefined)?.name ?? option.label,
  meta: option.meta,
})

/** Labels for ids restored from somewhere else (e.g. URL filters) - one small request each. */
export async function resolveCategoryOption(id: number): Promise<SearchableOption | null> {
  const res = await categoryLookupApi.categories({ ids: String(id) })
  const c = res.results[0]
  return c ? { id: c.id, label: categoryLabelWithType(c) } : null
}

export async function resolveSubCategoryOption(id: number): Promise<SearchableOption | null> {
  const res = await categoryLookupApi.subCategories({ ids: String(id) })
  return res.results[0] ? subCategoryOption(res.results[0], false) : null
}
