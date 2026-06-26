'use client'

import { useEffect, useState } from 'react'
import { Download, ArrowUpCircle, CheckCircle, Loader2 } from 'lucide-react'
import { getScoutStatus } from '@/lib/extension-frame'
import { SCOUT_LATEST_VERSION, SCOUT_DOWNLOAD_URL, SCOUT_WHATS_NEW, isScoutOutdated } from '@/lib/scout-version'

/**
 * SCOUT extension status pill for the dashboard hero — sits beside the
 * "Theme & Plugin" pill. SCOUT is a load-unpacked extension (no Web Store
 * auto-update), so we ping the installed copy and surface its state:
 *   - checking        → a brief "Checking SCOUT…" badge (the ping resolves fast)
 *   - not installed   → orange "Get SCOUT extension" download
 *   - installed/behind → LOUD orange "Update SCOUT vX" download (unzip + reload)
 *   - installed/current → a bright orange "Scout Extension up to date" badge
 *
 * Bright SCOUT-orange throughout so it reads as a distinct pill next to the
 * green "Theme & Plugin" pill and the purple "Tutorials" pill.
 *
 * Note: the ping needs NEXT_PUBLIC_SCOUT_EXTENSION_ID set (same dependency as
 * the top-bar SCOUT button). Without it the pill reads "not installed".
 */
export default function ScoutUpdatePill() {
  const [status, setStatus] = useState<{ installed: boolean; version: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    getScoutStatus()
      .then(s => { if (!cancelled) setStatus(s) })
      .catch(() => { if (!cancelled) setStatus({ installed: false, version: null }) })
    return () => { cancelled = true }
  }, [])

  // Still pinging the extension.
  if (!status) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold"
        style={{ background: 'rgba(255,149,0,0.10)', color: '#FF9500', border: '1px solid rgba(255,149,0,0.25)' }}
      >
        <Loader2 size={12} className="animate-spin" /> Checking SCOUT…
      </span>
    )
  }

  const outdated = status.installed && isScoutOutdated(status.version)

  // Not installed → download prompt.
  if (!status.installed) {
    return (
      <a
        href={SCOUT_DOWNLOAD_URL}
        download
        title="Download the SCOUT browser extension — grabs real video frames for thumbnails, reads Amazon product data when our server is blocked, and finds your Amazon videos for brand recaps."
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white transition-transform hover:-translate-y-0.5"
        style={{ background: 'linear-gradient(135deg, #FF9F0A 0%, #FF6B00 100%)', boxShadow: '0 3px 12px rgba(255,107,0,0.35)' }}
      >
        <Download size={13} /> Get SCOUT extension
      </a>
    )
  }

  // Installed but behind → loud update.
  if (outdated) {
    return (
      <a
        href={SCOUT_DOWNLOAD_URL}
        download
        title={`A newer SCOUT (v${SCOUT_LATEST_VERSION}) is ready. ${SCOUT_WHATS_NEW} Download, unzip over your SCOUT folder, then reload it at chrome://extensions.`}
        className="group inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white transition-transform hover:-translate-y-0.5"
        style={{ background: 'linear-gradient(135deg, #FF9F0A 0%, #FF6B00 100%)', boxShadow: '0 4px 16px rgba(255,107,0,0.38)' }}
      >
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70"></span>
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white"></span>
        </span>
        <ArrowUpCircle size={15} /> Update SCOUT to v{SCOUT_LATEST_VERSION}
      </a>
    )
  }

  // Installed + current → bright SCOUT-orange "up to date" badge.
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold"
      style={{ background: 'rgba(255,149,0,0.14)', color: '#FF9500', border: '1px solid rgba(255,149,0,0.34)' }}
    >
      <CheckCircle size={13} /> Scout Extension up to date
    </span>
  )
}
