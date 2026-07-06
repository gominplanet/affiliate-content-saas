// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/campaigns/catalog-search?q=<keyword>&limit=<n>
//
// The instant half of "Campaigns ON": queries the shared cc_campaign_catalog
// (migration 161, imported from Amazon's full CC export) instead of scraping
// the live Creator Connections grid. Applies the ON-CATALOG rulebook gates
// (commission floor, still-running + minimum runway, avoid-list on name/brand),
// ranks by commission, and returns candidate campaigns — each with a
// representative ASIN. SCOUT then verifies only that shortlist by ASIN
// (price / units / rating / carousel). No Amazon traffic, sub-second.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { CC_SMART_RULES } from '@/lib/cc-smart-rules'

export const dynamic = 'force-dynamic'

// Reuse the rulebook's avoid substrings (name/brand check; SCOUT re-checks the
// breadcrumb after the deep-check).
const AVOID = CC_SMART_RULES.avoidPatterns.map(p => p.toLowerCase())

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80)
  // How many candidates to hand SCOUT to verify — a healthy multiple of the
  // final target, since the deep-check will filter more out.
  const limit = Math.min(120, Math.max(10, parseInt(url.searchParams.get('limit') || '60', 10)))

  const today = new Date().toISOString().slice(0, 10)
  // Latest campaign end date we'll accept as "enough runway": today + minDaysLeft.
  const runwayCutoff = new Date(Date.now() + CC_SMART_RULES.minDaysLeft * 86400000)
    .toISOString().slice(0, 10)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('cc_campaign_catalog')
    .select('campaign_id, campaign_name, brand_name, asins, commission_pct, ends_at, available_slot, total_slot')
    .gte('commission_pct', CC_SMART_RULES.minCommissionPct)  // ≥ rulebook floor
    .gte('ends_at', runwayCutoff)                            // still running ≥ minDaysLeft
    .order('commission_pct', { ascending: false })
    .limit(limit * 3) // over-fetch: the avoid-list + no-ASIN filters thin this below `limit`

  if (q) {
    // Full-text over name+brand (the cc_catalog_fts_idx GIN index). websearch
    // syntax so multi-word keywords behave ("massage gun" → both terms).
    query = query.textSearch('campaign_name', q, { type: 'websearch', config: 'english' })
  }

  const { data, error } = await query
  if (error) {
    // Table missing (migration 161 not run) or FTS hiccup → tell the panel to
    // fall back to the live SCOUT scan rather than showing an error.
    return NextResponse.json({ ok: false, error: 'catalog-unavailable', detail: error.message }, { status: 200 })
  }

  type Row = {
    campaign_id: string; campaign_name: string; brand_name: string | null
    asins: string[]; commission_pct: number; ends_at: string
    available_slot: number | null; total_slot: number | null
  }
  const rows = (data ?? []) as Row[]
  const hitsAvoid = (r: Row) => {
    const hay = `${r.campaign_name} ${r.brand_name || ''}`.toLowerCase()
    return AVOID.some(p => hay.includes(p))
  }

  const candidates = rows
    .filter(r => Array.isArray(r.asins) && r.asins.length > 0)
    .filter(r => !hitsAvoid(r))
    .slice(0, limit)
    .map(r => {
      let daysLeft: number | null = null
      try { daysLeft = Math.max(0, Math.ceil((new Date(r.ends_at).getTime() - Date.now()) / 86400000)) } catch { /* keep null */ }
      return {
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        brand: r.brand_name,
        // Representative ASIN SCOUT will verify (the campaign's first product).
        asin: r.asins[0],
        asins: r.asins,
        commissionPct: r.commission_pct,
        endsAt: r.ends_at,
        daysLeft,
        slotsOpen: typeof r.available_slot === 'number' ? r.available_slot : null,
      }
    })

  return NextResponse.json({ ok: true, query: q, candidates, matched: rows.length })
}
