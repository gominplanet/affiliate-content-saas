'use client'

// Monthly-consumption gauge for the dashboard. A semicircular speedometer that
// reads /api/usage/generations (the SAME rows the quota enforces — blog posts +
// YouTube thumbnails + YouTube metadata) so what the user sees matches what the
// cap actually counts. Colour shifts green → amber → red as they approach the
// cap. Unlimited tiers (admin / grandfathered) get a calm "Unlimited" state.

import { useEffect, useState } from 'react'

interface Usage {
  tier: string
  used: number
  limit: number | null
  remaining: number | null
  unlimited: boolean
  resetLabel: string | null
  lifetime: boolean
}

// Geometry for the 180° arc.
const CX = 110
const CY = 110
const R = 86
const ARC = Math.PI * R // semicircle length
// Top semicircle, left → right (SVG sweep-flag 1 = through the top).
const ARC_PATH = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`

function colorFor(pct: number): string {
  if (pct >= 0.9) return '#ff3b30' // red — nearly out
  if (pct >= 0.7) return '#ff9500' // amber — heads-up
  return '#34c759' // green — plenty left
}

export default function ConsumptionGauge({ embedded = false }: { embedded?: boolean }) {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/usage/generations')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { if (!cancelled) setUsage(d as Usage) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [])

  if (failed) return null
  if (!usage) {
    // Skeleton — reserve the space so the dashboard doesn't jump.
    const inner = (
      <>
        {!embedded && <div className="h-4 w-40 rounded bg-black/5 dark:bg-white/5 mb-4" />}
        <div className="h-24 w-full rounded bg-black/5 dark:bg-white/5" />
      </>
    )
    if (embedded) return <div>{inner}</div>
    return (
      <div className="rounded-2xl border p-5" style={{ background: 'var(--surface, #fff)', borderColor: 'var(--border, rgba(0,0,0,0.08))' }}>
        {inner}
      </div>
    )
  }

  const unlimited = usage.unlimited || usage.limit === null
  const limit = usage.limit ?? 0
  const pct = unlimited || limit <= 0 ? 0 : Math.min(1, usage.used / limit)
  const arcColor = unlimited ? '#7C3AED' : colorFor(pct)
  const dash = unlimited ? ARC : pct * ARC
  const remaining = usage.remaining ?? 0

  return (
    <div
      className={embedded ? 'flex flex-col' : 'rounded-2xl border p-5 flex flex-col'}
      style={embedded ? undefined : { background: 'var(--surface, #fff)', borderColor: 'var(--border, rgba(0,0,0,0.08))' }}
    >
      {!embedded && (
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text, #1d1d1f)' }}>Monthly usage</h3>
          <span className="text-[11px] font-medium capitalize px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(124,58,237,0.10)', color: '#7C3AED' }}>
            {usage.tier}
          </span>
        </div>
      )}

      <div className="relative flex items-center justify-center">
        <svg viewBox="0 0 220 128" className="w-full max-w-[240px]" role="img"
          aria-label={unlimited ? `Unlimited plan — ${usage.used} generations used this period` : `${usage.used} of ${limit} generations used this period`}>
          {/* track */}
          <path d={ARC_PATH} fill="none" stroke="var(--border-bright, rgba(0,0,0,0.09))" strokeWidth={16} strokeLinecap="round" />
          {/* value */}
          <path
            d={ARC_PATH}
            fill="none"
            stroke={arcColor}
            strokeWidth={16}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${ARC}`}
            style={{ transition: 'stroke-dasharray 700ms ease, stroke 400ms ease' }}
          />
          {/* center readout */}
          {unlimited ? (
            <text x={CX} y={92} textAnchor="middle" fontSize={22} fontWeight={800} fill="var(--text, #1d1d1f)">∞</text>
          ) : (
            <text x={CX} y={94} textAnchor="middle" fill="var(--text, #1d1d1f)">
              <tspan fontSize={30} fontWeight={800}>{usage.used}</tspan>
              <tspan fontSize={15} fontWeight={600} fill="var(--text-faint, #86868b)"> / {limit}</tspan>
            </text>
          )}
          <text x={CX} y={112} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--text-faint, #86868b)"
            style={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {unlimited ? 'Unlimited' : `${usage.lifetime ? 'used' : 'this period'}`}
          </text>
        </svg>
      </div>

      <p className="text-[12px] text-center mt-1" style={{ color: 'var(--text-soft, #6e6e73)' }}>
        {unlimited
          ? `${usage.used} generation${usage.used === 1 ? '' : 's'} used${usage.lifetime ? '' : ' this period'}`
          : usage.lifetime
            ? <>{remaining} of {limit} left in your trial{remaining <= 0 ? ' — upgrade to keep going' : ''}</>
            : <><strong style={{ color: 'var(--text, #1d1d1f)' }}>{remaining}</strong> left{usage.resetLabel ? ` · resets ${usage.resetLabel}` : ''}</>}
      </p>

      <p className="text-[10px] text-center mt-1.5" style={{ color: 'var(--text-faint, #86868b)' }}>
        Counts blog posts, YouTube thumbnails &amp; metadata
      </p>
    </div>
  )
}
