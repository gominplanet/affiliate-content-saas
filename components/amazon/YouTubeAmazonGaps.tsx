'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUTUBE VS AMAZON (Labs; Seb, 2026-11-11: "is there a way to look at all of
// the youtube videos ive uploaded and see what is missing when you look at my
// amazon storefront?" ... "yes build it all"). Every YouTube upload checked
// against the videos on the creator's Amazon storefront, by the product each
// one links to (lib/yt-amazon-match):
//
//   On YouTube, no Amazon video yet   the gap to fill, biggest videos first
//   On Amazon only                    Amazon videos no YouTube video links to
//   Could not tell which product      with why, so a fix is obvious
//   On both                           what is already covered
//
// Check everything reads all three sources in turn: the YouTube uploads (the
// sync Blog posts uses), the Amazon video library and its products (SCOUT, as
// Earnings and Brand recap do), then each YouTube video's links. Each step
// says what it read, and a step that could not run says why.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, ExternalLink, Copy, Check, AlertTriangle, RefreshCw, Youtube, ShoppingBag, HelpCircle, CheckCircle2, Search, Square, ListChecks } from 'lucide-react'
import { toast } from 'sonner'
import { TealHeader } from '@/components/layout/teal-ui'
import { startCreatorHubVideosScan, getVideoScanStatus } from '@/lib/extension-frame'
import { readAllVideoProducts, readVideoProductsViaScout, type ProductReadProgress } from '@/lib/amazon-video-products-client'
import { listText, amazonState, type Coverage, type YtVideo, type AmzVideo } from '@/lib/yt-amazon-match'

const soft = { color: 'var(--text-3)' }
const GREEN = '#15803D'
const AMBER = '#B45309'
const RED = '#B91C1C'
type Tab = 'missing' | 'amazonOnly' | 'unknown' | 'both'
type Step = 'youtube' | 'amazon' | 'links'

interface Report { coverage: Coverage; youtubeNewest: string | null; amazonReadAt: string | null }

const day = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '')
const num = (n: number | null) => (n == null ? '' : n.toLocaleString())
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function post(url: string, body: Record<string, unknown>, ms = 120_000): Promise<Record<string, unknown>> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `MVP answered ${r.status}`)
  return j
}

