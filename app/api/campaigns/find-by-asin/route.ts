/**
 * GET /api/campaigns/find-by-asin?asin=B0...
 *
 * Does the user already have an imported Creator Connections campaign for this
 * ASIN (with a details URL SCOUT can open)? Used by the Product Finder's Message
 * button: if a campaign exists, the message modal opens in AUTO-SEND mode
 * (SCOUT delivers it on Amazon) instead of compose+copy. Session-authed.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

export async function GET(request: Request) {
  try {
    const supabase = await createServerClient()
    const auth = await getAuthAndOwner(supabase)
    if ('error' in auth) return auth.error
    const { ownerId } = auth

    const asin = (new URL(request.url).searchParams.get('asin') || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: 'A valid ASIN is required' }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('campaigns')
      .select('details_url,campaign_name,brand_name,commission_pct')
      .eq('user_id', ownerId)
      .eq('asin', asin)
      .not('details_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return NextResponse.json({
      ok: true,
      found: !!data?.details_url,
      detailsUrl: data?.details_url ?? null,
      campaignName: data?.campaign_name ?? null,
      brandName: data?.brand_name ?? null,
      commissionPct: data?.commission_pct ?? null,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
