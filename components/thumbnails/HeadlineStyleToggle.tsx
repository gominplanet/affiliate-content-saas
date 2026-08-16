'use client'

import { useEffect, useState } from 'react'

/**
 * Shared "headline style" control for every thumbnail generator. Polished
 * (default) = the current benefit headline. Question hook = a curiosity question
 * about the product ("Does it actually work?") + a matching facial reaction.
 *
 * The choice is persisted per browser under ONE key so a creator's preference
 * carries across every surface (Co-Pilot, Amazon composer, pins, blog heroes).
 */

const STORAGE_KEY = 'mvp_thumb_question'

/** Persisted boolean: true = question hook, false = polished statement. */
export function useHeadlineStyle(): [boolean, (on: boolean) => void] {
  const [question, setQuestion] = useState(false)
  useEffect(() => {
    try { setQuestion(localStorage.getItem(STORAGE_KEY) === '1') } catch { /* ignore */ }
  }, [])
  const set = (on: boolean) => {
    setQuestion(on)
    try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0') } catch { /* ignore */ }
  }
  return [question, set]
}

/** Map the boolean to the API value. */
export const headlineStyleValue = (question: boolean): 'statement' | 'question' => (question ? 'question' : 'statement')

export function HeadlineStyleToggle({
  question,
  onChange,
  disabled,
  compact,
}: {
  question: boolean
  onChange: (on: boolean) => void
  disabled?: boolean
  compact?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {!compact && (
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft, #86868b)' }}>
          Headline style
        </span>
      )}
      <div className="inline-flex rounded-lg border p-0.5 w-full" style={{ borderColor: 'var(--border, #d2d2d7)', background: 'var(--surface, #fff)' }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(false)}
          className={`flex-1 text-[12px] font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-60 ${!question ? 'bg-[#7C3AED] text-white' : 'hover:opacity-80'}`}
          style={!question ? undefined : { color: 'var(--text-soft, #6e6e73)' }}
        >
          Polished
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(true)}
          className={`flex-1 text-[12px] font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-60 ${question ? 'bg-[#7C3AED] text-white' : 'hover:opacity-80'}`}
          style={question ? undefined : { color: 'var(--text-soft, #6e6e73)' }}
        >
          Question hook
        </button>
      </div>
      {!compact && (
        <p className="text-[10px]" style={{ color: 'var(--text-faint, #86868b)' }}>
          {question
            ? 'MVP writes a curiosity question about the product (e.g. “Does it actually work?”) and matches the expression to it.'
            : 'Your polished benefit headline. Switch to Question hook for a clickier, question-style title.'}
        </p>
      )}
    </div>
  )
}
