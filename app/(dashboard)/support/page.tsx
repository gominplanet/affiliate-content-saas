'use client'

import { useState, useEffect, useCallback } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, LifeBuoy, CheckCircle2, Clock, Send, ImagePlus, X } from 'lucide-react'
import { toast } from 'sonner'

interface SupportMessage {
  id: string
  sender: 'user' | 'admin'
  body: string
  imageUrl?: string | null
  created_at: string
}

/** Upload one screenshot to Supabase storage; returns its public URL. */
async function uploadSupportImage(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/support/upload', { method: 'POST', body: fd })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || !d.url) throw new Error(d.error || 'Upload failed')
  return d.url as string
}

interface SupportTicket {
  id: string
  subject: string
  body: string
  status: 'open' | 'answered' | 'closed'
  admin_response: string | null
  responded_at: string | null
  created_at: string
  messages?: SupportMessage[]
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

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Normalize a ticket to a message list, synthesizing from the legacy
 *  body/admin_response fields when a pre-thread ticket has no messages array. */
function threadOf(t: SupportTicket): SupportMessage[] {
  if (t.messages && t.messages.length > 0) return t.messages
  const out: SupportMessage[] = [{ id: `${t.id}:body`, sender: 'user', body: t.body, created_at: t.created_at }]
  if (t.admin_response) out.push({ id: `${t.id}:resp`, sender: 'admin', body: t.admin_response, created_at: t.responded_at ?? t.created_at })
  return out
}

function Thread({ ticket, onReplied }: { ticket: SupportTicket; onReplied: (ticketId: string, m: SupportMessage) => void }) {
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const messages = threadOf(ticket)

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    setUploading(true)
    try { setImageUrl(await uploadSupportImage(f)) }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Upload failed') }
    finally { setUploading(false) }
  }

  async function sendReply() {
    const body = reply.trim()
    if (!body && !imageUrl) return
    setSending(true)
    try {
      const res = await fetch('/api/support/tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: ticket.id, body, imageUrl }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to send')
      setReply(''); setImageUrl(null)
      onReplied(ticket.id, d.message as SupportMessage)
      toast.success('Reply sent — we’ll get back to you here.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send your reply')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] flex-1">{ticket.subject}</p>
        <StatusBadge status={ticket.status} />
      </div>

      <div className="space-y-2.5">
        {messages.map(m => (
          <div key={m.id} className={m.sender === 'admin' ? 'flex justify-start' : 'flex justify-end'}>
            <div
              className={`max-w-[85%] rounded-lg p-3 ${
                m.sender === 'admin'
                  ? 'border-l-2 border-[#7C3AED] bg-[#7C3AED]/[0.06]'
                  : 'bg-black/[0.03] dark:bg-white/[0.05]'
              }`}
            >
              <p className={`text-[11px] font-semibold mb-1 ${m.sender === 'admin' ? 'text-[#7C3AED]' : 'text-[#6e6e73] dark:text-[#ebebf0]'}`}>
                {m.sender === 'admin' ? 'MVP Support' : 'You'}
              </p>
              {m.body && <p className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-pre-wrap">{m.body}</p>}
              {m.imageUrl && (
                <a href={m.imageUrl} target="_blank" rel="noopener noreferrer" className="block mt-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.imageUrl} alt="attachment" className="max-h-56 rounded-md border border-black/10 dark:border-white/10" loading="lazy" />
                </a>
              )}
              <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-1.5">{fmt(m.created_at)}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Attachment preview */}
      {imageUrl && (
        <div className="mt-3 relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="attachment preview" className="max-h-32 rounded-md border border-black/10 dark:border-white/10" />
          <button onClick={() => setImageUrl(null)} title="Remove attachment"
            className="absolute -top-2 -right-2 bg-black/70 text-white rounded-full p-0.5 hover:bg-black">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Reply box — a message on a closed ticket reopens it. */}
      <div className="mt-4 flex items-end gap-2">
        <textarea
          value={reply}
          onChange={e => setReply(e.target.value)}
          maxLength={5000}
          rows={2}
          placeholder={ticket.status === 'closed' ? 'Reply to reopen this ticket…' : 'Reply…'}
          className="flex-1 px-3 py-2 rounded-lg text-sm bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-[#7C3AED] resize-y"
        />
        <label title="Attach a screenshot" className="inline-flex items-center justify-center px-2.5 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-[#7C3AED] cursor-pointer shrink-0">
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onPickFile} className="hidden" disabled={uploading} />
        </label>
        <button
          onClick={sendReply}
          disabled={sending || uploading || (!reply.trim() && !imageUrl)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-[#7C3AED] text-white hover:bg-[#6d28d9] disabled:opacity-50 transition-colors shrink-0"
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Reply
        </button>
      </div>
    </div>
  )
}

export default function SupportPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [newImageUrl, setNewImageUrl] = useState<string | null>(null)
  const [newUploading, setNewUploading] = useState(false)

  async function onPickNewFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    setNewUploading(true)
    try { setNewImageUrl(await uploadSupportImage(f)) }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Upload failed') }
    finally { setNewUploading(false) }
  }

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
        body: JSON.stringify({ subject, body, imageUrl: newImageUrl }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to send')
      setSubject(''); setBody(''); setNewImageUrl(null)
      setTickets(prev => [d.ticket, ...prev])
      toast.success('Ticket sent — we’ll reply right here in MVP.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send your ticket')
    } finally {
      setSubmitting(false)
    }
  }

  // Optimistically append the user's reply + flip the ticket back to open.
  const handleReplied = useCallback((ticketId: string, m: SupportMessage) => {
    setTickets(prev => prev.map(t =>
      t.id === ticketId
        ? { ...t, status: 'open', messages: [...threadOf(t), m] }
        : t,
    ))
  }, [])

  return (
    <>
      <PageHero
        title="Help & Support"
        subtitle="Stuck on something? Start a ticket and we'll answer right here — no email needed. Every reply stays in the thread, so you can always see the full conversation."
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
        {newImageUrl && (
          <div className="mb-4 relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={newImageUrl} alt="attachment preview" className="max-h-32 rounded-md border border-black/10 dark:border-white/10" />
            <button onClick={() => setNewImageUrl(null)} title="Remove attachment"
              className="absolute -top-2 -right-2 bg-black/70 text-white rounded-full p-0.5 hover:bg-black">
              <X size={12} />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={submit}
            disabled={submitting || newUploading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[#7C3AED] text-white hover:bg-[#6d28d9] disabled:opacity-50 transition-colors"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {submitting ? 'Sending…' : 'Send ticket'}
          </button>
          <label title="Attach a screenshot" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-[#7C3AED] cursor-pointer text-sm">
            {newUploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            Screenshot
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onPickNewFile} className="hidden" disabled={newUploading} />
          </label>
        </div>
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
          <Thread key={t.id} ticket={t} onReplied={handleReplied} />
        ))}
      </div>
    </>
  )
}
