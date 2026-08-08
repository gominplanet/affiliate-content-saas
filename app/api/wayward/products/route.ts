/**
 * GET /api/wayward/products?page=1&pageSize=25&asin=…
 *
 * Browse the Wayward Amazon-Attribution product catalog (Labs). Open to any
 * signed-in user with their own Wayward API key connected (External
 * Integrations); no tier gate — access is by the user's own Wayward account.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getExternalKey } from '@/lib/external-keys'
import { getWaywardProducts } from '@/services/wayward'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const token = await getExternalKey(supabase, user.id, 'wayward')
    if (!token) {
      return NextResponse.json({ ok: false, needsToken: true, error: 'Connect your Wayward API key in External Integrations.' })
    }

    const { searchParams } = new URL(request.url)
    const pageNumber = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '25', 10) || 25))
    const asin = (searchParams.get('asin') || '').trim() || undefined
    const brandId = (searchParams.get('brandId') || '').trim() || undefined

    const page = await getWaywardProducts(token, { pageNumber, pageSize, asin, brandId })
    return NextResponse.json({ ok: true, ...page })
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'Wayward request timed out.'
      : e instanceof Error ? e.message : 'Unexpected error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
