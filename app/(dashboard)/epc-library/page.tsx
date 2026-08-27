'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// EPC Library — its own page under CC Campaigns. These are the Creator
// Connections products SCOUT has scraped, with their estimated EPC and budget.
// The panel itself (browse, fill-in images, get link, blog / social) is shared
// with the old in-page tab; this page just gives it a home in the nav.

import { useEffect, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { createBrowserClient } from '@/lib/supabase/client'
import { effectiveTier, VIEW_AS_EVENT } from '@/lib/view-as'
import { type Tier } from '@/lib/tier'
import EpcLibraryPanel from '@/components/campaigns/EpcLibraryPanel'

export default function EpcLibraryPage() {
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
        const { data } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
        realTier = (data as { tier?: string } | null)?.tier ?? 'trial'
        apply()
      } catch { realTier = 'trial'; apply() }
    })()
    window.addEventListener(VIEW_AS_EVENT, apply)
    return () => { cancelled = true; window.removeEventListener(VIEW_AS_EVENT, apply) }
  }, [])

  return (
    <>
      <PageHero
        title="EPC Library"
        subtitle="A catalogue of Amazon Sponsored Products opportunities with their estimated EPC and budget, refreshed by MVP every 48 hours. Turn any one into a blog post or social push, or grab its link."
      />
      <EpcLibraryPanel tier={tier} />
    </>
  )
}
