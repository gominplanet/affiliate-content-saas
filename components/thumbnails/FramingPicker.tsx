'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "How much of me is in this?" — one control, every builder.
//
// Chest-up was hardcoded into every design MVP has ever made, which is correct
// for a thumbnail (the face is what a viewer is scanning) and impossible for
// trousers, shoes, socks, a dress or swimwear. So the default still comes from
// the product, and this is the override.
//
// Build and height only appear for a full-body shot, and only because MVP has
// no photograph below the creator's chest. That is stated on the control rather
// than discovered in a render: someone picking Full body is entitled to know
// the body is being drawn from two words, not from a picture of them.
//
// Lives here rather than in each page for the same reason the wear toggle and
// the expression picker do: several screens build a design with a person in it,
// and a control written several times behaves several ways.

import { useCallback, useEffect, useState } from 'react'
import {
  BUILDS, HEIGHTS, normalizeFraming, normalizeBuild, normalizeHeight,
  type Framing, type BuildKey, type HeightKey,
} from '@/lib/body-framing'

const LS_FRAMING = 'mvp_thumb_framing'
const LS_BUILD = 'mvp_thumb_build'
const LS_HEIGHT = 'mvp_thumb_height'

/** Shared state for the picker, persisted like the other design controls.
 *  'auto' is a real stored value and the default: it means "nobody has chosen",
 *  which is what lets the product category decide. */
export function useFraming(): {
  framing: Framing; setFraming: (v: Framing) => void
  build: BuildKey; setBuild: (v: BuildKey) => void
  height: HeightKey; setHeight: (v: HeightKey) => void
} {
  const [framing, setF] = useState<Framing>('auto')
  const [build, setB] = useState<BuildKey>('average')
  const [height, setH] = useState<HeightKey>('average')

  useEffect(() => {
    try {
      setF(normalizeFraming(localStorage.getItem(LS_FRAMING)))
      setB(normalizeBuild(localStorage.getItem(LS_BUILD)))
      setH(normalizeHeight(localStorage.getItem(LS_HEIGHT)))
    } catch { /* private window */ }
  }, [])

  const setFraming = useCallback((v: Framing) => {
    setF(v)
    try { localStorage.setItem(LS_FRAMING, v) } catch { /* private window */ }
  }, [])
  const setBuild = useCallback((v: BuildKey) => {
    setB(v)
    try { localStorage.setItem(LS_BUILD, v) } catch { /* private window */ }
  }, [])
  const setHeight = useCallback((v: HeightKey) => {
    setH(v)
    try { localStorage.setItem(LS_HEIGHT, v) } catch { /* private window */ }
  }, [])

  return { framing, setFraming, build, setBuild, height, setHeight }
}

function Chip({ on, label, onClick, disabled }: {
  on: boolean; label: string; onClick: () => void; disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={on}
      className="rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d97706]/40"
      style={{
        borderColor: on ? '#d97706' : 'var(--border)',
        background: on ? 'rgba(217,119,6,0.10)' : 'transparent',
        color: on ? '#b45309' : 'var(--text-soft)',
      }}
    >
      {label}
    </button>
  )
}

export default function FramingPicker({
  framing, onFraming, build, onBuild, height, onHeight, autoIsFull, disabled,
}: {
  framing: Framing
  onFraming: (v: Framing) => void
  build: BuildKey
  onBuild: (v: BuildKey) => void
  height: HeightKey
  onHeight: (v: HeightKey) => void
  /** What 'auto' resolves to for the product currently in the form, so the
   *  button that will actually be used is the one that looks selected. */
  autoIsFull?: boolean
  disabled?: boolean
}) {
  const effective: 'bust' | 'full' = framing === 'auto' ? (autoIsFull ? 'full' : 'bust') : framing

  return (
    <div>
      <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--text)' }}>
        Framing
      </span>
      <div className="flex flex-wrap gap-1.5">
        <Chip on={effective === 'bust'} label="Bust shot" disabled={disabled} onClick={() => onFraming('bust')} />
        <Chip on={effective === 'full'} label="Full body shot" disabled={disabled} onClick={() => onFraming('full')} />
      </div>
      <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-soft)' }}>
        {effective === 'full'
          ? 'Head to feet, so shoes, trousers and full outfits are actually visible.'
          : 'Chest up, which puts the most face on screen.'}
        {framing === 'auto' ? ' Chosen for this product. Tap either to fix it.' : ''}
      </p>

      {/* Only for a full-body shot, and only because there is no photo to work
          from below the chest. Saying so here is cheaper than a creator
          wondering why the body in the render is not theirs. */}
      {effective === 'full' && (
        <div className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[11px] leading-relaxed mb-2.5" style={{ color: 'var(--text-soft)' }}>
            MVP only has photos of your face, so a full-body shot draws the rest of you. These two settings are what it draws from.
          </p>

          <span className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--text)' }}>Build</span>
          <div className="flex flex-wrap gap-1.5">
            {BUILDS.map(b => (
              <Chip key={b.key} on={b.key === build} label={b.label} disabled={disabled} onClick={() => onBuild(b.key)} />
            ))}
          </div>

          <span className="block text-[11px] font-semibold mt-3 mb-1" style={{ color: 'var(--text)' }}>Height</span>
          <div className="flex flex-wrap gap-1.5">
            {HEIGHTS.map(h => (
              <Chip key={h.key} on={h.key === height} label={h.label} disabled={disabled} onClick={() => onHeight(h.key)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
