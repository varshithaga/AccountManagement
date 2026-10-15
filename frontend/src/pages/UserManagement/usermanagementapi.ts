import axios from 'axios'
import { getAuthHeaders, createApiUrl } from '../../access/access'
import type { Paginated } from '../../types'
import type { PageKey, RoleActions } from '../../access/pages'

export interface ManagedUser {
  id: number
  username: string
  first_name: string
  last_name: string
  email: string
  is_active: boolean
  is_superuser: boolean
  /** Role id; null = no role, so no page access. */
  role: number | null
  role_name: string | null
  is_admin: boolean
  last_login: string | null
  date_joined: string
}

export interface Role {
  id: number
  name: string
  description: string
  pages: PageKey[]
  /** What the role may change on each of its pages; a page that's missing is view only. */
  actions: RoleActions
  /** The built-in Admin role: full access, can't be edited or deleted. */
  is_admin: boolean
  user_count: number
}

export interface UserPayload {
  username: string
  first_name: string
  last_name: string
  email: string
  is_active: boolean
  role: number | null
  /** Only sent when creating. */
  password?: string
}

export interface RolePayload {
  name: string
  description: string
  pages: PageKey[]
  actions: RoleActions
}

export const usersApi = {
  search: async (params: { search?: string; role?: number | string; is_active?: string; page?: number; limit?: number } = {}): Promise<Paginated<ManagedUser>> => {
    const response = await axios.get(createApiUrl('/users/'), {
      headers: await getAuthHeaders(),
      params: Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined)),
    })
    return response.data
  },

  create: async (payload: UserPayload): Promise<ManagedUser> => {
    const response = await axios.post(createApiUrl('/users/'), payload, { headers: await getAuthHeaders() })
    return response.data
  },

  update: async (id: number, payload: Partial<UserPayload>): Promise<ManagedUser> => {
    const response = await axios.patch(createApiUrl(`/users/${id}/`), payload, { headers: await getAuthHeaders() })
    return response.data
  },

  remove: async (id: number): Promise<void> => {
    await axios.delete(createApiUrl(`/users/${id}/`), { headers: await getAuthHeaders() })
  },

  resetPassword: async (id: number, newPassword: string): Promise<{ message: string }> => {
    const response = await axios.post(createApiUrl(`/users/${id}/reset-password/`), { new_password: newPassword }, {
      headers: await getAuthHeaders(),
    })
    return response.data
  },
}

export const rolesApi = {
  list: async (): Promise<Role[]> => {
    const response = await axios.get(createApiUrl('/roles/'), { headers: await getAuthHeaders() })
    return response.data
  },

  create: async (payload: RolePayload): Promise<Role> => {
    const response = await axios.post(createApiUrl('/roles/'), payload, { headers: await getAuthHeaders() })
    return response.data
  },

  update: async (id: number, payload: RolePayload): Promise<Role> => {
    const response = await axios.put(createApiUrl(`/roles/${id}/`), payload, { headers: await getAuthHeaders() })
    return response.data
  },

  remove: async (id: number): Promise<void> => {
    await axios.delete(createApiUrl(`/roles/${id}/`), { headers: await getAuthHeaders() })
  },
}

/** First message in an API error response ({"error": ...}, or DRF's {"field": ["..."]}), or the fallback. */
export function apiErrorMessage(err: any, fallback: string): string {
  const data = err?.response?.data
  if (!data) return fallback
  if (typeof data === 'string') return fallback
  if (typeof data.detail === 'string') return data.detail
  const first = (v: unknown): string | null => (Array.isArray(v) ? first(v[0]) : typeof v === 'string' ? v : null)
  if (data.error) return first(data.error) || fallback
  for (const [field, value] of Object.entries(data)) {
    const msg = first(value)
    if (msg) return field === 'non_field_errors' ? msg : `${field.replace(/_/g, ' ')}: ${msg}`
  }
  return fallback
}
