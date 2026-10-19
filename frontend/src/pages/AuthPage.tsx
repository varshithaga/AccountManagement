import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Eye, EyeOff, Lock, User, Mail, IdCard, CheckCircle2, ArrowRight, BarChart3, Tag, FileSearch, Copy, Building2,
} from 'lucide-react'
import api from '../api/client'
import { DEFAULT_COMPANY, companyStore, type CompanyOption } from '../access/company'
import { useAuth } from '../context/AuthContext'
import { Spinner, Tabs } from '../components/tw'

interface AuthPageProps {
  initialMode?: 'login' | 'signup'
}

const inputClass = 'h-12 w-full rounded-xl border border-input bg-surface pl-11 pr-11 text-sm font-medium text-ink outline-none transition-colors placeholder:text-slate-400 focus:border-[1.5px] focus:border-primary focus:ring-[3px] focus:ring-primary-soft'
const labelClass = 'mb-1.5 block text-[13px] font-semibold text-ink'
const iconClass = 'pointer-events-none absolute left-3.5 h-[18px] w-[18px] stroke-[1.8] text-muted'

function Field({ id, label, icon, children }: { id: string; label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <div className="relative flex items-center">
        <span className={iconClass}>{icon}</span>
        {children}
      </div>
    </div>
  )
}

function MiniStat({ icon, value, label }: { icon: ReactNode; value: ReactNode; label: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-sidebar-raised p-4">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.07] text-mint">{icon}</span>
      <p className="mt-3 text-[15px] font-semibold text-white">{value}</p>
      <p className="mt-0.5 text-xs text-sidebar-label">{label}</p>
    </div>
  )
}

