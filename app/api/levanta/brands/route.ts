/**
 * GET /api/levanta/brands — live read of the caller's Levanta brands via the
 * Creator v2 API. Powers the admin-only "MVP x Levanta" Labs tool.
 *
 * ADMIN-ONLY (integrations.tier === 'admin') while in Labs. Read-only: lists
 * brands + whether you have an approved partnership (`access`). Joining a brand
 * happens in the Levanta dashboard, not here.
 *
 * Token is a server-only env var (LEVANTA_API_TOKEN) — never returned, logged,
 * or echoed in errors.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { listLevantaBrands } from '@/services/levanta'
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
    const cursor = searchParams.get('cursor') || undefined
    const accessParam = searchParams.get('access')
    const access = accessParam === 'true' ? true : accessParam === 'false' ? false : undefined
    // Levanta validates `marketplace` strictly (a missing/empty value 422s).
    // Default to 'all' so every partnered brand shows regardless of marketplace.
    const marketplace = searchParams.get('marketplace') || 'all'

    const { brands, cursor: next } = await listLevantaBrands(token, { cursor, access, marketplace, limit: 100 })
    return NextResponse.json({ ok: true, brands, cursor: next })
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'Levanta request timed out.'
      : e instanceof Error ? e.message : 'Unexpected error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
