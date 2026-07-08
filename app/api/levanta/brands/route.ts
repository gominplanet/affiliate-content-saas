/**
 * GET /api/levanta/brands — live read of the caller's Levanta brands via the
 * Creator v2 API. Powers the "browse a specific brand" list on MVP x Levanta
 * (Source & Earn, Studio + Pro).
 *
 * Read-only: lists brands + whether you have an approved partnership (`access`).
 * Joining a brand happens in the Levanta dashboard, not here. Levanta pages
 * brands 100-at-a-time via a cursor, so we FOLLOW the cursor and return the
 * caller's FULL partnered set in one response — a 800-brand account used to see
 * only the first 100. Per-user key stored encrypted; never echoed.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { listLevantaBrands } from '@/services/levanta'
import { getExternalKey } from '@/lib/external-keys'
import { tierAllowsFinders, type Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BRAND_PAGE = 100        // Levanta's per-page max
const MAX_BRAND_PAGES = 40    // up to ~4000 brands
const SWEEP_DEADLINE_MS = 45_000

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    if (!tierAllowsFinders(tier)) {
      return NextResponse.json({ ok: false, error: 'MVP x Levanta requires a paid plan.' }, { status: 403 })
    }

    // Per-user key (External Integrations) with shared env fallback.
    const token = await getExternalKey(supabase, user.id, 'levanta')
    if (!token) {
      return NextResponse.json({ ok: false, needsToken: true, error: 'Connect your Levanta API key in External Integrations.' })
    }

    const { searchParams } = new URL(request.url)
    const accessParam = searchParams.get('access')
    const access = accessParam === 'true' ? true : accessParam === 'false' ? false : undefined
    // Levanta validates `marketplace` strictly (a missing/empty value 422s).
    // Default to 'all' so every partnered brand shows regardless of marketplace.
    const marketplace = searchParams.get('marketplace') || 'all'

    // Follow the cursor to the end so the caller sees ALL their brands, not just
    // the first page of 100. Bounded by page + wall-clock caps so a huge account
    // can't run past the function ceiling — we return whatever we gathered.
    const all: Awaited<ReturnType<typeof listLevantaBrands>>['brands'] = []
    let cur: string | undefined
    const t0 = Date.now()
    for (let p = 0; p < MAX_BRAND_PAGES; p++) {
      const { brands, cursor: next } = await listLevantaBrands(token, { cursor: cur, access, marketplace, limit: BRAND_PAGE })
      all.push(...brands)
      if (!next || Date.now() - t0 > SWEEP_DEADLINE_MS) break
      cur = next
    }
    return NextResponse.json({ ok: true, brands: all, cursor: null, total: all.length })
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'Levanta request timed out.'
      : e instanceof Error ? e.message : 'Unexpected error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
