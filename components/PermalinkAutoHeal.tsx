// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Silent, self-healing guard against stale post URLs. If a creator changes
// their WordPress permalink structure, every URL MVP stored for older posts
// starts 404ing ("View post" dead, GSC "Not found" pile). This fires the
// permalink re-sync in the background once a day: it re-fetches each post's
// CURRENT WordPress link, updates the stored URL, AND 301-redirects the old URL
// to the new one (via the plugin), so links heal without anyone clicking.
'use client'

import { useEffect } from 'react'

const KEY = 'mvp:permalinkHeal'
const DAY = 24 * 60 * 60 * 1000

export default function PermalinkAutoHeal() {
  useEffect(() => {
    try {
      const last = Number(localStorage.getItem(KEY) || 0)
      if (Date.now() - last < DAY) return
      // Stamp first so multiple tabs / a quick re-render don't double-fire.
      localStorage.setItem(KEY, String(Date.now()))
    } catch { return }
    // Fire-and-forget. resync-permalinks only writes when a URL actually
    // changed, so a no-drift run is cheap and silent.
    fetch('/api/blog/resync-permalinks', { method: 'POST' }).catch(() => {})
  }, [])
  return null
}
