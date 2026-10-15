/** Keeps a flatpickr calendar fully on screen.
 * Phones (< 640px wide): a centred sheet near the bottom of the screen over a dimmed backdrop.
 * Larger screens: below the field, or above it when there's no room, clamped inside the window,
 * and it follows the field while the page scrolls. */
import type flatpickr from 'flatpickr'

const MARGIN = 12
const GAP = 6
const MAX_WIDTH = 328
const MOBILE_BREAKPOINT = 640

type Instance = flatpickr.Instance & { _positionElement?: HTMLElement }

const listeners = new WeakMap<Instance, () => void>()
let backdrop: HTMLDivElement | null = null

function showBackdrop(show: boolean) {
  if (show && !backdrop) {
    backdrop = document.createElement('div')
    backdrop.className = 'calendar-sheet-backdrop'
    document.body.appendChild(backdrop)
  } else if (!show && backdrop) {
    backdrop.remove()
    backdrop = null
  }
}

function place(instance: Instance) {
  const calendar = instance.calendarContainer
  const anchor = instance._positionElement || instance.input
  if (!calendar || !anchor) return

  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(MAX_WIDTH, vw - MARGIN * 2)
  calendar.style.setProperty('width', `${width}px`, 'important')
  calendar.style.position = 'fixed'
  calendar.style.zIndex = '9999'
  calendar.style.right = 'auto'
  calendar.style.bottom = 'auto'

  const height = calendar.offsetHeight || 360
  const mobile = vw < MOBILE_BREAKPOINT
  showBackdrop(mobile)

  if (mobile) {
    calendar.classList.add('calendar-sheet')
    calendar.style.left = `${Math.round((vw - width) / 2)}px`
    calendar.style.top = `${Math.max(MARGIN, vh - height - MARGIN - 8)}px`
    return
  }

  calendar.classList.remove('calendar-sheet')
  const r = anchor.getBoundingClientRect()
  const left = Math.min(Math.max(MARGIN, r.left), vw - width - MARGIN)
  let top: number
  if (vh - r.bottom >= height + GAP + MARGIN) top = r.bottom + GAP
  else if (r.top >= height + GAP + MARGIN) top = r.top - height - GAP
  else top = Math.max(MARGIN, Math.min(r.bottom + GAP, vh - height - MARGIN))
  calendar.style.left = `${Math.round(left)}px`
  calendar.style.top = `${Math.round(top)}px`
}

/** Call from flatpickr's onOpen (and onMonthChange / onYearChange - the height can change). */
export function openCalendar(instance: Instance) {
  // Wait one frame so flatpickr has finished its own positioning and the height is known.
  requestAnimationFrame(() => place(instance))
  if (listeners.has(instance)) return
  const follow = () => place(instance)
  window.addEventListener('scroll', follow, true)
  window.addEventListener('resize', follow)
  listeners.set(instance, follow)
}

export function repositionCalendar(instance: Instance) {
  if (instance.isOpen) requestAnimationFrame(() => place(instance))
}

/** Call from flatpickr's onClose and when the picker is destroyed. */
export function closeCalendar(instance: Instance) {
  const follow = listeners.get(instance)
  if (follow) {
    window.removeEventListener('scroll', follow, true)
    window.removeEventListener('resize', follow)
    listeners.delete(instance)
  }
  showBackdrop(false)
}
