'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Group Post Queue (Labs). Pick Sponsored Products from the EPC Library or your
// published Amazon videos, write the posts in one go, then work down the list,
// Group first like everything else MVP puts on Facebook: SCOUT fills the post,
// affiliate link included, into your Group; you press Post; the moment SCOUT
// sees it go up, MVP posts on your Page linking to that Group post. The Page
// only ever links to Facebook, so it never spends Meta's outside-link limit.
//
// What each step shows is what happened, not what was asked: "Filled" only
// when SCOUT saw the text land, "In your Group" only with the post seen going
// up, and "On your Page" only with the Page post's id from Facebook.
//
// The queue lives in this browser (localStorage) while it is in Labs.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isFacebookGroupLink } from '@/lib/facebook-group-link'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, Sparkles, Send, Trash2, ExternalLink, CheckCircle2, AlertCircle, ListChecks, Video, BadgeDollarSign } from 'lucide-react'

type Source = 'epc' | 'videos'
type Group = { name: string; url: string }
type EpcRow = { asin: string; title: string | null; brand: string | null; imageUrl: string | null; epcValue: number | null; epcDisplay: string | null; priceCents: number | null; discountPct: number | null; rating: number | null; budget: string | null; detailsUrl: string | null }
type VideoRow = { aci: string; vdpUrl: string; description: string | null; views: number | null; publishedAt: string | null; asin: string | null; title: string | null; imageUrl: string | null; productCount: number }

/** One push of an item to one Group, then the Page. Every phase is what was
 *  seen: busy phases spin, `need_link` and `page_failed` wait for the creator. */
type Phase = 'composing' | 'filling' | 'waiting' | 'sharing' | 'need_link' | 'page_failed' | 'failed' | 'done'
interface Run {
  phase: Phase
  message: string
  /** The Group post's own address (or the Group's, when SCOUT could not read it). */
  groupLink?: string
  pageUrl?: string
  /** Set when the affiliate link fell back to a plain one. */
  linkNote?: string | null
}
const BUSY: Phase[] = ['composing', 'filling', 'waiting', 'sharing']
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
  /** Keyed by Group URL. */
  runs: Record<string, Run>
}

