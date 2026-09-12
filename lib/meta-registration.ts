// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Report a registration to Meta, from the two places a registration actually
// happens.
//
// WHY THIS MOVED. It used to be reported from /onboarding, on the theory that
// every new account passes through it. Neither half of that pair ever produced
// an event. Between 2026-09-11 00:00 UTC and the campaign's second day the
// pixel received 758 PageViews, 57 ViewContents, 6 InitiateCheckouts, one
// Purchase and 2 Leads, and ZERO CompleteRegistrations, from browser or server.
// The ad set optimizes on COMPLETE_REGISTRATION, so Meta was being asked to
// find people who do a thing it had never once observed, and delivery was
// priced accordingly: $85 CPM against the previous campaign's $56.
//
// The paid flow could never have fired it. /api/auth/signup-paid creates the
// account already-confirmed and hands back a Stripe Checkout URL whose
// success_url is /billing. A buyer never passes through /onboarding at all, so
// for them the event had no code path to run in.
//
// Why the trial flow did not fire it either was never established from the
// outside, and guessing would have been worse than removing the dependency. So
// the event now fires from the two server routes a registration cannot avoid:
// the email-confirmation callback for a trial, and the paid signup route. Both
// are server-side, so an ad blocker, Safari's tracking prevention or a cleared
// localStorage cannot eat them, and neither depends on a page rendering or on a
// client component hydrating.
//
// `source` rides along in custom_data so that if one route goes quiet the gap
// is attributable to that route rather than to "registrations" in general.

import { cookies, headers } from 'next/headers'
import { sendMetaEvent, registrationEventId } from '@/lib/meta-capi'

export type RegistrationSource = 'email-confirmation' | 'paid-signup'

/**
 * Send one CompleteRegistration. Returns whether Meta accepted it, so the
 * caller can log the real outcome rather than the attempt.
 *
 * Idempotent by construction: every send for a given account carries
 * registrationEventId(userId), so Meta collapses repeats into one conversion.
 */
export async function reportRegistration(opts: {
  userId: string
  email?: string | null
  /** Which door they came through ('amazon' | 'creator'), for reporting. */
  path?: string | null
  source: RegistrationSource
}): Promise<boolean> {
  const [jar, hdrs] = await Promise.all([cookies(), headers()])
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://mvpaffiliate.io'
  return sendMetaEvent({
    eventName: 'CompleteRegistration',
    eventId: registrationEventId(opts.userId),
    email: opts.email ?? null,
    externalId: opts.userId,
    eventSourceUrl: `${base}/signup`,
    fbp: jar.get('_fbp')?.value || null,
    fbc: jar.get('_fbc')?.value || null,
    clientIpAddress: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    clientUserAgent: hdrs.get('user-agent'),
    custom: {
      content_name: opts.source === 'paid-signup' ? 'Paid signup' : 'Free trial signup',
      content_category: opts.path ?? 'creator',
      registration_source: opts.source,
    },
  })
}
