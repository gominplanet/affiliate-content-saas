'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Gauge } from 'lucide-react'

/**
 * Horizontal plan-usage strip that sits directly under the topbar, on every
 * page. Shows every metered action that applies to the plan as a compact chip
 * (label · used/limit · mini bar), so nothing capped is invisible. Reads
 * /api/usage/summary. Amber past 75%, red at the cap. Hidden when the plan has
 * no finite caps (and on read error), and scrolls horizontally on narrow widths.
 */

interface Bucket { key: string; label: string; used: number; limit: number | null; remaining: number | null }
interface Summary { tier: string; buckets: Bucket[]; resetLabel: string | null; lifetime: boolean }

function toneFor(ratio: number): string {
  if (ratio >= 1) return '#FF3B30'
  if (ratio >= 0.75) return '#FF9500'
  return '#7C3AED'
}

export default function UsageBar() {
  const [data, setData] = useState<Summary | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/usage/summary')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d && Array.isArray(d.buckets)) setData(d as Summary) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const buckets = data?.buckets ?? []
  if (buckets.length === 0) return null

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto border-b px-6 py-2"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <span className="flex flex-shrink-0 items-center gap-1 pr-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
        <Gauge size={12} /> Usage
      </span>
      {buckets.map(b => {
        const ratio = b.limit ? Math.min(1, b.used / b.limit) : 0
        const color = toneFor(b.limit ? b.used / b.limit : 0)
        return (
          <div
            key={b.key}
            className="flex flex-shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1"
            style={{ borderColor: 'var(--border-2, var(--border))' }}
            title={b.limit != null ? `${b.used} of ${b.limit} used` : `${b.used} used`}
          >
            <span className="text-[11px] font-medium" style={{ color: 'var(--text)' }}>{b.label}</span>
            <span className="text-[11px] tabular-nums font-semibold" style={{ color }}>
              {b.used}{b.limit != null ? `/${b.limit}` : ''}
            </span>
            <span className="hidden sm:inline-block h-1.5 w-10 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--surface-bright, var(--border-2))' }}>
              <span className="block h-full rounded-full" style={{ width: `${ratio * 100}%`, background: color }} />
            </span>
          </div>
        )
      })}
      {data?.resetLabel && (
        <span className="flex-shrink-0 pl-1 text-[10px]" style={{ color: 'var(--text-faint)' }}>resets {data.resetLabel}</span>
      )}
      <Link
        href="/billing"
        className="ml-auto flex-shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-white"
        style={{ background: '#7C3AED' }}
      >
        Upgrade
      </Link>
    </div>
  )
}
