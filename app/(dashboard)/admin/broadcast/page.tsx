// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /admin/broadcast — email your MVP users at once. Admin-only (the API 403s
// otherwise). Compose subject + body, pick an audience segment, see the live
// recipient count, send a test to yourself, then send to everyone. Every email
// carries a working one-click unsubscribe (CAN-SPAM).
'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { Button } from '@/components/ui/button'
import { Send, Users, Mail, ShieldCheck, Info, History, RefreshCw } from 'lucide-react'

type Audience = 'all' | 'trial' | 'paid' | 'creator' | 'studio' | 'pro'
type BroadcastLog = {
  id: string; createdAt: string; subject: string; audience: string
  total: number; sent: number; failed: number
  delivered: number; opened: number; clicked: number; bounced: number
}
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—')
const AUDIENCES: { id: Audience; label: string; hint: string }[] = [
  { id: 'all', label: 'All users', hint: 'Everyone (trial + paid)' },
  { id: 'trial', label: 'Trial only', hint: 'Free-trial accounts' },
  { id: 'paid', label: 'All paid', hint: 'Creator + Studio + Pro' },
  { id: 'creator', label: 'Creator', hint: 'Creator tier only' },
  { id: 'studio', label: 'Studio', hint: 'Studio tier only' },
  { id: 'pro', label: 'Pro', hint: 'Pro tier only' },
]

