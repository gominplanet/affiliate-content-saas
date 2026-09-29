'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Review posts due a first-hand update (lib/post-refresh.ts). After 90 days
// MVP asks how the product has held up; the creator's line goes into the post
// in their words, and only then does WordPress change. A one-line bar,
// closed by default, so it never pushes the generator down the page.
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
  const [index, setIndex] = useState(0)
  const [showRecent, setShowRecent] = useState(false)
  // Closed unless this browser opened it last time. Storage can be blocked
  // (private windows, previews), so every read and write is guarded.
  const [open, setOpen] = useState(false)
  useEffect(() => { try { setOpen(localStorage.getItem('mvp.postUpdates.open') === '1') } catch { /* stays closed */ } }, [])
  const toggle = (v: boolean) => { setOpen(v); try { localStorage.setItem('mvp.postUpdates.open', v ? '1' : '0') } catch { /* not remembered */ } }

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
      <div className="rounded-xl border px-4 py-2.5 mb-4 text-[12.5px]" style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text-soft)' }}>
        Post updates need migration 384 before they can show which reviews are due.
      </div>
    )
  }
  if (!due.length && !recent.length) return null

  const current = due.length ? due[Math.min(index, due.length - 1)] : null
  return (
    <div className="rounded-xl border mb-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      {/* ONE LINE WHEN CLOSED. The panel sat above the generator and pushed it
          a screen down with a stack of reviews; closed by default, it is a
          single bar, and the choice is remembered in this browser. */}
      <button type="button" onClick={() => toggle(!open)} aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
        <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
          {dueCount > 0 ? `${dueCount} review${dueCount !== 1 ? 's are' : ' is'} due an update` : 'Post updates'}
        </span>
        <span className="text-[12px] hidden sm:inline truncate" style={{ color: 'var(--text-soft)' }}>
          {dueCount > 0 ? 'One line from you on how the product held up keeps each one current.' : `${recent.length} updated in the last 60 days.`}
        </span>
        <span className="ml-auto text-[12px] font-medium shrink-0" style={{ color: 'var(--accent)' }}>{open ? 'Hide' : dueCount > 0 ? 'Update them' : 'Show'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--border)' }}>
          {current && (
            <>
              <p className="text-[12px] mt-3 mb-2" style={{ color: 'var(--text-soft)' }}>
                Your line goes into the post in your words, labelled with how long after the review it was written. Readers trust it, and search engines count it as a real update, which a reworded post is not.
              </p>
              {/* One review at a time, not a stack of them. */}
              <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-baseline justify-between gap-2">
                  {current.url
                    ? <a href={current.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium truncate underline-offset-2 hover:underline" style={{ color: 'var(--text)' }}>{current.title || 'Untitled post'}</a>
                    : <span className="text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>{current.title || 'Untitled post'}</span>}
                  <span className="text-[12px] shrink-0 tabular-nums" style={{ color: 'var(--text-soft)' }}>{current.since} · {Math.min(index, due.length - 1) + 1} of {dueCount}</span>
                </div>
                <textarea
                  value={notes[current.id] || ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [current.id]: e.target.value }))}
                  maxLength={700} rows={2}
                  placeholder="Still using it? What has changed, worn, or surprised you?"
                  className="mt-2 w-full rounded-lg border px-3 py-2 text-[13px]"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg, transparent)', color: 'var(--text)' }}
                />
                <div className="flex flex-wrap gap-2 mt-2">
                  <button onClick={() => act(current, 'update')} disabled={busy === current.id || (notes[current.id] || '').trim().length < 15}
                    className="inline-flex items-center h-8 px-3 rounded-lg text-[12.5px] font-medium text-white disabled:opacity-50"
                    style={{ background: 'var(--accent)' }}>
                    {busy === current.id ? 'Updating…' : 'Add to post'}
                  </button>
                  <button onClick={() => act(current, 'snooze')} disabled={busy === current.id}
                    className="inline-flex items-center h-8 px-3 rounded-lg border text-[12.5px] font-medium disabled:opacity-50"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
                    Nothing new yet
                  </button>
                  {due.length > 1 && (
                    <button onClick={() => setIndex((i) => (i + 1) % due.length)} disabled={busy === current.id}
                      className="inline-flex items-center h-8 px-3 rounded-lg text-[12.5px] font-medium disabled:opacity-50 ml-auto"
                      style={{ color: 'var(--text-soft)' }}>
                      Skip for now →
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
          {recent.length > 0 && (
            <div className="mt-3">
              <button type="button" onClick={() => setShowRecent((v) => !v)} className="text-[12.5px] font-semibold" style={{ color: 'var(--text)' }}>
                {showRecent ? '▾' : '▸'} Updated in the last 60 days ({recent.length})
              </button>
              {showRecent && (
                <ul className="text-[12.5px] flex flex-col gap-1 mt-1" style={{ color: 'var(--text-soft)' }}>
                  {recent.map((r) => (
                    <li key={r.id}>
                      {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline" style={{ color: 'var(--text)' }}>{r.title || 'Untitled post'}</a> : (r.title || 'Untitled post')}
                      {r.note ? <>: “{r.note.length > 120 ? `${r.note.slice(0, 120)}…` : r.note}”</> : null}
                      {r.impact ? <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-soft)' }}>{impactText(r.impact)}</div> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
