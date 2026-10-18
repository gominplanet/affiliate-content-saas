// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE FIRST WEEK RUNS AT A QUARTER (Seb, 2026-10-18).
//
// The free trial is gone: every new member starts on Pro with the whole
// product open, and a 7-day refund in place of the trial (lib/guarantee).
// A refund window over a full month of allowances would let somebody pay,
// spend a month of AI in a week, and take the money back. So while the window
// is open each monthly allowance is a quarter of its full amount, and the rest
// opens on day 8. The billing month is not shortened: on day 8 the member has
// the full allowance for the same month, less what they already used.
//
// Only subscriptions that start after the trial ended (lib/free-trial
// NO_TRIAL_FROM) are affected. Every member from before keeps what they had,
// and a member whose start date was never recorded (no migration 439, or no
// subscription event yet) is never held back by a date we could not read.

import { GUARANTEE_DAYS } from '@/lib/guarantee'
import { NO_TRIAL_FROM } from '@/lib/free-trial'

/** How long the quarter allowances last: the refund window. */
export const INTRO_DAYS = GUARANTEE_DAYS
/** The share of each monthly allowance open during those days. */
export const INTRO_SHARE = 0.25

const DAY_MS = 24 * 60 * 60 * 1000

/** When the full allowances open for this member, or null when they already
 *  have them (an older member, a start we never recorded). Pure. */
export function introEndsAt(subscribedAtISO: string | null | undefined, now: Date = new Date()): Date | null {
  const t = Date.parse(String(subscribedAtISO ?? ''))
  if (!Number.isFinite(t) || t < Date.parse(NO_TRIAL_FROM)) return null
  const end = t + INTRO_DAYS * DAY_MS
  return end > now.getTime() ? new Date(end) : null
}

/** Is this member inside their first week? Pure. */
export function introActive(subscribedAtISO: string | null | undefined, now: Date = new Date()): boolean {
  return introEndsAt(subscribedAtISO, now) !== null
}

/** The allowance in force: a quarter during the first week, rounded down but
 *  never below 1 (a cap of 1 would otherwise read as switched off). Unlimited
 *  and switched-off allowances are left as they are. Pure. */
export function introCap(cap: number | null, subscribedAtISO: string | null | undefined, now: Date = new Date()): number | null {
  if (cap === null || cap <= 0) return cap
  if (!introActive(subscribedAtISO, now)) return cap
  return Math.max(1, Math.floor(cap * INTRO_SHARE))
}

/** The sentence a member reads when a first-week allowance runs out, so a
 *  lower number never looks like a fault. */
export function introNote(subscribedAtISO: string | null | undefined, now: Date = new Date()): string | null {
  const end = introEndsAt(subscribedAtISO, now)
  if (!end) return null
  return `Your first ${INTRO_DAYS} days run at a quarter of each monthly allowance. The rest opens on ${end.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.`
}
