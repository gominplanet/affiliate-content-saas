/**
 * /tiktok-shop — TikTok Shop (LABS). Add a TikTok Shop product by pasting its
 * link, and MVP reads the product off its own page. Pro/admin only (LABS),
 * matching the other Labs tools.
 */
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import { canSeeNav } from '@/lib/feature-access'
import TikTokShop from '@/components/labs/TikTokShop'

export default function TikTokShopPage() {
  const tier = useEffectiveTier()
  const router = useRouter()

  useEffect(() => {
    if (tier !== null && !canSeeNav('labs', tier)) router.replace('/dashboard')
  }, [tier, router])

  if (tier !== null && canSeeNav('labs', tier)) return <TikTokShop />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
