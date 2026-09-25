'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useWearProduct } from '@/components/thumbnails/WearProductToggle'
import ExpressionPicker, { useExpression } from '@/components/thumbnails/ExpressionPicker'
import Link from 'next/link'
import { toast } from 'sonner'
import { createBrowserClient } from '@/lib/supabase/client'
import { asinFromAmazonUrl } from '@/lib/asin'
import SavedProductImage, { saveProductImage, useSavedProductImage } from '@/components/product/SavedProductImage'
import { detectLineEdit, LINE_META, type LineKey } from '@/lib/yt-description-lines'
import PageHero from '@/components/layout/PageHero'
import { CoPilotGuide } from '@/components/guide/tool-guides'
import HeroVideo from '@/components/layout/HeroVideo'
import { walkthroughId } from '@/lib/tutorial-videos'
import { CapReachedBanner } from '@/components/CapReachedBanner'
import { useConfirm } from '@/components/ui/useConfirm'
import { pickWeightedStyleIndex, OVERLAY_STYLES, drawHeadline, type HeadlinePosition, type FaceBox } from '@/lib/thumbnail-overlay'
import { isExtensionAvailable, requestVideoFrames, requestAmazonProduct, requestVideoTranscript, requestStudioSchedule, requestStudioVideos, requestYtSaveRecipes, requestYtApplyDisclosures, requestYtInjectDisclosures, requestStudioFinish, type StudioFinishResult, type YtSaveRecipe, getScoutStatus, requestPinComment } from '@/lib/extension-frame'
import { SCOUT_STORE_LISTING_URL, SCOUT_PIN_MIN_VERSION, scoutAtLeast } from '@/lib/scout-version'
import { draftVisibility, productLinkFor, studioDisclosuresConfirmed, studioSetVisibility, studioRunHeadline, studioPathNote, studioStepLabel, studioStepText, studioStepTone } from '@/lib/studio-finish'
import { effectiveTier } from '@/lib/view-as'
import type { Tier } from '@/lib/tier'
import BrandStylePanel from '@/components/co-pilot/BrandStylePanel'
import ComparisonProducts, { type ComparisonResultItem } from '@/components/co-pilot/ComparisonProducts'
import { canUsePreview } from '@/lib/labs-preview'
import { readComparisonSlots, productLinksInText, type ComparisonSlotInput } from '@/lib/comparison-products'
import {
  Youtube, Wand2, CheckCircle, AlertCircle, Loader2, ExternalLink,
  Copy, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, RefreshCw, Link2, Tag, Lock, Eye, Globe,
  Image, Download, Sparkles, Upload, X, Search, Calendar, Camera, Package, Plus,
} from 'lucide-react'

/** Walkthrough shown beside the page title. */
// THE WALKTHROUGH VIDEO, off until it is re-recorded for the full Studio
// automation (the old one, nHrSHlrN9pI, predates it). Put the new YouTube id
// here and it shows on the page again.
const WALKTHROUGH_ID: string | null = null

interface DraftVideo {
  youtubeVideoId: string
  title: string
  description: string
  thumbnailUrl: string
  status: 'private' | 'unlisted' | 'public'
  publishedAt: string
  /** YouTube scheduled-publish time (status.publishAt). Non-null = scheduled to
   *  go live → treated as done (out of the draft to-do tabs). */
  publishAt?: string | null
  detectedAsin: string | null
  /** ISO timestamp when the user pushed metadata for this video to YouTube
   *  via /api/youtube/apply or /api/youtube/update-metadata. null if we
   *  haven't shipped this one yet. Powers the "Pushed via Co-Pilot" tab. */
  metadataAppliedAt?: string | null
  // Set when metadata was GENERATED for this video in Co-Pilot (mig 150). Moves
  // the video to "Metadata sent" even if the creator finishes it in YouTube
  // Studio directly and never clicks Apply.
  metadataGeneratedAt?: string | null
  /** 0-based position in the uploads playlist (0 = newest upload). The reliable
   *  newest-first sort key — draft publishedAt is a placeholder. */
  uploadPosition?: number | null
}

/**
 * "Which product did we detect?" confirmation. Shows the product MVP resolved
 * for this video and lets the creator correct it in one step by pasting the
 * right Amazon link or ASIN. The correction is stored on the video, and every
 * generator (thumbnails, blog, pins) reads it — so fixing it here fixes the
 * "wrong product" everywhere at once. Renders only inside an expanded card.
 */
