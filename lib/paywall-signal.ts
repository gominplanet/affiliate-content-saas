// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The moment a free account reaches the wall, reported once.
//
// The Amazon campaign advertises the $79 tier: publish to three channels from
// one screen, pitches written for you. Both are excluded from the free trial by
// design, and that is the whole shape of the funnel. The free account makes a
// design, holds it, and the publish button is the paywall. Seeing a $400
// campaign you cannot claim is the same idea.
//
// The risk somebody named before the spend started: registrations look healthy
// and nobody upgrades. If that happens, the reporting we have cannot tell the
// two explanations apart.
//
//   the ad brought people who were never going to pay
//   the ad brought the right people and they never got as far as the wall
//
// Those need opposite responses. The first is an audience problem, the second is
// a product problem, and guessing wrong costs a week of spend either way.
//
// So reaching the paywall is its own event. Between CompleteRegistration and a
// purchase there was nothing at all; this is the step in between, and it is the
// one that says the trial did its job.
//
// A CUSTOM event, not a standard one. Meta's standard events carry optimisation
// meaning, and teaching a campaign to optimise for people who hit a paywall is
// the opposite of what anyone wants. This is a diagnostic.

import { sendMetaEvent } from '@/lib/meta-capi'

export type PaywallSurface = 'publish-facebook' | 'publish-instagram' | 'publish-pinterest' | 'brand-pitch'

/** Stable per user + surface, so a creator who clicks Publish five times in a
 *  row is one person reaching the wall, not five. Meta dedupes on event_id. */
export function paywallEventId(userId: string, surface: PaywallSurface): string {
  return `paywall-${surface}-${userId}`
}

/**
 * Report that a free account was refused a paid capability.
 *
 * Fire-and-forget and never awaited by a route: this is telemetry, and a slow
 * Graph call must not add a second to the refusal the creator is waiting on.
 * Failures are swallowed for the same reason. The route's own response is what
 * the person sees, and it has already been decided by the time this runs.
 */
export function reportPaywallReached(opts: {
  userId: string
  email?: string | null
  surface: PaywallSurface
  /** The plan that would unlock it, for the report rather than for the user. */
  tier: string
}): void {
  void sendMetaEvent({
    eventName: 'PaywallReached',
    eventId: paywallEventId(opts.userId, opts.surface),
    email: opts.email ?? undefined,
    externalId: opts.userId,
    eventSourceUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://mvpaffiliate.io'}/amazon/social`,
    custom: { content_name: opts.surface, content_category: 'paywall', from_tier: opts.tier },
  }).catch(() => undefined)
}
