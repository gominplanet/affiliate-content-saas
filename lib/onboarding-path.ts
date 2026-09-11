// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Which onboarding a new account should see.
//
// There is one funnel and it opens with "Connect YouTube", marked required. Every
// step after it is locked until that is done. For a creator with a channel that
// is the right first move. For an Amazon influencer it is a dead end: they do
// not have a channel, they are never going to have one, and the product we sell
// them does not use one. They arrive from an ad about turning a product link
// into a design, and the first thing the app asks for is the one thing they
// cannot give it.
//
// So there are two paths, and this decides which one a visitor is on.
//
// HOW THE CHOICE TRAVELS
//
// It has to survive a round trip through email. Someone clicks "Start free" on
// the Amazon page, types their address, closes the tab, and comes back through a
// confirmation link twenty minutes later. Nothing client-side survives that
// reliably, so the intent rides in the URL from the sales page into signup, into
// the confirmation redirect, and out the other side, and is written to the
// account the first time the onboarding renders.
//
// THE PRECEDENCE IS DELIBERATE
//
// An explicit choice in the URL always wins, because it is the newest thing the
// person did: it is either the ad they just clicked or the fork they just picked
// on the funnel itself. The stored path is next. A guess from what is connected
// is last, and only when there is nothing else to go on.

export type OnboardingPath = 'amazon' | 'creator'

/** Read a path from a URL parameter or a database column. Anything unrecognised
 *  is null rather than a default, so "no answer" stays distinguishable from
 *  "creator" all the way up to the caller that has to pick one. */
export function parseOnboardingPath(v: unknown): OnboardingPath | null {
  const s = String(v ?? '').trim().toLowerCase()
  if (s === 'amazon') return 'amazon'
  if (s === 'creator' || s === 'youtube' || s === 'blog') return 'creator'
  return null
}

export interface PathSignals {
  /** ?for= on the URL: the ad they came from, or the fork they just clicked. */
  param?: unknown
  /** integrations.onboarding_path, when the column exists and is set. */
  stored?: unknown
  /** What the account already has connected. */
  hasYouTube?: boolean
  hasWordPress?: boolean
  hasAmazonTag?: boolean
}

/**
 * The path to render, and whether it is worth writing down.
 *
 * `persist` is true only when the answer came from an explicit choice that is
 * not already stored. A guess is never persisted: an account that happens to
 * have an Associates tag and no channel today may connect one tomorrow, and
 * writing "amazon" on the strength of that would lock a creator out of the
 * funnel they actually need.
 */
export function resolveOnboardingPath(s: PathSignals): { path: OnboardingPath; persist: boolean; from: 'param' | 'stored' | 'guess' | 'default' } {
  const fromParam = parseOnboardingPath(s.param)
  const fromStored = parseOnboardingPath(s.stored)

  if (fromParam) return { path: fromParam, persist: fromParam !== fromStored, from: 'param' }
  if (fromStored) return { path: fromStored, persist: false, from: 'stored' }

  // No stated choice. An account with an Associates tag, no channel and no blog
  // is an Amazon influencer who signed up before this existed, and sending them
  // back into the YouTube funnel would repeat the original mistake.
  if (s.hasAmazonTag && !s.hasYouTube && !s.hasWordPress) {
    return { path: 'amazon', persist: false, from: 'guess' }
  }
  return { path: 'creator', persist: false, from: 'default' }
}

/** Where a person on this path should land once onboarding is out of the way.
 *  The Amazon path goes straight to the thing the ad promised rather than to a
 *  dashboard they then have to read. */
export function onboardingDestination(path: OnboardingPath): string {
  return path === 'amazon' ? '/amazon/thumbnails' : '/dashboard'
}

/** The signup URL for a given path. One place, so the sales page, the pricing
 *  page and the funnel fork cannot drift into three different spellings. */
export function signupHrefFor(path: OnboardingPath): string {
  return path === 'amazon' ? '/signup?for=amazon' : '/signup'
}

/** Where the email confirmation link should come back to, carrying the path so
 *  it survives the round trip through the inbox. Returned as a plain in-app
 *  path; the caller encodes it into the callback. */
export function confirmationLandingFor(path: OnboardingPath): string {
  return path === 'amazon' ? '/onboarding?for=amazon' : '/onboarding'
}

/**
 * The Amazon path's steps, in order.
 *
 * Deliberately short, and only ONE of them is required. The loop this trial
 * sells is a product link turned into a design they can download, and every
 * question asked before they have seen that happen is a chance to lose them.
 * The Associates tag is the exception because it is what qualifies free AI, and
 * it is one field they know by heart.
 */
export interface AmazonStep {
  key: 'tag' | 'face' | 'socials'
  title: string
  blurb: string
  required: boolean
}

export function amazonOnboardingSteps(): AmazonStep[] {
  return [
    {
      key: 'tag',
      title: 'Your Amazon Associates tag',
      blurb: 'So every link you make earns on your account. One field, nothing to connect.',
      required: true,
    },
    {
      key: 'face',
      title: 'Put your face on the designs',
      blurb: 'Upload a few selfies and MVP builds a model of you. Skip it and your designs are product-only.',
      required: false,
    },
    {
      key: 'socials',
      title: 'Connect Facebook, Instagram or Pinterest',
      blurb: 'Only needed when you want to publish from here. You can download and post by hand without it.',
      required: false,
    },
  ]
}

/** True when this account can leave the Amazon onboarding and start making
 *  things. Mirrors the one required step above. */
export function amazonOnboardingReady(s: { hasAmazonTag?: boolean }): boolean {
  return !!s.hasAmazonTag
}
