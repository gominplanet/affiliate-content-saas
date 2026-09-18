// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AN ANNUAL PLAN IS TWELVE MONTHLY WINDOWS, NOT ONE ENORMOUS ONE.
//
// Two annual Stripe prices were added: Amazon at $999 and Pro at $1999, against
// $99 and $199 a month. Selling them touches two things that would each fail
// silently, and both would fail against the customer who just paid the most.
//
// THE ALLOWANCES. Every cap in lib/tier is monthly, and they are enforced by
// counting usage since the start of billingWindow(). Until now that window WAS
// the Stripe period, because a Stripe period was always a month. An annual
// subscription's period is a year, so handing it back unchanged would turn
// every monthly cap into an annual one: a Pro annual customer would get fifty
// Shorts for the year instead of fifty a month, and one month of posts to last
// twelve, with the usage card reporting a reset date next summer. They pay
// $1999 up front and receive a twelfth of the product.
//
// THE GRANT. The webhook maps a Stripe price id to a tier. An annual price
// missing from that map is a customer who paid a year up front and was granted
// nothing at all.
//
// Neither has a loud failure mode, which is why both are pinned here.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { billingWindow, addMonthsUTC } from '../lib/tier'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const live = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const STRIPE = live(read('lib/stripe.ts'))
const CHECKOUT = live(read('app/api/stripe/checkout/route.ts'))

const iso = (s: string) => new Date(s + 'T00:00:00.000Z')
const days = (n: number) => n * 24 * 60 * 60 * 1000

// ── a monthly subscription is unchanged ─────────────────────────────────────
//
// The overwhelming majority of subscribers. A change made for annual that moved
// anybody's monthly window would be a far bigger incident than the one it fixed.
{
  const w = billingWindow({
    periodStart: '2026-09-14T10:30:00.000Z',
    periodEnd: '2026-10-14T10:30:00.000Z',
    now: iso('2026-09-20'),
  })
  check('a monthly period is still used exactly as Stripe gave it',
    w.startISO === '2026-09-14T10:30:00.000Z', w.startISO)
  check('and still resets on the real billing date',
    w.resetLabel === 'Oct 14', w.resetLabel)

  const free = billingWindow({ periodStart: null, periodEnd: null, now: iso('2026-09-20') })
  check('a free user still falls back to the calendar month',
    free.startISO === '2026-09-01T00:00:00.000Z', free.startISO)

  // WHY THE THRESHOLD IS LOAD-BEARING, and it is not obvious: slicing a normal
  // 30-day period happens to produce the identical window, so lowering the
  // threshold looks harmless. It is not. An IRREGULAR short cycle, which Stripe
  // produces after a trial or a mid-cycle plan change, ends on a date that is
  // not start-plus-one-month, and a sliced window would report the anniversary
  // instead of the date Stripe will actually bill and reset on.
  const shortCycle = billingWindow({
    periodStart: '2026-09-14T10:30:00.000Z',
    periodEnd: '2026-10-01T00:00:00.000Z',
    now: iso('2026-09-20'),
  })
  check('an irregular short cycle reports the date Stripe will actually reset on',
    shortCycle.resetLabel === 'Oct 1', shortCycle.resetLabel)
}

// ── an annual subscription is sliced ────────────────────────────────────────
{
  const start = '2026-09-14T10:30:00.000Z'
  const end = '2027-09-14T10:30:00.000Z'

  const first = billingWindow({ periodStart: start, periodEnd: end, now: iso('2026-09-20') })
  check('month one starts on the subscription date',
    first.startISO === start, first.startISO)
  check('and resets a month later, not a year later',
    first.resetLabel === 'Oct 14', first.resetLabel)

  const third = billingWindow({ periodStart: start, periodEnd: end, now: iso('2026-11-20') })
  check('month three is its own window',
    third.startISO === '2026-11-14T10:30:00.000Z', third.startISO)
  check('and resets on the next anniversary',
    third.resetLabel === 'Dec 14', third.resetLabel)

  // The moment that matters most: the day before and the day after a monthly
  // anniversary must be different windows, or a customer's allowance either
  // resets a day early or a day late every single month.
  const dayBefore = billingWindow({ periodStart: start, periodEnd: end, now: iso('2026-10-13') })
  const dayAfter = billingWindow({ periodStart: start, periodEnd: end, now: iso('2026-10-15') })
  check('the window rolls over on the anniversary, not before it',
    dayBefore.startISO === start, dayBefore.startISO)
  check('and has rolled over the day after',
    dayAfter.startISO === '2026-10-14T10:30:00.000Z', dayAfter.startISO)

  const last = billingWindow({ periodStart: start, periodEnd: end, now: iso('2027-09-01') })
  check('the twelfth month is still a month, not a stub',
    last.startISO === '2027-08-14T10:30:00.000Z', last.startISO)

  // THE BUG THIS FILE EXISTS FOR, stated as an assertion: the window must never
  // be the whole year, because that is what silently converts every monthly cap
  // into an annual one.
  for (const when of ['2026-09-20', '2026-12-25', '2027-04-02', '2027-08-30']) {
    const w = billingWindow({ periodStart: start, periodEnd: end, now: iso(when) })
    const span = iso(when).getTime() - new Date(w.startISO).getTime()
    check(`on ${when} the allowance window is at most a month old`,
      span <= days(32), `${Math.round(span / days(1))} days`)
  }
}

