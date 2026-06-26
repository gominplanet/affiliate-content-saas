'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { createBrowserClient } from '@/lib/supabase/client'
import PageHero from '@/components/layout/PageHero'
import { CapReachedBanner } from '@/components/CapReachedBanner'
import { useConfirm } from '@/components/ui/useConfirm'
import { pickWeightedStyleIndex, OVERLAY_STYLES, drawHeadline, type HeadlinePosition, type FaceBox } from '@/lib/thumbnail-overlay'
import { isExtensionAvailable, requestVideoFrames } from '@/lib/extension-frame'
import { effectiveTier } from '@/lib/view-as'
import type { Tier } from '@/lib/tier'
import BrandStylePanel, { BORDER_NAMES } from '@/components/co-pilot/BrandStylePanel'
import {
  Youtube, Wand2, CheckCircle, AlertCircle, Loader2, ExternalLink,
  Copy, ChevronDown, ChevronUp, RefreshCw, Link2, Tag, Lock, Eye, Globe,
  Image, Download, Sparkles, Upload, X, Search, Calendar, Camera, Package, Plus,
} from 'lucide-react'

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
}

// ── Tab classification (2026-06-08, simplified 2026-06-20) ─────────────────
// THREE workflow buckets the YouTube Co-Pilot surfaces:
//   - todo:            any unpublished draft that still needs metadata, with
//                      or without a detected product. (The old product /
//                      no-product split was merged — both are processable, so
//                      product presence is now a per-ROW badge, not a tab.)
//   - shipped:         WE pushed metadata to YouTube via /api/youtube/apply
//                      or update-metadata — authoritative "done" signal,
//                      backed by the youtube_copilot_pushes table (mig 109)
//   - done:            HEURISTIC — description contains a Geniuslink /
//                      Amazon affiliate URL. Catches videos completed via
//                      other tools or manual edits (not by Co-Pilot).
// Per user spec 2026-06-08. Classification runs CLIENT-side off the existing
// drafts payload so the user can tweak rules without redeploying the API.
// 'todo' merges the old 'todo-product' / 'todo-no-product' split (2026-06-20):
// now that the metadata generator identifies the product from the title +
// transcript when there's no ASIN, both kinds of draft are equally
// processable, so the product/no-product distinction lives as a per-ROW badge
// (the orange "ASIN:" pill) instead of a top-level tab that implied
// "no product = dead end".
type VideoTab = 'todo' | 'shipped' | 'done'