function ProductConfirm({ youtubeVideoId, detectedAsin, onFixed, onRewrite }: {
  youtubeVideoId: string; detectedAsin: string | null
  /** The card now works on this ASIN: every generator is sent it. */
  onFixed?: (asin: string) => void
  /** Rewrite the title, description and thumbnail for the product just set.
   *  Offered, not done automatically, so edits already made are not lost. */
  onRewrite?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [fixed, setFixed] = useState<{ title: string; imageUrl: string | null; stored: boolean } | null>(null)

  async function submit() {
    const v = link.trim()
    if (!v) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/youtube/videos/set-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: youtubeVideoId, link: v }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not set the product')
      setFixed({ title: d.title, imageUrl: d.imageUrl ?? null, stored: d.stored !== false })
      if (typeof d.asin === 'string' && d.asin) onFixed?.(d.asin)
      setOpen(false); setLink('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  // QUIET WHEN THERE IS NOTHING TO CONFIRM. With no product found, a full
  // purple bar on every card in the list was noise; a small link is enough,
  // and it opens the box when pressed.
  if (!detectedAsin && !fixed && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mb-2 text-[11px] font-medium text-[#7C3AED] hover:underline">
        + Set the product
      </button>
    )
  }

  return (
    <div className="mb-2 rounded-lg border border-[#7C3AED]/20 bg-[#7C3AED]/[0.04] px-2.5 py-1.5 text-[11px]">
      {fixed ? (
        <div className="flex items-center gap-1.5 text-[#1d1d1f] dark:text-[#f5f5f7]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {fixed.imageUrl && <img src={fixed.imageUrl} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />}
          <span className="font-medium truncate">Product set: {fixed.title}{fixed.stored ? '' : ' (for this visit: MVP has not synced this video yet, so it is not saved)'}</span>
          {onRewrite && (
            <button type="button" onClick={onRewrite} className="ml-auto flex-shrink-0 font-semibold text-[#7C3AED] hover:underline">
              Rewrite for this product →
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[#6e6e73] dark:text-[#8e8e93]">
            {detectedAsin ? <>Product detected: <span className="font-mono">{detectedAsin}</span></> : 'No product detected for this video'}
          </span>
          <button type="button" onClick={() => setOpen(o => !o)} className="font-semibold text-[#7C3AED] hover:underline">
            {detectedAsin ? 'Wrong? Fix it →' : 'Set the product →'}
          </button>
        </div>
      )}
      {open && !fixed && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            placeholder="Paste the Amazon product link or its ASIN"
            className="flex-1 min-w-0 px-2 py-1 rounded-md border border-[var(--border-2,#e5e5e7)] bg-white dark:bg-[#1c1c1e] text-[11px] outline-none focus:border-[#7C3AED]"
          />
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-white bg-[#7C3AED] hover:opacity-90 disabled:opacity-50"
          >
            {busy ? '…' : 'Set'}
          </button>
        </div>
      )}
      {err && <p className="mt-1 text-[10px] text-[#ff3b30]">{err}</p>}
    </div>
  )
}

// ── Tab classification (2026-06-08, simplified 2026-06-20) ─────────────────
// TWO workflow buckets the YouTube Co-Pilot surfaces:
//   - todo  ("Needs metadata"):  a FRESH upload — just its filename title with
//                      an empty description, nothing written yet. This is the
//                      ONLY thing the to-do queue holds. (Per user 2026-06-29.)
//   - shipped ("Metadata sent"): metadata is already in place — either WE
//                      pushed it via /api/youtube/apply (metadataAppliedAt,
//                      backed by youtube_copilot_pushes, mig 109) OR the video
//                      already has a real written description. Not necessarily
//                      live yet.
// A public/live video folds into "shipped" too — it's done. (The separate
// "Live on YouTube" tab was removed 2026-07-02: it sat empty because published
// videos are excluded from the default load, so it only added noise.)
// Classification runs CLIENT-side off the existing drafts payload (which
// includes the description), so the rule can change without redeploying the API.
type VideoTab = 'todo' | 'shipped'

// (kept for reference) ASIN format on Amazon: 10 alphanumerics, almost always
// starting with B0. Product presence shows as the per-row orange "ASIN:" pill,
// not as a classification input — a fresh draft is fresh whether or not it
// names a product.
function classifyVideo(v: Pick<DraftVideo, 'title' | 'description' | 'detectedAsin' | 'metadataAppliedAt' | 'metadataGeneratedAt' | 'status' | 'publishAt'>): VideoTab {
  // SHIPPED wins first: if we GENERATED metadata for this video in Co-Pilot (or
  // pushed it via Apply), that's the authoritative "you've handled it" signal —
  // overrides everything, regardless of status. Generation counts even if the
  // creator finishes the video in YouTube Studio directly (never clicks Apply).
  if (v.metadataAppliedAt || v.metadataGeneratedAt) return 'shipped'

  // PUBLISHED → the video is live; the work is done. Folds into "Metadata sent"
  // (handled) — the separate "Live on YouTube" tab was removed.
  if (v.status === 'public') return 'shipped'

  // SCHEDULED → the creator set a publish time, which they only do once the
  // video is FINISHED (title, thumbnail, description all in place). A scheduled
  // video is never "fresh", so it belongs in "Metadata sent", not "Needs
  // metadata". This is also the reliable signal for SCOUT-synced videos, where
  // the bulk sync gives us the title + status but not always the full
  // description to detect via length below. (Per user 2026-07-02: "I know for a
  // fact these are done" — a wall of scheduled videos sitting in "Needs metadata".)
  if (v.publishAt) return 'shipped'

  // "Needs metadata" should ONLY hold a FRESH upload — a video that is still
  // just its filename title with NOTHING written underneath. The moment a video
  // has a real description (whether MVP wrote it or the creator did), it has
  // been worked on and is no longer "fresh", so it leaves the to-do queue.
  // (Per user 2026-06-29: "needs metadata = a fresh video with only a title —
  // the file's name — and nothing else".) A raw YouTube upload's description is
  // empty; an MVP-generated description runs to hundreds of characters, so a
  // short length threshold cleanly separates fresh from worked-on.
  const hasRealDescription = (v.description || '').trim().length >= 40
  if (hasRealDescription) return 'shipped'

  // Empty/near-empty description → genuinely fresh, still needs metadata.
  return 'todo'
}

// Newest upload first. uploadPosition (0-based index in the uploads playlist,
// 0 = newest) is the RELIABLE key — a never-published draft's publishedAt is a
// YouTube placeholder, so sorting on it scrambles the list. Fall back to
// publishedAt only when position is unknown (e.g. search.list results).
function byNewestUpload(a: DraftVideo, b: DraftVideo): number {
  const pa = a.uploadPosition, pb = b.uploadPosition
  const aHas = typeof pa === 'number', bHas = typeof pb === 'number'
  if (aHas && bHas) { if (pa !== pb) return (pa as number) - (pb as number) }
  else if (aHas !== bHas) return aHas ? -1 : 1  // known positions sort ahead
  return (b.publishedAt || '').localeCompare(a.publishedAt || '')
}

interface GeneratedMetadata {
  title: string
  description: string
  tags: string[]
  pinnedComment: string
  title_alternatives: string[]
}

interface AgentInsights {
  targetBuyer: string
  topBenefits: string[]
  painPoints: string[]
}

interface ProductInfo {
  title: string | null
  price: string | null
  rating: string | null
  imageUrl: string | null
  bullets?: string[]
  description?: string
}

/** Settings the Pro YouTube batch-apply panel pushes to YT in one shot.
 *  Note: paidPromotion + alteredContent intentionally NOT here — YouTube's
 *  Data API doesn't expose those fields. They're surfaced in the post-apply
 *  "Finish in Studio (3 clicks)" callout instead. */
interface ProPublishSettings {
  playlistId: string | null
  madeForKids: boolean       // false by default
  notifySubscribers: boolean // false by default — never spam the subscriber bell
  // 'draft' = push metadata/thumbnail only, never touch the video's
  // published state (it stays an unpublished YouTube draft).
  privacyStatus: 'draft' | 'public' | 'unlisted' | 'private'
  scheduleMode: 'now' | 'in1h' | 'in6h' | 'in24h' | 'custom'
  /** datetime-local value (local time, no zone) when scheduleMode === 'custom'. */
  scheduleAt: string
}

const defaultProSettings: ProPublishSettings = {
  playlistId: null,
  madeForKids: false,
  notifySubscribers: false,
  privacyStatus: 'draft',
  scheduleMode: 'now',
  scheduleAt: '',
}

// Shared GET cache across ALL VideoStudioCard instances. Face models, saved
// thumbnail styles and feedback weights are user/niche-global, not per-video —
// but every card fetched them on mount, so "Load all drafts" (hundreds of cards)
// fired hundreds of identical requests. This collapses them to ONE request per
// distinct URL (60s TTL), de-duping concurrent mounts via the shared promise.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _coPilotGetCache = new Map<string, { at: number; p: Promise<any> }>()
function cachedGet<T>(url: string): Promise<T> {
  const now = Date.now()
  const hit = _coPilotGetCache.get(url)
  if (hit && now - hit.at < 60_000) return hit.p as Promise<T>
  const p = fetch(url).then(r => {
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  })
  // Evict on failure so a later mount can retry.
  p.catch(() => { if (_coPilotGetCache.get(url)?.p === p) _coPilotGetCache.delete(url) })
  _coPilotGetCache.set(url, { at: now, p })
  return p as Promise<T>
}

// ── Content calendar ────────────────────────────────────────────────────────
// Month grid that plots the channel's videos as dots: PURPLE = scheduled
// (status.publishAt set — whether MVP or YouTube Studio set it), GREEN =
// published (public + publishedAt). Data comes from /api/youtube/calendar,
// which pulls FRESH from YouTube every call (no cache), so a schedule set
// directly on YouTube shows up here too. Click a day → its videos list below;
// clicking a video scrolls to its card (or opens it on YouTube if not loaded).
function ContentCalendar({ channelId, refreshNonce }: { channelId: string | null; refreshNonce: number }) {
  type CalEvent = { youtubeVideoId: string; title: string; status: string; publishAt: string | null; publishedAt: string }
  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  // SCOUT's scheduled videos kept in their OWN state and merged at render time
  // (below). Critical: the API fetch does setEvents(replace), so if we merged
  // SCOUT into events directly, a late-resolving API call would clobber it
  // (the race that emptied the calendar). Separate state can't be overwritten.
  const [scoutVideos, setScoutVideos] = useState<CalEvent[]>([])
  const now = new Date()
  const [viewY, setViewY] = useState(now.getFullYear())
  const [viewM, setViewM] = useState(now.getMonth())
  const [selected, setSelected] = useState<string | null>(null)
  // Opt-in gate: the calendar runs a (potentially deep) YouTube scan, so we do
  // NOT load it until the user explicitly asks — that keeps the shared daily
  // YouTube API quota for the people who actually use the calendar. The choice
  // is remembered in localStorage, so once opted in it just appears (served from
  // the persistent cache, which only tops up new uploads — see the calendar
  // route). `hydrated` avoids flashing the opt-in prompt to users who already
  // turned it on.
  const CAL_ENABLED_KEY = 'mvp_copilot_calendar_enabled'
  const [enabled, setEnabled] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    try { setEnabled(localStorage.getItem(CAL_ENABLED_KEY) === '1') } catch { /* ignore */ }
    setHydrated(true)
  }, [])
  function enableCalendar() {
    try { localStorage.setItem(CAL_ENABLED_KEY, '1') } catch { /* ignore */ }
    setEnabled(true)
  }

  useEffect(() => {
    if (!enabled) return       // not opted in → make NO YouTube calls at all
    let cancelled = false
    setLoading(true); setErr(null)
    const params = new URLSearchParams()
    if (channelId) params.set('channelId', channelId)
    // refreshNonce only advances when the user hits "Refresh from YouTube" —
    // force a fresh full scan then; otherwise serve the cached library scan.
    if (refreshNonce > 0) params.set('refresh', '1')
    const qs = params.toString() ? `?${params.toString()}` : ''
    fetch(`/api/youtube/calendar${qs}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d?.error) setErr(typeof d.error === 'string' ? d.error : 'Could not load calendar')
        else setEvents(Array.isArray(d?.events) ? d.events : [])
      })
      .catch(() => { if (!cancelled) setErr('Could not load calendar') })
      .finally(() => { if (!cancelled) setLoading(false) })

    // ── SCOUT supplement (Studio's complete scheduled list) ────────────────
    // The Data API misses most scheduled videos on large channels; SCOUT reads
    // Studio's own Content list, which knows them all. Cache the result in
    // localStorage (per channel, 30-min TTL) so we DON'T open a background
    // Studio tab on every visit — show the cached list instantly and only
    // re-scrape when it's stale or the user hits "Refresh from YouTube".
    const SCOUT_KEY = `mvp_scout_sched_${channelId || 'default'}`
    const SCOUT_TTL = 30 * 60 * 1000
    let cachedScout: { events?: CalEvent[]; cachedAt?: number } | null = null
    try { const raw = localStorage.getItem(SCOUT_KEY); if (raw) cachedScout = JSON.parse(raw) } catch { /* ignore */ }
    if (cachedScout && Array.isArray(cachedScout.events)) setScoutVideos(cachedScout.events)
    const scoutFresh = !!cachedScout && Array.isArray(cachedScout.events) && (Date.now() - (cachedScout.cachedAt || 0)) < SCOUT_TTL
    if (!scoutFresh || refreshNonce > 0) {
      requestStudioSchedule().then(s => {
        if (cancelled || !s.ok || !s.videos.length) return
        const mapped: CalEvent[] = s.videos.map(v => ({ youtubeVideoId: v.videoId, title: v.title, status: 'private', publishAt: v.publishAt, publishedAt: '' }))
        setScoutVideos(mapped)
        try { localStorage.setItem(SCOUT_KEY, JSON.stringify({ events: mapped, cachedAt: Date.now() })) } catch { /* ignore */ }
      }).catch(() => { /* best effort */ })
    }
    return () => { cancelled = true }
  }, [channelId, refreshNonce, enabled])

  const PURPLE = '#7C3AED', GREEN = '#34C759'
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const pad = (n: number) => String(n).padStart(2, '0')
  // Bucket by LOCAL date so a dot lands on the day the creator sees it go live.
  const localKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
  const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

  // Merge API events with SCOUT's scheduled videos (SCOUT wins per id — it's
  // the authoritative, complete scheduled source). Done at render time so
  // neither async source can clobber the other.
  const mergedEvents = useMemo(() => {
    if (!scoutVideos.length) return events
    const byId = new Map(events.map(e => [e.youtubeVideoId, e]))
    for (const v of scoutVideos) byId.set(v.youtubeVideoId, v)
    return Array.from(byId.values())
  }, [events, scoutVideos])

  const byDate = useMemo(() => {
    const m: Record<string, Array<{ id: string; title: string; kind: 'scheduled' | 'published' }>> = {}
    for (const e of mergedEvents) {
      if (e.publishAt) {
        const k = localKey(e.publishAt); (m[k] ||= []).push({ id: e.youtubeVideoId, title: e.title, kind: 'scheduled' })
      } else if (e.status === 'public' && e.publishedAt) {
        const k = localKey(e.publishedAt); (m[k] ||= []).push({ id: e.youtubeVideoId, title: e.title, kind: 'published' })
      }
    }
    return m
  // localKey is a pure helper; mergedEvents is the only real dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedEvents])

  let mSched = 0, mPub = 0
  Object.keys(byDate).forEach(k => {
    const [y, mm] = k.split('-').map(Number)
    if (y === viewY && mm - 1 === viewM) byDate[k].forEach(ev => ev.kind === 'scheduled' ? mSched++ : mPub++)
  })

  const first = new Date(viewY, viewM, 1).getDay()
  const dim = new Date(viewY, viewM + 1, 0).getDate()
  const cells = Math.ceil((first + dim) / 7) * 7

  function shiftMonth(delta: number) {
    let y = viewY, mo = viewM + delta
    if (mo < 0) { mo = 11; y -= 1 }
    if (mo > 11) { mo = 0; y += 1 }
    setViewY(y); setViewM(mo)
  }
  function gotoVideo(id: string) {
    const el = document.getElementById(`copilot-vid-${id}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('ring-2', 'ring-[#7C3AED]')
      setTimeout(() => el.classList.remove('ring-2', 'ring-[#7C3AED]'), 1800)
    } else {
      window.open(`https://www.youtube.com/watch?v=${id}`, '_blank', 'noopener,noreferrer')
    }
  }

  const selectedEvents = selected ? (byDate[selected] || []) : []

  // Opt-in gate (see CAL_ENABLED_KEY above). Until the user confirms, render the
  // calendar's frame with a confirmation button INSTEAD of auto-scanning YouTube
  // — so the layout stays intact but no quota is spent for people who skip it.
  if (!hydrated) return <div className="card p-4 min-h-[280px]" aria-hidden />
  if (!enabled) {
    return (
      <div className="card p-4">
        <div className="flex flex-col items-center justify-center text-center gap-3 px-4 py-10 min-h-[260px]">
          <div className="w-12 h-12 rounded-2xl bg-[#7C3AED]/10 flex items-center justify-center">
            <Calendar size={22} className="text-[#7C3AED]" />
          </div>
          <h3 className="text-[15px] font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Your YouTube publishing schedule</h3>
          <p className="text-xs text-[#6e6e73] dark:text-[#8e8e93] max-w-xs leading-relaxed">
            See every scheduled and published video on a month calendar, pulled from YouTube. We only load it when you ask, so it never slows the page down.
          </p>
          <button
            type="button"
            onClick={enableCalendar}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] transition-colors"
          >
            <Calendar size={15} /> Yes, show my YouTube schedule
          </button>
          <p className="text-[11px] text-[#a1a1a6] dark:text-[#6e6e73]">Loads once, then stays cached — only new uploads are fetched after.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Calendar size={15} className="text-[#7C3AED] flex-shrink-0" />
          <span className="text-sm font-bold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{MONTHS[viewM]} {viewY}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-[#86868b] hover:bg-gray-100 dark:hover:bg-white/10"><ChevronLeft size={15} /></button>
          <button type="button" onClick={() => { setViewY(now.getFullYear()); setViewM(now.getMonth()); setSelected(todayKey) }} className="px-2 h-7 text-[11px] font-semibold rounded-lg text-[#7C3AED] hover:bg-[#7C3AED]/10">Today</button>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-[#86868b] hover:bg-gray-100 dark:hover:bg-white/10"><ChevronRight size={15} /></button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3 text-[11px] text-[#86868b] dark:text-[#8e8e93]">
        <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: PURPLE }} />Scheduled</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: GREEN }} />Published</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-[#86868b] text-xs"><Loader2 size={14} className="animate-spin mr-2" /> Scanning your library…</div>
      ) : err ? (
        <div className="py-6 text-center text-xs text-[#86868b] dark:text-[#8e8e93]">{err}</div>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <div key={i} className="text-center text-[10px] text-[#86868b] dark:text-[#8e8e93]">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: cells }).map((_, i) => {
              const day = i - first + 1
              if (day < 1 || day > dim) return <div key={i} className="h-9" />
              const k = `${viewY}-${pad(viewM + 1)}-${pad(day)}`
              const evs = byDate[k] || []
              const isToday = k === todayKey
              const isSel = k === selected
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelected(k)}
                  className={`h-9 rounded-lg flex flex-col items-center justify-start pt-1 transition-colors ${
                    isSel ? 'bg-[#7C3AED]/10 ring-1 ring-[#7C3AED]'
                      : isToday ? 'ring-1 ring-[#86868b]/40'
                        : 'hover:bg-gray-100 dark:hover:bg-white/10'
                  }`}
                >
                  <span className={`text-[11px] leading-none text-[#1d1d1f] dark:text-[#f5f5f7] ${isToday || isSel ? 'font-bold' : ''}`}>{day}</span>
                  <div className="flex gap-0.5 mt-1 items-center min-h-[5px]">
                    {evs.slice(0, 3).map((ev, j) => (
                      <span key={j} className="w-[5px] h-[5px] rounded-full" style={{ background: ev.kind === 'scheduled' ? PURPLE : GREEN }} />
                    ))}
                    {evs.length > 3 && <span className="text-[8px] text-[#86868b] leading-none">+{evs.length - 3}</span>}
                  </div>
                </button>
              )
            })}
          </div>

          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-3">{mPub} published · {mSched} scheduled this month</p>

          {selected && (
            <div className="mt-2 pt-3 border-t border-gray-100 dark:border-white/10">
              <p className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">
                {new Date(selected + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              </p>
              {selectedEvents.length === 0 ? (
                <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Nothing scheduled or published.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {selectedEvents.map((ev, j) => (
                    <button key={j} type="button" onClick={() => gotoVideo(ev.id)} className="flex items-center gap-2 text-left py-1 hover:opacity-80">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ev.kind === 'scheduled' ? PURPLE : GREEN }} />
                      <span className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7] truncate flex-1 min-w-0">{ev.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * PIN A FIRST COMMENT THROUGH SCOUT, AND SAY WHAT HAPPENED. YouTube has no
 * pin API, so SCOUT pins it in the creator's own signed-in YouTube and
 * reports whether the pinned badge showed; that report is saved.
 */
async function pinFirstComment(rowId: string, youtubeVideoId: string, commentId: string): Promise<{ pinned: boolean; error?: string }> {
  const scout = await getScoutStatus()
  const fail = (error: string) => ({ pinned: false, error })
  let r: { pinned: boolean; error?: string }
  if (!scout.installed) r = fail('SCOUT is not installed in this browser, so it is not pinned. Pin it in YouTube Studio.')
  else if (!scoutAtLeast(scout.version, SCOUT_PIN_MIN_VERSION)) r = fail(`SCOUT ${scout.version ?? ''} cannot pin yet; Chrome updates it by itself soon.`)
  else {
    const res = await requestPinComment(youtubeVideoId, commentId)
    r = res.ok && res.pinned ? { pinned: true } : fail(`${res.error || 'SCOUT could not pin it.'}${res.steps ? ` What SCOUT saw: ${res.steps}.` : ''}`)
  }
  await fetch(`/api/youtube/first-comment/${rowId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pin_result', pinned: r.pinned, error: r.error }),
  }).catch(() => {})
  return r
}

/**
 * FIRST COMMENTS WAITING FOR THEIR PIN. A scheduled video gets its first
 * comment posted by the job while nobody is on the page, and only SCOUT, in
 * the creator's browser, can pin it. So Co-Pilot lists the posted ones not
 * yet pinned and pins them in one press, one video at a time, saying what
 * happened to each. Hidden when there is nothing to pin.
 */
function FirstCommentsToPin() {
  type Row = { id: string; youtube_video_id: string; video_title: string | null; state: string; comment_id: string | null; pinned: boolean | null; pin_error: string | null; last_error: string | null }
  const [rows, setRows] = useState<Row[]>([])
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState<Record<string, { pinned: boolean; error?: string }>>({})
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/youtube/first-comment')
      const j = await r.json().catch(() => ({}))
      if (r.ok) setRows((j.comments ?? []) as Row[])
    } catch { /* the banner is extra */ }
  }, [])
  useEffect(() => { void load() }, [load])
  const toPin = rows.filter((r) => r.state === 'posted' && r.comment_id && r.pinned !== true)
  const failed = rows.filter((r) => r.state === 'failed').slice(0, 3)
  if (toPin.length === 0 && failed.length === 0) return null
  async function pinAll() {
    setRunning(true)
    for (const r of toPin) {
      const res = await pinFirstComment(r.id, r.youtube_video_id, r.comment_id as string)
      setDone((d) => ({ ...d, [r.id]: res }))
    }
    setRunning(false)
    void load()
  }
  return (
    <div className="mb-4 rounded-xl border border-[#ff9500]/30 bg-[#ff9500]/5 px-4 py-3 text-[12.5px] text-[#1d1d1f] dark:text-[#f5f5f7]">
      {toPin.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span><b>{toPin.length} first {toPin.length === 1 ? 'comment is' : 'comments are'} on your videos but not pinned yet.</b> SCOUT opens each video for a few seconds and pins it.</span>
          <button type="button" onClick={() => void pinAll()} disabled={running}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white disabled:opacity-60" style={{ background: '#ff9500' }}>
            {running ? <Loader2 size={12} className="animate-spin" /> : null} {running ? 'Pinning…' : 'Pin them with SCOUT'}
          </button>
        </div>
      )}
      {toPin.some((r) => done[r.id] || r.pinned === false) && (
        <ul className="mt-2 flex flex-col gap-0.5 text-[11.5px]">
          {toPin.map((r) => {
            const res = done[r.id]
            const err = res ? (res.pinned ? null : res.error) : r.pin_error
            if (!res && r.pinned !== false) return null
            return (
              <li key={r.id} style={{ color: res?.pinned ? '#34c759' : '#ff9500' }}>
                {r.video_title || r.youtube_video_id}: {res?.pinned ? 'pinned' : `not pinned (${err || 'no reason given'})`}
              </li>
            )
          })}
        </ul>
      )}
      {failed.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 text-[11.5px] text-[#ff3b30]">
          {failed.map((r) => <li key={r.id}>First comment not posted on {r.video_title || r.youtube_video_id}: {r.last_error}</li>)}
        </ul>
      )}
    </div>
  )
}

function VideoStudioCard({ video, userTier, playlists, onApplied, isShort = null }: {
  video: DraftVideo
  userTier: Tier
  /** SHORT MODE (Labs): true when YouTube says this video is a Short, null when unknown. */
  isShort?: boolean | null
  playlists: Array<{ id: string; title: string }>
  /** Fires AFTER a successful Apply to YouTube with the pushed video's id so
   *  the parent can move just THAT video into the "🚀 Pushed via Co-Pilot" tab
   *  in place — no full re-fetch (which would re-scan and shrink the list). */
  onApplied?: (videoId: string) => void
}) {
  const isPro = userTier === 'pro' || userTier === 'admin'
  const { confirm, ConfirmHost } = useConfirm()
  const [generating, setGenerating] = useState(false)
  const [applying, setApplying] = useState(false)
  const [finishCheckDone, setFinishCheckDone] = useState(false)
  // Run state for SCOUT's Studio steps, which now run by themselves after
  // every push when SCOUT is installed (see finishOptIn below).
  // Monetization is a separate sub-toggle because not every channel is
  // monetized (no YPP = no toggle and no ad rating); end screen applies to all.
  // NO LONGER AN OPT-IN. The creator's rule: nobody should ever have to finish
  // a video in Studio. With SCOUT installed it runs every step by itself right
  // after the push; there is nothing to tick.
  const finishOptIn = true
  const finishDoDetails = true
  const finishDoMonetize = true
  const finishDoAdRating = true
  const finishDoTag = true
  const finishDoEndScreen = true
  const anyFinishStep = true
  // What YouTube reported about paid promotion and AI use after the push,
  // through its own API. A ref as well, for the step after SCOUT, which runs
  // in the same call as the push and cannot wait for a re-render.
  const [apiDisclosures, setApiDisclosures] = useState<{ asked: boolean; paidPromotion: boolean | null; aiUseNo: boolean | null; error: string | null } | null>(null)
  const apiDisclosuresRef = React.useRef<typeof apiDisclosures>(null)
  const [finishRunning, setFinishRunning] = useState(false)
  const [finishResult, setFinishResult] = useState<StudioFinishResult | null>(null)
  // Dev: captured YouTube Studio save requests (yt-hook) — used to learn the
  // real InnerTube disclosure request shape for the replay build.
  const [ytRecipes, setYtRecipes] = useState<YtSaveRecipe[] | null>(null)
  const [ytRecipeLoading, setYtRecipeLoading] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)
  const [generated, setGenerated] = useState<GeneratedMetadata | null>(null)
  const [agentInsights, setAgentInsights] = useState<AgentInsights | null>(null)
  const [product, setProduct] = useState<ProductInfo | null>(null)
  const [affiliateUrl, setAffiliateUrl] = useState<string | null>(null)
  const [geniuslinkUsed, setGeniuslinkUsed] = useState<boolean | null>(null)
  /** WHAT THE SERVER ACTUALLY BUILT, not what the URL looks like from here.
   *  The badge below used to guess from the URL shape: Geniuslink, else a
   *  "?tag=" substring, else "Plain Amazon link". A Passport link is
   *  mvpl.ink/<code> and carries neither, so every working Passport link was
   *  labelled a plain Amazon link, and a creator who had just switched to
   *  Passport was told his links were not being built. The server already sends
   *  the answer; the badge simply was not reading it. */
  const [linkStyleUsed, setLinkStyleUsed] = useState<'passport' | 'geniuslink' | 'bitly' | 'direct' | null>(null)
  /** Where the product attached to this generation came from:
   *  'caller' = user dropped an ASIN in the YT title themselves
   *  'title'  = same (server detected the ASIN in the title)
   *  'search' = no ASIN, we asked Haiku to extract the product name
   *             and scraped Amazon search for the match
   *  'none'   = general video, no product attached */
  const [productDiscoverySource, setProductDiscoverySource] = useState<'caller' | 'title' | 'search' | 'none' | null>(null)
  const [proSettings, setProSettings] = useState<ProPublishSettings>(defaultProSettings)
  const [geniuslinkError, setGeniuslinkError] = useState<string | null>(null)
  /** True when Geniuslink was skipped because of the creator's chosen link
   *  style, not because it failed. A different message: nothing is broken, a
   *  setting is pointing somewhere else, and telling them to check their
   *  credentials would send them looking for a fault that isn't there. */
  const [geniuslinkSkippedByStyle, setGeniuslinkSkippedByStyle] = useState(false)
  /** The chosen link style was actually delivered. The note below is then a
   *  fact about the creator's setup, not a failure, and must not be dressed as
   *  one: an amber box with a warning triangle on every single generation is
   *  how a correct configuration got reported as a broken product. */
  const [linkStyleHonoured, setLinkStyleHonoured] = useState(false)
  // False only when the affiliate link is somehow missing from the assembled
  // description (server double-checks this). Defaults true (nothing to flag).
  const [geniuslinkVerified, setGeniuslinkVerified] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  /** A step that is STILL RUNNING, not a failure.
   *
   *  "Amazon blocked our server, grabbing the product through SCOUT…" used to be
   *  pushed through setError, so the recovery working printed in the same red as
   *  a generation that had died. It reads as the product falling over at the
   *  exact moment it is routing around a block, and it was reported as one. The
   *  rule this encodes is the same one the badges follow: a state has to look
   *  like what it is. Progress is violet and sits with the running swarm; only
   *  a real stop is red. */
  const [progress, setProgress] = useState<string | null>(null)
  // True when the last generate failed the ASIN-mismatch tripwire → show "Generate anyway".
  const [asinMismatch, setAsinMismatch] = useState(false)
  // The server stopped because it could not tell the product and had nothing to go on.
  const [needsProduct, setNeedsProduct] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)
  // WHAT HAPPENED TO THE TIME, not what was asked. With SCOUT finishing, the
  // push sends no status, and the button used to turn green with "Scheduled
  // on YouTube" before (and whether or not) anything set the schedule.
  const [statusOutcome, setStatusOutcome] = useState<'set' | 'held' | null>(null)
  // The time and draft choice the push actually used, so Retry finishes THAT
  // push. Recomputed from the dropdown, "in 1 hour" became an hour from the
  // retry, not from the push.
  const pushedRef = React.useRef<{ publishAt: string | null; isDraft: boolean } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  /** Set when the creator has rewritten one of MVP's own boilerplate lines in
   *  the box below. Their edit already goes out with THIS video; the offer is
   *  to keep it for every future one, which until now they could not do at all.
   *  Detected by exact match against the lines MVP emitted, not by diffing, so
   *  a product name or a hashtag can never be mistaken for a template. */
  const [lineEditOffer, setLineEditOffer] = useState<{ key: LineKey; text: string } | null>(null)
  const [savingLine, setSavingLine] = useState(false)
  const [savedLineKey, setSavedLineKey] = useState<LineKey | null>(null)
  const [descOverrides, setDescOverrides] = useState<Record<string, unknown> | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [thumbnailPrompt, setThumbnailPrompt] = useState<string | null>(null)
  const [thumbnailModel, setThumbnailModel] = useState<string | null>(null)
  const [thumbnailHook, setThumbnailHook] = useState<string | null>(null)
  const [gfxTitleInput, setGfxTitleInput] = useState('')
  // Which face the composed thumbnail locked to (Auto-match result), shown so
  // the user can confirm it picked the right person.
  const [thumbnailFaceUsed, setThumbnailFaceUsed] = useState<string | null>(null)
  // Server-side debug (faceDebug) — on a fallback render it explains why the
  // primary designed path didn't run, so we can diagnose without server logs.
  const [thumbnailDebug, setThumbnailDebug] = useState<string | null>(null)
  const [sceneAnalysis, setSceneAnalysis] = useState<string | null>(null)
  const [generatingThumbnail, setGeneratingThumbnail] = useState(false)
  const [thumbnailError, setThumbnailError] = useState<string | null>(null)
  // Cache the real video frames grabbed by the extension, per video — so the
  // baked⇄crisp toggles don't re-open YouTube every time (one capture / video).
  const capturedFramesRef = React.useRef<{ videoId: string; frames: string[] } | null>(null)
  // Which overlay style was applied to the current thumbnail. Drives the
  // 👍 / 👎 row so reactions attribute to a styleId.
  const [thumbnailStyleId, setThumbnailStyleId] = useState<string | null>(null)
  const [thumbnailFeedbackSent, setThumbnailFeedbackSent] = useState<'like' | 'dislike' | null>(null)
  // Aggregated 👍/👎 history (YouTube surface) — fed to the weighted
  // picker so styles the user keeps rewarding get more shots, and
  // styles they keep rejecting get fewer.
  const [ytStyleWeights, setYtStyleWeights] = useState<{ liked: Record<string, number>; disliked: Record<string, number> }>({ liked: {}, disliked: {} })
  /** Locked headline — when set, the AI doesn't generate a hook, and the
   *  image prompt explicitly says "no text". We then overlay this text
   *  client-side via canvas so it's always crisp. 2–5 words works best. */
  const [customHeadline, setCustomHeadline] = useState('')
  /** Test & Compare kit (#20): how many distinct variants to generate per
   *  click so the user can pick the strongest. Default 1 (fast); bump to 2–3
   *  to compare. Each extra variant adds an image generation (slower + one
   *  more against the thumbnail cap), so comparison is opt-in. */
  // Variants selector removed — always generate a single thumbnail per click.
  const variantCount = 1
  /** All generated variants (best-first, with CTR scores) for the compare
   *  grid. The large preview shows the currently-selected one (thumbnailUrl). */
  const [thumbnailVariants, setThumbnailVariants] = useState<Array<{ url: string; score: number | null }>>([])
  // Title picker: the 5 AI title options + which one is active. On the clean
  // (overlay) path, clicking a title re-draws it on the text-free base image
  // instantly (no regeneration). titleOverlayCtx holds everything addTextOverlay
  // needs except the title; null = the active thumbnail can't be re-titled
  // client-side (baked text / upload).
  const [titleOptions, setTitleOptions] = useState<string[]>([])
  const [selectedTitleIdx, setSelectedTitleIdx] = useState(0)
  const [titleOverlayCtx, setTitleOverlayCtx] = useState<{ baseUrl: string; styleIndex: number; cutoutUrl?: string; position?: HeadlinePosition; faceBox?: FaceBox } | null>(null)
  const [retitling, setRetitling] = useState(false)
  /** Pre-generation prompt — opens when the user clicks Generate Thumbnail
   *  so they consciously decide whether to write their own headline or
   *  let MVP do it, before any AI work fires. */
  const [headlinePromptOpen, setHeadlinePromptOpen] = useState(false)
  // Remembers which generate path opened the picker, so "Start generation"
  // runs the right one: { textMode:'graphic' } = Create my MVP Thumbnail,
  // { noHuman:true } = Product Only. Both paths bake the picked headline.
  const [pendingThumbOpts, setPendingThumbOpts] = useState<{ textMode?: 'baked' | 'clean' | 'graphic'; noHuman?: boolean }>({})
  // Headline picker: index into pickerTitles, or 'custom' for write-your-own.
  // Defaults to 0 (the first AI-suggested option) so the modal feels "ready"
  // the moment titles load — Start can be clicked immediately.
  const [headlinePromptChoice, setHeadlinePromptChoice] = useState<number | 'custom'>(0)
  // Five product-specific title options fetched from /api/youtube/generate-titles
  // when the modal opens (or when the user hits Regenerate). Named pickerTitles
  // (not titleOptions) to avoid colliding with the post-generation swap-chip
  // state above — these two title sets are independent by design (the modal
  // ones lock the headline pre-render; the swap chips re-overlay post-render).
  const [pickerTitles, setPickerTitles] = useState<string[]>([])
  const [titleOptionsLoading, setTitleOptionsLoading] = useState(false)
  const [titleOptionsError, setTitleOptionsError] = useState<string | null>(null)
  /** Optional style-reference image URL — Haiku vision distills it
   *  into a style brief that gets folded into the Flux prompt. Public
   *  URL from Supabase storage. */
  const [styleReferenceUrl, setStyleReferenceUrl] = useState<string | null>(null)
  // Saved style presets. The user can pin a small library of "looks" and one-
  // click apply them across thumbnails for channel-wide visual consistency.
  // loadedPresetId tracks whether the active styleReferenceUrl came from a saved
  // preset (so we don't offer "Save as preset" on something already saved).
  const [savedStyles, setSavedStyles] = useState<Array<{ id: string; name: string; reference_url: string }>>([])
  const [loadedPresetId, setLoadedPresetId] = useState<string | null>(null)
  const [savingPreset, setSavingPreset] = useState(false)
  const [styleRefUploading, setStyleRefUploading] = useState(false)
  /** 3C — Up to 5 product reference photos the user uploads to ground the
   *  thumbnail composition on the ACTUAL product(s). Different from
   *  the creator's own selfies; these are clean product shots — front view, side angle, multiple products for
   *  comparison thumbnails, etc. Public Supabase URLs. */
  const [productImageUrls, setProductImageUrls] = useState<string[]>([])
  const [productImagesUploading, setProductImagesUploading] = useState(false)
  /** 3C — Optional composition direction folded into the Nano Banana Pro
   *  prompt — e.g. "front view on the left, side angle on the right".
   *  Only meaningful with 2+ product photos; the UI shows the input then. */
  const [productCompositionNote, setProductCompositionNote] = useState('')
  /** Free-text creator direction for the WHOLE thumbnail — "describe the
   *  thumbnail you want". Steers the AI scene/mood/pose/expression/background
   *  via the route's creatorDirectionClause. Optional; identity-lock + product
   *  fidelity always win over it. Sent on every generate path. */
  const [scenePrompt, setScenePrompt] = useState('')
  /** Optional creator-pasted product link — guarantees MVP renders the exact
   *  product (Amazon / geni.us / store URL). Sent on every generate path. */
  const [productUrl, setProductUrl] = useState('')
  // THE PRODUCT THE CREATOR SET on this card, which wins over the ASIN read
  // from the video's title. It used to be stored and then ignored: every
  // generator was still sent the title's ASIN, so fixing a wrong product
  // changed nothing until a reload, and a wrong ASIN in the title won even
  // then.
  const [fixedAsin, setFixedAsin] = useState<string | null>(null)
  const cardAsin = fixedAsin ?? video.detectedAsin ?? null
  /** When a product is already detected for the video, the paste box is hidden
   *  behind this toggle — the creator only reveals it to override the detection. */
  const [overrideProduct, setOverrideProduct] = useState(false)
  // COMPARISON VIDEO (Labs): 2 to 4 products in one video, set before generating.
  const canCompare = canUsePreview('comparison', userTier)
  // SHORT MODE (Labs): only when YouTube itself says this video is a Short.
  const shortMode = isShort === true && canUsePreview('shorts_mode', userTier)
  const [shortResult, setShortResult] = useState<{ fullReviewUrl: string | null } | null>(null)
  // PINNED FIRST COMMENT (Labs): posted by MVP when the video is public, pinned by SCOUT.
  const canFirstComment = canUsePreview('first_comment', userTier)
  const [firstCommentOn, setFirstCommentOn] = useState(true)
  const [firstComment, setFirstComment] = useState<
    | { state: 'sending' }
    | { state: 'waiting'; publishAt: string | null }
    | { state: 'posted'; pinned: boolean | null; pinError?: string; already?: boolean }
    | { state: 'failed'; error: string }
    | null
  >(null)
  async function queueFirstComment() {
    const text = (generated?.pinnedComment || '').trim()
    if (!canFirstComment || !firstCommentOn || !text) return
    setFirstComment({ state: 'sending' })
    try {
      const r = await fetch('/api/youtube/first-comment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtubeVideoId: video.youtubeVideoId, text, videoTitle: editTitle || video.title }),
      })
      const j = await r.json().catch(() => ({}))
      if (j.state === 'posted' && j.commentId) {
        if (j.already) { setFirstComment({ state: 'posted', pinned: null, already: true }); return }
        setFirstComment({ state: 'posted', pinned: null })
        const pin = await pinFirstComment(String(j.id), video.youtubeVideoId, String(j.commentId))
        setFirstComment({ state: 'posted', pinned: pin.pinned, pinError: pin.error })
      } else if (j.state === 'waiting') {
        setFirstComment({ state: 'waiting', publishAt: (j.publishAt ?? null) as string | null })
      } else {
        setFirstComment({ state: 'failed', error: String(j.error || 'The first comment could not be queued.') })
      }
    } catch { setFirstComment({ state: 'failed', error: 'Could not reach the server. Nothing was queued.' }) }
  }
  const [compareOn, setCompareOn] = useState(false)
  const [compareSlots, setCompareSlots] = useState<ComparisonSlotInput[]>([])
  const [compareResult, setCompareResult] = useState<ComparisonResultItem[] | null>(null)
  const [compareSaved, setCompareSaved] = useState<'saved' | 'missing_column' | 'no_row' | 'failed' | null>(null)
  const toggleCompare = (on: boolean) => {
    setCompareOn(on)
    if (on && compareSlots.length === 0) {
      // Filled in from what MVP can already see: the card's product first,
      // then product links in the video's description.
      const seen: string[] = []
      for (const v of [cardAsin ?? '', ...productLinksInText(video.description)]) if (v && !seen.includes(v)) seen.push(v)
      while (seen.length < 2) seen.push('')
      setCompareSlots(seen.slice(0, 4).map((input) => ({ input, label: '' })))
    }
  }
  /** User's READY face models — pulled from /api/face-models on mount.
   *  When the user picks one, faceModelId gets passed to the generate
   *  request and the server routes through the LoRA-capable Flux endpoint. */
  const [faceModels, setFaceModels] = useState<Array<{ id: string; name: string; trigger_token: string; outfit_pref?: string | null }>>([])
  // Live thumbnail-style controls (the single block) — drive every generation.
  const [borderIndex, setBorderIndex] = useState<number | null>(null) // null = keep borders varied
  const [accentColor, setAccentColor] = useState<string>('#FFE034')   // title emphasis colour
  const [selectedFaceModelId, setSelectedFaceModelId] = useState<string | null>(null)
  // Hide the green ✓ checkmark decoration. Prefilled from the saved style (via
  // the hidden BrandStylePanel), persisted on toggle, enforced by generate-thumbnail.
  const [noCheck, setNoCheck] = useState(false)
  // Brand badge preference. Default is NO badge until the creator picks one.
  // Prefilled from the saved style, persisted on change.
  const [badge, setBadge] = useState<string>('none')
  // 'auto' = vision-match from all ready models; 'no-human' = product-only; any other string = specific model id
  const [scoutFaceSelection, setScoutFaceSelection] = useState<'auto' | 'no-human' | string>('auto')
  /** Which thumbnail mode card is active. Drives the 4-card picker UI.
   *  'selfie'       → upload a photo of yourself with the product
   *  'own-design'   → upload a finished thumbnail (raw, no AI)
   *  'product-only' → AI generates product-only scene, no face
   *  'face-model'   → AI generates with your saved face model */
  const [thumbnailMode, setThumbnailMode] = useState<'selfie' | 'own-design' | 'product-only' | 'face-model' | null>(null)
  /** "Break frame" effect: run rembg to cut out the creator and composite
   *  them OVER the neon border. Off by default — enables in ~20s. */
  const [breakFrame, setBreakFrame] = useState(false)
  /** Headline style toggle: false = polished statement headline (default),
   *  true = curiosity question about the product + a matching facial reaction.
   *  Remembered per browser so a creator who prefers questions keeps it. */
  const [thumbQuestionMode, setThumbQuestionMode] = useState(false)
  // "Make me wear it": apparel goes ON the creator rather than being held up
  // beside them. Shared state so it is the same toggle everywhere it appears.
  const [thumbWear, setThumbWear] = useWearProduct()
  const [thumbExpression, setThumbExpression] = useExpression()
  useEffect(() => {
    try { setThumbQuestionMode(localStorage.getItem('mvp_thumb_question') === '1') } catch { /* ignore */ }
  }, [])
  const toggleThumbQuestion = (on: boolean) => {
    setThumbQuestionMode(on)
    try { localStorage.setItem('mvp_thumb_question', on ? '1' : '0') } catch { /* ignore */ }
  }
  /** Boost controls — the levers that separate a designed pro thumbnail from the
   *  default composite. Pose + effects are remembered per browser (a channel's
   *  house style); badge + accent word are per-thumbnail. */
  type ThumbPose = 'auto' | 'hold' | 'wear' | 'use' | 'point' | 'thumbs'
  const [thumbPose, setThumbPose] = useState<ThumbPose>('auto')
  const [thumbEffects, setThumbEffects] = useState(false)
  const [thumbBadge, setThumbBadge] = useState('')
  const [thumbAccentWord, setThumbAccentWord] = useState('')
  useEffect(() => {
    try {
      const p = localStorage.getItem('mvp_thumb_pose') as ThumbPose | null
      if (p && ['auto', 'hold', 'wear', 'use', 'point', 'thumbs'].includes(p)) setThumbPose(p)
      setThumbEffects(localStorage.getItem('mvp_thumb_effects') === '1')
    } catch { /* ignore */ }
  }, [])
  const pickThumbPose = (p: ThumbPose) => {
    setThumbPose(p)
    try { localStorage.setItem('mvp_thumb_pose', p) } catch { /* ignore */ }
  }
  const toggleThumbEffects = (on: boolean) => {
    setThumbEffects(on)
    try { localStorage.setItem('mvp_thumb_effects', on ? '1' : '0') } catch { /* ignore */ }
  }
  /** Zero-typing Boost toggles: the AI writes the starburst badge and picks the
   *  red accent word. Typing a custom one in Fine-tune overrides. Remembered. */
  const [thumbAutoBadge, setThumbAutoBadge] = useState(false)
  const [thumbAutoAccent, setThumbAutoAccent] = useState(false)
  useEffect(() => {
    try {
      setThumbAutoBadge(localStorage.getItem('mvp_thumb_auto_badge') === '1')
      setThumbAutoAccent(localStorage.getItem('mvp_thumb_auto_accent') === '1')
    } catch { /* ignore */ }
  }, [])
  const toggleThumbAutoBadge = (on: boolean) => {
    setThumbAutoBadge(on)
    try { localStorage.setItem('mvp_thumb_auto_badge', on ? '1' : '0') } catch { /* ignore */ }
  }
  const toggleThumbAutoAccent = (on: boolean) => {
    setThumbAutoAccent(on)
    try { localStorage.setItem('mvp_thumb_auto_accent', on ? '1' : '0') } catch { /* ignore */ }
  }
  /** null = still checking (ping in progress), true/false = known state. */
  const [extensionInstalled, setExtensionInstalled] = useState<boolean | null>(null)
  /** Live status shown inside the Card 4 button while generating. */
  const [thumbnailStatus, setThumbnailStatus] = useState<string>('')
  // Tier-cap-reached state — keyed separately from the red error toast
  // so we can render an amber upgrade banner with a /pricing CTA instead.
  const [capError, setCapError] = useState<{ message: string; info: { cap: string; currentTier?: string; upgrade?: { tier: string; label: string; limit: number | null } | null } } | null>(null)

  /** Persist one rewritten boilerplate line as this creator's default. */
  async function saveLineAsDefault() {
    if (!lineEditOffer) return
    setSavingLine(true)
    try {
      const res = await fetch('/api/youtube/description-lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: lineEditOffer.key, text: lineEditOffer.text }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok || j?.error) { toast.error(String(j?.error || 'Could not save that line.')); return }
      setSavedLineKey(lineEditOffer.key)
      setDescOverrides((p) => ({ ...(p ?? {}), [lineEditOffer.key]: lineEditOffer.text }))
      setLineEditOffer(null)
      toast.success('Saved. Every new description will use your wording.')
    } catch {
      toast.error('Could not save that line.')
    } finally { setSavingLine(false) }
  }

  useEffect(() => {
    if (generated) {
      setEditTitle(generated.title)
      setEditDesc(generated.description)
      setLineEditOffer(null)
      setSavedLineKey(null)
      setExpanded(true)
    }
  }, [generated])

  /** Pulls READY face models. Wrapped in a callback because we re-fetch
   *  every time the headline modal opens — face models trained in
   *  another tab while the Studio page was already open would otherwise
   *  never show up until a hard reload. */
  const loadFaceModels = useCallback(async () => {
    try {
      const d = await cachedGet<{ models?: Array<{ id: string; name: string; trigger_token: string; status: string; outfit_pref?: string | null }> }>('/api/face-models')
      const ready = ((d.models as Array<{ id: string; name: string; trigger_token: string; status: string; outfit_pref?: string | null }>) || [])
        .filter(m => m.status === 'ready')
        .map(m => ({ id: m.id, name: m.name, trigger_token: m.trigger_token, outfit_pref: m.outfit_pref ?? null }))
      setFaceModels(ready)
      setSelectedFaceModelId(prev => prev ?? (ready.length ? ready[0].id : null))
      // Always default to an EXPLICIT person (the first ready face), never silent
      // auto-detect — vision-matching on a video frame guessed wrong (put Michelle
      // on Seb's video). The "who's in this video?" chips let the creator switch;
      // this just makes the default a visible, correct-able choice instead of a
      // silent guess. Single face → that face; multiple → the first (switchable).
      setScoutFaceSelection(prev => prev !== 'auto' ? prev : ready.length ? ready[0].id : 'auto')
    } catch { setFaceModels([]) }
  }, [])

  // Per-face wardrobe: pin an outfit (e.g. "a white lab coat") so thumbnails keep
  // that look. Saved to the face, shared with the standalone generator + Photobooth.
  const [outfitDraft, setOutfitDraft] = useState<Record<string, string>>({})
  const [savingOutfit, setSavingOutfit] = useState<string | null>(null)
  const saveFaceOutfit = useCallback(async (faceId: string, value: string) => {
    const face = faceModels.find(f => f.id === faceId)
    const next = (value || '').trim()
    if (!face || next === (face.outfit_pref || '')) return
    setSavingOutfit(faceId)
    try {
      await fetch(`/api/face-models/${faceId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outfitPref: next }),
      })
      setFaceModels(prev => prev.map(f => f.id === faceId ? { ...f, outfit_pref: next || null } : f))
    } catch { /* best-effort */ }
    finally { setSavingOutfit(null) }
  }, [faceModels])

  // ── Saved thumbnail style presets ─────────────────────────────────────────
  const loadSavedStyles = useCallback(async () => {
    try {
      const d = await cachedGet<{ styles?: Array<{ id: string; name: string; reference_url: string }> }>('/api/thumbnail-styles')
      setSavedStyles(d.styles ?? [])
    } catch { /* keep what's in state */ }
  }, [])

  const applyPreset = useCallback((id: string, url: string) => {
    setStyleReferenceUrl(url)
    setLoadedPresetId(id)
  }, [])

  const saveCurrentAsPreset = useCallback(async () => {
    if (!styleReferenceUrl) return
    const name = typeof window !== 'undefined' ? window.prompt('Name this style preset (e.g. "Reviews — dark", "Product close-up")', '')?.trim() : ''
    if (!name) return
    setSavingPreset(true)
    try {
      const r = await fetch('/api/thumbnail-styles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, referenceUrl: styleReferenceUrl }),
      })
      const d = await r.json().catch(() => ({})) as { ok?: boolean; style?: { id: string; name: string; reference_url: string }; error?: string }
      if (!r.ok || !d.ok || !d.style) {
        toast.error(d.error || `Couldn't save preset (${r.status}).`)
        return
      }
      setSavedStyles(prev => [d.style!, ...prev])
      setLoadedPresetId(d.style.id)
      _coPilotGetCache.delete('/api/thumbnail-styles') // other cards see the new preset
    } finally {
      setSavingPreset(false)
    }
  }, [styleReferenceUrl])

  const deletePreset = useCallback(async (id: string) => {
    if (!(await confirm({
      title: 'Delete this style preset?',
      description: 'Your saved thumbnail style will be removed permanently. Existing thumbnails are unaffected.',
      confirmLabel: 'Delete preset',
      destructive: true,
    }))) return
    try {
      const r = await fetch(`/api/thumbnail-styles/${id}`, { method: 'DELETE' })
      if (!r.ok) return
      setSavedStyles(prev => prev.filter(s => s.id !== id))
      if (loadedPresetId === id) setLoadedPresetId(null)
      _coPilotGetCache.delete('/api/thumbnail-styles') // keep other cards in sync
    } catch { /* no-op */ }
  }, [loadedPresetId, confirm])

  // Load once on mount.
  useEffect(() => { loadFaceModels() }, [loadFaceModels])
  useEffect(() => { loadSavedStyles() }, [loadSavedStyles])
  // Check once on mount — drives the "install SCOUT" vs "generate" Card 4 UI.
  useEffect(() => { isExtensionAvailable().then(ok => setExtensionInstalled(ok)) }, [])

  // Pre-capture SCOUT frames the moment the card expands so they're ready
  // by the time the user clicks Generate (the user spends ~15-20s reading
  // title/description, which hides most of the 20-30s capture wait).
  useEffect(() => {
    if (!expanded || !video.youtubeVideoId) return
    if (capturedFramesRef.current?.videoId === video.youtubeVideoId && capturedFramesRef.current.frames.length) return
    ;(async () => {
      try {
        if (await isExtensionAvailable()) {
          const frames = await requestVideoFrames(video.youtubeVideoId!, [0.15, 0.3, 0.5, 0.7])
          if (frames.length) capturedFramesRef.current = { videoId: video.youtubeVideoId!, frames }
        }
      } catch { /* ignore — generateThumbnail retries */ }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, video.youtubeVideoId])

  // Pull aggregated 👍/👎 history for the YouTube surface so the random
  // style picker biases toward styles this user has rewarded.
  useEffect(() => {
    (async () => {
      try {
        // Niche-aware: bias the picker toward styles that worked on THIS
        // kind of video. Look up the video's category (RLS-scoped) and
        // pass it so the feedback endpoint weights matching-niche rows 3×.
        let nicheParam = ''
        try {
          const sb = createBrowserClient()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data } = await (sb as any).from('youtube_videos')
            .select('selected_category').eq('youtube_video_id', video.youtubeVideoId).single()
          const cat = (data?.selected_category as string | null)?.trim()
          if (cat) nicheParam = `&niche=${encodeURIComponent(cat)}`
        } catch { /* no category — overall weights */ }
        const fb = await cachedGet<{ liked?: Record<string, number>; disliked?: Record<string, number> }>(`/api/thumbnail-feedback?surface=youtube${nicheParam}`)
        setYtStyleWeights({ liked: fb.liked || {}, disliked: fb.disliked || {} })
      } catch { /* silent — picker just goes uniform */ }
    })()
  }, [])

  /**
   * The ASIN this video's art actually belongs to.
   *
   * NOT just video.detectedAsin. When the creator pastes a product link in
   * "Product link (override)", the form sends `productUrl` and no `asin` at
   * all — generate-thumbnail already has an effAsin for exactly this reason,
   * and the comment there records that keying off the body `asin` alone has
   * starved this route once before. The product-image memory repeated the
   * mistake and filed images under a null ASIN, which is why a Co-Pilot
   * thumbnail never came back in the Deals Hub.
   */
  const effectiveAsin = (() => {
    const override = productUrl.trim()
    if (override) return asinFromAmazonUrl(override) || cardAsin || null
    return cardAsin || null
  })()
  /** A link SCOUT can paste into Studio's Tag products search. */
  const hasProductLink = !!(productUrl.trim() || productLinkFor(effectiveAsin))

  /**
   * Remember the thumbnail against the PRODUCT, so posting the same ASIN to
   * Facebook next week can offer it back (lib/product-image-memory).
   *
   * Keyed on the visible thumbnail rather than on a button, because there is no
   * single moment when a creator "finishes": they generate, pick a variant,
   * swap the title, or upload their own. Every one of those changes
   * thumbnailUrl, and the image on screen is the one they mean. Saving only at
   * "Apply to YouTube" was the original bug — most thumbnails never get pushed,
   * so nothing was ever remembered.
   *
   * Best-effort and silent on failure; savedProductImage drives the one line of
   * UI that reports what actually happened.
   */
  const [savedProductImage, setSavedProductImage] = useState<'saving' | 'saved' | 'failed' | null>(null)
  // THE THUMBNAIL ALREADY MADE FOR THIS PRODUCT (the Thumbnail Generator, or
  // an earlier Co-Pilot run, files its latest one against the ASIN). Offered
  // before the generate button, so a second image is not paid for when the
  // creator already has one they like.
  const recalledThumb = useSavedProductImage(effectiveAsin)
  useEffect(() => {
    if (!thumbnailUrl || !effectiveAsin) { setSavedProductImage(null); return }
    // A RECALLED IMAGE IS ALREADY FILED: saving it again would only restamp
    // it as approved in Co-Pilot today.
    if (thumbnailModel === 'recalled') { setSavedProductImage('saved'); return }
    let cancelled = false
    setSavedProductImage('saving')
    ;(async () => {
      const ok = await saveProductImage({
        asin: effectiveAsin,
        imageUrl: thumbnailUrl,
        surface: 'YouTube Co-Pilot',
        modelUsed: thumbnailModel,
        source: thumbnailModel?.includes('upload') ? 'upload' : 'generated',
      })
      if (!cancelled) setSavedProductImage(ok ? 'saved' : 'failed')
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbnailUrl, effectiveAsin])

  /** Record a 👍 / 👎 reaction on the current YouTube thumbnail. */
  async function submitYtThumbnailFeedback(reaction: 'like' | 'dislike') {
    if (!thumbnailUrl) return
    setThumbnailFeedbackSent(reaction)
    try {
      await fetch('/api/thumbnail-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thumbnailUrl,
          reaction,
          // styleId may be null if overlay didn't run (e.g. cached path
          // before hook persistence) — surface signal still useful.
          styleId: thumbnailStyleId,
          surface: 'youtube',
          modelUsed: thumbnailModel ?? null,
        }),
      })
      if (thumbnailStyleId) {
        const sid = thumbnailStyleId
        setYtStyleWeights(prev => {
          const next = { liked: { ...prev.liked }, disliked: { ...prev.disliked } }
          const bucket = reaction === 'like' ? next.liked : next.disliked
          bucket[sid] = (bucket[sid] || 0) + 1
          return next
        })
      }
    } catch (e) {
      console.warn('[yt-thumb-feedback]', e)
    }
  }

  // Re-fetch every time the headline modal opens, so a face trained in
  // another tab (or one that just finished training in the background)
  // shows up immediately without forcing a page reload.
  useEffect(() => {
    if (headlinePromptOpen) loadFaceModels()
  }, [headlinePromptOpen, loadFaceModels])

  // Safe JSON parse — if server returns plain text / HTML on error, show that instead
  async function safeJson(res: Response): Promise<Record<string, unknown>> {
    const text = await res.text()
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      // Surface the raw server message so the user sees something meaningful
      throw new Error(text.slice(0, 300) || `HTTP ${res.status}`)
    }
  }

  async function generate(skipAsinCheck = false) {
    // A comparison that is not complete is said before anything is spent.
    const comparing = canCompare && compareOn
    if (comparing) {
      const { error: cmpErr } = readComparisonSlots(compareSlots)
      if (cmpErr) { toast.error(cmpErr); return }
    }
    setCompareResult(null)
    setCompareSaved(null)
    setGenerating(true)
    setError(null)
    setProgress(null)
    setAsinMismatch(false)
    setNeedsProduct(false)
    setGenerated(null)
    setApplied(false)
    setThumbnailUrl(null)
    setThumbnailError(null)
    try {
      // Client-side retry-on-overload: if Anthropic is overloaded, the server
      // already retries 8× internally, but if it still surfaces we automatically
      // retry once more on the client after a back-off so the user doesn't have
      // to click again. Total ceiling ≈ server attempts + 2 client tries.
      // Grounding: pull the video's TRANSCRIPT through SCOUT first (browser IP
      // + the user's own YouTube session — reaches private drafts the server
      // can't). Best-effort; on any failure we send no transcript and the
      // server grounds titles in the product instead (never a fabricated one).
      let scoutTranscript = ''
      try {
        if (video.youtubeVideoId && await isExtensionAvailable()) {
          setProgress('Reading the video transcript through SCOUT…')
          scoutTranscript = await requestVideoTranscript(video.youtubeVideoId)
          setProgress(null)
        }
      } catch { /* no transcript available — proceed with product grounding */ }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callOnce = (productOverride?: any) => fetch('/api/youtube/generate-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asin: cardAsin,
          videoTitle: video.title,
          videoDescription: video.description,
          // Used server-side to persist the generated metadata back to
          // the youtube_videos row so future generations can use it as
          // a voice anchor.
          youtubeVideoId: video.youtubeVideoId,
          // "Generate anyway" → bypass the ASIN-mismatch tripwire.
          skipAsinCheck,
          // SCOUT-fetched transcript → grounds titles/description in what the
          // video actually says. Omitted when unavailable.
          ...(scoutTranscript ? { transcript: scoutTranscript } : {}),
          // SCOUT-scraped product (only on the fallback retry below).
          ...(productOverride ? { productOverride } : {}),
          ...(comparing ? { comparisonProducts: compareSlots } : {}),
          ...(shortMode ? { isShort: true } : {}),
        }),
      })

      let res = await callOnce()
      let data = await safeJson(res)
      const isOverload = (d: Record<string, unknown>) =>
        typeof d.error === 'string' && /overload/i.test(d.error as string)
      for (let i = 0; !res.ok && isOverload(data) && i < 2; i++) {
        setProgress(`MVP is overloaded, auto-retrying (${i + 1}/2)…`)
        await new Promise(r => setTimeout(r, 8000 + i * 4000))
        res = await callOnce()
        data = await safeJson(res)
      }

      // Amazon blocked the SERVER scrape (datacenter IP). Fetch the product
      // through SCOUT — it runs in the user's own browser / logged-in Amazon
      // session, which Amazon doesn't block — and retry once with that data.
      // In a comparison the product that failed is the first compared one,
      // which the server names; otherwise it is the card's own product.
      const blockedAsin = comparing ? ((data.asin as string | undefined) ?? null) : cardAsin
      if (!res.ok && data.scrapeFailed && blockedAsin) {
        try {
          if (await isExtensionAvailable()) {
            setProgress('Amazon blocked our server, so SCOUT is fetching the product from your browser…')
            const prod = await requestAmazonProduct(blockedAsin)
            if (prod.ok && prod.product?.title) {
              res = await callOnce(prod.product)
              data = await safeJson(res)
            } else {
              // SCOUT was there and still could not get the product. Say that,
              // rather than leaving the "fetching…" line up while the real error
              // arrives from somewhere else and reads as unrelated.
              setProgress(null)
            }
          }
        } catch { /* fall through to the normal error handling below */ }
      }
      setProgress(null)
      if (data.limitReached) {
        setCapError({
          message: (data.error as string) || 'You\'ve hit your usage cap for this period.',
          info: { cap: (data.cap as string) || 'metadata', currentTier: data.currentTier as string | undefined, upgrade: data.upgrade as { tier: string; label: string; limit: number | null } | null | undefined },
        })
        setError(null)
        return
      }
      if (!res.ok) {
        // ASIN-mismatch tripwire (422) → flag so the UI can offer "Generate anyway".
        setAsinMismatch(!!data.asinMismatch)
        setNeedsProduct(!!data.needsProduct)
        // data.error can come back as a string OR an object with .message
        // (depends on which error path fired server-side). Without this
        // normalization, an object error makes new Error(obj) render as
        // "[object Object]" — the exact bug seen on the Studio card.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e = data.error as any
        const errMsg = typeof e === 'string' ? e
          : (e && typeof e === 'object' && typeof e.message === 'string') ? e.message
          : 'Generation failed'
        throw new Error(errMsg)
      }
      setError(null)
      setCapError(null)

      const generatedMeta = data.generated as GeneratedMetadata
      const productData = data.product as ProductInfo
      const productBullets = data.productBullets as string[]
      const productDescription = data.productDescription as string

      setGenerated(generatedMeta)
      // The server recorded a generate marker (mig 150), so this video will
      // reclassify to "Metadata sent" on the next drafts load — intentionally NOT
      // moved mid-edit here (the card would jump tabs while you're still working
      // with the freshly-generated metadata).
      setAgentInsights((data.agentInsights ?? null) as AgentInsights | null)
      setProduct({ ...productData, bullets: productBullets, description: productDescription })
      setAffiliateUrl(data.affiliateUrl as string)
      setGeniuslinkUsed((data.geniuslinkUsed ?? false) as boolean)
      setLinkStyleUsed((data.linkStyle ?? null) as typeof linkStyleUsed)
      setProductDiscoverySource((data.productDiscoverySource ?? null) as typeof productDiscoverySource)
      setGeniuslinkError((data.geniuslinkError ?? null) as string | null)
      setGeniuslinkSkippedByStyle((data.geniuslinkSkippedByStyle ?? false) as boolean)
      setLinkStyleHonoured((data.linkStyleHonoured ?? false) as boolean)
      setDescOverrides((data.descriptionLineOverrides ?? null) as Record<string, unknown> | null)
      setGeniuslinkVerified((data.geniuslinkVerified ?? true) as boolean)
      setCompareResult((data.comparison ?? null) as ComparisonResultItem[] | null)
      setShortResult(data.shortMode ? { fullReviewUrl: (data.fullReviewUrl ?? null) as string | null } : null)
      setCompareSaved((data.comparisonSaved ?? null) as typeof compareSaved)
      if (comparing && !data.comparison) toast.error('The comparison was not applied: this metadata covers one product. Try again, or tell support.')

      // ── Thumbnail no longer auto-fires after metadata generation ─────────
      // The thumbnail flow now opens a modal asking the user about the
      // headline (and, soon, the face model). Auto-firing here would skip
      // that decision and just produce whatever the defaults are. The
      // user clicks "Generate Thumbnail" explicitly when they're ready.
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate'
      // "Failed to fetch" = browser-level TypeError; the server never responded
      // (Vercel hit maxDuration, ISP hiccup, etc.). Give an actionable message.
      setError(msg === 'Failed to fetch'
        ? 'Request timed out — please try again'
        : msg)
    } finally {
      setGenerating(false)
      setProgress(null)
    }
  }

  async function applyToYouTube() {
    if (!generated) return
    setApplying(true)
    setApplyError(null)
    try {
      // Pro users get the one-click batch endpoint that pushes Studio
      // settings + metadata + thumbnail in a single orchestrated call.
      // Lower tiers fall through to the original metadata-only endpoint.
      if (isPro) {
        // Draft mode: push metadata/thumbnail only — send NO status
        // fields so the video stays an unpublished YouTube draft.
        // A schedule (publishAt) OVERRIDES draft — you can pick a date straight
        // from the default draft state. YouTube requires private-until-publish,
        // which the apply route enforces when publishAt is set.
        const publishAt = computePublishAt(proSettings.scheduleMode, proSettings.scheduleAt)
        const isDraft = proSettings.privacyStatus === 'draft' && !publishAt

        // Will SCOUT finish the Studio-only fields after this push?
        const wantsFinish = extensionInstalled === true && finishOptIn && anyFinishStep

        // SCOUT FIRST, THEN THE TIME.
        //
        // When SCOUT finishes this video, the push sends the words, the
        // thumbnail and the playlist, and NO status: no schedule, no
        // visibility. Two reasons. A draft only stays a draft if nothing sets
        // its status, and a draft's disclosures can only be answered through
        // Studio's Edit draft window. And nothing may be scheduled or public
        // before its paid promotion reads back as Yes.
        //
        // The time is then set by SCOUT itself on the draft's Visibility page,
        // or, for a video that is not a draft (or when that page did not read
        // back), through the YouTube API below, only once the disclosures did.
        const holdStatus = wantsFinish
        const firstPrivacy = holdStatus || isDraft || publishAt ? undefined : proSettings.privacyStatus

        const res = await fetch('/api/youtube/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId: video.youtubeVideoId,
            title: editTitle,
            description: editDesc,
            tags: generated.tags,
            thumbnailDataUri: thumbnailUrl ?? undefined,
            // Remember this thumbnail against the PRODUCT, not just this video,
            // so posting the same ASIN to Facebook next week can offer it back
            // (lib/product-image-memory). An uploaded image is flagged because
            // it is the one that regenerating can never reproduce.
            asin: effectiveAsin ?? undefined,
            thumbnailUploaded: !!thumbnailModel?.includes('upload'),
            playlistId: proSettings.playlistId,
            madeForKids: isDraft || holdStatus ? undefined : proSettings.madeForKids,
            notifySubscribers: proSettings.notifySubscribers,
            publishAt: holdStatus ? null : publishAt,
            privacyStatus: firstPrivacy,
            // Paid promotion Yes and AI use No through YouTube's own API, the
            // same step Liftoff's uploader takes, read back before any time.
            disclosures: true,
          }),
        })
        const data = await safeJson(res)
        if (!res.ok) throw new Error((data.error as string) || `HTTP ${res.status} — apply failed`)
        const warns = Array.isArray(data.warnings) ? (data.warnings as string[]) : []
        const quotaHit = data.quotaHit === true || warns.some(w => /quotaExceeded|exceeded your/i.test(w))
        // statusOk === false means the videos.update STATUS call failed — so the
        // video was NOT actually scheduled/updated on YouTube, even though the
        // HTTP request returned 200 with a warnings list. Do NOT flip to the green
        // "Scheduled on YouTube" state in that case; surface a clear, retryable
        // error (and a friendly message when YouTube's daily quota is the cause,
        // instead of dumping the raw 403 JSON the API returns).
        if (data.statusOk === false && !holdStatus) {
          setApplyError(
            quotaHit
              ? `YouTube's daily API quota is used up right now, so nothing reached YouTube${publishAt ? ' — the video is NOT scheduled' : ''}. The quota resets around midnight Pacific; try again then.`
              : `Couldn't apply to YouTube: ${warns.join(' · ') || 'unknown error'}`,
          )
          return
        }
        setApplied(true)
        void queueFirstComment()
        const disc = (data.disclosures && typeof data.disclosures === 'object') ? data.disclosures as NonNullable<typeof apiDisclosures> : null
        apiDisclosuresRef.current = disc
        setApiDisclosures(disc)
        // WITHOUT SCOUT the push itself sets the time, so its outcome is known
        // here: held when paid promotion did not read back, set otherwise.
        if (!holdStatus && (publishAt || !isDraft)) {
          if (typeof data.heldBack === 'string' && data.heldBack) {
            setStatusOutcome('held')
            setApplyError(`${data.heldBack} See it in YouTube Studio.`)
            return
          }
          if (data.statusOk !== false) setStatusOutcome('set')
        }
        if (warns.length > 0) {
          setApplyError(
            quotaHit
              ? `${publishAt ? 'Scheduled' : 'Applied'}, but some extras (thumbnail/playlist) hit YouTube's daily API quota and didn't apply. Re-run after it resets (around midnight Pacific).`
              : `Applied with warnings: ${warns.join(' · ')}`,
          )
        }
        if (wantsFinish) {
          setApplying(false)
          pushedRef.current = { publishAt, isDraft }
          setStatusOutcome(null)
          const fin = await runStudioFinish(publishAt)
          await settleAfterStudio(fin, publishAt, isDraft)
        }
        // Leave the panel EXPANDED so the post-apply "Finish on YouTube" card
        // stays visible and usable. Auto-collapsing + reclassifying here was
        // unmounting it ~1.5s after a clean apply — the card flashed and
        // vanished. Now the card's own "Dismiss" (dismissFinish) is what
        // collapses the panel and moves the video into "Metadata sent".
        return
      }

      // Trial / Creator — metadata + thumbnail only (no batch settings)
      const res = await fetch('/api/youtube/update-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: video.youtubeVideoId,
          title: editTitle,
          description: editDesc,
          tags: generated.tags,
          thumbnailDataUri: thumbnailUrl ?? undefined,
          asin: effectiveAsin ?? undefined,
          thumbnailUploaded: !!thumbnailModel?.includes('upload'),
        }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error((data.error as string) || `HTTP ${res.status} — update failed`)
      setApplied(true)
      void queueFirstComment()
      if (data.thumbnailWarning) {
        setApplyError(`Metadata applied ✓ — thumbnail not uploaded: ${data.thumbnailWarning}`)
      }
      // Panel stays expanded; the post-apply "Finish on YouTube" card's
      // "Dismiss" (dismissFinish) collapses it and moves the video on.
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply to YouTube')
    } finally {
      setApplying(false)
    }
  }

  /** Convert the schedule dropdown choice to an ISO 8601 publishAt, or null for
   *  "publish now". 'custom' uses the datetime-local value; a missing/past
   *  custom time returns null (the button is disabled in that case anyway). */
  function computePublishAt(mode: ProPublishSettings['scheduleMode'], scheduleAt: string): string | null {
    if (mode === 'now') return null
    if (mode === 'custom') {
      if (!scheduleAt) return null
      const t = new Date(scheduleAt) // datetime-local → local time
      if (isNaN(t.getTime()) || t.getTime() <= Date.now()) return null
      return t.toISOString()
    }
    const offsets: Record<'in1h' | 'in6h' | 'in24h', number> = {
      in1h: 1 * 60 * 60 * 1000,
      in6h: 6 * 60 * 60 * 1000,
      in24h: 24 * 60 * 60 * 1000,
    }
    return new Date(Date.now() + offsets[mode]).toISOString()
  }

  /** Min value for the datetime-local picker (5 min out, local time). */
  function localDatetimeMin(): string {
    const d = new Date(Date.now() + 5 * 60 * 1000)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  }
  // True when the user chose a custom schedule but the date is empty/past — used
  // to block the Apply button so we never silently fall back to draft/now.
  const scheduleNeedsDate = proSettings.scheduleMode === 'custom' && !computePublishAt('custom', proSettings.scheduleAt)

  /** Run the opt-in SCOUT "Finish on YouTube" pass: it opens YouTube Studio in
   *  the user's own browser and drives the real controls to turn Monetization
   *  on, submit the ad-suitability rating, and copy the end screen from the last
   *  video. Gated behind the explicit opt-in checkbox. The notify bell is left
   *  alone — MVP already disabled it via the Data API. */
  /** Done with the post-apply "Finish on YouTube" card — collapse the panel and
   *  move the video into the "Metadata sent" tab. This is what used to fire on a
   *  timer right after apply (which unmounted the card before the user could use
   *  it); now it's an explicit action so the card persists until the user is
   *  ready to move on. */
  function dismissFinish() {
    setFinishCheckDone(true)
    setExpanded(false)
    if (onApplied) onApplied(video.youtubeVideoId)
  }

  /**
   * Send SCOUT into Studio for this one video, with every step the creator
   * ticked, and keep exactly what it reports.
   *
   * THE RESULT IS SCOUT'S, WORD FOR WORD. This used to replace the Details
   * step's own detail with "Paid promotion checked, AI-use answered, notify
   * off" whenever the step came back ok, and to pass notify as a plain false
   * whatever the toggle said. Studio showed the box blank under that sentence.
   * SCOUT now reads every answer back off the page, and its words are the
   * ones shown.
   */
  /** Retry: SCOUT again, then the time, exactly as the push does. The retry
   *  used to run SCOUT only, so a video that was not a draft was left with
   *  no schedule under a green result that said its time was set. */
  async function retryStudioFinish() {
    const pushed = pushedRef.current
    const publishAt = pushed ? pushed.publishAt : computePublishAt(proSettings.scheduleMode, proSettings.scheduleAt)
    const isDraft = pushed ? pushed.isDraft : proSettings.privacyStatus === 'draft' && !publishAt
    // A TIME THAT HAS GONE is refused by YouTube, and scheduling "now" by
    // accident is worse. Said, with what to do.
    if (publishAt && new Date(publishAt).getTime() <= Date.now() + 60_000) {
      setApplyError(`The time this was pushed with (${new Date(publishAt).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}) has passed. Pick a new time and push again.`)
      return
    }
    setApplyError(null)
    setStatusOutcome(null)
    const fin = await runStudioFinish(publishAt)
    await settleAfterStudio(fin, publishAt, isDraft)
  }

  async function runStudioFinish(publishAtArg?: string | null): Promise<StudioFinishResult | null> {
    if (!video.youtubeVideoId || !finishOptIn || !anyFinishStep) return null
    setFinishRunning(true)
    setFinishError(null)
    setFinishResult(null)
    try {
      const publishAt = publishAtArg !== undefined
        ? publishAtArg
        : computePublishAt(proSettings.scheduleMode, proSettings.scheduleAt)
      const link = productUrl.trim() || productLinkFor(effectiveAsin)
      const fin = await requestStudioFinish(video.youtubeVideoId, {
        details: finishDoDetails,
        monetize: finishDoMonetize,
        selfCert: finishDoMonetize && finishDoAdRating,
        tagProduct: finishDoTag && !!link,
        productUrl: link ?? undefined,
        amazonUrl: productLinkFor(effectiveAsin) ?? undefined,
        productTitle: product?.title ?? undefined,
        endScreen: finishDoEndScreen,
        // The creator's own toggle, whichever way it points.
        notifySubscribers: proSettings.notifySubscribers === true,
        visibility: draftVisibility(publishAt, proSettings.privacyStatus),
      })
      if (fin.error === 'not-installed') setFinishError('SCOUT isn’t installed or didn’t respond. Reload SCOUT and try again.')
      else if (fin.error === 'timeout') setFinishError('YouTube Studio took too long to respond, so SCOUT stopped. Nothing after the last tick below was done.')
      else if (fin.error === 'busy') setFinishError('SCOUT is already working on another video in Studio. Try again when it has finished.')
      else if (fin.error) setFinishError(`Couldn’t finish in Studio: ${fin.error}`)
      setFinishResult(fin)
      return fin
    } catch (e) {
      setFinishError(e instanceof Error ? e.message : 'Failed to run the Studio finish')
      return null
    } finally {
      setFinishRunning(false)
    }
  }

  /**
   * After SCOUT: the time or visibility the creator asked for, if SCOUT did
   * not already set it on the draft's own Visibility page.
   *
   * ONLY ONCE THE DISCLOSURE READ BACK. A video whose paid promotion did not
   * stick stays exactly where it is, a draft or private, and the screen says
   * so. Going public without it is the one outcome this must never produce.
   */
  async function settleAfterStudio(fin: StudioFinishResult | null, publishAt: string | null, isDraft: boolean) {
    const wantsStatus = !!publishAt || !isDraft
    if (!wantsStatus) return
    if (studioSetVisibility(fin)) { setStatusOutcome('set'); return }
    setStatusOutcome('held')
    // SCOUT DID NOT FINISH, which is not the same as the disclosure failing.
    // Said as what it is, with the one thing to press.
    if (fin?.error === 'timeout' || fin?.error === 'busy' || fin?.error === 'not-installed') {
      setApplyError(`SCOUT did not finish in Studio, so ${publishAt ? 'the schedule' : `the ${proSettings.privacyStatus} setting`} was not applied. The video is unchanged on YouTube. Press Run SCOUT again.`)
      return
    }
    // A DRAFT SCOUT STOPPED IN is left a draft. Its own Schedule is on the
    // last page; when SCOUT stopped before it (checks found a claim, a page
    // never loaded), setting the time through the API instead scheduled a
    // draft SCOUT had stopped on purpose. The step it stopped at is named.
    // A Visibility page SCOUT reached and could not read back still falls
    // through to the API below, as before: only a draft it never got that
    // far in is held.
    const vis = fin?.steps.find((s) => s.step === 'visibility')
    if (fin?.path === 'draft' && (!vis || vis.notReached)) {
      // THE STEP IT STOPPED AT is the LAST one that failed: an earlier step can
      // fail and the run carry on (monetization did, and the banner blamed it
      // for a stop that happened pages later).
      const failedSteps = fin.steps.filter((s) => !s.ok && !s.skipped && !s.notReached)
      const stoppedAt = failedSteps[failedSteps.length - 1]
      const why = stoppedAt?.detail ? ` ${stoppedAt.detail.replace(/[.\s]*$/, '')}.` : ''
      setApplyError(`SCOUT stopped${stoppedAt ? ` at ${studioStepLabel(stoppedAt.step)}` : ''} in the draft, so it was not ${publishAt ? 'scheduled' : `set to ${proSettings.privacyStatus}`}. It is still a draft on YouTube.${why} Press Run SCOUT again, or see it in YouTube Studio.`)
      return
    }
    // Paid promotion confirmed by YouTube's API counts as much as SCOUT's read
    // of the Details page: either one is YouTube saying Yes.
    const confirmed = !finishDoDetails || studioDisclosuresConfirmed(fin) || apiDisclosuresRef.current?.paidPromotion === true
    const where = fin?.path === 'draft' ? 'a draft' : 'private'
    if (!confirmed) {
      setApplyError(`Kept as ${where} on purpose: SCOUT could not confirm paid promotion in Studio, and the video must not go out without it. Press Run SCOUT again, or see it in YouTube Studio.`)
      return
    }
    setApplying(true)
    try {
      const res2 = await fetch('/api/youtube/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: video.youtubeVideoId,
          madeForKids: proSettings.madeForKids,
          notifySubscribers: proSettings.notifySubscribers,
          publishAt,
          privacyStatus: publishAt ? undefined : proSettings.privacyStatus,
          // SCOUT ALREADY READ IT BACK IN STUDIO: the API's answer is not
          // asked again, since on a draft it keeps saying No and would hold a
          // schedule Studio already has the disclosure for.
          disclosures: !studioDisclosuresConfirmed(fin),
        }),
      })
      const d2 = await safeJson(res2)
      if (d2.disclosures && typeof d2.disclosures === 'object') {
        apiDisclosuresRef.current = d2.disclosures as NonNullable<typeof apiDisclosures>
        setApiDisclosures(apiDisclosuresRef.current)
      }
      if (typeof d2.heldBack === 'string' && d2.heldBack) {
        setApplyError(`${d2.heldBack} See it in YouTube Studio.`)
        return
      }
      if (res2.ok && d2.statusOk !== false) setStatusOutcome('set')
      if (!res2.ok || d2.statusOk === false) {
        setApplyError(`Studio settings are in, but ${publishAt ? 'scheduling' : `setting it to ${proSettings.privacyStatus}`} through YouTube did not go through. It is still ${where}. Open it on YouTube and ${publishAt ? 'schedule it' : `set it to ${proSettings.privacyStatus}`}.`)
      }
    } catch {
      setApplyError(`Studio settings are in, but the last step failed. It is still ${where}. Open it on YouTube and ${publishAt ? 'schedule it' : `set it to ${proSettings.privacyStatus}`}.`)
    } finally {
      setApplying(false)
    }
  }

  // ── Shared thumbnail result handler ─────────────────────────────────────────
  async function applyThumbnailResult(data: Record<string, unknown>) {
    const hook = (data.overlayHook as string) || ''
    setThumbnailFaceUsed((data.faceUsed as string | null) ?? null)
    setThumbnailDebug((data.faceDebug as string | null) ?? null)
    // Server may return one or many. Backwards-compat: single thumbnailUrl
    // when older callers / older deploys. Always normalize to array first.
    const rawList = (Array.isArray(data.thumbnailUrls) && data.thumbnailUrls.length > 0)
      ? (data.thumbnailUrls as string[])
      : [(data.thumbnailUrl as string)].filter(Boolean)

    // Baked path (Nano Banana default): the headline typography is already
    // rendered INTO the image by the model — show it AS-IS. Drawing our canvas
    // overlay on top would double the text. We keep the hook so the user can
    // one-click swap to the clean client-overlay version.
    const scores = (data.thumbnailScores as Array<{ score: number } | null> | undefined) || []
    if (data.baked === true) {
      setThumbnailVariants(rawList.map((u, i) => ({ url: u, score: scores[i]?.score ?? null })))
      setThumbnailStyleId(null)
      setThumbnailFeedbackSent(null)
      setThumbnailUrl(rawList[0])
      setThumbnailHook(hook)
      setThumbnailPrompt((data.prompt as string) ?? null)
      const usedModel = (data.modelUsed as string) ?? null
      setThumbnailModel(usedModel)
      if (usedModel === 'gpt-image-graphic') setGfxTitleInput(hook)
      setSceneAnalysis((data.channelStyle as string) ?? null)
      // Baked text is IN the image — there's no text-free base to re-title, so
      // the title picker is hidden on this path.
      setTitleOptions([])
      setTitleOverlayCtx(null)
      return
    }

    // Run the text overlay on each variant in parallel — these are small
    // canvas ops so it's fast. Falls back to raw URL on overlay failure
    // so the user never gets stuck.
    // Bias style picker by the user's 👍/👎 history (YouTube surface).
    const styleIndex = pickWeightedStyleIndex(ytStyleWeights.liked, ytStyleWeights.disliked)
    // Optional creator cut-out to composite into the bottom-right corner.
    const cutoutUrl = (data.personCutoutUrl as string) || undefined
    // Headline placement — fallback corner if no per-variant array is sent.
    const textPosition = (data.textPosition as HeadlinePosition | null) || undefined
    // Per-variant placement: the composed scene rotates the host side, so each
    // variant's clear corner differs (top-right when host is left, etc.).
    const textPositions = (data.textPositions as HeadlinePosition[] | undefined) || []
    // faceBox is null for composed (placement is deterministic from host side).
    const faceBox = (data.faceBox as FaceBox | null) || undefined
    // Per-variant titles (aligned to rawList order) so each variant gets its
    // own distinct headline, not the same line restyled.
    const overlayHooks = (data.overlayHooks as string[] | undefined) || []
    let pickedStyleId: string | null = null
    const finalUrls = await Promise.all(rawList.map(async (url, i) => {
      const variantHook = overlayHooks[i] || hook
      const variantPos = textPositions[i] || textPosition
      if (!variantHook && !cutoutUrl) return url
      try {
        const overlayed = await addTextOverlay(url, variantHook, styleIndex, cutoutUrl, variantPos, faceBox)
        pickedStyleId = overlayed.styleId
        return overlayed.url
      }
      catch (overlayErr) {
        console.warn('[thumbnail-overlay]', overlayErr)
        return url
      }
    }))

    // Store every overlaid variant (best-first) for the compare grid; the
    // large preview shows the top one until the user picks another.
    setThumbnailVariants(finalUrls.map((u, i) => ({ url: u, score: scores[i]?.score ?? null })))
    setThumbnailStyleId(pickedStyleId)
    setThumbnailFeedbackSent(null)
    setThumbnailUrl(finalUrls[0])
    setThumbnailHook(hook)
    setThumbnailPrompt((data.prompt as string) ?? null)
    setThumbnailModel((data.modelUsed as string) ?? null)
    setSceneAnalysis((data.channelStyle as string) ?? null)

    // Title picker: the 5 AI options + the context to re-overlay any of them on
    // the SAME text-free base image (rawList[0]) instantly. The default preview
    // already shows option[0] (= hook), so selectedTitleIdx starts at 0.
    const options = (data.titleOptions as string[] | undefined)?.filter(Boolean) ?? (hook ? [hook] : [])
    setTitleOptions(options)
    setSelectedTitleIdx(0)
    setTitleOverlayCtx(rawList[0]
      ? { baseUrl: rawList[0], styleIndex, cutoutUrl, position: textPositions[0] || textPosition, faceBox }
      : null)
  }

  // Re-overlay a different title on the text-free base image (clean path only),
  // instantly — no regeneration. Keeps the same style + placement, swaps text.
  async function selectTitle(i: number) {
    if (!titleOverlayCtx || retitling || i === selectedTitleIdx) return
    const title = titleOptions[i]
    if (!title) return
    setRetitling(true)
    setSelectedTitleIdx(i)
    try {
      const ov = await addTextOverlay(titleOverlayCtx.baseUrl, title, titleOverlayCtx.styleIndex, titleOverlayCtx.cutoutUrl, titleOverlayCtx.position, titleOverlayCtx.faceBox)
      setThumbnailUrl(ov.url)
      setThumbnailStyleId(ov.styleId)
      setThumbnailHook(title)
      setThumbnailFeedbackSent(null)
    } catch (err) {
      console.warn('[retitle]', err)
    } finally {
      setRetitling(false)
    }
  }

  /**
   * Upload-your-own thumbnail path. We read the file into a data URI
   * (matching the format the Apply-to-YouTube route already expects) and
   * skip all AI work. Enforces YouTube's hard limits: 2 MB max, image
   * mime type. Aspect ratio is recommended 16:9 but YouTube will accept
   * other shapes (just letterboxes / pillar-boxes in the player).
   */
  async function handleThumbnailUpload(file: File) {
    if (!file) return
    setThumbnailError(null)
    if (!file.type.startsWith('image/')) {
      setThumbnailError('Please pick an image file (JPG, PNG, GIF, or BMP).')
      return
    }
    // YouTube's thumbnail endpoint rejects > 2 MB
    if (file.size > 2 * 1024 * 1024) {
      setThumbnailError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — YouTube caps thumbnails at 2 MB. Compress and try again.`)
      return
    }
    const reader = new FileReader()
    reader.onerror = () => setThumbnailError("Couldn't read that file. Try a different image.")
    reader.onload = () => {
      const dataUri = reader.result as string
      setThumbnailUrl(dataUri)
      setThumbnailVariants([])
      setThumbnailPrompt(null)
      setThumbnailModel('upload')
      setThumbnailHook(null)
    }
    reader.readAsDataURL(file)
  }

  /**
   * Optional style-reference upload. Uploads to Supabase storage and
   * stores the public URL — the server uses it as an aesthetic anchor
   * (Haiku vision → style brief → prompt). Cleared on remove. 5 MB cap
   * since these images are reference-only and don't need to be huge.
   */
  async function handleStyleReferenceUpload(file: File) {
    setThumbnailError(null)
    if (!file.type.startsWith('image/')) {
      setThumbnailError('Style reference must be an image (JPG, PNG, or WebP).')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setThumbnailError(`Style reference is ${(file.size / 1024 / 1024).toFixed(1)} MB. Keep it under 5 MB.`)
      return
    }
    setStyleRefUploading(true)
    try {
      const sb = createBrowserClient()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      // user.id MUST be the first folder so the bucket's per-user RLS policy
      // ((storage.foldername)[1] = auth.uid()) lets the insert through.
      const path = `${user.id}/style-references/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await sb.storage
        .from('headshots').upload(path, file, { upsert: false, cacheControl: '31536000' })
      if (upErr) throw new Error(upErr.message)
      const { data } = sb.storage.from('headshots').getPublicUrl(path)
      setStyleReferenceUrl(data.publicUrl)
      // Fresh upload — not (yet) from a saved preset, so the "Save as preset"
      // button becomes available on this URL.
      setLoadedPresetId(null)
    } catch (err) {
      setThumbnailError(err instanceof Error ? err.message : 'Style reference upload failed')
    } finally {
      setStyleRefUploading(false)
    }
  }

  // 3C — Upload one or more product reference photos. Reuses the same public
  // product-images bucket as the other thumbnail uploads (server fetches them
  // back, rehosts to fal, and passes all of them as references to Nano Banana
  // Pro). Hard-capped at 5 — anything past the cap is silently dropped here
  // and clamped server-side too.
  async function handleProductImagesUpload(files: FileList | null) {
    setThumbnailError(null)
    if (!files || files.length === 0) return
    const room = 5 - productImageUrls.length
    if (room <= 0) { setThumbnailError('Up to 5 product photos.'); return }
    setProductImagesUploading(true)
    try {
      const sb = createBrowserClient()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const next: string[] = []
      for (const f of Array.from(files).slice(0, room)) {
        if (!f.type.startsWith('image/')) continue
        if (f.size > 10 * 1024 * 1024) {
          setThumbnailError(`${f.name}: ${(f.size / 1024 / 1024).toFixed(1)} MB — keep each photo under 10 MB.`)
          continue
        }
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase()
        const path = `${user.id}/thumb-product-refs/${crypto.randomUUID()}.${ext}`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: upErr } = await (sb.storage as any)
          .from('product-images').upload(path, f, { upsert: false, cacheControl: '31536000', contentType: f.type || 'image/jpeg' })
        if (upErr) { setThumbnailError(upErr.message); continue }
        const { data } = sb.storage.from('product-images').getPublicUrl(path)
        if (data?.publicUrl) next.push(data.publicUrl)
      }
      if (next.length) setProductImageUrls(prev => [...prev, ...next].slice(0, 5))
    } catch (err) {
      setThumbnailError(err instanceof Error ? err.message : 'Photo upload failed')
    } finally {
      setProductImagesUploading(false)
    }
  }

  function removeProductImage(url: string) {
    setProductImageUrls(prev => prev.filter(u => u !== url))
  }

  // Pre-generation title-options fetch. Fired the moment the "Who writes the
  // thumbnail headline?" modal opens (and again on "Regenerate"). Returns 5
  // product-specific titles built from the video title + description + ASIN so
  // the creator picks the line BEFORE the thumbnail is composed.
  async function loadTitleOptions() {
    setPickerTitles([])
    setTitleOptionsError(null)
    setTitleOptionsLoading(true)
    try {
      const res = await fetch('/api/youtube/generate-titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoTitle: editTitle || video.title,
          videoDescription: video.description,
          asin: cardAsin ?? undefined,
          count: 4,
        }),
      })
      const data = await res.json().catch(() => ({})) as { ok?: boolean; titles?: string[]; error?: string }
      if (!res.ok || !Array.isArray(data.titles) || data.titles.length === 0) {
        throw new Error(data.error || 'No titles returned')
      }
      setPickerTitles(data.titles)
      // Default-select the first AI option so Start is immediately clickable —
      // unless the user already had a custom headline typed, in which case
      // keep them on the "Write your own" radio.
      if (!customHeadline.trim()) setHeadlinePromptChoice(0)
    } catch (err) {
      setTitleOptionsError(err instanceof Error ? err.message : 'Failed to load title options')
    } finally {
      setTitleOptionsLoading(false)
    }
  }

  // Open the "Pick a thumbnail headline" modal BEFORE any generation fires.
  // Both manual entry points (Create my MVP Thumbnail + Product Only) route
  // through here so the creator always chooses the headline that gets baked
  // onto the thumbnail. `opts` is stashed and replayed on "Start generation".
  function openHeadlinePicker(opts: { textMode?: 'baked' | 'clean' | 'graphic'; noHuman?: boolean }) {
    setPendingThumbOpts(opts)
    // Land on the first AI suggestion unless they already typed their own.
    setHeadlinePromptChoice(customHeadline.trim() ? 'custom' : 0)
    setHeadlinePromptOpen(true)
    void loadTitleOptions()
  }

  async function generateThumbnail(opts?: { textMode?: 'baked' | 'clean' | 'graphic'; lockedHeadline?: string; noHuman?: boolean; skipFaceModel?: boolean; productImageUrlsOverride?: string[] }) {
    setGeneratingThumbnail(true)
    setThumbnailError(null)
    setThumbnailStatus('')
    const isProductOnly = opts?.noHuman ?? (selectedFaceModelId === 'no-human' || scoutFaceSelection === 'no-human')
    // Caller passes the picked headline DIRECTLY (not via setCustomHeadline +
    // setTimeout) — React state may not have flushed yet when this function's
    // closure reads customHeadline, which is what made the route fall back to
    // generic hooks even after the user picked from the modal.
    const headline = ((opts?.lockedHeadline ?? customHeadline).trim()) || undefined
    // SCOUT path (skipFaceModel:true): the person IN the video IS the identity
    // source — we never use the selected face model, even if Seb is auto-matched
    // to a video where Michelle appears. The captured frame carries the right face.
    const effectiveFaceModelId = opts?.skipFaceModel ? null : selectedFaceModelId
    // Determine textMode early so we know how many frames to request.
    // gpt-image ('graphic') is the ONLY engine now — for face thumbnails AND
    // product-only. The old NB/Gemini 'clean' path is retired (not good enough).
    const effectiveTextMode = opts?.textMode ?? 'graphic'
    try {
      // Capture a video frame ONLY when we have no face to work from. With the
      // selfie-driven flow, a selected face IS the identity source and gpt-image
      // re-renders the person freely — so opening the video for a frame is just
      // friction. We still grab one when there's no face model (then the frame
      // is the only identity source) and never for product-only.
      const hasRealFace = (scoutFaceSelection !== 'auto' && scoutFaceSelection !== 'no-human')
        || (!!effectiveFaceModelId && effectiveFaceModelId !== 'no-human')
      let capturedFrames: string[] = []
      if (video.youtubeVideoId && !isProductOnly && !hasRealFace) {
        if (capturedFramesRef.current?.videoId === video.youtubeVideoId && capturedFramesRef.current.frames.length) {
          capturedFrames = capturedFramesRef.current.frames
        } else {
          try {
            if (await isExtensionAvailable()) {
              setThumbnailError(null)
              setThumbnailStatus('Opening your video to capture a frame…')
              // 4 frames spread across the video — enough for the vision picker
              // while keeping capture time to ~20s. Pre-capture on expand means
              // these are usually ready before the user clicks Generate.
              const frames = await requestVideoFrames(video.youtubeVideoId, [0.15, 0.3, 0.5, 0.7])
              if (frames.length) {
                capturedFrames = frames
                capturedFramesRef.current = { videoId: video.youtubeVideoId, frames }
              }
            }
          } catch { /* ignore — fall back to the maxres frame */ }
        }
      }
      setThumbnailStatus('Generating your thumbnail…')
      const res = await fetch('/api/youtube/generate-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(290000),
        body: JSON.stringify({
          videoTitle: editTitle || video.title,
          asin: cardAsin ?? undefined,
          // Co-Pilot converts product links to geni.us, so the RAW video
          // description usually has no resolvable product link. The MVP-generated
          // description (editDesc) carries the geni.us link — send that so the
          // resolver can follow it to the real Amazon product (otherwise
          // gpt-image invents a generic product).
          videoDescription: editDesc.trim() || video.description,
          youtubeVideoId: video.youtubeVideoId,
          productTitle: product?.title ?? undefined,
          productDescription: product?.description ?? undefined,
          productBullets: product?.bullets ?? undefined,
          style: 'lifestyle',
          customHeadline: headline,
          variantCount,
          // The thumbnail-style block drives every generation (border + accent, live).
          borderStyleIndex: borderIndex ?? undefined,
          accentColor,
          // Face identity. The "Who's in this video?" picker (scoutFaceSelection)
          // is the user's EXPLICIT choice — honour it whether or not SCOUT managed
          // to capture frames. Previously, a failed/empty frame capture fell back
          // to the unrelated selectedFaceModelId (which the picker never sets), so
          // the picked person (e.g. Michelle) was silently dropped and the route
          // auto-matched the WRONG face.
          faceModelId: (() => {
            if (isProductOnly) return undefined
            if (scoutFaceSelection !== 'auto' && scoutFaceSelection !== 'no-human') return scoutFaceSelection
            return (effectiveFaceModelId && effectiveFaceModelId !== 'no-human') ? effectiveFaceModelId : undefined
          })(),
          faceAuto: (() => {
            if (isProductOnly) return undefined
            // An explicit person (or No-face) was picked → never auto-detect.
            if (scoutFaceSelection !== 'auto') return undefined
            // Auto picker: let the route vision-match (frames present) or auto-load
            // every model when no specific legacy model was chosen.
            return (capturedFrames.length > 0 || !effectiveFaceModelId) ? true : undefined
          })(),
          // 'no-human' → product-only; honoured whenever the picker is on No face.
          noHuman: (isProductOnly || scoutFaceSelection === 'no-human') || undefined,
          styleReferenceUrl: styleReferenceUrl || undefined,
          // 3C — Multi-product reference photos + optional composition note.
          // When the user uploaded their own product photos these replace the
          // single Amazon-scraped image as the references; the note (if any)
          // tells the model how to arrange them. A SCOUT-fetched image (from the
          // blocked-server rescue below) wins over the state-held uploads.
          customProductImageUrls: opts?.productImageUrlsOverride?.length ? opts.productImageUrlsOverride : (productImageUrls.length > 0 ? productImageUrls : undefined),
          // COMPARISON (Labs): the products the metadata was generated for, so
          // the thumbnail shows each one from its own Amazon photo.
          // Not on the SCOUT retry: those photos are all of ONE product, and
          // calling them a comparison would tell the model they are different.
          // A Short gets a vertical 9:16 thumbnail, the shape of the Short itself.
          ...(shortMode ? { format: 'short' } : {}),
          ...(canCompare && compareOn && compareResult && compareResult.length > 1 && !opts?.productImageUrlsOverride?.length
            ? { comparisonAsins: compareResult.map((r) => r.asin) } : {}),
          productCompositionNote: productCompositionNote.trim() || undefined,
          // Creator's free-text "describe your thumbnail" direction.
          scenePrompt: scenePrompt.trim() || undefined,
          // Optional pasted product link — authoritative product source.
          productUrl: productUrl.trim() || undefined,
          // This route hands back the TEXT-FREE base; the headline is baked on
          // in the browser below. Let the client save the finished image, or
          // the product would remember a thumbnail with no title on it.
          deferImageMemory: true,
          // graphic = gpt-image-1 (identity-grounded, ~20s with video frame or ~2min with Photobooth).
          // Use graphic whenever there's an identity source: face model OR a YouTube video to pull frames from.
          // Product-only / selfie → 'clean' (NB Pro, fast, no face composition).
          textMode: effectiveTextMode,
          capturedFrames: capturedFrames.length ? capturedFrames : undefined,
          // "Break frame" effect: composites the creator OVER the neon border.
          // Off by default (costs ~20s for the rembg pass).
          breakFrame: breakFrame || undefined,
          // Headline style: 'question' composes a curiosity question about the
          // product + a matching facial reaction; default polished statement.
          headlineStyle: thumbQuestionMode ? 'question' : 'statement',
          wearProduct: thumbWear && !isProductOnly,
          ...(thumbExpression !== 'auto' && !isProductOnly ? { expression: thumbExpression } : {}),
          // Boost controls (pose / energy effects / starburst badge / red accent word).
          pose: thumbPose !== 'auto' ? thumbPose : undefined,
          energyEffects: thumbEffects || undefined,
          badgeText: thumbBadge.trim() || undefined,
          accentWord: thumbAccentWord.trim() || undefined,
          // A chosen accent word reads best in red; only force the colour when the
          // creator actually picked a word, so the default yellow emphasis is untouched.
          ...((thumbAccentWord.trim() || thumbAutoAccent) ? { accentColor: '#FF2D2D' } : {}),
          // Zero-typing toggles: the AI writes the badge / picks the accent word.
          autoBadge: thumbAutoBadge || undefined,
          autoAccent: thumbAutoAccent || undefined,
        }),
      })
      const data = await safeJson(res)
      if (data.limitReached) {
        setCapError({
          message: (data.error as string) || 'You\'ve hit your thumbnail cap for this period.',
          info: { cap: (data.cap as string) || 'thumbnails', currentTier: data.currentTier as string | undefined, upgrade: data.upgrade as { tier: string; label: string; limit: number | null } | null | undefined },
        })
        return
      }
      // needsExtension (409): private/inaccessible video with no face identity source.
      if (!res.ok && data.needsExtension) {
        throw new Error("This video is private. Install the SCOUT extension from the Chrome Web Store to capture frames, or select a Face Model under \"Your Face\".")
      }
      // Amazon blocked the SERVER from fetching the product image (datacenter IP),
      // so the render had nothing to ground on. Fetch the product through SCOUT —
      // it runs in the creator's own browser, which Amazon doesn't block — and
      // retry once with those images. Guard against a loop (only when we haven't
      // already passed an override).
      if (!res.ok && data.scrapeFailed && cardAsin && !opts?.productImageUrlsOverride) {
        try {
          if (await isExtensionAvailable()) {
            setThumbnailStatus('Amazon blocked our server — grabbing the product through SCOUT…')
            if (canCompare && compareOn && compareResult && compareResult.length > 1) {
              toast.warning('Amazon blocked the product photos, so this thumbnail shows one product, not the comparison. Try again later for all of them.')
            }
            const prod = await requestAmazonProduct(cardAsin)
            const imgs = prod.ok && prod.product
              ? [prod.product.imageUrl, ...(prod.product.images || [])].filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u))
              : []
            if (imgs.length) {
              await generateThumbnail({ ...opts, productImageUrlsOverride: imgs.slice(0, 5) })
              return
            }
          }
        } catch { /* fall through to the normal error below */ }
      }
      // needsFaceModel (409): the user hasn't set up a Face Model and asked for
      // a thumbnail WITH a face — surface the full guidance, not a generic error.
      if (!res.ok) {
        // Surface the ACTUAL engine reason (gfxFallbackReason) instead of only the
        // generic "hit a snag", so a persistent failure is diagnosable at a glance.
        const why = typeof data.gfxFallbackReason === 'string' ? data.gfxFallbackReason.slice(0, 200) : ''
        const base = (data.message as string) || (data.error as string) || 'Thumbnail generation failed'
        throw new Error(why && !base.includes(why) ? `${base} (${why})` : base)
      }
      setCapError(null)
      await applyThumbnailResult(data)
      // A COMPARISON THAT LOST A PRODUCT says so: a thumbnail showing two of
      // three products looks finished, and nothing else would tell.
      const cmp = data.comparison as { asked: number; shown: number } | null | undefined
      if (cmp && cmp.shown < cmp.asked) {
        toast.warning(cmp.shown > 1
          ? `Only ${cmp.shown} of the ${cmp.asked} products are in this thumbnail: Amazon did not give MVP a photo of the rest.`
          : `The comparison could not be drawn: Amazon did not give MVP photos of the products, so this shows one product.`)
      }
    } catch (err) {
      setThumbnailError(err instanceof Error ? err.message : 'Failed to generate thumbnail')
    } finally {
      setGeneratingThumbnail(false)
      setThumbnailStatus('')
    }
  }

  // ── Auto-thumbnail: called right after metadata is generated ─────────────
  // Accepts product data directly so we don't rely on React state being updated
  async function generateThumbnailWithData(overrides: {
    productTitle?: string
    productDescription?: string
    productBullets?: string[]
    title?: string
  }) {
    setGeneratingThumbnail(true)
    setThumbnailError(null)
    try {
      const res = await fetch('/api/youtube/generate-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoTitle: overrides.title || video.title,
          asin: cardAsin ?? undefined,
          // Co-Pilot converts product links to geni.us, so the RAW video
          // description usually has no resolvable product link. The MVP-generated
          // description (editDesc) carries the geni.us link — send that so the
          // resolver can follow it to the real Amazon product (otherwise
          // gpt-image invents a generic product).
          videoDescription: editDesc.trim() || video.description,
          youtubeVideoId: video.youtubeVideoId,
          productTitle: overrides.productTitle ?? undefined,
          productDescription: overrides.productDescription ?? undefined,
          productBullets: overrides.productBullets ?? undefined,
          style: 'lifestyle',
          customHeadline: customHeadline.trim() || undefined,
          variantCount,
          borderStyleIndex: borderIndex ?? undefined,
          accentColor,
          // Honour an explicit "Who's in this video?" pick here too, so the
          // auto-thumbnail doesn't render the wrong person.
          faceModelId: (scoutFaceSelection !== 'auto' && scoutFaceSelection !== 'no-human')
            ? scoutFaceSelection
            : ((selectedFaceModelId && selectedFaceModelId !== 'no-human') ? selectedFaceModelId : undefined),
          // 'no-human' → product-only thumbnail, no face composition at all.
          noHuman: (selectedFaceModelId === 'no-human' || scoutFaceSelection === 'no-human') || undefined,
          styleReferenceUrl: styleReferenceUrl || undefined,
          // 3C — Carry the user's uploaded product photos + composition note
          // through the auto-thumbnail path too (post-metadata fire-and-forget).
          // Same semantics as the manual Generate call below.
          customProductImageUrls: productImageUrls.length > 0 ? productImageUrls : undefined,
          productCompositionNote: productCompositionNote.trim() || undefined,
          // Creator's free-text "describe your thumbnail" direction.
          scenePrompt: scenePrompt.trim() || undefined,
          // Optional pasted product link — authoritative product source.
          productUrl: productUrl.trim() || undefined,
          // This route hands back the TEXT-FREE base; the headline is baked on
          // in the browser below. Let the client save the finished image, or
          // the product would remember a thumbnail with no title on it.
          deferImageMemory: true,
          // gpt-image is the only engine now (matches the manual Generate button).
          textMode: 'graphic',
          breakFrame: breakFrame || undefined,
          headlineStyle: thumbQuestionMode ? 'question' : 'statement',
          wearProduct: thumbWear && !(selectedFaceModelId === 'no-human' || scoutFaceSelection === 'no-human'),
          ...(thumbExpression !== 'auto' && !(selectedFaceModelId === 'no-human' || scoutFaceSelection === 'no-human') ? { expression: thumbExpression } : {}),
          // Boost controls — same levers as the manual Generate button. accentColor
          // is already sent above on this path, so it isn't repeated here.
          pose: thumbPose !== 'auto' ? thumbPose : undefined,
          energyEffects: thumbEffects || undefined,
          badgeText: thumbBadge.trim() || undefined,
          accentWord: thumbAccentWord.trim() || undefined,
          autoBadge: thumbAutoBadge || undefined,
          autoAccent: thumbAutoAccent || undefined,
        }),
      })
      const data = await safeJson(res)
      if (data.limitReached) {
        setCapError({
          message: (data.error as string) || 'You\'ve hit your thumbnail cap for this period.',
          info: { cap: (data.cap as string) || 'thumbnails', currentTier: data.currentTier as string | undefined, upgrade: data.upgrade as { tier: string; label: string; limit: number | null } | null | undefined },
        })
        return
      }
      // needsFaceModel (409): the user hasn't set up a Face Model and asked for
      // a thumbnail WITH a face — surface the full guidance, not a generic error.
      if (!res.ok) {
        // Surface the ACTUAL engine reason (gfxFallbackReason) instead of only the
        // generic "hit a snag", so a persistent failure is diagnosable at a glance.
        const why = typeof data.gfxFallbackReason === 'string' ? data.gfxFallbackReason.slice(0, 200) : ''
        const base = (data.message as string) || (data.error as string) || 'Thumbnail generation failed'
        throw new Error(why && !base.includes(why) ? `${base} (${why})` : base)
      }
      setCapError(null)
      await applyThumbnailResult(data)
    } catch (err) {
      setThumbnailError(err instanceof Error ? err.message : 'Failed to generate thumbnail')
    } finally {
      setGeneratingThumbnail(false)
    }
  }

  // ── Thumbnail text-overlay styles ────────────────────────────────────────────
  // Visually distinct presets. One is picked randomly per generation so each
  // thumbnail looks different. Fonts are loaded from Google Fonts on demand.
  //
  // CALIBRATION (2026-05-20):
  //   1. User flagged all-white Bebas as "too plain" — removed.
  //   2. Titles must be VIRAL/PUNCHY, not subdued — every preset now uses
  //      bigger fonts (≥130px max), thicker outlines (≥16px), and a
  //      chunky "sticker" hardShadow (solid offset, no blur) on top of
  //      the soft blurry shadow for the splat-on-the-image look.
  //   3. New highlight-strip variant draws a yellow neon bar behind one
  //      line for the "MUST WATCH" / "GAME CHANGER" emphasis pop.
  //   4. If you tone these down later, re-read the memory file
  //      feedback_thumbnail_calibration.md first.
  // OVERLAY_STYLES + drawHeadline are imported from '@/lib/thumbnail-overlay'
  // (shared with the Instagram overlay) — MrBeast-style top-centred bold
  // lettering, no boxes. Edit them there.

  // Cache so the same font isn't loaded twice across re-renders
  const loadedFontsRef = React.useRef(new Set<string>())

  async function loadOverlayFont(fontName: string | null): Promise<void> {
    if (!fontName || loadedFontsRef.current.has(fontName)) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/ /g, '+')}:wght@400;700&display=swap`
    document.head.appendChild(link)
    await document.fonts.ready
    loadedFontsRef.current.add(fontName)
  }

  // ── addTextOverlay — picks a random style, loads the font, draws the canvas ──
  async function addTextOverlay(rawUrl: string, hookText: string, styleIndex?: number, cutoutUrl?: string, position?: HeadlinePosition, faceBox?: FaceBox): Promise<{ url: string; styleId: string }> {
    const style = OVERLAY_STYLES[styleIndex ?? Math.floor(Math.random() * OVERLAY_STYLES.length)]
    await loadOverlayFont(style.fontName)

    // Canvas needs crossOrigin images; proxy non-data URLs. Resolves null on
    // failure so a missing cut-out never blocks the thumbnail.
    const loadImg = (u: string) => new Promise<HTMLImageElement | null>((res) => {
      const im = new window.Image()
      im.crossOrigin = 'anonymous'
      im.onload = () => res(im)
      im.onerror = () => res(null)
      im.src = u.startsWith('data:') ? u : `/api/proxy-image?url=${encodeURIComponent(u)}`
    })

    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas not supported')

    const productImg = await loadImg(rawUrl)
    if (!productImg) throw new Error('Failed to load image for overlay')
    ctx.drawImage(productImg, 0, 0, 1280, 720)

    // Composite the creator cut-out into the bottom-right corner (transparent
    // PNG over the product scene), anchored to the bottom edge. Capped to ~46%
    // of the width / 96% of the height so it can never cover the whole scene
    // regardless of the cut-out's aspect ratio.
    if (cutoutUrl) {
      const cut = await loadImg(cutoutUrl)
      if (cut && cut.naturalWidth > 0) {
        // The server pads the portrait with background before removing it, so
        // the cut-out arrives with transparent margin around the person. Find
        // the opaque bounding box and draw only that region, so the padding
        // doesn't shrink the person — the face still fills the slot.
        const iw = cut.naturalWidth, ih = cut.naturalHeight
        let sx = 0, sy = 0, sw = iw, sh = ih
        let source: CanvasImageSource = cut
        try {
          const oc = document.createElement('canvas')
          oc.width = iw; oc.height = ih
          const octx = oc.getContext('2d', { willReadFrequently: true })
          if (octx) {
            octx.drawImage(cut, 0, 0)
            const imgData = octx.getImageData(0, 0, iw, ih)
            const data = imgData.data
            const ALPHA = 16
            // Per-column opaque stats — used both for the green despill and to
            // isolate the main subject from a separated side-figure (gpt-image
            // sometimes generates a companion next to the creator).
            const colCount = new Int32Array(iw)
            const colTop = new Int32Array(iw); colTop.fill(ih)
            const colBot = new Int32Array(iw); colBot.fill(-1)
            for (let y = 0; y < ih; y++) {
              for (let x = 0; x < iw; x++) {
                const i = (y * iw + x) * 4
                const a = data[i + 3]
                if (a > ALPHA) {
                  colCount[x]++
                  if (y < colTop[x]) colTop[x] = y
                  if (y > colBot[x]) colBot[x] = y
                }
                // Green despill: the green-screen matte leaves a green tint on
                // semi-transparent hair/edge pixels. Where green dominates,
                // clamp it down to the brighter of red/blue so the halo goes
                // neutral instead of glowing green.
                if (a > 0) {
                  const g = data[i + 1]
                  const rb = data[i] > data[i + 2] ? data[i] : data[i + 2]
                  if (g > rb) data[i + 1] = rb
                }
              }
            }
            octx.putImageData(imgData, 0, 0)
            source = oc

            // Feather the alpha edge ~1.5px so the cut-out blends into the scene
            // instead of reading as a hard pasted sticker. Drawing a blurred copy
            // with destination-in erodes the edge into a soft transition.
            try {
              const feather = document.createElement('canvas')
              feather.width = iw; feather.height = ih
              const fctx = feather.getContext('2d')
              if (fctx) {
                fctx.drawImage(oc, 0, 0)
                fctx.globalCompositeOperation = 'destination-in'
                fctx.filter = 'blur(1.5px)'
                fctx.drawImage(oc, 0, 0)
                fctx.filter = 'none'
                fctx.globalCompositeOperation = 'source-over'
                source = feather
              }
            } catch { /* keep the un-feathered cut-out */ }

            // Split the columns into runs separated by empty (fully transparent)
            // gaps and keep the HEAVIEST run — that's the main subject. A
            // companion standing apart with a gap between them becomes its own,
            // lighter run and gets dropped. A lone subject yields one run = the
            // full bounding box, so this is a no-op in the normal case.
            const minCol = Math.max(2, Math.floor(ih * 0.04)) // ignore stray wisp columns
            let bestStart = -1, bestEnd = -1, bestSum = -1
            let curStart = -1, curSum = 0
            for (let x = 0; x <= iw; x++) {
              const active = x < iw && colCount[x] >= minCol
              if (active) {
                if (curStart < 0) { curStart = x; curSum = 0 }
                curSum += colCount[x]
              } else if (curStart >= 0) {
                if (curSum > bestSum) { bestSum = curSum; bestStart = curStart; bestEnd = x - 1 }
                curStart = -1; curSum = 0
              }
            }
            if (bestStart >= 0) {
              let top = ih, bot = -1
              for (let x = bestStart; x <= bestEnd; x++) {
                if (colTop[x] < top) top = colTop[x]
                if (colBot[x] > bot) bot = colBot[x]
              }
              if (bot >= top) { sx = bestStart; sw = bestEnd - bestStart + 1; sy = top; sh = bot - top + 1 }
            }
          }
        } catch { /* tainted/unsupported — fall back to the full image */ }

        const ar = sw / sh
        const maxW = 1280 * 0.46
        const maxH = 720 * 0.96
        let cw = maxW
        let ch = cw / ar
        if (ch > maxH) { ch = maxH; cw = ch * ar }
        // No drop-shadow: any blurred shadow pools into a dark halo where the
        // cut-out meets the bottom-right frame corner. The despilled green-screen
        // edge is clean enough to sit directly on the scene.
        ctx.drawImage(source, sx, sy, sw, sh, 1280 - cw, 720 - ch, cw, ch)
      }
    }

    const text = hookText.replace(/\bhonest\b/gi, '').replace(/\s{2,}/g, ' ').trim().toUpperCase()
    if (text) {
      const words = text.split(' ')
      const lines = words.length === 1
        ? [words[0]]
        : (() => { const s = Math.ceil(words.length / 2); return [words.slice(0, s).join(' '), words.slice(s).join(' ')].filter(Boolean) })()
      // Smart text-zone (from the vision pass) places the headline in the corner
      // clear of the face. If we composited a cut-out into the bottom-right, a
      // bottom-right headline would collide — fall back to the style default.
      const safePos = position && !(cutoutUrl && position === 'bottom-right') ? position : undefined
      // Don't pass a faceBox when we composited a cut-out — the face we'd avoid
      // is from the source frame, not this scene, so it'd misplace the text.
      const safeFace = cutoutUrl ? undefined : faceBox
      // Shared renderer — MrBeast-style bold lettering, no boxes.
      drawHeadline(ctx, lines, style, 1280, 720, safePos, safeFace)
    }

    return { url: canvas.toDataURL('image/jpeg', 0.95), styleId: style.id }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const ytUrl = `https://www.youtube.com/watch?v=${video.youtubeVideoId}`

  return (
    <div id={`copilot-vid-${video.youtubeVideoId}`} className="card overflow-hidden scroll-mt-24 transition-shadow">
      {/* Video header */}
      <div className="flex gap-4 p-5">
        {/* Icon placeholder sits BEHIND the thumbnail. PRIVATE YouTube videos
            don't serve a public thumbnail, so i.ytimg.com 404s — the img then
            hides itself (onError) and this icon shows through instead of a blank
            box. Same fallback when there's no thumbnail URL at all. */}
        <div className="w-32 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100 relative flex items-center justify-center" style={{ height: '72px' }}>
          <Youtube size={20} className="text-[#86868b] dark:text-[#8e8e93]" />
          {video.thumbnailUrl && (
            <img
              src={video.thumbnailUrl}
              alt={video.title}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {/* Visibility chip — spells out the YouTube state in words so creators
                don't have to INFER it from "is there a date or not". All of these
                come straight from YouTube's own status:
                  public                 → "Public · live"            (already live)
                  private + publishAt    → "Scheduled · <date>"       (YouTube auto-publishes then)
                  private (no publishAt)  → "Private · not scheduled"  (will NOT go live on its own)
                  unlisted               → "Unlisted"
                Previously a plain-private and a scheduled video both just said
                "private", and the only difference was a separate date chip —
                which is exactly what confused people. */}
            {video.status === 'public' ? (
              <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#34c759]/10 text-[#34c759]">
                <Globe size={9} /> Public · live
              </span>
            ) : video.publishAt ? (
              <span
                className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#5856d6]/10 text-[#5856d6]"
                title={`YouTube will automatically make this public at ${new Date(video.publishAt).toLocaleString()}`}
              >
                <Calendar size={9} /> Scheduled · {new Date(video.publishAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
            ) : video.status === 'unlisted' ? (
              <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#7C3AED]/10 text-[#7C3AED]">
                <Eye size={9} /> Unlisted
              </span>
            ) : (
              <span
                className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-[#6e6e73] dark:text-[#ebebf0]"
                title="Private with no scheduled publish date — it won't go live on its own. Set a publish date in YouTube Studio (or publish it) to make it live."
              >
                <Lock size={9} className="text-[#ff9500]" /> Private · not scheduled
              </span>
            )}
            {shortMode && (
              <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#ff3b30]/10 text-[#ff3b30]" title="YouTube says this is a Short: Co-Pilot writes Short-shaped metadata for it">
                Short
              </span>
            )}
            {cardAsin && (
              <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#ff9500]/10 text-[#ff9500]">
                <Tag size={9} /> ASIN: {cardAsin}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] leading-snug line-clamp-2 mb-2">{video.title}</p>
          {/* ALWAYS THERE: a title with no ASIN is exactly when the creator
              most needs to say which product this is. */}
          <ProductConfirm
            youtubeVideoId={video.youtubeVideoId}
            detectedAsin={cardAsin}
            onFixed={(a) => { setFixedAsin(a); setNeedsProduct(false) }}
            onRewrite={() => { if (!generating) void generate() }}
          />
          {shortMode && (
            <div className="mb-2 rounded-lg border border-[#ff3b30]/20 bg-[#ff3b30]/[0.04] px-2.5 py-1.5 text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7]">
              <b>This is a Short.</b> YouTube does not make links clickable in a Short&apos;s description or comments, so Co-Pilot writes a short
              title and description that send viewers to your full review, and no pinned comment link. The product tag SCOUT adds in Studio is the link that works on a Short.
              {shortResult && (
                <span className="block mt-0.5 text-[#86868b]">
                  {shortResult.fullReviewUrl ? `Full review linked: ${shortResult.fullReviewUrl}. Also set it as the Short's Related video in YouTube Studio or the app, which is clickable.` : 'MVP found no other video of yours for this product, so there is no full review to point to.'}
                </span>
              )}
            </div>
          )}
          {canCompare && (
            <ComparisonProducts
              on={compareOn}
              onToggle={toggleCompare}
              slots={compareSlots}
              onChange={setCompareSlots}
              result={compareResult}
              saved={compareSaved}
              disabled={generating}
            />
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {generating ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-xs text-[#7C3AED] font-medium">
                  <Loader2 size={12} className="animate-spin" />
                  Running MVP agent swarm…
                </div>
                <div className="flex flex-wrap gap-1">
                  {(cardAsin
                    ? ['🔬 Product Analyst', '🎯 Title Strategist', '🔍 SEO Researcher', '✍️ Content Writer', '💬 Engagement Agent']
                    : ['🔬 Video Analyst', '🎯 Title Strategist', '🔍 SEO Researcher', '✍️ Description Writer', '💬 Engagement Agent']
                  ).map(a => (
                    <span key={a} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] animate-pulse">{a}</span>
                  ))}
                </div>
              </div>
            ) : (
              <button
                onClick={() => generate()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: cardAsin
                  ? 'linear-gradient(135deg, #ff9500 0%, #ff3b30 100%)'
                  : 'linear-gradient(135deg, #7C3AED 0%, #5856d6 100%)' }}
              >
                <Wand2 size={12} />
                {generated
                  ? 'Regenerate'
                  : cardAsin
                    ? 'Generate YouTube metadata'
                    : 'Generate metadata (no product)'}
              </button>
            )}
            {!cardAsin && !generating && (
              <span className="text-[11px] text-[#86868b] dark:text-[#8e8e93] italic">
                No ASIN in the title — we&apos;ll use a product link from your description if there is one (Amazon or a direct store link, wrapped with your Geniuslink), otherwise we write everything around the video&apos;s topic.
              </span>
            )}
            <a href={ytUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#7C3AED] transition-colors">
              <ExternalLink size={11} /> Open in YouTube
            </a>
          </div>
          {progress && (
            <p className="text-xs text-[#7C3AED] mt-2 flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin flex-shrink-0" />
              {progress}
            </p>
          )}
          {error && <p className="text-xs text-[#ff3b30] mt-2">{typeof error === 'string' ? error : 'Something went wrong'}</p>}
          {(asinMismatch || needsProduct) && !generating && (
            <button
              onClick={() => generate(true)}
              className="mt-2 text-[11px] px-3 h-7 rounded-md border border-[#ff9500] text-[#ff9500] font-semibold hover:bg-[#ff9500] hover:text-white transition"
              title={needsProduct ? 'This video is not about a product? Generate general metadata from the title.' : 'The product is right? Generate metadata anyway, skipping the ASIN match check.'}
            >
              {needsProduct ? 'Generate without a product' : 'Generate anyway'}
            </button>
          )}
          {capError && (
            <div className="mt-3">
              <CapReachedBanner
                message={capError.message}
                info={capError.info}
                onDismiss={() => setCapError(null)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Generated results */}
      {generated && (
        <div className="border-t border-gray-100 dark:border-white/10">
          {/* Product info bar */}
          {product?.title && (
            <div className="flex items-center gap-3 px-5 py-3 bg-[#ff9500]/5">
              {product.imageUrl && (
                <img src={product.imageUrl} alt={product.title} className="w-10 h-10 object-contain rounded" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{product.title}</p>
                  {/* When we found the product via Amazon search (no ASIN
                      in title), flag it so the user can sanity-check the
                      match before publishing. */}
                  {productDiscoverySource === 'search' && (
                    <span
                      title="No ASIN was in your YouTube title — we identified this product from your title text and found it on Amazon. Double-check it's the right match before publishing."
                      className="flex-shrink-0 inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#5856d6]/10 text-[#5856d6] border border-[#5856d6]/30"
                    >
                      <Sparkles size={9} /> Auto-discovered
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">
                  {product.price && <span>{product.price}</span>}
                  {product.rating && <span>★ {product.rating}/5</span>}
                  {affiliateUrl && (
                    <span className="flex items-center gap-1 text-[#7C3AED]">
                      <Link2 size={9} />
                      {linkStyleUsed === 'passport' ? 'Passport link ✓'
                        : linkStyleUsed === 'geniuslink' ? 'Geniuslink ✓'
                        : linkStyleUsed === 'bitly' ? 'Bitly link ✓'
                        : linkStyleUsed === 'direct' ? (affiliateUrl?.includes('?tag=') ? 'Associates link ✓' : 'Plain Amazon link')
                        // Pre-fix responses carry no linkStyle. Guess from the URL
                        // as before rather than showing nothing.
                        : geniuslinkUsed ? 'Geniuslink ✓'
                        : affiliateUrl?.includes('mvpl.ink') ? 'Passport link ✓'
                        : affiliateUrl?.includes('?tag=') ? 'Associates link ✓' : 'Plain Amazon link'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Geniuslink warning. A TIMEOUT / 5xx is a transient Geniuslink-side
              blip — don't tell the user to fix their credentials for that (it's
              misleading). Only point at credentials for a real auth/config error. */}
          {geniuslinkUsed === false && geniuslinkError && (
            <div className={linkStyleHonoured
              // Nothing failed: neutral, no triangle, no alarm colour.
              ? 'mx-5 mb-3 px-3 py-2 rounded-lg bg-[#8e8e93]/10 border border-[#8e8e93]/20 text-xs text-[#6e6e73] dark:text-[#a1a1a6]'
              : 'mx-5 mb-3 px-3 py-2 rounded-lg bg-[#ff9500]/10 border border-[#ff9500]/20 text-xs text-[#ff9500]'}>
              {linkStyleHonoured
                ? <>{geniuslinkError}</>
                : geniuslinkSkippedByStyle
                ? <>⚠️ Geniuslink not used. {geniuslinkError}</>
                : <>⚠️ Geniuslink not used — {geniuslinkError}.{' '}
                    {/timeout|aborted|transient|temporar|\b5\d\d\b/i.test(geniuslinkError)
                      ? <>This is usually a temporary Geniuslink hiccup — your Amazon tag was used as a fallback, and a <strong>Regenerate</strong> normally goes through with Geniuslink.</>
                      : <>Go to <strong>Brand Profile → Affiliate Link Routing</strong> to add or update your credentials.</>}
                  </>}
            </div>
          )}

          {/* Link-in-description check. Should never fire in normal use — the
              server puts the affiliate link at the top CTA and re-checks it's
              there. If it does, the creator should NOT publish until it's fixed. */}
          {affiliateUrl && geniuslinkVerified === false && (
            <div className="mx-5 mb-3 px-3 py-2 rounded-lg bg-[#ff3b30]/10 border border-[#ff3b30]/20 text-xs text-[#ff3b30]">
              ⚠️ Your affiliate link didn&rsquo;t land in the description. Hit <strong>Regenerate</strong> before publishing — don&rsquo;t post this one as-is.
            </div>
          )}

          {/* Toggle expand */}
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-2 w-full px-5 py-3 text-xs font-medium text-[#7C3AED] hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {expanded ? 'Hide' : 'Show'} generated metadata
            {applied && <span className="ml-auto flex items-center gap-1 text-[#34c759]"><CheckCircle size={12} /> Applied to YouTube</span>}
          </button>

          {expanded && (
            <div className="px-5 pb-5 flex flex-col gap-5">
              {/* Full-width stacked steps: metadata, then Art Director, top to bottom */}
              <div className="flex flex-col gap-5">

                {/* ── Step 1: metadata (full width) ── */}
                <div className="flex flex-col gap-5">

                  {/* Step 1 header */}
                  <div className="flex items-center gap-3 pb-1 border-b border-gray-100 dark:border-white/10">
                    <span className="w-7 h-7 rounded-full bg-[#7C3AED] text-white text-sm font-bold flex items-center justify-center flex-shrink-0 shadow-sm">1</span>
                    <div>
                      <p className="text-sm font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Review Metadata</p>
                      <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Edit title, description & tags if needed</p>
                    </div>
                  </div>

              {/* Title */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Title</label>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] ${editTitle.length > 90 ? 'text-[#ff3b30]' : 'text-[#86868b] dark:text-[#8e8e93]'}`}>{editTitle.length}/100</span>
                    <button onClick={() => copy(editTitle, 'title')} className="text-[10px] text-[#7C3AED] hover:underline flex items-center gap-0.5">
                      <Copy size={10} /> {copied === 'title' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  maxLength={100}
                  className="input-field text-sm"
                />
                {generated.title_alternatives?.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mb-1">Alternatives:</p>
                    <div className="flex flex-col gap-1">
                      {generated.title_alternatives.map((alt, i) => (
                        <button key={i} onClick={() => setEditTitle(alt)}
                          className="text-left text-xs text-[#7C3AED] hover:underline truncate">
                          → {alt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Description */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Description</label>
                  <button onClick={() => copy(editDesc, 'desc')} className="text-[10px] text-[#7C3AED] hover:underline flex items-center gap-0.5">
                    <Copy size={10} /> {copied === 'desc' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <textarea
                  value={editDesc}
                  onChange={e => {
                    const next = e.target.value
                    setEditDesc(next)
                    // Did they rewrite one of MVP's own lines? Exact-match
                    // against what MVP emitted, so per-video text (the product
                    // name, the hashtags, the ASIN) can never be mistaken for a
                    // template the creator wants kept.
                    setLineEditOffer(generated ? detectLineEdit(generated.description, next, descOverrides, {
                      shop: product ? 'AMAZON' : 'the product',
                      link: affiliateUrl || '',
                      site: '', email: '',
                    }) : null)
                  }}
                  rows={10}
                  className="input-field resize-none text-xs leading-relaxed font-mono"
                />
                {/* The offer. Their edit already ships with THIS video either
                    way; this is the part that was missing, and the reason a
                    creator was retyping the same sentence on every upload. */}
                {lineEditOffer && (
                  <div className="mt-2 px-3 py-2 rounded-lg bg-[#7C3AED]/8 border border-[#7C3AED]/20 flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                        You changed the {LINE_META[lineEditOffer.key].label.toLowerCase()}
                      </p>
                      <p className="text-[11px] text-[#6e6e73] dark:text-[#a1a1a6] mt-0.5">
                        This video already uses your version. Keep it for every future description too?
                      </p>
                    </div>
                    <button
                      onClick={() => void saveLineAsDefault()}
                      disabled={savingLine}
                      className="shrink-0 px-2.5 py-1 rounded-md text-[11px] font-semibold text-white disabled:opacity-50"
                      style={{ background: '#7C3AED' }}
                    >
                      {savingLine ? 'Saving…' : 'Save as default'}
                    </button>
                    <button
                      onClick={() => setLineEditOffer(null)}
                      className="shrink-0 px-1.5 py-1 text-[11px] text-[#86868b] hover:underline"
                    >
                      Not now
                    </button>
                  </div>
                )}
                {savedLineKey && (
                  <p className="mt-2 text-[11px] text-[#2E6B45] dark:text-[#6DBF8C]">
                    Saved. Your {LINE_META[savedLineKey].label.toLowerCase()} is now used on every new description. Change it any time on the YouTube page.
                  </p>
                )}
              </div>

              {/* Tags */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Tags ({generated.tags.length})</label>
                  <button onClick={() => copy(generated.tags.join(', '), 'tags')} className="text-[10px] text-[#7C3AED] hover:underline flex items-center gap-0.5">
                    <Copy size={10} /> {copied === 'tags' ? 'Copied!' : 'Copy all'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {generated.tags.map((tag, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-[#6e6e73] dark:text-[#ebebf0]">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

                </div> {/* ── end Step 1 ── */}

                {/* ── Step 2: MVP Art Director (full width, below step 1) ── */}
                <div className="flex flex-col gap-4 pt-1">

                  {/* Step 2 header */}
                  <div className="flex items-center gap-3 pb-1 border-b border-gray-100 dark:border-white/10">
                    <span className="w-7 h-7 rounded-full bg-[#7C3AED] text-white text-sm font-bold flex items-center justify-center flex-shrink-0 shadow-sm">2</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">MVP Art Director</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] font-medium">{shortMode ? '1080×1920' : '1280×720'}</span>
                      </div>
                      <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Designs a unique, viral thumbnail from your product & face</p>
                    </div>
                  </div>
                  {shortMode && (
                    <p className="rounded-lg border border-[#ff3b30]/20 bg-[#ff3b30]/[0.04] px-3 py-2 text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                      This is a Short, so MVP makes its thumbnail vertical (9:16, 1080×1920), the same shape as the Short. Text stays clear of the bottom, where YouTube puts the title and buttons.
                    </p>
                  )}

                  {/* Best-results tips — collapsible so it sets expectations
                      without cluttering the panel. Native <details>, no state. */}
                  <details className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 py-2 group">
                    <summary className="flex items-center gap-1.5 cursor-pointer list-none text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                      <Sparkles size={12} className="text-[#7C3AED]" />
                      How to get the most accurate thumbnails
                      <ChevronDown size={12} className="ml-auto text-[#86868b] transition-transform group-open:rotate-180" />
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1.5 text-[11px] leading-relaxed text-[#6e6e73] dark:text-[#ebebf0]">
                      <li><strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Train your face (optional).</strong> A few clear, well-lit photos from different angles — MVP renders your real likeness and auto-checks every thumbnail for a match. No face model? Choose &ldquo;No face&rdquo; for a product-only scene.</li>
                      <li><strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Describe the thumbnail you want.</strong> Use the box below to set the scene, mood, your pose or background — e.g. &ldquo;shocked face, bright kitchen, big arrow at the stain.&rdquo; The product photo is pulled from your Amazon link automatically — you don&apos;t need to upload one.</li>
                      <li><strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Headline is automatic.</strong> MVP writes the headline from the product itself. After it generates, you can edit the text or hit Regenerate.</li>
                      <li>Thumbnails are AI-generated, so glance at the variants and regenerate if one isn&apos;t quite right — it&apos;s normal to take a couple of tries.</li>
                    </ul>
                  </details>

                  {/* Face picker — who's in this video? Always shown so it never
                      silently disappears. It does NOT depend on SCOUT: a face model
                      is its own identity source (SCOUT is only needed to pull frames
                      from a PRIVATE video, not to use a saved face). With no trained
                      face, we explain where to add one instead of hiding the slot. */}
                  <div className="flex flex-col gap-2 px-1 pb-1">
                    <p className="text-[11px] font-semibold text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide">Who&apos;s in this video?</p>
                    {faceModels.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {/* Auto-detect removed: vision-matching on a video frame
                            guessed the wrong person. The creator picks explicitly;
                            the first face is pre-selected by default. */}
                        {faceModels.map(m => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setScoutFaceSelection(m.id)}
                            className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-all ${
                              scoutFaceSelection === m.id
                                ? 'bg-[#FF9500] text-white shadow-sm'
                                : 'bg-gray-100 dark:bg-white/10 text-[#86868b] dark:text-[#8e8e93] hover:bg-gray-200 dark:hover:bg-white/20'
                            }`}
                          >
                            {m.name}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setScoutFaceSelection('no-human')}
                          className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-all ${
                            scoutFaceSelection === 'no-human'
                              ? 'bg-[#3a3a3c] text-white shadow-sm'
                              : 'bg-gray-100 dark:bg-white/10 text-[#86868b] dark:text-[#8e8e93] hover:bg-gray-200 dark:hover:bg-white/20'
                          }`}
                        >
                          No face
                        </button>
                      </div>
                    ) : (
                      <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
                        No trained face yet — <a href="/photobooth" className="text-[#7C3AED] hover:underline font-medium">add your face</a> to put yourself on the thumbnail, or use <strong>Product Only</strong> below for a product-only scene.
                      </p>
                    )}

                    {/* Outfit lives in Fine-tune below (it needs typing). */}
                  </div>

                  {/* Quick style — one-tap toggles, zero typing. The AI writes the
                      badge and picks the accent word; Fine-tune below overrides. */}
                  <div className="flex flex-col gap-1.5 px-1">
                    <span className="text-[11px] font-semibold text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide">Quick style</span>
                    <div className="flex flex-wrap gap-1.5">
                      {([
                        ['question', 'Question hook', thumbQuestionMode, () => toggleThumbQuestion(!thumbQuestionMode), 'Headline becomes a curiosity question, with a matching expression'],
                        ['energy', 'Energy', thumbEffects, () => toggleThumbEffects(!thumbEffects), 'Speed lines, a streak on the product, a burst behind the title'],
                        ['badge', 'Badge', thumbAutoBadge, () => toggleThumbAutoBadge(!thumbAutoBadge), 'A starburst badge with a real benefit, written for you'],
                        ['accent', 'Red accent', thumbAutoAccent, () => toggleThumbAutoAccent(!thumbAutoAccent), 'One headline word pops in red'],
                        ['wear', 'Wear it', thumbWear, () => setThumbWear(!thumbWear), 'Clothing, shoes, watches, bags and glasses go ON you instead of being held up beside you. Nothing changes for a product nobody wears.'],
                      ] as Array<[string, string, boolean, () => void, string]>).map(([k, label, on, toggle, tip]) => (
                        <button key={k} type="button" disabled={generatingThumbnail} onClick={toggle} title={tip}
                          className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all disabled:opacity-60 ${
                            on ? 'bg-[#7C3AED] text-white shadow-sm' : 'bg-gray-100 dark:bg-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:bg-gray-200 dark:hover:bg-white/20'
                          }`}>
                          {on ? '✓ ' : ''}{label}
                        </button>
                      ))}
                    </div>
                    {/* The face itself. The chips above change the design; this
                        changes the person in it, which is the one thing a
                        creator could never steer before. */}
                    <div className="mt-2.5">
                      <ExpressionPicker value={thumbExpression} onChange={setThumbExpression} disabled={generatingThumbnail} compact />
                    </div>
                  </div>

                  {/* Match a look — compact: saved looks as chips + one upload chip.
                      Tap a look and MVP copies its palette, lighting and typography. */}
                  <div className="flex flex-col gap-1.5 px-1">
                    <span className="text-[11px] font-semibold text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide">Match a look</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {savedStyles.map(s => (
                        <span key={s.id} className="inline-flex items-center">
                          <button type="button" disabled={generatingThumbnail} onClick={() => applyPreset(s.id, s.reference_url)} title={`Use the "${s.name}" look`}
                            className={`px-3 py-1.5 rounded-l-full text-[12px] font-semibold transition-all disabled:opacity-60 ${
                              loadedPresetId === s.id ? 'bg-[#7C3AED] text-white shadow-sm' : 'bg-gray-100 dark:bg-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:bg-gray-200 dark:hover:bg-white/20'
                            }`}>
                            {loadedPresetId === s.id ? '✓ ' : ''}{s.name}
                          </button>
                          <button type="button" disabled={generatingThumbnail} onClick={() => void deletePreset(s.id)} title="Delete this look"
                            className={`px-2 py-1.5 rounded-r-full text-[12px] leading-none transition-all disabled:opacity-60 ${
                              loadedPresetId === s.id ? 'bg-[#7C3AED]/80 text-white' : 'bg-gray-100 dark:bg-white/10 text-[#86868b] hover:text-[#ff3b30]'
                            }`}>×</button>
                        </span>
                      ))}
                      <label title="Upload a thumbnail you love and MVP copies its style"
                        className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full border border-dashed border-[#7C3AED] text-[#7C3AED] transition ${(styleRefUploading || generatingThumbnail) ? 'opacity-60' : 'hover:bg-[#7C3AED] hover:text-white cursor-pointer'}`}>
                        {styleRefUploading ? <><Loader2 size={12} className="animate-spin" /> Uploading…</> : '+ Upload a look'}
                        <input type="file" accept="image/*" className="hidden" disabled={styleRefUploading || generatingThumbnail}
                          onChange={e => { const f = e.target.files?.[0]; if (f) void handleStyleReferenceUpload(f); e.currentTarget.value = '' }} />
                      </label>
                      {styleReferenceUrl && (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={styleReferenceUrl} alt="Style reference" className="h-8 w-14 object-cover rounded-md border border-gray-200 dark:border-white/10" />
                          {!loadedPresetId && (
                            <button type="button" disabled={savingPreset || generatingThumbnail} onClick={() => void saveCurrentAsPreset()}
                              className="text-[12px] font-semibold px-3 py-1.5 rounded-full text-white disabled:opacity-60" style={{ background: '#7C3AED' }}>
                              {savingPreset ? 'Saving…' : 'Save look'}
                            </button>
                          )}
                          <button type="button" disabled={generatingThumbnail} onClick={() => { setStyleReferenceUrl(null); setLoadedPresetId(null) }}
                            className="text-[12px] text-[#86868b] hover:text-[#ff3b30] disabled:opacity-60">Remove</button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Fine-tune — everything that needs typing lives here, collapsed
                      by default so the fast path above stays clean. */}
                  <details className="rounded-xl border border-gray-200 dark:border-white/10 px-3 py-2 mx-1 group">
                    <summary className="flex items-center gap-1.5 cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wide text-[#86868b] dark:text-[#8e8e93]">
                      Fine-tune <span className="normal-case font-normal tracking-normal text-[#a1a1a6]">(optional)</span>
                      <ChevronDown size={12} className="ml-auto text-[#86868b] transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="mt-3 flex flex-col gap-3">

                      {/* Pose */}
                      {scoutFaceSelection !== 'no-human' && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-semibold text-[#86868b] dark:text-[#8e8e93]">You with the product</span>
                          <div className="flex flex-wrap gap-1.5">
                            {([['auto', 'Auto'], ['hold', 'Hold it'], ['wear', 'Wear it'], ['use', 'Use it'], ['point', 'Point at it'], ['thumbs', 'Thumbs up']] as Array<[ThumbPose, string]>).map(([v, label]) => (
                              <button key={v} type="button" disabled={generatingThumbnail} onClick={() => pickThumbPose(v)}
                                className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-all disabled:opacity-60 ${
                                  thumbPose === v
                                    ? 'bg-[#FF9500] text-white shadow-sm'
                                    : 'bg-gray-100 dark:bg-white/10 text-[#86868b] dark:text-[#8e8e93] hover:bg-gray-200 dark:hover:bg-white/20'
                                }`}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Outfit — saved to the face, used everywhere. */}
                      {faceModels.length > 0 && scoutFaceSelection !== 'no-human' && (() => {
                        const activeId = (scoutFaceSelection !== 'auto' && faceModels.some(f => f.id === scoutFaceSelection))
                          ? scoutFaceSelection
                          : (faceModels[0]?.id || '')
                        const face = faceModels.find(f => f.id === activeId)
                        if (!face) return null
                        const draft = outfitDraft[activeId] ?? (face.outfit_pref || '')
                        return (
                          <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-semibold text-[#86868b] dark:text-[#8e8e93]">Outfit <span className="font-normal text-[#a1a1a6]">— saved to {face.name}</span></span>
                            <div className="flex items-center gap-2">
                              <input
                                value={draft}
                                onChange={e => setOutfitDraft(prev => ({ ...prev, [activeId]: e.target.value }))}
                                onBlur={() => { void saveFaceOutfit(activeId, draft) }}
                                placeholder="e.g. a white lab coat"
                                maxLength={120}
                                disabled={generatingThumbnail}
                                className="flex-1 h-8 px-2.5 text-[12px] rounded-lg border bg-white dark:bg-[#1c1c1e] border-[#d2d2d7] dark:border-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-[#FF9500] disabled:opacity-60"
                              />
                              {savingOutfit === activeId && <Loader2 size={13} className="animate-spin text-[#86868b]" />}
                            </div>
                          </label>
                        )
                      })()}

                      {/* Custom badge + accent word (override the auto toggles). */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] font-semibold text-[#86868b] dark:text-[#8e8e93]">Badge text <span className="font-normal text-[#a1a1a6]">— overrides auto</span></span>
                          <input value={thumbBadge} onChange={e => setThumbBadge(e.target.value)} maxLength={18} disabled={generatingThumbnail}
                            placeholder="e.g. MAX POWER!"
                            className="h-8 px-2.5 text-[12px] rounded-lg border bg-white dark:bg-[#1c1c1e] border-[#d2d2d7] dark:border-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-[#7C3AED] disabled:opacity-60" />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] font-semibold text-[#86868b] dark:text-[#8e8e93]">Red word <span className="font-normal text-[#a1a1a6]">— overrides auto</span></span>
                          <input value={thumbAccentWord} onChange={e => setThumbAccentWord(e.target.value)} maxLength={24} disabled={generatingThumbnail}
                            placeholder="e.g. STRONG"
                            className="h-8 px-2.5 text-[12px] rounded-lg border bg-white dark:bg-[#1c1c1e] border-[#d2d2d7] dark:border-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-[#7C3AED] disabled:opacity-60" />
                        </label>
                      </div>

                      {/* Describe your thumbnail — free-text scene direction. */}
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-[#86868b] dark:text-[#8e8e93]">Describe the scene <span className="font-normal text-[#a1a1a6]">— pose, mood, background</span></span>
                        <textarea
                          id="scene-prompt"
                          value={scenePrompt}
                          onChange={e => setScenePrompt(e.target.value.slice(0, 400))}
                          disabled={generatingThumbnail}
                          rows={2}
                          placeholder="e.g. me holding the bottle, shocked face, bright kitchen, big arrow at the stain"
                          className="w-full text-xs px-3 py-2 rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#a1a1a6] focus:outline-none focus:border-[#7C3AED] transition resize-none disabled:opacity-60"
                        />
                      </label>
                      <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">
                        Your face and the real product always stay accurate. Pose, Energy, Badge and Red accent are remembered for next time.
                      </p>
                    </div>
                  </details>

                  {/* "Describe the scene" now lives inside Fine-tune above. */}

                  {/* Product link. When the video already has a detected product we
                      DON'T ask again — the detected ASIN is passed to the generator
                      automatically. We just confirm it, and tuck the paste box behind
                      a toggle for the rare case the creator wants a different product.
                      When nothing was detected, the paste box is shown outright. */}
                  <div className="flex flex-col gap-1.5 px-1">
                    {cardAsin && !overrideProduct ? (
                      <>
                        <span className="text-[11px] font-semibold text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide">Product</span>
                        <div className="flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e]">
                          <span className="text-[#1d1d1f] dark:text-[#f5f5f7]">Using detected product <span className="font-mono">{cardAsin}</span></span>
                          <button type="button" disabled={generatingThumbnail}
                            onClick={() => setOverrideProduct(true)}
                            className="text-[11px] font-medium text-[#7C3AED] hover:underline whitespace-nowrap disabled:opacity-50">
                            Use a different product
                          </button>
                        </div>
                        <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">
                          The thumbnail renders this exact product. It came from your video, so there&apos;s nothing to paste.
                        </p>
                      </>
                    ) : (
                      <>
                        <label htmlFor="product-url" className="text-[11px] font-semibold text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide">
                          Product link <span className="font-normal normal-case tracking-normal text-[#a1a1a6]">{cardAsin ? '(override)' : '(optional — recommended)'}</span>
                        </label>
                        <input
                          id="product-url"
                          type="url"
                          value={productUrl}
                          onChange={e => setProductUrl(e.target.value.slice(0, 500))}
                          disabled={generatingThumbnail}
                          placeholder="Paste the Amazon or product link for this video"
                          className="w-full text-xs px-3 py-2 rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#a1a1a6] focus:outline-none focus:border-[#7C3AED] transition"
                        />
                        <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">
                          {cardAsin
                            ? <>Overrides the detected product (<span className="font-mono">{cardAsin}</span>). Leave blank to keep it. <button type="button" onClick={() => { setProductUrl(''); setOverrideProduct(false) }} className="text-[#7C3AED] hover:underline">Cancel</button></>
                            : 'MVP auto-detects the product from your video. Paste the link to be 100% sure it renders the exact product.'}
                        </p>
                      </>
                    )}
                  </div>

                  {/* ALREADY MADE FOR THIS PRODUCT: the image, where and when it
                      was made, and Use it. Never swapped in silently, and the
                      generate button below still makes a new one. */}
                  {recalledThumb.saved && (
                    <SavedProductImage
                      saved={recalledThumb.saved}
                      inUse={thumbnailUrl === recalledThumb.saved.imageUrl}
                      onUse={() => {
                        const img = recalledThumb.saved
                        if (!img) return
                        setThumbnailUrl(img.imageUrl)
                        setThumbnailVariants([])
                        setThumbnailPrompt(null)
                        setThumbnailHook(null)
                        setThumbnailModel('recalled')
                        setThumbnailError(null)
                      }}
                      onReplace={() => { setThumbnailUrl(null); setThumbnailModel(null) }}
                      replaceLabel="Don't use it"
                      keepLabel="press Create my MVP Thumbnail below for a new one"
                    />
                  )}

                  {/* Primary CTA: Create my MVP Thumbnail — order-1 so this big
                      generate button sits BELOW the method/border/badge options
                      (all order-0). The generator is the last thing you touch. */}
                  <div className="flex flex-col gap-2 order-1">

                    {extensionInstalled === false ? (
                      /* Extension not installed — show install prompt as primary CTA */
                      <div className="rounded-2xl border-2 border-[#FF9500] overflow-hidden shadow-md"
                        style={{ background: 'linear-gradient(135deg, rgba(255,149,0,0.12) 0%, rgba(255,107,0,0.07) 100%)' }}>
                        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
                          <div className="w-12 h-12 rounded-xl bg-[#FF9500]/20 flex items-center justify-center flex-shrink-0">
                            <Download size={22} className="text-[#FF9500]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="text-sm font-bold text-[#FF9500]">Install the SCOUT Extension</p>
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#FF9500] text-white uppercase tracking-wide flex-shrink-0">Recommended</span>
                            </div>
                            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Captures real frames from your video automatically</p>
                          </div>
                        </div>
                        <div className="px-4 pb-3 space-y-1.5">
                          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">One click from the Chrome Web Store — Chrome installs it and keeps it updated automatically.</p>
                        </div>
                        <div className="px-4 pb-4 flex items-center gap-2">
                          <a
                            href={SCOUT_STORE_LISTING_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FF9500] text-white text-xs font-semibold hover:bg-[#e6860a] transition-colors"
                          >
                            <Download size={12} />
                            Add to Chrome
                          </a>
                          <button
                            type="button"
                            onClick={() => isExtensionAvailable().then(ok => setExtensionInstalled(ok))}
                            className="text-xs text-[#FF9500] hover:underline"
                          >
                            I installed it — check again
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Extension installed — primary generate button */
                      <button
                        type="button"
                        onClick={() => {
                          // Auto-generate: MVP picks the headline from the product
                          // page itself (like ChatGPT) — no pre-render pick modal.
                          // The result has an editable headline + Regenerate for tweaks.
                          generateThumbnail({ textMode: 'graphic' })
                        }}
                        disabled={generatingThumbnail || extensionInstalled === null}
                        className={`flex items-center gap-4 w-full px-5 py-5 rounded-2xl text-left transition-all shadow-md hover:shadow-lg hover:scale-[1.01] active:scale-[0.99] ${generatingThumbnail ? 'opacity-80 cursor-not-allowed' : ''}`}
                        style={{ background: 'linear-gradient(135deg, #FF9500 0%, #FF6B00 100%)', border: '2px solid transparent' }}
                      >
                        <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                          {generatingThumbnail ? <Loader2 size={22} className="text-white animate-spin" /> : <Sparkles size={22} className="text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-base font-bold text-white">Create my MVP Thumbnail</p>
                          </div>
                          <p className="text-xs text-white/75">
                            {generatingThumbnail ? (thumbnailStatus || 'Starting…') : extensionInstalled === null ? 'Checking for extension…' : 'Captures your video frames automatically'}
                          </p>
                        </div>
                        {extensionInstalled && !generatingThumbnail && (
                          <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-white/20 text-white flex-shrink-0">SCOUT ✓</span>
                        )}
                      </button>
                    )}

                    {/* Thumbnail error */}
                    {thumbnailError && (
                      <div className="flex items-start gap-2 rounded-lg bg-[#ff3b30]/10 border border-[#ff3b30]/30 px-3 py-2.5">
                        <span className="text-[#ff3b30] text-sm flex-shrink-0 mt-0.5">⚠</span>
                        <p className="text-xs text-[#ff3b30] leading-relaxed flex-1 min-w-0 break-words">{thumbnailError}</p>
                        <button type="button" onClick={() => setThumbnailError(null)} className="text-[#ff3b30]/50 hover:text-[#ff3b30] flex-shrink-0 text-lg leading-none">×</button>
                      </div>
                    )}

                  </div>

                  {/* Divider — options that feed the generate button below */}
                  <div className="flex items-center gap-3 my-1">
                    <div className="flex-1 h-px bg-gray-200 dark:bg-white/10" />
                    <span className="text-[11px] text-[#86868b] dark:text-[#8e8e93] font-medium whitespace-nowrap">thumbnail options</span>
                    <div className="flex-1 h-px bg-gray-200 dark:bg-white/10" />
                  </div>

                  {/* Secondary options */}
                  <div className="flex flex-col gap-2">

                    {/* Upload Selfie — REMOVED 2026-06-27. The image-edit (Kontext)
                        path could distort the creator's identity and invent a
                        wrong product; the normal thumbnail flow is reliable, so we
                        pulled the entry point. Backend PATH U in generate-thumbnail
                        stays intact to revisit if a faithful edit model lands. */}

                    {/* Upload My Design */}
                    <button
                      type="button"
                      onClick={() => setThumbnailMode(m => m === 'own-design' ? null : 'own-design')}
                      className={`flex items-center gap-3 w-full px-3 py-3 rounded-xl border text-left transition-all ${thumbnailMode === 'own-design' ? 'border-[#5856d6] bg-[#5856d6]/5' : 'border-gray-200 dark:border-white/10 hover:border-[#5856d6]/50 bg-white dark:bg-[#1c1c1e]'}`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-[#5856d6]/10 flex items-center justify-center flex-shrink-0">
                        <Image size={15} className="text-[#5856d6]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Upload My Design</p>
                        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">Use your own finished thumbnail</p>
                      </div>
                      <ChevronDown size={13} className={`flex-shrink-0 text-[#86868b] transition-transform ${thumbnailMode === 'own-design' ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Product Only */}
                    <button
                      type="button"
                      onClick={() => setThumbnailMode(m => m === 'product-only' ? null : 'product-only')}
                      className={`flex items-center gap-3 w-full px-3 py-3 rounded-xl border text-left transition-all ${thumbnailMode === 'product-only' ? 'border-[#34c759] bg-[#34c759]/5' : 'border-gray-200 dark:border-white/10 hover:border-[#34c759]/50 bg-white dark:bg-[#1c1c1e]'}`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-[#34c759]/10 flex items-center justify-center flex-shrink-0">
                        <Package size={15} className="text-[#34c759]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Product Only</p>
                        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">No photo needed — product scene</p>
                      </div>
                      <ChevronDown size={13} className={`flex-shrink-0 text-[#86868b] transition-transform ${thumbnailMode === 'product-only' ? 'rotate-180' : ''}`} />
                    </button>

                  </div>

                  {/* Inline expand: Upload Selfie — REMOVED 2026-06-27 (see the
                      button comment above). */}

                  {/* Inline expand: Upload My Design */}
                  {thumbnailMode === 'own-design' && (
                    <div className="flex flex-col gap-3 p-4 rounded-xl bg-[#5856d6]/5 border border-[#5856d6]/20">
                      <p className="text-[11px] font-semibold text-[#5856d6]">Upload your finished thumbnail design</p>
                      {thumbnailUrl && thumbnailModel === 'upload' ? (
                        <div className="flex flex-col gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={thumbnailUrl} alt="Your design" className="w-full rounded-lg border border-[#5856d6]/30" style={{ aspectRatio: '16/9' }} />
                          <label className="flex items-center justify-center gap-1.5 py-2 rounded-lg border-2 border-dashed border-[#5856d6]/40 hover:border-[#5856d6] cursor-pointer text-xs text-[#5856d6] transition-all">
                            <input type="file" accept="image/jpeg,image/png,image/gif,image/bmp" className="hidden" disabled={generatingThumbnail}
                              onChange={e => { const f = e.target.files?.[0]; if (f) handleThumbnailUpload(f); e.target.value = '' }} />
                            <Upload size={11} /> Replace design
                          </label>
                        </div>
                      ) : (
                        <label className={`flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed cursor-pointer transition-all ${generatingThumbnail ? 'opacity-60 cursor-not-allowed border-[#5856d6]/20' : 'border-[#5856d6]/40 hover:border-[#5856d6] hover:bg-[#5856d6]/5'}`}>
                          <input type="file" accept="image/jpeg,image/png,image/gif,image/bmp" className="hidden" disabled={generatingThumbnail}
                            onChange={e => { const f = e.target.files?.[0]; if (f) handleThumbnailUpload(f); e.target.value = '' }} />
                          <Upload size={20} className="text-[#5856d6]" />
                          <span className="text-xs font-medium text-[#5856d6]">Drop or click to upload</span>
                          <span className="text-[10px] text-[#86868b]">JPG, PNG · 1280×720</span>
                        </label>
                      )}
                    </div>
                  )}

                  {/* Inline expand: Product Only */}
                  {thumbnailMode === 'product-only' && (
                    <div className="flex flex-col gap-3 p-4 rounded-xl bg-[#34c759]/5 border border-[#34c759]/20">
                      <p className="text-[11px] font-semibold text-[#34c759]">Product scene — no face needed</p>
                      <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0]">MVP places your product in a professional scene with your video title.</p>
                      <button
                        onClick={() => {
                          setSelectedFaceModelId('no-human')
                          // Auto-generate on gpt-image (graphic engine, no face) —
                          // a gorgeous product-hero scene; headline from the product.
                          generateThumbnail({ textMode: 'graphic', noHuman: true })
                        }}
                        disabled={generatingThumbnail}
                        className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all hover:opacity-90"
                        style={{ background: 'linear-gradient(135deg, #34c759 0%, #30d158 100%)' }}
                      >
                        {generatingThumbnail ? <><Loader2 size={13} className="animate-spin" /> Generating…</> : <><Sparkles size={13} /> Generate Product Thumbnail</>}
                      </button>
                    </div>
                  )}


                  {/* Border style + badge dropdowns removed: gpt-image composes the
                      full design (border, badge, arrow) itself, so these manual
                      controls are no longer needed. Defaults (borderIndex=null,
                      badge='none') are kept in state and the backend relies on the
                      model's own styling. */}

                  {/* BrandStylePanel mounted hidden — fires its saved-defaults useEffect on mount */}
                  <div className="hidden">
                    <BrandStylePanel
                      faceModels={faceModels}
                      selectedFaceModelId={selectedFaceModelId}
                      setSelectedFaceModelId={setSelectedFaceModelId}
                      borderIndex={borderIndex}
                      setBorderIndex={setBorderIndex}
                      accentColor={accentColor}
                      setAccentColor={setAccentColor}
                      setNoCheck={setNoCheck}
                      setDecoration={setBadge}
                      disabled={generatingThumbnail}
                    />
                  </div>

                  {/* Result — order-2 so the preview renders below the generate button. */}
                  {thumbnailUrl && (
                    <div className="flex flex-col gap-2 order-2">
                      <div className="rounded-xl overflow-hidden border border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-white/5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={thumbnailUrl} alt="Generated thumbnail" className="w-full object-cover" style={{ aspectRatio: '16/9' }} />
                      </div>
                      {/* Whether this image is now filed against the product.
                          Without this line a save that failed looks exactly
                          like one that worked, and the only place you would
                          find out is the Deals Hub a week later. */}
                      {effectiveAsin && savedProductImage === 'saved' && (
                        <span className="text-[11px] text-[#86868b]">
                          Saved for <span className="font-mono">{effectiveAsin}</span>. Deals Hub, Facebook and Pinterest will offer this image for this product.
                        </span>
                      )}
                      {effectiveAsin && savedProductImage === 'failed' && (
                        <span className="text-[11px] text-[#b91c1c] dark:text-[#f87171]">
                          Couldn&apos;t save this for <span className="font-mono">{effectiveAsin}</span>. Other tools won&apos;t offer it for this product. Your thumbnail here is unaffected.
                        </span>
                      )}
                      {!effectiveAsin && (
                        <span className="text-[11px] text-[#86868b]">
                          No product on this video, so this image isn&apos;t saved for reuse. Paste the Amazon link under Product link to file it against an ASIN.
                        </span>
                      )}
                      {titleOptions.length > 1 && titleOverlayCtx && (
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[11px] text-[#86868b]">Pick a title{retitling ? ' · applying…' : ''}</span>
                          <div className="flex flex-wrap gap-1.5">
                            {titleOptions.map((t, i) => (
                              <button key={i} onClick={() => selectTitle(i)} disabled={retitling}
                                className={`text-[11px] px-2.5 py-1 rounded-md border font-semibold transition disabled:opacity-60 ${i === selectedTitleIdx ? 'bg-[#7C3AED] border-[#7C3AED] text-white' : 'border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#7C3AED]'}`}>
                                {t}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {thumbnailVariants.length > 1 && (
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[11px] text-[#86868b]">Compare variants (★ = best CTR)</span>
                          <div className="grid grid-cols-3 gap-1.5">
                            {thumbnailVariants.map((v, i) => {
                              const sel = v.url === thumbnailUrl
                              return (
                                <button key={v.url} onClick={() => { setThumbnailUrl(v.url); setThumbnailFeedbackSent(null) }}
                                  className={`relative rounded-lg overflow-hidden border-2 transition ${sel ? 'border-[#7C3AED]' : 'border-transparent hover:border-gray-300 dark:hover:border-white/20'}`}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={v.url} alt={`Variant ${i + 1}`} className="w-full object-cover" style={{ aspectRatio: '16/9' }} />
                                  <span className="absolute top-1 left-1 text-[9px] px-1.5 py-0.5 rounded-full bg-black/60 text-white font-semibold">
                                    {i === 0 ? '★ ' : ''}{v.score !== null ? `${v.score}` : `#${i + 1}`}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        {thumbnailUrl.startsWith('data:') ? (
                          <a href={thumbnailUrl} download="thumbnail.jpg"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
                            style={{ background: '#34c759' }}>
                            <Download size={12} /> Download
                          </a>
                        ) : (
                          <a href={thumbnailUrl} download="thumbnail.jpg" target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
                            style={{ background: '#34c759' }}>
                            <Download size={12} /> Download
                          </a>
                        )}
                        {thumbnailFaceUsed && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] font-medium">👤 {thumbnailFaceUsed}</span>
                        )}
                        {/* No regenerate / custom-title controls on the gpt-image result:
                            every regeneration costs a full image, and MVP should land it on
                            the first try. Download it, or start a new generation. */}
                        {/* The engine-swap buttons that lived here ("Baked text",
                            "Crisp text", "Graphic") only rendered on a nano-banana
                            result, and the routes that produced one were removed when
                            gpt-image became the only engine. They could not be reached:
                            the sole way to a nano-banana result was a path only a
                            nano-banana result could open. Same for the kontext /
                            ideogram / flux "Scene (fallback)" badge. */}
                      </div>
                      {thumbnailModel !== 'upload' && (
                        <div className="flex items-center gap-2 pt-1">
                          <span className="text-[10px] text-[#86868b]">Train the AI:</span>
                          <button onClick={() => submitYtThumbnailFeedback('like')} disabled={thumbnailFeedbackSent !== null}
                            className={`text-[11px] px-2 py-0.5 rounded border transition ${thumbnailFeedbackSent === 'like' ? 'bg-[#34c759]/20 border-[#34c759] text-[#34c759]' : 'border-gray-200 dark:border-white/10 hover:border-[#34c759]'} disabled:opacity-60`}>
                            👍
                          </button>
                          <button onClick={() => submitYtThumbnailFeedback('dislike')} disabled={thumbnailFeedbackSent !== null}
                            className={`text-[11px] px-2 py-0.5 rounded border transition ${thumbnailFeedbackSent === 'dislike' ? 'bg-[#ff3b30]/20 border-[#ff3b30] text-[#ff3b30]' : 'border-gray-200 dark:border-white/10 hover:border-[#ff3b30]'} disabled:opacity-60`}>
                            👎
                          </button>
                          {thumbnailFeedbackSent && (
                            <span className="text-[10px] text-[#86868b]">Thanks — saved.</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                </div> {/* ── end Step 2 ── */}

              </div> {/* ── end stacked steps 1–2 ── */}

              {/* ── Step 3: Pinned Comment ── */}
              <div className="flex flex-col gap-3 pt-1">
                <div className="flex items-center gap-3 pb-1 border-b border-gray-100 dark:border-white/10">
                  <span className="w-7 h-7 rounded-full bg-[#ff9500]/15 border border-[#ff9500]/40 text-[#ff9500] text-sm font-bold flex items-center justify-center flex-shrink-0">3</span>
                  <div>
                    <p className="text-sm font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Pinned Comment <span className="text-[11px] font-normal text-[#86868b]">— optional</span></p>
                    <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
                      {canFirstComment
                        ? 'MVP posts this as the first comment the moment the video is public, and SCOUT pins it for you.'
                        : "YouTube's API can't pin — copy & paste this after your video goes live"}
                    </p>
                  </div>
                </div>
                {canFirstComment && (
                  <div className="rounded-xl border border-[#ff9500]/30 bg-white dark:bg-[#1c1c1e] px-4 py-3 text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {!firstComment ? (
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={firstCommentOn} onChange={(e) => setFirstCommentOn(e.target.checked)} className="accent-[#ff9500]" />
                        <span><b>Post and pin it for me</b> when I push to YouTube. A scheduled or private video gets it the moment it goes public.</span>
                      </label>
                    ) : firstComment.state === 'sending' ? (
                      <span className="flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Queuing the first comment…</span>
                    ) : firstComment.state === 'waiting' ? (
                      <span>Queued. The video is not public yet, so MVP posts the comment {firstComment.publishAt ? `when it goes live (${new Date(firstComment.publishAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})` : 'the moment it goes public'}. Open Co-Pilot afterwards and SCOUT pins it.</span>
                    ) : firstComment.state === 'posted' ? (
                      firstComment.already
                        ? <span className="text-[#34c759] font-semibold">This video already has its first comment from MVP, so no second one was posted.</span>
                        : firstComment.pinned === true
                          ? <span className="text-[#34c759] font-semibold">Posted and pinned. SCOUT saw it pinned on the video.</span>
                          : firstComment.pinned === false
                            ? <span><span className="text-[#34c759] font-semibold">Posted.</span> <span className="text-[#ff9500]">Not pinned: {firstComment.pinError}</span></span>
                            : <span className="flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Posted. SCOUT is pinning it…</span>
                    ) : (
                      <span className="text-[#ff3b30]">Not posted: {firstComment.error}</span>
                    )}
                  </div>
                )}
                {/* Collapsed by default — expand only if you want to use it. */}
                <details className="rounded-xl border border-[#ff9500]/30 bg-[#ff9500]/5 group">
                  <summary className="flex items-center gap-2 cursor-pointer list-none p-4 text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                    <ChevronDown size={14} className="text-[#ff9500] transition-transform group-open:rotate-180" />
                    View suggested pinned comment
                    <button
                      onClick={(e) => { e.preventDefault(); copy(generated.pinnedComment, 'pin') }}
                      className="ml-auto text-[10px] text-[#7C3AED] hover:underline flex items-center gap-0.5"
                    >
                      <Copy size={10} /> {copied === 'pin' ? 'Copied!' : 'Copy'}
                    </button>
                  </summary>
                  <div className="px-4 pb-4">
                    <div className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] p-3 rounded-lg bg-white dark:bg-[#1c1c1e] border border-[#d2d2d7] dark:border-[#3a3a3c] leading-relaxed">
                      {generated.pinnedComment}
                    </div>
                    <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-2">After the video is public: post this as a comment, then click the three-dot menu → <strong>Pin</strong>.</p>
                  </div>
                </details>
              </div>

              {/* Pro batch-apply settings panel — Pro/admin only */}
              {isPro && (
                <div className="border border-[#7C3AED]/20 bg-[#7C3AED]/5 rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-3 pb-1 border-b border-[#7C3AED]/10">
                    <span className="w-7 h-7 rounded-full bg-[#7C3AED] text-white text-sm font-bold flex items-center justify-center flex-shrink-0 shadow-sm">4</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Studio Settings</p>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#7C3AED] text-white font-semibold uppercase tracking-wide">Pro</span>
                      </div>
                      <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Playlist, visibility, schedule & notification</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Playlist */}
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-[#6e6e73] dark:text-[#ebebf0] font-medium">Add to playlist</span>
                      <select
                        value={proSettings.playlistId ?? ''}
                        onChange={e => setProSettings(s => ({ ...s, playlistId: e.target.value || null }))}
                        className="px-2 py-1.5 rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                      >
                        <option value="">— None —</option>
                        {playlists.map(p => (
                          <option key={p.id} value={p.id}>{p.title}</option>
                        ))}
                      </select>
                    </label>

                    {/* Visibility */}
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-[#6e6e73] dark:text-[#ebebf0] font-medium">Visibility</span>
                      <select
                        value={proSettings.privacyStatus}
                        onChange={e => setProSettings(s => ({ ...s, privacyStatus: e.target.value as ProPublishSettings['privacyStatus'] }))}
                        className="px-2 py-1.5 rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                        disabled={proSettings.scheduleMode !== 'now'}
                      >
                        <option value="draft">Save as draft (don&apos;t publish)</option>
                        <option value="public">Public</option>
                        <option value="unlisted">Unlisted</option>
                        <option value="private">Private</option>
                      </select>
                    </label>

                    {/* Schedule — reachable straight from the default draft state.
                        Picking anything other than "now" schedules the video
                        (private until then); Visibility above is disabled while a
                        schedule is set. */}
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-[#6e6e73] dark:text-[#ebebf0] font-medium">Schedule</span>
                      <select
                        value={proSettings.scheduleMode}
                        onChange={e => setProSettings(s => ({ ...s, scheduleMode: e.target.value as ProPublishSettings['scheduleMode'] }))}
                        className="px-2 py-1.5 rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                      >
                        <option value="now">Don&apos;t schedule</option>
                        <option value="custom">Pick a date &amp; time…</option>
                        <option value="in1h">In 1 hour</option>
                        <option value="in6h">In 6 hours</option>
                        <option value="in24h">In 24 hours</option>
                      </select>
                      {proSettings.scheduleMode === 'custom' && (
                        <input
                          type="datetime-local"
                          value={proSettings.scheduleAt}
                          min={localDatetimeMin()}
                          onChange={e => setProSettings(s => ({ ...s, scheduleAt: e.target.value }))}
                          className="mt-1 px-2 py-1.5 rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                        />
                      )}
                      {proSettings.scheduleMode !== 'now' && (
                        <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">YouTube auto-publishes it then (public). It stays private until then.</span>
                      )}
                    </label>
                  </div>

                  {/* Toggles. Paid promotion + altered content are NOT here —
                      YouTube's API doesn't accept those fields. They appear
                      in the post-apply "Finish in Studio (3 clicks)" callout
                      below the Apply button instead. */}
                  <div className="flex flex-col gap-1.5 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={proSettings.madeForKids}
                        onChange={e => setProSettings(s => ({ ...s, madeForKids: e.target.checked }))}
                      />
                      <span className="text-[#1d1d1f] dark:text-[#f5f5f7]">Made for kids</span>
                    </label>
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <span className="text-[#1d1d1f] dark:text-[#f5f5f7]">Notify subscribers when this goes public?</span>
                      <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                        {([['Yes', true], ['No', false]] as const).map(([lbl, val]) => (
                          <button
                            key={lbl}
                            type="button"
                            onClick={() => setProSettings(s => ({ ...s, notifySubscribers: val }))}
                            className={`px-3 py-1 text-[11px] font-semibold transition-colors ${proSettings.notifySubscribers === val ? 'bg-[#7C3AED] text-white' : 'text-[#6e6e73] dark:text-[#a1a1a6] hover:bg-black/5 dark:hover:bg-white/10'}`}
                          >
                            {lbl}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] -mt-0.5">Sent to YouTube either way. For a video that is already uploaded, YouTube only promises to honour it through Studio&apos;s own box, which SCOUT sets when it finishes the video in Studio.</p>
                  </div>

                  {/* NOTHING TO TICK. The creator asked never to have to finish a
                      video in Studio: paid promotion and AI use go through
                      YouTube's API on every push (read back, and nothing goes
                      out without them), and SCOUT does the Studio-only steps
                      by itself whenever it is installed. This only says what
                      will happen. */}
                  <div className="rounded-xl border border-[#7C3AED]/25 bg-[#7C3AED]/[0.04] px-3.5 py-3 flex flex-col gap-1.5">
                    <span className="text-xs font-bold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-1.5">
                      <Sparkles size={12} className="text-[#7C3AED] flex-shrink-0" /> Every YouTube setting, done for you
                    </span>
                    <span className="text-[11px] text-[#6e6e73] dark:text-[#8e8e93] leading-relaxed">
                      <strong>Paid promotion: Yes</strong> and <strong>AI use: No</strong> are set through YouTube and read back. Nothing is scheduled or made public until paid promotion reads back as Yes.
                    </span>
                    {extensionInstalled === true ? (
                      <span className="text-[11px] text-[#6e6e73] dark:text-[#8e8e93] leading-relaxed">
                        Then SCOUT does the rest in Studio in your own browser, and reads each one back: <strong>monetization On</strong>, the <strong>ad suitability rating</strong>, the <strong>product tag</strong>{hasProductLink ? '' : ' (when a product is found)'} and the <strong>end screen</strong> from your latest video.
                        {' '}Then {proSettings.scheduleMode !== 'now' ? 'the schedule you picked' : proSettings.privacyStatus === 'draft' ? 'it stays a draft, as you chose' : `it is set to ${proSettings.privacyStatus}`}. Notify subscribers: {proSettings.notifySubscribers ? 'Yes' : 'No'}.
                      </span>
                    ) : (
                      <span className="text-[11px] text-[#ff9500] leading-relaxed">
                        Monetization, the ad rating, the product tag and the end screen need SCOUT, which is not installed in this browser.{' '}
                        <a href={SCOUT_STORE_LISTING_URL} target="_blank" rel="noopener noreferrer" className="underline font-semibold">Add SCOUT to Chrome</a> and MVP does them for you on the next push.
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-2">
                <div className="flex items-center gap-3">
                  {(() => {
                    const scheduling = proSettings.scheduleMode !== 'now'
                    const draft = proSettings.privacyStatus === 'draft' && !scheduling
                    // When Pro opts SCOUT in, this one button pushes THEN finishes
                    // in Studio — so the label + spinner cover both phases.
                    const willFinish = isPro && extensionInstalled === true && finishOptIn && anyFinishStep
                    const busySuffix = willFinish ? ' + Studio steps…' : '…'
                    const idleSuffix = ''
                    // SENT IS NOT SCHEDULED: with SCOUT finishing, the time is set
                    // after it, and only says so once it is. Without SCOUT the
                    // push sets it, unless paid promotion did not read back.
                    const held = applied && (willFinish ? statusOutcome !== 'set' : statusOutcome === 'held')
                    const verb = (busyBase: string, done: string, idleBase: string) =>
                      held && !draft ? (finishRunning ? 'Sent, SCOUT is in Studio…' : statusOutcome === 'held' ? (scheduling ? 'Sent, NOT scheduled (see below)' : 'Sent, visibility NOT set (see below)') : 'Sent to YouTube')
                      : scheduling ? (applying ? `Scheduling${busySuffix}` : applied ? 'Scheduled on YouTube' : `Schedule on YouTube${idleSuffix}`)
                        : draft ? (applying ? `Saving draft${busySuffix}` : applied ? 'Saved to Draft' : `Save Draft to YouTube${idleSuffix}`)
                          : (applying ? `${busyBase}${busySuffix}` : applied ? done : `${idleBase}${idleSuffix}`)
                    return (
                      <button
                        onClick={applyToYouTube}
                        disabled={applying || applied || scheduleNeedsDate || finishRunning}
                        title={scheduleNeedsDate ? 'Pick a future date & time first' : undefined}
                        className="flex items-center justify-center gap-2.5 flex-1 py-3.5 rounded-xl text-base font-bold text-white disabled:opacity-60 transition-all shadow-lg hover:opacity-90 active:scale-[0.98]"
                        style={{ background: applied ? (held && !draft && statusOutcome === 'held' ? '#d97706' : '#34c759') : 'linear-gradient(135deg, #ff0000 0%, #cc0000 100%)', boxShadow: applied ? undefined : '0 4px 14px rgba(255,0,0,0.35)' }}
                      >
                        {(applying || finishRunning) ? <Loader2 size={16} className="animate-spin" /> : applied ? <CheckCircle size={16} /> : <Youtube size={16} />}
                        {verb('Pushing to YouTube', 'Pushed to YouTube!', 'Push to YouTube')}
                      </button>
                    )
                  })()}
                  <button onClick={() => generate()} disabled={generating}
                    className="flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#7C3AED] transition-colors flex-shrink-0">
                    <RefreshCw size={11} /> Regenerate
                  </button>
                </div>
                {applyError && (
                  <p className="text-xs text-[#ff3b30] bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-lg px-3 py-2 break-all">
                    ❌ {applyError}
                  </p>
                )}

                {/* AFTER THE PUSH: what YouTube and Studio now show, and one
                    button to look. No checklist to do by hand: the creator's
                    rule is that nobody should have to finish a video in
                    Studio. What did not work is said, with Run SCOUT again. */}
                {applied && !finishCheckDone && (
                  <div className="rounded-xl border border-[#7C3AED]/25 bg-[#7C3AED]/[0.04] px-4 py-3 flex flex-col gap-3">
                    <div className="flex items-start gap-2">
                      <Youtube size={14} className="text-[#ff0000] mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">On YouTube now</p>
                        {/* READ BACK FROM YOUTUBE after the push, not what was
                            sent: ? means YouTube did not say. */}
                        {apiDisclosures?.asked && (() => {
                          // EITHER READ COUNTS. On a draft YouTube's API keeps
                          // answering No after the push; SCOUT then sets and
                          // reads the same boxes in Studio. A red cross over a
                          // box Studio shows ticked was the API's stale answer
                          // drawn as the result.
                          const studio = !!finishResult?.steps.find((st) => st.step === 'details' && st.ok)
                          const paid = apiDisclosures.paidPromotion === true || studio ? true : finishRunning ? null : apiDisclosures.paidPromotion
                          const ai = apiDisclosures.aiUseNo === true || studio ? true : null
                          const from = (api: boolean) => (api ? '' : studio ? ' (read back in Studio)' : '')
                          return (
                            <p className="text-[11px] flex flex-wrap gap-x-3 gap-y-0.5">
                              <span className={paid === true ? 'text-[#34c759]' : paid === false ? 'text-[#ff3b30]' : 'text-[#86868b]'}>
                                {paid === true ? '✓' : paid === false ? '✗' : '?'} Paid promotion: Yes{from(apiDisclosures.paidPromotion === true)}{paid === null && finishRunning ? ' (SCOUT is setting it in Studio)' : ''}
                              </span>
                              <span className={ai === true ? 'text-[#34c759]' : 'text-[#86868b]'}>
                                {ai === true ? '✓' : '?'} AI use: No{from(apiDisclosures.aiUseNo === true)}{ai === true ? '' : ' (SCOUT sets it in Studio)'}
                              </span>
                            </p>
                          )
                        })()}
                        {!isPro && (
                          <p className="text-[11px] text-[#ff9500] leading-relaxed">
                            Title, description, tags and thumbnail were sent. Paid promotion, AI use, the schedule and the Studio steps were not: those come with the Pro plan&apos;s one click push.
                          </p>
                        )}
                        {apiDisclosures?.error && (
                          <p className="text-[10px] text-[#ff9500] mt-0.5 break-words">YouTube said: {apiDisclosures.error}</p>
                        )}
                        {isPro && extensionInstalled !== true && (
                          <p className="text-[11px] text-[#ff9500] mt-1 leading-relaxed">
                            Monetization, the ad rating, the product tag and the end screen were not set: SCOUT is not installed in this browser.{' '}
                            <a href={SCOUT_STORE_LISTING_URL} target="_blank" rel="noopener noreferrer" className="underline font-semibold">Add SCOUT to Chrome</a>, then push again.
                          </p>
                        )}
                      </div>
                      <button
                        onClick={dismissFinish}
                        className="text-[10px] text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] flex-shrink-0"
                        title="Done: move this video to Metadata sent"
                      >
                        Dismiss
                      </button>
                    </div>

                    {extensionInstalled === true && (finishRunning || finishResult || finishError) && (
                      <div className="rounded-lg border border-[#7C3AED]/30 bg-[#7C3AED]/5 px-3 py-2.5 flex flex-col gap-2">
                        {finishRunning && (
                          <div className="flex items-center gap-2 text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                            <Loader2 size={12} className="animate-spin text-[#7C3AED]" />
                            <span>SCOUT is doing the Studio steps on this video…</span>
                          </div>
                        )}

                        {finishResult && (
                          <div className="flex flex-col gap-1 text-[11px]">
                            {/* WHAT STUDIO SHOWED, NOT WHAT WAS CLICKED. Each
                                line is SCOUT's own sentence, written after it
                                read the control back. Done, failed, not needed
                                and not reached each look different, so a run
                                that stopped at the disclosure cannot read as
                                one that went through. */}
                            <p className={`font-semibold ${finishResult.ok ? 'text-[#34c759]' : 'text-[#ff9500]'}`}>{studioRunHeadline(finishResult)}</p>
                            {studioPathNote(finishResult.path) && (
                              <p className="text-[10px] text-[#86868b]">{studioPathNote(finishResult.path)}</p>
                            )}
                            {finishResult.steps.filter(s => s.step !== 'next' || !s.ok).map((s, i) => {
                              const tone = studioStepTone(s)
                              const icon = tone === 'good' ? '✓' : tone === 'bad' ? '✗' : tone === 'note' ? 'ℹ' : '○'
                              const color = tone === 'good' ? 'text-[#34c759]' : tone === 'bad' ? 'text-[#ff3b30]' : tone === 'note' ? 'text-[#ff9500]' : 'text-[#86868b]'
                              return (
                                <div key={i} className="flex flex-col gap-0.5">
                                  <div className="flex items-start gap-1.5">
                                    <span className={color}>{icon}</span>
                                    <span className="text-[#1d1d1f] dark:text-[#f5f5f7]">
                                      <strong>{studioStepLabel(s.step)}</strong>: {studioStepText(s)}
                                    </span>
                                  </div>
                                  {/* Expose SCOUT's DOM debug map on a real miss so
                                      the layout it saw can be tuned to. */}
                                  {tone === 'bad' && s.debug && Object.keys(s.debug).length > 0 && (
                                    <details className="ml-5">
                                      <summary className="text-[10px] text-[#86868b] cursor-pointer select-none">Show what SCOUT saw</summary>
                                      {/* COPIED AS TEXT, whole: a screenshot of this box
                                          cuts it off at its scroll height. It holds the
                                          page's button and option labels, never a login. */}
                                      <button
                                        type="button"
                                        onClick={() => { void navigator.clipboard?.writeText(JSON.stringify({ step: s.step, detail: s.detail, saw: s.debug }, null, 1)).then(() => toast.success('Copied. Paste it to support.')).catch(() => toast.error('Could not copy. Select the text below instead.')) }}
                                        className="mt-1 text-[10px] font-semibold text-[#7C3AED] hover:underline"
                                      >
                                        Copy what SCOUT saw
                                      </button>
                                      <pre className="mt-1 text-[9px] leading-snug text-[#6e6e73] dark:text-[#a1a1a6] bg-black/5 dark:bg-white/5 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-40">{JSON.stringify(s.debug, null, 1)}</pre>
                                    </details>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                        {finishError && (
                          <div className="flex flex-col gap-1.5">
                            <p className="text-[11px] text-[#ff3b30] bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-lg px-2.5 py-1.5 break-words">
                              ❌ {finishError}
                            </p>
                            <button
                              onClick={() => void retryStudioFinish()}
                              disabled={finishRunning}
                              className="inline-flex items-center justify-center gap-1.5 self-start px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-50 transition-colors"
                            >
                              <RefreshCw size={11} /> Run SCOUT again
                            </button>
                          </div>
                        )}
                      </div>
                    )}


                    <a
                      href={`https://studio.youtube.com/video/${video.youtubeVideoId}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 self-start px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-[#ff0000] hover:bg-[#cc0000] transition-colors"
                    >
                      <Youtube size={11} /> See in YouTube Studio <ExternalLink size={10} />
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pre-generation headline prompt — pops when the user clicks
          Generate Thumbnail so they consciously decide whether to lock
          a headline before any AI work fires. */}
      {headlinePromptOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setHeadlinePromptOpen(false)}
        >
          <div
            className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-md w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
              Pick a thumbnail headline
            </h3>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
              Four product-specific options written for THIS video — pick the one you like, or write your own (max 5 words). This is the title MVP bakes onto your thumbnail.
            </p>

            <div className="flex flex-col gap-2 mb-4 max-h-[60vh] overflow-y-auto pr-1">
              {/* Loading — fires the moment the modal opens. */}
              {titleOptionsLoading && (
                <div className="flex items-center gap-2 text-xs text-[#6e6e73] dark:text-[#ebebf0] p-3 rounded-lg border border-dashed border-gray-200 dark:border-white/10">
                  <Loader2 size={14} className="animate-spin" />
                  <span>Reading the video and writing 4 title options…</span>
                </div>
              )}

              {/* Error — user can still write their own. */}
              {!titleOptionsLoading && titleOptionsError && (
                <div className="text-xs p-3 rounded-lg border border-[#ff9500]/30 bg-[#ff9500]/5 text-[#ff9500]">
                  Couldn&apos;t load MVP title options ({titleOptionsError}). You can still write your own below.
                </div>
              )}

              {/* The five product-specific options. Default-selected = index 0. */}
              {!titleOptionsLoading && pickerTitles.map((title, idx) => (
                <label
                  key={idx}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    headlinePromptChoice === idx
                      ? 'border-[#7C3AED] bg-[#7C3AED]/5'
                      : 'border-gray-200 dark:border-white/10 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="headline-choice"
                    checked={headlinePromptChoice === idx}
                    onChange={() => setHeadlinePromptChoice(idx)}
                    className="mt-1"
                  />
                  <p className="text-sm font-semibold uppercase tracking-wide text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {title}
                  </p>
                </label>
              ))}

              {/* Always-available "Write your own" — works even when the AI batch fails. */}
              <label
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  headlinePromptChoice === 'custom'
                    ? 'border-[#7C3AED] bg-[#7C3AED]/5'
                    : 'border-gray-200 dark:border-white/10 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="headline-choice"
                  checked={headlinePromptChoice === 'custom'}
                  onChange={() => setHeadlinePromptChoice('custom')}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Write my own</p>
                  <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 mb-2">
                    Type the exact text (max 5 words). This is what MVP bakes onto your thumbnail.
                  </p>
                  {headlinePromptChoice === 'custom' && (
                    <input
                      type="text"
                      value={customHeadline}
                      onChange={(e) => {
                        // Hard cap at 5 words — punchy thumbnails live on a few
                        // big words; keep a trailing space so typing flows.
                        const words = e.target.value.split(/\s+/).filter(Boolean)
                        setCustomHeadline(words.length > 5 ? words.slice(0, 5).join(' ') : e.target.value)
                      }}
                      placeholder="e.g. WORTH IT?"
                      maxLength={40}
                      autoFocus
                      className="w-full text-xs px-2.5 py-1.5 rounded-md bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] focus:border-[#7C3AED] focus:outline-none uppercase tracking-wide"
                    />
                  )}
                </div>
              </label>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => loadTitleOptions()}
                disabled={titleOptionsLoading}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#86868b] hover:text-[#7C3AED] disabled:opacity-60 transition-colors"
                title="Generate a fresh batch of 4 title options"
              >
                <RefreshCw size={11} className={titleOptionsLoading ? 'animate-spin' : ''} /> Regenerate
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setHeadlinePromptOpen(false)}
                  className="px-3 py-2 rounded-lg text-xs font-medium text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    // Resolve the chosen title LOCALLY and pass it directly to
                    // generateThumbnail — relying on setCustomHeadline + a
                    // setTimeout leaves a stale-state race where the route
                    // doesn't receive the headline and falls back to generic
                    // hooks. Still mirror the value to customHeadline so the
                    // input field reflects the pick on re-open.
                    let pickedHeadline = ''
                    if (typeof headlinePromptChoice === 'number') {
                      pickedHeadline = pickerTitles[headlinePromptChoice] || ''
                    } else if (headlinePromptChoice === 'custom') {
                      pickedHeadline = customHeadline.trim()
                    }
                    if (pickedHeadline) setCustomHeadline(pickedHeadline)
                    setHeadlinePromptOpen(false)
                    // Replay the path the user came from (MVP thumbnail or
                    // Product Only) with their chosen headline baked in.
                    setTimeout(() => { generateThumbnail({ ...pendingThumbOpts, lockedHeadline: pickedHeadline || undefined }) }, 0)
                  }}
                  disabled={
                    titleOptionsLoading ||
                    (headlinePromptChoice === 'custom' && customHeadline.trim().length === 0) ||
                    (typeof headlinePromptChoice === 'number' && !pickerTitles[headlinePromptChoice])
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Sparkles size={11} /> Start generation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <ConfirmHost />
    </div>
  )
}

export default function StudioPage() {
  const supabase = createBrowserClient()
  const [drafts, setDrafts] = useState<DraftVideo[]>([])
  // SHORT MODE (Labs): which listed videos YouTube says are Shorts.
  const [shortsMap, setShortsMap] = useState<Record<string, boolean | null>>({})
  const [loading, setLoading] = useState(true)
  // loadingMore = "Load more" button busy state; distinct from initial load
  // because we want to keep the existing list rendered while it spins.
  const [loadingMore, setLoadingMore] = useState(false)
  const [needsAuth, setNeedsAuth] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasGeniuslink, setHasGeniuslink] = useState(false)
  // Passport (MVP's own geo-routing) makes the Geniuslink nag irrelevant.
  const [passportEnabled, setPassportEnabled] = useState(false)
  const [userTier, setUserTier] = useState<Tier>('trial')
  // Ask YouTube which listed videos are Shorts, once each (Labs).
  useEffect(() => {
    if (!canUsePreview('shorts_mode', userTier)) return
    const ids = drafts.map((d) => d.youtubeVideoId).filter((id) => !(id in shortsMap)).slice(0, 200)
    if (ids.length === 0) return
    let alive = true
    fetch('/api/youtube/shorts-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return
        // Every asked id gets an answer (null when YouTube could not say), so it is not asked again.
        const got = (j?.shorts ?? {}) as Record<string, boolean | null>
        setShortsMap((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, got[id] ?? null])) }))
      })
      .catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, userTier])
  const [playlists, setPlaylists] = useState<Array<{ id: string; title: string }>>([])
  // Admin-only: read back the YouTube Studio save requests SCOUT captured, to
  // learn the real InnerTube disclosure/monetization/tag-product request shapes.
  const [ytRecipes, setYtRecipes] = useState<YtSaveRecipe[] | null>(null)
  const [ytRecipeLoading, setYtRecipeLoading] = useState(false)
  const [ytApplyVideoId, setYtApplyVideoId] = useState('')
  const [ytApplyResult, setYtApplyResult] = useState<{ ok: boolean; detail?: string; error?: string; debug?: Record<string, unknown> } | null>(null)
  const [ytApplyLoading, setYtApplyLoading] = useState(false)
  // Dev tools (Studio save capture + injection test) are hidden behind ?dev=1
  // so they don't clutter the page for normal Pro users. Set in an effect to
  // avoid an SSR/hydration mismatch reading window during render.
  const [devMode, setDevMode] = useState(false)
  useEffect(() => { try { setDevMode(new URLSearchParams(window.location.search).get('dev') === '1') } catch { /* noop */ } }, [])
  // Pagination — single cursor. When non-null, more drafts can be fetched
  // via "Load more". When null, we've walked the entire uploads playlist.
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined)
  // Include published videos. Default OFF → drafts-first (private + unlisted).
  // Two reasons: (a) Co-Pilot's job is to optimize metadata BEFORE you publish,
  // and (b) the /drafts fetch deep-scans pages to surface drafts — defaulting ON
  // filled the first page with recent PUBLISHED videos and buried older product
  // drafts (they stopped appearing under "With product"). Tick it to also pull
  // the already-live library.
  const [includePublished, setIncludePublished] = useState(false)
  // Active workflow tab. Starts at 'todo' (the actionable queue), but if that
  // bucket is empty on load we auto-jump to the first tab that actually has
  // videos (effect below) so the page never opens on a blank list.
  const [activeTab, setActiveTab] = useState<VideoTab>('todo')
  const autoTabPicked = React.useRef(false)
  // One-shot guard: when the To-do queue lands empty but more drafts remain
  // unfetched, we auto-walk forward to surface them (effect below). Reset on
  // each fresh (non-append) load so a refresh / channel switch can re-dig.
  const autoFilledTodo = React.useRef(false)
  // Server-side search across the user's entire channel (not just the
  // currently-loaded uploads-playlist page). Debounced 350ms below so we
  // don't hammer YouTube's search endpoint on every keystroke — that one
  // costs ~100x more quota than the default listing.
  const [searchQuery, setSearchQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('') // post-debounce value driving the fetch
  // Multi-channel (migration 127): which connected YouTube channel Co-Pilot is
  // pulling drafts from. null = the account default. Only shown when the user
  // has more than one channel connected.
  const [channels, setChannels] = useState<Array<{ channelId: string; channelTitle: string; isDefault: boolean }>>([])
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  // Bumped on every "Refresh from YouTube" so the planning calendar re-pulls
  // fresh too (it fetches /api/youtube/calendar keyed off this nonce).
  const [calRefreshNonce, setCalRefreshNonce] = useState(0)

  // Bucket the current drafts list into the 4 workflow tabs. Recomputes
  // whenever drafts change — cheap (just regex per video). Search bypasses
  // tab filtering: search results show across all categories.
  const tabbed = useMemo(() => {
    const buckets: Record<VideoTab, DraftVideo[]> = {
      'todo': [],
      'shipped': [],
    }
    for (const v of drafts) buckets[classifyVideo(v)].push(v)
    for (const k of Object.keys(buckets) as VideoTab[]) buckets[k].sort(byNewestUpload)
    return buckets
  }, [drafts])
  // Search results also newest-first.
  const visibleDrafts = activeQuery
    ? [...drafts].sort(byNewestUpload)
    : tabbed[activeTab]

  // On first load, if the default tab ('todo') is empty, jump to the
  // FULLEST tab so Co-Pilot opens on the user's actual library instead of a
  // blank actionable-queue (an established channel is mostly "Done elsewhere").
  // Runs once; a manual tab click also marks this done (below) so we never
  // override the user's choice afterward.
  useEffect(() => {
    if (autoTabPicked.current || activeQuery || drafts.length === 0) return
    // If To-do is empty but more pages remain unfetched, hold off — the
    // auto-fill effect below digs for to-do drafts first. Only fall back to the
    // fullest tab once the channel is fully loaded and To-do is genuinely empty,
    // so we never strand the user on "Shipped" while real to-do work loads in.
    if (tabbed.todo.length === 0 && nextPageToken) return
    autoTabPicked.current = true
    if (tabbed[activeTab].length === 0) {
      const order: VideoTab[] = ['todo', 'shipped']
      const fullest = order.reduce((best, t) => (tabbed[t].length > tabbed[best].length ? t : best), order[0])
      if (tabbed[fullest].length > 0) setActiveTab(fullest)
    }
  }, [tabbed, drafts.length, activeQuery, activeTab, nextPageToken])

  /** load() handles three modes:
   *    - Initial / refresh / new search: replaces the drafts list. (append=false, no pageToken)
   *    - Load more: appends to the existing list. (append=true, pageToken=current cursor)
   *  Dedup is by youtubeVideoId — YouTube occasionally returns the same item
   *  on adjacent pages during edits, and we don't want it to flash twice.
   *
   *  `silent: true` skips the loading-spinner toggle. Used by the post-apply
   *  refresh so the list updates in place instead of flashing empty for a
   *  beat — the user just pushed a video, they don't want to see a spinner.
   */
  const load = useCallback(async (opts?: { pageToken?: string; query?: string; append?: boolean; includePublished?: boolean; silent?: boolean; forceRefresh?: boolean }) => {
    const append = opts?.append === true
    const silent = opts?.silent === true
    if (append) setLoadingMore(true)
    else if (!silent) setLoading(true)
    setError(null)
    // A fresh (non-append) load replaces the list, so let the to-do auto-fill
    // re-evaluate against the new results.
    if (!append && !opts?.pageToken) autoFilledTodo.current = false

    const pageToken = opts?.pageToken
    const query = (opts?.query ?? '').trim()
    const wantPublished = opts?.includePublished ?? false

    if (!pageToken && !append) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const intResult = await supabase.from('integrations').select('geniuslink_api_key,tier').eq('user_id', user.id).single()
        setHasGeniuslink(!!intResult.data?.geniuslink_api_key)
        const tier = effectiveTier(intResult.data?.tier as string)
        setUserTier(tier)
        // Passport on (and the tier can use it) → the creator is geo-routing with
        // MVP's own links, so the "connect Geniuslink" nag doesn't apply. Read it
        // from /api/passport (tier-correct) rather than the typed select, since the
        // column isn't in the generated types yet.
        fetch('/api/passport').then(r => r.ok ? r.json() : null).then(d => { if (d?.ok) setPassportEnabled(!!d.enabled) }).catch(() => {})
        // Fetch playlists for Pro/admin so the batch-apply panel can populate
        if (tier === 'pro' || tier === 'admin') {
          fetch('/api/youtube/playlists')
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.playlists) setPlaylists(d.playlists) })
            .catch(() => {})
        }
      }
    }

    // ── SCOUT-first: fill the draft cache from YouTube Studio, quota-free ─────
    // Before touching the Data API, if SCOUT is installed we read the user's
    // WHOLE Studio library (0 Data API units — it runs in their Studio session)
    // and write it into the same cache the GET below serves from. So the list
    // renders without spending any YouTube quota. Gated to fresh (non-append,
    // non-search, default-channel) loads and throttled via a localStorage
    // timestamp so we don't re-open a background Studio tab on every visit. If
    // SCOUT is missing / fails / returns nothing, we simply fall through to the
    // Data API path unchanged (requestStudioVideos resolves fast when absent).
    let scoutSynced = false
    if (!pageToken && !append && !query && !selectedChannelId) {
      try {
        const SYNC_KEY = 'mvp_scout_videos_synced'
        const last = Number(localStorage.getItem(SYNC_KEY) || 0)
        const stale = Date.now() - last > 15 * 60 * 1000
        if (opts?.forceRefresh || stale) {
          const s = await requestStudioVideos()
          if (s.ok && s.videos.length > 0) {
            const sync = await fetch('/api/youtube/drafts/scout-sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ videos: s.videos }),
            })
            if (sync.ok) {
              scoutSynced = true
              try { localStorage.setItem(SYNC_KEY, String(Date.now())) } catch { /* ignore */ }
            }
          }
        }
      } catch { /* SCOUT unavailable / errored → fall back to the Data API GET */ }
    }

    const params = new URLSearchParams()
    if (pageToken) params.set('pageToken', pageToken)
    if (query) params.set('q', query)
    if (wantPublished) params.set('includePublished', '1')
    // When SCOUT just refreshed the cache, DON'T force a Data API re-scan — serve
    // the freshly-synced (quota-free) cache instead.
    if (opts?.forceRefresh && !scoutSynced) params.set('refresh', '1')
    if (selectedChannelId) params.set('channelId', selectedChannelId)
    const url = params.toString() ? `/api/youtube/drafts?${params.toString()}` : '/api/youtube/drafts'
    const res = await fetch(url)
    const data = await res.json()
    if (res.status === 401 && data.needsAuth) {
      setNeedsAuth(true)
    } else if (!res.ok) {
      setError(data.error || 'Failed to load videos')
    } else {
      const incoming = (data.drafts as DraftVideo[] | undefined) || []
      if (append) {
        // Dedup by youtubeVideoId so a page-boundary collision (rare but
        // happens when the user is actively editing) doesn't show ghosts.
        setDrafts(prev => {
          const seen = new Set(prev.map(v => v.youtubeVideoId))
          const fresh = incoming.filter(v => !seen.has(v.youtubeVideoId))
          return [...prev, ...fresh]
        })
      } else {
        setDrafts(incoming)
      }
      setNextPageToken(data.nextPageToken)
    }
    if (append) setLoadingMore(false)
    else if (!silent) setLoading(false)
  }, [supabase, selectedChannelId])

  // Debounce search input → fetch when the user pauses typing. Empty query
  // re-loads the default (drafts-only) page.
  useEffect(() => {
    const handle = setTimeout(() => {
      const q = searchQuery.trim()
      if (q !== activeQuery) {
        setActiveQuery(q)
        setNextPageToken(undefined)
        void load({ query: q, includePublished })
      }
    }, 350)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  /** Walk every remaining page of the user's uploads playlist until the
   *  cursor is exhausted. Each round-trip the server walks up to 10 pages
   *  (500 videos scanned, MIN_HITS=25 cutoff), then returns a cursor we
   *  feed back in. We loop client-side so the user sees progress flick up
   *  ("47 loaded… 95… 143…") as each batch comes in.
   *
   *  Safety bound: hard cap at 100 round-trips (~50,000 videos scanned).
   *  Real channels never hit this; it exists so a runaway YouTube cursor
   *  (theoretically possible) doesn't melt the user's network. */
  const loadAll = useCallback(async () => {
    if (!nextPageToken || loadingMore) return
    setLoadingMore(true)
    setError(null)
    let cursor: string | undefined = nextPageToken
    let rounds = 0
    const HARD_CAP = 100
    try {
      while (cursor && rounds < HARD_CAP) {
        rounds++
        const params = new URLSearchParams()
        params.set('pageToken', cursor)
        if (activeQuery) params.set('q', activeQuery)
        if (includePublished) params.set('includePublished', '1')
        const res = await fetch(`/api/youtube/drafts?${params.toString()}`)
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || 'Failed to load more drafts — try Refresh.')
          break
        }
        const incoming = (data.drafts as DraftVideo[] | undefined) || []
        // Dedup against what's already in state — page boundaries can repeat
        // an entry during active edits, and we don't want it to flash twice.
        setDrafts(prev => {
          const seen = new Set(prev.map(v => v.youtubeVideoId))
          const fresh = incoming.filter(v => !seen.has(v.youtubeVideoId))
          return [...prev, ...fresh]
        })
        cursor = data.nextPageToken as string | undefined
        setNextPageToken(cursor)
        if (!cursor) break  // exhausted — no more pages on the channel
      }
    } finally {
      setLoadingMore(false)
    }
  }, [nextPageToken, loadingMore, activeQuery, includePublished])

  /** Dig forward through the uploads list until at least one TO-DO draft
   *  surfaces (or the budget / cursor runs out). The server scan already gates
   *  its early-stop on unshipped drafts, so this only kicks in for a deep
   *  channel whose to-do work sits past the first scan window — without it, a
   *  creator whose newest drafts were all already pushed would open Co-Pilot on
   *  an empty "To do" tab even though older unshipped drafts are waiting.
   *  Bounded to a handful of rounds to keep YouTube quota in check. */
  const autoFillTodo = useCallback(async () => {
    if (loadingMore) return
    let cursor: string | undefined = nextPageToken
    if (!cursor) return
    setLoadingMore(true)
    setError(null)
    let rounds = 0
    const ROUND_BUDGET = 8
    try {
      while (cursor && rounds < ROUND_BUDGET) {
        rounds++
        const params = new URLSearchParams()
        params.set('pageToken', cursor)
        if (includePublished) params.set('includePublished', '1')
        if (selectedChannelId) params.set('channelId', selectedChannelId)
        const res = await fetch(`/api/youtube/drafts?${params.toString()}`)
        const data = await res.json()
        if (!res.ok) { setError(data.error || 'Failed to load more drafts — try Refresh.'); break }
        const incoming = (data.drafts as DraftVideo[] | undefined) || []
        setDrafts(prev => {
          const seen = new Set(prev.map(v => v.youtubeVideoId))
          return [...prev, ...incoming.filter(v => !seen.has(v.youtubeVideoId))]
        })
        cursor = data.nextPageToken as string | undefined
        setNextPageToken(cursor)
        // Stop as soon as this batch surfaced a real to-do draft.
        if (incoming.some(v => classifyVideo(v) === 'todo')) break
        if (!cursor) break
      }
    } finally {
      setLoadingMore(false)
    }
  }, [nextPageToken, loadingMore, includePublished, selectedChannelId])

  // Trigger the dig once per fresh load, only when To-do is empty AND more
  // pages remain. If To-do already has items, or the channel is fully loaded,
  // mark it done and leave the auto-tab-pick to handle an empty queue.
  useEffect(() => {
    if (autoFilledTodo.current || activeQuery || loading || loadingMore) return
    if (drafts.length === 0) return
    if (tabbed.todo.length > 0 || !nextPageToken) { autoFilledTodo.current = true; return }
    autoFilledTodo.current = true
    void autoFillTodo()
  }, [tabbed.todo.length, nextPageToken, drafts.length, activeQuery, loading, loadingMore, autoFillTodo])

  const refresh = useCallback(() => {
    setNextPageToken(undefined)
    setCalRefreshNonce(n => n + 1)
    load({ query: activeQuery, includePublished, forceRefresh: true })
  }, [load, activeQuery, includePublished])

  // When the user flips the "Include published videos" toggle, treat it
  // like a refresh — replace the list with the right filter applied.
  const toggleIncludePublished = useCallback((next: boolean) => {
    setIncludePublished(next)
    setNextPageToken(undefined)
    void load({ query: activeQuery, includePublished: next })
  }, [load, activeQuery])

  useEffect(() => { load() }, [load])

  // Discover the user's connected YouTube channels so we can offer a picker
  // when they run more than one (migration 127). Selecting one re-loads the
  // drafts scoped to that channel (load() reads selectedChannelId).
  useEffect(() => {
    let cancelled = false
    fetch('/api/youtube/channels')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d?.channels) return
        setChannels(d.channels.map((c: { channelId: string; channelTitle: string; isDefault?: boolean }) => ({
          channelId: c.channelId, channelTitle: c.channelTitle, isDefault: !!c.isDefault,
        })))
      })
      .catch(() => { /* non-fatal — single-channel users just see no picker */ })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div>
        <PageHero
          title="YouTube Co-Pilot"
          subtitle="Generate titles, descriptions, tags, hashtags and thumbnails for any video, then push it all back to YouTube in one click."
          media={walkthroughId(WALKTHROUGH_ID) ? <HeroVideo videoId={WALKTHROUGH_ID!} title="YouTube Co-Pilot walkthrough" /> : undefined}
        />
        <div className="flex items-center justify-center py-20 text-[#86868b] dark:text-[#8e8e93] text-sm">
          <Loader2 size={16} className="animate-spin mr-2" /> Loading your videos…
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHero
        guide={<CoPilotGuide />}
        title="YouTube Co-Pilot"
        subtitle="Generate titles, descriptions, tags, hashtags and thumbnails for any video, then push it all back to YouTube in one click."
        media={walkthroughId(WALKTHROUGH_ID) ? <HeroVideo videoId={WALKTHROUGH_ID!} title="YouTube Co-Pilot walkthrough" /> : undefined}
      />

      {canUsePreview('first_comment', userTier) && <FirstCommentsToPin />}

      {/* ADMIN dev tool: read back the Studio save requests SCOUT captured
          (yt-hook), so the real InnerTube request shape can be handed over to
          build the disclosure/monetization/tag-product replay. Always visible
          for admins so it doesn't require pushing a video first. */}
      {devMode && (
        <div className="mb-4 rounded-xl border border-dashed border-[#7C3AED]/30 bg-[#7C3AED]/5 px-4 py-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-[#7C3AED]">Dev · Studio save capture</span>
            <button
              onClick={async () => { setYtRecipeLoading(true); try { setYtRecipes(await requestYtSaveRecipes()) } finally { setYtRecipeLoading(false) } }}
              disabled={ytRecipeLoading}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-50"
            >
              {ytRecipeLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Load captured Studio save
            </button>
            <span className="text-[10px] text-[#86868b]">In Studio: change paid-promotion / AI / monetization / tag-product on a test draft, Save, then load here.</span>
          </div>
          {ytRecipes && (
            ytRecipes.length === 0
              ? <p className="text-[11px] text-[#86868b]">Nothing captured yet. Make sure SCOUT 1.16.5+ is loaded, then change + Save a field in YouTube Studio and load again.</p>
              : <pre className="text-[9px] leading-snug text-[#6e6e73] dark:text-[#a1a1a6] bg-black/5 dark:bg-white/5 rounded p-2 overflow-auto whitespace-pre-wrap break-words max-h-72">{JSON.stringify(ytRecipes, null, 1)}</pre>
          )}

          {/* Replay TEST: hit YouTube's own metadata_update to set paid-promotion
              + AI + monetization via the internal API (no clicking). Paste a
              draft video id and run — the raw HTTP status/response comes back so
              we can tell if auth/attestation is accepted. */}
          <div className="flex items-center gap-2 flex-wrap border-t border-dashed border-[#7C3AED]/20 pt-2 mt-1">
            <input
              value={ytApplyVideoId}
              onChange={e => setYtApplyVideoId(e.target.value.trim())}
              placeholder="video id (e.g. qAO5DPFdrzo)"
              className="text-[11px] px-2 py-1 rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] w-52"
            />
            <button
              onClick={async () => { if (!ytApplyVideoId) return; setYtApplyLoading(true); setYtApplyResult(null); try { setYtApplyResult(await requestYtApplyDisclosures(ytApplyVideoId, { paidPromotion: true, aiDisclosure: true, hasAlteredContent: false, monetize: true })) } finally { setYtApplyLoading(false) } }}
              disabled={ytApplyLoading || !ytApplyVideoId}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-[#8e8e93] hover:opacity-90 disabled:opacity-50"
            >
              {ytApplyLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} API (200 but no-save)
            </button>
            <button
              onClick={async () => { if (!ytApplyVideoId) return; setYtApplyLoading(true); setYtApplyResult(null); try { setYtApplyResult(await requestYtInjectDisclosures(ytApplyVideoId, { paidPromotion: true, aiDisclosure: true, hasAlteredContent: false, monetize: true, notify: false })) } finally { setYtApplyLoading(false) } }}
              disabled={ytApplyLoading || !ytApplyVideoId}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-[#34c759] hover:opacity-90 disabled:opacity-50"
            >
              {ytApplyLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Test: inject via Studio save
            </button>
          </div>
          {ytApplyResult && (
            <pre className={`text-[10px] leading-snug rounded p-2 overflow-auto whitespace-pre-wrap break-words max-h-56 ${ytApplyResult.ok ? 'bg-[#34c759]/10 text-[#1d7d3f]' : 'bg-[#ff3b30]/5 text-[#b3261e] dark:text-[#ff6a5f]'}`}>{JSON.stringify(ytApplyResult, null, 1)}</pre>
          )}
        </div>
      )}

      {/* Top planning row — TWO columns: the month calendar takes 2/3 (left),
          and the right 1/3 stacks the Refresh control over the how-it-works
          explainer. Only when connected — needsAuth shows the connect banner
          below instead. */}
      {!needsAuth && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start mb-5">
          {/* Left 2/3 — planning calendar */}
          <div className="lg:col-span-2">
            <ContentCalendar channelId={selectedChannelId} refreshNonce={calRefreshNonce} />
          </div>

          {/* Right 1/3 — Refresh + channel picker stacked over the explainer */}
          <div className="flex flex-col gap-3">
            <button
              onClick={refresh}
              disabled={loading}
              title="Pull your newest uploaded and drafted videos straight from YouTube"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-[#7C3AED]/30 text-[#7C3AED] bg-[#7C3AED]/5 hover:bg-[#7C3AED]/10 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              {loading ? 'Refreshing…' : 'Refresh from YouTube'}
            </button>
            {channels.length > 0 && (() => {
              // Always show WHICH channel Co-Pilot is reading — the #1 support
              // confusion is videos from the wrong channel when a Google login
              // owns several. With >1 channel it's a switcher; with exactly one
              // it's a read-only label so the user can still see (and fix) it.
              const activeId = selectedChannelId ?? (channels.find(c => c.isDefault)?.channelId ?? channels[0].channelId)
              const active = channels.find(c => c.channelId === activeId) ?? channels[0]
              return (
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[#6e6e73] dark:text-[#8e8e93]">📺 Showing videos from</span>
                  {channels.length > 1 ? (
                    <select
                      value={activeId}
                      onChange={(e) => setSelectedChannelId(e.target.value)}
                      className="text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] w-full"
                    >
                      {channels.map(c => (
                        <option key={c.channelId} value={c.channelId}>{c.channelTitle}{c.isDefault ? ' (default)' : ''}</option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className="text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] truncate"
                      title={active?.channelTitle || undefined}
                    >
                      {active?.channelTitle || 'Connected channel'}
                    </span>
                  )}
                  <a href="/connect-youtube" className="text-[11px] text-[#7C3AED] hover:underline">
                    {channels.length > 1 ? 'Manage channels' : 'Wrong channel? Switch or reconnect →'}
                  </a>
                </div>
              )
            })()}
            {/* How Co-Pilot works */}
            <div className="card p-4 flex items-start gap-3 border border-[#7C3AED]/20 bg-[#7C3AED]/5">
              <div className="w-7 h-7 rounded-lg bg-[#7C3AED]/15 flex items-center justify-center flex-shrink-0">
                <AlertCircle size={14} className="text-[#7C3AED]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Works with any video — pick yours and we generate the title, description, tags, hashtags and thumbnail.</p>
                <ul className="space-y-1.5 text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
                  <li className="flex gap-2">
                    <span className="text-[#7C3AED] font-semibold flex-shrink-0">Amazon review</span>
                    <span>We identify the product from your title and what you say in the video, and add your affiliate link automatically.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-[#7C3AED] font-semibold flex-shrink-0">Other product</span>
                    <span>Same thing — we still write the review and link out to wherever you sell it.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-[#7C3AED] font-semibold flex-shrink-0">Not a product</span>
                    <span>You still get all the metadata around your topic (just no affiliate link).</span>
                  </li>
                </ul>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mt-2">
                  <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Optional:</strong> to guarantee we grab the exact product, drop its 10-character Amazon ASIN into the title or file name — e.g.{' '}
                  <span className="font-mono text-[#1d1d1f] dark:text-[#f5f5f7] bg-white dark:bg-[#1c1c1e] px-1.5 py-0.5 rounded border border-[#d2d2d7] dark:border-[#3a3a3c]">Vacuum - B08TT4YHG1</span>.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Connect YouTube OAuth banner */}
      {needsAuth && (
        <div className="card p-6 mb-6 flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-[#ff0000]/10 flex items-center justify-center flex-shrink-0">
            <Youtube size={20} className="text-[#ff0000]" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Connect YouTube to unlock the autopilot</h3>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
              We need read access to find your drafts (private + unlisted) and write access to push the description, tags, hashtags and thumbnail back to YouTube. One-time Google OAuth — revoke anytime.
            </p>
            <div className="rounded-lg border border-[#ff9500]/30 bg-[#ff9500]/5 px-3 py-2 mb-4">
              <p className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7] leading-relaxed">
                <strong>Tip for product reviews:</strong> add the Amazon ASIN to the video file name or YouTube title — e.g.{' '}
                <span className="font-mono bg-white dark:bg-[#1c1c1e] px-1.5 py-0.5 rounded border border-[#d2d2d7] dark:border-[#3a3a3c]">Vacuum - B08TT4YHG1</span>. It&apos;s optional — it just pins the exact product for accurate Amazon data + your affiliate link.
              </p>
            </div>
            <a
              href="/api/auth/youtube"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ background: '#ff0000' }}
            >
              <Youtube size={14} /> Connect YouTube
            </a>
          </div>
        </div>
      )}

      {/* Geniuslink warning */}
      {!needsAuth && !hasGeniuslink && !passportEnabled && (
        <div className="card p-4 mb-6 flex items-center gap-3 border border-[#ff9500]/30 bg-[#ff9500]/5">
          <AlertCircle size={16} className="text-[#ff9500] flex-shrink-0" />
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] flex-1">
            <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Geniuslink not connected.</strong> We&apos;ll fall back to plain US Amazon links, which means you only earn on .com traffic. Add your Geniuslink API key in <a href="/brand" className="text-[#7C3AED] hover:underline">Brand Profile → Affiliate Link Routing</a> to geo-route every click to the right Amazon storefront.
          </p>
        </div>
      )}

      {!needsAuth && !error && (
        <>
          {/* Search across the whole channel (any privacy status). Empty
              query falls back to the default ASIN-only listing of the
              uploads playlist. Debounced 350ms — search.list costs ~100x
              more YouTube quota than playlistItems, so we don't spam it. */}
          <div className="relative mb-4">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b]" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search your YouTube videos by title…"
              className="w-full text-sm pl-8 pr-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7]"
            />
          </div>

          {/* Workflow tabs — hidden during search since search results
              span all categories. Tab counts update live as drafts load
              via the "Load more" button. */}
          {!activeQuery && drafts.length > 0 && (
            <div className="flex items-center gap-1 mb-3 border-b border-gray-200 dark:border-white/10">
              {([
                { id: 'todo' as const, label: '📝 Needs metadata', sub: 'Drafts that still need their title, description, tags and thumbnail generated (the orange ASIN pill marks the ones with a detected product)' },
                { id: 'shipped' as const, label: '🚀 Metadata sent', sub: 'Handled — MVP generated or pushed the metadata, or the video is already scheduled/live. Re-generate any of it anytime.' },
              ]).map(t => {
                const count = tabbed[t.id].length
                const active = activeTab === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => { autoTabPicked.current = true; setActiveTab(t.id) }}
                    className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                      active
                        ? 'border-[#7C3AED] text-[#7C3AED]'
                        : 'border-transparent text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
                    }`}
                    title={t.sub}
                  >
                    <span>{t.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                      active
                        ? 'bg-[#7C3AED] text-white'
                        : 'bg-gray-100 dark:bg-white/10 text-[#86868b] dark:text-[#8e8e93]'
                    }`}>{count}</span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">
              {activeQuery
                ? `Search · ${drafts.length} result${drafts.length !== 1 ? 's' : ''} for "${activeQuery}"`
                : `${visibleDrafts.length} of ${drafts.length} ${includePublished ? 'video' : 'draft'}${drafts.length !== 1 ? 's' : ''} in this tab${nextPageToken ? ' · more available' : ' · all loaded'}`}
            </p>
            <div className="flex items-center gap-3">
              {/* "Include published videos" toggle — default OFF so Co-Pilot only
                  surfaces drafts (private + unlisted). Flip ON to re-do metadata
                  on a video that's already live. Hidden during search because
                  search bypasses the privacy filter server-side anyway. */}
              {!activeQuery && (
                <label className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includePublished}
                    onChange={(e) => toggleIncludePublished(e.target.checked)}
                    className="accent-[#7C3AED] w-3 h-3"
                  />
                  Include published
                </label>
              )}
              <button onClick={refresh} disabled={loading} className="flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#7C3AED] disabled:opacity-60 transition-colors">
                <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>

          {visibleDrafts.length === 0 ? (
            <div className="card p-8 text-center">
              <Youtube size={28} className="mx-auto text-[#86868b] dark:text-[#8e8e93] mb-3" />
              {activeQuery ? (
                <>
                  <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">No videos matched &quot;{activeQuery}&quot;</p>
                  <p className="text-xs text-[#86868b] dark:text-[#8e8e93] max-w-md mx-auto">Try a different title fragment, or clear the search to see your most recent uploads.</p>
                </>
              ) : drafts.length > 0 ? (
                // Drafts loaded but the active tab is empty — tell the user
                // which tab to switch to OR that they're all done.
                <>
                  <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
                    {activeTab === 'todo' && 'No unpublished drafts waiting'}
                    {activeTab === 'shipped' && 'Nothing handled in Co-Pilot yet'}
                  </p>
                  <p className="text-xs text-[#86868b] dark:text-[#8e8e93] max-w-md mx-auto">
                    {activeTab === 'shipped'
                      ? <>Generate metadata on a video (or schedule/publish it on YouTube) — handled videos land here.</>
                      : <>Switch tabs above to see your other videos.</>}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
                    {includePublished ? 'No videos found' : 'No drafts on your channel'}
                  </p>
                  <p className="text-xs text-[#86868b] dark:text-[#8e8e93] max-w-md mx-auto">
                    {includePublished
                      ? 'YouTube returned an empty list. If you just uploaded, try Refresh in a minute — YouTube can take time to index new videos.'
                      : <>Upload a video to YouTube Studio as <strong>private</strong> or <strong>unlisted</strong>, hit Refresh, and it&apos;ll show up here. Or tick <em>Include published</em> above to see videos that are already live.</>}
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-4">
                {visibleDrafts.map(video => (
                  <VideoStudioCard
                    key={video.youtubeVideoId}
                    video={video}
                    userTier={userTier}
                    isShort={shortsMap[video.youtubeVideoId] ?? null}
                    playlists={playlists}
                    onApplied={(videoId) => {
                      // Optimistic in-place reclassify: mark just this video
                      // shipped so it leaves the to-do tab WITHOUT a re-fetch.
                      // A silent re-load here would re-scan from scratch (Apply
                      // busts the server cache) and the scan's early-stop
                      // truncates the list back to a partial batch — wiping out
                      // everything "Load all drafts" had pulled in. The cache
                      // bust still reconciles on the next manual Refresh.
                      setDrafts(prev => prev.map(v =>
                        v.youtubeVideoId === videoId
                          ? { ...v, metadataAppliedAt: new Date().toISOString() }
                          : v,
                      ))
                    }}
                  />
                ))}
              </div>

              {/* Load all drafts — one click walks the rest of the
                  uploads playlist until the cursor is exhausted. The API
                  scans up to 10 pages (500 videos) per round-trip; we
                  chain round-trips client-side so the user sees the
                  count climb live ("Loaded 47… 95… 143…") instead of
                  staring at a frozen spinner. Hidden during search —
                  search.list has its own cursor + 25-result limit. */}
              {!activeQuery && nextPageToken && (
                <div className="flex flex-col items-center justify-center gap-2 mt-6">
                  <button
                    onClick={() => void loadAll()}
                    disabled={loadingMore}
                    className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold rounded-xl bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                  >
                    {loadingMore
                      ? <><Loader2 size={14} className="animate-spin" /> Loaded {drafts.length} so far — still scanning YouTube…</>
                      : <><RefreshCw size={14} /> Load all {includePublished ? 'videos' : 'drafts'} from YouTube</>}
                  </button>
                  {!loadingMore && (
                    <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
                      Walks every page of your YouTube uploads playlist. Big channels may take a few seconds.
                    </p>
                  )}
                </div>
              )}
              {!activeQuery && !nextPageToken && drafts.length >= 25 && (
                <p className="text-center text-xs text-[#86868b] dark:text-[#8e8e93] mt-6">
                  All caught up — every {includePublished ? 'uploaded video' : 'draft'} on your channel is loaded.
                </p>
              )}
            </>
          )}
        </>
      )}

      {error && (
        <div className="card p-6 flex items-center gap-3">
          <AlertCircle size={16} className="text-[#ff3b30] flex-shrink-0" />
          <p className="text-sm text-[#ff3b30]">{error}</p>
        </div>
      )}
    </div>
  )
}
