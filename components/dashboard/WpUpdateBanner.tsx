'use client'

import { useEffect, useState } from 'react'
import { Loader2, ArrowUpCircle, CheckCircle, AlertCircle } from 'lucide-react'

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
  error?: string
  theme?: { installed: string | null; latest: string; updateAvailable: boolean }
  plugin?: { installed: string | null; latest: string; updateAvailable: boolean }
}

export default function WpUpdateBanner() {
  const [status, setStatus] = useState<Status | null>(null)
  const [updating, setUpdating] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  async function runUpdate() {
    setUpdating(true)
    setError(null)
    try {
      const res = await fetch('/api/wordpress/self-update', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) throw new Error(data.error || 'Plugin too old for one-click update')
      if (!res.ok && !data.results) throw new Error(data.error || 'Update failed')
      // Partial (207) — surface which target failed
      if (data.results) {
        const t = data.results.theme, p = data.results.plugin
        const fails: string[] = []
        if (t && t.ok === false) fails.push(`theme: ${t.error}`)
        if (p && p.ok === false) fails.push(`plugin: ${p.error}`)
        if (fails.length) throw new Error(fails.join(' · '))
      }
      setDone(true)
      // Re-check so the banner disappears once versions match.
      setTimeout(loadStatus, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setUpdating(false)
    }
  }

  if (!status || !status.connected) return null

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
              <a href="/setup" className="text-[#0071e3] hover:underline">Setup</a> (and the theme),
              and from then on every update is a single button here — no wp-admin, ever again.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const themeUpd = status.theme?.updateAvailable
  const pluginUpd = status.plugin?.updateAvailable
  if (!themeUpd && !pluginUpd && !done) return null

  if (done) {
    return (
      <div className="card mb-6 p-4 border border-[#34c759]/30 bg-[#34c759]/5">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
          <CheckCircle size={15} className="text-[#34c759]" /> Your site is up to date.
        </p>
      </div>
    )
  }

  const parts: string[] = []
  if (themeUpd) parts.push(`theme ${status.theme!.installed} → ${status.theme!.latest}`)
  if (pluginUpd) parts.push(`plugin ${status.plugin!.installed} → ${status.plugin!.latest}`)

  return (
    <div className="card mb-6 p-5 border border-[#0071e3]/30 bg-[#0071e3]/5">
      <div className="flex items-start gap-3">
        <ArrowUpCircle size={18} className="text-[#0071e3] mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Site update available</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mb-3">
            A newer version of your MVP Affiliate site software is ready ({parts.join(' · ')}).
            One click — applies on your site in ~30 seconds, no wp-admin needed.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={runUpdate}
              disabled={updating}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-60 transition-colors"
            >
              {updating
                ? <><Loader2 size={11} className="animate-spin" /> Updating…</>
                : <><ArrowUpCircle size={11} /> Update now</>}
            </button>
            {error && (
              <span className="text-[11px] text-[#ff3b30] flex items-center gap-1 max-w-[420px]">
                <AlertCircle size={11} className="flex-shrink-0" /> {error}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
