/**
 * /trybe: TRYBE (Pro, in Find products; the Amazon plan gets a preview). SCOUT
 * reads TRYBE's Discover Brands, MVP studies each brand's website and drafts a
 * first message from the creator's core message, the creator skims the
 * Ready to send list and presses Send all, and SCOUT requests to join each brand
 * slowly, under a daily cap.
 */
'use client'

import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import ProUpgradePanel from '@/components/upgrade/ProUpgradePanel'
import { trybeAccess, canUsePreview, previewOpenToPro } from '@/lib/labs-preview'
import { getViewAsTier } from '@/lib/view-as'
import TrybeOutreach from '@/components/labs/TrybeOutreach'

export default function TrybeOutreachPage() {
  const tier = useEffectiveTier()

  // An admin viewing as Free sees TRYBE Free before it is live (lib/trybe-free).
  const access = tier !== null ? trybeAccess(tier, { adminPreview: getViewAsTier() !== null }) : null
  if (access === 'full') return <TrybeOutreach v2={canUsePreview('trybe_v2', tier)} layout={canUsePreview('trybe_layout', tier)} topBoard={canUsePreview('trybe_top_board', tier)} trybeEdit={canUsePreview('trybe_edit', tier)} studio={canUsePreview('trybe_studio', tier)} />
  // The Amazon plan: Find brands to browse, the rest shown as Pro (Seb, 2026-10-14).
  if (access === 'preview') return <TrybeOutreach preview />
  // TRYBE FREE (Seb, 2026-11-19): the same TRYBE as Pro, with what costs AI
  // or saves the most time shown as Pro (lib/trybe-free).
  if (access === 'free') return <TrybeOutreach free v2={previewOpenToPro('trybe_v2')} layout={previewOpenToPro('trybe_layout')} topBoard={previewOpenToPro('trybe_top_board')} />
  // Not on this plan: say so, never a silent bounce.
  if (tier !== null) return <ProUpgradePanel feature="TRYBE" body="TRYBE in MVP finds brands on TRYBE that fit your channel, writes each one a first message in your words, and SCOUT sends your requests to join. It is part of the Pro plan." />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
