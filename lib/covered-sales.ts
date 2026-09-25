// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "On sale now": the products a creator has ALREADY made content about, and
// which of them are on sale right now.
//
// WHY IT IS WORTH A FEATURE. A review video keeps selling for years, and the
// moment it sells best is when the product goes on sale. Nothing told the
// creator that moment had come: Deal Radar watches the whole store, and the
// price watch only ever watched products from a Deal Radar post. This watches
// the creator's own catalogue, the products their audience already trusts
// them on.
//
// CHEAP BY DESIGN. The shared deal cache (deal_radar_cache, filled by one cron
// for everyone) is read first and costs nothing. Only what it does not cover
// goes to Keepa, through the day-old cache, in batches of a hundred.

import { fetchKeepaBasicsCached } from '@/lib/keepa-cache'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

/** Where the creator covered a product. */
export interface CoverSource {
  kind: 'video' | 'storefront'
  /** youtube_videos.id for a video. */
  id?: string
  youtubeVideoId?: string
  title?: string
  views?: number | null
  publishedAt?: string | null
  channelId?: string | null
  thumbnail?: string | null
}

export interface CoveredProduct {
  asin: string
  title: string
  image: string | null
  sources: CoverSource[]
}

export interface SaleVerdict {
  onSale: boolean
  pct: number | null
  nowCents: number | null
  refCents: number | null
  /** What the sale is compared against, in words, for the screen. */
  basis: 'deal' | 'lightning' | 'avg90' | 'all-time-low' | null
  lightningEndsAt: string | null
  allTimeLow: boolean
}

/** A sale worth telling a creator about: 15% under the usual price, a
 *  lightning deal, or a new all-time low. Smaller moves are noise. */
export const SALE_MIN_PCT = 15

/**
 * The verdict for one product, from whichever source had it. Pure, so the
 * rule a creator is alerted on is the rule the page shows and the tests pin.
 */
export function saleVerdict(input: {
  deal?: { discount_pct: number | null; price_now_cents: number | null; price_was_cents: number | null; deal_type: string | null; lightning_ends_at: string | null } | null
  keepa?: { priceNowCents: number | null; priceAvg90Cents: number | null; priceLowestCents: number | null; discountPct: number | null } | null
}): SaleVerdict {
  const none: SaleVerdict = { onSale: false, pct: null, nowCents: null, refCents: null, basis: null, lightningEndsAt: null, allTimeLow: false }
  const d = input.deal
  if (d && (d.deal_type === 'lightning' || (d.discount_pct ?? 0) >= SALE_MIN_PCT)) {
    const lightning = d.deal_type === 'lightning'
    const endsOk = !lightning || !d.lightning_ends_at || new Date(d.lightning_ends_at).getTime() > Date.now()
    if (endsOk) {
      return {
        onSale: true, pct: d.discount_pct ?? null, nowCents: d.price_now_cents, refCents: d.price_was_cents,
        basis: lightning ? 'lightning' : 'deal', lightningEndsAt: lightning ? d.lightning_ends_at : null, allTimeLow: false,
      }
    }
  }
  const k = input.keepa
  if (k && k.priceNowCents != null && k.priceNowCents > 0) {
    const allTimeLow = k.priceLowestCents != null && k.priceNowCents <= k.priceLowestCents
    const pct = k.discountPct ?? (k.priceAvg90Cents ? Math.round((1 - k.priceNowCents / k.priceAvg90Cents) * 100) : null)
    if ((pct ?? 0) >= SALE_MIN_PCT || (allTimeLow && (pct ?? 0) >= 5)) {
      return {
        onSale: true, pct, nowCents: k.priceNowCents, refCents: k.priceAvg90Cents,
        basis: allTimeLow ? 'all-time-low' : 'avg90', lightningEndsAt: null, allTimeLow,
      }
    }
  }
  return none
}

/**
 * Every product this creator has covered, with where. Videos first, since a
 * video is what a sale can bring back to life; the storefront second.
 */
export async function coveredProducts(sb: Sb, userId: string, limit = 400, onlyAsins?: string[]): Promise<CoveredProduct[]> {
  // ONE PRODUCT, looked up directly: its videos can be older than the newest
  // `limit`, and the promo for an old review is exactly the point.
  const only = onlyAsins?.map((a) => String(a || '').trim().toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a))
  const byAsin = new Map<string, CoveredProduct>()
  const add = (asin: string, title: string, image: string | null, src: CoverSource) => {
    const a = String(asin || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(a)) return
    const cur = byAsin.get(a) ?? { asin: a, title: title || a, image, sources: [] }
    if ((!cur.title || cur.title === a) && title) cur.title = title
    if (!cur.image && image) cur.image = image
    cur.sources.push(src)
    byAsin.set(a, cur)
  }

  let vq = sb.from('youtube_videos')
    .select('id,asin,title,youtube_video_id,view_count,published_at,channel_id,thumbnail_url')
    .eq('user_id', userId).not('asin', 'is', null)
  if (only?.length) vq = vq.in('asin', only)
  const { data: vids } = await vq.order('published_at', { ascending: false, nullsFirst: false }).limit(limit)
  for (const v of (vids ?? []) as Array<Record<string, unknown>>) {
    const yt = String(v.youtube_video_id || '')
    // A video still being uploaded has a placeholder id, and nothing to promote.
    if (!/^[A-Za-z0-9_-]{11}$/.test(yt)) continue
    add(String(v.asin), '', null, {
      kind: 'video', id: String(v.id), youtubeVideoId: yt, title: String(v.title || ''),
      views: (v.view_count as number | null) ?? null, publishedAt: (v.published_at as string | null) ?? null,
      channelId: (v.channel_id as string | null) ?? null, thumbnail: (v.thumbnail_url as string | null) ?? null,
    })
  }

  let sq = sb.from('storefront_catalog').select('asin,title,image_url').eq('user_id', userId)
  if (only?.length) sq = sq.in('asin', only)
  const { data: store, error: storeErr } = await sq.limit(limit)
  if (!storeErr) {
    for (const s of (store ?? []) as Array<{ asin: string; title: string | null; image_url: string | null }>) {
      add(s.asin, s.title || '', s.image_url, { kind: 'storefront' })
    }
  }
  return [...byAsin.values()]
}

