import { describe, expect, it } from 'vitest'
import { actionLabel, changeLines, entityLabel } from './auditFormat'

describe('changeLines', () => {
  it('shows an update as old → new', () => {
    expect(changeLines({ action: 'UPDATE', changes: { phone: ['123', '999'], is_active: [true, false], receivable_account_id: [null, 4] } }))
      .toEqual(['phone: 123 → 999', 'is active: Yes → No', 'receivable account: — → 4'])
  })

  it('lists a created record and a changed password without values', () => {
    expect(changeLines({ action: 'CREATE', changes: { name: 'Acme', payment_terms_days: 30 } })).toEqual(['name: Acme', 'payment terms days: 30'])
    expect(changeLines({ action: 'PASSWORD', changes: { hashed_password: 'changed' } })).toEqual(['hashed password: changed'])
  })

  it('shortens long id lists of bulk actions', () => {
    const ids = Array.from({ length: 25 }, (_, i) => i + 1)
    const [count, list] = changeLines({ action: 'FINALIZE', changes: { count: 25, ids } })
    expect(count).toBe('count: 25')
    expect(list.endsWith('20…')).toBe(true)
  })

  it('has nothing to show without changes', () => {
    expect(changeLines({ action: 'LOGIN', changes: null })).toEqual([])
  })
})

describe('labels', () => {
  it('names actions and records, falling back to the raw value', () => {
    expect(actionLabel('POST')).toBe('Posted')
    expect(actionLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
    expect(entityLabel('SalesInvoice')).toBe('Sales invoice')
    expect(entityLabel('Widget')).toBe('Widget')
  })
})
