import { useEffect, useMemo, useRef } from 'react'
import flatpickr from 'flatpickr'
import 'flatpickr/dist/flatpickr.css'
import { Calendar } from 'lucide-react'
import { closeCalendar, openCalendar, repositionCalendar } from './calendarPosition'
type DateOption = flatpickr.Options.DateOption
type Hook = flatpickr.Options.Hook

export type DatePicker2Mode = 'single' | 'multiple' | 'range' | 'time'

export interface DatePicker2Props {
  id: string
  mode?: DatePicker2Mode
  value?: string | DateOption
  defaultDate?: DateOption
  onChange?: Hook | Hook[] | ((dateStr: string, dates: Date[]) => void)
  label?: string
  placeholder?: string
  minDate?: DateOption
  maxDate?: DateOption
  allowInput?: boolean
  highlightWeekdays?: number[]
  disabled?: boolean
  fullWidth?: boolean
  className?: string
}

export function DatePicker2({
  id,
  mode = 'single',
  value,
  defaultDate,
  onChange,
  label,
  placeholder = 'Select date',
  minDate,
  maxDate,
  allowInput = false,
  highlightWeekdays,
  disabled = false,
  fullWidth = true,
  className = '',
}: DatePicker2Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const flatpickrInstanceRef = useRef<flatpickr.Instance | null>(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const highlightedWeekdays = useMemo(() => {
    if (!highlightWeekdays || highlightWeekdays.length === 0) return undefined
    const normalized = highlightWeekdays.map((day) => ((day % 7) + 7) % 7)
    return Array.from(new Set(normalized))
  }, [highlightWeekdays])

  useEffect(() => {
    if (!inputRef.current) return

    // Destroy existing instance if any
    if (flatpickrInstanceRef.current) {
      flatpickrInstanceRef.current.destroy()
    }

    const applyPreferredStyles = (instance: flatpickr.Instance) => {
      const calendar = instance.calendarContainer
      if (!calendar) return
      calendar.classList.add('custom-datepicker-popup')

      const allDays = calendar.querySelectorAll('.flatpickr-day')
      allDays.forEach((day: Element) => {
        const dayElem = day as HTMLElement & { dateObj?: Date }
        const dateObj = dayElem.dateObj
        if (!highlightedWeekdays || highlightedWeekdays.length === 0 || !dateObj) {
          dayElem.classList.remove('preferred-day')
          return
        }

        if (highlightedWeekdays.includes(dateObj.getDay())) {
          dayElem.classList.add('preferred-day')
        } else {
          dayElem.classList.remove('preferred-day')
        }
      })
    }

    const initialDate = value || defaultDate || undefined

    flatpickrInstanceRef.current = flatpickr(inputRef.current, {
      mode: mode || 'single',
      static: false,
      disableMobile: true, // always our styled calendar - never the phone's built-in picker
      monthSelectorType: 'dropdown',
      dateFormat: 'Y-m-d',
      defaultDate: initialDate,
      clickOpens: !disabled,
      minDate,
      maxDate,
      allowInput,
      appendTo: document.body,
      positionElement: inputRef.current,
      onChange: (selectedDates, dateStr, instance) => {
        if (typeof onChangeRef.current === 'function') {
          ;(onChangeRef.current as any)(selectedDates, dateStr, instance)
          if ((onChangeRef.current as Function).length <= 2) {
            ;(onChangeRef.current as (dateStr: string, dates: Date[]) => void)(dateStr, selectedDates)
          }
        } else if (Array.isArray(onChangeRef.current)) {
          onChangeRef.current.forEach((hook) => hook(selectedDates, dateStr, instance))
        }
      },
      onOpen: (_selectedDates, _dateStr, instance) => {
        instance.calendarContainer?.classList.add('custom-datepicker-popup')
        openCalendar(instance)
      },
      onClose: (_selectedDates, _dateStr, instance) => closeCalendar(instance),
      onReady: (_selectedDates: Date[], _dateStr: string, instance: flatpickr.Instance) => {
        setTimeout(() => applyPreferredStyles(instance), 20)
      },
      onDayCreate: (_dObj: Date[], _dStr: string, _instance: flatpickr.Instance, dayElem: HTMLElement) => {
        const enrichedDay = dayElem as HTMLElement & { dateObj?: Date }
        const dateObj = enrichedDay.dateObj
        if (dateObj) {
          enrichedDay.dataset.weekday = dateObj.getDay().toString()
        } else {
          delete enrichedDay.dataset.weekday
        }

        if (highlightedWeekdays && highlightedWeekdays.length > 0 && dateObj) {
          if (highlightedWeekdays.includes(dateObj.getDay())) {
            dayElem.classList.add('preferred-day')
          } else {
            dayElem.classList.remove('preferred-day')
          }
        } else {
          dayElem.classList.remove('preferred-day')
        }
      },
      onMonthChange: (_selectedDates: Date[], _dateStr: string, instance: flatpickr.Instance) => {
        setTimeout(() => applyPreferredStyles(instance), 30)
        repositionCalendar(instance)
      },
      onYearChange: (_selectedDates: Date[], _dateStr: string, instance: flatpickr.Instance) => {
        setTimeout(() => applyPreferredStyles(instance), 30)
        repositionCalendar(instance)
      },
    })

    return () => {
      if (flatpickrInstanceRef.current) {
        closeCalendar(flatpickrInstanceRef.current)
        flatpickrInstanceRef.current.destroy()
        flatpickrInstanceRef.current = null
      }
    }
  }, [mode, id, minDate, maxDate, allowInput, disabled, highlightedWeekdays])

  // Sync value or defaultDate changes
  useEffect(() => {
    const target = value !== undefined ? value : defaultDate
    if (flatpickrInstanceRef.current) {
      if (target) {
        flatpickrInstanceRef.current.setDate(target, false)
      } else {
        flatpickrInstanceRef.current.clear()
      }
    }
  }, [value, defaultDate])

  // Inject CSS rules for flatpickr calendar z-index and card styling matching reference image
  useEffect(() => {
    const styleId = 'flatpickr-calendar-custom-card-theme'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `
        /* 1. Main Popup Container */
        .flatpickr-calendar.custom-datepicker-popup {
          background: var(--surface-muted) !important;
          border-radius: 24px !important;
          border: 1px solid var(--border) !important;
          box-shadow: 0 20px 30px -10px rgba(11, 46, 43, 0.1), 0 10px 15px -5px rgba(11, 46, 43, 0.05) !important;
          padding: 18px !important;
          width: 328px !important;
          font-family: inherit !important;
          z-index: 9999 !important;
        }

        .dark .flatpickr-calendar.custom-datepicker-popup,
        body.dark-mode .flatpickr-calendar.custom-datepicker-popup {
          background: var(--surface) !important;
          border-color: var(--border) !important;
          box-shadow: 0 20px 30px -10px rgba(11, 46, 43, 0.6) !important;
        }

        .flatpickr-calendar.custom-datepicker-popup::before,
        .flatpickr-calendar.custom-datepicker-popup::after {
          display: none !important;
        }

        /* 2. Month & Navigation Header */
        .flatpickr-calendar.custom-datepicker-popup .flatpickr-months {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          margin-bottom: 16px !important;
          position: relative !important;
          height: auto !important;
        }

        /* Prev and Next month circular pill buttons */
        .flatpickr-calendar.custom-datepicker-popup .flatpickr-prev-month,
        .flatpickr-calendar.custom-datepicker-popup .flatpickr-next-month {
          position: relative !important;
          top: auto !important;
          left: auto !important;
          right: auto !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          width: 38px !important;
          height: 38px !important;
          border-radius: 50% !important;
          background: var(--surface) !important;
          box-shadow: 0 2px 6px rgba(11, 46, 43, 0.06) !important;
          color: var(--text) !important;
          padding: 0 !important;
          transition: all 0.15s ease !important;
          margin: 0 !important;
          z-index: 10 !important;
        }

        .flatpickr-calendar.custom-datepicker-popup .flatpickr-prev-month:hover,
        .flatpickr-calendar.custom-datepicker-popup .flatpickr-next-month:hover {
          background: var(--surface) !important;
          transform: scale(1.05) !important;
          color: var(--primary) !important;
        }

        .dark .flatpickr-calendar.custom-datepicker-popup .flatpickr-prev-month,
        .dark .flatpickr-calendar.custom-datepicker-popup .flatpickr-next-month {
          background: var(--surface-muted) !important;
          color: var(--text) !important;
          box-shadow: 0 2px 6px rgba(11, 46, 43, 0.3) !important;
        }

        .flatpickr-calendar.custom-datepicker-popup .flatpickr-prev-month svg,
        .flatpickr-calendar.custom-datepicker-popup .flatpickr-next-month svg {
          width: 14px !important;
          height: 14px !important;
          fill: currentColor !important;
        }

        /* Center Month & Year Container */
        .flatpickr-calendar.custom-datepicker-popup .flatpickr-month {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          height: auto !important;
          background: transparent !important;
          overflow: visible !important;
        }

        .flatpickr-calendar.custom-datepicker-popup .flatpickr-current-month {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 8px !important;
          position: static !important;
          width: auto !important;
          padding: 0 !important;
          font-size: 15px !important;
          font-weight: 800 !important;
          color: var(--text) !important;
        }

        /* Styling Month Dropdown & Year Input as rounded white card badges with blue indicator */
        .flatpickr-calendar.custom-datepicker-popup .flatpickr-monthDropdown-months {
          background: var(--surface) !important;
          border-radius: 12px !important;
          padding: 6px 14px !important;
          font-weight: 800 !important;
          font-size: 15px !important;
          color: var(--text) !important;
          border: none !important;
          box-shadow: 0 2px 6px rgba(11, 46, 43, 0.05) !important;
          outline: none !important;
          cursor: pointer !important;
          appearance: none !important;
          -webkit-appearance: none !important;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='%230052FF'%3E%3Cpath d='M12 3l10 18H2z'/%3E%3C/svg%3E") !important;
          background-repeat: no-repeat !important;
          background-position: right 10px center !important;
          padding-right: 26px !important;
          margin-right: 4px !important;
        }

        .dark .flatpickr-calendar.custom-datepicker-popup .flatpickr-monthDropdown-months {
          background: var(--surface-muted) !important;
          color: var(--text) !important;
          box-shadow: 0 2px 6px rgba(11, 46, 43, 0.3) !important;
        }

        .flatpickr-calendar.custom-datepicker-popup .numInputWrapper {
          background: var(--surface) !important;
          border-radius: 12px !important;
          padding: 6px 14px !important;
          font-weight: 800 !important;
          font-size: 15px !important;
          color: var(--text) !important;
          box-shadow: 0 2px 6px rgba(11, 46, 43, 0.05) !important;
          display: inline-flex !important;
          align-items: center !important;
          position: relative !important;
          width: auto !important;
          margin-left: 4px !important;
        }

        .dark .flatpickr-calendar.custom-datepicker-popup .numInputWrapper {
          background: var(--surface-muted) !important;
          color: var(--text) !important;
          box-shadow: 0 2px 6px rgba(11, 46, 43, 0.3) !important;
        }

        .flatpickr-calendar.custom-datepicker-popup .numInputWrapper input.cur-year {
          font-weight: 800 !important;
          font-size: 15px !important;
          color: var(--text) !important;
          border: none !important;
          background: transparent !important;
          padding: 0 !important;
          width: 44px !important;
          outline: none !important;
        }

        .dark .flatpickr-calendar.custom-datepicker-popup .numInputWrapper input.cur-year {
          color: var(--text) !important;
        }

        .flatpickr-calendar.custom-datepicker-popup .numInputWrapper .arrowUp,
        .flatpickr-calendar.custom-datepicker-popup .numInputWrapper .arrowDown {
          display: none !important;
        }

        .flatpickr-calendar.custom-datepicker-popup .numInputWrapper::after {
          content: '' !important;
          display: inline-block !important;
          width: 0 !important;
          height: 0 !important;
          border-left: 4px solid transparent !important;
          border-right: 4px solid transparent !important;
          border-bottom: 6px solid var(--primary) !important;
          margin-left: 6px !important;
        }

        /* 3. Weekday Header */
        .flatpickr-calendar.custom-datepicker-popup .flatpickr-weekdays {
          margin-bottom: 8px !important;
          height: 28px !important;
        }

        .flatpickr-calendar.custom-datepicker-popup span.flatpickr-weekday {
          font-weight: 700 !important;
          font-size: 13px !important;
          color: var(--text-muted) !important;
        }

        .dark .flatpickr-calendar.custom-datepicker-popup span.flatpickr-weekday {
          color: var(--text-muted) !important;
        }

        /* 4. Day Cells Grid */
        .flatpickr-calendar.custom-datepicker-popup .dayContainer {
          display: grid !important;
          grid-template-columns: repeat(7, 1fr) !important;
          gap: 6px !important;
          width: 100% !important;
          min-width: 100% !important;
          max-width: 100% !important;
          justify-items: center !important;
        }

        .flatpickr-calendar.custom-datepicker-popup .flatpickr-days {
          width: 100% !important;
        }

        .flatpickr-calendar.custom-datepicker-popup .flatpickr-day {
          width: 36px !important;
          height: 36px !important;
          max-width: 36px !important;
          line-height: 36px !important;
          border-radius: 10px !important;
          background-color: var(--surface) !important;
          border: 1px solid var(--border-soft) !important;
          box-shadow: 0 1px 3px rgba(11, 46, 43, 0.04) !important;
          font-weight: 700 !important;
          font-size: 14px !important;
          color: var(--text) !important;
          margin: 0 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          transition: all 0.15s ease !important;
        }

        .dark .flatpickr-calendar.custom-datepicker-popup .flatpickr-day {
          background-color: var(--surface-muted) !important;
          border-color: var(--border-soft) !important;
          color: var(--text) !important;
          box-shadow: 0 1px 3px rgba(11, 46, 43, 0.2) !important;
        }

        /* Prev / Next Month Days (Greyed out, no white box) */
        .flatpickr-calendar.custom-datepicker-popup .flatpickr-day.prevMonthDay,
        .flatpickr-calendar.custom-datepicker-popup .flatpickr-day.nextMonthDay,
        .flatpickr-calendar.custom-datepicker-popup .flatpickr-day.flatpickr-disabled {
          background-color: transparent !important;
          border: none !important;
          box-shadow: none !important;
          color: color-mix(in srgb, var(--text-muted) 45%, transparent) !important;
          font-weight: 600 !important;
        }

        .dark .flatpickr-calendar.custom-datepicker-popup .flatpickr-day.prevMonthDay,
        .dark .flatpickr-calendar.custom-datepicker-popup .flatpickr-day.nextMonthDay,
        .dark .flatpickr-calendar.custom-datepicker-popup .flatpickr-day.flatpickr-disabled {
          color: color-mix(in srgb, var(--text-muted) 45%, transparent) !important;
        }

        /* Hover state */
        .flatpickr-calendar.custom-datepicker-popup .flatpickr-day:hover:not(.selected):not(.prevMonthDay):not(.nextMonthDay) {
          background-color: var(--primary-soft) !important;
          border-color: var(--primary-border) !important;
          color: var(--primary-hover) !important;
          transform: translateY(-1px) !important;
        }

        /* Selected Day (Vivid Blue Filled Card matching image) */
        .flatpickr-calendar.custom-datepicker-popup .flatpickr-day.selected,
        .flatpickr-calendar.custom-datepicker-popup .flatpickr-day.startRange,
        .flatpickr-calendar.custom-datepicker-popup .flatpickr-day.endRange {
          background-color: var(--primary) !important;
          color: #ffffff !important;
          border: none !important;
          box-shadow: 0 4px 12px rgba(13, 122, 108, 0.35) !important;
          font-weight: 800 !important;
        }

        /* Preferred / Highlighted Day (Soft Blue Filled Card matching day '7' in reference image) */
        .flatpickr-calendar.custom-datepicker-popup .flatpickr-day.preferred-day:not(.selected) {
          background-color: var(--primary-soft) !important;
          color: var(--primary-hover) !important;
          border: 1px solid var(--primary-border) !important;
          font-weight: 800 !important;
        }

        .dark .flatpickr-calendar.custom-datepicker-popup .flatpickr-day.preferred-day:not(.selected) {
          background-color: var(--primary-soft) !important;
          color: var(--primary) !important;
          border-color: var(--primary-border) !important;
        }
      `
      document.head.appendChild(style)
    }
  }, [])

  return (
    <div className={`flex flex-col gap-1 ${fullWidth ? 'w-full' : 'w-auto'} ${className}`}>
      {label && (
        <label htmlFor={id} className="text-xs font-semibold text-muted">
          {label}
        </label>
      )}

      <div className="relative flex items-center">
        <input
          id={id}
          ref={inputRef}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={!allowInput}
          className="h-12 w-full rounded-xl border border-input bg-surface px-3 pr-10 text-sm font-medium text-ink outline-none transition-colors placeholder:text-muted focus:border-primary focus:ring-[3px] focus:ring-primary-soft disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-900 "
        />

        <span className="pointer-events-none absolute right-3 flex items-center text-muted">
          <Calendar className="h-4 w-4" />
        </span>
      </div>
    </div>
  )
}

export default DatePicker2

