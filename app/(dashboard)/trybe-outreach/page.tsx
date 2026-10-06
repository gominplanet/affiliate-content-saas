/**
 * /trybe-outreach — TRYBE Outreach (LABS, admin while it is tested). SCOUT
 * reads TRYBE's Discover Brands, MVP studies each brand's website and drafts a
 * first message from the creator's core message, the creator skims the
 * morning queue and presses Send all, and SCOUT requests to join each brand
 * slowly, under a daily cap.
 */
'use client'

import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import ProUpgradePanel from '@/components/upgrade/ProUpgradePanel'
import { canUsePreview } from '@/lib/labs-preview'
import TrybeOutreach from '@/components/labs/TrybeOutreach'

export default function TrybeOutreachPage() {
  const tier = useEffectiveTier()

  if (tier !== null && canUsePreview('trybe_outreach', tier)) return <TrybeOutreach />
  // Not on this plan: say so, never a silent bounce.
  if (tier !== null) return <ProUpgradePanel feature="TRYBE Outreach" body="TRYBE Outreach finds brands on TRYBE, writes a first message for each one from its website, and sends your requests to join at a careful pace. It is still being tested." />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
