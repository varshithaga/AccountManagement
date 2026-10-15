import { describe, expect, it } from 'vitest'
import { GST_STATES, stateFromGstin, stateOptions } from './indianStates'

describe('stateFromGstin', () => {
  it('reads the state code at the start of a GSTIN', () => {
    expect(stateFromGstin('29ABCDE1234F1Z5')).toBe('Karnataka')
    expect(stateFromGstin(' 07aaaca1234a1z5')).toBe('Delhi')
    expect(stateFromGstin('27')).toBe('Maharashtra')
  })

  it('is empty when the code is unknown or missing', () => {
    expect(stateFromGstin('99ABCDE1234F1Z5')).toBe('')
    expect(stateFromGstin('2')).toBe('')
    expect(stateFromGstin(null)).toBe('')
  })
})

describe('stateOptions', () => {
  it('lists every state once, with unique codes', () => {
    const names = stateOptions('')
    expect(names).toHaveLength(GST_STATES.length)
    expect(new Set(GST_STATES.map((s) => s.code)).size).toBe(GST_STATES.length)
  })

  it('keeps a value typed before the list existed', () => {
    expect(stateOptions('karnataka ')[0]).toBe('karnataka ')
    expect(stateOptions('Kerala')).toHaveLength(GST_STATES.length)
  })
})
