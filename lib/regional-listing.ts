// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHERE IS THIS PRODUCT SOLD, AND UNDER WHICH ASIN, before anything is made.
//
// Liftoff asks this before it shows the country cards. "Is B0X sold in
// Germany?" answered by the US ASIN alone says No for a product Germany sells
// under its own ASIN, so a No is not the end of the question:
//
//   1. the same ASIN, from the shared stock cache or Keepa (lib/product-availability)
//   2. a listing there with the same barcode (UPC/EAN)
//   3. a listing there with the same brand and model number, or, in a store of
//      the same language, the same brand and a closely matching name
//      (lib/asin-equivalent, the same strict rules the coverage drain uses)
//   4. that local ASIN's own stock, from the same place as step 1
//
// Steps 2 and 3 are remembered per (source ASIN, country) in
// asin_market_equivalent (migration 387), across every creator, so a page
// that is opened ten times pays for them once. Without the table it still
// answers; it just asks Keepa again next time, within the same budget.
//
// THREE KINDS OF "NO", KEPT APART. Not sold (everything was tried), not
// checked yet (budget or Keepa ran out before step 3 finished) and cannot be
// checked (Australia, which Keepa does not cover) are different facts, and
// only the first may hide a country.

import { marketByDomain } from '@/lib/markets'
import { availabilityKey, lookupAvailability, MIN_KEEPA_TOKENS } from '@/lib/product-availability'
import { pickEquivalent, pickByName, nameSearchTerm } from '@/lib/asin-equivalent'
import { fetchKeepaIdentity, fetchKeepaByCodes, fetchKeepaSearch, fetchKeepaTokenStatus, keepaConfigured } from '@/services/keepa'

/** A found listing is kept longer than a "none", which a new listing can end. */
const FOUND_DAYS = 60
const NONE_DAYS = 14

export type RegionalVerdict = 'sold' | 'out_of_stock' | 'not_sold' | 'cannot_check' | 'not_checked'
export type RegionalAnswer = {
  verdict: RegionalVerdict
  /** The ASIN to use in that country, when it is not the source ASIN. */
  localAsin: string | null
  /** How the local ASIN was found: 'barcode' | 'model' | 'name'. */
  how: string | null
}
export type RegionalSkip = 'keepa_unconfigured' | 'low_tokens' | null

const up = (s: string) => String(s || '').trim().toUpperCase()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

/** Cached equivalents for these (asin, domain) pairs, fresh ones only. */
async function readCache(sb: Sb, pairs: Array<{ asin: string; domain: string }>): Promise<Map<string, { local: string | null; how: string | null }>> {
  const out = new Map<string, { local: string | null; how: string | null }>()
  const asins = [...new Set(pairs.map((p) => up(p.asin)))]
  if (!asins.length) return out
  try {
    const { data, error } = await sb.from('asin_market_equivalent')
      .select('source_asin,domain,local_asin,how,checked_at').in('source_asin', asins)
    if (error) return out
    const now = Date.now()
    for (const r of (data ?? []) as Array<{ source_asin: string; domain: string; local_asin: string | null; how: string | null; checked_at: string }>) {
      const age = (now - new Date(r.checked_at).getTime()) / 86_400_000
      if (age > (r.local_asin ? FOUND_DAYS : NONE_DAYS)) continue
      out.set(availabilityKey(r.source_asin, r.domain), { local: r.local_asin ? up(r.local_asin) : null, how: r.how })
    }
  } catch { /* no table yet: every pair is a miss, which is correct */ }
  return out
}

async function writeCache(sb: Sb, rows: Array<{ source_asin: string; domain: string; local_asin: string | null; how: string | null }>): Promise<void> {
  if (!rows.length) return
  try {
    await sb.from('asin_market_equivalent').upsert(
      rows.map((r) => ({ ...r, checked_at: new Date().toISOString() })),
      { onConflict: 'source_asin,domain' },
    )
  } catch { /* remembered next time instead */ }
}

/**
 * Every (asin, domain) pair answered, following the steps above. `searchBudget`
 * caps the brand-and-name searches (about ten Keepa tokens each); the barcode
 * step is one call per country and is not capped.
 */
