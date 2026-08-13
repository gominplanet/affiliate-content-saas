/**
 * /storefront — AMZ Storefront analytics (all paid tiers).
 *
 * The SCOUT-synced per-product earnings dashboard. Available to every PAID tier
 * (anyone with the Amazon toolkit can sync earnings). Trial users are redirected
 * to the dashboard. (Formerly served at /brainstorm, which now redirects here.)
 */
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import AmazonBrainstorm from '@/components/amazon/AmazonBrainstorm'

export default function StorefrontPage() {
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
