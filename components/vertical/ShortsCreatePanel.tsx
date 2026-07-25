// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
'use client'

/**
 * ShortsCreatePanel — the Shorts Studio "create" flow, inline (no modal).
 *
 * Used inside Clip Factory: pick a long video, find the strongest 15–30s
 * moments, render one to a 9:16 clip with running captions, then hand that
 * rendered clip up to the page via onUseClip so it flows into Enhance → Publish.
 * This is the same plan/ingest/render pipeline the ShortsStudioModal uses, minus
 * the publish pills (publishing happens in Clip Factory's own stage).
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Sparkles, Download, AlertCircle, Film, Scissors, ExternalLink, ArrowRight } from 'lucide-react'
import { ShortVideoUpload } from '@/components/ShortVideoUpload'
import { dispatchCapReached } from '@/components/CapReachedBanner'
import { errText } from '@/lib/err-text'
import { SUBTITLE_STYLES, type SubtitleStyle, type ShortRow } from '@/lib/shorts-types'

const PURPLE = '#7C3AED'
const STYLE_LABEL: Record<SubtitleStyle, string> = { 'bold-white': 'Bold white', 'yellow-pop': 'Yellow pop', 'outline': 'Outline', 'hype': 'Hype', 'brand': 'Brand' }

function fmt(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function ShortsCreatePanel({
  videoId, youtubeVideoId, videoTitle, onUseClip,
}: {
  videoId: string
  youtubeVideoId: string | null
  videoTitle: string
  /** Called when a clip is rendered and the creator picks it to carry forward. */
  onUseClip: (clip: { url: string; title: string; caption: string; hashtags: string[] }) => void
}) {
  const [loading, setLoading] = useState(true)
  const [planning, setPlanning] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [clips, setClips] = useState<ShortRow[]>([])
  const [hasSource, setHasSource] = useState(false)
  const [ingestEnabled, setIngestEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [styleById, setStyleById] = useState<Record<string, SubtitleStyle>>({})
  const [captionsById, setCaptionsById] = useState<Record<string, boolean>>({})
  const [renderingId, setRenderingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
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
    setPlanning(true); setError(null)
    try {
      const res = await fetch('/api/youtube/shorts/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, youtubeVideoId }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.limitReached) dispatchCapReached(data.error || 'Clip Factory is a Pro feature.', { cap: data.cap || 'shorts_studio', currentTier: data.currentTier, upgrade: data.upgrade })
        throw new Error(data.error || 'Could not find Shorts')
      }
      setClips(data.shorts || [])
      toast.success(`Found ${data.shorts?.length ?? 0} Short${data.shorts?.length === 1 ? '' : 's'}`)
    } catch (e) {
      setError(errText(e)); toast.error(errText(e))
    } finally {
      setPlanning(false)
    }
  }, [videoId, youtubeVideoId])

  const fetchAutomatically = useCallback(async () => {
    setPreparing(true); setError(null)
    try {
      const res = await fetch('/api/youtube/shorts/ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.ingestDisabled) setIngestEnabled(false)
        if (data.limitReached) dispatchCapReached(data.error || 'Clip Factory is a Pro feature.', { cap: data.cap || 'shorts_studio', currentTier: data.currentTier, upgrade: data.upgrade })
        throw new Error(data.error || 'Could not fetch the video automatically.')
      }
      setHasSource(true)
      toast.success('Video ready')
      await findShorts()
    } catch (e) {
      setError(errText(e)); toast.error(errText(e))
    } finally {
      setPreparing(false)
    }
  }, [videoId, findShorts])

  const renderClip = useCallback(async (clip: ShortRow) => {
    if (!hasSource) { toast.error('Prepare the source video first.'); return }
    setRenderingId(clip.id)
    try {
      const res = await fetch('/api/youtube/shorts/render', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shortId: clip.id,
          subtitleStyle: styleById[clip.id] || clip.subtitleStyle || 'bold-white',
          captions: captionsById[clip.id] !== false,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.needsUpload) { setHasSource(false); throw new Error('Prepare the source video first.') }
        if (data.limitReached) dispatchCapReached(data.error || 'Rendering is a Pro feature.', { cap: data.cap || 'shorts_studio', currentTier: data.currentTier, upgrade: data.upgrade })
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-[13px] text-[#4b4b4f] dark:text-[#b0b0b5] max-w-md">
          <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{videoTitle}</span> — we find the strongest
          15–30s moments and cut them for you. Subtitles are word-for-word from what you actually said.
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
              <p className="text-[10px] text-[#86868b] text-center mt-1.5">We download it for you and cut the clips. Takes a few minutes.</p>
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
              onUploaded={async () => { setHasSource(true); toast.success('Video uploaded — hit Find Shorts') }}
            />
          </div>
        </div>
      )}

      {error && <p className="text-[12px] text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={13} /> {error}</p>}

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
            const ytLink = clip.youtubeVideoId ? `https://youtu.be/${clip.youtubeVideoId}?t=${Math.floor(clip.startSec)}` : null
            return (
              <div key={clip.id} className="rounded-xl border border-black/5 dark:border-white/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 text-white" style={{ backgroundColor: PURPLE }}>{clip.score}/100</span>
                      <span className="text-[11px] text-[#86868b] tabular-nums">{fmt(clip.startSec)}–{fmt(clip.endSec)} · {Math.round(clip.endSec - clip.startSec)}s</span>
                      {ytLink && <a href={ytLink} target="_blank" rel="noreferrer" className="text-[11px] inline-flex items-center gap-0.5 hover:underline" style={{ color: PURPLE }}><ExternalLink size={10} /> Watch moment</a>}
                    </div>
                    {clip.hook && <p className="text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mt-1.5 line-clamp-2">{clip.hook}</p>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-[#4b4b4f] dark:text-[#b0b0b5] cursor-pointer select-none">
                    <input type="checkbox" checked={captionsOn} onChange={e => setCaptionsById(prev => ({ ...prev, [clip.id]: e.target.checked }))} disabled={rendering} className="accent-[#7C3AED]" />
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
                    <button
                      onClick={() => onUseClip({ url: clip.renderedUrl!, title: clip.hook || videoTitle, caption: clip.caption || '', hashtags: clip.hashtags || [] })}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white"
                      style={{ backgroundColor: '#34c759' }}
                    >
                      Use this clip <ArrowRight size={12} />
                    </button>
                  )}
                  {clip.status === 'failed' && clip.renderError && (
                    <span className="text-[11px] text-[#ff3b30] inline-flex items-center gap-1"><AlertCircle size={11} /> {clip.renderError}</span>
                  )}
                </div>

                {clip.status === 'rendered' && clip.renderedUrl && (
                  <div className="mt-3 flex items-center gap-3">
                    <div className="rounded-lg overflow-hidden bg-black aspect-[9/16] w-[90px] shrink-0">
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <video src={clip.renderedUrl} controls playsInline className="w-full h-full" />
                    </div>
                    <p className="text-[11px] text-[#86868b]">Rendered. Click <span className="font-medium text-[#248a3d]">Use this clip</span> to add a CTA and publish.</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
