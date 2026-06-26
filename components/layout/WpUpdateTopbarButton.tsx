'use client'

import { useEffect, useState } from 'react'
import { Loader2, ArrowUpCircle } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Compact, GLOBAL update alert that lives in the dashboard top bar (left of
 * "Visit Blog"), so a pending theme/plugin update is visible from EVERY MVP
 * page — not just the Dashboard hero where <WpUpdatePill> sits.
 *
 * Renders nothing unless there's an actionable one-click update, so it never
 * clutters the bar when the site is current. One click runs the same
 * /api/wordpress/self-update flow the pill uses (latest theme + plugin in
 * ~30s, no wp-admin). Loud amber→orange gradient + pulsing dot so it reads as
 * "do this now". Mount this only when a WordPress site is connected.
 */

interface Status {
  connected: boolean
  needsManualUpdate?: boolean
  authFailed?: boolean
  theme?: { installed: string | null; latest: string; updateAvailable: boolean }
  plugin?: { installed: string | null; latest: string; updateAvailable: boolean }
}

export default function WpUpdateTopbarButton() {
  const [status, setStatus] = useState<Status | null>(null)
  const [updating, setUpdating] = useState(false)
  const [hidden, setHidden] = useState(false)

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
    setUpdating(true)
    try {
      const res = await fetch('/api/wordpress/self-update', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) throw new Error(data.error || 'Plugin too old for one-click update — update once in wp-admin → Plugins.')
      if (!res.ok && !data.results) throw new Error(data.error || 'Update failed')
      if (data.results) {
        const fails: string[] = []
        if (data.results.theme?.ok === false) fails.push(`theme: ${data.results.theme.error}`)
        if (data.results.plugin?.ok === false) fails.push(`plugin: ${data.results.plugin.error}`)
        if (fails.length) throw new Error(fails.join(' · '))
      }
      toast.success('Your site is up to date', { description: 'The latest theme + plugin are now live.' })
      setHidden(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setUpdating(false)
    }
  }

  const live = status && status.connected && !status.authFailed && !status.needsManualUpdate
  const updateAvailable = !!live && (!!status?.theme?.updateAvailable || !!status?.plugin?.updateAvailable)
  if (hidden || !updateAvailable) return null

  const parts: string[] = []
  if (status?.theme?.updateAvailable) parts.push(`theme ${status.theme.installed} → ${status.theme.latest}`)
  if (status?.plugin?.updateAvailable) parts.push(`plugin ${status.plugin.installed} → ${status.plugin.latest}`)

  return (
    <button
      onClick={runUpdate}
      disabled={updating}
      title={`A newer version of your site is ready (${parts.join(' · ')}). One click applies it in ~30s — no wp-admin needed.`}
      className="px-3 py-2 rounded-lg text-[12px] font-semibold text-white inline-flex items-center gap-1.5 transition-transform hover:-translate-y-0.5 disabled:opacity-60"
      style={{ background: 'linear-gradient(135deg, #FF9F0A 0%, #FF6B00 100%)', boxShadow: '0 2px 10px rgba(255,107,0,0.35)' }}
    >
      {updating
        ? <><Loader2 size={12} className="animate-spin" /> Updating…</>
        : (
          <>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white"></span>
            </span>
            <ArrowUpCircle size={13} /> Update site
          </>
        )}
    </button>
  )
}
