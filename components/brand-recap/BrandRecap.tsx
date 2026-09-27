// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Brand recap (LABS): one message per Creator Connections brand, with every
// link the creator published for that brand's products.
//
// Each brand opens into a checklist of its products and links, a message
// rebuilt from whatever is ticked, and three ways to send it. What the page
// says afterwards is what happened: "Sent" only when Amazon confirmed the
// Creator Connections message, a partial send says how much went, and a
// copied or emailed recap counts as sent only when the creator says so.
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Send, Copy, Mail, Check, ChevronDown, ChevronRight, RefreshCw, AlertTriangle, ExternalLink, Search, Film } from 'lucide-react'
import PageHero from '@/components/layout/PageHero'
import { requestSendByAsin, requestSendByCampaign, startCreatorHubVideosScan, getVideoScanStatus, startVideoProductsScan, getVideoProductsStatus, type VideoScanStatus, type VideoProductsStatus } from '@/lib/extension-frame'
import {
  PLATFORM_LABEL, buildBrandRecapMessage, buildBrandRecapCcMessage, ccFromPlainText, ccGroupCount, ccSendReason, linkKey,
  type BrandGroup, type ContentLink,
} from '@/lib/brand-content'

const ACCENT = '#7C3AED'

interface Data {
  brands: BrandGroup[]
  unread: string[]
  privateVideos: number
  recapsTable: boolean
  linksTable: boolean
  sender: { name: string; site: string }
  timings?: Record<string, number>
  amazonVideos?: number
  error?: string
}

type Outcome = { kind: 'ok' | 'warn' | 'error'; text: string; chatUrl?: string | null }

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '')
const chatUrlFor = (campaignId: string | null | undefined) =>
  campaignId ? `https://affiliate-program.amazon.com/p/connect/request?campaignId=${encodeURIComponent(campaignId)}&type=affiliate-plus&status=opportunity` : null

