'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

// Order MUST match NEON_BORDER_STYLES in lib/thumbnail-simple-bake.ts (index =
// borderStyleIndex). Plain const because that lib is server-only (sharp/opentype).
export const BORDER_NAMES = [
  'Cyan ↔ magenta', 'All-yellow', 'Neon green', 'Pink ↔ purple', 'Fire (orange↔red)',
  'Ice blue', 'Gold', 'Lime ↔ cyan', 'Rainbow', 'Electric blue',
]
// Common title-accent colours. First = the current default (yellow).
const ACCENT_SWATCHES = ['#FFE034', '#FFFFFF', '#FF3B3B', '#39FF14', '#33B5FF', '#FF8A00', '#A020F0']

interface SavedStyle { borderStyleIndex: number | null; accentColor: string | null; face: string | null }

// The parent's selectedFaceModelId uses null(off) | 'no-human'(product) | <uuid>.
// The saved API uses                    'off'      | 'product'          | <uuid>.
// Legacy 'auto' saved values are treated as null (Off) — auto was removed.
function faceToSaved(sel: string | null): string {
  if (sel === 'no-human') return 'product'
  if (sel == null) return 'off'
  return sel
}
function savedToFace(face: string | null): string | null {
  if (face === 'auto') return null // legacy — treat as Off
  if (face === 'product') return 'no-human'
  if (face === 'off' || face == null) return null
  return face
}

/**
 * The ONE thumbnail-style block on the Co-Pilot page: border + accent colour +
 * face (Auto / Off / Product only / a Photobooth likeness). These drive EVERY
 * thumbnail this card generates; "Save as my default" persists them via
 * /api/youtube/thumbnail-style so the block prefills from your look next time.
 */
export default function BrandStylePanel({
  faceModels,
  selectedFaceModelId,
  setSelectedFaceModelId,
  borderIndex,
  setBorderIndex,
  accentColor,
  setAccentColor,
  disabled,
}: {
  faceModels: Array<{ id: string; name: string }>
  selectedFaceModelId: string | null
  setSelectedFaceModelId: (v: string | null) => void
  borderIndex: number | null
  setBorderIndex: (v: number | null) => void
  accentColor: string
  setAccentColor: (v: string) => void
  disabled?: boolean
}) {
  const [hasSaved, setHasSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  // Prefill the block from the saved default once on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/youtube/thumbnail-style')
        const d = await r.json() as { style?: SavedStyle | null }
        if (!cancelled && d.style) {
          setHasSaved(true)
          if (typeof d.style.borderStyleIndex === 'number') setBorderIndex(d.style.borderStyleIndex)
          if (d.style.accentColor) setAccentColor(d.style.accentColor)
          if (d.style.face) setSelectedFaceModelId(savedToFace(d.style.face))
        }
      } catch { /* ignore — block just keeps its defaults */ }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    setBusy(true)
    try {
      const r = await fetch('/api/youtube/thumbnail-style', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ borderStyleIndex: borderIndex, accentColor, face: faceToSaved(selectedFaceModelId) }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as { error?: string }
        throw new Error(e.error || 'Save failed')
      }
      setHasSaved(true)
      toast.success('Saved as your default — new thumbnails start from this')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save your default')
    } finally { setBusy(false) }
  }

  async function clearStyle() {
    setBusy(true)
    try {
      await fetch('/api/youtube/thumbnail-style', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true }),
      })
      setHasSaved(false)
      toast.success('Default cleared')
    } catch { toast.error('Could not clear your default') }
    finally { setBusy(false) }
  }

  const faceChip = (val: string | null, label: string, title: string) => (
    <button
      onClick={() => setSelectedFaceModelId(val)}
      disabled={disabled}
      title={title}
      className={`text-[11px] px-2.5 h-7 rounded-md border font-semibold transition disabled:opacity-60 ${selectedFaceModelId === val ? 'bg-[#7C3AED] border-[#7C3AED] text-white' : 'border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#7C3AED]'}`}
    >
      {label}
    </button>
  )

  const selectCls = 'text-[11px] h-7 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-[#1d1d1f] dark:text-[#f5f5f7] px-2'

  return (
    <div className="mb-3 rounded-lg border border-gray-200 dark:border-white/10 p-3">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Thumbnail style</span>
          <span className="text-[10px] text-[#86868b]">border, accent &amp; face for every thumbnail — save it to reuse</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={disabled || busy}
            className="text-[11px] px-3 h-7 rounded-md bg-[#7C3AED] text-white font-semibold hover:bg-[#6D28D9] transition disabled:opacity-50"
          >
            {busy ? 'Saving…' : hasSaved ? 'Update my default' : 'Save as my default'}
          </button>
          {hasSaved && (
            <button
              onClick={clearStyle}
              disabled={disabled || busy}
              className="text-[11px] px-2.5 h-7 rounded-md border border-gray-200 dark:border-white/10 text-[#86868b] hover:border-[#ff3b30] hover:text-[#ff3b30] transition disabled:opacity-50"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-[11px] text-[#86868b]">Face</span>
        {faceChip(null, 'Off', "Don't lock a face — use the video frame as-is")}
        {faceChip('no-human', 'Product only', 'No creator face — a product-only thumbnail')}
        {faceModels.map(fm => faceChip(fm.id, fm.name, `Lock ${fm.name}'s likeness from your Photobooth photos`))}
        {faceModels.length > 1 && faceChip('random', '🎲 Random', 'MVP picks one of your face models at random each generation')}
        {faceModels.length === 0 && (
          <span className="text-[10px] text-[#86868b]">Add your likeness in <a href="/face-training" className="text-[#7C3AED] hover:underline">Photobooth</a></span>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] text-[#86868b]">Border</span>
          <select
            value={borderIndex == null ? 'varied' : String(borderIndex)}
            onChange={e => setBorderIndex(e.target.value === 'varied' ? null : Number(e.target.value))}
            disabled={disabled}
            className={selectCls}
          >
            <option value="varied">Keep varied</option>
            {BORDER_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
        </label>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-[#86868b]">Accent</span>
          <div className="flex items-center gap-1">
            {ACCENT_SWATCHES.map(c => (
              <button
                key={c}
                onClick={() => setAccentColor(c)}
                disabled={disabled}
                title={c}
                aria-label={`Accent colour ${c}`}
                className={`w-5 h-5 rounded-full border transition ${accentColor.toUpperCase() === c.toUpperCase() ? 'border-[#7C3AED] ring-2 ring-[#7C3AED]/40' : 'border-gray-300 dark:border-white/20'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
