/**
 * /drop — Drop (LABS, admin while it is tested). Drop finished videos, say
 * where each goes, press one Launch: Liftoff for YouTube and Amazon, the blog
 * after the video, TRYBE through SCOUT. See lib/drop-plan.ts.
 */
'use client'

import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import ProUpgradePanel from '@/components/upgrade/ProUpgradePanel'
import { canUsePreview } from '@/lib/labs-preview'
import PageHero from '@/components/layout/PageHero'
import DropBoard from '@/components/labs/DropBoard'

export default function DropPage() {
  const tier = useEffectiveTier()

  if (tier !== null && canUsePreview('drop', tier)) {
    return (
      <>
        <PageHero
          title="Drop"
          subtitle="Drop your finished videos, say once where each one goes, and press Launch. Long videos go to YouTube, Amazon and your blog with your usual Liftoff choices. Vertical videos go to the TRYBE brand you pick."
        />
        <div className="pb-28">
          <DropBoard />
        </div>
      </>
    )
  }
  // Not on this plan: say so, never a silent bounce.
  if (tier !== null) return <ProUpgradePanel feature="Drop" body="Drop sends your finished videos to YouTube, Amazon, your blog and TRYBE from one Launch button. It is still being tested." />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
