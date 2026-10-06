/**
 * /group-queue — Group Post Queue (LABS, admin while it is tested). Sponsored
 * Products and Amazon videos posted to the Facebook Page in a batch, then each
 * Page post filled into the creator's Groups by SCOUT.
 */
'use client'

import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import ProUpgradePanel from '@/components/upgrade/ProUpgradePanel'
import { canUsePreview } from '@/lib/labs-preview'
import GroupPostQueue from '@/components/labs/GroupPostQueue'

export default function GroupQueuePage() {
  const tier = useEffectiveTier()

  if (tier !== null && canUsePreview('group_queue', tier)) return <GroupPostQueue />
  // Not on this plan: say so, never a silent bounce.
  if (tier !== null) return <ProUpgradePanel feature="Group Post Queue" body="Group Post Queue posts Sponsored Products and your Amazon videos to your Facebook Page in a batch, then fills each one into your Groups. It is still being tested." />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
