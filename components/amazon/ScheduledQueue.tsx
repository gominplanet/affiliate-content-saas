// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The Amazon social queue: what is waiting to go out, what went out, and what
// did not.
//
// Both composers on this page offer "Schedule post" and the walkthrough sells
// it. Until now the schedule went into a table with no reader: the creator saw
// "Scheduled for Tuesday 3:00 PM" once and never again. A post that failed at
// 3:00 PM failed in silence, on the plan we advertise.
//
// Four states, and they have to LOOK different, because the whole reason this
// exists is that three of them used to look identical (invisible):
//
//   Waiting     it has not gone yet, and can still be cancelled
//   Posted      it went, here is the link
//   Posted, but it went, and the affiliate link was substituted — read this
//   Did not go  it failed, here is the reason in plain words
//
// The third one is the one that matters. A post that published with a plain
// Amazon link instead of the Passport link the creator switched on is a success
// by every technical measure and a problem by the only one that pays them.
'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle, CalendarClock, Check, ExternalLink, Loader2, RefreshCw, X,
} from 'lucide-react'
import type { ScheduledRow } from '@/app/api/amazon/scheduled/route'
import { queueCancellable, queueDetail, queueOutcome, queueTone } from '@/lib/amazon-queue'

const PLATFORM: Record<ScheduledRow['platform'], { name: string; color: string }> = {
  pinterest: { name: 'Pinterest', color: '#E60023' },
  instagram: { name: 'Instagram', color: '#E1306C' },
  facebook: { name: 'Facebook', color: '#1877F2' },
}

const AMBER = '#ff9500'
const GREEN = '#34c759'
const RED = '#b91c1c'

/** Composers fire this after a successful schedule so the queue below them
 *  updates in place. Without it the creator schedules a post and the list
 *  directly underneath still says nothing is waiting, which reads as "it did
 *  not save" — the same doubt this panel is here to remove. */
export const AMAZON_QUEUE_EVENT = 'mvp:amazon-queue-changed'

function when(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'an unknown time'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const TONE: Record<ReturnType<typeof queueTone>, string> = {
  neutral: 'var(--text-soft)',
  good: GREEN,
  warn: AMBER,
  bad: RED,
}

/** The one line that says what actually happened to this post. The decision is
 *  lib/amazon-queue so it can be asserted; this only picks words and an icon. */
function outcome(r: ScheduledRow): { label: string; color: string; icon: React.ReactNode } {
  const o = queueOutcome(r)
  const color = TONE[queueTone(o)]
  switch (o) {
    case 'failed': return { label: 'Did not go out', color, icon: <AlertCircle size={14} /> }
    case 'cancelled': return { label: 'Cancelled', color, icon: <X size={14} /> }
    case 'sent-note': return { label: 'Posted, with a change', color, icon: <AlertCircle size={14} /> }
    case 'sent': return { label: 'Posted', color, icon: <Check size={14} /> }
    case 'sending': return { label: 'Going out now', color, icon: <Loader2 size={14} className="animate-spin" /> }
    default: return { label: `Waiting for ${when(r.scheduledAt)}`, color, icon: <CalendarClock size={14} /> }
  }
}

export default function ScheduledQueue() {
  const [rows, setRows] = useState<ScheduledRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/amazon/scheduled')
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((d.error as string) || 'Could not load your queue.')
      setRows((d.rows as ScheduledRow[]) ?? [])
      setLoadError(null)
    } catch (e) {
      // Say so. An empty panel where the queue should be is how a creator
      // concludes their scheduled post was never saved.
      setRows([])
      setLoadError(e instanceof Error ? e.message : 'Could not load your queue.')
    }
  }, [])

  useEffect(() => {
    void load()
    const onChange = () => { void load() }
    window.addEventListener(AMAZON_QUEUE_EVENT, onChange)
    return () => window.removeEventListener(AMAZON_QUEUE_EVENT, onChange)
  }, [load])

  const cancel = useCallback(async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch('/api/amazon/scheduled', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'cancel' }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setLoadError((d.error as string) || 'Could not cancel that.'); return }
      setLoadError(null)
      await load()
    } finally { setBusyId(null) }
  }, [load])

  // Nothing ever scheduled: say nothing. The panel is for people using it.
  if (rows !== null && rows.length === 0 && !loadError) return null

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-soft)' }}>
          Scheduled &amp; sent
        </h2>
        <button onClick={() => void load()} className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline" style={{ color: 'var(--text-soft)' }}>
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      {loadError && (
        <p className="mb-3 flex items-start gap-1.5 text-[13px]" style={{ color: RED }}>
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />{loadError}
        </p>
      )}

      {rows === null ? (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-soft)' }}>
          <Loader2 size={14} className="animate-spin" /> Loading your queue…
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const p = PLATFORM[r.platform] ?? PLATFORM.pinterest
            const o = outcome(r)
            return (
              <div key={r.id} className="flex items-start gap-3 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3">
                {r.imageUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={r.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                  : <span className="w-10 h-10 rounded-lg flex-shrink-0" style={{ backgroundColor: `${p.color}1a` }} />}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: p.color }}>{p.name}</span>
                    <span className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: o.color }}>
                      {o.icon} {o.label}
                    </span>
                  </div>
                  <p className="text-[12.5px] truncate" style={{ color: 'var(--text)' }}>
                    {r.productTitle || r.asin || 'Amazon product'}
                  </p>
                  {/* The reason, in full. Never truncated: a wrapped sentence is
                      readable, a clipped one is another silent failure. */}
                  {(() => {
                    const d = queueDetail(r)
                    if (!d) return null
                    return <p className="mt-1 text-[12px] leading-relaxed" style={{ color: d.kind === 'error' ? RED : 'var(--text)' }}>{d.text}</p>
                  })()}
                  {r.status === 'completed' && r.externalUrl && (
                    <a href={r.externalUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold hover:underline" style={{ color: p.color }}>
                      See the post <ExternalLink size={11} />
                    </a>
                  )}
                </div>

                {queueCancellable(r) && (
                  <button
                    onClick={() => void cancel(r.id)}
                    disabled={busyId === r.id}
                    className="text-[12px] font-medium hover:underline flex-shrink-0 disabled:opacity-50"
                    style={{ color: 'var(--text-soft)' }}
                  >
                    {busyId === r.id ? 'Cancelling…' : 'Cancel'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
