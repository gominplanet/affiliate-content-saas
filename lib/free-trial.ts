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
  /** Photobooth headshots from that face model.
   *
   *  Was 6, which is exactly what the $79 Amazon plan gets. A paid subscriber
   *  having the same headshot allowance as somebody paying nothing is not a
   *  trial, it is the product. Two is enough to see your own face come out of
   *  the machine, which is the whole job of this number, and it leaves the paid
   *  plan three times the room. */
  photobooth: 2,
  /** How long the free plan lasts.
   *
   *  It used to last forever. The caps were monthly and the counter reset on the
   *  1st, so a free account got five thumbnails, five designs and its headshots
   *  again every month for as long as it existed. That is not a trial, it is a
   *  free tier with a small ceiling, and nothing in the funnel ever forced the
   *  decision the trial exists to force.
   *
   *  Counted from signup rather than the calendar, so somebody who joins on the
   *  28th gets a month like everybody else instead of three days. */
  trialDays: 30,
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

/**
 * The free month: when it started, when it ends, and whether it is over.
 *
 * Every free allowance is counted inside this window instead of the calendar
 * month. Two things follow, and both are the point:
 *
 *   The five designs are five for the month, not five that come back on the 1st.
 *   Somebody who signs up on the 28th used to get five designs, then five more
 *   three days later.
 *
 *   When the window closes the allowances do not renew. The account keeps
 *   everything it made and everything read-only (research, Deal Radar, the
 *   designs already downloaded); it just cannot spend more free AI.
 *
 * `signupISO` absent or unreadable returns a window that has NOT expired. A
 * date we could not read must never be the reason somebody's account stops
 * working, and the per-feature caps still hold in that case.
 */
export interface FreeTrialWindow {
  /** Count usage from here. */
  startISO: string
  /** The moment the free month closes. */
  endISO: string
  expired: boolean
  /** Whole days left, floored, never negative. 0 on the last day. */
  daysLeft: number
  /** For checkUsageCap's "resets ..." line. Not a reset: it is the end. */
  endLabel: string
}

export function freeTrialWindow(signupISO: string | null | undefined, now: Date = new Date()): FreeTrialWindow {
  const start = new Date(String(signupISO ?? ''))
  const usable = !isNaN(start.getTime())
  // No readable signup date: behave as if the month started now, so nothing is
  // blocked and the counter still has a window to count in.
  const from = usable ? start : now
  const end = new Date(from.getTime() + FREE_TRIAL.trialDays * 24 * 60 * 60 * 1000)
  const msLeft = end.getTime() - now.getTime()
  return {
    startISO: from.toISOString(),
    endISO: end.toISOString(),
    expired: usable && msLeft <= 0,
    daysLeft: Math.max(0, Math.floor(msLeft / (24 * 60 * 60 * 1000))),
    endLabel: end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }
}

/**
 * The sentence to show when a free month is over, or null to allow.
 *
 * Paid tiers are never gated here. Says what they keep as well as what has
 * stopped, because an account that suddenly refuses to generate and explains
 * nothing reads as broken rather than finished.
 */
export function freeTrialExpiredBlock(opts: {
  tier: Tier
  signupISO: string | null | undefined
  now?: Date
}): string | null {
  if (opts.tier !== 'trial') return null
  const w = freeTrialWindow(opts.signupISO, opts.now)
  if (!w.expired) return null
  return `Your free month is over, so there is no free AI left on this account. Everything you already made is still yours to download, and Amazon product research and Deal Radar stay open. Upgrade to keep making designs.`
}

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
    `Free for ${FREE_TRIAL.trialDays} days, no card`,
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
