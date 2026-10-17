'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// DROP (Labs, admin while it is tested; Seb, 2026-10-17). THE ONE PAGE: set
// up once (where each kind of video goes, and every YouTube and Amazon
// setting), then drop videos, check each one, press Launch. "Once that setup
// is done, they never have to look at it again. They can just upload, upload,
// upload their videos, and then MVP does the rest."
//
// LONG VIDEOS ARE PREPARED WHILE YOU CHECK THEM. The first long video makes
// this drop's Liftoff batch from the setup (lib/drop-run startDraftBatch),
// and each one goes into it as soon as it is uploaded, with its own next free
// time. So the thumbnail Liftoff builds, the title, the description, the
// Amazon title, the face and the time are all on the video's own card here,
// with Liftoff's own editors, and nothing needs Liftoff opened.
//
// THE DROP BEING SET UP IS KEPT (migration 438): a reload shows the same
// videos, places and choices. Nothing is sent anywhere until Launch.
//
// THE PAGE CAN CLOSE AFTER LAUNCH. Liftoff prepares on MVP's servers; SCOUT's
// background Liftoff tab launches the batch once it is prepared and writes the
// blog posts (lib/drop-run dropSteps). Only a TRYBE send needs this page open,
// and the board says so while it runs.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, UploadCloud, X, Rocket, AlertTriangle, Settings2, Plus, Clock, RotateCcw } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { uploadResumable, ResumableUnavailable } from '@/lib/upload-resumable'
import { uploadWithProgress } from '@/lib/upload-progress'
import { freshAccessToken, saysExpired } from '@/lib/fresh-token'
import { storageSizeRefusal, BULK_VIDEO_MAX_BYTES } from '@/lib/clip-source-limits'
import { getScoutStatus, setLiftoffAuto, requestTrybeApi, requestTrybePutFile } from '@/lib/extension-frame'
import { scoutAtLeast, SCOUT_TRYBE_SUBMIT_MIN_VERSION } from '@/lib/scout-version'
import { scheduleItems, cadenceLabel } from '@/lib/launch-schedule'
import { itemProgressLabel, itemProgressTone, OPEN_ITEM_STATES, type ItemState } from '@/lib/launch-batch'
import { readBrandStats, type MyBrand } from '@/lib/trybe-mybrands'
import {
  dropKind, firstDay, readPlans, placeFits, nextFreeSlots, settingsFromLast, settingsBody, setupMissing, isStillPreparing,
  DROP_MAX, DEFAULT_PLANS, READY_PLACES, PLACE_INFO, EXTRA_PLACES,
  type DropKind, type LastBatch, type LaunchPlans, type PlaceId, type ExtraPlace, type DropSettings,
} from '@/lib/drop-plan'
import { browserHttp, dropSteps, sendDropToTrybe, startDraftBatch, addDraftVideo, type TrybeDropItem } from '@/lib/drop-run'
import DropTrybePicker, { emptyChoice, choiceBlocker, type TrybeChoice } from '@/components/labs/DropTrybePicker'
import DropResults, { TONE, type DropView, type BatchView } from '@/components/labs/DropResults'
import DropThumb from '@/components/labs/DropThumb'
import DropSetup from '@/components/labs/DropSetup'
import DropProduct from '@/components/labs/DropProduct'
import { PlaceTile, PlaceIcon, PLACES_OF, TEAL } from '@/components/labs/DropPlaces'
import DropTikTok, { emptyTikTok, tiktokBlocker, tiktokOptions, type TikTokChoice, type TikTokInfo } from '@/components/labs/DropTikTok'
import { ItemRowEditor, ScheduleRow, type Item } from '@/components/launch/LaunchBoard'
import { postVideoPin } from '@/lib/pinterest-video-pin'

const LANES = 3

interface Vid {
  key: string
  /** The drop's row for it, once it is saved. */
  itemId: string | null
  /** The creator's own file. Gone after a reload: the uploaded copy is used. */
  file: File | null
  name: string
  size: number
  type: string
  duration: number
  width: number
  height: number
  kind: DropKind
  up: 'waiting' | 'uploading' | 'done' | 'failed'
  sent: number
  error?: string
  url?: string
  asin: string
  /** Where the product came from when MVP filled it, said on the card. */
  asinFrom: 'file' | 'video' | null
  productName: string | null
  title: string
  places: PlaceId[]
  trybe: TrybeChoice
  /** The words for a vertical video's posts; empty lets MVP write them. */
  caption: string
  tiktok: TikTokChoice
  /** Its video in this drop's Liftoff batch. */
  launchItemId: string | null
  /** Being put into Liftoff right now. */
  adding: boolean
  /** Why it is not in Liftoff, when putting it there failed. */
  liftoffError: string | null
}

/** What a video's card keeps between reloads (drop_items.wish). */
interface Wish { places?: unknown; caption?: unknown; trybe?: unknown; tiktok?: unknown }

interface DraftItemRow {
  id: string; file_name: string | null; source_url: string | null; mime_type: string | null; size_bytes: number | null
  duration_seconds: number | null; width: number | null; height: number | null; kind: string; asin: string | null; title: string | null
  launch_item_id: string | null; wish?: Wish | null
}

interface DraftBatch {
  batch: { id: string; state: string; timezone: string; daily_slots: string[] | null; start_on: string | null; send_to_youtube?: boolean }
  items: Item[]
  launchBlocker: string | null
  ownSchedules: boolean
  faceAvailable: boolean
}

/** The places a vertical video posts to by file, which share its words. */
const SOCIAL: PlaceId[] = ['tiktok', 'instagram', 'shorts', 'facebook', 'pinterest']
/** The socials MVP reads the connection of (/api/social/connected). */
const CONNECTION: Partial<Record<PlaceId, string>> = { instagram: 'instagram', facebook: 'facebook', pinterest: 'pinterest' }

/** The frame size and length, read by the browser without uploading.
 *  Zeroes mean it could not tell, and the card says so. */
function probe(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    try {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.onloadedmetadata = () => {
        const d = Number(v.duration)
        resolve({ duration: Number.isFinite(d) ? Math.round(d) : 0, width: Number(v.videoWidth) || 0, height: Number(v.videoHeight) || 0 })
        URL.revokeObjectURL(v.src)
      }
      v.onerror = () => resolve({ duration: 0, width: 0, height: 0 })
      v.src = URL.createObjectURL(file)
    } catch { resolve({ duration: 0, width: 0, height: 0 }) }
  })
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 100 * 1024 * 1024 ? 0 : 1)} MB`
const clock = (s: number) => (s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '')
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }
const dropName = () => `Drop ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
/** Liftoff's own "Finish in the background" switch for this browser: Drop
 *  never turns it on behind a creator who turned it off there. */
const bgAllowed = () => { try { return window.localStorage.getItem('mvp_liftoff_bg') !== 'off' } catch { return true } }
const wakeBackground = async (inMinutes?: number) => (bgAllowed() ? setLiftoffAuto(true, inMinutes) : null)
const has = (v: Vid, place: PlaceId) => v.places.includes(place)

const field = 'w-full rounded-lg border px-2.5 py-1.5 text-[12.5px] bg-transparent font-normal'
const fieldStyle = { borderColor: 'var(--border)', color: 'var(--text)' }
const card = 'rounded-2xl border p-4 flex flex-col gap-3'
const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }
const label = 'flex flex-col gap-1 text-[11.5px] font-semibold'

