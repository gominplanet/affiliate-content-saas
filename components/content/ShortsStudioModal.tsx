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
import { toast } from 'sonner'
import { X, Scissors, Loader2, Sparkles, Download, ExternalLink, AlertCircle, Film } from 'lucide-react'
import { ShortVideoUpload } from '@/components/ShortVideoUpload'
import { dispatchCapReached } from '@/components/CapReachedBanner'
import { errText } from '@/lib/err-text'
import { SUBTITLE_STYLES, type SubtitleStyle, type ShortRow } from '@/lib/shorts-types'

const PURPLE = '#7C3AED'

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const STYLE_LABEL: Record<SubtitleStyle, string> = {
  'bold-white': 'Bold white',
  'yellow-pop': 'Yellow pop',
  'boxed': 'Boxed',
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
  const [error, setError] = useState<string | null>(null)
  // Per-clip UI: chosen subtitle style + render state.
  const [styleById, setStyleById] = useState<Record<string, SubtitleStyle>>({})
  const [renderingId, setRenderingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/youtube/shorts?videoId=${encodeURIComponent(videoId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setClips(data.shorts || [])
      setHasSource(!!data.hasSource)
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

  const renderClip = useCallback(async (clip: ShortRow) => {
    if (!hasSource) { toast.error('Upload the source video first.'); return }
    setRenderingId(clip.id)
    try {
      const res = await fetch('/api/youtube/shorts/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortId: clip.id, subtitleStyle: styleById[clip.id] || clip.subtitleStyle || 'bold-white' }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.needsUpload) { setHasSource(false); throw new Error('Upload the source video first.') }
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
  }, [hasSource, styleById])

  return (
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
              We read the video&apos;s transcript and pull the strongest 15–30s moments. Subtitles are taken
              word-for-word from what you actually said — nothing invented.
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

          {/* Source-video prompt (needed only to RENDER) */}
          {!hasSource && (
            <div className="rounded-xl border border-dashed border-black/10 dark:border-white/15 p-4">
              <p className="text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
                To render a clip, upload the full video file once
              </p>
              <ShortVideoUpload
                videoId={videoId}
                targetColumn="source_video_url"
                extraFields={{ source_video_uploaded_at: new Date().toISOString() }}
                label="Drop the full video (the long one) here"
                helpText="MP4, under 300 MB. We only use it to cut your clips — it never touches YouTube. You can find suggestions without this."
                onUploaded={async () => { setHasSource(true); toast.success('Source video ready'); }}
              />
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
                      <select
                        value={style}
                        onChange={e => setStyleById(prev => ({ ...prev, [clip.id]: e.target.value as SubtitleStyle }))}
                        disabled={rendering}
                        className="text-[11px] rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-2 py-1 text-[#1d1d1f] dark:text-[#f5f5f7]"
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
                        <a href={clip.renderedUrl} download target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium hover:underline" style={{ color: PURPLE }}>
                          <Download size={12} /> Download
                        </a>
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
  )
}
