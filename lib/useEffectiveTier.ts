// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// useEffectiveTier — client hook that resolves the tier the UI should render
// for. Returns null while loading (so a page can avoid flashing a paywall before
// the tier is known), then the effective tier: the real DB tier for normal
// users, or the admin's "view as" override so paywalls preview correctly. Re-
// resolves when the admin flips the View-as dropdown (VIEW_AS_EVENT).
//
// Use with FeatureLockedCard to gate a page:
//   const tier = useEffectiveTier()
//   if (tier !== null && tier === 'trial') return <FeatureLockedCard ... />

'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { effectiveTier, VIEW_AS_EVENT } from '@/lib/view-as'
import type { Tier } from '@/lib/tier'

export function useEffectiveTier(): Tier | null {
  const [tier, setTier] = useState<Tier | null>(null)
  useEffect(() => {
    let cancelled = false
    let realTier: string = 'trial'
    const apply = () => { if (!cancelled) setTier(effectiveTier(realTier)) }
    ;(async () => {
      try {
        const supabase = createBrowserClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { realTier = 'trial'; apply(); return }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any)
          .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
        realTier = (data as { tier?: string } | null)?.tier ?? 'trial'
        apply()
      } catch { realTier = 'trial'; apply() }
    })()
    window.addEventListener(VIEW_AS_EVENT, apply)
    return () => { cancelled = true; window.removeEventListener(VIEW_AS_EVENT, apply) }
  }, [])
  return tier
}
