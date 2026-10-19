import { beforeEach, describe, expect, it } from 'vitest'
import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import api from '../api/client'
import './access' // registers the plain-axios interceptor
import { COMPANY_HEADER, DEFAULT_COMPANY, companyStore } from './company'

/** Answers every request locally and keeps what was sent. */
function capture() {
  const sent: InternalAxiosRequestConfig[] = []
  const adapter: AxiosAdapter = async (config) => {
    sent.push(config)
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
  }
  return { sent, adapter }
}

describe('company header', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to the main company', () => {
    expect(companyStore.get()).toBe(DEFAULT_COMPANY)
  })

  it('goes on requests through the API client and plain axios', async () => {
    companyStore.set('acme')
    const { sent, adapter } = capture()
    await api.get('/companies/', { adapter })
    await axios.get('/api/clients/', { adapter })
    expect(sent.map((c) => c.headers.get(COMPANY_HEADER))).toEqual(['acme', 'acme'])
  })
})
