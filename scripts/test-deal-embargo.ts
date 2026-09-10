// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MVP must not walk a creator into breaking Amazon's deal embargo.
//
// The Deals Hub prints this on every page:
//
//   "Deals are confidential and can be published only on or after they are
//    published on www.amazon.com. Prime Big Deal Days dates are confidential
//    and can be communicated only after September 14, 2026 at 10:00 PM PDT."
//
// Two rules, and a tool that turns a queued deal into a live post in one click
// breaks both by accident. A creator exports the hub in September, sees the
// October deals sitting in the queue, presses Generate, and publishes a price
// and a date Amazon has not announced. That is their Associates account, not a
// formatting slip.
//
// The feature is not refused, it is deferred: the post is written now and
// scheduled for the moment the embargo lifts. So what these pin is that the hold
// is applied, that it lifts at the right instant, and that it never silently
// passes when it should hold.
import { dealEmbargo, canNameEvent, EVENT_ANNOUNCE_EMBARGO } from '../lib/deal-embargo'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// The situation this was written for: 10 September, looking at October deals.
const SEP = new Date('2026-09-10T12:00:00Z')
const OCT_DEAL = '2026-10-06T07:00:00Z'
const ANNOUNCE = new Date(EVENT_ANNOUNCE_EMBARGO.prime_big_deal_days!)

// ── a deal that has not started ─────────────────────────────────────────────
{
  const v = dealEmbargo({ dealStartsAt: OCT_DEAL, now: SEP })
  check('an October deal is held in September', v.blocked, JSON.stringify(v))
  check('the reason is the deal, not the event', v.reason === 'deal-not-live', String(v.reason))
  check('it is publishable exactly when the deal starts', v.publishableAt === new Date(OCT_DEAL).toISOString(), String(v.publishableAt))
  check('the message names the date', /6 Oct/.test(v.message ?? ''), String(v.message))
}

// ── a deal already running ──────────────────────────────────────────────────
{
  const v = dealEmbargo({ dealStartsAt: '2026-09-01T00:00:00Z', now: SEP })
  check('a live deal is not held', !v.blocked, JSON.stringify(v))
  check('a live deal needs no schedule', v.publishableAt === null)

  // A deal with no known start time cannot be held on that basis. The creator
  // pasting a single ASIN is the normal case and must keep working.
  check('an unknown start time does not block', !dealEmbargo({ now: SEP }).blocked)
  check('a null start time does not block', !dealEmbargo({ dealStartsAt: null, now: SEP }).blocked)
  check('a malformed start time does not block', !dealEmbargo({ dealStartsAt: 'not a date', now: SEP }).blocked)
}

// ── an event whose dates are not announced ──────────────────────────────────
{
  const v = dealEmbargo({ occasion: 'prime_big_deal_days', now: SEP })
  check('naming an unannounced event is held', v.blocked, JSON.stringify(v))
  check('the reason is the event', v.reason === 'event-not-announced', String(v.reason))
  check('it lifts at the announce time', v.publishableAt === ANNOUNCE.toISOString(), String(v.publishableAt))

  // One second either side of the deadline, because an off-by-one here is a
  // published embargo breach.
  const justBefore = new Date(ANNOUNCE.getTime() - 1000)
  const exactly = new Date(ANNOUNCE.getTime())
  check('held one second before', dealEmbargo({ occasion: 'prime_big_deal_days', now: justBefore }).blocked)
  check('released exactly on the deadline', !dealEmbargo({ occasion: 'prime_big_deal_days', now: exactly }).blocked)

  check('canNameEvent agrees with the verdict',
    !canNameEvent('prime_big_deal_days', justBefore) && canNameEvent('prime_big_deal_days', exactly))
  // Events with no embargo are always nameable. Black Friday's date is not a
  // secret and must not be treated as one.
  check('an unembargoed event is always nameable', canNameEvent('black_friday', SEP) && canNameEvent('none', SEP))
  check('no occasion is nameable', canNameEvent(null, SEP) && canNameEvent(undefined, SEP))
}

// ── both at once ────────────────────────────────────────────────────────────
{
  // The October deal starts long after the September announce date, so the DEAL
  // is what the creator is waiting on. The later hold has to win, or the post
  // goes live in the gap between the two.
  const v = dealEmbargo({ dealStartsAt: OCT_DEAL, occasion: 'prime_big_deal_days', now: SEP })
  check('the later hold wins', v.publishableAt === new Date(OCT_DEAL).toISOString(), String(v.publishableAt))
  check('and it is named as the deal', v.reason === 'deal-not-live', String(v.reason))

  // After the announcement, a still-future deal is STILL held. Being allowed to
  // say "Prime Big Deal Days" is not permission to publish October's prices.
  const afterAnnounce = new Date('2026-09-20T00:00:00Z')
  const v2 = dealEmbargo({ dealStartsAt: OCT_DEAL, occasion: 'prime_big_deal_days', now: afterAnnounce })
  check('the deal hold outlives the announcement hold', v2.blocked && v2.reason === 'deal-not-live', JSON.stringify(v2))

  // Once the deal is live, both are clear.
  const during = new Date('2026-10-07T00:00:00Z')
  check('nothing is held once the deal is running',
    !dealEmbargo({ dealStartsAt: OCT_DEAL, occasion: 'prime_big_deal_days', now: during }).blocked)
}

// ── house style ─────────────────────────────────────────────────────────────
{
  for (const v of [
    dealEmbargo({ dealStartsAt: OCT_DEAL, now: SEP }),
    dealEmbargo({ occasion: 'prime_big_deal_days', now: SEP }),
  ]) {
    check('no em-dash or en-dash in creator-facing copy', !/[—–]/.test(v.message ?? ''), String(v.message))
    check('no spaced-hyphen sentence break', !/ - /.test(v.message ?? ''), String(v.message))
    // The no-year rule: a message is copy, and it must not stamp a year in.
    check('no year injected into the message', !/\b20\d\d\b/.test(v.message ?? ''), String(v.message))
  }
}

if (failures.length) {
  console.error(`\n❌ deal-embargo: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ deal-embargo: an unstarted deal and an unannounced event are both held, and the later hold wins')
