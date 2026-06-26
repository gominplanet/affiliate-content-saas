'use client'

import { useEffect, useState } from 'react'
import { Download, ArrowUpCircle } from 'lucide-react'
import { getScoutStatus } from '@/lib/extension-frame'
import { SCOUT_LATEST_VERSION, SCOUT_DOWNLOAD_URL, isScoutOutdated } from '@/lib/scout-version'

/**
 * Global "Get / Update SCOUT" download in the dashboard top bar, beside the
 * WordPress theme-update button. SCOUT is a load-unpacked extension (no Web
 * Store auto-update), so the only way to ship a new build is to make the latest
 * zip reachable. Shows:
 *   - not installed → a subtle "Get SCOUT" download
 *   - installed but behind → a loud purple "Update SCOUT vX" download
 *   - installed + current → nothing (no clutter)
 * Pings the extension via getScoutStatus(); renders nothing until that resolves.
 */
export default function ScoutTopbarButton() {
  const [status, setStatus] = useState<{ installed: boolean; version: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    getScoutStatus().then(s => { if (!cancelled) setStatus(s) }).catch(() => { if (!cancelled) setStatus({ installed: false, version: null }) })
    return () => { cancelled = true }
  }, [])

  if (!status) return null
  const outdated = status.installed && isScoutOutdated(status.version)
  // Only surface when there's something to do.
  if (status.installed && !outdated) return null

  const label = outdated ? `Update SCOUT v${SCOUT_LATEST_VERSION}` : 'Get SCOUT'
  return (
    <a
      href={SCOUT_DOWNLOAD_URL}
      download
      title={outdated
        ? `A newer SCOUT (v${SCOUT_LATEST_VERSION}) is ready — download, unzip over your SCOUT folder, then reload it at chrome://extensions.`
        : 'Download the SCOUT browser extension — Amazon Creator Connections scout, Co-Pilot frame capture, and the Amazon video finder for brand recaps.'}
      className="px-3 py-2 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5 transition-transform hover:-translate-y-0.5"
      style={outdated
        ? { color: '#fff', background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)', boxShadow: '0 2px 10px rgba(124,58,237,0.35)' }
        : { color: 'var(--text-soft)', background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      {outdated ? <ArrowUpCircle size={13} /> : <Download size={13} />} {label}
    </a>
  )
}
