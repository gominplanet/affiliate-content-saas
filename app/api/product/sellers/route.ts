/**
 * GET /api/product/sellers?asin=<ASIN>
 *
 * Tier C of the deep-dive: the competition read — how many sellers compete on
 * the listing, whether Amazon sells it directly, and which major marketplaces
 * carry it (for geo-routed international affiliate traffic).
 *
 * COSTLY: uses Keepa's `&offers` (a live, multi-token refresh) plus a few cheap
 * cross-marketplace existence probes. So this is a SEPARATE on-demand endpoint,
 * fired only when a creator clicks "Check sellers & marketplaces" — never on a
 * plain deep-dive open. Signed-in only; sanitized errors.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { fetchKeepaSellers, keepaConfigured } from '@/services/keepa'
import { toUserMessage } from '@/lib/friendly-error'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const asin = (new URL(request.url).searchParams.get('asin') || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: 'Enter a valid 10-character ASIN.' }, { status: 400 })
    if (!keepaConfigured()) return NextResponse.json({ error: 'Seller data isn’t available right now. Please try again later.' }, { status: 503 })

    const s = await fetchKeepaSellers(asin)
    return NextResponse.json({
      ok: true,
      asin,
      sellerCount: s.sellerCount,
      soldByAmazon: s.soldByAmazon,
      singleSeller: s.singleSeller,
      marketplaces: s.marketplaces,
    })
  } catch (err) {
    console.error('[product/sellers]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, "Couldn't load seller data just now. Please try again in a moment.") }, { status: 500 })
  }
}
