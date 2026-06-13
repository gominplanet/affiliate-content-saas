'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { Loader2, Send, Plus, Trash2, MessageSquare, Sparkles, Brain, X, Upload } from 'lucide-react'
import { useConfirm } from '@/components/ui/useConfirm'
import { MessageMarkdown } from '@/components/assistant/MessageMarkdown'

interface Conversation { id: string; title: string; updated_at: string }
interface Msg { role: 'user' | 'assistant'; content: string }

const STARTERS = [
  'How do I get my first review published?',
  'What niche converts best for Amazon affiliates?',
  'Why isn\'t my YouTube thumbnail generating?',
  'How do I land my first brand collaboration?',
]

export default function AssistantPage() {
  const { confirm, ConfirmHost } = useConfirm()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState('')
  const [error, setError] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  // Memory panel
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memory, setMemory] = useState('')
  const [importText, setImportText] = useState('')
  const [memoryBusy, setMemoryBusy] = useState(false)
  const [memoryMsg, setMemoryMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function openMemory() {
    setMemoryOpen(true); setMemoryMsg(null)
    try {
      const res = await fetch('/api/assistant/memory')
      const d = await res.json()
      setMemory(d.memory || '')
    } catch { /* ignore */ }
  }

  async function importToMemory() {
    const text = importText.trim()
    if (!text || memoryBusy) return
    setMemoryBusy(true); setMemoryMsg(null)
    try {
      const res = await fetch('/api/assistant/memory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const d = await res.json()
      if (!res.ok) { setMemoryMsg(d.error || 'Import failed'); return }
      setMemory(d.memory || '')
      setImportText('')
      setMemoryMsg(d.note || 'Added to your assistant\'s memory ✓')
    } catch { setMemoryMsg('Import failed') }
    finally { setMemoryBusy(false) }
  }

  async function clearMemory() {
    setMemoryBusy(true)
    try {
      await fetch('/api/assistant/memory', { method: 'DELETE' })
      setMemory(''); setMemoryMsg('Memory cleared.')
    } catch { /* ignore */ }
    finally { setMemoryBusy(false) }
  }

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/assistant/conversations')
      const d = await res.json()
      setConversations(d.conversations ?? [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadConversations() }, [loadConversations])

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streaming])

  async function openConversation(id: string) {
    setActiveId(id)
    setError(null)
    setStreaming('')
    try {
      const res = await fetch(`/api/assistant/conversations/${id}`)
      const d = await res.json()
      setMessages((d.messages ?? []).map((m: Msg) => ({ role: m.role, content: m.content })))
    } catch { setMessages([]) }
  }

  function newChat() {
    setActiveId(null)
    setMessages([])
    setStreaming('')
    setError(null)
  }

  async function deleteConversation(id: string) {
    const ok = await confirm({
      title: 'Delete this conversation?',
      description: 'The messages will be removed for good.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/assistant/conversations/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error(`Couldn't delete (${res.status})`)
        return
      }
      if (activeId === id) newChat()
      loadConversations()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function send(text: string) {
    const msg = text.trim()
    if (!msg || sending) return
    setError(null)
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: msg }])
    setSending(true)
    setStreaming('')
    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeId, message: msg }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || `Error ${res.status}`)
        setMessages(prev => prev.slice(0, -1)) // roll back the optimistic user msg
        setSending(false)
        return
      }
      const convId = res.headers.get('X-Conversation-Id')
      if (convId && !activeId) setActiveId(convId)

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      if (reader) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          acc += decoder.decode(value, { stream: true })
          setStreaming(acc)
        }
      }
      setMessages(prev => [...prev, { role: 'assistant', content: acc }])
      setStreaming('')
      loadConversations()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <PageHero title="MVP Help Desk" subtitle="Your product guide + affiliate coach. Ask how to do anything in MVP Affiliate, or get strategy advice for your niche." />

      <div className="flex gap-4 h-[calc(100vh-180px)] min-h-[480px]">
        {/* Conversation list */}
        <div className="w-56 flex-shrink-0 flex flex-col gap-2">
          <button onClick={newChat} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[#7C3AED] text-white hover:bg-[#6D28D9]">
            <Plus size={13} /> New chat
          </button>
          <button onClick={openMemory} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#7C3AED]/40" title="What MVP remembers about you — view, import from another AI tool, or clear">
            <Brain size={13} /> Memory
          </button>
          <div className="flex-1 overflow-y-auto flex flex-col gap-1">
            {conversations.map(c => (
              <div key={c.id} className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 cursor-pointer text-xs ${activeId === c.id ? 'bg-[#7C3AED]/10 text-[#7C3AED]' : 'hover:bg-gray-100 dark:hover:bg-white/5 text-[#1d1d1f] dark:text-[#f5f5f7]'}`}>
                <MessageSquare size={12} className="flex-shrink-0 opacity-60" />
                <button onClick={() => openConversation(c.id)} className="flex-1 text-left truncate">{c.title}</button>
                <button onClick={() => deleteConversation(c.id)} className="opacity-0 group-hover:opacity-100 text-[#86868b] hover:text-[#ff3b30]" title="Delete">
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            {conversations.length === 0 && (
              <p className="text-[11px] text-[#86868b] px-2 py-2">No chats yet.</p>
            )}
          </div>
        </div>

        {/* Thread */}
        <div className="flex-1 flex flex-col rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] overflow-hidden">
          <div ref={threadRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {messages.length === 0 && !streaming && (
              <div className="m-auto max-w-md text-center">
                <div className="w-12 h-12 rounded-2xl bg-[#7C3AED]/10 flex items-center justify-center mx-auto mb-3">
                  <Sparkles size={22} className="text-[#7C3AED]" />
                </div>
                <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">How can I help?</p>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">Ask about using MVP Affiliate, or affiliate strategy for your niche.</p>
                <div className="flex flex-col gap-2">
                  {STARTERS.map(s => (
                    <button key={s} onClick={() => send(s)} className="text-left text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 hover:border-[#7C3AED]/40 text-[#1d1d1f] dark:text-[#f5f5f7]">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${m.role === 'user' ? 'bg-[#7C3AED] text-white whitespace-pre-wrap' : 'bg-gray-100 dark:bg-white/5 text-[#1d1d1f] dark:text-[#f5f5f7]'}`}>
                  {m.role === 'user' ? m.content : <MessageMarkdown content={m.content} />}
                </div>
              </div>
            ))}
            {streaming && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed bg-gray-100 dark:bg-white/5 text-[#1d1d1f] dark:text-[#f5f5f7]">
                  <MessageMarkdown content={streaming} />
                </div>
              </div>
            )}
            {sending && !streaming && (
              <div className="flex justify-start"><Loader2 size={16} className="animate-spin text-[#86868b]" /></div>
            )}
          </div>

          {error && (
            <p className="px-4 py-2 text-xs text-[#ff3b30] border-t border-[#ff3b30]/20 bg-[#ff3b30]/5">{error}</p>
          )}

          {/* Composer */}
          <div className="border-t border-gray-200 dark:border-white/10 p-3 flex items-end gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
              placeholder="Ask anything…"
              rows={1}
              className="flex-1 resize-none input-field text-sm max-h-32"
            />
            <button
              onClick={() => send(input)}
              disabled={sending || !input.trim()}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-50 flex-shrink-0"
            >
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
        </div>
      </div>

      {/* Memory panel */}
      {memoryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMemoryOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#1c1c1e] p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Brain size={18} className="text-[#7C3AED]" />
                <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Assistant memory</h3>
              </div>
              <button onClick={() => setMemoryOpen(false)} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"><X size={16} /></button>
            </div>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">This is what MVP remembers about you across all chats. It updates itself as you talk — and you can seed it by importing your history from any AI tool you&apos;ve been using.</p>

            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#86868b] mb-1">Current memory</label>
            <div className="rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0a0a0a] p-3 text-xs text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-pre-wrap min-h-[60px] mb-4">
              {memory || <span className="text-[#86868b]">Nothing yet — chat a bit, or import below.</span>}
            </div>

            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#86868b] mb-1">Import knowledge</label>
            <p className="text-[11px] text-[#86868b] mb-2">Paste anything you want it to know — or upload a text/markdown/JSON export from another AI tool. We distill the durable facts and merge them in (we don&apos;t store the raw dump).</p>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              rows={5}
              placeholder="Paste your assistant export or notes here…"
              className="input-field w-full text-xs mb-2"
            />
            <input ref={fileRef} type="file" accept=".txt,.md,.json,.csv,text/plain" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) { const t = await f.text(); setImportText(prev => (prev ? prev + '\n\n' : '') + t.slice(0, 200000)) } e.target.value = '' }} />
            <div className="flex items-center gap-2 mb-3">
              <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-white/10 hover:border-[#7C3AED]/40">
                <Upload size={12} /> Upload file
              </button>
              <button onClick={importToMemory} disabled={memoryBusy || !importText.trim()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-50">
                {memoryBusy ? <Loader2 size={12} className="animate-spin" /> : <Brain size={12} />} Import to memory
              </button>
            </div>
            {memoryMsg && <p className="text-[11px] text-[#34c759] mb-3">{memoryMsg}</p>}
            <button onClick={clearMemory} disabled={memoryBusy} className="text-[11px] text-[#86868b] hover:text-[#ff3b30] disabled:opacity-50">Clear all memory</button>
          </div>
        </div>
      )}
      <ConfirmHost />
    </>
  )
}
