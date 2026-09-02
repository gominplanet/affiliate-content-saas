// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/campaigns/favorite-brands/campaigns?brand=<label>&onlyOpen=1
// Every campaign for one favorited brand, mapped to the same shape the CC grid
// uses, so the watchlist can bulk-accept or bulk-message them. `onlyOpen`
// (default true) drops campaigns that are already full.
//   -> { ok, brand, campaigns: [{ campaignId, name, brand, repAsin, commissionPct, image, endsAt, isFull, spotsLeft, detailsUrl }] }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { campaignFullness } from '@/lib/cc-intelligence'
import { ccRequestUrl } from '@/lib/cc-urls'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COLS = 'campaign_id, campaign_name, brand_name, asins, rep_asin, commission_pct, ends_at, image_url, available_slot, total_slot'

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const label = (url.searchParams.get('brand') || '').trim()
  const onlyOpen = url.searchParams.get('onlyOpen') !== '0'
  const safe = label.replace(/[%_,]/g, ' ').trim()
  if (!safe) return NextResponse.json({ error: 'A brand is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb
    .from('cc_campaign_catalog')
    .select(COLS)
    .ilike('brand_name', safe)
    .order('monthly_sold', { ascending: false, nullsFirst: false })
    .limit(500)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campaigns = ((data ?? []) as any[]).map((r) => {
    const f = campaignFullness(r.available_slot, r.total_slot)
    return {
      campaignId: r.campaign_id as string,
      name: (r.campaign_name as string) || null,
      brand: (r.brand_name as string) || null,
      repAsin: (r.rep_asin as string) || (Array.isArray(r.asins) ? r.asins[0] : null),
      commissionPct: r.commission_pct != null ? Number(r.commission_pct) : null,
      image: (r.image_url as string) || null,
      endsAt: (r.ends_at as string) || null,
      isFull: f.isFull,
      spotsLeft: f.spotsLeft,
      detailsUrl: ccRequestUrl(r.campaign_id),
    }
  }).filter((c) => !!c.repAsin && (!onlyOpen || !c.isFull))

  return NextResponse.json({ ok: true, brand: label, campaigns })
}
