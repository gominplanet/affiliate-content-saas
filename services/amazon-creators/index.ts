// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Amazon Creators API client — the OAuth 2.0 replacement for PA-API 5.0 (which
 * retired May 2026). We use it as an OPERATOR-level media source: one set of
 * credentials (the account owner's) fetches product images/titles/prices by
 * ASIN to enrich the shared Creator Connections catalog for every user. Product
 * images aren't user-specific, so a single key is the right model (same posture
 * as the Keepa operator key).
 *
 * ENTIRELY env-gated: with the credentials unset every function is a safe no-op
 * (creatorsApiConfigured() === false, lookups return empty), so it ships dark
 * and lights up the moment the env vars exist.
 *
 * Env:
 *   AMAZON_CREATORS_CLIENT_ID      OAuth credential id  (amzn1.application-oa2-client.…)
 *   AMAZON_CREATORS_CLIENT_SECRET  OAuth credential secret (kept ONLY in the env)
 *   AMAZON_PARTNER_TAG             Associates tracking tag (e.g. gomin0e-20)
 *   AMAZON_MARKETPLACE             optional, default www.amazon.com
 *
 * Spec verified against affiliate-program.amazon.com/creatorsapi/docs
 * (get-started/using-curl + api-reference/get-items). GetItems returns NO video
 * data — carousel-video presence still comes from SCOUT.
 */

const GETITEMS_URL = 'https://creatorsapi.amazon/catalog/v1/getItems'

export function creatorsApiConfigured(): boolean {
  return !!(process.env.AMAZON_CREATORS_CLIENT_ID && process.env.AMAZON_CREATORS_CLIENT_SECRET && process.env.AMAZON_PARTNER_TAG)
}

function marketplace(): string {
  return (process.env.AMAZON_MARKETPLACE || 'www.amazon.com').trim()
}

/** Login-with-Amazon token host is regional; default NA (US/CA/MX/BR). */
function tokenEndpoint(mkt: string): string {
  if (/amazon\.(co\.uk|de|fr|it|es|nl|se|pl|ie|com\.be|com\.tr)$/i.test(mkt)) return 'https://api.amazon.co.uk/auth/o2/token'
  if (/amazon\.(co\.jp|com\.au|sg|ae|sa|in|eg)$/i.test(mkt)) return 'https://api.amazon.co.jp/auth/o2/token'
  return 'https://api.amazon.com/auth/o2/token'
}

// ── OAuth: client_credentials → bearer token, cached for its lifetime ────────
let _token: { value: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string | null> {
  const id = (process.env.AMAZON_CREATORS_CLIENT_ID || '').trim()
  const secret = (process.env.AMAZON_CREATORS_CLIENT_SECRET || '').trim()
  if (!id || !secret) return null
  // Reuse until ~1 min before expiry (never fetch a token per request).
  if (_token && Date.now() < _token.expiresAt - 60_000) return _token.value

  const url = tokenEndpoint(marketplace())
  const params = { grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'creatorsapi::default' }
  try {
    // Official example uses a JSON body; fall back to form-encoded on a 415.
    let res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params), signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 415) {
      res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(), signal: AbortSignal.timeout(15_000),
      })
    }
    if (!res.ok) { console.error('[creators-api token]', res.status); return null }
    const data = await res.json() as { access_token?: string; expires_in?: number }
    if (!data.access_token) return null
    const ttl = Number.isFinite(data.expires_in) ? (data.expires_in as number) : 3600
    _token = { value: data.access_token, expiresAt: Date.now() + ttl * 1000 }
    return _token.value
  } catch (e) {
    console.error('[creators-api token]', e instanceof Error ? e.message : e)
    return null
  }
}

export interface CreatorsItem {
  asin: string
  imageUrl: string | null
  title: string | null
  priceCents: number | null
  detailPageUrl: string | null
}

/**
 * Fetch product cards by ASIN (image / title / price / tagged link). Batches of
 * 10 (the GetItems cap), paced ~1 req/sec to respect the rate limit. Returns a
 * Map keyed by ASIN; never throws — a failure just yields fewer entries.
 */
export async function getItemsByAsin(asins: string[]): Promise<Map<string, CreatorsItem>> {
  const out = new Map<string, CreatorsItem>()
  if (!creatorsApiConfigured()) return out
  const clean = [...new Set(asins.map(a => String(a || '').toUpperCase()).filter(a => /^[A-Z0-9]{10}$/.test(a)))]
  if (!clean.length) return out
  const token = await getAccessToken()
  if (!token) return out

  const mkt = marketplace()
  const partnerTag = (process.env.AMAZON_PARTNER_TAG || '').trim()
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-marketplace': mkt }

  for (let i = 0; i < clean.length; i += 10) {
    const chunk = clean.slice(i, i + 10)
    const body = {
      itemIds: chunk,
      itemIdType: 'ASIN',
      marketplace: mkt,
      partnerTag,
      resources: ['images.primary.large', 'itemInfo.title', 'offersV2.listings.price', 'parentASIN'],
    }
    try {
      const res = await fetch(GETITEMS_URL, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
      if (res.status === 429) { console.warn('[creators-api getItems] 429 rate-limited'); break } // back off; caller retries later
      if (!res.ok) { console.error('[creators-api getItems]', res.status); continue }
      const data = await res.json() as { itemResults?: { items?: unknown[] } }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const raw of (data.itemResults?.items ?? []) as any[]) {
        const asin = String(raw?.asin || '').toUpperCase()
        if (!/^[A-Z0-9]{10}$/.test(asin)) continue
        out.set(asin, {
          asin,
          imageUrl: raw?.images?.primary?.large?.url || raw?.images?.primary?.medium?.url || raw?.images?.primary?.small?.url || null,
          title: raw?.itemInfo?.title?.displayValue || null,
          priceCents: parsePriceCents(raw?.offersV2?.listings?.[0]?.price),
          detailPageUrl: raw?.detailPageURL || null,
        })
      }
    } catch (e) {
      console.error('[creators-api getItems]', e instanceof Error ? e.message : e)
    }
    if (i + 10 < clean.length) await new Promise(r => setTimeout(r, 1100)) // ~1 req/sec
  }
  return out
}

/** Price shape is community-sourced (offers-v2 doc 404'd) — read amount or a
 *  "$19.99" displayAmount defensively. Returns integer cents, or null. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePriceCents(price: any): number | null {
  if (!price || typeof price !== 'object') return null
  if (Number.isFinite(price.amount)) return Math.round(Number(price.amount) * 100)
  const disp = typeof price.displayAmount === 'string' ? price.displayAmount : ''
  const n = Number(disp.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}
