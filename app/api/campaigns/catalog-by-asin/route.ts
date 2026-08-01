// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/campaigns/catalog-by-asin?asin=B0...
//
// Does a LIVE Creator Connections campaign exist for this ASIN in the shared
// imported catalog (cc_campaign_catalog, ~800k rows, GIN-indexed on asins)?
// Used by "Send on Creator Connections" to tell a real "not in CC at all" (email
// the brand instead) apart from a SCOUT miss (a campaign exists; open it by
// hand). Instant anti-join on the asins array — no SCOUT, no Amazon traffic.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const asin = (new URL(request.url).searchParams.get('asin') || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ ok: true, inCatalog: false })

  const admin = createAdminClient()
  // A campaign you've ACCEPTED stays messageable for a while after its end date
  // (Amazon keeps the chat open — it's in your Active tab). A hard "ends_at >=
  // today" filter dropped a campaign that ended yesterday, so Send-on-CC couldn't
  // find it in the catalog and fell back to the slow grid search. Use a grace
  // window so recently-ended campaigns still resolve.
  const today = new Date().toISOString().slice(0, 10)
  const grace = new Date()
  grace.setDate(grace.getDate() - 60)
  const graceDate = grace.toISOString().slice(0, 10)
  try {
    // Pull every campaign that carries this ASIN (a popular product can be in many).
    // We hand the campaign_ids to SCOUT so it can deep-link / API-message the exact
    // campaign. We DO NOT gate the ASIN lookup on ends_at: a campaign you've
    // ACCEPTED keeps its brand chat open long after it ends (Amazon's Active tab),
    // so an end-date filter here produced false "not in Creator Connections" for
    // brands the creator can still message. The send itself (SCOUT's chat/search)
    // is the real arbiter of whether a live chat exists — order by ends_at so the
    // freshest campaign is first, but never exclude on it.
    const runAsinQuery = (withGrace: boolean) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (admin as any)
        .from('cc_campaign_catalog')
        .select('campaign_id, campaign_name, brand_name, commission_pct, ends_at')
        .contains('asins', [asin])
      if (withGrace) q = q.gte('ends_at', graceDate)
      return q.order('ends_at', { ascending: false }).limit(50)
    }
    // Prefer recent campaigns; if none in the grace window, fall back to ANY
    // campaign carrying the ASIN (still messageable if the brand was accepted).
    let { data } = await runAsinQuery(true)
    if (!((data ?? []) as unknown[]).length) { ({ data } = await runAsinQuery(false)) }
    const rows = (data ?? []) as Array<{ campaign_id: string | null; campaign_name: string | null; brand_name: string | null; commission_pct: number | null }>
    if (!rows.length) return NextResponse.json({ ok: true, inCatalog: false })

    const brand = rows[0].brand_name ?? null
    const campaignIds = [...new Set(rows.map(r => r.campaign_id).filter(Boolean))]

    // BRAND FALLBACK: Creator Connections messaging is per-BRAND (one chat thread
    // per brand), so we can reach the brand through ANY of its currently-LIVE
    // campaigns if this product's own campaign has ended. Pull a few other live
    // campaign_ids for the same brand (mig 206 indexes brand_name for this).
    let brandCampaignIds: string[] = []
    if (brand) {
      try {
        const asinSet = new Set(campaignIds)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: bd } = await (admin as any)
          .from('cc_campaign_catalog')
          .select('campaign_id')
          .eq('brand_name', brand)
          .gte('ends_at', today)
          .order('ends_at', { ascending: false })
          .limit(12)
        brandCampaignIds = [...new Set(((bd ?? []) as Array<{ campaign_id: string | null }>).map(r => r.campaign_id).filter(Boolean) as string[])]
          .filter(id => !asinSet.has(id))
          .slice(0, 8)
      } catch { /* brand fallback is best-effort */ }
    }

    return NextResponse.json({
      ok: true,
      inCatalog: true,
      brand,
      campaignName: rows[0].campaign_name ?? null,
      commissionPct: rows[0].commission_pct ?? null,
      campaignIds,
      brandCampaignIds,
    })
  } catch {
    // Unknown (query failed) — treat as "can't tell", not "not in catalog".
    return NextResponse.json({ ok: true, inCatalog: null })
  }
}
