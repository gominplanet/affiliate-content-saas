'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Clip Factory (LABS) — the merged home of Shorts Studio (make a vertical
// clip from a long video, from the ground up) and Shop Burner (add a CTA/link
// overlay + product + auto-DM, then publish). One section, three stages:
//
//   1) Create  — get a vertical clip: build one from a long video (Shorts
//                Studio) OR upload / pick an existing Short.
//   2) Enhance — burn a CTA overlay + attach a product link (Shop Burner engine).
//   3) Publish — push to Instagram / TikTok / YouTube (or download).
//
// Lives in Labs so it can be tested next to the two originals without touching
// them; graduates once proven (flip the nav gate). Every stage reuses the
// existing API routes — no new engines.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Rocket, Scissors, Flame, Send, FlaskConical, Loader2, Search, Youtube, Link2,
  Sparkles, UploadCloud, Video, Check, Download, Instagram, Music2, ArrowRight, ArrowLeft,
  Trash2, Wand2, Package, ExternalLink,
} from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { ShortsCreatePanel } from '@/components/vertical/ShortsCreatePanel'
import FeatureLockedCard from '@/components/ui/FeatureLockedCard'
import { dispatchCapReached } from '@/components/CapReachedBanner'
import { errText } from '@/lib/err-text'
import { buildYouTubeShortTitle } from '@/lib/youtube-title'
import { buildYouTubeTags } from '@/lib/youtube-tags'
import { CTA_STICKERS, ctaStickerUrl } from '@/lib/cta-stickers'
import type { Tier } from '@/lib/tier'

const TikTokDirectModal = dynamic(
  () => import('@/components/TikTokDirectModal').then(m => ({ default: m.TikTokDirectModal })),
  { ssr: false },
)
const InstagramBurnedModal = dynamic(
  () => import('@/components/InstagramBurnedModal').then(m => ({ default: m.InstagramBurnedModal })),
  { ssr: false },
)

const PURPLE = '#7C3AED'
// Legible-in-both-themes styling for an UNSELECTED pill/chip. The old inline
// rgba(0,0,0,.12) borders + grey text were near-invisible on the dark theme.
const PILL_IDLE = 'text-[#1d1d1f] dark:text-[#f5f5f7] bg-black/[0.04] dark:bg-white/[0.08] border-black/15 dark:border-white/25 hover:border-[#7C3AED]/60'
// A selected pill: solid purple fill (paired with inline backgroundColor).
const PILL_ON = 'text-white border-transparent'
// A selected-but-outline chip (e.g. style/position choices): purple text + tint.
const PILL_SEL = 'text-[#7C3AED] bg-[#7C3AED]/10 border-[#7C3AED]'
const CAPTION_PRESETS = ['LINK IN BIO', 'LINK IN BIO 👆', 'FULL REVIEW ON YOUTUBE', 'WATCH THE FULL VIDEO', 'FOLLOW FOR MORE']
const POSITIONS = [
  { key: 'lower-left', label: 'Lower third', desc: 'Bottom — clears IG & TikTok UI' },
  { key: 'upper-left', label: 'Upper third', desc: 'Top of the screen' },
] as const
const STYLES = [
  { key: 'white-pill', label: 'White on dark' },
  { key: 'yellow-pill', label: 'Yellow on dark' },
  { key: 'black-pill', label: 'Black on white' },
  { key: 'white-shadow', label: 'White + shadow' },
] as const
const DURATIONS = [
  { key: 5, label: '5s' },
  { key: 10, label: '10s' },
  { key: 30, label: '30s' },
  { key: 0, label: 'Whole clip' },
] as const

type Stage = 'create' | 'enhance' | 'publish'
interface WorkingClip { url: string; title: string; hashtags?: string[] }
interface VideoLite { id: string; youtubeVideoId: string | null; title: string; thumbnailUrl: string | null; durationSeconds: number | null }
interface ShortItem { id: string; title: string; thumbnailUrl: string | null; hasVideo: boolean; youtubeVideoId: string | null; posted: boolean; productUrl: string | null }

function fmtDuration(sec: number | null): string {
  if (!sec || sec <= 0) return ''
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

// A cross-post pill: outline + brand color until posted, then fills solid.
function PostPill({ posted, label, color, icon, onClick, busy, disabled }: {
  posted: boolean; label: string; color: string; icon: React.ReactNode
  onClick: () => void; busy?: boolean; disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium border transition-colors disabled:opacity-50"
      style={posted ? { backgroundColor: color, borderColor: color, color: '#fff' } : { borderColor: `${color}66`, color }}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : posted ? <Check size={13} /> : icon}
      {label}{posted ? ' · Posted' : ''}
    </button>
  )
}

