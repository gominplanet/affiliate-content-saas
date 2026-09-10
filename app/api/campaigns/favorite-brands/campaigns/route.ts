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
import { brandLikeToken } from '@/lib/brand-match'
import { ccScanBrandCampaigns, ccAcceptedCampaignIds, ccIsAcceptable } from '@/lib/cc-brand-scan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const label = (url.searchParams.get('brand') || '').trim()
  const onlyOpen = url.searchParams.get('onlyOpen') !== '0'
  if (!brandLikeToken(label)) return NextResponse.json({ error: 'A brand is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const accepted = await ccAcceptedCampaignIds(sb, user.id)
  // The SAME scan the badge counts from (shared, still-running, deterministically
  // ordered). Accept all previously read a differently-ordered slice, so on a
  // brand with more campaigns than one scan reads, the badge counted campaigns
  // this route never returned and the count could not be driven to zero.
  const { rows, capped } = await ccScanBrandCampaigns(sb, label)

  const campaigns = rows.map((r) => {
    const f = campaignFullness(r.available_slot, r.total_slot)
    return {
      campaignId: r.campaign_id,
      name: r.campaign_name || null,
      brand: r.brand_name || null,
      repAsin: r.rep_asin || (Array.isArray(r.asins) ? r.asins[0] : null),
      commissionPct: r.commission_pct != null ? Number(r.commission_pct) : null,
      image: r.image_url || null,
      endsAt: r.ends_at || null,
      isFull: f.isFull,
      spotsLeft: f.spotsLeft,
      detailsUrl: ccRequestUrl(r.campaign_id),
      // Kept alongside the card so the acceptable test below reads the same row
      // shape ccIsAcceptable was written against.
      _row: r,
    }
  }).filter((c) => onlyOpen
    // Accept all: exactly what the badge counted as open, same predicate.
    ? ccIsAcceptable(c._row, accepted, c.isFull)
    // Message all: every campaign you have not joined, full ones included, so a
    // brand with no free slots can still be reached.
    : !!c.repAsin && !accepted.has(String(c.campaignId)))
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(({ _row, ...c }) => c)

  return NextResponse.json({ ok: true, brand: label, campaigns, capped })
}
