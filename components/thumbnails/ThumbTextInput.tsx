// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Your own thumbnail text": the one box every thumbnail surface shows (Seb,
// 2026-10-18). Empty means MVP writes the words. Typed means MVP puts exactly
// these words on the thumbnail, split over its two lines the way the preview
// shows, and the rules in lib/thumb-text are checked as the creator types so a
// text the generator would refuse is said here first, with the reason.
'use client'

import { Type } from 'lucide-react'
import { THUMB_TEXT_MAX_CHARS, normalizeThumbText, splitThumbText, thumbTextProblem } from '@/lib/thumb-text'

export default function ThumbTextInput({
  value, onChange, disabled, label = 'Your own thumbnail text', compact = false, note,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  label?: string
  /** Smaller, for a row inside a per-video editor. */
  compact?: boolean
  /** A line under the box for this surface, e.g. what a change rebuilds. */
  note?: string
}) {
  const problem = thumbTextProblem(value)
  const split = !problem && normalizeThumbText(value) ? splitThumbText(value) : null
  return (
    <div className="flex flex-col gap-1.5">
      <label className={`flex items-center gap-1.5 font-semibold uppercase tracking-[0.08em] ${compact ? 'text-[10.5px]' : 'text-[11px]'}`}
        style={{ color: 'var(--text-2, #6e6e73)' }}>
        <Type size={compact ? 11 : 12} /> {label} <span className="font-normal normal-case tracking-normal">(optional)</span>
      </label>
      <input
        type="text"
        value={value}
        disabled={disabled}
        maxLength={THUMB_TEXT_MAX_CHARS + 10}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. WORTH THE HYPE?"
        aria-invalid={!!problem}
        className={`w-full rounded-lg border bg-transparent uppercase tracking-wide focus:outline-none focus:border-[#7C3AED] disabled:opacity-50 ${compact ? 'px-2.5 py-1.5 text-[12px]' : 'px-3 py-2 text-[13px]'}`}
        style={{ borderColor: problem ? '#DC2626' : 'var(--border, rgba(0,0,0,0.12))', color: 'var(--text, #1d1d1f)' }}
      />
      {problem ? (
        <p className="text-[11.5px] text-red-700 dark:text-red-300">{problem}</p>
      ) : split ? (
        <p className="text-[11.5px]" style={{ color: 'var(--text-2, #6e6e73)' }}>
          MVP puts exactly this on the thumbnail:{' '}
          {split.line1 && <><b style={{ color: 'var(--text, #1d1d1f)' }}>{split.line1}</b> / </>}
          <b style={{ color: 'var(--text, #1d1d1f)' }}>{split.line2}</b>
        </p>
      ) : (
        <p className="text-[11.5px]" style={{ color: 'var(--text-2, #6e6e73)' }}>
          Leave it empty and MVP writes it. Type a line and MVP uses your words exactly.
        </p>
      )}
      {note && !problem && <p className="text-[11.5px]" style={{ color: 'var(--text-2, #6e6e73)' }}>{note}</p>}
    </div>
  )
}
