/**
 * /group-queue — Group Post Queue (LABS, admin while it is tested). Sponsored
 * Products and Amazon videos in a batch, Group first: SCOUT fills each post,
 * link included, into the creator's Group, then MVP posts on the Page linking
 * to that Group post.
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
  if (tier !== null) return <ProUpgradePanel feature="Group Post Queue" body="Group Post Queue puts Sponsored Products and your Amazon videos into your Facebook Group in a batch, then shares each one on your Page. It is still being tested." />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
