import DatePicker2 from '../DatePicker2'

/** A single date (YYYY-MM-DD) - the app's styled calendar on every device, never the browser's built-in picker. */
export function DateField({
  id, label, value, onChange, min, max, className = '',
}: {
  id: string
  label?: string
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  className?: string
}) {
  return (
    <DatePicker2
      id={id}
      label={label}
      value={value}
      minDate={min}
      maxDate={max}
      className={className}
      // DatePicker2 also calls this with the selected Date[] first - only the date string is wanted.
      onChange={(dateStr: unknown) => { if (typeof dateStr === 'string') onChange(dateStr) }}
    />
  )
}
