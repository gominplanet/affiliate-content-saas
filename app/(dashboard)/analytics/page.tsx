/**
 * /analytics — retired 2026-08.
 *
 * This was "Storefront Stats" (30-day Geniuslink click counts per product). It
 * name-clashed with the new SCOUT-synced AMZ Storefront dashboard (/brainstorm)
 * and was empty for storefront-only creators, so it was retired. Anyone landing
 * here is sent to AMZ Storefront.
 */
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export default function AnalyticsRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/storefront') }, [router])
  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
