/**
 * /ended-deals — Ended deals (LABS, admin while it is tested). Deal posts
 * whose sale is over, turned into lasting reviews at the same address.
 */
'use client'

import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import ProUpgradePanel from '@/components/upgrade/ProUpgradePanel'
import { canUsePreview } from '@/lib/labs-preview'
import EndedDeals from '@/components/deal/EndedDeals'

export default function EndedDealsPage() {
  const tier = useEffectiveTier()


  if (tier !== null && canUsePreview('deal_aftercare', tier)) return <EndedDeals />
  // Not on this plan: say so and how to get it, never a silent bounce.
  if (tier !== null) return <ProUpgradePanel feature="Ended Deals" body="Ended Deals turns deal posts whose sale is over into lasting reviews in place, and brings them back when the product is on sale again." />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
