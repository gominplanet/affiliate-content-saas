// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// StorefrontStage — the Amazon geos step. One master video, localized for every
// Amazon marketplace the creator sells in (title + description per market in
// their voice), with an optional dub in their own cloned voice. Used inside
// Launchpad (with a preset video) and on the standalone Storefront Sync page
// (with its own picker).
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { Loader2, Check, Circle, Mic, Play, Upload, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import { requestStorefrontDelivery, requestStorefrontPreflight, requestStorefrontLogin, requestStorefrontDebug, requestStorefrontProgress, getScoutStatus, type StorefrontMarketStatus, type StorefrontProgress } from '@/lib/extension-frame'
import { SCOUT_LATEST_VERSION } from '@/lib/scout-version'
import { normalizeAsinInput } from '@/lib/asin'
import { decodeHtmlEntities } from '@/lib/decode-entities'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Bare ASIN or Amazon product link → the clean 10-character code, or null. */
function normalizeAsin(v: string): string | null {
  return normalizeAsinInput(v)
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
interface Target { domain: string; market: string; country: string; lang: string; dub: boolean; title: string | null; description: string | null; state: string; detail: string | null; videoUrl: string | null; asin?: string | null }

/** Rounds of re-checking a dub whose request died, fifteen seconds apart.
 *  The dub route runs up to 300 seconds and this browser holds the request open
 *  the whole time; when the connection drops the server carries on and finishes.
 *  Long enough to cover that, short enough that a dub which really failed is
 *  reported promptly. */
const DUB_RECHECKS = 10

const label = { color: 'var(--text)' } as const
const muted = { color: 'var(--text-2)' } as const

/** presetVideoId: when set, the stage syncs THAT video and hides its own picker
 *  (Launchpad passes the already-picked video). */
export default function StorefrontStage({ presetVideoId, presetAsin, allowedDomains, defaultChosen, geoBadges, marketAsins, presetThumbnailUrl, allowDubbing = true }: {
  presetVideoId?: string | null
  presetAsin?: string | null
  /** Video Launchpad restricts to a subset of marketplaces (the English geos).
   *  When set, only these domains are shown/selectable. */
  allowedDomains?: string[] | null
  /** Whether this surface offers dubbing at all.
   *
   *  Video Launchpad passes false. It ships the four English storefronts, whose
   *  audio is already right, so there is nothing to dub and every control for it
   *  is noise on the one-click path. The dubbing CODE is untouched: the API
   *  route, the voice cloning, the credits and the standalone Storefront Sync
   *  page all still work, and that page still offers all nine markets.
   *
   *  This is a switch rather than "no non-English market is selected here, so
   *  the UI happens to stay hidden". Those are different statements, and the
   *  second one quietly stops being true the day somebody widens the allow-list.
   *  With this off, a non-English market that reaches delivery gets the English
   *  master rather than sitting in a dub queue nothing can start. */
  allowDubbing?: boolean
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
  /** Every storefront MVP supports, fetched once. `markets` below is this list
   *  narrowed to what the caller currently allows, and the two are separate
   *  because the allowed list CHANGES AFTER MOUNT. Launchpad researches the
   *  four English stores first and the other five only when the creator asks
   *  for them, so the narrowing has to be re-derived, not captured. */
  const [allMarkets, setAllMarkets] = useState<Market[]>([])
  const [markets, setMarkets] = useState<Market[]>([])
  const [loading, setLoading] = useState(!presetVideoId)
  const [picked, setPicked] = useState<string | null>(presetVideoId || null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [asin, setAsin] = useState(presetAsin || '')
  /** The English title every store starts from. Shown and editable BEFORE the
   *  run, because it is translated into every other market: a creator who only
   *  sees it after the localize has to redo five translations to fix a word. */
  const [masterTitle, setMasterTitle] = useState('')
  const [titleLoading, setTitleLoading] = useState(false)
  /** Once they have typed, a reload of the video must not overwrite them. */
  const titleTouched = useRef(false)
  // ASINs the creator pasted by hand for a market where the source ASIN isn't
  // listed and SCOUT found no confident local match. Merged over `marketAsins`.
  const [manualAsins, setManualAsins] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [targets, setTargets] = useState<Target[]>([])
  const [dubbing, setDubbing] = useState<string | null>(null)
  /** The markets in the upload wave running right now.
   *
   *  Without it every card said "Uploading…" the whole time anything was
   *  delivering, including markets that were sitting in the dub queue and
   *  markets that were not in the run at all. Two storefronts reported
   *  "Uploading…" through a run that never sent them a single byte. */
  const [wave, setWave] = useState<Set<string>>(new Set())
  /** What this run did, or failed to do, per market.
   *
   *  A TOAST IS NOT A RECORD. Germany's dub stopped part-way, the run said
   *  "1 never got as far as an upload", and Germany's card looked exactly like
   *  a market nobody had asked for: green tick, no note, a Generate dub button.
   *  Every reason the run learns is kept here and stays on the card. */
  const [outcome, setOutcome] = useState<Record<string, string>>({})
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

  // Live per-marketplace progress, polled from SCOUT only while a run is in
  // flight. The extension holds the truth (it is the thing moving the bytes), so
  // this is a read, never a source of state anything else depends on.
  const [progress, setProgress] = useState<StorefrontProgress>({})
  useEffect(() => {
    if (!delivering) { setProgress({}); return }
    let stopped = false
    const tick = async () => {
      try { const p = await requestStorefrontProgress(); if (!stopped) setProgress(p) } catch { /* keep the last bars */ }
    }
    void tick()
    const iv = setInterval(tick, 1500)
    return () => { stopped = true; clearInterval(iv) }
  }, [delivering])

  const [voice, setVoice] = useState<{ enabled: boolean; hasVoice: boolean; name: string | null; credits: number | null } | null>(null)
  const [consent, setConsent] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [buying, setBuying] = useState(false)
  // Optional: use the cloned voice (costs a credit) or the free generic voice.
  const [useMyVoice, setUseMyVoice] = useState(false)
  useEffect(() => { if (voice?.hasVoice) setUseMyVoice(true) }, [voice?.hasVoice])

  useEffect(() => { if (presetVideoId) setPicked(presetVideoId) }, [presetVideoId])

  // ── THE ASIN IS IN THE VIDEO'S OWN DESCRIPTION ───────────────────────────
  //
  // This field used to be typed by hand on every video, while the answer sat in
  // the description all along: "Check Today's Price and Availability on AMAZON
  // here: https://www.mvpl.ink/2eniqan". MVP can open that link. Asking someone
  // to read it themselves, once per video, is the work this product exists to
  // remove.
  //
  // It PREFILLS, it does not lock: the creator can still overtype it, and where
  // it came from is shown rather than the field silently filling itself.
  const [asinAuto, setAsinAuto] = useState<{ state: 'idle' | 'looking' | 'found' | 'none'; from?: string; note?: string }>({ state: 'idle' })
  const asinTouched = useRef(false)
  useEffect(() => {
    if (!picked || presetAsin) return
    // Never overwrite something the creator typed.
    if (asinTouched.current) return
    let alive = true
    setAsinAuto({ state: 'looking' })
    void (async () => {
      try {
        const r = await fetch(`/api/video-asin?videoId=${encodeURIComponent(picked)}`)
        const j = await r.json()
        if (!alive) return
        if (j?.asin) {
          setAsin(j.asin)
          setAsinAuto({ state: 'found', from: j.from || 'the description' })
        } else {
          setAsinAuto({ state: 'none', note: j?.note })
        }
      } catch {
        if (alive) setAsinAuto({ state: 'none', note: 'could not check the description just now' })
      }
    })()
    return () => { alive = false }
  }, [picked, presetAsin])

  // Resume the localized copy after a reload. The job itself lives on the server,
  // so only its id has to survive; the targets are re-fetched. Tied to the video
  // it belongs to, so a different master never picks up a stale job.
  useEffect(() => {
    if (!presetVideoId || jobId) return
    try {
      const raw = localStorage.getItem('mvp_storefront_job_v1')
      const s = raw ? JSON.parse(raw) : null
      if (s && s.videoId === presetVideoId && typeof s.jobId === 'string' && s.jobId) {
        setJobId(s.jobId)
        void refreshTargets(s.jobId)
      }
    } catch { /* no resume is fine */ }
    // refreshTargets is a stable function declaration in this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetVideoId, jobId])

  useEffect(() => {
    if (!presetVideoId || !jobId) return
    try { localStorage.setItem('mvp_storefront_job_v1', JSON.stringify({ videoId: presetVideoId, jobId })) } catch { /* ignore */ }
  }, [presetVideoId, jobId])

  const load = useCallback(async () => {
    try {
      const [mr, vr] = await Promise.all([
        fetch('/api/global-sync/markets').then(r => r.json()).catch(() => ({})),
        fetch('/api/voice-clone/status').then(r => r.json()).catch(() => ({})),
      ])
      // STORED WHOLE. The narrowing is the effect below, which re-runs when the
      // caller's allowed list changes; doing it here froze the list at whatever
      // was known when this component mounted.
      if (Array.isArray(mr?.markets)) setAllMarkets(mr.markets)
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
    // No dependency on allowedDomains on purpose: the market list is static and
    // the caller narrowing it must not cost a second fetch. The narrowing lives
    // in the effect below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetVideoId])
  useEffect(() => { load() }, [load])

  // ── THE ALLOWED LIST CHANGES AFTER MOUNT ──────────────────────────────────
  //
  // This narrowing used to happen inside load(), whose only dependency is
  // presetVideoId, under a comment saying allowedDomains was "computed once
  // before this stage mounts". That was true while Launchpad only ever offered
  // the English stores. It stopped being true the day the international check
  // became an opt-in button, and nothing noticed: the creator pressed "Check
  // international stores", the card hid itself because the check had succeeded,
  // the parent's list grew to nine, and this component went on showing four.
  // The check appeared to do nothing at all, which is the worst shape a bug can
  // take, because there is nothing on screen to report.
  //
  // Joined into a string for the dependency: the parent rebuilds these arrays
  // on every render, so comparing them by identity would re-run this forever.
  const allowedKey = (allowedDomains ?? []).join(',')
  const defaultKey = (defaultChosen ?? []).join(',')
  /** Domains this stage has already offered. A market is ticked by default
   *  exactly once, the first time it appears. */
  const offered = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (allMarkets.length === 0) return
    const allow = allowedKey ? allowedKey.split(',') : []
    const shown = allow.length ? allMarkets.filter((m) => allow.includes(m.domain)) : allMarkets
    setMarkets(shown)

    // Tick the newly offered ones the caller wants, and ONLY those. Re-deriving
    // the whole selection from defaultChosen would undo every box the creator
    // has touched: untick Canada, ask for the international stores, and Canada
    // comes back ticked with no explanation.
    const want = defaultChosen ? new Set(defaultChosen) : null
    const fresh = shown.filter((m) => !offered.current.has(m.domain))
    if (fresh.length === 0) return
    for (const m of fresh) offered.current.add(m.domain)
    const add = fresh.filter((m) => (want ? want.has(m.domain) : true)).map((m) => m.domain)
    if (add.length > 0) setChosen((prev) => new Set([...prev, ...add]))
    // allMarkets is read, not watched by identity; the keys carry the change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMarkets, allowedKey, defaultKey])

  // ── WHOSE MARKETS THE COPY PANEL IS ABOUT ─────────────────────────────────
  //
  // `targets` belongs to the sync JOB, and the job id is restored from
  // localStorage on mount, so the panel routinely describes an earlier run. The
  // button on it said "Upload to all storefronts" while the checkboxes above
  // said something else entirely, and pressing it uploaded to last week's
  // country. Both of those are now named rather than implied.
  const jobCountries = targets.map((t) => t.country || t.domain)
  const jobMatchesTicks = targets.length === chosen.size
    && targets.every((t) => chosen.has(t.domain))

  // The video's own title, which is what the server would otherwise use. Read
  // here so the creator sees it before anything is translated.
  useEffect(() => {
    const id = picked
    if (!id) { setMasterTitle(''); titleTouched.current = false; return }
    let cancelled = false
    setTitleLoading(true)
    ;(async () => {
      try {
        const sb = createBrowserClient()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (sb as any)
          .from('youtube_videos').select('title,generated_title').eq('id', id).maybeSingle()
        if (cancelled) return
        // generated_title first: it is the one the server prefers, so showing
        // `title` would present a line that is not the one about to be used.
        const t = decodeHtmlEntities(String(data?.generated_title || data?.title || '')).trim()
        // NEVER over an edit in progress.
        if (!titleTouched.current) setMasterTitle(t)
      } catch { /* the field stays empty and says so */ }
      finally { if (!cancelled) setTitleLoading(false) }
    })()
    return () => { cancelled = true }
  }, [picked])

  /** The markets on screen that will receive a translation of that title. */
  const dubbingMarketNames = markets
    .filter(m => chosen.has(m.domain) && m.needsTranslation)
    .map(m => m.country)

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
    if (!baseAsin) { toast.error('Enter a valid product ASIN, or paste the Amazon product link. MVP needs it to build each market’s title and thumbnail.'); return null }
    if (!masterTitle.trim()) { toast.error('Write the English title first. Every other store gets a translation of it, so an empty one means untitled listings everywhere.'); return null }
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
        // THE EDITED TITLE, not the one on the video. Every other market is a
        // translation OF THIS, so sending the old one would translate wording
        // the creator has just replaced.
        body: JSON.stringify({ videoId: picked, markets: Array.from(chosen), asin: baseAsin, masterTitle: masterTitle.trim() || undefined, marketAsins: Object.keys(overrides).length ? overrides : undefined }),
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
        else toast('Still localizing in the background. The markets will fill in here as they finish.')
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
  async function recheckSignin(domains?: string[]) {
    setRechecking(true)
    try {
      const map = await runPreflight(domains && domains.length ? domains : markets.filter(m => chosen.has(m.domain)).map(m => m.domain))
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
        ...targets.map(t => `  ${t.country} (${t.domain}): ${t.state}${t.detail ? ` · ${t.detail}` : ''}`),
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
      // ── 0) THE JOB'S OWN MARKETS, READ NOW ────────────────────────────────
      //
      // NOT THE `targets` STATE. This function closes over whatever `targets`
      // held in the render where the button was clicked, and uploadAll calls it
      // after awaiting a localize that replaces them. So a creator with an
      // earlier job restored from localStorage clicked "Upload to 2 stores",
      // and the whole delivery ran against the OLD job's markets: the preflight
      // checked them, nothing was queued for them under the new job id, and
      // the run ended on "Uploaded to 0 of 1 storefronts" while the two markets
      // on screen were never touched. Nothing was dubbed either, because the
      // old market needed no dub.
      //
      // A job id is a fact and the state is a snapshot, so the job id wins.
      setPhase('Checking sign-in…')
      const jr = await fetch(`/api/global-sync/${jid}`).then(x => x.json()).catch(() => ({}))
      const live: Target[] = Array.isArray(jr?.targets) ? jr.targets : []
      if (live.length === 0) {
        toast.error('This sync has no markets on it yet. Pick your storefronts and hit Upload again.')
        return
      }
      setTargets(live)
      // Last run's notes are not this run's news.
      setOutcome({})

      // ── 1) SIGN-IN CHECK FIRST ────────────────────────────────────────────
      // Confirm which marketplaces the creator is signed in + enrolled on before
      // anything else, so we never spend minutes dubbing a market we can't reach.
      const preMap = await runPreflight(live.map(t => t.domain))
      if (preMap === null) return // SCOUT not installed — already told the creator; don't stack a second error
      const preKnown = Object.keys(preMap).length > 0
      const readyDomains = new Set(
        preKnown ? live.filter(t => preMap[t.domain] === 'ready').map(t => t.domain) : live.map(t => t.domain),
      )
      // Blocked markets are flagged on their own cards by the sign-in badge that
      // runPreflight just set (not signed in / not enrolled / unconfirmed).
      const blocked = preKnown ? live.filter(t => preMap[t.domain] !== 'ready') : []
      if (readyDomains.size === 0) {
        await refreshTargets(jid)
        // Open every store so the creator can sign in right away, not hunt for links.
        await openSignInTabs(live.map(t => t.domain))
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

      // ── 2) DUB AND UPLOAD, OVERLAPPED ─────────────────────────────────────
      // Dubbing runs on our servers, uploading runs in this browser. They compete
      // for nothing, so a market that needs no dub should never sit behind one
      // that does. Previously every dub finished before the first byte of ANY
      // market was uploaded, which is why one dubbed market slowed all of them.
      // Now the English geos upload while the dubs render, and dubbed markets
      // follow as soon as their audio is ready.
      // ── ALREADY ON THE STOREFRONT IS NOT A MARKET TO UPLOAD ───────────────
      //
      // The queue excludes anything with a delivered_at, correctly. The client
      // then counted it among the markets it set out to upload, found no queue
      // item for it, and reported "Not uploaded: amazon.it (it never reached
      // the upload queue)" about a listing that was already live. A creator
      // re-running to finish one market gets told the market that worked has
      // failed.
      const already = live.filter(t => readyDomains.has(t.domain) && t.state === 'delivered')
      const readyTargets = live.filter(t => readyDomains.has(t.domain) && t.state !== 'delivered')
      if (readyTargets.length === 0) {
        await refreshTargets(jid)
        toast.success(already.length > 0
          ? `Already on ${already.length === 1 ? 'that storefront' : `all ${already.length} storefronts`}. Nothing left to upload.`
          : 'Nothing left to upload for this video.')
        return
      }
      // With dubbing off, nothing waits: every market delivers the English
      // master in wave 1. A non-English target that somehow got here is treated
      // as skip-dub below rather than queued for a dub this surface won't run.
      const needDub = allowDubbing ? readyTargets.filter(t => t.dub && !t.videoUrl && !skipDub.has(t.domain)) : []
      const dubDomains = new Set(needDub.map(t => t.domain))
      const uploadNow = readyTargets.filter(t => !dubDomains.has(t.domain))
      const useClone = !!(voice?.hasVoice && useMyVoice)

      // Start the dubs and DON'T wait. Two at a time so several non-English
      // markets don't queue behind each other either.
      // Collected across both dub workers, read once the wave is done.
      const dubFailures: Array<{ domain: string; reason: string }> = []
      const dubbingDone = (async () => {
        if (needDub.length === 0) return
        const queue = [...needDub]
        const worker = async () => {
          for (;;) {
            const t = queue.shift()
            if (!t) return
            setDubbing(t.domain)
            // THE RESPONSE IS READ. This was fire-and-forget, with a catch whose
            // comment said "falls back to the master video for this market" and
            // told nobody. A dub that 502s leaves video_url null, the queue
            // serves the English master, and the market is delivered and marked
            // done: a French storefront with a French title and English audio,
            // reported as a success. Collected here and surfaced after the wave,
            // because a toast per market during a ten-market run is noise.
            try {
              const dr = await fetch('/api/global-sync/dub', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobId: jid, domain: t.domain, voice: useClone ? 'cloned' : 'standard' }),
              })
              const dj = await dr.json().catch(() => ({}))
              if (!dr.ok || !dj?.ok || !dj?.videoUrl) {
                const why = String(dj?.error || `HTTP ${dr.status}`).slice(0, 140)
                dubFailures.push({ domain: t.domain, reason: why })
                setOutcome(prev => ({ ...prev, [t.domain]: `The dub did not finish: ${why}` }))
              }
            } catch (e) {
              // A dub that runs past the function's ceiling lands here with the
              // fetch aborted, which is the one failure the server never gets to
              // record, so the card is the only place it can be said.
              const why = e instanceof Error ? e.message : 'the dub request did not complete'
              dubFailures.push({ domain: t.domain, reason: why })
              setOutcome(prev => ({ ...prev, [t.domain]: `The dub did not finish: ${why}` }))
            }
          }
        }
        await Promise.all([worker(), worker()])
        setDubbing(null)
        if (useClone) void refreshVoice()
      })()

      const loadQueue = async (only: Set<string>) => {
        const q = await fetch(`/api/global-sync/deliver/queue?jobId=${jid}`).then(r => r.json()).catch(() => ({}))
        const arr = Array.isArray(q?.items) ? q.items : []
        // Honor "skip dub": deliver the English master to those markets even if a
        // dub was generated earlier. Only keep markets in THIS wave.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // Dubbing off means every market takes the master, so the same rule that
        // serves an explicit "skip dub" serves the whole surface.
        const mapped = arr.map((i: any) => ((!allowDubbing || skipDub.has(i.domain)) && i.masterUrl) ? { ...i, videoUrl: i.masterUrl } : i)
          .filter((i: { domain: string }) => only.has(i.domain))

        // A PARTIAL DROP IS THE ONE THAT GETS THROUGH. The empty-queue check
        // below catches a wave where nothing came back. It cannot catch four
        // markets coming back out of five: the run then ends on "Uploaded to 4
        // of 4 storefronts", counted against what arrived rather than against
        // what was asked for, which reads as complete. The queue now names what
        // it could not serve and why, so the gap is a sentence instead of a
        // number nobody can check.
        const skippedHere = (Array.isArray(q?.skipped) ? q.skipped : [])
          .filter((s: { domain: string }) => only.has(s.domain))
        const missing = [...only].filter(d => !mapped.some((i: { domain: string }) => i.domain === d))
        if (missing.length > 0) {
          const why = new Map(skippedHere.map((s: { domain: string; reason: string }) => [s.domain, s.reason]))
          const lines = missing.map(d => `${d} (${why.get(d) || 'it never reached the upload queue'})`).join('; ')
          toast.error(`Not uploaded: ${lines}. The other stores in this wave still went out.`, { duration: 16000 })
          // ON THE CARD TOO. The toast is gone in sixteen seconds and the
          // market it named goes back to looking untouched.
          setOutcome(prev => {
            const next = { ...prev }
            for (const d of missing) next[d] = `Not uploaded. ${String(why.get(d) || 'it never reached the upload queue')}`
            return next
          })
        }
        return mapped
      }

      // The still-rendering-thumbnail question is asked at most once per run, and
      // the ANSWER is what carries. Tracking only "have we asked" meant a creator
      // who chose to wait in the first wave was never asked again, and the dubbed
      // wave then uploaded thumbnail-less anyway — the exact opposite of Cancel.
      let thumbDecision: 'unasked' | 'go' | 'stop' = 'unasked'
      type WaveResult = { targetId: string; ok: boolean; duplicate?: boolean; error?: string | null }
      const deliverWave = async (only: Set<string>, phaseLabel: string): Promise<WaveResult[]> => {
        if (only.size === 0 || thumbDecision === 'stop') return []
        setPhase('Getting the thumbnail…')
        let items = await loadQueue(only)
        // An empty queue for a wave we meant to upload is a real failure and it
        // used to return in silence. The run then ended on "Uploaded to 0 of 0
        // storefronts", which reads like there had been nothing to do rather
        // than like the markets the creator picked never reached the queue.
        if (items.length === 0) {
          toast.error(`Nothing was queued for ${[...only].join(', ')}, so ${only.size === 1 ? 'that store' : 'those stores'} got no upload. Hit Upload again; if it keeps happening the localize step did not finish.`, { duration: 12000 })
          return []
        }
        // A thumbnail the caller already made (Launchpad's thumbnail step) counts:
        // fill it into any item the server queue didn't have one for so the gate
        // passes immediately instead of waiting on the background render.
        if (presetThumbnailUrl) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          items = items.map((i: any) => i.thumbnailUrl ? i : { ...i, thumbnailUrl: presetThumbnailUrl })
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hasThumb = (arr: any[]) => !!presetThumbnailUrl || arr.some((i: { thumbnailUrl?: string | null }) => !!i.thumbnailUrl)
        if (!hasThumb(items)) {
          for (let i = 0; i < 24 && !hasThumb(items); i++) { await sleep(5000); items = await loadQueue(only) }
          if (!hasThumb(items) && thumbDecision === 'unasked') {
            const go = typeof window !== 'undefined' && window.confirm(
              'Your branded thumbnail is still rendering. Upload now and let Amazon use a frame from the video instead?\n\nClick Cancel to wait a bit longer and try again.',
            )
            thumbDecision = go ? 'go' : 'stop'
            if (!go) { toast('Held off. Try again once the thumbnail has finished rendering.'); return [] }
          }
        }

        // ── THE IMAGE, BEFORE IT GOES UP ────────────────────────────────────
        // A non-English store falling back to the branded thumbnail gets
        // ENGLISH HOOK TEXT on a German listing. Same shape as the English
        // audio: the upload succeeds, the state says delivered, and the only
        // way anyone finds out is looking at the storefront. Said here, while
        // the creator can still stop it.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const textFallbacks = items.filter((i: any) => i?.thumbnailIsTextFallback)
        if (textFallbacks.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const names = textFallbacks.map((i: any) => i.country || i.domain).join(', ')
          toast(`${names} will use the thumbnail with your ENGLISH text on it, because the text-free version has not finished rendering.`, { duration: 14000 })
          setOutcome(prev => {
            const next = { ...prev }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const i of textFallbacks) next[i.domain] = 'Uploaded with the English-text thumbnail, because the text-free version was not ready.'
            return next
          })
        }

        setPhase(phaseLabel)
        // ONLY the markets actually going out in this wave, and only once the
        // queue has really served them. Set before the call and cleared after,
        // so a card says "Uploading…" exactly while its upload is happening.
        setWave(new Set(items.map((i: { domain: string }) => i.domain)))
        const res = await requestStorefrontDelivery(items)
        setWave(new Set())
        if (!res.ok && !res.results) { toast.error(res.error || 'Could not reach SCOUT.'); return [] }
        const rows = (res.results || []) as WaveResult[]
        // Report each outcome so the UI shows delivery state. A duplicate is not a
        // failure — the video is already on that storefront — so mark it present
        // (green) with a clear note instead of an error, and don't create a copy.
        for (const r of rows) {
          const isDup = !r.ok && r.duplicate
          await fetch('/api/global-sync/deliver/result', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              targetId: r.targetId,
              ok: r.ok || isDup,
              detail: isDup ? 'Already on this storefront, skipped duplicate' : (r.ok ? 'Uploaded to storefront' : (r.error || 'Upload failed')),
            }),
          }).catch(() => {})
        }
        await refreshTargets(jid)
        return rows
      }

      const results: WaveResult[] = []

      // Wave 1: everything that already has its video. Runs while dubs render.
      if (uploadNow.length > 0) {
        toast(needDub.length > 0
          ? `Uploading ${uploadNow.length} ${uploadNow.length === 1 ? 'store' : 'stores'} now while ${needDub.length} ${needDub.length === 1 ? 'market is' : 'markets are'} dubbed. Keep this tab open.`
          : 'Uploading to your storefronts… keep this tab open.')
        results.push(...await deliverWave(new Set(uploadNow.map(t => t.domain)), 'Uploading…'))
      } else if (needDub.length > 0) {
        toast(`Dubbing ${needDub.length} ${needDub.length === 1 ? 'market' : 'markets'} first. This can take a couple of minutes each.`)
      }

      // Wave 2: the dubbed markets, as soon as their audio exists.
      if (needDub.length > 0) setPhase('Finishing the dubs…')
      await dubbingDone.catch(() => { /* per-market failures are collected in dubFailures */ })
      await refreshTargets(jid)

      // SAID BEFORE THE UPLOAD, not after. These markets are about to receive
      // the English master under a translated title, and once that is on the
      // storefront the creator's only clue is watching their own video. Warned
      // here so the sentence arrives while they can still stop the run.
      // ── A DUB THAT OUTLIVED ITS REQUEST IS NOT A FAILED DUB ───────────────
      //
      // The dub route runs for up to 300 seconds and this browser holds that
      // request open the whole time. The connection does not always survive it.
      // The server carries on, finishes, and writes the dubbed file to the
      // target; the client has already recorded a failure and moved on.
      //
      // That is exactly what happened to Germany. The run reported "1 never got
      // as far as an upload" and the diagnostic, taken minutes later, showed
      // `amazon.de: localized · Dubbed`. The dub was there. Nothing had gone
      // wrong except this client believing its own dropped connection.
      //
      // So a dub that "failed" is checked against the TARGET before it is
      // believed. The server is the one that knows.
      let unresolved = [...dubFailures]
      if (unresolved.length > 0) {
        setPhase('Checking the dubs that lost their connection…')
        for (let round = 0; round < DUB_RECHECKS && unresolved.length > 0; round++) {
          const jr = await fetch(`/api/global-sync/${jid}`).then(x => x.json()).catch(() => ({}))
          const rows: Target[] = Array.isArray(jr?.targets) ? jr.targets : []
          const landed = unresolved.filter(f => rows.find(t => t.domain === f.domain)?.videoUrl)
          if (landed.length > 0) {
            unresolved = unresolved.filter(f => !landed.some(l => l.domain === f.domain))
            setTargets(rows)
            // CLEARED, because the card is carrying a failure that is no longer
            // true and would otherwise sit there through a successful upload.
            setOutcome(prev => {
              const next = { ...prev }
              for (const l of landed) delete next[l.domain]
              return next
            })
          }
          // A target the server marked failed is a real answer; stop waiting.
          unresolved = unresolved.filter(f => rows.find(t => t.domain === f.domain)?.state !== 'failed')
          if (unresolved.length > 0 && round < DUB_RECHECKS - 1) await sleep(15000)
        }
      }

      // SAID BEFORE THE UPLOAD, and only about the ones that really did fail.
      if (unresolved.length > 0) {
        const names = unresolved.map(d => d.domain).join(', ')
        toast.error(
          `The dub did not finish for ${names}. ${unresolved.length === 1 ? 'That store' : 'Those stores'} will get your ENGLISH audio under a translated title unless you stop now. Reason: ${unresolved[0].reason}`,
          { duration: 20000 },
        )
      }

      if (needDub.length > 0) {
        results.push(...await deliverWave(dubDomains, 'Uploading the dubbed markets…'))
      }

      if (blocked.length > 0) {
        toast(`${blocked.length} ${blocked.length === 1 ? 'store was' : 'stores were'} skipped (not signed in / not enrolled).`)
      }
      // COUNT AGAINST WHAT WE SET OUT TO DO, NOT AGAINST WHAT CAME BACK.
      //
      // This read `${done} of ${results.length}`, where results is the rows SCOUT
      // returned. A market that never reached the queue produces no row, so it
      // left both sides of the fraction, and three stores that uploaded nothing
      // reported "Uploaded to 0 of 0 storefronts" as a success toast. The
      // denominator has to be the markets we were ready to upload to.
      const attempted = readyTargets.length
      const done = results.filter(r => r.ok).length
      const dups = results.filter(r => !r.ok && r.duplicate).length
      const landed = done + dups
      const missing = Math.max(0, attempted - results.length)
      const tail = [
        dups > 0 ? `${dups} already there` : '',
        // Counted apart from the attempt, because these were never attempted:
        // they were on their storefront before this run started.
        already.length > 0 ? `${already.length} already uploaded before this run` : '',
        missing > 0 ? `${missing} never got as far as an upload` : '',
      ].filter(Boolean).join(' · ')
      const line = `Uploaded to ${done} of ${attempted} storefronts${tail ? ` · ${tail}` : ''}`
      if (landed === attempted && attempted > 0) toast.success(line)
      else toast.error(line, { duration: 12000 })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Storefront upload failed')
    } finally { setDelivering(false); setPhase(null); setDubbing(null); setWave(new Set()) }
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
        ? 'Localizing failed. Hit Upload again to retry.'
        : 'Still localizing. Give it a moment, then hit Upload again.')
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
      <style>{`
        @keyframes mvpIndeterminate { 0% { transform: translateX(-100%) } 100% { transform: translateX(300%) } }
        .mvp-indeterminate { animation: mvpIndeterminate 1.3s ease-in-out infinite }
        @media (prefers-reduced-motion: reduce) { .mvp-indeterminate { animation: none; width: 100% } }
      `}</style>
      {/* Sounds like you — cloned voice for dubs */}
      {/* Dub voice — collapsed to one line. Free generic voice is the default; the
          cloned-voice upgrade (credits) lives behind "change" so it never clutters
          the fast path. */}
      {allowDubbing && voice?.enabled && (
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
                    title="This product isn’t listed here under the US ASIN and no local match was found. Paste the local ASIN to include this market."
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
            <input
              value={asin}
              onChange={e => { asinTouched.current = true; setAsin(e.target.value) }}
              placeholder={asinAuto.state === 'looking' ? 'Reading the description…' : 'B0XXXXXXXX or a product link'}
              required
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-transparent" style={{ borderColor: baseAsin ? 'var(--border)' : '#e0554b55', color: 'var(--text)' }} />
            {/* WHERE IT CAME FROM. A required field that fills itself and says
                nothing leaves the creator wondering what it is about to tag. */}
            {asinAuto.state === 'looking' && (
              <p className="text-[11px] mt-1 inline-flex items-center gap-1" style={{ color: '#0EA5A4' }}>
                <Loader2 size={11} className="animate-spin" /> Looking for the product link in this video’s description…
              </p>
            )}
            {asinAuto.state === 'found' && !asinTouched.current && (
              <p className="text-[11px] mt-1" style={{ color: '#10B981' }}>
                Found in {asinAuto.from}. Change it if that is the wrong product.
              </p>
            )}
            {asinAuto.state === 'none' && (
              <p className="text-[11px] mt-1" style={{ color: '#d97706' }}>
                {asinAuto.note || 'No Amazon product link in this video’s description'}, so type the ASIN here.
              </p>
            )}
            <p className="text-[11px] mt-1" style={asin.trim() && !baseAsin ? { color: '#e0554b' } : muted}>
              {asin.trim() && !baseAsin
                ? 'That doesn’t look right. Paste the 10-character ASIN or the Amazon product link.'
                : 'Required. MVP uses the product to write each market’s title and build the thumbnail.'}
            </p>
          </div>
        )}
      </div>

      {/* ── THE TITLE EVERY STORE STARTS FROM ────────────────────────────────
          The English stores get this exact line, and every other store gets a
          translation OF IT. It was read off the video server side and never
          shown, so the first time a creator saw the wording that would carry
          their listing in five countries was after it had been translated into
          all five, when changing it meant redoing the lot. */}
      {picked && (
        <div className="card p-4 mb-5">
          <label className="text-[12px] font-medium" style={label}>
            Title for the English stores
          </label>
          <textarea
            value={masterTitle}
            onChange={e => { titleTouched.current = true; setMasterTitle(e.target.value) }}
            rows={2}
            placeholder={titleLoading ? 'Reading this video’s title…' : 'The title your listing will carry'}
            className="w-full mt-1.5 px-3 py-2 rounded-lg border text-sm bg-transparent resize-y"
            style={{ borderColor: masterTitle.trim() ? 'var(--border)' : '#d9770655', color: 'var(--text)' }}
          />
          <div className="mt-1 flex items-baseline justify-between gap-3 flex-wrap">
            <p className="text-[11px]" style={masterTitle.trim() ? muted : { color: '#d97706' }}>
              {!masterTitle.trim()
                ? 'Empty, so your listings would go up untitled. Write the title first.'
                : dubbingMarketNames.length > 0
                  ? `Edit it here and ${dubbingMarketNames.join(', ')} ${dubbingMarketNames.length === 1 ? 'gets a translation' : 'get translations'} of this wording, not of the old one.`
                  : 'The English stores use this exactly as written.'}
            </p>
            <span className="text-[11px] tabular-nums" style={muted}>{masterTitle.trim().length}</span>
          </div>
        </div>
      )}

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
            <div>
              <h2 className="text-sm font-semibold" style={label}>Localized copy</h2>
              {/* WHICH MARKETS THIS IS FOR. The panel is the job's, and the job
                  is restored from localStorage, so it routinely belongs to an
                  earlier run. Unnamed, it reads as being about whatever is
                  ticked above. */}
              <p className="text-[11.5px] mt-0.5" style={muted}>
                {jobCountries.join(', ')}
              </p>
            </div>
            <button onClick={() => void deliverAll()} disabled={delivering}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#0EA5A4,#0891B2)' }}>
              {/* NAMED, not "all storefronts". This button delivers THIS job's
                  markets, and "all" is a promise about the ticks above, which
                  it has nothing to do with. Pressed while an old job was
                  restored, "Upload to all storefronts" uploaded to one country
                  from last week. */}
              {delivering
                ? <><Loader2 size={15} className="animate-spin" /> {phase || 'Working…'}</>
                : <><Upload size={15} /> Upload to {targets.length === 1 ? jobCountries[0] : `these ${targets.length} stores`}</>}
            </button>
          </div>
          {/* THE MISMATCH, SAID OUT LOUD. Two upload buttons sat on screen at
              once, one for the ticks and one for a job that no longer matched
              them, and nothing distinguished them. */}
          {!jobMatchesTicks && (
            <p className="text-[12px] mb-3 px-3 py-2 rounded-lg" style={{ color: '#d97706', background: 'rgba(217,119,6,0.08)' }}>
              This copy is from an earlier run, for {jobCountries.join(', ')}. The countries ticked above
              are different, so this button will not upload to them. Use the Upload button further up to
              start a run for what you have ticked.
            </p>
          )}
          <p className="text-[12px] mb-2" style={muted}>One click uploads through SCOUT into your logged-in Amazon Creator account. It checks your sign-in, dubs any non-English market that needs it, then uploads, so no storefront ships with English audio. You must be signed in to each marketplace and enrolled in its Creator program. Keep this tab open while it runs.</p>
          {scout && (
            scout.installed
              ? <p className="text-[11px] mb-3" style={scoutStale ? { color: '#d97706' } : muted}>
                  SCOUT v{scout.version || '?'}{scoutStale ? `. Please update to ${SCOUT_LATEST_VERSION} (remove the old unpacked build in chrome://extensions and load the new one). Uploads before you update will keep failing.` : ' · up to date'}
                </p>
              : <p className="text-[11px] mb-3" style={{ color: '#e0554b' }}>SCOUT not detected. Install it and sign in to Amazon to upload.</p>
          )}
          {/* Quick way into each store's Creator Hub. Uploads run inside your
              logged-in Amazon session, so signing in (or switching account) is the
              single most common thing to need from here. */}
          {targets.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              <span className="text-[11px] mr-0.5" style={muted}>Open a store to sign in:</span>
              {targets.map(t => (
                <button key={t.domain} type="button" onClick={() => void signInMarket(t.domain, t.country)}
                  className="text-[11px] font-medium px-2 py-1 rounded-lg border inline-flex items-center gap-1"
                  style={{
                    borderColor: signin[t.domain] === 'ready' ? 'rgba(16,185,129,0.5)' : 'var(--border)',
                    color: signin[t.domain] === 'ready' ? '#10B981' : 'var(--text-2)',
                  }}
                  title={`Open ${t.country} on Amazon${signin[t.domain] === 'ready' ? ' (already signed in)' : ''}`}>
                  <LogIn size={11} /> {t.market || t.country}
                </button>
              ))}
              {targets.length > 1 && (
                <button type="button"
                  onClick={() => void openSignInTabs(targets.map(t => t.domain)).then(n => { if (n > 0) toast(`Opened ${n} Amazon ${n === 1 ? 'tab' : 'tabs'}.`) })}
                  className="text-[11px] underline" style={muted}>Open all</button>
              )}
              <button type="button" onClick={() => void recheckSignin(targets.map(t => t.domain))} disabled={rechecking}
                className="text-[11px] underline inline-flex items-center gap-1 disabled:opacity-60" style={muted}>
                {rechecking ? <><Loader2 size={11} className="animate-spin" /> Checking…</> : 'Re-check sign-in'}
              </button>
              {/* Always reachable, not just after a failure. A successful run holds
                  the most useful record of what Amazon actually replied. */}
              <button type="button" onClick={() => void copyDiagnostic()} disabled={copyingDiag}
                className="text-[11px] underline inline-flex items-center gap-1 disabled:opacity-60" style={muted}
                title="Copy what Amazon replied on this run, for support">
                {copyingDiag ? <><Loader2 size={11} className="animate-spin" /> Collecting…</> : 'Copy the Amazon diagnostic'}
              </button>
            </div>
          )}
          <div className="space-y-3">
            {targets.map(t => {
              // WHAT IS HAPPENING TO THIS MARKET, not what is happening to the
              // run. `delivering && not finished` labelled every card
              // "Uploading…" from the first click, so a market queued behind a
              // dub, and a market not in the run at all, both claimed to be
              // uploading. Two storefronts said it for a run that never sent
              // them anything.
              const finished = t.state === 'delivered' || t.state === 'failed'
              const uploading = !finished && wave.has(t.domain)
              const isDubbing = !finished && dubbing === t.domain
              const queued = delivering && !finished && !uploading && !isDubbing
              const busy = uploading || isDubbing
              return (
              <div key={t.domain} className="rounded-xl border-2 p-3 transition-colors" style={
                t.state === 'delivered' ? { borderColor: '#10B981', background: 'rgba(16,185,129,0.14)' }
                  : t.state === 'failed' ? { borderColor: 'rgba(224,85,75,0.6)', background: 'rgba(224,85,75,0.07)' }
                  : uploading ? { borderColor: 'rgba(14,165,164,0.6)', background: 'rgba(14,165,164,0.06)' }
                  : { borderColor: 'var(--border)' }
              }>
                <div className="flex items-center gap-2 mb-1">
                  {t.state === 'delivered' ? <Check size={15} style={{ color: '#10B981' }} />
                    : busy ? <Loader2 size={14} className="animate-spin" style={{ color: '#0EA5A4' }} />
                    : t.state === 'localized' ? <Check size={14} style={{ color: '#10B981' }} />
                    : <Circle size={13} style={muted} />}
                  <span className="text-sm font-medium" style={label}>{t.country}</span>
                  <span className="text-[11px]" style={muted}>{t.lang}{t.dub ? ' · dub' : ''}</span>
                  {t.state === 'delivered' && <span className="text-[11px] font-bold inline-flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ color: '#fff', background: '#10B981' }}><Check size={12} /> Uploaded</span>}
                  {uploading && <span className="text-[11px] font-medium" style={{ color: '#0EA5A4' }}>{progress[t.domain]?.step || 'Uploading…'}</span>}
                  {isDubbing && <span className="text-[11px] font-medium" style={{ color: '#0EA5A4' }}>Dubbing into {t.lang.split('-')[0].toUpperCase()}…</span>}
                  {/* NAMED, because "waiting" and "uploading" are different
                      news. A market queued behind a dub that reads as uploading
                      is a creator who thinks their storefront has the video. */}
                  {queued && <span className="text-[11px] font-medium" style={muted}>{t.dub && !t.videoUrl ? 'Waiting for its dub' : 'Waiting its turn'}</span>}
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
                {/* The product this market will publish with. Shown BEFORE the
                    upload because Amazon locks a pending post: an untagged or
                    wrong-ASIN video can't be corrected until it goes live.
                    `undefined` means this row predates the field, which is not the
                    same as "no ASIN" — don't cry wolf on it. */}
                {t.asin !== undefined && (
                  <p className="text-[11px] mb-0.5" style={t.asin ? muted : { color: '#e0554b' }}>
                    {t.asin
                      ? <>Tagging <span className="font-mono font-medium" style={label}>{t.asin}</span>{baseAsin && t.asin.toUpperCase() !== baseAsin.toUpperCase() ? ' (local ASIN)' : ''}</>
                      : 'No product ASIN for this market. MVP will skip it rather than publish an untagged video.'}
                  </p>
                )}
                {/* Real progress while this market is moving bytes. The percentage
                    is genuine (the browser reports what has actually gone out);
                    steps without a measurable size show a moving stripe instead of
                    a fake number. */}
                {uploading && (() => {
                  const p = progress[t.domain]
                  const pct = typeof p?.pct === 'number' ? Math.max(0, Math.min(100, p.pct)) : null
                  return (
                    <div className="mb-1.5 mt-0.5">
                      <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                        <div
                          className={pct == null ? 'h-full w-1/3 rounded-full mvp-indeterminate' : 'h-full rounded-full'}
                          style={{
                            width: pct == null ? undefined : `${pct}%`,
                            background: 'linear-gradient(90deg,#0EA5A4,#0891B2)',
                            transition: pct == null ? undefined : 'width .35s ease',
                          }}
                        />
                      </div>
                      {pct != null && <p className="text-[10px] mt-0.5 tabular-nums" style={muted}>{pct}%</p>}
                    </div>
                  )
                })()}
                {t.title && <p className="text-[13px] font-medium" style={label}>{t.title}</p>}
                {t.description && <p className="text-[12px] mt-0.5 line-clamp-3" style={muted}>{t.description}</p>}
                {t.detail && t.state !== 'delivered' && <p className="text-[11px] mt-1" style={muted}>{t.detail}</p>}
                {/* WHAT THIS RUN DID TO THIS MARKET, and it stays. The reason
                    used to live only in a toast, so a market the run could not
                    upload went back to looking exactly like one nobody had
                    picked: a tick, no note, and a Generate dub button. */}
                {/* SHOWN EVEN WHEN DELIVERED. The thumbnail fallback is a note
                    about a market that DID upload, and hiding it on success is
                    exactly how English text ends up on a German listing with
                    nothing on screen to say so. Each message states its own
                    outcome, so there is no prefix to get wrong. */}
                {outcome[t.domain] && (
                  <p className="text-[11.5px] mt-1.5 px-2 py-1.5 rounded-lg" style={{ color: '#d97706', background: 'rgba(217,119,6,0.08)' }}>
                    {outcome[t.domain]}
                  </p>
                )}
                {/* Skip dub: deliver the English master to this market on purpose. */}
                {allowDubbing && t.dub && t.state !== 'delivered' && (
                  <label className="flex items-center gap-1.5 text-[11px] mt-1.5 cursor-pointer" style={muted}>
                    <input type="checkbox" checked={skipDub.has(t.domain)}
                      onChange={() => setSkipDub(prev => { const n = new Set(prev); n.has(t.domain) ? n.delete(t.domain) : n.add(t.domain); return n })}
                      className="accent-[#0EA5A4]" />
                    Skip dub, upload with English audio
                  </label>
                )}
                {allowDubbing && t.dub && !skipDub.has(t.domain) && t.videoUrl && (
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
                {allowDubbing && t.dub && !skipDub.has(t.domain) && !t.videoUrl && (t.state === 'localized' || t.state === 'failed' || t.state === 'dubbing') && (
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
