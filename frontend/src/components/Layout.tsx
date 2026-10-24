import { Suspense, useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  Menu, LogOut, LayoutDashboard, Folders, Tag, Landmark, Hash,
  Receipt, ArrowLeftRight, BarChart3, Wallet, Scale, GitCompare,
  Moon, Sun, X, BookOpen, Link2, ListChecks, BookOpenCheck, GitMerge, Users,
  ChevronDown, Settings, Lock, Waves, NotebookText, FlaskConical,
  Contact, Truck, Package, FileText, ShoppingCart, HandCoins, Hourglass, Percent, History,
  Repeat, Boxes, ReceiptIndianRupee, Sparkles,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { ALL_PAGES, PAGE_GROUPS, type PageKey } from '../access/pages'
import { useThemeMode } from '../context/ThemeModeContext'
import { Spinner } from './tw'
import { LogoMark } from './Logo'

/* Deep Teal & Amber shell (design tokens in index.css). */

const DRAWER_WIDTH = 248

interface NavSubItem {
  label: string
  path: string
}

interface NavItem {
  label: string
  path: string
  icon: React.ReactNode
  subItems?: NavSubItem[]
}

const ICON = 'h-[18px] w-[18px] shrink-0 stroke-[1.8]'

const PAGE_ICONS: Record<PageKey, React.ReactNode> = {
  dashboard: <LayoutDashboard className={ICON} />,
  workflow: <ListChecks className={ICON} />,
  menu_guide: <BookOpen className={ICON} />,
  categories: <Folders className={ICON} />,
  category_keywords: <Tag className={ICON} />,
  bai_codes: <Hash className={ICON} />,
  bank_accounts: <Landmark className={ICON} />,
  bank_statements: <Receipt className={ICON} />,
  statement_continuity: <Link2 className={ICON} />,
  transactions: <ArrowLeftRight className={ICON} />,
  journal_entries: <BookOpenCheck className={ICON} />,
  bank_reconciliation: <GitMerge className={ICON} />,
  period_close: <Lock className={ICON} />,
  clients: <Contact className={ICON} />,
  suppliers: <Truck className={ICON} />,
  products: <Package className={ICON} />,
  sales_invoices: <FileText className={ICON} />,
  purchase_bills: <ShoppingCart className={ICON} />,
  payments: <HandCoins className={ICON} />,
  recurring_invoices: <Repeat className={ICON} />,
  inventory: <Boxes className={ICON} />,
  receivables_payables: <Hourglass className={ICON} />,
  profit_and_loss: <BarChart3 className={ICON} />,
  balance_sheet: <Wallet className={ICON} />,
  cash_flow: <Waves className={ICON} />,
  trial_balance: <Scale className={ICON} />,
  account_ledger: <NotebookText className={ICON} />,
  reports_comparison: <GitCompare className={ICON} />,
  gst_summary: <Percent className={ICON} />,
  tds_summary: <ReceiptIndianRupee className={ICON} />,
  ai_assistant: <Sparkles className={ICON} />,
  user_management: <Users className={ICON} />,
  audit_log: <History className={ICON} />,
}

/** Short headings for the sidebar groups and the breadcrumb. */
const GROUP_LABEL: Record<string, string> = {
  Overview: 'Overview',
  Masters: 'Masters',
  'Operations & Bookkeeping': 'Bookkeeping',
  'Financial Statements & Insights': 'Reports',
  Administration: 'Admin',
}

/** Testing-only tools - not role pages of their own; shown only to administrators while the server has
 * TESTING_TOOLS on (they can wipe a bank's journal entries). */
const TESTING_PAGES = [
  { label: 'Delete Month Journals', path: '/testing/delete-month-journals' },
]

const NAV_PATHS = ALL_PAGES.map((p) => p.path)

/** True when a more specific nav item (e.g. /bank-statements/continuity) owns the current
 * path, so its parent (/bank-statements) shouldn't also show as active. */
const isShadowed = (path: string, pathname: string) =>
  NAV_PATHS.some((p) => p !== path && p.startsWith(`${path}/`) && pathname.startsWith(p))

/** The sidebar page (and its group) the URL belongs to - for the breadcrumb. */
function currentPage(pathname: string) {
  let best: { label: string; group: string; len: number } | null = null
  for (const group of PAGE_GROUPS) {
    for (const p of group.pages) {
      if ((pathname === p.path || pathname.startsWith(`${p.path}/`)) && (!best || p.path.length > best.len)) {
        best = { label: p.label, group: GROUP_LABEL[group.title] ?? group.title, len: p.path.length }
      }
    }
  }
  if (!best && pathname.startsWith('/profile')) return { label: 'Profile Settings', group: 'Account' }
  if (!best) {
    const testing = TESTING_PAGES.find((p) => pathname.startsWith(p.path))
    if (testing) return { label: testing.label, group: 'Testing' }
  }
  return best
}

export default function Layout() {
  const { logout, user, hasPage } = useAuth()
  const { mode, toggleThemeMode } = useThemeMode()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const initials = (user?.username || '?').slice(0, 2).toUpperCase()
  const roleLabel = user?.role_name || (user?.is_admin ? 'Administrator' : 'No role assigned')
  const page = currentPage(location.pathname)

  // Only the pages the user's role opens; a group with none left is dropped.
  const navGroups: { title: string; items: NavItem[] }[] = PAGE_GROUPS
    .map((group) => ({
      title: group.title,
      items: group.pages.filter((p) => hasPage(p.key)).map((p) => ({ label: p.label, path: p.path, icon: PAGE_ICONS[p.key] })),
    }))
    .filter((group) => group.items.length > 0)
  const testingItems = (user?.testing_tools ? TESTING_PAGES : [])
    .map((p) => ({ label: p.label, path: p.path, icon: <FlaskConical className={ICON} /> }))
  if (testingItems.length) navGroups.push({ title: 'Testing', items: testingItems })

  const sidebarContent = (
    <div className="flex h-full flex-col bg-sidebar px-4 pb-4 pt-6 text-sidebar-text">
      {/* Brand */}
      <div className="flex items-center gap-3 px-1 pb-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary">
          <LogoMark className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold leading-tight text-white">LedgerDesk</p>
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-highlight">Pro suite</p>
        </div>
        {/* Mobile close button */}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
          className="flex h-10 w-10 items-center justify-center rounded-[10px] text-sidebar-label hover:bg-sidebar-active hover:text-white md:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="-mx-1 flex-1 overflow-y-auto px-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {navGroups.map((group) => (
          <div key={group.title} className="mt-4 first:mt-1">
            <div className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-sidebar-label">
              {GROUP_LABEL[group.title] ?? group.title}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const currentFullPath = location.pathname + location.search

                return (
                  <div key={item.path}>
                    <NavLink
                      to={item.path}
                      end={isShadowed(item.path, location.pathname)}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm transition-colors ${
                          isActive
                            ? 'bg-sidebar-active font-semibold text-white'
                            : 'font-medium text-sidebar-text hover:bg-white/[0.06] hover:text-white'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {item.icon}
                          <span className="flex-1 truncate">{item.label}</span>
                          {isActive && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-highlight" />}
                        </>
                      )}
                    </NavLink>

                    {item.subItems && (
                      <div className="ml-6 mt-1 space-y-0.5 border-l border-white/10 pl-3">
                        {item.subItems.map((sub) => {
                          const isSubSelected = currentFullPath === sub.path
                          return (
                            <NavLink
                              key={sub.path}
                              to={sub.path}
                              onClick={() => setMobileOpen(false)}
                              className={`block rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
                                isSubSelected
                                  ? 'bg-sidebar-active font-semibold text-white'
                                  : 'font-medium text-sidebar-label hover:bg-white/[0.06] hover:text-white'
                              }`}
                            >
                              {sub.label}
                            </NavLink>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User card */}
      <div className="mt-2 flex items-center gap-2 rounded-[14px] bg-sidebar-raised p-2.5">
        <NavLink
          to="/profile"
          title="Profile Settings"
          onClick={() => setMobileOpen(false)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-[10px] p-1 transition hover:bg-white/[0.05]"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-highlight text-xs font-bold text-highlight-ink">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-white">{user?.username || 'Account'}</p>
            <p className="truncate text-xs text-sidebar-label">{roleLabel}</p>
            {user?.company && (
              <p className="truncate text-xs font-semibold text-highlight" title="Company - sign out to switch">{user.company.name}</p>
            )}
          </div>
        </NavLink>
        <button
          type="button"
          onClick={handleLogout}
          title="Log out"
          aria-label="Log out"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-sidebar-label transition hover:bg-white/[0.06] hover:text-white"
        >
          <LogOut className="h-[18px] w-[18px] stroke-[1.8]" />
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-bg">
      {/* Top bar */}
      <header className="fixed top-0 z-30 flex h-[73px] w-full items-center justify-between gap-3 border-b border-border bg-surface px-4 md:pl-[288px] md:pr-10">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted hover:bg-surface-muted md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          {page && (
            <nav aria-label="Breadcrumb" className="min-w-0 truncate text-sm">
              <span className="font-medium text-muted">{page.group}</span>
              <span className="mx-2 text-input">/</span>
              <span className="font-semibold text-ink">{page.label}</span>
            </nav>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleThemeMode}
            title={mode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface text-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            {mode === 'dark' ? <Sun className="h-[18px] w-[18px] stroke-[1.8]" /> : <Moon className="h-[18px] w-[18px] stroke-[1.8]" />}
          </button>

          {/* Account menu: Profile Settings / Log out */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setAccountOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              title="Account"
              className="flex h-11 items-center gap-2.5 rounded-xl border border-border bg-surface pl-1.5 pr-2.5 transition-colors hover:bg-surface-muted"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-highlight text-xs font-bold text-highlight-ink">
                {initials}
              </div>
              <div className="hidden text-left sm:block">
                <p className="text-[13px] font-semibold leading-tight text-ink">{user?.username || 'Account'}</p>
                <p className="text-xs leading-tight text-muted">{roleLabel}</p>
              </div>
              <ChevronDown className={`h-4 w-4 text-muted transition-transform ${accountOpen ? 'rotate-180' : ''}`} />
            </button>

            {accountOpen && (
              <>
                {/* Click-away layer */}
                <div className="fixed inset-0 z-40" onClick={() => setAccountOpen(false)} />
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-border bg-surface shadow-xl"
                >
                  <div className="border-b border-border-soft px-4 py-3">
                    <p className="truncate text-sm font-semibold text-ink">
                      {[user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username}
                    </p>
                    <p className="truncate text-xs text-muted">{user?.email || roleLabel}</p>
                  </div>
                  <div className="p-1.5">
                    {[
                      { label: 'Profile Settings', to: '/profile', icon: <Settings className="h-4 w-4" /> },
                      // { label: 'Change Password', to: '/profile#password', icon: <KeyRound className="h-4 w-4" /> },
                    ].map((item) => (
                      <button
                        key={item.to}
                        type="button"
                        role="menuitem"
                        onClick={() => { setAccountOpen(false); navigate(item.to) }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-ink hover:bg-surface-muted"
                      >
                        <span className="text-muted">{item.icon}</span>
                        {item.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleLogout}
                      className="mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-danger-text hover:bg-danger-soft"
                    >
                      <LogOut className="h-4 w-4" />
                      Log out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Desktop fixed sidebar */}
      <aside style={{ width: DRAWER_WIDTH }} className="fixed bottom-0 left-0 top-0 z-40 hidden md:block">
        {sidebarContent}
      </aside>

      {/* Mobile slide-in drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="fixed inset-0 bg-overlay" onClick={() => setMobileOpen(false)} />
          <aside style={{ width: DRAWER_WIDTH }} className="fixed bottom-0 left-0 top-0 z-50 h-full shadow-2xl">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main page body */}
      <main className="px-4 pb-12 pt-[97px] md:pl-[288px] md:pr-10">
        {/* Pages load on demand (see App.tsx) - the sidebar stays while one downloads. */}
        <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center"><Spinner size={32} /></div>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
