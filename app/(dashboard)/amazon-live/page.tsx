/**
 * /amazon-live — Amazon Live prep (LABS). Pick products, get the show:
 * the lineup, timings, talking points and a teleprompter. LABS,
 * matching the other Labs tools.
 */
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import { canSeeNav } from '@/lib/feature-access'
import AmazonLive from '@/components/labs/AmazonLive'

export default function AmazonLivePage() {
  const tier = useEffectiveTier()
  const router = useRouter()

  useEffect(() => {
    if (tier !== null && !canSeeNav('labs', tier)) router.replace('/dashboard')
  }, [tier, router])

  if (tier !== null && canSeeNav('labs', tier)) return <AmazonLive />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
