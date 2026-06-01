'use client'

/**
 * InstagramDirectModal — modal for pushing a vertical YouTube Short
 * straight to Instagram (Reel and/or Story) WITHOUT first generating a
 * blog post. Opens from the Instagram pill on a Vertical Videos row.
 *
 * Caption is generated fresh via Haiku (instagram-tuned: 8 niche hashtags
 * + affiliate disclaimer baked in). The user can edit anything before
 * hitting Post.
 */
import { useEffect, useState, useCallback } from 'react'
import {
  Loader2, AlertCircle, CheckCircle, Send, ExternalLink, X,
  RefreshCw, Package,
} from 'lucide-react'
import { ShortVideoUpload } from '@/components/ShortVideoUpload'

interface VideoMeta {
  title: string
  videoUrl: string | null
  /** 11-char YouTube video id. Used to deep-link the creator into their
   *  YouTube Studio so they can hit the official Download button. */
  youtubeVideoId?: string | null
  defaultCaption: string
  hashtags: string[]
  hook: string
  igUsername: string
  alreadyReelPosted: boolean
  alreadyStoryPosted: boolean
  productResolved?: { title: string; asin: string | null } | null
}

type Mode = 'reel' | 'story' | 'both'

export function InstagramDirectModal({
  videoId,
  onClose,
  onPosted,
}: {
  videoId: string
  onClose: () => void
  /** Fires once a Reel or Story is successfully posted. The row pill flips
   *  to "Posted" state in response. */
  onPosted?: (mode: Mode) => void
}) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [meta, setMeta] = useState<VideoMeta | null>(null)
  const [reconnectRequired, setReconnectRequired] = useState(false)

  // Optional product context for caption regeneration.
  const [productInput, setProductInput] = useState('')
  const [regenerating, setRegenerating] = useState(false)
  const [productResolved, setProductResolved] = useState<{ title: string; asin: string | null } | null>(null)

  const [caption, setCaption] = useState('')
  const [mode, setMode] = useState<Mode>('reel')

  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [posted, setPosted] = useState<{ reel?: string; story?: string } | null>(null)
  const [partialErrors, setPartialErrors] = useState<string[]>([])
  // 11-char YouTube id stashed separately so we can build the Studio link
  // even on the error path (where `meta` is null).
  const [youtubeId, setYoutubeId] = useState<string | null>(null)

  const loadMeta = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/instagram/post-direct-video/video-meta?videoId=${encodeURIComponent(videoId)}`)
      const json = await res.json()
      setYoutubeId((json.youtubeVideoId as string | null) ?? null)
      if (!res.ok || !json.videoUrl) {
        setLoadError(json.error || 'No vertical video ready for this Short.')
        setMeta(null)
        setLoading(false)
        return
      }
      setMeta(json as VideoMeta)
      setCaption((json.defaultCaption as string) || '')
      setProductResolved((json.productResolved as { title: string; asin: string | null } | null) || null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Loading failed.')
    } finally {
      setLoading(false)
    }
  }, [videoId])

  useEffect(() => { void loadMeta() }, [loadMeta])

  const regenerateCaption = useCallback(async () => {
    setRegenerating(true)
    try {
      const url = `/api/instagram/post-direct-video/video-meta?videoId=${encodeURIComponent(videoId)}${productInput.trim() ? `&productInput=${encodeURIComponent(productInput.trim())}` : ''}`
      const res = await fetch(url)
      const json = await res.json()
      if (res.ok && json.defaultCaption) {
        setCaption(json.defaultCaption)
        setProductResolved(json.productResolved || null)
      }
    } catch { /* swallow */ }
    finally { setRegenerating(false) }
  }, [videoId, productInput])

  const submit = useCallback(async () => {
    if (!meta?.videoUrl || posting || posted) return
    setPosting(true)
    setPostError(null)
    setPartialErrors([])
    try {
      const res = await fetch('/api/instagram/post-direct-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, caption, mode }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setPostError(json.error || 'Instagram publish failed.')
        setReconnectRequired(!!json.reconnectRequired)
        return
      }
      setPosted({ reel: json.reelId ?? undefined, story: json.storyId ?? undefined })
      setPartialErrors(Array.isArray(json.partialErrors) ? json.partialErrors : [])
      if (onPosted) onPosted(mode)
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Posting failed.')
    } finally {
      setPosting(false)
    }
  }, [meta, posting, posted, videoId, caption, mode, onPosted])

  const closeAllowed = !posting

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={() => closeAllowed && onClose()}
    >
      <div
        className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-lg w-full max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-gray-100 dark:border-white/10">
          <div className="flex items-center gap-2.5">
            <span
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
              style={{ background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 5.838c3.405 0 6.162 2.76 6.162 6.162 0 3.405-2.76 6.162-6.162 6.162-3.405 0-6.162-2.76-6.162-6.162 0-3.405 2.76-6.162 6.162-6.162zM12 16c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z"/></svg>
            </span>
            <div>
              <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Post Short to Instagram</h3>
              <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">Direct push — no blog post needed</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={!closeAllowed}
            className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] disabled:opacity-40 flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5">
          {loading ? (
            <div className="py-10 flex items-center justify-center text-sm text-[#86868b]">
              <Loader2 size={16} className="animate-spin mr-2" /> Loading + writing your caption…
            </div>
          ) : loadError ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border-[#ff9500]/20 bg-[#ff9500]/5 p-3">
                <p className="text-sm text-[#9a5d00] flex items-start gap-2"><AlertCircle size={14} className="mt-0.5" /> {loadError}</p>
                {reconnectRequired && (
                  <a href="/setup?tab=integrations" className="mt-3 inline-block text-xs text-[#7C3AED] hover:underline">
                    Go to Integrations → Reconnect Instagram →
                  </a>
                )}
              </div>
              {/* The straightforward flow: download from YouTube Studio
                  (official, always works), then drop into the zone below.
                  Studio's Download button hands the creator the same MP4
                  they originally uploaded — no quality loss. */}
              {youtubeId && (
                <div className="rounded-lg border border-[#7C3AED]/20 bg-[#7C3AED]/5 p-4 flex flex-col items-center gap-2.5">
                  <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] text-center">
                    Open this Short in YouTube Studio, hit <strong>⋮ → Download</strong>, then drop the MP4 in the zone below.
                  </p>
                  <a
                    href={`https://studio.youtube.com/video/${youtubeId}/edit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9]"
                  >
                    Open in YouTube Studio <ExternalLink size={14} />
                  </a>
                </div>
              )}

              {/* Drag-and-drop / file picker — the bulletproof path. */}
              <ShortVideoUpload videoId={videoId} onUploaded={loadMeta} />
            </div>
          ) : !meta ? null : (
            <div className="flex flex-col gap-4">
              {meta.igUsername && (
                <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-white/10">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#e6683c] to-[#bc1888]" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-[#86868b] uppercase tracking-wide font-semibold">Posting as</p>
                    <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">@{meta.igUsername}</p>
                  </div>
                </div>
              )}

              {meta.videoUrl && (
                <div className="flex flex-col items-center gap-1.5">
                  <div className="rounded-xl overflow-hidden bg-[#000] aspect-[9/16] max-w-[200px]">
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <video src={meta.videoUrl} controls playsInline className="w-full h-full" />
                  </div>
                  {/* Wrong-video escape hatches: Studio link + upload. */}
                  {(youtubeId || meta.youtubeVideoId) && (
                    <a
                      href={`https://studio.youtube.com/video/${youtubeId || meta.youtubeVideoId}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-[#86868b] hover:text-[#7C3AED] inline-flex items-center gap-1"
                      title="Open this Short in YouTube Studio to download the original MP4"
                    >
                      <ExternalLink size={10} /> Wrong video? Open in YouTube Studio to grab the right one
                    </a>
                  )}
                  <ShortVideoUpload videoId={videoId} onUploaded={loadMeta} compact />
                </div>
              )}

              {/* Product input — optional. */}
              <div>
                <label className="block text-[10px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-1.5 flex items-center gap-1">
                  <Package size={11} /> Product (optional)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={productInput}
                    onChange={(e) => setProductInput(e.target.value)}
                    placeholder="ASIN (B08TT4YHG1), Amazon URL, or Geniuslink"
                    className="flex-1 text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                  />
                  <button
                    type="button"
                    onClick={() => void regenerateCaption()}
                    disabled={regenerating}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-xs font-semibold text-white bg-[#5856d6] hover:bg-[#4845b4] disabled:opacity-60"
                    title="Regenerate the caption using the product info above"
                  >
                    {regenerating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                    {regenerating ? 'Writing…' : 'Refresh'}
                  </button>
                </div>
                {productResolved && (
                  <p className="text-[10px] text-[#34c759] mt-1">
                    ✓ Using product: <strong>{productResolved.title.slice(0, 80)}{productResolved.title.length > 80 ? '…' : ''}</strong>
                    {productResolved.asin && <span className="text-[#86868b]"> · {productResolved.asin}</span>}
                  </p>
                )}
                {!productResolved && productInput && (
                  <p className="text-[10px] text-[#86868b] mt-1">Click Refresh to apply the product to the caption.</p>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-1.5">
                  Caption (AI-generated — edit freely)
                </label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  maxLength={2200}
                  rows={6}
                  className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                />
                <p className="text-[10px] text-[#86868b] mt-1">{caption.length} / 2200 · Hashtags + disclaimer included.</p>
              </div>

              <div>
                <p className="text-[10px] font-semibold text-[#3a3a3c] dark:text-[#d2d2d7] uppercase tracking-wide mb-1.5">
                  Post as
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {(['reel', 'story', 'both'] as Mode[]).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={`text-xs px-3 py-2 rounded-md border-2 transition-colors ${mode === m ? 'border-[#e1306c] bg-[#e1306c]/5 text-[#1d1d1f] dark:text-[#f5f5f7]' : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-[#e1306c]/40'}`}
                    >
                      {m === 'reel' ? 'Reel only' : m === 'story' ? 'Story only' : 'Reel + Story'}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[#86868b] mt-1.5">
                  {mode === 'reel' && 'Reels carry the caption — most reach.'}
                  {mode === 'story' && 'Stories are 24h. Caption is ignored — IG drops it for Story posts.'}
                  {mode === 'both' && 'Best of both: Reel for reach + Story for the 24h spike.'}
                </p>
              </div>

              {postError && (
                <div className="rounded-lg border-[#ff3b30]/20 bg-[#ff3b30]/5 p-3">
                  <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {postError}</p>
                </div>
              )}
              {posted && (
                <div className="rounded-lg border-[#34c759]/20 bg-[#34c759]/5 p-3 flex flex-col gap-1">
                  <p className="text-xs text-[#34c759] flex items-center gap-1.5">
                    <CheckCircle size={12} />
                    {posted.reel && posted.story && 'Reel + Story live on Instagram.'}
                    {posted.reel && !posted.story && 'Reel live on Instagram.'}
                    {!posted.reel && posted.story && 'Story live on Instagram.'}
                  </p>
                  <a href="https://www.instagram.com/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-[#7C3AED] hover:underline self-start">
                    Open Instagram <ExternalLink size={10} />
                  </a>
                </div>
              )}
              {partialErrors.length > 0 && (
                <div className="rounded-lg border-[#ff9500]/20 bg-[#ff9500]/5 p-3">
                  <p className="text-xs text-[#9a5d00] flex items-center gap-1.5"><AlertCircle size={12} /> Partial: {partialErrors.join(' · ')}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {!loading && !loadError && meta && (
          <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100 dark:border-white/10">
            <button onClick={onClose} disabled={!closeAllowed} className="btn-secondary text-sm">Cancel</button>
            <button
              onClick={() => void submit()}
              disabled={posting || !!posted || !meta.videoUrl}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: posted ? '#34c759' : 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)' }}
            >
              {posting
                ? <><Loader2 size={14} className="animate-spin" /> Posting…</>
                : posted
                  ? <><CheckCircle size={14} /> Posted</>
                  : <><Send size={14} /> Post to Instagram</>
              }
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
