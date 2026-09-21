// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Hand everything that is ready to SCOUT, and say what actually happened.
//
// ONE DELIVERY PATH. The storefront board had this inline, and the launch page
// needed the same thing. Copying it would have produced two uploaders that
// agreed until the first time one of them learned something: the dub check, the
// daily cap, the order of the calls. Those are not details, they are the
// difference between a correct listing and a French storefront playing English
// audio.
//
// WHY THE LAUNCH PAGE NEEDS IT AT ALL. Its result box said "Your Amazon stores
// need this tab open, because MVP uploads through your own logged-in Creator
// account". That was false on that page: it used SCOUT to check sign-in and
// never uploaded anything, so the tab it asked you to keep open did nothing for
// Amazon. The sentence is now true, which is the better of the two ways to fix
// a screen that says something untrue.

import { requestStorefrontDelivery } from '@/lib/extension-frame'
import { fetchWithTimeout } from '@/lib/fetch-timeout'

export interface DeliveryOutcome {
  /** SCOUT accepted the batch. NOT that every listing is live: Amazon confirms
   *  those one at a time afterwards, and the board reports that separately. */
  ok: boolean
  /** Why not, in SCOUT's words where it gave any. */
  error?: string
  /** How many were handed over. */
  handedOver: number
  /** Ready in every way except their translated audio. NOT a failure, and not
   *  uploaded either: English audio under a French title is invisible from
   *  every angle except a French shopper pressing play. */
  waitingOnDub: number
  /** Storefronts that have had their allowance today, in their own words. */
  atCap: string[]
  /** What is left today, per storefront. */
  dailyRoom: Array<{ domain: string; country: string; cap: number; used: number; left: number }>
  /** Nothing was ready at all, which is different from something going wrong. */
  nothingReady: boolean
}

/**
 * Upload everything prepared, respecting Amazon's own daily limit.
 *
 * The queue does the counting and the capping; this does the handing over and
 * the reporting. Neither decides the rules on its own.
 */
export async function deliverPreparedStorefronts(): Promise<DeliveryOutcome> {
  const empty: DeliveryOutcome = {
    ok: false, handedOver: 0, waitingOnDub: 0, atCap: [], dailyRoom: [], nothingReady: false,
  }
  let j: Record<string, unknown>
  try {
    // BOUNDED. The queue counts deliveries per storefront against Postgres and
    // can be slow on a large account, but a request with no deadline leaves the
    // button spinning forever with nothing to report.
    const q = await fetchWithTimeout('/api/global-sync/deliver/queue', { timeoutMs: 60_000 })
    j = await q.json() as Record<string, unknown>
  } catch {
    return { ...empty, error: 'Could not reach MVP to work out what is ready.' }
  }

  const all = Array.isArray(j.items) ? j.items : []
  // A MARKET THAT WANTED A DUB AND HAS NOT GOT ONE IS NOT UPLOADED.
  //
  // The queue serves the master render when a target has no dubbed file, which
  // is right for the English stores and right for a creator who deliberately
  // skipped the dub on one video. It is wrong here: nothing in the catalogue
  // grid skips a dub on purpose, so a master fallback in this list is a dub
  // that has not finished.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = all.filter((i: any) => !i?.audioIsMasterFallback)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const waiting = all.filter((i: any) => i?.audioIsMasterFallback)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const atCap = (Array.isArray(j.skipped) ? j.skipped : [] as any[])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((x: any) => /daily limit/i.test(String(x?.reason || '')))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((x: any) => String(x.reason))
  const dailyRoom = (Array.isArray(j.dailyRoom) ? j.dailyRoom : []) as DeliveryOutcome['dailyRoom']

  if (items.length === 0) {
    return { ...empty, nothingReady: true, waitingOnDub: waiting.length, atCap, dailyRoom }
  }

  const res = await requestStorefrontDelivery(items)
  if (!res?.ok) {
    return {
      ...empty, waitingOnDub: waiting.length, atCap, dailyRoom,
      error: res?.error || 'SCOUT could not upload.',
    }
  }
  return {
    ok: true, handedOver: items.length, waitingOnDub: waiting.length, atCap, dailyRoom,
    nothingReady: false,
  }
}

/**
 * What the creator should read after pressing upload.
 *
 * REPORTS WHAT HAPPENED. Every sentence here describes a fact the outcome
 * carries, and the held-back cases are named rather than folded into a number
 * that looks like a success.
 */
export function deliverySummary(o: DeliveryOutcome): string[] {
  const out: string[] = []
  if (o.error) { out.push(o.error); return out }
  if (o.nothingReady) {
    out.push(o.waitingOnDub > 0
      ? `${o.waitingOnDub} ${o.waitingOnDub === 1 ? 'listing is' : 'listings are'} still waiting on their translated audio. They go up as soon as the voiceover is done.`
      : 'Nothing is prepared yet. The background worker fills this as it goes.')
  } else if (o.ok) {
    out.push(`${o.handedOver} handed to Amazon. The board updates as each one is confirmed.`)
    if (o.waitingOnDub > 0) {
      out.push(`${o.waitingOnDub} held back until their translated audio is ready.`)
    }
  }
  // THE CAP IS AMAZON'S AND THE ONLY REMEDY IS TOMORROW, so it is said whether
  // or not anything went up: a number that stops moving reads as a break.
  for (const r of o.atCap.slice(0, 3)) out.push(r)
  return out
}
