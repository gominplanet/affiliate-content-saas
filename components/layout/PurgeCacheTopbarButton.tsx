'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

/**
 * "Clear cache" shortcut in the dashboard top bar, sitting next to Visit Blog +
 * WP Admin. One click re-posts the site's current customizations, which triggers
 * litespeed_purge_all in the MVP plugin — so brand/theme changes that a caching
 * layer (LiteSpeed, SG Optimizer, Cloudflare) is still serving stale appear on
 * the live site immediately, without the user hunting for the host's purge
 * button. Targets the user's default site (the API resolves it server-side).
 *
 * Mount only when a WordPress site is connected (parent already gates on
 * wpSiteUrl) — no site → nothing to purge.
 */
export default function PurgeCacheTopbarButton() {
  const [busy, setBusy] = useState(false)

  async function purge() {
    if (busy) return
    setBusy(true)
    const t = toast.loading('Clearing your site cache…')
    try {
      const res = await fetch('/api/wordpress/purge-cache', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not clear the cache', { id: t })
      } else {
        toast.success('Cache cleared — your latest changes are live', { id: t })
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not clear the cache', { id: t })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={purge}
      disabled={busy}
      className="px-3 py-2 rounded-lg border text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-60"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        color: 'var(--text-soft)',
      }}
      onMouseEnter={(e) => { if (!busy) e.currentTarget.style.backgroundColor = 'var(--surface-hover)' }}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface)')}
      title="Clear your WordPress cache so brand/theme changes show up on the live site right away"
    >
      <RefreshCw size={11} className={busy ? 'animate-spin' : ''} /> {busy ? 'Clearing…' : 'Clear Cache'}
    </button>
  )
}
