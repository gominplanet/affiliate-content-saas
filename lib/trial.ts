// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SEVEN DAYS FREE, THEN THE CARD IS CHARGED (Seb, 2026-10-21: "people can try
// it out for 1 week for free").
//
// WHAT THIS REPLACES. From 2026-10-18 a new member paid on day one and could
// ask for it back inside 7 days (lib/guarantee). The money moved first and the
// promise was that it would move back. This moves the money instead: Stripe
// takes the card at checkout, charges nothing for 7 days, and bills on day 8
// unless they cancel.
//
// WHY THE CARD IS STILL TAKEN. A trial with no card is a bot farm with a
// signup form, which is the problem the old free tier's Amazon Associates tag
// qualifier existed to solve. A card does the same job better, and it is what
// lets day 8 happen by itself rather than asking somebody to come back and
// decide a second time.
//
// WHY THE FIRST WEEK IS STILL A QUARTER OF THE ALLOWANCES. lib/intro-allowance
// already holds the first 7 days after `subscribed_at` to a quarter of each
// monthly allowance. Under a trial that window lands exactly on the free week,
// which is what stops somebody taking a free account, spending a month of AI
// in six days, and cancelling. A quarter of a month is slightly MORE than a
// week's share, so nobody evaluating the product in good faith runs out.
//
// SET IN CODE, NOT IN THE DASHBOARD. Stripe lets a trial be configured on the
// Price itself, invisibly to this repo. Sending trial_period_days on the
// session overrides that, so the length is whatever this file says, it is
// visible in review, and it is covered by a test.

import { livePrice } from '@/lib/price-schedule'

/** How many free days a new member gets before the first charge. */
export const TRIAL_DAYS = 7

/**
 * Who gets the free week.
 *
 * ONCE PER CUSTOMER. A member who has ever had a Stripe customer record, or
 * whose subscription start was ever recorded, has been here before: churning
 * and coming back is not a new trial. Both fields are written by the webhook
 * and never cleared, so this stays true after a cancellation.
 *
 * The gap this does NOT close is a returning creator using a fresh email and
 * a fresh card. lib/creator-refund already matches a creator across email,
 * card fingerprint, YouTube channel and Amazon tag for the refund; the same
 * matching can be pointed at trials when it is worth the extra read. Until
 * then this is the honest limit: it stops churn-and-return on one account,
 * not a determined second signup.
 */
export function trialEligible(member: {
  stripeCustomerId?: string | null
  subscribedAt?: string | null
}): boolean {
  return !member.stripeCustomerId && !member.subscribedAt
}

/** What Stripe is told. `undefined` rather than 0 for an ineligible member:
 *  Stripe reads trial_period_days: 0 as a request it may still act on, and an
 *  absent field is the unambiguous way to say "charge them now". */
export function trialPeriodDays(member: Parameters<typeof trialEligible>[0]): number | undefined {
  return trialEligible(member) ? TRIAL_DAYS : undefined
}

// ── What a visitor reads ─────────────────────────────────────────────────────
//
// Every price here comes from lib/price-schedule, never typed, so a screen
// cannot advertise a number checkout would not charge (scripts/test-price-claims).

/** The offer in one line, for a button's supporting text or a hero. */
export function trialLabel(now?: number): string {
  return `${TRIAL_DAYS} days free, then $${livePrice('pro', 'month', now)} a month`
}

/** The short form for a feature tile or a badge. */
export const TRIAL_SHORT = `${TRIAL_DAYS} days free`

/** The whole promise under a checkout button. Says the card is taken and says
 *  when the charge lands, because a trial that surprises somebody on day 8 is
 *  a refund request and a chargeback, not a customer. */
export function trialSentence(now?: number): string {
  return `Your card is saved now and charged nothing for ${TRIAL_DAYS} days. `
    + `On day ${TRIAL_DAYS + 1} it becomes $${livePrice('pro', 'month', now)} a month. Cancel any time before then and you pay nothing.`
}

/** The line that keeps the allowance honest, for anywhere the trial is sold.
 *  Saying it up front costs a little and saves the person who hits a cap on
 *  day three believing the product is broken. */
export const TRIAL_ALLOWANCE_NOTE =
  `Everything is unlocked during the free week, with a quarter of each monthly allowance, which is a little more than a week's share.`
