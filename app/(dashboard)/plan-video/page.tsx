/**
 * /plan-video — Plan this video (LABS, admin while it is tested). A joined
 * Creator Connections campaign turned into a video plan; see lib/video-plan.ts.
 */
'use client'

import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import ProUpgradePanel from '@/components/upgrade/ProUpgradePanel'
import { canUsePreview } from '@/lib/labs-preview'
import VideoPlanner from '@/components/labs/VideoPlanner'

export default function PlanVideoPage() {
  const tier = useEffectiveTier()

  if (tier !== null && canUsePreview('video_plan', tier)) return <VideoPlanner />
  // Not on this plan: say so, never a silent bounce.
  if (tier !== null) return <ProUpgradePanel feature="Plan this video" body="Plan this video turns a Creator Connections campaign you joined into a filming plan with titles, talking points, shots and dates. It is still being tested." />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
