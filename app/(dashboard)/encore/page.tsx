/**
 * /encore — Encore (LABS). Products the creator already made videos about
 * that are on sale today, and the promo for each, so an old review earns
 * again. Formerly "On sale now" at /on-sale, which now redirects here. Pro/admin only (LABS),
 * matching the other Labs tools.
 */
'use client'

import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import ProUpgradePanel from '@/components/upgrade/ProUpgradePanel'
import { canUsePreview } from '@/lib/labs-preview'
import OnSale from '@/components/labs/OnSale'

export default function EncorePage() {
  const tier = useEffectiveTier()


  if (tier !== null && canUsePreview('on_sale', tier)) return <OnSale />
  // Not on this plan: say so and how to get it, never a silent bounce.
  if (tier !== null) return <ProUpgradePanel feature="Encore" body="Encore finds the products you already reviewed that are on sale today, writes a timely comment and post for each, and pins them, so an old video earns again." />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
