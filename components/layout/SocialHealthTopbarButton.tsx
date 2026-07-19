'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, X, ArrowRight } from 'lucide-react'

/**
 * GLOBAL "reconnect your channel" alert in the dashboard top bar.
 *
 * A social connection can die quietly — an expired X token, a platform still in
 * the publishing schedule that was never connected — and then EVERY scheduled
 * post to it fails, every day, with nobody noticing. (One account produced 39
 * of 43 weekly failures that way.) The cron now auto-pauses those channels; this
 * is the other half: telling the creator so they can actually fix it.
 *
 * Renders nothing when every channel is healthy, so it never clutters the bar.
 * Dismiss hides it for the session (it returns on next load until reconnected).
 */

interface DeadChannel {
  platform: string
  label: string
  consecutiveFailures: number
  reason: 'not_connected' | 'expired' | 'failing'
  message: string
}

export default function SocialHealthTopbarButton() {
  const [dead, setDead] = useState<DeadChannel[]>([])
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/social/health')
      .then(r => r.json())
      .then(d => { if (!cancelled && Array.isArray(d.dead)) setDead(d.dead) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (dismissed || dead.length === 0) return null

  const headline = dead.length === 1
    ? `${dead[0].label} needs reconnecting`
    : `${dead.length} connections need attention`

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-[#ff9500] to-[#ff3b30] hover:opacity-90 transition-opacity"
        title={headline}
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
        </span>
        <AlertTriangle size={12} />
        <span className="hidden sm:inline">{headline}</span>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-[320px] rounded-xl border bg-white dark:bg-[#1c1c1e] shadow-xl z-50 p-3"
          style={{ borderColor: 'var(--border, #e5e5e7)' }}
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              Some posts didn&apos;t go out
            </p>
            <button
              onClick={() => { setOpen(false); setDismissed(true) }}
              className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] flex-shrink-0"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex flex-col gap-2.5 mb-3">
            {dead.map(d => (
              <div key={d.platform} className="text-[11px] leading-relaxed">
                <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{d.label}</span>
                <span className="text-[#86868b] dark:text-[#8e8e93]"> · {d.consecutiveFailures} failed in a row</span>
                <p className="text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">{d.message}</p>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mb-2.5">
            We&apos;ve paused repeat attempts on these so they stop failing. They resume automatically once reconnected.
          </p>

          <Link
            href="/connect-socials"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1.5 w-full text-xs font-semibold text-white px-3 py-2 rounded-lg bg-[#7C3AED] hover:opacity-90 transition-opacity"
          >
            Reconnect <ArrowRight size={12} />
          </Link>
        </div>
      )}
    </div>
  )
}