export default function AuthPage({ initialMode }: AuthPageProps) {
  const location = useLocation()
  const isSignUpPath = initialMode === 'signup' || location.pathname === '/signup'
  const [mode, setMode] = useState<'login' | 'signup'>(isSignUpPath ? 'signup' : 'login')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')

  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const { login, register } = useAuth()
  const navigate = useNavigate()

  // Several companies on this server: pick which one's books to sign in to (none shown with just one).
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [company, setCompany] = useState(companyStore.get())
  useEffect(() => {
    api.get('/companies/')
      .then(({ data }) => {
        const list: CompanyOption[] = data.companies ?? []
        setCompanies(list)
        if (!list.some((c) => c.key === companyStore.get())) setCompany(DEFAULT_COMPANY)
      })
      .catch(() => setCompanies([]))
  }, [])
  const chooseCompany = (key: string) => {
    setCompany(key)
    companyStore.set(key)
  }

  const handleModeChange = (next: 'login' | 'signup') => {
    setMode(next)
    setError('')
    setSuccess('')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    companyStore.set(company) // the sign-in request and everything after it go to this company

    if (mode === 'login') {
      if (!username.trim() || !password) {
        setError('Please enter both username and password.')
        return
      }
      setLoading(true)
      try {
        await login(username.trim(), password)
        navigate('/')
      } catch (err: any) {
        const msg = err.response?.data?.detail || err.response?.data?.error || 'Invalid username or password.'
        setError(msg)
      } finally {
        setLoading(false)
      }
    } else {
      if (!username.trim()) {
        setError('Username is required.')
        return
      }
      if (!password) {
        setError('Password is required.')
        return
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters long.')
        return
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.')
        return
      }

      setLoading(true)
      try {
        const nameParts = fullName.trim().split(' ')
        const firstName = nameParts[0] || ''
        const lastName = nameParts.slice(1).join(' ') || ''

        await register({
          username: username.trim(), password, email: email.trim(),
          first_name: firstName, last_name: lastName,
        })
        setSuccess('Account created successfully! Redirecting...')
        setTimeout(() => navigate('/'), 1000)
      } catch (err: any) {
        const msg = err.response?.data?.error || err.response?.data?.detail || 'Failed to create account.'
        setError(msg)
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-bg md:flex-row">
      {/* LEFT PANEL - BRANDING */}
      <section className="nav-rail relative hidden flex-col justify-between gap-10 overflow-y-auto px-10 py-10 md:flex md:w-1/2 lg:px-14 lg:py-12">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <p className="font-display text-lg font-bold leading-tight text-white">LedgerDesk</p>
              <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-highlight">Pro suite</p>
            </div>
          </div>

          <span className="mt-12 inline-flex items-center gap-2 rounded-full bg-[#15306A] px-3.5 py-1.5 text-[13px] font-semibold text-mint">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            Automated bank statement processing
          </span>

          <h1 className="mt-5 max-w-[520px] font-display text-[44px] font-bold leading-[1.08] tracking-[-0.02em] text-white">
            Statements in. Clean books out.
          </h1>
          <p className="mt-4 max-w-[480px] text-[15px] leading-relaxed text-sidebar-text">
            Upload PDF or Excel statements from every bank account, catch gaps and duplicates automatically,
            match each line to your ledger, and close the month with reports your accountant can trust.
          </p>

          {/* Keyword → category preview */}
          <div className="mt-8 max-w-[480px] rounded-[18px] border border-white/10 bg-sidebar-raised p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-sidebar-label">Auto-categorized</p>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">UPI/AWS INDIA/Cloud services</p>
                <p className="mt-1 text-xs text-sidebar-label">
                  Keyword <span className="num rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[11px] text-white">AWS</span>
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-sidebar-label" />
              <div className="text-right">
                <p className="text-sm font-semibold text-white">Software &amp; Cloud</p>
                <p className="mt-1 text-xs text-sidebar-label">Operating Expenses</p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid max-w-[480px] grid-cols-3 gap-3">
            <MiniStat icon={<Tag className="h-4 w-4" />} value="Keyword" label="rules engine" />
            <MiniStat icon={<FileSearch className="h-4 w-4" />} value="P&L" label="drill-down" />
            <MiniStat icon={<Copy className="h-4 w-4" />} value="Duplicate" label="checks" />
          </div>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-sidebar-text">
          {['Role-based access control', 'Secure session tokens', 'Excel & PDF export'].map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-success" /> {t}
            </span>
          ))}
        </div>
      </section>

      {/* RIGHT PANEL - AUTH FORM */}
      <section className="flex w-full flex-1 items-center justify-center px-4 py-10 md:w-1/2">
        <div className="w-full max-w-[420px] rounded-[22px] border border-border bg-surface p-7 sm:p-8">
          {/* Brand on phones, where the left panel is hidden */}
          <div className="mb-6 flex items-center gap-2.5 md:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white">
              <BarChart3 className="h-[18px] w-[18px]" />
            </div>
            <p className="font-display text-base font-bold text-ink">LedgerDesk</p>
          </div>

          <h2 className="font-display text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="mt-1.5 text-[15px] text-muted">
            {mode === 'login' ? 'Sign in to your accounting workspace.' : 'Set up access to your accounting workspace.'}
          </p>

          <Tabs
            value={mode}
            onChange={handleModeChange}
            className="mt-6 w-full [&>button]:flex-1 [&>button]:py-2"
            options={[
              { value: 'login', label: 'Sign in' },
              { value: 'signup', label: 'Sign up' },
            ]}
          />

          {error && (
            <div role="alert" className="mt-5 rounded-xl border border-danger-border bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger-text">
              {error}
            </div>
          )}

          {success && (
            <div role="status" className="mt-5 rounded-xl border border-success/30 bg-success-soft px-3.5 py-2.5 text-sm font-medium text-success-text">
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="mt-5 flex flex-col gap-4">
            {companies.length > 1 && (
              <Field id="auth-company" label="Company" icon={<Building2 className="h-full w-full" />}>
                <select
                  id="auth-company"
                  value={company}
                  onChange={(e) => chooseCompany(e.target.value)}
                  className={`${inputClass} appearance-none`}
                >
                  {companies.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                </select>
              </Field>
            )}

            {mode === 'signup' && (
              <Field id="auth-fullname" label="Full name" icon={<IdCard className="h-full w-full" />}>
                <input
                  id="auth-fullname"
                  type="text"
                  placeholder="Optional"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                  className={inputClass}
                />
              </Field>
            )}

            <Field id="auth-username" label="Username" icon={<User className="h-full w-full" />}>
              <input
                id="auth-username"
                type="text"
                placeholder="Your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                className={inputClass}
              />
            </Field>

            {mode === 'signup' && (
              <Field id="auth-email" label="Work email" icon={<Mail className="h-full w-full" />}>
                <input
                  id="auth-email"
                  type="email"
                  placeholder="Optional"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className={inputClass}
                />
              </Field>
            )}

            <Field id="auth-password" label="Password" icon={<Lock className="h-full w-full" />}>
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:text-ink"
              >
                {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
              </button>
            </Field>

            {mode === 'signup' && (
              <Field id="auth-confirm" label="Confirm password" icon={<Lock className="h-full w-full" />}>
                <input
                  id="auth-confirm"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Repeat the password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:text-ink"
                >
                  {showConfirmPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              </Field>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? <Spinner size={20} className="border-white/40 border-t-white" />
                : <>{mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight className="h-[18px] w-[18px]" /></>}
            </button>

            {mode === 'login' && (
              <p className="text-center text-xs text-muted">
                Forgot your password? Ask an administrator to reset it from User Management.
              </p>
            )}

            <p className="border-t border-border-soft pt-4 text-center text-sm text-muted">
              {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
              <button
                type="button"
                onClick={() => handleModeChange(mode === 'login' ? 'signup' : 'login')}
                className="font-semibold text-primary hover:underline"
              >
                {mode === 'login' ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          </form>
        </div>
      </section>
    </div>
  )
}
