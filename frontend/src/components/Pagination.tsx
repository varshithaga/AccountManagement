import { ChevronLeft, ChevronRight } from 'lucide-react'

export const ROWS_PER_PAGE_OPTIONS = [10, 20, 50, 100]
export const DEFAULT_ROWS_PER_PAGE = 20

// Clamps `page` (0-indexed) so it never points past the last available page
// once `count` shrinks (e.g. after a search or filter is applied).
export function clampPage(page: number, rowsPerPage: number, count: number): number {
  const maxPage = Math.max(0, Math.ceil(count / rowsPerPage) - 1)
  return Math.min(Math.max(0, page), maxPage)
}

export function paginate<T>(items: T[], page: number, rowsPerPage: number): T[] {
  const start = page * rowsPerPage
  return items.slice(start, start + rowsPerPage)
}

export function getPageRange(currentPage: number, totalPages: number): (number | string)[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, '...', totalPages]
  }

  if (currentPage >= totalPages - 3) {
    return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  }

  return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages]
}

interface PaginationProps {
  count: number
  page: number
  rowsPerPage: number
  onPageChange: (page: number) => void
  onRowsPerPageChange: (rowsPerPage: number) => void
  className?: string
  /** 'top' when the bar sits above the table (divider below it instead of above). */
  position?: 'top' | 'bottom'
}

export default function Pagination({
  count,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  className = '',
  position = 'bottom',
}: PaginationProps) {
  const clampedPage = clampPage(page, rowsPerPage, count)
  const maxPage = Math.max(0, Math.ceil(count / rowsPerPage) - 1)
  const totalPages = maxPage + 1
  const currentDisplayPage = clampedPage + 1
  const startItem = count === 0 ? 0 : clampedPage * rowsPerPage + 1
  const endItem = Math.min(count, (clampedPage + 1) * rowsPerPage)

  const pageItems = getPageRange(currentDisplayPage, totalPages)

  return (
    <div className={`flex flex-col gap-3 ${position === 'top' ? 'border-b' : 'border-t'} border-border-soft px-6 py-3.5 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <span>Rows per page:</span>
        <select
          value={rowsPerPage}
          onChange={(e) => onRowsPerPageChange(Number(e.target.value))}
          className="num h-[38px] rounded-[10px] border border-input bg-surface px-2 text-[13px] font-semibold text-ink outline-none transition-colors focus:border-primary focus:ring-[3px] focus:ring-primary-soft"
        >
          {ROWS_PER_PAGE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <span className="ml-2 font-medium">
          Showing <span className="num">{startItem}–{endItem}</span> of <span className="num">{count}</span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1 self-end sm:self-auto">
        <button
          type="button"
          disabled={clampedPage === 0}
          onClick={() => onPageChange(clampedPage - 1)}
          className="flex h-[38px] items-center gap-1 rounded-[10px] px-3 text-[13px] font-semibold text-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span>Prev</span>
        </button>

        {pageItems.map((item, idx) => {
          if (typeof item === 'number') {
            const isActive = item === currentDisplayPage
            return (
              <button
                key={item}
                type="button"
                onClick={() => onPageChange(item - 1)}
                className={`num flex h-[38px] min-w-[38px] items-center justify-center rounded-[10px] px-2 text-[13px] font-semibold transition-colors ${
                  isActive
                    ? 'bg-sidebar text-white dark:bg-primary'
                    : 'text-ink hover:bg-surface-muted'
                }`}
              >
                {item}
              </button>
            )
          }

          return (
            <span
              key={`dots-${idx}`}
              className="flex h-[38px] min-w-[24px] items-center justify-center px-1 text-[13px] font-semibold text-muted select-none"
            >
              ...
            </span>
          )
        })}

        <button
          type="button"
          disabled={clampedPage >= maxPage}
          onClick={() => onPageChange(clampedPage + 1)}
          className="flex h-[38px] items-center gap-1 rounded-[10px] px-3 text-[13px] font-semibold text-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span>Next</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}


