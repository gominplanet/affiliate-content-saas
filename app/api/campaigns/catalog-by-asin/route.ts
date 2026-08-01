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
  const grace = new Date()
  grace.setDate(grace.getDate() - 60)
  const graceDate = grace.toISOString().slice(0, 10)
  try {
    // Pull every campaign that carries this ASIN and hasn't ended long ago (a
    // popular product can be in many). We hand the campaign_ids to SCOUT so it can
    // deep-link the exact campaign — no guessing, no slow ASIN resolution.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from('cc_campaign_catalog')
      .select('campaign_id, campaign_name, brand_name, commission_pct, ends_at')
      .contains('asins', [asin])
      .gte('ends_at', graceDate)
      .order('ends_at', { ascending: false })
      .limit(50)
    const rows = (data ?? []) as Array<{ campaign_id: string | null; campaign_name: string | null; brand_name: string | null; commission_pct: number | null }>
    if (!rows.length) return NextResponse.json({ ok: true, inCatalog: false })
    return NextResponse.json({
      ok: true,
      inCatalog: true,
      brand: rows[0].brand_name ?? null,
      campaignName: rows[0].campaign_name ?? null,
      commissionPct: rows[0].commission_pct ?? null,
      campaignIds: [...new Set(rows.map(r => r.campaign_id).filter(Boolean))],
    })
  } catch {
    // Unknown (query failed) — treat as "can't tell", not "not in catalog".
    return NextResponse.json({ ok: true, inCatalog: null })
  }
}
