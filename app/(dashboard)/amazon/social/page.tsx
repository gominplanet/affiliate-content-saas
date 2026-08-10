// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon Influencer → Social Influencer. Turn an Art Director design into a
// native post for the three visual networks Amazon creators live on: Pinterest,
// Instagram, Facebook. The AI writes the caption, attaches the affiliate link,
// and (for Instagram) routes through the Link-in-Bio shop grid. Pick a network
// tab, generate, then post now or schedule.
import type { Metadata } from 'next'
import { Share2 } from 'lucide-react'
import SocialComposer from '@/components/amazon/SocialComposer'
import SocialConnections from '@/components/amazon/SocialConnections'
import AffiliateSetup from '@/components/amazon/AffiliateSetup'

export const metadata: Metadata = {
  title: 'Social Influencer — Amazon Influencer',
  description: 'Turn a thumbnail into Pinterest, Instagram and Facebook posts.',
}

export default function AmazonSocialPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Share2 size={14} className="text-[#d97706]" />
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-soft)' }}>
            Amazon Influencer · Social Influencer
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2" style={{ color: 'var(--text)' }}>
          One design, three networks
        </h1>
        <p className="text-sm max-w-2xl" style={{ color: 'var(--text-soft)' }}>
          MVP Art Director makes scroll-stopping designs, then turns them into great Pins and posts. Caption, affiliate link and publishing, handled.
        </p>
      </header>

      {/* Connect strip — all three accounts in one place */}
      <SocialConnections />

      {/* Affiliate IDs — Amazon tag / Geniuslink, via a setup modal */}
      <AffiliateSetup />

      {/* Saved research finds + the network-tabbed composer */}
      <SocialComposer />
    </div>
  )
}
