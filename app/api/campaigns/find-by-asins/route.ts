/**
 * POST /api/campaigns/find-by-asins   body: { asins: string[] }
 *
 * Batch version of find-by-asin. Given the ASINs of a Product Finder result set,
 * return which ones are already imported Creator Connections campaigns (with a
 * details URL SCOUT can auto-send through). Lets the Finder badge each row's
 * campaign status up front — before the user opens the Message modal — instead of
 * one lookup per open. Session-authed.
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

    const body = await request.json().catch(() => ({})) as { asins?: unknown }
    const asins = Array.isArray(body.asins)
      ? Array.from(new Set(body.asins.map((a) => String(a || '').trim().toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a)))).slice(0, 60)
      : []
    if (asins.length === 0) return NextResponse.json({ ok: true, map: {} })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('campaigns')
      .select('asin,details_url,campaign_name,brand_name,commission_pct')
      .eq('user_id', ownerId)
      .in('asin', asins)
      .not('details_url', 'is', null)
      .order('created_at', { ascending: false })

    // Keep the most-recent row per ASIN (the query is already newest-first).
    const map: Record<string, { detailsUrl: string; campaignName: string | null; brandName: string | null; commissionPct: number | null }> = {}
    for (const row of (data ?? [])) {
      const asin = String(row.asin || '').toUpperCase()
      if (!asin || map[asin]) continue
      map[asin] = {
        detailsUrl: row.details_url,
        campaignName: row.campaign_name ?? null,
        brandName: row.brand_name ?? null,
        commissionPct: row.commission_pct ?? null,
      }
    }

    return NextResponse.json({ ok: true, map })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
