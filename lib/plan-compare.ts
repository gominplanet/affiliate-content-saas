// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon Influencer and the publishing plan are two products, not two rungs.
//
// Read as a price list they look like one ladder, and a storefront creator
// scanning it has no reason to think the cheaper one is the plan built for
// them. The difference is not size. One plan has no blog at all and asks for no
// website and no channel; the other is a content engine, and it will build the
// site for someone who has none. That is the sentence the page has to make
// unmissable, and these rows are how.
//
// TWO PLANS, NAMED. Creator and Studio are frozen: existing subscribers keep
// them and nobody new can buy one, so every row here compares the two plans
// that are actually for sale. A marketing surface that names a retired tier is
// selling something checkout will refuse, and the rows used to give three
// values per line for exactly that reason.
//
// EVERY NUMBER HERE IS READ FROM lib/tier.ts.
//
// Typed by hand, they go stale and oversell. The Amazon sales page advertised
// 300 pins against a 150 cap, 50 pitches against 40 and 100 posts against 60,
// because someone trimmed the plan and the marketing copy stayed where it was.
// A comparison table is the worst possible place for that: it is read by
// somebody deciding what to pay for.

import { SELLABLE_TIERS, TIERS } from '@/lib/tier'

const n = (v: number | null | undefined, fallback = 'unlimited') => (v == null ? fallback : String(v))

export interface CompareRow {
  label: string
  /** What the Amazon Influencer plan does. */
  amazon: string
  /** What the Pro publishing plan does. */
  ladder: string
  /** True for the rows that carry the actual distinction, so the page can lead
   *  with them rather than burying them in a list of equals. */
  decisive?: boolean
}

/** The comparison, shortest form that still answers "which one am I". */
export function planCompareRows(): CompareRow[] {
  const A = TIERS.amazon
  const P = TIERS.pro

  return [
    {
      label: 'Who it is for',
      amazon: 'You post Amazon products to your storefront and socials',
      ladder: 'You publish reviews on a site of your own, with or without a YouTube channel',
      decisive: true,
    },
    {
      label: 'What you need to start',
      amazon: 'An Amazon Associates tag. Nothing to connect.',
      // NOT "a WordPress site and a YouTube channel". MVP installs WordPress,
      // so requiring one turned this row into a reason not to buy for everybody
      // who has not started yet.
      ladder: 'An Amazon Associates tag. Bring a WordPress site or let MVP build you one.',
      decisive: true,
    },
    {
      label: 'Blog posts',
      // Stated as an absence, on purpose. "0 per month" reads like a limit you
      // could hit; "no blog" is the product boundary.
      amazon: A.postsPerMonth === 0 ? 'None. This plan has no blog.' : `${n(A.postsPerMonth)} a month`,
      ladder: `${n(P.postsPerMonth)} a month`,
      decisive: true,
    },
    {
      label: 'Thumbnails',
      amazon: `${n(A.thumbnailsPerMonth)} a month`,
      ladder: `${n(P.thumbnailsPerMonth)} a month`,
    },
    {
      label: 'Ready-to-post designs',
      amazon: `${n(A.pinsPerMonth)} pins · ${n(A.igPostsPerMonth)} Reels · ${n(A.facebookPostsPerMonth)} Facebook`,
      ladder: `${n(P.pinsPerMonth)} pins · ${n(P.igPostsPerMonth)} Reels · ${n(P.facebookPostsPerMonth)} Facebook`,
    },
    {
      label: 'Publishes to',
      amazon: `${A.socials.length} networks: Facebook, Instagram and Pinterest`,
      ladder: `Your blog, plus ${P.socials.length} networks`,
      decisive: true,
    },
    {
      label: 'Messaging brands on Creator Connections',
      // Uncapped on both, and worth a row of its own. The cap below is a
      // different tool, and putting one number beside this line is what made
      // people read a limit into outreach that has none.
      amazon: 'Unlimited',
      ladder: 'Unlimited',
    },
    {
      label: 'Brand pitches drafted for you',
      amazon: `${n(A.collabsPerMonth)} a month`,
      ladder: `${n(P.collabsPerMonth)} a month`,
    },
    {
      label: 'Your face on the designs',
      amazon: `${n(A.maxFaces)} models, ${n(A.photoboothPerMonth)} headshots`,
      ladder: `${n(P.maxFaces)} models, ${n(P.photoboothPerMonth)} headshots`,
    },
    {
      label: 'Amazon research + Deal Radar',
      amazon: 'Unlimited',
      ladder: 'Unlimited',
    },
    {
      label: 'Price',
      amazon: `$${A.price} a month`,
      ladder: `$${P.price} a month`,
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

/** Cheapest SELLABLE plan on the blog track. Derived, never typed: the last
 *  hardcoded number here outlived the plan it named. */
function ladderEntryPrice(): number {
  const prices = SELLABLE_TIERS
    .filter(t => t !== 'amazon')
    .map(t => TIERS[t].price)
    .filter(p => typeof p === 'number' && p > 0)
  return Math.min(...prices)
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
      // NOT "I have a blog". MVP builds the site: the Hostinger flow installs
      // WordPress, and the setup step wires the theme, categories and pages. The
      // old title turned this door away from everybody who has not started yet,
      // which is the group the product is best at serving.
      title: 'I want a site of my own',
      blurb: 'Turn your videos and product links into full written reviews on your own site, with thumbnails, metadata, scripts, a newsletter and social posts, all in your voice. No site yet? MVP builds you one.',
      tell: 'Bring a WordPress site or let MVP set one up for you. Either way, this is your plan.',
      // THE CHEAPEST PLAN SOMEONE CAN ACTUALLY BUY on this track, read from
      // SELLABLE_TIERS. It said "From $49", which is Creator: a frozen tier that
      // existing subscribers keep and nobody new can purchase. The pricing page
      // was quoting a price checkout will not sell.
      price: `$${ladderEntryPrice()} a month`,
      href: '#plans',
    },
  ]
}
