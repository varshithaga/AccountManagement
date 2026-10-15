import { useCallback, useEffect, useState } from 'react'

/** Fixed totals for a page's summary cards, from its <resource>/summary/ endpoint - unlike the list,
 * they ignore the page's search, filters and paging. Call refresh() after anything that adds,
 * changes or deletes records. */
export function usePageSummary<T>(load: () => Promise<T>): [T | null, () => void] {
  const [summary, setSummary] = useState<T | null>(null)
  const refresh = useCallback(() => {
    load().then(setSummary).catch(() => {
      // Only informational - the page still works without it.
    })
  }, [load])
  useEffect(() => { refresh() }, [refresh])
  return [summary, refresh]
}
