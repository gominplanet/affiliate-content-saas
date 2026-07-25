'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Vertical Powerhouse (LABS) — the merged home of Shorts Studio (make a vertical
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
} from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { ShortsStudioModal } from '@/components/content/ShortsStudioModal'
import FeatureLockedCard from '@/components/ui/FeatureLockedCard'
import { dispatchCapReached } from '@/components/CapReachedBanner'
import { errText } from '@/lib/err-text'
import { CTA_STICKERS, ctaStickerUrl } from '@/lib/cta-stickers'
import { youtubeUploadEnabled } from '@/lib/feature-flags'
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
interface WorkingClip { url: string; title: string }
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

export default function VerticalPowerhousePage() {
  const supabase = useMemo(() => createBrowserClient(), [])
  const [tier, setTier] = useState<Tier | string>('trial')
  const [gateLoaded, setGateLoaded] = useState(false)
  const isPro = tier === 'pro' || tier === 'admin'

  const [stage, setStage] = useState<Stage>('create')
  const [clip, setClip] = useState<WorkingClip | null>(null)

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
  const fileRef = useRef<HTMLInputElement>(null)

  // ---- Enhance ----
  const [overlayType, setOverlayType] = useState<'sticker' | 'text'>('sticker')
  const [stickerId, setStickerId] = useState<string>(CTA_STICKERS[0]?.id ?? '')
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
        if (data.limitReached) dispatchCapReached(data.error || 'Vertical Powerhouse is a Pro feature.', { cap: data.cap || 'shorts_studio', currentTier: data.currentTier, upgrade: data.upgrade })
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
    if (!s.hasVideo) { toast.error('This Short has no stored video. Download it from YouTube Studio and re-upload.'); return }
    try {
      const res = await fetch(`/api/instagram/burn/source?videoId=${encodeURIComponent(s.id)}`)
      const data = await res.json()
      if (!data.videoUrl) throw new Error('No stored video for this Short.')
      if (s.productUrl) setProduct(s.productUrl)
      setClip({ url: data.videoUrl as string, title: s.title })
      setStage('enhance')
    } catch (e) { toast.error(errText(e)) }
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
      setClip({ url: urlData.publicUrl, title: file.name })
      setStage('enhance')
    } catch (e) { toast.error(errText(e)) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }, [supabase])

  const runBurn = useCallback(async () => {
    if (!clip) return
    setBurning(true)
    setBurnedUrl(null)
    try {
      const sticker = overlayType === 'sticker' ? CTA_STICKERS.find(s => s.id === stickerId) : undefined
      const res = await fetch('/api/instagram/burn', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: clip.url,
          caption: overlayType === 'text' ? caption : undefined,
          style: overlayType === 'text' ? style : undefined,
          stickerId: sticker?.id,
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
  }, [clip, overlayType, stickerId, caption, style, position, product, productName, burnDuration])

  const skipEnhance = useCallback(() => { setBurnedUrl(null); setComposedCaption(''); setStage('publish') }, [])

  const postYouTube = useCallback(async () => {
    if (!publishUrl) return
    setPublishingYt(true)
    try {
      const res = await fetch('/api/youtube/upload-short', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: publishUrl, title: (clip?.title || 'New Short').slice(0, 100), description: publishCaption }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'YouTube upload failed')
      setPosted(p => ({ ...p, youtube: true }))
      toast.success('Uploaded to YouTube as a Short')
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
          feature="Vertical Powerhouse"
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
        <h1 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Vertical Powerhouse</h1>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 text-white bg-[#DC2626]">
          <FlaskConical size={10} /> Labs
        </span>
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
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold border transition-colors disabled:opacity-40"
                style={active
                  ? { backgroundColor: PURPLE, borderColor: PURPLE, color: '#fff' }
                  : done
                    ? { borderColor: `${PURPLE}66`, color: PURPLE }
                    : { borderColor: 'rgba(0,0,0,0.12)', color: '#86868b' }}
              >
                {done ? <Check size={14} /> : s.icon}
                {i + 1}. {s.label}
              </button>
              {i < STEPS.length - 1 && <ArrowRight size={14} className="text-[#c7c7cc]" />}
            </div>
          )
        })}
      </div>

      {/* ---------------- CREATE ---------------- */}
      {stage === 'create' && (
        <div>
          <div className="flex gap-2 mb-4">
            <button onClick={() => setOnramp('long')} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold border transition-colors" style={onramp === 'long' ? { backgroundColor: PURPLE, borderColor: PURPLE, color: '#fff' } : { borderColor: 'rgba(0,0,0,0.12)', color: '#4b4b4f' }}>
              <Scissors size={13} /> From a long video
            </button>
            <button onClick={() => setOnramp('existing')} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold border transition-colors" style={onramp === 'existing' ? { backgroundColor: PURPLE, borderColor: PURPLE, color: '#fff' } : { borderColor: 'rgba(0,0,0,0.12)', color: '#4b4b4f' }}>
              <UploadCloud size={13} /> Upload or pick a short
            </button>
          </div>

          {onramp === 'long' ? (
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
                Building from a long video opens Shorts Studio to pick and render the clip. Rendered clips can be published there, or upload the result here to add a CTA overlay first.
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
                  {filteredShorts.map(s => (
                    <button key={s.id} onClick={() => pickShort(s)} className="group text-left rounded-xl border border-black/5 dark:border-white/10 overflow-hidden hover:border-[#7C3AED]/50 transition-colors bg-white dark:bg-[#1c1c1e]">
                      <div className="relative aspect-[9/16] bg-black/5 dark:bg-white/5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {s.thumbnailUrl ? <img src={s.thumbnailUrl} alt="" className="w-full h-full object-cover" /> : <Video size={22} className="absolute inset-0 m-auto text-[#c7c7cc]" />}
                        {s.posted && <span className="absolute top-1.5 left-1.5 text-[9px] font-semibold rounded-full bg-[#34c759] text-white px-1.5 py-0.5">Posted</span>}
                        {!s.hasVideo && <span className="absolute bottom-1.5 left-1.5 right-1.5 text-[9px] text-white bg-black/70 rounded px-1 py-0.5 text-center">Needs download</span>}
                      </div>
                      <p className="text-[11px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] p-2 line-clamp-2">{s.title}</p>
                    </button>
                  ))}
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
                <button onClick={() => setOverlayType('sticker')} className="rounded-lg border-2 px-3 py-1.5 text-[12px] font-medium" style={overlayType === 'sticker' ? { borderColor: PURPLE, color: PURPLE } : { borderColor: 'rgba(0,0,0,0.12)', color: '#86868b' }}>CTA box</button>
                <button onClick={() => setOverlayType('text')} className="rounded-lg border-2 px-3 py-1.5 text-[12px] font-medium" style={overlayType === 'text' ? { borderColor: PURPLE, color: PURPLE } : { borderColor: 'rgba(0,0,0,0.12)', color: '#86868b' }}>Caption text</button>
              </div>
              {overlayType === 'sticker' ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {CTA_STICKERS.map(s => (
                    <button key={s.id} onClick={() => setStickerId(s.id)} className="rounded-lg border-2 overflow-hidden p-1.5 bg-white dark:bg-[#2c2c2e]" style={{ borderColor: stickerId === s.id ? PURPLE : 'rgba(0,0,0,0.1)' }} title={s.label}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={ctaStickerUrl(s.file)} alt={s.label} className="w-full h-12 object-contain" />
                      </button>
                  ))}
                </div>
              ) : (
                <div>
                  <input value={caption} onChange={e => setCaption(e.target.value.slice(0, 60))} placeholder="LINK IN BIO" className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7] mb-2" />
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {CAPTION_PRESETS.map(p => <button key={p} onClick={() => setCaption(p)} className="text-[11px] rounded-full border border-black/10 dark:border-white/15 px-2 py-1 text-[#4b4b4f] dark:text-[#b0b0b5] hover:border-[#7C3AED]/50">{p}</button>)}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {STYLES.map(st => <button key={st.key} onClick={() => setStyle(st.key)} className="text-[11px] rounded-full border-2 px-2.5 py-1" style={style === st.key ? { borderColor: PURPLE, color: PURPLE } : { borderColor: 'rgba(0,0,0,0.12)', color: '#86868b' }}>{st.label}</button>)}
                  </div>
                </div>
              )}
            </div>

            {/* Position + duration */}
            <div className="flex flex-wrap gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#3a3a3c] dark:text-[#d2d2d7] mb-2">Position</p>
                <div className="flex gap-2">{POSITIONS.map(p => <button key={p.key} onClick={() => setPosition(p.key)} className="rounded-lg border-2 px-3 py-1.5 text-[12px] font-medium" style={position === p.key ? { borderColor: PURPLE, color: PURPLE } : { borderColor: 'rgba(0,0,0,0.12)', color: '#86868b' }} title={p.desc}>{p.label}</button>)}</div>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#3a3a3c] dark:text-[#d2d2d7] mb-2">How long it shows</p>
                <div className="flex gap-2">{DURATIONS.map(d => <button key={d.key} onClick={() => setBurnDuration(d.key)} className="rounded-lg border-2 px-3 py-1.5 text-[12px] font-medium" style={burnDuration === d.key ? { borderColor: PURPLE, color: PURPLE } : { borderColor: 'rgba(0,0,0,0.12)', color: '#86868b' }}>{d.label}</button>)}</div>
              </div>
            </div>

            {/* Product link */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#3a3a3c] dark:text-[#d2d2d7] mb-2">Product link (optional)</p>
              <input value={product} onChange={e => setProduct(e.target.value)} placeholder="Amazon ASIN, store URL, or TikTok Shop link" className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7] mb-2" />
              <input value={productName} onChange={e => setProductName(e.target.value)} placeholder="Product name (helps the AI caption)" className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]" />
            </div>

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
              {youtubeUploadEnabled() && <PostPill label="YouTube" color="#FF0000" icon={<Youtube size={13} />} posted={!!posted.youtube} busy={publishingYt} onClick={postYouTube} />}
              <a href={publishUrl} download target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium border border-black/10 dark:border-white/15 text-[#1d1d1f] dark:text-[#f5f5f7]"><Download size={13} /> Download</a>
            </div>
            {composedCaption && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#3a3a3c] dark:text-[#d2d2d7] mb-1.5">Suggested caption</p>
                <textarea readOnly value={composedCaption} rows={5} className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]" />
              </div>
            )}
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

      {/* Shorts Studio modal (long-video creator) */}
      {selectedVideo && (
        <ShortsStudioModal
          videoId={selectedVideo.id}
          youtubeVideoId={selectedVideo.youtubeVideoId}
          videoTitle={selectedVideo.title}
          onClose={() => setSelectedVideo(null)}
        />
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
