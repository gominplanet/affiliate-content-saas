'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

// Order MUST match NEON_BORDER_STYLES in lib/thumbnail-simple-bake.ts (index =
// borderStyleIndex). Kept here as a plain const because that lib is server-only
// (sharp/opentype) and can't be imported into a client component.
const BORDER_NAMES = [
  'Cyan ↔ magenta', 'All-yellow', 'Neon green', 'Pink ↔ purple', 'Fire (orange↔red)',
  'Ice blue', 'Gold', 'Lime ↔ cyan', 'Rainbow', 'Electric blue',
]
// Common title-accent colours. First = the current default (yellow).
const ACCENT_SWATCHES = ['#FFE034', '#FFFFFF', '#FF3B3B', '#39FF14', '#33B5FF', '#FF8A00', '#A020F0']

interface BrandThumbStyle {
  borderStyleIndex: number | null
  accentColor: string | null
  faceModelId: string | null
}

/**
 * Saved thumbnail BRAND STYLE control. Lets a creator lock one look — a fixed
 * neon border, a title accent colour, and a pinned face model — so a whole
 * channel reads consistently. Reads/writes /api/youtube/thumbnail-style; the
 * `applyBrandStyle` toggle (parent state) decides whether the next generation
 * uses it. Distinct from the "Style reference" image picker.
 */
export default function BrandStylePanel({
  faceModels,
  applyBrandStyle,
  onToggle,
  disabled,
}: {
  faceModels: Array<{ id: string; name: string }>
  applyBrandStyle: boolean
  onToggle: (v: boolean) => void
  disabled?: boolean
}) {
  const [loaded, setLoaded] = useState(false)
  const [hasSaved, setHasSaved] = useState(false)
  const [borderStyleIndex, setBorderStyleIndex] = useState<number | null>(null)
  const [accentColor, setAccentColor] = useState<string>('#FFE034')
  const [faceModelId, setFaceModelId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/youtube/thumbnail-style')
        const d = await r.json() as { style?: BrandThumbStyle | null }
        if (!cancelled && d.style) {
          setHasSaved(true)
          setBorderStyleIndex(typeof d.style.borderStyleIndex === 'number' ? d.style.borderStyleIndex : null)
          setAccentColor(d.style.accentColor || '#FFE034')
          setFaceModelId(d.style.faceModelId ?? null)
        }
      } catch { /* ignore — panel just starts empty */ }
      finally { if (!cancelled) setLoaded(true) }
    })()
    return () => { cancelled = true }
  }, [])

  async function save() {
    setBusy(true)
    try {
      const r = await fetch('/api/youtube/thumbnail-style', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ borderStyleIndex, accentColor, faceModelId }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as { error?: string }
        throw new Error(e.error || 'Save failed')
      }
      setHasSaved(true)
      onToggle(true)
      toast.success('Brand style saved — new thumbnails will use it')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save brand style')
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
      onToggle(false)
      setBorderStyleIndex(null); setAccentColor('#FFE034'); setFaceModelId(null)
      toast.success('Brand style cleared — borders will vary again')
    } catch { toast.error('Could not clear brand style') }
    finally { setBusy(false) }
  }

  if (!loaded) return null

  const selectCls = 'text-[11px] h-7 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-[#1d1d1f] dark:text-[#f5f5f7] px-2'

  return (
    <div className="mb-3 rounded-lg border border-gray-200 dark:border-white/10 p-3">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Brand style</span>
          <span className="text-[10px] text-[#86868b]">{hasSaved ? 'lock one look across thumbnails' : 'save a look to reuse it'}</span>
        </div>
        <button
          onClick={() => onToggle(!applyBrandStyle)}
          disabled={disabled || !hasSaved}
          title={hasSaved ? 'Toggle whether new thumbnails use your saved brand style' : 'Save a brand style first'}
          className={`text-[11px] px-2.5 h-7 rounded-md border font-semibold transition disabled:opacity-50 ${applyBrandStyle && hasSaved ? 'bg-[#7C3AED] border-[#7C3AED] text-white' : 'border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#7C3AED]'}`}
        >
          {applyBrandStyle && hasSaved ? 'Brand style: ON' : 'Use my brand style'}
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] text-[#86868b]">Border</span>
          <select
            value={borderStyleIndex == null ? 'varied' : String(borderStyleIndex)}
            onChange={e => setBorderStyleIndex(e.target.value === 'varied' ? null : Number(e.target.value))}
            disabled={disabled || busy}
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
                disabled={disabled || busy}
                title={c}
                aria-label={`Accent colour ${c}`}
                className={`w-5 h-5 rounded-full border transition ${accentColor.toUpperCase() === c.toUpperCase() ? 'border-[#7C3AED] ring-2 ring-[#7C3AED]/40' : 'border-gray-300 dark:border-white/20'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {faceModels.length > 0 && (
          <label className="flex items-center gap-1.5">
            <span className="text-[11px] text-[#86868b]">Face</span>
            <select
              value={faceModelId ?? 'auto'}
              onChange={e => setFaceModelId(e.target.value === 'auto' ? null : e.target.value)}
              disabled={disabled || busy}
              className={selectCls}
            >
              <option value="auto">Auto-match</option>
              {faceModels.map(fm => <option key={fm.id} value={fm.id}>{fm.name}</option>)}
            </select>
          </label>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={save}
            disabled={disabled || busy}
            className="text-[11px] px-3 h-7 rounded-md bg-[#7C3AED] text-white font-semibold hover:bg-[#6D28D9] transition disabled:opacity-50"
          >
            {busy ? 'Saving…' : hasSaved ? 'Update style' : 'Save brand style'}
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
    </div>
  )
}
