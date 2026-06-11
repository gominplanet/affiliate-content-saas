'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { Loader2, Send, X, MessageCircle } from 'lucide-react'
import { MessageMarkdown } from '@/components/assistant/MessageMarkdown'

interface Msg { role: 'user' | 'assistant'; content: string }

export function HelpDeskSidebar() {
  const [open, setOpen] = useState(false)
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
      const res = await fetch('/api/assistant/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversationId: null }),
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

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 w-12 h-12 rounded-full bg-gradient-to-br from-[#0071E3] to-[#0051BA] text-white shadow-lg hover:shadow-xl transition-shadow flex items-center justify-center z-40"
          aria-label="Open help desk"
          title="Ask MVP Help Desk"
        >
          <MessageCircle size={20} />
        </button>
      )}

      {/* Sidebar panel */}
      {open && (
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
      )}
    </>
  )
}
