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
  let { rows, capped } = await ccScanBrandCampaigns(sb, label)

  // MESSAGE ALL, when the brand has nothing running.
  //
  // Joining needs a live campaign with a free slot. Messaging does not, and this
  // is the case where messaging matters most: a creator who has joined every
  // campaign a brand has ever run, or whose campaigns have all ended, is exactly
  // the creator with a reason to write to them. Refusing to open the window
  // because there is nothing left to join refuses the conversation that gets the
  // next campaign made.
  //
  // Deliberately second, not merged into the first scan: the live set is the
  // right answer whenever there is one, and ended campaigns are a fallback for
  // reaching a brand rather than something to show alongside live ones.
  let usedEnded = false
  if (!onlyOpen && !rows.length) {
    const wider = await ccScanBrandCampaigns(sb, label, { includeEnded: true })
    if (wider.rows.length) { rows = wider.rows; capped = wider.capped; usedEnded = true }
  }

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
      // Whether this creator has already joined it. Passed through rather than
      // used to hide the row: the bulk message window labels a joined campaign
      // and skips re-joining it, which is more useful than pretending it is not
      // there.
      joined: accepted.has(String(r.campaign_id)),
      // Kept alongside the card so the acceptable test below reads the same row
      // shape ccIsAcceptable was written against.
      _row: r,
    }
  }).filter((c) => onlyOpen
    // Accept all: exactly what the badge counted as open, same predicate.
    ? ccIsAcceptable(c._row, accepted, c.isFull)
    // Message all: EVERY campaign for the brand. Full ones, and joined ones.
    //
    // Joined campaigns used to be filtered out here, which meant a creator who
    // had accepted everything a brand offered got "No campaigns found to
    // message. They may all be ones you've already joined." That sentence is
    // accurate and useless: having joined a brand's campaigns is a reason to
    // talk to them, not a reason to be locked out of it.
    : !!c.repAsin)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(({ _row, ...c }) => c)

  return NextResponse.json({
    ok: true, brand: label, campaigns, capped,
    // True when these are the brand's ENDED campaigns, offered only as a way to
    // reach them. The caller says so rather than presenting them as live.
    endedOnly: usedEnded,
  })
}
