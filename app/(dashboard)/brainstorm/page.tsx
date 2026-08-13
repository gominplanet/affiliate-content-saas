/**
 * /brainstorm — Storefront analytics (all paid tiers).
 *
 * The old blog/YouTube Brainstorm (90-day performance snapshot + AI idea
 * generator) was retired. This route now serves ONE thing: the storefront
 * analytics dashboard (SCOUT-synced earnings). Available to every PAID tier —
 * anyone with the Amazon toolkit can sync earnings, so anyone paid can see them.
 * Trial users are redirected to the dashboard.
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

  // Trial has no Storefront — send them to the dashboard. Every paid tier stays.
  useEffect(() => {
    if (gateTier === 'trial') {
      router.replace('/dashboard')
    }
  }, [gateTier, router])

  if (gateTier !== null && gateTier !== 'trial') return <AmazonBrainstorm />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