// ASIN format on Amazon: 10 alphanumerics, almost always starting with B0.
// We allow the broader 10-alphanum pattern but anchor on word boundaries so
// random letters in a title don't false-match.
const ASIN_RE = /\b(B0[A-Z0-9]{8})\b/i
function classifyVideo(v: Pick<DraftVideo, 'title' | 'description' | 'detectedAsin' | 'metadataAppliedAt' | 'status' | 'publishAt'>): VideoTab {
  const title = v.title || ''

  // SHIPPED wins first: if we pushed metadata via Co-Pilot, that's the
  // authoritative signal — overrides everything, regardless of status.
  if (v.metadataAppliedAt) return 'shipped'

  // PUBLISHED (and not pushed via Co-Pilot) → "Done elsewhere". The With product
  // / No product tabs are STRICTLY unpublished drafts (per user 2026-06-10):
  // private/unlisted videos the creator hasn't shipped yet — typically a raw
  // product-name + ASIN title and no finished thumbnail. A live/public video
  // never belongs in those tabs, even if it carries a product signal.
  if (v.status === 'public') return 'done'

  // RAW PRODUCT DRAFT wins next: an ASIN in the TITLE (incl. the filename-derived
  // title of a fresh upload, e.g. "White turtle neck B07NSJ95HM") is the orange
  // "Generate YouTube metadata" signal — exactly what "With product" is for. This
  // BEATS the scheduled check below: the creator schedules raw drafts too, so a
  // scheduled raw product draft is still work to do and stays in "With product".
  // RAW PRODUCT DRAFT stays in the to-do queue even when scheduled: a raw
  // ASIN-in-title upload is still work to finish, so it must NOT fall through to
  // the 'shipped' (publishAt) check below. (Per user 2026-06-10.)
  const hasAsin = !!v.detectedAsin || ASIN_RE.test(title)
  if (hasAsin) return 'todo'

  // Everything else still unpublished — whether or not a product was detected —
  // is work to do. (Product presence shows as a per-row badge, not a tab.)
  return 'todo'
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

const STATUS_ICON = {
  private: <Lock size={11} className="text-[#ff9500]" />,
  unlisted: <Eye size={11} className="text-[#7C3AED]" />,
  public: <Globe size={11} className="text-[#34c759]" />,
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
  scheduleMode: 'now' | 'in1h' | 'in6h' | 'in24h'
}

const defaultProSettings: ProPublishSettings = {
  playlistId: null,
  madeForKids: false,
  notifySubscribers: false,
  privacyStatus: 'draft',
  scheduleMode: 'now',
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

function VideoStudioCard({ video, userTier, playlists, onApplied }: {
  video: DraftVideo
  userTier: Tier
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
  const [generated, setGenerated] = useState<GeneratedMetadata | null>(null)
  const [agentInsights, setAgentInsights] = useState<AgentInsights | null>(null)
  const [product, setProduct] = useState<ProductInfo | null>(null)
  const [affiliateUrl, setAffiliateUrl] = useState<string | null>(null)
  const [geniuslinkUsed, setGeniuslinkUsed] = useState<boolean | null>(null)
  /** Where the product attached to this generation came from:
   *  'caller' = user dropped an ASIN in the YT title themselves
   *  'title'  = same (server detected the ASIN in the title)
   *  'search' = no ASIN, we asked Haiku to extract the product name
   *             and scraped Amazon search for the match
   *  'none'   = general video, no product attached */
  const [productDiscoverySource, setProductDiscoverySource] = useState<'caller' | 'title' | 'search' | 'none' | null>(null)
  const [proSettings, setProSettings] = useState<ProPublishSettings>(defaultProSettings)
  const [geniuslinkError, setGeniuslinkError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // True when the last generate failed the ASIN-mismatch tripwire → show "Generate anyway".
  const [asinMismatch, setAsinMismatch] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
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
  /** "Upload your own photo" flow — the user supplies a photo of themselves
   *  WITH the product; the server cleans it up / re-renders it into a polished
   *  thumbnail scene (Kontext) and we overlay the title. Public Supabase URL.
   *  cleanupPrompt is optional free-text direction for the re-render. */
  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [cleanupPrompt, setCleanupPrompt] = useState('')
  /** 3C — Up to 5 product reference photos the user uploads to ground the
   *  thumbnail composition on the ACTUAL product(s). Different from
   *  uploadedPhotoUrl (which is a photo of the USER with the product); these
   *  are clean product shots — front view, side angle, multiple products for
   *  comparison thumbnails, etc. Public Supabase URLs. */
  const [productImageUrls, setProductImageUrls] = useState<string[]>([])
  const [productImagesUploading, setProductImagesUploading] = useState(false)
  /** 3C — Optional composition direction folded into the Nano Banana Pro
   *  prompt — e.g. "front view on the left, side angle on the right".
   *  Only meaningful with 2+ product photos; the UI shows the input then. */
  const [productCompositionNote, setProductCompositionNote] = useState('')
  /** User's READY face models — pulled from /api/face-models on mount.
   *  When the user picks one, faceModelId gets passed to the generate
   *  request and the server routes through the LoRA-capable Flux endpoint. */
  const [faceModels, setFaceModels] = useState<Array<{ id: string; name: string; trigger_token: string }>>([])
  // Live thumbnail-style controls (the single block) — drive every generation.
  const [borderIndex, setBorderIndex] = useState<number | null>(null) // null = keep borders varied
  const [accentColor, setAccentColor] = useState<string>('#FFE034')   // title emphasis colour
  const [selectedFaceModelId, setSelectedFaceModelId] = useState<string | null>(null)
  /** Which thumbnail mode card is active. Drives the 4-card picker UI.
   *  'selfie'       → upload a photo of yourself with the product
   *  'own-design'   → upload a finished thumbnail (raw, no AI)
   *  'product-only' → AI generates product-only scene, no face
   *  'face-model'   → AI generates with your saved face model */
  const [thumbnailMode, setThumbnailMode] = useState<'selfie' | 'own-design' | 'product-only' | 'face-model' | null>(null)
  /** "Break frame" effect: run rembg to cut out the creator and composite
   *  them OVER the neon border. Off by default — enables in ~20s. */
  const [breakFrame, setBreakFrame] = useState(false)
  /** null = still checking (ping in progress), true/false = known state. */
  const [extensionInstalled, setExtensionInstalled] = useState<boolean | null>(null)
  /** Live status shown inside the Card 4 button while generating. */
  const [thumbnailStatus, setThumbnailStatus] = useState<string>('')
  // Tier-cap-reached state — keyed separately from the red error toast
  // so we can render an amber upgrade banner with a /pricing CTA instead.
  const [capError, setCapError] = useState<{ message: string; info: { cap: string; currentTier?: string; upgrade?: { tier: string; label: string; limit: number | null } | null } } | null>(null)

  useEffect(() => {
    if (generated) {
      setEditTitle(generated.title)
      setEditDesc(generated.description)
      setExpanded(true)
    }
  }, [generated])

  /** Pulls READY face models. Wrapped in a callback because we re-fetch
   *  every time the headline modal opens — face models trained in
   *  another tab while the Studio page was already open would otherwise
   *  never show up until a hard reload. */
  const loadFaceModels = useCallback(async () => {
    try {
      const d = await cachedGet<{ models?: Array<{ id: string; name: string; trigger_token: string; status: string }> }>('/api/face-models')
      const ready = ((d.models as Array<{ id: string; name: string; trigger_token: string; status: string }>) || [])
        .filter(m => m.status === 'ready')
        .map(m => ({ id: m.id, name: m.name, trigger_token: m.trigger_token }))
      setFaceModels(ready)
      // Default to the first ready face model (most users have only one person).
      setSelectedFaceModelId(prev => prev ?? (ready.length ? ready[0].id : null))
    } catch { setFaceModels([]) }
  }, [])

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
    setGenerating(true)
    setError(null)
    setAsinMismatch(false)
    setGenerated(null)
    setApplied(false)
    setThumbnailUrl(null)
    setThumbnailError(null)
    try {
      // Client-side retry-on-overload: if Anthropic is overloaded, the server
      // already retries 8× internally, but if it still surfaces we automatically
      // retry once more on the client after a back-off so the user doesn't have
      // to click again. Total ceiling ≈ server attempts + 2 client tries.
      const callOnce = () => fetch('/api/youtube/generate-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asin: video.detectedAsin,
          videoTitle: video.title,
          videoDescription: video.description,
          // Used server-side to persist the generated metadata back to
          // the youtube_videos row so future generations can use it as
          // a voice anchor.
          youtubeVideoId: video.youtubeVideoId,
          // "Generate anyway" → bypass the ASIN-mismatch tripwire.
          skipAsinCheck,
        }),
      })

      let res = await callOnce()
      let data = await safeJson(res)
      const isOverload = (d: Record<string, unknown>) =>
        typeof d.error === 'string' && /overload/i.test(d.error as string)
      for (let i = 0; !res.ok && isOverload(data) && i < 2; i++) {
        setError(`MVP is overloaded — auto-retrying (${i + 1}/2)…`)
        await new Promise(r => setTimeout(r, 8000 + i * 4000))
        res = await callOnce()
        data = await safeJson(res)
      }
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
      setAgentInsights((data.agentInsights ?? null) as AgentInsights | null)
      setProduct({ ...productData, bullets: productBullets, description: productDescription })
      setAffiliateUrl(data.affiliateUrl as string)
      setGeniuslinkUsed((data.geniuslinkUsed ?? false) as boolean)
      setProductDiscoverySource((data.productDiscoverySource ?? null) as typeof productDiscoverySource)
      setGeniuslinkError((data.geniuslinkError ?? null) as string | null)

      // ── Thumbnail no longer auto-fires after metadata generation ─────────
      // The thumbnail flow now opens a modal asking the user about the
      // headline (and, soon, the face model). Auto-firing here would skip
      // that decision and just produce whatever the defaults are. The
      // user clicks "Generate Thumbnail" explicitly when they're ready.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate')
    } finally {
      setGenerating(false)
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
        const isDraft = proSettings.privacyStatus === 'draft'
        const publishAt = isDraft ? null : computePublishAt(proSettings.scheduleMode)
        const res = await fetch('/api/youtube/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId: video.youtubeVideoId,
            title: editTitle,
            description: editDesc,
            tags: generated.tags,
            thumbnailDataUri: thumbnailUrl ?? undefined,
            playlistId: proSettings.playlistId,
            madeForKids: isDraft ? undefined : proSettings.madeForKids,
            notifySubscribers: proSettings.notifySubscribers,
            publishAt,
            privacyStatus: isDraft || publishAt ? undefined : proSettings.privacyStatus,
          }),
        })
        const data = await safeJson(res)
        if (!res.ok) throw new Error((data.error as string) || `HTTP ${res.status} — apply failed`)
        setApplied(true)
        let hasWarning = false
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          setApplyError(`Applied with warnings: ${(data.warnings as string[]).join(' · ')}`)
          hasWarning = true
        }
        // Clean success → auto-collapse the panel after a beat so the user
        // sees the green "Applied to YouTube" / "Saved to draft" state, then
        // the card returns to the list view for the next video. Skip the
        // collapse when there's a warning — the user needs to see the detail.
        if (!hasWarning) setTimeout(() => setExpanded(false), 1500)
        // Refresh the parent's drafts list so this video moves into the
        // "🚀 Pushed via Co-Pilot" tab automatically. Fire on success even
        // when there's a warning — the push happened, the classification
        // should update. Small delay matches the auto-collapse so the list
        // re-renders right as the card returns to the row view.
        if (onApplied) setTimeout(() => onApplied(video.youtubeVideoId), hasWarning ? 0 : 1600)
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
        }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error((data.error as string) || `HTTP ${res.status} — update failed`)
      setApplied(true)
      if (data.thumbnailWarning) {
        setApplyError(`Metadata applied ✓ — thumbnail not uploaded: ${data.thumbnailWarning}`)
        // Metadata still landed → still belongs in 🚀 Pushed.
        if (onApplied) setTimeout(() => onApplied(video.youtubeVideoId), 0)
      } else {
        // Clean success → auto-collapse so the user can move on to the next
        // video in the list. Same UX pattern as the Pro path above.
        setTimeout(() => setExpanded(false), 1500)
        if (onApplied) setTimeout(() => onApplied(video.youtubeVideoId), 1600)
      }
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply to YouTube')
    } finally {
      setApplying(false)
    }
  }

  /** Convert the schedule mode dropdown choice to an ISO 8601 publishAt or null. */
  function computePublishAt(mode: ProPublishSettings['scheduleMode']): string | null {
    if (mode === 'now') return null
    const offsets: Record<'in1h' | 'in6h' | 'in24h', number> = {
      in1h: 1 * 60 * 60 * 1000,
      in6h: 6 * 60 * 60 * 1000,
      in24h: 24 * 60 * 60 * 1000,
    }
    return new Date(Date.now() + offsets[mode]).toISOString()
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

  async function handlePhotoUpload(file: File) {
    setThumbnailError(null)
    if (!file.type.startsWith('image/')) {
      setThumbnailError('Your photo must be an image (JPG, PNG, or WebP).')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setThumbnailError(`That photo is ${(file.size / 1024 / 1024).toFixed(1)} MB. Keep it under 10 MB.`)
      return
    }
    setPhotoUploading(true)
    try {
      const sb = createBrowserClient()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      // Public bucket so the server can fetch it for the Kontext re-render.
      const path = `${user.id}/thumb-uploads/${crypto.randomUUID()}.${ext}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (sb.storage as any)
        .from('product-images').upload(path, file, { upsert: false, cacheControl: '31536000', contentType: file.type || 'image/jpeg' })
      if (upErr) throw new Error(upErr.message)
      const { data } = sb.storage.from('product-images').getPublicUrl(path)
      setUploadedPhotoUrl(data.publicUrl)
    } catch (err) {
      setThumbnailError(err instanceof Error ? err.message : 'Photo upload failed')
    } finally {
      setPhotoUploading(false)
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
          asin: video.detectedAsin ?? undefined,
          count: 5,
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

  async function generateThumbnail(opts?: { textMode?: 'baked' | 'clean' | 'graphic'; lockedHeadline?: string; noHuman?: boolean; skipFaceModel?: boolean }) {
    setGeneratingThumbnail(true)
    setThumbnailError(null)
    setThumbnailStatus('')
    const isProductOnly = opts?.noHuman ?? (selectedFaceModelId === 'no-human')
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
    // 'graphic' (gpt-image-1) is only used when the user has a face model
    // explicitly selected — it's slower (30-60s) and requires OPENAI_API_KEY.
    // SCOUT / frame-only thumbnails always use 'clean' (NB/Gemini, 20-30s).
    const effectiveTextMode = opts?.textMode ?? (
      isProductOnly ? 'clean' :
      (effectiveFaceModelId && effectiveFaceModelId !== 'no-human') ? 'graphic' :
      'clean'
    )
    try {
      // Always try to capture a real video frame with SCOUT — it provides the
      // scene context (the creator in their actual video, the product in context).
      // A face model (if selected) is used for identity lock IN ADDITION to the
      // frame, not instead of it. Product-only mode skips frame capture entirely.
      let capturedFrames: string[] = []
      if (video.youtubeVideoId && !isProductOnly) {
        if (capturedFramesRef.current?.videoId === video.youtubeVideoId && capturedFramesRef.current.frames.length) {
          capturedFrames = capturedFramesRef.current.frames
        } else {
          try {
            if (await isExtensionAvailable()) {
              setThumbnailError(null)
              setThumbnailStatus('Opening your video to capture a frame…')
              // 7 frames spread across the video so the vision picker can choose
              // the best one (clear face, product visible, sharp). The extension
              // processes them serially (~3s each + ~10s startup ≈ 30s total).
              const frames = await requestVideoFrames(video.youtubeVideoId, [0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8])
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
        signal: AbortSignal.timeout(240000),
        body: JSON.stringify({
          videoTitle: editTitle || video.title,
          asin: video.detectedAsin ?? undefined,
          videoDescription: video.description,
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
          // "Your Face" — lock the host's likeness from their uploaded photos.
          // effectiveFaceModelId is null when skipFaceModel:true (SCOUT path).
          faceModelId: (!isProductOnly && effectiveFaceModelId && effectiveFaceModelId !== 'no-human') ? effectiveFaceModelId : undefined,
          // 'no-human' → product-only thumbnail, no face composition at all.
          noHuman: isProductOnly || undefined,
          styleReferenceUrl: styleReferenceUrl || undefined,
          uploadedPhotoUrl: uploadedPhotoUrl || undefined,
          cleanupPrompt: cleanupPrompt.trim() || undefined,
          // 3C — Multi-product reference photos + optional composition note.
          // When the user uploaded their own product photos these replace the
          // single Amazon-scraped image as the references; the note (if any)
          // tells the model how to arrange them.
          customProductImageUrls: productImageUrls.length > 0 ? productImageUrls : undefined,
          productCompositionNote: productCompositionNote.trim() || undefined,
          // graphic = gpt-image-1 (identity-grounded, ~20s with video frame or ~2min with Photobooth).
          // Use graphic whenever there's an identity source: face model OR a YouTube video to pull frames from.
          // Product-only / selfie → 'clean' (NB Pro, fast, no face composition).
          textMode: effectiveTextMode,
          capturedFrames: capturedFrames.length ? capturedFrames : undefined,
          // "Break frame" effect: composites the creator OVER the neon border.
          // Off by default (costs ~20s for the rembg pass).
          breakFrame: breakFrame || undefined,
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
        throw new Error("This video is private. Install the SCOUT extension (chrome://extensions → Load unpacked → extension/ folder) to capture frames, or select a Face Model under \"Your Face\".")
      }
      // needsFaceModel (409): the user hasn't set up a Face Model and asked for
      // a thumbnail WITH a face — surface the full guidance, not a generic error.
      if (!res.ok) throw new Error((data.message as string) || (data.error as string) || 'Thumbnail generation failed')
      setCapError(null)
      await applyThumbnailResult(data)
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
          asin: video.detectedAsin ?? undefined,
          videoDescription: video.description,
          youtubeVideoId: video.youtubeVideoId,
          productTitle: overrides.productTitle ?? undefined,
          productDescription: overrides.productDescription ?? undefined,
          productBullets: overrides.productBullets ?? undefined,
          style: 'lifestyle',
          customHeadline: customHeadline.trim() || undefined,
          variantCount,
          borderStyleIndex: borderIndex ?? undefined,
          accentColor,
          faceModelId: (selectedFaceModelId && selectedFaceModelId !== 'no-human') ? selectedFaceModelId : undefined,
          // 'no-human' → product-only thumbnail, no face composition at all.
          noHuman: selectedFaceModelId === 'no-human' || undefined,
          styleReferenceUrl: styleReferenceUrl || undefined,
          // 3C — Carry the user's uploaded product photos + composition note
          // through the auto-thumbnail path too (post-metadata fire-and-forget).
          // Same semantics as the manual Generate call below.
          customProductImageUrls: productImageUrls.length > 0 ? productImageUrls : undefined,
          productCompositionNote: productCompositionNote.trim() || undefined,
          // Composed scene + crisp canvas title by default (matches the manual
          // Generate button). 'Try AI-baked text' re-runs as 'baked'.
          textMode: 'clean',
          breakFrame: breakFrame || undefined,
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
      if (!res.ok) throw new Error((data.message as string) || (data.error as string) || 'Thumbnail generation failed')
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
    <div className="card overflow-hidden">
      {/* Video header */}
      <div className="flex gap-4 p-5">
        {video.thumbnailUrl ? (
          <div className="w-32 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100" style={{ height: '72px' }}>
            <img src={video.thumbnailUrl} alt={video.title} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="w-32 flex-shrink-0 rounded-lg bg-gray-100 flex items-center justify-center" style={{ height: '72px' }}>
            <Youtube size={20} className="text-[#86868b] dark:text-[#8e8e93]" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-[#6e6e73] dark:text-[#ebebf0]">
              {STATUS_ICON[video.status]} {video.status}
            </span>
            {video.detectedAsin && (
              <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#ff9500]/10 text-[#ff9500]">
                <Tag size={9} /> ASIN: {video.detectedAsin}
              </span>
            )}
            {video.publishAt && (
              <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#5856d6]/10 text-[#5856d6]">
                <Calendar size={9} /> Goes live {new Date(video.publishAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] leading-snug line-clamp-2 mb-2">{video.title}</p>
          <div className="flex items-center gap-2 flex-wrap">
            {generating ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-xs text-[#7C3AED] font-medium">
                  <Loader2 size={12} className="animate-spin" />
                  Running MVP agent swarm…
                </div>
                <div className="flex flex-wrap gap-1">
                  {(video.detectedAsin
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
                style={{ background: video.detectedAsin
                  ? 'linear-gradient(135deg, #ff9500 0%, #ff3b30 100%)'
                  : 'linear-gradient(135deg, #7C3AED 0%, #5856d6 100%)' }}
              >
                <Wand2 size={12} />
                {generated
                  ? 'Regenerate'
                  : video.detectedAsin
                    ? 'Generate YouTube metadata'
                    : 'Generate metadata (no product)'}
              </button>
            )}
            {!video.detectedAsin && !generating && (
              <span className="text-[11px] text-[#86868b] dark:text-[#8e8e93] italic">
                No ASIN in the title — we&apos;ll use a product link from your description if there is one (Amazon or a direct store link, wrapped with your Geniuslink), otherwise we write everything around the video&apos;s topic.
              </span>
            )}
            <a href={ytUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#7C3AED] transition-colors">
              <ExternalLink size={11} /> Open in YouTube
            </a>
          </div>
          {error && <p className="text-xs text-[#ff3b30] mt-2">{typeof error === 'string' ? error : 'Something went wrong'}</p>}
          {asinMismatch && !generating && (
            <button
              onClick={() => generate(true)}
              className="mt-2 text-[11px] px-3 h-7 rounded-md border border-[#ff9500] text-[#ff9500] font-semibold hover:bg-[#ff9500] hover:text-white transition"
              title="The product is right? Generate metadata anyway, skipping the ASIN match check."
            >
              Generate anyway
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
                      {geniuslinkUsed ? 'Geniuslink ✓' : affiliateUrl?.includes('?tag=') ? 'Associates link ✓' : 'Plain Amazon link'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Geniuslink warning */}
          {geniuslinkUsed === false && geniuslinkError && (
            <div className="mx-5 mb-3 px-3 py-2 rounded-lg bg-[#ff9500]/10 border border-[#ff9500]/20 text-xs text-[#ff9500]">
              ⚠️ Geniuslink not used — {geniuslinkError}. Go to <strong>Brand Profile → Affiliate Link Routing</strong> to add or update your credentials.
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
              {/* Two-column layout: metadata left, thumbnail right */}
              <div className="flex gap-6 items-start">

                {/* ── Left column: metadata ── */}
                <div className="flex-1 min-w-0 flex flex-col gap-5">

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
                  onChange={e => setEditDesc(e.target.value)}
                  rows={10}
                  className="input-field resize-none text-xs leading-relaxed font-mono"
                />
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

                </div> {/* ── end left column ── */}

                {/* ── Right column: AI Thumbnail Generator ── */}
                <div className="w-[360px] flex-shrink-0 flex flex-col gap-4">

                  {/* Step 2 header */}
                  <div className="flex items-center gap-3 pb-1 border-b border-gray-100 dark:border-white/10">
                    <span className="w-7 h-7 rounded-full bg-[#7C3AED] text-white text-sm font-bold flex items-center justify-center flex-shrink-0 shadow-sm">2</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">AI Thumbnail Generator</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] font-medium">1280×720</span>
                      </div>
                      <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Pick a method and generate your thumbnail</p>
                    </div>
                  </div>

                  {/* Primary CTA: Create my MVP Thumbnail */}
                  <div className="flex flex-col gap-2">

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
                          <p className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Two steps:</p>
                          <ol className="text-[11px] text-[#86868b] dark:text-[#8e8e93] space-y-1 list-decimal list-inside">
                            <li>Download &amp; unzip the extension</li>
                            <li>Chrome → <span className="font-mono">chrome://extensions</span> → Developer mode ON → Load unpacked → select the unzipped folder</li>
                          </ol>
                        </div>
                        <div className="px-4 pb-4 flex items-center gap-2">
                          <a
                            href="/mvp-scout-extension.zip"
                            download="mvp-scout-extension.zip"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FF9500] text-white text-xs font-semibold hover:bg-[#e6860a] transition-colors"
                          >
                            <Download size={12} />
                            Download extension
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
                          void generateThumbnail({ skipFaceModel: true, textMode: 'graphic' })
                        }}
                        disabled={generatingThumbnail || extensionInstalled === null}
                        className="flex items-center gap-4 w-full px-5 py-5 rounded-2xl text-left transition-all disabled:opacity-50 shadow-md hover:shadow-lg hover:scale-[1.01] active:scale-[0.99]"
                        style={{ background: generatingThumbnail ? 'linear-gradient(135deg, rgba(255,149,0,0.15) 0%, rgba(255,107,0,0.10) 100%)' : 'linear-gradient(135deg, #FF9500 0%, #FF6B00 100%)', border: '2px solid transparent' }}
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

                  {/* Divider — secondary options */}
                  <div className="flex items-center gap-3 my-1">
                    <div className="flex-1 h-px bg-gray-200 dark:bg-white/10" />
                    <span className="text-[11px] text-[#86868b] dark:text-[#8e8e93] font-medium whitespace-nowrap">or choose a method</span>
                    <div className="flex-1 h-px bg-gray-200 dark:bg-white/10" />
                  </div>

                  {/* Secondary options */}
                  <div className="flex flex-col gap-2">

                    {/* Upload Selfie */}
                    <button
                      type="button"
                      onClick={() => setThumbnailMode(m => m === 'selfie' ? null : 'selfie')}
                      className={`flex items-center gap-3 w-full px-3 py-3 rounded-xl border text-left transition-all ${thumbnailMode === 'selfie' ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-[#7C3AED]/50 bg-white dark:bg-[#1c1c1e]'}`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-[#7C3AED]/10 flex items-center justify-center flex-shrink-0">
                        <Camera size={15} className="text-[#7C3AED]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Upload Selfie</p>
                        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">You + product → AI thumbnail</p>
                      </div>
                      <ChevronDown size={13} className={`flex-shrink-0 text-[#86868b] transition-transform ${thumbnailMode === 'selfie' ? 'rotate-180' : ''}`} />
                    </button>

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

                  {/* Inline expand: Upload Selfie */}
                  {thumbnailMode === 'selfie' && (
                    <div className="flex flex-col gap-3 p-4 rounded-xl bg-[#7C3AED]/5 border border-[#7C3AED]/20">
                      <p className="text-[11px] font-semibold text-[#7C3AED]">Upload 1–3 photos of you with the product</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {uploadedPhotoUrl && (
                          <div className="relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={uploadedPhotoUrl} alt="Selfie" className="w-16 h-10 object-cover rounded-lg border border-[#7C3AED]/30" />
                            <button type="button" onClick={() => { setUploadedPhotoUrl(null); setCleanupPrompt('') }}
                              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#ff3b30] text-white flex items-center justify-center">
                              <X size={8} />
                            </button>
                          </div>
                        )}
                        {!uploadedPhotoUrl && (
                          <label className={`flex flex-col items-center justify-center gap-1 w-16 h-10 rounded-lg border-2 border-dashed cursor-pointer transition-all ${photoUploading ? 'opacity-60 cursor-wait border-[#7C3AED]/30' : 'border-[#7C3AED]/40 hover:border-[#7C3AED] hover:bg-[#7C3AED]/5'}`}>
                            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={generatingThumbnail || photoUploading}
                              onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); e.target.value = '' }} />
                            {photoUploading ? <Loader2 size={11} className="animate-spin text-[#7C3AED]" /> : <Plus size={11} className="text-[#7C3AED]" />}
                          </label>
                        )}
                      </div>
                      <input
                        type="text"
                        value={cleanupPrompt}
                        onChange={e => setCleanupPrompt(e.target.value)}
                        maxLength={400}
                        placeholder="Scene hint: bright kitchen, excited expression…"
                        disabled={generatingThumbnail}
                        className="text-xs px-3 py-2 rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-gray-400 focus:outline-none focus:border-[#7C3AED] transition"
                      />
                      <button
                        onClick={() => {
                          setSelectedFaceModelId(null)
                          void generateThumbnail()
                        }}
                        disabled={generatingThumbnail || !uploadedPhotoUrl}
                        className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all hover:opacity-90"
                        style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #5856d6 100%)' }}
                      >
                        {generatingThumbnail ? <><Loader2 size={13} className="animate-spin" /> Generating…</> : <><Sparkles size={13} /> Generate Thumbnail</>}
                      </button>
                    </div>
                  )}

                  {/* Inline expand: Upload My Design */}
                  {thumbnailMode === 'own-design' && (
                    <div className="flex flex-col gap-3 p-4 rounded-xl bg-[#5856d6]/5 border border-[#5856d6]/20">
                      <p className="text-[11px] font-semibold text-[#5856d6]">Upload your finished thumbnail design</p>
                      {thumbnailUrl && thumbnailModel === 'kontext-upload' ? (
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
                          void generateThumbnail({ noHuman: true })
                        }}
                        disabled={generatingThumbnail}
                        className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all hover:opacity-90"
                        style={{ background: 'linear-gradient(135deg, #34c759 0%, #30d158 100%)' }}
                      >
                        {generatingThumbnail ? <><Loader2 size={13} className="animate-spin" /> Generating…</> : <><Sparkles size={13} /> Generate Product Thumbnail</>}
                      </button>
                    </div>
                  )}


                  {/* Border style dropdown */}
                  <div>
                    <label className="text-[10px] font-semibold text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide block mb-1.5">Border style</label>
                    <select
                      value={borderIndex === null ? '' : borderIndex}
                      onChange={e => setBorderIndex(e.target.value === '' ? null : Number(e.target.value))}
                      disabled={generatingThumbnail}
                      className="w-full text-xs px-3 py-2 rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:border-[#7C3AED] transition"
                    >
                      <option value="">Random / varied</option>
                      {BORDER_NAMES.map((name, i) => (
                        <option key={i} value={i}>{name}</option>
                      ))}
                    </select>
                  </div>

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
                      disabled={generatingThumbnail}
                    />
                  </div>

                  {/* Result */}
                  {thumbnailUrl && (
                    <div className="flex flex-col gap-2">
                      <div className="rounded-xl overflow-hidden border border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-white/5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={thumbnailUrl} alt="Generated thumbnail" className="w-full object-cover" style={{ aspectRatio: '16/9' }} />
                      </div>
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
                        {thumbnailModel === 'gpt-image-graphic' && (
                          <>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#FF6B00]/10 text-[#FF6B00] font-medium">🎨 Graphic Design</span>
                            <button onClick={() => generateThumbnail({ textMode: 'clean' })} disabled={generatingThumbnail}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-white/10 hover:border-[#7C3AED] text-[#1d1d1f] dark:text-[#f5f5f7] transition disabled:opacity-60">
                              <RefreshCw size={12} /> Scene
                            </button>
                            <div className="flex items-center gap-1.5 w-full">
                              <input type="text" value={gfxTitleInput} onChange={e => setGfxTitleInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && gfxTitleInput.trim()) generateThumbnail({ textMode: 'graphic', lockedHeadline: gfxTitleInput.trim() }) }}
                                placeholder="Custom title → Enter"
                                className="flex-1 min-w-0 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-transparent text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-gray-400 focus:outline-none focus:border-[#FF6B00] transition" />
                              <button onClick={() => { if (gfxTitleInput.trim()) generateThumbnail({ textMode: 'graphic', lockedHeadline: gfxTitleInput.trim() }) }}
                                disabled={generatingThumbnail || !gfxTitleInput.trim()}
                                className="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[#FF6B00] text-white hover:bg-[#e55a00] transition disabled:opacity-50">→</button>
                            </div>
                          </>
                        )}
                        {(thumbnailModel === 'nano-banana-pro' || thumbnailModel === 'nano-banana') && (
                          <>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#34c759]/10 text-[#34c759] font-medium">✨ Scene · crisp text</span>
                            <button onClick={() => generateThumbnail({ textMode: 'baked' })} disabled={generatingThumbnail}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-white/10 hover:border-[#5856d6] text-[#1d1d1f] dark:text-[#f5f5f7] transition disabled:opacity-60">
                              <RefreshCw size={12} /> Baked text
                            </button>
                            {selectedFaceModelId && selectedFaceModelId !== 'no-human' && (
                              <button onClick={() => generateThumbnail({ textMode: 'graphic' })} disabled={generatingThumbnail}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-white/10 hover:border-[#FF6B00] text-[#1d1d1f] dark:text-[#f5f5f7] transition disabled:opacity-60">
                                🎨 Graphic
                              </button>
                            )}
                          </>
                        )}
                        {(thumbnailModel === 'nano-banana-pro-baked' || thumbnailModel === 'nano-banana-baked') && (
                          <>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#5856d6]/10 text-[#5856d6] font-medium">✨ Baked text</span>
                            <button onClick={() => generateThumbnail({ textMode: 'clean' })} disabled={generatingThumbnail}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-white/10 hover:border-[#7C3AED] text-[#1d1d1f] dark:text-[#f5f5f7] transition disabled:opacity-60">
                              <RefreshCw size={12} /> Crisp text
                            </button>
                          </>
                        )}
                        {thumbnailModel === 'kontext-upload' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] font-medium">📤 Your upload</span>
                        )}
                        {!!thumbnailModel && thumbnailModel !== 'kontext-upload' && (thumbnailModel.startsWith('kontext-') || thumbnailModel.startsWith('ideogram-') || thumbnailModel.startsWith('flux')) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#ff9500]/10 text-[#ff9500] font-medium" title="Scene-composite fallback">
                            🎨 Scene (fallback)
                          </span>
                        )}
                      </div>
                      {!!thumbnailDebug && !!thumbnailModel && thumbnailModel !== 'kontext-upload' && (thumbnailModel.startsWith('kontext-') || thumbnailModel.startsWith('ideogram-') || thumbnailModel.startsWith('flux')) && (
                        <p className="text-[10px] text-[#86868b] leading-snug break-words">Why fallback: {thumbnailDebug}</p>
                      )}
                      {thumbnailModel !== 'kontext-upload' && (
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

                </div> {/* ── end right column ── */}

              </div> {/* ── end two-column flex ── */}

              {/* ── Step 3: Pinned Comment ── */}
              <div className="flex flex-col gap-3 pt-1">
                <div className="flex items-center gap-3 pb-1 border-b border-gray-100 dark:border-white/10">
                  <span className="w-7 h-7 rounded-full bg-[#ff9500]/15 border border-[#ff9500]/40 text-[#ff9500] text-sm font-bold flex items-center justify-center flex-shrink-0">3</span>
                  <div>
                    <p className="text-sm font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Pinned Comment <span className="text-[11px] font-normal text-[#86868b]">— optional</span></p>
                    <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">YouTube's API can't pin — copy & paste this after your video goes live</p>
                  </div>
                </div>
                <div className="rounded-xl border border-[#ff9500]/30 bg-[#ff9500]/5 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Pinned comment</label>
                    <button onClick={() => copy(generated.pinnedComment, 'pin')} className="text-[10px] text-[#7C3AED] hover:underline flex items-center gap-0.5">
                      <Copy size={10} /> {copied === 'pin' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] p-3 rounded-lg bg-white dark:bg-[#1c1c1e] border border-[#d2d2d7] dark:border-[#3a3a3c] leading-relaxed">
                    {generated.pinnedComment}
                  </div>
                  <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-2">After the video is public: post this as a comment, then click the three-dot menu → <strong>Pin</strong>.</p>
                </div>
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

                    {/* Schedule */}
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-[#6e6e73] dark:text-[#ebebf0] font-medium">Schedule</span>
                      <select
                        value={proSettings.scheduleMode}
                        onChange={e => setProSettings(s => ({ ...s, scheduleMode: e.target.value as ProPublishSettings['scheduleMode'] }))}
                        className="px-2 py-1.5 rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] disabled:opacity-50"
                        disabled={proSettings.privacyStatus === 'draft'}
                      >
                        <option value="now">Publish now</option>
                        <option value="in1h">In 1 hour</option>
                        <option value="in6h">In 6 hours</option>
                        <option value="in24h">In 24 hours</option>
                      </select>
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
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={proSettings.notifySubscribers}
                        onChange={e => setProSettings(s => ({ ...s, notifySubscribers: e.target.checked }))}
                      />
                      <span className="text-[#1d1d1f] dark:text-[#f5f5f7]">Notify subscribers <span className="text-[#86868b]">(off = no bell spam)</span></span>
                    </label>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-2">
                <div className="flex items-center gap-3">
                  <button
                    onClick={applyToYouTube}
                    disabled={applying || applied}
                    className="flex items-center justify-center gap-2.5 flex-1 py-3.5 rounded-xl text-base font-bold text-white disabled:opacity-60 transition-all shadow-lg hover:opacity-90 active:scale-[0.98]"
                    style={{ background: applied ? '#34c759' : 'linear-gradient(135deg, #ff0000 0%, #cc0000 100%)', boxShadow: applied ? undefined : '0 4px 14px rgba(255,0,0,0.35)' }}
                  >
                    {applying ? <><Loader2 size={16} className="animate-spin" /> {proSettings.privacyStatus === 'draft' ? 'Saving draft…' : 'Pushing to YouTube…'}</>
                      : applied ? <><CheckCircle size={16} /> {proSettings.privacyStatus === 'draft' ? 'Saved to Draft' : 'Pushed to YouTube!'}</>
                      : <><Youtube size={16} /> {proSettings.privacyStatus === 'draft' ? 'Save Draft to YouTube' : 'Push to YouTube'}</>}
                  </button>
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

                {/* Post-apply Studio checklist — covers fields YouTube's API
                    doesn't accept (paid promotion, monetization, content
                    rating). Three clicks in Studio and the video is fully
                    set up. Dismissible so repeat applies don't nag. */}
                {applied && !finishCheckDone && (
                  <div className="rounded-xl border border-[#ff9500]/30 bg-[#ff9500]/5 px-4 py-3 flex flex-col gap-2.5">
                    <div className="flex items-start gap-2">
                      <AlertCircle size={14} className="text-[#ff9500] mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">Finish on YouTube (3 clicks)</p>
                        <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
                          YouTube&apos;s API doesn&apos;t accept these fields — open YouTube and tick them once. Takes 10 seconds.
                        </p>
                      </div>
                      <button
                        onClick={() => setFinishCheckDone(true)}
                        className="text-[10px] text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] flex-shrink-0"
                        title="Hide this reminder"
                      >
                        Dismiss
                      </button>
                    </div>

                    <ul className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7] flex flex-col gap-1.5 pl-1">
                      <li className="flex items-start gap-2">
                        <span className="w-4 h-4 rounded-full border border-[#ff9500] flex items-center justify-center text-[10px] font-bold text-[#ff9500] flex-shrink-0 mt-px">1</span>
                        <span><strong>Paid promotion</strong>: Details → tick <em>&quot;Yes, the video contains paid promotion&quot;</em>.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="w-4 h-4 rounded-full border border-[#ff9500] flex items-center justify-center text-[10px] font-bold text-[#ff9500] flex-shrink-0 mt-px">2</span>
                        <span><strong>Monetization</strong>: Monetization tab → toggle <em>On</em>.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="w-4 h-4 rounded-full border border-[#ff9500] flex items-center justify-center text-[10px] font-bold text-[#ff9500] flex-shrink-0 mt-px">3</span>
                        <span><strong>Content rating</strong>: pick <em>&quot;None of the above&quot;</em> for each row, then Submit.</span>
                      </li>
                    </ul>

                    <a
                      href={`https://studio.youtube.com/video/${video.youtubeVideoId}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 self-start px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-[#ff0000] hover:bg-[#cc0000] transition-colors"
                    >
                      <Youtube size={11} /> Open this video on YouTube <ExternalLink size={10} />
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
              Five product-specific options written for THIS video — pick the one you like, or write your own. MVP then composes around your choice so the title sits where it should.
            </p>

            <div className="flex flex-col gap-2 mb-4 max-h-[60vh] overflow-y-auto pr-1">
              {/* Loading — fires the moment the modal opens. */}
              {titleOptionsLoading && (
                <div className="flex items-center gap-2 text-xs text-[#6e6e73] dark:text-[#ebebf0] p-3 rounded-lg border border-dashed border-gray-200 dark:border-white/10">
                  <Loader2 size={14} className="animate-spin" />
                  <span>Reading the video and writing 5 title options…</span>
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
                    Type the exact text. We&apos;ll overlay it crisply on the MVP-generated background.
                  </p>
                  {headlinePromptChoice === 'custom' && (
                    <input
                      type="text"
                      value={customHeadline}
                      onChange={(e) => setCustomHeadline(e.target.value)}
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
                title="Generate a fresh batch of 5 title options"
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
                    setTimeout(() => { generateThumbnail({ lockedHeadline: pickedHeadline || undefined }) }, 0)
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
  const [loading, setLoading] = useState(true)
  // loadingMore = "Load more" button busy state; distinct from initial load
  // because we want to keep the existing list rendered while it spins.
  const [loadingMore, setLoadingMore] = useState(false)
  const [needsAuth, setNeedsAuth] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasGeniuslink, setHasGeniuslink] = useState(false)
  const [userTier, setUserTier] = useState<Tier>('trial')
  const [playlists, setPlaylists] = useState<Array<{ id: string; title: string }>>([])
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

  // Bucket the current drafts list into the 4 workflow tabs. Recomputes
  // whenever drafts change — cheap (just regex per video). Search bypasses
  // tab filtering: search results show across all categories.
  const tabbed = useMemo(() => {
    const buckets: Record<VideoTab, DraftVideo[]> = {
      'todo': [],
      'shipped': [],
      'done': [],
    }
    for (const v of drafts) buckets[classifyVideo(v)].push(v)
    // Newest drafts first — the YouTube scan/cache order isn't reliably
    // recency-sorted, so sort each tab by publishedAt descending so the most
    // recent uploads surface at the top instead of old ones.
    const byNewest = (a: DraftVideo, b: DraftVideo) => (b.publishedAt || '').localeCompare(a.publishedAt || '')
    for (const k of Object.keys(buckets) as VideoTab[]) buckets[k].sort(byNewest)
    return buckets
  }, [drafts])
  // Search results also newest-first.
  const visibleDrafts = activeQuery
    ? [...drafts].sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
    : tabbed[activeTab]

  // On first load, if the default tab ('todo') is empty, jump to the
  // FULLEST tab so Co-Pilot opens on the user's actual library instead of a
  // blank actionable-queue (an established channel is mostly "Done elsewhere").
  // Runs once; a manual tab click also marks this done (below) so we never
  // override the user's choice afterward.
  useEffect(() => {
    if (autoTabPicked.current || activeQuery || drafts.length === 0) return
    autoTabPicked.current = true
    if (tabbed[activeTab].length === 0) {
      const order: VideoTab[] = ['todo', 'shipped', 'done']
      const fullest = order.reduce((best, t) => (tabbed[t].length > tabbed[best].length ? t : best), order[0])
      if (tabbed[fullest].length > 0) setActiveTab(fullest)
    }
  }, [tabbed, drafts.length, activeQuery, activeTab])

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
        // Fetch playlists for Pro/admin so the batch-apply panel can populate
        if (tier === 'pro' || tier === 'admin') {
          fetch('/api/youtube/playlists')
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.playlists) setPlaylists(d.playlists) })
            .catch(() => {})
        }
      }
    }

    const params = new URLSearchParams()
    if (pageToken) params.set('pageToken', pageToken)
    if (query) params.set('q', query)
    if (wantPublished) params.set('includePublished', '1')
    if (opts?.forceRefresh) params.set('refresh', '1')
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

  const refresh = useCallback(() => {
    setNextPageToken(undefined)
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
        title="YouTube Co-Pilot"
        subtitle="Generate titles, descriptions, tags, hashtags and thumbnails for any video, then push it all back to YouTube in one click."
      />


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
      {!needsAuth && !hasGeniuslink && (
        <div className="card p-4 mb-6 flex items-center gap-3 border border-[#ff9500]/30 bg-[#ff9500]/5">
          <AlertCircle size={16} className="text-[#ff9500] flex-shrink-0" />
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] flex-1">
            <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Geniuslink not connected.</strong> We&apos;ll fall back to plain US Amazon links, which means you only earn on .com traffic. Add your Geniuslink API key in <a href="/brand" className="text-[#7C3AED] hover:underline">Brand Profile → Affiliate Link Routing</a> to geo-route every click to the right Amazon storefront.
          </p>
        </div>
      )}

      {/* How-it-works disclaimer — always visible once connected */}
      {!needsAuth && (
        <div className="card p-4 mb-5 flex items-start gap-3 border border-[#7C3AED]/20 bg-[#7C3AED]/5">
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
      )}

      {!needsAuth && !error && (
        <>
          {/* Search across the whole channel (any privacy status). Empty
              query falls back to the default ASIN-only listing of the
              uploads playlist. Debounced 350ms — search.list costs ~100x
              more YouTube quota than playlistItems, so we don't spam it. */}
          {/* Channel picker — only when the creator runs more than one YouTube
              channel. Selecting one re-loads the drafts scoped to that channel
              (the default channel flag no longer silently controls Co-Pilot). */}
          {channels.length > 1 && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-[#6e6e73] dark:text-[#8e8e93]">📺 Channel</span>
              <select
                value={selectedChannelId ?? (channels.find(c => c.isDefault)?.channelId ?? channels[0].channelId)}
                onChange={(e) => setSelectedChannelId(e.target.value)}
                className="text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] max-w-[280px]"
              >
                {channels.map(c => (
                  <option key={c.channelId} value={c.channelId}>{c.channelTitle}{c.isDefault ? ' (default)' : ''}</option>
                ))}
              </select>
            </div>
          )}

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
                { id: 'todo' as const, label: '📝 To do', sub: 'Unpublished drafts that still need metadata — with or without a product (the orange ASIN pill marks the ones with a detected product)' },
                { id: 'shipped' as const, label: '🚀 Shipped', sub: 'Pushed to YouTube through Co-Pilot — re-generate thumbnail or metadata anytime' },
                { id: 'done' as const, label: '✅ Published', sub: 'Already live on YouTube (published outside Co-Pilot)' },
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
              <button onClick={refresh} className="flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#7C3AED] transition-colors">
                <RefreshCw size={11} /> Refresh
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
                    {activeTab === 'shipped' && 'Nothing pushed via Co-Pilot yet'}
                    {activeTab === 'done' && 'No published videos here'}
                  </p>
                  <p className="text-xs text-[#86868b] dark:text-[#8e8e93] max-w-md mx-auto">
                    {activeTab === 'shipped'
                      ? <>Generate metadata on a video and click <strong>Apply to YouTube</strong> — once we successfully push it, the video lands here.</>
                      : activeTab === 'done'
                        ? <>Videos with an Amazon/Geniuslink in the description but no Co-Pilot push record land here — usually from another tool or manual edits.</>
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
