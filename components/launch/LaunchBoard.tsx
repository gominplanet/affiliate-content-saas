// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Ten videos, set up together, launched once.
//
// THE PAGE LEADS. Five numbered steps, exactly one of them open, and the open
// one is whichever the server says is first incomplete. A creator should never
// have to work out what to do next: the step that is their turn is the one that
// is expanded, tinted and labelled "Do this next".
//
// EVERY STATE COMES FROM THE SERVER. `steps`, `launchBlocker` and every item
// state are computed in lib/launch-batch and read here. This screen does not
// decide whether anything is done, because a screen that decides for itself can
// tick a step the worker will refuse, which is the failure this whole codebase
// keeps producing in different costumes.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import {
  Loader2, Plus, Trash2, Upload, Rocket, Clock, X, Check, AlertTriangle, LogIn, Wand2, ChevronUp, ChevronDown,
} from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { deliverPreparedStorefronts, deliverySummary, type DeliveryOutcome } from '@/lib/storefront-delivery'
import { MARKETS } from '@/lib/markets'
import { cadenceLabel, scheduleItems, todayIn, type ItemSchedule } from '@/lib/launch-schedule'
import { itemStateLabel, itemStateTone, itemProgressLabel, itemProgressTone, prepEta, batchRecap, stepIsOptional, launchOutcome, type CtaPreset, type StepStatus, type ItemRow, type StepId } from '@/lib/launch-batch'
import { liftoffPending } from '@/lib/liftoff-pending'
import { requestStorefrontPreflight, requestStudioFinish, getScoutStatus, setLiftoffAuto, type LiftoffAutoState, type StudioFinishResult } from '@/lib/extension-frame'
import { scoutAtLeast, SCOUT_STUDIO_MIN_VERSION } from '@/lib/scout-version'
import {
  DEFAULT_STUDIO_OPTIONS, liftoffStudioRequest, storeStudioRun, studioRunHeadline, studioPathNote, studioStepLabel, studioStepText, studioStepTone,
  type StoredStudioRun, type StudioOptions,
} from '@/lib/studio-finish'
import StepCard from './StepCard'
import LaunchReport, { type ReportItem } from './LaunchReport'
import CtaPicker from './CtaPicker'
import ThumbnailPicker from './ThumbnailPicker'
import type { ThumbnailPreset } from '@/lib/thumbnail-preset'

const text = { color: 'var(--text)' } as const
const muted = { color: 'var(--text-2)' } as const

interface Item {
  id: string
  position: number
  source_url: string | null
  rendered_url: string | null
  asin: string | null
  title: string | null
  description: string | null
  thumbnail_url: string | null
  /** 'styled' (the batch look applied) or 'plain' (it did not). */
  thumbnail_source: string | null
  /** The youtube_videos row this became, once it reached YouTube. The upload
   *  scope is built from these, so a batch can only ever deliver its own. */
  video_id: string | null
  /** Attempts so far, so a screen can tell working from stuck. */
  render_tries: number | null
  thumb_tries: number | null
  updated_at: string | null
  state: string
  reason: string | null
  publish_at: string | null
  youtube_video_id: string | null
  /** When YouTube accepted the thumbnail we designed, and what it said if it
   *  refused. Without these the row draws our image whether or not the channel
   *  is running it. */
  thumbnail_set_at: string | null
  thumbnail_error: string | null
  /** 'filename', 'creator' or 'mvp'. Null reads as 'filename'. */
  title_source: string | null
  /** This video's own YouTube date and time, or both null to follow the
   *  batch pattern. Absent entirely until migration 364 is run. */
  custom_publish_date?: string | null
  custom_publish_time?: string | null
  /** Set by the launch route: the uploader has this video. */
  planned_publish_at?: string | null
  publish_tries?: number | null
  /** When YouTube confirmed it is in the batch playlist, or what it said
   *  when it was not. Absent until migration 367. */
  playlist_added_at?: string | null
  playlist_error?: string | null
  /** SCOUT's last Studio run on this video, as Studio read it back. */
  studio_finish?: StoredStudioRun | null
  /** Each Amazon country for this video, as recorded: 'delivered', 'failed'
   *  (with SCOUT's reason in detail), 'localized' (ready, or waiting on its
   *  dub) or 'pending'. */
  amazon?: Array<{ domain: string; state: string; detail: string | null; waitingOnDub: boolean }>
  /** What YouTube confirmed after the uploader set the disclosures (368). */
  api_disclosures?: ReportItem['api_disclosures']
}
interface Market { domain: string; country: string; langName: string | null; needsDub: boolean }
/** A batch in the switcher: enough to choose between them, nothing more. */
interface BatchSummary {
  id: string; name: string; state: string; videos: number
  start_on: string | null; created_at: string
}
interface Batch {
  id: string; name: string; state: string
  cta: CtaPreset | null; cta_chosen: boolean | null
  thumbnail: ThumbnailPreset | null; thumbnail_chosen: boolean | null
  markets: Market[]
  daily_slots: string[]; start_on: string | null; timezone: string
  /** False: Amazon only. Absent (before migration 369) reads as true. */
  send_to_youtube?: boolean
}

const TONE: Record<string, string> = {
  good: '#10B981', busy: '#0EA5A4', warn: '#d97706', idle: 'var(--text-2)',
}

/** Tomorrow in the creator's own zone, which is the earliest sensible first day:
 *  a batch still has to upload before it can publish. */
/** Today in the creator's own zone, which is the earliest first day.
 *
 *  IT USED TO BE TOMORROW, and that made the feature wait a day for no reason:
 *  finish a batch at nine in the morning and the earliest anything could go out
 *  was the next one. A time that has already gone today means now. */
