'use client'

/**
 * Shop Burner — upload a vertical video and burn a caption (e.g.
 * "LINK IN BIO") into the lower third via Cloudinary, then preview the result.
 * From there the user can explicitly publish it as a Reel to their connected
 * Instagram (separate action — never auto-posted) or download it for Reels /
 * Stories / TikTok. Pro-only.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@/lib/supabase/client'
import PageHero from '@/components/layout/PageHero'
import { effectiveTier, VIEW_AS_EVENT } from '@/lib/view-as'
import { metaEnabled } from '@/lib/feature-flags'
import FeatureLockedCard from '@/components/ui/FeatureLockedCard'
import { TikTokDirectModal } from '@/components/TikTokDirectModal'
import { CTA_STICKERS, ctaStickerUrl } from '@/lib/cta-stickers'
import type { Tier } from '@/lib/tier'
import { Flame, Loader2, Sparkles, Download, AlertCircle, UploadCloud, Video, CheckCircle, Copy, Instagram, Plus, Trash2, Clock, Search } from 'lucide-react'

const CAPTION_PRESETS = ['LINK IN BIO', 'LINK IN BIO 👆', 'FULL REVIEW ON YOUTUBE', 'WATCH THE FULL VIDEO', 'FOLLOW FOR MORE']
const POSITIONS: Array<{ key: string; label: string; desc: string }> = [
  { key: 'lower-left', label: 'Lower third', desc: 'Bottom-left — clears Instagram & TikTok UI' },
  { key: 'upper-left', label: 'Upper third', desc: 'Top-left of the screen' },
]
const STYLES: Array<{ key: string; label: string; desc: string }> = [
  { key: 'white-pill', label: 'White on dark', desc: 'White text, dark pill' },
  { key: 'yellow-pill', label: 'Yellow on dark', desc: 'Yellow text, dark pill' },
  { key: 'black-pill', label: 'Black on white', desc: 'Black text, white pill' },
  { key: 'white-shadow', label: 'White + shadow', desc: 'White text, soft shadow, no pill' },
]

/** A vertical YouTube Short the creator can pick to run through the burner. */
interface ShortItem {
  id: string
  title: string
  thumbnailUrl: string | null
  views: number | null
  productUrl: string | null
  hasVideo: boolean
  youtubeVideoId: string | null
  posted: boolean
}

