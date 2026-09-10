// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon's deal embargo, encoded so MVP cannot walk a creator into breaking it.
//
// The Deals Hub in Amazon Associates carries this on every page:
//
//   "Deals are confidential and can be published only on or after they are
//    published on www.amazon.com. Prime Big Deal Days dates are confidential
//    and can be communicated only after September 14, 2026 at 10:00 PM PDT."
//
// Two separate rules, and both are easy to break by accident with a tool whose
// whole job is to turn a deal into a published post in one click. A creator
// exports the Deals Hub in September, sees October deals in the queue, and hits
// Generate. The post goes live immediately, naming a price and a date that
// Amazon has not announced. That is their Associates account on the line, not
// a formatting problem.
//
// So both rules live here as data, both are checked before publishing, and the
// answer says which rule applies and when it lifts. The feature stays useful in
// the meantime because the whole point of pre-loading deals is to have the post
// written and waiting: an embargoed deal is not refused, it is SCHEDULED for the
// moment the embargo ends.

import type { DealOccasionSlug } from '@/lib/deal-occasion'

/** When each event's DATES may first be named publicly.
 *
 *  Keyed by occasion because that is what a post puts in its title and badge.
 *  An event that is not listed has no announcement embargo, which is the normal
 *  case: Black Friday's date is not a secret.
 *
 *  Add a line here when Amazon announces the next one. An absent entry means
 *  "no embargo", so forgetting to add one fails open, which is why the
 *  per-deal rule below exists independently and does not rely on this list. */
export const EVENT_ANNOUNCE_EMBARGO: Partial<Record<DealOccasionSlug, string>> = {
  // "communicated only after September 14, 2026 at 10:00 PM PDT" (UTC-7).
  prime_big_deal_days: '2026-09-15T05:00:00.000Z',
}

export type DealBlockReason = 'deal-not-live' | 'event-not-announced'

export interface DealEmbargoVerdict {
  /** True when publishing right now would breach the embargo. */
  blocked: boolean
  reason: DealBlockReason | null
  /** The earliest moment this post may go live, as an ISO string. Feed it
   *  straight to the scheduler: the article is generated now and WordPress
   *  flips it live at exactly this time. */
  publishableAt: string | null
  /** One sentence for the creator. Says what is held and until when. */
  message: string | null
}

const OK: DealEmbargoVerdict = { blocked: false, reason: null, publishableAt: null, message: null }

function parse(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d
}

/** Human date for a message. UTC, spelled out, so there is no ambiguity about
 *  whose timezone a creator is reading. */
function human(d: Date): string {
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC', hour12: false,
  }) + ' UTC'
}

/**
 * May this deal post be published right now?
 *
 * `dealStartsAt` is the deal's own start time from the Deals Hub export. When
 * it is in the future the deal is not live on amazon.com yet, and Amazon's rule
 * is explicit that it cannot be published before it is.
 *
 * `occasion` is checked separately: a post can be about a deal that IS live
 * while still naming an event whose dates are not yet announced.
 *
 * The later of the two wins, because both have to be satisfied.
 */
export function dealEmbargo(args: {
  dealStartsAt?: string | Date | null
  occasion?: DealOccasionSlug | null
  now?: Date
}): DealEmbargoVerdict {
  const now = args.now ?? new Date()

  const starts = parse(args.dealStartsAt)
  const announce = args.occasion ? parse(EVENT_ANNOUNCE_EMBARGO[args.occasion] ?? null) : null

  const dealHeld = starts != null && starts.getTime() > now.getTime()
  const eventHeld = announce != null && announce.getTime() > now.getTime()
  if (!dealHeld && !eventHeld) return OK

  // Both can apply at once. The post cannot go out until the later one lifts,
  // and the reason names whichever that is, because that is the one the creator
  // is waiting on.
  const dealMs = dealHeld ? starts!.getTime() : -Infinity
  const eventMs = eventHeld ? announce!.getTime() : -Infinity
  const useDeal = dealMs >= eventMs
  const until = new Date(Math.max(dealMs, eventMs))

  return {
    blocked: true,
    reason: useDeal ? 'deal-not-live' : 'event-not-announced',
    publishableAt: until.toISOString(),
    message: useDeal
      ? `This deal does not start on Amazon until ${human(until)}. Amazon's terms allow publishing only once a deal is live, so the post will be written now and scheduled to go out then.`
      : `Amazon has not announced this event's dates yet. They can be named from ${human(until)}, so the post will be written now and scheduled to go out then.`,
  }
}

/** May this event be NAMED in copy right now? Used to grey out an occasion in
 *  the picker, so a creator is not offered a badge they are not allowed to
 *  print yet. */
export function canNameEvent(occasion: DealOccasionSlug | null | undefined, now: Date = new Date()): boolean {
  if (!occasion) return true
  const announce = parse(EVENT_ANNOUNCE_EMBARGO[occasion] ?? null)
  return announce == null || announce.getTime() <= now.getTime()
}
