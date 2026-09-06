/**
 * POST /api/campaigns/mark-accepted
 *   { asin, campaignId?, detailsUrl?, brand?, commissionPct?, productTitle? }
 *
 * Called after SCOUT confirms it clicked Accept on the campaign's Amazon page,
 * so the row shows an "✓ Accepted" record.
 *
 * The CC Campaigns browse page accepts straight from the SHARED catalog, where
 * the user may have no `campaigns` row for this ASIN yet. So this UPSERTS:
 * update accepted_at on an existing (user_id, asin) row, else insert a fresh
 * row carrying the catalog identifiers (cc_campaign_id, details_url, brand,
 * commission). Session-authed. Best-effort — a failure here never undoes the
 * accept that already happened on Amazon.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const auth = await getAuthAndOwner(supabase)
    if ('error' in auth) return auth.error
    const { ownerId } = auth

    const body = await request.json().catch(() => ({})) as {
      asin?: string
      campaignId?: string
      detailsUrl?: string
      brand?: string
      commissionPct?: number
      productTitle?: string
      /** Which part of MVP did this, so the record can say. */
      source?: string
    }
    const asin = (body.asin || '').toString().trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      return NextResponse.json({ error: 'A valid ASIN is required' }, { status: 400 })
    }
    const now = new Date().toISOString()
    // Sanitize the free-text body fields before they're stored:
    //  - details_url must be an Amazon affiliate URL (else drop it — never store
    //    an arbitrary/`javascript:` string that might later render as an href).
    //  - brand is capped like product_title.
    const safeDetailsUrl = (typeof body.detailsUrl === 'string' && /^https:\/\/affiliate-program\.amazon\.[a-z.]+\//i.test(body.detailsUrl))
      ? body.detailsUrl.slice(0, 500)
      : null
    const safeBrand = typeof body.brand === 'string' ? body.brand.slice(0, 200) : null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    // Existing row for this (user, ASIN)? Update in place and backfill the
    // catalog identifiers if they're missing (older rows predate these cols).
    const { data: existing } = await sb
      .from('campaigns')
      .select('id')
      .eq('user_id', ownerId)
      .eq('asin', asin)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing?.id) {
      // amazon_joined_at is the persisted "joined on Amazon" marker "Joined only"
      // reads — accepting a campaign IS joining it, so set it here too.
      const patch: Record<string, unknown> = { accepted_at: now, amazon_joined_at: now, updated_at: now }
      if (body.campaignId) patch.cc_campaign_id = body.campaignId
      if (safeDetailsUrl) patch.details_url = safeDetailsUrl
      if (safeBrand) patch.brand_name = safeBrand
      const { error } = await sb.from('campaigns').update(patch).eq('id', existing.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await recordAcceptedCampaign(sb, ownerId, body.campaignId, safeBrand, asin, body.source)
      return NextResponse.json({ ok: true, created: false })
    }

    // No row yet → insert one so the accept is recorded. status stays 'pending'
    // (accepted, no post yet). Only include columns we have values for so this
    // stays resilient to older schemas.
    const insert: Record<string, unknown> = {
      user_id: ownerId,
      asin,
      status: 'pending',
      accepted_at: now,
      amazon_joined_at: now,
    }
    if (body.campaignId) insert.cc_campaign_id = body.campaignId
    if (safeDetailsUrl) insert.details_url = safeDetailsUrl
    if (safeBrand) insert.brand_name = safeBrand
    if (typeof body.commissionPct === 'number' && isFinite(body.commissionPct)) insert.commission_pct = body.commissionPct
    if (body.productTitle) insert.product_title = body.productTitle.slice(0, 300)

    const { error } = await sb.from('campaigns').insert(insert)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await recordAcceptedCampaign(sb, ownerId, body.campaignId, safeBrand, asin, body.source)
    return NextResponse.json({ ok: true, created: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/**
 * Record the accept. This is MVP's memory of what it joined.
 *
 * It used to return early when Amazon had not given a campaign id, which meant an
 * accept that succeeded on Amazon left no trace here. The Joined Campaigns page
 * reads this ledger to answer "show me what I joined through MVP so I can make
 * something for it", so a missing row is a campaign the creator can no longer
 * find. The ledger is keyed by campaign so several campaigns for one product each
 * keep their own row; without a real id there is still exactly one thing to
 * remember, so it gets a stable per-product key instead of being dropped.
 *
 * `source` is written when the column exists and skipped when it does not, so
 * this keeps working on a database that has not had migration 314 applied yet.
 * Losing the label is survivable; losing the row is not.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recordAcceptedCampaign(sb: any, userId: string, campaignId: string | undefined, brand: string | null, asin: string, source?: string): Promise<void> {
  const cid = (campaignId || '').toString().trim() || `asin:${asin}`
  const base = { user_id: userId, campaign_id: cid, brand_name: brand, asin, accepted_at: new Date().toISOString() }
  const src = typeof source === 'string' && source.trim() ? source.trim().slice(0, 40) : null
  try {
    const withSource = await sb.from('cc_accepted_campaigns')
      .upsert({ ...base, source: src }, { onConflict: 'user_id,campaign_id' })
    if (!withSource?.error) return
  } catch { /* fall through to the column-less write */ }
  try {
    await sb.from('cc_accepted_campaigns').upsert(base, { onConflict: 'user_id,campaign_id' })
  } catch { /* the accept still happened on Amazon; never fail the request */ }
}
