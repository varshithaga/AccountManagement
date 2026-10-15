import { useEffect, useRef } from 'react'
import flatpickr from 'flatpickr'
import 'flatpickr/dist/flatpickr.css'
import './DatePicker.css'
import { closeCalendar, openCalendar, repositionCalendar } from './calendarPosition'
import { Calendar } from 'lucide-react'

type DatePickerMode = 'single' | 'multiple' | 'range' | 'time'

interface DatePickerProps {
  id: string
  label?: string
  mode?: DatePickerMode
  value?: string
  onChange?: (date: string) => void
  placeholder?: string
  minDate?: string
  maxDate?: string
  disabled?: boolean
  fullWidth?: boolean
  className?: string
}

export default function DatePicker({
  id,
  label,
  mode = 'single',
  value,
  onChange,
  placeholder,
  minDate,
  maxDate,
  disabled = false,
  fullWidth = true,
  className = '',
}: DatePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<flatpickr.Instance | null>(null)
  const onChangeRef = useRef(onChange)

  // Update onChange ref without triggering re-initialization
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Initialize flatpickr once
  useEffect(() => {
    if (!inputRef.current) return

    if (pickerRef.current) {
      pickerRef.current.destroy()
    }

    pickerRef.current = flatpickr(inputRef.current, {
      mode,
      dateFormat: 'Y-m-d',
      defaultDate: value || undefined,
      minDate,
      maxDate,
      clickOpens: !disabled,
      allowInput: false,
      closeOnSelect: true,
      disableMobile: true, // always our styled calendar - never the phone's built-in picker
      appendTo: document.body,
      positionElement: inputRef.current,
      onChange: (selectedDates) => {
        if (onChangeRef.current && selectedDates.length > 0) {
          const localDate = selectedDates[0]
          const year = localDate.getFullYear()
          const month = String(localDate.getMonth() + 1).padStart(2, '0')
          const day = String(localDate.getDate()).padStart(2, '0')
          onChangeRef.current(`${year}-${month}-${day}`)
        }
      },
      onOpen: function (this: flatpickr.Instance) {
        this.calendarContainer?.addEventListener('click', (e: Event) => {
          e.stopPropagation()
        })
        openCalendar(this)
      },
      onClose: function (this: flatpickr.Instance) {
        closeCalendar(this)
      },
      onMonthChange: function (this: flatpickr.Instance) {
        repositionCalendar(this)
      },
    })

    return () => {
      if (pickerRef.current) {
        closeCalendar(pickerRef.current)
        pickerRef.current.destroy()
        pickerRef.current = null
      }
    }
  }, [mode, minDate, maxDate, disabled])

  // Sync an externally-changed value (including a cleared one) without destroying the instance.
  useEffect(() => {
    if (!pickerRef.current) return
    if (value) pickerRef.current.setDate(value, false)
    else pickerRef.current.clear(false)
  }, [value])

  return (
    <div className={`flex flex-col gap-1 ${fullWidth ? 'w-full' : 'w-auto'} ${className}`} onClick={(e) => e.stopPropagation()}>
      {label && (
        <label htmlFor={id} className="text-xs font-semibold text-muted">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        <input
          id={id}
          ref={inputRef}
          placeholder={placeholder || 'Select date'}
          defaultValue={value}
          readOnly
          disabled={disabled}
          className="h-12 w-full cursor-pointer rounded-xl border border-input bg-surface px-3 pr-10 text-sm font-medium text-ink outline-none transition-colors placeholder:text-muted focus:border-primary focus:ring-[3px] focus:ring-primary-soft disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-900 "
        />
        <div className="pointer-events-none absolute right-3 flex items-center text-muted">
          <Calendar className="h-4 w-4" />
        </div>
      </div>
    </div>
  )
}

