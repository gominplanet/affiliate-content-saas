'use client'

import { useEffect } from 'react'

/**
 * Fires a throttled /api/heartbeat so the admin Users list shows REAL last-seen
 * activity (not auth.users.last_sign_in_at, which only moves on an explicit
 * sign-in). Client throttle via localStorage: at most once per 10 min per
 * browser; the server also throttles to 5 min. Fire-and-forget, never blocks.
 */
const KEY = 'mvp_last_heartbeat'
const CLIENT_THROTTLE_MS = 10 * 60 * 1000

export default function LastSeenHeartbeat() {
  useEffect(() => {
    const ping = () => {
      let last = 0
      try { last = Number(localStorage.getItem(KEY) || 0) } catch { /* private mode */ }
      if (Date.now() - last < CLIENT_THROTTLE_MS) return
      try { localStorage.setItem(KEY, String(Date.now())) } catch { /* ignore */ }
      fetch('/api/heartbeat', { method: 'POST', keepalive: true }).catch(() => { /* fire-and-forget */ })
    }
    ping() // on mount
    // Re-ping when the tab regains focus (covers long-lived sessions).
    const onVisible = () => { if (document.visibilityState === 'visible') ping() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
  return null
}
