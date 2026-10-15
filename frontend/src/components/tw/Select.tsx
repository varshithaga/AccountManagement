import { Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, ChangeEvent, CSSProperties, KeyboardEvent, ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

interface Opt { value: string; label: ReactNode; text: string; disabled: boolean }

const MENU_MAX_HEIGHT = 288
const MENU_GAP = 4
const VIEWPORT_MARGIN = 8

const textOf = (node: ReactNode): string =>
  Children.toArray(node).map((n) => (typeof n === 'string' || typeof n === 'number' ? String(n)
    : isValidElement<{ children?: ReactNode }>(n) ? textOf(n.props.children) : '')).join('')

/** Flattens <option> children (also inside fragments / arrays from .map). */
function collectOptions(children: ReactNode, out: Opt[] = []): Opt[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const el = child as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>
    if (el.type === Fragment) collectOptions(el.props.children, out)
    else if (el.type === 'option') {
      const label = el.props.children
      out.push({ value: String(el.props.value ?? textOf(label)), label, text: textOf(label), disabled: Boolean(el.props.disabled) })
    }
  })
  return out
}

/** Dropdown with the same API as a native <select> (pass <option> children; onChange gets
 * e.target.value), but the option list is drawn by the app instead of the OS - so it matches
 * the page's size and zoom, and stays inside the viewport on tablets and small laptops. */
export function Select({
  id, label, value, onChange, children, className = '',
}: {
  id: string
  label?: string
  value: string | number
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void
  children: ReactNode
  className?: string
}) {
  const options = useMemo(() => collectOptions(children), [children])
  const selectedIndex = options.findIndex((o) => o.value === String(value))
  const selected = options[selectedIndex]
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const listId = useId()

  const choose = (opt: Opt) => {
    if (opt.disabled) return
    setOpen(false)
    buttonRef.current?.focus()
    if (opt.value === String(value)) return
    const target = { value: opt.value, id } as HTMLSelectElement
    onChange({ target, currentTarget: target } as ChangeEvent<HTMLSelectElement>)
  }

  // Fixed-position menu portalled to <body>: not clipped by scrolling panels, flips up when
  // there's no room below, and is kept inside the viewport horizontally.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP
      const spaceAbove = rect.top - MENU_GAP
      const openUp = spaceBelow < Math.min(MENU_MAX_HEIGHT, 200) && spaceAbove > spaceBelow
      const maxHeight = Math.max(120, Math.min(MENU_MAX_HEIGHT, (openUp ? spaceAbove : spaceBelow) - VIEWPORT_MARGIN))
      const viewportWidth = document.documentElement.clientWidth
      const width = Math.min(rect.width, viewportWidth - 2 * VIEWPORT_MARGIN)
      const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, viewportWidth - width - VIEWPORT_MARGIN))
      setMenuStyle({
        position: 'fixed', left, minWidth: width, maxWidth: viewportWidth - 2 * VIEWPORT_MARGIN, maxHeight,
        ...(openUp ? { bottom: window.innerHeight - rect.top + MENU_GAP } : { top: rect.bottom + MENU_GAP }),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  // Close on a click / tap outside.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!buttonRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (open && active >= 0) menuRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const openMenu = () => { setActive(selectedIndex); setOpen(true) }

  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i].disabled) return i
    return from
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openMenu() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => step(i, 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => step(i, -1)) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(step(-1, 1)) }
    else if (e.key === 'End') { e.preventDefault(); setActive(step(options.length, -1)) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[active]) choose(options[active]) }
    else if (e.key === 'Escape' || e.key === 'Tab') setOpen(false)
    else if (e.key.length === 1) {
      // Type-ahead: jump to the next option starting with that letter.
      const ch = e.key.toLowerCase()
      const n = options.length
      for (let k = 1; k <= n; k++) {
        const i = (active + k) % n
        if (!options[i].disabled && options[i].text.trim().toLowerCase().startsWith(ch)) { setActive(i); break }
      }
    }
  }

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      {label && <label htmlFor={id} className="text-[13px] font-semibold text-ink">{label}</label>}
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={`flex h-12 w-full min-w-0 items-center justify-between gap-2 rounded-xl border bg-surface px-3.5 text-left text-sm font-medium text-ink outline-none transition-colors focus:border-primary focus:ring-[3px] focus:ring-primary-soft ${open ? 'border-primary ring-[3px] ring-primary-soft' : 'border-input'}`}
      >
        <span className="truncate">{selected?.label ?? ''}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && menuStyle && createPortal(
        <ul
          ref={menuRef}
          id={listId}
          role="listbox"
          style={menuStyle}
          className="z-[80] overflow-auto rounded-xl border border-border bg-surface py-1 shadow-xl"
        >
          {options.map((opt, i) => {
            const isSelected = i === selectedIndex
            return (
              <li
                key={`${opt.value}-${i}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={opt.disabled}
                onMouseEnter={() => !opt.disabled && setActive(i)}
                onClick={() => choose(opt)}
                className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm font-medium ${opt.disabled
                  ? 'cursor-not-allowed text-slate-300 dark:text-slate-600'
                  : i === active ? 'bg-slate-100 dark:bg-white/10' : ''} ${isSelected ? 'text-primary' : opt.disabled ? '' : 'text-slate-700 dark:text-slate-200'}`}
              >
                <span className="break-words">{opt.label}</span>
                {isSelected && <Check className="h-4 w-4 shrink-0" />}
              </li>
            )
          })}
        </ul>,
        document.body,
      )}
    </div>
  )
}