export default function ClipFactoryPage() {
  const supabase = useMemo(() => createBrowserClient(), [])
  const [tier, setTier] = useState<Tier | string>('trial')
  const [gateLoaded, setGateLoaded] = useState(false)
  const isPro = tier === 'pro' || tier === 'admin'

  const [stage, setStage] = useState<Stage>('create')
  const [clip, setClip] = useState<WorkingClip | null>(null)
  // Monthly Shorts usage (X / 50). null limit = unlimited (admin).
  const [usage, setUsage] = useState<{ used: number; limit: number | null; resetLabel: string } | null>(null)
  const loadUsage = useCallback(async () => {
    try {
      const res = await fetch('/api/youtube/shorts/usage')
      if (res.ok) setUsage(await res.json())
    } catch { /* non-fatal */ }
  }, [])
  useEffect(() => { void loadUsage() }, [loadUsage])

  // ---- Create: long-video on-ramp (opens Shorts Studio) ----
  const [videos, setVideos] = useState<VideoLite[]>([])
  const [vidQuery, setVidQuery] = useState('')
  const [selectedVideo, setSelectedVideo] = useState<VideoLite | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [ownership, setOwnership] = useState(false)
  const [generating, setGenerating] = useState(false)

  // ---- Create: existing-short / upload on-ramp ----
  const [onramp, setOnramp] = useState<'long' | 'existing'>('long')
  const [shorts, setShorts] = useState<ShortItem[]>([])
  const [loadingShorts, setLoadingShorts] = useState(false)
  const [shortQuery, setShortQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [fetchingShortId, setFetchingShortId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Where the working clip came from: 'created' (rendered from a long video, so
  // it carries a plan caption) vs 'existing' (uploaded / picked short — no
  // caption yet, so we push the creator to add a product link for a real one).
  const [clipSource, setClipSource] = useState<'created' | 'existing'>('existing')

  // ---- Enhance ----
  const [overlayType, setOverlayType] = useState<'sticker' | 'text'>('sticker')
  const [stickerTab, setStickerTab] = useState<'gallery' | 'mine' | 'make'>('gallery')
  const [stickerId, setStickerId] = useState<string>(CTA_STICKERS[0]?.id ?? '')
  // A custom (AI-generated / saved) box URL. When set, it wins over stickerId.
  const [customStickerUrl, setCustomStickerUrl] = useState<string | null>(null)
  const [myStickers, setMyStickers] = useState<Array<{ id: string; url: string; tag: string }>>([])
  const [tagText, setTagText] = useState('')
  const [genLoading, setGenLoading] = useState(false)
  const [caption, setCaption] = useState('LINK IN BIO')
  const [style, setStyle] = useState<typeof STYLES[number]['key']>('white-pill')
  const [position, setPosition] = useState<typeof POSITIONS[number]['key']>('lower-left')
  const [burnDuration, setBurnDuration] = useState<number>(10)
  const [product, setProduct] = useState('')
  const [productName, setProductName] = useState('')
  const [burning, setBurning] = useState(false)
  const [burnedUrl, setBurnedUrl] = useState<string | null>(null)
  const [composedCaption, setComposedCaption] = useState<string>('')

  // ---- Publish ----
  const [ttOpen, setTtOpen] = useState(false)
  const [igOpen, setIgOpen] = useState(false)
  const [publishingYt, setPublishingYt] = useState(false)
  const [posted, setPosted] = useState<{ tiktok?: boolean; instagram?: boolean; youtube?: boolean }>({})
  // The uploaded YouTube video id, so we can link the creator straight to it
  // (a Short can take a few minutes to process before it's visible).
  const [ytVideoId, setYtVideoId] = useState<string | null>(null)

  // The clip that flows into Publish: the burned one if Enhance ran, else the raw clip.
  const publishUrl = burnedUrl || clip?.url || ''
  const publishCaption = composedCaption || ''

  // Load gate + long videos on mount.
  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setGateLoaded(true); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: intRow } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).single()
      setTier((intRow?.tier as string) || 'trial')
      setGateLoaded(true)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('youtube_videos')
        .select('id,youtube_video_id,title,thumbnail_url,duration_seconds,is_vertical,published_at')
        .eq('user_id', user.id).or('is_vertical.is.null,is_vertical.eq.false')
        .order('published_at', { ascending: false }).limit(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setVideos(((data ?? []) as any[]).map(v => ({
        id: v.id, youtubeVideoId: v.youtube_video_id ?? null, title: v.title ?? 'Untitled',
        thumbnailUrl: v.thumbnail_url ?? null, durationSeconds: v.duration_seconds ?? null,
      })))
    })()
  }, [supabase])

  const loadShorts = useCallback(async () => {
    setLoadingShorts(true)
    try {
      const res = await fetch('/api/instagram/burn/shorts')
      const data = await res.json()
      setShorts((data.shorts || []) as ShortItem[])
    } catch { /* non-fatal */ }
    finally { setLoadingShorts(false) }
  }, [])

  useEffect(() => { if (onramp === 'existing' && shorts.length === 0) void loadShorts() }, [onramp, shorts.length, loadShorts])

  const filteredVideos = useMemo(() => {
    const q = vidQuery.trim().toLowerCase()
    return q ? videos.filter(v => v.title.toLowerCase().includes(q)) : videos
  }, [videos, vidQuery])
  const filteredShorts = useMemo(() => {
    const q = shortQuery.trim().toLowerCase()
    return q ? shorts.filter(s => s.title.toLowerCase().includes(q)) : shorts
  }, [shorts, shortQuery])

  const generateFromLink = useCallback(async () => {
    const url = linkUrl.trim()
    if (!url) { toast.error('Paste a YouTube link first.'); return }
    if (!ownership) { toast.error('Confirm you own the video first.'); return }
    setGenerating(true)
    try {
      const res = await fetch('/api/youtube/shorts/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtubeUrl: url, ownershipConfirmed: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.limitReached) dispatchCapReached(data.error || 'Clip Factory is a Pro feature.', { cap: data.cap || 'shorts_studio', currentTier: data.currentTier, upgrade: data.upgrade })
        throw new Error(data.error || 'Could not generate clips from that link.')
      }
      if (data.video) {
        setSelectedVideo({ id: data.video.id, youtubeVideoId: data.video.youtubeVideoId ?? null, title: data.video.title ?? 'Video', thumbnailUrl: null, durationSeconds: null })
        setLinkUrl(''); setOwnership(false)
      }
    } catch (e) { toast.error(errText(e)) }
    finally { setGenerating(false) }
  }, [linkUrl, ownership])

  const pickShort = useCallback(async (s: ShortItem) => {
    try {
      let videoUrl = ''
      if (s.hasVideo) {
        const res = await fetch(`/api/instagram/burn/source?videoId=${encodeURIComponent(s.id)}`)
        const data = await res.json()
        videoUrl = (data.videoUrl as string) || ''
      }
      // No stored MP4 — fetch it inside MVP (the downloader service), never send
      // the creator to YouTube Studio to download + re-upload.
      if (!videoUrl) {
        setFetchingShortId(s.id)
        const res = await fetch('/api/youtube/shorts/ingest', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId: s.id, target: 'short' }),
        })
        const data = await res.json()
        if (!res.ok || !data.videoUrl) {
          if (data.ingestDisabled) throw new Error("Automatic fetch isn't set up on this deployment yet.")
          if (data.limitReached) dispatchCapReached(data.error || 'Clip Factory is a Pro feature.', { cap: data.cap || 'shorts_studio', currentTier: data.currentTier, upgrade: data.upgrade })
          throw new Error(data.error || "We couldn't fetch this Short automatically.")
        }
        videoUrl = data.videoUrl as string
        setShorts(prev => prev.map(x => (x.id === s.id ? { ...x, hasVideo: true } : x)))
      }
      if (!videoUrl) throw new Error('No video available for this Short.')
      if (s.productUrl) setProduct(s.productUrl)
      setClipSource('existing')
      setClip({ url: videoUrl, title: s.title })
      setStage('enhance')
    } catch (e) { toast.error(errText(e)) }
    finally { setFetchingShortId(null) }
  }, [])

  const handleUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith('video/')) { toast.error('Please select a video file (MP4 recommended).'); return }
    if (file.size > 300 * 1024 * 1024) { toast.error(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB — keep it under 300MB.`); return }
    setUploading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
      const path = `${user.id}/burner-${crypto.randomUUID()}.${ext}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.storage as any).from('instagram-videos').upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'video/mp4' })
      if (upErr) throw new Error(upErr.message || 'Upload failed')
      const { data: urlData } = supabase.storage.from('instagram-videos').getPublicUrl(path)
      setClipSource('existing')
      setClip({ url: urlData.publicUrl, title: file.name })
      setStage('enhance')
    } catch (e) { toast.error(errText(e)) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }, [supabase])

  // Load the creator's saved custom CTA boxes ("My boxes").
  const loadMyStickers = useCallback(async () => {
    try {
      const res = await fetch('/api/instagram/burn/my-stickers')
      const data = await res.json()
      setMyStickers((data.stickers || []) as Array<{ id: string; url: string; tag: string }>)
    } catch { /* non-fatal */ }
  }, [])

  // Generate a custom CTA box from a typed tag (AI badge -> transparent PNG).
  const generateSticker = useCallback(async () => {
    const tag = tagText.trim()
    if (!tag) { toast.error('Type a few words for your CTA box.'); return }
    setGenLoading(true)
    try {
      const res = await fetch('/api/instagram/burn/generate-sticker', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        if (res.status === 429 || data.limitReached) dispatchCapReached(data.error || 'You have hit your monthly CTA box limit.', { cap: data.cap || 'cta_box', currentTier: data.currentTier, upgrade: data.upgrade })
        throw new Error(data.error || 'Could not create the box')
      }
      setCustomStickerUrl(data.stickerUrl as string)
      setStickerId('')
      setMyStickers(prev => [{ id: data.id as string, url: data.stickerUrl as string, tag: data.tag as string }, ...prev])
      setTagText('')
      toast.success('CTA box created')
    } catch (e) { toast.error(errText(e)) }
    finally { setGenLoading(false) }
  }, [tagText])

  const deleteMySticker = useCallback(async (id: string, url: string) => {
    setMyStickers(prev => prev.filter(s => s.id !== id))
    if (customStickerUrl === url) { setCustomStickerUrl(null); setStickerId(CTA_STICKERS[0]?.id ?? '') }
    try { await fetch(`/api/instagram/burn/my-stickers?id=${encodeURIComponent(id)}`, { method: 'DELETE' }) } catch { /* non-fatal */ }
  }, [customStickerUrl])

  useEffect(() => { void loadMyStickers() }, [loadMyStickers])

  const runBurn = useCallback(async () => {
    if (!clip) return
    setBurning(true)
    setBurnedUrl(null)
    try {
      const useCustom = overlayType === 'sticker' && !!customStickerUrl
      const sticker = overlayType === 'sticker' && !customStickerUrl ? CTA_STICKERS.find(s => s.id === stickerId) : undefined
      const res = await fetch('/api/instagram/burn', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: clip.url,
          caption: overlayType === 'text' ? caption : undefined,
          style: overlayType === 'text' ? style : undefined,
          stickerId: sticker?.id,
          customStickerUrl: useCustom ? customStickerUrl : undefined,
          position,
          product: product.trim() || undefined,
          productName: productName.trim() || undefined,
          stickerDurationSec: burnDuration,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        if (data.limitReached) dispatchCapReached(data.error || 'Enhancing is a Pro feature.', { cap: data.cap || 'instagram_burner', currentTier: data.currentTier, upgrade: data.upgrade })
        throw new Error(data.error || 'Burn failed')
      }
      setBurnedUrl(data.url as string)
      setComposedCaption((data.caption as string) || '')
      setStage('publish')
      toast.success('Overlay burned')
    } catch (e) { toast.error(errText(e)) }
    finally { setBurning(false) }
  }, [clip, overlayType, stickerId, customStickerUrl, caption, style, position, product, productName, burnDuration])

  const skipEnhance = useCallback(() => { setBurnedUrl(null); setComposedCaption(''); setStage('publish') }, [])

  const postYouTube = useCallback(async () => {
    if (!publishUrl) return
    setPublishingYt(true)
    try {
      const res = await fetch('/api/youtube/upload-short', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: publishUrl,
          title: buildYouTubeShortTitle(clip?.title || 'New Short', clip?.hashtags || []),
          description: publishCaption,
          tags: buildYouTubeTags(clip?.hashtags || [], clip?.title || ''),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        // No upload scope on this connection yet — kick off incremental auth to
        // grant just youtube.upload, then the creator comes back and posts.
        if (data.reconnectRequired) {
          toast('One-time step: grant YouTube publishing access…')
          window.location.href = `/api/auth/youtube?intent=upload&returnTo=${encodeURIComponent('/clip-factory')}`
          return
        }
        throw new Error(data.error || 'YouTube upload failed')
      }
      setPosted(p => ({ ...p, youtube: true }))
      if (data.videoId) setYtVideoId(data.videoId as string)
      toast.success('Uploaded to YouTube — it may take a few minutes to process')
    } catch (e) { toast.error(errText(e)) }
    finally { setPublishingYt(false) }
  }, [publishUrl, publishCaption, clip])

  const restart = useCallback(() => {
    setClip(null); setBurnedUrl(null); setComposedCaption(''); setPosted({}); setStage('create')
  }, [])

  if (gateLoaded && !isPro) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <FeatureLockedCard
          icon={<Rocket size={22} />}
          feature="Clip Factory"
          description="Turn a long video into captioned vertical Shorts, add a shoppable CTA overlay, and publish to Instagram, TikTok and YouTube, all in one flow."
          requiredTier="pro"
          currentTier={tier as Tier}
        />
      </div>
    )
  }

  const STEPS: Array<{ key: Stage; label: string; icon: React.ReactNode }> = [
    { key: 'create', label: 'Create', icon: <Scissors size={14} /> },
    { key: 'enhance', label: 'Enhance', icon: <Flame size={14} /> },
    { key: 'publish', label: 'Publish', icon: <Send size={14} /> },
  ]
  const stageIndex = STEPS.findIndex(s => s.key === stage)

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <Rocket size={20} style={{ color: PURPLE }} />
        <h1 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Clip Factory</h1>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 text-white bg-[#DC2626]">
          <FlaskConical size={10} /> Labs
        </span>
        {usage && usage.limit !== null && (
          <span
            className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2.5 py-0.5 border"
            style={usage.used >= usage.limit
              ? { borderColor: '#ff3b30', color: '#ff3b30' }
              : { borderColor: `${PURPLE}66`, color: PURPLE }}
            title={usage.resetLabel ? `Resets ${usage.resetLabel}` : undefined}
          >
            {usage.used} / {usage.limit} Shorts this month
          </span>
        )}
      </div>
      <p className="text-[13px] text-[#4b4b4f] dark:text-[#b0b0b5] max-w-2xl mb-5">
        Make a vertical short from a long video, add a shoppable CTA and product link, then publish to Instagram,
        TikTok and YouTube. Shorts Studio and Shop Burner, one flow. <span className="italic">Experimental; still being tested.</span>
      </p>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-6">
        {STEPS.map((s, i) => {
          const active = s.key === stage
          const done = i < stageIndex
          const reachable = i === 0 || !!clip
          return (
            <div key={s.key} className="flex items-center gap-2">
              <button
                onClick={() => reachable && setStage(s.key)}
                disabled={!reachable}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold border transition-colors disabled:opacity-50 ${
                  active
                    ? 'text-white border-transparent'
                    : done
                      ? 'text-[#7C3AED] bg-[#7C3AED]/10 border-[#7C3AED]/50'
                      : 'text-[#1d1d1f] dark:text-[#f5f5f7] bg-black/[0.03] dark:bg-white/[0.08] border-black/15 dark:border-white/25 hover:border-[#7C3AED]/60'
                }`}
                style={active ? { backgroundColor: PURPLE } : undefined}
              >
                {done ? <Check size={14} /> : s.icon}
                {i + 1}. {s.label}
              </button>
              {i < STEPS.length - 1 && <ArrowRight size={14} className="text-black/30 dark:text-white/40" />}
            </div>
          )
        })}
      </div>

      {/* ---------------- CREATE ---------------- */}
      {stage === 'create' && (
        <div>
          <div className="flex gap-2 mb-4">
            <button onClick={() => setOnramp('long')} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold border transition-colors ${onramp === 'long' ? PILL_ON : PILL_IDLE}`} style={onramp === 'long' ? { backgroundColor: PURPLE } : undefined}>
              <Scissors size={13} /> From a long video
            </button>
            <button onClick={() => setOnramp('existing')} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold border transition-colors ${onramp === 'existing' ? PILL_ON : PILL_IDLE}`} style={onramp === 'existing' ? { backgroundColor: PURPLE } : undefined}>
              <UploadCloud size={13} /> Upload or pick a short
            </button>
          </div>

          {onramp === 'long' && selectedVideo ? (
            <div>
              <button onClick={() => setSelectedVideo(null)} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#86868b] mb-4">
                <ArrowLeft size={14} /> Pick a different video
              </button>
              <ShortsCreatePanel
                videoId={selectedVideo.id}
                youtubeVideoId={selectedVideo.youtubeVideoId}
                videoTitle={selectedVideo.title}
                onUseClip={(c) => {
                  setClipSource('created')
                  setClip({ url: c.url, title: c.title, hashtags: c.hashtags })
                  void loadUsage()
                  // Seed a caption in case Enhance is skipped; burn overwrites it.
                  setComposedCaption([c.caption, (c.hashtags || []).join(' ')].filter(Boolean).join('\n\n').trim())
                  setSelectedVideo(null)
                  setStage('enhance')
                }}
              />
            </div>
          ) : onramp === 'long' ? (
            <div>
              {/* Paste a link */}
              <div className="rounded-xl border border-black/5 dark:border-white/10 p-4 mb-5 bg-white dark:bg-[#1c1c1e]">
                <div className="flex items-center gap-2 mb-2">
                  <Link2 size={15} style={{ color: PURPLE }} />
                  <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Paste a YouTube link</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void generateFromLink() }} placeholder="https://youtube.com/watch?v=…" className="flex-1 rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]" />
                  <button onClick={generateFromLink} disabled={generating || !linkUrl.trim() || !ownership} className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: PURPLE }}>
                    {generating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                    {generating ? 'Generating…' : 'Generate Clips'}
                  </button>
                </div>
                <label className="flex items-start gap-2 mt-2.5 cursor-pointer select-none">
                  <input type="checkbox" checked={ownership} onChange={e => setOwnership(e.target.checked)} className="mt-0.5 accent-[#7C3AED]" />
                  <span className="text-[11px] text-[#4b4b4f] dark:text-[#b0b0b5]">I own this video or have the rights to use it. Unauthorized videos may violate copyright.</span>
                </label>
              </div>

              {videos.length > 0 && (
                <div className="relative mb-4 max-w-sm">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b]" />
                  <input value={vidQuery} onChange={e => setVidQuery(e.target.value)} placeholder="Search your videos…" className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-transparent pl-9 pr-3 py-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]" />
                </div>
              )}
              {videos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-3 text-[#86868b]">
                  <Youtube size={30} />
                  <p className="text-sm max-w-xs">No long videos synced yet. Connect YouTube and sync your channel, then come back.</p>
                  <Link href="/content" className="text-sm font-medium" style={{ color: PURPLE }}>Go to Content →</Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredVideos.map(v => (
                    <button key={v.id} onClick={() => setSelectedVideo(v)} className="group text-left rounded-xl border border-black/5 dark:border-white/10 overflow-hidden hover:border-[#7C3AED]/50 transition-colors bg-white dark:bg-[#1c1c1e]">
                      <div className="relative aspect-video bg-black/5 dark:bg-white/5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" className="w-full h-full object-cover" />}
                        {fmtDuration(v.durationSeconds) && <span className="absolute bottom-1.5 right-1.5 text-[10px] font-medium rounded bg-black/75 text-white px-1.5 py-0.5 tabular-nums">{fmtDuration(v.durationSeconds)}</span>}
                        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white" style={{ backgroundColor: PURPLE }}><Scissors size={13} /> Make Shorts</span>
                        </span>
                      </div>
                      <p className="text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] p-2.5 line-clamp-2">{v.title}</p>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-[#86868b] mt-4">
                Pick a video to find its best moments and render a vertical clip right here, then add a CTA and publish. No downloads, no re-uploads.
              </p>
            </div>
          ) : (
            <div>
              <div className="relative mb-4 max-w-sm">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b]" />
                <input value={shortQuery} onChange={e => setShortQuery(e.target.value)} placeholder="Search your shorts…" className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-transparent pl-9 pr-3 py-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]" />
              </div>
              <div className="mb-4">
                <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void handleUpload(f) }} />
                <button onClick={() => fileRef.current?.click()} disabled={uploading} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: PURPLE }}>
                  {uploading ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
                  {uploading ? 'Uploading…' : 'Upload a vertical video'}
                </button>
              </div>
              {loadingShorts ? (
                <div className="flex items-center justify-center py-12 text-[#86868b]"><Loader2 size={20} className="animate-spin" /></div>
              ) : shorts.length === 0 ? (
                <p className="text-sm text-[#86868b] py-8 text-center">No vertical shorts found. Upload one above, or build one from a long video.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {filteredShorts.map(s => {
                    const fetching = fetchingShortId === s.id
                    return (
                      <button key={s.id} onClick={() => pickShort(s)} disabled={fetching} className="group text-left rounded-xl border border-black/5 dark:border-white/10 overflow-hidden hover:border-[#7C3AED]/50 transition-colors bg-white dark:bg-[#1c1c1e] disabled:opacity-70">
                        <div className="relative aspect-[9/16] bg-black/5 dark:bg-white/5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {s.thumbnailUrl ? <img src={s.thumbnailUrl} alt="" className="w-full h-full object-cover" /> : <Video size={22} className="absolute inset-0 m-auto text-[#c7c7cc]" />}
                          {s.posted && <span className="absolute top-1.5 left-1.5 text-[9px] font-semibold rounded-full bg-[#34c759] text-white px-1.5 py-0.5">Posted</span>}
                          {!s.hasVideo && !fetching && <span className="absolute bottom-1.5 left-1.5 right-1.5 inline-flex items-center justify-center gap-1 text-[9px] text-white bg-black/70 rounded px-1 py-0.5"><Download size={10} /> Tap to fetch</span>}
                          {fetching && <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-[10px] font-medium gap-1"><Loader2 size={14} className="animate-spin" /> Fetching…</span>}
                        </div>
                        <p className="text-[11px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] p-2 line-clamp-2">{s.title}</p>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------------- ENHANCE ---------------- */}
      {stage === 'enhance' && clip && (
        <div className="grid md:grid-cols-[1fr_240px] gap-6">
          <div className="flex flex-col gap-5">
            {/* Overlay type */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#3a3a3c] dark:text-[#d2d2d7] mb-2">Call-to-action overlay</p>
              <div className="flex gap-2 mb-3">
                <button onClick={() => setOverlayType('sticker')} className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${overlayType === 'sticker' ? PILL_SEL : PILL_IDLE}`}>CTA box</button>
                <button onClick={() => setOverlayType('text')} className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${overlayType === 'text' ? PILL_SEL : PILL_IDLE}`}>Caption text</button>
              </div>
              {overlayType === 'sticker' ? (
                <div>
                  {/* Gallery / My boxes / Make your own */}
                  <div className="flex gap-2 mb-3">
                    <button onClick={() => setStickerTab('gallery')} className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${stickerTab === 'gallery' ? PILL_SEL : PILL_IDLE}`}>Gallery</button>
                    <button onClick={() => setStickerTab('mine')} className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${stickerTab === 'mine' ? PILL_SEL : PILL_IDLE}`}>My boxes{myStickers.length ? ` (${myStickers.length})` : ''}</button>
                    <button onClick={() => setStickerTab('make')} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${stickerTab === 'make' ? PILL_SEL : PILL_IDLE}`}><Wand2 size={12} /> Make your own</button>
                  </div>

                  {stickerTab === 'gallery' && (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {CTA_STICKERS.map(s => {
                        const on = !customStickerUrl && stickerId === s.id
                        return (
                          <button key={s.id} onClick={() => { setStickerId(s.id); setCustomStickerUrl(null) }} className="rounded-lg border-2 overflow-hidden p-1.5 bg-white dark:bg-[#2c2c2e] transition-colors" style={{ borderColor: on ? PURPLE : 'rgba(128,128,128,0.25)' }} title={s.label}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={ctaStickerUrl(s.file)} alt={s.label} className="w-full h-12 object-contain" />
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {stickerTab === 'mine' && (
                    myStickers.length === 0 ? (
                      <p className="text-[12px] text-[#86868b] py-4">No custom boxes yet. Hit <span className="font-medium text-[#7C3AED]">Make your own</span> to design one from a few words.</p>
                    ) : (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {myStickers.map(m => {
                          const on = customStickerUrl === m.url
                          return (
                            <div key={m.id} className="relative group">
                              <button onClick={() => { setCustomStickerUrl(m.url); setStickerId('') }} className="w-full rounded-lg border-2 overflow-hidden p-1.5 bg-white dark:bg-[#2c2c2e]" style={{ borderColor: on ? PURPLE : 'rgba(128,128,128,0.25)' }} title={m.tag}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={m.url} alt={m.tag} className="w-full h-12 object-contain" />
                              </button>
                              <button onClick={() => deleteMySticker(m.id, m.url)} className="absolute -top-1.5 -right-1.5 rounded-full bg-[#ff3b30] text-white p-0.5 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete"><Trash2 size={11} /></button>
                            </div>
                          )
                        })}
                      </div>
                    )
                  )}

                  {stickerTab === 'make' && (
                    <div className="rounded-xl border border-[#7C3AED]/25 bg-[#7C3AED]/5 p-3">
                      <p className="text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Describe your CTA box in a few words — we design a transparent badge for it.</p>
                      <div className="flex gap-2">
                        <input value={tagText} onChange={e => setTagText(e.target.value.slice(0, 40))} onKeyDown={e => { if (e.key === 'Enter') void generateSticker() }} placeholder="e.g. Grab yours today" className="flex-1 rounded-lg border border-black/10 dark:border-white/15 bg-white dark:bg-[#2c2c2e] px-3 py-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]" />
                        <button onClick={generateSticker} disabled={genLoading || !tagText.trim()} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: PURPLE }}>
                          {genLoading ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                          {genLoading ? 'Designing…' : 'Create box'}
                        </button>
                      </div>
                      <p className="text-[10px] text-[#86868b] mt-1.5">1–6 words work best. New boxes are saved to My boxes and selected automatically.</p>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <input value={caption} onChange={e => setCaption(e.target.value.slice(0, 60))} placeholder="LINK IN BIO" className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7] mb-2" />
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {CAPTION_PRESETS.map(p => <button key={p} onClick={() => setCaption(p)} className={`text-[11px] rounded-full border px-2.5 py-1 transition-colors ${caption === p ? PILL_SEL : PILL_IDLE}`}>{p}</button>)}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {STYLES.map(st => <button key={st.key} onClick={() => setStyle(st.key)} className={`text-[11px] rounded-full border px-2.5 py-1 transition-colors ${style === st.key ? PILL_SEL : PILL_IDLE}`}>{st.label}</button>)}
                  </div>
                </div>
              )}
            </div>

            {/* Position + duration */}
            <div className="flex flex-wrap gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#3a3a3c] dark:text-[#d2d2d7] mb-2">Position</p>
                <div className="flex gap-2">{POSITIONS.map(p => <button key={p.key} onClick={() => setPosition(p.key)} className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${position === p.key ? PILL_SEL : PILL_IDLE}`} title={p.desc}>{p.label}</button>)}</div>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#3a3a3c] dark:text-[#d2d2d7] mb-2">How long it shows</p>
                <div className="flex gap-2">{DURATIONS.map(d => <button key={d.key} onClick={() => setBurnDuration(d.key)} className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${burnDuration === d.key ? PILL_SEL : PILL_IDLE}`}>{d.label}</button>)}</div>
              </div>
            </div>

            {/* Product link — pushed hard for clips that didn't come from a scripted
                long video (uploads / existing shorts have no caption otherwise). */}
            {clipSource === 'existing' ? (
              <div className="rounded-xl border border-[#ff9500]/40 bg-[#ff9500]/10 p-3.5">
                <p className="text-[12px] font-semibold text-[#9a5d00] dark:text-[#ffcf8f] flex items-center gap-1.5"><Package size={13} /> Add your product link so we can write the caption</p>
                <p className="text-[11px] text-[#9a5d00] dark:text-[#ffcf8f]/85 mt-0.5 mb-2.5 leading-relaxed">
                  This short didn&apos;t come from a scripted video, so we need the ASIN or affiliate link to write a proper caption with your link and hashtags. Without it the caption comes out empty.
                </p>
                <input value={product} onChange={e => setProduct(e.target.value)} placeholder="Amazon ASIN, store URL, or TikTok Shop link" className="w-full rounded-lg border border-black/15 dark:border-white/20 bg-white dark:bg-[#2c2c2e] px-3 py-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7] mb-2" />
                <input value={productName} onChange={e => setProductName(e.target.value)} placeholder="Product name (helps the AI caption)" className="w-full rounded-lg border border-black/15 dark:border-white/20 bg-white dark:bg-[#2c2c2e] px-3 py-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]" />
              </div>
            ) : (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#3a3a3c] dark:text-[#d2d2d7] mb-2">Product link (optional)</p>
                <input value={product} onChange={e => setProduct(e.target.value)} placeholder="Amazon ASIN, store URL, or TikTok Shop link" className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7] mb-2" />
                <input value={productName} onChange={e => setProductName(e.target.value)} placeholder="Product name (helps the AI caption)" className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]" />
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button onClick={() => setStage('create')} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#86868b]"><ArrowLeft size={14} /> Back</button>
              <button onClick={runBurn} disabled={burning} className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-60" style={{ backgroundColor: PURPLE }}>
                {burning ? <Loader2 size={14} className="animate-spin" /> : <Flame size={14} />}
                {burning ? 'Burning…' : 'Burn overlay & continue'}
              </button>
              <button onClick={skipEnhance} className="text-[13px] font-medium hover:underline" style={{ color: PURPLE }}>Skip — publish as is</button>
            </div>
          </div>

          {/* Preview */}
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-xl overflow-hidden bg-black aspect-[9/16] w-full max-w-[220px]">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video src={clip.url} controls playsInline className="w-full h-full" />
            </div>
            <p className="text-[11px] text-[#86868b] text-center truncate max-w-full">{clip.title}</p>
          </div>
        </div>
      )}

      {/* ---------------- PUBLISH ---------------- */}
      {stage === 'publish' && publishUrl && (
        <div className="grid md:grid-cols-[1fr_240px] gap-6">
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-[#4b4b4f] dark:text-[#b0b0b5]">
              {burnedUrl ? 'Overlay burned. Publish your finished clip:' : 'Publishing the clip as is (no overlay):'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <PostPill label="TikTok" color="#FE2C55" icon={<Music2 size={13} />} posted={!!posted.tiktok} onClick={() => setTtOpen(true)} />
              <PostPill label="Instagram" color="#E1306C" icon={<Instagram size={13} />} posted={!!posted.instagram} onClick={() => setIgOpen(true)} />
              <PostPill label="YouTube" color="#FF0000" icon={<Youtube size={13} />} posted={!!posted.youtube} busy={publishingYt} onClick={postYouTube} />
              <a href={publishUrl} download target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium border border-black/10 dark:border-white/15 text-[#1d1d1f] dark:text-[#f5f5f7]"><Download size={13} /> Download</a>
            </div>
            {ytVideoId && (
              <div className="rounded-lg border border-[#FF0000]/25 bg-[#FF0000]/5 p-3 text-[12px] text-[#4b4b4f] dark:text-[#d2d2d7]">
                <p className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Uploaded to YouTube. A Short can take a few minutes to process before it shows publicly.</p>
                <div className="flex flex-wrap gap-3">
                  <a href={`https://studio.youtube.com/video/${ytVideoId}/edit`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline" style={{ color: '#FF0000' }}><ExternalLink size={12} /> Open in YouTube Studio</a>
                  <a href={`https://youtube.com/shorts/${ytVideoId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline" style={{ color: '#FF0000' }}><ExternalLink size={12} /> View the Short</a>
                </div>
              </div>
            )}
            {composedCaption && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#3a3a3c] dark:text-[#d2d2d7] mb-1.5">Suggested caption</p>
                <textarea readOnly value={composedCaption} rows={5} className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]" />
              </div>
            )}
            {(() => {
              const tags = buildYouTubeTags(clip?.hashtags || [], clip?.title || '')
              return tags.length > 0 ? (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#3a3a3c] dark:text-[#d2d2d7] mb-1.5">YouTube tags (added automatically)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map(t => (
                      <span key={t} className="text-[11px] rounded-full px-2.5 py-1 border border-black/10 dark:border-white/15 text-[#4b4b4f] dark:text-[#b0b0b5]">{t}</span>
                    ))}
                  </div>
                </div>
              ) : null
            })()}
            <div className="flex items-center gap-3 pt-1">
              <button onClick={() => setStage('enhance')} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#86868b]"><ArrowLeft size={14} /> Back to Enhance</button>
              <button onClick={restart} className="text-[13px] font-medium hover:underline" style={{ color: PURPLE }}>Start another</button>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-xl overflow-hidden bg-black aspect-[9/16] w-full max-w-[220px]">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video src={publishUrl} controls playsInline className="w-full h-full" />
            </div>
          </div>
        </div>
      )}

      {/* Publish modals */}
      {ttOpen && publishUrl && (
        <TikTokDirectModal
          burnedVideoUrl={publishUrl}
          initialCaption={publishCaption}
          onClose={() => setTtOpen(false)}
          onPosted={() => { setPosted(p => ({ ...p, tiktok: true })); setTtOpen(false); toast.success('Posted to TikTok') }}
        />
      )}
      {igOpen && publishUrl && (
        <InstagramBurnedModal
          burnedVideoUrl={publishUrl}
          initialCaption={publishCaption}
          onClose={() => setIgOpen(false)}
          onPosted={() => { setPosted(p => ({ ...p, instagram: true })); toast.success('Posted to Instagram') }}
        />
      )}
    </div>
  )
}
