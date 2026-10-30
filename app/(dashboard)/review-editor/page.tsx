/**
 * /review-editor — the review editor (LABS, admin while it is tested). A
 * review take and a B-roll take in, a finished video out; see
 * lib/review-edit-server.ts.
 */
'use client'

import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import ProUpgradePanel from '@/components/upgrade/ProUpgradePanel'
import { canUsePreview } from '@/lib/labs-preview'
import ReviewEditor from '@/components/review-editor/ReviewEditor'

export default function ReviewEditorPage() {
  const tier = useEffectiveTier()

  if (tier !== null && canUsePreview('review_edit', tier)) return <ReviewEditor />
  // Not on this plan: say so, never a silent bounce.
  if (tier !== null) return <ProUpgradePanel feature="Review editor" body="The review editor turns a review take and a B-roll take into a finished video for Amazon, YouTube, TRYBE and TikTok. It is still being tested." />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
