/**
 * /instagram-burner (Shop Burner) — retired 2026-08.
 *
 * Clip Factory (/clip-factory) is the merged home of Shorts Studio + Shop
 * Burner: single-clip Create → Enhance → Publish, plus the batch/schedule flow
 * (ported into Clip Factory's "Batch" mode). Anyone landing here is redirected.
 */
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export default function ShopBurnerRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/clip-factory') }, [router])
  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
