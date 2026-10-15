import { Link, useLocation } from 'react-router-dom'
import { Compass } from 'lucide-react'

export default function NotFoundPage() {
  const { pathname } = useLocation()
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-white/10 dark:bg-slate-900/60">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
        <Compass className="h-7 w-7" />
      </div>
      <p className="text-xs font-extrabold uppercase tracking-widest text-violet-700 dark:text-violet-300">404</p>
      <h1 className="mt-1 text-xl font-extrabold text-slate-900 dark:text-slate-100">Page not found</h1>
      <p className="mt-2 break-words text-sm text-slate-500 dark:text-slate-400">
        There is no page at <span className="font-mono font-semibold">{pathname}</span>. The link may be old or
        mistyped.
      </p>
      <Link to="/" className="mt-4 inline-block font-bold text-violet-700 hover:underline dark:text-violet-300">
        Go to my home page
      </Link>
    </div>
  )
}
