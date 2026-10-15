import { useCallback, useEffect, useState } from 'react'
import SearchableSelect from './SearchableSelect'
import type { SearchableOption } from './SearchableSelect'
import { bankAccountLookupApi } from '../api/resources'
import type { BankAccountOption } from '../api/resources'

const PAGE_SIZE = 20

const toOption = (a: BankAccountOption): SearchableOption => ({
  id: a.id,
  label: `${a.name}${a.bank_name ? ` · ${a.bank_name}` : ''}${a.is_active ? '' : ' (inactive)'}`,
  meta: a.name,
})

/**
 * Bank-account dropdown backed by the paged /lookups/bank-accounts/ search (20 per page,
 * more on scroll) - replaces downloading every account for a native <select>.
 * Clearing it means "all accounts" wherever it's used as a filter.
 */
export default function BankAccountSelect({
  value, onChange, label = 'Bank Account', placeholder = 'All bank accounts', size = 'small', required, disabled,
}: {
  value: number | '' | null | undefined
  /** name: the account's plain name (e.g. for export headers), null when cleared. */
  onChange: (accountId: number | null, name: string | null) => void
  label?: string
  placeholder?: string
  size?: 'small' | 'medium'
  required?: boolean
  disabled?: boolean
}) {
  const [option, setOption] = useState<SearchableOption | null>(null)
  const id = value ? Number(value) : null

  // A value set from outside (URL filter, preselected upload account) only carries the id -
  // fetch just that account's label.
  useEffect(() => {
    if (!id) {
      setOption(null)
      return
    }
    if (option?.id === id) return
    setOption({ id, label: `Account #${id}` })
    let cancelled = false
    bankAccountLookupApi.search({ ids: String(id) })
      .then((res) => { if (!cancelled && res.results[0]) setOption(toOption(res.results[0])) })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const fetchOptions = useCallback(async ({ search, page }: { search: string; page: number }) => {
    const res = await bankAccountLookupApi.search({ search: search.trim() || undefined, page, limit: PAGE_SIZE })
    return { options: res.results.map(toOption), hasMore: Boolean(res.next) }
  }, [])

  return (
    <SearchableSelect
      label={label}
      placeholder={placeholder}
      value={option}
      onChange={(opt) => { setOption(opt); onChange(opt ? opt.id : null, opt ? String(opt.meta ?? opt.label) : null) }}
      fetchOptions={fetchOptions}
      size={size}
      required={required}
      disabled={disabled}
    />
  )
}

/** True once at least one bank account exists - a 1-row request instead of the full list. */
export async function hasAnyBankAccount(): Promise<boolean> {
  const res = await bankAccountLookupApi.search({ limit: 1 })
  return res.count > 0
}
