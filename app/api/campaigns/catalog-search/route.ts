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
import { campaignRules, type CampaignRuleMode } from '@/lib/cc-smart-rules'
import { tierAllowsFinders, type Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Source & Earn is Studio + Pro only — and this route reads the proprietary
  // shared CC catalog, so gate it here too (not just at the UI). 2026-07-07.
  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!tierAllowsFinders((intRow?.tier as Tier) ?? 'trial')) {
    return NextResponse.json({ error: 'The AMZ Product Finder requires a paid plan.' }, { status: 403 })
  }

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80)
  // How many candidates to hand SCOUT to verify — a healthy multiple of the
  // final target, since the deep-check will filter more out.
  const limit = Math.min(120, Math.max(10, parseInt(url.searchParams.get('limit') || '60', 10)))
  // Pagination — each re-scan advances so users get FRESH campaigns, not repeats.
  const offset = Math.max(0, Math.min(20000, parseInt(url.searchParams.get('offset') || '0', 10)))
  // Rule mode: 'focus' (MVP Profitability Rules, default) or 'wide' (looser).
  const mode: CampaignRuleMode = url.searchParams.get('mode') === 'wide' ? 'wide' : 'focus'
  const RULES = campaignRules(mode)
  // Avoid substrings (name/brand check; SCOUT re-checks breadcrumb post-deep-check).
  const AVOID = RULES.avoidPatterns.map(p => p.toLowerCase())

  // Latest campaign end date we'll accept as "enough runway": today + minDaysLeft.
  const runwayCutoff = new Date(Date.now() + RULES.minDaysLeft * 86400000)
    .toISOString().slice(0, 10)

  // Keyword search runs against the STORED, GIN-indexed `search_vec` column
  // (migration 162 — name+brand). This is REQUIRED: a plain campaign_name FTS
  // has no matching index, so it seq-scans to_tsvector over ~240k rows and hits
  // the statement timeout. If search_vec is absent (mig 162 not run) the query
  // errors and we cleanly signal the panel to use the live SCOUT scan instead.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('cc_campaign_catalog')
    .select('campaign_id, campaign_name, brand_name, asins, commission_pct, ends_at, available_slot, total_slot')
    .gte('commission_pct', RULES.minCommissionPct)  // ≥ active-mode floor
    .gte('ends_at', runwayCutoff)                    // still running ≥ minDaysLeft
    .order('commission_pct', { ascending: false })
    .order('campaign_id', { ascending: true })       // stable tiebreak so pages don't overlap
    // over-fetch a window (avoid-list + no-ASIN thin it below `limit`); paginate it.
    .range(offset, offset + limit * 3 - 1)
  if (q) query = query.textSearch('search_vec', q, { type: 'websearch' })

  const { data, error } = await query
  if (error) {
    // Table/column missing (mig 161/162 not run) or another hiccup → tell the
    // panel to fall back to the live SCOUT scan rather than show an error.
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

  // A full DB window came back ⇒ there are almost certainly more pages. The
  // panel advances `offset` by the window size on the next scan to dig deeper.
  const windowSize = limit * 3
  const hasMore = rows.length >= windowSize
  return NextResponse.json({
    ok: true, query: q, candidates, matched: rows.length,
    offset, nextOffset: offset + windowSize, hasMore,
  })
}
