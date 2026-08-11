'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Gauge, ArrowRight } from 'lucide-react'

/**
 * GLOBAL usage meter in the dashboard topbar — visible on every page so users
 * always know how much of their plan's limits they've used this period.
 *
 * Reads /api/usage/summary, which returns the hard caps that apply to the user's
 * tier (Amazon tier → Thumbnails / Pins / Instagram / Facebook; other tiers →
 * their Generations allowance, plus Shorts / X on Pro). The pill shows the
 * bucket closest to its limit; the dropdown lists them all with mini bars.
 *
 * Renders nothing when the plan has no finite caps (admin/unlimited) or the read
 * fails — it never shows a wrong number or clutters the bar for unlimited plans.
 */

interface Bucket { key: string; label: string; used: number; limit: number; remaining: number }
interface Summary { tier: string; buckets: Bucket[]; resetLabel: string | null; lifetime: boolean }

// Colour by how full the bucket is: calm under 75%, amber approaching, red at/over.
function toneFor(ratio: number): { bar: string; text: string } {
  if (ratio >= 1) return { bar: '#ff3b30', text: '#ff3b30' }
  if (ratio >= 0.75) return { bar: '#ff9500', text: '#ff9500' }
  return { bar: '#7C3AED', text: 'var(--text, #1d1d1f)' }
}

export default function UsageMeterTopbar() {
  const [data, setData] = useState<Summary | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/usage/summary')
      .then(r => r.json())
      .then(d => { if (!cancelled && Array.isArray(d?.buckets)) setData(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const buckets = data?.buckets ?? []
  if (buckets.length === 0) return null

  // The "hottest" bucket (highest used/limit) leads the pill — that's the one
  // the user is most likely to hit.
  const hottest = buckets.reduce((a, b) =>
    (b.used / b.limit) > (a.used / a.limit) ? b : a, buckets[0])
  const hotRatio = Math.min(1, hottest.used / hottest.limit)
  const hotTone = toneFor(hottest.used / hottest.limit)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[12px] font-medium transition-colors hover:bg-[var(--surface-2,#f5f5f7)]"
        style={{ borderColor: 'var(--border, #e5e5e7)' }}
        title="Your plan usage this period"
      >
        <Gauge size={13} style={{ color: hotTone.text }} />
        <span className="hidden sm:inline" style={{ color: hotTone.text }}>
          {hottest.label} {hottest.used}/{hottest.limit}
        </span>
        {/* tiny inline bar */}
        <span className="hidden md:inline-block w-8 h-1.5 rounded-full overflow-hidden bg-[var(--border-2,#e5e5e7)]">
          <span className="block h-full rounded-full" style={{ width: `${hotRatio * 100}%`, background: hotTone.bar }} />
        </span>
      </button>

      {open && (
        <>
          {/* click-away */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 mt-2 w-[300px] rounded-xl border bg-white dark:bg-[#1c1c1e] shadow-xl z-50 p-3.5"
            style={{ borderColor: 'var(--border, #e5e5e7)' }}
          >
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Plan usage</p>
              {data?.resetLabel && (
                <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">resets {data.resetLabel}</span>
              )}
              {data?.lifetime && (
                <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">trial total</span>
              )}
            </div>

            <div className="flex flex-col gap-3">
              {buckets.map(b => {
                const ratio = Math.min(1, b.used / b.limit)
                const tone = toneFor(b.used / b.limit)
                return (
                  <div key={b.key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{b.label}</span>
                      <span className="text-[11px] tabular-nums" style={{ color: tone.text }}>
                        {b.used}/{b.limit}
                        {b.remaining > 0
                          ? <span className="text-[#86868b] dark:text-[#8e8e93]"> · {b.remaining} left</span>
                          : <span className="font-semibold"> · full</span>}
                      </span>
                    </div>
                    <span className="block w-full h-1.5 rounded-full overflow-hidden bg-[var(--border-2,#e5e5e7)]">
                      <span className="block h-full rounded-full transition-all" style={{ width: `${ratio * 100}%`, background: tone.bar }} />
                    </span>
                  </div>
                )
              })}
            </div>

            <Link
              href="/pricing"
              onClick={() => setOpen(false)}
              className="mt-3.5 flex items-center justify-center gap-1.5 w-full text-xs font-semibold text-white px-3 py-2 rounded-lg bg-[#7C3AED] hover:opacity-90 transition-opacity"
            >
              Need more? Upgrade <ArrowRight size={12} />
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
