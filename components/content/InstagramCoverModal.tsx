'use client'

/**
 * InstagramCoverModal — pick the Reel COVER frame from the video, inside MVP.
 *
 * Instagram normally defaults a Reel's cover to the first frame (often blurry),
 * forcing the creator to open the IG app and scrub to a better one. Here they
 * scrub the SAME 9:16 render that will be posted, pick a frame, and we save the
 * offset (ms) to youtube_videos.ig_cover_offset_ms — the publish then passes it
 * as `thumb_offset`, so the Reel goes out with the chosen still. No IG round-trip.
 */

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { X, Check, Loader2, RotateCcw, ImageIcon } from 'lucide-react'

export default function InstagramCoverModal({
  videoDbId,
  videoUrl: videoUrlProp,
  onClose,
  onSaved,
}: {
  videoDbId: string
  /** The vertical MP4 (instagram_video_url). If omitted we fetch it. */
  videoUrl?: string | null
  onClose: () => void
  onSaved?: (offsetMs: number | null) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(videoUrlProp ?? null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [posSec, setPosSec] = useState(0)          // scrubber position (seconds)
  const [saving, setSaving] = useState(false)
  const [savedOffsetMs, setSavedOffsetMs] = useState<number | null>(null)

  // Load the render + any previously-chosen offset.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const r = await fetch(`/api/blog/instagram-cover?videoId=${encodeURIComponent(videoDbId)}`)
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Could not load this video')
        if (cancelled) return
        const url = (videoUrlProp || d.videoUrl) as string | null
        if (!url) throw new Error('No vertical MP4 for this yet — add a 9:16 render first.')
        setVideoUrl(url)
        setSavedOffsetMs(typeof d.offsetMs === 'number' ? d.offsetMs : null)
        if (typeof d.offsetMs === 'number') setPosSec(d.offsetMs / 1000)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [videoDbId, videoUrlProp])

  // Seek the <video> to the scrubber position so the frame previews live.
  function onScrub(sec: number) {
    setPosSec(sec)
    const v = videoRef.current
    if (v && Number.isFinite(sec)) { try { v.currentTime = sec } catch { /* ignore */ } }
  }

  async function save(offsetMs: number | null) {
    setSaving(true)
    try {
      const res = await fetch('/api/blog/instagram-cover', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: videoDbId, offsetMs }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not save the cover')
      setSavedOffsetMs(d.offsetMs ?? null)
      onSaved?.(d.offsetMs ?? null)
      toast.success(offsetMs == null ? 'Cover reset to Instagram default' : 'Cover frame saved — your Reel will use it')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Couldn’t save the cover')
    } finally {
      setSaving(false)
    }
  }

  const fmt = (s: number) => {
    if (!Number.isFinite(s)) return '0.0s'
    return `${s.toFixed(1)}s`
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        className="card w-full max-w-md max-h-[92vh] overflow-y-auto p-5 !bg-white dark:!bg-[#16161a]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-1.5">
              <ImageIcon size={16} className="text-[#7C3AED]" /> Choose the Reel cover
            </h3>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">Scrub to a frame — that still becomes your Reel cover. No need to fix it in Instagram.</p>
          </div>
          <button onClick={onClose} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-white p-1" title="Close"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#86868b] py-12 justify-center">
            <Loader2 size={16} className="animate-spin" /> Loading your video…
          </div>
        ) : error ? (
          <div className="py-8 text-center"><p className="text-sm text-[#ff3b30]">{error}</p></div>
        ) : videoUrl && (
          <div className="flex flex-col gap-3">
            {/* 9:16 preview — seeks live as you scrub. muted + playsInline so a
                background seek never autoplays audio. */}
            <div className="relative mx-auto rounded-xl overflow-hidden bg-black" style={{ width: 220, aspectRatio: '9 / 16' }}>
              <video
                ref={videoRef}
                src={videoUrl}
                muted
                playsInline
                preload="metadata"
                className="absolute inset-0 w-full h-full object-cover"
                onLoadedMetadata={e => {
                  const d = e.currentTarget.duration
                  if (Number.isFinite(d)) setDuration(d)
                  try { e.currentTarget.currentTime = posSec } catch { /* ignore */ }
                }}
              />
            </div>

            {/* Scrubber */}
            <div>
              <input
                type="range"
                min={0}
                max={Math.max(duration, 0.1)}
                step={0.1}
                value={Math.min(posSec, duration || posSec)}
                onChange={e => onScrub(parseFloat(e.target.value))}
                className="w-full accent-[#7C3AED]"
                disabled={!duration}
              />
              <div className="flex items-center justify-between text-[11px] text-[#86868b] mt-0.5">
                <span>Frame at <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">{fmt(posSec)}</strong></span>
                <span>{fmt(duration)}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => save(Math.round(posSec * 1000))}
                disabled={saving || !duration}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-50"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Use this frame
              </button>
              {savedOffsetMs != null && (
                <button
                  onClick={() => save(null)}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[var(--border-2,#e5e5e7)] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[var(--surface-hover,#f5f5f7)] disabled:opacity-50"
                >
                  <RotateCcw size={13} /> Reset to default
                </button>
              )}
            </div>
            {savedOffsetMs != null && (
              <p className="text-[11px] text-[#1f8a3a]">Current cover: frame at {fmt(savedOffsetMs / 1000)}.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
