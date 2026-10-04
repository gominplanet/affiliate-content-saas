// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /social-launch-kit — stand up a social presence in ~5 minutes. The cards
// live in components/launch-kit/LaunchKit.tsx, which Meta Hub also uses for
// the Facebook Page and niche Group kits. /social-launch-kit?niche=Kitchen
// opens the Group kit on that niche.
'use client'

import PageHero from '@/components/layout/PageHero'
import { SocialLaunchKitGuide } from '@/components/guide/tool-guides'
import { Rocket } from 'lucide-react'
import HeroVideo from '@/components/layout/HeroVideo'
import { walkthroughId } from '@/lib/tutorial-videos'
import FeatureLockedCard from '@/components/ui/FeatureLockedCard'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import LaunchKit from '@/components/launch-kit/LaunchKit'

/** Walkthrough shown beside the page title. */
const WALKTHROUGH_ID = 'O4fOrgudOOA'

export default function SocialLaunchKitPage() {
  const gateTier = useEffectiveTier()

  // ── Tier gate ────────────────────────────────────────────────────
  // Social Launch Kit is a paid feature. Trial users get the upsell card.
  if (gateTier !== null && gateTier === 'trial') {
    return (
      <FeatureLockedCard
        icon={<Rocket size={28} strokeWidth={1.8} />}
        feature="Social Launch Kit"
        description="Stand up a whole social presence in about five minutes. Pick a platform (a Facebook Page or Group, Pinterest, X, Threads, Bluesky or LinkedIn) and MVP hands you the name, @handle, bios, category, keywords and first post, plus an on-brand banner and avatar, all ready to paste."
        bullets={[
          'Ready-to-paste name, @handle, bios, category and keywords per platform',
          'On-brand banner + avatar generated from your Brand Profile',
          'A written-in-your-voice first post to launch with',
          'Step-by-step setup with deep links — then connect it for auto-posting',
        ]}
        requiredTier="creator"
        currentTier={gateTier}
      />
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <PageHero
        guide={<SocialLaunchKitGuide />}
        title="Social Launch Kit"
        subtitle="No time to figure out a Facebook Page or Group, Pinterest, X, Threads, Bluesky or LinkedIn? Pick a platform and MVP hands you everything: name, bio, banner, avatar, and a step-by-step setup, ready to paste."
        media={walkthroughId(WALKTHROUGH_ID) ? <HeroVideo videoId={WALKTHROUGH_ID} title="Social Launch Kit walkthrough" /> : undefined}
      />

      <div className="flex items-start gap-2.5 rounded-xl px-3 py-2.5 mt-4 mb-5"
        style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid var(--border)' }}>
        <Rocket size={16} className="text-[#7C3AED] flex-shrink-0 mt-0.5" />
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          Everything is generated from your <a href="/brand" className="font-semibold hover:underline" style={{ color: '#7C3AED' }}>Brand Profile</a> and voice, so it sounds like you.
          You still click the final &quot;create&quot; on each platform — MVP can&apos;t make the account for you — but every field and image is done. Once it&apos;s live, connect it in <a href="/connect-socials" className="font-semibold hover:underline" style={{ color: '#7C3AED' }}>Connect Socials</a> to auto-post.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        <LaunchKit />
      </div>
    </div>
  )
}
