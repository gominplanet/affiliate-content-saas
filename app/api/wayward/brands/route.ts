/**
 * GET /api/wayward/brands?page=1&pageSize=200
 *
 * List Wayward brands (id, name, avg commission, active product count) so the
 * finder can offer a brand filter + "top-commission brands" discovery. The
 * catalog products endpoint has no keyword/sort, so the brand list is the real
 * way to narrow 326k products.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getExternalKey } from '@/lib/external-keys'
import { getWaywardBrands } from '@/services/wayward'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const token = await getExternalKey(supabase, user.id, 'wayward')
    if (!token) return NextResponse.json({ ok: false, needsToken: true, error: 'Connect your Wayward API key in External Integrations.' })

    const { searchParams } = new URL(request.url)
    const pageNumber = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') || '200', 10) || 200))

    const data = await getWaywardBrands(token, { pageNumber, pageSize })
    return NextResponse.json({ ok: true, ...data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
