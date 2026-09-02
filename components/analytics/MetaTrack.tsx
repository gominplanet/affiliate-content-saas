// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Fires ONE Meta standard event on mount. Drop it into a page (including a
// server component's JSX) to mark that page as a conversion point. `onceKey`
// guards against re-firing on repeat visits (persisted per browser) — use it for
// once-per-user events like CompleteRegistration.
'use client'

import { useEffect } from 'react'
import { trackMeta } from '@/lib/meta-pixel'

export default function MetaTrack({ event, params, onceKey }: {
  event: string
  params?: Record<string, unknown>
  onceKey?: string
}) {
  useEffect(() => {
    try {
      if (onceKey) {
        const k = `mvp_fb_${onceKey}`
        if (window.localStorage.getItem(k)) return
        window.localStorage.setItem(k, '1')
      }
    } catch { /* storage blocked → still fire */ }
    trackMeta(event, params)
    // Fire exactly once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}
