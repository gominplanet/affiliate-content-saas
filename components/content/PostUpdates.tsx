'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Review posts due a first-hand update (lib/post-refresh.ts). After 90 days
// MVP asks how the product has held up; the creator's line goes into the post
// in their words, and only then does WordPress change. LABS while tested.
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import { canUsePreview } from '@/lib/labs-preview'
import type { Impact } from '@/lib/update-impact'

interface Due { id: string; title: string | null; url: string | null; since: string; lastUpdatedAt: string | null }
interface Recent { id: string; title: string | null; url: string | null; at: string; note: string | null; impact: Impact | null }

/** What Search Console says happened after the update, in words that keep
 *  "too soon", "no data" and "measured" apart. */
function impactText(i: Impact | null): string {
  if (!i) return ''
  switch (i.state) {
    case 'waiting': return `Search results in ${i.readyInDays} day${i.readyInDays === 1 ? '' : 's'}.`
    case 'no-search-console': return 'Connect Search Console to see whether it helped.'
    case 'other-site': return 'This post is on a site your Search Console property does not cover.'
    case 'unavailable': return 'Search Console did not answer. Reload later.'
    case 'measured': {
      const n = (x: number) => x.toLocaleString()
      return `${i.days} days before vs after: ${n(i.before.impressions)} → ${n(i.after.impressions)} impressions, ${n(i.before.clicks)} → ${n(i.after.clicks)} clicks.`
    }
  }
}

export function PostUpdates() {
  const tier = useEffectiveTier()
  const allowed = tier !== null && canUsePreview('post_refresh', tier)
  const [due, setDue] = useState<Due[]>([])
  const [dueCount, setDueCount] = useState(0)
  const [recent, setRecent] = useState<Recent[]>([])
  const [needsMigration, setNeedsMigration] = useState(false)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/blog/refresh', { cache: 'no-store' })
      if (!r.ok) return
      const j = await r.json()
      setNeedsMigration(!!j.needsMigration)
      setDue(Array.isArray(j.due) ? j.due : [])
      setDueCount(Number(j.dueCount) || 0)
      setRecent(Array.isArray(j.recent) ? j.recent : [])
    } catch { /* a report; a failed read shows nothing */ }
  }, [])
  useEffect(() => { if (allowed) load() }, [allowed, load])

  const act = async (d: Due, action: 'update' | 'snooze') => {
    setBusy(d.id)
    try {
      const r = await fetch('/api/blog/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, postId: d.id, note: notes[d.id] || '' }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { toast.error(j.error || 'Nothing was changed.'); return }
      if (action === 'snooze') toast.success('MVP will ask about this post again in 90 days.')
      else if (j.warning) toast.warning(j.warning)
      else toast.success(j.pinged ? 'Update is live on your post, and search engines were told.' : 'Update is live on your post.')
      await load()
    } finally { setBusy(null) }
  }

  if (!allowed) return null
  if (needsMigration) {
    return (
      <div className="rounded-xl border p-4 mb-6 text-[13px]" style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text-soft)' }}>
        Post updates need migration 384 before they can show which reviews are due.
      </div>
    )
  }
  if (!due.length && !recent.length) return null

  return (
    <div className="rounded-xl border p-4 mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      {due.length > 0 && (
        <>
          <div className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
            {dueCount} review{dueCount !== 1 ? 's are' : ' is'} due an update
          </div>
          <p className="text-[12.5px] mt-1 mb-3" style={{ color: 'var(--text-soft)' }}>
            One line on how the product has held up since you reviewed it. It goes into the post in your words, labelled with how long after the review it was written. Readers trust it and search engines count it as a real update, which a reworded post is not.
          </p>
          <div className="flex flex-col gap-3">
            {due.map((d) => (
              <div key={d.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-baseline justify-between gap-2">
                  {d.url
                    ? <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium truncate underline-offset-2 hover:underline" style={{ color: 'var(--text)' }}>{d.title || 'Untitled post'}</a>
                    : <span className="text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>{d.title || 'Untitled post'}</span>}
                  <span className="text-[12px] shrink-0" style={{ color: 'var(--text-soft)' }}>{d.since}</span>
                </div>
                <textarea
                  value={notes[d.id] || ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [d.id]: e.target.value }))}
                  maxLength={700} rows={2}
                  placeholder="Still using it? What has changed, worn, or surprised you?"
                  className="mt-2 w-full rounded-lg border px-3 py-2 text-[13px]"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg, transparent)', color: 'var(--text)' }}
                />
                <div className="flex gap-2 mt-2">
                  <button onClick={() => act(d, 'update')} disabled={busy === d.id || (notes[d.id] || '').trim().length < 15}
                    className="inline-flex items-center h-8 px-3 rounded-lg text-[12.5px] font-medium text-white disabled:opacity-50"
                    style={{ background: 'var(--accent)' }}>
                    {busy === d.id ? 'Updating…' : 'Add to post'}
                  </button>
                  <button onClick={() => act(d, 'snooze')} disabled={busy === d.id}
                    className="inline-flex items-center h-8 px-3 rounded-lg border text-[12.5px] font-medium disabled:opacity-50"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
                    Nothing new yet
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {recent.length > 0 && (
        <div className={due.length ? 'mt-4' : ''}>
          <div className="text-[12.5px] font-semibold mb-1" style={{ color: 'var(--text)' }}>Updated in the last 60 days</div>
          <ul className="text-[12.5px] flex flex-col gap-1" style={{ color: 'var(--text-soft)' }}>
            {recent.map((r) => (
              <li key={r.id}>
                {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline" style={{ color: 'var(--text)' }}>{r.title || 'Untitled post'}</a> : (r.title || 'Untitled post')}
                {r.note ? <>: “{r.note.length > 120 ? `${r.note.slice(0, 120)}…` : r.note}”</> : null}
                {r.impact ? <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-soft)' }}>{impactText(r.impact)}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
