/**
 * /brainstorm — retired. The AMZ Storefront dashboard moved to /storefront.
 * Anyone landing here (old links, bookmarks) is redirected there.
 */
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export default function BrainstormRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/storefront') }, [router])
  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
