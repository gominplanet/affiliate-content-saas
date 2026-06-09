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
import { createAdminClient } from '@/lib/supabase/admin'
import { probeCarouselVideo } from '@/services/amazon'

export const dynamic = 'force-dynamic'
// When the carousel-video filter is on, we run up to ~30 parallel Amazon
// scrapes per request (3x oversample × 10 concurrency). Each scrape is
// capped at 6s but the whole pass can take 15-25s on a cold catalog.
// 60s ceiling gives plenty of headroom + matches what /api/campaigns/import
// uses for its own Amazon enrichment step.
export const maxDuration = 60

interface RpcRow {
  asin: string
  campaign_id: string
  campaign_name: string | null
  brand: string | null
  commission: number | null
  ends_at: string | null
  days_left: number | null
  price: number | null
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
  // Price bounds — both optional. Empty string / missing / non-numeric
  // becomes null which the RPC reads as "no bound on that side". We
  // don't clamp to ≥0 because the RPC null-checks before comparing.
  const minPriceRaw = searchParams.get('minPrice')
  const maxPriceRaw = searchParams.get('maxPrice')
  const minPrice = minPriceRaw && !isNaN(Number(minPriceRaw)) ? Number(minPriceRaw) : null
  const maxPrice = maxPriceRaw && !isNaN(Number(maxPriceRaw)) ? Number(maxPriceRaw) : null
  // When set, the route post-filters the RPC results to only ASINs whose
  // Amazon product page has at least one video in the top image carousel.
  // Costs ~30 parallel scrapes worst-case per request, hence the bumped
  // maxDuration above.
  const requireCarouselVideo = searchParams.get('requireCarouselVideo') === '1'

  // Since the RPC now returns one canonical row per ASIN (migration
  // 098 added is_canonical), the route-side dedupe is no-op work.
  // Overfetch stays at 2x as cheap insurance in case a future RPC
  // refactor reintroduces duplicates — Postgres barely notices the
  // extra few hundred rows on the canonical subset.
  // When the carousel-video filter is on, oversample MORE (5x) to give
  // the filter enough candidates to fill the user's queue cap — empirical
  // hit rate is ~30-50% for products with carousel video, so 5x leaves
  // headroom even on stricter niches.
  const overfetch = requireCarouselVideo
    ? Math.max(limit * 5, 200)
    : Math.max(limit * 2, 200)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc('search_creator_campaigns', {
    p_keyword: keyword || '',
    p_min_commission: minCommission,
    p_min_days: minDays,
    p_need_budget: needBudget,
    p_limit: overfetch,
    p_min_price: minPrice,
    p_max_price: maxPrice,
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
  // Sort by commission, but DON'T slice to `limit` yet when the
  // carousel-video filter is on — the filter drops 50-70% of candidates,
  // so we need the full oversampled pool to fill the user's queue cap.
  const sortedCandidates = [...byAsin.values()]
    .sort((a, b) => (b.commission ?? 0) - (a.commission ?? 0))

  let kept = sortedCandidates
  // Per-verdict counters so the UI can distinguish "Amazon blocked us"
  // (bot-challenge / fetch-failed) from "the products genuinely have no
  // carousel video" (no-video). Critical for debugging zero-result
  // searches — previously the user couldn't tell whether the filter was
  // overly strict or whether the scrape was being blocked entirely.
  const counts = { hasVideo: 0, noVideo: 0, botChallenge: 0, fetchFailed: 0, notFound: 0 }
  // ASINs that returned 404 on Amazon — we'll prune them from the
  // shared catalog after responding so future searches don't waste
  // probe budget on the same dead products. Self-healing: over time
  // the catalog gets cleaner without any admin intervention.
  const deadAsins: string[] = []
  if (requireCarouselVideo) {
    const survivors: typeof sortedCandidates = []
    const CHUNK = 10
    for (let i = 0; i < sortedCandidates.length && survivors.length < limit; i += CHUNK) {
      const batch = sortedCandidates.slice(i, i + CHUNK)
      const verdicts = await Promise.all(batch.map(r => probeCarouselVideo(r.asin)))
      verdicts.forEach((v, idx) => {
        switch (v) {
          case 'has-video':     counts.hasVideo++;     survivors.push(batch[idx]); break
          case 'no-video':      counts.noVideo++;      break
          case 'bot-challenge': counts.botChallenge++; break
          case 'fetch-failed':  counts.fetchFailed++;  break
          case 'not-found':
            counts.notFound++
            deadAsins.push(batch[idx].asin)
            break
        }
      })
    }
    kept = survivors
  }

  // Fire-and-forget prune of confirmed-dead ASINs. Uses the admin
  // client because the catalog has no DELETE RLS for regular users
  // (it's an admin-managed shared table). Failure is non-fatal — the
  // next search will probe the same ASINs again and try to prune
  // them once more, so eventual consistency is fine.
  if (deadAsins.length > 0) {
    try {
      const admin = createAdminClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(admin as any)
        .from('creator_connections_catalog')
        .delete()
        .in('asin', deadAsins)
        .then(({ error, count }: { error: unknown; count: number | null }) => {
          if (error) console.error('[campaigns/search] dead-asin prune failed:', error)
          else console.log(`[campaigns/search] pruned ${count ?? deadAsins.length} dead ASIN rows from catalog`)
        }, (err: unknown) => {
          console.error('[campaigns/search] dead-asin prune threw:', err)
        })
    } catch (e) {
      console.error('[campaigns/search] could not start dead-asin prune:', e)
    }
  }

  const final = kept
    .slice(0, limit)
    .map(r => ({
      asin: r.asin,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name || r.brand || r.asin,
      brand: r.brand || '',
      epc: r.commission != null ? `${r.commission}%` : '',
      endsAt: r.ends_at || '',
      commission: r.commission ?? 0,
      price: r.price,
    }))

  // Surface the catalog's freshness so the UI can show "last refreshed
  // X days ago" — the user has no other way to know whether the admin
  // ran the weekly upload yet. Cheap one-row query against the same
  // table, runs in parallel with the search above (well, sequentially
  // here but indexed on imported_at so it's a single index lookup).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: freshness } = await (supabase as any)
    .from('creator_connections_catalog')
    .select('imported_at')
    .order('imported_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    matches: final,
    totalScanned: rows.length,
    uniqueAsins: byAsin.size,
    lastRefresh: freshness?.imported_at ?? null,
    // Surface the carousel-video filter result so the UI can explain
    // a low/zero match count. Breaks down by verdict so the user can
    // tell "Amazon blocked our scrape" from "the products genuinely
    // have no video".
    carouselVideoFilter: requireCarouselVideo
      ? {
          probed: counts.hasVideo + counts.noVideo + counts.botChallenge + counts.fetchFailed + counts.notFound,
          kept: counts.hasVideo,
          noVideo: counts.noVideo,
          botChallenge: counts.botChallenge,
          fetchFailed: counts.fetchFailed,
          notFound: counts.notFound,
          // Number of dead ASINs we just pruned from the catalog so the
          // next search doesn't see them. Self-healing signal — the UI
          // can show "catalog cleaned of N dead products".
          prunedFromCatalog: deadAsins.length,
        }
      : null,
  })
}
