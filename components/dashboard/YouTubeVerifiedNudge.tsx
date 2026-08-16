'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Youtube, X, ArrowRight, ShieldCheck } from 'lucide-react'

/**
 * One-time nudge for users who connected YouTube BEFORE the app was verified by
 * Google. Their old token still works, but a fresh reconnect now gives the
 * verified, durable connection (no more "Google hasn't verified this app"
 * screen, no scope-resurrection). Informational + positive, NOT an alarm —
 * distinct from the red ReconnectBanner, which only fires for genuinely dead
 * connections.
 *
 * Only shown to users who actually have YouTube connected (`show`), and only
 * once — dismissal is stored per-id in localStorage. Bump NUDGE_ID to re-show.
 */

const NUDGE_ID = 'yt-verified-2026-08'
const STORAGE_KEY = 'mvp_yt_verified_nudge'

export default function YouTubeVerifiedNudge({ show }: { show: boolean }) {
  const [dismissed, setDismissed] = useState(true) // start hidden, never flash

  useEffect(() => {
    if (!show) return
    try { setDismissed(localStorage.getItem(STORAGE_KEY) === NUDGE_ID) } catch { setDismissed(false) }
  }, [show])

  if (!show || dismissed) return null

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, NUDGE_ID) } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div
      className="card mb-6 p-4 relative"
      style={{
        background: 'linear-gradient(135deg, rgba(124,58,237,0.06) 0%, rgba(52,199,89,0.06) 100%)',
        borderColor: 'rgba(124,58,237,0.25)',
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
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#7C3AED]/10">
          <Youtube size={16} className="text-[#7C3AED]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1 flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-[#34c759]" /> MVP is now verified by Google
          </p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mb-3">
            Your YouTube connection still works, but a quick one-time reconnect gives you the new verified connection: no more &ldquo;unverified app&rdquo; warning, and a permanent link that won&apos;t quietly drop. Takes about 20 seconds.
          </p>
          <div className="flex items-center gap-3">
            <Link
              href="/connect-youtube"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-[#7C3AED] hover:opacity-90 transition-opacity"
            >
              Reconnect YouTube <ArrowRight size={11} />
            </Link>
            <button
              onClick={dismiss}
              className="text-xs font-medium text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors"
            >
              Later
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
