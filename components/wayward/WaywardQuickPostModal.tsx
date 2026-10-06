// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Wayward "Quick post to socials": the shared partner window
// (components/social/PartnerQuickPostModal) pointed at /api/wayward/social-post,
// which mints and cloaks the creator's Wayward attributed Amazon link.

'use client'

import PartnerQuickPostModal from '@/components/social/PartnerQuickPostModal'

export interface WaywardQuickPostItem { asin: string; name: string; imageUrl: string | null }

export default function WaywardQuickPostModal({
  item, onClose, initialCaption = '',
}: { item: WaywardQuickPostItem; onClose: () => void; initialCaption?: string }) {
  return (
    <PartnerQuickPostModal
      name={item.name} imageUrl={item.imageUrl}
      endpoint="/api/wayward/social-post"
      payload={{ asin: item.asin, name: item.name, imageUrl: item.imageUrl }}
      linkLabel="Your Wayward attributed Amazon link"
      captionPlaceholder="We'll write a caption for you, or type your own…"
      onClose={onClose} initialCaption={initialCaption}
    />
  )
}
