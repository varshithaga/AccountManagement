import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CompanyPanel from './CompanyPanel'
import { periodCloseApi, type Company, type PeriodCloseState } from './periodcloseapi'

vi.mock('./periodcloseapi', () => ({ periodCloseApi: { saveCompany: vi.fn() } }))

const blank: Company = { name: '', gstin: '', state: '', address: '', email: '', phone: '' }

const stateWith = (company: Company): PeriodCloseState => ({
  closed_through: null, history: [], fiscal_year_start_month: 4,
  current_fiscal_year: { start: '2026-04-01', end: '2027-03-31' }, company,
})

/** Like the Period Close page: the saved state comes back down as the company. */
function Page({ onSaved }: { onSaved: (s: PeriodCloseState) => void }) {
  const [company, setCompany] = useState(blank)
  return <CompanyPanel company={company} canEdit onSaved={(s) => { setCompany(s.company); onSaved(s) }} />
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CompanyPanel', () => {
  it('fills the state in from the GSTIN and saves what the server returns', async () => {
    const saved = { ...blank, name: 'Ledgerline', gstin: '29AAACA1234A1Z5', state: 'Karnataka' }
    vi.mocked(periodCloseApi.saveCompany).mockResolvedValue(stateWith(saved))
    const onSaved = vi.fn()
    render(<Page onSaved={onSaved} />)

    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toHaveProperty('disabled', true)  // nothing changed yet

    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Ledgerline' } })
    fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: '29aaaca1234a1z5' } })
    expect(screen.getByText('Karnataka')).toBeTruthy()  // picked from the GSTIN's state code
    expect(save).toHaveProperty('disabled', false)

    fireEvent.click(save)
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(stateWith(saved)))
    expect(periodCloseApi.saveCompany).toHaveBeenCalledWith({ ...blank, name: 'Ledgerline', gstin: '29aaaca1234a1z5', state: 'Karnataka' })
    expect(screen.getByLabelText<HTMLInputElement>('GSTIN').value).toBe('29AAACA1234A1Z5')
    expect(screen.getByText('Saved')).toBeTruthy()
    expect(save).toHaveProperty('disabled', true)  // nothing left to save
  })

  it('shows the error the server gives', async () => {
    vi.mocked(periodCloseApi.saveCompany).mockRejectedValue({ response: { data: { company_gstin: ['A GSTIN has 15 characters.'] } } })
    render(<CompanyPanel company={blank} canEdit onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('company gstin: A GSTIN has 15 characters.')).toBeTruthy()
  })

  it('is read-only without the edit right', () => {
    render(<CompanyPanel company={{ ...blank, name: 'Ledgerline' }} canEdit={false} onSaved={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.getByLabelText<HTMLInputElement>('Company name').disabled).toBe(true)
  })
})
