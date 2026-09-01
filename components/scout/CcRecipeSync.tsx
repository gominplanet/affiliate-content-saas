'use client'

/**
 * CcRecipeSync — keeps SCOUT's learned Creator Connections send/search recipe
 * mirrored to the creator's MVP account, so it's never forgotten.
 *
 * On load (once per session), when SCOUT is installed:
 *   • If SCOUT HAS a learned recipe → back it up to the account.
 *   • If SCOUT has NONE → restore the account's saved recipe into SCOUT.
 *
 * This makes the recipe survive reinstalls and switches between the sideloaded
 * and Web Store builds (which have separate extension storage): whichever build
 * is installed re-hydrates from the account the next time MVP is open. Fully
 * silent and best-effort — never blocks or surfaces UI.
 */

import { useEffect } from 'react'
import { getScoutStatus, getScoutCcRecipe, setScoutCcRecipe } from '@/lib/extension-frame'

const ONCE_KEY = 'mvp.cc.recipeSync.v1'

export default function CcRecipeSync() {
  useEffect(() => {
    // Once per browser session — this only needs to reconcile, not run on every
    // client navigation.
    try { if (sessionStorage.getItem(ONCE_KEY) === '1') return } catch { /* ignore */ }
    let cancelled = false

    ;(async () => {
      try {
        const scout = await getScoutStatus().catch(() => ({ installed: false, version: null as string | null }))
        if (cancelled || !scout.installed) return

        const local = await getScoutCcRecipe()
        if (cancelled) return

        if (local.send && local.search) {
          // SCOUT knows the recipe → back it up to the account.
          await fetch('/api/scout/cc-recipe', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ send: local.send, search: local.search }),
          }).catch(() => {})
        } else {
          // SCOUT forgot (fresh install / switched build) → restore from account.
          const saved = await fetch('/api/scout/cc-recipe').then(r => r.ok ? r.json() : null).catch(() => null)
          if (!cancelled && saved?.send && saved?.search) {
            await setScoutCcRecipe({ send: saved.send, search: saved.search }).catch(() => {})
          }
        }
        try { sessionStorage.setItem(ONCE_KEY, '1') } catch { /* ignore */ }
      } catch { /* best-effort — never surface */ }
    })()

    return () => { cancelled = true }
  }, [])

  return null
}
