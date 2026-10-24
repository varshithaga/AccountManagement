import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import api, { tokenStore } from '../api/client'
import { INLINE_CATEGORY_PAGES, INLINE_SUB_CATEGORY_PAGES, type PageAction, type PageKey, type RoleActions } from '../access/pages'

export interface AuthUser {
  id: number
  username: string
  first_name: string
  last_name: string
  email: string
  /** null = no role assigned yet, so no page access. */
  role_name: string | null
  is_admin: boolean
  /** Page keys the user's role opens (see access/pages.ts). */
  pages: PageKey[]
  /** What the role may change on each page; a page that's missing is view only. */
  actions: RoleActions
  date_joined: string
  /** True when the server has TESTING_TOOLS on and the user is an administrator. */
  testing_tools?: boolean
  /** The company signed in to - each one's books are separate. */
  company?: { key: string; name: string }
}

interface RegisterPayload {
  username: string
  password: string
  email?: string
  first_name?: string
  last_name?: string
}

interface AuthContextValue {
  isAuthenticated: boolean
  user: AuthUser | null
  /** True while the signed-in user's details and page access are being loaded. */
  loading: boolean
  /** True when that load failed (e.g. the server is unreachable). */
  loadError: boolean
  hasPage: (page: PageKey) => boolean
  /** Whether the user's role may create / edit / delete on the page. The server enforces
   * this; here it hides the buttons the user couldn't use anyway. */
  can: (page: PageKey, action: PageAction) => boolean
  /** Adding a missing category / sub-category from a dropdown while working on another page. */
  canAddCategory: boolean
  canAddSubCategory: boolean
  /** Re-reads the user from the server - after a profile edit, or to retry a failed load. */
  refreshUser: () => Promise<AuthUser>
  login: (username: string, password: string) => Promise<any>
  register: (userData: RegisterPayload) => Promise<any>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(!!tokenStore.getAccess())
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(!!tokenStore.getAccess())
  const [loadError, setLoadError] = useState(false)

  const refreshUser = useCallback(async () => {
    setLoadError(false)
    try {
      const { data } = await api.get<AuthUser>('/auth/me/')
      setUser(data)
      return data
    } catch (err) {
      setLoadError(true)
      throw err
    }
  }, [])

  // Page reload with a stored session: fetch who the user is and what they may open.
  useEffect(() => {
    if (!tokenStore.getAccess()) return
    refreshUser().catch(() => {}).finally(() => setLoading(false))
  }, [refreshUser])

  /** Stores the tokens, then loads the user; a failure leaves no half-signed-in session. */
  const startSession = useCallback(async (access: string, refresh: string) => {
    tokenStore.setTokens(access, refresh)
    try {
      await refreshUser()
    } catch (err) {
      tokenStore.clear()
      setLoadError(false)
      throw err
    }
    setIsAuthenticated(true)
  }, [refreshUser])

  const login = useCallback(async (username: string, password: string) => {
    const { data } = await api.post('/auth/token/', { username, password })
    await startSession(data.access, data.refresh)
    return data
  }, [startSession])

  const register = useCallback(async (userData: RegisterPayload) => {
    const { data } = await api.post('/auth/register/', userData)
    if (data.access && data.refresh) {
      await startSession(data.access, data.refresh)
    }
    return data
  }, [startSession])

  const logout = useCallback(() => {
    const refresh = tokenStore.getRefresh()
    // Best-effort: revoke the refresh token server-side so it can't be replayed
    // later. The endpoint needs only the refresh token (sent in the body), so
    // local state can be cleared immediately without waiting on the response.
    if (refresh) {
      api.post('/auth/logout/', { refresh }).catch(() => {})
    }
    tokenStore.clear()
    setUser(null)
    setLoadError(false)
    setIsAuthenticated(false)
  }, [])

  const hasPage = useCallback((page: PageKey) => !!user?.pages.includes(page), [user])
  const can = useCallback((page: PageKey, action: PageAction) => !!user?.actions?.[page]?.includes(action), [user])
  const canAddInline = (pages: PageKey[]) => can('categories', 'create') || pages.some((p) => can(p, 'create') || can(p, 'edit'))
  const canAddCategory = canAddInline(INLINE_CATEGORY_PAGES)
  const canAddSubCategory = canAddInline(INLINE_SUB_CATEGORY_PAGES)

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, loading, loadError, hasPage, can, canAddCategory, canAddSubCategory, refreshUser, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
