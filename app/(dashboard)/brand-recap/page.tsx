/**
 * /brand-recap — Brand recap (LABS, admin while it is tested). One message
 * per Creator Connections brand with every link the creator published for
 * that brand's products.
 */
'use client'

import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import ProUpgradePanel from '@/components/upgrade/ProUpgradePanel'
import { canUsePreview } from '@/lib/labs-preview'
import BrandRecap from '@/components/brand-recap/BrandRecap'

export default function BrandRecapPage() {
  const tier = useEffectiveTier()


  if (tier !== null && canUsePreview('brand_recap', tier)) return <BrandRecap />
  // Not on this plan: say so and how to get it, never a silent bounce.
  if (tier !== null) return <ProUpgradePanel feature="Brand Recap" body="Brand Recap gathers every link you published for a Creator Connections brand into one message you can send them." />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
