'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, X, ArrowRight } from 'lucide-react'

/**
 * Proactive limit nudge. Reads /api/usage/summary and, when a real cap is at
 * 80%+ this period, shows a slim dismissible banner under the usage bar so users
 * hear about it BEFORE they hit a wall (and get a clean upgrade path). One nudge
 * at a time (the closest-to-limit bucket). Dismiss is remembered per bucket per
 * billing period, so it returns next period but never nags within one.
 *
 * Skips unlimited/admin plans (nothing to run out of) and read errors.
 */

interface Bucket { key: string; label: string; used: number; limit: number | null }
interface Summary { tier: string; buckets: Bucket[]; resetLabel: string | null }

export default function UsageNudge() {
  const [data, setData] = useState<Summary | null>(null)
  const [dismissed, setDismissed] = useState(true) // assume dismissed until we know

  useEffect(() => {
    let alive = true
    fetch('/api/usage/summary')
      .then(r => (r.ok ? r.json() : null))
      .then((d: Summary | null) => {
        if (!alive || !d || !Array.isArray(d.buckets)) return
        setData(d)
        setDismissed(false)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (!data || dismissed || data.tier === 'admin') return null

  // The most-full finite bucket at 80%+.
  const hot = data.buckets
    .filter(b => b.limit && b.limit > 0)
    .map(b => ({ ...b, ratio: b.used / (b.limit as number) }))
    .filter(b => b.ratio >= 0.8)
    .sort((a, b) => b.ratio - a.ratio)[0]
  if (!hot) return null

  const key = `mvp_usage_nudge_${hot.key}_${data.resetLabel || 'period'}`
  try { if (localStorage.getItem(key) === '1') return null } catch { /* private mode */ }

  const full = hot.used >= (hot.limit as number)
  const accent = full ? '#ff3b30' : '#ff9500'

  function close() {
    try { localStorage.setItem(key, '1') } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div
      className="flex items-center gap-2.5 border-b px-6 py-2 text-[12px]"
      style={{ borderColor: 'var(--border)', backgroundColor: `${accent}12` }}
    >
      <AlertTriangle size={14} style={{ color: accent }} className="flex-shrink-0" />
      <span style={{ color: 'var(--text)' }}>
        {full
          ? <>You’ve used all <b>{hot.limit}</b> {hot.label.toLowerCase()} this period{data.resetLabel ? ` (resets ${data.resetLabel})` : ''}.</>
          : <>You’re at <b>{hot.used}/{hot.limit}</b> {hot.label.toLowerCase()} this period. You’ll run out soon.</>}
      </span>
      <Link
        href="/pricing"
        onClick={close}
        className="ml-auto flex-shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white"
        style={{ background: accent }}
      >
        Upgrade <ArrowRight size={12} />
      </Link>
      <button onClick={close} aria-label="Dismiss" className="flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
        <X size={14} />
      </button>
    </div>
  )
}
