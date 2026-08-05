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
    }
    const asin = (body.asin || '').toString().trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      return NextResponse.json({ error: 'A valid ASIN is required' }, { status: 400 })
    }
    const now = new Date().toISOString()

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
      const patch: Record<string, unknown> = { accepted_at: now, updated_at: now }
      if (body.campaignId) patch.cc_campaign_id = body.campaignId
      if (body.detailsUrl) patch.details_url = body.detailsUrl
      if (body.brand) patch.brand_name = body.brand
      const { error } = await sb.from('campaigns').update(patch).eq('id', existing.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
    }
    if (body.campaignId) insert.cc_campaign_id = body.campaignId
    if (body.detailsUrl) insert.details_url = body.detailsUrl
    if (body.brand) insert.brand_name = body.brand
    if (typeof body.commissionPct === 'number' && isFinite(body.commissionPct)) insert.commission_pct = body.commissionPct
    if (body.productTitle) insert.product_title = body.productTitle.slice(0, 300)

    const { error } = await sb.from('campaigns').insert(insert)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, created: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
