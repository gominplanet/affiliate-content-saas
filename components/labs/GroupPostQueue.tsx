'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Group Post Queue (Labs). Pick Sponsored Products from the EPC Library or your
// published Amazon videos, write the posts in one go, then work down the list:
// each item goes to your Facebook PAGE with the affiliate link (through the
// API), and its Group copy points at that Page post, filled into each Group by
// SCOUT for you to press Post. The Group never carries an Amazon link.
//
// What each step shows is what happened, not what was asked: "On your Page"
// only with the Page post's URL in hand, "Filled" only when SCOUT saw the text
// land, and "Posted" only because you ticked it (SCOUT never presses Post).
//
// The queue lives in this browser (localStorage) while it is in Labs.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, Sparkles, Send, Trash2, ExternalLink, CheckCircle2, AlertCircle, ListChecks, Video, BadgeDollarSign, Copy } from 'lucide-react'

type Source = 'epc' | 'videos'
type Group = { name: string; url: string }
type EpcRow = { asin: string; title: string | null; brand: string | null; imageUrl: string | null; epcValue: number | null; epcDisplay: string | null; priceCents: number | null; discountPct: number | null; rating: number | null; budget: string | null; detailsUrl: string | null }
type VideoRow = { aci: string; vdpUrl: string; description: string | null; views: number | null; publishedAt: string | null; asin: string | null; title: string | null; imageUrl: string | null; productCount: number }

type PageState = { state: 'posting' } | { state: 'ok'; url: string; note: string | null } | { state: 'failed'; error: string }
type GroupState = { state: 'working' } | { state: 'filled' | 'not'; message: string }
interface QueueItem {
  key: string
  kind: 'epc' | 'video'
  asin: string
  title: string
  brand?: string | null
  imageUrl: string | null
  discountPct?: number | null
  description?: string | null
  vdpUrl?: string
  caption: string
  page?: PageState
  groups: Record<string, GroupState>
  /** Groups the creator TICKED as posted. Their word, not something MVP saw. */
  posted: string[]
}

const STORE = 'mvp.groupQueue.v1'
function loadQueue(): QueueItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || '[]') as QueueItem[]
    // A post interrupted mid-flight (tab closed) never finished: say so rather
    // than spin forever, so it is posted again only on purpose.
    return Array.isArray(raw) ? raw.map((q) => ({
      ...q,
      page: q.page?.state === 'posting' ? { state: 'failed', error: 'The page was closed while this was posting. Check your Facebook Page before posting it again.' } : q.page,
      groups: Object.fromEntries(Object.entries(q.groups || {}).filter(([, v]) => v.state !== 'working')),
      posted: q.posted || [],
    })) : []
  } catch { return [] }
}