export async function lookupRegional(
  sb: Sb,
  pairs: Array<{ asin: string; domain: string }>,
  opts: { lookupBudget: number; searchBudget: number },
): Promise<{ answers: Map<string, RegionalAnswer>; skipped: RegionalSkip }> {
  const key = availabilityKey
  const answers = new Map<string, RegionalAnswer>()
  const norm = pairs.map((p) => ({ asin: up(p.asin), domain: p.domain }))

  // 1. The same ASIN.
  const first = await lookupAvailability(sb, norm, { lookupBudget: opts.lookupBudget })
  let skipped: RegionalSkip = first.skipped ?? null
  const fromStock = (a: string | undefined): RegionalVerdict =>
    a === 'in_stock' ? 'sold' : a === 'out_of_stock' ? 'out_of_stock' : a === 'not_listed' ? 'not_sold' : a === 'no_answer' ? 'cannot_check' : 'not_checked'
  for (const p of norm) answers.set(key(p.asin, p.domain), { verdict: fromStock(first.answers.get(key(p.asin, p.domain))), localAsin: null, how: null })

  // 2 and 3 only for "not sold under this ASIN" in a country Keepa covers.
  const missing = norm.filter((p) => answers.get(key(p.asin, p.domain))?.verdict === 'not_sold' && marketByDomain(p.domain)?.keepa != null)
  if (!missing.length) return { answers, skipped }

  // Until steps 2 and 3 have answered, a No under the US ASIN is not a No.
  for (const p of missing) answers.set(key(p.asin, p.domain), { verdict: 'not_checked', localAsin: null, how: null })

  const cached = await readCache(sb, missing)
  const locals = new Map<string, { local: string | null; how: string | null }>()
  for (const p of missing) { const c = cached.get(key(p.asin, p.domain)); if (c) locals.set(key(p.asin, p.domain), c) }

  const todo = missing.filter((p) => !locals.has(key(p.asin, p.domain)))
  if (todo.length) {
    const tok = keepaConfigured() ? await fetchKeepaTokenStatus() : null
    if (!keepaConfigured()) skipped = 'keepa_unconfigured'
    else if (tok?.tokensLeft != null && tok.tokensLeft < MIN_KEEPA_TOKENS) skipped = 'low_tokens'
    else {
      let searchesLeft = tok?.tokensLeft != null && tok.tokensLeft < MIN_KEEPA_TOKENS + opts.searchBudget * 10 ? 0 : opts.searchBudget
      // Who each product is (barcodes, brand, model, name), from the US store.
      const ids = await fetchKeepaIdentity([...new Set(todo.map((p) => p.asin))])
      const write: Array<{ source_asin: string; domain: string; local_asin: string | null; how: string | null }> = []
      const byDomain = new Map<string, typeof todo>()
      for (const p of todo) byDomain.set(p.domain, [...(byDomain.get(p.domain) ?? []), p])
      for (const [domain, list] of byDomain) {
        const mkt = marketByDomain(domain)!
        const readable = list.filter((p) => ids.has(p.asin))
        const codes = [...new Set(readable.flatMap((p) => ids.get(p.asin)?.codes ?? []))]
        const listings = codes.length ? await fetchKeepaByCodes(codes, mkt.keepa as number) : []
        if (listings === null) continue // not looked at: stays "not checked"
        for (const p of readable) {
          const src = ids.get(p.asin)!
          const byCode = pickEquivalent(src.codes, listings, p.asin)
          if (byCode) { locals.set(key(p.asin, domain), { local: byCode, how: 'barcode' }); write.push({ source_asin: p.asin, domain, local_asin: byCode, how: 'barcode' }); continue }
          const term = nameSearchTerm(src)
          if (term && searchesLeft <= 0) continue // owed a search: stays "not checked"
          if (term) {
            searchesLeft--
            const hits = await fetchKeepaSearch(term, mkt.keepa as number)
            if (hits === null) continue
            const m = pickByName(src, hits, mkt.lang.startsWith('en'))
            if (m) { locals.set(key(p.asin, domain), { local: m.asin, how: m.how }); write.push({ source_asin: p.asin, domain, local_asin: m.asin, how: m.how }); continue }
          }
          // Everything there is to try was tried.
          locals.set(key(p.asin, domain), { local: null, how: null })
          write.push({ source_asin: p.asin, domain, local_asin: null, how: null })
        }
      }
      await writeCache(sb, write)
    }
  }

  // 4. A local ASIN is checked like any other, never assumed to be buyable.
  const localPairs = missing.flatMap((p) => { const l = locals.get(key(p.asin, p.domain))?.local; return l ? [{ asin: l, domain: p.domain }] : [] })
  const second = localPairs.length ? await lookupAvailability(sb, localPairs, { lookupBudget: opts.lookupBudget }) : null
  if (second?.skipped && !skipped) skipped = second.skipped
  for (const p of missing) {
    const l = locals.get(key(p.asin, p.domain))
    if (!l) continue // left "not checked"
    if (!l.local) { answers.set(key(p.asin, p.domain), { verdict: 'not_sold', localAsin: null, how: null }); continue }
    const v = fromStock(second?.answers.get(key(l.local, p.domain)))
    // The local listing exists (it was found there); unknown stock is "sold",
    // the way the stock cache already reads a listing with no buy-box answer.
    answers.set(key(p.asin, p.domain), { verdict: v === 'not_checked' ? 'sold' : v, localAsin: l.local, how: l.how })
  }
  return { answers, skipped }
}

/** Remembered local ASINs only, no Keepa: for the hand-off to the Amazon side,
 *  which must not spend tokens or wait on a search. */
export async function cachedLocalAsins(sb: Sb, asin: string, domains: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const c = await readCache(sb, domains.map((d) => ({ asin, domain: d })))
  for (const d of domains) { const l = c.get(availabilityKey(asin, d))?.local; if (l) out.set(d, l) }
  return out
}
