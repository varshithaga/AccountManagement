import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * A right-anchored slide-in panel. Mount it only while there is data to show
 * (the caller typically returns null when its `data` prop is falsy) — there is
 * no exit transition, matching the previous MUI Drawer's unmount behavior.
 */
export function Drawer({
  title, onClose, children, widthClassName = 'w-full sm:w-[460px] md:w-[500px]',
}: {
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  widthClassName?: string
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60]">
      <div
        className={`absolute inset-0 bg-[rgba(10,26,58,0.62)] transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        className={`absolute right-0 top-0 flex h-full flex-col overflow-y-auto rounded-l-[24px] border-l border-border bg-surface p-6 shadow-2xl transition-transform duration-200 ${widthClassName} ${visible ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {title !== undefined && (
          <div className="mb-2 flex items-center justify-between">
            {title}
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted hover:bg-surface-muted hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
