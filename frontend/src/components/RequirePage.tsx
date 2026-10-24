import { type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ShieldAlert, UserCog } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { ALL_PAGES, type PageKey } from '../access/pages'

function Notice({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-border bg-surface p-8 text-center ">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-warning-soft text-warning-text ">
        {icon}
      </div>
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      <div className="mt-2 text-sm text-muted">{children}</div>
    </div>
  )
}

/** Renders the page only when the user's role includes it; otherwise an "access denied" notice. */
export default function RequirePage({ page, children }: { page: PageKey; children: ReactNode }) {
  const { hasPage, user } = useAuth()
  if (hasPage(page)) return children
  return (
    <Notice icon={<ShieldAlert className="h-7 w-7" />} title="You don't have access to this page">
      <p>
        Your role{user?.role_name ? ` (${user.role_name})` : ''} does not include this page. Ask an administrator if
        you need it.
      </p>
      <Link to="/" className="mt-4 inline-block font-bold text-violet-700 hover:underline dark:text-violet-300">
        Go to my home page
      </Link>
    </Notice>
  )
}

/** The testing tools: only for administrators, and only while the server has TESTING_TOOLS on. */
export function RequireTestingTools({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user?.testing_tools) return children
  return (
    <Notice icon={<ShieldAlert className="h-7 w-7" />} title="Testing tools are turned off">
      <p>
        These tools can delete journal entries in bulk, so they are only for administrators and only while
        TESTING_TOOLS is set to true in backend/.env.
      </p>
      <Link to="/" className="mt-4 inline-block font-bold text-violet-700 hover:underline dark:text-violet-300">
        Go to my home page
      </Link>
    </Notice>
  )
}

/** "/" - sends the user to the first page their role opens. */
export function HomeRedirect() {
  const { hasPage } = useAuth()
  const first = ALL_PAGES.find((p) => hasPage(p.key))
  if (first) return <Navigate to={first.path} replace />
  return (
    <Notice icon={<UserCog className="h-7 w-7" />} title="Your account is waiting for access">
      <p>
        No role has been assigned to your account yet, so there are no pages to show. Ask an administrator to give
        you a role on the User Management page, then reload this page.
      </p>
    </Notice>
  )
}
