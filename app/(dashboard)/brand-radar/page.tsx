/**
 * /brand-radar — Brand Radar (LABS). Pull the full Amazon storefront + TikTok
 * through an external provider and surface the brands the creator has worked with.
 * Pro/admin only (LABS), matching the other LABS tools.
 */
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import { canSeeNav } from '@/lib/feature-access'
import BrandRadar from '@/components/labs/BrandRadar'

export default function BrandRadarPage() {
  const tier = useEffectiveTier()
  const router = useRouter()

  useEffect(() => {
    if (tier !== null && !canSeeNav('labs', tier)) router.replace('/dashboard')
  }, [tier, router])

  if (tier !== null && canSeeNav('labs', tier)) return <BrandRadar />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