function earliestDay(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export default function LaunchBoard() {
  const [batchId, setBatchId] = useState<string | null>(null)
  const [batch, setBatch] = useState<Batch | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [steps, setSteps] = useState<StepStatus[]>([])
  const [blocker, setBlocker] = useState<string | null>(null)
  const [maxItems, setMaxItems] = useState(10)
  // False until migration 364 is run, in which case every video follows the
  // pattern and the page says why it cannot be given its own time.
  const [ownSchedules, setOwnSchedules] = useState(true)
  // Notify subscribers when each video goes public. Off unless turned on.
  const [notifySubs, setNotifySubs] = useState(false)
  const [notifyAvailable, setNotifyAvailable] = useState(true)
  // The YouTube options (migration 367): the playlist every video joins, and
  // the Studio steps SCOUT does when Finish in Studio is pressed.
  const [playlistId, setPlaylistId] = useState<string | null>(null)
  const [playlists, setPlaylists] = useState<Array<{ id: string; title: string }> | null>(null)
  const [playlistsError, setPlaylistsError] = useState<string | null>(null)
  const [studioOpts, setStudioOpts] = useState<StudioOptions>(DEFAULT_STUDIO_OPTIONS)
  const [ytOptionsAvailable, setYtOptionsAvailable] = useState(true)
  const [youtubeChoiceAvailable, setYoutubeChoiceAvailable] = useState(true)
  const [scoutReady, setScoutReady] = useState<boolean | null>(null)
  const [scoutVersion, setScoutVersion] = useState<string | null>(null)
  // ── KEEP GOING WHEN THIS PAGE IS CLOSED ──────────────────────────────────
  // On unless the creator turns it off (remembered in this browser). SCOUT
  // then wakes every few minutes and, with this page closed, opens Liftoff in
  // a pinned background tab to finish the Studio steps and Amazon uploads.
  const [bgPref, setBgPref] = useState(true)
  const [bgState, setBgState] = useState<LiftoffAutoState | null>(null)
  useEffect(() => {
    try { if (window.localStorage.getItem('mvp_liftoff_bg') === 'off') setBgPref(false) } catch { /* default on */ }
  }, [])
  async function applyBg(on: boolean, inMinutes?: number) {
    const st = await setLiftoffAuto(on, inMinutes)
    setBgState(st)
    return st
  }
  function toggleBg(on: boolean) {
    setBgPref(on)
    try { window.localStorage.setItem('mvp_liftoff_bg', on ? 'on' : 'off') } catch { /* this visit only */ }
    // Switched back on with work left: armed again here, since the page's
    // own arming runs once per batch and switching off cleared the wake.
    void applyBg(on, on && workLeft ? 5 : undefined)
  }
  // The Studio steps need SCOUT 1.20.0 or later; an older SCOUT drives the old
  // Details script, which is exactly what left these boxes blank.
  const scoutCanStudio = scoutReady === true && scoutAtLeast(scoutVersion, SCOUT_STUDIO_MIN_VERSION)
  // Which video SCOUT is in Studio for right now, and runs not yet stored
  // (shown until the reload that brings the stored copy back).
  const [studioBusy, setStudioBusy] = useState<string | null>(null)
  const [liveRuns, setLiveRuns] = useState<Record<string, StoredStudioRun>>({})
  // SCOUT's own record of each step, kept for this visit only (the stored run
  // leaves it out, it can be long), so a failed step can be copied as text.
  const liveRaw = useRef<Record<string, StudioFinishResult>>({})
  // ONE LAUNCH BUTTON IN VIEW, NEVER TWO. The bar at the bottom exists so
  // Launch is never somewhere you have to scroll to find; when the real button
  // is already on screen, the bar was a second copy of it directly underneath,
  // and a creator reasonably asked what the other one did. So the bar only
  // shows while the schedule step's button is out of view (scrolled away, or
  // its step folded shut).
  // ── AMAZON GOES BY ITSELF, WHILE THIS PAGE IS OPEN ───────────────────────
  // It used to wait for a press. It cannot run from our servers: Amazon has no
  // upload API for storefront videos, so SCOUT does it in this browser, signed
  // in as the creator. What CAN go is the press. Once the batch is launched,
  // this page checks every two minutes and hands over whatever is ready (on
  // YouTube, translated, dubbed). The queue only ever serves listings not yet
  // delivered, so nothing goes twice.
  //
  // IT STOPS RATHER THAN HAMMERS. An error, or a run where listings were ready
  // and none went, turns it off and says why; the button is still there to try
  // again by hand. A loop retrying a signed-out Amazon every two minutes would
  // be noise at best.
  const amazonRunning = useRef(false)
  // Its own flag, not the page's shared `busy`: an Amazon run takes minutes,
  // and ending it used to clear a Launch or a save still in flight.
  const [amazonBusy, setAmazonBusy] = useState(false)
  const [amazonAuto, setAmazonAuto] = useState<'on' | 'stopped'>('on')
  const [amazonNote, setAmazonNote] = useState<{ at: Date; lines: string[]; error: boolean } | null>(null)
  // ── AND THE STUDIO STEPS, BY THEMSELVES, FIRST ─────────────────────────
  // Paid promotion, AI use, the notify box, monetization: YouTube's API sets
  // none of them, and a batch only did them when somebody found and pressed
  // Finish in Studio on each row. Nobody did, and the videos sat scheduled
  // with the boxes blank. Now each video is finished in Studio once, by
  // itself, as soon as it is on YouTube, while this page is open.
  //
  // BEFORE AMAZON, never alongside it: the disclosures are what must be in
  // place before a video goes public, and both jobs drive SCOUT.
  //
  // ONCE PER VIDEO PER VISIT. A run that stops is not retried on a timer; the
  // row says where it stopped and Run Studio again is one press away.
  const studioRunning = useRef(false)
  const studioTried = useRef<Set<string>>(new Set())
  const studioManual = useRef(false)
  const studioBusyUntil = useRef(0)
  const lastStudioError = useRef<string | null>(null)
  // THE SAME RULE AS THE BACKGROUND TAB (lib/liftoff-pending): on YouTube,
  // within the work window, and no run yet or one that timed out with tries
  // left. Opening an old batch no longer drives its public videos through
  // Studio again.
  const studioDue = (i: Item) => liftoffPending(
    [{ ...i, studio_finish: liveRuns[i.id] ?? i.studio_finish }], [],
    { sendToYouTube: batch?.send_to_youtube !== false, studioPossible: scoutCanStudio },
  ).studio > 0
  const studioTick = useRef<() => void>(() => {})
  studioTick.current = () => {
    if (!scoutCanStudio || !batch || studioRunning.current || studioManual.current || amazonRunning.current) return
    if (Date.now() < studioBusyUntil.current) return
    if (batch.state !== 'launched' && batch.state !== 'launching') return
    // A run that timed out did not finish, so it goes again (once per visit);
    // one that ran to the end, whatever it found, is left for Run again.
    const next = items.find((i) => studioDue(i) && !studioTried.current.has(i.id))
    if (!next) return
    studioTried.current.add(next.id)
    void finishInStudio(next)
  }
  // Every video that needs the Studio steps and has not had them yet.
  const studioPending = items.some((i) => studioDue(i))

  // The latest state, read by a timer set once. A closure over the first
  // render would check a batch that has since launched as still a draft.
  const amazonTick = useRef<() => void>(() => {})
  amazonTick.current = () => {
    // The Studio steps go first; Amazon waits for them to finish.
    if (studioRunning.current || (scoutCanStudio && items.some((i) => studioDue(i) && !studioTried.current.has(i.id)))) return
    if (amazonAuto !== 'on' || scoutReady !== true || !batch || amazonRunning.current) return
    if (batch.state !== 'launched' && batch.state !== 'launching') return
    if (batch.markets.length === 0 || !items.some((i) => !!i.video_id)) return
    void uploadToAmazon({ auto: true }).then((out) => {
      if (!out) return
      // SCOUT STILL UPLOADING (the background tab's run, say) is not a
      // failure; the next check picks up whatever is left.
      if (out.error && /still uploading/i.test(out.error)) return
      if (out.error) setAmazonAuto('stopped')
      // Ready, not capped, and still nothing went: something is wrong that a
      // second try in two minutes will not fix.
      else if (!out.nothingReady && out.handedOver + out.duplicates === 0 && out.atCap.length === 0) setAmazonAuto('stopped')
    })
  }
  // WORK LEFT ON THIS BATCH: SCOUT is asked to look again later, so closing
  // the page does not stop it. Opening Liftoff with nothing pending no longer
  // sets a background tab going behind it.
  const armedFor = useRef<string | null>(null)
  const pendingHere = batch && (batch.state === 'launched' || batch.state === 'launching')
    ? liftoffPending(items, batch.markets.map((m) => m.domain), { sendToYouTube: batch.send_to_youtube !== false, studioPossible: scoutCanStudio })
    : null
  const workLeft = !!pendingHere && pendingHere.youtube + pendingHere.studio + pendingHere.amazon > 0
  useEffect(() => {
    if (!batch || !workLeft || !bgPref || scoutReady !== true || armedFor.current === batch.id) return
    armedFor.current = batch.id
    void applyBg(true, 5)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch?.id, workLeft, bgPref, scoutReady])
  useEffect(() => {
    const first = setTimeout(() => { studioTick.current(); amazonTick.current() }, 5_000)
    const studioEvery = setInterval(() => studioTick.current(), 20_000)
    const every = setInterval(() => amazonTick.current(), 120_000)
    return () => { clearTimeout(first); clearInterval(studioEvery); clearInterval(every) }
  }, [])
  // And at once when another video reaches YouTube, rather than up to two
  // minutes later.
  const onYouTubeCount = items.filter((i) => !!i.video_id).length
  useEffect(() => { if (onYouTubeCount > 0) { studioTick.current(); amazonTick.current() } }, [onYouTubeCount])
  // ── WHICH COUNTRIES SELL EACH VIDEO'S PRODUCT, before launch ─────────────
  // Asked again whenever the set of products changes. A country that sells none
  // of them is not blocked from being ticked; it is said, so the choice is made
  // knowing.
  type Verdict = 'sold' | 'out_of_stock' | 'not_sold' | 'cannot_check' | 'not_checked'
  const [avail, setAvail] = useState<{
    videos: Array<{ id: string; title: string }>
    markets: Array<{ domain: string; byVideo: Array<{ id: string; verdict: Verdict }> }>
    skipped: string | null
  } | null>(null)
  const [availLoading, setAvailLoading] = useState(false)
  const productKey = items.map((i) => (i.asin || '').toUpperCase()).filter(Boolean).sort().join(',')
  useEffect(() => {
    if (!batchId || !productKey) { setAvail(null); return }
    let gone = false
    // Cleared first, so a failed answer for this batch can never leave the
    // last batch's countries showing.
    setAvail(null)
    setAvailLoading(true)
    fetch(`/api/launch/batches/${batchId}/availability`)
      .then((r) => r.json())
      .then((j) => { if (!gone && j?.ok) setAvail({ videos: j.videos ?? [], markets: j.markets ?? [], skipped: j.skipped ?? null }) })
      .catch(() => { /* the step still works; it just says nothing about availability */ })
      .finally(() => { if (!gone) setAvailLoading(false) })
    return () => { gone = true }
  }, [batchId, productKey])
  const [mainLaunchEl, setMainLaunchEl] = useState<HTMLButtonElement | null>(null)
  const [mainLaunchInView, setMainLaunchInView] = useState(false)
  useEffect(() => {
    if (!mainLaunchEl || typeof IntersectionObserver === 'undefined') { setMainLaunchInView(false); return }
    const io = new IntersectionObserver(([e]) => setMainLaunchInView(!!e?.isIntersecting))
    io.observe(mainLaunchEl)
    return () => io.disconnect()
  }, [mainLaunchEl])
  // Rows with an edited time that has not been saved. Launch refuses while
  // any exists, because it would launch with the old time.
  const [dirtyRows, setDirtyRows] = useState<Record<string, boolean>>({})
  const markDirty = useCallback((id: string, v: boolean) => {
    // Same value, same object: React skips the render, so a row reporting
    // itself on every pass cannot start a render loop.
    setDirtyRows((prev) => (!!prev[id] === v ? prev : { ...prev, [id]: v }))
  }, [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  /**
   * THE PAGE OPENS THE RIGHT STEP ONCE, AND THEN LEAVES IT ALONE.
   *
   * It used to re-open whatever the server called current after every save,
   * which is fine in theory and awful in practice: the countries step is a
   * multi-select, so ticking France completed it, the reload decided the
   * current step was now the products one, and the box the creator was working
   * in folded shut under their hand. Every save became a navigation.
   *
   * So the auto-open happens on the first load and never again. After that the
   * open step is the creator's choice alone, and the one they should do next is
   * still marked "Do this next" for them to click when they are ready.
   */
  const autoOpened = useRef(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [uploading, setUploading] = useState(0)
  const [signin, setSignin] = useState<Record<string, string>>({})
  // ROOM LEFT TODAY, per storefront, from the same counting the upload queue
  // enforces. Reported while the creator is still choosing countries rather
  // than only at the moment an upload is refused.
  const [room, setRoom] = useState<Record<string, number>>({})
  // EVERY BATCH, not just the open one. The page used to find the first
  // unlaunched batch and show that, so the moment one finished it vanished:
  // ten videos scheduled over ten days and no record of them on the page that
  // scheduled them.
  const [batches, setBatches] = useState<BatchSummary[]>([])
  const [launched, setLaunched] = useState<{ scheduled: number; firstAt: string | null; lastAt: string | null; note: string } | null>(null)

  // ── load ──────────────────────────────────────────────────────────────────
  // THE BATCH ON SCREEN, read synchronously. A reply for another batch (a
  // poll, or an Amazon or Studio run that finished minutes after the creator
  // switched) used to be drawn over the one they had switched to, and the
  // next tick of a country then saved that batch's list onto this one.
  const currentId = useRef<string | null>(null)
  const load = useCallback(async (id: string, quiet = false) => {
    try {
      const r = await fetch(`/api/launch/batches/${id}`)
      const j = await r.json()
      if (currentId.current !== id) return
      // A POLL THAT FAILS IS NOT A PAGE THAT FAILED. One bad twelve-second
      // poll used to replace the whole page with an error, taking unsaved
      // edits with it. Only the load that opens a batch reports.
      if (!r.ok || !j?.ok) { if (!quiet) setError(j?.error || 'Could not load this batch.'); return }
      setError(null)
      setBatch(j.batch)
      setItems(j.items ?? [])
      setSteps(j.steps ?? [])
      setBlocker(j.launchBlocker ?? null)
      setMaxItems(j.maxItems ?? 10)
      setOwnSchedules(j.ownSchedules !== false)
      setNotifySubs(j.notifySubscribers === true)
      setNotifyAvailable(j.notifyAvailable !== false)
      setPlaylistId(j.playlistId ?? null)
      if (j.studioOptions) setStudioOpts(j.studioOptions as StudioOptions)
      setYtOptionsAvailable(j.youtubeOptionsAvailable !== false)
      setYoutubeChoiceAvailable(j.youtubeChoiceAvailable !== false)
      // ONCE. See autoOpened: after this the creator drives.
      if (!autoOpened.current) {
        const current = (j.steps ?? []).find((s: StepStatus) => s.current)
        if (current) { setOpen(current.id); autoOpened.current = true }
      }
    } catch {
      if (!quiet) setError('Could not reach the server.')
    } finally { setLoading(false) }
  }, [])

  // ── A DIFFERENT BATCH STARTS CLEAN ───────────────────────────────────────
  // What the last batch's launch, Amazon runs and Studio runs said used to
  // stay on screen for the next one: a new draft showed "Launched" and the
  // previous batch's "Automatic sending stopped".
  const showBatch = useCallback((id: string | null) => {
    currentId.current = id
    setBatchId(id)
    setLaunched(null)
    setAmazonAuto('on')
    setAmazonNote(null)
    setLiveRuns({})
    studioTried.current = new Set()
    setDirtyRows({})
    setAvail(null)
    setError(null)
    autoOpened.current = false
  }, [])

  // Find or start a batch on first paint, so the page is never an empty screen
  // with a button on it.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/launch/batches')
        const j = await r.json()
        if (!r.ok) { setError(j?.error || 'Could not read your batches.'); setLoading(false); return }
        const all = (j.batches ?? []) as BatchSummary[]
        setBatches(all)
        // The one still being worked on, or failing that the most recent, so a
        // finished batch is still what you see when you come back to the page.
        const openBatch = all.find((b) => b.state !== 'launched') ?? all[0]
        if (openBatch) { showBatch(openBatch.id); void load(openBatch.id); return }
        setLoading(false)
      } catch { setError('Could not reach the server.'); setLoading(false) }
    })()
  }, [load, showBatch])

  // THE WORK HAPPENS ELSEWHERE, so the page watches rather than drives. Slow
  // enough not to hammer the API, fast enough that a finished render shows up
  // while the creator is still looking at the screen.
  useEffect(() => {
    if (!batchId) return
    const t = setInterval(() => void load(batchId, true), 12_000)
    return () => clearInterval(t)
  }, [batchId, load])

  // The creator's playlists, once, for the picker. A failure is said beside
  // the picker rather than showing an empty list that looks like "none".
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/youtube/playlists')
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { setPlaylistsError(j?.error || 'Could not read your playlists.'); return }
        setPlaylists(Array.isArray(j?.playlists) ? j.playlists : [])
      } catch { setPlaylistsError('Could not read your playlists.') }
    })()
    void getScoutStatus().then((st) => {
      setScoutReady(st.installed)
      setScoutVersion(st.version)
      // Tell SCOUT where Liftoff lives and that it may keep going, unless
      // the creator switched it off in this browser.
      let off = false
      try { off = window.localStorage.getItem('mvp_liftoff_bg') === 'off' } catch { /* default on */ }
      if (st.installed && !off) void setLiftoffAuto(true).then(setBgState)
    }).catch(() => setScoutReady(false))
  }, [])

  /** The switcher's own list, re-read whenever it could have changed. */
  async function refreshBatches() {
    try {
      const r = await fetch('/api/launch/batches')
      const j = await r.json()
      if (r.ok && Array.isArray(j?.batches)) setBatches(j.batches as BatchSummary[])
    } catch { /* the current batch still works without the list */ }
  }

  function openBatch(id: string) {
    if (id === batchId) return
    // A DIFFERENT BATCH IS A DIFFERENT PAGE, so it gets to point at its own
    // current step rather than inheriting whichever one was open here.
    showBatch(id)
    void load(id)
  }

  async function deleteBatch(id: string, name: string, state: string) {
    const gone = state === 'launched' || state === 'launching'
    // THE TRUTH BEFORE THE CONFIRM. This is the one delete on the page where
    // somebody could reasonably expect the videos to come down with it.
    const ok = window.confirm(gone
      ? `Delete "${name}"?\n\nThis removes MVP's record of the batch. The videos stay on YouTube and the listings stay on Amazon exactly where they are.`
      : `Delete "${name}"? It has not gone out, so nothing is published yet.`)
    if (!ok) return
    setBusy('batch')
    try {
      const r = await fetch(`/api/launch/batches/${id}${gone ? '?confirm=1' : ''}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j?.error || 'Could not delete that batch.'); return }
      toast.success('Batch deleted.')
      // The page has to pick a new one to show, and the list it picks from has
      // just changed, so both are re-read rather than guessed at.
      const rest = batches.filter((b) => b.id !== id)
      setBatches(rest)
      if (id === batchId) {
        const next = rest.find((b) => b.state !== 'launched') ?? rest[0]
        showBatch(next?.id ?? null)
        if (next) await load(next.id)
        else { setBatch(null); setItems([]) }
      }
      await refreshBatches()
    } finally { setBusy(null) }
  }

  async function renameBatch(id: string, current: string) {
    const name = window.prompt('Name this batch', current)?.trim()
    if (!name || name === current) return
    setBusy('batch')
    try {
      const r = await fetch(`/api/launch/batches/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!r.ok) { toast.error('Could not rename that batch.'); return }
      await refreshBatches()
      if (id === batchId) await load(id)
    } finally { setBusy(null) }
  }

  async function startBatch() {
    setBusy('new')
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const r = await fetch('/api/launch/batches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // THEIR OWN ZONE, from their own browser. Everything about when a video
        // goes public depends on it.
        body: JSON.stringify({ timezone: tz }),
      })
      const j = await r.json()
      if (!r.ok || !j?.ok) { toast.error(j?.error || 'Could not start a batch.'); return }
      // A NEW BATCH IS A NEW PAGE, so it may point at step one.
      showBatch(j.id)
      await refreshBatches()
      await load(j.id)
    } finally { setBusy(null) }
  }

  // Refreshed whenever the board is, so a batch launched in another tab does
  // not leave this number describing an hour ago.
  useEffect(() => {
    let cancelled = false
    const pull = async () => {
      try {
        const d = await fetch('/api/global-sync/daily-room').then(r => r.json()).catch(() => ({}))
        if (cancelled || !Array.isArray(d?.dailyRoom)) return
        const next: Record<string, number> = {}
        for (const r of d.dailyRoom as Array<{ domain: string; left: number }>) next[r.domain] = r.left
        setRoom(next)
      } catch { /* the countries still tick without it */ }
    }
    void pull()
    const t = setInterval(pull, 60_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  // THE SAME DELIVERY THE STOREFRONT BOARD USES, not a copy. The dub check and
  // the daily cap live in lib/storefront-delivery, because two uploaders agree
  // only until one of them learns something.
  async function uploadToAmazon(opts?: { auto?: boolean }): Promise<DeliveryOutcome | null> {
    const auto = opts?.auto === true
    if (amazonRunning.current) return null
    // ONE SCOUT JOB AT A TIME. The automatic passes kept Studio and Amazon
    // apart, but the buttons did not: pressing one while the other ran sent
    // SCOUT into both at once.
    if (studioRunning.current) {
      if (!auto) toast('SCOUT is finishing a video in YouTube Studio. Amazon goes as soon as it is done.', { duration: 8000 })
      return null
    }
    // NO COUNTRIES MEANS NOTHING TO SEND, not every country. An empty list was
    // left off the request, and the queue read that as "all of them".
    if ((batch?.markets.length ?? 0) === 0) {
      if (!auto) toast.error('No Amazon countries are picked for this batch, so there is nothing to send.')
      return null
    }
    amazonRunning.current = true
    setAmazonBusy(true)
    try {
      // SCOPED TO THIS BATCH. Unscoped, this delivers the creator's whole
      // account queue: the first real run picked the US and Germany and
      // watched SCOUT open Spain, France and Italy.
      const videoIds = items.map((i) => i.video_id).filter((v): v is string => !!v)
      if (videoIds.length === 0) {
        if (!auto) toast('None of these are on YouTube yet, so Amazon has nothing to take. That happens first.', { duration: 9000 })
        return null
      }
      const forBatch = batchId
      const out = await deliverPreparedStorefronts({
        videoIds,
        domains: batch?.markets.map((m) => m.domain) ?? [],
        // A press means try again, failures included; the automatic run
        // leaves a refused listing alone until somebody asks.
        retryFailed: !auto,
      })
      const lines = deliverySummary(out)
      // SWITCHED BATCH WHILE IT RAN: this answer belongs to the other one,
      // and must not be drawn under the batch now on screen.
      if (currentId.current !== forBatch) return out
      setAmazonNote({ at: new Date(), lines, error: !!out.error })
      // SCOUT ALREADY UPLOADING (the background tab) is not a failure of the
      // automatic run, and a red toast every two minutes said it was.
      if (auto && out.error && /still uploading/i.test(out.error)) return out
      // AUTOMATIC IS QUIET UNLESS SOMETHING HAPPENED. The note under the
      // button always says the latest run; a toast only when listings went up
      // or it went wrong, not every two minutes that nothing was ready.
      if (out.error) { toast.error(lines.join(' '), { duration: 15000 }); await load(batchId!); return out }
      if (out.nothingReady) { if (!auto) toast(lines.join(' '), { duration: 9000 }); return out }
      // Green only when every listing went; a mix is said as a mix.
      if (out.failed.length === 0) toast.success(lines[0])
      else toast.error(lines.join(' '), { duration: 15000 })
      if (!auto && out.failed.length === 0) for (const l of lines.slice(1)) toast(l, { duration: 12000 })
      await load(batchId!)
      return out
    } catch {
      toast.error('Could not reach SCOUT. Is the extension installed?', { duration: 9000 })
      setAmazonNote({ at: new Date(), lines: ['Could not reach SCOUT. Is the extension installed?'], error: true })
      return { ok: false, error: 'scout', handedOver: 0, duplicates: 0, failed: [], waitingOnDub: 0, atCap: [], dailyRoom: [], nothingReady: false }
    } finally { amazonRunning.current = false; setAmazonBusy(false) }
  }

  async function moveItem(id: string, direction: 'up' | 'down') {
    setBusy('batch')
    try {
      const r = await fetch(`/api/launch/items/${id}/move`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j?.error || 'Could not move that one.'); return }
      await load(batchId!)
    } finally { setBusy(null) }
  }

  async function retryItem(id: string) {
    setBusy('batch')
    try {
      const r = await fetch(`/api/launch/items/${id}/retry`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j?.error || 'Could not try that again.'); return }
      toast.success(j.message || 'Trying again.')
      await load(batchId!)
    } finally { setBusy(null) }
  }

  async function patchBatch(body: Record<string, unknown>) {
    if (!batchId) return
    setBusy('batch')
    try {
      const r = await fetch(`/api/launch/batches/${batchId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j?.error || 'Could not save that.'); return }
      // WHAT WAS REFUSED, SAID OUT LOUD. The save succeeds with the bad field
      // dropped, so without this a creator picks a look, sees a green tick, and
      // gets ten thumbnails that never used it.
      if (Array.isArray(j?.rejected) && j.rejected.length > 0) {
        toast(j.rejected.join(' '), { duration: 10000 })
      }
      // NOT autoOpened = false. Saving is not navigating: resetting it here is
      // what folded the countries step shut on the first country ticked.
      await load(batchId)
    } finally { setBusy(null) }
  }

  /** One Studio step on or off, saved with the batch. */
  function setStudioOpt(k: keyof StudioOptions, v: boolean) {
    const next = { ...studioOpts, [k]: v }
    setStudioOpts(next)
    void patchBatch({ studioOptions: next })
  }

  /**
   * SCOUT in YouTube Studio for one video, with the batch's steps.
   *
   * THE REPORT IS STUDIO'S. Every step comes back with what Studio showed
   * after the click, and that is what the row keeps and draws. A draft's own
   * Schedule is only given the time this video already has on YouTube, so the
   * Studio pass can never move a launch.
   */
  async function finishInStudio(it: Item): Promise<StoredStudioRun | null> {
    if (!it.youtube_video_id || studioRunning.current) return null
    if (amazonRunning.current) {
      toast('SCOUT is sending to Amazon right now. Try Studio again when it has finished.', { duration: 8000 })
      return null
    }
    studioRunning.current = true
    setStudioBusy(it.id)
    try {
      // THE SAME REQUEST THE BACKGROUND TAB SENDS (lib/studio-finish).
      const fin = await requestStudioFinish(it.youtube_video_id, liftoffStudioRequest(it, studioOpts, notifySubs))
      // SCOUT NEVER STARTED: nothing to keep. Storing it used to mark the
      // video as done-with for the automatic pass, on every later visit too.
      lastStudioError.current = fin.error ?? null
      if (fin.error === 'not-installed') {
        toast.error('SCOUT did not answer, so nothing was done in Studio. Reload SCOUT and this page.')
        return null
      }
      // SCOUT IS ON ANOTHER VIDEO (the background tab, say): nothing was done
      // here, so nothing is kept, and the automatic pass may try again.
      if (fin.error === 'busy') {
        studioTried.current.delete(it.id)
        // AND WAITS A MINUTE. The retry straight after used to ask SCOUT
        // again every second and a half for as long as the other run took.
        studioBusyUntil.current = Date.now() + 60_000
        return null
      }
      liveRaw.current[it.id] = fin
      const run = storeStudioRun(fin, new Date(), liveRuns[it.id] ?? it.studio_finish)
      setLiveRuns((prev) => ({ ...prev, [it.id]: run }))
      const r = await fetch(`/api/launch/items/${it.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studioFinish: run }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        toast.error(j?.error || 'SCOUT finished, but its report could not be kept.')
      } else if (batchId) {
        await load(batchId)
      }
      return run
    } finally {
      studioRunning.current = false
      setStudioBusy(null)
      // Straight on to the next video that needs it, if any.
      setTimeout(() => studioTick.current(), 1500)
    }
  }

  /** Every video on YouTube whose Studio steps have not all read back, one
   *  at a time, because each one takes over a Studio tab. */
  async function finishAllInStudio() {
    if (studioRunning.current) return
    const todo = items.filter((i) => !!i.youtube_video_id && !(liveRuns[i.id] ?? i.studio_finish)?.ok)
    let done = 0
    // The automatic pass stands aside while this runs, so the two never try
    // to start the same video.
    studioManual.current = true
    try {
      for (const it of todo) {
        studioTried.current.add(it.id)
        const run = await finishInStudio(it)
        if (run?.ok) done++
        // finishInStudio keeps nothing when SCOUT never started, so the
        // reason is read from the ref: one "did not answer" stops the lot
        // instead of one toast per video.
        if (lastStudioError.current === 'not-installed' || lastStudioError.current === 'busy') break
      }
    } finally { studioManual.current = false }
    if (todo.length > 0) {
      toast(done === todo.length
        ? `Studio steps read back on all ${done}.`
        : `Studio steps read back on ${done} of ${todo.length}. Each row says where the others stopped.`, { duration: 8000 })
    }
  }

  // ── videos ────────────────────────────────────────────────────────────────
  async function addFiles(files: FileList | null) {
    if (!files || !batchId) return
    const room = maxItems - items.length
    const picked = Array.from(files).slice(0, Math.max(0, room))
    if (picked.length === 0) {
      toast.error(`A batch holds ${maxItems} videos. Launch this one, or start another.`)
      return
    }
    if (files.length > picked.length) {
      // SAID, not silently trimmed. Dropping twelve files and getting ten with
      // no explanation is how somebody launches without two of their videos.
      toast(`Taking the first ${picked.length}. A batch holds ${maxItems}.`, { duration: 7000 })
    }
    const supabase = createBrowserClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toast.error('Not signed in.'); return }

    setUploading(picked.length)
    for (const file of picked) {
      try {
        if (!file.type.startsWith('video/')) { toast.error(`${file.name} is not a video.`); continue }
        if (file.size > 500 * 1024 * 1024) {
          toast.error(`${file.name} is ${(file.size / 1024 / 1024).toFixed(0)}MB. Keep them under 500MB.`)
          continue
        }
        const probed = await probeVideo(file)
        // THE SAME RULE AS VIDEO LAUNCHPAD. That path refuses vertical and
        // points at Clip Factory; a batch that quietly accepted it would burn a
        // CTA positioned against a 16:9 preview onto a 9:16 frame, and the
        // creator would find out ten renders later.
        if (probed.width > 0 && probed.height > 0 && probed.height > probed.width) {
          toast.error(`${file.name} looks vertical. This path is for horizontal videos, so use Clip Factory for Shorts.`)
          continue
        }
        const durationSec = probed.duration
        const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
        const path = `${user.id}/batch-${crypto.randomUUID()}.${ext}`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: upErr } = await (supabase.storage as any)
          .from('instagram-videos')
          .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'video/mp4' })
        if (upErr) throw new Error(upErr.message || 'Upload failed')
        const { data: urlData } = supabase.storage.from('instagram-videos').getPublicUrl(path)
        const r = await fetch(`/api/launch/batches/${batchId}/items`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceUrl: urlData.publicUrl,
            // A PLACEHOLDER, AND MARKED AS ONE. This is the file's name, not a
            // title anybody chose, and a file name reached YouTube as a title
            // because nothing downstream could tell the difference. MVP writes
            // a real one from the product unless the creator types their own.
            title: file.name.replace(/\.[^.]+$/, ''),
            titleSource: 'filename',
            durationSeconds: durationSec,
          }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j?.error || 'Could not add that video.')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not add ${file.name}.`)
      } finally {
        setUploading((n) => Math.max(0, n - 1))
      }
    }
    await load(batchId)
  }

  async function removeItem(id: string) {
    setBusy(id)
    try {
      const r = await fetch(`/api/launch/items/${id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j?.error || 'Could not remove that.'); return }
      if (batchId) await load(batchId)
    } finally { setBusy(null) }
  }

  async function patchItem(id: string, body: Record<string, unknown>) {
    setBusy(id)
    try {
      const r = await fetch(`/api/launch/items/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j?.error || 'Could not save that.'); return }
      if (j?.resolvedFromLink) toast.success(`Found ${j.resolvedFromLink} behind that link.`)
      if (batchId) await load(batchId)
    } finally { setBusy(null) }
  }

  // ── countries ─────────────────────────────────────────────────────────────
  async function checkSignin(domains: string[]) {
    if (domains.length === 0) return
    setBusy('signin')
    try {
      const res = await requestStorefrontPreflight(domains)
      if (!res?.ok || !Array.isArray(res.results)) {
        toast.error(res?.error || 'SCOUT could not check your stores. Is the extension installed?')
        return
      }
      const next: Record<string, string> = {}
      for (const r of res.results) next[r.domain] = String(r.status)
      setSignin(next)
      const ready = res.results.filter((r) => r.status === 'ready').length
      toast.success(`Signed in on ${ready} of ${res.results.length}.`)
    } catch {
      toast.error('Could not reach SCOUT.')
    } finally { setBusy(null) }
  }

  // ── launch ────────────────────────────────────────────────────────────────
  async function launch() {
    if (!batchId) return
    // IN launch() ITSELF, not only on the buttons. There are two Launch
    // buttons on this page (the step and the sticky bar) and the first draft
    // of this guard was on one of them.
    const pending = items.filter((i) => dirtyRows[i.id]).map((i) => i.position + 1)
    if (pending.length > 0) {
      toast.error(pending.length === 1
        ? `Video ${pending[0]} has a time you changed but have not set. Press Set on it first.`
        : `Videos ${pending.join(', ')} have times you changed but have not set. Press Set on each first.`)
      return
    }
    setBusy('launch')
    try {
      const r = await fetch(`/api/launch/batches/${batchId}/launch`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j?.error || 'Could not launch.', { duration: 14000 }); return }
      setLaunched({ scheduled: j.scheduled, firstAt: j.firstAt, lastAt: j.lastAt, note: j.note })
      // THE BACKGROUND WAKES NOW, not in five minutes, so closing the page
      // straight after Launch still gets everything done.
      if (bgPref && scoutReady) void applyBg(true, 1)
      if (Array.isArray(j.leftBehind) && j.leftBehind.length > 0) {
        // NAMED. Launching nine of ten and saying nothing is the silence this
        // codebase keeps producing.
        toast.error(
          `${j.leftBehind.length} ${j.leftBehind.length === 1 ? 'video was' : 'videos were'} left behind: `
          + j.leftBehind.map((x: { title: string; reason: string }) => `${x.title || 'untitled'} (${x.reason || 'not ready'})`).join('; '),
          { duration: 18000 },
        )
      }
      await load(batchId)
    } finally { setBusy(null) }
  }

  // ── render ────────────────────────────────────────────────────────────────
  if (loading) {
    return <p className="text-[13px] inline-flex items-center gap-2" style={muted}><Loader2 size={14} className="animate-spin" /> Loading…</p>
  }
  if (error) {
    return <p className="text-[13px]" style={{ color: '#dc2626' }}>{error}</p>
  }
  if (!batchId || !batch) {
    return (
      <div className="max-w-xl">
        <p className="text-[13.5px] mb-4" style={muted}>
          Set up to ten videos in one sitting. You choose the CTA and the countries once, give each
          video its own product, then press Launch and leave it.
        </p>
        <button
          onClick={() => void startBatch()} disabled={busy === 'new'}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#0EA5A4,#0891B2)' }}
        >
          {busy === 'new' ? <><Loader2 size={15} className="animate-spin" /> Starting…</> : <><Plus size={15} /> Start a batch</>}
        </button>
      </div>
    )
  }

  const step = (id: string) => steps.find((s) => s.id === id)
  const toggle = (id: string) => { autoOpened.current = true; setOpen(open === id ? null : id) }
  const slots = batch.daily_slots ?? []
  // THE SAME FUNCTION THE LAUNCH ROUTE USES, over the same list of videos, so
  // the time beside each video is the time YouTube is given. Keyed by id: a
  // video with its own date keeps it, and the rest follow the pattern.
  const schedule = scheduleItems(items.map((i) => ({
    id: i.id, customDate: i.custom_publish_date, customTime: i.custom_publish_time,
  })), { timezone: batch.timezone, slots, startOn: batch.start_on ?? '' })
  // LOCKED PER VIDEO, once the uploader has its time (or it is on YouTube).
  // A video left behind at launch, or kept private after a missed slot, is
  // not, and a new time is what it needs.
  const keptPrivate = (i: Item) => i.state === 'blocked' && !!i.youtube_video_id && /^Kept private\./.test(i.reason || '')
  const rowLocked = (i: Item) => i.state === 'scheduled' || i.state === 'published' || (!!i.planned_publish_at && !keptPrivate(i))
  // ONLY VIDEOS STILL TO BE LAUNCHED. "These go public as soon as they are
  // uploaded" was printed over a batch launched days ago, about videos that
  // were already live.
  const goingNow = items.filter((i) => {
    if (rowLocked(i)) return false
    const sc = schedule.get(i.id)
    return !!sc && sc.at.getTime() <= Date.now()
  }).length
  // Ready, with no upload time: left behind at launch and fixed since, or
  // given a new time after a missed slot. Launch these too sends them.
  const latecomers = items.filter((i) => i.state === 'prepared' && !i.planned_publish_at)
  const unsaved = items.filter((i) => dirtyRows[i.id]).map((i) => i.position + 1)
  const scheduleLocked = batch.state === 'launching' || batch.state === 'launched'
  // YouTube and Amazon, unless the creator chose Amazon only (migration 369).
  const youtubeOn = batch.send_to_youtube !== false

  const stateWord = (st: string) =>
    st === 'launched' ? 'Launched' : st === 'launching' ? 'Going out' : st === 'ready' ? 'Ready' : 'Being set up'

  return (
    <div className="max-w-3xl flex flex-col gap-3">
      {/* ── EVERY BATCH, NOT JUST THIS ONE ──────────────────────────────────
          A launched batch used to disappear the moment it finished: ten
          videos scheduled across ten days, and the page that scheduled them
          showed an empty "start a batch" screen. */}
      {batches.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {batches.map((b) => {
            const on = b.id === batchId
            return (
              <span key={b.id}
                className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-lg border text-[12px]"
                style={{
                  borderColor: on ? '#0EA5A4' : 'var(--border)',
                  background: on ? 'rgba(14,165,164,0.08)' : 'transparent',
                }}>
                <button type="button" onClick={() => openBatch(b.id)} className="text-left" style={text}>
                  <span className="font-medium">{b.name}</span>
                  <span style={muted}>{' \u00b7 '}{b.videos} {b.videos === 1 ? 'video' : 'videos'}{' \u00b7 '}{stateWord(b.state)}</span>
                </button>
                {/* RENAME AND DELETE LIVE ON THE THING THEY ACT ON. A list of
                    rows you cannot act on teaches people to ignore the list. */}
                <button type="button" onClick={() => void renameBatch(b.id, b.name)} disabled={busy === 'batch'}
                  title="Rename this batch" className="leading-none disabled:opacity-40" style={muted}>
                  <Wand2 size={11} />
                </button>
                <button type="button" onClick={() => void deleteBatch(b.id, b.name, b.state)} disabled={busy === 'batch'}
                  title="Delete this batch" className="leading-none disabled:opacity-40" style={muted}>
                  <Trash2 size={11} />
                </button>
              </span>
            )
          })}
          {/* ALWAYS AVAILABLE. Somebody who posts three a day wants the next
              batch set up while the last one is still going out. */}
          <button type="button" onClick={() => void startBatch()} disabled={busy === 'new'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] disabled:opacity-60"
            style={{ borderColor: 'var(--border)', ...muted }}>
            {busy === 'new' ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
            New batch
          </button>
        </div>
      )}

      {/* ── WHERE YOU ARE, IN ONE LINE ──────────────────────────────────────
          Six accordions, one open at a time, and no way to see how many were
          left. A creator three steps in could not tell whether they were
          nearly finished or had barely started, which is the difference
          between carrying on and giving up. */}
      <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="flex items-center gap-2.5 flex-wrap">
          {steps.map((st, i) => (
            <span key={st.id} className="flex items-center gap-2.5">
              <span
                title={`${st.title}: ${st.detail}`}
                className="inline-flex items-center justify-center rounded-full text-[10px] font-bold"
                style={{
                  width: 18, height: 18,
                  background: st.done ? '#10B981' : st.current ? '#0EA5A4' : 'var(--surface-hover)',
                  color: st.done || st.current ? '#fff' : 'var(--text-2)',
                }}>
                {st.done ? <Check size={10} /> : i + 1}
              </span>
              {i < steps.length - 1 && (
                <span style={{ width: 14, height: 2, borderRadius: 2, background: st.done ? '#10B981' : 'var(--border)' }} />
              )}
            </span>
          ))}
          <span className="text-[12px] ml-1" style={muted}>
            {steps.filter((st) => st.done).length} of {steps.length} done
          </span>
        </div>

        <p className="text-[13px] mt-3" style={text}>
          <strong>{items.length}</strong> of {maxItems} videos in <strong>{batch.name}</strong>.
        </p>
        {/* HOW LONG, because "press Launch and walk away" is the whole promise
            and nobody walks away from a screen that will not say. */}
        {prepEta(items as unknown as ItemRow[]) && (
          <p className="text-[12.5px] mt-1 inline-flex items-center gap-1.5" style={{ color: '#0EA5A4' }}>
            <Clock size={12} /> {prepEta(items as unknown as ItemRow[])}
          </p>
        )}
        <p className="text-[12.5px] mt-1" style={muted}>
          MVP burns your CTA into each one, builds the thumbnails, writes each country&apos;s title and
          dubs the audio. All of that runs on our servers with this tab shut. The one part that needs
          your browser is the Amazon upload, because it goes through your own logged-in Creator account.
        </p>
      </div>

      {/* ── 1. videos ──────────────────────────────────────────────────────── */}
      <StepCard
        n={1} title={step('videos')?.title ?? 'Add your videos'}
        detail={step('videos')?.detail ?? ''} done={!!step('videos')?.done}
        current={!!step('videos')?.current} open={open === 'videos'} onToggle={() => toggle('videos')}
      >
        <div className="flex flex-col gap-3">
          <label
            className="rounded-xl border border-dashed px-4 py-6 text-center cursor-pointer"
            style={{ borderColor: 'var(--border)' }}
          >
            <input
              type="file" accept="video/*" multiple className="hidden"
              onChange={(e) => { void addFiles(e.target.files); e.currentTarget.value = '' }}
            />
            <Upload size={18} style={{ color: '#0EA5A4', margin: '0 auto 6px' }} />
            <span className="block text-[13px] font-medium" style={text}>
              {uploading > 0 ? `Uploading ${uploading}…` : 'Choose videos'}
            </span>
            <span className="block text-[11.5px] mt-0.5" style={muted}>
              Pick several at once. Up to {maxItems} per batch, under 500MB each.
            </span>
          </label>

          {items.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {items.map((it) => (
                <li key={it.id} className="flex items-center gap-2 rounded-lg border px-3 py-2"
                  style={{ borderColor: 'var(--border)' }}>
                  <span className="text-[11px] tabular-nums w-5" style={muted}>{it.position + 1}</span>
                  <span className="flex-1 min-w-0 truncate text-[12.5px]" style={text}>
                    {it.title || 'Untitled'}
                  </span>
                  <span className="text-[11px]" style={{ color: TONE[itemStateTone(it.state as never)] }}>
                    {itemStateLabel(it.state as never)}
                  </span>
                  <button onClick={() => void removeItem(it.id)} disabled={busy === it.id}
                    className="p-1 rounded disabled:opacity-50" title="Remove">
                    <Trash2 size={13} style={muted} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </StepCard>

      {/* ── 2. the CTA ─────────────────────────────────────────────────────── */}
      <StepCard
        n={2} title={step('cta')?.title ?? 'Choose your CTA'}
        detail={step('cta')?.detail ?? ''} done={!!step('cta')?.done}
        current={!!step('cta')?.current} open={open === 'cta'} onToggle={() => toggle('cta')}
        optional={stepIsOptional('cta')}
      >
        <CtaPicker
          value={batch.cta}
          saving={busy === 'batch'}
          onSave={(preset) => void patchBatch({ cta: preset, ctaChosen: true })}
        />
      </StepCard>

      {/* ── 3. the thumbnail look ──────────────────────────────────────────── */}
      <StepCard
        n={3} title={step('thumbnail')?.title ?? 'Choose your thumbnail look'}
        detail={step('thumbnail')?.detail ?? ''} done={!!step('thumbnail')?.done}
        current={!!step('thumbnail')?.current} open={open === 'thumbnail'} onToggle={() => toggle('thumbnail')}
        optional={stepIsOptional('thumbnail')}
      >
        <ThumbnailPicker
          value={batch.thumbnail}
          chosen={!!batch.thumbnail_chosen}
          saving={busy === 'batch'}
          onSave={(preset) => void patchBatch({ thumbnail: preset, thumbnailChosen: true })}
        />
      </StepCard>

      {/* ── 4. countries ───────────────────────────────────────────────────── */}
      <StepCard
        n={4} title={step('countries')?.title ?? 'Pick your Amazon countries'}
        detail={step('countries')?.detail ?? ''} done={!!step('countries')?.done}
        current={!!step('countries')?.current} open={open === 'countries'} onToggle={() => toggle('countries')}
      >
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px]" style={muted}>
            Chosen once for the whole batch. A country that does not speak English gets its own title,
            its own dubbed audio and the thumbnail with no words on it, all made by MVP.
          </p>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
            {MARKETS.map((m) => {
              const on = batch.markets.some((x) => x.domain === m.domain)
              const state = signin[m.domain]
              return (
                <button
                  key={m.domain} type="button" disabled={busy === 'batch'}
                  onClick={() => {
                    const next = on
                      ? batch.markets.filter((x) => x.domain !== m.domain).map((x) => x.domain)
                      : [...batch.markets.map((x) => x.domain), m.domain]
                    void patchBatch({ markets: next })
                  }}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left disabled:opacity-60"
                  style={{
                    borderColor: on ? '#0EA5A4' : 'var(--border)',
                    background: on ? 'rgba(14,165,164,0.07)' : 'transparent',
                  }}
                >
                  <span className="shrink-0 rounded flex items-center justify-center"
                    style={{ width: 16, height: 16, border: `1.5px solid ${on ? '#0EA5A4' : 'var(--border)'}`, background: on ? '#0EA5A4' : 'transparent' }}>
                    {on && <Check size={11} color="#fff" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-medium truncate" style={text}>{m.country}</span>
                    <span className="block text-[11px]" style={muted}>
                      {/* WHAT THIS COUNTRY ACTUALLY RECEIVES, including which
                          of the two thumbnails. The text-free copy is a
                          deliberate choice, not a thumbnail that failed, and
                          the only place it was ever said was the step above. */}
                      {m.needsTranslation
                        ? `${m.langName}, dubbed \u00b7 thumbnail with no words`
                        : 'English \u00b7 thumbnail with the hook'}
                    </span>
                    {/* DOES AMAZON SELL THE PRODUCT HERE, per video, from the
                        same check the storefront grid makes. Said before the
                        tick, because the other way round a creator launched
                        to seven countries and six could not take one video. */}
                    {(() => {
                      const row = avail?.markets.find((x) => x.domain === m.domain)
                      if (!row || row.byVideo.length === 0) {
                        return availLoading && productKey
                          ? <span className="block text-[11px]" style={muted}>Checking which products are sold here…</span>
                          : null
                      }
                      const name = (id: string) => avail!.videos.find((v) => v.id === id)?.title ?? 'a video'
                      const n = row.byVideo.length
                      const sold = row.byVideo.filter((v) => v.verdict === 'sold' || v.verdict === 'out_of_stock')
                      const notSold = row.byVideo.filter((v) => v.verdict === 'not_sold')
                      const oos = row.byVideo.filter((v) => v.verdict === 'out_of_stock')
                      const cannot = row.byVideo.every((v) => v.verdict === 'cannot_check')
                      // NOT CHECKED AND CANNOT CHECK BOTH COUNT AS UNKNOWN. A
                      // mix of sold and cannot-check used to read "Sells all"
                      // in green.
                      const unchecked = row.byVideo.filter((v) => v.verdict === 'not_checked' || v.verdict === 'cannot_check')
                      if (cannot) {
                        return <span className="block text-[11px]" style={muted}>Cannot be checked ahead of time here. If Amazon does not sell it, the upload fails and the row says so</span>
                      }
                      return (
                        <span className="block text-[11px]">
                          {notSold.length === 0 && unchecked.length === 0 && (
                            <span style={{ color: '#10B981' }}>{n === 1 ? 'Sells this product' : `Sells all ${n} products`}</span>
                          )}
                          {notSold.length > 0 && (
                            <span style={{ color: notSold.length === n ? '#ef4444' : '#d97706' }}>
                              {notSold.length === n
                                ? (n === 1 ? 'Does not sell this product' : `Sells none of the ${n} products`)
                                : `Sells ${sold.length} of ${n}. Not sold: ${notSold.map((v) => name(v.id)).join(', ')}`}
                            </span>
                          )}
                          {notSold.length === 0 && unchecked.length > 0 && (
                            <span style={muted}>{`Sells ${sold.length} of ${n}; ${unchecked.length} not checked yet`}</span>
                          )}
                          {oos.length > 0 && (
                            <span className="block" style={{ color: '#d97706' }}>Out of stock today: {oos.map((v) => name(v.id)).join(', ')}</span>
                          )}
                        </span>
                      )
                    })()}
                    {/* ROOM LEFT TODAY, before the wall rather than at it.
                        Amazon takes twenty a day on the US store and ten
                        everywhere else, and a number that stops moving with no
                        explanation reads as something broken. */}
                    {on && room[m.domain] !== undefined && (
                      <span className="block text-[11px]"
                        style={{ color: room[m.domain] === 0 ? '#d97706' : 'var(--text-2)' }}>
                        {room[m.domain] === 0
                          ? 'full for today, the rest go tomorrow'
                          : `${room[m.domain]} more today`}
                      </span>
                    )}
                  </span>
                  {/* THE FACT, not the tick. Being signed in is something SCOUT
                      reports; ticking is a decision. A screen that conflates
                      them promises listings in a country nobody can reach. */}
                  {state === 'ready' && <Check size={13} style={{ color: '#10B981' }} />}
                  {state && state !== 'ready' && <AlertTriangle size={13} style={{ color: '#d97706' }} />}
                </button>
              )
            })}
          </div>
          {/* WHY SOME SAY "NOT CHECKED", rather than leaving it to look like
              a verdict. */}
          {avail?.skipped && (
            <p className="text-[11.5px]" style={{ color: '#d97706' }}>
              {avail.skipped === 'low_tokens'
                ? 'The product lookup service is busy right now, so some countries are not checked yet. Reopen this step in a few minutes.'
                : 'The product lookup service is not available right now, so some countries are not checked. That is not the same as not sold.'}
            </p>
          )}
          {batch.markets.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => void checkSignin(batch.markets.map((m) => m.domain))}
                disabled={busy === 'signin'}
                className="inline-flex items-center gap-1.5 text-[12.5px] px-3 py-1.5 rounded-lg border disabled:opacity-50"
                style={{ borderColor: 'var(--border)', ...text }}
              >
                {busy === 'signin' ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />}
                Check I am signed in
              </button>
              <span className="text-[11.5px]" style={muted}>
                MVP uploads through your own Amazon Creator account, so you need to be signed in to each.
              </span>
            </div>
          )}
        </div>
      </StepCard>

      {/* ── 5. products, the only per-video step ───────────────────────────── */}
      <StepCard
        n={5} title={step('products')?.title ?? 'Set each product'}
        detail={step('products')?.detail ?? ''} done={!!step('products')?.done}
        current={!!step('products')?.current} open={open === 'products'} onToggle={() => toggle('products')}
      >
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px]" style={muted}>
            The one thing that cannot be shared: every video sells its own product. Paste the ASIN or
            the Amazon link, and MVP will follow a shortened one to the end.
          </p>
          {items.length === 0 && <p className="text-[12.5px]" style={muted}>Add some videos first.</p>}
          {items.map((it, i) => (
            <ItemRowEditor key={it.id} item={it} busy={busy === it.id} onSave={patchItem}
              onMove={moveItem} first={i === 0} last={i === items.length - 1} />
          ))}
        </div>
      </StepCard>

      {/* ── 5. cadence and launch ──────────────────────────────────────────── */}
      <StepCard
        n={6} title={step('schedule')?.title ?? 'Schedule your YouTube posts'}
        detail={step('schedule')?.detail ?? ''} done={!!step('schedule')?.done}
        current={!!step('schedule')?.current} open={open === 'schedule'} onToggle={() => toggle('schedule')}
      >
        <div className="flex flex-col gap-4">
          {/* ── WHERE THIS BATCH GOES ────────────────────────────────────────
              YouTube and Amazon, or Amazon only (what Video Launchpad's
              "skip YouTube" did). Amazon only has no schedule, no notify
              switch and no YouTube options, so they are not on the page. */}
          <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
            <p className="text-[12.5px] font-medium mb-2" style={text}>Where do these videos go?</p>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              {([
                [true, 'YouTube and Amazon', 'Scheduled on YouTube at your times, then to every Amazon country you picked.'],
                [false, 'Amazon only', 'Skip YouTube. Each video goes to your Amazon storefronts as soon as it is ready.'],
              ] as Array<[boolean, string, string]>).map(([v, label, hint]) => {
                const on = youtubeOn === v
                return (
                  <button key={label} type="button"
                    disabled={scheduleLocked || busy === 'batch' || (!v && !youtubeChoiceAvailable)}
                    onClick={() => { if (!on) void patchBatch({ sendToYouTube: v }) }}
                    className="text-left rounded-lg border px-3 py-2 disabled:opacity-60"
                    style={{ borderColor: on ? '#0EA5A4' : 'var(--border)', background: on ? 'rgba(14,165,164,0.07)' : 'transparent' }}>
                    <span className="block text-[12.5px] font-semibold" style={text}>{label}</span>
                    <span className="block text-[11.5px]" style={muted}>{hint}</span>
                  </button>
                )
              })}
            </div>
            {!youtubeChoiceAvailable && (
              <p className="text-[11.5px] mt-2" style={{ color: '#d97706' }}>
                Amazon only needs a database update (migration 369). Until then batches go to YouTube and Amazon.
              </p>
            )}
          </div>

          {youtubeOn && (<>
          {/* WHICH PLATFORM THIS IS, up front. The step used to say "cadence"
              and nothing else, and the first person to read it asked where
              YouTube was. The two halves behave completely differently and the
              screen has to say so rather than let a creator assume. */}
          <p className="text-[12.5px] px-3 py-2 rounded-lg" style={{ ...muted, background: 'var(--surface-hover)' }}>
            This is the <strong style={text}>YouTube</strong> schedule. Each video goes up private and
            YouTube makes it public at the time you pick. If a time passes before its video has finished
            uploading, it stays private and its row asks you for a new time. Nothing goes public that you
            did not choose.
            {batch.markets.length > 0 && (
              <> Your <strong style={text}>Amazon</strong> storefronts are not on a schedule: each listing
                goes up as soon as its translation and dub are done.</>
            )}
          </p>

          {/* ── EACH VIDEO, ITS OWN DATE AND TIME ─────────────────────────────
              The creator decides when every video goes out. Each row is the
              time that video will actually get, and changing it gives the
              video its own. Worked out with the same function the launch
              route uses, over the same list, so what is on screen is what
              YouTube is given. */}
          {items.length > 0 && (
            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
              <p className="text-[12.5px] font-medium mb-0.5" style={text}>
                <Clock size={12} style={{ display: 'inline', marginRight: 4 }} />
                When each video goes public on YouTube
              </p>
              <p className="text-[11.5px] mb-2" style={muted}>
                {ownSchedules
                  ? <>Pick any day and any time for any video. Times are yours: {batch.timezone}.</>
                  // SAID, not hidden. Without migration 364 the columns do not
                  // exist, and an editor whose every save was refused would be
                  // worse than no editor.
                  : <>Every video follows the daily pattern below for now. Giving each video its own
                    date and time needs a database update (migration 364) that has not been run yet.</>}
              </p>
              <ul className="flex flex-col gap-1">
                {items.map((it) => (
                  <ScheduleRow
                    key={it.id}
                    n={it.position + 1}
                    title={it.title || ''}
                    sched={schedule.get(it.id)}
                    fixedAt={it.publish_at ?? it.planned_publish_at ?? null}
                    timezone={batch.timezone}
                    locked={rowLocked(it)}
                    available={ownSchedules}
                    busy={busy === it.id}
                    onSet={(date, time) => void patchItem(it.id, { schedule: { date, time } })}
                    onReset={() => void patchItem(it.id, { schedule: null })}
                    onDirty={(v) => markDirty(it.id, v)}
                  />
                ))}
              </ul>
              {/* AND WHAT AMAZON DOES, which is not on this schedule at all.
                  The list above is YouTube only, and reading it as the whole
                  plan is what made a creator ask whether Amazon was waiting
                  for the same date. */}
              {batch.markets.length > 0 && (
                <p className="text-[11.5px] mt-2 pt-2" style={{ ...muted, borderTop: '1px solid var(--border)' }}>
                  Amazon is not on this schedule. Each of your {batch.markets.length} {batch.markets.length === 1 ? 'storefront' : 'storefronts'} gets
                  its listing as soon as that country&apos;s translation and dub are done, up to {' '}
                  {batch.markets.map((m) => `${m.country} ${room[m.domain] ?? (m.domain === 'amazon.com' ? 20 : 10)}`).join(', ')} more today.
                </p>
              )}
            </div>
          )}

          {/* ── NOTIFY SUBSCRIBERS: ON MEANS YES, OFF MEANS NO ─────────────────
              Off by default. Whatever this says is sent to YouTube explicitly
              on every upload and every scheduling call; YouTube's own default
              is to notify, which is how batch videos used to ring the bell
              with no switch anywhere. Locked once launched, because the
              uploader may already have sent the answer. */}
          <label className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${notifyAvailable && !scheduleLocked ? 'cursor-pointer' : 'cursor-not-allowed'}`}
            style={{ borderColor: 'var(--border)' }}>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-medium" style={text}>Notify subscribers</span>
              <span className="block text-[11.5px]" style={muted}>
                {!notifyAvailable
                  ? 'Needs a database update (migration 366). Until then these videos do not notify anyone.'
                  : notifySubs
                    ? 'On: YouTube notifies your subscribers when each video goes public.'
                    : 'Off: your subscribers are not notified when these go public.'}
              </span>
            </span>
            <button
              type="button" role="switch" aria-checked={notifySubs}
              disabled={!notifyAvailable || scheduleLocked || busy === 'batch'}
              onClick={() => void patchBatch({ notifySubscribers: !notifySubs })}
              className="relative shrink-0 rounded-full transition-colors disabled:opacity-50"
              style={{ width: 40, height: 22, background: notifySubs ? '#0EA5A4' : 'var(--border)' }}
            >
              <span className="absolute top-[3px] rounded-full bg-white transition-all"
                style={{ width: 16, height: 16, left: notifySubs ? 21 : 3 }} />
            </button>
          </label>

          {/* ── YOUTUBE OPTIONS ─────────────────────────────────────────────
              The playlist is set by the uploader, through YouTube's API. The
              Studio steps are the settings that API cannot touch, and SCOUT
              does them in Studio when Finish in Studio is pressed on the
              board, reading each one back. Nothing here runs by itself. */}
          <div className="rounded-xl border p-3 flex flex-col gap-2.5" style={{ borderColor: 'var(--border)' }}>
            <p className="text-[12.5px] font-medium" style={text}>YouTube options</p>
            {!ytOptionsAvailable && (
              <p className="text-[11.5px] px-2 py-1 rounded" style={{ color: '#d97706', background: 'rgba(217,119,6,0.08)' }}>
                Needs a database update (migration 367). Until then no playlist is used and Studio results are not kept after a reload.
              </p>
            )}
            <label className="block text-[12px]" style={text}>
              Playlist
              <select
                value={playlistId ?? ''}
                disabled={!ytOptionsAvailable || busy === 'batch' || !playlists}
                onChange={(e) => void patchBatch({ playlistId: e.target.value || null })}
                className="block mt-1 w-full px-3 py-2 rounded-lg border text-sm bg-transparent disabled:opacity-60"
                style={{ borderColor: 'var(--border)', ...text }}
              >
                <option value="">None</option>
                {(playlists ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                {/* A saved playlist the list no longer has (deleted, or the
                    list failed) is still shown, by id, rather than silently
                    reading as None. */}
                {playlistId && playlists && !playlists.some((p) => p.id === playlistId) && (
                  <option value={playlistId}>Saved playlist ({playlistId})</option>
                )}
              </select>
              <span className="block text-[11px] mt-1" style={playlistsError ? { color: '#d97706' } : muted}>
                {playlistsError
                  ?? (scheduleLocked
                    ? 'Videos already on YouTube are added within a minute or two; the rest as they upload. Each row says whether YouTube took it.'
                    : playlists === null ? 'Reading your playlists…'
                    : playlists.length === 0 ? 'Your channel has no playlists yet.'
                    : 'Every video in this batch is added to it as it uploads.')}
              </span>
            </label>
            <div>
              <p className="text-[12px]" style={text}>Studio steps SCOUT does for each video once it is on YouTube</p>
              <div className="mt-1.5 flex flex-col gap-1.5">
                {([
                  ['disclosures', 'Paid promotion: Yes, and AI use: No', 'Untick if these videos are AI generated or altered.'],
                  ['monetize', 'Monetization: On', 'Skipped on a channel without it.'],
                  ['adRating', 'Ad suitability: None of the above, then Submit rating', 'YouTube checks this rating, so only tick it when it is true.'],
                  ['tagProduct', 'Tag each video\u2019s product', 'Only the exact match for its Amazon link, never a similar product.'],
                  ['endScreen', 'End screen imported from your latest video', ''],
                ] as Array<[keyof StudioOptions, string, string]>).map(([k, label, hint]) => {
                  const off = k === 'adRating' && !studioOpts.monetize
                  return (
                    <label key={k} className={`flex items-start gap-2 text-[12px] ${off ? 'opacity-50' : 'cursor-pointer'}`} style={text}>
                      <input type="checkbox" className="mt-0.5"
                        checked={studioOpts[k] && !off}
                        disabled={off || busy === 'batch' || !ytOptionsAvailable}
                        onChange={(e) => setStudioOpt(k, e.target.checked)} />
                      <span>{label}{hint && <span className="block text-[11px]" style={muted}>{hint}</span>}</span>
                    </label>
                  )
                })}
              </div>
              <p className="text-[11px] mt-1.5" style={muted}>
                Notify subscribers in Studio follows the switch above ({notifySubs ? 'on' : 'off'}).
                {' '}They run by themselves after launch, one video at a time, while Chrome is open. Untick anything that is not true for these videos before then.
                {scoutReady === false && ' SCOUT is not installed in this browser, so it cannot.'}
                {scoutReady === true && !scoutCanStudio && ` Your SCOUT is ${scoutVersion ?? 'an older version'}; these steps need the latest SCOUT.`}
              </p>
            </div>
          </div>

          {/* ── THE PATTERN, NOW THE SHORTCUT ─────────────────────────────────
              Still the quick way to fill ten videos in one go. It only sets
              the videos that have no time of their own, so a hand-picked time
              is never overwritten by changing it.
              NOT SHOWN WHEN THERE IS NO "REST". A creator who timed every
              video by hand was shown "Daily pattern, for the rest" with 09:00
              in it, read it as a second schedule, and asked whether Amazon was
              going out one a day. It governs nothing in that case, so it is not
              on the page; clear any video's own time and it comes back. */}
          {items.length > 0 && items.every((i) => !!i.custom_publish_date && !!i.custom_publish_time) ? (
            <p className="text-[11.5px] rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--border)', ...muted }}>
              Every video has its own YouTube date and time, so no daily pattern is used.
            </p>
          ) : (
          <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
            <p className="text-[12.5px] font-medium mb-0.5" style={text}>YouTube daily pattern, for videos without their own time</p>
            <p className="text-[11.5px] mb-2" style={muted}>
              Videos without their own time go out on YouTube on this pattern, in batch order: one per time,
              per day. {slots.length > 0 ? cadenceLabel(slots) + '.' : 'No pattern set.'} Amazon does not follow it.
            </p>
            <SlotEditor
              slots={slots}
              disabled={busy === 'batch' || scheduleLocked}
              onChange={(next) => void patchBatch({ dailySlots: next })}
            />
            <label className="block text-[12px] font-medium mt-3" style={text}>
              Starting
              <input
                type="date"
                value={batch.start_on ?? ''}
                min={earliestDay(batch.timezone)}
                disabled={scheduleLocked}
                onChange={(e) => void patchBatch({ startOn: e.target.value })}
                className="block mt-1 px-3 py-2 rounded-lg border text-sm bg-transparent"
                style={{ borderColor: 'var(--border)', ...text }}
              />
            </label>
          </div>
          )}

          </>)}

          {/* SAID BEFORE THE BUTTON, not after. Going public is the one thing
              on this page that cannot be undone, so a creator about to do it
              immediately should read that first. */}
          {/* AMBER, NOT GREEN. Green on this page means done and good; this
              is the one action here that cannot be undone, and a creator who
              did not mean it lost a scheduled launch to a sentence that looked
              like good news. */}
          {goingNow > 0 && (
            <p className="text-[12.5px] px-3 py-2 rounded-lg" style={{ color: '#d97706', background: 'rgba(217,119,6,0.08)' }}>
              {goingNow === items.length
                ? 'Those times have gone today, so these go public as soon as they are uploaded.'
                : `${goingNow} of these ${goingNow === 1 ? 'goes' : 'go'} public as soon as ${goingNow === 1 ? 'it is' : 'they are'} uploaded, because ${goingNow === 1 ? 'its time has' : 'those times have'} gone today. The rest wait for theirs.`}
            </p>
          )}

          {/* AN UNSAVED TIME STOPS THE LAUNCH, and says which. Launching now
              would give YouTube the old time while the screen shows the new
              one. */}
          {unsaved.length > 0 && (
            <p className="text-[12.5px] px-3 py-2 rounded-lg" style={{ color: '#d97706', background: 'rgba(217,119,6,0.08)' }}>
              {unsaved.length === 1
                ? `Video ${unsaved[0]} has a time you changed but have not set. Press Set on it first.`
                : `Videos ${unsaved.join(', ')} have times you changed but have not set. Press Set on each first.`}
            </p>
          )}

          {/* THE REASON, always. A disabled button with nothing beside it is the
              dead end this codebase keeps producing. */}
          {/* Not after launch: "nothing is ready to launch" printed over a
              batch that had just launched read as something going wrong. */}
          {blocker && !scheduleLocked && (
            <p className="text-[12.5px] px-3 py-2 rounded-lg" style={{ color: '#d97706', background: 'rgba(217,119,6,0.08)' }}>
              {blocker}
            </p>
          )}

          <button
            ref={setMainLaunchEl}
            onClick={() => void launch()}
            disabled={!!blocker || unsaved.length > 0 || busy === 'launch' || batch.state === 'launching' || batch.state === 'launched'}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#0EA5A4,#0891B2)' }}
          >
            {busy === 'launch'
              ? <><Loader2 size={16} className="animate-spin" /> Launching…</>
              : batch.state === 'launched' || batch.state === 'launching'
                ? <><Check size={16} /> Launched</>
                : <><Rocket size={16} /> Launch {items.length} {items.length === 1 ? 'video' : 'videos'}</>}
          </button>
        </div>
      </StepCard>

      {/* ── after the launch ───────────────────────────────────────────────── */}
      {/* GONE ON RELOAD, WHICH IS WHEN IT WAS WANTED. This panel, and with it
          the only Upload to Amazon button on the page, was drawn from a piece
          of state set by pressing Launch. Refresh the tab and it vanished, so
          a creator coming back to a launched batch found nothing to press and
          no sign Amazon was ever part of it. The batch's own state says it was
          launched, and that survives a reload. */}
      {(launched || batch.state === 'launched' || batch.state === 'launching') && (() => {
        // WHAT THE ROWS SAY, NOT WHAT THE LAUNCH CALL PROMISED. This panel used
        // `launched.scheduled`, a number captured from the launch reply and
        // never revisited, so it read "1 video scheduled" in green above a
        // board reading "Cannot go" for that same video.
        const out = launchOutcome(items as unknown as ItemRow[])
        // THE TIMES COME FROM THE ROWS TOO when this is a reload rather than a
        // press, for the same reason the counts do.
        const live = items
          .filter((i) => (i.state === 'scheduled' || i.state === 'published') && i.publish_at)
          .map((i) => String(i.publish_at)).sort()
        // THE ROWS ONLY. The launch reply carries the PLANNED times, and it
        // used to win: the header read "First on 23 Sept, 17:00" over a video
        // that actually went live at 18:09, and "last on 24 Sept" over one
        // that was not on YouTube at all. The rows hold what YouTube did.
        const firstAt = live[0] ?? null
        const lastAt = live[live.length - 1] ?? null
        const shade = out.tone === 'warn' ? '#d97706' : out.tone === 'busy' ? '#0EA5A4' : '#10B981'
        const when = (iso: string) =>
          new Intl.DateTimeFormat('en-GB', { timeZone: batch.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
        return (
        <div className="rounded-2xl border p-4" style={{ borderColor: shade, background: `${shade}12` }}>
          <p className="text-[13.5px] font-semibold flex items-center gap-1.5" style={{ color: shade }}>
            {out.tone === 'warn' ? <AlertTriangle size={14} /> : out.tone === 'busy' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {out.headline}
          </p>
          {/* THE TIMES ONLY WHEN THERE IS SOMETHING TO TIME. Printing the
              schedule under a batch where nothing published is the plan
              reported as the result, one line lower down. */}
          {out.onYouTube > 0 && firstAt && lastAt && (
            <p className="text-[12.5px] mt-1" style={muted}>
              {firstAt === lastAt
                ? `Public on ${when(firstAt)}.`
                : `First on ${when(firstAt)}, last on ${when(lastAt)}.`}
            </p>
          )}
          {out.blocked > 0 && (
            <p className="text-[12.5px] mt-1" style={muted}>
              The board below says what stopped each one, and Try again puts it back in the queue.
            </p>
          )}
          {/* THE ONES THE LAUNCH DID NOT TAKE, ready now. They used to sit on
              ready forever: only Launch gives a video its upload time, and
              Launch refused a second press. */}
          {latecomers.length > 0 && (
            <div className="mt-2 flex items-center gap-3 flex-wrap rounded-lg px-3 py-2" style={{ background: 'rgba(217,119,6,0.08)' }}>
              <span className="text-[12.5px] flex-1 min-w-0" style={{ color: '#d97706' }}>
                {latecomers.length === 1 ? 'Video' : 'Videos'} {latecomers.map((i) => i.position + 1).join(', ')} {latecomers.length === 1 ? 'is' : 'are'} ready
                but not launched yet. {batch.send_to_youtube === false
                  ? `${latecomers.length === 1 ? 'It goes' : 'They go'} to Amazon as soon as ${latecomers.length === 1 ? 'it is' : 'they are'} launched.`
                  : `${latecomers.length === 1 ? 'It goes' : 'They go'} at ${latecomers.length === 1 ? 'its' : 'their'} own time, or the daily pattern.`}
                {/* WHY THE BUTTON IS GREYED, said beside it rather than left
                    for a press that comes back refused. */}
                {blocker && <span className="block mt-0.5" style={{ color: 'var(--text)' }}>{blocker}</span>}
              </span>
              <button onClick={() => void launch()} disabled={busy === 'launch' || unsaved.length > 0 || !!blocker}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white disabled:opacity-50"
                style={{ background: '#0EA5A4' }}>
                {busy === 'launch' ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
                Launch {latecomers.length === 1 ? 'this one' : `these ${latecomers.length}`} too
              </button>
            </div>
          )}

          {/* ── THE TWO SIDES ARE NOT ON THE SAME CLOCK, AND ONE IS MANUAL ───
              This box said "Amazon: straight away" and then, three lines on,
              that Amazon needed this tab open. Both sentences were in view at
              once and only one of them could be true. Nothing about Amazon is
              automatic: SCOUT drives the creator's own signed-in Creator
              account from this tab, and the heading now says so. */}
          <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
            {youtubeOn && <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
              <p className="text-[12px] font-semibold" style={text}>YouTube: automatic</p>
              <p className="text-[11.5px] mt-1" style={muted}>
                Each video is uploaded for you, private, with paid promotion and AI use set through YouTube&apos;s own API and read back,
                and YouTube makes it public at the time you picked. What only Studio can set (the notify box, monetization,
                the ad rating, product tag, end screen) SCOUT does by itself as each video reaches YouTube, while Chrome is open.
              </p>
            </div>}
            <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
              <p className="text-[12px] font-semibold" style={text}>Amazon: automatic while Chrome is open</p>
              <p className="text-[11.5px] mt-1" style={muted}>
                Not on the YouTube schedule. Once a video is launched and a country&apos;s translation and dub are done, SCOUT sends it to that storefront by itself.
                Amazon has no way for MVP to upload from its servers, so SCOUT does it in your Chrome, signed in as you: on this page while it is open, and in a pinned background tab when it is closed (the switch below).
                Amazon takes 20 a day on the US store and 10 a day on each other one, which is its rule, not ours.
              </p>
            </div>
          </div>

          {/* THE REASON BEFORE THE PRESS. This button used to be live whatever
              the batch was doing, and told you only afterwards, in a toast,
              that there was nothing for it to send. */}
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <button
              onClick={() => { setAmazonAuto('on'); void uploadToAmazon() }}
              disabled={amazonBusy || !!studioBusy || !!out.amazonBlocker || batch.markets.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-white disabled:opacity-45"
              style={{ background: '#0EA5A4' }}>
              {amazonBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {amazonBusy ? 'Sending to Amazon…' : `Send to Amazon now (${batch.markets.length} ${batch.markets.length === 1 ? 'country' : 'countries'})`}
            </button>
            <span className="text-[11.5px] min-w-0 flex-1" style={out.amazonBlocker ? { color: '#d97706' } : muted}>
              {out.amazonBlocker
                ?? `${batch.markets.map((m) => m.country).join(', ')}. SCOUT uses your own signed-in Creator account, so keep this tab open while it runs.`}
            </span>
          </div>
          {/* ── KEEP GOING WHEN THIS PAGE IS CLOSED ─────────────────────────── */}
          {scoutReady && (
            <div className="mt-3 flex items-start justify-between gap-3 rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium" style={text}>Keep going when this page is closed</span>
                <span className="block text-[11.5px]" style={
                  bgPref && bgState && (bgState.ok === false || !bgState.hasAlarms || bgState.lastRun === 'signed-out' || bgState.lastRun === 'timed-out') ? { color: '#d97706' } : muted}>
                  {!bgPref
                    ? 'Off: the Studio steps and Amazon uploads only run while this page is open.'
                    : bgState?.error === 'bad-origin'
                      ? 'SCOUT only keeps Liftoff going from mvpaffiliate.io. Open Liftoff there for this to work.'
                    : bgState?.error === 'no-reply'
                      ? 'SCOUT did not answer, so nothing will run with this page closed. Update SCOUT to the latest version, then reload this page.'
                    : bgState && !bgState.hasAlarms
                      ? 'Your SCOUT is too old for this. Update SCOUT to the latest version, then reload this page.'
                      : bgState?.lastRun === 'signed-out'
                        ? 'The last background run found you signed out of MVP in this browser, so it could not do anything. Stay signed in and it carries on.'
                        : 'On: while Chrome is open, SCOUT checks every few minutes and, with this page closed, opens Liftoff in a pinned background tab to finish the Studio steps and Amazon uploads, then closes it.'}
                  {bgPref && bgState?.lastRunAt ? ` Last run: ${new Date(bgState.lastRunAt).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} (${({ 'all-done': 'all done', waiting: 'more to do', 'timed-out': 'stopped answering, closed', 'tab-closed': 'its tab was closed', 'could-not-open': 'could not open a tab', 'signed-out': 'signed out', opened: 'running now', armed: 'waiting to start' } as Record<string, string>)[bgState.lastRun ?? ''] ?? bgState.lastRun})` : ''}
                </span>
              </span>
              <button
                type="button" role="switch" aria-checked={bgPref}
                onClick={() => toggleBg(!bgPref)}
                className="relative shrink-0 rounded-full transition-colors"
                style={{ width: 40, height: 22, background: bgPref ? '#0EA5A4' : 'var(--border)' }}
              >
                <span className="absolute top-[3px] rounded-full bg-white transition-all"
                  style={{ width: 16, height: 16, left: bgPref ? 21 : 3 }} />
              </button>
            </div>
          )}
          {/* WHAT THE AUTOMATIC SEND IS DOING, in its own words, so "on" and
              "stopped" and "nothing ready yet" never look the same. */}
          <p className="mt-2 text-[11.5px]" style={amazonNote?.error || amazonAuto === 'stopped' || scoutReady === false ? { color: '#d97706' } : muted}>
            {scoutReady === false
              ? 'SCOUT is not installed in this browser, so Amazon cannot go by itself. Install SCOUT, then reload this page.'
              : amazonAuto === 'stopped'
                ? `Automatic sending stopped: ${amazonNote?.lines.join(' ') || 'the last run did not go through'} Fix that, then press Send to Amazon now.`
                : amazonNote
                  ? `Automatic, checked at ${amazonNote.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: ${amazonNote.lines.join(' ')} Checks again every two minutes.`
                  : 'Automatic: checks every two minutes while this page is open.'}
          </p>
        </div>
        )
      })()}

      {/* ── WHERE EVERY VIDEO LANDED ─────────────────────────────────────────
          The one place that answers "did it all go out", read from what came
          back: YouTube's own read of each video, SCOUT's read of Studio, and
          each storefront's answer. "All done" only when nothing is working. */}
      {scheduleLocked && items.length > 0 && (
        <LaunchReport
          items={items as unknown as ReportItem[]}
          markets={batch.markets.map((m) => m.domain)}
          timezone={batch.timezone}
          playlistChosen={!!playlistId}
          studioPossible={scoutCanStudio && youtubeOn}
        />
      )}

      {/* ── EVERY DECISION, IN ONE PLACE, BEFORE THE IRREVERSIBLE BUTTON ────
          The settings are spread over six collapsed steps, and the moment
          they all matter at once is the moment somebody is about to publish.
          Scrolling back through six accordions to check what you chose is not
          reviewing, it is hoping. */}
      {!blocker && !launched && !scheduleLocked && items.length > 0 && (
        <div className="rounded-2xl border p-4" style={{ borderColor: '#0EA5A4', background: 'rgba(14,165,164,0.05)' }}>
          <p className="text-[13px] font-semibold mb-2" style={text}>What pressing Launch does</p>
          <ul className="flex flex-col gap-1">
            {batchRecap(
              { ...batch, markets: batch.markets.map((m) => m.domain) } as never,
              items as unknown as ItemRow[],
            ).map((line) => (
              <li key={line} className="text-[12.5px] flex gap-2" style={muted}>
                <Check size={13} style={{ color: '#0EA5A4', flexShrink: 0, marginTop: 2 }} />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── THE BUTTON IS NEVER SOMEWHERE YOU HAVE TO FIND ──────────────────
          Launch lived inside step six, so reaching it meant scrolling past
          everything and opening an accordion. It rides along now, with the
          reason it is disabled beside it rather than nowhere. */}
      {!scheduleLocked && items.length > 0 && !mainLaunchInView && (
        <div className="sticky bottom-3 z-10 rounded-xl border px-3 py-2.5 flex items-center gap-3 flex-wrap"
          style={{
            borderColor: blocker ? 'var(--border)' : '#0EA5A4',
            background: 'var(--surface)',
            boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
          }}>
          <button
            onClick={() => void launch()}
            disabled={!!blocker || unsaved.length > 0 || busy === 'launch'}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-45 shrink-0"
            style={{ background: 'linear-gradient(135deg,#0EA5A4,#0891B2)' }}>
            {busy === 'launch' ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
            {launched ? 'Launched' : `Launch ${items.filter((i) => i.state === 'prepared').length || items.length}`}
          </button>
          <span className="text-[12px] min-w-0 flex-1" style={blocker || unsaved.length > 0 ? { color: '#d97706' } : muted}>
            {/* THE REASON, ALWAYS. A greyed button with nothing beside it is
                the dead end this codebase keeps producing. */}
            {blocker ?? (unsaved.length > 0
              ? `Set the time you changed on ${unsaved.length === 1 ? `video ${unsaved[0]}` : `videos ${unsaved.join(', ')}`} first.`
              : launched
              ? 'Already on its way. The board below says where each one is.'
              : 'Everything is answered. This schedules YouTube and starts Amazon.')}
          </span>
        </div>
      )}

      {/* ── the board: what is actually happening to each video ────────────── */}
      {items.length > 0 && (
        <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
            <h2 className="text-[13px] font-semibold" style={text}>Where each video is</h2>
            {/* ONE AT A TIME, ON PURPOSE. Each run takes over a Studio tab for
                a minute or two, and two at once would fight over it. */}
            {scoutCanStudio && items.some((i) => !!i.youtube_video_id) && (
              <button onClick={() => void finishAllInStudio()} disabled={!!studioBusy || amazonBusy}
                className="text-[12px] px-3 py-1.5 rounded-lg font-semibold text-white disabled:opacity-50"
                style={{ background: '#0EA5A4' }}>
                {studioBusy ? 'SCOUT is in Studio…' : 'Finish all in Studio'}
              </button>
            )}
          </div>
          <ul className="flex flex-col gap-1.5">
            {items.map((it) => (
              <li key={it.id} className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5"
                style={{ borderColor: 'var(--border)' }}>
                {it.thumbnail_url
                  ? <Image src={it.thumbnail_url} alt="" width={64} height={36} unoptimized
                      style={{ width: 64, height: 36, objectFit: 'cover', borderRadius: 4 }} />
                  : <span className="shrink-0 rounded" style={{ width: 64, height: 36, background: 'var(--surface-hover)' }} />}
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] truncate" style={text}>{it.title || 'Untitled'}</span>
                  <span className="block text-[11.5px]" style={{ color: TONE[itemProgressTone(it as never)] }}>
                    {itemProgressLabel(it as never)}
                    {/* THE LOOK THAT WAS ACTUALLY USED, at a glance. The reason
                        below says it in a sentence, but a creator scanning ten
                        rows reads the colours, and a thumbnail built the wrong
                        way looked identical to one built the right way. */}
                    {it.thumbnail_source === 'plain' && (
                      <> · <span style={{ color: '#d97706' }}>plain look</span></>
                    )}
                    {/* WHOSE TITLE THIS IS. A file name and a written title
                        look the same on a row, and one of them went to
                        YouTube as "STEAM BRUSH WORKS?" while the channel's
                        other videos read like titles. */}
                    {(it.title_source ?? 'filename') === 'filename' && (
                      <> · <span style={{ color: '#d97706' }}>still your file name</span></>
                    )}
                    {it.title_source === 'mvp' && (
                      <> · <span style={{ color: '#86868b' }}>title by MVP</span></>
                    )}
                    {/* NO DESCRIPTION MEANS NO AFFILIATE LINK, and the CTA
                        burned into the frame says there is one. A video that
                        earns nothing must not look identical to one that
                        does. */}
                    {!it.description && (it.state === 'prepared' || it.state === 'scheduled' || it.state === 'published') && (
                      <> · <span style={{ color: '#d97706' }}>no link in the description</span></>
                    )}
                    {/* WORKING AND STUCK MUST NOT READ THE SAME.
                        "Building the thumbnail" said the same thing one second
                        in and forty minutes in, which is the failure this
                        codebase keeps producing in new shapes. The attempt
                        count and the time since anything last happened are the
                        two facts that separate them. */}
                    {(it.state === 'rendering' || it.state === 'preparing') && (
                      <> · {progressNote(it)}</>
                    )}
                    {/* THE THUMBNAIL ON THE CHANNEL, not the one in this row.
                        The image to the left is the file we designed, and it
                        was drawn here whether or not YouTube ever took it,
                        which for a long time it never did. */}
                    {(it.state === 'scheduled' || it.state === 'published') && (
                      it.thumbnail_set_at
                        ? <> · <span style={{ color: '#10B981' }}>thumbnail set</span></>
                        : <> · <span style={{ color: '#d97706' }}>YouTube picked its own frame</span></>
                    )}
                    {/* PAST TENSE WHEN IT HAS HAPPENED. "Live on YouTube · goes
                        live 23 Sept, 18:09" said both in one line. */}
                    {it.publish_at && (
                      <> · {it.state === 'published' ? 'went live' : 'goes live'} {new Intl.DateTimeFormat('en-GB', {
                        timeZone: batch.timezone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
                      }).format(new Date(it.publish_at))}</>
                    )}
                  </span>
                  {/* AMAZON, COUNTRY BY COUNTRY, as recorded. Uploaded, failed
                      with SCOUT's reason, waiting on its dub, or ready and not
                      sent yet each read differently; a batch whose every
                      upload failed used to look the same as one that went. */}
                  {(it.amazon?.length ?? 0) > 0 && (
                    <span className="block text-[11.5px] mt-0.5">
                      {it.amazon!.map((a, i) => {
                        const c = MARKETS.find((m) => m.domain === a.domain)?.country ?? a.domain
                        const [word, colour] = a.state === 'delivered' ? ['on Amazon', '#10B981']
                          : a.state === 'failed' ? ['failed', '#ef4444']
                          : a.state === 'localized' ? (a.waitingOnDub ? ['dubbing', '#0EA5A4'] : ['ready to send', '#d97706'])
                          // From the coverage grid: no listing made yet.
                          : a.state === 'grid:blocked' ? ['cannot go', '#ef4444']
                          : a.state === 'grid:live' || a.state === 'grid:uploaded' ? ['on Amazon', '#10B981']
                          : a.state === 'grid:unknown' ? ['not checked yet', 'var(--text-2)']
                          : ['preparing', 'var(--text-2)']
                        return (
                          <span key={a.domain} title={a.state === 'failed' && a.detail ? a.detail : undefined}>
                            {i > 0 && <span style={muted}> · </span>}
                            <span style={text}>{c}</span> <span style={{ color: colour }}>{word}</span>
                          </span>
                        )
                      })}
                    </span>
                  )}
                  {it.amazon?.some((a) => (a.state === 'failed' || a.state === 'grid:blocked') && a.detail) && (
                    <span className="block text-[11.5px] mt-0.5 px-2 py-1 rounded" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.08)' }}>
                      {it.amazon.filter((a) => (a.state === 'failed' || a.state === 'grid:blocked') && a.detail).map((a) =>
                        `${MARKETS.find((m) => m.domain === a.domain)?.country ?? a.domain}: ${a.detail}`).join(' · ')}
                    </span>
                  )}
                  {/* THE PLAYLIST, as YouTube answered. A video missing from
                      its playlist must not look like one that is in it. */}
                  {it.youtube_video_id && playlistId && (it.playlist_added_at || it.playlist_error) && (
                    <span className="block text-[11.5px]" style={{ color: it.playlist_added_at ? '#10B981' : '#d97706' }}>
                      {it.playlist_added_at ? 'In the playlist' : `Not added to the playlist: ${it.playlist_error}`}
                    </span>
                  )}
                  {/* THE STUDIO STEPS, AS STUDIO READ THEM BACK. Never run,
                      all read back, and stopped part way each read
                      differently at a glance; the list opens for the detail. */}
                  {it.youtube_video_id && (() => {
                    const run = liveRuns[it.id] ?? it.studio_finish ?? null
                    if (studioBusy === it.id) {
                      return <span className="block text-[11.5px] mt-0.5" style={{ color: '#0EA5A4' }}>SCOUT is in YouTube Studio with this video…</span>
                    }
                    if (!run) {
                      return <span className="block text-[11.5px] mt-0.5" style={{ color: '#d97706' }}>
                        {scoutCanStudio
                          ? 'Studio steps not done yet. SCOUT does them by itself while this page is open.'
                          : scoutReady === true
                            ? `Studio steps not done: they need the latest SCOUT, and this browser has ${scoutVersion ?? 'an older one'}.`
                            : 'Studio steps not done: SCOUT is not installed in this browser.'}
                      </span>
                    }
                    const asResult = { ok: run.ok, steps: run.steps, error: run.error ?? undefined, path: run.path ?? undefined }
                    return (
                      <details className="mt-0.5">
                        <summary className="text-[11.5px] cursor-pointer select-none" style={{ color: run.ok ? '#10B981' : '#d97706' }}>
                          {studioRunHeadline(asResult)}
                        </summary>
                        <ul className="mt-1 flex flex-col gap-0.5 pl-1">
                          {studioPathNote(asResult.path) && (
                            <li className="text-[11px]" style={muted}>{studioPathNote(asResult.path)}</li>
                          )}
                          {run.steps.filter((st) => st.step !== 'next' || !st.ok).map((st, i) => {
                            const tone = studioStepTone(st)
                            const colour = tone === 'good' ? '#10B981' : tone === 'bad' ? '#ef4444' : tone === 'note' ? '#d97706' : 'var(--text-2)'
                            return (
                              <li key={i} className="text-[11px] flex gap-1.5">
                                <span style={{ color: colour }}>{tone === 'good' ? '✓' : tone === 'bad' ? '✗' : tone === 'note' ? 'i' : '○'}</span>
                                <span style={text}><strong>{studioStepLabel(st.step)}</strong>: {studioStepText(st)}</span>
                              </li>
                            )
                          })}
                        </ul>
                        {(() => {
                          // COPIED AS TEXT: SCOUT's record of the steps that did
                          // not work, from a run made on this page. Button and
                          // option labels only, never a login.
                          const raw = liveRaw.current[it.id]
                          const bad = raw ? raw.steps.filter((x) => !x.ok && !x.skipped && x.debug && Object.keys(x.debug).length > 0) : []
                          if (bad.length === 0) return null
                          return (
                            <button type="button" className="mt-1 text-[11px] font-semibold underline" style={{ color: '#0EA5A4' }}
                              onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(bad.map((x) => ({ step: x.step, detail: x.detail, saw: x.debug })), null, 1)).then(() => toast.success('Copied. Paste it to support.')).catch(() => toast.error('Could not copy.')) }}>
                              Copy what SCOUT saw
                            </button>
                          )
                        })()}
                      </details>
                    )
                  })()}
                  {/* A NOTE, NOT A FAILURE. The video is on the channel; only
                      the image we designed for it is not. */}
                  {it.thumbnail_error && !it.reason && (
                    <span className="block text-[11.5px] mt-1 px-2 py-1 rounded"
                      style={{ color: '#d97706', background: 'rgba(217,119,6,0.08)' }}>
                      The video is up, but YouTube would not take the thumbnail we made: {it.thumbnail_error}
                    </span>
                  )}
                  {/* THE REASON STAYS. A video that could not go looks exactly
                      like one nobody picked unless the row says otherwise. */}
                  {it.reason && (
                    <span className="block text-[11.5px] mt-1 px-2 py-1 rounded"
                      style={{ color: '#d97706', background: 'rgba(217,119,6,0.08)' }}>
                      {it.reason}
                    </span>
                  )}
                </span>
                {/* A WAY BACK. Every cause "Cannot go" names is something a
                    creator can fix, and until now the only way to act on that
                    was deleting the video and starting again, which throws
                    away a finished render and two thumbnails. */}
                {/* NOT for a video kept private after a missed slot. Retrying
                    it would reach the same past time and keep it private
                    again; what it needs is a new time, which is set in
                    YouTube Studio, and the Open link beside it goes there. */}
                {it.state === 'blocked' && !/^Kept private\./.test(it.reason || '') && (
                  <button onClick={() => void retryItem(it.id)} disabled={busy === 'batch'}
                    className="text-[11.5px] px-2.5 py-1 rounded-lg border shrink-0 disabled:opacity-50"
                    style={{ borderColor: '#d97706', color: '#d97706' }}>
                    Try again
                  </button>
                )}
                {it.youtube_video_id && scoutCanStudio && (
                  <button onClick={() => void finishInStudio(it)} disabled={!!studioBusy || amazonBusy}
                    className="text-[11.5px] px-2.5 py-1 rounded-lg border shrink-0 disabled:opacity-50"
                    style={{ borderColor: '#0EA5A4', color: '#0EA5A4' }}>
                    {(liveRuns[it.id] ?? it.studio_finish) ? 'Run Studio again' : 'Finish in Studio'}
                  </button>
                )}
                {it.youtube_video_id && (
                  <a href={`https://studio.youtube.com/video/${it.youtube_video_id}/edit`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-[11.5px] underline shrink-0" style={{ color: '#0EA5A4' }}>
                    Open
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** One video's own product and title. */
/**
 * How a video that is still working is doing, in facts rather than reassurance.
 *
 * TRIES AND MINUTES. A step that is running says which attempt it is on, so a
 * creator can see it moving. A step that has not touched its row in a while
 * says how long, because that is the only difference on screen between a slow
 * image model and a worker that is not running at all, and the second one
 * needs somebody to look at it.
 */
function progressNote(it: Item): string {
  const tries = Number((it.state === 'rendering' ? it.render_tries : it.thumb_tries) ?? 0)
  const mins = it.updated_at
    ? Math.floor((Date.now() - new Date(it.updated_at).getTime()) / 60_000)
    : 0
  const attempt = tries > 1 ? `try ${tries} of 3` : 'first try'
  // Ten minutes is comfortably past a slow image model, and the drain runs
  // every minute, so nothing moving for that long is worth saying out loud.
  if (mins >= 10) return `${attempt}, nothing for ${mins} minutes`
  return attempt
}

function ItemRowEditor({
  item, busy, onSave, onMove, first, last,
}: {
  item: Item
  busy: boolean
  onSave: (id: string, body: Record<string, unknown>) => Promise<void>
  onMove: (id: string, direction: 'up' | 'down') => Promise<void>
  first: boolean
  last: boolean
}) {
  const [title, setTitle] = useState(item.title ?? '')
  const [product, setProduct] = useState(item.asin ?? '')
  const [options, setOptions] = useState<string[]>([])
  const [writing, setWriting] = useState(false)
  // THE DESCRIPTION IS WHERE THE AFFILIATE LINK GOES. MVP writes it during
  // prepare, and this is the only place it can be read or changed before it
  // reaches YouTube. Collapsed, because most people will never touch it.
  const [showDesc, setShowDesc] = useState(false)
  const [desc, setDesc] = useState(item.description ?? '')

  // THE TITLE MVP WROTE IS OFFERED, NOT APPLIED. This is the line that goes on
  // YouTube and gets translated into every other country, so it is the last
  // thing that should be changed without being read.
  async function writeTitle() {
    setWriting(true)
    try {
      // ── SAVE THE PRODUCT FIRST IF IT IS SITTING THERE UNSAVED ───────────
      //
      // The button was enabled by the text in the PRODUCT BOX and the route
      // read the SAVED row, so pasting an ASIN and pressing Write it for me
      // answered "Set the product first" while the product was plainly on
      // screen an inch away. Technically true, and it reads as broken.
      //
      // Two ways to fix that: refuse until they press Save, or press it for
      // them. A creator who typed the ASIN and asked for a title has already
      // told us everything we needed, so asking again is ceremony.
      const unsaved = product.trim() && product !== (item.asin ?? '')
      if (unsaved) {
        dirty.current = false
        await onSave(item.id, { product })
      }

      const r = await fetch(`/api/launch/items/${item.id}/title`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !Array.isArray(j?.titles)) { toast.error(j?.error || 'Could not write a title.'); return }
      setOptions(j.titles as string[])
    } finally { setWriting(false) }
  }

  // AN ASIN IS NOT A TITLE, and nothing used to stop one becoming the YouTube
  // title of ten videos and the source text for every translation.
  const titleIsAsin = !!title.trim() && !!product.trim()
    && title.trim().toUpperCase() === product.trim().toUpperCase()
  // Only adopt server values the creator has not overwritten, or a poll landing
  // mid-sentence would wipe what they are typing.
  const dirty = useRef(false)
  useEffect(() => {
    if (dirty.current) return
    setTitle(item.title ?? '')
    setProduct(item.asin ?? '')
    setDesc(item.description ?? '')
  }, [item.title, item.asin, item.description])

  const changed = title !== (item.title ?? '')
    || product !== (item.asin ?? '')
    || desc !== (item.description ?? '')
  // ONE FIELD'S SAVE MUST NOT WIPE THE OTHER. Both were always sent together,
  // so emptying one box and pressing Save deleted whatever was in it even when
  // the creator was only editing its neighbour. An empty product field is sent
  // ONLY when it was not empty to begin with, which is a deliberate clear.
  function save() {
    const body: Record<string, unknown> = {}
    if (title !== (item.title ?? '')) body.title = title
    if (product !== (item.asin ?? '')) body.product = product
    if (desc !== (item.description ?? '')) body.description = desc
    dirty.current = false
    void onSave(item.id, body)
  }

  const lab = { color: 'var(--text-2)', fontSize: 11, fontWeight: 600 } as const

  // COLLAPSED UNTIL IT NEEDS YOU. Each row carries a title box, a product box,
  // a description, two buttons and a pair of arrows. That is fine for one video
  // and a wall for ten, and the wall hides the one row that actually needs
  // attention. A row opens when it is incomplete, because that IS the row that
  // needs attention.
  const incomplete = !title.trim() || !product.trim() || titleIsAsin
  const [openRow, setOpenRow] = useState(incomplete)

  if (!openRow) {
    return (
      <div className="rounded-lg border px-3 py-2 flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
        <span className="flex flex-col items-center w-5 shrink-0">
          <button type="button" onClick={() => void onMove(item.id, 'up')} disabled={busy || first}
            title="Send this one out earlier" className="leading-none disabled:opacity-25" style={muted}>
            <ChevronUp size={12} />
          </button>
          <span className="text-[11px] tabular-nums" style={muted}>{item.position + 1}</span>
          <button type="button" onClick={() => void onMove(item.id, 'down')} disabled={busy || last}
            title="Send this one out later" className="leading-none disabled:opacity-25" style={muted}>
            <ChevronDown size={12} />
          </button>
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[12.5px] truncate" style={text}>{title || 'Untitled'}</span>
          <span className="block text-[11px] font-mono truncate" style={muted}>{product || 'No product yet'}</span>
        </span>
        <button type="button" onClick={() => setOpenRow(true)}
          className="text-[11.5px] underline shrink-0" style={muted}>
          Edit
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-lg border p-3 flex flex-col gap-2.5" style={{ borderColor: 'var(--border)' }}>
      {/* LABELLED, NOT JUST PLACEHELD. A placeholder disappears the moment a
          box has anything in it, and both boxes held the same ASIN, so there
          was nothing on screen saying which was which. The warning about the
          title was also sitting under the product box, so the box it pointed
          at was the wrong one and the product got cleared instead. */}
      <div className="flex items-start gap-2">
        {/* THE NUMBER IS THE PUBLISHING ORDER, not a label. With one post a
            day, number one goes out first and number ten goes out next week,
            and until now that was decided by the order a file dialog happened
            to return. */}
        <span className="flex flex-col items-center w-5 pt-4 shrink-0">
          <button type="button" onClick={() => void onMove(item.id, 'up')}
            disabled={busy || first} title="Send this one out earlier"
            className="leading-none disabled:opacity-25" style={muted}>
            <ChevronUp size={12} />
          </button>
          <span className="text-[11px] tabular-nums" style={muted}>{item.position + 1}</span>
          <button type="button" onClick={() => void onMove(item.id, 'down')}
            disabled={busy || last} title="Send this one out later"
            className="leading-none disabled:opacity-25" style={muted}>
            <ChevronDown size={12} />
          </button>
        </span>
        <label className="flex-1 min-w-0">
          <span className="block mb-1" style={lab}>Title, for YouTube and the English stores</span>
          <input
            value={title}
            onChange={(e) => { dirty.current = true; setTitle(e.target.value) }}
            placeholder="What this video is about"
            className="w-full px-2.5 py-1.5 rounded-lg border text-[12.5px] bg-transparent"
            style={{ borderColor: titleIsAsin ? '#d97706' : 'var(--border)', ...text }}
          />
          {/* BESIDE THE BOX IT IS ABOUT. */}
          {titleIsAsin && (
            <span className="block text-[11.5px] mt-1" style={{ color: '#d97706' }}>
              That is the ASIN, not a title. It would go on YouTube exactly as it reads and be translated into every country.
            </span>
          )}
          <button type="button" onClick={() => void writeTitle()} disabled={writing || !product.trim()}
            title={!product.trim()
              ? 'Paste the ASIN or the Amazon link first. The title is written from what the product is.'
              : 'Writes a title from the product. Saves the product first if you have not.'}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 mt-1.5 rounded-lg border text-[11.5px] disabled:opacity-40"
            style={{ borderColor: 'var(--border)', ...text }}>
            {writing ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
            Write it for me
          </button>
        </label>
      </div>

      {/* ── the description, where the affiliate link lives ──────────────── */}
      <div className="flex items-start gap-2">
        <span className="w-5" />
        <div className="flex-1 min-w-0">
          <button type="button" onClick={() => setShowDesc((v) => !v)}
            className="text-[11px] font-semibold underline" style={{ color: 'var(--text-2)' }}>
            {showDesc ? 'Hide the description' : item.description ? 'See the description' : 'Description (MVP writes it)'}
          </button>
          {showDesc && (
            <>
              <textarea
                value={desc} rows={5}
                onChange={(e) => { dirty.current = true; setDesc(e.target.value) }}
                placeholder="MVP writes this when it prepares the video, with your affiliate link in it."
                className="w-full mt-1 px-2.5 py-1.5 rounded-lg border text-[12px] bg-transparent"
                style={{ borderColor: 'var(--border)', ...text }}
              />
              <span className="block text-[11px] mt-1" style={muted}>
                This goes on YouTube as written. Your affiliate link lives in here, so the CTA burned into the video has somewhere to point.
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-end gap-2">
        <span className="w-5" />
        <label className="flex-1 min-w-0">
          <span className="block mb-1" style={lab}>Product</span>
          <input
            value={product}
            onChange={(e) => { dirty.current = true; setProduct(e.target.value) }}
            placeholder="ASIN or Amazon link"
            className="w-full px-2.5 py-1.5 rounded-lg border text-[12.5px] font-mono bg-transparent"
            style={{ borderColor: 'var(--border)', ...text }}
          />
        </label>
        <button
          onClick={save}
          disabled={busy || !changed}
          className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40 shrink-0"
          style={{ background: '#0EA5A4' }}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
        </button>
        {/* NOT WHILE THERE ARE UNSAVED EDITS. Folding a row away over typing
            somebody has not saved loses it without saying so. */}
        <button type="button" onClick={() => setOpenRow(false)} disabled={changed || incomplete}
          title={changed ? 'Save first' : incomplete ? 'This one still needs a product and a title' : 'Fold this one away'}
          className="text-[11.5px] underline shrink-0 disabled:opacity-30" style={muted}>
          Done
        </button>
      </div>

      {options.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px]" style={muted}>Pick one, then Save. You can edit it after.</span>
          {options.map((o) => (
            <button key={o} type="button"
              onClick={() => { dirty.current = true; setTitle(o); setOptions([]) }}
              className="text-left text-[12px] px-2.5 py-1.5 rounded-lg border"
              style={{ borderColor: 'var(--border)', ...text }}>
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The publishing times. The number of them IS the videos-per-day. */
function SlotEditor({
  slots, disabled, onChange,
}: {
  slots: string[]
  disabled: boolean
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('09:00')
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {slots.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px]"
            style={{ background: 'rgba(14,165,164,0.12)', color: '#0EA5A4' }}>
            {s}
            <button type="button" disabled={disabled}
              onClick={() => onChange(slots.filter((x) => x !== s))} title="Remove">
              <X size={11} />
            </button>
          </span>
        ))}
        {slots.length === 0 && <span className="text-[12px]" style={muted}>No times yet.</span>}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="time" value={draft} onChange={(e) => setDraft(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg border text-[12.5px] bg-transparent"
          style={{ borderColor: 'var(--border)', ...text }}
        />
        <button
          type="button" disabled={disabled || !draft}
          onClick={() => onChange([...slots, draft])}
          className="px-3 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-40"
          style={{ border: '1px solid var(--border)', ...text }}
        >
          Add a time
        </button>
      </div>
    </div>
  )
}

/**
 * One video's YouTube date and time, editable on its own.
 *
 * The creator decides when each of their videos goes out: this one Friday at
 * nine, that one next Tuesday at six. A row shows the time the video will
 * actually get, whether that came from the pattern or was set by hand, and
 * changing either field gives the video its own time.
 *
 * AN EDIT IS NOT SAVED UNTIL SET IS PRESSED, and the row says so. Saving on
 * every keystroke fires on half-typed times ("1" on the way to "17:00"), and
 * saving on blur races the Launch button: press Launch straight after picking
 * a date and the launch can read the time from before the edit. So the row
 * reports itself unsaved to the board, and the board refuses to launch while
 * any row is, naming which one. What is on screen is what YouTube gets.
 */
function ScheduleRow({
  n, title, sched, fixedAt, timezone, locked, available, busy, onSet, onReset, onDirty,
}: {
  n: number
  title: string
  sched: ItemSchedule | undefined
  /** When locked: the time the uploader has, or the time YouTube confirmed.
   *  Not the pattern's, which may have been changed since. */
  fixedAt?: string | null
  timezone: string
  /** Launched, or already on YouTube: the time is fixed. */
  locked: boolean
  /** False until migration 364 is run: the row shows the pattern time only. */
  available: boolean
  busy: boolean
  onSet: (date: string, time: string) => void
  onReset: () => void
  onDirty: (dirty: boolean) => void
}) {
  const [d, setD] = useState(sched?.date ?? '')
  const [t, setT] = useState(sched?.time ?? '')
  // Follow the server when it changes underneath: a pattern edit, a reorder,
  // a save coming back. Keyed on the values, not the object, which is new on
  // every render.
  useEffect(() => { setD(sched?.date ?? ''); setT(sched?.time ?? '') }, [sched?.date, sched?.time])

  const dirty = (d !== (sched?.date ?? '') || t !== (sched?.time ?? '')) && !!d && !!t
  // THROUGH A REF. The parent passes a new arrow every render, and with it in
  // the effects' deps an unsaved row ran "not dirty" (the cleanup) then
  // "dirty" on every render, two state changes that caused the next render:
  // a loop for as long as a time was typed and not set.
  const onDirtyRef = useRef(onDirty)
  onDirtyRef.current = onDirty
  useEffect(() => { onDirtyRef.current(dirty) }, [dirty])
  // FOLDED AWAY IS NOT UNSAVED. Closing the step unmounts this row and loses
  // the edit, so it must stop holding Launch back for a row nobody can see.
  useEffect(() => () => onDirtyRef.current(false), [])

  const now = !locked && sched && sched.at.getTime() <= Date.now()
  const editable = available && !locked

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] py-1" style={muted}>
      <span className="tabular-nums w-5">{n}</span>
      <span className="flex-1 min-w-[8rem] truncate" style={text}>{title || 'Untitled'}</span>
      {editable ? (
        <span className="inline-flex items-center gap-1.5 flex-wrap">
          <input
            type="date" value={d} min={todayIn(timezone)} disabled={busy}
            onChange={(e) => setD(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && dirty) onSet(d, t) }}
            aria-label={`Date for video ${n}`}
            className="px-2 py-1 rounded-md border text-[12px] bg-transparent tabular-nums"
            style={{ borderColor: dirty ? '#d97706' : 'var(--border)', ...text }}
          />
          <input
            type="time" value={t} disabled={busy}
            onChange={(e) => setT(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && dirty) onSet(d, t) }}
            aria-label={`Time for video ${n}`}
            className="px-2 py-1 rounded-md border text-[12px] bg-transparent tabular-nums"
            style={{ borderColor: dirty ? '#d97706' : 'var(--border)', ...text }}
          />
          {dirty ? (
            <button type="button" disabled={busy} onClick={() => onSet(d, t)}
              className="px-2.5 py-1 rounded-md text-[11.5px] font-semibold text-white disabled:opacity-50"
              style={{ background: '#d97706' }}>
              {busy ? <Loader2 size={11} className="animate-spin" /> : 'Set'}
            </button>
          ) : sched?.own ? (
            <>
              <span className="px-1.5 py-0.5 rounded text-[10.5px] font-semibold"
                style={{ background: 'rgba(14,165,164,0.12)', color: '#0EA5A4' }}>Own time</span>
              <button type="button" disabled={busy} onClick={onReset}
                title="Put this video back on the daily pattern"
                className="text-[11px] underline disabled:opacity-50" style={muted}>
                Use pattern
              </button>
            </>
          ) : sched ? (
            <span className="text-[10.5px]" style={muted}>from pattern</span>
          ) : (
            // NO TIME, SAID AS NO TIME. An empty pair of inputs with nothing
            // beside it reads as a glitch rather than as a question.
            <span className="text-[10.5px]" style={{ color: '#d97706' }}>needs a time</span>
          )}
        </span>
      ) : (locked && fixedAt) || sched ? (
        <span className="tabular-nums">
          {new Intl.DateTimeFormat('en-GB', {
            timeZone: timezone, weekday: 'short', day: '2-digit', month: 'short',
            hour: '2-digit', minute: '2-digit', hour12: false,
          }).format(locked && fixedAt ? new Date(fixedAt) : sched!.at)}
        </span>
      ) : (
        <span style={{ color: '#d97706' }}>no time yet</span>
      )}
      {/* NOW IS NOT A TIME, and printing this morning's slot beside a video
          that is about to go out would be the plan reported as the result. */}
      {now && !dirty && (
        <span className="basis-full pl-7 text-[11px]" style={{ color: '#d97706' }}>
          Goes public as soon as it is uploaded, because that time has gone today.
        </span>
      )}
      {dirty && (
        <span className="basis-full pl-7 text-[11px]" style={{ color: '#d97706' }}>
          Not saved yet. Press Set, or this video keeps its old time.
        </span>
      )}
    </li>
  )
}

/** A video's length and shape, read in the browser so the server never
 *  downloads it just to measure it.
 *
 *  Zeroes mean the browser could not read the metadata, and the caller treats
 *  that as "cannot tell" rather than as "not vertical": refusing a video
 *  because a probe failed would be blaming the creator for our own blind spot. */
function probeVideo(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    try {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.onloadedmetadata = () => {
        const d = Number(v.duration)
        const out = {
          duration: Number.isFinite(d) ? Math.round(d) : 0,
          width: Number(v.videoWidth) || 0,
          height: Number(v.videoHeight) || 0,
        }
        URL.revokeObjectURL(v.src)
        resolve(out)
      }
      v.onerror = () => resolve({ duration: 0, width: 0, height: 0 })
      v.src = URL.createObjectURL(file)
    } catch { resolve({ duration: 0, width: 0, height: 0 }) }
  })
}
