// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// StorefrontStage — the Amazon geos step. One master video, localized for every
// Amazon marketplace the creator sells in (title + description per market in
// their voice), with an optional dub in their own cloned voice. Used inside
// Launchpad (with a preset video) and on the standalone Storefront Sync page
// (with its own picker).
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { Globe, Loader2, Check, Circle, Mic, Play, Upload, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import { requestStorefrontDelivery, requestStorefrontPreflight, requestStorefrontLogin, requestStorefrontDebug, getScoutStatus, type StorefrontMarketStatus } from '@/lib/extension-frame'
import { SCOUT_LATEST_VERSION } from '@/lib/scout-version'
import { asinFromAmazonUrl } from '@/lib/product-link'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Bare ASIN or Amazon product link → the clean 10-character code, or null. */
function normalizeAsin(v: string): string | null {
  const s = (v || '').trim()
  if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase()
  return asinFromAmazonUrl(s)
}

/** -1 / 0 / 1 dotted-version compare; a null/unknown left side sorts oldest. */
function cmpVer(a: string | null | undefined, b: string): number {
  if (!a) return -1
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

interface Vid { id: string; title: string; thumbnail_url: string | null }
interface Market { domain: string; code: string; country: string; langName: string; needsTranslation: boolean }
interface Target { domain: string; market: string; country: string; lang: string; dub: boolean; title: string | null; description: string | null; state: string; detail: string | null; videoUrl: string | null }

const label = { color: 'var(--text)' } as const
const muted = { color: 'var(--text-2)' } as const

/** presetVideoId: when set, the stage syncs THAT video and hides its own picker
 *  (Launchpad passes the already-picked video). */
export default function StorefrontStage({ presetVideoId, presetAsin, allowedDomains, defaultChosen, geoBadges, marketAsins, presetThumbnailUrl }: {
  presetVideoId?: string | null
  presetAsin?: string | null
  /** Video Launchpad restricts to a subset of marketplaces (Phase 1: the English
   *  geos). When set, only these domains are shown/selectable. */
  allowedDomains?: string[] | null
  /** Which of the allowed domains start checked (Phase 1: the ones the product
   *  was found in). Omit to check all. */
  defaultChosen?: string[] | null
  /** Optional per-domain status label ("Product found" / "Not confirmed"), shown
   *  as a small badge so the creator can decide. */
  geoBadges?: Record<string, string> | null
  /** Per-domain LOCAL ASIN override (Video Launchpad resolves a different ASIN in
   *  a market where the source one isn't listed). Merged with any the creator
   *  pastes by hand; sent to /start so each market delivers against its own code. */
  marketAsins?: Record<string, string> | null
  /** A thumbnail the caller already generated (Launchpad's YouTube step). Used so
   *  the upload's thumbnail gate passes immediately and each storefront gets it,
   *  instead of waiting on the background render. */
  presetThumbnailUrl?: string | null
}) {
  const [videos, setVideos] = useState<Vid[]>([])
  const [markets, setMarkets] = useState<Market[]>([])
  const [loading, setLoading] = useState(!presetVideoId)
  const [picked, setPicked] = useState<string | null>(presetVideoId || null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [asin, setAsin] = useState(presetAsin || '')
  // ASINs the creator pasted by hand for a market where the source ASIN isn't
  // listed and SCOUT found no confident local match. Merged over `marketAsins`.
  const [manualAsins, setManualAsins] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [targets, setTargets] = useState<Target[]>([])
  const [dubbing, setDubbing] = useState<string | null>(null)
  // Non-English markets the creator chose to deliver WITHOUT a dub (English audio
  // on purpose). Domains in here are skipped by the auto-dub and delivered with
  // the master video.
  const [skipDub, setSkipDub] = useState<Set<string>>(new Set())
  const [delivering, setDelivering] = useState(false)
  // Current phase label for the one-click Upload flow (sign-in → dub → thumbnail → upload).
  const [phase, setPhase] = useState<string | null>(null)
  // Per-marketplace sign-in / enrollment status from the SCOUT pre-flight.
  const [signin, setSignin] = useState<Record<string, StorefrontMarketStatus>>({})
  // Installed SCOUT version — surfaced so a stale build (the #1 cause of a
  // repeated upload failure after a fix ships) is obvious, not a guess.
  const [scout, setScout] = useState<{ installed: boolean; version: string | null } | null>(null)
  useEffect(() => { getScoutStatus().then(setScout).catch(() => setScout({ installed: false, version: null })) }, [])
  const scoutStale = !!scout && scout.installed && cmpVer(scout.version, SCOUT_LATEST_VERSION) < 0
  // Check sign-in for every shown marketplace as soon as SCOUT + the market list
  // are known, so the badges are REAL from the start instead of every store
  // reading "Log in" until the creator hits Upload.
  const [signinChecked, setSigninChecked] = useState(false)
  useEffect(() => {
    if (signinChecked || !scout?.installed || markets.length === 0) return
    let cancelled = false
    ;(async () => {
      try { await runPreflight(markets.map(m => m.domain), true) } catch { /* badges stay neutral */ }
      if (!cancelled) setSigninChecked(true)
    })()
    return () => { cancelled = true }
    // runPreflight is a stable function declaration inside this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scout?.installed, markets, signinChecked])

  const [voice, setVoice] = useState<{ enabled: boolean; hasVoice: boolean; name: string | null; credits: number | null } | null>(null)
  const [consent, setConsent] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [buying, setBuying] = useState(false)
  // Optional: use the cloned voice (costs a credit) or the free generic voice.
  const [useMyVoice, setUseMyVoice] = useState(false)
  useEffect(() => { if (voice?.hasVoice) setUseMyVoice(true) }, [voice?.hasVoice])

  useEffect(() => { if (presetVideoId) setPicked(presetVideoId) }, [presetVideoId])

  const load = useCallback(async () => {
    try {
      const [mr, vr] = await Promise.all([
        fetch('/api/global-sync/markets').then(r => r.json()).catch(() => ({})),
        fetch('/api/voice-clone/status').then(r => r.json()).catch(() => ({})),
      ])
      if (Array.isArray(mr?.markets)) {
        // Video Launchpad restricts to a subset (the English geos in Phase 1).
        const mkts = Array.isArray(allowedDomains) && allowedDomains.length
          ? mr.markets.filter((m: Market) => allowedDomains.includes(m.domain))
          : mr.markets
        setMarkets(mkts)
        // Default selection: the caller's list (Phase 1: the geos the product was
        // found in), else every shown storefront. The creator can toggle any.
        const initial = Array.isArray(defaultChosen)
          ? mkts.filter((m: Market) => defaultChosen.includes(m.domain)).map((m: Market) => m.domain)
          : mkts.map((m: Market) => m.domain)
        setChosen(new Set(initial))
      }
      if (vr?.ok) setVoice({ enabled: !!vr.enabled, hasVoice: !!vr.hasVoice, name: vr.name || null, credits: typeof vr.credits === 'number' ? vr.credits : null })
      if (!presetVideoId) {
        const sb = createBrowserClient()
        const { data: { user } } = await sb.auth.getUser()
        if (user) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data } = await (sb as any)
            .from('youtube_videos').select('id,title,thumbnail_url')
            .eq('user_id', user.id).order('published_at', { ascending: false, nullsFirst: false }).limit(18)
          setVideos(Array.isArray(data) ? data : [])
        }
      }
    } catch { /* ignore */ } finally { setLoading(false) }
    // allowedDomains/defaultChosen are computed once (from the geo-check) before
    // this stage mounts, so they're read at load time without re-running the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetVideoId])
  useEffect(() => { load() }, [load])

  const toggleMarket = (domain: string) => setChosen(prev => {
    const next = new Set(prev); next.has(domain) ? next.delete(domain) : next.add(domain); return next
  })

  // The ASIN a given market delivers against: a hand-pasted one wins, else the
  // page-resolved local ASIN, else the base (US) ASIN.
  const baseAsin = normalizeAsin(asin)
  const asinFor = (domain: string) => (manualAsins[domain] || (marketAsins && marketAsins[domain]) || baseAsin || '').trim().toUpperCase()
  // A chosen market that isn't confirmed under the base ASIN and has no resolved
  // or pasted local ASIN yet — the creator can paste one.
  const needsLocalAsin = (domain: string) =>
    geoBadges?.[domain] === 'Not listed here' && !(marketAsins && marketAsins[domain]) && !manualAsins[domain]

  // Localize the chosen markets. Returns the job + its settled status so the
  // one-click Upload can chain straight into delivery. `quiet` skips the
  // standalone toasts when running as part of that chain.
  async function start(quiet = false): Promise<{ jobId: string; status: string } | null> {
    if (!picked) { toast.error('Pick a master video first'); return null }
    if (chosen.size === 0) { toast.error('Pick at least one marketplace'); return null }
    if (!baseAsin) { toast.error('Enter a valid product ASIN (or paste the Amazon product link) — MVP needs it to build each market’s title and thumbnail'); return null }
    setRunning(true); setTargets([]); setJobId(null)
    try {
      // Per-market ASIN overrides for the chosen markets that differ from the base.
      const overrides: Record<string, string> = {}
      for (const domain of chosen) {
        const a = asinFor(domain)
        if (a && a !== baseAsin) overrides[domain] = a
      }
      const r = await fetch('/api/global-sync/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: picked, markets: Array.from(chosen), asin: baseAsin, marketAsins: Object.keys(overrides).length ? overrides : undefined }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.jobId) throw new Error(j.error || 'Could not start the sync')
      setJobId(j.jobId)
      // Poll until the job settles. Report the REAL outcome — the old code said
      // "localized" even when the job failed or was still running at the timeout.
      let finalStatus: string = 'localizing'
      for (let i = 0; i < 40; i++) {
        await sleep(3000)
        const jr = await fetch(`/api/global-sync/${j.jobId}`).then(x => x.json()).catch(() => ({}))
        if (Array.isArray(jr?.targets)) setTargets(jr.targets)
        if (jr?.status === 'done' || jr?.status === 'failed') { finalStatus = jr.status; break }
      }
      if (!quiet) {
        if (finalStatus === 'done') toast.success('Storefronts localized. Review each market’s copy, then upload.')
        else if (finalStatus === 'failed') toast.error('Localizing failed for this sync. Try again.')
        else toast('Still localizing in the background — the markets will fill in here as they finish.')
      }
      return { jobId: j.jobId as string, status: finalStatus }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the sync')
      return null
    } finally { setRunning(false) }
  }

  async function refreshVoice() {
    const vr = await fetch('/api/voice-clone/status').then(r => r.json()).catch(() => ({}))
    if (vr?.ok) setVoice({ enabled: !!vr.enabled, hasVoice: !!vr.hasVoice, name: vr.name || null, credits: typeof vr.credits === 'number' ? vr.credits : null })
  }
  async function cloneVoice() {
    if (!consent) { toast.error('Please confirm you have the right to clone this voice'); return }
    setCloning(true)
    try {
      const r = await fetch('/api/voice-clone/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Voice cloning failed')
      await refreshVoice()
      toast.success('Your voice is ready. New dubs will sound like you.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Voice cloning failed') } finally { setCloning(false) }
  }
  async function removeVoice() {
    setCloning(true)
    try { await fetch('/api/voice-clone/delete', { method: 'POST' }); await refreshVoice(); setConsent(false); toast.success('Cloned voice removed') }
    catch { /* ignore */ } finally { setCloning(false) }
  }
  async function buyCredits(block: '50' | '150' | '500') {
    setBuying(true)
    try {
      const r = await fetch('/api/stripe/credits-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ block }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.url) throw new Error(j.error || 'Could not start checkout')
      window.location.href = j.url
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not start checkout'); setBuying(false) }
  }

  // Returning from a successful credit purchase.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search).get('credits')
    if (p === 'ok') { toast.success('Credits added to your account.'); void refreshVoice(); window.history.replaceState({}, '', window.location.pathname) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ask SCOUT which marketplaces the creator is signed in + enrolled on. Returns
  // the domain→status map (also stored in state for the per-market badges).
  // Returns the domain→status map; `null` when SCOUT isn't installed (so callers
  // stop instead of proceeding and hitting a second "can't reach SCOUT" error).
  // `quiet` suppresses the toast for the automatic background check on load.
  async function runPreflight(domains: string[], quiet = false): Promise<Record<string, StorefrontMarketStatus> | null> {
    const res = await requestStorefrontPreflight(domains)
    if (!res.ok) {
      if (!quiet) {
        toast.error(res.error === 'not-installed'
          ? 'Install SCOUT (and sign in to Amazon) to upload to your storefronts.'
          : (res.error || 'Could not check your sign-in status.'))
      }
      return res.error === 'not-installed' ? null : {}
    }
    const map: Record<string, StorefrontMarketStatus> = {}
    for (const r of (res.results || [])) map[r.domain] = r.status
    setSignin(prev => ({ ...prev, ...map }))
    return map
  }

  // Standalone "Check sign-in" — preflight the localized markets without uploading.
  // Open one marketplace's Creator Hub in a new tab so the creator can sign in.
  async function signInMarket(domain: string, country: string) {
    const res = await requestStorefrontLogin(domain)
    if (!res.ok) { toast.error(res.error === 'not-installed' ? 'Install SCOUT first.' : 'Could not open the sign-in page.'); return }
    toast(`Opened ${country} in a new tab. Sign in there, then hit Upload again.`)
  }

  // Open a Creator Hub tab for EVERY selected store that isn't confirmed signed in,
  // so the creator can log in to each one and MVP can re-check before uploading.
  // Returns how many tabs opened.
  async function openSignInTabs(domains: string[]): Promise<number> {
    let opened = 0
    for (const d of domains) {
      const res = await requestStorefrontLogin(d)
      if (res.ok) opened++
      else if (res.error === 'not-installed') { toast.error('Install SCOUT first.'); break }
    }
    return opened
  }

  // Re-run the sign-in check for the selected stores (after the creator logged in).
  const [rechecking, setRechecking] = useState(false)
  async function recheckSignin() {
    setRechecking(true)
    try {
      const map = await runPreflight(markets.filter(m => chosen.has(m.domain)).map(m => m.domain))
      if (map) {
        const still = Object.entries(map).filter(([, s]) => s !== 'ready').length
        if (still === 0) toast.success('Signed in on every selected store.')
        else toast(`${still} ${still === 1 ? 'store still needs' : 'stores still need'} a sign-in.`)
      }
    } finally { setRechecking(false) }
  }

  // Selected stores whose sign-in isn't confirmed (only meaningful once checked).
  const notReadyChosen = markets.filter(m => chosen.has(m.domain) && signin[m.domain] !== 'ready')

  // Put every failure detail AND what Amazon's own Creator Hub sends on the
  // clipboard, so a rejected publish can be diagnosed from one paste.
  const [copyingDiag, setCopyingDiag] = useState(false)
  async function copyDiagnostic() {
    setCopyingDiag(true)
    try {
      const log = await requestStorefrontDebug()
      const report = [
        `SCOUT v${scout?.version || '?'} · ${new Date().toISOString()}`,
        '',
        'MVP upload results:',
        ...targets.map(t => `  ${t.country} (${t.domain}) — ${t.state}${t.detail ? `: ${t.detail}` : ''}`),
        '',
        log.length === 0
          ? 'Amazon Creator Hub calls captured: none yet. Publish one video by hand in the Creator Hub, then copy this again.'
          : `Amazon Creator Hub calls captured (${log.length}):`,
        ...log.map(e => `\n--- ${e.method} ${e.url} → ${e.status}\nREQUEST: ${e.request || '(none)'}\nRESPONSE: ${e.response}`),
      ].join('\n')
      await navigator.clipboard.writeText(report)
      toast.success(log.length === 0
        ? 'Copied. Publish one video by hand in the Creator Hub first, then copy again so we get Amazon’s own request.'
        : `Copied the diagnostic, including ${log.length} of Amazon’s own calls.`)
    } catch {
      toast.error('Could not copy the diagnostic.')
    } finally { setCopyingDiag(false) }
  }

  // `jobIdArg` lets the one-click Upload pass the job it just created, before
  // React state has caught up.
  async function deliverAll(jobIdArg?: string) {
    const jid = jobIdArg || jobId
    if (!jid) return
    setDelivering(true)
    try {
      // ── 1) SIGN-IN CHECK FIRST ────────────────────────────────────────────
      // Confirm which marketplaces the creator is signed in + enrolled on before
      // anything else, so we never spend minutes dubbing a market we can't reach.
      setPhase('Checking sign-in…')
      const preMap = await runPreflight(targets.map(t => t.domain))
      if (preMap === null) return // SCOUT not installed — already told the creator; don't stack a second error
      const preKnown = Object.keys(preMap).length > 0
      const readyDomains = new Set(
        preKnown ? targets.filter(t => preMap[t.domain] === 'ready').map(t => t.domain) : targets.map(t => t.domain),
      )
      // Blocked markets are flagged on their own cards by the sign-in badge that
      // runPreflight just set (not signed in / not enrolled / unconfirmed).
      const blocked = preKnown ? targets.filter(t => preMap[t.domain] !== 'ready') : []
      if (readyDomains.size === 0) {
        await refreshTargets(jid)
        // Open every store so the creator can sign in right away, not hunt for links.
        await openSignInTabs(targets.map(t => t.domain))
        toast.error('You’re not signed in to any of these marketplaces yet. Sign in on the tabs that just opened, then hit Upload again.')
        return
      }
      // Some stores aren't signed in: open a tab for each so the creator can log in
      // now, and ask whether to upload to the ready ones in the meantime. Nothing is
      // silently skipped.
      if (blocked.length > 0) {
        setPhase('Opening stores to sign in…')
        await openSignInTabs(blocked.map(t => t.domain))
        const names = blocked.map(t => t.country || t.domain).join(', ')
        const goOn = typeof window !== 'undefined' && window.confirm(
          `${blocked.length === 1 ? 'This store isn’t' : 'These stores aren’t'} signed in: ${names}.\n\nMVP opened ${blocked.length === 1 ? 'its Amazon tab' : 'a tab for each'} so you can log in. Upload to the ${readyDomains.size} signed-in ${readyDomains.size === 1 ? 'store' : 'stores'} now and come back for the rest?\n\nCancel to sign in first and upload everything together.`,
        )
        if (!goOn) { toast('Sign in on the opened tabs, then hit Upload again.'); return }
      }

      // ── 2) DUB the ready markets that still need it ───────────────────────
      // A non-English market with no dub yet is voiced in its own language first,
      // so no storefront ships English audio under a translated title. Only dub
      // markets we'll actually upload to. Best-effort: a failed dub falls back to
      // the master video.
      const needDub = targets.filter(t => t.dub && !t.videoUrl && !skipDub.has(t.domain) && readyDomains.has(t.domain))
      if (needDub.length > 0) {
        const useClone = !!(voice?.hasVoice && useMyVoice)
        setPhase(`Dubbing ${needDub.length} ${needDub.length === 1 ? 'market' : 'markets'}…`)
        toast(`Preparing ${needDub.length} ${needDub.length === 1 ? 'dub' : 'dubs'} first — this can take a couple of minutes each.`)
        for (const t of needDub) {
          setDubbing(t.domain)
          try {
            await fetch('/api/global-sync/dub', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jobId: jid, domain: t.domain, voice: useClone ? 'cloned' : 'standard' }),
            })
          } catch { /* fall back to the master video for this market */ }
        }
        setDubbing(null)
        await refreshTargets(jid)
        if (useClone) void refreshVoice()
      }

      // ── 3) THUMBNAIL — make sure one can be ported ────────────────────────
      setPhase('Getting the thumbnail…')
      const loadQueue = async () => {
        const q = await fetch(`/api/global-sync/deliver/queue?jobId=${jid}`).then(r => r.json()).catch(() => ({}))
        const arr = Array.isArray(q?.items) ? q.items : []
        // Honor "skip dub": deliver the English master to those markets even if a
        // dub was generated earlier. Only keep markets we're signed in on.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return arr.map((i: any) => (skipDub.has(i.domain) && i.masterUrl) ? { ...i, videoUrl: i.masterUrl } : i)
          .filter((i: { domain: string }) => readyDomains.has(i.domain))
      }
      let items = await loadQueue()
      if (items.length === 0) { toast('Nothing to upload yet — localize the markets first.'); return }
      // A thumbnail the caller already made (Launchpad's YouTube step) counts —
      // fill it into any item the server queue didn't have one for so the gate
      // passes immediately instead of waiting on the background render.
      if (presetThumbnailUrl) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items = items.map((i: any) => i.thumbnailUrl ? i : { ...i, thumbnailUrl: presetThumbnailUrl })
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasThumb = (arr: any[]) => !!presetThumbnailUrl || arr.some((i: { thumbnailUrl?: string | null }) => !!i.thumbnailUrl)
      if (!hasThumb(items)) {
        for (let i = 0; i < 24 && !hasThumb(items); i++) { await sleep(5000); items = await loadQueue() }
        if (!hasThumb(items)) {
          const go = typeof window !== 'undefined' && window.confirm(
            'Your branded thumbnail is still rendering. Upload now and let Amazon use a frame from the video instead?\n\nClick Cancel to wait a bit longer and try again.',
          )
          if (!go) { toast('Held off — try again once the thumbnail has finished rendering.'); return }
        }
      }

      // ── 4) UPLOAD to the ready geos ───────────────────────────────────────
      setPhase('Uploading…')
      toast(blocked.length > 0
        ? `Uploading to ${items.length} ready ${items.length === 1 ? 'market' : 'markets'}. ${blocked.length} skipped (not signed in / not enrolled).`
        : 'Uploading to your storefronts… keep this tab open.')

      const res = await requestStorefrontDelivery(items)
      if (!res.ok && !res.results) { toast.error(res.error || 'Could not reach SCOUT.'); return }
      // Report each outcome so the UI shows delivery state. A duplicate is not a
      // failure — the video is already on that storefront — so mark it present
      // (green) with a clear note instead of an error, and don't create a copy.
      for (const r of (res.results || [])) {
        const isDup = !r.ok && r.duplicate
        await fetch('/api/global-sync/deliver/result', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetId: r.targetId,
            ok: r.ok || isDup,
            detail: isDup ? 'Already on this storefront — skipped duplicate' : (r.ok ? 'Uploaded to storefront' : (r.error || 'Upload failed')),
          }),
        }).catch(() => {})
      }
      await refreshTargets(jid)
      const results = res.results || []
      const done = results.filter(r => r.ok).length
      const dups = results.filter(r => !r.ok && r.duplicate).length
      toast.success(`Uploaded to ${done} of ${results.length} storefronts${dups > 0 ? ` · ${dups} already there` : ''}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Storefront upload failed')
    } finally { setDelivering(false); setPhase(null); setDubbing(null) }
  }

  async function refreshTargets(jobIdArg?: string) {
    const jid = jobIdArg || jobId
    if (!jid) return
    const jr = await fetch(`/api/global-sync/${jid}`).then(x => x.json()).catch(() => ({}))
    if (Array.isArray(jr?.targets)) setTargets(jr.targets)
  }
  // ONE click: localize (title + description per market), then dub what needs it
  // and upload — the least-friction path. Reviewing the localized copy is
  // optional: it appears below as it lands and stays there afterwards.
  async function uploadAll() {
    setPhase('Localizing…')
    const res = await start(true)
    if (!res) { setPhase(null); return }
    if (res.status !== 'done') {
      setPhase(null)
      toast.error(res.status === 'failed'
        ? 'Localizing failed — hit Upload again to retry.'
        : 'Still localizing — give it a moment, then hit Upload again.')
      return
    }
    await deliverAll(res.jobId)
  }

  async function dubOne(domain: string) {
    if (!jobId) return
    setDubbing(domain)
    try {
      const r = await fetch('/api/global-sync/dub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId, domain, voice: voice?.hasVoice && useMyVoice ? 'cloned' : 'standard' }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Dub failed')
      await refreshTargets()
      const base = j.note === 'voiceover_only' ? 'Voiceover ready' : j.voice === 'cloned' ? 'Dubbed in your voice' : 'Dub ready'
      if (j.voice === 'cloned' && typeof j.clonedDubsRemaining === 'number') {
        toast.success(`${base} · ${j.clonedDubsRemaining} your-voice credits left`)
      } else if (j.outOfCredits) {
        toast.success(`${base} · out of your-voice credits, standard voice used`)
      } else {
        toast.success(base)
      }
      if (j.voice === 'cloned' || j.outOfCredits) void refreshVoice()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Dub failed'); await refreshTargets() } finally { setDubbing(null) }
  }

  return (
    <div className="space-y-5">
      {/* Sounds like you — cloned voice for dubs */}
      {/* Dub voice — collapsed to one line. Free generic voice is the default; the
          cloned-voice upgrade (credits) lives behind "change" so it never clutters
          the fast path. */}
      {voice?.enabled && (
        <details className="card p-4 group" style={{ background: 'rgba(14,165,164,0.04)' }}>
          <summary className="flex items-center gap-2 cursor-pointer list-none text-[12px]" style={muted}>
            <Mic size={14} style={{ color: '#0EA5A4' }} />
            <span>Dub voice: <span className="font-medium" style={label}>{voice.hasVoice && useMyVoice ? 'your own voice (1 credit per market)' : 'free generic voice'}</span></span>
            <span className="ml-auto underline">change</span>
          </summary>
          <div className="mt-3">
          {voice.hasVoice ? (
            <div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Mic size={15} style={{ color: '#0EA5A4' }} />
                  <span className="text-sm" style={label}>Your voice is ready{voice.name ? ` (from “${voice.name}”)` : ''}. Choose how dubs sound:</span>
                </div>
                <button type="button" onClick={() => void removeVoice()} disabled={cloning} className="text-[12px] underline disabled:opacity-60" style={muted}>Remove</button>
              </div>
              {/* Optional: my voice (credits) vs generic (free) */}
              <div className="inline-flex rounded-lg border overflow-hidden mt-2.5" style={{ borderColor: 'var(--border)' }}>
                <button type="button" onClick={() => setUseMyVoice(true)}
                  className="px-3 py-1.5 text-[12px] font-medium"
                  style={{ background: useMyVoice ? 'rgba(14,165,164,0.12)' : 'transparent', color: useMyVoice ? '#0EA5A4' : 'var(--text-2)' }}>
                  My voice (1 credit)
                </button>
                <button type="button" onClick={() => setUseMyVoice(false)}
                  className="px-3 py-1.5 text-[12px] font-medium"
                  style={{ background: !useMyVoice ? 'rgba(14,165,164,0.12)' : 'transparent', color: !useMyVoice ? '#0EA5A4' : 'var(--text-2)' }}>
                  Generic voice (free)
                </button>
              </div>
              <p className="text-[12px] mt-1.5" style={muted}>
                {useMyVoice
                  ? <>Each non-English dub narrates in your voice and uses 1 credit.{typeof voice.credits === 'number' ? <> {voice.credits} left this month.</> : <> Unlimited on your plan.</>}</>
                  : <>Dubs use a clean generic voice, free and unlimited. Your credits are untouched.</>}
              </p>
              {useMyVoice && typeof voice.credits === 'number' && (
                <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                  <span className="text-[12px]" style={muted}>Top up:</span>
                  {([['50', '$29'], ['150', '$69'], ['500', '$199']] as const).map(([b, price]) => (
                    <button key={b} type="button" onClick={() => void buyCredits(b)} disabled={buying}
                      className="text-[12px] font-medium px-2.5 py-1 rounded-lg border disabled:opacity-60"
                      style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                      {b} for {price}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Mic size={15} style={{ color: '#0EA5A4' }} />
                <span className="text-sm font-semibold" style={label}>Make dubs sound like you <span className="font-normal" style={muted}>(optional)</span></span>
              </div>
              <p className="text-[12px] mb-1.5" style={muted}>Dubs work out of the box in a clean generic voice, free and unlimited. This is an optional upgrade: MVP learns your voice from a recent video and narrates every non-English dub in your own voice.</p>
              <p className="text-[12px] mb-2.5" style={muted}>
                Your-voice dubs use <span className="font-semibold" style={label}>1 credit per market</span>.
                {typeof voice.credits === 'number'
                  ? <> You have <span className="font-semibold" style={label}>{voice.credits} credits</span> this month.</>
                  : <> Unlimited on your plan.</>}
                {' '}Standard-voice dubs are always free.
              </p>
              <label className="flex items-start gap-2 text-[12px] cursor-pointer mb-2.5" style={muted}>
                <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 accent-[#0EA5A4]" />
                <span>I confirm this is my own voice, or I have permission to clone it.</span>
              </label>
              <button type="button" onClick={() => void cloneVoice()} disabled={cloning || !consent}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium px-3 py-2 rounded-lg text-white disabled:opacity-60" style={{ background: '#0EA5A4' }}>
                {cloning ? <><Loader2 size={14} className="animate-spin" /> Learning your voice…</> : <><Mic size={14} /> Use my voice</>}
              </button>
            </div>
          )}
          </div>
        </details>
      )}

      {/* Master video picker — only when no video was passed in */}
      {!presetVideoId && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold mb-3" style={label}>Pick your master video</h2>
          {loading ? (
            <div className="flex items-center gap-2 text-sm py-4" style={muted}><Loader2 size={15} className="animate-spin" /> Loading…</div>
          ) : videos.length === 0 ? (
            <p className="text-sm" style={muted}>No videos yet. Sync your channel first.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {videos.map(v => {
                const on = picked === v.id
                return (
                  <button key={v.id} type="button" onClick={() => setPicked(v.id)} className="text-left rounded-xl border overflow-hidden"
                    style={{ borderColor: on ? '#0EA5A4' : 'var(--border)', borderWidth: on ? 2 : 1, background: 'var(--bg)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {v.thumbnail_url ? <img src={v.thumbnail_url} alt="" className="w-full aspect-video object-cover" /> : <div className="w-full aspect-video" style={{ background: 'var(--surface)' }} />}
                    <div className="p-2"><p className="text-[12px] font-medium line-clamp-2" style={label}>{v.title}</p></div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Markets */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={label}>Marketplaces</h2>
          <button type="button" className="text-[12px] underline" style={muted}
            onClick={() => setChosen(new Set(markets.filter(m => m.domain !== 'amazon.com').map(m => m.domain)))}>
            Select all (except US)
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {markets.map(m => {
            const on = chosen.has(m.domain)
            const status = signin[m.domain]
            // A resolved/pasted local ASIN (product listed abroad under a different code).
            const localAsin = (marketAsins && marketAsins[m.domain]) || manualAsins[m.domain] || null
            const showLocal = !!localAsin && localAsin.toUpperCase() !== asin.trim().toUpperCase()
            return (
              <div key={m.domain} className="flex flex-col gap-2 p-2.5 rounded-lg border text-sm"
                style={{ borderColor: on ? '#0EA5A4' : 'var(--border)', background: on ? 'rgba(14,165,164,0.05)' : 'transparent', color: 'var(--text)' }}>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                    <input type="checkbox" checked={on} onChange={() => toggleMarket(m.domain)} disabled={running} className="accent-[#0EA5A4]" />
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">{m.code}</span>
                      <span className="text-[11px] ml-1" style={muted}>{m.needsTranslation ? m.langName : 'English'}</span>
                      {showLocal ? (
                        <span className="block text-[10px]" style={{ color: '#10B981' }}>Local ASIN {localAsin}</span>
                      ) : geoBadges && geoBadges[m.domain] ? (
                        <span className="block text-[10px]" style={{ color: geoBadges[m.domain] === 'Product found' ? '#10B981' : 'var(--text-3)' }}>{geoBadges[m.domain]}</span>
                      ) : null}
                    </span>
                  </label>
                  {status === 'ready' ? (
                    <span className="text-[11px] inline-flex items-center gap-0.5 whitespace-nowrap" style={{ color: '#10B981' }} title="Signed in on this marketplace"><Check size={11} /> Signed in</span>
                  ) : (!signinChecked && scout?.installed) ? (
                    <span className="text-[11px] inline-flex items-center gap-0.5 whitespace-nowrap" style={muted} title="Checking your sign-in on this marketplace"><Loader2 size={11} className="animate-spin" /> checking</span>
                  ) : (
                    <button type="button" onClick={() => void signInMarket(m.domain, m.country)}
                      className="text-[11px] underline whitespace-nowrap inline-flex items-center gap-0.5" style={{ color: '#e0554b' }}
                      title={`Open ${m.country} on Amazon to sign in`}>
                      <LogIn size={11} /> Log in
                    </button>
                  )}
                </div>
                {/* No confident local match for a not-listed market → let the creator paste it. */}
                {on && needsLocalAsin(m.domain) && (
                  <input
                    defaultValue=""
                    onBlur={e => { const v = e.target.value.trim().toUpperCase(); if (/^[A-Z0-9]{10}$/.test(v)) setManualAsins(prev => ({ ...prev, [m.domain]: v })) }}
                    placeholder="Paste this market’s ASIN"
                    className="w-full px-2 py-1 rounded-md border text-[11px] bg-transparent"
                    style={{ borderColor: '#e0554b55', color: 'var(--text)' }}
                    title="This product isn’t listed here under the US ASIN and no local match was found — paste the local ASIN to include this market."
                  />
                )}
              </div>
            )
          })}
        </div>
        {/* Sign-in gate for the SELECTED stores: once checked, any store that isn't
            confirmed gets its Amazon tab opened in one click, then a re-check. */}
        {scout?.installed && signinChecked && !running && !delivering && (
          notReadyChosen.length > 0 ? (
            <div className="mt-3 flex items-center gap-3 flex-wrap rounded-lg border px-3 py-2" style={{ borderColor: '#e0554b55', background: 'rgba(224,85,75,0.05)' }}>
              <p className="text-[12px] flex-1 min-w-[12rem]" style={label}>
                <span className="font-medium" style={{ color: '#e0554b' }}>{notReadyChosen.length} of {chosen.size} selected {chosen.size === 1 ? 'store isn’t' : 'stores aren’t'} signed in</span>
                <span style={muted}> ({notReadyChosen.map(m => m.code).join(', ')}). MVP uploads only to stores you’re signed in to.</span>
              </p>
              <button type="button" onClick={() => void openSignInTabs(notReadyChosen.map(m => m.domain)).then(n => { if (n > 0) toast(`Opened ${n} Amazon ${n === 1 ? 'tab' : 'tabs'}. Sign in on each, then re-check.`) })}
                className="text-[12px] font-medium px-3 py-1.5 rounded-lg text-white inline-flex items-center gap-1" style={{ background: '#e0554b' }}>
                <LogIn size={12} /> Open {notReadyChosen.length === 1 ? 'the store' : `${notReadyChosen.length} stores`} to sign in
              </button>
              <button type="button" onClick={() => void recheckSignin()} disabled={rechecking} className="text-[12px] underline inline-flex items-center gap-1 disabled:opacity-60" style={muted}>
                {rechecking ? <><Loader2 size={12} className="animate-spin" /> Checking…</> : 'Re-check sign-in'}
              </button>
            </div>
          ) : chosen.size > 0 ? (
            <p className="text-[12px] mt-3 inline-flex items-center gap-1" style={{ color: '#10B981' }}><Check size={12} /> Signed in on every selected store.</p>
          ) : null
        )}
        {presetAsin ? (
          // Launchpad already collected the ASIN in its own step — show it, don't ask twice.
          <p className="text-[12px] mt-3" style={muted}>Product <span className="font-mono font-medium" style={label}>{baseAsin || presetAsin}</span> · set in the step above.</p>
        ) : (
          <div className="mt-3">
            <label className="text-[12px] font-medium" style={label}>Featured ASIN <span style={{ color: '#e0554b' }}>*</span></label>
            <input value={asin} onChange={e => setAsin(e.target.value)} placeholder="B0XXXXXXXX or a product link" required
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-transparent" style={{ borderColor: baseAsin ? 'var(--border)' : '#e0554b55', color: 'var(--text)' }} />
            <p className="text-[11px] mt-1" style={asin.trim() && !baseAsin ? { color: '#e0554b' } : muted}>
              {asin.trim() && !baseAsin
                ? 'That doesn’t look right — paste the 10-character ASIN or the Amazon product link.'
                : 'Required. MVP uses the product to write each market’s title and build the thumbnail.'}
            </p>
          </div>
        )}
      </div>

      {/* ONE click: localize → sign-in check → dub → upload. "Preview first" is the
          optional review path (localize only, then Upload from the copy card). */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => void uploadAll()} disabled={running || delivering || !picked || chosen.size === 0 || !baseAsin}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#0EA5A4,#0891B2)' }}>
          {(running || delivering)
            ? <><Loader2 size={16} className="animate-spin" /> {phase || 'Working…'}</>
            : <><Upload size={16} /> Upload to {chosen.size || ''} {chosen.size === 1 ? 'store' : 'stores'}</>}
        </button>
        {!running && !delivering && (
          <button type="button" onClick={() => void start()} disabled={!picked || chosen.size === 0 || !baseAsin}
            className="text-[12px] underline disabled:opacity-50" style={muted}>
            Preview the localized copy first
          </button>
        )}
      </div>

      {targets.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <h2 className="text-sm font-semibold" style={label}>Localized copy</h2>
            <button onClick={() => void deliverAll()} disabled={delivering}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#0EA5A4,#0891B2)' }}>
              {delivering ? <><Loader2 size={15} className="animate-spin" /> {phase || 'Working…'}</> : <><Upload size={15} /> Upload to all storefronts</>}
            </button>
          </div>
          <p className="text-[12px] mb-2" style={muted}>One click uploads through SCOUT into your logged-in Amazon Creator account. It checks your sign-in, dubs any non-English market that needs it, then uploads, so no storefront ships with English audio. You must be signed in to each marketplace and enrolled in its Creator program. Keep this tab open while it runs.</p>
          {scout && (
            scout.installed
              ? <p className="text-[11px] mb-3" style={scoutStale ? { color: '#d97706' } : muted}>
                  SCOUT v{scout.version || '?'}{scoutStale ? ` — please update to ${SCOUT_LATEST_VERSION} (remove the old unpacked build in chrome://extensions and load the new one). Uploads before you update will keep failing.` : ' · up to date'}
                </p>
              : <p className="text-[11px] mb-3" style={{ color: '#e0554b' }}>SCOUT not detected. Install it and sign in to Amazon to upload.</p>
          )}
          <div className="space-y-3">
            {targets.map(t => {
              const uploading = delivering && t.state !== 'delivered' && t.state !== 'failed'
              return (
              <div key={t.domain} className="rounded-xl border-2 p-3 transition-colors" style={
                t.state === 'delivered' ? { borderColor: '#10B981', background: 'rgba(16,185,129,0.14)' }
                  : t.state === 'failed' ? { borderColor: 'rgba(224,85,75,0.6)', background: 'rgba(224,85,75,0.07)' }
                  : uploading ? { borderColor: 'rgba(14,165,164,0.6)', background: 'rgba(14,165,164,0.06)' }
                  : { borderColor: 'var(--border)' }
              }>
                <div className="flex items-center gap-2 mb-1">
                  {t.state === 'delivered' ? <Check size={15} style={{ color: '#10B981' }} />
                    : uploading ? <Loader2 size={14} className="animate-spin" style={{ color: '#0EA5A4' }} />
                    : t.state === 'localized' ? <Check size={14} style={{ color: '#10B981' }} />
                    : <Circle size={13} style={muted} />}
                  <span className="text-sm font-medium" style={label}>{t.country}</span>
                  <span className="text-[11px]" style={muted}>{t.lang}{t.dub ? ' · dub' : ''}</span>
                  {t.state === 'delivered' && <span className="text-[11px] font-bold inline-flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ color: '#fff', background: '#10B981' }}><Check size={12} /> Uploaded</span>}
                  {uploading && <span className="text-[11px] font-medium" style={{ color: '#0EA5A4' }}>Uploading…</span>}
                  {t.state === 'failed' && <span className="text-[11px] font-medium" style={{ color: '#e0554b' }}>upload failed</span>}
                  {/* Sign-in / enrollment status from the pre-flight. */}
                  {signin[t.domain] === 'ready' && <span className="text-[11px] font-medium inline-flex items-center gap-1" style={{ color: '#10B981' }}><Check size={12} /> signed in</span>}
                  {signin[t.domain] === 'not_signed_in' && <span className="text-[11px] font-medium" style={{ color: '#e0554b' }}>not signed in</span>}
                  {signin[t.domain] === 'not_enrolled' && <span className="text-[11px] font-medium" style={{ color: '#d97706' }}>not enrolled</span>}
                  {signin[t.domain] === 'unknown' && <span className="text-[11px] font-medium" style={{ color: '#d97706' }}>sign-in not confirmed</span>}
                </div>
                {(signin[t.domain] === 'not_signed_in' || signin[t.domain] === 'not_enrolled' || signin[t.domain] === 'unknown') && (
                  <div className="mb-1">
                    <button type="button" onClick={() => void signInMarket(t.domain, t.country)}
                      className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg border"
                      style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                      <LogIn size={13} /> {signin[t.domain] === 'not_enrolled' ? `Open ${t.country} Creator Hub` : `Sign in on ${t.country}`}
                    </button>
                  </div>
                )}
                {t.title && <p className="text-[13px] font-medium" style={label}>{t.title}</p>}
                {t.description && <p className="text-[12px] mt-0.5 line-clamp-3" style={muted}>{t.description}</p>}
                {t.detail && t.state !== 'delivered' && <p className="text-[11px] mt-1" style={muted}>{t.detail}</p>}
                {/* Skip dub: deliver the English master to this market on purpose. */}
                {t.dub && t.state !== 'delivered' && (
                  <label className="flex items-center gap-1.5 text-[11px] mt-1.5 cursor-pointer" style={muted}>
                    <input type="checkbox" checked={skipDub.has(t.domain)}
                      onChange={() => setSkipDub(prev => { const n = new Set(prev); n.has(t.domain) ? n.delete(t.domain) : n.add(t.domain); return n })}
                      className="accent-[#0EA5A4]" />
                    Skip dub — upload with English audio
                  </label>
                )}
                {t.dub && !skipDub.has(t.domain) && t.videoUrl && (
                  // Listen to the generated dub in-page. Stays available after the
                  // market is delivered so you can always check how it sounds. A
                  // voiceover-only result is an .mp3; a muxed dub is an .mp4.
                  <div className="mt-2">
                    <div className="flex items-center gap-1.5 mb-1 text-[12px] font-medium" style={{ color: '#0EA5A4' }}>
                      <Play size={13} /> Your {t.country} dub
                    </div>
                    {/\.mp3(\?|$)/i.test(t.videoUrl) ? (
                      <audio controls preload="none" src={t.videoUrl} className="w-full h-9" />
                    ) : (
                      <video controls preload="none" src={t.videoUrl} className="w-full rounded-lg" style={{ maxHeight: 220 }} />
                    )}
                    {(t.state === 'localized' || t.state === 'failed') && (
                      <button type="button" onClick={() => void dubOne(t.domain)} disabled={dubbing === t.domain}
                        className="inline-flex items-center gap-1.5 text-[11px] font-medium mt-1 disabled:opacity-60"
                        style={{ color: 'var(--text-2)' }}>
                        {dubbing === t.domain ? <><Loader2 size={12} className="animate-spin" /> Regenerating…</> : <><Mic size={12} /> Regenerate dub</>}
                      </button>
                    )}
                  </div>
                )}
                {t.dub && !skipDub.has(t.domain) && !t.videoUrl && (t.state === 'localized' || t.state === 'failed' || t.state === 'dubbing') && (
                  <div className="flex items-center gap-3 mt-2">
                    <button type="button" onClick={() => void dubOne(t.domain)} disabled={dubbing === t.domain}
                      className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg border disabled:opacity-60"
                      style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                      {dubbing === t.domain ? <><Loader2 size={13} className="animate-spin" /> Dubbing…</> : <><Mic size={13} /> Generate dub</>}
                    </button>
                  </div>
                )}
              </div>
              )
            })}
          </div>
          {/* Amazon rejected the publish → give the creator something actionable
              plus the exact request Amazon's own Creator Hub makes, so a payload
              mismatch can be diffed instead of guessed at. */}
          {targets.some(t => t.state === 'failed') && (
            <div className="mt-4 rounded-lg border p-3" style={{ borderColor: '#e0554b55', background: 'rgba(224,85,75,0.05)' }}>
              <p className="text-[12px] font-medium mb-1" style={label}>Amazon rejected the publish</p>
              <p className="text-[12px]" style={muted}>
                The video and thumbnail reached Amazon; it was the final publish call that was refused. First try publishing one video by hand in the Creator Hub. If Amazon asks you to verify a phone number or accept something new, that gate is on the account and MVP can’t pass it for you. Once that manual publish goes through, hit the button below and send us the result.
              </p>
              <button type="button" onClick={() => void copyDiagnostic()} disabled={copyingDiag}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg border mt-2"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                {copyingDiag ? <><Loader2 size={13} className="animate-spin" /> Collecting…</> : 'Copy the Amazon diagnostic'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
