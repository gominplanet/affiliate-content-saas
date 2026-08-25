// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Is a given ASIN a real product in a given Amazon marketplace? Passport routes a
// visitor to their local store with the SAME ASIN, but ASINs aren't listed in
// every marketplace — a US product can 404 on amazon.ca. Before routing local we
// check this and fall back to the US store when the product isn't there, so a
// shopper never lands on a dead page. Cached per (asin, marketplace) in
// passport_asin_market (migration 294) so only the first click pays the lookup.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const CHECK_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/**
 * True if `asin` resolves to a real product on `host` (e.g. www.amazon.ca).
 * Cache-first; on a miss does one bounded GET to <host>/dp/<asin> and caches a
 * definitive 200/404. On timeout / network error / any other status it returns
 * false (so the caller falls back to the US store) WITHOUT caching, so it retries
 * next time rather than pinning a transient failure. Never throws.
 */
export async function localAsinAvailable(admin: Db, asin: string, host: string): Promise<boolean> {
  const a = (asin || '').trim().toUpperCase()
  const h = (host || '').trim().toLowerCase()
  if (!/^[A-Z0-9]{10}$/.test(a) || !h) return false

  // 1) Cache.
  try {
    const { data } = await admin.from('passport_asin_market').select('available').eq('asin', a).eq('marketplace', h).maybeSingle()
    if (data && typeof data.available === 'boolean') return data.available
  } catch { /* table missing → skip cache, do the live check */ }

  // 2) Live check — bounded so it can't stall the redirect. Only 200 counts as
  //    "listed"; a missing /dp/ASIN returns 404. Don't read the body.
  let status = 0
  try {
    const res = await fetch(`https://${h}/dp/${a}`, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': CHECK_UA, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(2500),
    })
    status = res.status
  } catch {
    return false // timeout / network — fall back to US this click, don't cache
  }

  const available = status === 200
  // Cache only a definitive answer (listed, or a real 404). Ambiguous statuses
  // (403 bot-wall, 5xx, redirects) aren't cached so we re-check later.
  if (status === 200 || status === 404) {
    try {
      await admin.from('passport_asin_market').upsert(
        { asin: a, marketplace: h, available, checked_at: new Date().toISOString() },
        { onConflict: 'asin,marketplace' },
      )
    } catch { /* cache write is best-effort */ }
  }
  // A non-200, non-404 (e.g. a 403 bot page) is inconclusive — don't route the
  // shopper local on a maybe; fall back to US where the ASIN is known to exist.
  return available
}
