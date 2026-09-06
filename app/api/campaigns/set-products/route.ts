// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/campaigns/set-products   { asin, asins: string[] }
//
// Remember which products a joined campaign covers.
//
// SCOUT reads them off Amazon's own campaign page, which is the only complete
// source: the shared catalog's asins column is empty for a large share of
// campaigns, so MVP recovers one ASIN from the campaign's name and treats it as
// the whole campaign. That read costs a hidden tab and a few seconds, and the
// campaign will eventually drop off Amazon's live list entirely, so the answer is
// kept here rather than fetched again every time the creator opens the card.
//
// Keyed by the campaign's representative product, which is how every row on the
// Joined Campaigns page is addressed.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const auth = await getAuthAndOwner(supabase)
    if ('error' in auth) return auth.error
    const { ownerId } = auth
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    const body = await request.json().catch(() => ({})) as { asin?: string; asins?: string[] }
    const asin = String(body.asin || '').toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: 'A valid ASIN is required' }, { status: 400 })

    // The campaign's own product always belongs in its list, even when Amazon's
    // page did not name it, so a stored list is never missing the row it is on.
    const asins = [...new Set([asin, ...((body.asins ?? [])
      .map(a => String(a || '').toUpperCase())
      .filter(a => /^[A-Z0-9]{10}$/.test(a)))])].slice(0, 60)

    const { error } = await sb.from('campaigns')
      .update({ campaign_asins: asins, updated_at: new Date().toISOString() })
      .eq('user_id', ownerId).eq('asin', asin)
    // The column arrived in migration 315. A database without it should say so
    // rather than pretend the products were saved.
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 200 })
    return NextResponse.json({ ok: true, asins })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 })
  }
}