export default function BroadcastPage() {
  const [audience, setAudience] = useState<Audience>('all')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [count, setCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [busy, setBusy] = useState<'test' | 'send' | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [result, setResult] = useState<{ sent: number; failed: number; total: number } | null>(null)
  const [history, setHistory] = useState<BroadcastLog[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'log' }),
      })
      const data = await res.json()
      if (res.ok) setHistory(data.broadcasts ?? [])
    } catch { /* silent — the log is a nice-to-have */ }
    finally { setLoadingHistory(false) }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  const refreshCount = useCallback(async (aud: Audience) => {
    setCounting(true); setCount(null)
    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'count', audience: aud }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not count recipients.'); return }
      setCount(data.count ?? 0)
    } catch { toast.error('Network error.') }
    finally { setCounting(false) }
  }, [])

  useEffect(() => { refreshCount(audience) }, [audience, refreshCount])

  async function sendTest() {
    if (!subject.trim() || !body.trim()) { toast.error('Add a subject and body first.'); return }
    setBusy('test')
    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', subject, body, testTo: testTo.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Test send failed.'); return }
      toast.success(`Test sent to ${data.to} — check your inbox.`)
    } catch { toast.error('Network error.') }
    finally { setBusy(null) }
  }

  async function sendAll() {
    if (!subject.trim() || !body.trim()) { toast.error('Add a subject and body first.'); return }
    if (!count) { toast.error('No recipients in this segment.'); return }
    if (confirmText.trim().toUpperCase() !== 'SEND') { toast.error('Type SEND to confirm.'); return }
    setBusy('send'); setResult(null)
    const t = toast.loading(`Sending to ${count} ${count === 1 ? 'person' : 'people'}…`)
    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', audience, subject, body }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Send failed.', { id: t }); return }
      setResult({ sent: data.sent, failed: data.failed, total: data.total })
      setConfirmText('')
      toast.success(`Sent to ${data.sent} of ${data.total}${data.failed ? ` (${data.failed} failed)` : ''} ✓`, { id: t })
      loadHistory()
    } catch { toast.error('Network error.', { id: t }) }
    finally { setBusy(null) }
  }

  const canSend = subject.trim() && body.trim() && !!count && confirmText.trim().toUpperCase() === 'SEND' && busy !== 'send'

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <PageHero
        title="Broadcast email"
        subtitle="Send an email to all your trial and paid users at once. Nothing sends until you click the final button — send a test to yourself first."
      />

      {/* Audience */}
      <div className="card p-4 mt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-faint)' }}>Audience</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {AUDIENCES.map(a => (
            <button key={a.id} onClick={() => setAudience(a.id)}
              className="text-left rounded-lg px-3 py-2 border transition-colors"
              style={audience === a.id
                ? { borderColor: '#7C3AED', background: 'rgba(124,58,237,0.08)' }
                : { borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <span className="block text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{a.label}</span>
              <span className="block text-[11px]" style={{ color: 'var(--text-faint)' }}>{a.hint}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3 text-[13px]" style={{ color: 'var(--text-soft)' }}>
          <Users size={14} className="text-[#7C3AED]" />
          {counting ? 'Counting recipients…'
            : count === null ? '—'
            : <><b style={{ color: 'var(--text)' }}>{count.toLocaleString()}</b>&nbsp;{count === 1 ? 'recipient' : 'recipients'} (opted-out users excluded)</>}
        </div>
      </div>

      {/* Compose */}
      <div className="card p-4 mt-4 flex flex-col gap-3">
        <div>
          <label htmlFor="bc-subject" className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>Subject</label>
          <input id="bc-subject" value={subject} onChange={e => setSubject(e.target.value)}
            placeholder="e.g. New: turn any product into a blog + socials in 2 minutes"
            className="w-full mt-1 rounded-lg px-3 py-2 text-[14px]"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }} />
        </div>
        <div>
          <label htmlFor="bc-body" className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>Body</label>
          <textarea id="bc-body" value={body} onChange={e => setBody(e.target.value)} rows={9}
            placeholder={'Write like you\'re emailing one person.\n\nLeave a blank line between paragraphs. Bare links (https://…) become clickable automatically. An unsubscribe footer is added for you.'}
            className="w-full mt-1 rounded-lg px-3 py-2 text-[14px] leading-relaxed resize-y"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }} />
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint)' }}>
            From <b>MVP Affiliate &lt;noreply@mvpaffiliate.io&gt;</b> · replies go to your account email.
          </p>
        </div>
      </div>

      {/* Test */}
      <div className="card p-4 mt-4">
        <div className="flex items-center gap-2 mb-2">
          <Mail size={14} className="text-[#7C3AED]" />
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Send a test first</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={testTo} onChange={e => setTestTo(e.target.value)}
            placeholder="your@email.com (defaults to your account)"
            className="flex-1 min-w-[220px] rounded-lg px-3 py-2 text-[13px]"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }} />
          <Button variant="secondary" size="sm" loading={busy === 'test'} onClick={sendTest}>Send test</Button>
        </div>
      </div>

      {/* Send for real */}
      <div className="card p-4 mt-4" style={{ borderColor: 'rgba(220,38,38,0.25)' }}>
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck size={14} style={{ color: '#dc2626' }} />
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Send to everyone</p>
        </div>
        <p className="text-[12px] leading-relaxed mb-3" style={{ color: 'var(--text-soft)' }}>
          This emails <b>{count === null ? '…' : count.toLocaleString()}</b> {AUDIENCES.find(a => a.id === audience)?.label.toLowerCase()} — it cannot be undone. Type <b>SEND</b> to confirm.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="Type SEND"
            className="w-32 rounded-lg px-3 py-2 text-[13px] font-semibold tracking-wide"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }} />
          <Button variant="primary" size="sm" loading={busy === 'send'} disabled={!canSend}
            leftIcon={<Send className="h-4 w-4" />} onClick={sendAll}>
            Send broadcast
          </Button>
        </div>
        {result && (
          <div className="flex items-start gap-2 mt-3 rounded-lg px-3 py-2 text-[12px]"
            style={{ background: 'rgba(52,199,89,0.08)', border: '1px solid rgba(52,199,89,0.25)', color: 'var(--text-soft)' }}>
            <Info size={13} className="mt-0.5 flex-shrink-0" style={{ color: '#34c759' }} />
            <span>Delivered to <b style={{ color: 'var(--text)' }}>{result.sent}</b> of {result.total}{result.failed ? ` · ${result.failed} failed (bad/blocked addresses)` : ' · no failures'}.</span>
          </div>
        )}
      </div>

      {/* Send history */}
      <div className="card p-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <History size={14} className="text-[#7C3AED]" />
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Recent broadcasts</p>
          </div>
          <button onClick={loadHistory} title="Refresh" className="inline-flex items-center gap-1 text-[11px] font-semibold hover:underline" style={{ color: '#7C3AED' }}>
            <RefreshCw size={11} className={loadingHistory ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
        {history.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
            {loadingHistory ? 'Loading…' : 'No broadcasts sent yet. Your history and open/click rates will show here.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr style={{ color: 'var(--text-faint)' }} className="text-left">
                  <th className="font-semibold pb-2 pr-3">Sent</th>
                  <th className="font-semibold pb-2 pr-3">Subject</th>
                  <th className="font-semibold pb-2 pr-3">To</th>
                  <th className="font-semibold pb-2 pr-3 text-right">Recipients</th>
                  <th className="font-semibold pb-2 pr-3 text-right">Opened</th>
                  <th className="font-semibold pb-2 text-right">Clicked</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--text-soft)' }}>
                {history.map(h => (
                  <tr key={h.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(h.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
                    <td className="py-2 pr-3 max-w-[220px] truncate" title={h.subject} style={{ color: 'var(--text)' }}>{h.subject}</td>
                    <td className="py-2 pr-3 capitalize">{h.audience}</td>
                    <td className="py-2 pr-3 text-right">{h.sent}{h.failed ? <span style={{ color: '#dc2626' }}> (−{h.failed})</span> : ''}</td>
                    <td className="py-2 pr-3 text-right">{h.opened} <span style={{ color: 'var(--text-faint)' }}>({pct(h.opened, h.delivered || h.sent)})</span></td>
                    <td className="py-2 text-right">{h.clicked} <span style={{ color: 'var(--text-faint)' }}>({pct(h.clicked, h.delivered || h.sent)})</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
              Open/click rates fill in over the following minutes/hours as Resend reports engagement (needs the Resend webhook configured). Opens are unique per person.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
