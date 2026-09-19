'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Pick a look for your images.
//
// A creator asked whether MVP's thumbnails could be customised, because every
// account was producing the same ones. The proposal on the table was a form:
// accent colour, main colour, title font, style, lighting, mood. Six fields.
//
// That form would not have worked, for three reasons.
//
// Almost nobody fills in six fields. The ones who do pick combinations that
// fight each other, because retro plus luxury plus studio lighting is three
// looks rather than one. And you cannot describe a visual style in words to
// somebody who has not seen it: "editorial" means something exact to a designer
// and nothing at all to a creator with a tool review channel.
//
// People are excellent at recognising what they like and poor at naming it. So
// this shows the looks instead of asking about them. Each tile renders its own
// preset: its real palette, its real type weight, its real layout, and whether
// it carries badges. Picking takes about five seconds and needs no vocabulary.
//
// The tiles are drawn in CSS rather than being generated images, deliberately.
// A generated sample would be one roll of the dice presented as the look, and
// the first creator whose output did not match it would have been mis-sold. A
// drawn tile promises the ingredients, which is what a preset actually fixes.

import { VISUAL_PRESETS, DEFAULT_PRESET_ID, parsePresetIds, serialisePresetIds, type VisualPreset } from '@/lib/visual-presets'
import { Check } from 'lucide-react'

/** Display order. Loud first because it holds the default every account is
 *  already on, so the current selection is visible without scrolling. */
const FAMILIES = ['Loud', 'Quiet', 'Photographic', 'Graphic'] as const

/** A miniature of the look: ground, type, accent, and badges only where the
 *  preset actually has them. The badge row is the most visible difference
 *  between the loud looks and the restrained ones, so it is not decoration. */
function Preview({ preset }: { preset: VisualPreset }) {
  const [bg, ink, accent] = preset.swatch

  // The ground tells you what KIND of image this is before you read a word:
  // a blurred gradient, a flat graphic block, a photograph, a technical grid or
  // a sheet of paper. Twenty coloured rectangles would say almost nothing.
  const ground: React.CSSProperties =
    preset.previewShape === 'gradient'
      ? { background: `radial-gradient(120% 120% at 20% 0%, ${accent} 0%, ${bg} 62%)` }
      : preset.previewShape === 'photo'
        ? { background: `linear-gradient(160deg, ${bg} 0%, ${accent}33 55%, ${bg} 100%)` }
        : preset.previewShape === 'grid'
          ? {
            background: bg,
            backgroundImage: `linear-gradient(${accent}44 1px, transparent 1px), linear-gradient(90deg, ${accent}44 1px, transparent 1px)`,
            backgroundSize: '9px 9px',
          }
          : preset.previewShape === 'paper'
            ? { background: bg, boxShadow: `inset 0 0 0 1px ${ink}18, inset 0 -8px 14px -10px ${ink}55` }
            : { background: bg }

  return (
    <div
      aria-hidden
      style={{
        ...ground,
        borderRadius: 6, height: 74, padding: 8,
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        gap: 4, overflow: 'hidden', position: 'relative',
      }}
    >
      {/* Stands in for the product. Square on the graphic looks, round on the
          photographic ones, so the shape carries information too. */}
      <div style={{
        position: 'absolute', right: 8, top: 8, width: 26, height: 26,
        borderRadius: preset.previewShape === 'grid' || preset.previewShape === 'flat' ? 2 : 13,
        background: accent,
        opacity: preset.previewShape === 'photo' ? 0.7 : 0.9,
      }} />
      <div style={{
        color: ink,
        fontWeight: preset.previewWeight,
        fontFamily: preset.previewSerif ? 'Georgia, serif' : 'inherit',
        fontSize: preset.id === 'premium' || preset.id === 'mono' ? 8 : 12,
        letterSpacing: preset.id === 'premium' || preset.id === 'mono' ? '0.18em' : preset.id === 'retro' ? '-0.02em' : 0,
        textTransform: preset.id === 'premium' || preset.id === 'retro' || preset.id === 'mono' ? 'uppercase' : 'none',
        lineHeight: 1.05,
      }}>
        {preset.id === 'retro' || preset.id === 'comic' ? 'THE ONE TO BUY' : 'The one to buy'}
      </div>
      {preset.badges ? (
        <div style={{ display: 'flex', gap: 3 }}>
          {[0, 1].map(i => (
            <span key={i} style={{
              background: accent, color: bg, fontSize: 7, fontWeight: 800,
              padding: '2px 5px', borderRadius: 999,
            }}>SPEC</span>
          ))}
        </div>
      ) : (
        <div style={{ height: 5, width: 26, background: accent, opacity: 0.6, borderRadius: 1 }} />
      )}
    </div>
  )
}

