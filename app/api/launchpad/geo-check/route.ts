// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/launchpad/geo-check — Video Launchpad geo research.
// Given the product ASIN, report where it looks listed across the Amazon
// marketplaces MVP delivers to, so the creator can decide which storefronts to
// upload to.
//
// Phase 3: the existence check runs through KEEPA per marketplace domain, which
// is definitive and NOT bot-walled like a server-side /dp fetch. Keepa covers
// US, UK, DE, FR, JP, CA, IT, ES. Australia has NO Keepa domain (Keepa dropped
// amazon.com.au), so it can't be answered server-side reliably — a datacenter
// /dp probe gets blocked. For AU we return status 'unknown' with browser:true,
// and the CLIENT re-checks it through SCOUT, which reads the real /dp page in the
// creator's own logged-in session on a residential IP (unblockable). A cache read
// still short-circuits AU when a prior SCOUT check was persisted; the client posts
// its SCOUT result back here ({ cache: {...} }) to fill that cache.
//
//   body: { asin, scope?, brand?, title? }
//        -> { ok, asin, brand, title, scope, geos: [{ domain, code, country, status, asin, browser? }] }
//   body: { cache: { asin, domain, status } } -> { ok } (persist a SCOUT result)
//
// scope is 'english' (default, the four English stores), 'international' (the
// five that need a dub, on their own so opting in does not re-pay for the four)
// or 'all'. Each non-US market is one Keepa lookup, so the default is the
// cheapest answer and the rest is asked for.
// brand/title come from Keepa US so the client can drive SCOUT's local-ASIN
// search for any market where the source ASIN isn't listed.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier } from '@/lib/tier'
import { keepaConfigured, fetchKeepaBrandInfo } from '@/services/keepa'
import { asinFromAmazonUrl } from '@/lib/asin'
import { MARKETS, marketByDomain } from '@/lib/markets'

export const runtime = 'nodejs'
export const maxDuration = 60

// The marketplaces MVP delivers to. `domain` matches the global-sync /
// storefront-upload key (no www); `keepa` is the Keepa domainId (null = not on
// Keepa → SCOUT browser check on the client); `host` is the store host.
//
// ALL NINE. This was English-only for a while: the four storefronts whose audio
// was already right, so that nothing waited on a dub before the first upload
// started.
//
// Two things retired that reasoning. The delivery runs in WAVES, so the English
// markets upload while the dubs render and a dubbed market never holds up one
// that needs nothing. And a video YouTube has already dubbed now costs nothing
// to localize at all, because the track is pulled instead of synthesized.
//
// It also stopped being honest. The page promised "a dub per non-English
// market" on the paywall card and in the hero while reaching four English
// storefronts, so a creator paid for Pro, read that, and got no dub anywhere.
//
// The other cost of narrowing was five fewer Keepa lookups per check, and that
// saving is KEPT rather than paid back: the list below is what this route CAN
// research, not what it does on every call. `scope` decides, and it defaults to
// the English four. The international five are looked up when a creator asks
// for them and not before.
// ONE LIST. This was a second copy of lib/markets carrying the Keepa domain
// ids, and the coverage drain needing them was very nearly a third. A market
// list is a fact about the product, so the ids moved to lib/markets and this
// derives. The US stays first because the source ASIN lives there by
// definition and the loop below treats it as given.
const GEOS = MARKETS.map((m) => ({
  domain: m.domain, host: m.host, code: m.code, country: m.country, keepa: m.keepa,
}))

function asinFrom(v: string): string | null {
  const s = (v || '').trim()
  if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase()
  return asinFromAmazonUrl(s)
}

type GeoStatus = 'found' | 'not-listed' | 'unknown'

