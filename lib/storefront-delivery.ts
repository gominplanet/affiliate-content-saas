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
  /** How many SCOUT actually uploaded, by its own per-listing answer. Not how
   *  many were passed to it: that number was reported as "handed to Amazon"
   *  while every upload in it could have failed. */
  handedOver: number
  /** Already on that storefront, so SCOUT skipped it rather than making a
   *  copy. Recorded as present, which it is. */
  duplicates: number
  /** Listings SCOUT tried and could not upload, each with its own reason. */
  failed: Array<{ domain: string; country: string; error: string }>
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
export async function deliverPreparedStorefronts(scope?: {
  /** Only these videos. The launch page passes its batch, because an unscoped
   *  call delivers the creator's ENTIRE account queue: the first real run
   *  picked the US and Germany and watched SCOUT open Spain, France and Italy. */
  videoIds?: string[]
  /** Offer listings that failed last time again. A press says "try again";
   *  an automatic run does not, so a listing Amazon refused is not retried
   *  every two minutes. */
  retryFailed?: boolean
  /** And only these countries, AND-ed with the videos above. Two filters
   *  because the batch knows both, and either one alone still leaves a way to
   *  publish somewhere nobody chose. */
  domains?: string[]
}): Promise<DeliveryOutcome> {
  const empty: DeliveryOutcome = {
    ok: false, handedOver: 0, duplicates: 0, failed: [], waitingOnDub: 0, atCap: [], dailyRoom: [], nothingReady: false,
  }
  let j: Record<string, unknown>
  try {
    // BOUNDED. The queue counts deliveries per storefront against Postgres and
    // can be slow on a large account, but a request with no deadline leaves the
    // button spinning forever with nothing to report.
    const qs = new URLSearchParams()
    if (scope?.videoIds?.length) qs.set('videoIds', scope.videoIds.join(','))
    if (scope?.domains?.length) qs.set('domains', scope.domains.join(','))
    if (scope?.retryFailed) qs.set('retryFailed', '1')
    const q = await fetchWithTimeout(
      `/api/global-sync/deliver/queue${qs.toString() ? `?${qs}` : ''}`,
      { timeoutMs: 60_000 },
    )
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
  if (!res?.ok && !res?.results) {
    return {
      ...empty, waitingOnDub: waiting.length, atCap, dailyRoom,
      error: res?.error || 'SCOUT could not upload.',
    }
  }

  // ── EVERY ANSWER IS RECORDED, THEN COUNTED ─────────────────────────────
  //
  // THIS PATH NEVER RECORDED ANYTHING. SCOUT answers per listing (uploaded,
  // already there, or failed and why), and Video Launchpad has always written
  // those answers back. This helper dropped them: no listing was ever marked
  // delivered, so every press offered the whole set again, and it reported
  // "N handed to Amazon" for however many it passed in, whether or not a
  // single one went up. A creator launched two videos to seven countries, was
  // told they were handed over, and found nothing on any storefront.
  //
  // Written the same way Launchpad writes them, so the coverage grid, the
  // queue and the batch board all read one truth.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byTarget = new Map<string, any>(items.map((i: any) => [String(i.targetId), i]))
  const rows = Array.isArray(res.results) ? res.results : []
  let uploaded = 0, duplicates = 0
  const failed: DeliveryOutcome['failed'] = []
  for (const r of rows) {
    const dup = !r.ok && !!r.duplicate
    const it = byTarget.get(String(r.targetId))
    if (r.ok) uploaded++
    else if (dup) duplicates++
    else failed.push({ domain: String(it?.domain || ''), country: String(it?.country || it?.domain || ''), error: String(r.error || 'no reason given') })
    try {
      await fetchWithTimeout('/api/global-sync/deliver/result', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetId: r.targetId,
          ok: r.ok || dup,
          mediaAci: r.mediaAci ?? null,
          detail: dup ? 'Already on this storefront, skipped duplicate' : (r.ok ? 'Uploaded to storefront' : (r.error || 'Upload failed')),
        }),
        timeoutMs: 15_000,
      })
    } catch { /* the count below still says what happened */ }
  }
  // A listing SCOUT never answered for is a failure too, not a silent gap.
  const answered = new Set(rows.map((r) => String(r.targetId)))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const it of items as any[]) {
    if (!answered.has(String(it.targetId))) failed.push({ domain: String(it.domain || ''), country: String(it.country || it.domain || ''), error: 'SCOUT did not report on this one' })
  }
  return {
    ok: uploaded + duplicates > 0 && failed.length === 0,
    handedOver: uploaded, duplicates, failed,
    waitingOnDub: waiting.length, atCap, dailyRoom,
    nothingReady: false,
    error: uploaded + duplicates === 0 && failed.length > 0
      ? `Nothing uploaded. ${failed.slice(0, 4).map((f) => `${f.country}: ${f.error}`).join('; ')}${failed.length > 4 ? `; and ${failed.length - 4} more` : ''}`
      : undefined,
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
  } else {
    // WHAT SCOUT SAID, per listing: uploaded, already there, failed and why.
    if (o.handedOver > 0) out.push(`${o.handedOver} uploaded to Amazon.`)
    if (o.duplicates > 0) out.push(`${o.duplicates} already on that storefront, so not uploaded again.`)
    if (o.failed.length > 0) {
      out.push(`${o.failed.length} did not upload: ${o.failed.slice(0, 4).map((f) => `${f.country}: ${f.error}`).join('; ')}${o.failed.length > 4 ? `; and ${o.failed.length - 4} more` : ''}.`)
    }
    if (o.waitingOnDub > 0) {
      out.push(`${o.waitingOnDub} held back until their translated audio is ready.`)
    }
  }
  // THE CAP IS AMAZON'S AND THE ONLY REMEDY IS TOMORROW, so it is said whether
  // or not anything went up: a number that stops moving reads as a break.
  for (const r of o.atCap.slice(0, 3)) out.push(r)
  return out
}
