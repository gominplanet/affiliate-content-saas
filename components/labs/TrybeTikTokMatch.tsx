'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MATCH MY TIKTOK (Seb, 2026-11-09: TrybeDaily "can scan user's tiktok
// accounts and retrieve their videos and match them to brands and products on
// trybe.. possible?"; "build both, but we're going to use Scout to start").
//
// The creator types their handle; SCOUT reads their public TikTok videos in
// its own minimized window and hands them to MVP as it goes (the scan keeps
// going with this page closed); MVP matches them to every brand on TRYBE and
// says how it knows for each one. Once TikTok approves MVP's video list
// scope, the same scan runs from the cloud through the creator's TikTok
// connection (lib/tiktok-video-list).
//
// WHAT HAPPENED, NOT WHAT WAS MEANT (CLAUDE.md "Reporting"). TrybeDaily's
// scan ended "116 posts checked, 0 brands matched" with no way to tell a
// library with no TRYBE brands from a scan that read nothing. Here the end
// says how the scan ended (read to the end, TikTok stopped loading, a puzzle,
// stopped), how many videos carry a TikTok Shop tag, and why nothing matched
// when nothing did.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Loader2, ScanSearch, Square, ExternalLink, Check, RefreshCw, Cloud, Eye, ShoppingBag, AtSign, Hash, Type, Package, Send, Clapperboard, Download } from 'lucide-react'
import { cleanHandle } from '@/lib/tiktok-videos'
import { isMatch, SURENESS_WORDS, type MatchKind, type Sureness } from '@/lib/tiktok-match-words'
import { requestTikTokLibraryAccess, requestTikTokLibraryScan, requestTikTokLibraryStop, requestTikTokLibraryDaily, requestTikTokDownload, type TikTokDownloadProgress } from '@/lib/extension-frame'
import { SCOUT_STORE_LISTING_URL, SCOUT_TIKTOK_LIBRARY_MIN_VERSION } from '@/lib/scout-version'
import { BrandMark } from '@/components/labs/TrybeFinderControls'
import { BrandName } from '@/components/labs/trybe-dossier-context'
import TrybeLink from '@/components/labs/TrybeLink'

const API = '/api/labs/tiktok-library'
const ACCENT = 'var(--accent)'
const soft = { color: 'var(--text-3)' }
const AMBER = '#B45309'
const RED = '#B91C1C'

interface Video { id: string; url: string; caption: string; postedAt: string | null; views: number | null; cover: string | null; products: Array<{ title: string | null; shop: string | null }> }
interface Match { brandId: string; name: string; sureness: Sureness; videoIds: string[]; how: Array<{ kind: MatchKind; videoId: string; text: string; count?: number }>; newestAt: string | null; foundAt: string; joinedTrybeAt: string | null }
interface Scan { id: string | null; source: string | null; status: string | null; read: number; total: number | null; withProduct: number; reachedEnd: boolean | null; error: string | null; startedAt: string | null; updatedAt: string | null; finishedAt: string | null }
interface Library { handle: string; name: string | null; avatar: string | null; videoCount: number | null; privateAccount: boolean | null; scan: Scan; daily: boolean; kept: number; matchedAt: string | null; matchedNote: string | null; matchedBrands: number }
interface Data {
  library: Library | null; matches: Match[]; videos: Record<string, Video>
  brands?: Record<string, { website: string | null; categories: string[]; trybeScore: number | null; requested: string | null }>
  official: { switchOn: boolean; connected: boolean; hasScope: boolean; username: string | null }
}

const KIND_ICON: Record<MatchKind, typeof ShoppingBag> = { product_tag: ShoppingBag, mention: AtSign, hashtag: Hash, name: Type, product: Package }
// Each chip's words in a darker shade on light and a lighter one on dark, so
// it reads on both.
const SURE_CLS: Record<Sureness, string> = {
  sure: 'bg-[rgba(22,163,74,0.14)] text-[#15803D] dark:text-[#4ADE80]',
  likely: 'bg-[rgba(13,148,136,0.14)] text-[#0F766E] dark:text-[#2DD4BF]',
  maybe: 'bg-[color:var(--surface-2)] text-[color:var(--text-2)]',
}
const ASKED: Record<string, string> = { sent: 'Asked on TRYBE', sending: 'Sending now', already: 'Already asked', drafted: 'Request written, not sent', replied: 'Replied', accepted: 'Accepted' }
/** Statuses where the request has gone (or is going) to TRYBE. */
const GONE = new Set(['sent', 'sending', 'already', 'replied', 'accepted'])

const day = (at: string | null) => { const t = at ? Date.parse(at) : NaN; return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null }
const compact = (n: number | null) => (n == null ? null : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(n))

async function post(body: Record<string, unknown>) {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j.ok === false) throw new Error(j.error || `MVP answered ${res.status}`)
  return j
}

export interface MatchActions {
  /** Write the request for one brand into Ready to send. */
  request: (id: string) => Promise<void>
  /** Send a written request now, through SCOUT. */
  send?: (id: string) => Promise<void>
  /** Why sending cannot start right now (TRYBE not allowed, its tab closed, the daily limit). */
  sendBlocked?: string | null
  /** Open Brand scripts for the brand, with the product the videos show. */
  scripts?: (id: string, name: string, product: string | null) => void
  openQueue?: () => void
  /** TRYBE's Upload page, where a downloaded video goes to its brand. */
  openUpload?: () => void
  /** The TikTok handle the videos are from. */
  handle: string
}

