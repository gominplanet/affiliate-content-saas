/**
 * GET /api/analytics/storefront — per-PRODUCT performance (Storefront Stats).
 *
 * v1: rolls the creator's content up by product (ASIN) and attaches REAL
 * Geniuslink clicks (30-day, bot-filtered) + a Keepa demand/price estimate.
 * v2: merges REAL sales from storefront_earnings (units / revenue / commission,
 * scraped from Amazon Influencer earnings by SCOUT), for the selected period
 * (weekly | monthly), with a trend vs the previous period. Products with sales
 * but no MVP content are included too (the "this is selling, make content" gap).
 *
 * Product ↔ content mapping: blog_posts.deal_meta.asin + youtube_videos.asin.
 * Query: ?period=weekly|monthly (default monthly).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createGeniuslinkService } from '@/services/geniuslink'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_CODES = 150
const CONCURRENCY = 8

interface Piece { type: 'blog' | 'youtube'; title: string; url: string | null; code: string }
interface EarnRow { asin: string; period_start: string; period_end: string; units: number | null; ordered_items: number | null; revenue_cents: number | null; commission_cents: number | null; clicks: number | null; product_title: string | null }

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const period = new URL(request.url).searchParams.get('period') === 'weekly' ? 'weekly' : 'monthly'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('geniuslink_api_key,geniuslink_api_secret,storefront_synced_at')
      .eq('user_id', user.id)
      .single()
    const hasGenius = !!(intRow?.geniuslink_api_key && intRow?.geniuslink_api_secret)

    // ── Content pieces (for clicks) ───────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [postsRes, vidsRes, campRes, earnRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from('blog_posts')
        .select('id,title,wordpress_url,geniuslink_code,deal_meta,video_id')
        .eq('user_id', user.id).eq('status', 'published').not('geniuslink_code', 'is', null),
      // All YT videos with an ASIN (also the id/youtube_video_id maps used to
      // resolve a blog post's product via its source video).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from('youtube_videos')
        .select('id,title,asin,geniuslink_yt_code,youtube_video_id')
        .eq('user_id', user.id).not('asin', 'is', null),
      // Creator-Connections posts carry their ASIN here (asin ↔ blog_post_id).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from('campaigns')
        .select('asin,blog_post_id').eq('user_id', user.id).not('blog_post_id', 'is', null),
      // Real earnings: latest periods of the selected type (desc so [0]=current,
      // [1]=previous per ASIN for the trend).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from('storefront_earnings')
        .select('asin,period_start,period_end,units,ordered_items,revenue_cents,commission_cents,clicks,product_title')
        .eq('user_id', user.id).eq('period_type', period)
        .order('period_start', { ascending: false }).limit(2000),
    ])

    const byAsin = new Map<string, { pieces: Piece[]; codes: Set<string>; blog: number; video: number }>()
    const ensure = (asin: string) => {
      let g = byAsin.get(asin)
      if (!g) { g = { pieces: [], codes: new Set(), blog: 0, video: 0 }; byAsin.set(asin, g) }
      return g
    }

    // ASIN resolution maps: a blog post's product can come from its deal_meta,
    // its source YouTube video (video_id → youtube_videos.asin), or a Creator
    // Connections campaign row (blog_post_id → asin). Video-derived posts are the
    // common case for a YouTube-first creator, so this widens coverage a lot.
    const vidAsinById = new Map<string, string>()
    const vidAsinByYtId = new Map<string, string>()
    for (const v of (vidsRes.data ?? []) as Array<{ id: string | null; asin: string | null; youtube_video_id: string | null }>) {
      const asin = (v.asin || '').trim(); if (!asin) continue
      if (v.id) vidAsinById.set(v.id, asin)
      if (v.youtube_video_id) vidAsinByYtId.set(v.youtube_video_id, asin)
    }
    const campAsinByPost = new Map<string, string>()
    for (const c of (campRes.data ?? []) as Array<{ asin: string | null; blog_post_id: string | null }>) {
      if (c.blog_post_id && c.asin) campAsinByPost.set(c.blog_post_id, c.asin.trim())
    }

    for (const p of (postsRes.data ?? []) as Array<{ id: string; title: string | null; wordpress_url: string | null; geniuslink_code: string | null; deal_meta: { asin?: string } | null; video_id: string | null }>) {
      const code = (p.geniuslink_code || '').trim(); if (!code) continue
      const asin = (p.deal_meta?.asin || '').trim()
        || campAsinByPost.get(p.id)
        || (p.video_id ? (vidAsinById.get(p.video_id) || vidAsinByYtId.get(p.video_id) || '') : '')
      if (!asin) continue
      const g = ensure(asin); g.pieces.push({ type: 'blog', title: p.title || 'Untitled post', url: p.wordpress_url, code }); g.codes.add(code); g.blog++
    }
    // YouTube pieces (need their own geniuslink_yt_code for click attribution).
    for (const v of (vidsRes.data ?? []) as Array<{ title: string | null; asin: string | null; geniuslink_yt_code: string | null; youtube_video_id: string | null }>) {
      const asin = (v.asin || '').trim(); const code = (v.geniuslink_yt_code || '').trim()
      if (!asin || !code) continue
      const url = v.youtube_video_id ? `https://www.youtube.com/watch?v=${v.youtube_video_id}` : null
      const g = ensure(asin); g.pieces.push({ type: 'youtube', title: v.title || 'Untitled video', url, code }); g.codes.add(code); g.video++
    }

    // ── Earnings: current + previous period per ASIN ──────────────────────────
    const earnByAsin = new Map<string, { current: EarnRow; previous?: EarnRow }>()
    for (const e of (earnRes.data ?? []) as EarnRow[]) {
      const cur = earnByAsin.get(e.asin)
      if (!cur) earnByAsin.set(e.asin, { current: e })
      else if (!cur.previous && e.period_start < cur.current.period_start) cur.previous = e
    }

    // Union of content ASINs + earnings ASINs (a product can have sales with no
    // MVP content yet — that's a "make content" signal, so it belongs here).
    const allAsins = new Set<string>([...byAsin.keys(), ...earnByAsin.keys()])
    if (allAsins.size === 0) {
      return NextResponse.json({ connected: hasGenius, period, products: [], totals: { products: 0, clicks: 0, topClicks: 0, revenue: 0, commission: 0 }, lastSyncedAt: intRow?.storefront_synced_at ?? null })
    }

    // ── Clicks (Geniuslink), bounded fan-out ──────────────────────────────────
    const clicksByCode = new Map<string, number>()
    if (hasGenius) {
      const allCodes = [...new Set([...byAsin.values()].flatMap((g) => [...g.codes]))].slice(0, MAX_CODES)
      const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
      for (let i = 0; i < allCodes.length; i += CONCURRENCY) {
        const batch = allCodes.slice(i, i + CONCURRENCY)
        const series = await Promise.all(batch.map((c) => genius.getDailyClicks(c, 30).catch(() => [])))
        batch.forEach((c, idx) => clicksByCode.set(c, series[idx].reduce((s, d) => s + d.clicks, 0)))
      }
    }

    // ── Keepa enrichment (title / image / price / demand / commission) ─────────
    const asins = [...allAsins]
    const enrich = new Map<string, { title: string | null; image: string | null; priceNow: number | null; monthlySold: number | null; commissionPct: number | null }>()
    for (let i = 0; i < asins.length; i += 300) {
      const chunk = asins.slice(i, i + 300)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: dr } = await (supabase as any).from('deal_radar_cache')
        .select('asin,title,image_url,price_now_cents,monthly_sold,campaign_commission_pct').in('asin', chunk)
      for (const r of (dr ?? []) as Array<{ asin: string; title: string | null; image_url: string | null; price_now_cents: number | null; monthly_sold: number | null; campaign_commission_pct: number | null }>) {
        enrich.set(r.asin, { title: r.title, image: r.image_url, priceNow: r.price_now_cents != null ? r.price_now_cents / 100 : null, monthlySold: r.monthly_sold, commissionPct: r.campaign_commission_pct != null ? Number(r.campaign_commission_pct) : null })
      }
    }

    const dollars = (c: number | null | undefined) => c != null ? c / 100 : null
    const products = [...allAsins].map((asin) => {
      const g = byAsin.get(asin)
      const clicks = g ? [...g.codes].reduce((s, c) => s + (clicksByCode.get(c) ?? 0), 0) : 0
      const e = earnByAsin.get(asin)
      const cur = e?.current, prev = e?.previous
      const revenue = dollars(cur?.revenue_cents ?? null)
      const commission = dollars(cur?.commission_cents ?? null)
      const prevRevenue = dollars(prev?.revenue_cents ?? null)
      const units = cur?.units ?? cur?.ordered_items ?? null
      const orders = cur?.ordered_items ?? cur?.units ?? null
      const meta = enrich.get(asin)
      return {
        asin,
        title: meta?.title || g?.pieces[0]?.title || cur?.product_title || asin,
        image: meta?.image ?? null,
        clicks,
        pieceCount: g?.pieces.length ?? 0,
        blogCount: g?.blog ?? 0,
        videoCount: g?.video ?? 0,
        hasContent: !!g,
        monthlySold: meta?.monthlySold ?? null,
        priceNow: meta?.priceNow ?? null,
        commissionPct: meta?.commissionPct ?? null,
        // v2 real sales
        units,
        revenue,
        commission,
        revenueDeltaPct: revenue != null && prevRevenue != null && prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 100) : null,
        conversionPct: orders != null && clicks > 0 ? Math.round((orders / clicks) * 1000) / 10 : null,
        periodStart: cur?.period_start ?? null,
        periodEnd: cur?.period_end ?? null,
        pieces: (g?.pieces ?? []).slice(0, 6).map((p) => ({ type: p.type, title: p.title, url: p.url })),
        amazonUrl: `https://www.amazon.com/dp/${asin}`,
      }
    }).sort((a, b) => (b.revenue ?? -1) - (a.revenue ?? -1) || b.clicks - a.clicks)

    return NextResponse.json({
      connected: hasGenius,
      period,
      products,
      totals: {
        products: products.length,
        clicks: products.reduce((s, p) => s + p.clicks, 0),
        topClicks: Math.max(0, ...products.map((p) => p.clicks)),
        revenue: products.reduce((s, p) => s + (p.revenue ?? 0), 0),
        commission: products.reduce((s, p) => s + (p.commission ?? 0), 0),
      },
      lastSyncedAt: intRow?.storefront_synced_at ?? null,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 })
  }
}
