// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One numbered step on the launch page.
//
// THE PAGE HAS TO LEAD. Five equal boxes is a form, and a creator looking at a
// form has to work out the order for themselves. Exactly one step is `current`
// at a time (lib/launch-batch decides which), and it is the only one that is
// open, tinted and outlined. Everything before it is a green tick with its
// answer beside it; everything after is dimmed and shut.
//
// A step is NEVER ticked because it was visited. `done` comes from the same
// function the worker uses, so the tick means the thing is actually true.
'use client'

import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

const text = { color: 'var(--text)' } as const
const muted = { color: 'var(--text-2)' } as const

export default function StepCard({
  n, title, detail, done, current, open, onToggle, children,
}: {
  n: number
  title: string
  /** One line: what is still needed, or what was chosen. */
  detail: string
  done: boolean
  /** The one step the creator should do next. */
  current: boolean
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  // Green ONLY for done. A current step is teal, which reads as "you are here"
  // rather than as an achievement.
  const accent = done ? '#10B981' : current ? '#0EA5A4' : 'var(--border)'
  return (
    <section
      className="rounded-2xl border transition-colors"
      style={{
        borderColor: current ? accent : 'var(--border)',
        background: current ? 'rgba(14,165,164,0.05)' : 'var(--surface)',
        // A step that is neither done nor current is not the creator's problem
        // yet, and saying so with opacity is quieter than a lock icon.
        opacity: done || current || open ? 1 : 0.62,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
      >
        <span
          className="shrink-0 inline-flex items-center justify-center rounded-full text-[12px] font-bold"
          style={{
            width: 26, height: 26,
            background: done ? accent : current ? accent : 'var(--surface-hover)',
            color: done || current ? '#fff' : 'var(--text-2)',
          }}
        >
          {done ? <Check size={14} /> : n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold" style={text}>{title}</span>
          {/* THE SAME SENTENCE THE SERVER GIVES. A screen that writes its own
              summary can be more optimistic than the thing doing the work. */}
          <span className="block text-[12.5px] mt-0.5" style={done ? { color: '#10B981' } : muted}>
            {detail}
          </span>
        </span>
        {current && !open && (
          <span className="shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full"
            style={{ background: accent, color: '#fff' }}>
            Do this next
          </span>
        )}
        <ChevronDown
          size={16}
          className="shrink-0 transition-transform"
          style={{ ...muted, transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: 'var(--border)' }}>{children}</div>}
    </section>
  )
}
