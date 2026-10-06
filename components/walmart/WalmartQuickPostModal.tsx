// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Walmart "Quick post to socials": the shared partner window
// (components/social/PartnerQuickPostModal) pointed at /api/walmart/social-post,
// which mints and cloaks the creator's Walmart link. No scheduling: Walmart
// deals have no live-deal cache to gate a queued post, so posting is immediate.

'use client'

import PartnerQuickPostModal from '@/components/social/PartnerQuickPostModal'

export interface WalmartQuickPostItem { itemId: string; name: string; imageUrl: string | null; url: string }

export default function WalmartQuickPostModal({
  item, onClose, initialCaption = '',
}: { item: WalmartQuickPostItem; onClose: () => void; initialCaption?: string }) {
  return (
    <PartnerQuickPostModal
      name={item.name} imageUrl={item.imageUrl}
      endpoint="/api/walmart/social-post"
      payload={{ itemId: item.itemId, name: item.name, imageUrl: item.imageUrl, url: item.url }}
      linkLabel="Your Walmart affiliate link"
      onClose={onClose} initialCaption={initialCaption}
    />
  )
}