const STORE = 'mvp.groupQueue.v1'
function loadQueue(): QueueItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || '[]') as QueueItem[]
    // A post interrupted mid-flight (tab closed) never finished: say so rather
    // than spin forever, so it is posted again only on purpose.
    return Array.isArray(raw) ? raw.map((q) => ({
      ...q,
      runs: Object.fromEntries(Object.entries(q.runs || {}).map(([k, r]) => [k, BUSY.includes(r.phase)
        ? { ...r, phase: 'need_link' as Phase, message: 'MVP was closed before this finished. If you pressed Post in the Group, paste that post\'s link and share it on your Page. Check your Page first so it does not go out twice.' }
        : r])),
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
        add.push({ key, kind: 'epc', asin: r.asin, title: r.title || r.asin, brand: r.brand, imageUrl: r.imageUrl, discountPct: r.discountPct, caption: '', runs: {} })
      }
    } else {
      for (const v of videos ?? []) {
        const key = `video:${v.aci}`
        if (!picked.has(key) || queued.has(key) || !v.asin) continue
        add.push({ key, kind: 'video', asin: v.asin, title: v.title || v.asin, imageUrl: v.imageUrl, description: v.description, vdpUrl: v.vdpUrl, caption: '', runs: {} })
      }
    }
    if (!add.length) { toast.info('Nothing new to add.'); return }
    setQueue((all) => [...all, ...add]); setPicked(new Set())
    toast.success(`${add.length} added to the queue`)
  }

  async function writeAll() {
    const todo = queue.filter((q) => !q.caption.trim() && !Object.keys(q.runs).length)
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

  const [target, setTarget] = useState('')
  useEffect(() => { if (!target && groups[0]) setTarget(groups[0].url) }, [groups, target])
  const [manual, setManual] = useState<Record<string, string>>({})
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const setRun = useCallback((key: string, groupUrl: string, r: Partial<Run>) => {
    setQueue((all) => all.map((q) => (q.key === key
      ? { ...q, runs: { ...q.runs, [groupUrl]: { ...(q.runs[groupUrl] ?? { phase: 'composing', message: '' }), ...r } as Run } }
      : q)))
  }, [])

  function teaser(q: QueueItem, groupName: string): string {
    const first = q.caption.trim().split(/(?<=[.!?])\s+|\n+/)[0]?.trim() || q.title
    const hook = first.length > 160 ? first.slice(0, 157).trimEnd() + '…' : first
    return [`New in ${groupName}:`, hook, 'The full post, links and all, is in the Group 👇'].join('\n\n')
  }

  // The Facebook hub's record (Meta Hub lists Group posts left without their
  // Page post). Best effort: a record that fails never fails the post.
  function record(q: QueueItem, g: Group, groupPostUrl: string, pagePostUrl: string | null) {
    void fetch('/api/facebook/hub', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'post', sourceId: q.key, title: q.title.slice(0, 160), groupUrl: g.url, groupPostUrl, pagePostUrl }),
    }).catch(() => {})
  }

  // Step 2: the Page post, linking to the Group post. Never an outside link.
  async function shareOnPage(q: QueueItem, g: Group, link: string, lead: string) {
    if (!isFacebookGroupLink(link)) { setRun(q.key, g.url, { phase: 'need_link', message: 'That is not a link to your Group or a post in it (facebook.com/groups/…).' }); return }
    setRun(q.key, g.url, { phase: 'sharing', groupLink: link, message: `${lead} Sharing it on your Page now…` })
    try {
      const r = await fetch('/api/blog/facebook-group-teaser', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: teaser(q, g.name || 'my Group'), link, imageUrl: q.imageUrl || undefined }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok || !j.id) throw new Error(j.error || `Facebook said no (${r.status})`)
      const pic = j.photo ? ' with the picture' : j.photoTried ? ' as text only (Facebook refused the picture)' : ''
      setRun(q.key, g.url, { phase: 'done', pageUrl: `https://www.facebook.com/${j.id}`, message: `${lead} Shared on ${j.page || 'your Page'}${pic}, linking to the Group post.` })
      record(q, g, link, `https://www.facebook.com/${j.id}`)
    } catch (e) {
      // FAILED IS NOT DONE: the Group post is up, the Page post is not.
      setRun(q.key, g.url, { phase: 'page_failed', message: `${lead} The Page post did not go out: ${e instanceof Error ? e.message : 'it failed'}.` })
      record(q, g, link, null)
    }
  }

  // Step 1: the Group post with the affiliate link, filled by SCOUT. Then
  // SCOUT watches for the creator to press Post, and the Page post follows.
  async function postItem(q: QueueItem, g: Group) {
    const label = g.name || 'your Group'
    setRun(q.key, g.url, { phase: 'composing', message: 'Building the Group post…', groupLink: undefined, pageUrl: undefined })
    let text: string
    try {
      const r = await fetch('/api/group-queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'compose', item: { kind: q.kind, asin: q.asin, title: q.title, caption: q.caption, vdpUrl: q.vdpUrl } }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.text) { setRun(q.key, g.url, { phase: 'failed', message: j.error || 'The Group post could not be built.' }); return }
      text = j.text
      setRun(q.key, g.url, { linkNote: j.linkNote ?? null })
    } catch (e) { setRun(q.key, g.url, { phase: 'failed', message: `MVP did not answer (${String(e)}).` }); return }

    try { await navigator.clipboard.writeText(text) } catch { /* the message still says what to do */ }
    setRun(q.key, g.url, { phase: 'filling', message: `SCOUT is opening ${label}…` })
    const { requestFacebookGroupPrefill, getFacebookGroupPostStatus } = await import('@/lib/extension-frame')
    const res = await requestFacebookGroupPrefill(g.url, text, q.imageUrl ? { kind: 'thumbnail', url: q.imageUrl } : null)
    if (!res.filled) {
      setRun(q.key, g.url, { phase: 'need_link', message: `${res.error || 'SCOUT could not fill it. The post is copied: paste it in the Group yourself.'} Once it is up, paste its link here to share it on your Page.` })
      return
    }
    const media = res.media ? ` ${res.media}` : ''
    if (!res.canWatch || !res.watchId) {
      setRun(q.key, g.url, { phase: 'need_link', message: `Filled in ${label}.${media} Press Post there. Your SCOUT cannot spot the post going up, so paste its link here after (click its time stamp and copy the address).` })
      return
    }
    setRun(q.key, g.url, { phase: 'waiting', message: `Filled in ${label}.${media} Press Post in the Facebook tab; MVP shares it on your Page by itself.` })
    const end = Date.now() + 16 * 60 * 1000
    const manualTip = ' Paste the post\'s link here (click its time stamp and copy the address) to share it on your Page.'
    while (mounted.current && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 3000))
      const st = await getFacebookGroupPostStatus(res.watchId)
      if (st.state === 'watching') continue
      if (st.state === 'posted' && st.url && isFacebookGroupLink(st.url)) { await shareOnPage(q, g, st.url, `Posted in ${label}.`); return }
      if (st.state === 'posted' || st.state === 'posted_no_link') { await shareOnPage(q, g, g.url, `Posted in ${label}, but SCOUT could not read the post's own link, so the Page post links to the Group.`); return }
      const why = st.state === 'closed' ? 'The Facebook tab closed before SCOUT saw the post go up.'
        : st.state === 'not_seen' ? 'SCOUT did not see the post appear. If the Group holds posts for approval, it shows once approved.'
        : 'SCOUT stopped watching before it saw the post.'
      setRun(q.key, g.url, { phase: 'need_link', message: why + manualTip })
      return
    }
    if (mounted.current) setRun(q.key, g.url, { phase: 'need_link', message: 'SCOUT watched for 16 minutes and did not see the post.' + manualTip })
  }

  const isDone = (q: QueueItem) => Object.values(q.runs).some((r) => r.phase === 'done')
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
          Pick Sponsored Products or your Amazon videos, write every post at once, then work down the list. Each post goes into your Group with your affiliate link: SCOUT fills it in and you press Post. MVP then posts on your Page linking to that Group post, so your Page never uses up Meta's link limit.
        </p>
      </header>

      {groups.length === 0 && (
        <p className="text-[12.5px] rounded-xl border px-3 py-2" style={{ borderColor: '#ff9500', color: 'var(--text-soft)' }}>
          Save your deals Group first: every post here starts in a Group. Add it in <Link href="/meta" className="underline">Meta Hub</Link> or <Link href="/brand" className="underline">Brand Profile</Link> under Facebook Groups.
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

        {queue.length > 0 && groups.length > 1 && (
          <label className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--text-soft)' }}>
            Post into
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="rounded-lg border px-2 py-1 bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              {groups.map((g) => <option key={g.url} value={g.url}>{g.name || g.url}</option>)}
            </select>
          </label>
        )}

        {queue.map((q) => {
          const g = groups.find((x) => x.url === target) ?? groups[0]
          const run = g ? q.runs[g.url] : undefined
          const busy = !!run && BUSY.includes(run.phase)
          const others = Object.entries(q.runs).filter(([u, r]) => u !== g?.url && r.phase === 'done')
          const tone = !run ? '' : run.phase === 'done' ? 'text-[#10b981]' : run.phase === 'failed' || run.phase === 'page_failed' ? 'text-[#ff3b30]' : run.phase === 'need_link' ? 'text-[#ff9500]' : ''
          return (
            <div key={q.key} className={card} style={cardStyle}>
              <div className="flex items-start gap-3">
                {q.imageUrl ? <img src={q.imageUrl} alt="" className="w-12 h-12 rounded object-contain bg-white flex-shrink-0" /> : <div className="w-12 h-12 rounded flex-shrink-0" style={{ background: 'var(--border)' }} />}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text)' }}>{q.title}</p>
                  <p className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>{q.kind === 'video' ? 'Your Amazon video' : 'Sponsored Product'} · {q.asin}</p>
                </div>
                {isDone(q) && <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#10b981]"><CheckCircle2 size={13} /> Done</span>}
                <button onClick={() => setQueue((all) => all.filter((x) => x.key !== q.key))} disabled={busy} aria-label="Remove" style={{ color: 'var(--text-faint)' }}><Trash2 size={14} /></button>
              </div>

              <textarea value={q.caption} disabled={busy} onChange={(e) => patch(q.key, (x) => ({ ...x, caption: e.target.value }))} rows={3}
                placeholder="Write the post, or use Write all posts with AI. MVP adds your link, disclosure and #ad #sponsored."
                className="w-full rounded-lg border px-3 py-2 text-[12.5px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />

              {g && (
                <div className="flex flex-col gap-1.5 text-[12px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => postItem(q, g)} disabled={!q.caption.trim() || busy} className={`${btn} text-white bg-[#1877F2]`}>
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      {busy ? 'Working…' : run?.phase === 'done' ? `Post to ${g.name || 'Group'} again` : `Post to ${g.name || 'Group'} + Page`}
                    </button>
                    {run?.phase === 'page_failed' && run.groupLink && (
                      <button onClick={() => shareOnPage(q, g, run.groupLink!, 'Your Group post is up.')} className={`${btn} border`} style={ghost}>Try the Page post again</button>
                    )}
                    {run?.groupLink && <a href={run.groupLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline" style={{ color: 'var(--text-faint)' }}>Group post <ExternalLink size={11} /></a>}
                    {run?.pageUrl && <a href={run.pageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline" style={{ color: 'var(--text-faint)' }}>Page post <ExternalLink size={11} /></a>}
                  </div>
                  {run && (
                    <p className={`inline-flex items-start gap-1 ${tone}`} style={tone ? undefined : { color: 'var(--text-soft)' }}>
                      {run.phase === 'done' ? <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" /> : run.phase === 'failed' || run.phase === 'page_failed' || run.phase === 'need_link' ? <AlertCircle size={13} className="mt-0.5 flex-shrink-0" /> : <Loader2 size={13} className="mt-0.5 flex-shrink-0 animate-spin" />}
                      <span>{run.message}</span>
                    </p>
                  )}
                  {run?.linkNote && <p className="text-[11.5px] text-[#ff9500]">{run.linkNote}</p>}
                  {run?.phase === 'need_link' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <input value={manual[q.key] ?? ''} onChange={(e) => setManual((m) => ({ ...m, [q.key]: e.target.value }))} placeholder="https://www.facebook.com/groups/…/posts/…"
                        className="rounded-lg border px-2 py-1 text-[12.5px] bg-transparent flex-1 min-w-[220px]" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
                      <button onClick={() => shareOnPage(q, g, (manual[q.key] || '').trim(), 'Your Group post is up.')} disabled={!(manual[q.key] || '').trim()} className={`${btn} border`} style={ghost}>Share on my Page</button>
                    </div>
                  )}
                  {others.length > 0 && <p className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>Also done in {others.map(([u]) => groups.find((x) => x.url === u)?.name || 'another Group').join(', ')}.</p>}
                </div>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}
