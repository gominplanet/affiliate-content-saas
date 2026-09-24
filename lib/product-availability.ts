// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Is this product sold in that Amazon country? One answer, wherever it is asked.
//
// ONE PLACE. The coverage grid asked this before preparing a country, and a
// launch batch found out only afterwards, as "Amazon does not sell this product
// in Canada" on six of seven countries for a video already launched. The batch
// now asks while the creator is still choosing countries, and it asks HERE, the
// same function the grid uses, reading and writing the same shared cache. Two
// screens that could disagree about whether Germany sells the product would be
// worse than one that said nothing.
//
// THE ORDER, cheapest first:
//   1. Countries no server can answer (Australia has no Keepa domain): settled
//      as 'no_answer', which never blocks.
//   2. The shared cache (passport_asin_market), across every creator, fresh for
//      STOCK_CACHE_DAYS. Free.
//   3. Keepa, paid, within the caller's budget, one call per country for up to
//      a hundred ASINs, written back to the cache for everybody.
// A pair nobody could answer is simply absent from the map. That is not a
// verdict, and callers must not treat it as "not sold".

import { marketByDomain } from '@/lib/markets'
import { fetchKeepaBasics, fetchKeepaTokenStatus, keepaConfigured } from '@/services/keepa'
import type { StockAnswer } from '@/lib/storefront-coverage'

/** How long a cached answer stands. Whether a product is sold in a country at
 *  all barely changes; whether it is buyable today changes weekly. Two weeks is
 *  the compromise, and a wrong "out of stock" only costs ordering, never a
 *  block. */
export const STOCK_CACHE_DAYS = 14
/** Yield the shared Keepa pool below this. Deal Radar and the Finder are
 *  somebody waiting on a screen; background checks give way to them. */
export const MIN_KEEPA_TOKENS = 200

export const availabilityKey = (asin: string, domain: string) => `${asin.toUpperCase()}:${domain}`

export async function lookupAvailability(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  pairs: Array<{ asin: string; domain: string }>,
  opts: { lookupBudget: number },
): Promise<{ answers: Map<string, StockAnswer>; spent: number; skipped?: 'keepa_unconfigured' | 'low_tokens' }> {
  const key = availabilityKey
  const answers = new Map<string, StockAnswer>()
  let spent = 0

  // 1. Markets no server can answer.
  for (const r of pairs) if (marketByDomain(r.domain)?.keepa == null) answers.set(key(r.asin, r.domain), 'no_answer')
  const askable = pairs.filter((r) => marketByDomain(r.domain)?.keepa != null)

  // 2. The shared cache, across every creator.
  const fresh = new Date(Date.now() - STOCK_CACHE_DAYS * 86_400_000).toISOString()
  const wantedAsins = [...new Set(askable.map((r) => r.asin.toUpperCase()))]
  if (wantedAsins.length > 0) {
    try {
      const { data: cached } = await sb.from('passport_asin_market')
        .select('asin,marketplace,available,in_stock')
        .in('asin', wantedAsins).gte('checked_at', fresh)
      const domains = [...new Set(askable.map((r) => r.domain))]
      for (const c of (cached ?? [])) {
        const mkt = domains.find((d) => marketByDomain(d)?.host.toLowerCase() === String(c.marketplace).toLowerCase())
        if (!mkt) continue
        // in_stock is NULL where the writer did not know the buy box (SCOUT's
        // /dp probe answers existence only), and that is recorded as listed
        // rather than invented as out of stock.
        const a: StockAnswer = !c.available ? 'not_listed' : (c.in_stock === false ? 'out_of_stock' : 'in_stock')
        answers.set(key(String(c.asin), mkt), a)
      }
    } catch { /* no cache → everything below is a miss, which is correct */ }
  }

  // 3. What is left is paid for, within budget, in the order given.
  const misses = askable.filter((r) => !answers.has(key(r.asin, r.domain)))
  if (misses.length === 0) return { answers, spent }
  if (!keepaConfigured()) return { answers, spent, skipped: 'keepa_unconfigured' }
  const tok = await fetchKeepaTokenStatus()
  if (tok.tokensLeft != null && tok.tokensLeft < MIN_KEEPA_TOKENS) return { answers, spent, skipped: 'low_tokens' }

  const byDomain = new Map<string, Set<string>>()
  for (const r of misses) byDomain.set(r.domain, (byDomain.get(r.domain) ?? new Set()).add(r.asin.toUpperCase()))

  let budget = opts.lookupBudget
  const now = new Date().toISOString()
  const writeBack: Array<Record<string, unknown>> = []
  for (const [domain, asinSet] of byDomain) {
    if (budget <= 0) break
    const mkt = marketByDomain(domain)
    if (!mkt || mkt.keepa == null) continue
    const batch = [...asinSet].slice(0, budget)
    let info: Awaited<ReturnType<typeof fetchKeepaBasics>>
    try {
      info = await fetchKeepaBasics(batch, mkt.keepa)
    } catch {
      continue // left unanswered, so the next ask retries it
    }
    budget -= batch.length
    spent += batch.length
    for (const asin of batch) {
      const p = info.get(asin)
      // ABSENT FROM THE RESPONSE = the lookup did not happen for this ASIN.
      if (!p) continue
      const listed = !!p.title
      answers.set(key(asin, domain), !listed ? 'not_listed' : (p.priceNowCents != null ? 'in_stock' : 'out_of_stock'))
      writeBack.push({
        asin, marketplace: mkt.host.toLowerCase(), available: listed,
        in_stock: listed ? p.priceNowCents != null : false,
        price_cents: p.priceNowCents ?? null, checked_at: now,
      })
    }
  }
  if (writeBack.length > 0) {
    try {
      await sb.from('passport_asin_market').upsert(writeBack, { onConflict: 'asin,marketplace' })
    } catch { /* the cache is best-effort; the answers still stand */ }
  }
  return { answers, spent }
}
