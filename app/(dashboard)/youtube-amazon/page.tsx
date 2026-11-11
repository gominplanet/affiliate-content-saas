/**
 * /youtube-amazon — YouTube vs Amazon (Labs, admin only). Every YouTube upload
 * checked against the videos on the creator's Amazon storefront by product;
 * see components/amazon/YouTubeAmazonGaps.tsx and lib/yt-amazon-match.ts.
 */
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import YouTubeAmazonGaps from '@/components/amazon/YouTubeAmazonGaps'

export default function YouTubeAmazonPage() {
  const tier = useEffectiveTier()
  const router = useRouter()

  // In Labs, so admin only (Labs is invisible to everyone else).
  useEffect(() => {
    if (tier !== null && tier !== 'admin') router.replace('/dashboard')
  }, [tier, router])

  if (tier === 'admin') return <YouTubeAmazonGaps />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