export default function TrybeTikTokMatch({ hasCore, onWrite, scoutOpens = false, onSend, sendBlocked = null, onScripts, onOpenQueue, onOpenUpload }: {
  hasCore: boolean; onWrite: (ids: string[]) => Promise<string[] | void>; scoutOpens?: boolean
  onSend?: (id: string) => Promise<void>; sendBlocked?: string | null
  onScripts?: (id: string, name: string, product: string | null) => void; onOpenQueue?: () => void; onOpenUpload?: () => void
}) {
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState<'starting' | 'stopping' | 'official' | 'daily' | null>(null)
  const [scout, setScout] = useState<'checking' | 'no-scout' | 'old' | 'granted' | 'not-granted'>('checking')
  const [showMaybe, setShowMaybe] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [writing, setWriting] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(API, { cache: 'no-store' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `MVP answered ${res.status}`)
      setData(j as Data)
      setLoadError(null)
      setHandle((h) => h || (j.library?.handle ? `@${j.library.handle}` : j.official?.username ? `@${j.official.username}` : ''))
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not load Match my TikTok.') }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { void requestTikTokLibraryAccess(false).then((r) => setScout(r.state)) }, [])
  const running = data?.library?.scan.status === 'running'
  // While a scan runs, the page follows it from MVP's copy (SCOUT hands over as it goes).
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => { void load() }, 3000)
    return () => clearInterval(t)
  }, [running, load])

  const lib = data?.library ?? null
  const scan = lib?.scan ?? null
  const official = data?.official
  const cloud = !!official?.switchOn && !!official?.hasScope

  async function startScan() {
    const h = cleanHandle(handle)
    if (!h) { toast.error('Type your TikTok handle as it shows on your profile, like @gominreviews.'); return }
    setBusy('starting')
    try {
      let acc = await requestTikTokLibraryAccess(false)
      if (acc.state === 'no-scout' || acc.state === 'old') { setScout(acc.state); toast.error(acc.state === 'old' ? `This needs SCOUT ${SCOUT_TIKTOK_LIBRARY_MIN_VERSION} or newer.` : 'This needs SCOUT in this Chrome.'); return }
      if (acc.state !== 'granted') {
        toast.message('SCOUT is asking Chrome once to read tiktok.com. Choose Allow in the small window.')
        acc = await requestTikTokLibraryAccess(true)
        setScout(acc.state)
        if (acc.state !== 'granted') { toast.error('SCOUT was not allowed to read tiktok.com, so nothing was read. Press Scan again and choose Allow.'); return }
      }
      setScout('granted')
      const r = await post({ action: 'start', handle: h })
      const s = await requestTikTokLibraryScan(h, r.scanId)
      if (!s.ok) {
        if (s.error === 'busy') toast.message('SCOUT is already reading your TikTok. It hands each batch over as it goes.')
        else { await post({ action: 'stop' }).catch(() => null); toast.error(`SCOUT could not start the scan${s.error ? ` (${s.error})` : ''}.`) }
      }
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The scan could not start.')
    } finally { setBusy(null) }
  }

  async function stopScan() {
    setBusy('stopping')
    try { await requestTikTokLibraryStop(); await post({ action: 'stop' }); await load() } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not stop the scan.') } finally { setBusy(null) }
  }

  async function cloudScan() {
    setBusy('official')
    try {
      const r = await post({ action: 'official', handle: cleanHandle(handle) })
      toast.success(`${r.read} videos read from TikTok${r.reachedEnd ? ', to the end' : ''}. ${r.matched} brands matched.`)
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'The cloud scan failed.'); await load() } finally { setBusy(null) }
  }

  async function setDaily(on: boolean) {
    if (!lib) return
    setBusy('daily')
    try {
      await post({ action: 'daily', on })
      // From the cloud once TikTok approves; until then SCOUT checks in this Chrome.
      if (!cloud) {
        const r = await requestTikTokLibraryDaily(on, lib.handle)
        if (!r.ok) toast.error('MVP saved it, but SCOUT did not answer, so this Chrome will not check daily. Open this page with SCOUT on and turn it on again.')
        else if (on) toast.success('SCOUT will check your TikTok for new videos once a day while Chrome is open.')
      } else if (on) toast.success('MVP will check your TikTok for new videos once a day, from the cloud.')
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not change the daily check.') } finally { setBusy(null) }
  }

  const matches = data?.matches ?? []
  const shown = useMemo(() => matches.filter(isMatch), [matches])
  const maybes = useMemo(() => matches.filter((m) => !isMatch(m)), [matches])
  const askable = (id: string) => !data?.brands?.[id]?.requested
  // One brand at a time from its card: write the request, send it, or scripts.
  const actions: MatchActions = {
    request: async (id) => { if (!hasCore) { toast.error('Write your core message in Find brands first: requests are written from it.'); return } await onWrite([id]); await load() },
    send: onSend ? async (id) => { await onSend(id); await load() } : undefined,
    sendBlocked, scripts: onScripts, openQueue: onOpenQueue, openUpload: onOpenUpload, handle: lib?.handle ?? '',
  }
  const pickable = shown.filter((m) => askable(m.brandId))

  async function writeRequests() {
    const ids = Array.from(picked)
    if (!ids.length) return
    setWriting(true)
    try { await onWrite(ids); setPicked(new Set()); await load() } finally { setWriting(false) }
  }

  const total = scan?.total ?? lib?.videoCount ?? null
  const pct = scan && total ? Math.min(100, Math.round((scan.read / Math.max(1, total)) * 100)) : null
  const left = (() => {
    if (!scan || !running || !total || !scan.startedAt || scan.read < 10) return null
    const secs = (Date.now() - Date.parse(scan.startedAt)) / 1000
    const rest = Math.max(0, total - scan.read) / Math.max(0.1, scan.read / secs)
    return rest < 90 ? 'about a minute left' : `about ${Math.round(rest / 60)} min left`
  })()

  return (
    <section className="rounded-2xl border p-4 sm:p-5 mb-4" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)' }} aria-label="Match my TikTok">
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <span className="w-9 h-9 shrink-0 rounded-xl inline-flex items-center justify-center" style={{ background: 'rgb(var(--brand-rgb) / 0.12)', color: ACCENT }}><ScanSearch size={18} /></span>
        <div className="min-w-[14rem] flex-1">
          <h2 className="text-[17px] font-extrabold leading-tight">Match my TikTok</h2>
          <p className="text-[13px] mt-0.5 max-w-[68ch]" style={{ color: 'var(--text-2)' }}>Find the TRYBE brands you already filmed. SCOUT reads your public TikTok videos out of sight, and MVP matches each one by its TikTok Shop tag, your @tags, and the brand or product named in your caption. Nothing is posted.</p>
        </div>
      </div>

      {loadError && <p className="text-[13px] mb-3" style={{ color: RED }}>{loadError}</p>}

      {/* SCOUT, when it is not ready. */}
      {scout === 'no-scout' && !cloud && (
        <p className="text-[13px] mb-3 rounded-lg px-3 py-2" style={{ background: 'rgba(217,119,6,0.10)', color: AMBER }}>
          This reads your TikTok through SCOUT, MVP&rsquo;s Chrome helper. <a href={SCOUT_STORE_LISTING_URL} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Install SCOUT from the Chrome Web Store</a>, then come back.
        </p>
      )}
      {scout === 'old' && !cloud && (
        <p className="text-[13px] mb-3 rounded-lg px-3 py-2" style={{ background: 'rgba(217,119,6,0.10)', color: AMBER }}>
          This needs SCOUT {SCOUT_TIKTOK_LIBRARY_MIN_VERSION} or newer. Chrome updates SCOUT by itself within a day; to update now, open <a href={SCOUT_STORE_LISTING_URL} target="_blank" rel="noopener noreferrer" className="font-semibold underline">SCOUT on the Chrome Web Store</a>.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        {/* The account. */}
        <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--border)' }}>
          {lib ? (
            <div className="flex items-center gap-3">
              {lib.avatar
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={lib.avatar} alt="" width={56} height={56} className="w-14 h-14 rounded-full object-cover shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                : <span className="w-14 h-14 rounded-full shrink-0 inline-flex items-center justify-center text-[20px] font-bold" style={{ background: 'rgb(var(--brand-rgb) / 0.12)', color: ACCENT }}>{(lib.name || lib.handle)[0]?.toUpperCase()}</span>}
              <div className="min-w-0">
                <p className="text-[16px] font-bold leading-tight truncate">{lib.name || `@${lib.handle}`}</p>
                <a href={`https://www.tiktok.com/@${lib.handle}`} target="_blank" rel="noopener noreferrer" className="text-[13px] inline-flex items-center gap-1 underline" style={{ color: ACCENT }}>@{lib.handle} on TikTok <ExternalLink size={11} /></a>
                <p className="text-[12.5px] mt-0.5" style={soft}>{lib.videoCount != null ? `${lib.videoCount.toLocaleString()} public videos on the profile` : 'Video count not read yet'}{lib.privateAccount ? ' · private account' : ''}</p>
              </div>
            </div>
          ) : (
            <p className="text-[13px]" style={soft}>Type your TikTok handle and press Scan. SCOUT opens your profile in its own minimized window, so nothing takes over your screen.</p>
          )}
          {lib && (
            <label className="mt-3 pt-3 border-t flex items-start gap-2.5 cursor-pointer" style={{ borderColor: 'var(--border)' }}>
              <input type="checkbox" className="mt-1 accent-[#0D9488]" checked={lib.daily} disabled={busy === 'daily'} onChange={(e) => void setDaily(e.target.checked)} />
              <span className="text-[13px]">
                <span className="font-semibold">Check for new TikTok videos daily</span>
                <span className="block text-[12px]" style={soft}>{cloud ? 'MVP reads your newest videos from the cloud once a day and matches them.' : 'SCOUT reads your newest videos once a day while Chrome is open, and MVP matches them. Brands that join TRYBE later are matched to your videos too.'}</span>
              </span>
            </label>
          )}
        </div>

        {/* The scan. */}
        <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[14px] font-bold mb-2">Your TikTok videos</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <label className="flex-1 flex items-center gap-1.5 rounded-lg border px-3 py-2 focus-within:ring-2 focus-within:ring-[#7C3AED]/40" style={{ borderColor: 'var(--border-2)' }}>
              <AtSign size={14} style={soft} />
              <input value={handle.replace(/^@/, '')} onChange={(e) => setHandle(e.target.value)} placeholder="yourhandle" aria-label="Your TikTok handle" className="flex-1 min-w-0 bg-transparent outline-none text-[14px]" disabled={running} />
            </label>
            {running ? (
              <button type="button" onClick={() => void stopScan()} disabled={busy === 'stopping'} className="rounded-lg px-4 py-2 text-[13.5px] font-bold inline-flex items-center justify-center gap-1.5 border" style={{ borderColor: 'var(--border-2)' }}>
                {busy === 'stopping' ? <Loader2 size={14} className="animate-spin" /> : <Square size={13} />} Stop scan
              </button>
            ) : (
              <button type="button" onClick={() => void startScan()} disabled={!!busy || scout === 'no-scout'} className="rounded-lg px-4 py-2 text-[13.5px] font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-60" style={{ background: ACCENT, color: '#fff' }}>
                {busy === 'starting' ? <Loader2 size={14} className="animate-spin" /> : <ScanSearch size={14} />} {lib ? 'Scan again' : 'Scan my TikTok'}
              </button>
            )}
          </div>
          {official?.switchOn && !running && (
            cloud ? (
              <button type="button" onClick={() => void cloudScan()} disabled={!!busy} className="mt-2 text-[12.5px] font-semibold inline-flex items-center gap-1.5 underline disabled:opacity-60" style={{ color: ACCENT }}>
                {busy === 'official' ? <Loader2 size={12} className="animate-spin" /> : <Cloud size={12} />} Scan from the cloud instead (through your TikTok connection, no SCOUT)
              </button>
            ) : (
              <p className="mt-2 text-[12.5px]" style={soft}><Cloud size={12} className="inline -mt-0.5" /> To scan from the cloud without SCOUT, <a href="/api/auth/tiktok" className="font-semibold underline" style={{ color: ACCENT }}>connect TikTok again on TikTok&rsquo;s sign-in page</a> and allow MVP to read your videos.</p>
            )
          )}

          {/* How the scan went. */}
          {scan && running && (
            <div className="mt-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold"><Loader2 size={14} className="animate-spin" style={{ color: ACCENT }} /> Scanning @{lib?.handle}{scan.source === 'scout_daily' ? ' (daily check)' : ''}</div>
              <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }} role="progressbar" aria-valuemin={0} aria-valuemax={total ?? undefined} aria-valuenow={scan.read}>
                <div className="h-full rounded-full transition-all" style={{ width: `${pct ?? 8}%`, background: ACCENT }} />
              </div>
              <p className="text-[12.5px] mt-1.5"><span className="font-semibold tabular-nums">{scan.read.toLocaleString()}{total ? ` of ${total.toLocaleString()}` : ''} videos read</span>{left && <span style={soft}> &middot; {left} (estimate)</span>}</p>
              <p className="text-[12px] mt-1" style={soft}>Newest videos first. Brands are matched when the scan ends. You can close this page: SCOUT keeps reading in its own window and hands each batch to MVP.</p>
            </div>
          )}
          {scan && !running && scan.status && (
            <ScanEnd scan={scan} total={total} kept={lib?.kept ?? 0} matched={lib?.matchedBrands ?? 0} />
          )}
        </div>
      </div>

      {lib?.matchedNote && <p className="text-[12.5px] mt-3" style={{ color: AMBER }}>{lib.matchedNote}</p>}

      {/* The matches. */}
      {lib && !running && lib.kept > 0 && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h3 className="text-[15px] font-bold">TRYBE brands you filmed</h3>
            <span className="text-[12px] rounded-full px-2 py-0.5 font-semibold bg-[rgba(13,148,136,0.14)] text-[#0F766E] dark:text-[#2DD4BF]">{shown.length}</span>
            <button type="button" onClick={() => void post({ action: 'rematch' }).then(load).catch((e) => toast.error(e.message))} className="text-[12px] inline-flex items-center gap-1 underline" style={soft}><RefreshCw size={11} /> Match again</button>
            <span className="flex-1" />
            {pickable.length > 0 && (
              <button type="button" onClick={() => setPicked(picked.size ? new Set() : new Set(pickable.map((m) => m.brandId)))} className="text-[12.5px] font-semibold underline" style={{ color: ACCENT }}>{picked.size ? 'Clear picks' : `Pick all ${pickable.length} not asked yet`}</button>
            )}
            <button type="button" onClick={() => void writeRequests()} disabled={!picked.size || writing || !hasCore} title={hasCore ? undefined : 'Write your core message in Find brands first.'}
              className="rounded-lg px-3.5 py-1.5 text-[13px] font-bold inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: ACCENT, color: '#fff' }}>
              {writing ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Write requests{picked.size ? ` to ${picked.size}` : ''}
            </button>
          </div>
          {!hasCore && picked.size > 0 && <p className="text-[12.5px] mb-2" style={{ color: AMBER }}>Write your core message in Find brands first: requests are written from it.</p>}
          {shown.length === 0 ? (
            <p className="text-[13px] rounded-lg px-3 py-2.5" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
              None of your {lib.kept.toLocaleString()} videos names a TRYBE brand in a TikTok Shop tag, an @tag or its caption. A video that only shows a product without naming it cannot be matched yet. Brands that join TRYBE later are checked against these videos by themselves.
            </p>
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
              {shown.map((m) => <MatchCard key={m.brandId} m={m} videos={data?.videos ?? {}} brand={data?.brands?.[m.brandId]} picked={picked.has(m.brandId)} scoutOpens={scoutOpens} actions={actions}
                onPick={(on) => setPicked((p) => { const n = new Set(p); if (on) n.add(m.brandId); else n.delete(m.brandId); return n })} />)}
            </div>
          )}
          {maybes.length > 0 && (
            <div className="mt-4">
              <button type="button" onClick={() => setShowMaybe((v) => !v)} className="text-[12.5px] font-semibold underline" style={soft}>
                {showMaybe ? 'Hide' : 'Show'} {maybes.length} possible {maybes.length === 1 ? 'match' : 'matches'}: brand names that are everyday words, so check the video
              </button>
              {showMaybe && (
                <div className="grid grid-cols-[minmax(0,1fr)] gap-3 mt-3">
                  {maybes.map((m) => <MatchCard key={m.brandId} m={m} videos={data?.videos ?? {}} brand={data?.brands?.[m.brandId]} picked={picked.has(m.brandId)} scoutOpens={scoutOpens} actions={actions}
                    onPick={(on) => setPicked((p) => { const n = new Set(p); if (on) n.add(m.brandId); else n.delete(m.brandId); return n })} />)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** How the scan ended, as it happened. */
function ScanEnd({ scan, total, kept, matched }: { scan: Scan; total: number | null; kept: number; matched: number }) {
  const daily = scan.source === 'scout_daily'
  const when = day(scan.finishedAt)
  const chips = (
    <div className="flex flex-wrap gap-1.5 mt-2">
      <span className="text-[12px] font-semibold rounded-full px-2.5 py-0.5 tabular-nums bg-[rgba(219,39,119,0.12)] text-[#BE185D] dark:text-[#F9A8D4]">{kept.toLocaleString()} videos kept</span>
      <span className="text-[12px] font-semibold rounded-full px-2.5 py-0.5 tabular-nums" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }} title="Videos with a TikTok Shop product tag on them">{scan.withProduct.toLocaleString()} with a TikTok Shop tag</span>
      <span className="text-[12px] font-semibold rounded-full px-2.5 py-0.5 tabular-nums bg-[rgba(13,148,136,0.14)] text-[#0F766E] dark:text-[#2DD4BF]">{matched.toLocaleString()} brands matched</span>
    </div>
  )
  let line: ReactNode
  if (scan.status === 'failed') line = <p className="text-[13px] mt-3" style={{ color: RED }}>{scan.error || 'The scan failed.'}</p>
  else if (scan.status === 'stopped') line = <p className="text-[13px] mt-3" style={{ color: AMBER }}>{scan.error || 'The scan was stopped.'} {scan.read.toLocaleString()} read before it stopped.</p>
  else if (daily) line = <p className="text-[13px] mt-3" style={{ color: 'var(--text-2)' }}>Daily check{when ? ` on ${when}` : ''}: SCOUT read your newest {scan.read.toLocaleString()} videos and stopped at ones MVP already had.</p>
  else if (scan.reachedEnd) {
    line = (
      <p className="text-[13px] mt-3 inline-flex items-start gap-1.5" style={{ color: 'var(--text-2)' }}>
        <Check size={14} className="mt-0.5 shrink-0" style={{ color: '#15803D' }} />
        <span>Read to the end of your videos{when ? ` on ${when}` : ''}: {scan.read.toLocaleString()} read.{total && scan.read < total ? ` Your profile counts ${total.toLocaleString()}; TikTok’s page showed ${scan.read.toLocaleString()} (private, friends only and removed videos do not show on it).` : ''}</span>
      </p>
    )
  } else line = <p className="text-[13px] mt-3" style={{ color: AMBER }}>{scan.error || `TikTok stopped loading more after ${scan.read.toLocaleString()}${total ? ` of ${total.toLocaleString()}` : ''} videos.`} Press Scan again to read the rest; videos already read are kept.</p>
  return <div>{line}{chips}</div>
}

/** What a download that did not happen means, in words. */
const DL_WORDS: Record<string, string> = {
  puzzle: 'TikTok asked to confirm you are a person, so SCOUT stopped. Open tiktok.com in Chrome, do it once, then press Download again.',
  gone: 'TikTok says this video is private or no longer there, so there is nothing to save.',
  'no-video-address': 'TikTok\u2019s page did not show where it plays the video from, so nothing was saved.',
  'not-saved': 'TikTok would not hand over the video file, so nothing was saved.',
  'no-access': 'SCOUT is not allowed to read tiktok.com in this Chrome. Press Scan again and choose Allow.',
  'no-answer-from-page': 'TikTok\u2019s page did not load in time, so nothing was saved. Try again.',
  // From SCOUT 1.60.1 and older, which stopped without saying where.
  timeout: 'The download took too long, and this SCOUT stopped without saying where. Check your Downloads folder. SCOUT 1.60.2 follows a slow download to the end and says how far it got; Chrome updates SCOUT by itself.',
  'asked-where': 'Chrome asked where to save the video, and no folder was chosen. If you saw no Save window, open Chrome\u2019s Settings, then Downloads, and turn off \u201CAsk where to save each file before downloading\u201D. Then press Download again.',
  'open-tab-slow': 'SCOUT could not open TikTok in its window in time, so nothing was saved. Try again.',
}
/** The step a download reached, for one that ran out of time (SCOUT 1.60.2). */
const STEP_WORDS: Record<string, string> = {
  starting: 'starting',
  opening: 'opening your video on TikTok',
  finding: 'looking for the video file on TikTok\u2019s page',
  chrome: 'saving it through Chrome',
  page: 'saving it from TikTok\u2019s page',
}
const mb = (n: number) => (n / 1_048_576).toFixed(1)
/** How far a download is, in a few words for the small button under a video. */
function progressWords(p: TikTokDownloadProgress): string {
  if (p.waiting) return 'Waiting'
  if (p.asking) return 'Choose a folder'
  if (p.bytes > 0) return p.total > 0 ? `${mb(p.bytes)} of ${mb(p.total)} MB` : `${mb(p.bytes)} MB`
  return p.step === 'finding' ? 'Finding it' : p.step === 'chrome' || p.step === 'page' ? 'Saving' : 'Opening'
}
/** What each try SCOUT made means (SCOUT 1.60.1 says what it tried). */
function tryWords(raw: string): string {
  // '+nosignin': the page's second try, without its sign-in (the code keeps it).
  const code = raw.replace(/\+nosignin$/, '')
  if (code === 'chrome-asked-where') return 'Chrome asked where to save it, and no folder was chosen'
  if (code === 'chrome-stopped' || code === 'page-stopped') return 'SCOUT stopped it at its time limit'
  if (code === 'chrome-stalled' || code === 'page-stalled') return 'TikTok stopped sending the file part way'
  if (code === 'chrome-no-answer' || code === 'page-no-answer') return 'TikTok did not start sending the file'
  if (code === 'chrome-too-slow') return 'it was still coming in at SCOUT\u2019s time limit'
  if (code === 'chrome-gone') return 'the download disappeared from Chrome\u2019s list'
  if (code === 'page-busy') return 'TikTok\u2019s page stopped answering SCOUT'
  if (/^chrome-SERVER_(FORBIDDEN|UNAUTHORIZED)/.test(code)) return 'TikTok refused to send the file (Forbidden)'
  if (/^chrome-SERVER_/.test(code)) return 'TikTok answered with an error'
  if (/^chrome-NETWORK_/.test(code)) return 'the connection to TikTok failed'
  if (code === 'chrome-too-small' || code === 'page-not-a-video') return 'TikTok sent a page instead of the video'
  if (/^chrome-start/.test(code)) return 'Chrome would not start the download'
  if (code === 'page-fetch-blocked') return 'TikTok\u2019s page could not read its own file'
  if (/^page-http-40[13]$/.test(code)) return 'TikTok refused the file to its own page'
  if (code === 'page-no-download') return 'Chrome did not save it (if Chrome is set to ask where to save each file, that window opens out of sight)'
  if (code === 'page-fetch-timeout') return 'TikTok took too long to send it'
  return code
}
/** Every way SCOUT tried, in words, with its codes for the team. */
function triedWords(tried: Array<{ way: string; result: string }> | undefined): string | null {
  if (!tried?.length) return null
  const by = new Map<string, string>()
  for (const t of tried) if (t.result !== 'ok' && !by.has(t.way)) by.set(t.way, tryWords(t.result))
  const parts = Array.from(by.entries()).map(([way, w]) => `${way === 'chrome' ? 'Through Chrome' : 'From TikTok\u2019s page'}: ${w}.`)
  const codes = Array.from(new Set(tried.map((t) => t.result))).join(', ')
  return `${parts.join(' ')} (${codes})`
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'brand'
const fileFor = (brand: string, v: { id: string; postedAt: string | null }) => `${slug(brand)}-${v.postedAt ? v.postedAt.slice(0, 10) : 'tiktok'}-${v.id}`

/** Save one video to the creator's Downloads through SCOUT; says what happened.
 *  SCOUT 1.60.2 also says how far it is (onProgress), and when Chrome asks
 *  where to save, the creator is told to choose a folder. */
async function downloadVideo(handle: string, brand: string, v: { id: string; postedAt: string | null }, openUpload?: () => void, onProgress?: (words: string) => void): Promise<boolean> {
  let told = false
  const r = await requestTikTokDownload(handle, v.id, fileFor(brand, v), (p) => {
    onProgress?.(progressWords(p))
    if (p.asking && !told) {
      told = true
      toast.info('Chrome is asking where to save the video: choose a folder in Chrome\u2019s Save window. Chrome asks because \u201CAsk where to save each file before downloading\u201D is on in its Downloads settings.', { duration: 15000 })
    }
  })
  if (r.ok) {
    const mb = r.bytes ? ` (${(r.bytes / 1_048_576).toFixed(1)} MB)` : ''
    const file = (r.file || `${fileFor(brand, v)}.mp4`).split(/[\\/]/).pop()
    toast.success(`Saved to your Downloads: ${file}${mb}`, openUpload ? { duration: 10000, action: { label: 'Upload to TRYBE', onClick: openUpload } } : undefined)
    return true
  }
  const tried = r.state === 'old' ? null : triedWords(r.tried)
  const came = r.bytes ? ` ${mb(r.bytes)} MB${r.total ? ` of ${mb(r.total)} MB` : ''} had come in.` : ''
  const base = r.state === 'old' ? `${r.error} Chrome updates SCOUT by itself within a day.`
    : r.error === 'too-slow' ? `Not saved: SCOUT ran out of time while ${STEP_WORDS[r.step || ''] || 'saving it'}.${came}`
      : r.error === 'not-saved' && tried ? 'Not saved.'
        : (r.error && DL_WORDS[r.error]) || `Not saved: ${r.error || 'SCOUT did not say why'}.`
  const why = tried ? `${base} ${tried}` : base
  toast.error(why, { duration: 12000 })
  return false
}

/** The product these videos show, for scripts: a TikTok Shop tag's title, else
 *  the product the caption named, else null (Brand scripts uses the brief). */
function productOf(m: Match, videos: Record<string, Video>): string | null {
  for (const id of m.videoIds) for (const p of videos[id]?.products || []) if (p.title) return p.title
  const named = m.how.find((h) => h.kind === 'product')?.text.match(/\u201C([^\u201D]+)\u201D/)
  return named ? named[1] : null
}

function MatchCard({ m, videos, brand, picked, onPick, scoutOpens, actions }: { m: Match; videos: Record<string, Video>; brand?: { website: string | null; requested: string | null }; picked: boolean; onPick: (on: boolean) => void; scoutOpens: boolean; actions: MatchActions }) {
  const [busy, setBusy] = useState<'request' | 'send' | null>(null)
  // Each video's download: running, saved, or failed.
  const [dl, setDl] = useState<Record<string, 'busy' | 'done' | 'failed'>>({})
  const [dlAll, setDlAll] = useState<{ done: number; of: number; id: string } | null>(null)
  // How far each running download is, in words (SCOUT 1.60.2 says).
  const [dlNow, setDlNow] = useState<Record<string, string>>({})
  const saveOne = async (v: { id: string; postedAt: string | null }) => {
    setDl((d) => ({ ...d, [v.id]: 'busy' }))
    const ok = await downloadVideo(actions.handle, m.name, v, actions.openUpload, (w) => setDlNow((n) => (n[v.id] === w ? n : { ...n, [v.id]: w })))
    setDl((d) => ({ ...d, [v.id]: ok ? 'done' : 'failed' }))
    setDlNow((n) => { const { [v.id]: _gone, ...rest } = n; void _gone; return rest })
    return ok
  }
  const saveAll = async () => {
    const all = m.videoIds.map((id) => videos[id] ?? { id, postedAt: null })
    for (let i = 0; i < all.length; i++) {
      setDlAll({ done: i, of: all.length, id: all[i].id })
      // One failed download stops the rest: the reason is said once, not for every video.
      if (!(await saveOne(all[i]))) break
    }
    setDlAll(null)
  }
  const status = brand?.requested ?? null
  const asked = status ? ASKED[status] || 'On your TRYBE list' : null
  const gone = !!status && GONE.has(status)
  const drafted = status === 'drafted'
  const run = async (kind: 'request' | 'send', fn: () => Promise<void>) => { setBusy(kind); try { await fn() } finally { setBusy(null) } }
  const btn = 'rounded-lg px-3 py-1.5 text-[12.5px] font-bold inline-flex items-center gap-1.5 disabled:opacity-50'
  const joined = m.joinedTrybeAt && Date.now() - Date.parse(m.joinedTrybeAt) < 30 * 86_400_000 ? day(m.joinedTrybeAt) : null
  const vids = m.videoIds.map((id) => videos[id]).filter(Boolean).slice(0, 4)
  return (
    <div className="min-w-0 rounded-xl border p-3 sm:p-3.5 flex items-start gap-2.5 sm:gap-3" style={{ borderColor: picked ? ACCENT : 'var(--border)' }}>
      <input type="checkbox" className="mt-3 accent-[#7C3AED]" checked={picked} disabled={!!asked} onChange={(e) => onPick(e.target.checked)} aria-label={`Pick ${m.name}`} />
      <BrandMark name={m.name} website={brand?.website ?? null} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <BrandName id={m.brandId} name={m.name} className="text-[15px] font-semibold" />
          <span className={`text-[11.5px] font-bold rounded-full px-2 py-0.5 cursor-help ${SURE_CLS[m.sureness]}`} title={SURENESS_WORDS[m.sureness].says}>{SURENESS_WORDS[m.sureness].label}</span>
          <span className="text-[12px]" style={soft}>{m.videoIds.length} {m.videoIds.length === 1 ? 'video' : 'videos'}</span>
          {joined && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-[rgba(124,58,237,0.14)] text-[#6D28D9] dark:text-[#C4B5FD]">Joined TRYBE {joined}</span>}
          {asked && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>{asked}</span>}
          <TrybeLink brandId={m.brandId} name={m.name} scout={scoutOpens} />
        </div>
        <ul className="mt-1.5 space-y-0.5">
          {m.how.slice(0, 3).map((h, i) => {
            const Icon = KIND_ICON[h.kind]
            return <li key={i} className="text-[12.5px] flex items-start gap-1.5" style={{ color: 'var(--text-2)' }}><Icon size={12} className="mt-[3px] shrink-0" style={soft} /><span>{h.text}{(h.count ?? 1) > 1 ? ` (${h.count} videos)` : ''}</span></li>
          })}
        </ul>
        {vids.length > 0 && (
          <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1">
            {vids.map((v) => (
              <div key={v.id} className="shrink-0 w-[104px] rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                <a href={v.url} target="_blank" rel="noopener noreferrer" className="block group" title={v.caption || 'Watch on TikTok'}>
                  <span className="block w-full aspect-[9/16] relative" style={{ background: 'var(--surface-2)' }}>
                    {v.cover && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.cover} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    )}
                    {v.views != null && <span className="absolute left-1 bottom-1 text-[10.5px] font-bold rounded px-1 inline-flex items-center gap-0.5" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}><Eye size={10} />{compact(v.views)}</span>}
                  </span>
                  <span className="block px-1.5 pt-1 text-[10.5px] leading-tight">
                    <span className="font-semibold inline-flex items-center gap-0.5 whitespace-nowrap text-[10px] group-hover:underline" style={{ color: ACCENT }}>Watch on TikTok <ExternalLink size={9} /></span>
                    {v.postedAt && <span className="block" style={soft}>{day(v.postedAt)}</span>}
                  </span>
                </a>
                <button type="button" onClick={() => void saveOne(v)} disabled={dl[v.id] === 'busy' || !!dlAll}
                  className="w-full px-1.5 pb-1.5 pt-0.5 text-left text-[10.5px] font-semibold inline-flex items-center gap-1 disabled:opacity-60 hover:underline"
                  style={{ color: dl[v.id] === 'failed' ? AMBER : 'var(--text)' }} title="Save this video to your Downloads folder, to upload it to TRYBE">
                  {dl[v.id] === 'busy' ? <Loader2 size={11} className="animate-spin" /> : dl[v.id] === 'done' ? <Check size={11} /> : <Download size={11} />}
                  {dl[v.id] === 'busy' ? (dlNow[v.id] || 'Saving') : dl[v.id] === 'done' ? 'Saved' : dl[v.id] === 'failed' ? 'Try again' : 'Download'}
                </button>
              </div>
            ))}
            {m.videoIds.length > vids.length && <span className="self-center text-[12px] shrink-0" style={soft}>and {m.videoIds.length - vids.length} more</span>}
          </div>
        )}
        {/* RIGHT FROM THE MATCH (Seb, 2026-11-09: "is there a direct way right
            there to request partnership with the brand and then also create
            scripts all from there?"). */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {!gone && !drafted && (
            <button type="button" onClick={() => void run('request', () => actions.request(m.brandId))} disabled={!!busy} className={btn} style={{ background: ACCENT, color: '#fff' }}
              title="MVP writes your request from your core message and adds a line with your TikTok video of this brand. It waits in Ready to send for you to read or send.">
              {busy === 'request' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Request partnership
            </button>
          )}
          {drafted && actions.send && (
            <button type="button" onClick={() => void run('send', () => actions.send!(m.brandId))} disabled={!!busy || !!actions.sendBlocked} title={actions.sendBlocked || 'SCOUT sends it on TRYBE now, under your daily limit.'} className={btn} style={{ background: ACCENT, color: '#fff' }}>
              {busy === 'send' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send request now
            </button>
          )}
          {drafted && actions.openQueue && (
            <button type="button" onClick={actions.openQueue} className="text-[12.5px] font-semibold underline" style={{ color: ACCENT }}>Read it first in Ready to send</button>
          )}
          {actions.handle && (
            <button type="button" onClick={() => void saveAll()} disabled={!!dlAll} className={`${btn} border`} style={{ borderColor: 'var(--border-2)', color: 'var(--text)' }}
              title="Save every video of this brand to your Downloads folder, one after another, to upload them to TRYBE">
              {dlAll ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {dlAll ? `Saving ${dlAll.done + 1} of ${dlAll.of}${dlNow[dlAll.id] ? `: ${dlNow[dlAll.id]}` : ''}` : m.videoIds.length > 1 ? `Download all ${m.videoIds.length} videos` : 'Download the video'}
            </button>
          )}
          {actions.scripts && (
            <button type="button" onClick={() => actions.scripts!(m.brandId, m.name, productOf(m, videos))} className={`${btn} border`} style={{ borderColor: 'var(--border-2)', color: 'var(--text)' }}
              title="Brand scripts for this brand from its TRYBE brief. Before it accepts you, write them from its product in Video Scripts.">
              <Clapperboard size={13} /> Write scripts
            </button>
          )}
          {drafted && actions.sendBlocked && <span className="text-[12px]" style={{ color: AMBER }}>{actions.sendBlocked}</span>}
        </div>
      </div>
    </div>
  )
}
