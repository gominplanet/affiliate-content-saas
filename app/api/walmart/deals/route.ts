/**
 * GET /api/walmart/deals — the Walmart Deals feed: current PartnerBoost
 * Affiliate Boost promotions (commission bumps), each enriched with product
 * detail + a commissionable tracking link. Read-only.
 *
 * Open to every signed-in tier (like the PartnerBoost finder) — it reads the
 * user's OWN connected PartnerBoost account, gated by the token check, not by
 * plan. Turning a deal into a post still runs through /api/walmart/generate,
 * which enforces the paid + WordPress gates.
 *
 * Query: page (default 1), pageSize (default 50, max 50).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWalmartDeals } from '@/services/partnerboost'
import { getExternalKey } from '@/lib/external-keys'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const token = await getExternalKey(supabase, user.id, 'partnerboost')
    if (!token) {
      return NextResponse.json({ ok: false, needsToken: true, error: 'Connect your PartnerBoost API key in External Integrations.' })
    }

    const { searchParams } = new URL(request.url)
    const page = Math.max(Number(searchParams.get('page')) || 1, 1)
    const pageSize = Math.min(Math.max(Number(searchParams.get('pageSize')) || 50, 1), 50)

    const { deals, hasMore } = await getWalmartDeals(token, { page, pageSize })
    return NextResponse.json({ ok: true, deals, hasMore, page })
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'PartnerBoost request timed out.'
      : e instanceof Error ? e.message : 'Unexpected error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
