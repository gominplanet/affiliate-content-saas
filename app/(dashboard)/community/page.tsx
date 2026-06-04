/**
 * Community page — the MVP Affiliate Facebook group is the community hub.
 *
 * (Discord is being rethought; its helpers in lib/community.ts are kept for a
 * possible future return, but no Discord surface renders here for now.)
 */

import type { Metadata } from 'next'
import PageHero from '@/components/layout/PageHero'
import { Facebook, ExternalLink, LifeBuoy, Trophy, Handshake, Gift } from 'lucide-react'
import { FACEBOOK_GROUP_URL } from '@/lib/community'

export const metadata: Metadata = { title: 'Community' }

const WHATS_INSIDE: Array<{ icon: typeof LifeBuoy; title: string; body: string }> = [
  { icon: LifeBuoy, title: 'Get support', body: 'Stuck on setup, an integration, or a generation? Ask the group — we and other creators are in there to help.' },
  { icon: Trophy, title: 'Share your wins', body: 'Post the reviews, channels, and rankings that are working for you. Real examples beat theory.' },
  { icon: Handshake, title: 'Brand-outreach tips', body: 'Swap notes on pitching brands and landing collabs with creators doing it.' },
  { icon: Gift, title: 'Member-only offers', body: 'First to hear about new features, product drops, and offers we share with the community.' },
]

export default function CommunityPage() {
  return (
    <>
      <PageHero
        title="Community"
        subtitle="Join the MVP Affiliate Facebook group — get support, share what's working, and catch member-only offers. We're in there too."
      />

      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        {/* Facebook group — the community hub */}
        <div
          className="card p-6"
          style={{ background: 'linear-gradient(180deg, rgba(24,119,242,0.07) 0%, transparent 100%)', borderColor: 'rgba(24,119,242,0.3)' }}
        >
          <div className="flex items-start gap-3 mb-4">
            <div className="w-11 h-11 rounded-full bg-[#1877F2]/15 flex items-center justify-center flex-shrink-0">
              <Facebook size={22} className="text-[#1877F2]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">MVP Affiliate Facebook Group</p>
              <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
                Free to join. The fastest way to get help, see what other creators are shipping, and stay on top of new features and offers.
              </p>
            </div>
          </div>
          <a
            href={FACEBOOK_GROUP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
            style={{ background: '#1877F2' }}
          >
            <Facebook size={15} /> Join the group <ExternalLink size={13} />
          </a>
        </div>

        {/* What the group is for */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {WHATS_INSIDE.map(({ icon: Icon, title, body }) => (
            <div key={title} className="card p-5">
              <div className="flex items-center gap-2 mb-1.5">
                <Icon size={16} className="text-[#1877F2]" />
                <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{title}</p>
              </div>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">{body}</p>
            </div>
          ))}
        </div>

        <div className="card p-5 text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
          <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">House rules</p>
          <p>Be kind, keep self-promo to wins/showcases, and don&apos;t DM members without consent. We&apos;re a focused community — keep it useful for everyone.</p>
        </div>
      </div>
    </>
  )
}
