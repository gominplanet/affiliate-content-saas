'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, ArrowUpCircle, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Compact site-version pill that lives in the dashboard hero, next to the
 * "Welcome back, …" name.
 *   - update available → a LOUD amber "Update available — install now" button
 *     (pulsing dot, version delta line) so it's impossible to miss, PLUS a
 *     one-time-per-version toast on load so a freshly-pushed update always
 *     announces itself even if the user isn't looking at the hero.
 *   - up to date       → a quiet green "Up to date" badge
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
  const toastedFor = useRef<string | null>(null)

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
      toast.success('Your site is up to date', { description: 'The latest theme + plugin are now live.' })
      setTimeout(loadStatus, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setUpdating(false)
    }
  }

  // Is there an actionable update right now? Computed before any early return so
  // the toast effect can depend on it (hooks must run unconditionally).
  const live = status && status.connected && !status.authFailed && !status.needsManualUpdate
  const updateAvailable = !!live && (!!status?.theme?.updateAvailable || !!status?.plugin?.updateAvailable) && !done
  const versionKey = `${status?.theme?.latest ?? ''}|${status?.plugin?.latest ?? ''}`

  // One-time-per-version attention toast — fires when a NEW version is detected,
  // so users always know an update was pushed. Re-fires only when the latest
  // version changes (tracked in localStorage), not on every page load.
  useEffect(() => {
    if (!updateAvailable) return
    if (toastedFor.current === versionKey) return
    toastedFor.current = versionKey
    let seen: string | null = null
    try { seen = localStorage.getItem('mvp_seen_update_version') } catch { /* private mode */ }
    if (seen === versionKey) return
    try { localStorage.setItem('mvp_seen_update_version', versionKey) } catch { /* ignore */ }
    toast('🚀 A new update is ready for your site', {
      description: 'One click applies the latest theme + plugin in about 30 seconds — no wp-admin needed.',
      duration: 12000,
      action: { label: 'Update now', onClick: () => { void runUpdate() } },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateAvailable, versionKey])

  // No status yet, no site, or an error banner owns the message → render nothing.
  if (!status || !status.connected || status.authFailed || status.needsManualUpdate) return null

  if (updateAvailable) {
    const parts: string[] = []
    if (status.theme?.updateAvailable) parts.push(`theme ${status.theme.installed} → ${status.theme.latest}`)
    if (status.plugin?.updateAvailable) parts.push(`plugin ${status.plugin.installed} → ${status.plugin.latest}`)
    return (
      <div className="flex flex-col items-start gap-1.5">
        <button
          onClick={runUpdate}
          disabled={updating}
          title={`A newer version of your site software is ready (${parts.join(' · ')}). Applies in ~30s — no wp-admin.`}
          className="group inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #FF9F0A 0%, #FF6B00 100%)', boxShadow: '0 4px 16px rgba(255,107,0,0.38)' }}
        >
          {updating
            ? <><Loader2 size={14} className="animate-spin" /> Updating your site…</>
            : <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70"></span>
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white"></span>
                </span>
                <ArrowUpCircle size={15} /> Update available — install now
              </>}
        </button>
        <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{parts.join(' · ')}</span>
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
