// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WORTH A TEST (Seb, 2026-11-20, on The Perfect Jean: "maybe a leap of faith
// ... if you create 5 or 10 videos on this and to test, maybe this is a good
// brand to test, especially if the brand is brand new ... on Tribe for 36
// days, and creators have earned 30K plus. That's not a bad brand to deal
// with"). MVP's read of a niche can say "not a fit" about a brand whose own
// numbers say it pays. When a brand is new on TRYBE and already paid out, or
// has room and pays and is liked, the brand page says so: test it with 5 to
// 10 videos, with each reason in TRYBE's own numbers, and the catch (a cap
// per video) said plainly. Pure, so it is tested (scripts/test-trybe-test-call.ts).

/** A brand this young on TRYBE counts as new. */
export const NEW_DAYS = 90
/** Paid out to its creators, in dollars, before a test is worth it. */
export const TEST_MIN_PAID = 10_000
/** Fewer creators than this leaves room for one more. */
export const ROOM_CREATORS = 500

export interface TestCallInput {
  daysOnTrybe: number | null
  /** Paid out to its creators, in dollars (lib/trybe-daily paidOutOf). */
  paidOut: number | null
  /** The same, as TRYBE says it ("$30K+"). */
  earnedWords: string | null
  creators: number | null
  rating: number | null
  reviews: number | null
  score: number | null
  /** The most one video can earn (lib/trybe-pay maxPer). */
  maxPer: number | null
  /** MVP's fit check said not a fit for the creator's niche. */
  notFit: boolean
}

export interface TestCall { title: string; why: string[]; plan: string; caveats: string[] }

const money = (n: number) => (n >= 1000 ? `$${(Math.round(n / 100) / 10).toLocaleString('en-US')}K` : `$${Math.round(n)}`)

/** Whether a brand is worth a test of 5 to 10 videos, and why, in its own
 *  numbers; null when its numbers do not say so. Pure. */
export function testCall(i: TestCallInput): TestCall | null {
  const paid = i.paidOut != null && i.paidOut >= TEST_MIN_PAID
  const fresh = i.daysOnTrybe != null && i.daysOnTrybe <= NEW_DAYS
  const room = i.creators != null && i.creators < ROOM_CREATORS
  const liked = i.rating != null && i.rating >= 4.5 && (i.reviews ?? 0) >= 5
  const quick = i.score != null && i.score >= 80
  if (!paid || !(fresh || (room && (liked || quick)))) return null
  const earned = i.earnedWords || money(i.paidOut as number)
  const why: string[] = []
  why.push(fresh ? `On TRYBE ${i.daysOnTrybe} day${i.daysOnTrybe === 1 ? '' : 's'}, and its creators have already earned ${earned}.` : `Its creators have earned ${earned}.`)
  if (room) why.push(`${(i.creators as number).toLocaleString('en-US')} creators work with it, so each one gets more of its budget.`)
  if (liked) why.push(`${(i.rating as number).toFixed(1)} ★ from ${i.reviews} creators who worked with it.`)
  if (quick) why.push(`TRYBE score ${Math.round(i.score as number)}: it reviews, launches ads and answers quickly.`)
  const caveats: string[] = []
  if (i.notFit) caveats.push('MVP’s read of your niche said not a fit. Five to ten videos tell you more than that read: if one or two are approved and run as ads, keep going.')
  if (i.maxPer != null) caveats.push(`It caps what one video can earn at ${money(i.maxPer)}. That only matters if a video wins big, so it is no reason to skip a test.`)
  return {
    title: 'Worth a test: 5 to 10 videos',
    why,
    plan: 'Ask to join, film 5 to 10 videos of one product, and look at what it approves and runs as ads within two weeks.',
    caveats,
  }
}
