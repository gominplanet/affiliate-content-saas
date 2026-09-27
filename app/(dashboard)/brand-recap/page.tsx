/**
 * /brand-recap — Brand recap (LABS, admin while it is tested). One message
 * per Creator Connections brand with every link the creator published for
 * that brand's products.
 */
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import { canUsePreview } from '@/lib/labs-preview'
import BrandRecap from '@/components/brand-recap/BrandRecap'

export default function BrandRecapPage() {
  const tier = useEffectiveTier()
  const router = useRouter()

  useEffect(() => {
    if (tier !== null && !canUsePreview('brand_recap', tier)) router.replace('/dashboard')
  }, [tier, router])

  if (tier !== null && canUsePreview('brand_recap', tier)) return <BrandRecap />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
