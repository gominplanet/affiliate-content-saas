/**
 * GET /api/levanta/products?brandId=… — products for one Levanta brand via the
 * Creator v2 API. Admin-only (Labs). Returns ASIN, title, price, commission,
 * image, rating, platformEpc — the raw datafeed; the generate route enriches an
 * ASIN via the existing Amazon scraper.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { listLevantaProducts, levantaRaw } from '@/services/levanta'
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
    if (tier !== 'admin') {
      return NextResponse.json({ ok: false, error: 'MVP x Levanta is admin-only while in Labs.' }, { status: 403 })
    }

    const token = process.env.LEVANTA_API_TOKEN?.trim()
    if (!token) {
      return NextResponse.json({ ok: false, needsToken: true, error: 'LEVANTA_API_TOKEN is not set in the environment.' })
    }

    const { searchParams } = new URL(request.url)

    // Debug: return the RAW Levanta product shape so we can map live field names
    // exactly (the docs have diverged). Admin-only; returns catalogue data, not
    // the token. Hit /api/levanta/products?debug=1 (no brandId needed).
    if (searchParams.get('debug') === '1') {
      const raw = await levantaRaw(token, '/products?limit=2&marketplace=all')
      return NextResponse.json({ ok: true, raw })
    }

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
