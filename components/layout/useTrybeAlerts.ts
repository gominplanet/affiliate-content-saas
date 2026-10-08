'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The unread count on the TRYBE Outreach menu item (lib/trybe-alerts.ts).
//
// Two parts. The count itself is read from MVP every two minutes and on each
// page change, and follows the TRYBE page straight away through its event.
// And for a creator who uses the TRYBE inbox in this browser, the dashboard
// asks SCOUT for the inbox at most every half hour while a page is in view,
// so a reply shows without opening TRYBE Outreach. SCOUT reads it from a TRYBE
// tab behind this one, which it closes again after five quiet minutes.

import { useEffect, useState } from 'react'
import { requestTrybeAccess } from '@/lib/extension-frame'
import { scoutAtLeast, SCOUT_TRYBE_INBOX_MIN_VERSION } from '@/lib/scout-version'
import {
  reportTrybeInbox, TRYBE_ALERT_EVENT, TRYBE_INBOX_ON_KEY, TRYBE_LAST_CHECK_KEY, TRYBE_SHELL_CHECK_MS, type InboxSnapshot,
} from '@/lib/trybe-alerts'

export function useTrybeAlerts(enabled: boolean, pathname: string): number {
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!enabled) { setUnread(0); return }
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch('/api/labs/trybe/alerts', { signal: AbortSignal.timeout(20_000) })
        if (!r.ok || cancelled) return
        const d = await r.json()
        if (!cancelled) setUnread(Number(d?.unread) || 0)
      } catch { /* transient: the interval tries again */ }
    }
    void load()
    const t = setInterval(load, 120_000)
    const on = (e: Event) => { const d = (e as CustomEvent<InboxSnapshot>).detail; if (d && typeof d.unread === 'number') setUnread(d.unread) }
    window.addEventListener(TRYBE_ALERT_EVENT, on)
    return () => { cancelled = true; clearInterval(t); window.removeEventListener(TRYBE_ALERT_EVENT, on) }
  }, [enabled, pathname])

  useEffect(() => {
    if (!enabled) return
    let busy = false
    const tick = async () => {
      if (busy || document.visibilityState !== 'visible') return
      // The TRYBE page reads the inbox itself every two minutes.
      if (pathname.startsWith('/trybe-outreach')) return
      let on = false, last = 0
      try { on = localStorage.getItem(TRYBE_INBOX_ON_KEY) === '1'; last = Number(localStorage.getItem(TRYBE_LAST_CHECK_KEY)) || 0 } catch { return }
      if (!on || Date.now() - last < TRYBE_SHELL_CHECK_MS) return
      busy = true
      // Claimed before asking, so two MVP tabs never check together.
      try { localStorage.setItem(TRYBE_LAST_CHECK_KEY, String(Date.now())) } catch { /* this browser only */ }
      try {
        const access = await requestTrybeAccess(false)
        if (access.state !== 'granted' || !scoutAtLeast(access.version ?? null, SCOUT_TRYBE_INBOX_MIN_VERSION)) return
        const { fetchTrybeInbox } = await import('@/components/labs/TrybeInbox')
        const r = await fetchTrybeInbox()
        if (r.ok) await reportTrybeInbox(r.convos)
      } catch { /* SCOUT busy or gone: the next check tries again */ } finally { busy = false }
    }
    const first = setTimeout(() => void tick(), 20_000)
    const t = setInterval(() => void tick(), 5 * 60_000)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [enabled, pathname])

  return unread
}
