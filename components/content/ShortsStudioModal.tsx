// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
'use client'

/**
 * ShortsStudioModal — turn one long-form YouTube video into short vertical clips.
 *
 * Two stages, mirroring how the rest of the app works (plan first, then render):
 *   1. "Find Shorts" → /api/youtube/shorts/plan reads the timestamped transcript
 *      and returns the best 15–30s moments (hook + caption + verbatim subtitles).
 *      No video file needed — this works immediately for any synced video.
 *   2. "Render" a clip → /api/youtube/shorts/render cuts it, reframes to 9:16 and
 *      burns the subtitles via Cloudinary. Needs the source MP4, which the
 *      creator uploads once (YouTube ToS: we never server-pull the video) — the
 *      same upload the Instagram burner uses.
 */
import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { X, Scissors, Loader2, Sparkles, Download, ExternalLink, AlertCircle, Film, Youtube, Instagram, Music2, Check } from 'lucide-react'
import { ShortVideoUpload } from '@/components/ShortVideoUpload'
import { dispatchCapReached } from '@/components/CapReachedBanner'
import { errText } from '@/lib/err-text'
import { ensureDisclaimer } from '@/lib/social-disclaimer'
import { buildYouTubeShortTitle } from '@/lib/youtube-title'
import { buildYouTubeTags } from '@/lib/youtube-tags'
import { SUBTITLE_STYLES, type SubtitleStyle, type ShortRow } from '@/lib/shorts-types'

// TikTok publish reuses the existing compliant modal (creator info + privacy
// picker required by TikTok's API). Lazy — only loads when a creator posts.
const TikTokDirectModal = dynamic(
  () => import('@/components/TikTokDirectModal').then(m => ({ default: m.TikTokDirectModal })),
  { ssr: false },
)

// Instagram publish reuses the same review-then-post modal shape as TikTok:
// preview the clip, edit the caption, then Post as a Reel.
const InstagramBurnedModal = dynamic(
  () => import('@/components/InstagramBurnedModal').then(m => ({ default: m.InstagramBurnedModal })),
  { ssr: false },
)

const PURPLE = '#7C3AED'

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const STYLE_LABEL: Record<SubtitleStyle, string> = {
  'bold-white': 'Bold white',
  'yellow-pop': 'Yellow pop',
  'outline': 'Outline',
  'hype': 'Hype',
  'brand': 'Brand',
}

// A cross-post pill. Outline + brand color when not yet posted; fills solid with
// a check once the clip has been published there (so it's clear it's done).
function PostPill({
  posted, label, color, icon, onClick, busy, disabled, postedAt,
}: {
  posted: boolean
  label: string
  color: string
  icon: React.ReactNode
  onClick: () => void
  busy?: boolean
  disabled?: boolean
  postedAt?: string | null
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      title={posted ? `Posted to ${label}${postedAt ? ` · ${new Date(postedAt).toLocaleString()}` : ''}` : `Post to ${label}`}
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium border transition-colors disabled:opacity-50"
      style={posted
        ? { backgroundColor: color, borderColor: color, color: '#fff' }
        : { borderColor: `${color}66`, color }}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : posted ? <Check size={12} /> : icon}
      {label}{posted ? ' · Posted' : ''}
    </button>
  )
}

