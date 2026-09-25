// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "My features": the sidebar features a creator starred, shown in their own
// section at the top of the sidebar (migration 376).
//
// SAVED TO THE ACCOUNT, SHOWN AT ONCE. The list is kept on the account so it
// follows the creator to every device, and mirrored in this browser so the
// sidebar draws it immediately instead of popping in after a network call.
// If the account copy cannot be saved (the table is missing, the network is
// down), the browser copy still works and `savedTo` says 'device', so the
// sidebar can tell the creator it will not follow them yet.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'

/** Most features a creator can pin. The section stays short enough to scan. */
export const MAX_NAV_FAVORITES = 12

const LOCAL_KEY = 'mvp_nav_favorites_v1'

/** Adds or removes one page, keeping pin order and the maximum. Pure. */
export function toggleFavorite(list: string[], href: string, max = MAX_NAV_FAVORITES): { next: string[]; full: boolean } {
  if (list.includes(href)) return { next: list.filter((h) => h !== href), full: false }
  if (list.length >= max) return { next: list, full: true }
  return { next: [...list, href], full: false }
}

function readLocal(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(LOCAL_KEY) || '[]')
    return Array.isArray(v) ? v.filter((h): h is string => typeof h === 'string').slice(0, MAX_NAV_FAVORITES) : []
  } catch { return [] }
}
function writeLocal(list: string[]) {
  try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(list)) } catch { /* private mode: account copy still works */ }
}

export function useNavFavorites(): {
  favorites: string[]
  toggle: (href: string) => { full: boolean }
  /** Where the list is kept: the account (every device) or only this browser. */
  savedTo: 'account' | 'device' | null
} {
  const [favorites, setFavoritesState] = useState<string[]>([])
  const [savedTo, setSavedTo] = useState<'account' | 'device' | null>(null)
  // The current list, read synchronously by toggle (a state updater may run later).
  const current = useRef<string[]>([])
  const setFavorites = (list: string[]) => { current.current = list; setFavoritesState(list) }

  useEffect(() => {
    setFavorites(readLocal())
    let alive = true
    ;(async () => {
      try {
        const sb = createBrowserClient()
        const { data: { user } } = await sb.auth.getUser()
        if (!user) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (sb as any).from('user_nav_favorites').select('hrefs').eq('user_id', user.id).maybeSingle()
        if (!alive) return
        if (error) { setSavedTo('device'); return }
        if (data && Array.isArray(data.hrefs)) {
          const list = (data.hrefs as string[]).slice(0, MAX_NAV_FAVORITES)
          setFavorites(list)
          writeLocal(list)
        }
        setSavedTo('account')
      } catch { if (alive) setSavedTo('device') }
    })()
    return () => { alive = false }
  }, [])

  const toggle = useCallback((href: string) => {
    const r = toggleFavorite(current.current, href)
    if (r.full) return { full: true }
    setFavorites(r.next)
    writeLocal(r.next)
    ;(async () => {
      try {
        const sb = createBrowserClient()
        const { data: { user } } = await sb.auth.getUser()
        if (!user) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (sb as any).from('user_nav_favorites')
          .upsert({ user_id: user.id, hrefs: r.next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
        setSavedTo(error ? 'device' : 'account')
      } catch { setSavedTo('device') }
    })()
    return { full: false }
  }, [])

  return { favorites, toggle, savedTo }
}