export interface OnSaleProduct extends CoveredProduct { verdict: SaleVerdict }

/**
 * Which covered products are on sale. `admin` is a service-role client: the
 * Keepa cache is admin-read only. Sorted biggest sale first, with a video
 * behind it before one only in the storefront.
 */
export interface SaleCheckStats {
  /** Products whose price was actually known: in the deal cache or answered by Keepa. */
  checked: number
  /** Products not checked this time: past the Keepa cap, or Keepa did not answer. */
  skipped: number
}

export async function findSales(
  admin: Sb, products: CoveredProduct[],
  opts?: { keepaCap?: number; onStats?: (s: SaleCheckStats) => void },
): Promise<OnSaleProduct[]> {
  if (products.length === 0) { opts?.onStats?.({ checked: 0, skipped: 0 }); return [] }
  const asins = products.map((p) => p.asin)
  const deals = new Map<string, NonNullable<Parameters<typeof saleVerdict>[0]['deal']> & { title?: string; image_url?: string | null }>()
  for (let i = 0; i < asins.length; i += 200) {
    const { data } = await admin.from('deal_radar_cache')
      .select('asin,title,image_url,discount_pct,price_now_cents,price_was_cents,deal_type,lightning_ends_at')
      .in('asin', asins.slice(i, i + 200))
    for (const r of (data ?? []) as Array<Record<string, unknown>>) deals.set(String(r.asin), r as never)
  }
  // Keepa only for what the shared cache did not already answer, capped so
  // one creator with a huge catalogue cannot spend the day's tokens.
  // Videos before storefront-only products, so the cap cuts the least useful.
  const videoFirst = products
    .filter((p) => !deals.has(p.asin))
    .sort((a, b) => Number(b.sources.some((s) => s.kind === 'video')) - Number(a.sources.some((s) => s.kind === 'video')))
    .map((p) => p.asin)
  // THE CAP IS ON NEW LOOKUPS, NOT ON PRODUCTS. A product Keepa answered in
  // the last day is already in the shared cache and costs nothing, so it is
  // always included; only products never looked up count against the cap.
  // Counting the cached ones too meant every check re-read the same first 50
  // and the rest of a big catalogue was never reached.
  const fresh = new Set<string>()
  const since = new Date(Date.now() - 86_400_000).toISOString()
  for (let i = 0; i < videoFirst.length; i += 200) {
    const { data, error } = await admin.from('keepa_product_cache').select('asin')
      .in('asin', videoFirst.slice(i, i + 200)).gte('fetched_at', since)
    if (error) break
    for (const r of (data ?? []) as Array<{ asin: string }>) fresh.add(String(r.asin).toUpperCase())
  }
  const cached = videoFirst.filter((a) => fresh.has(a))
  const unseen = videoFirst.filter((a) => !fresh.has(a)).slice(0, opts?.keepaCap ?? 50)
  const rest = [...cached, ...unseen]
  const keepa = rest.length ? await fetchKeepaBasicsCached(admin, rest, { maxAgeDays: 1 }) : new Map()
  const checked = deals.size + rest.filter((a) => keepa.has(a)).length
  opts?.onStats?.({ checked, skipped: Math.max(0, asins.length - checked) })

  const out: OnSaleProduct[] = []
  for (const p of products) {
    const d = deals.get(p.asin) ?? null
    const k = keepa.get(p.asin) ?? null
    const verdict = saleVerdict({ deal: d, keepa: k })
    if (!verdict.onSale) continue
    out.push({
      ...p,
      title: p.title && p.title !== p.asin ? p.title : (d?.title || k?.title || p.title),
      image: p.image || d?.image_url || k?.imageUrl || p.sources.find((s) => s.thumbnail)?.thumbnail || null,
      verdict,
    })
  }
  const hasVideo = (p: OnSaleProduct) => p.sources.some((s) => s.kind === 'video') ? 1 : 0
  return out.sort((a, b) => hasVideo(b) - hasVideo(a) || (b.verdict.pct ?? 0) - (a.verdict.pct ?? 0))
}

/** "32% off" / "Lightning deal" / "Lowest price ever", for a label. */
export function saleLabel(v: SaleVerdict): string {
  if (v.basis === 'lightning') return v.pct ? `Lightning deal, ${v.pct}% off` : 'Lightning deal'
  if (v.allTimeLow) return v.pct ? `Lowest price ever, ${v.pct}% under usual` : 'Lowest price ever'
  return v.pct ? `${v.pct}% off` : 'On sale'
}
