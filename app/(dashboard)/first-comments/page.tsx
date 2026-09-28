/**
 * /first-comments — pinned first comments for older YouTube videos (LABS,
 * admin while it is tested, behind the same gate as Co-Pilot's first comment).
 */
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import { canUsePreview } from '@/lib/labs-preview'
import OlderVideos from '@/components/first-comments/OlderVideos'

export default function FirstCommentsPage() {
  const tier = useEffectiveTier()
  const router = useRouter()

  useEffect(() => {
    if (tier !== null && !canUsePreview('first_comment', tier)) router.replace('/dashboard')
  }, [tier, router])

  if (tier !== null && canUsePreview('first_comment', tier)) return <OlderVideos />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
