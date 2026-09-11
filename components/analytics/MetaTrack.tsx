// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Fires ONE Meta standard event on mount. Drop it into a page (including a
// server component's JSX) to mark that page as a conversion point. `onceKey`
// guards against re-firing on repeat visits (persisted per browser) — use it for
// once-per-user events like CompleteRegistration.
'use client'

import { useEffect } from 'react'
import { trackMeta } from '@/lib/meta-pixel'

export default function MetaTrack({ event, params, onceKey, eventId }: {
  event: string
  params?: Record<string, unknown>
  onceKey?: string
  /**
   * Dedup key shared with the same event sent server-side through the
   * Conversions API (lib/meta-capi.ts). Without it the two halves are counted
   * as two conversions; with it Meta collapses them into one. Pass it whenever
   * the server also reports this event.
   */
  eventId?: string
}) {
  useEffect(() => {
    try {
      if (onceKey) {
        const k = `mvp_fb_${onceKey}`
        if (window.localStorage.getItem(k)) return
        window.localStorage.setItem(k, '1')
      }
    } catch { /* storage blocked → still fire */ }
    trackMeta(event, params, eventId)
    // Fire exactly once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}
