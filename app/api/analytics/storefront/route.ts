/**
 * GET /api/analytics/storefront — per-PRODUCT performance (Storefront Stats v1).
 *
 * Rolls the creator's content up by product (ASIN) and attaches the real money
 * signal we already have: Geniuslink clicks. Each product shows how many pieces
 * cover it (blog + YouTube), total clicks across those links, and a demand /
 * price estimate from the Keepa-enriched deal cache.
 *
 * This is the "storefront" view Logie-style tools sell, built from data MVP
 * already holds — no Amazon-earnings scraping. Real sales/revenue (v2) needs a
 * SCOUT reader for the authenticated earnings pages.
 *
 * Product ↔ content mapping:
 *   - blog_posts.deal_meta->>asin  (deal / product posts) + geniuslink_code
 *   - youtube_videos.asin          + geniuslink_yt_code
 * Clicks come per-shortcode from Geniuslink (last 30 days, bot-filtered).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createGeniuslinkService } from '@/services/geniuslink'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Bound the Geniuslink fan-out so a big catalog can't 504 the route.
const MAX_CODES = 150
const CONCURRENCY = 8

interface Piece { type: 'blog' | 'youtube'; title: string; url: string | null; code: string }

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations')
      .select('geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', user.id)
      .single()
    if (!intRow?.geniuslink_api_key || !intRow?.geniuslink_api_secret) {
      return NextResponse.json({ connected: false, products: [], totals: { products: 0, clicks: 0, topClicks: 0 } })
    }

    // Gather product-linked content (only pieces that carry a Geniuslink code —
    // no code = no click data to roll up).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [postsRes, vidsRes] = await Promise.all([
      // deal_meta lags the generated types — cast, it exists at runtime.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('blog_posts')
        .select('title,wordpress_url,geniuslink_code,deal_meta')
        .eq('user_id', user.id)
        .eq('status', 'published')
        .not('geniuslink_code', 'is', null),
      // asin (migration 204) + geniuslink_yt_code (114) lag the generated types,
      // so cast through any — they exist at runtime.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('youtube_videos')
        .select('title,asin,geniuslink_yt_code,youtube_video_id')
        .eq('user_id', user.id)
        .not('asin', 'is', null)
        .not('geniuslink_yt_code', 'is', null),
    ])

    // Group pieces by ASIN.
    const byAsin = new Map<string, { pieces: Piece[]; codes: Set<string>; blog: number; video: number }>()
    const ensure = (asin: string) => {
      let g = byAsin.get(asin)
      if (!g) { g = { pieces: [], codes: new Set(), blog: 0, video: 0 }; byAsin.set(asin, g) }
      return g
    }
    for (const p of (postsRes.data ?? []) as Array<{ title: string | null; wordpress_url: string | null; geniuslink_code: string | null; deal_meta: { asin?: string } | null }>) {
      const asin = (p.deal_meta?.asin || '').trim()
      const code = (p.geniuslink_code || '').trim()
      if (!asin || !code) continue
      const g = ensure(asin)
      g.pieces.push({ type: 'blog', title: p.title || 'Untitled post', url: p.wordpress_url, code })
      g.codes.add(code); g.blog++
    }
    for (const v of (vidsRes.data ?? []) as Array<{ title: string | null; asin: string | null; geniuslink_yt_code: string | null; youtube_video_id: string | null }>) {
      const asin = (v.asin || '').trim()
      const code = (v.geniuslink_yt_code || '').trim()
      if (!asin || !code) continue
      const g = ensure(asin)
      const url = v.youtube_video_id ? `https://www.youtube.com/watch?v=${v.youtube_video_id}` : null
      g.pieces.push({ type: 'youtube', title: v.title || 'Untitled video', url, code })
      g.codes.add(code); g.video++
    }

    if (byAsin.size === 0) {
      return NextResponse.json({ connected: true, products: [], totals: { products: 0, clicks: 0, topClicks: 0 } })
    }

    // Fetch 30-day clicks for every unique code (bounded), then roll up per ASIN.
    const allCodes = [...new Set([...byAsin.values()].flatMap((g) => [...g.codes]))].slice(0, MAX_CODES)
    const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
    const clicksByCode = new Map<string, number>()
    for (let i = 0; i < allCodes.length; i += CONCURRENCY) {
      const batch = allCodes.slice(i, i + CONCURRENCY)
      const series = await Promise.all(batch.map((c) => genius.getDailyClicks(c, 30).catch(() => [])))
      batch.forEach((c, idx) => clicksByCode.set(c, series[idx].reduce((s, d) => s + d.clicks, 0)))
    }

    // Keepa enrichment (title / image / demand / price / campaign) from the deal
    // cache, by ASIN. Best-effort — products not in the cache still show, using
    // their content title and no image.
    const asins = [...byAsin.keys()]
    const enrich = new Map<string, { title: string | null; image: string | null; priceNow: number | null; monthlySold: number | null; discountPct: number | null; commissionPct: number | null }>()
    for (let i = 0; i < asins.length; i += 300) {
      const chunk = asins.slice(i, i + 300)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: dr } = await (supabase as any)
        .from('deal_radar_cache')
        .select('asin,title,image_url,price_now_cents,monthly_sold,discount_pct,campaign_commission_pct')
        .in('asin', chunk)
      for (const r of (dr ?? []) as Array<{ asin: string; title: string | null; image_url: string | null; price_now_cents: number | null; monthly_sold: number | null; discount_pct: number | null; campaign_commission_pct: number | null }>) {
        enrich.set(r.asin, {
          title: r.title, image: r.image_url,
          priceNow: r.price_now_cents != null ? r.price_now_cents / 100 : null,
          monthlySold: r.monthly_sold, discountPct: r.discount_pct,
          commissionPct: r.campaign_commission_pct != null ? Number(r.campaign_commission_pct) : null,
        })
      }
    }

    const products = [...byAsin.entries()].map(([asin, g]) => {
      const clicks = [...g.codes].reduce((s, c) => s + (clicksByCode.get(c) ?? 0), 0)
      const e = enrich.get(asin)
      return {
        asin,
        title: e?.title || g.pieces[0]?.title || asin,
        image: e?.image ?? null,
        clicks,
        pieceCount: g.pieces.length,
        blogCount: g.blog,
        videoCount: g.video,
        monthlySold: e?.monthlySold ?? null,
        priceNow: e?.priceNow ?? null,
        commissionPct: e?.commissionPct ?? null,
        pieces: g.pieces.slice(0, 6).map((p) => ({ type: p.type, title: p.title, url: p.url })),
        amazonUrl: `https://www.amazon.com/dp/${asin}`,
      }
    }).sort((a, b) => b.clicks - a.clicks)

    const totalClicks = products.reduce((s, p) => s + p.clicks, 0)
    return NextResponse.json({
      connected: true,
      products,
      totals: { products: products.length, clicks: totalClicks, topClicks: products[0]?.clicks ?? 0 },
      codesCapped: allCodes.length >= MAX_CODES,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 })
  }
}
