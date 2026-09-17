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

import { VISUAL_PRESETS, DEFAULT_PRESET_ID, type VisualPreset } from '@/lib/visual-presets'
import { Check } from 'lucide-react'

/** A miniature of the look: ground, type, accent, and badges only where the
 *  preset actually has them. The badge row is the most visible difference
 *  between the loud looks and the restrained ones, so it is not decoration. */
function Preview({ preset }: { preset: VisualPreset }) {
  const [bg, ink, accent] = preset.swatch
  return (
    <div
      aria-hidden
      style={{
        background: bg, borderRadius: 6, height: 74, padding: 8,
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        gap: 4, overflow: 'hidden', position: 'relative',
      }}
    >
      {/* Stands in for the product. */}
      <div style={{
        position: 'absolute', right: 8, top: 8, width: 26, height: 26,
        borderRadius: preset.id === 'technical' ? 2 : 13,
        background: accent, opacity: 0.85,
      }} />
      <div style={{
        color: ink,
        fontWeight: preset.previewWeight,
        fontFamily: preset.previewSerif ? 'Georgia, serif' : 'inherit',
        fontSize: preset.id === 'premium' ? 8 : 12,
        letterSpacing: preset.id === 'premium' ? '0.18em' : preset.id === 'retro' ? '-0.02em' : 0,
        textTransform: preset.id === 'premium' || preset.id === 'retro' ? 'uppercase' : 'none',
        lineHeight: 1.05,
      }}>
        {preset.id === 'retro' ? 'THE ONE TO BUY' : 'The one to buy'}
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
  value: string | null | undefined
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const current = String(value ?? '').trim() || DEFAULT_PRESET_ID

  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>
        Look for your images
      </label>
      <p className="text-[11.5px] mb-2.5 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        This sets the style of every image MVP makes for you: blog headers, YouTube thumbnails and
        Pinterest pins. It applies to all of them so your posts look like each other, and it is what
        stops your thumbnails looking like everybody else&apos;s. Your brand colours are used on top of
        whichever you pick.
      </p>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {VISUAL_PRESETS.map(p => {
          const selected = p.id === current
          return (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(p.id)}
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
}