export default function BrandRecap() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/brand-recap')
      const text = await r.text()
      let j: Data
      // A function that runs out of time answers with the host's own error
      // page, not JSON. Say that in words rather than as a parse error.
      try { j = JSON.parse(text) } catch {
        throw new Error(r.status === 504 || /timed? ?out|An error occurred/i.test(text)
          ? `The server took too long gathering your links (HTTP ${r.status}). Press Refresh to try again.`
          : `The server answered with an error page (HTTP ${r.status}) instead of your brands.`)
      }
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // AMAZON VIDEOS: the same sync the Earnings page runs. SCOUT reads the whole
  // video library from Amazon's own data in the creator's signed-in browser
  // (thousands of videos, no paging through Manage Content), then reads which
  // product each video sells. Both save as they go, so what is read is kept
  // even if the tab is closed part way, and the next press carries on.
  // Progress and the outcome are said in numbers, never just "done".
  const [scanning, setScanning] = useState(false)
  const [scanNote, setScanNote] = useState<{ ok: boolean; text: string } | null>(null)
  // Live progress, so a long run reads as working or stuck, never as a
  // frozen sentence: how far, out of how many, how long it has been running,
  // when the count last moved, and which Amazon page SCOUT is on.
  const [prog, setProg] = useState<{ step: 1 | 2; done: number; total: number | null; startedAt: number; movedAt: number; page: string | null } | null>(null)
  const stopWatching = useRef(false)
  const [, setTick] = useState(0)
  useEffect(() => { if (!prog) return; const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t) }, [prog])
  async function findAmazonVideos() {
    setScanning(true); setScanNote({ ok: true, text: 'Starting SCOUT…' })
    stopWatching.current = false
    const started = Date.now()
    let lastDone = -1
    const track = (step: 1 | 2, done: number, total: number | null, page: string | null) => {
      setProg((p) => {
        const moved = !p || p.step !== step || done !== lastDone
        lastDone = done
        return { step, done, total, startedAt: p?.startedAt ?? started, movedAt: moved ? Date.now() : p.movedAt, page }
      })
    }
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    try {
      // 1. The video list.
      const s1 = await startCreatorHubVideosScan()
      if (!s1.ok) {
        setScanNote({ ok: false, text: s1.error === 'not-installed' ? 'Finding your Amazon videos needs the SCOUT extension in this browser.'
          : s1.error === 'needs-update' ? 'Your SCOUT is too old to read your Amazon videos. Update it, then try again.'
            : 'SCOUT could not start reading your Amazon videos. Open amazon.com signed in to your Influencer account, then try again.' })
        return
      }
      let list: VideoScanStatus | null = null
      for (let i = 0; i < 900; i++) {
        await wait(2000)
        list = await getVideoScanStatus()
        if (!list) continue
        if (list.done || list.interrupted) break
        if (stopWatching.current) { setScanNote({ ok: true, text: 'Stopped watching. SCOUT carries on in the background and saves as it goes; press Find my Amazon videos again to see where it is.' }); return }
        track(1, list.offset || 0, list.total, list.pageTitle || list.landedOn || null)
        setScanNote(null)
      }
      if (!list || list.error) {
        setScanNote({ ok: false, text: list?.error === 'no-videos' ? 'SCOUT opened your video list but could not read any videos. Open Manage Content once on Amazon, then try again.' : 'SCOUT could not finish reading your video list. What it read is saved; press again to carry on.' })
        return
      }
      // 2. Which product each video sells.
      const s2 = await startVideoProductsScan()
      if (!s2.ok) { setScanNote({ ok: false, text: `Read ${list.saved.toLocaleString()} new videos, but could not start reading their products. Press again to carry on.` }); return }
      let prod: VideoProductsStatus | null = null
      for (let i = 0; i < 5400; i++) {
        await wait(2000)
        prod = await getVideoProductsStatus()
        if (!prod) continue
        if (prod.done || prod.interrupted) break
        if (stopWatching.current) { setScanNote({ ok: true, text: 'Stopped watching. SCOUT carries on in the background and saves as it goes; press Find my Amazon videos again to see where it is.' }); return }
        track(2, prod.read, prod.remaining != null ? prod.read + prod.remaining : null, null)
        setScanNote({ ok: true, text: `${prod.withProducts.toLocaleString()} have a product so far. You can keep working; it saves as it goes.` })
      }
      await load()
      if (!prod) setScanNote({ ok: false, text: 'SCOUT stopped answering. What was read is saved; reload and press again to carry on.' })
      else if (prod.interrupted) setScanNote({ ok: true, text: `Chrome paused SCOUT after ${prod.read.toLocaleString()} videos. What was read is saved and already in the list; press again to carry on.` })
      else if (prod.error) setScanNote({ ok: false, text: `Stopped reading products after ${prod.read.toLocaleString()} videos. What was read is saved; press again to carry on.` })
      else setScanNote({ ok: true, text: `Done: ${prod.withProducts.toLocaleString()} of the ${prod.read.toLocaleString()} videos read have a product, and their Amazon video links are now in the list.` })
    } finally { setScanning(false); setProg(null) }
  }

  const brands = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = data?.brands ?? []
    return q ? all.filter((b) => b.brand.toLowerCase().includes(q) || b.products.some((p) => p.name.toLowerCase().includes(q) || p.asin.toLowerCase() === q)) : all
  }, [data, query])

  return (
    <div className="max-w-5xl mx-auto">
      <PageHero
        title="Brand recap"
        subtitle="Every link you published for a brand's products, in one message you can send them on Creator Connections."
      />

      <div className="card p-4 mb-4 text-[13px] leading-relaxed text-[#3a3a3c] dark:text-[#d1d1d6]">
        Brands on Creator Connections want to see what you made for them. Pick a brand, check the links, and send. MVP
        remembers what each brand already got, so the next recap only has what is new.
      </div>

      {data && !data.recapsTable && (
        <Notice tone="warn">The recap log is missing (migration 379). You can still send, but MVP cannot remember what each brand already got, so every link will keep showing as new.</Notice>
      )}
      {data && !data.linksTable && (
        <Notice tone="warn">MVP is not yet keeping the links of Deal Radar, Encore and Amazon social posts (migration 379), so those posts are not listed.</Notice>
      )}
      {data && data.unread.length > 0 && (
        <Notice tone="warn">Could not read {data.unread.join(', ')}, so some links may be missing below. Refresh to try again.</Notice>
      )}
      {data && data.privateVideos > 0 && (
        <Notice tone="info">{data.privateVideos} video{data.privateVideos === 1 ? ' is' : 's are'} private or scheduled on YouTube, so {data.privateVideos === 1 ? 'it is' : 'they are'} left out until public.</Notice>
      )}
      <Notice tone="info">
        Instagram, TikTok and Deal Radar posts from before this page existed may be missing: MVP only kept their links from now on. Everything posted from here on is included.
      </Notice>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a brand or product"
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-[var(--border-2,#e5e5e7)] bg-white dark:bg-[#1c1c1e] text-[13px] outline-none focus:border-[#7C3AED]" />
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-[var(--border-2,#e5e5e7)] text-[12px] font-medium disabled:opacity-50">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
        </button>
        <button onClick={findAmazonVideos} disabled={scanning} title="SCOUT reads all your Amazon videos and which product each one sells, then adds them to the list"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-[var(--border-2,#e5e5e7)] text-[12px] font-medium disabled:opacity-50">
          {scanning ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />} Find my Amazon videos
        </button>
      </div>
      {prog && <ScanProgress p={prog} onStop={() => { stopWatching.current = true }} />}
      {scanNote && <Notice tone={scanNote.ok ? 'info' : 'warn'}>{scanNote.text}</Notice>}

      {error && <Notice tone="error">Could not load your brands: {error}</Notice>}
      {loading && !data && <div className="flex items-center gap-2 text-[13px] text-[#86868b] py-10 justify-center"><Loader2 size={14} className="animate-spin" /> Gathering every link you published…</div>}
      {data && brands.length === 0 && !loading && (
        <div className="card p-6 text-[13px] text-[#6e6e73] dark:text-[#aeaeb2]">
          {query ? 'No brand or product matches that.' : 'No Creator Connections brand has content from you yet. Once a video, post or social post about one of their products is live, the brand shows up here.'}
        </div>
      )}

      {data?.timings && (
        <p className="mb-2 text-[11px] text-[#86868b]">
          {data.brands.length} brand{data.brands.length === 1 ? '' : 's'}. {typeof data.amazonVideos === 'number' && (data.amazonVideos > 0
            ? `${data.amazonVideos.toLocaleString()} Amazon videos with a product. `
            : 'No Amazon videos synced yet: press Find my Amazon videos. ')}Slowest read: {(() => {
            const [name, ms] = Object.entries(data.timings).sort((a, b) => b[1] - a[1])[0] ?? ['none', 0]
            return `${name.replace(/_/g, ' ')} (${(ms / 1000).toFixed(1)}s)`
          })()}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {brands.map((b) => (
          <li key={b.brandKey} className="card overflow-hidden">
            <button type="button" onClick={() => setOpenKey(openKey === b.brandKey ? null : b.brandKey)}
              className="w-full flex flex-wrap items-center gap-2 p-4 text-left">
              {openKey === b.brandKey ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{b.brand}</span>
              <span className="text-[12px] text-[#86868b]">
                {b.products.length} product{b.products.length === 1 ? '' : 's'} · {b.linkCount} link{b.linkCount === 1 ? '' : 's'}
              </span>
              {b.newCount > 0
                ? <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold text-white" style={{ background: ACCENT }}>{b.newCount} new</span>
                : <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-[#34c759]/15 text-[#248a3d]">All sent</span>}
              <span className="ml-auto text-[12px] text-[#86868b]">{b.lastRecapAt ? `Last recap ${fmtDate(b.lastRecapAt)}` : 'Never sent a recap'}</span>
            </button>
            {openKey === b.brandKey && data && (
              <Composer brand={b} sender={data.sender} onLogged={load} />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'info' | 'warn' | 'error'; children: React.ReactNode }) {
  const cls = tone === 'error' ? 'border-[#ff3b30]/40 text-[#ff3b30]' : tone === 'warn' ? 'border-[#ff9500]/40' : 'border-[var(--border-2,#e5e5e7)] text-[#6e6e73] dark:text-[#aeaeb2]'
  return (
    <div className={`card p-3 mb-3 border text-[12px] leading-relaxed flex gap-2 ${cls}`}>
      {tone !== 'info' && <AlertTriangle size={14} className={`shrink-0 mt-0.5 ${tone === 'warn' ? 'text-[#ff9500]' : ''}`} />}
      <span>{children}</span>
    </div>
  )
}

function Composer({ brand, sender, onLogged }: { brand: BrandGroup; sender: { name: string; site: string }; onLogged: () => void }) {
  const hasSent = brand.linkCount > brand.newCount
  const [onlyNew, setOnlyNew] = useState(hasSent && brand.newCount > 0)
  const defaultTicks = useCallback((newOnly: boolean) => {
    const t: Record<string, boolean> = {}
    for (const p of brand.products) for (const l of p.links) t[linkKey(l.url)] = newOnly ? !l.sent : true
    return t
  }, [brand])
  const [ticked, setTicked] = useState<Record<string, boolean>>(() => defaultTicks(hasSent && brand.newCount > 0))
  const [message, setMessage] = useState('')
  const [edited, setEdited] = useState(false)
  const [busy, setBusy] = useState<'cc' | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [pendingManual, setPendingManual] = useState<'copy' | 'email' | null>(null)

  const chosen = useMemo(() => brand.products
    .map((p) => ({ ...p, links: p.links.filter((l) => ticked[linkKey(l.url)]) }))
    .filter((p) => p.links.length), [brand, ticked])
  const chosenLinks: ContentLink[] = useMemo(() => chosen.flatMap((p) => p.links), [chosen])
  const sinceLast = onlyNew && hasSent

  const built = useMemo(() => buildBrandRecapMessage({ brand: brand.brand, products: chosen, sinceLast, name: sender.name, site: sender.site }), [brand.brand, chosen, sinceLast, sender])
  useEffect(() => { if (!edited) setMessage(built) }, [built, edited])

  const ccText = edited ? ccFromPlainText(message) : buildBrandRecapCcMessage({ brand: brand.brand, products: chosen, sinceLast, name: sender.name, site: sender.site })

  function switchMode(newOnly: boolean) {
    setOnlyNew(newOnly); setTicked(defaultTicks(newOnly)); setEdited(false)
  }

  async function log(channel: 'cc' | 'copy' | 'email', ok: boolean, extra: { groups?: number; campaignId?: string | null; error?: string } = {}) {
    try {
      const r = await fetch('/api/brand-recap/log', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandKey: brand.brandKey, brand: brand.brand, channel, ok, message,
          urls: chosenLinks.map((l) => l.url), asins: chosen.map((p) => p.asin), ...extra,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!j.logged) toast.error(j.error || 'The send was not recorded, so these links will still show as new.')
      else if (ok) onLogged()
    } catch { toast.error('The send was not recorded, so these links will still show as new.') }
  }

  async function sendOnCc() {
    if (!chosenLinks.length || busy) return
    setBusy('cc'); setOutcome({ kind: 'warn', text: 'Sending on Creator Connections…' })
    const groups = ccGroupCount(ccText)
    const asin = chosen[0].asin
    try {
      const byAsin = await requestSendByAsin(asin, ccText, brand.campaignIds)
      if (byAsin.ok) {
        setOutcome({ kind: 'ok', text: `Sent to ${brand.brand} on Creator Connections (${byAsin.groups ?? groups} message${(byAsin.groups ?? groups) === 1 ? '' : 's'}).`, chatUrl: chatUrlFor(byAsin.campaignId) })
        await log('cc', true, { groups: byAsin.groups ?? groups, campaignId: byAsin.campaignId })
        return
      }
      if (byAsin.error === 'not-installed') { setOutcome({ kind: 'error', text: ccSendReason('not-installed') }); return }
      // Part of it reached the brand. Trying another path would send those parts twice.
      if ((byAsin.groups || 0) > 0) {
        setOutcome({ kind: 'warn', text: `Only ${byAsin.groups} of ${groups} messages reached ${brand.brand}. Open the chat and send the rest by hand (Copy message has it all). These links still count as not sent.`, chatUrl: chatUrlFor(byAsin.campaignId) })
        await log('cc', false, { groups: byAsin.groups, campaignId: byAsin.campaignId, error: `partial: ${byAsin.groups} of ${groups}` })
        return
      }
      if (brand.campaignIds.length) {
        const direct = await requestSendByCampaign(brand.campaignIds, ccText, asin)
        if (direct.ok) {
          setOutcome({ kind: 'ok', text: `Sent to ${brand.brand} on Creator Connections (${direct.groups ?? groups} message${(direct.groups ?? groups) === 1 ? '' : 's'}).`, chatUrl: direct.detailsUrl ?? null })
          await log('cc', true, { groups: direct.groups ?? groups })
          return
        }
        if (direct.leftOpen) {
          try { await navigator.clipboard.writeText(message) } catch { /* Copy message still works */ }
          setOutcome({ kind: 'warn', text: 'SCOUT opened the brand chat in a new tab with your message typed in, but could not confirm it was sent. Press Send in that tab. The message is also on your clipboard.', chatUrl: direct.detailsUrl ?? null })
          setPendingManual('copy')
          return
        }
        if ((direct.groups || 0) > 0) {
          setOutcome({ kind: 'warn', text: `Only ${direct.groups} of ${groups} messages reached ${brand.brand}. Open the chat and send the rest by hand.`, chatUrl: direct.detailsUrl ?? null })
          await log('cc', false, { groups: direct.groups, error: `partial: ${direct.groups} of ${groups}` })
          return
        }
        const reason = direct.reason || direct.error || byAsin.reason || byAsin.error
        setOutcome({ kind: 'error', text: ccSendReason(reason), chatUrl: chatUrlFor(brand.campaignIds[0]) })
        await log('cc', false, { error: String(reason || 'not sent') })
        return
      }
      const reason = byAsin.reason || byAsin.error
      setOutcome({ kind: 'error', text: ccSendReason(reason) })
      await log('cc', false, { error: String(reason || 'not sent') })
    } finally { setBusy(null) }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(message); toast.success('Message copied') } catch { toast.error('Could not copy. Select the text and copy it.') }
    setPendingManual('copy')
  }
  function email() {
    const subject = `${brand.brand}: where my content for your products is live`
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`
    setPendingManual('email')
  }
  async function markSent() {
    const ch = pendingManual ?? 'copy'
    setPendingManual(null)
    setOutcome({ kind: 'ok', text: `Marked as sent to ${brand.brand}. These links will not show as new again.` })
    await log(ch, true)
  }

  const toggle = (url: string) => { setTicked((t) => ({ ...t, [linkKey(url)]: !t[linkKey(url)] })); setEdited(false) }

  return (
    <div className="border-t border-[var(--border-2,#e5e5e7)] p-4 flex flex-col gap-4">
      {hasSent && (
        <div className="inline-flex self-start rounded-lg border border-[var(--border-2,#e5e5e7)] p-0.5 text-[12px]">
          <button onClick={() => switchMode(true)} className={`px-3 py-1 rounded-md font-medium ${onlyNew ? 'text-white' : 'text-[#6e6e73]'}`} style={onlyNew ? { background: ACCENT } : undefined}>
            New since last recap ({brand.newCount})
          </button>
          <button onClick={() => switchMode(false)} className={`px-3 py-1 rounded-md font-medium ${!onlyNew ? 'text-white' : 'text-[#6e6e73]'}`} style={!onlyNew ? { background: ACCENT } : undefined}>
            Everything ({brand.linkCount})
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {brand.products.map((p) => (
          <div key={p.asin}>
            <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{p.name} <span className="font-normal text-[#86868b]">{p.asin}</span></p>
            <ul className="mt-1 flex flex-col gap-1">
              {p.links.map((l) => (
                <li key={l.url} className="flex items-start gap-2 text-[12px]">
                  <input type="checkbox" checked={!!ticked[linkKey(l.url)]} onChange={() => toggle(l.url)} className="mt-0.5 accent-[#7C3AED]" />
                  <span className="min-w-0">
                    <span className="font-medium">{PLATFORM_LABEL[l.platform]}</span>
                    {l.sent && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[#34c759]/15 text-[#248a3d] font-semibold">Sent before</span>}
                    {l.at && <span className="ml-1.5 text-[#86868b]">{fmtDate(l.at)}</span>}
                    <a href={l.url} target="_blank" rel="noreferrer" className="block truncate text-[#0a84ff] hover:underline">{l.url}</a>
                    {l.note && <span className="block text-[11px] text-[#ff9500]">{l.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[12px] font-semibold">Message</label>
          {edited && <button onClick={() => setEdited(false)} className="text-[11px] text-[#0a84ff]">Rebuild from the ticked links</button>}
        </div>
        <textarea value={message} onChange={(e) => { setMessage(e.target.value); setEdited(true) }} rows={12}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-2,#e5e5e7)] bg-white dark:bg-[#1c1c1e] text-[12px] font-mono leading-relaxed outline-none focus:border-[#7C3AED]" />
        <p className="mt-1 text-[11px] text-[#86868b]">
          {chosenLinks.length} link{chosenLinks.length === 1 ? '' : 's'} ticked. On Creator Connections it goes as {ccGroupCount(ccText)} message{ccGroupCount(ccText) === 1 ? '' : 's'}.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={sendOnCc} disabled={!chosenLinks.length || !!busy}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-[13px] font-semibold disabled:opacity-40" style={{ background: ACCENT }}>
          {busy === 'cc' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send on Creator Connections
        </button>
        <button onClick={copy} disabled={!chosenLinks.length} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-2,#e5e5e7)] text-[13px] font-medium disabled:opacity-40">
          <Copy size={14} /> Copy message
        </button>
        <button onClick={email} disabled={!chosenLinks.length} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-2,#e5e5e7)] text-[13px] font-medium disabled:opacity-40">
          <Mail size={14} /> Email
        </button>
        {pendingManual && (
          <button onClick={markSent} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#34c759]/50 text-[#248a3d] text-[13px] font-semibold">
            <Check size={14} /> I sent it
          </button>
        )}
      </div>

      {outcome && (
        <div className={`rounded-lg px-3 py-2 text-[12px] leading-relaxed ${outcome.kind === 'ok' ? 'bg-[#34c759]/10 text-[#248a3d]' : outcome.kind === 'warn' ? 'bg-[#ff9500]/10 text-[#c93400]' : 'bg-[#ff3b30]/10 text-[#d70015]'}`}>
          {outcome.text}
          {outcome.chatUrl && (
            <a href={outcome.chatUrl} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 underline">Open the brand chat <ExternalLink size={11} /></a>
          )}
        </div>
      )}
    </div>
  )
}

const since = (ms: number) => { const sec = Math.max(0, Math.round(ms / 1000)); return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s` }

/** The Amazon video sync, in progress: a bar when the total is known, a
 *  moving stripe when it is not, the time running, when the count last
 *  moved, and a plain warning once it has not moved for 90 seconds. */
function ScanProgress({ p, onStop }: { p: { step: 1 | 2; done: number; total: number | null; startedAt: number; movedAt: number; page: string | null }; onStop: () => void }) {
  const now = Date.now()
  const still = now - p.movedAt
  const stuck = still > 90_000
  const pct = p.total && p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : null
  return (
    <div className={`card p-3 mb-3 border text-[12px] ${stuck ? 'border-[#ff9500]/50' : 'border-[var(--border-2,#e5e5e7)]'}`}>
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <Loader2 size={13} className="animate-spin" style={{ color: ACCENT }} />
        <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
          Step {p.step} of 2: {p.step === 1 ? 'reading your Amazon videos' : 'reading which product each video sells'}
        </span>
        <span className="text-[#86868b] tabular-nums">
          {p.done.toLocaleString()}{p.total ? ` of ${p.total.toLocaleString()}` : ''}{pct != null ? ` (${pct}%)` : ''}
        </span>
        <button onClick={onStop} className="ml-auto text-[11px] text-[#86868b] hover:text-[#ff3b30]">Stop watching</button>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden bg-black/5 dark:bg-white/10">
        {pct != null
          ? <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, pct)}%`, background: ACCENT }} />
          : <div className="h-full w-1/3 rounded-full animate-pulse" style={{ background: ACCENT }} />}
      </div>
      <p className="mt-1.5 text-[11px] text-[#86868b] tabular-nums">
        Running {since(now - p.startedAt)}. Last moved {since(still)} ago.{p.page ? ` SCOUT is on: ${p.page}.` : ''}
      </p>
      {stuck && (
        <p className="mt-1 text-[11px] text-[#c93400]">
          Nothing has moved for {since(still)}. SCOUT may be waiting on Amazon: check the Amazon tab it opened{p.page ? ` (${p.page})` : ''} and sign in if asked. Everything read so far is saved, so you can press Stop watching and try again later.
        </p>
      )}
    </div>
  )
}
