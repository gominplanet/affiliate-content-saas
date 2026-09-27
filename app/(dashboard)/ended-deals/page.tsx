/**
 * /ended-deals — Ended deals (LABS, admin while it is tested). Deal posts
 * whose sale is over, turned into lasting reviews at the same address.
 */
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import { canUsePreview } from '@/lib/labs-preview'
import EndedDeals from '@/components/deal/EndedDeals'

export default function EndedDealsPage() {
  const tier = useEffectiveTier()
  const router = useRouter()

  useEffect(() => {
    if (tier !== null && !canUsePreview('deal_aftercare', tier)) router.replace('/dashboard')
  }, [tier, router])

  if (tier !== null && canUsePreview('deal_aftercare', tier)) return <EndedDeals />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
