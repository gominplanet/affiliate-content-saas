/**
 * GET /api/campaigns/catalog/search
 *
 * Filters the admin-uploaded creator_connections_catalog and returns the
 * matches the user would otherwise have gotten from uploading their own
 * .zip. Replaces the client-side filter loop in /campaigns/page.tsx with
 * a single SQL query that the user can hit instantly.
 *
 * Query params:
 *   keyword       string  — case-insensitive contains-match on brand/campaign_name
 *   minCommission number  — drop rows with commission < this (% as a number)
 *   minDays       number  — drop rows with days_left < this; null days kept
 *   needBudget    "1"|"0" — when "1" (default), require has_budget_and_slots=true
 *   limit         number  — top N by commission (default 500, max 3000)
 *
 * Returns the same { asin, campaignId, campaignName, brand, epc, endsAt,
 * commission } shape the existing legacy parser produces, so the rest of
 * the UI keeps working without changes.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface CatalogRow {
  asin: string
  campaign_id: string
  campaign_name: string | null
  brand: string | null
  commission: number | null
  ends_at: string | null
  days_left: number | null
  has_budget_and_slots: boolean
}

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const keyword = (searchParams.get('keyword') || '').trim().toLowerCase()
  const minCommission = Math.max(0, Number(searchParams.get('minCommission') || 0))
  const minDays = Math.max(0, Number(searchParams.get('minDays') || 0))
  const needBudget = (searchParams.get('needBudget') || '1') === '1'
  const limit = Math.min(3000, Math.max(1, Number(searchParams.get('limit') || 500)))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from('creator_connections_catalog')
    .select('asin, campaign_id, campaign_name, brand, commission, ends_at, days_left, has_budget_and_slots')
    .gte('commission', minCommission)
    // Either days_left is null (unknown, kept per legacy behavior) OR >= minDays
    .or(`days_left.is.null,days_left.gte.${minDays}`)
    .order('commission', { ascending: false })
    .limit(Math.max(limit * 4, 2000)) // overfetch since we dedupe by ASIN next

  if (needBudget) q = q.eq('has_budget_and_slots', true)

  if (keyword) {
    // Case-insensitive substring match across campaign_name + brand.
    // We can't simultaneously OR + ilike across two columns cleanly with
    // PostgREST's `or()` syntax + already-applied filters, so use a
    // tsquery via textSearch as a coarse first filter, then refine
    // client-side below.
    const safeKw = keyword.replace(/[%_]/g, '')
    q = q.or(`campaign_name.ilike.%${safeKw}%,brand.ilike.%${safeKw}%`)
  }

  const { data, error } = await q
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as CatalogRow[]

  // Dedupe on ASIN keeping highest commission (matches legacy behavior).
  const byAsin = new Map<string, CatalogRow>()
  for (const r of rows) {
    const prev = byAsin.get(r.asin)
    if (!prev || (r.commission ?? 0) > (prev.commission ?? 0)) {
      byAsin.set(r.asin, r)
    }
  }
  const final = [...byAsin.values()]
    .sort((a, b) => (b.commission ?? 0) - (a.commission ?? 0))
    .slice(0, limit)
    .map(r => ({
      asin: r.asin,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name || r.brand || r.asin,
      brand: r.brand || '',
      epc: r.commission != null ? `${r.commission}%` : '',
      endsAt: r.ends_at || '',
      commission: r.commission ?? 0,
    }))

  return NextResponse.json({
    matches: final,
    totalScanned: rows.length,
    uniqueAsins: byAsin.size,
  })
}