export default function VisualPresetPicker({ value, onChange, disabled }: {
  /** Comma-separated ids. A single id is the old shape and still works. */
  value: string | null | undefined
  onChange: (ids: string) => void
  disabled?: boolean
}) {
  // SEVERAL LOOKS, NOT ONE. A creator can tick as many as they like and each
  // image rolls one of them. An empty stored value means the default, which is
  // what every account had before any of this existed.
  const chosen = parsePresetIds(value)
  const current = chosen.length ? chosen : [DEFAULT_PRESET_ID]
  const many = current.length > 1

  // Ticking the last remaining look off would leave nothing, and "no look" is
  // not a state the generators have. Unticking the last one is refused rather
  // than silently reinterpreted, so the screen never shows zero selected while
  // the images come out in a look nobody picked.
  function toggle(id: string) {
    const has = current.includes(id)
    if (has && current.length === 1) return
    const next = has ? current.filter(x => x !== id) : [...current, id]
    onChange(serialisePresetIds(next))
  }

  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>
        Look for your images
      </label>
      {/* THE COPY CHANGES WITH THE CHOICE. The old sentence promised that every
          image matches, which is true of one look and false the moment a second
          is ticked. Leaving it up would have been the same class of mistake as
          a badge that calls every link an Amazon link: text describing the
          configuration somebody used to have. */}
      <p className="text-[11.5px] mb-2.5 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        {many ? (
          <>
            This sets the style of every image MVP makes for you: blog headers, YouTube thumbnails and
            Pinterest pins. You have picked <strong>{current.length} looks</strong>, so each image is
            made in one of them, chosen at random. That means images within the same post will not
            always match. Tick just one if you would rather everything looked the same. Your brand
            colours are used on top of whichever is picked.
          </>
        ) : (
          <>
            This sets the style of every image MVP makes for you: blog headers, YouTube thumbnails and
            Pinterest pins. It applies to all of them so your posts look like each other, and it is what
            stops your thumbnails looking like everybody else&apos;s. Tick more than one and MVP will pick
            at random between them. Your brand colours are used on top of whichever you pick.
          </>
        )}
      </p>
      {/* Grouped, because twenty tiles in one wall is a shop rather than a
          choice. The families are how somebody narrows down before they look. */}
      {FAMILIES.map(family => {
        const inFamily = VISUAL_PRESETS.filter(p => p.family === family)
        if (!inFamily.length) return null
        return (
          <div key={family} className="mb-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-faint)' }}>
              {family}
            </p>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {inFamily.map(p => {
                const selected = current.includes(p.id)
                const isLastOne = selected && current.length === 1
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    disabled={disabled}
                    title={isLastOne ? 'Keep at least one look selected.' : undefined}
                    onClick={() => toggle(p.id)}
                    className="text-left rounded-xl p-2 transition disabled:opacity-50"
                    style={{
                      border: `1.5px solid ${selected ? 'var(--accent, #7C3AED)' : 'var(--border)'}`,
                      background: 'var(--surface)',
                    }}
                  >
                    <Preview preset={p} />
                    <div className="flex items-center gap-1 mt-1.5">
                      <span className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>{p.name}</span>
                      {selected && <Check size={12} style={{ color: 'var(--accent, #7C3AED)' }} />}
                    </div>
                    <p className="text-[10.5px] mt-0.5 leading-snug" style={{ color: 'var(--text-faint)' }}>{p.blurb}</p>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
