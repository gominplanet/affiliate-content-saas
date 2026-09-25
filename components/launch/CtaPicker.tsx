// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Choose the CTA once. It goes on every video in the batch, in the same spot.
//
// DELIBERATELY NOT THE DRAG-AND-DROP CANVAS from Video Launchpad. That exists
// so one video can have its badge nudged into a gap in that particular shot,
// and it is the right tool for one video. Ten videos are ten different shots,
// so a pixel-perfect position chosen against the first one is meaningless on
// the other nine. Nine named places are honest about what is actually being
// decided: roughly where on the frame, on all of them.
'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Check, Ban } from 'lucide-react'
import { CTA_STICKERS, ctaStickerUrl } from '@/lib/cta-stickers'
import { ctaTopLeft, type CtaPreset } from '@/lib/launch-batch'

const text = { color: 'var(--text)' } as const
const muted = { color: 'var(--text-2)' } as const

/** The nine places, as fractions of the frame. Named rather than dragged,
 *  because the same pixel means something different on every video. */
const SPOTS: Array<{ key: string; label: string; x: number; y: number }> = [
  { key: 'tl', label: 'Top left',      x: 0.22, y: 0.16 },
  { key: 'tc', label: 'Top centre',    x: 0.50, y: 0.14 },
  { key: 'tr', label: 'Top right',     x: 0.78, y: 0.16 },
  { key: 'ml', label: 'Middle left',   x: 0.22, y: 0.50 },
  { key: 'mc', label: 'Centre',        x: 0.50, y: 0.50 },
  { key: 'mr', label: 'Middle right',  x: 0.78, y: 0.50 },
  { key: 'bl', label: 'Bottom left',   x: 0.22, y: 0.82 },
  { key: 'bc', label: 'Bottom centre', x: 0.50, y: 0.84 },
  { key: 'br', label: 'Bottom right',  x: 0.78, y: 0.82 },
]

function nearestSpot(x: number, y: number): string {
  let best = SPOTS[7]
  let d = Infinity
  for (const s of SPOTS) {
    const dd = (s.x - x) ** 2 + (s.y - y) ** 2
    if (dd < d) { d = dd; best = s }
  }
  return best.key
}

