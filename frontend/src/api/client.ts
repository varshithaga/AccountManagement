import axios, { type InternalAxiosRequestConfig } from 'axios'
import { getAccessTokenIfSignedIn, refreshSession } from '../access/access'
import { COMPANY_HEADER, companyStore } from '../access/company'

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean
}

const ACCESS_KEY = 'access_token'
const REFRESH_KEY = 'refresh_token'

export const tokenStore = {
  getAccess: (): string | null => localStorage.getItem(ACCESS_KEY),
  getRefresh: (): string | null => localStorage.getItem(REFRESH_KEY),
  setTokens: (access: string, refresh?: string): void => {
    localStorage.setItem(ACCESS_KEY, access)
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear: (): void => {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

declare const __API_URL__: string

const API_BASE = typeof __API_URL__ !== 'undefined' ? `${__API_URL__}/api` : '/api'

const api = axios.create({ baseURL: API_BASE })

// Renews an expired access token before sending, through the same shared refresh as
// access/access.ts - two refreshes with one (single-use) refresh token would sign the user out.
// Signing in / up needs no token - and a stale one left in storage must not get in the way.
// Logout authenticates with the refresh token in its body, not the access token.
const PUBLIC_PATHS = ['/auth/token/', '/auth/register/', '/auth/logout/', '/companies/']

api.interceptors.request.use(async (config) => {
  config.headers.set(COMPANY_HEADER, companyStore.get())
  if (PUBLIC_PATHS.includes(config.url || '')) return config
  const token = await getAccessTokenIfSignedIn()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config as RetryableConfig | undefined
    const response = error.response

    if (response?.status === 401 && config && !config._retry && tokenStore.getRefresh()) {
      config._retry = true
      try {
        // Rejected although the token looked valid (e.g. revoked) - try one shared refresh.
        const newAccess = await refreshSession()
        config.headers.Authorization = `Bearer ${newAccess}`
        return api(config)
      } catch {
        tokenStore.clear()
        window.location.href = '/login'
        return Promise.reject(error)
      }
    }
    return Promise.reject(error)
  }
)

export default api
