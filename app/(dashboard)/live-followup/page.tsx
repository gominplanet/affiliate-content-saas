/**
 * /live-followup — Amazon Live follow-up (Pro). Drafts only.
 * Clips and a roundup post from a Live replay; see lib/live-followup.ts.
 */
'use client'

import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import ProUpgradePanel from '@/components/upgrade/ProUpgradePanel'
import { canUsePreview } from '@/lib/labs-preview'
import LiveFollowup from '@/components/labs/LiveFollowup'

export default function LiveFollowupPage() {
  const tier = useEffectiveTier()

  if (tier !== null && canUsePreview('live_followup', tier)) return <LiveFollowup />
  // Not on this plan: say so, never a silent bounce.
  if (tier !== null) return <ProUpgradePanel feature="Live follow-up" body="Live follow-up turns an Amazon Live replay into one clip per product and a post listing everything you showed, ready to review and post." />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