export default function DropBoard() {
  const [vids, setVids] = useState<Vid[]>([])
  const [loaded, setLoaded] = useState(false)
  const [last, setLast] = useState<(LastBatch & { created_at?: string }) | null>(null)
  const [hasBlogSite, setHasBlogSite] = useState(false)
  const [available, setAvailable] = useState(true)
  const [needs, setNeeds] = useState<string | null>(null)
  const [placesNeed, setPlacesNeed] = useState<string | null>(null)
  const [draftNeed, setDraftNeed] = useState<string | null>(null)
  const [plans, setPlans] = useState<LaunchPlans>(DEFAULT_PLANS)
  const [setupOpen, setSetupOpen] = useState(false)
  const [drops, setDrops] = useState<DropView[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [batches, setBatches] = useState<Record<string, BatchView | 'missing' | undefined>>({})
  const [scout, setScout] = useState<{ installed: boolean; version: string | null } | null>(null)
  const [bgOn, setBgOn] = useState<boolean | null>(null)
  const [brands, setBrands] = useState<MyBrand[] | null>(null)
  const [brandsError, setBrandsError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const [sending, setSending] = useState<Record<string, string>>({})
  const [dragOver, setDragOver] = useState(false)
  const [connected, setConnected] = useState<Set<string> | null>(null)
  const [tiktokInfo, setTiktokInfo] = useState<TikTokInfo | null>(null)
  const [tiktokError, setTiktokError] = useState<string | null>(null)
  // THIS DROP'S LIFTOFF BATCH, read from Liftoff, so each card shows what
  // Liftoff really has: its thumbnail, title, product, state and time.
  const [draftBatch, setDraftBatch] = useState<DraftBatch | null>(null)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [busyTimes, setBusyTimes] = useState<number[]>([])
  const [faces, setFaces] = useState<Array<{ id: string; name: string }>>([])
  const [busyItem, setBusyItem] = useState<string | null>(null)
  const [dirtyRows, setDirtyRows] = useState<Record<string, boolean>>({})
  const [wishNote, setWishNote] = useState<string | null>(null)
  const stepsRunning = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Refs for the work that outlives a render: uploads, Liftoff adds, saves.
  const vidsRef = useRef<Vid[]>([])
  vidsRef.current = vids
  const draftIdRef = useRef<string | null>(null)
  const draftPromise = useRef<Promise<string | null> | null>(null)
  const batchIdRef = useRef<string | null>(null)
  const batchPromise = useRef<Promise<string | null> | null>(null)
  const restored = useRef(false)
  const adding = useRef(new Set<string>())
  const guesses = useRef<Record<string, Promise<void>>>({})
  const wishTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  /** Times handed to videos on this page, so two never get the same one. */
  const handed = useRef<number[]>([])

  const timezone = useMemo(zone, [])
  const canTrybe = !!scout?.installed && scoutAtLeast(scout.version, SCOUT_TRYBE_SUBMIT_MIN_VERSION)
  const settings: DropSettings = useMemo(() => plans.settings ?? settingsFromLast(last), [plans.settings, last])
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const toYouTube = settings.sendToYouTube

  /** Why a place cannot be used right now, in words, or null when it can. */
  const whyNot = useCallback((place: PlaceId): string | null => {
    if (!READY_PLACES.has(place)) return 'Coming in the next update'
    if ((EXTRA_PLACES as string[]).includes(place) && placesNeed) return 'Needs migration 437'
    if (place === 'blog' && !hasBlogSite) return 'Connect a blog site first'
    if (place === 'trybe' && !canTrybe) return `Needs SCOUT ${SCOUT_TRYBE_SUBMIT_MIN_VERSION}${scout?.version ? ` (this Chrome has ${scout.version})` : ''}`
    // CONNECTED, AS THE PUBLISHERS SEE IT. Unknown is not "not connected":
    // the place stays open and the post itself says what happened.
    const conn = CONNECTION[place]
    if (conn && connected && !connected.has(conn)) return `Connect ${PLACE_INFO[place].label.split(' ')[0]} first`
    if (place === 'tiktok' && tiktokError) return tiktokError
    if ((place === 'pin' || place === 'group') && connected && !connected.has(place === 'pin' ? 'pinterest' : 'facebook')) return `Connect ${place === 'pin' ? 'Pinterest' : 'Facebook'} first`
    return null
  }, [placesNeed, hasBlogSite, canTrybe, scout?.version, connected, tiktokError])

  /** The setup's places for a new video, less any that cannot be used now. */
  const planFor = (kind: DropKind, p: LaunchPlans = plans, why: (x: PlaceId) => string | null = whyNot): PlaceId[] => {
    const list = p[kind].filter((x) => !why(x))
    return list.filter((x) => placeFits(x, kind, list.includes('liftoff'), list.includes('blog')))
  }

  const mark = (key: string, patch: Partial<Vid>) => setVids((list) => list.map((v) => (v.key === key ? { ...v, ...patch } : v)))

  // ── this drop's Liftoff batch ──────────────────────────────────────────────
  const loadBatch = useCallback(async () => {
    const id = batchIdRef.current
    if (!id) { setDraftBatch(null); return }
    const r = await browserHttp(`/api/launch/batches/${id}`)
    if (!r.ok) { setBatchError(String(r.json.error || `Liftoff could not read this drop's batch (${r.status}).`)); return }
    setBatchError(null)
    setDraftBatch({
      batch: r.json.batch as DraftBatch['batch'],
      items: ((r.json.items ?? []) as Item[]).slice().sort((a, b) => a.position - b.position),
      launchBlocker: (r.json.launchBlocker as string) ?? null,
      ownSchedules: r.json.ownSchedules !== false,
      faceAvailable: r.json.faceAvailable !== false,
    })
  }, [])

  const load = useCallback(async () => {
    const r = await browserHttp('/api/drop')
    if (!r.ok) { setLoadError(String(r.json.error || `Drop could not be read (${r.status}).`)); setDrops([]); setLoaded(true); return }
    setLoadError(null)
    setAvailable(r.json.available !== false)
    setNeeds((r.json.needs as string) || null)
    setPlacesNeed((r.json.placesNeed as string) || null)
    setDraftNeed((r.json.draftNeed as string) || null)
    const p = r.json.plans ? readPlans(r.json.plans) : DEFAULT_PLANS
    setPlans(p)
    setLast((r.json.last as LastBatch) ?? null)
    setHasBlogSite(r.json.hasBlogSite === true)
    setBusyTimes(((r.json.busy ?? []) as string[]).map((x) => Date.parse(x)).filter(Number.isFinite))

    // THE DROP BEING SET UP, back on the page after a reload. Only on the
    // first read: after that the page is the one making it, and a later read
    // must not put the videos back over the ones being uploaded.
    const draft = r.json.draft as ({ id: string; batch_id: string | null; items: DraftItemRow[] }) | null
    const first = !restored.current
    restored.current = true
    if (draft && first) {
      draftIdRef.current = draft.id
      if (draft.batch_id) batchIdRef.current = draft.batch_id
      const placeOk = (x: unknown): x is PlaceId => typeof x === 'string' && !!PLACE_INFO[x as PlaceId]
      setVids(draft.items.map((i): Vid => {
        const w = (i.wish ?? {}) as Wish
        const kind: DropKind = i.kind === 'vertical' ? 'vertical' : 'long'
        const size = Number(i.size_bytes) || 0
        return {
          key: `d-${i.id}`, itemId: i.id, file: null, name: i.file_name || 'Video', size, type: i.mime_type || 'video/mp4',
          duration: Number(i.duration_seconds) || 0, width: Number(i.width) || 0, height: Number(i.height) || 0, kind,
          up: 'done', sent: size, url: i.source_url || undefined, asin: i.asin || '', asinFrom: null, productName: null, title: i.title || '',
          places: Array.isArray(w.places) ? w.places.filter(placeOk).filter((x) => PLACE_INFO[x].kind === kind) : planFor(kind, p, () => null),
          caption: typeof w.caption === 'string' ? w.caption : '',
          trybe: w.trybe && typeof w.trybe === 'object' ? { ...emptyChoice(), ...(w.trybe as Partial<TrybeChoice>) } : emptyChoice(),
          tiktok: w.tiktok && typeof w.tiktok === 'object' ? { ...emptyTikTok(), ...(w.tiktok as Partial<TikTokChoice>) } : emptyTikTok(),
          launchItemId: i.launch_item_id || null, adding: false, liftoffError: null,
        }
      }))
    }
    if (batchIdRef.current) void loadBatch()

    const list = (r.json.drops ?? []) as DropView[]
    setDrops(list)
    // Each drop's Liftoff batch, as Liftoff reports it.
    const next: Record<string, BatchView | 'missing'> = {}
    await Promise.all(list.filter((d) => d.batch_id).map(async (d) => {
      const b = await browserHttp(`/api/launch/batches/${d.batch_id}`)
      next[d.batch_id!] = b.ok
        ? { state: String((b.json.batch as { state?: string })?.state || ''), send_to_youtube: (b.json.batch as { send_to_youtube?: boolean })?.send_to_youtube, items: (b.json.items ?? []) as BatchView['items'] }
        : 'missing'
    }))
    setBatches(next)
    setLoaded(true)
    // planFor reads the plan passed in, not the render's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadBatch])

  /** One pass of the steps this page can run: launch, the blog posts, then
   *  every other place. A drop still being set up is left alone. */
  const runSteps = useCallback(async () => {
    if (stepsRunning.current) return
    stepsRunning.current = true
    try {
      const out = await dropSteps(browserHttp, undefined, undefined, { videoPin: (b) => postVideoPin(b), timezone })
      if (out.launched) {
        toast.success(`Liftoff launched ${out.launched === 1 ? 'a drop' : `${out.launched} drops`}. SCOUT uploads to YouTube next.`)
        void wakeBackground(1).then((st) => setBgOn(!!st?.on))
      }
      if (out.blogs) toast.success(`${out.blogs} blog post${out.blogs === 1 ? '' : 's'} written and scheduled after ${out.blogs === 1 ? 'its video' : 'their videos'}.`)
      if (out.sent) toast.success(`${out.sent} more ${out.sent === 1 ? 'place' : 'places'} done. The board shows each one.`)
      if (out.notes.length) toast.error(out.notes[0], { duration: 12000 })
    } finally {
      stepsRunning.current = false
      void load()
    }
  }, [load, timezone])

  useEffect(() => {
    void load().then(() => runSteps())
    // Which socials can be posted to, the way the publishers resolve them.
    browserHttp('/api/social/connected').then((r) => {
      if (r.ok && r.json.known === true) setConnected(new Set(((r.json.connected ?? []) as unknown[]).map(String)))
    })
    // TikTok's own account settings, read as the posting screen opens (TikTok
    // asks for this every time; it names the account and the allowed privacy).
    browserHttp('/api/blog/tiktok-post/creator-info').then((r) => {
      const info = r.json.info as TikTokInfo | undefined
      if (r.ok && info?.username) setTiktokInfo(info)
      else setTiktokError(r.status === 412 ? 'Connect TikTok first' : String(r.json.error || 'TikTok did not answer'))
    })
    // The creator's saved faces, for "who's in this video" on each card.
    browserHttp('/api/face-models').then((r) => {
      if (r.ok) setFaces(((r.json.models ?? []) as Array<{ id: string; name: string }>).map((m) => ({ id: m.id, name: m.name })))
    })
    getScoutStatus().then((st) => {
      setScout(st)
      if (!st.installed) return
      void wakeBackground().then((s) => setBgOn(s ? !!s.on : false))
      if (scoutAtLeast(st.version, SCOUT_TRYBE_SUBMIT_MIN_VERSION)) {
        requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=all').then((r) => {
          if (!r.ok) { setBrandsError(`TRYBE did not answer${r.status ? ` (${r.status})` : ''}. Sign in to TRYBE in this Chrome, then reload.`); return }
          setBrands(readBrandStats(r.json))
        }).catch((e) => setBrandsError(e instanceof Error ? e.message : 'SCOUT did not answer.'))
      }
    }).catch(() => setScout({ installed: false, version: null }))
  }, [load, runSteps])

  // While a drop is still on its way, look again every 30 seconds.
  const open = (drops ?? []).some((d) => !['done', 'failed'].includes(d.state) || d.items.some((i) => i.blog_state === 'writing' || i.trybe_state === 'sending'))
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => void runSteps(), 30_000)
    return () => clearInterval(t)
  }, [open, runSteps])

  // While Liftoff is preparing this drop's videos, read it every 8 seconds,
  // so each thumbnail appears on its card as soon as it is built.
  const preparing = !!draftBatch?.items.some((i) => (OPEN_ITEM_STATES as string[]).includes(i.state))
  useEffect(() => {
    if (!preparing) return
    const t = setInterval(() => void loadBatch(), 8_000)
    return () => clearInterval(t)
  }, [preparing, loadBatch])

  // Leaving while a file is going up or a TRYBE send runs loses it: said.
  const busy = launching || vids.some((v) => v.up === 'uploading') || Object.keys(sending).length > 0
  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  // ── the drop and its batch, made once, when the first video needs them ─────
  function ensureDraft(): Promise<string | null> {
    if (draftIdRef.current) return Promise.resolve(draftIdRef.current)
    if (!draftPromise.current) {
      draftPromise.current = browserHttp('/api/drop', { method: 'POST', body: { action: 'draft_start', name: dropName() } }).then((r) => {
        if (!r.ok || !r.json.id) { draftPromise.current = null; return null }
        draftIdRef.current = String(r.json.id)
        return draftIdRef.current
      })
    }
    return draftPromise.current
  }

  function ensureBatch(): Promise<string | null> {
    if (batchIdRef.current) return Promise.resolve(batchIdRef.current)
    if (!batchPromise.current) {
      batchPromise.current = (async () => {
        const dropId = await ensureDraft()
        if (!dropId) { batchPromise.current = null; return null }
        const st = settingsRef.current
        const made = await startDraftBatch({ dropId, name: dropName(), settings: st, timezone, startOn: firstDay(st.dailySlots, timezone).startOn }, browserHttp)
        if (made.problems.length) toast.error(made.problems[0], { duration: 12000 })
        if (!made.batchId) { batchPromise.current = null; return null }
        batchIdRef.current = made.batchId
        return made.batchId
      })()
    }
    return batchPromise.current
  }

  /** Keep what this card says, a moment after the last change. */
  function keepWish(key: string) {
    clearTimeout(wishTimers.current[key])
    wishTimers.current[key] = setTimeout(() => {
      const v = vidsRef.current.find((x) => x.key === key)
      if (!v?.itemId) return
      void browserHttp('/api/drop', { method: 'POST', body: {
        action: 'draft_item', itemId: v.itemId, asin: v.asin.trim(), title: v.title.trim(),
        wish: { places: v.places, caption: v.caption, trybe: v.trybe, tiktok: v.tiktok },
      } }).then((r) => {
        if (!r.ok) setWishNote(String(r.json.error || 'Your choices for a video were not kept. They still apply until you reload.'))
        else if (r.json.wishSaved === false) setWishNote(String(r.json.wishError || 'Your choices are not kept over a reload yet.'))
        else setWishNote(null)
      })
    }, 800)
  }
  const change = (key: string, patch: Partial<Vid>) => { mark(key, patch); keepWish(key) }

  /** The times already taken: launched videos, this batch's, and any just
   *  handed out on this page. */
  const takenTimes = (): number[] => {
    const b = draftBatch
    const mine = b ? [...scheduleItems(b.items.map((i) => ({ id: i.id, customDate: i.custom_publish_date, customTime: i.custom_publish_time })),
      { timezone: b.batch.timezone, slots: b.batch.daily_slots ?? [], startOn: b.batch.start_on ?? '' }).values()].map((s) => s.at.getTime()) : []
    return [...busyTimes, ...mine, ...handed.current]
  }

  /** Into this drop's Liftoff batch, with its own next free time, so Liftoff
   *  prepares it while the creator checks it. */
  async function addToLiftoff(key: string, known: Partial<Vid> = {}) {
    const v0 = vidsRef.current.find((x) => x.key === key)
    if (!v0) return
    const v = { ...v0, ...known }
    if (!v.itemId || !v.url || v.launchItemId || adding.current.has(key)) return
    adding.current.add(key)
    mark(key, { adding: true, liftoffError: null })
    try {
      const batchId = await ensureBatch()
      if (!batchId) { mark(key, { liftoffError: 'Liftoff did not start a batch for this drop.' }); return }
      const cur = { ...v, ...(vidsRef.current.find((x) => x.key === key) ?? {}), ...known }
      const res = await addDraftVideo(batchId, { itemId: v.itemId, sourceUrl: v.url, fileName: v.name, title: cur.title, asin: cur.asin, durationSeconds: v.duration }, browserHttp)
      if (!res.launchItemId) { mark(key, { liftoffError: res.problem || 'Liftoff did not take it.' }); return }
      mark(key, { launchItemId: res.launchItemId })
      if (res.problem) toast.error(res.problem, { duration: 10000 })
      // ITS OWN TIME: the next one on your pattern nobody has yet. Handed out
      // before the call, so two videos added together never share one.
      if (settingsRef.current.sendToYouTube) {
        const [slot] = nextFreeSlots(1, settingsRef.current.dailySlots, timezone, takenTimes())
        if (slot) {
          handed.current.push(slot.at)
          const t = await browserHttp(`/api/launch/items/${res.launchItemId}`, { method: 'PATCH', body: { schedule: { date: slot.date, time: slot.time } } })
          // Refused (Liftoff's own times need migration 364): the card shows
          // the time Liftoff will really give it, from its pattern.
          if (!t.ok) handed.current = handed.current.filter((x) => x !== slot.at)
        }
      }
      await loadBatch()
    } finally {
      adding.current.delete(key)
      mark(key, { adding: false })
    }
  }

  async function dropFromLiftoff(v: Vid) {
    const id = v.launchItemId
    if (!id) return
    mark(v.key, { launchItemId: null })
    const r = await browserHttp(`/api/launch/items/${id}`, { method: 'DELETE' })
    if (!r.ok) toast.error(String(r.json.error || 'Liftoff did not let it go. It is still in this drop\'s batch.'))
    if (v.itemId) await browserHttp('/api/drop', { method: 'POST', body: { action: 'draft_item', itemId: v.itemId, launchItemId: null } })
    await loadBatch()
  }

  async function addFiles(files: FileList | File[] | null) {
    if (!files) return
    const room = DROP_MAX - vids.length
    const picked = Array.from(files).filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(f.name))
    if (picked.length < Array.from(files).length) toast.error('Only video files can be dropped.')
    if (picked.length > room) toast(`Taking the first ${Math.max(0, room)}. A drop holds ${DROP_MAX}.`, { duration: 7000 })
    const take = picked.slice(0, Math.max(0, room))
    if (take.length === 0) return
    const supabase = createBrowserClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toast.error('Not signed in.'); return }

    const rows: Vid[] = []
    for (const [i, file] of take.entries()) {
      const p = await probe(file)
      const kind = dropKind(p.width, p.height)
      rows.push({
        key: `${Date.now()}-${i}-${file.name}`, itemId: null, file, name: file.name, size: file.size, type: file.type || 'video/mp4',
        duration: p.duration, width: p.width, height: p.height, kind, up: 'waiting', sent: 0,
        asin: '', asinFrom: null, productName: null, title: '', places: planFor(kind), trybe: emptyChoice(), caption: '', tiktok: emptyTikTok(),
        launchItemId: null, adding: false, liftoffError: null,
      })
    }
    setVids((list) => [...list, ...rows])

    // The product, from what MVP already knows about the file's name.
    for (const r of rows) {
      guesses.current[r.key] = browserHttp(`/api/clip-factory/product-guess?file=${encodeURIComponent(r.name)}`).then((g) => {
        const product = String(g.json.product || '')
        if (!g.ok || !product) return
        setVids((list) => list.map((v) => (v.key === r.key && !v.asin ? { ...v, asin: product, asinFrom: (g.json.from === 'video' ? 'video' : 'file'), productName: (g.json.productName as string) || null } : v)))
      }).catch(() => {})
    }

    // Three at a time, each with its own bar. Each one is saved to the drop as
    // soon as it is up, and a long one goes straight into Liftoff.
    const upOne = async (r: Vid) => {
      if (r.size > BULK_VIDEO_MAX_BYTES) { mark(r.key, { up: 'failed', error: `${mb(r.size)} is over the ${mb(BULK_VIDEO_MAX_BYTES)} limit.` }); return }
      const ext = r.name.split('.').pop()?.toLowerCase() || 'mp4'
      let path = `${user.id}/drop-${crypto.randomUUID()}.${ext}`
      mark(r.key, { up: 'uploading', sent: 0, error: undefined })
      let url: string
      try {
        try {
          await uploadResumable({
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            getAccessToken: (force) => freshAccessToken(supabase, force),
            bucket: 'instagram-videos', path, file: r.file!, contentType: r.type,
            onProgress: ({ sent }) => mark(r.key, { sent }),
          })
        } catch (e) {
          if (!(e instanceof ResumableUnavailable)) throw e
          path = `${user.id}/drop-${crypto.randomUUID()}.${ext}`
          const token = await freshAccessToken(supabase, true)
          if (!token) throw new Error('Signed out during the upload. Sign in again and drop this one again.')
          await uploadWithProgress({
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, accessToken: token,
            bucket: 'instagram-videos', path, file: r.file!, contentType: r.type,
            onProgress: ({ sent }) => mark(r.key, { sent }),
          })
        }
        url = supabase.storage.from('instagram-videos').getPublicUrl(path).data.publicUrl
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'The upload failed.'
        mark(r.key, { up: 'failed', error: storageSizeRefusal(msg, r.size) || (saysExpired(msg) ? 'Your sign-in ran out during the upload. Refresh the page and drop this one again.' : msg) })
        return
      }
      mark(r.key, { sent: r.size, url })
      await guesses.current[r.key]
      const dropId = await ensureDraft()
      const cur = vidsRef.current.find((x) => x.key === r.key)
      if (!cur) return // removed while it uploaded
      const saved = dropId ? await browserHttp('/api/drop', { method: 'POST', body: { action: 'draft_add', dropId, item: {
        fileName: r.name, sourceUrl: url, mimeType: r.type, sizeBytes: r.size, durationSeconds: r.duration, width: r.width, height: r.height,
        kind: r.kind, asin: cur.asin.trim(), title: cur.title.trim(),
      } } }) : null
      if (!saved?.ok || !saved.json.id) {
        mark(r.key, { up: 'failed', error: `Uploaded, but not added to the drop: ${String(saved?.json.error || 'Drop did not answer')}. Remove it and drop it again.` })
        return
      }
      const itemId = String(saved.json.id)
      mark(r.key, { up: 'done', itemId })
      keepWish(r.key)
      if (r.kind === 'long' && cur.places.includes('liftoff')) await addToLiftoff(r.key, { itemId, url, up: 'done' })
    }
    let next = 0
    await Promise.all(Array.from({ length: Math.min(LANES, rows.length) }, async () => {
      while (next < rows.length) await upOne(rows[next++])
    }))
  }

  const flipPlace = (v: Vid, place: PlaceId) => {
    const on = has(v, place)
    let places = on ? v.places.filter((x) => x !== place) : [...v.places, place]
    // Off Liftoff, nothing that works from the YouTube video can stay on; off
    // the blog post, nothing that goes out with it.
    if (place === 'liftoff' && on) places = places.filter((x) => !PLACE_INFO[x].afterYouTube)
    if (place === 'blog' && on) places = places.filter((x) => !PLACE_INFO[x].withBlog)
    change(v.key, { places })
    if (place === 'liftoff' && on && v.launchItemId) void dropFromLiftoff(v)
    if (place === 'liftoff' && !on && v.up === 'done') void addToLiftoff(v.key)
  }

  async function removeVid(v: Vid) {
    setVids((list) => list.filter((x) => x.key !== v.key))
    if (v.launchItemId) await browserHttp(`/api/launch/items/${v.launchItemId}`, { method: 'DELETE' })
    if (v.itemId) {
      const r = await browserHttp('/api/drop', { method: 'POST', body: { action: 'draft_remove', itemId: v.itemId } })
      if (!r.ok) toast.error(String(r.json.error || 'It was not taken out of the drop. Reload and remove it again.'))
    }
    if (v.launchItemId) void loadBatch()
  }

  // ── Liftoff's own editors, on each card ────────────────────────────────────
  async function patchItem(id: string, body: Record<string, unknown>) {
    setBusyItem(id)
    try {
      const r = await browserHttp(`/api/launch/items/${id}`, { method: 'PATCH', body })
      if (!r.ok) { toast.error(String(r.json.error || 'Could not save that.')); return }
      if (r.json.resolvedFromLink) toast.success(`Found ${r.json.resolvedFromLink} behind that link.`)
      await loadBatch()
    } finally { setBusyItem(null) }
  }

  async function moveItem(id: string, direction: 'up' | 'down') {
    setBusyItem(id)
    try {
      const r = await browserHttp(`/api/launch/items/${id}/move`, { method: 'POST', body: { direction } })
      if (!r.ok) { toast.error(String(r.json.error || 'Could not move that one.')); return }
      await loadBatch()
    } finally { setBusyItem(null) }
  }

  // ── the setup, saved once ──────────────────────────────────────────────────
  async function saveSetup(next: LaunchPlans): Promise<boolean> {
    const before = plans.settings
    const r = await browserHttp('/api/drop', { method: 'POST', body: { action: 'plans_save', plans: next } })
    if (!r.ok) { toast.error(String(r.json.error || 'The setup was not saved.')); return false }
    const saved = readPlans(r.json.plans)
    setPlans(saved)
    // THIS DROP'S BATCH TAKES IT TOO, through Liftoff's own checks.
    const bid = batchIdRef.current
    const st = saved.settings
    if (bid && st) {
      const lookChanged = JSON.stringify(before?.thumbnail ?? null) !== JSON.stringify(st.thumbnail ?? null)
      const p = await browserHttp(`/api/launch/batches/${bid}`, { method: 'PATCH', body: { ...settingsBody(st, timezone, firstDay(st.dailySlots, timezone).startOn), ...(lookChanged ? { rebuildThumbnails: true } : {}) } })
      if (!p.ok) toast.error(`Saved, but this drop's Liftoff batch did not take it: ${String(p.json.error || p.status)}`, { duration: 12000 })
      if (st.sendToYouTube && st.channelId) {
        const c = await browserHttp(`/api/launch/batches/${bid}/channel`, { method: 'POST', body: { channelId: st.channelId } })
        if (!c.ok) toast.error(`Your YouTube channel was not confirmed: ${String(c.json.error || c.status)}`, { duration: 12000 })
      }
      void loadBatch()
      toast.success('Setup saved. The videos on this page keep their own times; change any on its card.')
    } else {
      toast.success('Setup saved. Every video you drop follows it.')
    }
    return true
  }

  // ── what Launch would do, and what stops it ────────────────────────────────
  const liOf = (v: Vid): Item | null => (v.launchItemId && draftBatch?.items.find((i) => i.id === v.launchItemId)) || null
  const sched = useMemo(() => {
    const b = draftBatch
    if (!b) return new Map()
    return scheduleItems(b.items.map((i) => ({ id: i.id, customDate: i.custom_publish_date, customTime: i.custom_publish_time })),
      { timezone: b.batch.timezone, slots: b.batch.daily_slots ?? [], startOn: b.batch.start_on ?? '' })
  }, [draftBatch])
  const ready = vids.filter((v) => v.up === 'done' && v.itemId)
  const longs = ready.filter((v) => v.kind === 'long' && has(v, 'liftoff'))
  const toTrybe = ready.filter((v) => has(v, 'trybe'))
  const sends = ready.reduce((n, v) => n + v.places.length, 0)
  const stillPreparing = longs.length > 0 && isStillPreparing(draftBatch?.launchBlocker)

  const blocker = (() => {
    if (!available) return needs || 'Drop needs migration 436 first.'
    if (draftNeed) return draftNeed
    if (!plans.settings) return 'Save your setup first. You only do it once.'
    if (vids.length === 0) return 'Drop your videos first.'
    if (vids.some((v) => v.up === 'uploading' || v.up === 'waiting')) return 'Wait for the uploads to finish.'
    const failed = vids.find((v) => v.up === 'failed' || (v.up === 'done' && !v.itemId))
    if (failed) return `${failed.name} is not in the drop. Remove it, or drop it again.`
    if (!ready.some((v) => v.places.length > 0)) return 'Pick at least one place for a video.'
    for (const v of ready) {
      const off = v.places.find((p) => whyNot(p))
      if (off) return `${v.name}: ${PLACE_INFO[off].label} cannot be used right now (${whyNot(off)}). Untick it.`
    }
    if (longs.length) {
      const miss = setupMissing(settings)
      if (miss.length) return `Finish your setup first: ${miss.join(', ')}.`
      const notIn = longs.find((v) => !v.launchItemId)
      if (notIn) return notIn.adding ? `Putting ${notIn.name} into Liftoff.` : `${notIn.name} is not in Liftoff. Press Try again on its card.`
      if (!draftBatch) return batchError || 'Reading this drop from Liftoff.'
      const noProduct = longs.find((v) => !String(liOf(v)?.asin ?? '').trim())
      if (noProduct) return `Add the product for ${noProduct.name}.`
      const dirty = longs.find((v) => v.launchItemId && dirtyRows[v.launchItemId])
      if (dirty) return `${dirty.name} has a time you have not set. Press Set, or put it back.`
      if (draftBatch.launchBlocker && !isStillPreparing(draftBatch.launchBlocker)) return `Liftoff: ${draftBatch.launchBlocker}`
    }
    const t = ready.find((v) => has(v, 'trybe') && choiceBlocker(v.trybe))
    if (t) return `${t.name}: ${choiceBlocker(t.trybe)}.`
    const tk = ready.find((v) => has(v, 'tiktok') && tiktokBlocker(v.tiktok, tiktokInfo, v.duration))
    if (tk) return `${tk.name}: ${tiktokBlocker(tk.tiktok, tiktokInfo, tk.duration)}.`
    // ONLY ON TRYBE MEANS ONLY ON TRYBE: asked, not posted anyway.
    const ex = ready.find((v) => has(v, 'trybe') && v.trybe.exclusive && SOCIAL.some((x) => has(v, x)))
    if (ex) return `${ex.name} is ticked Only on TRYBE and also set to post on ${SOCIAL.filter((x) => has(ex, x)).map((x) => PLACE_INFO[x].label).join(', ')}. Untick one.`
    const am = ready.find((v) => v.kind === 'vertical' && has(v, 'amazon') && !v.asin.trim())
    if (am) return `${am.name}: Amazon needs the product.`
    if (ready.some((v) => has(v, 'trybe')) && !canTrybe) return `Sending to TRYBE needs SCOUT ${SCOUT_TRYBE_SUBMIT_MIN_VERSION} in this Chrome.`
    return null
  })()

  async function launch() {
    const dropId = draftIdRef.current
    if (blocker || !dropId) return
    setLaunching(true)
    try {
      const go = ready.filter((v) => v.places.length > 0)
      // NO LONG VIDEO LEFT FOR LIFTOFF: its empty batch goes, so Liftoff's
      // list does not gain a batch with nothing in it.
      const bid = batchIdRef.current
      if (bid && !go.some((v) => has(v, 'liftoff') && v.launchItemId) && draftBatch && draftBatch.items.length === 0) {
        const del = await browserHttp(`/api/launch/batches/${bid}`, { method: 'DELETE' })
        if (del.ok) await browserHttp('/api/drop', { method: 'POST', body: { action: 'link', dropId, batchId: null, keepDraft: true } })
      }
      const r = await browserHttp('/api/drop', { method: 'POST', body: { action: 'draft_launch', dropId, name: dropName(), items: go.map((v) => {
        const li = liOf(v)
        return {
          id: v.itemId, asin: String(li?.asin ?? v.asin).trim(), title: String(li?.title ?? v.title).trim(),
          toLiftoff: has(v, 'liftoff') && !!v.launchItemId, toBlog: has(v, 'blog'), toTrybe: has(v, 'trybe'),
          trybe: has(v, 'trybe') ? v.trybe : undefined,
          places: v.places.filter((x): x is ExtraPlace => (EXTRA_PLACES as string[]).includes(x)),
          caption: v.caption.trim() || undefined,
          options: has(v, 'tiktok') ? { tiktok: tiktokOptions(v.tiktok) } : undefined,
        }
      }) } })
      if (!r.ok) { toast.error(String(r.json.error || 'The drop did not launch.')); return }
      if (r.json.placesSaved === false) toast.error(String(r.json.placesError || 'The other places were not saved.'), { duration: 12000 })
      toast.success(r.json.state === 'preparing'
        ? (stillPreparing ? 'Launched. Liftoff sends the long videos as soon as they are prepared. The board below shows each one.' : 'Launched. The board below shows where each video lands.')
        : 'Launched. The board below shows where each video lands.')
      // The page is clear for the next drop; the board follows this one.
      setVids([]); setDraftBatch(null); setDirtyRows({})
      draftIdRef.current = null; draftPromise.current = null; batchIdRef.current = null; batchPromise.current = null; handed.current = []
      if (longs.length) void wakeBackground(1).then((st) => setBgOn(!!st?.on))
      await runSteps()
      // Vertical videos: each to its TRYBE brand, one at a time, here.
      for (const v of go.filter((x) => has(x, 'trybe'))) {
        await sendOne({
          id: v.itemId!, source_url: v.url!, file_name: v.name, mime_type: v.type, size_bytes: v.size,
          trybe_brand_id: v.trybe.brandId, trybe_program_id: v.trybe.programId, trybe_angle_id: v.trybe.angleId,
          trybe_product_ids: v.trybe.productIds, trybe_exclusive: v.trybe.exclusive, trybe_notes: v.trybe.notes,
        }, v.trybe.brandName)
      }
    } finally { setLaunching(false) }
  }

  async function sendOne(it: TrybeDropItem, brandName: string, again = false) {
    setSending((s) => ({ ...s, [it.id]: `Sending to ${brandName}` }))
    try {
      const res = await sendDropToTrybe(it, browserHttp, {
        api: requestTrybeApi, put: requestTrybePutFile,
        onStep: (t, done, total) => setSending((s) => ({ ...s, [it.id]: total && total > 1 ? `${t} (${done ?? 0} of ${total})` : t })),
      }, again)
      if (!res) toast('That video is already being sent from another tab.')
      else if (res.state === 'in_review') toast.success(`In ${brandName}'s review on TRYBE.`)
      else if (res.state === 'sent_unconfirmed') toast(`TRYBE took it, but it is not in your ${brandName} submissions yet. Check TRYBE before sending again.`, { duration: 12000 })
      else toast.error(`Not sent to ${brandName}: ${res.error || 'TRYBE did not take it.'}`, { duration: 14000 })
    } finally {
      setSending((s) => { const n = { ...s }; delete n[it.id]; return n })
      void load()
    }
  }

  async function blogAgain(itemId: string) {
    const r = await browserHttp('/api/drop', { method: 'POST', body: { action: 'blog_again', itemId } })
    if (!r.ok || !r.json.queued) { toast.error(String(r.json.error || 'It is still being written. Give it a few minutes.')); return }
    toast('Writing it again on the next pass.')
    void runSteps()
  }

  async function trybeAgain(itemId: string) {
    const d = (drops ?? []).find((x) => x.items.some((i) => i.id === itemId))
    const it = d?.items.find((i) => i.id === itemId) as unknown as (TrybeDropItem & { trybe_brand_name: string | null; trybe_state: string }) | undefined
    if (!it) return
    if (it.trybe_state === 'sent_unconfirmed' && !window.confirm('TRYBE took this video before. Check your TRYBE submissions first: sending again can make a second submission. Send again?')) return
    await sendOne(it, it.trybe_brand_name || 'the brand', it.trybe_state !== 'wanted')
  }

  async function sendAgain(sendId: string) {
    const r = await browserHttp('/api/drop', { method: 'POST', body: { action: 'send_again', sendId } })
    if (!r.ok || !r.json.queued) { toast.error(String(r.json.error || 'It is still on its way. Give it a few minutes.')); return }
    toast('Trying again now.')
    void runSteps()
  }

  async function removeDrop(dropId: string) {
    if (!window.confirm('Remove this drop from the list? What it sent stays where it went: the Liftoff batch, blog posts and TRYBE submissions are not touched.')) return
    const r = await browserHttp('/api/drop', { method: 'POST', body: { action: 'delete', dropId } })
    if (!r.ok) toast.error(String(r.json.error || 'Not removed.'))
    void load()
  }

  // ── render ─────────────────────────────────────────────────────────────────
  const planLine = (kind: DropKind) => {
    const list = plans[kind].filter((p) => !whyNot(p))
    return list.length ? list.map((p) => (p === 'liftoff' && !toYouTube ? 'Amazon' : PLACE_INFO[p].label)).join(', ') : 'Nowhere yet'
  }
  const missing = setupMissing(plans.settings ?? null)
  const showSetup = loaded && (setupOpen || !plans.settings)
  const studioOn = Object.values(settings.studioOptions).filter(Boolean).length
  const fmt = (at: Date) => at.toLocaleString('en-US', { timeZone: draftBatch?.batch.timezone || timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      {loadError && <p className="rounded-lg px-3 py-2 text-[12.5px] text-red-700 bg-red-500/10 dark:text-red-300 dark:bg-red-400/15">{loadError}</p>}
      {!available && (
        <p className="rounded-lg px-3 py-2 text-[12.5px] flex items-start gap-2 text-amber-700 bg-amber-500/15 dark:text-amber-300 dark:bg-amber-400/15">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {needs || 'Drop needs migration 436 in the database first.'}
        </p>
      )}
      {(draftNeed || placesNeed || wishNote) && (
        <p className="rounded-lg px-3 py-2 text-[12px] text-amber-700 bg-amber-500/15 dark:text-amber-300 dark:bg-amber-400/15">{draftNeed || placesNeed || wishNote}</p>
      )}

      {/* ── the setup, done once ───────────────────────────────────────────── */}
      {!loaded ? (
        <p className="inline-flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--text-2)' }}><Loader2 size={13} className="animate-spin" /> Reading your setup</p>
      ) : showSetup ? (
        <DropSetup plans={plans} settings={settings} why={whyNot} onSave={saveSetup} onClose={() => setSetupOpen(false)} first={!plans.settings} />
      ) : (
        <section className="rounded-2xl border px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-3" style={cardStyle}>
          <div className="min-w-0 flex-1 grid gap-1.5 text-[12.5px]">
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Your setup</p>
            <p className="min-w-0" style={{ color: 'var(--text)' }}><span className="font-semibold">Long videos:</span> <span style={{ color: 'var(--text-2)' }}>{planLine('long')}</span></p>
            <p className="min-w-0" style={{ color: 'var(--text)' }}><span className="font-semibold">Vertical videos:</span> <span style={{ color: 'var(--text-2)' }}>{planLine('vertical')}</span></p>
            {plans.long.includes('liftoff') && (
              <p className="min-w-0 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]" style={{ color: 'var(--text-2)' }}>
                <span>CTA: {settings.ctaChosen ? (settings.cta ? 'on every video' : 'none') : 'not picked'}</span>
                <span>Thumbnail look: {settings.thumbnailChosen ? 'set' : 'not picked'}</span>
                {toYouTube && <span>{cadenceLabel(settings.dailySlots)}</span>}
                {toYouTube && <span>Studio steps: {studioOn} of 4</span>}
                {settings.amazon && <span>US Amazon store</span>}
              </p>
            )}
            {missing.length > 0 && plans.long.includes('liftoff') && (
              <p className="text-[12px] text-amber-700 dark:text-amber-300">Long videos wait for: {missing.join(', ')}.</p>
            )}
          </div>
          <button type="button" onClick={() => setSetupOpen(true)}
            className="inline-flex items-center gap-1.5 self-start rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
            <Settings2 size={13} /> Change setup
          </button>
        </section>
      )}

      {/* ── the drop zone: big when empty, a bar once videos are in ───────── */}
      <section
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files) }}
        className={`rounded-2xl border-2 border-dashed transition-colors ${vids.length ? 'px-4 py-3 flex items-center gap-3' : 'px-5 py-10 flex flex-col items-center gap-2 text-center'}`}
        style={{ borderColor: dragOver ? TEAL : 'var(--border-2)', background: dragOver ? 'rgba(14,165,164,0.06)' : 'var(--surface)' }}>
        {vids.length === 0 ? (
          <>
            <span className="rounded-full p-3" style={{ background: 'rgba(14,165,164,0.12)', color: TEAL }}><UploadCloud size={24} /></span>
            <p className="text-[15px] font-semibold mt-1" style={{ color: 'var(--text)' }}>Drop your finished videos here</p>
            <p className="text-[12.5px] max-w-md" style={{ color: 'var(--text-2)' }}>
              Each one follows your setup. Long videos are prepared while you check them: the product, thumbnail, title and time are on each card. Press Launch once. Up to {DROP_MAX} at a time.
            </p>
            <button type="button" onClick={() => inputRef.current?.click()}
              className="mt-2 rounded-lg px-4 py-2 text-[13px] font-semibold text-white" style={{ background: TEAL }}>
              Choose videos
            </button>
          </>
        ) : (
          <>
            <UploadCloud size={18} style={{ color: TEAL }} className="shrink-0" />
            <p className="text-[12.5px] min-w-0 flex-1" style={{ color: 'var(--text-2)' }}>
              {vids.length} of {DROP_MAX} videos. Drop more here.
            </p>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={vids.length >= DROP_MAX || launching}
              className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              <Plus size={13} /> Add
            </button>
          </>
        )}
        <input ref={inputRef} type="file" accept="video/*" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
      </section>

      {/* ── each video ─────────────────────────────────────────────────────── */}
      {vids.length > 0 && (
        <section className="flex flex-col gap-3">
          {vids.map((v) => {
            const pct = v.size ? Math.round((v.sent / v.size) * 100) : 0
            const li = liOf(v)
            const inLiftoff = v.kind === 'long' && has(v, 'liftoff')
            const pos = li && draftBatch ? draftBatch.items.findIndex((i) => i.id === li.id) : -1
            const at = li ? sched.get(li.id) : undefined
            const tone = li ? itemProgressTone({ ...li, state: li.state as ItemState }) : null
            return (
              <article key={v.key} className={card} style={cardStyle}>
                <header className="flex items-start gap-3">
                  {li?.thumbnail_url ? (
                    // THE THUMBNAIL LIFTOFF BUILT, the one YouTube gets, in place
                    // of the still as soon as it exists.
                    <figure className="shrink-0 flex flex-col gap-0.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={li.thumbnail_url} alt={`Thumbnail for ${li.title || v.name}`} className="aspect-video w-[112px] sm:w-[148px] rounded-lg object-cover" style={{ background: 'var(--surface-2)' }} />
                      <figcaption className="text-[10.5px]" style={{ color: 'var(--text-2)' }}>{li.thumbnail_source === 'creator' ? 'Your own thumbnail' : 'Built in your look'}</figcaption>
                    </figure>
                  ) : (
                    <DropThumb file={v.file} src={v.url} vertical={v.kind === 'vertical'} />
                  )}
                  <div className="min-w-0 flex-1 flex flex-col gap-1">
                    <div className="flex items-start gap-2">
                      <p className="text-[13.5px] font-semibold line-clamp-2 break-words min-w-0 flex-1" style={{ color: 'var(--text)' }} title={li?.title || v.name}>{li?.title || v.name}</p>
                      <button type="button" aria-label={`Remove ${v.name}`} disabled={launching || v.up === 'uploading'}
                        onClick={() => void removeVid(v)}
                        className="rounded-lg p-1 -mt-1 -mr-1 disabled:opacity-40" style={{ color: 'var(--text-2)' }}><X size={15} /></button>
                    </div>
                    {li && tone && (
                      <span className={`self-start inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[10.5px] font-semibold ${TONE[tone].cls}`}>
                        {tone === 'busy' && <Loader2 size={9} className="animate-spin" />}Liftoff: {itemProgressLabel({ ...li, state: li.state as ItemState })}
                      </span>
                    )}
                    <p className="text-[11.5px] tabular-nums break-words" style={{ color: 'var(--text-2)' }}>
                      <span className="rounded-md px-1.5 py-px mr-1.5 font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--text)' }}>{v.kind === 'vertical' ? 'Vertical' : 'Long'}</span>
                      {v.width && v.height ? `${v.width}×${v.height}` : 'frame size not read, treated as long'}
                      {v.duration ? ` · ${clock(v.duration)}` : ''} · {mb(v.size)}{li?.title ? ` · ${v.name}` : ''}
                    </p>
                    {v.up !== 'done' ? (
                      <div className="flex flex-col gap-1 mt-0.5">
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                          <div className="h-full rounded-full transition-[width]" style={{ width: `${v.up === 'failed' ? 100 : pct}%`, background: v.up === 'failed' ? '#EF4444' : TEAL }} />
                        </div>
                        <p className={`text-[11.5px] tabular-nums ${v.up === 'failed' ? 'text-red-700 dark:text-red-300' : ''}`} style={v.up === 'failed' ? undefined : { color: 'var(--text-2)' }}>
                          {v.up === 'failed' ? `Not uploaded: ${v.error}` : v.up === 'waiting' ? 'Waiting to upload' : pct >= 100 ? 'Uploaded, saving it to the drop' : `Uploading ${pct}% · ${mb(v.sent)} of ${mb(v.size)}`}
                        </p>
                      </div>
                    ) : li?.state === 'blocked' && li.reason ? (
                      <p className="text-[11.5px] text-red-700 dark:text-red-300">{li.reason}</p>
                    ) : (
                      <p className="text-[11.5px] text-emerald-700 dark:text-emerald-300">Uploaded to MVP</p>
                    )}
                  </div>
                </header>

                {/* Where it goes. */}
                <div className="grid gap-2 grid-cols-2 lg:grid-cols-3" role="group" aria-label="Where this video goes">
                  {PLACES_OF[v.kind].map((place) => {
                    const why = whyNot(place)
                      || (PLACE_INFO[place].afterYouTube && !has(v, 'liftoff') ? `Needs ${toYouTube ? 'YouTube and Amazon' : 'Amazon'} on` : null)
                      || (PLACE_INFO[place].withBlog && !has(v, 'blog') ? 'Needs Blog post on' : null)
                    return <PlaceTile key={place} place={place} on={has(v, place)} why={why} onClick={() => flipPlace(v, place)}
                      label={place === 'liftoff' && !toYouTube ? 'Amazon' : undefined} />
                  })}
                </div>

                {/* LONG: Liftoff's own editor for this video, as soon as it is in. */}
                {inLiftoff && !li && (
                  <div className="flex flex-col gap-2">
                    {v.adding || (v.launchItemId && !draftBatch) ? (
                      <p className="inline-flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-2)' }}><Loader2 size={12} className="animate-spin" /> Putting it into Liftoff, so its thumbnail is built while you check it</p>
                    ) : v.liftoffError ? (
                      <p className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-red-700 bg-red-500/10 dark:text-red-300 dark:bg-red-400/15">
                        <span className="min-w-0 flex-1">Not in Liftoff: {v.liftoffError}</span>
                        <button type="button" onClick={() => void addToLiftoff(v.key)} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-semibold" style={{ borderColor: 'currentColor' }}><RotateCcw size={11} /> Try again</button>
                      </p>
                    ) : v.up === 'done' && v.itemId && !v.launchItemId ? (
                      <p className="flex flex-wrap items-center gap-2 text-[12px] text-amber-700 dark:text-amber-300">
                        <span className="min-w-0 flex-1">Not in Liftoff yet.</span>
                        <button type="button" onClick={() => void addToLiftoff(v.key)} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-semibold" style={{ borderColor: 'currentColor' }}><RotateCcw size={11} /> Try again</button>
                      </p>
                    ) : null}
                    {!v.launchItemId && (
                      <label className={label} style={{ color: 'var(--text-2)' }}>
                        Product (ASIN or Amazon link)
                        <input value={v.asin} onChange={(e) => change(v.key, { asin: e.target.value, asinFrom: null, productName: null })}
                          className={field} style={fieldStyle} placeholder="B0..." />
                        {v.asinFrom && <span className="font-normal" style={{ color: 'var(--text-2)' }}>Filled from {v.asinFrom === 'file' ? 'the file name' : 'an earlier video'}{v.productName ? `: ${v.productName}` : ''}. Check it.</span>}
                      </label>
                    )}
                    {!v.launchItemId && <DropProduct asin={v.asin} />}
                  </div>
                )}
                {inLiftoff && li && draftBatch && (
                  <div className="flex flex-col gap-3">
                    <DropProduct asin={li.asin ?? ''} />
                    <ItemRowEditor item={li} busy={busyItem === li.id} onSave={patchItem} onMove={moveItem}
                      first={pos <= 0} last={pos === draftBatch.items.length - 1}
                      faces={faces} faceAvailable={draftBatch.faceAvailable} onReload={loadBatch} />
                    {toYouTube && draftBatch.batch.send_to_youtube !== false && (
                      <div className="rounded-xl border p-3 flex flex-col gap-1" style={{ borderColor: 'var(--border)' }}>
                        <p className="text-[12.5px] font-medium inline-flex items-center gap-1.5" style={{ color: 'var(--text)' }}><Clock size={12} /> When it goes public on YouTube</p>
                        <p className="text-[11.5px]" style={{ color: 'var(--text-2)' }}>
                          {draftBatch.ownSchedules
                            ? <>The next free time on your pattern, after your other videos. Pick any day and time instead. Times are yours: {draftBatch.batch.timezone}.</>
                            : <>It follows your daily pattern for now. A time of its own needs a database update (migration 364).</>}
                          {has(v, 'blog') && at ? ` Its blog post goes live ten minutes after it is public.` : ''}
                        </p>
                        <ul className="flex flex-col gap-1">
                          <ScheduleRow n={pos + 1} title={li.title || v.name} sched={at}
                            fixedAt={li.publish_at ?? li.planned_publish_at ?? null} timezone={draftBatch.batch.timezone}
                            locked={!!li.planned_publish_at} available={draftBatch.ownSchedules} busy={busyItem === li.id}
                            onSet={(date, time) => void patchItem(li.id, { schedule: { date, time } })}
                            onReset={() => void patchItem(li.id, { schedule: null })}
                            onDirty={(d) => setDirtyRows((m) => (m[li.id] === d ? m : { ...m, [li.id]: d }))} />
                        </ul>
                        {at && at.at.getTime() <= Date.now() && (
                          <p className="text-[11.5px] text-amber-700 dark:text-amber-300">This time has passed ({fmt(at.at)}): it goes public as soon as it is on YouTube.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* VERTICAL: its words, product and each place's choices. */}
                {v.kind === 'vertical' && (SOCIAL.some((x) => has(v, x)) || has(v, 'amazon')) && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className={label} style={{ color: 'var(--text-2)' }}>
                      Product (ASIN or Amazon link){has(v, 'amazon') ? '' : ', optional'}
                      <input value={v.asin} onChange={(e) => change(v.key, { asin: e.target.value, asinFrom: null, productName: null })}
                        className={field} style={fieldStyle} placeholder="B0..." />
                      {v.asinFrom && <span className="font-normal" style={{ color: 'var(--text-2)' }}>Filled from {v.asinFrom === 'file' ? 'the file name' : 'an earlier video'}{v.productName ? `: ${v.productName}` : ''}. Check it.</span>}
                    </label>
                    <label className={label} style={{ color: 'var(--text-2)' }}>
                      Title (Short, pin and Amazon), optional
                      <input value={v.title} maxLength={95} onChange={(e) => change(v.key, { title: e.target.value })}
                        className={field} style={fieldStyle} placeholder="Empty: the first line of the caption" />
                    </label>
                    {v.asin.trim() && <div className="sm:col-span-2"><DropProduct asin={v.asin} /></div>}
                    {SOCIAL.some((x) => has(v, x)) && (
                      <label className={`sm:col-span-2 ${label}`} style={{ color: 'var(--text-2)' }}>
                        Caption, optional
                        <textarea value={v.caption} rows={3} maxLength={2000} onChange={(e) => change(v.key, { caption: e.target.value })}
                          className={field} style={fieldStyle} placeholder={v.asin ? 'Empty: MVP writes one from the product, with your link and #ad where each platform needs it' : 'Empty: posted without a caption. Add the product and MVP writes one.'} />
                        <span className="font-normal" style={{ color: 'var(--text-2)' }}>Each platform gets its own version: link in bio on TikTok and Instagram, the link on Facebook and Shorts, and its own hashtag count.</span>
                      </label>
                    )}
                  </div>
                )}

                {v.kind === 'vertical' && has(v, 'tiktok') && (
                  <DropTikTok info={tiktokInfo} infoError={tiktokError} value={v.tiktok} onChange={(c) => change(v.key, { tiktok: c })} />
                )}

                {v.kind === 'vertical' && has(v, 'trybe') && canTrybe && (
                  <DropTrybePicker brands={brands} brandsError={brandsError} value={v.trybe} onChange={(c) => change(v.key, { trybe: c })} />
                )}
                {v.places.length === 0 && (
                  <p className="text-[11.5px] text-amber-700 dark:text-amber-300">Not going anywhere yet. Pick a place above, or remove it.</p>
                )}
              </article>
            )
          })}
        </section>
      )}

      {/* ── the one button, always in reach ───────────────────────────────── */}
      {vids.length > 0 && (
        <div className="sticky bottom-3 z-10 rounded-xl border px-3 py-2.5 flex items-center gap-3 flex-wrap"
          style={{ borderColor: blocker ? 'var(--border)' : TEAL, background: 'var(--surface)', boxShadow: '0 6px 24px rgba(0,0,0,0.18)' }}>
          <button type="button" onClick={() => void launch()} disabled={!!blocker || launching}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-45 shrink-0"
            style={{ background: 'linear-gradient(135deg,#0EA5A4,#0891B2)' }}>
            {launching ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />} {stillPreparing ? 'Launch when ready' : 'Launch'}
          </button>
          <span className="min-w-0 flex-1 text-[12px]">
            {launching ? <span style={{ color: 'var(--text-2)' }}>Launching</span>
              : blocker ? <span className="text-amber-700 dark:text-amber-300">{blocker}</span>
                : (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1" style={{ color: 'var(--text-2)' }}>
                    <span className="font-semibold" style={{ color: 'var(--text)' }}>{ready.length} video{ready.length === 1 ? '' : 's'}, {sends} send{sends === 1 ? '' : 's'}</span>
                    {[...new Set(ready.flatMap((v) => v.places))].map((pl) => (
                      <span key={pl} className="inline-flex items-center gap-1"><PlaceIcon place={pl} size={12} />{pl === 'liftoff' && !toYouTube ? 'Amazon' : PLACE_INFO[pl].label}</span>
                    ))}
                    {stillPreparing && <span>· Liftoff is still preparing; it goes once they are ready{bgOn ? ', even with this page closed' : ''}</span>}
                    {toTrybe.length > 0 && <span>· keep this page open while TRYBE sends</span>}
                  </span>
                )}
          </span>
        </div>
      )}

      {/* ── what happened ─────────────────────────────────────────────────── */}
      {drops === null ? (
        <p className="inline-flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--text-2)' }}><Loader2 size={13} className="animate-spin" /> Reading your drops</p>
      ) : drops.length === 0 && vids.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: 'var(--text-2)' }}>
          Nothing launched yet. Your first drop shows up here, with where each video went. <Link href="/liftoff" className="underline">Liftoff</Link> and <Link href="/clip-factory" className="underline">Clip Factory</Link> still work on their own.
        </p>
      ) : (
        <DropResults drops={drops} batches={batches} sending={sending} canSendTrybe={canTrybe}
          onBlogAgain={(id) => void blogAgain(id)} onTrybeAgain={(id) => void trybeAgain(id)} onRemove={(id) => void removeDrop(id)} onSendAgain={(id) => void sendAgain(id)} />
      )}
    </div>
  )
}
