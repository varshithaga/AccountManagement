import { useCallback, useEffect, useState } from 'react'
import {
  Plus, Search, X, Pencil, Trash2, KeyRound, ShieldCheck, RefreshCw, Lock,
} from 'lucide-react'
import {
  usersApi, rolesApi, apiErrorMessage,
  type ManagedUser, type Role, type UserPayload, type RolePayload,
} from './usermanagementapi'
import Pagination, { DEFAULT_ROWS_PER_PAGE } from '../../components/Pagination'
import { Alert, Button, Chip, Modal, Panel, Spinner, Switch, Tabs } from '../../components/tw'
import { ACTION_LABELS, ALL_ACTIONS, ALL_PAGES, PAGE_ACTIONS, PAGE_GROUPS, type PageAction, type PageKey } from '../../access/pages'
import { useAuth } from '../../context/AuthContext'

const INPUT = 'h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm font-medium text-ink outline-none transition-colors focus:border-primary focus:ring-[3px] focus:ring-primary-soft disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800/50'
const LABEL = 'mb-1 block text-xs font-bold text-ink'
const TH = 'px-6 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-muted'
const ROW_ACTION = 'rounded-lg p-2 text-muted transition-colors disabled:cursor-not-allowed disabled:opacity-40'

const PAGE_LABEL = Object.fromEntries(ALL_PAGES.map((p) => [p.key, p.label])) as Record<PageKey, string>

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : 'Never'

const fullName = (u: ManagedUser) => `${u.first_name} ${u.last_name}`.trim()

const EMPTY_USER: UserPayload = { username: '', first_name: '', last_name: '', email: '', is_active: true, role: null, password: '' }
const EMPTY_ROLE: RolePayload = { name: '', description: '', pages: [], actions: {} }

/** "Bank Accounts · Create, Edit" - what a role may do on a page, for the role cards. */
const rightsLabel = (key: PageKey, granted: PageAction[] = []) => {
  const offered = PAGE_ACTIONS[key]
  if (!offered) return PAGE_LABEL[key] ?? key
  const held = offered.filter((a) => granted.includes(a))
  const rights = held.length === 0 ? 'View only' : held.length === offered.length ? 'Full' : held.map((a) => ACTION_LABELS[a]).join(', ')
  return `${PAGE_LABEL[key] ?? key} · ${rights}`
}

/* ------------------------------------------------------------------ Users */

