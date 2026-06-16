/**
 * GET /api/levanta/products?brandId=… — products for one Levanta brand via the
 * Creator v2 API. Admin-only (Labs). Returns ASIN, title, price, commission,
 * image, rating, platformEpc — the raw datafeed; the generate route enriches an
 * ASIN via the existing Amazon scraper.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { listLevantaProducts } from '@/services/levanta'
import { getExternalKey } from '@/lib/external-keys'
import type { Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    if (tier !== 'pro' && tier !== 'admin') {
      return NextResponse.json({ ok: false, error: 'MVP x Levanta is a Pro feature.' }, { status: 403 })
    }

    const token = await getExternalKey(supabase, user.id, 'levanta')
    if (!token) {
      return NextResponse.json({ ok: false, needsToken: true, error: 'Connect your Levanta API key in External Integrations.' })
    }

    const { searchParams } = new URL(request.url)
    const brandId = (searchParams.get('brandId') || '').trim()
    if (!brandId) return NextResponse.json({ ok: false, error: 'brandId required' }, { status: 400 })
    const cursor = searchParams.get('cursor') || undefined
    // Levanta validates `marketplace` strictly (missing/empty value 422s).
    const marketplace = searchParams.get('marketplace') || 'all'

    const { products, cursor: next } = await listLevantaProducts(token, { brandIds: brandId, cursor, marketplace, limit: 60 })
    return NextResponse.json({ ok: true, products, cursor: next })
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'Levanta request timed out.'
      : e instanceof Error ? e.message : 'Unexpected error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
