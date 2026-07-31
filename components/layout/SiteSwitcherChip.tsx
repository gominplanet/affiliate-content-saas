'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SiteSwitcherChip — the topbar site chip, upgraded into a real switcher for
// Pro users who have connected 2+ WordPress sites.
//
//   · 0–1 sites  → renders exactly the old chip: a plain link to /setup (single
//     -site users have nothing to switch, so no menu).
//   · 2+  sites  → a dropdown listing every connected site. Picking one sets it
//     as the DEFAULT site (PATCH makeDefault) and reloads, because the default
//     site is the single resolution path the whole app reads (getDefaultSite):
//     switching it re-targets the topbar hostname, the WP-admin/Visit-blog
//     shortcuts, publishing, Geniuslink grouping, everything. A client-only
//     "selected site" would only reach the few routes that accept a siteId.
//
// Matches the old chip's styling exactly so single-site users see no change.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Check, Loader2, Settings2 } from 'lucide-react'

interface Site { id: string; label: string; url: string; isDefault: boolean }

const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/+$/, '')

export default function SiteSwitcherChip({ currentHostname }: { currentHostname: string | null }) {
  const [sites, setSites] = useState<Site[] | null>(null)
  const [open, setOpen] = useState(false)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Load (and reload) the site list. The topbar mounts once and persists across
  // client-side navigation, so a site added on /setup wouldn't show up without
  // this: we re-fetch whenever the tab regains focus / becomes visible, so the
  // switcher self-heals after you connect a blog without a hard reload.
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/wordpress/sites', { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      const d = (await r.json()) as { sites?: Site[] }
      setSites(Array.isArray(d?.sites) ? d.sites : [])
    } catch {
      setSites(prev => prev ?? [])
    }
  }, [])

  useEffect(() => {
    load()
    const onFocus = () => load()
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  // Close the menu on any outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const pick = useCallback(async (site: Site) => {
    if (site.isDefault) { setOpen(false); return }
    setSwitchingId(site.id)
    try {
      // Full switch: sets the default AND mirrors the site into the legacy
      // integrations columns, so the whole app (not just siteId-aware routes)
      // targets the chosen blog.
      const r = await fetch('/api/wordpress/active-site', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id }),
      })
      if (!r.ok) throw new Error(String(r.status))
      // Reload so every server-rendered, default-site-derived surface (the chip,
      // the WP shortcuts, the sidebar blog links) re-renders on the new site.
      window.location.reload()
    } catch {
      setSwitchingId(null)
      setOpen(false)
    }
  }, [])

  const chipStyle = {
    backgroundColor: 'var(--surface)',
    borderColor: 'var(--border)',
    color: 'var(--text)',
  } as const
  const chipClass = 'flex items-center gap-2 px-3 py-2 rounded-lg border text-[13px] font-medium transition-colors'

  // Single-site (or still loading, or none): keep the exact old behavior — a
  // link to /setup. No switcher UI for users with nothing to switch.
  if (!sites || sites.length < 2) {
    return (
      <Link
        href="/setup"
        className={chipClass}
        style={chipStyle}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface)')}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
        {currentHostname || 'No WordPress yet'}
        <ChevronDown size={12} style={{ color: 'var(--text-faint)' }} />
      </Link>
    )
  }

  const current = sites.find(s => s.isDefault) || sites[0]
  const currentLabel = current ? hostOf(current.url) : (currentHostname || 'Select a blog')

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={chipClass}
        style={chipStyle}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface)')}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch blog"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
        <span className="truncate max-w-[180px]">{currentLabel}</span>
        <ChevronDown size={12} style={{ color: 'var(--text-faint)' }} />
      </button>

      {open && (
        <div
          // Explicit SOLID background: --surface is translucent in dark mode,
          // which let the page bleed through the menu. Force an opaque surface.
          className="absolute left-0 top-full mt-1.5 z-50 min-w-[240px] rounded-xl border shadow-xl overflow-hidden bg-white dark:bg-[#16161a]"
          style={{ borderColor: 'var(--border)' }}
          role="listbox"
        >
          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
            Your blogs
          </div>
          {sites.map(s => {
            const active = s.isDefault
            const busy = switchingId === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => pick(s)}
                disabled={!!switchingId}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors disabled:opacity-60"
                style={{ color: 'var(--text)' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                role="option"
                aria-selected={active}
              >
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: active ? '#7C3AED' : 'var(--border)' }} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium truncate">{s.label || hostOf(s.url)}</span>
                  <span className="block text-[11px] truncate" style={{ color: 'var(--text-faint)' }}>{hostOf(s.url)}</span>
                </span>
                {busy ? <Loader2 size={14} className="animate-spin flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
                  : active ? <Check size={14} className="flex-shrink-0" style={{ color: '#7C3AED' }} /> : null}
              </button>
            )
          })}
          <Link
            href="/setup"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2.5 text-[12px] font-medium border-t transition-colors"
            style={{ color: 'var(--text-soft)', borderColor: 'var(--border)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <Settings2 size={13} /> Manage sites
          </Link>
        </div>
      )}
    </div>
  )
}