export default function YouTubeAmazonGaps() {
  const [report, setReport] = useState<Report | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<Step | null>(null)
  const [line, setLine] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<Step, { ok: boolean; text: string } | undefined>>({ youtube: undefined, amazon: undefined, links: undefined })
  const [tab, setTab] = useState<Tab>('missing')
  const [q, setQ] = useState('')
  const [copied, setCopied] = useState(false)
  const stop = useRef(false)
  const note = (s: Step, ok: boolean, text: string) => setNotes((n) => ({ ...n, [s]: { ok, text } }))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/labs/yt-amazon', { cache: 'no-store', signal: AbortSignal.timeout(90_000) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setLoadErr(j.error || `MVP answered ${r.status}`); return }
      setReport(j as Report); setLoadErr(null)
    } catch (e) { setLoadErr(e instanceof Error && e.name === 'TimeoutError' ? 'MVP took too long to put the lists together. Press Refresh.' : 'MVP did not answer. Press Refresh.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  // 1. Every public YouTube upload, 50 at a time (the sync Blog posts uses).
  const readYouTube = async (): Promise<boolean> => {
    setRunning('youtube')
    let total = 0
    let token: string | null = null
    try {
      for (let page = 0; page < 80 && !stop.current; page++) {
        setLine(`Reading your YouTube uploads: ${total.toLocaleString()} so far.`)
        const j = await post('/api/youtube/sync', page === 0 ? { fresh: true } : { pageToken: token })
        total += Number(j.synced) || 0
        token = typeof j.nextPageToken === 'string' ? j.nextPageToken : null
        if (!token) break
      }
      note('youtube', true, `${total.toLocaleString()} YouTube uploads read${stop.current ? ' before you stopped' : ''}.`)
      return true
    } catch (e) {
      note('youtube', false, `Reading your YouTube uploads stopped after ${total.toLocaleString()}: ${e instanceof Error ? e.message : 'no answer'}`)
      return false
    } finally { setRunning(null); setLine(null) }
  }

  // 2. The Amazon video library (SCOUT, in a background tab), then each video's products.
  const readAmazon = async (): Promise<boolean> => {
    setRunning('amazon')
    try {
      const s = await startCreatorHubVideosScan()
      if (!s.ok) {
        const why = s.error === 'not-installed' ? 'SCOUT is not installed in this Chrome' : s.error === 'needs-update' ? 'SCOUT needs updating' : s.error || 'SCOUT did not start'
        note('amazon', false, `Your Amazon video list was not read: ${why}. The products of the videos MVP already has are still matched.`)
      } else {
        for (let i = 0; i < 450 && !stop.current; i++) {
          const st = await getVideoScanStatus()
          setLine(`SCOUT is reading your Amazon video list in a background tab: ${num(st?.saved ?? 0)}${st?.total ? ` of ${num(st.total)}` : ''} videos.`)
          if (!st || st.done || !st.running) {
            if (st?.error) note('amazon', false, `SCOUT stopped reading your Amazon video list: ${st.error}. ${num(st.saved)} videos were saved.`)
            break
          }
          await sleep(2000)
        }
      }
      const show = (p: ProductReadProgress) => {
        const doneN = p.total != null && p.remaining != null ? Math.max(0, p.total + -p.remaining) : null
        setLine(`Reading which product each Amazon video shows: ${num(doneN)}${p.total ? ` of ${num(p.total)}` : ''} done, ${num(p.withProducts)} with a product.`)
      }
      let out = await readAllVideoProducts(show, () => stop.current)
      if (out.kind === 'blocked') {
        const viaScout = await readVideoProductsViaScout(show, () => stop.current, out.p)
        out = viaScout.kind === 'done' || viaScout.kind === 'stopped' ? viaScout : { kind: 'stuck', p: viaScout.p, error: viaScout.kind === 'no-scout' ? 'Amazon paused MVP’s server and SCOUT is not installed' : viaScout.kind === 'old-scout' ? 'Amazon paused MVP’s server and SCOUT needs updating' : viaScout.error || 'Amazon paused the reads' }
      }
      const p = out.p
      if (out.kind === 'done') note('amazon', true, `Every Amazon video's products are read (${num(p.withProducts)} matched to a product this run).`)
      else if (out.kind === 'stopped') note('amazon', true, `Stopped. ${num(p.withProducts)} Amazon videos matched to a product this run; MVP reads the rest by itself.`)
      else if (out.kind === 'no-library') note('amazon', false, 'MVP has no Amazon video list yet, so nothing on Amazon can be matched. Install SCOUT, sign in to Amazon in this Chrome, and press Check everything again.')
      else note('amazon', false, `Reading the Amazon videos' products stopped: ${'error' in out ? out.error : 'no answer'}. ${num(p.remaining)} still to read; MVP carries on by itself.`)
      return true
    } finally { setRunning(null); setLine(null) }
  }

  // 3. Each YouTube video's links, a batch at a time.
  const readLinks = async (): Promise<boolean> => {
    setRunning('links')
    let read = 0
    let found = 0
    try {
      for (let i = 0; i < 400 && !stop.current; i++) {
        const j = await post('/api/labs/yt-amazon', { action: 'read' })
        read += Number(j.read) || 0
        found += Number(j.found) || 0
        const left = Number(j.left) || 0
        setLine(`Following the links in your YouTube descriptions: ${read.toLocaleString()} videos read, ${found.toLocaleString()} with a product, ${left.toLocaleString()} to go.`)
        if (!left || !Number(j.read)) break
      }
      note('links', true, `${read.toLocaleString()} YouTube videos' links read this run, ${found.toLocaleString()} leading to a product${stop.current ? '. Stopped; press again to carry on' : ''}.`)
      return true
    } catch (e) {
      note('links', false, `Following the links stopped after ${read.toLocaleString()} videos: ${e instanceof Error ? e.message : 'no answer'}`)
      return false
    } finally { setRunning(null); setLine(null) }
  }

  const checkAll = async () => {
    stop.current = false
    setNotes({ youtube: undefined, amazon: undefined, links: undefined })
    await readYouTube()
    if (!stop.current) await readAmazon()
    if (!stop.current) await readLinks()
    await load()
  }
  const one = async (f: () => Promise<boolean>) => { stop.current = false; await f(); await load() }
  const readAgain = async () => {
    stop.current = false
    try { await post('/api/labs/yt-amazon', { action: 'again' }) } catch (e) { note('links', false, e instanceof Error ? e.message : 'MVP did not answer.'); return }
    await readLinks(); await load()
  }

  const c = report?.coverage
  const needle = q.trim().toLowerCase()
  const hit = useCallback((s: string) => !needle || s.toLowerCase().includes(needle), [needle])
  const rows = useMemo(() => {
    if (!c) return { missing: [], amazonOnly: [], unknown: [], both: [] } as Pick<Coverage, Tab>
    return {
      missing: c.missing.filter((m) => hit(`${m.yt.title} ${m.asins.join(' ')}`)),
      amazonOnly: c.amazonOnly.filter((m) => hit(`${m.amz.description || ''} ${m.products.map((p) => `${p.asin} ${p.title || ''}`).join(' ')}`)),
      unknown: c.unknown.filter((m) => hit(m.yt.title)),
      both: c.both.filter((m) => hit(`${m.yt.title} ${m.asins.join(' ')}`)),
    }
  }, [c, hit])
  const copy = async () => {
    if (!c || tab === 'both') return
    try { await navigator.clipboard.writeText(listText(c, tab)); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { toast.error('Copying was blocked by the browser.') }
  }

  const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode; n: number; color: string }> = [
    { id: 'missing', label: 'On YouTube, no Amazon video yet', icon: <Youtube size={14} />, n: c?.counts.missing ?? 0, color: RED },
    { id: 'amazonOnly', label: 'On Amazon only', icon: <ShoppingBag size={14} />, n: c?.counts.amazonOnly ?? 0, color: AMBER },
    { id: 'unknown', label: 'Could not tell which product', icon: <HelpCircle size={14} />, n: c?.counts.unknown ?? 0, color: 'var(--text-3)' },
    { id: 'both', label: 'On both', icon: <CheckCircle2 size={14} />, n: c?.counts.both ?? 0, color: GREEN },
  ]

  return (
    <div className="max-w-[1100px] mx-auto">
      <TealHeader eyebrow="Labs" title="YouTube vs Amazon" icon={<ListChecks />}
        line="Every YouTube upload checked against the videos on your Amazon storefront, by the product each one links to. See what is missing on Amazon, what is only on Amazon, and which videos MVP could not place."
        actions={running
          ? <button type="button" onClick={() => { stop.current = true }} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 font-semibold border" style={{ borderColor: 'var(--border-2)' }}><Square size={13} /> Stop</button>
          : <button type="button" onClick={() => void checkAll()} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 font-semibold text-white" style={{ background: 'var(--accent)' }}><RefreshCw size={14} /> Check everything</button>}
        chips={line ? <span className="inline-flex items-center gap-1.5 text-[13px]" style={soft}><Loader2 size={13} className="animate-spin" /> {line}</span> : null} />

      {/* What each source holds, and reading each one on its own. */}
      <div className="rounded-2xl border p-4 mb-4 grid gap-3 sm:grid-cols-3 text-[13px]" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)' }}>
        {([
          { s: 'youtube' as Step, title: 'Your YouTube uploads', what: c ? `${c.counts.youtube.toLocaleString()} public videos${report?.youtubeNewest ? `, newest ${day(report.youtubeNewest)}` : ''}.` : '', act: () => one(readYouTube), btn: 'Read again' },
          { s: 'links' as Step, title: 'Products in your YouTube videos', what: c ? `Links read for ${c.counts.youtubeRead.toLocaleString()} of ${c.counts.youtube.toLocaleString()} videos.` : '', act: () => one(readLinks), btn: c && c.counts.youtubeRead < c.counts.youtube ? 'Find the products' : 'Read new ones' },
          { s: 'amazon' as Step, title: 'Your Amazon videos', what: c ? `${c.counts.amazon.toLocaleString()} videos${report?.amazonReadAt ? `, list read ${day(report.amazonReadAt)}` : ''}${c.counts.amazonUnread ? `; products not read yet for ${c.counts.amazonUnread.toLocaleString()}` : ''}.` : '', act: () => one(readAmazon), btn: 'Read again' },
        ]).map((x) => (
          <div key={x.s} className="min-w-0">
            <p className="font-semibold">{x.title}</p>
            <p style={soft}>{loading && !c ? 'Loading...' : x.what}</p>
            {notes[x.s] && <p className="mt-0.5" style={{ color: notes[x.s]!.ok ? GREEN : AMBER }}>{notes[x.s]!.text}</p>}
            <button type="button" disabled={!!running} onClick={() => void x.act()} className="mt-1 inline-flex items-center gap-1 font-semibold disabled:opacity-50" style={{ color: 'var(--accent)' }}>
              {running === x.s ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {x.btn}
            </button>
          </div>
        ))}
      </div>

      {loadErr && <p className="mb-4 rounded-xl border p-3 text-[13.5px] inline-flex items-start gap-1.5" style={{ borderColor: AMBER, color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {loadErr}</p>}

      {c && (
        <>
          <div className="flex flex-wrap gap-2 mb-3" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                className="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold"
                style={{ borderColor: tab === t.id ? t.color : 'var(--border-2)', background: tab === t.id ? 'var(--surface)' : 'transparent', color: tab === t.id ? t.color : 'var(--text-2)' }}>
                {t.icon} {t.label} <span className="tabular-nums">{t.n.toLocaleString()}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 mb-3 text-[13px]">
            <label className="relative flex-[1_1_260px] max-w-[420px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={soft} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles or ASINs" aria-label="Search the list"
                className="w-full rounded-lg border pl-7 pr-2 py-1.5" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)' }} />
            </label>
            {tab !== 'both' && rows[tab].length > 0 && (
              <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--accent)' }}>
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy this list'}
              </button>
            )}
            <button type="button" disabled={!!running} onClick={() => void readAgain()} className="inline-flex items-center gap-1 font-semibold disabled:opacity-50" style={soft}
              title="After you change your YouTube descriptions: every video's links are followed again.">
              <RefreshCw size={12} /> Read every video&rsquo;s links again
            </button>
          </div>

          <TabNote tab={tab} c={c} />

          <ul className="space-y-2">
            {tab === 'missing' && rows.missing.slice(0, 300).map((m) => (
              <YtRow key={m.yt.id} v={m.yt}>
                <AsinLinks asins={m.asins} />
                {m.rejected.length > 0 && <p className="text-[12px]" style={{ color: AMBER }}>Amazon rejected the video you uploaded for {m.rejected.length === 1 ? 'this product' : 'these products'}.</p>}
              </YtRow>
            ))}
            {tab === 'both' && rows.both.slice(0, 300).map((m) => (
              <YtRow key={m.yt.id} v={m.yt}>
                <AsinLinks asins={m.asins} />
                <p className="text-[12px]" style={{ color: GREEN }}>On Amazon: {m.amazon.slice(0, 3).map((a) => amzName(a)).join('; ')}{m.amazon.length > 3 ? ` and ${m.amazon.slice(3).length} more` : ''}</p>
              </YtRow>
            ))}
            {tab === 'unknown' && rows.unknown.slice(0, 300).map((m) => (
              <YtRow key={m.yt.id} v={m.yt}><p className="text-[12.5px]" style={soft}>{m.why}</p></YtRow>
            ))}
            {tab === 'amazonOnly' && rows.amazonOnly.slice(0, 300).map((m) => (
              <li key={m.amz.aci} className="rounded-xl border p-3 text-[13px]" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)' }}>
                <p className="font-semibold">{amzName(m.amz)}</p>
                <p style={soft}>{[day(m.amz.publishedAt), m.amz.views != null ? `${num(m.amz.views)} views on Amazon` : null, amazonState(m.amz.state) === 'review' ? 'still in review on Amazon' : null].filter(Boolean).join(' · ')}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {m.products.map((p) => (
                    <a key={p.asin} href={`https://www.amazon.com/dp/${p.asin}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--accent)' }}>
                      {p.title ? `${p.title.slice(0, 60)}${p.title.length > 60 ? '...' : ''}` : p.asin}: see it on Amazon <ExternalLink size={11} />
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {tab !== 'amazonOnly' && rows[tab].length > 300 && <p className="mt-2 text-[12.5px]" style={soft}>Showing the 300 with the most views of {rows[tab].length.toLocaleString()}. Search to find the rest; Copy this list copies them all.</p>}
          {rows[tab].length === 0 && <p className="text-[13.5px] py-6 text-center" style={soft}>{needle ? 'Nothing in this list matches your search.' : EMPTY[tab]}</p>}
        </>
      )}
    </div>
  )
}

const EMPTY: Record<Tab, string> = {
  missing: 'Every YouTube video MVP could place has an Amazon video for its product.',
  amazonOnly: 'Every Amazon video shows a product one of your YouTube videos links to.',
  unknown: 'MVP placed every YouTube video.',
  both: 'No YouTube video and Amazon video share a product yet.',
}

/** What each list means and what it leaves out, said once above it. */
function TabNote({ tab, c }: { tab: Tab; c: Coverage }) {
  const parts: string[] = []
  if (tab === 'missing') parts.push('These YouTube videos link to a product that has no video on your Amazon storefront. The ones with the most views come first.')
  if (tab === 'amazonOnly') parts.push('These Amazon videos show a product none of your YouTube videos links to.')
  if (tab === 'unknown') parts.push('MVP could not tell which product these YouTube videos are about. Each says why.')
  if (tab === 'both') parts.push('These YouTube videos have an Amazon video for their product.')
  if ((tab === 'missing' || tab === 'amazonOnly') && c.counts.amazonUnread) parts.push(`MVP has not read the products of ${c.counts.amazonUnread.toLocaleString()} Amazon videos yet, so this list may still change; press Read again under Your Amazon videos.`)
  const unreadYt = c.counts.youtube + -c.counts.youtubeRead
  if ((tab === 'missing' || tab === 'both') && unreadYt > 0) parts.push(`${unreadYt.toLocaleString()} YouTube videos' links are not read yet.`)
  if (c.common.length && (tab === 'missing' || tab === 'unknown' || tab === 'both')) parts.push(`Left out of the matching: ${c.common.slice(0, 4).map((x) => `${x.asin} (in ${x.videos} descriptions)`).join(', ')}, links in most of your descriptions, likely your gear list.`)
  if (tab === 'amazonOnly' && c.counts.amazonNoProduct) parts.push(`${c.counts.amazonNoProduct.toLocaleString()} Amazon videos show no product at all and are not listed.`)
  return <p className="mb-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>{parts.join(' ')}</p>
}

function amzName(a: AmzVideo): string {
  const first = (a.description || '').split('\n').map((l) => l.trim()).find(Boolean) || `Amazon video ${a.aci.slice(-6)}`
  return first.length > 80 ? `${first.slice(0, 80)}...` : first
}

function YtRow({ v, children }: { v: YtVideo; children?: React.ReactNode }) {
  return (
    <li className="rounded-xl border p-3 flex gap-3 text-[13px]" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)' }}>
      {v.thumb
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={v.thumb} alt="" className="w-[96px] h-[54px] rounded-lg object-cover shrink-0 border" style={{ borderColor: 'var(--border)' }} loading="lazy" />
        : <span className="w-[96px] h-[54px] rounded-lg shrink-0" style={{ background: 'var(--surface-2)' }} />}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-semibold leading-snug">{v.title}</p>
        <p style={soft}>{[day(v.publishedAt), v.views != null ? `${num(v.views)} views on YouTube` : null, v.short ? 'Short' : null].filter(Boolean).join(' · ')}
          {' '}<a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold" style={{ color: 'var(--accent)' }}>Watch on YouTube <ExternalLink size={10} /></a>
        </p>
        {children}
      </div>
    </li>
  )
}

function AsinLinks({ asins }: { asins: string[] }) {
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px]">
      {asins.slice(0, 6).map((a) => (
        <a key={a} href={`https://www.amazon.com/dp/${a}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold" style={{ color: 'var(--accent)' }}>
          {a}: see it on Amazon <ExternalLink size={10} />
        </a>
      ))}
      {asins.length > 6 && <span style={soft}>and {asins.slice(6).length} more</span>}
    </p>
  )
}
