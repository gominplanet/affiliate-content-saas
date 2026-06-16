'use client'

// Always-visible "N posts left" chip for the sidebar. Fetches /api/usage/posts
// on mount and renders the remaining post allowance with a progress bar that
// turns amber as the cap nears and red when it's spent. Hidden entirely for
// unlimited plans (nothing to count down) and while the fetch is in flight, so
// it never flashes a wrong number. Links to /billing for the upgrade nudge.

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Usage {
  used: number
  limit: number | null
  remaining: number | null
  lifetime: boolean
  unlimited: boolean
}

export default function UsageChip({ collapsed }: { collapsed?: boolean }) {
  const [u, setU] = useState<Usage | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/usage/posts')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d && !d.error) setU(d as Usage) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (!u || u.unlimited || u.limit === null || u.remaining === null) return null

  const { used, limit, remaining, lifetime } = u
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100))
  const out = remaining === 0
  const near = !out && pct >= 60
  const color = out ? '#FF3B30' : near ? '#FF9500' : '#7C3AED'
  const noun = lifetime ? 'free review' : 'post'
  const label = out
    ? `No ${noun}s left`
    : `${remaining} ${noun}${remaining === 1 ? '' : 's'} left`

  if (collapsed) {
    return (
      <Link
        href="/billing"
        title={label}
        className="mx-auto mb-2 mt-1 flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white"
        style={{ background: color }}
      >
        {remaining}
      </Link>
    )
  }

  return (
    <Link
      href="/billing"
      className="group block px-3 pb-2 pt-1"
      title={out ? 'Upgrade to keep creating' : `${used} of ${limit} used${lifetime ? '' : ' this period'}`}
    >
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="font-semibold" style={{ color }}>{label}</span>
        <span
          className="font-medium opacity-0 transition-opacity group-hover:opacity-100"
          style={{ color: 'var(--text-faint)' }}
        >
          {out ? 'Upgrade →' : `${used}/${limit}`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--surface-bright)' }}>
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </Link>
  )
}
