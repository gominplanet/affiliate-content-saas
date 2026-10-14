/**
 * /trybe-outreach — TRYBE Outreach (Pro, in Find products). SCOUT
 * reads TRYBE's Discover Brands, MVP studies each brand's website and drafts a
 * first message from the creator's core message, the creator skims the
 * Ready to send list and presses Send all, and SCOUT requests to join each brand
 * slowly, under a daily cap.
 */
'use client'

import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import ProUpgradePanel from '@/components/upgrade/ProUpgradePanel'
import { trybeAccess } from '@/lib/labs-preview'
import TrybeOutreach from '@/components/labs/TrybeOutreach'

export default function TrybeOutreachPage() {
  const tier = useEffectiveTier()

  const access = tier !== null ? trybeAccess(tier) : null
  if (access === 'full') return <TrybeOutreach />
  // The Amazon plan: Find brands to browse, the rest shown as Pro (Seb, 2026-10-14).
  if (access === 'preview') return <TrybeOutreach preview />
  // Not on this plan: say so, never a silent bounce.
  if (tier !== null) return <ProUpgradePanel feature="TRYBE" body="TRYBE in MVP finds brands on TRYBE that fit your channel, writes each one a first message in your words, and SCOUT sends your requests to join. It is part of the Pro plan." />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
