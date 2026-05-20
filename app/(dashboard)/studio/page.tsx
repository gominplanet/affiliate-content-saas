'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import Header from '@/components/layout/Header'
import { TutorialVideo } from '@/components/TutorialVideo'
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
  userTier: 'free' | 'starter' | 'growth' | 'pro' | 'admin'
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
  const [sceneAnalysis, setSceneAnalysis] = useState<string | null>(null)
  const [generatingThumbnail, setGeneratingThumbnail] = useState(false)
  const [thumbnailError, setThumbnailError] = useState<string | null>(null)
  const [instantLoading, setInstantLoading] = useState(false)

  useEffect(() => {
    if (generated) {
      setEditTitle(generated.title)
      setEditDesc(generated.description)
      setExpanded(true)
    }
  }, [generated])

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
      if (!res.ok) throw new Error((data.error as string) || 'Generation failed')
      setError(null)

      const generatedMeta = data.generated as GeneratedMetadata
      const productData = data.product as ProductInfo
      const productBullets = data.productBullets as string[]
      const productDescription = data.productDescription as string

      setGenerated(generatedMeta)
      setAgentInsights((data.agentInsights ?? null) as AgentInsights | null)
      setProduct({ ...productData, bullets: productBullets, description: productDescription })
      setAffiliateUrl(data.affiliateUrl as string)
      setGeniuslinkUsed((data.geniuslinkUsed ?? false) as boolean)
      setGeniuslinkError((data.geniuslinkError ?? null) as string | null)

      // ── Auto-generate thumbnail immediately after metadata ─────────────────
      // Fire-and-forget — pass product text data directly, no re-fetch needed
      generateThumbnailWithData({
        productTitle: productData?.title ?? undefined,
        productDescription: productDescription ?? undefined,
        productBullets: productBullets ?? undefined,
        title: generatedMeta.title,
      })
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

      // Free / Starter / Growth — metadata + thumbnail only (no batch settings)
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
    const rawUrl = data.thumbnailUrl as string

    // Flux returns a clean image — apply canvas text overlay on top
    let finalUrl = rawUrl
    if (hook) {
      try {
        finalUrl = await addTextOverlay(rawUrl, hook)
      } catch (overlayErr) {
        console.warn('[thumbnail-overlay]', overlayErr)
        // Fall back to raw image without text
      }
    }

    setThumbnailUrl(finalUrl)
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
      setThumbnailPrompt(null)
      setThumbnailModel('upload')
      setThumbnailHook(null)
    }
    reader.readAsDataURL(file)
  }

  async function generateThumbnail() {
    setGeneratingThumbnail(true)
    setThumbnailError(null)
    try {
      const res = await fetch('/api/youtube/generate-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoTitle: editTitle || video.title,
          asin: video.detectedAsin ?? undefined,
          productTitle: product?.title ?? undefined,
          productDescription: product?.description ?? undefined,
          productBullets: product?.bullets ?? undefined,
          style: 'lifestyle',
        }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error((data.error as string) || 'Thumbnail generation failed')
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
          productTitle: overrides.productTitle ?? undefined,
          productDescription: overrides.productDescription ?? undefined,
          productBullets: overrides.productBullets ?? undefined,
          style: 'lifestyle',
        }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error((data.error as string) || 'Thumbnail generation failed')
      await applyThumbnailResult(data)
    } catch (err) {
      setThumbnailError(err instanceof Error ? err.message : 'Failed to generate thumbnail')
    } finally {
      setGeneratingThumbnail(false)
    }
  }

  // ── Thumbnail text-overlay styles ────────────────────────────────────────────
  // 4 visually distinct presets. One is picked randomly per generation so each
  // thumbnail looks different. Fonts are loaded from Google Fonts on demand.
  const OVERLAY_STYLES = [
    {
      // Classic YouTube: yellow + white Impact, bottom-left, dark gradient
      id: 'impact-classic',
      fontName: null as string | null,          // system font — no load needed
      fontStack: 'Impact, "Arial Black", sans-serif',
      weight: '900',
      colors: ['#FFE034', '#FFFFFF'],
      outlineColor: '#000',
      outlineW: 14,
      shadowAlpha: 0.8,
      maxPx: 112,
      position: 'bottom-left' as const,
      gradient: true,
    },
    {
      // Bebas Neue: all-white modern condensed, bottom-left, subtle gradient
      id: 'bebas-white',
      fontName: 'Bebas Neue',
      fontStack: '"Bebas Neue", Impact, sans-serif',
      weight: '400',
      colors: ['#FFFFFF', '#FFFFFF'],
      outlineColor: '#000',
      outlineW: 10,
      shadowAlpha: 0.9,
      maxPx: 124,
      position: 'bottom-left' as const,
      gradient: true,
    },
    {
      // Bangers: orange + white, energetic, top-left
      id: 'bangers-orange',
      fontName: 'Bangers',
      fontStack: '"Bangers", Impact, sans-serif',
      weight: '400',
      colors: ['#FF6B00', '#FFFFFF'],
      outlineColor: '#000',
      outlineW: 13,
      shadowAlpha: 0.85,
      maxPx: 118,
      position: 'top-left' as const,
      gradient: false,
    },
    {
      // Oswald: red + white, bold & authoritative, bottom-left
      id: 'oswald-red',
      fontName: 'Oswald',
      fontStack: '"Oswald", Impact, sans-serif',
      weight: '700',
      colors: ['#FF3B30', '#FFFFFF'],
      outlineColor: '#000',
      outlineW: 12,
      shadowAlpha: 0.8,
      maxPx: 108,
      position: 'bottom-left' as const,
      gradient: true,
    },
  ]

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
  async function addTextOverlay(rawUrl: string, hookText: string, styleIndex?: number): Promise<string> {
    const style = OVERLAY_STYLES[styleIndex ?? Math.floor(Math.random() * OVERLAY_STYLES.length)]
    await loadOverlayFont(style.fontName)

    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1280
      canvas.height = 720
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas not supported')); return }

      const text = hookText.replace(/\bhonest\b/gi, '').replace(/\s{2,}/g, ' ').trim().toUpperCase()
      const words = text.split(' ')
      let lines: string[]
      if (words.length === 1) {
        lines = [words[0]]
      } else {
        const split = Math.ceil(words.length / 2)
        lines = [words.slice(0, split).join(' '), words.slice(split).join(' ')].filter(Boolean)
      }

      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        ctx.drawImage(img, 0, 0, 1280, 720)

        const MARGIN_X = 48
        const MARGIN_EDGE = 52   // bottom or top margin
        const ZONE_W = 680       // max text width (left ~53% of frame)
        const { outlineW: OUTLINE, colors: LINE_COLORS, outlineColor, shadowAlpha, maxPx } = style

        const makeFont = (s: number) => `${style.weight} ${s}px ${style.fontStack}`
        let fs = maxPx
        ctx.font = makeFont(fs)
        while (fs > 48) {
          const maxW = Math.max(...lines.map(l => ctx.measureText(l).width))
          if (maxW <= ZONE_W - OUTLINE * 2) break
          fs -= 4
          ctx.font = makeFont(fs)
        }

        const lineH = fs * 1.18
        const totalH = lines.length * lineH

        // Position anchor
        const startY = style.position === 'top-left'
          ? MARGIN_EDGE
          : 720 - MARGIN_EDGE - totalH

        // Background gradient (bottom styles only)
        if (style.gradient) {
          const gradH = totalH + MARGIN_EDGE + 20
          const gradY = style.position === 'top-left' ? 0 : 720 - gradH
          const grad = ctx.createLinearGradient(0, gradY, 0, gradY + gradH)
          if (style.position === 'top-left') {
            grad.addColorStop(0, `rgba(0,0,0,0.6)`)
            grad.addColorStop(1, 'rgba(0,0,0,0)')
          } else {
            grad.addColorStop(0, 'rgba(0,0,0,0)')
            grad.addColorStop(1, `rgba(0,0,0,0.65)`)
          }
          ctx.fillStyle = grad
          ctx.fillRect(0, gradY, 1280, gradH)
        }

        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.lineJoin = 'round'

        lines.forEach((line, i) => {
          const x = MARGIN_X
          const y = startY + i * lineH

          ctx.font = makeFont(fs)
          ctx.shadowColor = `rgba(0,0,0,${shadowAlpha})`
          ctx.shadowBlur = 10
          ctx.shadowOffsetX = 4
          ctx.shadowOffsetY = 4

          ctx.lineWidth = OUTLINE
          ctx.strokeStyle = outlineColor
          ctx.strokeText(line, x, y)

          ctx.shadowBlur = 0
          ctx.shadowOffsetX = 0
          ctx.shadowOffsetY = 0
          ctx.fillStyle = LINE_COLORS[i] ?? LINE_COLORS[LINE_COLORS.length - 1]
          ctx.fillText(line, x, y)
        })

        resolve(canvas.toDataURL('image/jpeg', 0.95))
      }
      img.onerror = () => reject(new Error('Failed to load image for overlay'))
      img.src = rawUrl.startsWith('data:') ? rawUrl : `/api/proxy-image?url=${encodeURIComponent(rawUrl)}`
    })
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
          }),
        })
        const data = await res.json() as Record<string, unknown>
        if (!res.ok) throw new Error((data.error as string) || 'Hook generation failed')
        hook = (data.overlayHook as string) || ''
        setThumbnailHook(hook)
      }

      let finalUrl: string = video.thumbnailUrl
      try {
        finalUrl = await addTextOverlay(video.thumbnailUrl, hook)
      } catch (overlayErr) {
        console.warn('[instant-overlay]', overlayErr)
        // Fall back to raw YouTube thumbnail — hook still saved for display
      }
      setThumbnailUrl(finalUrl)
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
            {video.detectedAsin ? (
              generating ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-xs text-[#0071e3] font-medium">
                    <Loader2 size={12} className="animate-spin" />
                    Running AI agent swarm…
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {['🔬 Product Analyst', '🎯 Title Strategist', '🔍 SEO Researcher', '✍️ Content Writer', '💬 Engagement Agent'].map(a => (
                      <span key={a} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#0071e3]/10 text-[#0071e3] animate-pulse">{a}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <button
                  onClick={generate}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, #ff9500 0%, #ff3b30 100%)' }}
                >
                  <Wand2 size={12} />
                  {generated ? 'Regenerate' : 'Generate YouTube metadata'}
                </button>
              )
            ) : (
              <span className="text-xs text-[#86868b] dark:text-[#8e8e93]">
                No ASIN in the title — add the 10-character Amazon code (e.g. <span className="font-mono text-[#1d1d1f] dark:text-[#f5f5f7]">B08N5WRWNW</span>) anywhere in the video title to unlock generation.
              </span>
            )}
            <a href={ytUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#0071e3] transition-colors">
              <ExternalLink size={11} /> Open in YouTube
            </a>
          </div>
          {error && <p className="text-xs text-[#ff3b30] mt-2">{error}</p>}
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
                <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{product.title}</p>
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
                    <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Manual: paste these in YouTube Studio after Apply</p>
                    <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
                      YouTube&apos;s API doesn&apos;t allow programmatic pinned comments or end-screen elements. We generate the content — you paste it in (90 seconds).
                    </p>
                  </div>
                </div>

                {/* Pinned comment */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">1. Pinned comment</label>
                    <button onClick={() => copy(generated.pinnedComment, 'pin')} className="text-[10px] text-[#0071e3] hover:underline flex items-center gap-0.5">
                      <Copy size={10} /> {copied === 'pin' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] p-3 rounded-lg bg-white dark:bg-[#1c1c1e] border border-[#d2d2d7] dark:border-[#3a3a3c] leading-relaxed">
                    {generated.pinnedComment}
                  </div>
                  <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-1.5">After the video is public: post this as a comment, then click the three-dot menu → <strong>Pin</strong>.</p>
                </div>

                {/* End-screen checklist */}
                <div>
                  <label className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] block mb-1.5">2. End screen (last 5–20 seconds)</label>
                  <div className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] p-3 rounded-lg bg-white dark:bg-[#1c1c1e] border border-[#d2d2d7] dark:border-[#3a3a3c] leading-relaxed">
                    <p className="font-semibold mb-1.5">Recommended layout — three elements:</p>
                    <ul className="list-disc list-inside flex flex-col gap-1 text-[#3a3a3c] dark:text-[#ebebf0]">
                      <li><strong>Subscribe button</strong> — bottom-right corner</li>
                      <li><strong>Video element</strong> — bottom-left, set to &quot;Best for viewer&quot; (YouTube picks your top related video automatically)</li>
                      <li><strong>Playlist or video</strong> — top-right, link to a related review or your channel&apos;s top playlist</li>
                    </ul>
                  </div>
                  <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-1.5">In Studio: open the video → <strong>Editor</strong> → <strong>End screen</strong> → add elements at the timestamp of your outro.</p>
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

                {/* Generate buttons */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <button
                    onClick={generateThumbnail}
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

                {thumbnailError && (
                  <p className="text-xs text-[#ff3b30] mb-3">{thumbnailError}</p>
                )}

                {/* Result */}
                {thumbnailUrl && (
                  <div className="flex flex-col gap-2">
                    <div className="rounded-xl overflow-hidden border border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-white/5">
                      <img src={thumbnailUrl} alt="Generated thumbnail" className="w-full object-cover" style={{ aspectRatio: '16/9' }} />
                    </div>
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
                        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">Finish in Studio (3 clicks)</p>
                        <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
                          YouTube&apos;s API doesn&apos;t accept these fields — open Studio and tick them once. Takes 10 seconds.
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
                      <Youtube size={11} /> Open this video in Studio <ExternalLink size={10} />
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
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
  const [userTier, setUserTier] = useState<'free' | 'starter' | 'growth' | 'pro' | 'admin'>('free')
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
        const tier = (intResult.data?.tier as 'free' | 'starter' | 'growth' | 'pro' | 'admin') ?? 'free'
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
        <Header title="YouTube Studio" subtitle="Drop the ASIN in your YouTube title. We generate the description, tags, hashtags and thumbnail — then push it all back to Studio in one click." />
        <div className="flex items-center justify-center py-20 text-[#86868b] dark:text-[#8e8e93] text-sm">
          <Loader2 size={16} className="animate-spin mr-2" /> Loading your videos…
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header
        title="YouTube Studio"
        subtitle="Drop the ASIN in your YouTube title. We generate the description, tags, hashtags and thumbnail — then push it all back to Studio in one click."
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
              We need read access to find your drafts (private + unlisted) and write access to push the description, tags, hashtags and thumbnail back into Studio. One-time Google OAuth — revoke anytime.
            </p>
            <div className="rounded-lg border border-[#ff9500]/30 bg-[#ff9500]/5 px-3 py-2 mb-4">
              <p className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7] leading-relaxed">
                <strong>Before you upload your next video:</strong> include the Amazon ASIN in the video file name or YouTube title — e.g.{' '}
                <span className="font-mono bg-white dark:bg-[#1c1c1e] px-1.5 py-0.5 rounded border border-[#d2d2d7] dark:border-[#3a3a3c]">Vacuum - B08TT4YHG1</span>. That&apos;s how MVP knows which product to generate the review for.
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
            <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Before you upload to YouTube — include the Amazon ASIN in your video name</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
              Name the video file (or the YouTube title) so the 10-character Amazon ASIN sits inside it. Example:{' '}
              <span className="font-mono text-[#1d1d1f] dark:text-[#f5f5f7] bg-white dark:bg-[#1c1c1e] px-1.5 py-0.5 rounded border border-[#d2d2d7] dark:border-[#3a3a3c]">Vacuum - B08TT4YHG1</span>.
              That&apos;s how we identify the product, pull its Amazon data, and generate the description, tags, hashtags and thumbnail. No ASIN, no generation.
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
