// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/launchpad/geo-check — Video Launchpad, Phase 1 (English geos).
// Given the product ASIN, report where it looks listed across the four
// English-speaking Amazon marketplaces (US, CA, UK, AU) so the creator can
// decide which storefronts to upload the video to.
//
// This is a HINT, not a gate: Amazon frequently bot-walls a server-side check
// from a datacenter IP (403), so we return a 3-state status — 'found' (a real
// 200), 'not-listed' (a real 404), or 'unknown' (blocked / timeout / anything
// else) — and let the creator decide regardless. The storefront upload validates
// the ASIN for real at publish time.
//
//   body: { asin }  ->  { ok, geos: [{ domain, code, country, status }] }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'

export const runtime = 'nodejs'
export const maxDuration = 30

// The four English-speaking marketplaces. `domain` matches the global-sync /
// storefront-upload marketplace key (no www); `host` is the store host we probe.
const ENGLISH_GEOS = [
  { domain: 'amazon.com', host: 'www.amazon.com', code: 'US', country: 'United States' },
  { domain: 'amazon.ca', host: 'www.amazon.ca', code: 'CA', country: 'Canada' },
  { domain: 'amazon.co.uk', host: 'www.amazon.co.uk', code: 'GB', country: 'United Kingdom' },
  { domain: 'amazon.com.au', host: 'www.amazon.com.au', code: 'AU', country: 'Australia' },
] as const

const CHECK_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

function asinFrom(v: string): string | null {
  const s = (v || '').trim()
  if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase()
  const m = s.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i)
  return m ? m[1].toUpperCase() : null
}

type GeoStatus = 'found' | 'not-listed' | 'unknown'

/** Cache-first 3-state check of one marketplace. Reuses the passport_asin_market
 *  cache (mig 294). A definitive 200/404 is cached; anything ambiguous is not. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkGeo(sb: any, asin: string, host: string): Promise<GeoStatus> {
  const h = host.toLowerCase()
  try {
    const { data } = await sb.from('passport_asin_market').select('available').eq('asin', asin).eq('marketplace', h).maybeSingle()
    if (data && typeof data.available === 'boolean') return data.available ? 'found' : 'not-listed'
  } catch { /* cache miss / table absent → live check */ }
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
    } catch { /* best-effort cache write */ }
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
  const geos = await Promise.all(ENGLISH_GEOS.map(async (g) => ({
    domain: g.domain, code: g.code, country: g.country,
    // The US store is where the source ASIN lives — always listed there.
    status: g.code === 'US' ? 'found' as GeoStatus : await checkGeo(sb, asin, g.host),
  })))

  return NextResponse.json({ ok: true, asin, geos })
}
