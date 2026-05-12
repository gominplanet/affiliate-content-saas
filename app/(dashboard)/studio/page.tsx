'use client'

import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import Header from '@/components/layout/Header'
import {
  Youtube, Wand2, CheckCircle, AlertCircle, Loader2, ExternalLink,
  Copy, ChevronDown, ChevronUp, RefreshCw, Link2, Tag, Lock, Eye, Globe,
  Image, Download, Sparkles,
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

function VideoStudioCard({ video, hasHeadshot }: { video: DraftVideo; hasHeadshot: boolean }) {
  const [generating, setGenerating] = useState(false)
  const [applying, setApplying] = useState(false)
  const [generated, setGenerated] = useState<GeneratedMetadata | null>(null)
  const [agentInsights, setAgentInsights] = useState<AgentInsights | null>(null)
  const [product, setProduct] = useState<ProductInfo | null>(null)
  const [affiliateUrl, setAffiliateUrl] = useState<string | null>(null)
  const [geniuslinkUsed, setGeniuslinkUsed] = useState<boolean | null>(null)
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
  const [headshotUsed, setHeadshotUsed] = useState(false)
  const [pulidError, setPulidError] = useState<string | null>(null)
  const [generatingThumbnail, setGeneratingThumbnail] = useState(false)
  const [thumbnailPhase, setThumbnailPhase] = useState<'idle' | 'prompting' | 'queued' | 'polling'>('idle')
  const [thumbnailError, setThumbnailError] = useState<string | null>(null)
  const [thumbnailStyle, setThumbnailStyle] = useState<'review' | 'unboxing' | 'comparison' | 'lifestyle'>('review')
  const [includePerson, setIncludePerson] = useState(true)
  const [includeText, setIncludeText] = useState(false)

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
    try {
      const res = await fetch('/api/youtube/generate-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asin: video.detectedAsin,
          videoTitle: video.title,
          videoDescription: video.description,
        }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error((data.error as string) || 'Generation failed')
      setGenerated(data.generated as GeneratedMetadata)
      setAgentInsights((data.agentInsights ?? null) as AgentInsights | null)
      setProduct({ ...(data.product as ProductInfo), bullets: data.productBullets as string[], description: data.productDescription as string })
      setAffiliateUrl(data.affiliateUrl as string)
      setGeniuslinkUsed((data.geniuslinkUsed ?? false) as boolean)
      setGeniuslinkError((data.geniuslinkError ?? null) as string | null)
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
      const res = await fetch('/api/youtube/update-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: video.youtubeVideoId,
          title: editTitle,
          description: editDesc,
          tags: generated.tags,
        }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error((data.error as string) || `HTTP ${res.status} — update failed`)
      setApplied(true)
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply to YouTube')
    } finally {
      setApplying(false)
    }
  }

  async function generateThumbnail() {
    setGeneratingThumbnail(true)
    setThumbnailPhase('prompting')
    setThumbnailError(null)
    setPulidError(null)
    try {
      const res = await fetch('/api/youtube/generate-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoTitle: editTitle || video.title,
          videoDescription: video.description || undefined,
          productTitle: product?.title ?? undefined,
          productDescription: product?.description ?? undefined,
          productBullets: product?.bullets ?? undefined,
          productPrice: product?.price ?? undefined,
          productRating: product?.rating ?? undefined,
          asin: video.detectedAsin ?? undefined,
          style: thumbnailStyle,
          includePerson,
        }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error((data.error as string) || 'Thumbnail generation failed')

      const hook = (data.overlayHook as string) || ''

      // ── Direct path — Gemini/Imagen return synchronously ─────────────────────
      let finalUrl: string = data.thumbnailUrl as string
      if (includeText) {
        try {
          finalUrl = await addTextOverlay(data.thumbnailUrl as string, hook || editTitle || video.title)
        } catch (overlayErr) {
          console.warn('[text-overlay]', overlayErr)
        }
      }

      setThumbnailUrl(finalUrl)
      setThumbnailHook(hook)
      setThumbnailPrompt((data.prompt as string) ?? null)
      setThumbnailModel((data.modelUsed as string) ?? null)
      setHeadshotUsed((data.headshotUsed as boolean) ?? false)
      setPulidError((data.pulidError as string) ?? null)
    } catch (err) {
      setThumbnailError(err instanceof Error ? err.message : 'Failed to generate thumbnail')
    } finally {
      setGeneratingThumbnail(false)
      setThumbnailPhase('idle')
    }
  }

  // ── Client-side text overlay via canvas ─────────────────────────────────────
  // Renders like real YouTube thumbnails: large all-caps hook, upper-left position,
  // white fill + thick black stroke, with a subtle darkened band behind the text.
  function addTextOverlay(rawUrl: string, hookText: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1280
      canvas.height = 720
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas not supported')); return }

      // Make sure it's all-caps, no "honest", clean spacing
      const text = hookText
        .replace(/\bhonest\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .toUpperCase()

      // Split into lines by word-wrap (max width 580px = left half of frame)
      // so text stays in the left ~45% and doesn't overlap the product
      function wrapText(c: CanvasRenderingContext2D, t: string, font: string, maxW: number, maxLines: number): string[] {
        c.font = font
        const words = t.split(' ')
        const lines: string[] = []
        let cur = ''
        for (const w of words) {
          const test = cur ? `${cur} ${w}` : w
          if (c.measureText(test).width > maxW && cur) {
            lines.push(cur)
            cur = w
            if (lines.length >= maxLines - 1) { lines.push(cur); return lines }
          } else { cur = test }
        }
        if (cur) lines.push(cur)
        return lines
      }

      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        ctx.drawImage(img, 0, 0, 1280, 720)

        const fontSize = 96
        const font = `900 ${fontSize}px Impact, "Arial Black", Arial, sans-serif`
        const lines = wrapText(ctx, text, font, 500, 3)
        const lineH = fontSize * 1.15
        const totalH = lines.length * lineH
        const padX = 40
        const padY = 28

        // Solid dark pill behind text — always readable regardless of image brightness
        const bandW = 520
        const bandH = totalH + 28
        const radius = 14
        ctx.fillStyle = 'rgba(0,0,0,0.72)'
        ctx.beginPath()
        ctx.roundRect(padX - 16, padY - 10, bandW, bandH, radius)
        ctx.fill()

        ctx.font = font
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'

        lines.forEach((line, i) => {
          const y = padY + 4 + i * lineH
          // Thick black outline for extra pop
          ctx.lineWidth = 12
          ctx.strokeStyle = '#000000'
          ctx.lineJoin = 'round'
          ctx.strokeText(line, padX, y)
          // Bright white fill
          ctx.fillStyle = '#FFFFFF'
          ctx.fillText(line, padX, y)
        })

        resolve(canvas.toDataURL('image/jpeg', 0.93))
      }
      img.onerror = () => reject(new Error('Failed to load image for overlay'))
      img.src = `/api/proxy-image?url=${encodeURIComponent(rawUrl)}`
    })
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
                No ASIN detected in title — add an Amazon ASIN (e.g. B08N5WRWNW) to the video title to enable generation
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

              {/* Pinned comment */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Pinned comment</label>
                  <button onClick={() => copy(generated.pinnedComment, 'pin')} className="text-[10px] text-[#0071e3] hover:underline flex items-center gap-0.5">
                    <Copy size={10} /> {copied === 'pin' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] p-3 rounded-lg bg-gray-50 dark:bg-white/5 leading-relaxed">
                  {generated.pinnedComment}
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

                {/* Style picker */}
                <div className="flex gap-1.5 mb-3 flex-wrap">
                  {(['review', 'unboxing', 'comparison', 'lifestyle'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setThumbnailStyle(s)}
                      className={`text-[10px] font-medium px-2.5 py-1 rounded-full border transition-colors capitalize ${
                        thumbnailStyle === s
                          ? 'bg-[#0071e3] border-[#0071e3] text-white'
                          : 'bg-transparent border-gray-200 dark:border-white/20 text-[#6e6e73] dark:text-[#ebebf0] hover:border-[#0071e3] hover:text-[#0071e3]'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                {/* Options toggles */}
                <div className="flex flex-col gap-2.5 mb-4">
                  {/* With Image toggle */}
                  <div className="flex items-center gap-3 w-fit">
                    <button
                      onClick={() => setIncludePerson(p => !p)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        includePerson ? 'bg-[#af52de]' : 'bg-gray-200 dark:bg-white/20'
                      }`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                        includePerson ? 'translate-x-4' : 'translate-x-0'
                      }`} />
                    </button>
                    <div className="flex flex-col cursor-pointer" onClick={() => setIncludePerson(p => !p)}>
                      <span className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">With image</span>
                      <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">Add your face using headshot from Brand Profile</span>
                    </div>
                  </div>

                  {/* With Text toggle */}
                  <div className="flex items-center gap-3 w-fit">
                    <button
                      onClick={() => setIncludeText(t => !t)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        includeText ? 'bg-[#ff9500]' : 'bg-gray-200 dark:bg-white/20'
                      }`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                        includeText ? 'translate-x-4' : 'translate-x-0'
                      }`} />
                    </button>
                    <div className="flex flex-col cursor-pointer" onClick={() => setIncludeText(t => !t)}>
                      <span className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">With text</span>
                      <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">AI adds a short viral hook to spark curiosity</span>
                    </div>
                  </div>
                </div>

                {/* Headshot missing warning */}
                {includePerson && !hasHeadshot && (
                  <div className="mb-3 px-3 py-2 rounded-lg bg-[#af52de]/8 border border-[#af52de]/20 text-[10px] text-[#af52de] flex items-center gap-1.5">
                    <span>⚠️</span>
                    <span>No headshot saved — <a href="/brand" className="underline font-semibold">add yours in Brand Profile</a> to place your face in thumbnails.</span>
                  </div>
                )}

                {/* Generate button */}
                <button
                  onClick={generateThumbnail}
                  disabled={generatingThumbnail}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-60 transition-opacity hover:opacity-90 mb-3"
                  style={{ background: 'linear-gradient(135deg, #0071e3 0%, #5856d6 100%)' }}
                >
                  {generatingThumbnail
                    ? <><Loader2 size={12} className="animate-spin" /> {thumbnailPhase === 'prompting' ? 'Writing prompt…' : 'Generating…'}</>
                    : <><Sparkles size={12} /> {thumbnailUrl ? 'Regenerate Thumbnail' : 'Generate Thumbnail'}</>}
                </button>

                {thumbnailError && (
                  <p className="text-xs text-[#ff3b30] mb-3">{thumbnailError}</p>
                )}

                {/* Result */}
                {thumbnailUrl && (
                  <div className="flex flex-col gap-2">
                    <div className="rounded-xl overflow-hidden border border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-white/5">
                      <img src={thumbnailUrl} alt="Generated thumbnail" className="w-full object-cover" style={{ aspectRatio: '16/9' }} />
                    </div>
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
                      {headshotUsed && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#af52de]/10 text-[#af52de] font-medium">
                          👤 Your face included
                        </span>
                      )}
                      {includePerson && !headshotUsed && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#ff9500]/10 text-[#ff9500] font-medium">
                          ℹ️ Product-only (face gen unavailable)
                        </span>
                      )}
                      {includeText && thumbnailUrl.startsWith('data:') && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#ff9500]/10 text-[#ff9500] font-medium">
                          📝 Title overlay added
                        </span>
                      )}
                      {thumbnailPrompt && (
                        <button onClick={() => copy(thumbnailPrompt, 'prompt')} className="text-[10px] text-[#86868b] dark:text-[#8e8e93] hover:text-[#0071e3] transition-colors flex items-center gap-0.5">
                          <Copy size={10} /> {copied === 'prompt' ? 'Copied!' : 'Copy prompt'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-1">
                <div className="flex items-center gap-3">
                  <button
                    onClick={applyToYouTube}
                    disabled={applying || applied}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60 transition-colors"
                    style={{ background: applied ? '#34c759' : '#ff0000' }}
                  >
                    {applying ? <><Loader2 size={14} className="animate-spin" /> Applying…</>
                      : applied ? <><CheckCircle size={14} /> Applied to YouTube</>
                      : <><Youtube size={14} /> Apply to YouTube</>}
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
  const [filter, setFilter] = useState<'all' | 'asin'>('asin')
  const [hasGeniuslink, setHasGeniuslink] = useState(false)
  const [hasHeadshot, setHasHeadshot] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    // Check Geniuslink connection + headshot URL
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const [intResult, brandResult] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('integrations')
          .select('geniuslink_api_key')
          .eq('user_id', user.id)
          .single(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('brand_profiles')
          .select('headshot_url')
          .eq('user_id', user.id)
          .single(),
      ])
      setHasGeniuslink(!!intResult.data?.geniuslink_api_key)
      setHasHeadshot(!!(brandResult.data?.headshot_url as string))
    }

    const res = await fetch('/api/youtube/drafts')
    const data = await res.json()
    if (res.status === 401 && data.needsAuth) {
      setNeedsAuth(true)
    } else if (!res.ok) {
      setError(data.error || 'Failed to load videos')
    } else {
      setDrafts(data.drafts || [])
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  const filtered = filter === 'asin'
    ? drafts.filter(d => d.detectedAsin)
    : drafts

  const asinCount = drafts.filter(d => d.detectedAsin).length

  if (loading) {
    return (
      <div>
        <Header title="YouTube Studio" subtitle="Generate optimised titles, descriptions and tags from your Amazon ASINs." />
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
        subtitle="Generate optimised titles, descriptions and tags from your Amazon ASINs."
      />

      {/* Connect YouTube OAuth banner */}
      {needsAuth && (
        <div className="card p-6 mb-6 flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-[#ff0000]/10 flex items-center justify-center flex-shrink-0">
            <Youtube size={20} className="text-[#ff0000]" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Connect YouTube to read your drafts</h3>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
              This feature needs permission to read your private/draft videos and update their metadata. Connect your Google account to get started.
            </p>
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
            <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">No Geniuslink connected.</strong> Affiliate links will use plain Amazon URLs.
            Add your Geniuslink API key in <a href="/setup?tab=integrations" className="text-[#0071e3] hover:underline">Site & Integrations</a>.
          </p>
        </div>
      )}

      {!needsAuth && !error && (
        <>
          {/* Filter tabs */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex items-center gap-1 bg-[#f5f5f7] dark:bg-[#000] p-1 rounded-xl">
              {([
                { key: 'asin', label: `With ASIN (${asinCount})` },
                { key: 'all', label: `All videos (${drafts.length})` },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    filter === key
                      ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-sm'
                      : 'text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button onClick={load} className="flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#0071e3] transition-colors ml-auto">
              <RefreshCw size={11} /> Refresh
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="card p-8 text-center">
              <Youtube size={28} className="mx-auto text-[#86868b] dark:text-[#8e8e93] mb-3" />
              {filter === 'asin' ? (
                <>
                  <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">No videos with ASINs found</p>
                  <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">
                    Add an Amazon ASIN to a private/draft video title (e.g. &ldquo;B08N5WRWNW Review — Hydro Flask&rdquo;) and it will appear here.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">No videos found</p>
                  <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Make sure your YouTube channel is connected and you have videos.</p>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {filtered.map(video => (
                <VideoStudioCard key={video.youtubeVideoId} video={video} hasHeadshot={hasHeadshot} />
              ))}
            </div>
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
