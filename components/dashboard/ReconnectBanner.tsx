'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, X, ArrowRight } from 'lucide-react'

/**
 * Dashboard "reconnect needed" banner — the LOUD surface for a dead connection.
 *
 * The topbar pill (SocialHealthTopbarButton) is easy to miss; a creator whose
 * Facebook or YouTube token silently died can sit disconnected for weeks and
 * churn before noticing. This puts it front-and-centre on the dashboard, with a
 * one-click Reconnect to the right page per platform.
 *
 * Reads the same GET /api/social/health (reactive failures + proactive FB/YT
 * token probe). Dismissal is keyed by the exact set of dead platforms, so fixing
 * one (or a new one dying) re-shows it rather than staying hidden.
 */

interface DeadChannel {
  platform: string
  label: string
  message: string
  href?: string
}

const STORAGE_KEY = 'mvp_reconnect_seen'

export default function ReconnectBanner() {
  const [dead, setDead] = useState<DeadChannel[]>([])
  const [dismissed, setDismissed] = useState(true) // start hidden — never flash

  useEffect(() => {
    let cancelled = false
    fetch('/api/social/health')
      .then(r => r.json())
      .then(d => {
        if (cancelled || !Array.isArray(d.dead) || d.dead.length === 0) return
        setDead(d.dead)
        const key = d.dead.map((x: DeadChannel) => x.platform).sort().join(',')
        try { setDismissed(localStorage.getItem(STORAGE_KEY) === key) } catch { setDismissed(false) }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (dismissed || dead.length === 0) return null

  const key = dead.map(d => d.platform).sort().join(',')
  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, key) } catch { /* ignore */ }
    setDismissed(true)
  }

  const headline = dead.length === 1
    ? `${dead[0].label} needs reconnecting`
    : `${dead.length} connections need reconnecting`

  return (
    <div
      className="card mb-6 p-4 relative"
      style={{
        background: 'linear-gradient(180deg, rgba(255, 59, 48, 0.09) 0%, rgba(255, 59, 48, 0.02) 100%)',
        borderColor: 'rgba(255, 59, 48, 0.35)',
      }}
    >
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#ff3b30]/10">
          <AlertTriangle size={16} className="text-[#ff3b30]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">{headline}</p>
          <div className="flex flex-col gap-2">
            {dead.map(d => (
              <div key={d.platform} className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed flex-1">
                  <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{d.label}:</span> {d.message}
                </p>
                <Link
                  href={d.href || '/connect-socials'}
                  className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-[#ff3b30] hover:opacity-90 transition-opacity flex-shrink-0 self-start"
                >
                  Reconnect {d.label} <ArrowRight size={11} />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
