/**
 * GET /api/products/for-you
 *
 * "Made for your channel" — products scored against the creator's affinity
 * profile (categories they earn in, their topic keywords, their buyers' price
 * band) instead of the same best-sellers everyone sees. Candidates come from the
 * enriched CC campaign catalog (which also carries a paying commission), so a
 * match is both a fit AND a monetizable pick. Signed-in only; no extra API cost.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrComputeAffinity, scoreProductForAffinity } from '@/lib/creator-affinity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CANDIDATE_COLS = 'rep_asin,campaign_name,brand_name,image_url,price_now_cents,price_was_cents,discount_pct,rating,review_count,monthly_sold,video_count,category,parent_asin,sales_rank,sales_rank_category,listed_since,commission_pct'

function taggedLink(asin: string, tag: string | null): string {
  const base = `https://www.amazon.com/dp/${asin}`
  return tag ? `${base}?tag=${encodeURIComponent(tag)}` : base
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const profile = await getOrComputeAffinity(admin, user.id)

  // Own Amazon tag for the links (falls back to the operator tag in taggedLink).
  let tag: string | null = null
  try {
    const { data: intg } = await supabase.from('integrations').select('amazon_associates_tag').eq('user_id', user.id).maybeSingle()
    tag = ((intg as { amazon_associates_tag?: string } | null)?.amazon_associates_tag || '').trim() || null
  } catch { /* optional */ }

  const today = new Date().toISOString().slice(0, 10)
  const catNames = profile.categories.map(c => c.name).slice(0, 8)

  // Candidate pool: on-affinity categories first (the real match), newest-ending
  // live campaigns, most-bought first. New creators (no categories yet) fall back
  // to a high-demand slice so the feed still has something useful.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  let candidates: any[] = []
  try {
    let q = sb.from('cc_campaign_catalog').select(CANDIDATE_COLS).not('rep_asin', 'is', null).gte('ends_at', today)
    if (catNames.length) q = q.in('category', catNames)
    const { data } = await q.order('monthly_sold', { ascending: false, nullsFirst: false }).limit(catNames.length ? 400 : 200)
    candidates = Array.isArray(data) ? data : []
    // If the category filter came back thin (stale catalog / mismatch), widen once.
    if (catNames.length && candidates.length < 12) {
      const { data: wide } = await sb.from('cc_campaign_catalog').select(CANDIDATE_COLS).not('rep_asin', 'is', null).gte('ends_at', today)
        .order('monthly_sold', { ascending: false, nullsFirst: false }).limit(200)
      const seen = new Set(candidates.map(c => c.rep_asin))
      for (const r of (wide ?? []) as any[]) if (!seen.has(r.rep_asin)) candidates.push(r)
    }
  } catch (e) {
    console.error('[for-you]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: true, profile, products: [], hasProfile: profile.sampleSize > 0 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scored = candidates.map((r: any) => {
    const { score, reasons } = scoreProductForAffinity({
      category: r.category, priceNowCents: r.price_now_cents, monthlySold: r.monthly_sold,
      videoCount: r.video_count, commissionPct: r.commission_pct, title: r.campaign_name,
    }, profile)
    const asin = String(r.rep_asin).toUpperCase()
    const estCommissionCents = (r.price_now_cents != null && r.commission_pct != null)
      ? Math.round(r.price_now_cents * (r.commission_pct / 100)) : null
    return {
      score, reasons,
      product: {
        asin, parentAsin: r.parent_asin ?? null,
        imageUrl: r.image_url ?? null, imageHref: taggedLink(asin, tag),
        brand: r.brand_name ?? null, title: r.campaign_name ?? null,
        priceNow: r.price_now_cents != null ? Math.round(r.price_now_cents) / 100 : null,
        priceWas: r.price_was_cents != null ? Math.round(r.price_was_cents) / 100 : null,
        discountPct: r.discount_pct ?? null,
        rating: r.rating != null ? Number(r.rating) : null, reviewCount: r.review_count ?? null,
        monthlySold: r.monthly_sold ?? null, hasVideo: (r.video_count ?? 0) > 0,
        salesRank: r.sales_rank ?? null, salesRankCategory: r.sales_rank_category ?? null,
        category: r.category ?? null, listedSince: r.listed_since ?? null,
        commission: estCommissionCents != null ? { cents: estCommissionCents, ratePct: r.commission_pct, isBounty: true } : null,
      },
    }
  })
  // Best match first; break ties by demand.
  scored.sort((a, b) => b.score - a.score || (b.product.monthlySold ?? 0) - (a.product.monthlySold ?? 0))
  const products = scored.slice(0, 24)

  return NextResponse.json({ ok: true, profile, hasProfile: profile.sampleSize > 0, products })
}
