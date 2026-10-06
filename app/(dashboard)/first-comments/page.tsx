/**
 * /first-comments — pinned first comments for older YouTube videos (LABS,
 * admin while it is tested, behind the same gate as Co-Pilot's first comment).
 */
'use client'

import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import ProUpgradePanel from '@/components/upgrade/ProUpgradePanel'
import { canUsePreview } from '@/lib/labs-preview'
import OlderVideos from '@/components/first-comments/OlderVideos'

export default function FirstCommentsPage() {
  const tier = useEffectiveTier()


  if (tier !== null && canUsePreview('first_comment', tier)) return <OlderVideos />
  // Not on this plan: say so and how to get it, never a silent bounce.
  if (tier !== null) return <ProUpgradePanel feature="Pinned comments" body="Pinned comments posts and pins a first comment with your product link on every video, new and old, and keeps it up to date." />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
