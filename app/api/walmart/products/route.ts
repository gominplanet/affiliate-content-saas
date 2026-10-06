/**
 * GET /api/walmart/products — Walmart products for one PartnerBoost brand, via
 * the datafeed (mod=datafeed&op=list). Powers "Browse products" on the
 * admin-only Walmart PB Labs tool. Read-only.
 *
 * Query: brandId (preferred) and/or mcid, optional keywords, page, limit.
 * Admin-only; token is the server-only PARTNERBOOST_API_TOKEN env var.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { listPartnerBoostProducts, listAmazonProducts, type PBBrandType } from '@/services/partnerboost'
import { getExternalKey } from '@/lib/external-keys'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    // No plan gate: browsing reads the creator's OWN PartnerBoost key, like the
    // Levanta and Wayward browse routes and /api/partnerboost/finder. A 403 here
    // hid the whole page (the finder included) from a free trial that the
    // sidebar sends to it. Making a post (/api/walmart/generate) stays gated.

    const token = await getExternalKey(supabase, user.id, 'partnerboost')
    if (!token) return NextResponse.json({ ok: false, needsToken: true, error: 'Connect your PartnerBoost API key in External Integrations.' })

    const { searchParams } = new URL(request.url)
    const brandId = searchParams.get('brandId') || undefined
    const mcid = searchParams.get('mcid') || undefined
    const keywords = searchParams.get('keywords') || undefined
    const limit = Math.min(Number(searchParams.get('limit')) || 24, 100)
    const ALLOWED_TYPES: PBBrandType[] = ['Walmart', 'Amazon', 'DTC', 'TikTok', 'Indirect']
    const btRaw = (searchParams.get('brandType') || 'Walmart') as PBBrandType
    const brandType: PBBrandType = ALLOWED_TYPES.includes(btRaw) ? btRaw : 'Walmart'
    if (!brandId && !mcid && !keywords) {
      return NextResponse.json({ ok: false, error: 'A brand (brandId or mcid) or keywords is required.' }, { status: 400 })
    }

    // Amazon uses op=get_fba_products (the generic op=list datafeed rejects
    // brand_type=Amazon); everything else uses the generic datafeed. Both
    // normalize to the same PBProduct shape, so the rest of the flow is identical.
    const { products, total, totalPage } = brandType === 'Amazon'
      ? await listAmazonProducts(token, { brandId, keywords, limit })
      : await listPartnerBoostProducts(token, { brandType, brandId, mcid, keywords, limit })
    return NextResponse.json({ ok: true, total, totalPage, products })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 })
  }
}
