/**
 * /video-scripts — Video Scripts (LABS, admin while it is tried). Any product
 * in, five 30 to 40 second scripts out; see lib/product-scripts.ts.
 */
'use client'

import { Loader2 } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import ProUpgradePanel from '@/components/upgrade/ProUpgradePanel'
import { canUsePreview } from '@/lib/labs-preview'
import ProductScripts from '@/components/labs/ProductScripts'

export default function VideoScriptsPage() {
  const tier = useEffectiveTier()

  if (tier !== null && canUsePreview('product_scripts', tier)) return <ProductScripts />
  // Not on this plan: say so, never a silent bounce.
  if (tier !== null) return <ProUpgradePanel feature="Video Scripts" body="Video Scripts turns any product, from a TikTok Shop or Amazon link to a screenshot, into five short videos written scene by scene. It is still being tested." />

  return (
    <div className="flex items-center justify-center py-24 text-sm text-[#86868b] dark:text-[#8e8e93]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  )
}
