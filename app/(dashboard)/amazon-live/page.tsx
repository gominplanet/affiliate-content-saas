/**
 * /amazon-live — Amazon Live prep (LABS). Pick products, get the show:
 * the lineup, timings, talking points and a teleprompter. LABS,
 * matching the other Labs tools.
 */
'use client'

import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import ProUpgradePanel from '@/components/upgrade/ProUpgradePanel'
import { canUsePreview } from '@/lib/labs-preview'
import AmazonLive from '@/components/labs/AmazonLive'

export default function AmazonLivePage() {
  const tier = useEffectiveTier()


  if (tier !== null && canUsePreview('amazon_live', tier)) return <AmazonLive />
  // Not on this plan: say so and how to get it, never a silent bounce.
  if (tier !== null) return <ProUpgradePanel feature="Amazon Live Prep" body="Amazon Live Prep builds your show plan from your own reviews: talking points, product order and a teleprompter." />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
