// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// InstagramPublishModal + InstagramPublishModalShell — the per-row
// "Publish to Instagram" flow opened from the IG pill on a horizontal
// or vertical VideoCard. Handles upload of vertical MP4, image
// generation for horizontal (auto-composed feed image), per-post
// account picker (Pro multi-account), and the Reel/Story/Both mode
// switcher. Reports success back through onReelPosted / onStoryPosted
// so the parent can flip its pill state.
//
// Extracted from app/(dashboard)/content/page.tsx 2026-06-07 — the
// largest single piece of the content-page split (~740 lines).
'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { CheckCircle, Loader2, RefreshCw, Wand2, X, Flame, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { createBrowserClient } from '@/lib/supabase/client'
import { useModalA11y } from '@/components/ui/useModalA11y'
import { effectiveTier } from '@/lib/view-as'
import { dispatchCapReached } from '@/components/CapReachedBanner'
import { pickWeightedStyleIndex, renderThumbnailOverlay } from '@/lib/thumbnail-overlay'

// ── Instagram Publish modal ───────────────────────────────────────────────────
// Opens when the user clicks the Instagram pill on a video card. Walks them
// through: upload vertical MP4 (if not yet) → pick mode (Reel/Story/Both) →
// publish. Calls the parent's posted callbacks so the pill state updates.
export function InstagramPublishModal({
  postId,
  videoDbId,
  videoKind,
  alreadyReeled,
  alreadyStoried,
  igAccounts,
  onClose,
  onPublishStart,
  onPublishEnd,
  onReelPosted,
  onStoryPosted,
}: {
  postId: string
  videoDbId: string
  /** 'vertical' = upload-MP4 path (Reels). 'horizontal' = auto-composed-image path (Feed image). */
  videoKind: 'horizontal' | 'vertical'
  alreadyReeled: boolean
  alreadyStoried: boolean
  /** Connected IG accounts (Pro multi-account) for the per-post picker. */
  igAccounts: Array<{ id: string; displayName: string | null; isDefault: boolean }>
  onClose: () => void
  onPublishStart: () => void
  onPublishEnd: () => void
  onReelPosted: () => void
  onStoryPosted: (affiliateUrl: string) => void
}) {
  const supabase = createBrowserClient()
  // Which IG account to publish to (Pro multi-account). Defaults to the last
  // choice, then the default account. Persisted across sessions.
  const [selectedIgAccountId, setSelectedIgAccountId] = useState<string>(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem('mvp_ig_account_choice') } catch { /* ignore */ }
    if (saved && igAccounts.some(a => a.id === saved)) return saved
    return igAccounts.find(a => a.isDefault)?.id ?? igAccounts[0]?.id ?? ''
  })
  // Media-ready URL — instagram_video_url for vertical, instagram_image_url for horizontal
  const [existingUrl, setExistingUrl] = useState<string | null>(null)
  // Real YouTube video id — deep-links to Studio to download the source MP4.
  const [ytVideoId, setYtVideoId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string>('')
  const [uploadError, setUploadError] = useState<string | null>(null)
  // Image generation state (horizontal kind only)
  const [generatingImage, setGeneratingImage] = useState(false)
  // Default mode: Both unless one's already been done — then only the missing one
  // Feed-post mode is 'reel' for vertical, 'image' for horizontal — kept in `feedMode`.
  const feedMode: 'reel' | 'image' = videoKind === 'horizontal' ? 'image' : 'reel'
  const initialMode: 'reel' | 'image' | 'story' | 'both' =
    alreadyReeled && !alreadyStoried ? 'story' : alreadyStoried && !alreadyReeled ? feedMode : 'both'
  const [mode, setMode] = useState<'reel' | 'image' | 'story' | 'both'>(initialMode)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewLoaded, setPreviewLoaded] = useState(false)
  const [previewedReelCaption, setPreviewedReelCaption] = useState('')
  const [previewedAffiliateUrl, setPreviewedAffiliateUrl] = useState<string | null>(null)
  // ── AI native IG image (Pro-only) ────────────────────────────────────────
  // Source-picker state. For horizontal videos the user can choose between
  // the existing "compose from YT thumbnail" path (free, fast) and the new
  // "generate native 4:5 AI image" path (Pro, slow, paid). Vertical videos
  // are MP4-upload only and don't see any of this.
  const [igSource, setIgSource] = useState<'compose' | 'ai'>('compose')
  const [aiHeadline, setAiHeadline] = useState('')
  const [aiFaceModelId, setAiFaceModelId] = useState<string | null>(null)
  const [aiFaceModels, setAiFaceModels] = useState<Array<{ id: string; name: string; trigger_token: string }>>([])
  const [aiTier, setAiTier] = useState<string>('trial')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  // Track which overlay style was used on the current AI image so the
  // 👍 / 👎 feedback row can attribute the reaction to a style. Cleared
  // whenever we leave the AI path or reset the preview.
  const [aiStyleId, setAiStyleId] = useState<string | null>(null)
  const [aiFeedbackSent, setAiFeedbackSent] = useState<'like' | 'dislike' | null>(null)
  // Aggregated feedback summary used to bias the random style picker.
  // Re-fetched on mount + after every reaction so weights stay fresh.
  const [styleWeights, setStyleWeights] = useState<{ liked: Record<string, number>; disliked: Record<string, number> }>({ liked: {}, disliked: {} })

  // Load Pro status + face models on mount so the AI option only shows
  // to users who can actually use it. Free-tier users see no second
  // option (they get the existing compose flow only).
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: intRow } = await supabase
          .from('integrations').select('tier').eq('user_id', user.id).single()
        setAiTier(effectiveTier(intRow?.tier as string))
        const fmRes = await fetch('/api/face-models')
        if (fmRes.ok) {
          const fm = await fmRes.json()
          const ready = ((fm.models as Array<{ id: string; name: string; trigger_token: string; status: string }>) || [])
            .filter(m => m.status === 'ready')
            .map(m => ({ id: m.id, name: m.name, trigger_token: m.trigger_token }))
          setAiFaceModels(ready)
        }
        // Pull aggregated 👍/👎 history for the IG surface so the random
        // style picker biases toward styles this user has rewarded —
        // niche-aware: weights styles that worked on this video's category.
        try {
          let nicheParam = ''
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: catRow } = await supabase.from('youtube_videos')
              .select('selected_category').eq('id', videoDbId).single()
            const cat = (catRow?.selected_category as string | null)?.trim()
            if (cat) nicheParam = `&niche=${encodeURIComponent(cat)}`
          } catch { /* overall weights */ }
          const fbRes = await fetch(`/api/thumbnail-feedback?surface=instagram${nicheParam}`)
          if (fbRes.ok) {
            const fb = await fbRes.json()
            setStyleWeights({ liked: fb.liked || {}, disliked: fb.disliked || {} })
          }
        } catch { /* silent — picker just goes uniform */ }
      } catch { /* silent — picker just won't render */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const aiIsPro = aiTier === 'pro' || aiTier === 'admin'

  /** Fire the IG-native AI image generation. On success, the returned
   *  imageUrl is wired into existingUrl so the rest of the modal treats
   *  it exactly like a composed image — preview, mode picker, publish all
   *  unchanged. */
  async function handleGenerateAIImage(opts: { force?: boolean } = {}) {
    setAiGenerating(true)
    setAiError(null)
    try {
      const res = await fetch('/api/instagram/generate-ai-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId,
          customHeadline: aiHeadline.trim() || undefined,
          faceModelId: aiFaceModelId || undefined,
          // Explicit Regenerate click bypasses the server-side cache and
          // burns a fresh credit. First-time generations leave this off
          // so re-opening the modal re-uses the previous result for free.
          force: opts.force === true,
        }),
      })
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (!res.ok) {
        if (data.limitReached) {
          dispatchCapReached(data.error || 'Cap reached.', {
            cap: data.cap || 'instagram_ai', currentTier: data.currentTier, upgrade: data.upgrade,
          })
          return
        }
        throw new Error(data.error || 'AI generation failed')
      }
      // Draw the headline overlay onto the Fal-returned image so the
      // user gets a viral-looking IG post, not a clean portrait with
      // no caption. 4:5 canvas (1080×1350). Falls back to the raw URL
      // if canvas/CORS fails so we never end up worse than before.
      const rawUrl = data.imageUrl as string
      const overlayHook = (data.overlayHook as string) || ''
      let finalUrl = rawUrl
      let styleId: string | null = null
      if (overlayHook) {
        try {
          const styleIndex = pickWeightedStyleIndex(styleWeights.liked, styleWeights.disliked)
          // Smart text-zone (vision) keeps the caption off the face when present.
          const textPosition = (data.textPosition as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center' | null) || undefined
          const faceBox = (data.faceBox as { x: number; y: number; w: number; h: number } | null) || undefined
          const overlayed = await renderThumbnailOverlay(rawUrl, overlayHook, { width: 1080, height: 1350, styleIndex, position: textPosition, faceBox })
          finalUrl = overlayed.url
          styleId = overlayed.styleId
        } catch (overlayErr) {
          console.warn('[ig-ai-overlay]', overlayErr)
        }
      }
      setAiStyleId(styleId)
      setAiFeedbackSent(null)
      setExistingUrl(finalUrl)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI generation failed')
    } finally {
      setAiGenerating(false)
    }
  }

  /** Record a 👍 / 👎 reaction on the current AI image. Best-effort — we
   *  don't surface errors because feedback shouldn't block publishing. */
  async function submitAiFeedback(reaction: 'like' | 'dislike') {
    if (!existingUrl) return
    setAiFeedbackSent(reaction)
    try {
      await fetch('/api/thumbnail-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thumbnailUrl: existingUrl,
          reaction,
          // styleId may be null on legacy cached images that pre-date the
          // hook persistence — still record the surface-level signal.
          styleId: aiStyleId,
          surface: 'instagram',
          modelUsed: aiFaceModelId ? 'fal-flux-lora' : 'fal-flux-pro-v1.1',
          videoId: videoDbId,
        }),
      })
      // Optimistically bump local weights so the next regen reflects the
      // signal without waiting on a round-trip.
      if (aiStyleId) {
        setStyleWeights(prev => {
          const next = { liked: { ...prev.liked }, disliked: { ...prev.disliked } }
          const bucket = reaction === 'like' ? next.liked : next.disliked
          bucket[aiStyleId] = (bucket[aiStyleId] || 0) + 1
          return next
        })
      }
    } catch (e) {
      console.warn('[ig-ai-feedback]', e)
    }
  }

  // Load whichever URL applies to this kind
  useEffect(() => {
    const col = videoKind === 'horizontal' ? 'instagram_image_url' : 'instagram_video_url'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;supabase.from('youtube_videos').select(`${col},youtube_video_id`).eq('id', videoDbId).single().then(({ data }: { data: Record<string, string | null> | null }) => {
      const url = data?.[col]
      if (url) setExistingUrl(url)
      setYtVideoId(data?.youtube_video_id ?? null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoDbId, videoKind])

  /** Horizontal kind: kick off server-side image composition. */
  async function handleGenerateImage() {
    setGeneratingImage(true)
    setUploadError(null)
    setUploadProgress('Composing image…')
    try {
      const res = await fetch('/api/instagram/compose-thumbnail-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoDbId }),
      })
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (!res.ok) throw new Error(data.error || 'Image generation failed')
      setExistingUrl(data.instagramImageUrl as string)
      setUploadProgress('')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Image generation failed')
      setUploadProgress('')
    } finally {
      setGeneratingImage(false)
    }
  }

  async function handleFileUpload(file: File) {
    if (!file) return
    if (!file.type.startsWith('video/')) {
      setUploadError('Please select a video file (MP4 recommended).')
      return
    }
    // 300MB cap. The upload goes browser → Supabase Storage directly (not
    // through a Vercel function), so the ceiling is the Supabase bucket's
    // file_size_limit (set to 300MB) — well within Instagram's ~1GB Reel limit.
    if (file.size > 300 * 1024 * 1024) {
      setUploadError(`File is ${(file.size / 1024 / 1024).toFixed(1)}MB — videos must be under 300MB. Compress and retry.`)
      return
    }
    setUploading(true)
    setUploadError(null)
    setUploadProgress('Uploading…')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
      const path = `${user.id}/${videoDbId}.${ext}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.storage as any).from('instagram-videos').upload(path, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.type || 'video/mp4',
      })
      if (upErr) throw new Error(upErr.message || 'Upload failed')
      const { data: urlData } = supabase.storage.from('instagram-videos').getPublicUrl(path)
      const publicUrl = urlData.publicUrl
      // Persist on youtube_videos so the publish route can read it
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateErr } = await supabase.from('youtube_videos').update({ instagram_video_url: publicUrl }).eq('id', videoDbId)
      if (updateErr) throw new Error(updateErr.message || 'Save failed')
      setExistingUrl(publicUrl)
      setUploadProgress('')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  /** Re-trigger preview generation when the user changes mode after previewing. */
  function resetPreview() {
    setPreviewLoaded(false)
    setPreviewedReelCaption('')
    setPreviewedAffiliateUrl(null)
    setPublishError(null)
  }

  const apiKind: 'video' | 'image' = videoKind === 'horizontal' ? 'image' : 'video'

  /** Step 3 — call publish route with dryRun: true to get the editable caption + affiliate URL. */
  async function previewContent() {
    setPreviewing(true)
    setPublishError(null)
    try {
      const res = await fetch('/api/blog/instagram-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, kind: apiKind, mode, dryRun: true, socialAccountId: selectedIgAccountId || undefined }),
      })
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (!res.ok) throw new Error(data.error || 'Preview failed')
      setPreviewedReelCaption((data.reelCaption as string) ?? '')
      setPreviewedAffiliateUrl((data.affiliateUrl as string) ?? null)
      setPreviewLoaded(true)
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  /** Step 4 — publish using the (possibly edited) caption from the preview step. */
  async function publish() {
    if (!existingUrl) {
      setPublishError(videoKind === 'horizontal' ? 'Generate the Instagram image first.' : 'Upload a vertical MP4 first.')
      return
    }
    setPublishing(true)
    setPublishError(null)
    onPublishStart()
    try {
      const sendsFeedCaption = mode === feedMode || mode === 'both'
      const res = await fetch('/api/blog/instagram-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId,
          kind: apiKind,
          mode,
          caption: sendsFeedCaption ? previewedReelCaption : undefined,
          socialAccountId: selectedIgAccountId || undefined,
        }),
      })
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (!res.ok) throw new Error(data.error || 'Publish failed')

      if (data.reelId || data.imagePostId) onReelPosted()
      if (data.storyId) onStoryPosted(data.affiliateUrl ?? '')

      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        setPublishError('Published with warnings: ' + data.warnings.join(' · '))
        return
      }
      onClose()
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setPublishing(false)
      onPublishEnd()
    }
  }

  return (
    <InstagramPublishModalShell onClose={onClose}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                  <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 5.838c3.405 0 6.162 2.76 6.162 6.162 0 3.405-2.76 6.162-6.162 6.162-3.405 0-6.162-2.76-6.162-6.162 0-3.405 2.76-6.162 6.162-6.162zM12 16c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z"/>
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Publish to Instagram</h3>
            </div>
            <button onClick={onClose} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]">
              <X size={16} />
            </button>
          </div>

          {/* Account picker — only when the user has more than one IG account. */}
          {igAccounts.length > 1 && (
            <div className="mb-5">
              <label className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5 block">Publish to account</label>
              <select
                value={selectedIgAccountId}
                onChange={e => {
                  const v = e.target.value
                  setSelectedIgAccountId(v)
                  try { localStorage.setItem('mvp_ig_account_choice', v) } catch { /* ignore */ }
                }}
                className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 focus:border-[#7C3AED] focus:outline-none"
              >
                {igAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.displayName || 'Instagram account'}</option>
                ))}
              </select>
            </div>
          )}

          {/* Step 1 — Media source (video upload for vertical, auto-image for horizontal) */}
          <div className="mb-5">
            <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
              {videoKind === 'horizontal'
                ? '1. Instagram image (4:5, auto-composed from your thumbnail)'
                : '1. Vertical video (9:16, MP4, <300MB)'}
            </p>
            {existingUrl ? (
              videoKind === 'horizontal' ? (
                <div className="rounded-lg bg-[#34c759]/5 border border-[#34c759]/30 p-3">
                  <div className="flex items-start gap-3">
                    {/* Bigger preview — 200px wide, 4:5 ratio. Big enough
                        to actually evaluate the headline + face before
                        publishing, without dominating the modal. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={existingUrl} alt="Composed Instagram image" className="w-44 rounded-md object-cover border border-gray-200 dark:border-white/10 flex-shrink-0" style={{ aspectRatio: '4/5' }} />
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      <p className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-1.5">
                        <CheckCircle size={12} className="text-[#34c759]" /> Image ready
                      </p>
                      {/* Regenerate routes to whichever source the user
                          picked. AI path forces a fresh generation server-
                          side so the user actually gets a NEW image (not
                          the cached one). */}
                      {aiIsPro && igSource === 'ai' ? (
                        <button
                          onClick={() => handleGenerateAIImage({ force: true })}
                          disabled={aiGenerating}
                          className="text-[11px] text-[#5856d6] hover:underline inline-flex items-center gap-1 disabled:opacity-60 self-start"
                        >
                          {aiGenerating ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Regenerate AI image
                        </button>
                      ) : (
                        <button onClick={handleGenerateImage} disabled={generatingImage} className="text-[11px] text-[#7C3AED] hover:underline inline-flex items-center gap-1 disabled:opacity-60 self-start">
                          {generatingImage ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Regenerate
                        </button>
                      )}
                      {/* Reset / Discard — clears existingUrl so the source
                          picker (Compose vs AI) reappears. Lets the user
                          switch paths without closing the whole modal. */}
                      <button
                        onClick={() => {
                          setExistingUrl(null)
                          setUploadError(null)
                          setAiError(null)
                          setAiStyleId(null)
                          setAiFeedbackSent(null)
                          // Reset preview state so old caption draft
                          // doesn't carry across the source switch.
                          resetPreview()
                        }}
                        disabled={generatingImage || aiGenerating}
                        className="text-[11px] text-[#ff3b30] hover:underline inline-flex items-center gap-1 disabled:opacity-60 self-start"
                      >
                        <X size={10} /> Discard &amp; pick a different source
                      </button>
                      {/* 👍 / 👎 feedback — only on AI images where we
                          captured a styleId. The picker on the next gen
                          biases toward 'like' styles + away from 'dislike'
                          styles, so this is the user training their own
                          random generator. */}
                      {aiIsPro && igSource === 'ai' && (
                        <div className="flex items-center gap-2 pt-1">
                          <span className="text-[10px] text-[#86868b]">Train the AI:</span>
                          <button
                            onClick={() => submitAiFeedback('like')}
                            disabled={aiFeedbackSent !== null}
                            className={`text-[11px] px-2 py-0.5 rounded border transition ${aiFeedbackSent === 'like' ? 'bg-[#34c759]/20 border-[#34c759] text-[#34c759]' : 'border-gray-200 dark:border-white/10 hover:border-[#34c759]'} disabled:opacity-60`}
                            title="I'd use this thumbnail"
                          >
                            👍
                          </button>
                          <button
                            onClick={() => submitAiFeedback('dislike')}
                            disabled={aiFeedbackSent !== null}
                            className={`text-[11px] px-2 py-0.5 rounded border transition ${aiFeedbackSent === 'dislike' ? 'bg-[#ff3b30]/20 border-[#ff3b30] text-[#ff3b30]' : 'border-gray-200 dark:border-white/10 hover:border-[#ff3b30]'} disabled:opacity-60`}
                            title="Not this style"
                          >
                            👎
                          </button>
                          {aiFeedbackSent && (
                            <span className="text-[10px] text-[#86868b]">Thanks — saved.</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 rounded-lg bg-[#34c759]/5 border border-[#34c759]/30">
                  <p className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-1.5">
                    <CheckCircle size={12} className="text-[#34c759]" /> Video ready
                  </p>
                  <button onClick={() => { setExistingUrl(null); resetPreview() }} className="text-[11px] text-[#7C3AED] hover:underline">
                    Replace
                  </button>
                </div>
              )
            ) : videoKind === 'horizontal' ? (
              <div className="space-y-3">
                {/* Source picker — only renders for Pro users. Trial/Creator —
                    see just the compose button (current behavior). */}
                {aiIsPro && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setIgSource('compose')}
                      className={`flex-1 p-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                        igSource === 'compose'
                          ? 'border-[#E1306C] bg-[#E1306C]/5 text-[#1d1d1f] dark:text-[#f5f5f7]'
                          : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'
                      }`}
                    >
                      Compose from YT thumbnail
                      <span className="block text-[10px] font-normal text-[#86868b] mt-0.5">Free · 5s</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIgSource('ai')}
                      className={`flex-1 p-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                        igSource === 'ai'
                          ? 'border-[#5856d6] bg-[#5856d6]/5 text-[#1d1d1f] dark:text-[#f5f5f7]'
                          : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'
                      }`}
                    >
                      ✨ Generate native AI image
                      <span className="block text-[10px] font-normal text-[#86868b] mt-0.5">Pro · 4:5 portrait · ~30s</span>
                    </button>
                  </div>
                )}

                {/* AI configuration form — face picker + headline lock */}
                {aiIsPro && igSource === 'ai' && (
                  <div className="p-3 rounded-lg border border-[#5856d6]/30 bg-[#5856d6]/5 space-y-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
                        Headline <span className="font-normal text-[#86868b]">(optional · leave blank for AI to pick)</span>
                      </label>
                      <input
                        type="text"
                        value={aiHeadline}
                        onChange={(e) => setAiHeadline(e.target.value)}
                        placeholder="e.g. GAME CHANGER!"
                        maxLength={40}
                        disabled={aiGenerating}
                        className="w-full text-xs px-2.5 py-1.5 rounded-md bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] focus:border-[#5856d6] focus:outline-none uppercase tracking-wide"
                      />
                    </div>
                    {aiFaceModels.length > 0 ? (
                      <div>
                        <label className="block text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Face</label>
                        <div className="flex flex-col gap-1">
                          <label className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer text-xs ${aiFaceModelId === null ? 'border-[#5856d6] bg-white dark:bg-[#0a0a0a]' : 'border-gray-200 dark:border-white/10'}`}>
                            <input type="radio" name="ig-face" checked={aiFaceModelId === null} onChange={() => setAiFaceModelId(null)} />
                            <span>No face — product-only</span>
                          </label>
                          {aiFaceModels.map(m => (
                            <label key={m.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer text-xs ${aiFaceModelId === m.id ? 'border-[#5856d6] bg-white dark:bg-[#0a0a0a]' : 'border-gray-200 dark:border-white/10'}`}>
                              <input type="radio" name="ig-face" checked={aiFaceModelId === m.id} onChange={() => setAiFaceModelId(m.id)} />
                              <span className="font-medium">{m.name}</span>
                              <span className="text-[10px] text-[#86868b]">({m.trigger_token})</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0]">
                        No trained faces yet — the AI will generate a product-only portrait. <Link href="/face-training" className="text-[#5856d6] hover:underline">Train your face</Link> for stronger Instagram results.
                      </p>
                    )}
                    <button
                      onClick={() => handleGenerateAIImage()}
                      disabled={aiGenerating}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold text-white disabled:opacity-60"
                      style={{ background: 'linear-gradient(135deg, #5856d6 0%, #E1306C 100%)' }}
                    >
                      {aiGenerating
                        ? <><Loader2 size={11} className="animate-spin" /> Generating (20-40s)…</>
                        : <>✨ Generate AI image</>}
                    </button>
                    {aiError && <p className="text-[11px] text-[#ff3b30]">{aiError}</p>}
                    <p className="text-[10px] text-[#86868b] italic">
                      Each generation counts as 1 of your monthly Instagram AI credits. Re-opening this modal later re-uses the same image free.
                    </p>
                  </div>
                )}

                {/* Compose button — only shown when source = compose OR user is not Pro */}
                {(!aiIsPro || igSource === 'compose') && (
                  <button
                    onClick={handleGenerateImage}
                    disabled={generatingImage}
                    className="w-full flex flex-col items-center justify-center p-6 rounded-lg border-2 border-dashed border-gray-300 dark:border-white/15 hover:border-[#E1306C] cursor-pointer transition-colors disabled:cursor-wait"
                  >
                    {generatingImage ? (
                      <>
                        <Loader2 size={20} className="animate-spin text-[#E1306C] mb-2" />
                        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{uploadProgress || 'Composing image…'}</p>
                      </>
                    ) : (
                      <>
                        <Wand2 size={18} className="text-[#86868b] dark:text-[#8e8e93] mb-2" />
                        <p className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">Compose Instagram image</p>
                        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">YouTube thumbnail + title + your brand · 1080×1350</p>
                      </>
                    )}
                  </button>
                )}
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center p-6 rounded-lg border-2 border-dashed border-gray-300 dark:border-white/15 hover:border-[#7C3AED] cursor-pointer transition-colors">
                <input type="file" accept="video/*" className="hidden" onChange={e => e.target.files?.[0] && handleFileUpload(e.target.files[0])} disabled={uploading} />
                {uploading ? (
                  <>
                    <Loader2 size={20} className="animate-spin text-[#7C3AED] mb-2" />
                    <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{uploadProgress || 'Uploading…'}</p>
                  </>
                ) : (
                  <>
                    <Wand2 size={18} className="text-[#86868b] dark:text-[#8e8e93] mb-2" />
                    <p className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">Click to upload vertical MP4</p>
                    <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">9:16 aspect ratio, 3–90 seconds, under 300MB</p>
                  </>
                )}
              </label>
            )}
            {/* No vertical video yet → help them get the source MP4 (download
                from their own YouTube video) and offer to make one in Shop Burner
                (adds a “Shop Now” sticker). The burner stores the 9:16 render on
                the same field, so it's ready here AND on TikTok afterwards. */}
            {videoKind === 'vertical' && !uploading && (
              <div className="mt-2 flex flex-col gap-1.5">
                {ytVideoId && (
                  <a
                    href={`https://studio.youtube.com/video/${encodeURIComponent(ytVideoId)}/edit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[#7C3AED] hover:underline"
                  >
                    <ExternalLink size={14} />
                    Don&apos;t have the file? Download it from your YouTube video
                  </a>
                )}
                <a
                  href={`/instagram-burner?videoId=${encodeURIComponent(videoDbId)}&from=instagram`}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#7C3AED] hover:underline"
                >
                  <Flame size={14} />
                  or make one in Shop Burner (add a “Shop Now” sticker)
                </a>
              </div>
            )}
            {uploadError && <p className="text-[11px] text-[#ff3b30] mt-2">{uploadError}</p>}
          </div>

          {/* Step 2 — Mode picker */}
          <div className="mb-5">
            <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">2. What to publish</p>
            <div className="grid grid-cols-3 gap-2">
              {(videoKind === 'horizontal' ? ([
                { val: 'image' as const, label: 'Feed post', hint: 'Image + SEO caption + 20 hashtags. No clickable link (IG limitation).', disabled: alreadyReeled && !alreadyStoried },
                { val: 'story' as const, label: 'Story only', hint: 'Image + link sticker (you add the sticker manually after).', disabled: alreadyStoried && !alreadyReeled },
                { val: 'both' as const, label: 'Both', hint: 'Feed post for reach + Story for affiliate clicks. Recommended.', disabled: alreadyReeled && alreadyStoried },
              ]) : ([
                { val: 'reel' as const, label: 'Reel only', hint: 'Max SEO caption + 20 hashtags. No clickable link (IG limitation).', disabled: alreadyReeled && !alreadyStoried },
                { val: 'story' as const, label: 'Story only', hint: 'Video + link sticker (you add the sticker manually after).', disabled: alreadyStoried && !alreadyReeled },
                { val: 'both' as const, label: 'Both', hint: 'Reel for reach + Story for affiliate clicks. Recommended.', disabled: alreadyReeled && alreadyStoried },
              ])).map(opt => (
                <button
                  key={opt.val}
                  onClick={() => { setMode(opt.val); resetPreview() }}
                  disabled={opt.disabled}
                  className={`p-3 rounded-lg border text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    mode === opt.val
                      ? 'border-[#E1306C] bg-[#E1306C]/5'
                      : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
                  }`}
                >
                  <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{opt.label}</p>
                  <p className="text-[10px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mt-1">{opt.hint}</p>
                </button>
              ))}
            </div>
            {(alreadyReeled || alreadyStoried) && (
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-2 italic">
                Already posted: {alreadyReeled && 'Reel'}{alreadyReeled && alreadyStoried && ' + '}{alreadyStoried && 'Story'}
              </p>
            )}
          </div>

          {/* Step 3 — Preview (collapses into Publish once user has previewed) */}
          {!previewLoaded ? (
            <div className="mb-5">
              <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">3. Preview the AI caption before publishing</p>
              <button
                onClick={previewContent}
                disabled={previewing}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/10 hover:bg-gray-200 dark:hover:bg-white/20 disabled:opacity-60 transition-colors"
              >
                {previewing ? <><Loader2 size={12} className="animate-spin" /> Generating preview…</> : <><Wand2 size={12} /> Preview AI content</>}
              </button>
              <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-2 leading-relaxed">
                We&apos;ll show you the generated caption + hashtags so you can edit them before publishing. Nothing posts to Instagram until you click Publish.
              </p>
            </div>
          ) : (
            <div className="mb-5">
              <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">3. Edit before publishing</p>

              {(mode === feedMode || mode === 'both') && (
                <div className="mb-3">
                  <label className="text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1 block">{videoKind === 'horizontal' ? 'Post' : 'Reel'} caption + hashtags <span className="text-[#86868b]">({previewedReelCaption.length}/2200)</span></label>
                  <textarea
                    value={previewedReelCaption}
                    onChange={e => setPreviewedReelCaption(e.target.value.slice(0, 2200))}
                    rows={9}
                    className="w-full text-xs text-[#1d1d1f] dark:text-[#f5f5f7] p-3 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 focus:border-[#E1306C] focus:outline-none leading-relaxed font-mono"
                    placeholder="Caption will appear here once preview is generated"
                  />
                  <button onClick={previewContent} disabled={previewing} className="text-[10px] text-[#7C3AED] hover:underline mt-1 inline-flex items-center gap-1 disabled:opacity-60">
                    {previewing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Regenerate
                  </button>
                </div>
              )}

              {(mode === 'story' || mode === 'both') && previewedAffiliateUrl && (
                <div className="rounded-lg border border-[#E1306C]/30 bg-[#E1306C]/5 p-3 mb-3">
                  <p className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Story link (you&apos;ll add this as a Link Sticker after publish)</p>
                  <code className="text-[11px] font-mono text-[#7C3AED] break-all">{previewedAffiliateUrl}</code>
                  <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-1.5 leading-relaxed">
                    The Story video publishes automatically. Instagram&apos;s API doesn&apos;t expose link stickers, so you&apos;ll tap to copy this URL after publish and paste it into a Link sticker on your phone (5 sec).
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 4 — Publish (only shown once preview is loaded) */}
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} disabled={publishing} className="text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] px-3 py-2">
              Cancel
            </button>
            <button
              onClick={publish}
              disabled={!existingUrl || !previewLoaded || publishing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)' }}
              title={!previewLoaded ? 'Preview the AI content first' : ''}
            >
              {publishing ? <><Loader2 size={12} className="animate-spin" /> Publishing…</> : <>Publish to Instagram</>}
            </button>
          </div>
          {publishError && <p className="text-[11px] text-[#ff3b30] mt-3 break-all">{publishError}</p>}
        </div>
    </InstagramPublishModalShell>
  )
}

/** Modal shell wrapper for InstagramPublishModal — gives proper focus
 *  trap, scroll lock, Escape close, and restore-focus via useModalA11y. */
export function InstagramPublishModalShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const onA11yKey = useModalA11y(true, panelRef, onClose)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
      onKeyDown={onA11yKey}
      role="presentation"
    >
      <div
        ref={panelRef}
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto outline-none"
        role="dialog"
        aria-modal="true"
        aria-label="Publish to Instagram"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  )
}