/** Cache-only read for a Keepa-less marketplace (Australia). A live server /dp
 *  probe is blocked from datacenter IPs, so we NEVER fetch here — the definitive
 *  check runs on the client through SCOUT (creator's own residential session).
 *  Returns a prior SCOUT result if one was persisted, else 'unknown'.
 *  `admin` is the service-role client: passport_asin_market is RLS-locked to
 *  service role (migration 294), so the user client can't read/write it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cachedGeoStatus(admin: any, asin: string, host: string): Promise<GeoStatus> {
  if (!admin) return 'unknown'
  const h = host.toLowerCase()
  try {
    const { data } = await admin.from('passport_asin_market').select('available').eq('asin', asin).eq('marketplace', h).maybeSingle()
    if (data && typeof data.available === 'boolean') return data.available ? 'found' : 'not-listed'
  } catch { /* no cache → unknown, client re-checks via SCOUT */ }
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

  const body = await req.json().catch(() => ({})) as {
    asin?: string
    cache?: { asin?: string; domain?: string; status?: string }
    scope?: string
    brand?: string
    title?: string
  }

  // passport_asin_market is RLS-locked to the service role (migration 294), so
  // the cache read/write needs the admin client. Missing service key → no cache
  // (the SCOUT browser check still runs), never a hard failure.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any = null
  try { admin = createAdminClient() } catch { admin = null }

  // Cache-write path: the client posts back a SCOUT browser-check result so a
  // Keepa-less marketplace (Australia) is instant on the next check. Only the
  // definitive states are persisted; 'unknown' is never cached.
  if (body.cache) {
    const cAsin = asinFrom(body.cache.asin || '')
    const geo = GEOS.find(g => g.domain === body.cache!.domain || g.host === body.cache!.domain)
    const st = body.cache.status
    if (admin && cAsin && geo && (st === 'found' || st === 'not-listed')) {
      try {
        await admin.from('passport_asin_market').upsert(
          { asin: cAsin, marketplace: geo.host.toLowerCase(), available: st === 'found', checked_at: new Date().toISOString() },
          { onConflict: 'asin,marketplace' },
        )
      } catch { /* best-effort */ }
    }
    return NextResponse.json({ ok: true })
  }

  const asin = asinFrom(body.asin || '')
  if (!asin) return NextResponse.json({ error: 'A valid product ASIN is required.' }, { status: 400 })

  const canKeepa = keepaConfigured()

  // ── ONLY RESEARCH THE MARKETS SOMEBODY ASKED ABOUT ───────────────────────
  //
  // Each non-US marketplace is one Keepa lookup, and most creators only ever
  // ship to the English four. Researching all nine on every check spends five
  // lookups per run on an answer nobody reads, which is exactly the kind of
  // cost that survives for months because it appears on no screen.
  //
  // So the first check asks about the English stores, and the international
  // ones are researched when a creator asks for them. 'international' is the
  // five on their own rather than all nine, so opting in does not re-pay for the
  // four already answered.
  //
  // Default is 'english' rather than 'all'. A caller that forgets the parameter
  // should cost the least, not the most.
  const scope = body.scope === 'all' ? 'all' : body.scope === 'international' ? 'international' : 'english'
  const inScope = GEOS.filter((g) => {
    const mkt = marketByDomain(g.domain)
    const isEnglish = !mkt?.needsTranslation
    return scope === 'all' ? true : scope === 'english' ? isEnglish : !isEnglish
  })

  // Pull the product's US brand + title once. The client passes these to SCOUT to
  // search for a LOCAL ASIN in any market where the source ASIN isn't listed.
  //
  // The caller can hand back what the first check already returned, so the
  // international pass does not spend a second US lookup to learn the same two
  // strings. They only steer a SCOUT search, so a caller-supplied value costs
  // nothing worse than a worse search.
  let brand: string | null = (body.brand || '').trim() || null
  let title: string | null = (body.title || '').trim() || null
  if (canKeepa && !brand && !title) {
    try {
      const us = await fetchKeepaBrandInfo([asin], 1)
      const info = us.get(asin)
      brand = info?.brand || null
      title = info?.title || null
    } catch { /* best-effort — client falls back to manual paste */ }
  }

  const geos = await Promise.all(inScope.map(async (g) => {
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
    // Australia — no Keepa domain. Serve a cached SCOUT result if we have one,
    // else flag browser:true so the client runs the definitive SCOUT /dp check.
    const cached = await cachedGeoStatus(admin, asin, g.host)
    return { domain: g.domain, code: g.code, country: g.country, status: cached, asin, browser: true, host: g.host }
  }))

  return NextResponse.json({ ok: true, asin, brand, title, geos, scope })
}
