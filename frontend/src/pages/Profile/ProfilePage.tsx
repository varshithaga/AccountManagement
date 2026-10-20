import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { KeyRound, ShieldCheck } from 'lucide-react'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { Alert, Button, Chip, Panel } from '../../components/tw'
import { ACTION_LABELS, ALL_PAGES, PAGE_ACTIONS } from '../../access/pages'

const INPUT = 'h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm font-medium text-ink outline-none transition-colors focus:border-primary focus:ring-[3px] focus:ring-primary-soft disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800/50'
const LABEL = 'mb-1 block text-xs font-bold text-ink'

function Success({ children }: { children: string }) {
  return (
    <div className="mb-4 rounded-xl border border-success/40 bg-success-soft px-4 py-3 text-sm font-medium text-success-text dark:bg-success-soft ">
      {children}
    </div>
  )
}

const errorMessage = (err: any, fallback: string): string => {
  const data = err?.response?.data
  if (typeof data?.error === 'string') return data.error
  const first = data && typeof data === 'object' ? Object.values(data)[0] : null
  return (Array.isArray(first) && typeof first[0] === 'string' ? first[0] : null) || fallback
}

export default function ProfilePage() {
  const { user, refreshUser } = useAuth()

  const [details, setDetails] = useState({
    first_name: user?.first_name ?? '', last_name: user?.last_name ?? '', email: user?.email ?? '',
  })
  const [detailsError, setDetailsError] = useState('')
  const [detailsSaved, setDetailsSaved] = useState(false)
  const [savingDetails, setSavingDetails] = useState(false)

  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' })
  const [passwordError, setPasswordError] = useState('')
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  // "Change Password" in the account menu links to /profile#password - jump straight to that form.
  const { hash } = useLocation()
  const currentPasswordRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (hash !== '#password') return
    currentPasswordRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    currentPasswordRef.current?.focus({ preventScroll: true })
  }, [hash])

  if (!user) return null

  const saveDetails = async () => {
    setDetailsError('')
    setDetailsSaved(false)
    setSavingDetails(true)
    try {
      await api.patch('/auth/me/', details)
      await refreshUser()
      setDetailsSaved(true)
    } catch (err) {
      setDetailsError(errorMessage(err, 'Failed to save your details.'))
    } finally {
      setSavingDetails(false)
    }
  }

  const changePassword = async () => {
    setPasswordSaved(false)
    if (!passwords.current || !passwords.next) return setPasswordError('Enter your current password and a new password.')
    if (passwords.next !== passwords.confirm) return setPasswordError('The new passwords do not match.')
    setPasswordError('')
    setSavingPassword(true)
    try {
      await api.post('/auth/change-password/', { current_password: passwords.current, new_password: passwords.next })
      setPasswords({ current: '', next: '', confirm: '' })
      setPasswordSaved(true)
    } catch (err) {
      setPasswordError(errorMessage(err, 'Failed to change your password.'))
    } finally {
      setSavingPassword(false)
    }
  }

  // "Bank Accounts · Create, Edit" - the page and what the role may change on it.
  const pageLabels = ALL_PAGES.filter((p) => user.pages.includes(p.key)).map((p) => {
    const offered = PAGE_ACTIONS[p.key]
    if (!offered) return p.label
    const held = offered.filter((a) => user.actions?.[p.key]?.includes(a))
    const rights = held.length === 0 ? 'View only' : held.length === offered.length ? 'Full' : held.map((a) => ACTION_LABELS[a]).join(', ')
    return `${p.label} · ${rights}`
  })

  return (
    <div className="mx-auto max-w-4xl pb-12">
      <div className="mb-6 flex items-center gap-3">
        <div>
          <h1 className="text-ink">Profile Settings</h1>
          <p className="mt-1.5 max-w-3xl text-[15px] text-muted">Your details, password and the pages your role opens.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel>
          <h2 className="mb-4 text-base font-bold text-ink">Details</h2>
          {detailsError && <Alert className="mb-4">{detailsError}</Alert>}
          {detailsSaved && <Success>Your details were saved.</Success>}
          <div className="flex flex-col gap-4">
            <div>
              <label className={LABEL}>Username</label>
              <input type="text" value={user.username} disabled className={INPUT} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={LABEL}>First Name</label>
                <input type="text" value={details.first_name} className={INPUT}
                  onChange={(e) => setDetails({ ...details, first_name: e.target.value })} />
              </div>
              <div>
                <label className={LABEL}>Last Name</label>
                <input type="text" value={details.last_name} className={INPUT}
                  onChange={(e) => setDetails({ ...details, last_name: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={LABEL}>Email</label>
              <input type="email" value={details.email} className={INPUT}
                onChange={(e) => setDetails({ ...details, email: e.target.value })} />
            </div>
            <div>
              <Button variant="contained" onClick={saveDetails} disabled={savingDetails}>Save Details</Button>
            </div>
          </div>
        </Panel>

        <Panel>
          <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-ink">
            <KeyRound className="h-4 w-4 text-amber-500" /> Change Password
          </h2>
          {passwordError && <Alert className="mb-4">{passwordError}</Alert>}
          {passwordSaved && <Success>Your password was changed.</Success>}
          <div className="flex flex-col gap-4">
            <div>
              <label className={LABEL}>Current Password</label>
              <input ref={currentPasswordRef} type="password" autoComplete="current-password" value={passwords.current} className={INPUT}
                onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} />
            </div>
            <div>
              <label className={LABEL}>New Password</label>
              <input type="password" autoComplete="new-password" value={passwords.next} className={INPUT}
                onChange={(e) => setPasswords({ ...passwords, next: e.target.value })} />
              <p className="mt-1 text-xs text-muted">At least 8 characters, not all numbers, not a common password.</p>
            </div>
            <div>
              <label className={LABEL}>Confirm New Password</label>
              <input type="password" autoComplete="new-password" value={passwords.confirm} className={INPUT}
                onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} />
            </div>
            <div>
              <Button variant="contained" color="warning" onClick={changePassword} disabled={savingPassword}>Change Password</Button>
            </div>
          </div>
        </Panel>

        <Panel className="lg:col-span-2">
          <h2 className="mb-1 flex items-center gap-2 text-base font-bold text-ink">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Role: {user.role_name || (user.is_admin ? 'Administrator' : 'None assigned')}
          </h2>
          <p className="mb-3 text-xs text-muted">
            Your role is set by an administrator and decides which pages you can open and what you can change on them.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {pageLabels.length === 0
              ? <span className="text-sm font-semibold text-warning-text">No pages yet - ask an administrator to assign you a role.</span>
              : pageLabels.map((label) => <Chip key={label} tone="primary" variant="outline">{label}</Chip>)}
          </div>
        </Panel>
      </div>
    </div>
  )
}