// ── month ends do not drift ─────────────────────────────────────────────────
//
// A subscription starting on the 31st has no 31 February to renew on, and a
// naive setUTCMonth rolls into March, moving the customer's reset date three
// days every other month for a year.
{
  check('31 Jan plus one month clamps to 28 Feb',
    addMonthsUTC(iso('2026-01-31'), 1).toISOString().startsWith('2026-02-28'),
    addMonthsUTC(iso('2026-01-31'), 1).toISOString())
  check('and plus two months returns to the 31st',
    addMonthsUTC(iso('2026-01-31'), 2).toISOString().startsWith('2026-03-31'),
    addMonthsUTC(iso('2026-01-31'), 2).toISOString())
  check('a leap February is respected',
    addMonthsUTC(iso('2028-01-31'), 1).toISOString().startsWith('2028-02-29'),
    addMonthsUTC(iso('2028-01-31'), 1).toISOString())
  check('30 Nov plus one month is 30 Dec, not 31',
    addMonthsUTC(iso('2026-11-30'), 1).toISOString().startsWith('2026-12-30'),
    addMonthsUTC(iso('2026-11-30'), 1).toISOString())

  const w = billingWindow({
    periodStart: '2026-01-31T09:00:00.000Z',
    periodEnd: '2027-01-31T09:00:00.000Z',
    now: iso('2026-03-15'),
  })
  check('an annual plan bought on the 31st still gets clean monthly windows',
    w.startISO === '2026-02-28T09:00:00.000Z', w.startISO)
}

// ── the webhook can recognise what was bought ───────────────────────────────
{
  check('annual price ids are configured from their own env vars',
    /STRIPE_PRICE_PRO_ANNUAL/.test(STRIPE) && /STRIPE_PRICE_AMAZON_ANNUAL/.test(STRIPE))
  check('and are folded into the list the webhook maps to tiers',
    /\.\.\.ANNUAL_PRICE_ID_LIST\.pro/.test(STRIPE) && /\.\.\.ANNUAL_PRICE_ID_LIST\.amazon/.test(STRIPE),
    'an annual price missing here is a year paid for and nothing granted')
  check('the annual ids are kept in their own list, not merged into the monthly one',
    /export const ANNUAL_PRICE_ID_LIST/.test(STRIPE),
    'PRICE_IDS takes the FIRST id as what a new buyer pays; an annual id in front of it would charge everybody a year up front')
  check('there is an honest answer for a tier with no annual price',
    /export function annualPriceIdFor/.test(STRIPE) && /list\.length > 0 \? list\[0\]! : null/.test(STRIPE))
}

// ── checkout charges yearly only when yearly exists ─────────────────────────
{
  check('checkout accepts an interval',
    /interval\?: BillingInterval/.test(CHECKOUT))
  check('and defaults to monthly for every existing caller',
    /const wantsAnnual = interval === 'year'/.test(CHECKOUT),
    'absent, or anything but year, must mean month')
  check('the annual price is preferred only when it resolves',
    /const priceId = annualId \?\? PRICE_IDS\[/.test(CHECKOUT))
  check('and a yearly request with no annual price is reported, not swallowed',
    /Yearly checkout requested with no annual price configured/.test(read('app/api/stripe/checkout/route.ts')),
    'charging monthly under a yearly button is a small lie somebody needs to know about')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
