// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The free trial, as one loop rather than a list of limits.
//
// The old free tier was built for the YouTube path: connect a channel, connect
// WordPress, spend five blog posts. Ads now buy Amazon influencers, and that
// funnel asked them for two connections they do not have before showing them
// anything. Most never got to the part that would have sold them.
//
// So the free tier now runs the Amazon loop end to end, once:
//
//   an Amazon product  →  a finished design with their own face on it  →
//   downloaded, in their hands
//
// Everything in here serves that sentence. Five thumbnails and five ready-to-post
// designs are enough to do it more than once. One face model and six photobooth
// shots are what make the designs theirs rather than generic output, and that is
// the ninety seconds nobody else's product has. Deal Radar browsing stays open
// and uncapped, and Amazon product research gets a generous daily allowance,
// because they are read-only, cost almost nothing, and are the only reason a
// trial user opens the app on day three.
// Brand-deal campaigns stay visible and unpitchable, because looking at a $400
// campaign with four spots left that you cannot claim is a better argument than
// any pricing page.
//
// What stays paid: publishing to socials, sending brand pitches, anything bulk.
// The download is free and the publish is the upgrade, so the wall lands while
// they are holding a finished design rather than before they have seen one.
//
// THE QUALIFIER
//
// Free AI needs a bar or it feeds signup-and-farm bots. The old bar was a
// connected WordPress site, which is heavy, and irrelevant to an Amazon
// influencer who will never publish a blog post. The new bar is an Amazon
// Associates tag: one text field, every real Amazon influencer knows theirs by
// heart, and no bot farm has one. Same protection, a fraction of the friction,
// and it qualifies exactly the audience the ads are buying.

import type { Tier } from '@/lib/tier'

/** What one free account gets. Mirrors the `trial` entry in lib/tier.ts, which
 *  is the enforced copy; these are here so the copy the user reads and the
 *  numbers the server enforces cannot drift apart unnoticed. */
export const FREE_TRIAL = {
  /** Art Director thumbnails. */
  thumbnails: 5,
  /** Ready-to-post designs, POOLED across pins, Instagram and Facebook. One
   *  pool rather than five of each: the loop is "make a design", not "make a
   *  pin, and separately make a story". */
  socialDesigns: 5,
  /** One face model, so every design can carry their face. */
  faces: 1,
  /** Photobooth headshots from that face model. */
  photobooth: 6,
  /** Amazon product searches per day.
   *
   *  Three public pages advertised "Unlimited Amazon product research" while
   *  /api/amazon-research enforced a daily number the copy had never heard of.
   *  Fifty is plenty for a person and stops a scraper draining the shared Keepa
   *  token pool (each search is about 10 tokens), so the cap is right and the
   *  word was wrong. It lives here now, and the route imports it, so the number
   *  a creator reads is the number the server counts. */
  researchSearchesPerDay: 50,
  /** The circuit breaker, raised from $5 to cover the loop above with headroom.
   *
   *  At $5 the breaker fired mid-trial, on the most engaged users first, and a
   *  generation that simply stops working does not read as a limit. It reads as
   *  a broken product. */
  aiSpendCeilingUsd: 15,
} as const

/** The Amazon Associates tag format: 2-20 chars, letters/digits/hyphens, ending
 *  in a store id like `-20`. Loose on purpose. This is a qualifier, not an
 *  ownership proof, and rejecting a real creator's unusual tag costs far more
 *  than letting a malformed one through. */
export function looksLikeAssociatesTag(v: string | null | undefined): boolean {
  const s = String(v ?? '').trim()
  if (!s) return false
  return /^[A-Za-z0-9][A-Za-z0-9-]{1,19}-[0-9]{1,3}$/.test(s)
}

/** Free-tier image generation needs the Associates tag on file. Paid tiers are
 *  never gated here. Returns the sentence to show, or null to allow.
 *
 *  Pure so the wording and the rule are pinned by tests rather than discovered
 *  by a creator hitting them. */
export function freeTrialImageBlock(opts: { tier: Tier; amazonTag: string | null | undefined }): string | null {
  if (opts.tier !== 'trial') return null
  if (looksLikeAssociatesTag(opts.amazonTag)) return null
  const has = String(opts.amazonTag ?? '').trim()
  if (has) {
    return `That doesn’t look like an Amazon Associates tag (they end in something like "-20"). Check it in Setup and your ${FREE_TRIAL.thumbnails} free designs are ready to go.`
  }
  return `Add your Amazon Associates tag in Setup to unlock your ${FREE_TRIAL.thumbnails} free designs. It’s one field, no site or account to connect.`
}

/** The design pool for a tier: a single number covering pins + Instagram +
 *  Facebook together, or null when that tier uses its own per-format caps.
 *
 *  Only the free tier pools. On a paid plan a pin cap and an Instagram cap are
 *  separate promises and must stay separate. */
export function pooledDesignCap(limits: { socialDesignsPerMonth?: number | null }): number | null {
  const v = limits.socialDesignsPerMonth
  return typeof v === 'number' ? v : null
}

/** The free plan in the words a prospect reads, in the order they meet them.
 *  One list, used by the pricing page, the upgrade cards and the trial banner,
 *  so three surfaces cannot advertise three different free plans. */
export function freeTrialHighlights(): string[] {
  return [
    `${FREE_TRIAL.thumbnails} Art Director thumbnails`,
    `${FREE_TRIAL.socialDesigns} ready-to-post designs (pins, Instagram, Facebook)`,
    `1 face model and ${FREE_TRIAL.photobooth} photobooth headshots`,
    `${FREE_TRIAL.researchSearchesPerDay} Amazon product searches a day, and Deal Radar`,
    'See every brand-deal campaign your storefront matches',
    'Download everything you make',
  ]
}

/** What the free plan does NOT include, stated plainly. A trial that hides its
 *  walls until you hit one produces a support ticket, not an upgrade. */
export function freeTrialExclusions(): string[] {
  return [
    'Publishing straight to Facebook, Instagram or Pinterest',
    'Sending brand pitches',
    'Bulk and scheduled posting',
  ]
}
