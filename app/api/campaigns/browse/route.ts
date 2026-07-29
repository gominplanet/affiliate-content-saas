// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/campaigns/browse — the fast, sortable "Browse all" view of the shared
// Creator Connections catalog (cc_campaign_catalog, migration 161).
//
// Unlike /catalog-search (which gates by MVP's proprietary rules and hands a
// shortlist to SCOUT to live-verify), this is a plain, instant browse of every
// still-running campaign — the CreatorKit-style table: rate · budget left ·
// slots claimed · days left — with the user's own sort/filter, sub-second, no
// Amazon traffic and no per-user cost (one shared cache read).
//
// Product-signal columns (recent sales, rating, video count) are NOT here yet —
// those arrive in a follow-up once the catalog's ASINs are Keepa-enriched; this
// route only serves the campaign-economics the catalog already holds.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsFinders, type Tier } from '@/lib/tier'
import { toUserMessage } from '@/lib/friendly-error'

export const dynamic = 'force-dynamic'

type SortKey = 'commission' | 'endingSoon' | 'mostRunway' | 'slots' | 'budget'
const PAGE_SIZE = 40

export async function GET(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Same gate as the rest of the finder (paid tiers). Flipping the BROWSE view
    // to free later is a one-line change here — the read costs ~nothing.
    const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    if (!tierAllowsFinders((intRow?.tier as Tier) ?? 'trial')) {
      return NextResponse.json({ error: 'The AMZ Product Finder requires a paid plan.' }, { status: 403 })
    }

    const url = new URL(request.url)
    const q = (url.searchParams.get('q') || '').trim().slice(0, 80)
    const minCommission = numParam(url, 'minCommission') ?? 0
    const minDaysLeft = Math.max(0, numParam(url, 'minDaysLeft') ?? 0)
    const openSlotsOnly = url.searchParams.get('openSlots') === '1'
    const sort = (url.searchParams.get('sort') || 'commission') as SortKey
    const page = Math.max(0, intParam(url, 'page') ?? 0)

    // "Still running" is the baseline; minDaysLeft raises the runway floor.
    const runwayCutoff = new Date(Date.now() + minDaysLeft * 86_400_000).toISOString().slice(0, 10)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const build = () => {
      let query = sb.from('cc_campaign_catalog')
        .select('campaign_id, campaign_name, brand_name, asins, commission_pct, starts_at, ends_at, budget, budget_remaining, available_slot, total_slot')
        .gte('ends_at', runwayCutoff)
      if (minCommission > 0) query = query.gte('commission_pct', minCommission)
      if (openSlotsOnly) query = query.gt('available_slot', 0)
      if (q) query = query.textSearch('search_vec', q, { type: 'websearch' })
      return applySort(query, sort)
    }

    const from = page * PAGE_SIZE
    let { data, error } = await build().range(from, from + PAGE_SIZE - 1)
    // search_vec absent (migration 162 not run) or another keyword hiccup — retry
    // once without the keyword so browse still works.
    if (error && q) {
      let fb = sb.from('cc_campaign_catalog')
        .select('campaign_id, campaign_name, brand_name, asins, commission_pct, starts_at, ends_at, budget, budget_remaining, available_slot, total_slot')
        .gte('ends_at', runwayCutoff)
      if (minCommission > 0) fb = fb.gte('commission_pct', minCommission)
      if (openSlotsOnly) fb = fb.gt('available_slot', 0)
      fb = fb.ilike('campaign_name', `%${q}%`)
      ;({ data, error } = await applySort(fb, sort).range(from, from + PAGE_SIZE - 1))
    }
    if (error) {
      console.error('[campaigns/browse]', error.message)
      return NextResponse.json({ error: toUserMessage(error, 'Could not load campaigns just now. Please try again in a moment.') }, { status: 500 })
    }

    type Row = {
      campaign_id: string; campaign_name: string; brand_name: string | null
      asins: string[]; commission_pct: number; starts_at: string | null; ends_at: string
      budget: number | null; budget_remaining: number | null
      available_slot: number | null; total_slot: number | null
    }
    const rows = ((data ?? []) as Row[]).filter(r => Array.isArray(r.asins) && r.asins.length > 0)
    const campaigns = rows.map(toClient)
    return NextResponse.json({ ok: true, page, campaigns, hasMore: (data ?? []).length === PAGE_SIZE })
  } catch (err) {
    console.error('[campaigns/browse]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Could not load campaigns just now. Please try again in a moment.') }, { status: 500 })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySort(query: any, sort: SortKey) {
  switch (sort) {
    case 'endingSoon':  return query.order('ends_at', { ascending: true }).order('campaign_id', { ascending: true })
    case 'mostRunway':  return query.order('ends_at', { ascending: false }).order('campaign_id', { ascending: true })
    case 'slots':       return query.order('available_slot', { ascending: false, nullsFirst: false }).order('campaign_id', { ascending: true })
    case 'budget':      return query.order('budget_remaining', { ascending: false, nullsFirst: false }).order('campaign_id', { ascending: true })
    case 'commission':
    default:            return query.order('commission_pct', { ascending: false }).order('ends_at', { ascending: true }).order('campaign_id', { ascending: true })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toClient(r: any) {
  let daysLeft: number | null = null
  try { daysLeft = Math.max(0, Math.ceil((new Date(r.ends_at).getTime() - Date.now()) / 86_400_000)) } catch { /* keep null */ }
  const total = typeof r.total_slot === 'number' ? r.total_slot : null
  const open = typeof r.available_slot === 'number' ? r.available_slot : null
  const claimed = total != null && open != null ? Math.max(0, total - open) : null
  const budget = typeof r.budget === 'number' ? r.budget : null
  const budgetRemaining = typeof r.budget_remaining === 'number' ? r.budget_remaining : null
  const budgetPct = budget != null && budget > 0 && budgetRemaining != null
    ? Math.max(0, Math.min(100, Math.round((budgetRemaining / budget) * 100))) : null
  return {
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    brand: r.brand_name,
    asin: r.asins[0] as string,
    asinCount: r.asins.length,
    commissionPct: Number(r.commission_pct),
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    daysLeft,
    slotsOpen: open,
    totalSlot: total,
    slotsClaimed: claimed,
    budget,
    budgetRemaining,
    budgetPct,
  }
}

function intParam(url: URL, key: string): number | null {
  const v = url.searchParams.get(key); if (v == null || v === '') return null
  const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null
}
function numParam(url: URL, key: string): number | null {
  const v = url.searchParams.get(key); if (v == null || v === '') return null
  const n = Number(v); return Number.isFinite(n) ? n : null
}
