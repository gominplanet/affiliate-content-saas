// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon Influencer and the blog ladder are two products, not four rungs.
//
// On a pricing page they look like one ladder, and the price makes it worse:
// $79 sits between Creator at $49 and Studio at $99, so Amazon Influencer reads
// as the middle option of a range rather than a different product entirely. A
// storefront creator scanning that page has no reason to think the $79 plan is
// the one built for them, and a blogger has no reason to think it is not.
//
// The difference is not a matter of size. One plan has no blog at all and asks
// for no website and no channel; the other three are a content engine that
// cannot start without both. That is the sentence the page has to make
// unmissable, and these rows are how.
//
// EVERY NUMBER HERE IS READ FROM lib/tier.ts.
//
// Typed by hand, they go stale and oversell. The Amazon sales page advertised
// 300 pins against a 150 cap, 50 pitches against 40 and 100 posts against 60,
// because someone trimmed the plan and the marketing copy stayed where it was.
// A comparison table is the worst possible place for that: it is read by
// somebody deciding what to pay for.

import { TIERS } from '@/lib/tier'

const n = (v: number | null | undefined, fallback = 'unlimited') => (v == null ? fallback : String(v))

export interface CompareRow {
  label: string
  /** What the Amazon Influencer plan does. */
  amazon: string
  /** What Creator / Studio / Pro do, given in that order where they differ. */
  ladder: string
  /** True for the rows that carry the actual distinction, so the page can lead
   *  with them rather than burying them in a list of equals. */
  decisive?: boolean
}

/** The comparison, shortest form that still answers "which one am I". */
export function planCompareRows(): CompareRow[] {
  const A = TIERS.amazon
  const C = TIERS.creator
  const S = TIERS.studio
  const P = TIERS.pro

  return [
    {
      label: 'Who it is for',
      amazon: 'You post Amazon products to your storefront and socials',
      ladder: 'You run a blog, a YouTube channel, or both',
      decisive: true,
    },
    {
      label: 'What you need to start',
      amazon: 'An Amazon Associates tag. Nothing to connect.',
      ladder: 'A WordPress site and a YouTube channel',
      decisive: true,
    },
    {
      label: 'Blog posts',
      // Stated as an absence, on purpose. "0 per month" reads like a limit you
      // could hit; "no blog" is the product boundary.
      amazon: A.postsPerMonth === 0 ? 'None. This plan has no blog.' : `${n(A.postsPerMonth)} a month`,
      ladder: `${n(C.postsPerMonth)} · ${n(S.postsPerMonth)} · ${n(P.postsPerMonth)} a month`,
      decisive: true,
    },
    {
      label: 'Thumbnails',
      amazon: `${n(A.thumbnailsPerMonth)} a month`,
      ladder: `${n(C.thumbnailsPerMonth)} · ${n(S.thumbnailsPerMonth)} · ${n(P.thumbnailsPerMonth)} a month`,
    },
    {
      label: 'Ready-to-post designs',
      amazon: `${n(A.pinsPerMonth)} pins · ${n(A.igPostsPerMonth)} Reels · ${n(A.facebookPostsPerMonth)} Facebook`,
      ladder: C.pinsPerMonth === 0
        ? `Not on Creator · ${n(S.pinsPerMonth)} · ${n(P.pinsPerMonth)} pins`
        : `${n(C.pinsPerMonth)} · ${n(S.pinsPerMonth)} · ${n(P.pinsPerMonth)} pins`,
    },
    {
      label: 'Publishes to',
      amazon: 'Facebook, Instagram and Pinterest',
      ladder: `Your blog, plus ${C.socials.length} · ${S.socials.length} · ${P.socials.length} networks`,
      decisive: true,
    },
    {
      label: 'Brand deals (Creator Connections)',
      amazon: `${n(A.collabsPerMonth)} pitches a month`,
      ladder: `${n(C.collabsPerMonth)} · ${n(S.collabsPerMonth)} · ${n(P.collabsPerMonth)} a month`,
    },
    {
      label: 'Your face on the designs',
      amazon: `${n(A.maxFaces)} model, ${n(A.photoboothPerMonth)} headshots`,
      ladder: `${n(C.maxFaces)} · ${n(S.maxFaces)} · ${n(P.maxFaces)} models`,
    },
    {
      label: 'Amazon research + Deal Radar',
      amazon: 'Unlimited',
      ladder: 'Unlimited',
    },
    {
      label: 'Price',
      amazon: `$${A.price} a month`,
      ladder: `$${C.price} · $${S.price} · $${P.price} a month`,
    },
  ]
}

/** The two doors, in the words somebody would use about themselves. Shared so
 *  the pricing page and the Amazon sales page ask the same question. */
export interface TrackCard {
  key: 'amazon' | 'ladder'
  eyebrow: string
  title: string
  blurb: string
  /** The one line that settles it for someone who is unsure. */
  tell: string
  price: string
  href: string
}

export function trackCards(): TrackCard[] {
  return [
    {
      key: 'amazon',
      eyebrow: 'No website · no YouTube',
      title: 'I post Amazon products',
      blurb: 'Turn any product link into a finished thumbnail or a ready-to-post design with your face on it, publish it to Facebook, Instagram and Pinterest, and get matched to paid brand deals.',
      tell: 'If you do not have a blog and do not want one, this is your plan.',
      price: `$${TIERS.amazon.price} a month`,
      href: '/amazon-influencer',
    },
    {
      key: 'ladder',
      eyebrow: 'Blog + YouTube engine',
      title: 'I have a blog or a YouTube channel',
      blurb: 'Turn your videos into full written reviews on your own site, with thumbnails, metadata, scripts, a newsletter and social posts, all in your voice.',
      tell: 'If you publish to a website of your own, this is your ladder.',
      price: `From $${TIERS.creator.price} a month`,
      href: '#plans',
    },
  ]
}
