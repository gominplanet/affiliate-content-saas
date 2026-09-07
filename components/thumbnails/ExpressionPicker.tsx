'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "What face am I making?" — one control, every builder.
//
// Expression was decided for the creator: the art director picked it from the
// psychological angle, and the Question hook style pinned it to skeptical or
// doubtful, because a question headline does read best over a doubtful face.
// Which is exactly why every thumbnail from a run came back wearing the same
// frown. A channel that always looks unconvinced stops meaning anything.
//
// Auto is the default and keeps the old behaviour, so this only ever costs a
// creator something when they want it. The pick persists, because someone whose
// channel has a tone picks the same face for months, not per product.
//
// It lives here rather than in each page for the same reason the wear toggle
// does: five screens build a design with a face in it, and a control written
// five times behaves five ways.

import { useCallback, useEffect, useState } from 'react'
import { EXPRESSIONS, normalizeExpression, type ExpressionKey } from '@/lib/face-expression'

const LS_KEY = 'mvp_thumb_expression'

/** Shared state for the picker, persisted like the other design controls. */
export function useExpression(): [ExpressionKey, (v: ExpressionKey) => void] {
  const [value, setValueState] = useState<ExpressionKey>('auto')
  useEffect(() => {
    try { setValueState(normalizeExpression(localStorage.getItem(LS_KEY))) } catch { /* private window */ }
  }, [])
  const setValue = useCallback((v: ExpressionKey) => {
    setValueState(v)
    try { localStorage.setItem(LS_KEY, v) } catch { /* private window */ }
  }, [])
  return [value, setValue]
}

export default function ExpressionPicker({ value, onChange, disabled, compact }: {
  value: ExpressionKey
  onChange: (v: ExpressionKey) => void
  disabled?: boolean
  /** Tighter, for a panel that is already dense. */
  compact?: boolean
}) {
  const picked = EXPRESSIONS.find(e => e.key === value) ?? EXPRESSIONS[0]
  return (
    <div>
      <span className={`block ${compact ? 'text-[11px]' : 'text-xs'} font-semibold mb-1`} style={{ color: 'var(--text)' }}>
        Expression
      </span>
      <div className="flex flex-wrap gap-1.5">
        {EXPRESSIONS.map(e => {
          const on = e.key === value
          return (
            <button
              key={e.key}
              type="button"
              disabled={disabled}
              onClick={() => onChange(e.key)}
              aria-pressed={on}
              title={e.hint}
              className={`rounded-full border ${compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-[12px]'} font-medium transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d97706]/40`}
              style={{
                borderColor: on ? '#d97706' : 'var(--border)',
                background: on ? 'rgba(217,119,6,0.10)' : 'transparent',
                color: on ? '#b45309' : 'var(--text-soft)',
              }}
            >
              {e.label}
            </button>
          )
        })}
      </div>
      <p className={`${compact ? 'text-[10.5px]' : 'text-[11px]'} mt-1.5 leading-relaxed`} style={{ color: 'var(--text-soft)' }}>
        {picked.hint}.
      </p>
    </div>
  )
}
