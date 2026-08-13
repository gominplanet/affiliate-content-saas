/**
 * /brainstorm — Amazon Influencer storefront analytics.
 *
 * The old blog/YouTube Brainstorm (90-day performance snapshot + AI idea
 * generator) was retired. This route now serves ONE thing: the Amazon tier's
 * storefront analytics dashboard (SCOUT-synced earnings). Every other tier is
 * redirected to the dashboard — Brainstorm no longer exists for them.
 */
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import AmazonBrainstorm from '@/components/amazon/AmazonBrainstorm'

export default function BrainstormPage() {
  const gateTier = useEffectiveTier()
  const router = useRouter()

  // Non-Amazon tiers no longer have a Brainstorm — send them to the dashboard.
  useEffect(() => {
    if (gateTier !== null && gateTier !== 'amazon') {
      router.replace('/dashboard')
    }
  }, [gateTier, router])

  if (gateTier === 'amazon') return <AmazonBrainstorm />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
