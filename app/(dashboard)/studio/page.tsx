'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@/lib/supabase/client'
import Header from '@/components/layout/Header'
import { TutorialVideo } from '@/components/TutorialVideo'
import { CapReachedBanner } from '@/components/CapReachedBanner'
import { pickWeightedStyleIndex, OVERLAY_STYLES, drawHeadline, type HeadlinePosition, type FaceBox } from '@/lib/thumbnail-overlay'
import { isExtensionAvailable, requestVideoFrames } from '@/lib/extension-frame'
import { effectiveTier } from '@/lib/view-as'
import {
  Youtube, Wand2, CheckCircle, AlertCircle, Loader2, ExternalLink,
  Copy, ChevronDown, ChevronUp, RefreshCw, Link2, Tag, Lock, Eye, Globe,
  Image, Download, Sparkles, ChevronLeft, ChevronRight, Upload,
} from 'lucide-react'

interface DraftVideo {
  youtubeVideoId: string
  title: string
  description: string
  thumbnailUrl: string
  status: 'private' | 'unlisted' | 'public'
  publishedAt: string
  detectedAsin: string | null
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
  unlisted: <Eye size={11} className="text-[#0071e3]" />,
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

function VideoStudioCard({ video, userTier, playlists }: {
  video: DraftVideo
  userTier: 'trial' | 'creator' | 'pro' | 'admin'
  playlists: Array<{ id: string; title: string }>
}) {
  const isPro = userTier === 'pro' || userTier === 'admin'
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
  // Which face the composed thumbnail locked to (Auto-match result), shown so
  // the user can confirm it picked the right person.
  const [thumbnailFaceUsed, setThumbnailFaceUsed] = useState<string | null>(null)
  const [sceneAnalysis, setSceneAnalysis] = useState<string | null>(null)
  const [generatingThumbnail, setGeneratingThumbnail] = useState(false)
  const [thumbnailError, setThumbnailError] = useState<string | null>(null)
  // Cache the real video frames grabbed by the extension, per video — so the
  // baked⇄crisp toggles don't re-open YouTube every time (one capture / video).
  const capturedFramesRef = React.useRef<{ videoId: string; frames: string[] } | null>(null)
  const [instantLoading, setInstantLoading] = useState(false)
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
  const [variantCount, setVariantCount] = useState(1)
  /** All generated variants (best-first, with CTR scores) for the compare
   *  grid. The large preview shows the currently-selected one (thumbnailUrl). */
  const [thumbnailVariants, setThumbnailVariants] = useState<Array<{ url: string; score: number | null }>>([])
  /** Pre-generation prompt — opens when the user clicks Generate Thumbnail
   *  so they consciously decide whether to write their own headline or
   *  let MVP do it, before any AI work fires. */
  const [headlinePromptOpen, setHeadlinePromptOpen] = useState(false)
  const [headlinePromptChoice, setHeadlinePromptChoice] = useState<'auto' | 'manual'>('auto')
  /** Optional style-reference image URL — Haiku vision distills it
   *  into a style brief that gets folded into the Flux prompt. Public
   *  URL from Supabase storage. */
  const [styleReferenceUrl, setStyleReferenceUrl] = useState<string | null>(null)
  const [styleRefUploading, setStyleRefUploading] = useState(false)
  /** "Upload your own photo" flow — the user supplies a photo of themselves
   *  WITH the product; the server cleans it up / re-renders it into a polished
   *  thumbnail scene (Kontext) and we overlay the title. Public Supabase URL.
   *  cleanupPrompt is optional free-text direction for the re-render. */
  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [cleanupPrompt, setCleanupPrompt] = useState('')
  /** User's READY face models — pulled from /api/face-models on mount.
   *  When the user picks one, faceModelId gets passed to the generate
   *  request and the server routes through the LoRA-capable Flux endpoint. */
  const [faceModels, setFaceModels] = useState<Array<{ id: string; name: string; trigger_token: string }>>([])
  const [selectedFaceModelId, setSelectedFaceModelId] = useState<string | null>(null)
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
      const r = await fetch('/api/face-models')
      if (!r.ok) return setFaceModels([])
      const d = await r.json()
      const ready = ((d.models as Array<{ id: string; name: string; trigger_token: string; status: string }>) || [])
        .filter(m => m.status === 'ready')
        .map(m => ({ id: m.id, name: m.name, trigger_token: m.trigger_token }))
      setFaceModels(ready)
      // Default to 'auto' — the server vision-matches the video to the right
      // face (e.g. Seb vs Michelle), so we never lock the wrong person. The
      // user can still pick a specific face or turn it off.
      setSelectedFaceModelId(prev => prev ?? (ready.length ? 'auto' : null))
    } catch { setFaceModels([]) }
  }, [])

  // Load once on mount.
  useEffect(() => { loadFaceModels() }, [loadFaceModels])

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
        const res = await fetch(`/api/thumbnail-feedback?surface=youtube${nicheParam}`)
        if (res.ok) {
          const fb = await res.json()
          setYtStyleWeights({ liked: fb.liked || {}, disliked: fb.disliked || {} })
        }
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

  async function generate() {
    setGenerating(true)
    setError(null)
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
        }),
      })

      let res = await callOnce()
      let data = await safeJson(res)
      const isOverload = (d: Record<string, unknown>) =>
        typeof d.error === 'string' && /overload/i.test(d.error as string)
      for (let i = 0; !res.ok && isOverload(data) && i < 2; i++) {
        setError(`Claude is overloaded — auto-retrying (${i + 1}/2)…`)
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
      if (!res.ok) throw new Error((data.error as string) || 'Generation failed')
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
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          setApplyError(`Applied with warnings: ${(data.warnings as string[]).join(' · ')}`)
        }
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
      setThumbnailModel((data.modelUsed as string) ?? null)
      setSceneAnalysis((data.channelStyle as string) ?? null)
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

  async function generateThumbnail(opts?: { textMode?: 'baked' | 'clean' }) {
    setGeneratingThumbnail(true)
    setThumbnailError(null)
    try {
      // Real video frames are only needed as the LIKENESS source when there's NO
      // face in play. With a face selected (specific or Auto), the face comes
      // from the creator's Photobooth bank and the route uses the YouTube
      // thumbnail for layout — so we skip opening/scrubbing the video entirely.
      // Only when "No face" is chosen do we grab frames (the host's likeness).
      let capturedFrames: string[] = []
      if (video.youtubeVideoId && selectedFaceModelId === null) {
        if (capturedFramesRef.current?.videoId === video.youtubeVideoId && capturedFramesRef.current.frames.length) {
          capturedFrames = capturedFramesRef.current.frames
        } else {
          try {
            if (await isExtensionAvailable()) {
              setThumbnailError(null)
              const frames = await requestVideoFrames(video.youtubeVideoId)
              if (frames.length) {
                capturedFrames = frames
                capturedFramesRef.current = { videoId: video.youtubeVideoId, frames }
              }
            }
          } catch { /* ignore — fall back to the maxres frame */ }
        }
      }
      const res = await fetch('/api/youtube/generate-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoTitle: editTitle || video.title,
          asin: video.detectedAsin ?? undefined,
          videoDescription: video.description,
          youtubeVideoId: video.youtubeVideoId,
          productTitle: product?.title ?? undefined,
          productDescription: product?.description ?? undefined,
          productBullets: product?.bullets ?? undefined,
          style: 'lifestyle',
          customHeadline: customHeadline.trim() || undefined,
          variantCount,
          // "Your Face" — lock the host's likeness from their uploaded photos.
          faceModelId: (selectedFaceModelId && selectedFaceModelId !== 'auto') ? selectedFaceModelId : undefined,
          faceAuto: selectedFaceModelId === 'auto' || undefined,
          styleReferenceUrl: styleReferenceUrl || undefined,
          uploadedPhotoUrl: uploadedPhotoUrl || undefined,
          cleanupPrompt: cleanupPrompt.trim() || undefined,
          // Default 'clean': the composed, vidIQ-style designed scene (host +
          // hero product + reimagined background) rendered TEXT-FREE, with the
          // headline drawn by our pixel-perfect canvas overlay — guaranteed
          // correct spelling. "Try AI-baked text" re-runs with 'baked' to bake
          // the title into the image (more integrated, but may misspell).
          textMode: opts?.textMode ?? 'clean',
          capturedFrames: capturedFrames.length ? capturedFrames : undefined,
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
      if (!res.ok) throw new Error((data.error as string) || 'Thumbnail generation failed')
      setCapError(null)
      await applyThumbnailResult(data)
    } catch (err) {
      setThumbnailError(err instanceof Error ? err.message : 'Failed to generate thumbnail')
    } finally {
      setGeneratingThumbnail(false)
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
          faceModelId: (selectedFaceModelId && selectedFaceModelId !== 'auto') ? selectedFaceModelId : undefined,
          faceAuto: selectedFaceModelId === 'auto' || undefined,
          styleReferenceUrl: styleReferenceUrl || undefined,
          // Composed scene + crisp canvas title by default (matches the manual
          // Generate button). 'Try AI-baked text' re-runs as 'baked'.
          textMode: 'clean',
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
      if (!res.ok) throw new Error((data.error as string) || 'Thumbnail generation failed')
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

  // ── ⚡ Instant thumbnail — real video frame + AI hook, no generation wait ────
  async function quickThumbnail() {
    if (!video.thumbnailUrl) return
    setInstantLoading(true)
    setThumbnailError(null)
    try {
      let hook = thumbnailHook  // reuse cached hook if available

      if (!hook) {
        // Fast hook-only call — skips all image generation
        const res = await fetch('/api/youtube/generate-thumbnail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quickMode: true,
            videoTitle: editTitle || video.title,
            productTitle: product?.title ?? undefined,
            asin: video.detectedAsin ?? undefined,
            // Honour the locked headline on the instant path too —
            // the server short-circuits the hook agent when this is set.
            customHeadline: customHeadline.trim() || undefined,
          }),
        })
        const data = await res.json() as Record<string, unknown>
        if (data.limitReached) {
          setCapError({
            message: (data.error as string) || 'You\'ve hit your thumbnail cap for this period.',
            info: { cap: (data.cap as string) || 'thumbnails', currentTier: data.currentTier as string | undefined, upgrade: data.upgrade as { tier: string; label: string; limit: number | null } | null | undefined },
          })
          return
        }
        if (!res.ok) throw new Error((data.error as string) || 'Hook generation failed')
        hook = (data.overlayHook as string) || ''
        setThumbnailHook(hook)
      }

      let finalUrl: string = video.thumbnailUrl
      let pickedStyleId: string | null = null
      try {
        const styleIndex = pickWeightedStyleIndex(ytStyleWeights.liked, ytStyleWeights.disliked)
        const overlayed = await addTextOverlay(video.thumbnailUrl, hook, styleIndex)
        finalUrl = overlayed.url
        pickedStyleId = overlayed.styleId
      } catch (overlayErr) {
        console.warn('[instant-overlay]', overlayErr)
        // Fall back to raw YouTube thumbnail — hook still saved for display
      }
      setThumbnailStyleId(pickedStyleId)
      setThumbnailFeedbackSent(null)
      setThumbnailUrl(finalUrl)
      setThumbnailVariants([])
      setSceneAnalysis(null)
      setThumbnailModel('instant')
    } catch (err) {
      setThumbnailError(err instanceof Error ? err.message : 'Instant thumbnail failed')
    } finally {
      setInstantLoading(false)
    }
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
          </div>
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] leading-snug line-clamp-2 mb-2">{video.title}</p>
          <div className="flex items-center gap-2 flex-wrap">
            {generating ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-xs text-[#0071e3] font-medium">
                  <Loader2 size={12} className="animate-spin" />
                  Running AI agent swarm…
                </div>
                <div className="flex flex-wrap gap-1">
                  {(video.detectedAsin
                    ? ['🔬 Product Analyst', '🎯 Title Strategist', '🔍 SEO Researcher', '✍️ Content Writer', '💬 Engagement Agent']
                    : ['🔬 Video Analyst', '🎯 Title Strategist', '🔍 SEO Researcher', '✍️ Description Writer', '💬 Engagement Agent']
                  ).map(a => (
                    <span key={a} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#0071e3]/10 text-[#0071e3] animate-pulse">{a}</span>
                  ))}
                </div>
              </div>
            ) : (
              <button
                onClick={generate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: video.detectedAsin
                  ? 'linear-gradient(135deg, #ff9500 0%, #ff3b30 100%)'
                  : 'linear-gradient(135deg, #0071e3 0%, #5856d6 100%)' }}
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
              className="flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#0071e3] transition-colors">
              <ExternalLink size={11} /> Open in YouTube
            </a>
          </div>
          {error && <p className="text-xs text-[#ff3b30] mt-2">{error}</p>}
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
                    <span className="flex items-center gap-1 text-[#0071e3]">
                      <Link2 size={9} />
                      {geniuslinkUsed ? 'Geniuslink ✓' : affiliateUrl?.includes('?tag=') ? 'Associates link ✓' : 'Plain Amazon link'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Agent Insights */}
          {agentInsights && (agentInsights.topBenefits.length > 0 || agentInsights.painPoints.length > 0) && (
            <div className="mx-5 mb-3 p-3 rounded-xl bg-[#0071e3]/5 border border-[#0071e3]/10">
              <p className="text-[10px] font-semibold text-[#0071e3] mb-2 flex items-center gap-1">
                <Sparkles size={10} /> Agent insights
              </p>
              {agentInsights.targetBuyer && (
                <p className="text-[10px] text-[#6e6e73] dark:text-[#ebebf0] mb-2">
                  <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Target buyer:</span> {agentInsights.targetBuyer}
                </p>
              )}
              <div className="flex gap-4">
                {agentInsights.topBenefits.length > 0 && (
                  <div className="flex-1">
                    <p className="text-[9px] font-semibold text-[#34c759] mb-1">✓ Top benefits</p>
                    {agentInsights.topBenefits.map((b, i) => (
                      <p key={i} className="text-[9px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">• {b}</p>
                    ))}
                  </div>
                )}
                {agentInsights.painPoints.length > 0 && (
                  <div className="flex-1">
                    <p className="text-[9px] font-semibold text-[#ff9500] mb-1">⚡ Pain points solved</p>
                    {agentInsights.painPoints.map((p, i) => (
                      <p key={i} className="text-[9px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">• {p}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Geniuslink warning */}
          {geniuslinkUsed === false && geniuslinkError && (
            <div className="mx-5 mb-3 px-3 py-2 rounded-lg bg-[#ff9500]/10 border border-[#ff9500]/20 text-xs text-[#ff9500]">
              ⚠️ Geniuslink not used — {geniuslinkError}. Go to <strong>Site &amp; Integrations</strong> to add your credentials.
            </div>
          )}

          {/* Toggle expand */}
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-2 w-full px-5 py-3 text-xs font-medium text-[#0071e3] hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {expanded ? 'Hide' : 'Show'} generated metadata
            {applied && <span className="ml-auto flex items-center gap-1 text-[#34c759]"><CheckCircle size={12} /> Applied to YouTube</span>}
          </button>

          {expanded && (
            <div className="px-5 pb-5 flex flex-col gap-5">
              {/* Title */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Title</label>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] ${editTitle.length > 90 ? 'text-[#ff3b30]' : 'text-[#86868b] dark:text-[#8e8e93]'}`}>{editTitle.length}/100</span>
                    <button onClick={() => copy(editTitle, 'title')} className="text-[10px] text-[#0071e3] hover:underline flex items-center gap-0.5">
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
                          className="text-left text-xs text-[#0071e3] hover:underline truncate">
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
                  <button onClick={() => copy(editDesc, 'desc')} className="text-[10px] text-[#0071e3] hover:underline flex items-center gap-0.5">
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
                  <button onClick={() => copy(generated.tags.join(', '), 'tags')} className="text-[10px] text-[#0071e3] hover:underline flex items-center gap-0.5">
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

              {/* Manual: paste in YouTube Studio — items YT API can't push */}
              <div className="rounded-xl border border-[#ff9500]/30 bg-[#ff9500]/5 p-4">
                <div className="flex items-start gap-2 mb-3">
                  <AlertCircle size={14} className="text-[#ff9500] mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Manual: paste these on YouTube after Apply</p>
                    <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
                      YouTube&apos;s API doesn&apos;t allow programmatic pinned comments or end-screen elements. We generate the content — you paste it in (90 seconds).
                    </p>
                  </div>
                </div>

                {/* Pinned comment */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Pinned comment</label>
                    <button onClick={() => copy(generated.pinnedComment, 'pin')} className="text-[10px] text-[#0071e3] hover:underline flex items-center gap-0.5">
                      <Copy size={10} /> {copied === 'pin' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] p-3 rounded-lg bg-white dark:bg-[#1c1c1e] border border-[#d2d2d7] dark:border-[#3a3a3c] leading-relaxed">
                    {generated.pinnedComment}
                  </div>
                  <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-1.5">After the video is public: post this as a comment, then click the three-dot menu → <strong>Pin</strong>.</p>
                </div>

              </div>

              {/* Thumbnail Generator */}
              <div className="border-t border-gray-100 dark:border-white/10 pt-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Image size={13} className="text-[#0071e3]" />
                    <span className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">AI Thumbnail Generator</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#0071e3]/10 text-[#0071e3] font-medium">1280×720</span>
                  </div>
                </div>

                {/* Optional style reference — inline control. Variants
                    were removed; we always generate one thumbnail to keep
                    token spend predictable. The headline question is asked
                    via modal at click-time. */}
                <div className="mb-3 p-3 rounded-lg bg-[#f5f5f7] dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
                      Style reference <span className="text-[#86868b] dark:text-[#8e8e93] font-normal">(optional — upload a thumbnail whose look you want to match)</span>
                    </label>
                    {styleReferenceUrl ? (
                      <div className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={styleReferenceUrl} alt="Style reference" className="w-16 h-9 object-cover rounded-md border border-gray-200 dark:border-white/10" />
                        <span className="text-[11px] text-[#34c759] flex items-center gap-1">
                          <CheckCircle size={11} /> Style locked in
                        </span>
                        <button
                          type="button"
                          onClick={() => setStyleReferenceUrl(null)}
                          disabled={generatingThumbnail || instantLoading}
                          className="text-[11px] text-[#86868b] hover:text-[#ff3b30] ml-1"
                          title="Remove style reference"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <label className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border cursor-pointer transition-colors ${styleRefUploading ? 'opacity-60 cursor-wait' : 'hover:border-[#0071e3]'}`}
                        style={{ borderColor: '#d2d2d7', color: '#1d1d1f', background: 'white' }}>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          disabled={generatingThumbnail || instantLoading || styleRefUploading}
                          onChange={(e) => {
                            const f = e.target.files?.[0]
                            if (f) handleStyleReferenceUpload(f)
                            e.target.value = ''
                          }}
                        />
                        {styleRefUploading
                          ? <><Loader2 size={11} className="animate-spin" /> Uploading…</>
                          : <><Upload size={11} /> Upload style reference</>}
                      </label>
                    )}
                  </div>
                </div>

                {/* Optional: upload your OWN photo (you + the product). When
                    set, we clean it up / re-render it into a polished
                    thumbnail scene and overlay the title — no AI scene, no
                    face cut-out. */}
                <div className="mb-3 p-3 rounded-lg bg-[#f5f5f7] dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10">
                  <label className="block text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
                    Use your own photo <span className="text-[#86868b] dark:text-[#8e8e93] font-normal">(optional — a photo of YOU with the product; we clean it up &amp; re-render it)</span>
                  </label>
                  {uploadedPhotoUrl ? (
                    <div className="flex items-center gap-2 mb-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={uploadedPhotoUrl} alt="Your photo" className="w-16 h-9 object-cover rounded-md border border-gray-200 dark:border-white/10" />
                      <span className="text-[11px] text-[#34c759] flex items-center gap-1"><CheckCircle size={11} /> Photo added</span>
                      <button
                        type="button"
                        onClick={() => { setUploadedPhotoUrl(null); setCleanupPrompt('') }}
                        disabled={generatingThumbnail || instantLoading}
                        className="text-[11px] text-[#86868b] hover:text-[#ff3b30] ml-1"
                        title="Remove your photo"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <label className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border cursor-pointer transition-colors ${photoUploading ? 'opacity-60 cursor-wait' : 'hover:border-[#0071e3]'}`}
                      style={{ borderColor: '#d2d2d7', color: '#1d1d1f', background: 'white' }}>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        disabled={generatingThumbnail || instantLoading || photoUploading}
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) handlePhotoUpload(f)
                          e.target.value = ''
                        }}
                      />
                      {photoUploading
                        ? <><Loader2 size={11} className="animate-spin" /> Uploading…</>
                        : <><Upload size={11} /> Upload your photo</>}
                    </label>
                  )}
                  {uploadedPhotoUrl && (
                    <input
                      type="text"
                      value={cleanupPrompt}
                      onChange={(e) => setCleanupPrompt(e.target.value)}
                      maxLength={400}
                      placeholder="Optional direction — e.g. bright kitchen, surprised face"
                      disabled={generatingThumbnail || instantLoading}
                      className="mt-1 w-full text-[11px] px-2 py-1 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                    />
                  )}
                </div>

                {/* Generate buttons */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <button
                    onClick={() => {
                      // Open the headline-decision modal first — generation
                      // only fires once the user explicitly picks auto/manual.
                      setHeadlinePromptChoice(customHeadline.trim() ? 'manual' : 'auto')
                      setHeadlinePromptOpen(true)
                    }}
                    disabled={generatingThumbnail || instantLoading}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-60 transition-opacity hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg, #0071e3 0%, #5856d6 100%)' }}
                  >
                    {generatingThumbnail
                      ? <><Loader2 size={12} className="animate-spin" /> Generating…</>
                      : <><Sparkles size={12} /> {thumbnailUrl ? 'Regenerate' : 'Generate Thumbnail'}</>}
                  </button>

                  {video.thumbnailUrl && (
                    <button
                      onClick={quickThumbnail}
                      disabled={generatingThumbnail || instantLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-60 transition-opacity hover:opacity-80 border"
                      style={{ background: '#1c1c1e', borderColor: '#3a3a3c', color: '#f5f5f7' }}
                      title="Uses your real video frame + AI hook. No generation wait."
                    >
                      {instantLoading
                        ? <><Loader2 size={12} className="animate-spin" /> Generating hook…</>
                        : <>⚡ Instant</>}
                    </button>
                  )}

                  {/* Upload your own — skips AI, uses the user's file as-is. */}
                  <label
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer disabled:opacity-60 transition-opacity hover:bg-gray-50 dark:hover:bg-white/5"
                    style={{ borderColor: '#d2d2d7', color: '#1d1d1f' }}
                    title="Use your own thumbnail (JPG/PNG, ≤ 2 MB, 1280×720 recommended)"
                  >
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/bmp"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (f) handleThumbnailUpload(f)
                        e.target.value = '' // allow re-uploading the same file
                      }}
                      disabled={generatingThumbnail || instantLoading}
                    />
                    <Upload size={12} /> Upload your own
                  </label>
                </div>

                {/* Test & Compare: how many variants to generate per click. More
                    variants = more options to A/B test, but each counts once
                    against your thumbnail allowance. */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="text-[11px] text-[#86868b]">Variants to compare:</span>
                  {[1, 2, 3].map(n => (
                    <button
                      key={n}
                      onClick={() => setVariantCount(n)}
                      disabled={generatingThumbnail || instantLoading}
                      className={`text-[11px] w-7 h-7 rounded-md border font-semibold transition disabled:opacity-60 ${variantCount === n ? 'bg-[#0071e3] border-[#0071e3] text-white' : 'border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#0071e3]'}`}
                      title={`Generate ${n} variant${n > 1 ? 's' : ''} (${n} thumbnail credit${n > 1 ? 's' : ''})`}
                    >
                      {n}
                    </button>
                  ))}
                </div>

                {/* "Your Face" picker — choose WHICH uploaded face to lock into
                    the thumbnail (e.g. Seb vs Michelle), or Off to rely on the
                    video frame alone. Manage faces in Face Training. */}
                {faceModels.length > 0 ? (
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className="text-[11px] text-[#86868b]">Use my face:</span>
                    <button
                      onClick={() => setSelectedFaceModelId('auto')}
                      disabled={generatingThumbnail || instantLoading}
                      className={`text-[11px] px-2.5 h-7 rounded-md border font-semibold transition disabled:opacity-60 ${selectedFaceModelId === 'auto' ? 'bg-[#0071e3] border-[#0071e3] text-white' : 'border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#0071e3]'}`}
                      title="Auto — we match the video to the right person from your faces"
                    >
                      Auto
                    </button>
                    <button
                      onClick={() => setSelectedFaceModelId(null)}
                      disabled={generatingThumbnail || instantLoading}
                      className={`text-[11px] px-2.5 h-7 rounded-md border font-semibold transition disabled:opacity-60 ${selectedFaceModelId === null ? 'bg-[#0071e3] border-[#0071e3] text-white' : 'border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#0071e3]'}`}
                      title="Don't lock a face — use the video frame's host as-is"
                    >
                      Off
                    </button>
                    {faceModels.map(fm => (
                      <button
                        key={fm.id}
                        onClick={() => setSelectedFaceModelId(fm.id)}
                        disabled={generatingThumbnail || instantLoading}
                        className={`text-[11px] px-2.5 h-7 rounded-md border font-semibold transition disabled:opacity-60 ${selectedFaceModelId === fm.id ? 'bg-[#0071e3] border-[#0071e3] text-white' : 'border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#0071e3]'}`}
                        title={`Lock the host's likeness to "${fm.name}" using your uploaded photos`}
                      >
                        {fm.name}
                      </button>
                    ))}
                    <span className="text-[10px] text-[#86868b]">— locks that person&apos;s likeness from your photos</span>
                  </div>
                ) : (
                  <p className="text-[10px] text-[#86868b] mb-3">
                    Want the host to look more like you? Add your photos in{' '}
                    <a href="/face-training" className="text-[#0071e3] hover:underline">Face Training</a> — they&apos;ll lock your likeness into every thumbnail.
                  </p>
                )}

                {thumbnailError && (
                  <p className="text-xs text-[#ff3b30] mb-3">{thumbnailError}</p>
                )}

                {/* Result */}
                {thumbnailUrl && (
                  <div className="flex flex-col gap-2">
                    <div className="rounded-xl overflow-hidden border border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-white/5">
                      <img src={thumbnailUrl} alt="Generated thumbnail" className="w-full object-cover" style={{ aspectRatio: '16/9' }} />
                    </div>

                    {/* Test & Compare grid — when 2+ variants were generated,
                        show them ranked (best-first) with their CTR score.
                        Click one to make it the active preview / download /
                        apply target. The top variant is pre-selected. */}
                    {thumbnailVariants.length > 1 && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[11px] text-[#86868b]">Compare variants — click to select (★ = highest predicted CTR)</span>
                        <div className="grid grid-cols-3 gap-2">
                          {thumbnailVariants.map((v, i) => {
                            const selected = v.url === thumbnailUrl
                            return (
                              <button
                                key={v.url}
                                onClick={() => { setThumbnailUrl(v.url); setThumbnailFeedbackSent(null) }}
                                className={`relative rounded-lg overflow-hidden border-2 transition ${selected ? 'border-[#0071e3]' : 'border-transparent hover:border-gray-300 dark:hover:border-white/20'}`}
                                title={v.score !== null ? `Predicted CTR score: ${v.score}/100` : 'Variant'}
                              >
                                <img src={v.url} alt={`Variant ${i + 1}`} className="w-full object-cover" style={{ aspectRatio: '16/9' }} />
                                <span className="absolute top-1 left-1 text-[9px] px-1.5 py-0.5 rounded-full bg-black/60 text-white font-semibold">
                                  {i === 0 ? '★ ' : ''}{v.score !== null ? `${v.score}` : `#${i + 1}`}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                        <p className="text-[10px] text-[#86868b] leading-snug">
                          A/B test on YouTube: publish your top pick, then after ~a week swap to the runner-up from <span className="font-medium">YouTube → Content → Edit → Thumbnail</span> and compare impressions-CTR in <span className="font-medium">Analytics → Content</span>. Keep the winner.
                        </p>
                      </div>
                    )}
                    {/* Visual Style Analysis text was here — removed so the
                        AI's internal prompt/notes aren't surfaced to users. */}
                    <div className="flex items-center gap-3 flex-wrap">
                      {thumbnailUrl.startsWith('data:') ? (
                        // Canvas data URL — use a regular <a> with href
                        <a
                          href={thumbnailUrl}
                          download="thumbnail.jpg"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
                          style={{ background: '#34c759' }}
                        >
                          <Download size={12} /> Download Thumbnail
                        </a>
                      ) : (
                        <a
                          href={thumbnailUrl}
                          download="thumbnail.jpg"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
                          style={{ background: '#34c759' }}
                        >
                          <Download size={12} /> Download Thumbnail
                        </a>
                      )}
                      {/* Composed designed thumbnail — default draws the title
                          via crisp canvas overlay (perfect spelling); the baked
                          variant integrates it into the image (may misspell). */}
                      {thumbnailFaceUsed && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#0071e3]/10 text-[#0071e3] font-medium" title="Face locked to this person's photos (auto-matched)">
                          👤 {thumbnailFaceUsed}
                        </span>
                      )}
                      {(thumbnailModel === 'nano-banana-pro' || thumbnailModel === 'nano-banana') && (
                        <>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#34c759]/10 text-[#34c759] font-medium">
                            ✨ Designed · crisp text
                          </span>
                          <button
                            onClick={() => generateThumbnail({ textMode: 'baked' })}
                            disabled={generatingThumbnail}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-white/10 hover:border-[#5856d6] text-[#1d1d1f] dark:text-[#f5f5f7] transition disabled:opacity-60"
                            title="Re-render with the headline baked into the image by the AI (more integrated, but may have typos)"
                          >
                            <RefreshCw size={12} /> Try AI-baked text
                          </button>
                        </>
                      )}
                      {(thumbnailModel === 'nano-banana-pro-baked' || thumbnailModel === 'nano-banana-baked') && (
                        <>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#5856d6]/10 text-[#5856d6] font-medium">
                            ✨ Designed · baked text (may have typos)
                          </span>
                          <button
                            onClick={() => generateThumbnail({ textMode: 'clean' })}
                            disabled={generatingThumbnail}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-white/10 hover:border-[#0071e3] text-[#1d1d1f] dark:text-[#f5f5f7] transition disabled:opacity-60"
                            title="Re-render with the headline drawn as a crisp, perfect overlay instead of baked into the image"
                          >
                            <RefreshCw size={12} /> Switch to crisp text
                          </button>
                        </>
                      )}
                      {thumbnailModel === 'upload' && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#0071e3]/10 text-[#0071e3] font-medium">
                          📤 Your upload
                        </span>
                      )}
                      {thumbnailModel === 'instant' && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#34c759]/10 text-[#34c759] font-medium">
                          ⚡ Instant — your real frame
                        </span>
                      )}
                      {/* "Copy prompt" button removed — internal AI prompt
                          shouldn't be exposed to users. */}
                    </div>
                    {/* 👍 / 👎 feedback row — only when we have a styleId
                        (i.e. the overlay actually ran on this thumbnail).
                        Uploads and raw video frames without overlay skip
                        this. Drives the weighted style picker. */}
                    {thumbnailModel !== 'upload' && (
                      <div className="flex items-center gap-2 pt-1">
                        <span className="text-[10px] text-[#86868b]">Train the AI:</span>
                        <button
                          onClick={() => submitYtThumbnailFeedback('like')}
                          disabled={thumbnailFeedbackSent !== null}
                          className={`text-[11px] px-2 py-0.5 rounded border transition ${thumbnailFeedbackSent === 'like' ? 'bg-[#34c759]/20 border-[#34c759] text-[#34c759]' : 'border-gray-200 dark:border-white/10 hover:border-[#34c759]'} disabled:opacity-60`}
                          title="I'd use this style"
                        >
                          👍
                        </button>
                        <button
                          onClick={() => submitYtThumbnailFeedback('dislike')}
                          disabled={thumbnailFeedbackSent !== null}
                          className={`text-[11px] px-2 py-0.5 rounded border transition ${thumbnailFeedbackSent === 'dislike' ? 'bg-[#ff3b30]/20 border-[#ff3b30] text-[#ff3b30]' : 'border-gray-200 dark:border-white/10 hover:border-[#ff3b30]'} disabled:opacity-60`}
                          title="Not this style"
                        >
                          👎
                        </button>
                        {thumbnailFeedbackSent && (
                          <span className="text-[10px] text-[#86868b]">Thanks — saved.</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Pro batch-apply settings panel — Pro/admin only */}
              {isPro && (
                <div className="border border-[#0071e3]/20 bg-[#0071e3]/5 rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#0071e3] text-white font-semibold uppercase tracking-wide">Pro</span>
                    <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">One-click Studio settings</p>
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
              <div className="flex flex-col gap-2 pt-1">
                <div className="flex items-center gap-3">
                  <button
                    onClick={applyToYouTube}
                    disabled={applying || applied}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60 transition-colors"
                    style={{ background: applied ? '#34c759' : '#ff0000' }}
                  >
                    {applying ? <><Loader2 size={14} className="animate-spin" /> {proSettings.privacyStatus === 'draft' ? 'Saving draft…' : 'Applying…'}</>
                      : applied ? <><CheckCircle size={14} /> {proSettings.privacyStatus === 'draft' ? 'Saved to draft' : 'Applied to YouTube'}</>
                      : <><Youtube size={14} /> {proSettings.privacyStatus === 'draft' ? 'Save draft to YouTube' : 'Apply to YouTube'}</>}
                  </button>
                  <button onClick={generate} disabled={generating}
                    className="flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#0071e3] transition-colors">
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
              Who writes the thumbnail headline?
            </h3>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
              The headline is the text that gets overlaid on top of the thumbnail. Pick now so the AI knows whether to leave you negative space.
            </p>

            <div className="flex flex-col gap-2 mb-4">
              <label
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  headlinePromptChoice === 'auto'
                    ? 'border-[#0071e3] bg-[#0071e3]/5'
                    : 'border-gray-200 dark:border-white/10 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="headline-choice"
                  checked={headlinePromptChoice === 'auto'}
                  onChange={() => setHeadlinePromptChoice('auto')}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Let MVP write it</p>
                  <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
                    AI generates a 2-3 word punchy hook based on your video title.
                  </p>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  headlinePromptChoice === 'manual'
                    ? 'border-[#0071e3] bg-[#0071e3]/5'
                    : 'border-gray-200 dark:border-white/10 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="headline-choice"
                  checked={headlinePromptChoice === 'manual'}
                  onChange={() => setHeadlinePromptChoice('manual')}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">I&apos;ll write my own title</p>
                  <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 mb-2">
                    Type the exact text. We&apos;ll overlay it crisply on the AI-generated background.
                  </p>
                  {headlinePromptChoice === 'manual' && (
                    <input
                      type="text"
                      value={customHeadline}
                      onChange={(e) => setCustomHeadline(e.target.value)}
                      placeholder="e.g. WORTH IT?"
                      maxLength={40}
                      autoFocus
                      className="w-full text-xs px-2.5 py-1.5 rounded-md bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] focus:border-[#0071e3] focus:outline-none uppercase tracking-wide"
                    />
                  )}
                </div>
              </label>
            </div>

            {/* Face picker removed — thumbnails now ground on the real video
                frame (the creator + product are already in it), so no face
                upload is needed. */}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setHeadlinePromptOpen(false)}
                className="px-3 py-2 rounded-lg text-xs font-medium text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  // Apply the choice: blank headline if "auto", or whatever
                  // the user typed if "manual". Then fire the existing
                  // generate flow which already reads customHeadline state.
                  if (headlinePromptChoice === 'auto') setCustomHeadline('')
                  setHeadlinePromptOpen(false)
                  // Defer the fetch so the customHeadline state update lands first.
                  setTimeout(() => { generateThumbnail() }, 0)
                }}
                disabled={headlinePromptChoice === 'manual' && customHeadline.trim().length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Sparkles size={11} /> Start generation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function StudioPage() {
  const supabase = createBrowserClient()
  const [drafts, setDrafts] = useState<DraftVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [needsAuth, setNeedsAuth] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasGeniuslink, setHasGeniuslink] = useState(false)
  const [userTier, setUserTier] = useState<'trial' | 'creator' | 'pro' | 'admin'>('trial')
  const [playlists, setPlaylists] = useState<Array<{ id: string; title: string }>>([])
  // Pagination
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined)
  const [pageHistory, setPageHistory] = useState<string[]>([]) // stack of previous page tokens
  const [currentPage, setCurrentPage] = useState(1)

  const load = useCallback(async (pageToken?: string) => {
    setLoading(true)
    setError(null)

    if (!pageToken) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const intResult = await (supabase as any).from('integrations').select('geniuslink_api_key,tier').eq('user_id', user.id).single()
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

    const url = pageToken ? `/api/youtube/drafts?pageToken=${encodeURIComponent(pageToken)}` : '/api/youtube/drafts'
    const res = await fetch(url)
    const data = await res.json()
    if (res.status === 401 && data.needsAuth) {
      setNeedsAuth(true)
    } else if (!res.ok) {
      setError(data.error || 'Failed to load videos')
    } else {
      setDrafts(data.drafts || [])
      setNextPageToken(data.nextPageToken)
    }
    setLoading(false)
  }, [supabase])

  const goNext = useCallback(() => {
    if (!nextPageToken) return
    setPageHistory(h => [...h, nextPageToken])
    setCurrentPage(p => p + 1)
    load(nextPageToken)
  }, [nextPageToken, load])

  const goPrev = useCallback(() => {
    const history = [...pageHistory]
    history.pop()
    const prevToken = history[history.length - 1]
    setPageHistory(history)
    setCurrentPage(p => p - 1)
    load(prevToken)
  }, [pageHistory, load])

  const refresh = useCallback(() => {
    setPageHistory([])
    setCurrentPage(1)
    setNextPageToken(undefined)
    load()
  }, [load])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div>
        <Header title="YouTube Co-Pilot" subtitle="Generate viral title ideas, a description, tags, hashtags and a thumbnail for any video — then push it all back to YouTube in one click. Add the Amazon ASIN to your title for an exact product review with affiliate links." />
        <div className="flex items-center justify-center py-20 text-[#86868b] dark:text-[#8e8e93] text-sm">
          <Loader2 size={16} className="animate-spin mr-2" /> Loading your videos…
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header
        title="YouTube Co-Pilot"
        subtitle="Generate viral title ideas, a description, tags, hashtags and a thumbnail for any video — then push it all back to YouTube in one click. Add the Amazon ASIN to your title for an exact product review with affiliate links."
      />

      <TutorialVideo sectionKey="studio" />

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
            <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Geniuslink not connected.</strong> We&apos;ll fall back to plain US Amazon links, which means you only earn on .com traffic. Add your Geniuslink API key in <a href="/setup?tab=integrations" className="text-[#0071e3] hover:underline">Site &amp; Integrations</a> to geo-route every click to the right Amazon storefront.
          </p>
        </div>
      )}

      {/* How-it-works disclaimer — always visible once connected */}
      {!needsAuth && (
        <div className="card p-4 mb-5 flex items-start gap-3 border border-[#0071e3]/20 bg-[#0071e3]/5">
          <div className="w-7 h-7 rounded-lg bg-[#0071e3]/15 flex items-center justify-center flex-shrink-0">
            <AlertCircle size={14} className="text-[#0071e3]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Reviewing an Amazon product? Put the ASIN in your title for the best result</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
              If your video reviews an Amazon product, drop the 10-character ASIN into the YouTube title (or the video file name) — e.g.{' '}
              <span className="font-mono text-[#1d1d1f] dark:text-[#f5f5f7] bg-white dark:bg-[#1c1c1e] px-1.5 py-0.5 rounded border border-[#d2d2d7] dark:border-[#3a3a3c]">Vacuum - B08TT4YHG1</span>.
              That pins the exact product so we pull its real Amazon data and add your affiliate link. <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">It&apos;s optional, though</strong> — with no ASIN we try to identify the product from your title automatically, and if it isn&apos;t a product video we still generate title ideas, description, tags, hashtags and thumbnail around your topic (just no affiliate link).
            </p>
          </div>
        </div>
      )}

      {!needsAuth && !error && (
        <>
          <div className="flex items-center justify-between mb-5">
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Page {currentPage} · {drafts.length} video{drafts.length !== 1 ? 's' : ''}</p>
            <button onClick={refresh} className="flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#0071e3] transition-colors">
              <RefreshCw size={11} /> Refresh
            </button>
          </div>

          {drafts.length === 0 ? (
            <div className="card p-8 text-center">
              <Youtube size={28} className="mx-auto text-[#86868b] dark:text-[#8e8e93] mb-3" />
              <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">No ASIN drafts yet</p>
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93] max-w-md mx-auto">Drop an Amazon ASIN (the 10-character code like <span className="font-mono text-[#1d1d1f] dark:text-[#f5f5f7]">B08N5WRWNW</span>) anywhere in your YouTube video title. Save the draft, hit Refresh, and it&apos;ll show up here ready to generate.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-4">
                {drafts.map(video => (
                  <VideoStudioCard key={video.youtubeVideoId} video={video} userTier={userTier} playlists={playlists} />
                ))}
              </div>

              {/* Pagination */}
              {(currentPage > 1 || nextPageToken) && (
                <div className="flex items-center justify-between mt-6">
                  <button
                    onClick={goPrev}
                    disabled={currentPage <= 1 || loading}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl border border-[#d2d2d7] dark:border-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#1c1c1e] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft size={15} /> Previous
                  </button>
                  <span className="text-xs text-[#86868b] dark:text-[#8e8e93]">Page {currentPage}</span>
                  <button
                    onClick={goNext}
                    disabled={!nextPageToken || loading}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl border border-[#d2d2d7] dark:border-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#1c1c1e] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next <ChevronRight size={15} />
                  </button>
                </div>
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
