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
import { brandMatches, brandLikeToken } from '@/lib/brand-match'

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
  const tok = brandLikeToken(label)
  if (!tok) return NextResponse.json({ error: 'A brand is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // The user's already-joined campaign IDs — excluded so Accept all / Message all
  // only target campaigns they haven't joined yet. Keyed on campaign ID, NOT ASIN:
  // Amazon runs multiple distinct campaigns per product, so an ASIN key would hide
  // a brand-new joinable campaign just because an earlier one for that product was
  // joined.
  const accepted = new Set<string>()
  // Authoritative per-campaign ledger (many campaigns per ASIN).
  try {
    const { data: led } = await sb.from('cc_accepted_campaigns')
      .select('campaign_id').eq('user_id', user.id).limit(8000)
    for (const r of (led ?? [])) {
      const id = String(r?.campaign_id || '').trim()
      if (id) accepted.add(id)
    }
  } catch { /* ledger may not exist yet */ }
  // Backfill from the legacy ASIN-keyed campaigns row.
  try {
    const { data: acc } = await sb.from('campaigns')
      .select('cc_campaign_id, accepted_at, amazon_joined_at').eq('user_id', user.id).limit(4000)
    for (const r of (acc ?? [])) {
      const id = String(r?.cc_campaign_id || '').trim()
      if (id && (r.accepted_at || r.amazon_joined_at)) accepted.add(id)
    }
  } catch { /* nothing excluded */ }

  const { data } = await sb
    .from('cc_campaign_catalog')
    .select(COLS)
    .or(`brand_name.ilike.%${tok}%,campaign_name.ilike.%${tok}%`)
    .order('monthly_sold', { ascending: false, nullsFirst: false })
    .limit(1000)

  // Precise whole-word brand match on the returned rows (brand OR title), so a
  // variant/null brand is caught via the title without look-alikes like "Dreamegg".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campaigns = ((data ?? []) as any[]).filter((r) => brandMatches(label, r.brand_name, r.campaign_name)).map((r) => {
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
  }).filter((c) => !!c.repAsin && !accepted.has(String(c.campaignId)) && (!onlyOpen || !c.isFull))

  return NextResponse.json({ ok: true, brand: label, campaigns })
}
