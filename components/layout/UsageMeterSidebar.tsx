'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Gauge } from 'lucide-react'

/**
 * Plan-usage meter for the sidebar footer (above the user pill) — visible on
 * every page so users always know how much of each limit they've used this
 * period. Reads /api/usage/summary, which returns the caps that apply to the
 * user's tier (Amazon → Thumbnails / Pins / Instagram / Facebook; other tiers →
 * their Generations allowance, plus Shorts / X on Pro; admin gets a sample
 * preview so the founder can see the visual).
 *
 * Renders every bucket inline as a compact labelled bar. Bars go amber past 75%
 * and red at the cap. Hidden only when the plan has no buckets at all.
 */

interface Bucket { key: string; label: string; used: number; limit: number | null; remaining: number | null }
interface Summary { tier: string; buckets: Bucket[]; resetLabel: string | null; lifetime: boolean }

function toneFor(ratio: number): string {
  if (ratio >= 1) return '#FF3B30'
  if (ratio >= 0.75) return '#FF9500'
  return '#7C3AED'
}

export default function UsageMeterSidebar({ collapsed }: { collapsed?: boolean }) {
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

  // Collapsed rail → a single gauge icon tinted by the hottest bucket.
  if (collapsed) {
    const hottest = buckets.reduce((a, b) => {
      const ra = a.limit ? a.used / a.limit : 0
      const rb = b.limit ? b.used / b.limit : 0
      return rb > ra ? b : a
    }, buckets[0])
    const ratio = hottest.limit ? Math.min(1, hottest.used / hottest.limit) : 0
    return (
      <Link href="/billing" title="Plan usage" className="mx-auto mb-2 mt-1 flex items-center justify-center">
        <Gauge size={18} style={{ color: toneFor(ratio) }} />
      </Link>
    )
  }

  return (
    <div className="px-3 pb-2 pt-1">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
          <Gauge size={11} /> Usage
        </span>
        {data?.resetLabel && (
          <span className="text-[9px]" style={{ color: 'var(--text-faint)' }}>resets {data.resetLabel}</span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {buckets.map(b => {
          const ratio = b.limit ? Math.min(1, b.used / b.limit) : 0
          const color = toneFor(b.limit ? b.used / b.limit : 0)
          return (
            <div key={b.key}>
              <div className="mb-0.5 flex items-center justify-between text-[10px]">
                <span className="font-medium" style={{ color: 'var(--text)' }}>{b.label}</span>
                <span className="tabular-nums font-medium" style={{ color }}>
                  {b.used}{b.limit != null ? `/${b.limit}` : ''}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--surface-bright)' }}>
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${ratio * 100}%`, backgroundColor: color }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
