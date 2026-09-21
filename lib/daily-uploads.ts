// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// How many more videos Amazon will take today, per storefront.
//
// AMAZON'S RULE, NOT OURS. Twenty a day on amazon.com, ten on every other
// store. Going past it is the kind of thing that gets a Creator account
// flagged, and a launch batch makes it easy to pass without noticing: ten
// videos across five countries is fifty uploads in one evening.
//
// PER STOREFRONT, so five countries are five separate allowances and a full
// France never holds up an empty Japan.
//
// A ROLLING TWENTY-FOUR HOURS, not a calendar day. A limit that resets at
// midnight lets somebody put twenty up at 23:50 and twenty more at 00:10, which
// is forty in twenty minutes however the calendar describes it.
//
// ONE COPY OF THE COUNTING. The upload queue enforces this and the launch page
// reports it, and those two disagreeing is worse than either being wrong on its
// own: the page would promise room the queue then refuses, with no explanation
// anywhere.

import { marketByDomain } from '@/lib/markets'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

export interface DailyRoom {
  domain: string
  country: string
  /** What Amazon takes in a day on this store. */
  cap: number
  /** Delivered in the last twenty-four hours. */
  used: number
  /** What is left, never negative. */
  left: number
}

/** The start of the rolling window, as an ISO string. */
export function windowStart(now: number = Date.now()): string {
  return new Date(now - 24 * 60 * 60_000).toISOString()
}

/**
 * How many each of these storefronts has taken, and how many are left.
 *
 * COUNTED FROM WHAT AMAZON ACTUALLY TOOK, not from what we handed out.
 * Counting the queue would stop a creator short for uploads that never
 * happened, which is the same wall with none of the reason behind it.
 *
 * Counted with a Postgres count rather than a fetched array, because PostgREST
 * caps a response at 1000 rows and a page length has been reported as a total
 * three times in this codebase.
 */
export async function dailyRoomFor(
  sb: Sb, userId: string, domains: string[],
): Promise<DailyRoom[]> {
  const since = windowStart()
  const out: DailyRoom[] = []
  for (const domain of [...new Set(domains)]) {
    const mkt = marketByDomain(domain)
    if (!mkt) continue
    let used = 0
    try {
      const { count } = await sb.from('global_sync_targets')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('domain', domain)
        .eq('state', 'delivered').gte('delivered_at', since)
      used = count ?? 0
    } catch {
      // A count that could not be read is reported as zero used rather than as
      // a full store. Blocking an upload over a failed count would be this
      // module inventing a limit Amazon never set.
      used = 0
    }
    out.push({
      domain, country: mkt.country, cap: mkt.dailyUploads,
      used, left: Math.max(0, mkt.dailyUploads - used),
    })
  }
  return out
}
