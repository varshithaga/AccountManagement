/** The company being worked in. Each company's books are a separate database on the server; every request
 * says which one in the X-Company header, and the login token only works in the company it came from. */

const STORAGE_KEY = 'company'

export const DEFAULT_COMPANY = 'default'
export const COMPANY_HEADER = 'X-Company'

export interface CompanyOption {
  key: string
  name: string
}

export const companyStore = {
  get: (): string => {
    try {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_COMPANY
    } catch {
      return DEFAULT_COMPANY
    }
  },
  set: (key: string): void => {
    try {
      localStorage.setItem(STORAGE_KEY, key)
    } catch {
      // storage blocked - requests fall back to the main company
    }
  },
}
