// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/launchpad/geo-check — Video Launchpad geo research.
// Given the product ASIN, report where it looks listed across the Amazon
// marketplaces MVP delivers to, so the creator can decide which storefronts to
// upload to.
//
// Phase 3: the existence check runs through KEEPA per marketplace domain, which
// is definitive and NOT bot-walled like a server-side /dp fetch. Keepa covers
// US, UK, DE, FR, JP, CA, IT, ES; Australia has no Keepa domain, so it falls
// back to a bounded /dp probe (3-state, since that can be blocked). Each geo
// carries the ASIN to attach there (Phase 3 keeps the source ASIN; a future step
// resolves a different LOCAL asin when the product is listed under another one).
//
//   body: { asin }  ->  { ok, asin, geos: [{ domain, code, country, status, asin }] }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { keepaConfigured, fetchKeepaBrandInfo } from '@/services/keepa'

export const runtime = 'nodejs'
export const maxDuration = 60

// The marketplaces MVP delivers to. `domain` matches the global-sync /
// storefront-upload key (no www); `keepa` is the Keepa domainId (null = not on
// Keepa → /dp fallback); `host` is the store host for that fallback.
const GEOS = [
  { domain: 'amazon.com', host: 'www.amazon.com', code: 'US', country: 'United States', keepa: 1 },
  { domain: 'amazon.ca', host: 'www.amazon.ca', code: 'CA', country: 'Canada', keepa: 6 },
  { domain: 'amazon.co.uk', host: 'www.amazon.co.uk', code: 'GB', country: 'United Kingdom', keepa: 2 },
  { domain: 'amazon.com.au', host: 'www.amazon.com.au', code: 'AU', country: 'Australia', keepa: null },
  { domain: 'amazon.de', host: 'www.amazon.de', code: 'DE', country: 'Germany', keepa: 3 },
  { domain: 'amazon.fr', host: 'www.amazon.fr', code: 'FR', country: 'France', keepa: 4 },
  { domain: 'amazon.es', host: 'www.amazon.es', code: 'ES', country: 'Spain', keepa: 9 },
  { domain: 'amazon.it', host: 'www.amazon.it', code: 'IT', country: 'Italy', keepa: 8 },
  { domain: 'amazon.co.jp', host: 'www.amazon.co.jp', code: 'JP', country: 'Japan', keepa: 5 },
] as const

const CHECK_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

function asinFrom(v: string): string | null {
  const s = (v || '').trim()
  if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase()
  const m = s.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i)
  return m ? m[1].toUpperCase() : null
}

type GeoStatus = 'found' | 'not-listed' | 'unknown'

/** Australia has no Keepa domain — cache-first bounded /dp probe (3-state). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkGeoDp(sb: any, asin: string, host: string): Promise<GeoStatus> {
  const h = host.toLowerCase()
  try {
    const { data } = await sb.from('passport_asin_market').select('available').eq('asin', asin).eq('marketplace', h).maybeSingle()
    if (data && typeof data.available === 'boolean') return data.available ? 'found' : 'not-listed'
  } catch { /* cache miss → live check */ }
  let status = 0
  try {
    const res = await fetch(`https://${h}/dp/${asin}`, {
      method: 'GET', redirect: 'follow',
      headers: { 'User-Agent': CHECK_UA, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(2500),
    })
    status = res.status
  } catch { return 'unknown' }
  if (status === 200 || status === 404) {
    try {
      await sb.from('passport_asin_market').upsert(
        { asin, marketplace: h, available: status === 200, checked_at: new Date().toISOString() },
        { onConflict: 'asin,marketplace' },
      )
    } catch { /* best-effort */ }
    return status === 200 ? 'found' : 'not-listed'
  }
  return 'unknown'
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  if (!['pro', 'admin'].includes(tier)) {
    return NextResponse.json({ error: 'Video Launchpad is a Pro feature.', code: 'tier_not_allowed' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { asin?: string }
  const asin = asinFrom(body.asin || '')
  if (!asin) return NextResponse.json({ error: 'A valid product ASIN is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const canKeepa = keepaConfigured()

  const geos = await Promise.all(GEOS.map(async (g) => {
    // US: the source ASIN lives here by definition.
    if (g.code === 'US') return { domain: g.domain, code: g.code, country: g.country, status: 'found' as GeoStatus, asin }
    // Keepa domains: a non-null title back from that domain means the ASIN is
    // listed there (definitive). No Keepa key configured → 'unknown'.
    if (g.keepa != null) {
      if (!canKeepa) return { domain: g.domain, code: g.code, country: g.country, status: 'unknown' as GeoStatus, asin }
      try {
        const info = await fetchKeepaBrandInfo([asin], g.keepa)
        const listed = !!(info.get(asin)?.title)
        return { domain: g.domain, code: g.code, country: g.country, status: (listed ? 'found' : 'not-listed') as GeoStatus, asin }
      } catch {
        return { domain: g.domain, code: g.code, country: g.country, status: 'unknown' as GeoStatus, asin }
      }
    }
    // Australia — no Keepa domain, bounded /dp probe.
    return { domain: g.domain, code: g.code, country: g.country, status: await checkGeoDp(sb, asin, g.host), asin }
  }))

  return NextResponse.json({ ok: true, asin, geos })
}
