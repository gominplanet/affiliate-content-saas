/**
 * /recap — Your week: what MVP did for the creator last week (lib/week-recap).
 * The top bar flashes "Week recap" until this page is opened for the new week.
 */
'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Loader2 } from 'lucide-react'
import { RECAP_SEEN_KEY, weekWindow } from '@/lib/week-window'
import type { WeekRecap, RecapLink } from '@/lib/week-recap'

type Recap = WeekRecap & { back: number }

export default function RecapPage() {
  const [back, setBack] = useState(0)
  const [data, setData] = useState<Recap | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (b: number) => {
    setData(null); setError(null)
    try {
      const r = await fetch(`/api/recap?back=${b}`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      setData(j as Recap)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [])
  useEffect(() => { load(back) }, [back, load])

  // Opening the page is what stops the top bar flashing for this week.
  useEffect(() => {
    try {
      localStorage.setItem(RECAP_SEEN_KEY, weekWindow().key)
      window.dispatchEvent(new Event('mvp-recap-seen'))
    } catch { /* private mode */ }
  }, [])

  const week = weekWindow(new Date(), back)
  const nothing = data && !data.unread.length && [
    data.videos?.count, data.posts?.count, data.social?.sent, data.social?.failed, data.amazonVideos,
    data.pinnedComments, data.encoreComments, data.postUpdates, data.clicks?.count,
  ].every((n) => !n)

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-faint)' }}>Week recap</p>
          <h1 className="text-[26px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>{back === 0 ? 'Your week' : `The week of ${week.label.split(' to ')[0]}`}</h1>
          <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>{week.label} (UTC). Everything here happened; nothing is planned or estimated.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setBack((b) => Math.min(8, b + 1))} disabled={back >= 8} className="inline-flex items-center gap-1 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border disabled:opacity-40" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
            <ChevronLeft size={14} /> Earlier
          </button>
          <button onClick={() => setBack((b) => Math.max(0, b - 1))} disabled={back === 0} className="inline-flex items-center gap-1 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border disabled:opacity-40" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
            Later <ChevronRight size={14} />
          </button>
        </div>
      </header>

      {!data && !error && (
        <p className="py-16 flex items-center justify-center gap-2 text-[13px]" style={{ color: 'var(--text-faint)' }}><Loader2 size={15} className="animate-spin" /> Adding up the week…</p>
      )}
      {error && (
        <p className="text-[13px] text-[#ff3b30]">The recap could not load: {error}. <button onClick={() => load(back)} className="font-semibold underline">Try again</button></p>
      )}

      {data && (<>
        {data.unread.length > 0 && (
          <p className="text-[12.5px] rounded-lg px-3 py-2 text-[#b25e00] bg-[#ff9500]/10">Could not be read: {data.unread.join(', ')}. Those numbers are missing, not zero.</p>
        )}
        {nothing && (
          <p className="text-[13.5px] rounded-xl border px-4 py-4" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
            Nothing went out this week. A video, a post or a Bulk Amazon upload batch next week will show up here.
          </p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile label="Videos on YouTube" value={data.videos?.count} />
          <Tile label="Blog posts published" value={data.posts?.count} />
          <Tile label="Social posts sent" value={data.social?.sent} sub={data.social?.failed ? `${data.social.failed} failed` : undefined} warn={!!data.social?.failed} />
          <Tile label="Videos on Amazon" value={data.amazonVideos} />
          <Tile label="Passport clicks" value={data.clicks?.count} sub={data.clicks ? change(data.clicks.count, data.clicks.previous) : undefined} />
          <Tile label="Pinned comments posted" value={data.pinnedComments} />
          <Tile label="On sale comments" value={data.encoreComments} />
          <Tile label="Reviews updated" value={data.postUpdates} />
        </div>

        {data.social && data.social.byPlatform.length > 0 && (
          <Section title="Where the social posts went">
            <div className="flex flex-wrap gap-2">
              {data.social.byPlatform.map((p) => (
                <span key={p.platform} className="text-[12.5px] rounded-full border px-3 py-1" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>{p.platform}: <b className="tabular-nums">{p.count}</b></span>
              ))}
            </div>
          </Section>
        )}

        {data.clicks && data.clicks.topCountries.length > 0 && (
          <Section title="Where the clicks came from">
            <div className="flex flex-wrap gap-2">
              {data.clicks.topCountries.map((c) => (
                <span key={c.country} className="text-[12.5px] rounded-full border px-3 py-1" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>{c.country}: <b className="tabular-nums">{c.count}</b></span>
              ))}
            </div>
          </Section>
        )}

        {!!data.videos?.items.length && <LinkList title="Videos" items={data.videos.items} more={data.videos.count - data.videos.items.length} />}
        {!!data.posts?.items.length && <LinkList title="Blog posts" items={data.posts.items} more={data.posts.count - data.posts.items.length} />}
      </>)}
    </div>
  )
}

function change(now: number, before: number): string {
  if (!before) return now ? 'none the week before' : ''
  const pct = Math.round(((now - before) / before) * 100)
  return pct === 0 ? 'same as the week before' : `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% on the week before`
}

function Tile({ label, value, sub, warn }: { label: string; value: number | null | undefined; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <p className="text-[24px] font-semibold tabular-nums leading-tight" style={{ color: 'var(--text)' }}>{value == null ? '?' : value}</p>
      <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>{label}</p>
      {value == null && <p className="text-[11.5px] text-[#ff9500]">Could not be read</p>}
      {sub && <p className={`text-[11.5px] ${warn ? 'text-[#ff3b30]' : ''}`} style={warn ? undefined : { color: 'var(--text-faint)' }}>{sub}</p>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{title}</h2>
      {children}
    </section>
  )
}

function LinkList({ title, items, more }: { title: string; items: RecapLink[]; more: number }) {
  return (
    <Section title={title}>
      <ul className="rounded-xl border divide-y" style={{ borderColor: 'var(--border)' }}>
        {items.map((it, i) => (
          <li key={i} className="px-4 py-2.5 text-[13px] flex items-center justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
            <span className="min-w-0 truncate" style={{ color: 'var(--text)' }}>{it.title}</span>
            {it.url && <a href={it.url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-[#7C3AED] hover:underline">Open <ExternalLink size={11} /></a>}
          </li>
        ))}
      </ul>
      {more > 0 && <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>and {more} more</p>}
    </Section>
  )
}