function UsersTab({ roles, onChanged }: { roles: Role[]; onChanged: () => void }) {
  const { user: me, refreshUser, can } = useAuth()
  const canCreate = can('user_management', 'create')
  const canEdit = can('user_management', 'edit')
  const canDelete = can('user_management', 'delete')
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE)

  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<ManagedUser | null>(null)
  const [form, setForm] = useState<UserPayload>(EMPTY_USER)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const [resetFor, setResetFor] = useState<ManagedUser | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [resetError, setResetError] = useState('')
  const [notice, setNotice] = useState('')

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const data = await usersApi.search({ search: search.trim() || undefined, role: roleFilter, page: page + 1, limit: rowsPerPage })
      setUsers(data.results)
      setCount(data.count)
      setListError('')
    } catch {
      setListError('Failed to load users.')
    } finally {
      setLoading(false)
    }
  }, [search, roleFilter, page, rowsPerPage])

  useEffect(() => {
    const handle = setTimeout(fetchUsers, 300)
    return () => clearTimeout(handle)
  }, [fetchUsers])

  /** Reload the list and role counts; if the change was to my own account, my access too. */
  const afterChange = async (changedId?: number) => {
    await fetchUsers()
    onChanged()
    if (changedId === me?.id) await refreshUser().catch(() => {})
  }

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_USER)
    setFormError('')
    setDialog(true)
  }

  const openEdit = (u: ManagedUser) => {
    setEditing(u)
    setForm({ username: u.username, first_name: u.first_name, last_name: u.last_name, email: u.email, is_active: u.is_active, role: u.role })
    setFormError('')
    setDialog(true)
  }

  const save = async () => {
    if (!form.username.trim()) return setFormError('Please enter a username.')
    if (!editing && !form.password) return setFormError('Please enter a password.')
    setFormError('')
    setSaving(true)
    try {
      if (editing) {
        const { password: _password, ...rest } = form
        await usersApi.update(editing.id, rest)
      } else {
        await usersApi.create(form)
      }
      setDialog(false)
      await afterChange(editing?.id)
    } catch (err) {
      setFormError(apiErrorMessage(err, 'Failed to save the user.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (u: ManagedUser) => {
    if (!window.confirm(`Delete user "${u.username}"? They will no longer be able to sign in.`)) return
    try {
      await usersApi.remove(u.id)
      await afterChange()
    } catch (err) {
      alert(apiErrorMessage(err, 'Failed to delete the user.'))
    }
  }

  const resetPassword = async () => {
    if (!resetFor) return
    if (!newPassword) return setResetError('Please enter a new password.')
    try {
      await usersApi.resetPassword(resetFor.id, newPassword)
      setNotice(`Password reset for ${resetFor.username}. Share the new password with them; they can change it from their profile.`)
      setResetFor(null)
    } catch (err) {
      setResetError(apiErrorMessage(err, 'Failed to reset the password.'))
    }
  }

  return (
    <>
      {notice && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-success/40 bg-success-soft px-4 py-3 text-sm font-medium text-success-text dark:bg-success-soft ">
          {notice}
          <button type="button" onClick={() => setNotice('')} title="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}

      <Panel className="py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex flex-1 items-center">
            <Search className="absolute left-3.5 h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder="Search users by username, name or email..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0) }}
              className={`${INPUT} pl-10`}
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); setPage(0) }}
            className={`${INPUT} sm:w-56`}
          >
            <option value="">All roles</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {canCreate && (
            <Button variant="contained" icon={<Plus className="h-4 w-4" />} onClick={openCreate} className="h-11 px-4">
              Add User
            </Button>
          )}
        </div>
      </Panel>

      {listError && <Alert>{listError}</Alert>}

      <Panel className="overflow-hidden p-0">
        {loading && users.length === 0 ? (
          <div className="flex items-center justify-center p-16"><Spinner /></div>
        ) : users.length === 0 ? (
          <div className="py-14 text-center text-sm font-semibold text-muted">
            No users match these filters.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-slate-50 dark:bg-slate-900/80">
                    <th className={TH}>User</th>
                    <th className={TH}>Email</th>
                    <th className={TH}>Role</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Last Sign-in</th>
                    {(canEdit || canDelete) && <th className={`${TH} text-right`}>Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft">
                  {users.map((u) => {
                    const isMe = u.id === me?.id
                    return (
                      <tr key={u.id} className="transition-colors hover:bg-surface-muted">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-sm font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
                              {u.username.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <span className="font-bold text-ink">{u.username}</span>
                              {isMe && <Chip tone="info" variant="outline" className="ml-2">You</Chip>}
                              {fullName(u) && <span className="block text-xs text-muted">{fullName(u)}</span>}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-muted">{u.email || '—'}</td>
                        <td className="px-6 py-4">
                          {u.role_name ? (
                            <Chip tone={u.is_admin ? 'primary' : 'neutral'} variant={u.is_admin ? 'solid' : 'outline'}>{u.role_name}</Chip>
                          ) : u.is_superuser ? (
                            <Chip tone="primary" title="Django superuser - always has full access">Superuser</Chip>
                          ) : (
                            <span className="text-xs font-semibold text-warning-text">No role - no access</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <Chip tone={u.is_active ? 'success' : 'neutral'} variant="outline">{u.is_active ? 'Active' : 'Inactive'}</Chip>
                        </td>
                        <td className="px-6 py-4 text-muted">{formatDate(u.last_login)}</td>
                        {(canEdit || canDelete) && (
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-end gap-1">
                              {canEdit && (
                                <>
                                  <button type="button" title="Edit user" onClick={() => openEdit(u)}
                                    className={`${ROW_ACTION} hover:bg-violet-50 hover:text-violet-600 dark:hover:bg-primary-soft dark:hover:text-violet-300`}>
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                  <button type="button" title="Reset password"
                                    onClick={() => { setResetFor(u); setNewPassword(''); setResetError('') }}
                                    className={`${ROW_ACTION} hover:bg-warning-soft hover:text-warning-text dark:hover:bg-warning-soft `}>
                                    <KeyRound className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                              {canDelete && (
                                <button type="button" title={isMe ? 'You cannot delete your own account' : 'Delete user'}
                                  disabled={isMe} onClick={() => remove(u)}
                                  className={`${ROW_ACTION} hover:bg-danger-soft hover:text-danger-text dark:hover:bg-danger-soft `}>
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              count={count}
              page={page}
              rowsPerPage={rowsPerPage}
              onPageChange={setPage}
              onRowsPerPageChange={(rpp) => { setRowsPerPage(rpp); setPage(0) }}
            />
          </>
        )}
      </Panel>

      <Modal
        open={dialog}
        onClose={() => setDialog(false)}
        title={editing ? `Edit ${editing.username}` : 'Add User'}
        widthClassName="max-w-lg"
        footer={
          <>
            <Button variant="outlined" onClick={() => setDialog(false)}>Cancel</Button>
            <Button variant="contained" onClick={save} disabled={saving}>{editing ? 'Save Changes' : 'Create User'}</Button>
          </>
        }
      >
        {formError && <Alert className="mb-4">{formError}</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={LABEL}>Username <span className="text-rose-500">*</span></label>
            <input type="text" autoFocus value={form.username} className={INPUT}
              onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div>
            <label className={LABEL}>First Name</label>
            <input type="text" value={form.first_name} className={INPUT}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          </div>
          <div>
            <label className={LABEL}>Last Name</label>
            <input type="text" value={form.last_name} className={INPUT}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Email</label>
            <input type="email" value={form.email} className={INPUT}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          {!editing && (
            <div className="sm:col-span-2">
              <label className={LABEL}>Password <span className="text-rose-500">*</span></label>
              <input type="password" autoComplete="new-password" value={form.password} className={INPUT}
                onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <p className="mt-1 text-xs text-muted">At least 8 characters, not all numbers, not a common password.</p>
            </div>
          )}
          <div className="sm:col-span-2">
            <label className={LABEL}>Role</label>
            <select value={form.role ?? ''} className={INPUT}
              onChange={(e) => setForm({ ...form, role: e.target.value ? Number(e.target.value) : null })}>
              <option value="">No role (no page access)</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted">The role decides which menus this user sees and what they can change there. Edit roles on the Roles &amp; Permissions tab.</p>
          </div>
          <div className="sm:col-span-2">
            <Switch
              checked={form.is_active}
              onChange={(v) => setForm({ ...form, is_active: v })}
              disabled={editing?.id === me?.id}
              label={form.is_active ? 'Active - can sign in' : 'Inactive - cannot sign in'}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!resetFor}
        onClose={() => setResetFor(null)}
        title={`Reset password for ${resetFor?.username ?? ''}`}
        icon={<KeyRound className="h-5 w-5 text-amber-500" />}
        footer={
          <>
            <Button variant="outlined" onClick={() => setResetFor(null)}>Cancel</Button>
            <Button variant="contained" color="warning" onClick={resetPassword}>Reset Password</Button>
          </>
        }
      >
        {resetError && <Alert className="mb-4">{resetError}</Alert>}
        <label className={LABEL}>New Password</label>
        <input type="password" autoFocus autoComplete="new-password" value={newPassword} className={INPUT}
          onChange={(e) => setNewPassword(e.target.value)} />
        <p className="mt-1 text-xs text-muted">
          The user is not notified - tell them the new password yourself. They can change it afterwards from their profile.
        </p>
      </Modal>
    </>
  )
}

/* ------------------------------------------------------------------ Roles */

function RolesTab({ roles, loading, onChanged }: { roles: Role[]; loading: boolean; onChanged: () => Promise<void> }) {
  const { refreshUser, can } = useAuth()
  const canCreate = can('user_management', 'create')
  const canEdit = can('user_management', 'edit')
  const canDelete = can('user_management', 'delete')
  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<Role | null>(null)
  const [form, setForm] = useState<RolePayload>(EMPTY_ROLE)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_ROLE)
    setError('')
    setDialog(true)
  }

  const openEdit = (role: Role) => {
    setEditing(role)
    setForm({ name: role.name, description: role.description, pages: role.pages, actions: role.actions ?? {} })
    setError('')
    setDialog(true)
  }

  /** View on/off. Closing a page takes its other rights with it. */
  const togglePage = (key: PageKey) =>
    setForm((f) => {
      if (!f.pages.includes(key)) return { ...f, pages: [...f.pages, key] }
      const { [key]: _closed, ...actions } = f.actions
      return { ...f, pages: f.pages.filter((k) => k !== key), actions }
    })

  /** A right on/off. Granting one opens the page too - it can't be used without View. */
  const toggleAction = (key: PageKey, action: PageAction) =>
    setForm((f) => {
      const held = f.actions[key] ?? []
      const next = held.includes(action) ? held.filter((a) => a !== action) : [...held, action]
      return { ...f, pages: f.pages.includes(key) ? f.pages : [...f.pages, key], actions: { ...f.actions, [key]: next } }
    })

  /** Everything in a sidebar group: every page with every right it offers, or none. */
  const toggleGroup = (keys: PageKey[], on: boolean) =>
    setForm((f) => {
      const actions = { ...f.actions }
      for (const key of keys) {
        const offered = PAGE_ACTIONS[key]
        if (on && offered) actions[key] = [...offered]
        else delete actions[key]
      }
      return { ...f, pages: on ? [...new Set([...f.pages, ...keys])] : f.pages.filter((k) => !keys.includes(k)), actions }
    })

  const hasFullAccess = (key: PageKey) =>
    form.pages.includes(key) && (PAGE_ACTIONS[key] ?? []).every((a) => form.actions[key]?.includes(a))

  const save = async () => {
    if (!form.name.trim()) return setError('Please enter a role name.')
    setError('')
    setSaving(true)
    try {
      if (editing) await rolesApi.update(editing.id, form)
      else await rolesApi.create(form)
      setDialog(false)
      await onChanged()
      // My own role may be the one that changed - pick up the new menu.
      await refreshUser().catch(() => {})
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to save the role.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (role: Role) => {
    if (!window.confirm(`Delete the role "${role.name}"?`)) return
    try {
      await rolesApi.remove(role.id)
      await onChanged()
    } catch (err) {
      alert(apiErrorMessage(err, 'Failed to delete the role.'))
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          A role is a list of pages and what may be done on each: view, create, edit, delete. Users see only the
          menus of their role, and the server refuses the rest.
        </p>
        {canCreate && (
          <Button variant="contained" icon={<Plus className="h-4 w-4" />} onClick={openCreate} className="h-11 shrink-0 px-4">
            Add Role
          </Button>
        )}
      </div>

      {loading && roles.length === 0 ? (
        <div className="flex items-center justify-center p-16"><Spinner /></div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {roles.map((role) => (
            <Panel key={role.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-bold text-ink">
                    {role.is_admin ? <ShieldCheck className="h-4 w-4 text-primary" /> : null}
                    {role.name}
                  </h3>
                  {role.description && <p className="mt-0.5 text-xs text-muted">{role.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Chip tone="neutral" variant="outline">{role.user_count} {role.user_count === 1 ? 'user' : 'users'}</Chip>
                  {role.is_admin ? (
                    <span title="The Admin role always has full access and cannot be changed" className="p-2 text-slate-300 dark:text-slate-600">
                      <Lock className="h-4 w-4" />
                    </span>
                  ) : (
                    <>
                      {canEdit && (
                        <button type="button" title="Edit role" onClick={() => openEdit(role)}
                          className={`${ROW_ACTION} hover:bg-violet-50 hover:text-violet-600 dark:hover:bg-primary-soft dark:hover:text-violet-300`}>
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {canDelete && (
                        <button type="button" title="Delete role" onClick={() => remove(role)}
                          className={`${ROW_ACTION} hover:bg-danger-soft hover:text-danger-text dark:hover:bg-danger-soft `}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {role.is_admin ? (
                  <Chip tone="primary">All pages · Full</Chip>
                ) : role.pages.length === 0 ? (
                  <span className="text-xs font-semibold text-warning-text">No pages selected</span>
                ) : (
                  role.pages.map((key) => <Chip key={key} tone="primary" variant="outline">{rightsLabel(key, role.actions?.[key])}</Chip>)
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Modal
        open={dialog}
        onClose={() => setDialog(false)}
        title={editing ? `Edit role: ${editing.name}` : 'Add Role'}
        widthClassName="max-w-3xl"
        footer={
          <>
            <Button variant="outlined" onClick={() => setDialog(false)}>Cancel</Button>
            <Button variant="contained" onClick={save} disabled={saving}>{editing ? 'Save Changes' : 'Create Role'}</Button>
          </>
        }
      >
        {error && <Alert className="mb-4">{error}</Alert>}
        <div className="max-h-[65vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL}>Role Name <span className="text-rose-500">*</span></label>
              <input type="text" autoFocus value={form.name} className={INPUT}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className={LABEL}>Description</label>
              <input type="text" value={form.description} className={INPUT}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>

          <p className="mb-1 mt-5 text-xs font-bold uppercase tracking-wider text-muted">
            Pages and rights ({form.pages.length} of {ALL_PAGES.length} pages)
          </p>
          <p className="mb-2 text-xs text-muted">
            View opens the page. Create, Edit and Delete decide what the user can change there; a dash means the
            page has nothing of that kind. Tick a group to give everything in it.
          </p>
          <div className="space-y-3">
            {PAGE_GROUPS.map((group) => {
              const keys = group.pages.map((p) => p.key)
              const allOn = keys.every(hasFullAccess)
              return (
                <div key={group.title} className="rounded-xl border border-border p-3 ">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="pb-2 text-left">
                          <label className="flex cursor-pointer items-center gap-2 font-bold text-ink">
                            <input type="checkbox" checked={allOn} onChange={(e) => toggleGroup(keys, e.target.checked)}
                              className="h-4 w-4 accent-primary" />
                            {group.title}
                          </label>
                        </th>
                        {['View', ...ALL_ACTIONS.map((a) => ACTION_LABELS[a])].map((label) => (
                          <th key={label} className="w-16 pb-2 text-center text-xs font-bold text-muted">{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.pages.map((p) => (
                        <tr key={p.key} className="border-t border-border-soft">
                          <td className="py-1.5 pl-6 text-ink">{p.label}</td>
                          <td className="text-center">
                            <input type="checkbox" aria-label={`${p.label}: View`} checked={form.pages.includes(p.key)}
                              onChange={() => togglePage(p.key)} className="h-4 w-4 cursor-pointer accent-primary" />
                          </td>
                          {ALL_ACTIONS.map((action) => (
                            <td key={action} className="text-center">
                              {PAGE_ACTIONS[p.key]?.includes(action) ? (
                                <input type="checkbox" aria-label={`${p.label}: ${ACTION_LABELS[action]}`}
                                  checked={!!form.actions[p.key]?.includes(action)}
                                  onChange={() => toggleAction(p.key, action)} className="h-4 w-4 cursor-pointer accent-primary" />
                              ) : (
                                <span className="text-slate-300 dark:text-slate-600">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        </div>
      </Modal>
    </>
  )
}

/* ------------------------------------------------------------------- Page */

export default function UserManagementPage() {
  const [tab, setTab] = useState<'users' | 'roles'>('users')
  const [roles, setRoles] = useState<Role[]>([])
  const [rolesLoading, setRolesLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchRoles = useCallback(async () => {
    setRolesLoading(true)
    try {
      setRoles(await rolesApi.list())
      setError('')
    } catch {
      setError('Failed to load roles.')
    } finally {
      setRolesLoading(false)
    }
  }, [])

  useEffect(() => { fetchRoles() }, [fetchRoles])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-ink">User Management</h1>
            <p className="mt-1.5 max-w-3xl text-[15px] text-muted">
              Add users, assign roles, and choose which pages each role can open and change.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs<'users' | 'roles'>
            value={tab}
            onChange={setTab}
            options={[{ value: 'users', label: 'Users' }, { value: 'roles', label: 'Roles & Permissions' }]}
          />
          <button
            type="button"
            title="Refresh"
            onClick={fetchRoles}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:bg-surface-muted "
          >
            <RefreshCw className={`h-4 w-4 ${rolesLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {tab === 'users'
        ? <UsersTab roles={roles} onChanged={fetchRoles} />
        : <RolesTab roles={roles} loading={rolesLoading} onChanged={fetchRoles} />}
    </div>
  )
}
