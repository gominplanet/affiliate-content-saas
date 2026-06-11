'use client'

import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react'
import { toast } from 'sonner'
import { Loader2, Send, X, MessageCircle } from 'lucide-react'
import { MessageMarkdown } from '@/components/assistant/MessageMarkdown'

interface Msg { role: 'user' | 'assistant'; content: string }

interface HelpDeskContextType {
  open: boolean
  setOpen: (open: boolean) => void
}

const HelpDeskContext = createContext<HelpDeskContextType | undefined>(undefined)

export function HelpDeskProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <HelpDeskContext.Provider value={{ open, setOpen }}>
      {children}
    </HelpDeskContext.Provider>
  )
}

function useHelpDesk() {
  const ctx = useContext(HelpDeskContext)
  if (!ctx) throw new Error('useHelpDesk must be used inside HelpDeskProvider')
  return ctx
}

export function HelpDeskButton() {
  const { setOpen } = useHelpDesk()

  return (
    <button
      onClick={() => setOpen(true)}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-[#0071E3] to-[#0051BA] hover:from-[#0051BA] hover:to-[#003D8A] transition-all shadow-md hover:shadow-lg"
      title="Ask Me For Help"
    >
      <MessageCircle size={18} />
      <span className="hidden sm:inline">Ask Me</span>
    </button>
  )
}

export function HelpDeskPanel() {
  const { open, setOpen } = useHelpDesk()
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState('')
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streaming])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return

    const userMsg: Msg = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setSending(true)
    setStreaming('')

    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })

      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Failed to get response')
        setSending(false)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        setSending(false)
        return
      }

      let assembled = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = new TextDecoder().decode(value)
        assembled += chunk
        setStreaming(assembled)
      }

      setMessages(prev => [...prev, { role: 'assistant', content: assembled }])
      setStreaming('')
    } catch (err) {
      console.error('Help Desk error:', err)
      toast.error('Connection error')
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }, [input, sending])

  if (!open) return null

  return (
    <div className="fixed bottom-0 right-0 w-full sm:w-96 h-full sm:h-[600px] sm:rounded-l-lg bg-white dark:bg-[#1a1a1a] border-l border-gray-200 dark:border-white/10 shadow-2xl flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-white/10">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-white">MVP Help Desk</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">Ask anything about MVP</p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="p-1 hover:bg-gray-100 dark:hover:bg-white/10 rounded transition-colors"
          aria-label="Close help desk"
        >
          <X size={20} className="text-gray-600 dark:text-gray-400" />
        </button>
      </div>

      {/* Messages */}
      <div
        ref={threadRef}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {messages.length === 0 && !streaming && (
          <div className="flex items-center justify-center h-full text-center">
            <div>
              <MessageCircle size={40} className="text-gray-300 dark:text-gray-700 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Ask questions about features, setup, or troubleshooting.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-xs px-3 py-2 rounded-lg ${
                msg.role === 'user'
                  ? 'bg-[#0071E3] text-white'
                  : 'bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-white'
              }`}
            >
              {msg.role === 'assistant' ? (
                <MessageMarkdown content={msg.content} />
              ) : (
                <p className="text-sm">{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-xs px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-white">
              <MessageMarkdown content={streaming} />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200 dark:border-white/10 space-y-2">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="Ask MVP Help Desk..."
            disabled={sending}
            className="flex-1 px-3 py-2 border border-gray-200 dark:border-white/20 rounded-lg bg-white dark:bg-white/5 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-[#0071E3] disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="p-2 rounded-lg bg-[#0071E3] text-white hover:bg-[#0051BA] disabled:opacity-50 transition-colors"
            aria-label="Send"
          >
            {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  )
}

// Legacy export for backward compatibility
export function HelpDeskSidebar() {
  return <HelpDeskPanel />
}
