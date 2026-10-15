import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, UIEvent } from 'react'
import { createPortal } from 'react-dom'
import { Spinner } from './tw'

export interface SearchableOption {
  id: number
  label: string
  /** Extra data the caller attached to the option (e.g. a sub-category's parent category). */
  meta?: unknown
}

interface FetchPageResult {
  options: SearchableOption[]
  hasMore: boolean
}

interface SearchableSelectProps {
  label: string
  value: SearchableOption | null
  onChange: (option: SearchableOption | null) => void
  fetchOptions: (params: { search: string; page: number }) => Promise<FetchPageResult>
  placeholder?: string
  disabled?: boolean
  required?: boolean
  size?: 'small' | 'medium'
  fullWidth?: boolean
  /** Bump this (e.g. a parent category id) to clear loaded options and refetch — for dependent dropdowns. */
  resetKey?: string | number | null
  /** Optional handler to trigger creation of a new item directly from inside the dropdown list. */
  onCreateNew?: () => void
  /** Custom label for the create new option at the bottom of the dropdown. */
  createNewText?: string
}

const DEBOUNCE_MS = 300
const SCROLL_THRESHOLD_PX = 48
const CREATE_NEW_ID = -99999
const MENU_MAX_HEIGHT = 288 // matches max-h-72
const MENU_GAP = 4
const VIEWPORT_MARGIN = 8

export default function SearchableSelect({
  label, value, onChange, fetchOptions, placeholder, disabled, required,
  size = 'small', resetKey, onCreateNew, createNewText,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState(value?.label ?? '')
  const [options, setOptions] = useState<SearchableOption[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const requestId = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)

  useEffect(() => {
    if (!open) setInputValue(value?.label ?? '')
  }, [value, open])

  // The menu is portalled to <body> with fixed positioning, so a scrolling/clipping
  // ancestor (e.g. a table's overflow-x-auto wrapper) can't cut it off. It opens upward
  // when there isn't room below - e.g. on the last rows of a table.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP
      const spaceAbove = rect.top - MENU_GAP
      const openUp = spaceBelow < Math.min(MENU_MAX_HEIGHT, 200) && spaceAbove > spaceBelow
      const maxHeight = Math.max(120, Math.min(MENU_MAX_HEIGHT, (openUp ? spaceAbove : spaceBelow) - 8))
      // Keep the menu inside the viewport horizontally (tablets / narrow windows):
      // never wider than the screen, and shifted left if it would run off the right edge.
      const viewportWidth = document.documentElement.clientWidth
      const width = Math.min(Math.max(rect.width, 220), viewportWidth - 2 * VIEWPORT_MARGIN)
      const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, viewportWidth - width - VIEWPORT_MARGIN))
      setMenuStyle({
        position: 'fixed',
        left,
        width,
        maxHeight,
        ...(openUp ? { bottom: window.innerHeight - rect.top + MENU_GAP } : { top: rect.bottom + MENU_GAP }),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true) // capture: also catches scrolling containers
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const runFetch = useCallback((search: string, pageToLoad: number, append: boolean) => {
    const id = ++requestId.current
    setLoading(true)
    fetchOptions({ search, page: pageToLoad })
      .then((result) => {
        if (id !== requestId.current) return
        setOptions((prev) => (append ? [...prev, ...result.options] : result.options))
        setHasMore(result.hasMore)
        setPage(pageToLoad)
        setLoading(false)
      })
      .catch(() => {
        if (id !== requestId.current) return
        setLoading(false)
      })
  }, [fetchOptions])

  useEffect(() => {
    if (!open) return
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runFetch(inputValue, 1, false), DEBOUNCE_MS)
    return () => clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inputValue])

  useEffect(() => {
    setOptions([])
    setPage(1)
    setHasMore(false)
    if (open) runFetch(inputValue, 1, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (loading || !hasMore) return
    const el = event.currentTarget
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD_PX) {
      runFetch(inputValue, page + 1, true)
    }
  }

  const displayOptions = useMemo(() => {
    if (!onCreateNew) return options
    const labelText = createNewText || 'Create New'
    return [...options, { id: CREATE_NEW_ID, label: labelText }]
  }, [options, onCreateNew, createNewText])

  const selectOption = (option: SearchableOption) => {
    if (option.id === CREATE_NEW_ID) {
      setOpen(false)
      onCreateNew?.()
      return
    }
    onChange(option)
    setInputValue(option.label)
    setOpen(false)
    inputRef.current?.blur()
  }

  const handleFocus = () => {
    if (disabled) return
    setOpen(true)
    inputRef.current?.select()
  }

  const handleClear = () => {
    onChange(null)
    setInputValue('')
    inputRef.current?.focus()
    setOpen(true)
  }

  const inputHeight = size === 'small' ? 'h-10' : 'h-12'

  return (
    <div className="relative flex flex-col gap-1">
      {label && (
        <label className="text-xs font-semibold text-muted">
          {label}
          {required && <span className="text-rose-500"> *</span>}
        </label>
      )}
      <div ref={anchorRef} className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={handleFocus}
          onChange={(e) => { setInputValue(e.target.value); setOpen(true) }}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() } }}
          className={`w-full ${inputHeight} rounded-xl border border-input bg-surface px-3 pr-8 text-sm font-medium text-ink outline-none transition-colors placeholder:text-muted focus:border-primary focus:ring-[3px] focus:ring-primary-soft disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-900 `}
        />
        <span className="pointer-events-none absolute right-3 flex items-center">
          {loading ? (
            <Spinner size={14} />
          ) : value && !disabled ? (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => { e.preventDefault(); handleClear() }}
              className="pointer-events-auto text-muted hover:text-slate-600 dark:hover:text-slate-300"
            >
              ×
            </button>
          ) : null}
        </span>
      </div>

      {open && !disabled && menuStyle && createPortal(
        <div
          onScroll={handleScroll}
          onMouseDown={(e) => e.preventDefault()}
          style={menuStyle}
          className="z-[80] overflow-auto rounded-xl border border-border bg-surface py-1 shadow-xl "
        >
          {displayOptions.length === 0 && !loading && (
            onCreateNew ? (
              <button
                type="button"
                onClick={() => { setOpen(false); onCreateNew() }}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm font-bold text-violet-600 hover:bg-violet-50 dark:text-violet-400 dark:hover:bg-primary-soft"
              >
                {createNewText || 'Create New'}
              </button>
            ) : (
              <div className="px-3 py-2 text-sm text-muted">No options</div>
            )
          )}

          {displayOptions.map((option) => {
            const isCreateNew = option.id === CREATE_NEW_ID
            const isSelected = value?.id === option.id
            return (
              <button
                type="button"
                key={option.id}
                onClick={() => selectOption(option)}
                className={
                  isCreateNew
                    ? 'flex w-full items-center border-t border-border-soft px-3 py-2 text-left text-sm font-bold text-violet-600 hover:bg-violet-50 dark:text-violet-400 dark:hover:bg-primary-soft'
                    : `flex w-full items-center break-words px-3 py-2 text-left text-sm font-medium hover:bg-surface-muted ${isSelected ? 'bg-violet-50/60 text-violet-700 dark:bg-primary-soft dark:text-violet-300' : 'text-ink'}`
                }
              >
                {option.label}
              </button>
            )
          })}

          {loading && (
            <div className="flex items-center justify-center py-2">
              <Spinner size={16} />
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
