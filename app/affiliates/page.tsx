/**
 * /affiliates — public affiliate-program recruitment page (server wrapper).
 *
 * Redesigned 2026-06-17 from the "affiliates-landing-reference" brief. This
 * file stays a server component purely for metadata; the page UI + the two
 * interactive bits (earnings estimator, FAQ accordion) live in the client
 * component. Route is allow-listed in middleware.ts so it renders logged-out.
 *
 * Terms (10% recurring · 60-day cookie · $50 min · monthly via Stripe ·
 * audience 20% off first 3 months, code yUrNXwso) mirror the live Rewardful
 * campaign and are single-sourced in affiliates-client.tsx → CAMPAIGN.
 */
import type { Metadata } from 'next'
import AffiliatesClient from './affiliates-client'

export const metadata: Metadata = {
  title: 'Become an Affiliate',
  description:
    'Earn 10% recurring — for life — promoting MVP Affiliate: turn one YouTube video into a blog, social posts, thumbnails, and brand pitches. 60-day cookie, monthly payouts, your audience saves 20%.',
}

export default function AffiliatesPage() {
  return <AffiliatesClient />
}
