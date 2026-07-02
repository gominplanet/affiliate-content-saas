'use client'

import { useEffect, useState } from 'react'
import { Download, ArrowUpCircle } from 'lucide-react'
import { getScoutInstallKind } from '@/lib/extension-frame'
import { SCOUT_STORE_LISTING_URL } from '@/lib/scout-version'

/**
 * Global SCOUT prompt in the dashboard top bar, beside the WordPress
 * theme-update button. SCOUT now lives on the Chrome Web Store and auto-updates,
 * so we never nag a store install to "update" (nothing for the user to do). We
 * only surface the two states that need a human:
 *   - not installed → a subtle "Get SCOUT" (one-click store install)
 *   - sideloaded    → a purple "Move SCOUT to the Web Store" (the old manually
 *                     loaded build never auto-updates; reinstalling hands updates
 *                     back to Chrome for good)
 *   - store install → nothing (installed + auto-updating = no clutter)
 * Pings via getScoutInstallKind(); renders nothing until that resolves.
 */
export default function ScoutTopbarButton() {
  const [status, setStatus] = useState<{ kind: 'store' | 'sideload' | 'none'; version: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    getScoutInstallKind().then(s => { if (!cancelled) setStatus(s) }).catch(() => { if (!cancelled) setStatus({ kind: 'none', version: null }) })
    return () => { cancelled = true }
  }, [])

  if (!status) return null
  // Store install → auto-updating, nothing to prompt.
  if (status.kind === 'store') return null

  const sideloaded = status.kind === 'sideload'
  const label = sideloaded ? 'Move SCOUT to the Web Store' : 'Get SCOUT'
  return (
    <a
      href={SCOUT_STORE_LISTING_URL}
      target="_blank"
      rel="noopener noreferrer"
      title={sideloaded
        ? "You're on the older manually-installed SCOUT, which Chrome can't auto-update. Reinstall from the Chrome Web Store once and Chrome keeps it current from then on (remove the old load-unpacked copy after)."
        : 'Install the SCOUT browser extension from the Chrome Web Store — one click, auto-updating. Amazon Creator Connections scout, Co-Pilot frame capture, and the Amazon video finder for brand recaps.'}
      className="px-3 py-2 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5 transition-transform hover:-translate-y-0.5"
      style={sideloaded
        ? { color: '#fff', background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)', boxShadow: '0 2px 10px rgba(124,58,237,0.35)' }
        : { color: 'var(--text-soft)', background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      {sideloaded ? <ArrowUpCircle size={13} /> : <Download size={13} />} {label}
    </a>
  )
}