export default function InstagramBurnerPage() {
  const supabase = createBrowserClient()
  const [tier, setTier] = useState('trial')
  // Meta gate uses the RAW tier + reviewer email (NOT the view-as effective
  // tier) so an admin previewing as another tier — or the reviewer — still
  // gets in while the public stays gated.
  const [metaUnlocked, setMetaUnlocked] = useState(metaEnabled())
  const [igUsername, setIgUsername] = useState<string | null>(null)
  const [ttUsername, setTtUsername] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [mode, setMode] = useState<'single' | 'batch'>('single')
  // Overlay type: a styled text caption, or a pre-designed CTA box (PNG sticker).
  const [overlayType, setOverlayType] = useState<'text' | 'sticker'>('sticker')
  const [stickerId, setStickerId] = useState<string | null>(null)
  // AI-generated CTA box from a typed tag (transparent PNG hosted on Supabase).
  const [tagText, setTagText] = useState('')
  const [genStickerUrl, setGenStickerUrl] = useState<string | null>(null)
  const [genStickerLoading, setGenStickerLoading] = useState(false)
  const [genStickerError, setGenStickerError] = useState<string | null>(null)
  // The creator's saved CTA boxes (reusable across sessions) — {id,url,tag}.
  const [myStickers, setMyStickers] = useState<Array<{ id: string | null; url: string; tag: string }>>([])
  const [caption, setCaption] = useState('LINK IN BIO')
  const [position, setPosition] = useState('lower-left')
  const [style, setStyle] = useState('white-pill')
  const [product, setProduct] = useState('')
  const [productName, setProductName] = useState('')

  const [uploading, setUploading] = useState(false)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  // When opened from a Short card (?videoId=), we auto-load the Short's
  // already-stored MP4. shortLoaded = the clip came from the Short (not a
  // manual upload); ytDownloadHint = no stored MP4 yet, link out to YouTube.
  const [loadingShort, setLoadingShort] = useState(false)
  const [shortLoaded, setShortLoaded] = useState(false)
  const [ytDownloadHint, setYtDownloadHint] = useState<{ youtubeVideoId: string | null } | null>(null)
  // Source mode: pick from the creator's own YouTube Shorts, or upload a file.
  // Defaults to 'shorts' once we discover they have any; else 'upload'.
  const [sourceMode, setSourceMode] = useState<'shorts' | 'upload'>('upload')
  const [shorts, setShorts] = useState<ShortItem[] | null>(null)
  const [loadingShorts, setLoadingShorts] = useState(false)
  const [shortsQuery, setShortsQuery] = useState('')
  const [selectedShortId, setSelectedShortId] = useState<string | null>(null)
  const [burning, setBurning] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [igCaption, setIgCaption] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [ttOpen, setTtOpen] = useState(false)
  const [published, setPublished] = useState(false)
  // Final preview-and-confirm gate before anything is posted to Instagram.
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [igError, setIgError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Keep the real DB tier in a ref-ish state so the VIEW_AS_EVENT listener
  // below can re-resolve effectiveTier() without re-querying Supabase
  // every time the admin flips the View-as chip.
  const [realTier, setRealTier] = useState<string>('trial')

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    let resolvedTier = 'trial'
    if (user) {
      // Select only non-sensitive columns — never the access token.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await supabase.from('integrations').select('tier,instagram_username,tiktok_username').eq('user_id', user.id).single()
      resolvedTier = (data?.tier as string) || 'trial'
      setIgUsername((data?.instagram_username as string) || null)
      setTtUsername((data?.tiktok_username as string) || null)
    }
    setMetaUnlocked(metaEnabled({ tier: resolvedTier, email: user?.email }))
    setRealTier(resolvedTier)
    setTier(effectiveTier(resolvedTier))
    setLoading(false)
  }, [supabase])
  useEffect(() => { load() }, [load])

  // Load a Short's already-stored MP4 (or surface the YouTube-download hint
  // when none is stored). Shared by the deep-link (?videoId=) and the in-page
  // Shorts picker.
  const loadShortVideo = useCallback(async (videoId: string) => {
    setLoadingShort(true); setShortLoaded(false); setYtDownloadHint(null)
    setSourceUrl(null); setResultUrl(null); setError(null)
    try {
      const r = await fetch(`/api/instagram/burn/source?videoId=${encodeURIComponent(videoId)}`)
      const d = await r.json() as { videoUrl?: string | null; youtubeVideoId?: string | null; noVideo?: boolean }
      if (d.videoUrl) { setSourceUrl(d.videoUrl); setShortLoaded(true) }
      else if (d.noVideo) { setYtDownloadHint({ youtubeVideoId: d.youtubeVideoId ?? null }) }
    } catch { /* non-fatal — user can still upload manually */ }
    finally { setLoadingShort(false) }
  }, [])

  // Pick a Short from the in-page gallery → prefill name/product + load its MP4.
  const pickShort = useCallback((s: ShortItem) => {
    setSelectedShortId(s.id)
    if (s.title) setProductName(s.title.replace(/#\w+/g, '').trim())
    if (s.productUrl) setProduct(s.productUrl)
    void loadShortVideo(s.id)
  }, [loadShortVideo])

  // Prefill from deep-link params (the Short pills pass ?productName=&product=
  // &videoId= so the clip + caption are grounded the moment you land here).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    const pn = sp.get('productName')
    const p = sp.get('product')
    const videoId = sp.get('videoId')
    if (pn) setProductName(pn)
    if (p) setProduct(p)
    if (videoId && /^[0-9a-f-]{36}$/i.test(videoId)) {
      setSourceMode('shorts')
      setSelectedShortId(videoId)
      void loadShortVideo(videoId)
    }
  }, [loadShortVideo])

  // Discover the creator's own Shorts so they can pick one without leaving the
  // burner. If they have any, default the source mode to "from my Shorts".
  useEffect(() => {
    let cancelled = false
    setLoadingShorts(true)
    fetch('/api/instagram/burn/shorts')
      .then(r => r.json())
      .then((d: { shorts?: ShortItem[] }) => {
        if (cancelled) return
        const list = Array.isArray(d.shorts) ? d.shorts : []
        setShorts(list)
        // Only auto-switch to Shorts mode when nothing's been chosen/uploaded.
        if (list.length > 0 && !sourceUrl) setSourceMode('shorts')
      })
      .catch(() => { if (!cancelled) setShorts([]) })
      .finally(() => { if (!cancelled) setLoadingShorts(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Admin View-as override — re-resolve effective tier whenever the chip
  // flips so the FeatureLockedCard appears/disappears live.
  useEffect(() => {
    const apply = () => setTier(effectiveTier(realTier))
    window.addEventListener(VIEW_AS_EVENT, apply)
    return () => window.removeEventListener(VIEW_AS_EVENT, apply)
  }, [realTier])

  const isPro = tier === 'pro' || tier === 'admin'

  async function handleUpload(file: File) {
    setError(null)
    setResultUrl(null)
    if (!file.type.startsWith('video/')) { setError('Please select a video file (MP4 recommended).'); return }
    if (file.size > 300 * 1024 * 1024) { setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB — keep it under 300MB.`); return }
    setUploading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
      // Match the proven IG-upload path shape ({uid}/{file}) — the bucket's RLS
      // policy only accepts the user id as the first folder, no extra subfolder.
      const path = `${user.id}/burner-${crypto.randomUUID()}.${ext}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.storage as any).from('instagram-videos').upload(path, file, {
        cacheControl: '3600', upsert: false, contentType: file.type || 'video/mp4',
      })
      if (upErr) throw new Error(upErr.message || 'Upload failed')
      const { data: urlData } = supabase.storage.from('instagram-videos').getPublicUrl(path)
      setSourceUrl(urlData.publicUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Generate a CTA box from a typed tag (AI badge → transparent PNG). On
  // success it becomes the active sticker (clears any gallery pick).
  async function generateSticker() {
    const t = tagText.trim()
    if (!t) { setGenStickerError('Type a short tag first.'); return }
    setGenStickerLoading(true); setGenStickerError(null)
    try {
      const res = await fetch('/api/instagram/burn/generate-sticker', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: t }),
      })
      const d = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok) throw new Error((d.error as string) || `Failed (HTTP ${res.status})`)
      const url = d.stickerUrl as string
      setGenStickerUrl(url)
      setStickerId(null) // a generated badge replaces any gallery selection
      // Add to the reusable "My boxes" list (it's already persisted server-side).
      setMyStickers(prev => [{ id: (d.id as string) ?? null, url, tag: (d.tag as string) || t }, ...prev])
    } catch (e) {
      setGenStickerError(e instanceof Error ? e.message : 'Could not generate the box')
    } finally {
      setGenStickerLoading(false)
    }
  }

  // Load the creator's saved CTA boxes once, so they can reuse a past design.
  useEffect(() => {
    let cancelled = false
    fetch('/api/instagram/burn/my-stickers')
      .then(r => r.json())
      .then((d: { stickers?: Array<{ id: string; url: string; tag: string }> }) => {
        if (!cancelled && Array.isArray(d.stickers)) setMyStickers(d.stickers)
      })
      .catch(() => { /* non-fatal */ })
    return () => { cancelled = true }
  }, [])

  async function deleteSticker(id: string | null, url: string) {
    setMyStickers(prev => prev.filter(s => s.url !== url))
    if (genStickerUrl === url) setGenStickerUrl(null)
    if (id) {
      try { await fetch(`/api/instagram/burn/my-stickers?id=${encodeURIComponent(id)}`, { method: 'DELETE' }) }
      catch { /* best-effort */ }
    }
  }

  async function burn() {
    if (!sourceUrl) { setError('Upload a video first.'); return }
    if (overlayType === 'sticker' && !stickerId && !genStickerUrl) { setError('Pick a CTA box or make one from text, or switch to caption text.'); return }
    setBurning(true); setError(null); setResultUrl(null); setIgCaption(null); setPublished(false); setIgError(null)
    try {
      const res = await fetch('/api/instagram/burn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: sourceUrl,
          caption: caption.trim() || 'LINK IN BIO',
          position,
          style,
          // A generated badge takes precedence over a gallery pick.
          customStickerUrl: overlayType === 'sticker' ? (genStickerUrl || undefined) : undefined,
          stickerId: overlayType === 'sticker' && !genStickerUrl ? stickerId : undefined,
          product: product.trim() || undefined,
          productName: productName.trim() || undefined,
        }),
      })
      const d = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok) throw new Error((d.error as string) || `Failed (HTTP ${res.status})`)
      setResultUrl(d.url as string)
      setIgCaption((d.caption as string) || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Burn failed')
    } finally {
      setBurning(false)
    }
  }

  // Explicit, user-initiated publish — kept separate from burn() so we never
  // auto-post (Meta content-publishing policy requires an explicit action).
  async function publishToIg() {
    if (!resultUrl) return
    setPublishing(true); setIgError(null)
    try {
      const res = await fetch('/api/instagram/publish-burned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: resultUrl, caption: igCaption ?? caption.trim() ?? 'LINK IN BIO' }),
      })
      const d = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok || d.published !== true) throw new Error((d.error as string) || `Failed (HTTP ${res.status})`)
      setPublished(true)
    } catch (e) {
      setIgError(e instanceof Error ? e.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  function copyCaption() {
    if (!igCaption) return
    navigator.clipboard.writeText(igCaption).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  async function download() {
    if (!resultUrl) return
    try {
      const res = await fetch(resultUrl)
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `captioned-${Date.now()}.mp4`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(href)
    } catch { window.open(resultUrl, '_blank') }
  }

  if (!metaUnlocked) {
    return (
      <>
        <PageHero title="Shop Burner" subtitle="Burn a call-to-action onto your vertical videos, then publish straight to Instagram Reels and TikTok — or download for Stories." />
        <div className="card p-6 max-w-xl flex items-start gap-3">
          <AlertCircle size={18} className="text-[#ff9500] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Temporarily unavailable</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">Instagram publishing is momentarily unavailable. Please try again shortly — you can still create and download content elsewhere in the app.</p>
          </div>
        </div>
      </>
    )
  }

  // Tier gate — non-Pro users get the FeatureLockedCard takeover instead
  // of the half-greyed-out form we used to show (banner on top, opacity-60
  // form below). Single source of truth + same visual as every other
  // gated page in the app.
  if (!isPro) {
    return (
      <FeatureLockedCard
        icon={<Flame size={28} strokeWidth={1.8} />}
        feature="Shop Burner"
        description='Upload a vertical video, burn a call-to-action onto it (like "LINK IN BIO"), then publish straight to Instagram Reels and TikTok — or download it to post anywhere.'
        bullets={[
          'Caption presets ("LINK IN BIO", "WATCH THE FULL VIDEO", "FOLLOW FOR MORE") + custom text',
          'Lower-third or center placement (lower-third clears Instagram\'s UI buttons)',
          'Four caption styles: white-on-dark, yellow-on-dark, black-on-white, white-with-shadow',
          'Direct publish to connected Instagram as a Reel (manual confirm — never auto-posts)',
          'Batch mode: up to 5 videos at once with a scheduled-publish queue',
          'Download as MP4 for Reels / Stories / TikTok reposting',
        ]}
        requiredTier="pro"
        currentTier={tier as Tier}
      />
    )
  }

  return (
    <>
      <PageHero
        title="Shop Burner"
        subtitle="Pick one of your YouTube Shorts (or upload a clip), burn a caption or CTA box onto it, then publish straight to Instagram Reels and TikTok — or download for Stories."
      />

      <div className="max-w-4xl">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#86868b] py-12 justify-center"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : (
          <>
            {/* Connected accounts — Instagram + TikTok, the two publish targets. */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {igUsername ? (
                <div className="flex items-center gap-2 rounded-lg border border-[#E1306C]/25 bg-[#E1306C]/5 px-3 py-2 w-fit">
                  <Instagram size={15} className="text-[#E1306C] flex-shrink-0" />
                  <span className="text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]">Instagram: <span className="font-semibold">@{igUsername}</span></span>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-white/10 px-3 py-2 w-fit">
                  <Instagram size={15} className="text-[#86868b] flex-shrink-0" />
                  <span className="text-[12px] text-[#6e6e73] dark:text-[#ebebf0]">No Instagram — <Link href="/connect-socials" className="text-[#7C3AED] font-semibold hover:underline">connect</Link></span>
                </div>
              )}
              {ttUsername ? (
                <div className="flex items-center gap-2 rounded-lg border border-black/15 bg-black/[0.04] dark:bg-white/5 px-3 py-2 w-fit">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0 text-black dark:text-white"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.45a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.34z"/></svg>
                  <span className="text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]">TikTok: <span className="font-semibold">@{ttUsername}</span></span>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-white/10 px-3 py-2 w-fit">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0 text-[#86868b]"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.45a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.34z"/></svg>
                  <span className="text-[12px] text-[#6e6e73] dark:text-[#ebebf0]">No TikTok — <Link href="/connect-socials" className="text-[#7C3AED] font-semibold hover:underline">connect</Link></span>
                </div>
              )}
            </div>

            <div className="flex gap-2 mb-4">
              <button onClick={() => setMode('single')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${mode === 'single' ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#7C3AED]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0]'}`}>Single video</button>
              <button onClick={() => setMode('batch')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${mode === 'batch' ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#7C3AED]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0]'}`}>Batch &amp; schedule · up to 5</button>
            </div>
            {mode === 'batch' ? (
              <BatchBurner supabase={supabase} />
            ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Controls */}
            <div className="card p-5 space-y-4">
              {/* 1. Source video — pick one of your own Shorts, or upload a file */}
              <div>
                <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">1. Your video <span className="font-normal text-[#86868b]">(vertical, under 300MB)</span></label>
                <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setShortLoaded(false); setSelectedShortId(null); setYtDownloadHint(null); handleUpload(f) } }} />

                {/* Mode toggle — only when the creator actually has Shorts. */}
                {shorts && shorts.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <button
                      onClick={() => setSourceMode('shorts')}
                      className={`text-center px-3 py-2 rounded-lg border text-[13px] font-medium transition-colors ${sourceMode === 'shorts' ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#7C3AED]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'}`}
                    >From my Shorts</button>
                    <button
                      onClick={() => setSourceMode('upload')}
                      className={`text-center px-3 py-2 rounded-lg border text-[13px] font-medium transition-colors ${sourceMode === 'upload' ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#7C3AED]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'}`}
                    >Upload a file</button>
                  </div>
                )}

                {sourceMode === 'shorts' && shorts && shorts.length > 0 ? (
                  <>
                    <div className="relative mb-2">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#86868b]" />
                      <input
                        type="text"
                        value={shortsQuery}
                        onChange={(e) => setShortsQuery(e.target.value)}
                        placeholder="Search your Shorts…"
                        className="input-field text-sm pl-8"
                      />
                    </div>
                    <div className="max-h-[300px] overflow-y-auto -mx-1 px-1 space-y-1.5">
                      {shorts
                        .filter(s => !shortsQuery || s.title.toLowerCase().includes(shortsQuery.toLowerCase()))
                        .map(s => (
                          <button
                            key={s.id}
                            onClick={() => pickShort(s)}
                            className={`w-full flex items-center gap-2.5 p-1.5 rounded-lg border text-left transition-colors ${selectedShortId === s.id ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}
                          >
                            {s.thumbnailUrl
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={s.thumbnailUrl} alt="" className="w-11 h-11 rounded object-cover flex-shrink-0 bg-black/5" />
                              : <div className="w-11 h-11 rounded bg-black/5 dark:bg-white/5 flex-shrink-0" />}
                            <span className="min-w-0 flex-1">
                              <span className="block text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] line-clamp-2 leading-snug">{s.title || 'Untitled Short'}</span>
                              <span className="block text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">
                                {s.hasVideo ? 'Ready to burn' : 'Needs download from YouTube'}{s.posted ? ' · already posted' : ''}
                              </span>
                            </span>
                            {selectedShortId === s.id && (
                              loadingShort
                                ? <Loader2 size={14} className="animate-spin text-[#7C3AED] flex-shrink-0" />
                                : shortLoaded
                                ? <CheckCircle size={14} className="text-[#34c759] flex-shrink-0" />
                                : null
                            )}
                          </button>
                        ))}
                    </div>
                    {/* Selected Short has no stored MP4 → link to YouTube Studio,
                        where the owner has a real Download button (⋮ → Download). */}
                    {selectedShortId && ytDownloadHint && !sourceUrl && (
                      <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-2 leading-relaxed">
                        We don&apos;t have this Short&apos;s MP4 yet.{' '}
                        {ytDownloadHint.youtubeVideoId && (
                          <a href={`https://studio.youtube.com/video/${ytDownloadHint.youtubeVideoId}/edit`} target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] font-semibold hover:underline">Open it in YouTube Studio</a>
                        )}{ytDownloadHint.youtubeVideoId ? ' → ⋮ → Download, then ' : 'Download it from YouTube Studio, then '}
                        <button onClick={() => setSourceMode('upload')} className="text-[#7C3AED] font-semibold hover:underline">upload it here</button> once.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading || loadingShort}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-gray-300 dark:border-white/15 text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#7C3AED] transition-colors disabled:opacity-60"
                    >
                      {uploading
                        ? <><Loader2 size={14} className="animate-spin" /> Uploading…</>
                        : sourceUrl
                        ? <><Video size={14} className="text-[#34c759]" /> Video ready — pick another</>
                        : <><UploadCloud size={14} /> Upload video</>}
                    </button>
                    {loadingShorts && !shorts && (
                      <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1.5 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Checking for your Shorts…</p>
                    )}
                    {ytDownloadHint && !sourceUrl && (
                      <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1.5 leading-relaxed">
                        We don&apos;t have this Short&apos;s MP4 yet.{' '}
                        {ytDownloadHint.youtubeVideoId && (
                          <a href={`https://studio.youtube.com/video/${ytDownloadHint.youtubeVideoId}/edit`} target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] font-semibold hover:underline">Open it in YouTube Studio</a>
                        )}{ytDownloadHint.youtubeVideoId ? ' → ⋮ → Download, then upload it here once.' : 'Download it from YouTube Studio, then upload it here once.'}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Overlay — styled text caption OR a pre-designed CTA box (PNG) */}
              <div>
                <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">2. Overlay</label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    onClick={() => setOverlayType('sticker')}
                    className={`text-center px-3 py-2 rounded-lg border text-[13px] font-medium transition-colors ${overlayType === 'sticker' ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#7C3AED]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'}`}
                  >CTA box</button>
                  <button
                    onClick={() => setOverlayType('text')}
                    className={`text-center px-3 py-2 rounded-lg border text-[13px] font-medium transition-colors ${overlayType === 'text' ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#7C3AED]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'}`}
                  >Caption text</button>
                </div>

                {overlayType === 'text' ? (
                  <>
                    <input
                      type="text"
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      maxLength={60}
                      className="input-field text-sm"
                      placeholder="LINK IN BIO"
                    />
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {CAPTION_PRESETS.map(p => (
                        <button key={p} onClick={() => setCaption(p)} className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${caption === p ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#7C3AED]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'}`}>{p}</button>
                      ))}
                    </div>
                    {/* Style */}
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      {STYLES.map(s => (
                        <button key={s.key} onClick={() => setStyle(s.key)} className={`text-left p-2 rounded-lg border transition-colors ${style === s.key ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}>
                          <span className="block text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{s.label}</span>
                          <span className="block text-[10px] text-[#86868b] dark:text-[#8e8e93]">{s.desc}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    {/* Make a CTA box from a typed tag (AI → transparent PNG, in our box style) */}
                    <div className="mb-3 p-2.5 rounded-lg border border-[#7C3AED]/25 bg-[#7C3AED]/5">
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5"><Sparkles size={11} className="text-[#7C3AED]" /> Make one from text</span>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={tagText}
                          onChange={e => setTagText(e.target.value)}
                          maxLength={40}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void generateSticker() } }}
                          placeholder="e.g. BUY BEFORE IT'S GONE"
                          className="input-field text-sm flex-1"
                        />
                        <button
                          onClick={() => void generateSticker()}
                          disabled={genStickerLoading || !tagText.trim()}
                          className="px-3 py-2 rounded-lg bg-[#7C3AED] text-white text-[13px] font-semibold disabled:opacity-50 inline-flex items-center gap-1.5 flex-shrink-0"
                        >
                          {genStickerLoading ? <><Loader2 size={13} className="animate-spin" /> Making…</> : <><Sparkles size={13} /> Make</>}
                        </button>
                      </div>
                      {genStickerError && <p className="text-[11px] text-[#ff3b30] mt-1.5">{genStickerError}</p>}
                      <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-1.5">1–6 words. MVP designs a transparent badge in our box style (~20s). Saved to “My boxes” to reuse anytime.</p>

                      {/* My boxes — the creator's saved designs, reusable across sessions */}
                      {myStickers.length > 0 && (
                        <div className="mt-3">
                          <p className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">My boxes</p>
                          <div className="grid grid-cols-2 gap-2">
                            {myStickers.map(s => (
                              <div key={s.url} className="relative">
                                <button
                                  onClick={() => { setGenStickerUrl(s.url); setStickerId(null) }}
                                  className={`w-full p-1.5 rounded-lg border transition-colors ${genStickerUrl === s.url ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={s.url} alt={s.tag || 'CTA box'} className="w-full h-auto rounded bg-[#1d1d1f]/5" />
                                  {s.tag && <span className="block text-[10px] text-center mt-1 truncate text-[#1d1d1f] dark:text-[#f5f5f7]">{s.tag}</span>}
                                </button>
                                <button
                                  onClick={() => void deleteSticker(s.id, s.url)}
                                  title="Delete this box"
                                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-black/80"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {CTA_STICKERS.length > 0 && (
                      <>
                        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mb-1.5">…or pick a ready-made box:</p>
                        <div className="grid grid-cols-2 gap-2">
                          {CTA_STICKERS.map(s => (
                            <button
                              key={s.id}
                              onClick={() => { setStickerId(s.id); setGenStickerUrl(null) }}
                              className={`p-1.5 rounded-lg border transition-colors ${stickerId === s.id ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={ctaStickerUrl(s.file)} alt={s.label} className="w-full h-auto rounded bg-[#1d1d1f]/5" />
                              <span className="block text-[11px] text-center mt-1 text-[#1d1d1f] dark:text-[#f5f5f7]">{s.label}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>

              {/* Position */}
              <div>
                <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">3. Position</label>
                <div className="grid grid-cols-2 gap-2">
                  {POSITIONS.map(p => (
                    <button key={p.key} onClick={() => setPosition(p.key)} className={`text-left p-2.5 rounded-lg border transition-colors ${position === p.key ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}>
                      <span className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{p.label}</span>
                      <span className="block text-[11px] text-[#86868b] dark:text-[#8e8e93]">{p.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Product (optional) — ASIN / store URL / TikTok Shop link → smart caption */}
              <div>
                <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">4. Product link <span className="font-normal text-[#86868b]">(optional)</span></label>
                <input
                  type="text"
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                  className="input-field text-sm"
                  placeholder="Amazon ASIN, store URL, or TikTok Shop link"
                />
                {/tiktok\.com|vt\.tiktok|tiktok\.shop|tiktokshop/i.test(product) && (
                  <p className="text-[11px] text-[#FF6B00] mt-1">TikTok links can&apos;t be read automatically — add the product name below so we can write the caption. The link is still used as your CTA.</p>
                )}
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  className="input-field text-sm mt-2"
                  placeholder="Product name (e.g. Stanley 40oz Tumbler) — optional for Amazon/store links"
                />
                <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">We research the link (or use the name) and write a caption — 3 niche hashtags + #ad disclosure — to post with the video.</p>
              </div>

              {error && <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {error}</p>}

              <button
                onClick={burn}
                disabled={burning || uploading || !sourceUrl}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-50 transition-colors w-full justify-center"
              >
                {burning ? <><Loader2 size={14} className="animate-spin" /> Burning… (~20–40s)</> : <><Flame size={14} /> Burn caption</>}
              </button>
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] text-center">The caption is rendered into the video itself, so it shows on-screen anywhere you post it.</p>
            </div>

            {/* Result */}
            <div>
              {resultUrl ? (
                <div className="card p-3 space-y-3">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video src={resultUrl} controls playsInline className="w-full rounded-lg bg-black max-h-[60vh]" />

                  {/* Composed Reel caption — review before publishing */}
                  {igCaption && (
                    <div className="rounded-lg border border-gray-200 dark:border-white/10 p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Reel caption</span>
                        <button onClick={copyCaption} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7C3AED] hover:underline">
                          {copied ? <><CheckCircle size={11} /> Copied!</> : <><Copy size={11} /> Copy</>}
                        </button>
                      </div>
                      <pre className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-pre-wrap font-sans leading-relaxed max-h-40 overflow-y-auto">{igCaption}</pre>
                    </div>
                  )}

                  {/* Publish status / explicit publish action */}
                  {published ? (
                    <div className="flex items-center gap-1.5 rounded-lg bg-[#34c759]/10 border border-[#34c759]/25 px-3 py-2 text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                      <Instagram size={13} className="text-[#E1306C] flex-shrink-0" /> Posted to your Instagram as a Reel.
                    </div>
                  ) : (
                    <>
                      {igError && (
                        <div className="flex items-start gap-1.5 rounded-lg bg-[#ff9500]/10 border border-[#ff9500]/25 px-3 py-2 text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                          <AlertCircle size={13} className="text-[#ff9500] flex-shrink-0 mt-0.5" /> Couldn’t publish ({igError}). You can download below and post it manually.
                        </div>
                      )}
                      <button
                        onClick={() => setConfirmPublish(true)}
                        disabled={publishing}
                        className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                        style={{ background: 'linear-gradient(90deg, #F58529, #DD2A7B, #8134AF)' }}
                      >
                        {publishing ? <><Loader2 size={13} className="animate-spin" /> Publishing to Instagram…</> : <><Instagram size={13} /> Publish to Instagram</>}
                      </button>
                      <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] text-center -mt-1">Review the video and caption above, then publish when you’re ready. Nothing is posted automatically.</p>
                    </>
                  )}

                  {/* Post the burned video straight to TikTok — opens the
                      audit-compliant composer (privacy picker, disclosure, etc.). */}
                  <button
                    onClick={() => setTtOpen(true)}
                    className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-semibold text-white hover:opacity-90 bg-black"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.45a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.34z" /></svg>
                    Post to TikTok
                  </button>

                  <button onClick={download} className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-semibold bg-[#34c759] text-white hover:opacity-90">
                    <Download size={13} /> Download captioned video
                  </button>
                </div>
              ) : (
                <div className="card p-8 text-center h-full flex flex-col items-center justify-center">
                  <Flame size={28} className="text-[#86868b] mx-auto mb-3" />
                  <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">Your captioned video will appear here.</p>
                </div>
              )}
            </div>
          </div>
            )}
          </>
        )}
      </div>

      {/* TikTok publish — burned video → audit-compliant TikTok composer. */}
      {ttOpen && resultUrl && (
        <TikTokDirectModal
          burnedVideoUrl={resultUrl}
          initialCaption={igCaption || caption}
          onClose={() => setTtOpen(false)}
        />
      )}

      {/* Final preview + confirm before anything is posted to Instagram. */}
      {confirmPublish && resultUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => { if (!publishing) setConfirmPublish(false) }}
        >
          <div
            className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-1">
              <Instagram size={18} className="text-[#E1306C]" />
              <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Publish this Reel to Instagram?</h3>
            </div>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
              This posts to your connected Instagram account{igUsername ? <> (<strong>@{igUsername}</strong>)</> : ''} as a Reel. Give it one last look.
            </p>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video src={resultUrl} controls playsInline className="w-full rounded-lg bg-black max-h-[45vh] mb-3" />
            {igCaption && (
              <div className="rounded-lg border border-gray-200 dark:border-white/10 p-2.5 mb-4">
                <span className="block text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Caption</span>
                <pre className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-pre-wrap font-sans leading-relaxed max-h-40 overflow-y-auto">{igCaption}</pre>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmPublish(false)}
                disabled={publishing}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-[#6e6e73] dark:text-[#ebebf0] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => { setConfirmPublish(false); publishToIg() }}
                disabled={publishing}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                style={{ background: 'linear-gradient(90deg, #F58529, #DD2A7B, #8134AF)' }}
              >
                <Instagram size={13} /> Confirm &amp; Publish
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Batch & schedule ─────────────────────────────────────────────────────────
interface BatchItem { id: string; url: string | null; uploading: boolean; caption: string; product: string; videoId?: string; label?: string }
interface Job { id: string; caption_text: string; status: string; scheduled_at: string; result_url: string | null; ig_published: boolean; error_message: string | null }

function defaultStartLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'text-[#7C3AED] bg-[#7C3AED]/10',
  processing: 'text-[#ff9500] bg-[#ff9500]/10',
  completed: 'text-[#34c759] bg-[#34c759]/10',
  failed: 'text-[#ff3b30] bg-[#ff3b30]/10',
}

function BatchBurner({ supabase }: { supabase: ReturnType<typeof createBrowserClient> }) {
  const [items, setItems] = useState<BatchItem[]>([{ id: crypto.randomUUID(), url: null, uploading: false, caption: 'LINK IN BIO', product: '' }])
  const [bStyle, setBStyle] = useState('white-pill')
  const [bPos, setBPos] = useState('lower-left')
  // Overlay (all videos): a pre-designed CTA box (PNG) or plain caption text —
  // mirrors the single-video burner. Default to the CTA box.
  const [bOverlay, setBOverlay] = useState<'sticker' | 'text'>('sticker')
  const [bBoxUrl, setBBoxUrl] = useState<string | null>(null)       // selected CTA box URL (all videos)
  const [boxes, setBoxes] = useState<Array<{ id: string | null; url: string; tag: string }>>([])
  const [genTag, setGenTag] = useState('')
  const [genLoading, setGenLoading] = useState(false)
  const [genErr, setGenErr] = useState<string | null>(null)
  // Source: pick from the creator's own Shorts (resolves the stored MP4) or
  // upload files — same options as single-video mode.
  const [bSource, setBSource] = useState<'shorts' | 'upload'>('upload')
  const [shorts, setShorts] = useState<ShortItem[] | null>(null)
  const [shortsQuery, setShortsQuery] = useState('')
  const [addingId, setAddingId] = useState<string | null>(null)
  const [startAt, setStartAt] = useState(defaultStartLocal())
  const [intervalHours, setIntervalHours] = useState(24)
  const [submitting, setSubmitting] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])

  // Load the creator's saved CTA boxes (shared with the single-video burner).
  useEffect(() => {
    let cancelled = false
    fetch('/api/instagram/burn/my-stickers')
      .then(r => r.json())
      .then((d: { stickers?: Array<{ id: string; url: string; tag: string }> }) => {
        if (!cancelled && Array.isArray(d.stickers)) setBoxes(d.stickers)
      })
      .catch(() => { /* non-fatal */ })
    return () => { cancelled = true }
  }, [])

  // Make a CTA box from a typed tag → becomes the active box (all videos).
  async function generateBox() {
    const t = genTag.trim()
    if (!t) { setGenErr('Type a short tag first.'); return }
    setGenLoading(true); setGenErr(null)
    try {
      const res = await fetch('/api/instagram/burn/generate-sticker', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: t }),
      })
      const d = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok) throw new Error((d.error as string) || `Failed (HTTP ${res.status})`)
      const url = d.stickerUrl as string
      setBBoxUrl(url)
      setBoxes(prev => [{ id: (d.id as string) ?? null, url, tag: (d.tag as string) || t }, ...prev])
      setGenTag('')
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : 'Could not generate the box')
    } finally { setGenLoading(false) }
  }

  // Discover the creator's own Shorts so they can add them without uploading.
  useEffect(() => {
    let cancelled = false
    fetch('/api/instagram/burn/shorts')
      .then(r => r.json())
      .then((d: { shorts?: ShortItem[] }) => {
        if (cancelled) return
        const list = Array.isArray(d.shorts) ? d.shorts : []
        setShorts(list)
        if (list.some(s => s.hasVideo)) setBSource('shorts') // default to Shorts when any are ready
      })
      .catch(() => { if (!cancelled) setShorts([]) })
    return () => { cancelled = true }
  }, [])

  // Add a Short as a batch item — resolves its stored 9:16 MP4. Capped at 5,
  // de-duped, and a Short with no render shows a clear error.
  async function addShort(s: ShortItem) {
    if (items.filter(it => it.url).length >= 5) { setErr('Up to 5 videos per batch.'); return }
    if (items.some(it => it.videoId === s.id)) return
    setAddingId(s.id); setErr(null)
    try {
      const r = await fetch(`/api/instagram/burn/source?videoId=${encodeURIComponent(s.id)}`)
      const d = await r.json() as { videoUrl?: string | null; noVideo?: boolean }
      if (!d.videoUrl) { setErr(`“${s.title.slice(0, 40)}” has no MP4 yet — download it from YouTube or upload the file.`); return }
      const newItem: BatchItem = { id: crypto.randomUUID(), url: d.videoUrl, uploading: false, caption: 'LINK IN BIO', product: s.productUrl || '', videoId: s.id, label: s.title }
      setItems(prev => {
        // Replace a blank placeholder row if there is one, else append (cap 5).
        const blank = prev.findIndex(it => !it.url && !it.uploading && !it.videoId)
        if (blank >= 0) { const next = [...prev]; next[blank] = newItem; return next }
        return prev.length >= 5 ? prev : [...prev, newItem]
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add that Short')
    } finally { setAddingId(null) }
  }

  const loadJobs = useCallback(async () => {
    try {
      const r = await fetch('/api/instagram/burn-batch')
      const d = await r.json()
      if (Array.isArray(d?.jobs)) setJobs(d.jobs as Job[])
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { loadJobs() }, [loadJobs])

  async function uploadItem(id: string, file: File) {
    if (!file.type.startsWith('video/')) { setErr('Pick a video file.'); return }
    if (file.size > 300 * 1024 * 1024) { setErr('Each video must be under 300MB.'); return }
    setErr(null)
    setItems(prev => prev.map(it => it.id === id ? { ...it, uploading: true } : it))
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
      const path = `${user.id}/burner-${crypto.randomUUID()}.${ext}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.storage as any).from('instagram-videos').upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'video/mp4' })
      if (upErr) throw new Error(upErr.message)
      const { data: urlData } = supabase.storage.from('instagram-videos').getPublicUrl(path)
      setItems(prev => prev.map(it => it.id === id ? { ...it, url: urlData.publicUrl, uploading: false } : it))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed')
      setItems(prev => prev.map(it => it.id === id ? { ...it, uploading: false } : it))
    }
  }

  function setField(id: string, field: 'caption' | 'product', value: string) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it))
  }
  function addItem() { setItems(prev => prev.length >= 5 ? prev : [...prev, { id: crypto.randomUUID(), url: null, uploading: false, caption: 'LINK IN BIO', product: '' }]) }
  function removeItem(id: string) { setItems(prev => prev.length <= 1 ? prev : prev.filter(it => it.id !== id)) }

  const readyItems = items.filter(it => it.url)

  // Exact scheduled time per post — mirrors the server's spread
  // (startMs + i * intervalHours). Shown in the review step so the user
  // confirms exactly what posts and when before anything is queued.
  function scheduledAt(index: number): Date {
    const startMs = startAt && !isNaN(Date.parse(startAt)) ? Date.parse(startAt) : Date.now()
    return new Date(startMs + index * intervalHours * 3600_000)
  }

  // Step 1: open the review panel (no posting happens yet).
  function openReview() {
    if (readyItems.length === 0) { setErr('Upload at least one video.'); return }
    if (bOverlay === 'sticker' && !bBoxUrl) { setErr('Pick a CTA box or make one from text, or switch to caption text.'); return }
    setErr(null); setMsg(null); setReviewing(true)
  }

  // Step 2: explicit confirm — only now do we queue the batch.
  async function confirmSchedule() {
    const ready = items.filter(it => it.url)
    if (ready.length === 0) { setErr('Upload at least one video.'); setReviewing(false); return }
    setSubmitting(true); setErr(null); setMsg(null)
    try {
      const res = await fetch('/api/instagram/burn-batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videos: ready.map(it => ({ videoUrl: it.url, caption: it.caption, product: it.product.trim() || undefined })),
          style: bStyle, position: bPos,
          // CTA box (all videos) when in sticker mode; omit for caption-text mode.
          stickerUrl: bOverlay === 'sticker' ? (bBoxUrl || undefined) : undefined,
          startAt: new Date(startAt).toISOString(),
          intervalHours,
        }),
      })
      const d = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok) throw new Error((d.error as string) || `Failed (HTTP ${res.status})`)
      setMsg(`Scheduled ${d.queued} video${(d.queued as number) > 1 ? 's' : ''}. First posts ${new Date(d.firstAt as string).toLocaleString()}.`)
      setItems([{ id: crypto.randomUUID(), url: null, uploading: false, caption: 'LINK IN BIO', product: '' }])
      setReviewing(false)
      loadJobs()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to queue')
    } finally { setSubmitting(false) }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Controls */}
      <div className="card p-5 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">1. Videos <span className="font-normal text-[#86868b]">({items.filter(it => it.url).length}/5)</span></label>
            {bSource === 'upload' && <button onClick={addItem} disabled={items.length >= 5} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7C3AED] hover:underline disabled:opacity-40"><Plus size={11} /> Add video</button>}
          </div>

          {/* Source toggle — From my Shorts | Upload (same as single video) */}
          {shorts && shorts.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button onClick={() => setBSource('shorts')} className={`text-center px-3 py-2 rounded-lg border text-[13px] font-medium transition-colors ${bSource === 'shorts' ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#7C3AED]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'}`}>From my Shorts</button>
              <button onClick={() => setBSource('upload')} className={`text-center px-3 py-2 rounded-lg border text-[13px] font-medium transition-colors ${bSource === 'upload' ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#7C3AED]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'}`}>Upload</button>
            </div>
          )}

          {/* Shorts picker — click to add (up to 5) */}
          {bSource === 'shorts' && shorts && shorts.length > 0 && (
            <div className="mb-2">
              <div className="relative mb-1.5">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#86868b]" />
                <input type="text" value={shortsQuery} onChange={(e) => setShortsQuery(e.target.value)} placeholder="Search your Shorts…" className="input-field text-[12px] pl-8" />
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {shorts.filter(s => !shortsQuery || s.title.toLowerCase().includes(shortsQuery.toLowerCase())).slice(0, 40).map(s => {
                  const added = items.some(it => it.videoId === s.id)
                  return (
                    <button key={s.id} onClick={() => addShort(s)} disabled={added || addingId === s.id} className={`w-full flex items-center gap-2 rounded-lg border p-1.5 text-left transition-colors ${added ? 'border-[#34c759]/40 bg-[#34c759]/5' : 'border-gray-200 dark:border-white/10 hover:border-[#7C3AED]'} disabled:opacity-70`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {s.thumbnailUrl ? <img src={s.thumbnailUrl} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" /> : <div className="w-10 h-10 rounded bg-[#1d1d1f]/5 flex-shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{s.title}</p>
                        <p className="text-[10px] text-[#86868b]">{s.hasVideo ? 'Ready to burn' : 'Needs download from YouTube'}{s.posted ? ' · already posted' : ''}</p>
                      </div>
                      <span className="text-[11px] font-semibold flex-shrink-0 pr-1">{addingId === s.id ? <Loader2 size={12} className="animate-spin" /> : added ? <CheckCircle size={13} className="text-[#34c759]" /> : <Plus size={13} className="text-[#7C3AED]" />}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* The chosen videos — caption + product + remove. Upload control only
              in upload mode; shorts-added rows show their title. */}
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={it.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-[#86868b] w-4">{i + 1}.</span>
                  {bSource === 'shorts' || it.videoId ? (
                    <span className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-[12px] ${it.url ? 'border-[#34c759]/40 text-[#34c759]' : 'border-dashed border-gray-300 dark:border-white/15 text-[#86868b]'}`}>
                      {it.url ? <><Video size={12} /> {it.label ? it.label.slice(0, 32) : 'Ready'}</> : 'Pick a Short above'}
                    </span>
                  ) : (
                    <label className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border border-dashed text-[12px] cursor-pointer ${it.url ? 'border-[#34c759]/40 text-[#34c759]' : 'border-gray-300 dark:border-white/15 text-[#6e6e73] dark:text-[#ebebf0] hover:border-[#7C3AED]'}`}>
                      <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadItem(it.id, f); e.currentTarget.value = '' }} />
                      {it.uploading ? <><Loader2 size={12} className="animate-spin" /> Uploading…</> : it.url ? <><Video size={12} /> Ready</> : <><UploadCloud size={12} /> Upload</>}
                    </label>
                  )}
                  {items.length > 1 && <button onClick={() => removeItem(it.id)} className="text-[#86868b] hover:text-[#ff3b30] p-1"><Trash2 size={13} /></button>}
                </div>
                <input type="text" value={it.caption} onChange={(e) => setField(it.id, 'caption', e.target.value)} maxLength={60} placeholder="Caption text (e.g. LINK IN BIO)" className="input-field text-[12px]" />
                <input type="text" value={it.product} onChange={(e) => setField(it.id, 'product', e.target.value)} placeholder="Product ASIN or URL (optional)" className="input-field text-[12px]" />
              </div>
            ))}
          </div>
          {bSource === 'shorts' && items.filter(it => it.url).length === 0 && (
            <p className="text-[11px] text-[#86868b] mt-1.5">Pick a Short above to add it (up to 5).</p>
          )}
        </div>

        {/* Overlay (all videos) — CTA box or caption text, same as single video */}
        <div>
          <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">2. Overlay (all videos)</label>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <button onClick={() => setBOverlay('sticker')} className={`text-center px-3 py-2 rounded-lg border text-[13px] font-medium transition-colors ${bOverlay === 'sticker' ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#7C3AED]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'}`}>CTA box</button>
            <button onClick={() => setBOverlay('text')} className={`text-center px-3 py-2 rounded-lg border text-[13px] font-medium transition-colors ${bOverlay === 'text' ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#7C3AED]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'}`}>Caption text</button>
          </div>
          {bOverlay === 'text' ? (
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Each video burns its own caption from the “Caption text” field above.</p>
          ) : (
            <div className="rounded-lg border border-[#7C3AED]/15 bg-[#7C3AED]/[0.03] p-2.5">
              {/* Make a CTA box from a typed tag */}
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5"><Sparkles size={11} className="text-[#7C3AED]" /> Make one from text</span>
              <div className="flex gap-1.5">
                <input type="text" value={genTag} onChange={(e) => setGenTag(e.target.value)} maxLength={40} placeholder="e.g. BUY BEFORE IT'S GONE" className="input-field text-[12px] flex-1" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void generateBox() } }} />
                <button onClick={() => void generateBox()} disabled={genLoading || !genTag.trim()} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-50">
                  {genLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Make
                </button>
              </div>
              {genErr && <p className="text-[10px] text-[#ff3b30] mt-1">{genErr}</p>}
              <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-1.5">1–6 words. Burned onto every video in this batch. Saved to “My boxes” to reuse anytime.</p>

              {boxes.length > 0 && (
                <div className="mt-2">
                  <p className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">My boxes</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {boxes.map(b => (
                      <button
                        key={b.url}
                        onClick={() => setBBoxUrl(b.url)}
                        title={b.tag || 'CTA box'}
                        className={`p-1.5 rounded-lg border transition-colors ${bBoxUrl === b.url ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={b.url} alt={b.tag || 'CTA box'} className="w-full h-auto rounded bg-[#1d1d1f]/5" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Shared style */}
        <div>
          <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">3. Style (all videos)</label>
          <div className="grid grid-cols-2 gap-2">
            {STYLES.map(s => (
              <button key={s.key} onClick={() => setBStyle(s.key)} className={`text-left p-2 rounded-lg border transition-colors ${bStyle === s.key ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}>
                <span className="block text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Shared position */}
        <div>
          <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">4. Position (all videos)</label>
          <div className="grid grid-cols-2 gap-2">
            {POSITIONS.map(p => (
              <button key={p.key} onClick={() => setBPos(p.key)} className={`text-left p-2.5 rounded-lg border transition-colors ${bPos === p.key ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}>
                <span className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Schedule */}
        <div>
          <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">5. Schedule</label>
          <div className="flex flex-col gap-2">
            <div>
              <span className="block text-[11px] text-[#86868b] mb-1">First post at</span>
              <input type="datetime-local" value={startAt} min={defaultStartLocal()} onChange={(e) => setStartAt(e.target.value)} className="input-field text-sm w-full" />
            </div>
            <div>
              <span className="block text-[11px] text-[#86868b] mb-1">Then one every…</span>
              <select value={intervalHours} onChange={(e) => setIntervalHours(Number(e.target.value))} className="input-field text-sm">
                <option value={0}>Post all now (as ready)</option>
                <option value={6}>6 hours</option>
                <option value={12}>12 hours</option>
                <option value={24}>1 day</option>
                <option value={48}>2 days</option>
                <option value={72}>3 days</option>
                <option value={168}>1 week</option>
              </select>
            </div>
          </div>
        </div>

        {err && <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {err}</p>}
        {msg && <p className="text-xs text-[#34c759] flex items-center gap-1.5"><CheckCircle size={12} /> {msg}</p>}

        <button onClick={openReview} disabled={submitting || !items.some(it => it.url)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-50 transition-colors w-full justify-center">
          <Clock size={14} /> Review &amp; schedule
        </button>
        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] text-center">You’ll review every post before anything is scheduled. Each video is then burned, captioned, and posted to Instagram at its scheduled time.</p>
      </div>

      {/* Queue */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Queue</h3>
          <button onClick={loadJobs} className="text-[11px] text-[#7C3AED] hover:underline">Refresh</button>
        </div>
        {jobs.length === 0 ? (
          <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">No scheduled videos yet.</p>
        ) : (
          <div className="space-y-2">
            {jobs.map(j => (
              <div key={j.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-white/10 p-2.5">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{j.caption_text}</p>
                  <p className="text-[10px] text-[#86868b]">{new Date(j.scheduled_at).toLocaleString()}{j.error_message ? ` · ${j.error_message.slice(0, 60)}` : ''}</p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_STYLE[j.status] || 'text-[#86868b] bg-gray-100'}`}>{j.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Review & confirm — explicit approval before anything is scheduled */}
      {reviewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !submitting && setReviewing(false)}>
          <div className="card max-w-lg w-full max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Review before scheduling</h3>
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mb-3">
              These {readyItems.length} post{readyItems.length > 1 ? 's' : ''} will be burned and published to your connected Instagram at the times below. Nothing is posted until you confirm.
            </p>
            <div className="space-y-2 mb-4">
              {readyItems.map((it, i) => (
                <div key={it.id} className="rounded-lg border border-gray-200 dark:border-white/10 p-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Post {i + 1} · “{it.caption.trim() || 'LINK IN BIO'}”</span>
                    <span className="text-[10px] font-medium text-[#7C3AED] flex-shrink-0">{scheduledAt(i).toLocaleString()}</span>
                  </div>
                  <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
                    {it.product.trim()
                      ? <>Reel caption auto-written from <span className="font-medium">{it.product.trim().slice(0, 60)}</span> (3 hashtags + #ad).</>
                      : <>No product set — the on-screen caption is used as the Reel caption.</>}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mb-4">
              Overlay: {bOverlay === 'sticker' ? 'CTA box' : 'Caption text'}{bOverlay === 'text' ? ` · Style: ${STYLES.find(s => s.key === bStyle)?.label}` : ''} · Position: {POSITIONS.find(p => p.key === bPos)?.label}
            </p>
            {err && <p className="text-xs text-[#ff3b30] flex items-center gap-1.5 mb-3"><AlertCircle size={12} /> {err}</p>}
            <div className="flex gap-2">
              <button onClick={() => setReviewing(false)} disabled={submitting} className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">
                Back
              </button>
              <button onClick={confirmSchedule} disabled={submitting} className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ background: 'linear-gradient(90deg, #F58529, #DD2A7B, #8134AF)' }}>
                {submitting ? <><Loader2 size={14} className="animate-spin" /> Scheduling…</> : <><Instagram size={14} /> Confirm &amp; schedule {readyItems.length} post{readyItems.length > 1 ? 's' : ''}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
