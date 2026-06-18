'use client'

import { useEffect, useState } from 'react'
import { Loader2, ArrowUpCircle, CheckCircle } from 'lucide-react'

/**
 * Compact site-version pill that lives in the dashboard hero, next to the
 * "Welcome back, …" name. It's the at-a-glance status the user wanted up top:
 *   - update available → a purple "Update now" button (runs the WP self-update
 *     in place, no wp-admin trip)
 *   - up to date       → a green "Up to date" badge
 *
 * The loud, explanatory states (WordPress auth failed / legacy plugin needs a
 * one-time manual update) stay in <WpUpdateBanner /> below — those are rare and
 * need more than a pill. This pill renders nothing until status loads, and
 * nothing at all when no WordPress site is connected or an error banner owns it.
 */

interface Status {
  connected: boolean
  needsManualUpdate?: boolean
  authFailed?: boolean
  theme?: { installed: string | null; latest: string; updateAvailable: boolean }
  plugin?: { installed: string | null; latest: string; updateAvailable: boolean }
}

export default function WpUpdatePill() {
  const [status, setStatus] = useState<Status | null>(null)
  const [updating, setUpdating] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadStatus() {
    try {
      const res = await fetch('/api/wordpress/wp-status')
      setStatus((await res.json().catch(() => ({}))) as Status)
    } catch {
      setStatus(null)
    }
  }

  useEffect(() => { loadStatus() }, [])

  async function runUpdate() {
    setUpdating(true); setError(null)
    try {
      const res = await fetch('/api/wordpress/self-update', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) throw new Error(data.error || 'Plugin too old for one-click update')
      if (!res.ok && !data.results) throw new Error(data.error || 'Update failed')
      if (data.results) {
        const fails: string[] = []
        if (data.results.theme?.ok === false) fails.push(`theme: ${data.results.theme.error}`)
        if (data.results.plugin?.ok === false) fails.push(`plugin: ${data.results.plugin.error}`)
        if (fails.length) throw new Error(fails.join(' · '))
      }
      setDone(true)
      setTimeout(loadStatus, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setUpdating(false)
    }
  }

  // No status yet, no site, or an error banner owns the message → render nothing.
  if (!status || !status.connected || status.authFailed || status.needsManualUpdate) return null

  const updateAvailable = (status.theme?.updateAvailable || status.plugin?.updateAvailable) && !done

  if (updateAvailable) {
    const parts: string[] = []
    if (status.theme?.updateAvailable) parts.push(`theme ${status.theme.installed} → ${status.theme.latest}`)
    if (status.plugin?.updateAvailable) parts.push(`plugin ${status.plugin.installed} → ${status.plugin.latest}`)
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          onClick={runUpdate}
          disabled={updating}
          title={`A newer version of your site software is ready (${parts.join(' · ')}). Applies in ~30s — no wp-admin.`}
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-white transition-colors disabled:opacity-60"
          style={{ background: '#7C3AED' }}
        >
          {updating
            ? <><Loader2 size={13} className="animate-spin" /> Updating…</>
            : <><ArrowUpCircle size={13} /> Update now</>}
        </button>
        {error && <span className="text-[11px] max-w-[320px]" style={{ color: '#ff6b6b' }}>{error}</span>}
      </div>
    )
  }

  // Connected + current (or just finished updating) → quiet "Up to date" badge.
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold"
      style={{ background: 'rgba(52,199,89,0.12)', color: '#34c759', border: '1px solid rgba(52,199,89,0.30)' }}
    >
      <CheckCircle size={13} /> Up to date
    </span>
  )
}
