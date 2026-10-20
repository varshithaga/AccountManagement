import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Bot, MessageSquarePlus, Send, Sparkles, Trash2, User as UserIcon } from 'lucide-react'
import { Alert, Button, IconButton, Panel, Spinner } from '../../components/tw'
import { PageHeader } from '../../components/PageParts'
import { errorText } from '../Billing/billingapi'
import Markdown from './Markdown'
import {
  aiApi, PROVIDER_LABEL, SUGGESTIONS, TOOL_LABEL, type AiConversation, type AiMessage, type AiStatus,
} from './aiapi'

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

/** A chat that answers questions about the books from LedgerDesk's own reports. Read-only. */
export default function AiAssistantPage() {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [chats, setChats] = useState<AiConversation[]>([])
  const [chatId, setChatId] = useState<number | null>(null)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [input, setInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [loadingChat, setLoadingChat] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingIds = useRef(0)

  useEffect(() => {
    aiApi.status().then(setStatus).catch((err) => setError(errorText(err, 'Could not reach the AI Assistant.')))
    aiApi.conversations().then(setChats).catch(() => {})
  }, [])

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, asking])

  const openChat = async (id: number) => {
    if (asking) return
    setChatId(id)
    setError('')
    setLoadingChat(true)
    try {
      setMessages((await aiApi.conversation(id)).messages ?? [])
    } catch (err) {
      setError(errorText(err, 'Could not open that chat.'))
    } finally {
      setLoadingChat(false)
    }
  }

  const newChat = () => {
    if (asking) return
    setChatId(null)
    setMessages([])
    setError('')
  }

  const deleteChat = async (id: number) => {
    if (!window.confirm('Delete this chat?')) return
    try {
      await aiApi.remove(id)
      setChats((list) => list.filter((c) => c.id !== id))
      if (id === chatId) newChat()
    } catch (err) {
      setError(errorText(err, 'Could not delete the chat.'))
    }
  }

  const ask = async (text: string) => {
    const question = text.trim()
    if (!question || asking) return
    setError('')
    setAsking(true)
    setInput('')
    // Shown straight away; replaced by the saved copy (or taken back if no answer comes).
    pendingIds.current += 1
    const pending: AiMessage = { id: -pendingIds.current, role: 'user', content: question, provider: '', tools: [], created_at: '' }
    setMessages((list) => [...list, pending])
    try {
      const result = await aiApi.chat(question, chatId)
      setMessages((list) => [...list.filter((m) => m.id !== pending.id), ...result.messages])
      setChatId(result.conversation.id)
      setChats((list) => [result.conversation, ...list.filter((c) => c.id !== result.conversation.id)])
    } catch (err) {
      setMessages((list) => list.filter((m) => m.id !== pending.id))
      setInput(question)
      setError(errorText(err, 'The AI Assistant could not answer. Please try again.'))
    } finally {
      setAsking(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      ask(input)
    }
  }

  const enabled = status?.enabled ?? false
  const suggestions = SUGGESTIONS.filter((s) => status?.tools.includes(s.tool)).slice(0, 4)
  const providers = (status?.providers ?? []).map((p) => PROVIDER_LABEL[p] ?? p)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI Assistant"
        description="Ask questions about your books in plain words - profit, GST, overdue invoices, what a client owes. Answers come from the same reports you see in LedgerDesk, limited to the pages your role can open. It can only read: it never creates or changes anything."
        actions={<Button variant="outlined" icon={<MessageSquarePlus className="h-4 w-4" />} onClick={newChat} disabled={asking}>New chat</Button>}
      />

      {status && !enabled && (
        <Alert>The AI Assistant is not set up yet. An administrator needs to add GEMINI_API_KEY (and optionally OPENAI_API_KEY) to backend/.env and restart the server.</Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Panel className="flex max-h-[30vh] flex-col gap-1 overflow-y-auto p-3 lg:max-h-[calc(100vh-260px)]">
          <p className="px-2 pb-1 text-xs font-bold uppercase tracking-[0.08em] text-muted">Your chats</p>
          {chats.length === 0 && <p className="px-2 py-3 text-sm text-muted">No chats yet.</p>}
          {chats.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-2 rounded-xl px-2 py-2 text-sm ${c.id === chatId ? 'bg-primary-soft text-ink' : 'text-ink hover:bg-surface-muted'}`}
            >
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openChat(c.id)} disabled={asking}>
                <span className="block truncate font-medium">{c.title || 'Chat'}</span>
                <span className="text-xs text-muted">{fmtDay(c.updated_at)}</span>
              </button>
              <IconButton title="Delete chat" onClick={() => deleteChat(c.id)} disabled={asking}>
                <Trash2 className="h-4 w-4 stroke-[1.8]" />
              </IconButton>
            </div>
          ))}
        </Panel>

        <Panel className="flex min-h-[60vh] flex-col p-0 lg:h-[calc(100vh-260px)]">
          <div ref={scrollRef} className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6">
            {loadingChat ? (
              <div className="flex flex-1 items-center justify-center"><Spinner size={28} /></div>
            ) : messages.length === 0 ? (
              <div className="m-auto flex max-w-xl flex-col items-center gap-4 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                  <Sparkles className="h-7 w-7 stroke-[1.8]" />
                </div>
                <p className="font-display text-base font-semibold text-ink">What would you like to know?</p>
                {suggestions.length > 0 && enabled && (
                  <div className="flex flex-wrap justify-center gap-2">
                    {suggestions.map((s) => (
                      <button
                        key={s.text}
                        type="button"
                        onClick={() => ask(s.text)}
                        className="rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm text-ink hover:border-primary hover:bg-primary-soft"
                      >
                        {s.text}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${m.role === 'user' ? 'bg-surface-muted text-muted' : 'bg-primary-soft text-primary'}`}>
                    {m.role === 'user' ? <UserIcon className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>
                  <div className={`min-w-0 max-w-[85%] rounded-2xl px-4 py-3 ${m.role === 'user' ? 'bg-primary text-white' : 'border border-border bg-surface'}`}>
                    {m.role === 'user' ? (
                      <p className="whitespace-pre-wrap text-sm">{m.content}</p>
                    ) : (
                      <>
                        <Markdown text={m.content} />
                        {(m.tools.length > 0 || m.provider) && (
                          <p className="mt-2 border-t border-border pt-2 text-xs text-muted">
                            {m.tools.length > 0 && <>Looked up: {m.tools.map((t) => TOOL_LABEL[t] ?? t).join(', ')}</>}
                            {m.tools.length > 0 && m.provider && ' · '}
                            {m.provider && <>{PROVIDER_LABEL[m.provider] ?? m.provider}</>}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
            {asking && (
              <div className="flex items-center gap-3 text-sm text-muted">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-primary"><Bot className="h-4 w-4" /></div>
                <Spinner size={16} /> Looking into your books...
              </div>
            )}
          </div>

          {error && <Alert className="mx-4 mb-3">{error}</Alert>}

          <div className="border-t border-border p-3 sm:p-4">
            <div className="flex items-end gap-2">
              <textarea
                aria-label="Your question"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={2}
                maxLength={4000}
                disabled={!enabled || asking}
                placeholder={enabled ? 'Ask about your books... (Enter to send, Shift+Enter for a new line)' : 'The AI Assistant is not set up yet.'}
                className="min-h-[44px] w-full resize-none rounded-xl border border-input bg-surface px-3 py-2.5 text-sm text-ink outline-none placeholder:text-slate-400 focus:border-primary focus:ring-[3px] focus:ring-primary-soft disabled:opacity-50"
              />
              <Button variant="contained" icon={<Send className="h-4 w-4" />} onClick={() => ask(input)} disabled={!enabled || asking || !input.trim()}>
                Send
              </Button>
            </div>
            {enabled && (
              <p className="mt-2 text-xs text-muted">
                Answered by {providers.join(', then ')}. The figures it looks up are sent to that service. AI can make mistakes - check important figures in the reports.
              </p>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}
