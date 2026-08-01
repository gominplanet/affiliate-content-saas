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
  const today = new Date().toISOString().slice(0, 10)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from('cc_campaign_catalog')
      .select('campaign_name, brand_name, commission_pct, ends_at')
      .contains('asins', [asin])
      .gte('ends_at', today)
      .limit(1)
      .maybeSingle()
    if (!data) return NextResponse.json({ ok: true, inCatalog: false })
    return NextResponse.json({
      ok: true,
      inCatalog: true,
      brand: data.brand_name ?? null,
      campaignName: data.campaign_name ?? null,
      commissionPct: data.commission_pct ?? null,
    })
  } catch {
    // Unknown (query failed) — treat as "can't tell", not "not in catalog".
    return NextResponse.json({ ok: true, inCatalog: null })
  }
}