export default function CtaPicker({
  value, onSave, saving,
}: {
  /** The batch's current preset, or null for "no CTA". */
  value: CtaPreset | null
  onSave: (preset: CtaPreset | null) => void
  saving: boolean
}) {
  const [stickerId, setStickerId] = useState(value?.stickerId || CTA_STICKERS[0]?.id || '')
  const [spot, setSpot] = useState(value ? nearestSpot(value.xPct, value.yPct) : 'bc')
  const [width, setWidth] = useState(value?.widthPct ?? 0.5)
  const [style, setStyle] = useState<'lowerthird' | 'endcard'>(value?.style ?? 'lowerthird')
  // THE BADGE'S OWN PROPORTIONS, from the image once it loads, so the preview
  // keeps it inside the frame exactly the way the render will.
  const [stickerAspect, setStickerAspect] = useState(1)

  const sticker = CTA_STICKERS.find((s) => s.id === stickerId) ?? CTA_STICKERS[0]
  const place = SPOTS.find((s) => s.key === spot) ?? SPOTS[7]

  function save() {
    if (!sticker) return
    onSave({
      stickerId: sticker.id,
      stickerUrl: ctaStickerUrl(sticker.file),
      style,
      widthPct: width,
      xPct: place.x,
      yPct: place.y,
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px]" style={muted}>
        Picked once. MVP burns this exact design into all the videos in this batch, in the same
        place at the same size, so the set looks like a set.
      </p>

      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        {/* ── the designs ───────────────────────────────────────────────── */}
        <div>
          <p className="text-[12px] font-medium mb-2" style={text}>Design</p>
          <div
            className="grid gap-2 overflow-y-auto pr-1"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', maxHeight: 280 }}
          >
            {CTA_STICKERS.map((s) => {
              const on = s.id === stickerId
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setStickerId(s.id); if (s.widthPct) setWidth(s.widthPct) }}
                  title={s.label}
                  className="relative rounded-lg border p-1.5 transition-colors"
                  style={{
                    borderColor: on ? '#0EA5A4' : 'var(--border)',
                    background: on ? 'rgba(14,165,164,0.08)' : 'transparent',
                  }}
                >
                  <Image
                    src={ctaStickerUrl(s.file)} alt={s.label}
                    width={180} height={90} unoptimized
                    style={{ width: '100%', height: 'auto', objectFit: 'contain' }}
                  />
                  {on && (
                    <span className="absolute top-1 right-1 rounded-full p-0.5" style={{ background: '#0EA5A4' }}>
                      <Check size={10} color="#fff" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── where it sits, and how big ────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-[12px] font-medium mb-2" style={text}>Where it sits</p>
            {/* A 9:16 frame with the badge shown at its real relative size, so
                the choice is previewed rather than described. */}
            {/* 16:9, BECAUSE THAT IS WHAT THIS PATH TAKES. The uploader refuses
                vertical video and points at Clip Factory, exactly as Video
                Launchpad does, so a phone-shaped preview would be showing the
                creator a frame their video will never have and placing the
                badge against proportions that do not exist. */}
            <div
              className="relative rounded-lg border overflow-hidden mx-auto"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-hover)', width: 230, aspectRatio: '16 / 9' }}
            >
              {sticker && (
                <Image
                  src={ctaStickerUrl(sticker.file)} alt=""
                  width={200} height={100} unoptimized
                  onLoad={(e) => {
                    const im = e.currentTarget
                    if (im.naturalWidth > 0) setStickerAspect(im.naturalHeight / im.naturalWidth)
                  }}
                  style={(() => {
                    // THE SAME MATHS THE RENDER USES (ctaTopLeft), so what is
                    // shown here is where it lands on the video.
                    const c = ctaTopLeft({ xPct: place.x, yPct: place.y, widthPct: width }, stickerAspect)
                    return {
                      position: 'absolute' as const,
                      left: `${c.x * 100}%`, top: `${c.y * 100}%`,
                      width: `${width * 100}%`, height: 'auto', objectFit: 'contain' as const,
                    }
                  })()}
                />
              )}
            </div>
            <div className="grid grid-cols-3 gap-1 mt-2 mx-auto" style={{ width: 230 }}>
              {SPOTS.map((s) => (
                <button
                  key={s.key} type="button" onClick={() => setSpot(s.key)} title={s.label}
                  className="rounded border text-[10px] py-1.5 transition-colors"
                  style={{
                    borderColor: s.key === spot ? '#0EA5A4' : 'var(--border)',
                    background: s.key === spot ? 'rgba(14,165,164,0.12)' : 'transparent',
                    color: s.key === spot ? '#0EA5A4' : 'var(--text-2)',
                  }}
                >
                  ●
                </button>
              ))}
            </div>
            <p className="text-[11px] mt-1 text-center" style={muted}>{place.label}</p>
          </div>

          <label className="text-[12px] font-medium" style={text}>
            Size
            <input
              type="range" min={10} max={100} value={Math.round(width * 100)}
              onChange={(e) => setWidth(Number(e.target.value) / 100)}
              className="w-full mt-1"
            />
            <span className="text-[11px]" style={muted}>{Math.round(width * 100)}% of the frame</span>
          </label>

          <div>
            <p className="text-[12px] font-medium mb-1" style={text}>When it shows</p>
            <div className="flex gap-2">
              {([['lowerthird', 'Early, for 10s'], ['endcard', 'Last 8 seconds']] as const).map(([k, label]) => (
                <button
                  key={k} type="button" onClick={() => setStyle(k)}
                  className="flex-1 rounded-lg border text-[11.5px] py-2 transition-colors"
                  style={{
                    borderColor: style === k ? '#0EA5A4' : 'var(--border)',
                    background: style === k ? 'rgba(14,165,164,0.10)' : 'transparent',
                    color: style === k ? '#0EA5A4' : 'var(--text-2)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button" onClick={save} disabled={saving || !sticker}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#0EA5A4,#0891B2)' }}
        >
          {saving ? 'Saving…' : 'Use this on all of them'}
        </button>
        {/* NO CTA IS A CHOICE, not an absence. Recorded, so the batch stops
            waiting for an answer it has already been given. */}
        <button
          type="button" onClick={() => onSave(null)} disabled={saving}
          className="inline-flex items-center gap-1.5 text-[12.5px] underline disabled:opacity-50"
          style={muted}
        >
          <Ban size={13} /> No CTA on these
        </button>
      </div>
    </div>
  )
}