export default function GroupPostQueue() {
  const [source, setSource] = useState<Source>('epc')
  const [minEpc, setMinEpc] = useState('')
  const [minDiscount, setMinDiscount] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [epc, setEpc] = useState<EpcRow[] | null>(null)
  const [videos, setVideos] = useState<VideoRow[] | null>(null)
  const [videoPending, setVideoPending] = useState(0)
  const [listError, setListError] = useState<string | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [disclaimer, setDisclaimer] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [ready, setReady] = useState(false)
  const [writing, setWriting] = useState(false)

  useEffect(() => { setQueue(loadQueue()); setReady(true) }, [])
  useEffect(() => { if (ready) { try { localStorage.setItem(STORE, JSON.stringify(queue)) } catch { /* full or blocked */ } } }, [queue, ready])

  const patch = useCallback((key: string, fn: (q: QueueItem) => QueueItem) => {
    setQueue((all) => all.map((q) => (q.key === key ? fn(q) : q)))
  }, [])

  const load = useCallback(async () => {
    setListError(null); setPicked(new Set())
    const qs = source === 'videos' ? 'source=videos'
      : new URLSearchParams({ source: 'epc', minEpc, minDiscount, maxPrice, limit: '100' }).toString()
    if (source === 'videos') setVideos(null); else setEpc(null)
    try {
      const r = await fetch(`/api/group-queue?${qs}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) { setListError(j.error || 'Could not load.'); source === 'videos' ? setVideos([]) : setEpc([]); return }
      setGroups(j.groups ?? []); setDisclaimer(j.disclaimer ?? '')
      if (j.error) setListError(j.error)
      if (source === 'videos') { setVideos(j.items ?? []); setVideoPending(j.pendingProducts ?? 0) } else setEpc(j.items ?? [])
    } catch (e) { setListError(String(e)); source === 'videos' ? setVideos([]) : setEpc([]) }
  }, [source, minEpc, minDiscount, maxPrice])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [source])

  const queued = useMemo(() => new Set(queue.map((q) => q.key)), [queue])

  function addPicked() {
    const add: QueueItem[] = []
    if (source === 'epc') {
      for (const r of epc ?? []) {
        const key = `epc:${r.asin}`
        if (!picked.has(key) || queued.has(key)) continue
        add.push({ key, kind: 'epc', asin: r.asin, title: r.title || r.asin, brand: r.brand, imageUrl: r.imageUrl, discountPct: r.discountPct, caption: '', groups: {}, posted: [] })
      }
    } else {
      for (const v of videos ?? []) {
        const key = `video:${v.aci}`
        if (!picked.has(key) || queued.has(key) || !v.asin) continue
        add.push({ key, kind: 'video', asin: v.asin, title: v.title || v.asin, imageUrl: v.imageUrl, description: v.description, vdpUrl: v.vdpUrl, caption: '', groups: {}, posted: [] })
      }
    }
    if (!add.length) { toast.info('Nothing new to add.'); return }
    setQueue((all) => [...all, ...add]); setPicked(new Set())
    toast.success(`${add.length} added to the queue`)
  }

  async function writeAll() {
    const todo = queue.filter((q) => !q.caption.trim() && q.page?.state !== 'ok')
    if (!todo.length) { toast.info('Every post in the queue already has text.'); return }
    setWriting(true)
    let wrote = 0, failed = 0
    try {
      for (let i = 0; i < todo.length; i += 10) {
        const batch = todo.slice(i, i + 10)
        const r = await fetch('/api/group-queue', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'write', items: batch.map((q) => ({ key: q.key, kind: q.kind, title: q.title, brand: q.brand, discountPct: q.discountPct, description: q.description })) }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { toast.error(j.error || 'The posts could not be written.'); failed += batch.length; break }
        const caps = (j.captions ?? {}) as Record<string, string>
        setQueue((all) => all.map((q) => (caps[q.key] && !q.caption.trim() ? { ...q, caption: caps[q.key] } : q)))
        wrote += Object.keys(caps).length
        failed += (j.failed ?? []).length
      }
    } finally { setWriting(false) }
    if (wrote) toast.success(`Wrote ${wrote} post${wrote === 1 ? '' : 's'}`)
    if (failed) toast.error(`${failed} could not be written. Write them by hand or try again.`)
  }

  async function postToPage(q: QueueItem) {
    patch(q.key, (x) => ({ ...x, page: { state: 'posting' } }))
    try {
      const r = await fetch('/api/group-queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'page', item: { kind: q.kind, asin: q.asin, title: q.title, imageUrl: q.imageUrl, caption: q.caption, vdpUrl: q.vdpUrl } }),
      })
      const j = await r.json().catch(() => ({}))
      if (j.ok && j.url) patch(q.key, (x) => ({ ...x, page: { state: 'ok', url: j.url, note: j.linkNote ?? null } }))
      else patch(q.key, (x) => ({ ...x, page: { state: 'failed', error: j.error || 'Facebook did not take the post.' } }))
    } catch (e) {
      patch(q.key, (x) => ({ ...x, page: { state: 'failed', error: `MVP did not hear back (${String(e)}). Check your Facebook Page before posting again.` } }))
    }
  }

  function groupCopy(q: QueueItem, pageUrl: string): string {
    return [q.caption.trim(), `👉 All the details here: ${pageUrl}`, disclaimer.trim()].filter(Boolean).join('\n\n')
  }

  async function fillGroup(q: QueueItem, g: Group) {
    if (q.page?.state !== 'ok') return
    const text = groupCopy(q, q.page.url)
    try { await navigator.clipboard.writeText(text) } catch { /* the message still says what to do */ }
    patch(q.key, (x) => ({ ...x, groups: { ...x.groups, [g.url]: { state: 'working' } } }))
    const { requestFacebookGroupPrefill } = await import('@/lib/extension-frame')
    const res = await requestFacebookGroupPrefill(g.url, text)
    const label = g.name || 'your Group'
    patch(q.key, (x) => ({
      ...x,
      groups: {
        ...x.groups,
        [g.url]: res.filled
          ? { state: 'filled', message: `Filled in ${label}. Press Post in the Facebook tab, then tick Posted here.` }
          : { state: 'not', message: res.error || 'SCOUT could not fill it. The post is copied: paste it in the Group yourself.' },
      },
    }))
  }

  function togglePosted(q: QueueItem, url: string) {
    patch(q.key, (x) => ({ ...x, posted: x.posted.includes(url) ? x.posted.filter((u) => u !== url) : [...x.posted, url] }))
  }

  const isDone = (q: QueueItem) => q.page?.state === 'ok' && groups.length > 0 && groups.every((g) => q.posted.includes(g.url))
  const doneCount = queue.filter(isDone).length

  const card = 'rounded-2xl border p-4 flex flex-col gap-3'
  const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }
  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50'
  const ghost = { borderColor: 'var(--border)', color: 'var(--text)' }
  const input = 'rounded-lg border px-2 py-1 text-[12.5px] w-24 bg-transparent'

  const list = source === 'epc' ? epc : videos

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-faint)' }}>Labs · Facebook</p>
        <h1 className="text-[24px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>Group Post Queue</h1>
        <p className="text-[13px] max-w-2xl" style={{ color: 'var(--text-soft)' }}>
          Pick Sponsored Products or your Amazon videos, write every post at once, then work down the list. Each one goes to your Facebook Page with your affiliate link. Your Groups get a short post pointing at that Page post, so no Amazon link ever sits in a Group.
        </p>
      </header>

      {groups.length === 0 && (
        <p className="text-[12.5px] rounded-xl border px-3 py-2" style={{ borderColor: '#ff9500', color: 'var(--text-soft)' }}>
          You have no Facebook Groups saved yet, so this can only post to your Page. Add them in <Link href="/brand" className="underline">Brand Profile</Link> under Facebook Groups.
        </p>
      )}

      {/* ── Pick ─────────────────────────────────────────────────────────── */}
      <section className={card} style={cardStyle}>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setSource('epc')} className={`${btn} ${source === 'epc' ? 'text-white bg-[#7C3AED]' : 'border'}`} style={source === 'epc' ? undefined : ghost}><BadgeDollarSign size={13} /> Sponsored Products</button>
          <button onClick={() => setSource('videos')} className={`${btn} ${source === 'videos' ? 'text-white bg-[#7C3AED]' : 'border'}`} style={source === 'videos' ? undefined : ghost}><Video size={13} /> My Amazon videos</button>
        </div>

        {source === 'epc' && (
          <div className="flex flex-wrap items-end gap-3 text-[12px]" style={{ color: 'var(--text-soft)' }}>
            <label className="flex flex-col gap-1">Min EPC ($)<input className={input} style={{ borderColor: 'var(--border)' }} inputMode="decimal" value={minEpc} onChange={(e) => setMinEpc(e.target.value)} placeholder="0.50" /></label>
            <label className="flex flex-col gap-1">Min discount (%)<input className={input} style={{ borderColor: 'var(--border)' }} inputMode="numeric" value={minDiscount} onChange={(e) => setMinDiscount(e.target.value)} placeholder="any" /></label>
            <label className="flex flex-col gap-1">Max price ($)<input className={input} style={{ borderColor: 'var(--border)' }} inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="any" /></label>
            <button onClick={load} className={`${btn} border`} style={ghost}>Apply</button>
          </div>
        )}

        {listError && <p className="text-[12.5px] text-[#ff3b30]">{listError}</p>}
        {list === null && <p className="text-[12.5px]" style={{ color: 'var(--text-faint)' }}><Loader2 size={13} className="inline animate-spin" /> Loading…</p>}
        {source === 'epc' && epc && epc.length === 0 && !listError && (
          <p className="text-[12.5px]" style={{ color: 'var(--text-soft)' }}>Nothing matches. Scan your Sponsored Products into the <Link href="/epc-library" className="underline">EPC Library</Link> first, or loosen the filters.</p>
        )}
        {source === 'videos' && videos && videos.length === 0 && !listError && (
          <p className="text-[12.5px]" style={{ color: 'var(--text-soft)' }}>No published Amazon videos found. MVP reads them with SCOUT from your Amazon video library.</p>
        )}
        {source === 'videos' && videoPending > 0 && (
          <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>{videoPending} video{videoPending === 1 ? '' : 's'} have no product read yet, so they cannot be posted until MVP finishes reading them.</p>
        )}

        {list && list.length > 0 && (
          <>
            <ul className="rounded-xl border divide-y max-h-[420px] overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
              {source === 'epc' && (epc ?? []).map((r) => {
                const key = `epc:${r.asin}`
                return (
                  <li key={key} className="px-3 py-2 flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
                    <input type="checkbox" disabled={queued.has(key)} checked={picked.has(key) || queued.has(key)} onChange={() => setPicked((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })} />
                    {r.imageUrl ? <img src={r.imageUrl} alt="" className="w-9 h-9 rounded object-contain bg-white flex-shrink-0" /> : <div className="w-9 h-9 rounded flex-shrink-0" style={{ background: 'var(--border)' }} />}
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--text)' }}>{r.title || r.asin}</p>
                      <p className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
                        {r.epcDisplay || (r.epcValue != null ? `EPC up to $${r.epcValue.toFixed(2)}` : 'EPC not shown')}
                        {r.discountPct ? ` · ${r.discountPct}% below usual` : ''}{r.budget ? ` · budget ${r.budget}` : ''}{queued.has(key) ? ' · in queue' : ''}
                      </p>
                    </div>
                    {r.detailsUrl && <a href={r.detailsUrl} target="_blank" rel="noopener noreferrer" className="text-[11.5px] underline flex-shrink-0" style={{ color: 'var(--text-faint)' }}>Opt in on Amazon</a>}
                  </li>
                )
              })}
              {source === 'videos' && (videos ?? []).map((v) => {
                const key = `video:${v.aci}`
                return (
                  <li key={key} className="px-3 py-2 flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
                    <input type="checkbox" disabled={queued.has(key) || !v.asin} checked={picked.has(key) || queued.has(key)} onChange={() => setPicked((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })} />
                    {v.imageUrl ? <img src={v.imageUrl} alt="" className="w-9 h-9 rounded object-contain bg-white flex-shrink-0" /> : <div className="w-9 h-9 rounded flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--border)' }}><Video size={14} /></div>}
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--text)' }}>{v.title || (v.asin ? v.asin : 'Product not read yet')}</p>
                      <p className="text-[11.5px] truncate" style={{ color: 'var(--text-faint)' }}>
                        {v.views != null ? `${v.views.toLocaleString()} views · ` : ''}{v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : ''}{v.productCount > 1 ? ` · ${v.productCount} products, posts the first` : ''}{queued.has(key) ? ' · in queue' : ''}
                      </p>
                    </div>
                    <a href={v.vdpUrl} target="_blank" rel="noopener noreferrer" className="text-[11.5px] underline flex-shrink-0" style={{ color: 'var(--text-faint)' }}>Watch</a>
                  </li>
                )
              })}
            </ul>
            <div className="flex items-center gap-2">
              <button onClick={addPicked} disabled={picked.size === 0} className={`${btn} text-white bg-[#7C3AED]`}><ListChecks size={13} /> Add {picked.size || ''} to queue</button>
              {source === 'epc' && <p className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>MVP never opts you in for you. Open each product on Amazon to opt in.</p>}
            </div>
          </>
        )}
      </section>

      {/* ── Queue ────────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[14px] font-semibold mr-auto" style={{ color: 'var(--text)' }}>Queue {queue.length > 0 ? `(${doneCount} of ${queue.length} done)` : ''}</h2>
          {queue.length > 0 && <button onClick={writeAll} disabled={writing} className={`${btn} text-white bg-[#7C3AED]`}>{writing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}{writing ? 'Writing…' : 'Write all posts with AI'}</button>}
          {doneCount > 0 && <button onClick={() => setQueue((all) => all.filter((q) => !isDone(q)))} className={`${btn} border`} style={ghost}>Clear done</button>}
        </div>
        {queue.length === 0 && <p className="text-[12.5px]" style={{ color: 'var(--text-faint)' }}>Nothing queued yet. Tick some products or videos above and add them.</p>}

        {queue.map((q) => {
          const page = q.page
          const onPage = page?.state === 'ok'
          return (
            <div key={q.key} className={card} style={cardStyle}>
              <div className="flex items-start gap-3">
                {q.imageUrl ? <img src={q.imageUrl} alt="" className="w-12 h-12 rounded object-contain bg-white flex-shrink-0" /> : <div className="w-12 h-12 rounded flex-shrink-0" style={{ background: 'var(--border)' }} />}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text)' }}>{q.title}</p>
                  <p className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>{q.kind === 'video' ? 'Your Amazon video' : 'Sponsored Product'} · {q.asin}</p>
                </div>
                {isDone(q) && <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#10b981]"><CheckCircle2 size={13} /> Done</span>}
                <button onClick={() => setQueue((all) => all.filter((x) => x.key !== q.key))} aria-label="Remove" style={{ color: 'var(--text-faint)' }}><Trash2 size={14} /></button>
              </div>

              <textarea value={q.caption} disabled={onPage || page?.state === 'posting'} onChange={(e) => patch(q.key, (x) => ({ ...x, caption: e.target.value }))} rows={3}
                placeholder="Write the post, or use Write all posts with AI. MVP adds your link and disclosure."
                className="w-full rounded-lg border px-3 py-2 text-[12.5px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />

              {/* Step 1: the Page, through the API, with the affiliate link. */}
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="font-semibold" style={{ color: 'var(--text-soft)' }}>1. Facebook Page</span>
                {!onPage && (
                  <button onClick={() => postToPage(q)} disabled={!q.caption.trim() || page?.state === 'posting'} className={`${btn} text-white bg-[#1877F2]`}>
                    {page?.state === 'posting' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    {page?.state === 'posting' ? 'Posting…' : page?.state === 'failed' ? 'Try again' : 'Post to Page'}
                  </button>
                )}
                {onPage && <a href={page.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#10b981]"><CheckCircle2 size={13} /> On your Page <ExternalLink size={11} /></a>}
                {page?.state === 'failed' && <span className="inline-flex items-center gap-1 text-[#ff3b30]"><AlertCircle size={13} /> Not posted: {page.error}</span>}
              </div>
              {onPage && page.note && <p className="text-[11.5px] text-[#ff9500]">{page.note}</p>}

              {/* Step 2: the Groups, filled by SCOUT, pointing at the Page post. */}
              {groups.length > 0 && (
                <div className="flex flex-col gap-1.5 text-[12px]">
                  <span className="font-semibold" style={{ color: 'var(--text-soft)' }}>2. Groups {onPage ? '' : '(after the Page post is up)'}</span>
                  {groups.map((g) => {
                    const st = q.groups[g.url]
                    const done = q.posted.includes(g.url)
                    return (
                      <div key={g.url} className="flex flex-wrap items-center gap-2">
                        <span className="min-w-[120px] truncate" style={{ color: 'var(--text)' }}>{g.name || g.url}</span>
                        <button onClick={() => fillGroup(q, g)} disabled={!onPage || st?.state === 'working'} className={`${btn} border`} style={ghost}>
                          {st?.state === 'working' ? <Loader2 size={13} className="animate-spin" /> : null}
                          {st?.state === 'working' ? 'SCOUT is filling…' : st ? 'Fill again' : 'Fill with SCOUT'}
                        </button>
                        {onPage && <button onClick={() => navigator.clipboard.writeText(groupCopy(q, page.url)).then(() => toast.success('Group post copied'), () => toast.error('Copy failed'))} className={`${btn}`} style={{ color: 'var(--text-faint)' }}><Copy size={12} /> Copy</button>}
                        <label className="inline-flex items-center gap-1" style={{ color: done ? '#10b981' : 'var(--text-faint)' }}>
                          <input type="checkbox" disabled={!onPage} checked={done} onChange={() => togglePosted(q, g.url)} /> Posted
                        </label>
                        {st && st.state !== 'working' && <span className={st.state === 'filled' ? 'text-[#10b981]' : 'text-[#ff9500]'}>{st.message}</span>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}
