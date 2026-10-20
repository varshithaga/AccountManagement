import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AiAssistantPage from './AiAssistantPage'
import { aiApi, type AiMessage } from './aiapi'

vi.mock('./aiapi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./aiapi')>()),
  aiApi: { status: vi.fn(), conversations: vi.fn(), conversation: vi.fn(), remove: vi.fn(), chat: vi.fn() },
}))

const message = (id: number, role: AiMessage['role'], content: string, extra: Partial<AiMessage> = {}): AiMessage =>
  ({ id, role, content, provider: '', tools: [], created_at: '2026-10-20T10:00:00Z', ...extra })
const chat = { id: 7, title: 'Overdue?', created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AiAssistantPage', () => {
  it('asks a question and shows the answer with what it looked up', async () => {
    vi.mocked(aiApi.status).mockResolvedValue({ enabled: true, providers: ['gemini', 'openai'], tools: ['list_sales_invoices'] })
    vi.mocked(aiApi.conversations).mockResolvedValue([])
    vi.mocked(aiApi.chat).mockResolvedValue({
      conversation: chat,
      messages: [message(1, 'user', 'Which invoices are overdue?'),
        message(2, 'assistant', '**INV-1** is overdue.', { provider: 'gemini', tools: ['list_sales_invoices'] })],
    })
    render(<AiAssistantPage />)

    // Only suggestions the role can answer are offered.
    fireEvent.click(await screen.findByRole('button', { name: 'Which sales invoices are overdue, and by how much?' }))
    expect(screen.queryByText('What is our net profit this financial year so far?')).toBeNull()

    expect(await screen.findByText('INV-1')).toBeTruthy()
    expect(screen.getByText(/Looked up: Sales invoices/)).toBeTruthy()
    expect(aiApi.chat).toHaveBeenCalledWith('Which sales invoices are overdue, and by how much?', null)
    expect(screen.getByRole('button', { name: /Overdue\?/ })).toBeTruthy()  // the new chat is listed

    // The next question continues the same chat.
    vi.mocked(aiApi.chat).mockResolvedValue({ conversation: chat, messages: [message(3, 'user', 'And INV-2?'), message(4, 'assistant', 'Paid.')] })
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'And INV-2?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(aiApi.chat).toHaveBeenLastCalledWith('And INV-2?', 7))
  })

  it('gives the question back when no answer comes', async () => {
    vi.mocked(aiApi.status).mockResolvedValue({ enabled: true, providers: ['gemini'], tools: [] })
    vi.mocked(aiApi.conversations).mockResolvedValue([])
    vi.mocked(aiApi.chat).mockRejectedValue({ response: { data: { detail: 'The AI service did not answer just now.' } } })
    render(<AiAssistantPage />)
    const box = await screen.findByLabelText<HTMLTextAreaElement>('Your question')
    await waitFor(() => expect(box.disabled).toBe(false))
    fireEvent.change(box, { target: { value: 'Hello' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('The AI service did not answer just now.')).toBeTruthy()
    expect(box.value).toBe('Hello')
  })

  it('says when it is not set up', async () => {
    vi.mocked(aiApi.status).mockResolvedValue({ enabled: false, providers: [], tools: [] })
    vi.mocked(aiApi.conversations).mockResolvedValue([])
    render(<AiAssistantPage />)
    expect(await screen.findByText(/not set up yet\. An administrator/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true)
  })
})
