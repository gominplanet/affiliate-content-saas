'use client'

import { useState, useEffect, useCallback } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, AlertCircle, Send, CheckCircle2, Clock, Archive, Zap } from 'lucide-react'
import { toast } from 'sonner'

interface AdminTicket {
  id: string
  user_id: string
  email: string | null
  subject: string
  body: string
  status: 'open' | 'answered' | 'closed'
  admin_response: string | null
  responded_at: string | null
  created_at: string
  tier?: string | null
  priority?: boolean
}

const FILTERS = ['open', 'answered', 'closed', 'all'] as const
type Filter = (typeof FILTERS)[number]

export default function AdminSupportTicketsPage() {
  const [filter, setFilter] = useState<Filter>('open')
  const [tickets, setTickets] = useState<AdminTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const res = await fetch(`/api/admin/support-tickets?status=${filter}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load')
      setTickets(d.tickets || [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  async function patch(id: string, payload: { admin_response?: string; status?: string }) {
    setSavingId(id)
    try {
      const res = await fetch('/api/admin/support-tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...payload }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to save')
      toast.success(payload.admin_response ? 'Reply sent — the user will see it in MVP.' : 'Ticket updated.')
      setDrafts(prev => { const n = { ...prev }; delete n[id]; return n })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSavingId(null)
    }
  }

  const openCount = tickets.filter(t => t.status === 'open').length

  return (
    <>
      <PageHero
        title="Support tickets (admin)"
        subtitle="Reply here and the user reads it back inside MVP. New tickets also email you so you don't have to keep checking this page."
      />

      <div className="flex items-center gap-2 mb-5">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
              filter === f ? 'bg-[#7C3AED] text-white' : 'bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]'
            }`}
          >
            {f}{f === 'open' && openCount > 0 ? ` (${openCount})` : ''}
          </button>
        ))}
        {loading && <Loader2 size={14} className="animate-spin text-[#86868b] ml-1" />}
      </div>

      {err && (
        <div className="card p-4 mb-5 flex items-center gap-2 text-sm text-[#ff3b30]">
          <AlertCircle size={14} /> {err}
        </div>
      )}

      {!loading && tickets.length === 0 && (
        <div className="card p-6 text-center">
          <p className="text-sm text-[#86868b] dark:text-[#8e8e93]">No {filter === 'all' ? '' : filter} tickets.</p>
        </div>
      )}

      <div className="space-y-3">
        {tickets.map(t => {
          const draft = drafts[t.id] ?? t.admin_response ?? ''
          const saving = savingId === t.id
          return (
            <div key={t.id} className="card p-5">
              <div className="flex items-start justify-between gap-3 mb-1">
                <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] flex-1">{t.subject}</p>
                <div className="flex items-center gap-1.5 shrink-0">
                  {t.priority && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#7C3AED]/15 text-[#7C3AED]">
                      <Zap size={12} /> Priority{t.tier ? ` · ${t.tier}` : ''}
                    </span>
                  )}
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    t.status === 'open' ? 'bg-amber-500/15 text-amber-500'
                      : t.status === 'answered' ? 'bg-[#34c759]/15 text-[#34c759]'
                      : 'bg-gray-500/15 text-gray-400'
                  }`}>
                    {t.status === 'open' ? <Clock size={12} /> : <CheckCircle2 size={12} />} {t.status}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mb-2">
                {t.email || t.user_id} · {new Date(t.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </p>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] whitespace-pre-wrap mb-3 rounded-lg bg-black/[0.02] dark:bg-white/[0.03] p-3">{t.body}</p>

              <textarea
                value={draft}
                onChange={e => setDrafts(prev => ({ ...prev, [t.id]: e.target.value }))}
                rows={3}
                placeholder="Type your reply… the user reads it on their /support page."
                className="w-full mb-2 px-3 py-2 rounded-lg text-sm bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-[#7C3AED] resize-y"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => patch(t.id, { admin_response: draft, status: 'answered' })}
                  disabled={saving || !draft.trim()}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#7C3AED] text-white hover:bg-[#6d28d9] disabled:opacity-50 transition-colors"
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  {t.admin_response ? 'Update reply' : 'Send reply'}
                </button>
                {t.status !== 'closed' && (
                  <button
                    onClick={() => patch(t.id, { status: 'closed' })}
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:bg-black/[0.03] disabled:opacity-50 transition-colors"
                  >
                    <Archive size={13} /> Close
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
