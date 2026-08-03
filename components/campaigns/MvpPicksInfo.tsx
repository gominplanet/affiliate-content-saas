'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MvpPicksInfo — a small "What's this?" trigger that sits next to the MVP picks
// toggle and opens a short, plain-language write-up of what MVP Picks is. Kept
// out of the tiny hover-tooltip (InfoTip) on purpose: this is a few paragraphs
// meant for a curious user, not a one-liner. Click to open, click outside or
// Esc to close.

import { useEffect, useRef, useState } from 'react'
import { HelpCircle, X } from 'lucide-react'

export default function MvpPicksInfo() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label="What is MVP Picks?"
        className="inline-flex items-center gap-1 h-9 rounded-full px-2.5 text-[12px] font-medium border transition"
        style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}
      >
        <HelpCircle size={13} /> What's this?
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-2 z-50 w-[320px] sm:w-[380px] rounded-2xl border p-4 shadow-xl"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>What “MVP Picks” means</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="shrink-0 -mr-1 -mt-0.5 p-1 rounded-lg" style={{ color: 'var(--text-faint)' }}>
              <X size={15} />
            </button>
          </div>
          <div className="space-y-2.5 text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            <p>
              MVP Picks is our shortlist filter. Turn it on and MVP only shows products that clear a
              set of rules we've refined over five years of running Amazon affiliate content. They're
              the same thresholds we use ourselves to consistently earn six figures a year from Amazon.
            </p>
            <p>
              Other products can absolutely work, and plenty do. MVP Picks just points you at the ones
              we'd lean into first, so you spend your time on the strongest candidates instead of
              digging through everything.
            </p>
            <p>
              One honest note: this is a filter, not a promise. We can't guarantee income or results.
              What you earn comes down to the product, your content, your audience, and plenty of
              factors no tool controls. MVP Picks tilts the odds in your favor.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
