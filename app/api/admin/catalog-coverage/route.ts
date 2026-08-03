// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/admin/catalog-coverage?q=<keyword>   (admin only)
//
// Diagnostic for "Amazon CC shows 1000+ for a keyword, MVP Browse shows 2".
// For a keyword it reports: total catalog size, how many rows match our
// name+brand full-text index (what Browse searches), how many match a plain
// name ILIKE, and a sample of matches with their import date + runway — so we
// can tell whether the gap is a STALE/partial import (few rows, old dates) or a
// SEARCH-SCOPE gap (Amazon matches the product; we only match the campaign name).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier } from '@/lib/tier'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (normalizeTier(intRow?.tier) !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80)
  if (!q) return NextResponse.json({ error: 'Pass ?q=<keyword>' }, { status: 400 })

  const admin = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const A = admin as any
  const countOf = async (mod: (query: any) => any, estimated = false): Promise<number | null> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      let query = A.from('cc_campaign_catalog').select('campaign_id', { count: estimated ? 'estimated' : 'exact', head: true })
      query = mod(query)
      const { count, error } = await query
      return error || count == null ? null : count
    } catch { return null }
  }

  // What Browse actually searches: the name+brand FTS index (search_vec).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ftsCount = await countOf((query: any) => query.textSearch('search_vec', q, { type: 'websearch' }))
  // Same, but only LIVE campaigns (ends_at >= today) — Browse's default.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ftsLiveCount = await countOf((query: any) => query.textSearch('search_vec', q, { type: 'websearch' }).gte('ends_at', today))
  // A plain name ILIKE (may seq-scan; best-effort, null on timeout).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nameIlikeCount = await countOf((query: any) => query.ilike('campaign_name', `%${q}%`))
  const total = await countOf((query: any) => query, true) // eslint-disable-line @typescript-eslint/no-explicit-any

  // A sample of matches with import date + runway, to eyeball staleness/names.
  let sample: Array<{ name: string; brand: string | null; importedAt: string | null; endsAt: string; enriched: boolean; asinCount: number }> = []
  // How many of the matching rows actually carry a populated asins column —
  // Browse needs an ASIN, so rows with 0 asins used to be dropped.
  let withAsins: number | null = null
  try {
    const { data } = await A.from('cc_campaign_catalog')
      .select('campaign_name, brand_name, imported_at, ends_at, product_verified_at, asins')
      .textSearch('search_vec', q, { type: 'websearch' })
      .order('imported_at', { ascending: false })
      .limit(20)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sample = (data ?? []).map((r: any) => ({
      name: r.campaign_name, brand: r.brand_name, importedAt: r.imported_at ?? null,
      endsAt: r.ends_at, enriched: r.product_verified_at != null,
      asinCount: Array.isArray(r.asins) ? r.asins.length : 0,
    }))
  } catch { /* sample is best-effort */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withAsins = await countOf((query: any) => query.textSearch('search_vec', q, { type: 'websearch' }).not('asins', 'eq', '{}'))

  // Best-effort newest import across the whole catalog (the staleness signal).
  let latestImportedAt: string | null = null
  try {
    const { data } = await A.from('cc_campaign_catalog').select('imported_at').order('imported_at', { ascending: false }).limit(1)
    latestImportedAt = data?.[0]?.imported_at ?? null
  } catch { /* best-effort */ }

  return NextResponse.json({
    ok: true, q, total, ftsCount, ftsLiveCount, nameIlikeCount, withAsins, latestImportedAt, sample,
  })
}
