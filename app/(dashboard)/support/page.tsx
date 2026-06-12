'use client'

import { useState, useEffect, useCallback } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, LifeBuoy, CheckCircle2, Clock, Send } from 'lucide-react'
import { toast } from 'sonner'

interface SupportTicket {
  id: string
  subject: string
  body: string
  status: 'open' | 'answered' | 'closed'
  admin_response: string | null
  responded_at: string | null
  created_at: string
}

function StatusBadge({ status }: { status: SupportTicket['status'] }) {
  const map = {
    open: { label: 'Waiting for reply', cls: 'bg-amber-500/15 text-amber-500', icon: <Clock size={12} /> },
    answered: { label: 'Answered', cls: 'bg-[#34c759]/15 text-[#34c759]', icon: <CheckCircle2 size={12} /> },
    closed: { label: 'Closed', cls: 'bg-gray-500/15 text-gray-400', icon: <CheckCircle2 size={12} /> },
  }[status]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${map.cls}`}>
      {map.icon} {map.label}
    </span>
  )
}

export default function SupportPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/support/tickets')
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load')
      setTickets(d.tickets || [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load your tickets')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function submit() {
    if (!subject.trim() || !body.trim()) {
      toast.error('Add a subject and a message first.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to send')
      setSubject(''); setBody('')
      setTickets(prev => [d.ticket, ...prev])
      toast.success('Ticket sent — we’ll reply right here in MVP.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send your ticket')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHero
        title="Create a Help Ticket"
        subtitle="Stuck on something? Send us a ticket and we'll answer right here — no email needed. You'll see the reply on this page and get a notification when it lands."
      />

      {/* New ticket */}
      <div className="card p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <LifeBuoy size={16} className="text-[#7C3AED]" />
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">New ticket</p>
        </div>
        <label htmlFor="ticket-subject" className="block text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">Subject</label>
        <input
          id="ticket-subject"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          maxLength={200}
          placeholder="What do you need help with?"
          className="w-full mb-4 px-3 py-2 rounded-lg text-sm bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-[#7C3AED]"
        />
        <label htmlFor="ticket-body" className="block text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">Message</label>
        <textarea
          id="ticket-body"
          value={body}
          onChange={e => setBody(e.target.value)}
          maxLength={5000}
          rows={5}
          placeholder="Describe what's happening, what you expected, and any steps you've already tried. The more detail, the faster we can help."
          className="w-full mb-4 px-3 py-2 rounded-lg text-sm bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-[#7C3AED] resize-y"
        />
        <button
          onClick={submit}
          disabled={submitting}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[#7C3AED] text-white hover:bg-[#6d28d9] disabled:opacity-50 transition-colors"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {submitting ? 'Sending…' : 'Send ticket'}
        </button>
      </div>

      {/* History */}
      <div className="flex items-center gap-2 mb-3">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Your tickets</p>
        {loading && <Loader2 size={13} className="animate-spin text-[#86868b]" />}
      </div>

      {!loading && tickets.length === 0 && (
        <div className="card p-6 text-center">
          <p className="text-sm text-[#86868b] dark:text-[#8e8e93]">No tickets yet. Send your first one above.</p>
        </div>
      )}

      <div className="space-y-3">
        {tickets.map(t => (
          <div key={t.id} className="card p-5">
            <div className="flex items-start justify-between gap-3 mb-2">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] flex-1">{t.subject}</p>
              <StatusBadge status={t.status} />
            </div>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] whitespace-pre-wrap mb-1">{t.body}</p>
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mb-2">
              Sent {new Date(t.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </p>

            {t.admin_response && (
              <div className="mt-3 rounded-lg border-l-2 border-[#7C3AED] bg-[#7C3AED]/[0.06] p-3">
                <p className="text-[11px] font-semibold text-[#7C3AED] mb-1">MVP Support replied</p>
                <p className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-pre-wrap">{t.admin_response}</p>
                {t.responded_at && (
                  <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-1.5">
                    {new Date(t.responded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
