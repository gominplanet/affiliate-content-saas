/**
 * GET /api/campaigns/catalog/search
 *
 * Filters the admin-uploaded creator_connections_catalog and returns the
 * matches the user would otherwise have gotten from uploading their own
 * .zip. Hits a Postgres RPC function (search_creator_campaigns) so the
 * query planner sees ONE deterministic SQL statement and can pick the
 * trigram + b-tree indexes consistently — vs. PostgREST's auto-generated
 * SQL from chained .or() calls which kept hitting statement timeouts.
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

interface RpcRow {
  asin: string
  campaign_id: string
  campaign_name: string | null
  brand: string | null
  commission: number | null
  ends_at: string | null
  days_left: number | null
}

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const keyword = (searchParams.get('keyword') || '').trim()
  const minCommission = Math.max(0, Number(searchParams.get('minCommission') || 0))
  const minDays = Math.max(0, Number(searchParams.get('minDays') || 0))
  const needBudget = (searchParams.get('needBudget') || '1') === '1'
  const limit = Math.min(3000, Math.max(1, Number(searchParams.get('limit') || 500)))

  // Modest overfetch (2x, min 200) to leave headroom for the dedupe-by-ASIN
  // pass below without making Postgres sort 2000+ rows just so we can throw
  // most away. The earlier overfetch=2000 was crossing the per-statement
  // timeout for keyword searches even with trigram indexes — each extra
  // row in the LIMIT N means more candidates the planner has to sort.
  const overfetch = Math.max(limit * 2, 200)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('search_creator_campaigns', {
    p_keyword: keyword || null,
    p_min_commission: minCommission,
    p_min_days: minDays,
    p_need_budget: needBudget,
    p_limit: overfetch,
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as RpcRow[]

  // Dedupe on ASIN keeping highest commission (matches legacy behavior).
  const byAsin = new Map<string, RpcRow>()
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
