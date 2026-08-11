'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Gauge } from 'lucide-react'

/**
 * Plan-usage strip under the topbar, on every page. Every metered action that
 * applies to the plan is shown as a labelled mini-meter in a wrapping grid (no
 * horizontal scrolling — it lays out as ~two rows on desktop and reflows down
 * on narrow widths). Reads /api/usage/summary. Amber past 75%, red at the cap.
 * Hidden when the plan has no finite caps (and on read error).
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
    <div className="border-b px-6 py-2.5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-faint)' }}>
          <Gauge size={12} /> Usage this period
        </span>
        <span className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-faint)' }}>
          {data?.resetLabel && <span>resets {data.resetLabel}</span>}
          <Link href="/billing" className="rounded-md px-2 py-0.5 font-semibold text-white" style={{ background: '#7C3AED' }}>
            Upgrade
          </Link>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
        {buckets.map(b => {
          const ratio = b.limit ? Math.min(1, b.used / b.limit) : 0
          const color = toneFor(b.limit ? b.used / b.limit : 0)
          return (
            <div key={b.key} title={b.limit != null ? `${b.used} of ${b.limit} used` : `${b.used} used`}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="truncate text-[11px] font-medium" style={{ color: 'var(--text)' }}>{b.label}</span>
                <span className="flex-shrink-0 text-[11px] font-semibold tabular-nums" style={{ color }}>
                  {b.used}{b.limit != null ? <span style={{ color: 'var(--text-faint)' }}>/{b.limit}</span> : ''}
                </span>
              </div>
              <span className="block h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'var(--surface-bright, var(--border-2))' }}>
                <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${ratio * 100}%`, background: color }} />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
