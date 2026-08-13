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
import PageExplainer from '@/components/amazon/PageExplainer'

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

      <PageExplainer
        eyebrow="New here? Here’s the flow"
        heading="One design becomes a post on every network"
        intro="This turns a product design into finished posts for the three networks Amazon creators live on: Pinterest, Instagram and Facebook. MVP writes the caption and attaches your affiliate link, so you just approve and post. Two quick one-time setups first (connect accounts, add your Amazon tag), then it is a few clicks every time."
        steps={[
          { title: 'Connect your accounts', body: 'Link Pinterest, Instagram and Facebook once, in the strip below. This is how MVP posts on your behalf.' },
          { title: 'Add your affiliate tag', body: 'Enter your Amazon Associates tag (and Geniuslink if you use it) so every post carries your link and earns you commission.' },
          { title: 'Pick a design & network', body: 'Choose a saved design or generate a fresh one, then pick a network tab. The caption and link are written for you.' },
          { title: 'Post now or schedule', body: 'Publish to all three at once, or queue it for later. Copy done, design done, link attached, you just hit go.' },
        ]}
        footnote="On Instagram, product links route through your shoppable Link-in-Bio grid, since Instagram does not allow links in captions."
      />

      {/* Connect strip — all three accounts in one place */}
      <SocialConnections />

      {/* Affiliate IDs — Amazon tag / Geniuslink, via a setup modal */}
      <AffiliateSetup />

      {/* Saved research finds + the network-tabbed composer */}
      <SocialComposer />
    </div>
  )
}
