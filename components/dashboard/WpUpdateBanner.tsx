'use client'

import { useEffect, useState } from 'react'
import { ArrowUpCircle, AlertCircle } from 'lucide-react'

/**
 * Dashboard banner that surfaces a one-click "Update now" when the user's
 * WordPress theme/plugin is behind the latest published version. Polls
 * /api/wordpress/wp-status on mount; on click hits /api/wordpress/self-update
 * which runs the WP-side upgrader. No wp-admin trip.
 *
 * States:
 *  - loading / not-connected / up-to-date → render nothing (silent)
 *  - needsManualUpdate → old plugin with no self-update endpoint; tell them
 *    to do one manual update (the last one ever)
 *  - updateAvailable → the green "Update now" banner
 */

interface Status {
  connected: boolean
  needsManualUpdate?: boolean
  authFailed?: boolean
  error?: string
  theme?: { installed: string | null; latest: string; updateAvailable: boolean }
  plugin?: { installed: string | null; latest: string; updateAvailable: boolean }
}

export default function WpUpdateBanner() {
  const [status, setStatus] = useState<Status | null>(null)

  async function loadStatus() {
    try {
      const res = await fetch('/api/wordpress/wp-status')
      const data = await res.json().catch(() => ({}))
      setStatus(data as Status)
    } catch {
      setStatus(null)
    }
  }

  useEffect(() => { loadStatus() }, [])

  if (!status || !status.connected) return null

  // Application Password rejected (401/403) — brand syncs, customizations, and
  // publishing all fail silently until the user reconnects. Loud RED banner.
  if (status.authFailed) {
    return (
      <div className="card mb-6 p-5 border-2 border-[#ff3b30]/40 bg-[#ff3b30]/5">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="text-[#ff3b30] mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[#ff3b30] mb-1">WordPress connection needs reconnecting</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mb-3">
              Your site rejected the saved Application Password — until you reconnect, your logo, brand details,
              and new posts won&apos;t reach your blog. This happens when your WordPress password changed, the app
              password was revoked, or the site was migrated.
            </p>
            <a
              href="/setup?tab=integrations"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-[#ff3b30] hover:bg-[#e0352b] transition-colors"
            >
              <ArrowUpCircle size={11} /> Reconnect WordPress
            </a>
          </div>
        </div>
      </div>
    )
  }

  // Old plugin (pre-1.0.6) — no self-update endpoint. One manual update needed.
  if (status.needsManualUpdate) {
    return (
      <div className="card mb-6 p-4 border border-[#ff9500]/30 bg-[#ff9500]/5">
        <div className="flex items-start gap-3">
          <AlertCircle size={16} className="text-[#ff9500] mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">One last manual update</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
              Your installed plugin predates one-click updates. Reinstall it once from{' '}
              <a href="/setup" className="text-[#7C3AED] hover:underline">Setup</a> (and the theme),
              and from then on every update is a single button here — no wp-admin, ever again.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // The everyday "update available" / "up to date" states now live in the
  // compact <WpUpdatePill /> next to the dashboard welcome name. This banner is
  // only for the rare, loud states above (auth failed / legacy manual update).
  return null
}