export function ShortsStudioModal({
  videoId, youtubeVideoId, videoTitle, onClose,
}: {
  videoId: string
  youtubeVideoId: string | null
  videoTitle: string
  onClose: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [planning, setPlanning] = useState(false)
  const [clips, setClips] = useState<ShortRow[]>([])
  const [hasSource, setHasSource] = useState(false)
  const [ingestEnabled, setIngestEnabled] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Per-clip UI: chosen subtitle style + render state.
  const [styleById, setStyleById] = useState<Record<string, SubtitleStyle>>({})
  // Per-clip captions on/off (default on). captions off = a clean clip.
  const [captionsById, setCaptionsById] = useState<Record<string, boolean>>({})
  const [renderingId, setRenderingId] = useState<string | null>(null)
  // Publishing: a `${clipId}:ig|yt` key while a direct post is in flight, and
  // the clip whose rendered URL is being posted to TikTok (opens the modal).
  const [publishing, setPublishing] = useState<string | null>(null)
  const [ttPost, setTtPost] = useState<{ id: string; url: string; caption: string } | null>(null)
  const [igPost, setIgPost] = useState<{ id: string; url: string; caption: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/youtube/shorts?videoId=${encodeURIComponent(videoId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setClips(data.shorts || [])
      setHasSource(!!data.hasSource)
      setIngestEnabled(!!data.ingestEnabled)
    } catch (e) {
      setError(errText(e))
    } finally {
      setLoading(false)
    }
  }, [videoId])

  useEffect(() => { void load() }, [load])

  const findShorts = useCallback(async () => {
    setPlanning(true)
    setError(null)
    try {
      const res = await fetch('/api/youtube/shorts/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, youtubeVideoId }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.limitReached) {
          dispatchCapReached(data.error || 'Shorts Studio is a Pro feature.', { cap: data.cap || 'shorts_studio', currentTier: data.currentTier, upgrade: data.upgrade })
        }
        throw new Error(data.error || 'Could not find Shorts')
      }
      setClips(data.shorts || [])
      toast.success(`Found ${data.shorts?.length ?? 0} Short${data.shorts?.length === 1 ? '' : 's'}`)
    } catch (e) {
      setError(errText(e))
      toast.error(errText(e))
    } finally {
      setPlanning(false)
    }
  }, [videoId, youtubeVideoId])

  // No-upload path: ask the server to fetch the video for us, then find Shorts.
  const fetchAutomatically = useCallback(async () => {
    setPreparing(true)
    setError(null)
    try {
      const res = await fetch('/api/youtube/shorts/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.ingestDisabled) setIngestEnabled(false)
        if (data.limitReached) dispatchCapReached(data.error || 'Shorts Studio is a Pro feature.', { cap: data.cap || 'shorts_studio', currentTier: data.currentTier, upgrade: data.upgrade })
        throw new Error(data.error || 'Could not fetch the video automatically.')
      }
      setHasSource(true)
      toast.success('Video ready')
      await findShorts()
    } catch (e) {
      setError(errText(e))
      toast.error(errText(e))
    } finally {
      setPreparing(false)
    }
  }, [videoId, findShorts])

  const renderClip = useCallback(async (clip: ShortRow) => {
    if (!hasSource) { toast.error('Upload the source video first.'); return }
    setRenderingId(clip.id)
    try {
      const res = await fetch('/api/youtube/shorts/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shortId: clip.id,
          subtitleStyle: styleById[clip.id] || clip.subtitleStyle || 'bold-white',
          captions: captionsById[clip.id] !== false,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.needsUpload) { setHasSource(false); throw new Error(data.error || 'Upload the source video first.') }
        if (data.limitReached) dispatchCapReached(data.error || 'Rendering Shorts is a Pro feature.', { cap: data.cap || 'shorts_studio', currentTier: data.currentTier, upgrade: data.upgrade })
        throw new Error(data.error || 'Render failed')
      }
      if (data.short) setClips(prev => prev.map(c => (c.id === clip.id ? data.short : c)))
      toast.success('Short rendered')
    } catch (e) {
      toast.error(errText(e))
      setClips(prev => prev.map(c => (c.id === clip.id ? { ...c, status: 'failed', renderError: errText(e) } : c)))
    } finally {
      setRenderingId(null)
    }
  }, [hasSource, styleById, captionsById])

  // Caption for a cross-post: the clip's caption + its hashtags, with the FTC
  // affiliate disclosure appended (ensureDisclaimer skips it if already present).
  const captionFor = (clip: ShortRow) =>
    ensureDisclaimer(
      [clip.caption, (clip.hashtags || []).join(' ')].filter(Boolean).join('\n\n').trim(),
    )

  // Record a successful cross-post so the platform's pill flips to "posted"
  // and stays that way across reloads. Best-effort: the post already happened.
  const markPosted = useCallback(async (shortId: string, platform: 'tiktok' | 'instagram' | 'youtube') => {
    const key = platform === 'tiktok' ? 'postedTiktok' : platform === 'instagram' ? 'postedInstagram' : 'postedYoutube'
    const now = new Date().toISOString()
    setClips(prev => prev.map(c => (c.id === shortId ? { ...c, [key]: now } : c)))
    try {
      await fetch('/api/youtube/shorts/mark-posted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortId, platform }),
      })
    } catch { /* pill already flipped locally; non-fatal */ }
  }, [])

  const postYouTube = useCallback(async (clip: ShortRow) => {
    if (!clip.renderedUrl) return
    setPublishing(clip.id + ':yt')
    try {
      const res = await fetch('/api/youtube/upload-short', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: clip.renderedUrl, title: buildYouTubeShortTitle(clip.hook, clip.hashtags), description: captionFor(clip), tags: buildYouTubeTags(clip.hashtags, clip.hook) }),
      })
      const data = await res.json()
      if (!res.ok) {
        // Missing upload scope — grant it via incremental auth, then retry.
        if (data.reconnectRequired) {
          toast('One-time step: grant YouTube publishing access…')
          window.location.href = `/api/auth/youtube?intent=upload&returnTo=${encodeURIComponent(window.location.pathname)}`
          return
        }
        throw new Error(data.error || 'YouTube upload failed')
      }
      toast.success('Uploaded to YouTube as a Short')
      void markPosted(clip.id, 'youtube')
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setPublishing(null)
    }
  }, [markPosted])

  return (
    <>
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-2xl bg-white dark:bg-[#1c1c1e] shadow-2xl my-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/5 dark:border-white/10 px-5 py-4">
          <div className="flex items-center gap-2 min-w-0">
            <Scissors size={18} style={{ color: PURPLE }} />
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">Shorts Studio</h2>
              <p className="text-[11px] text-[#86868b] truncate">{videoTitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10" aria-label="Close">
            <X size={18} className="text-[#86868b]" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Intro + action */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-[13px] text-[#4b4b4f] dark:text-[#b0b0b5] max-w-md">
              We find the strongest 15–30s moments and cut them for you. If the transcript isn&apos;t on YouTube,
              upload the video and we&apos;ll transcribe it ourselves. Subtitles are word-for-word from what you
              actually said — nothing invented.
            </p>
            <button
              onClick={findShorts}
              disabled={planning}
              className="shrink-0 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: PURPLE }}
            >
              {planning ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {planning ? 'Finding moments…' : clips.length ? 'Find more Shorts' : 'Find Shorts'}
            </button>
          </div>

          {/* Source-video prompt — needed to transcribe (if no captions) + render */}
          {!hasSource && (
            <div className="rounded-xl border border-dashed border-black/10 dark:border-white/15 p-4 space-y-3">
              {ingestEnabled && (
                <div>
                  <button
                    onClick={fetchAutomatically}
                    disabled={preparing}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    style={{ backgroundColor: PURPLE }}
                  >
                    {preparing ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                    {preparing ? 'Preparing video…' : 'Fetch this video automatically — no upload'}
                  </button>
                  <p className="text-[10px] text-[#86868b] text-center mt-1.5">
                    We download it for you and cut the clips. Takes a few minutes.
                  </p>
                </div>
              )}
              <div>
                <p className="text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
                  {ingestEnabled ? 'Or upload the video yourself' : 'Upload the full video once — we transcribe it and cut your clips from it'}
                </p>
                <ShortVideoUpload
                  videoId={videoId}
                  targetColumn="source_video_url"
                  extraFields={{ source_video_uploaded_at: new Date().toISOString() }}
                  label="Drop the full video (the long one) here"
                  helpText="MP4, under 300 MB. We transcribe it and cut every clip from it — it never touches YouTube."
                  onUploaded={async () => { setHasSource(true); toast.success('Video uploaded — hit Find Shorts'); }}
                />
              </div>
            </div>
          )}

          {error && (
            <p className="text-[12px] text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={13} /> {error}</p>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-10 text-[#86868b]"><Loader2 size={20} className="animate-spin" /></div>
          ) : clips.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center gap-2 text-[#86868b]">
              <Film size={26} />
              <p className="text-sm">No Shorts yet. Hit <span className="font-medium" style={{ color: PURPLE }}>Find Shorts</span> to scan this video.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {clips.map(clip => {
                const style = styleById[clip.id] || clip.subtitleStyle || 'bold-white'
                const captionsOn = captionsById[clip.id] !== false
                const rendering = renderingId === clip.id
                const ytLink = clip.youtubeVideoId
                  ? `https://youtu.be/${clip.youtubeVideoId}?t=${Math.floor(clip.startSec)}`
                  : null
                return (
                  <div key={clip.id} className="rounded-xl border border-black/5 dark:border-white/10 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 text-white" style={{ backgroundColor: PURPLE }}>
                            {clip.score}/100
                          </span>
                          <span className="text-[11px] text-[#86868b] tabular-nums">
                            {fmt(clip.startSec)}–{fmt(clip.endSec)} · {Math.round(clip.endSec - clip.startSec)}s
                          </span>
                          {ytLink && (
                            <a href={ytLink} target="_blank" rel="noreferrer" className="text-[11px] inline-flex items-center gap-0.5 hover:underline" style={{ color: PURPLE }}>
                              <ExternalLink size={10} /> Watch moment
                            </a>
                          )}
                          {/* "Published · where" — at a glance which channels this short
                              went out on. Derived from the posted-at stamps already on
                              the clip (non-null = posted there). */}
                          {(() => {
                            const chans: string[] = []
                            if (clip.postedTiktok) chans.push('TikTok')
                            if (clip.postedInstagram) chans.push('Instagram')
                            if (clip.postedYoutube) chans.push('YouTube')
                            if (!chans.length) return null
                            return (
                              <span
                                className="text-[10px] font-semibold rounded-full px-2 py-0.5 inline-flex items-center gap-1"
                                style={{ background: 'rgba(52,199,89,0.15)', color: '#1f8a3a', border: '1px solid rgba(52,199,89,0.4)' }}
                                title={`This short is posted on ${chans.join(', ')}.`}
                              >
                                <Check size={10} /> Published · {chans.join(' · ')}
                              </span>
                            )
                          })()}
                        </div>
                        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mt-1.5">{clip.hook || 'Untitled clip'}</p>
                        {clip.caption && <p className="text-[12px] text-[#4b4b4f] dark:text-[#b0b0b5] mt-1">{clip.caption}</p>}
                        {clip.reason && <p className="text-[11px] italic text-[#86868b] mt-1">{clip.reason}</p>}
                        {clip.hashtags?.length > 0 && (
                          <p className="text-[11px] mt-1" style={{ color: PURPLE }}>{clip.hashtags.join(' ')}</p>
                        )}
                        {clip.subtitles?.length > 0 && (
                          <p className="text-[11px] text-[#86868b] mt-1.5 line-clamp-2">
                            <span className="font-medium">Captions:</span> {clip.subtitles.map(s => s.text).join(' ')}
                          </p>
                        )}
                      </div>

                      {/* Rendered preview */}
                      {clip.status === 'rendered' && clip.renderedUrl && (
                        <video src={clip.renderedUrl} controls className="w-24 rounded-lg shrink-0 bg-black" style={{ aspectRatio: '9/16' }} />
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-wrap mt-3">
                      {/* Captions = the running, audio-synced subtitle track (the
                          whole clip's script, readable with sound off). Toggle
                          off for a clean clip. */}
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-[#4b4b4f] dark:text-[#b0b0b5] cursor-pointer select-none" title="Burn running subtitles that follow the audio">
                        <input
                          type="checkbox"
                          checked={captionsOn}
                          onChange={e => setCaptionsById(prev => ({ ...prev, [clip.id]: e.target.checked }))}
                          disabled={rendering}
                          className="accent-[#7C3AED]"
                        />
                        Captions
                      </label>
                      <select
                        value={style}
                        onChange={e => setStyleById(prev => ({ ...prev, [clip.id]: e.target.value as SubtitleStyle }))}
                        disabled={rendering || !captionsOn}
                        className="text-[11px] rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-2 py-1 text-[#1d1d1f] dark:text-[#f5f5f7] disabled:opacity-40"
                      >
                        {SUBTITLE_STYLES.map(s => <option key={s} value={s}>{STYLE_LABEL[s]}</option>)}
                      </select>
                      <button
                        onClick={() => renderClip(clip)}
                        disabled={rendering}
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60"
                        style={{ backgroundColor: rendering ? '#9ca3af' : PURPLE }}
                      >
                        {rendering ? <Loader2 size={12} className="animate-spin" /> : <Scissors size={12} />}
                        {rendering ? 'Rendering…' : clip.status === 'rendered' ? 'Re-render' : 'Render Short'}
                      </button>
                      {clip.status === 'rendered' && clip.renderedUrl && (
                        <>
                          <a href={clip.renderedUrl} download target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium hover:underline" style={{ color: PURPLE }}>
                            <Download size={12} /> Download
                          </a>
                          <span className="text-[11px] text-[#86868b] ml-1">Post to</span>
                          <PostPill
                            label="TikTok"
                            color="#FE2C55"
                            icon={<Music2 size={12} />}
                            posted={!!clip.postedTiktok}
                            postedAt={clip.postedTiktok}
                            onClick={() => setTtPost({ id: clip.id, url: clip.renderedUrl!, caption: captionFor(clip) })}
                          />
                          <PostPill
                            label="Instagram"
                            color="#E1306C"
                            icon={<Instagram size={12} />}
                            posted={!!clip.postedInstagram}
                            postedAt={clip.postedInstagram}
                            onClick={() => setIgPost({ id: clip.id, url: clip.renderedUrl!, caption: captionFor(clip) })}
                          />
                          <PostPill
                            label="YouTube"
                            color="#FF0000"
                            icon={<Youtube size={12} />}
                            posted={!!clip.postedYoutube}
                            postedAt={clip.postedYoutube}
                            busy={publishing === clip.id + ':yt'}
                            onClick={() => postYouTube(clip)}
                          />
                        </>
                      )}
                      {clip.status === 'failed' && clip.renderError && (
                        <span className="text-[11px] text-[#ff3b30] inline-flex items-center gap-1"><AlertCircle size={11} /> {clip.renderError}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>

    {/* z-[70] wrapper: the TikTok modal is z-50 and this Shorts modal is z-[60],
        so without lifting it the TikTok modal opens BEHIND this one. */}
    {ttPost && (
      <div className="relative z-[70]">
        <TikTokDirectModal
          burnedVideoUrl={ttPost.url}
          initialCaption={ttPost.caption}
          onClose={() => setTtPost(null)}
          onPosted={() => { void markPosted(ttPost.id, 'tiktok'); setTtPost(null); toast.success('Posted to TikTok') }}
        />
      </div>
    )}
    {/* Same z-[70] lift so the IG modal opens above this Shorts modal (z-[60]). */}
    {igPost && (
      <div className="relative z-[70]">
        <InstagramBurnedModal
          burnedVideoUrl={igPost.url}
          initialCaption={igPost.caption}
          onClose={() => setIgPost(null)}
          onPosted={() => { void markPosted(igPost.id, 'instagram'); toast.success('Posted to Instagram') }}
        />
      </div>
    )}
    </>
  )
}
