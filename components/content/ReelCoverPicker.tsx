'use client'

/**
 * ReelCoverPicker — pick the Reel COVER frame by scrubbing a video, returning the
 * chosen offset (ms) via a callback. Unlike InstagramCoverModal (which persists to
 * youtube_videos.ig_cover_offset_ms via an API), this one is STATELESS: it takes a
 * plain video URL and hands the ms back to the caller, which threads it straight to
 * publish as thumb_offset. Used by Clip Factory, where the burned clip has no DB row
 * and the URL you scrub IS exactly what gets published.
 */

import { useRef, useState } from 'react'
import { X, Check, ImageIcon, RotateCcw } from 'lucide-react'

export default function ReelCoverPicker({
  videoUrl,
  initialOffsetMs,
  onPick,
  onClose,
}: {
  videoUrl: string
  initialOffsetMs?: number | null
  /** Called with the chosen ms (or null to reset to Instagram's default frame). */
  onPick: (offsetMs: number | null) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [duration, setDuration] = useState(0)
  const [posSec, setPosSec] = useState(initialOffsetMs != null ? initialOffsetMs / 1000 : 0)

  function onScrub(sec: number) {
    setPosSec(sec)
    const v = videoRef.current
    if (v && Number.isFinite(sec)) { try { v.currentTime = sec } catch { /* ignore */ } }
  }
  const fmt = (s: number) => (Number.isFinite(s) ? `${s.toFixed(1)}s` : '0.0s')

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[92vh] overflow-y-auto p-5 rounded-2xl bg-white dark:bg-[#16161a] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-1.5">
              <ImageIcon size={16} className="text-[#E1306C]" /> Choose the Reel cover
            </h3>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">Scrub to a frame — that still becomes your Reel cover. No need to fix it in Instagram.</p>
          </div>
          <button onClick={onClose} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-white p-1" title="Close"><X size={18} /></button>
        </div>

        <div className="flex flex-col gap-3">
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

          <div>
            <input
              type="range"
              min={0}
              max={Math.max(duration, 0.1)}
              step={0.1}
              value={Math.min(posSec, duration || posSec)}
              onChange={e => onScrub(parseFloat(e.target.value))}
              className="w-full accent-[#E1306C]"
              disabled={!duration}
            />
            <div className="flex items-center justify-between text-[11px] text-[#86868b] mt-0.5">
              <span>Frame at <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">{fmt(posSec)}</strong></span>
              <span>{fmt(duration)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => { onPick(Math.round(posSec * 1000)); onClose() }}
              disabled={!duration}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[#E1306C] text-white hover:opacity-90 disabled:opacity-50"
            >
              <Check size={13} /> Use this frame
            </button>
            {initialOffsetMs != null && (
              <button
                onClick={() => { onPick(null); onClose() }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[var(--border-2,#e5e5e7)] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[var(--surface-hover,#f5f5f7)]"
              >
                <RotateCcw size={13} /> Reset to default
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
