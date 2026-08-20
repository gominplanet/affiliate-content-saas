// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Channel-fit matching — the brain behind "Made for your channel". Instead of
// showing every creator the same best-sellers, we build a per-creator AFFINITY
// PROFILE from what actually works for THEM (real earnings + their video topics)
// and score candidate products against it. All from data we already hold, so
// there's no guesswork and no extra API cost.
//
// Profile =
//   • categories — where their storefront EARNS, weighted by real commission
//   • keywords   — topic words from their YouTube titles + earning products
//   • price band — where their buyers actually convert
//
// Everything here is best-effort and defensive: missing data yields an empty
// profile (the feed then falls back to plain demand ranking), never a throw.

export interface AffinityCategory { name: string; weight: number }
export interface AffinityProfile {
  categories: AffinityCategory[]
  keywords: string[]
  priceMinCents: number | null
  priceMaxCents: number | null
  sampleSize: number
  computedAt: string | null
}

export const EMPTY_AFFINITY: AffinityProfile = { categories: [], keywords: [], priceMinCents: null, priceMaxCents: null, sampleSize: 0, computedAt: null }

// Words that carry no niche signal — dropped from keyword extraction.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'without', 'your', 'you', 'to', 'of', 'in', 'on', 'at', 'by', 'from',
  'is', 'are', 'best', 'top', 'review', 'reviews', 'vs', 'new', 'how', 'what', 'why', 'this', 'that', 'my', 'our',
  'amazon', 'product', 'products', 'buy', 'shop', 'deal', 'deals', 'pack', 'set', 'piece', 'pieces', 'inch', 'inches',
  'size', 'color', 'black', 'white', 'blue', 'red', 'green', 'pink', 'large', 'small', 'medium', 'pro', 'plus', 'premium',
  'unboxing', 'video', 'shorts', 'short', 'youtube', 'channel', 'subscribe', 'watch',
])

function tokenizeTitle(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
  return sorted[i]
}

/**
 * Compute a fresh affinity profile for a creator from their earnings + videos.
 * Uses the service-role client (reads across shared caches). Never throws.
 */
export async function computeAffinity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  userId: string,
): Promise<AffinityProfile> {
  try {
    // 1. Earnings by ASIN (sum commission across periods; that's the weight).
    const { data: earn } = await admin
      .from('storefront_earnings')
      .select('asin, commission_cents, revenue_cents')
      .eq('user_id', userId)
      .limit(4000)
    const earnedByAsin = new Map<string, number>() // asin → commission cents
    for (const r of (earn ?? []) as Array<{ asin: string | null; commission_cents: number | null; revenue_cents: number | null }>) {
      const a = (r.asin || '').toUpperCase()
      if (!/^[A-Z0-9]{10}$/.test(a)) continue
      const w = Number(r.commission_cents) || Math.max(0, Number(r.revenue_cents) || 0) * 0.05 // fall back to ~5% of revenue
      earnedByAsin.set(a, (earnedByAsin.get(a) || 0) + Math.max(0, w))
    }
    const asins = [...earnedByAsin.keys()]

    // 2. Resolve category + price + title for those ASINs from the shared caches.
    const meta = new Map<string, { category: string | null; priceCents: number | null; title: string | null }>()
    if (asins.length) {
      const put = (asin: string, category: unknown, price: unknown, title: unknown) => {
        const a = String(asin || '').toUpperCase()
        if (!a) return
        const cur = meta.get(a) || { category: null, priceCents: null, title: null }
        if (!cur.category && typeof category === 'string' && category.trim()) cur.category = category.trim()
        if (cur.priceCents == null && Number.isFinite(Number(price)) && Number(price) > 0) cur.priceCents = Number(price)
        if (!cur.title && typeof title === 'string' && title.trim()) cur.title = title.trim()
        meta.set(a, cur)
      }
      const chunks: string[][] = []
      for (let i = 0; i < asins.length; i += 300) chunks.push(asins.slice(i, i + 300))
      for (const chunk of chunks) {
        try {
          const [dr, cc, ap] = await Promise.all([
            admin.from('deal_radar_cache').select('asin,category,price_now_cents,title').in('asin', chunk),
            admin.from('cc_campaign_catalog').select('rep_asin,category,price_now_cents,campaign_name').in('rep_asin', chunk),
            admin.from('amz_product_cache').select('asin,category,price_now_cents').in('asin', chunk),
          ])
          for (const r of (dr.data ?? []) as any[]) put(r.asin, r.category, r.price_now_cents, r.title)
          for (const r of (cc.data ?? []) as any[]) put(r.rep_asin, r.category, r.price_now_cents, r.campaign_name)
          for (const r of (ap.data ?? []) as any[]) put(r.asin, r.category, r.price_now_cents, null)
        } catch { /* a cache table may be absent — skip it */ }
      }
    }

    // 3. Category weights = share of commission earned in each resolved category.
    const catWeight = new Map<string, number>()
    let totalWeighted = 0
    for (const [asin, w] of earnedByAsin) {
      const cat = meta.get(asin)?.category
      if (!cat) continue
      catWeight.set(cat, (catWeight.get(cat) || 0) + w)
      totalWeighted += w
    }
    const categories: AffinityCategory[] = [...catWeight.entries()]
      .map(([name, w]) => ({ name, weight: totalWeighted > 0 ? w / totalWeighted : 0 }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8)

    // 4. Keywords from YouTube titles + earning-product titles.
    const { data: vids } = await admin.from('youtube_videos').select('title').eq('user_id', userId).limit(300)
    const freq = new Map<string, number>()
    for (const v of (vids ?? []) as Array<{ title: string | null }>) for (const t of tokenizeTitle(v.title || '')) freq.set(t, (freq.get(t) || 0) + 1)
    for (const asin of asins) { const title = meta.get(asin)?.title; if (title) for (const t of tokenizeTitle(title)) freq.set(t, (freq.get(t) || 0) + 2) }
    const keywords = [...freq.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([w]) => w)

    // 5. Price band = 10th–90th percentile of earning-product prices.
    const prices = asins.map(a => meta.get(a)?.priceCents).filter((c): c is number => c != null && c > 0).sort((a, b) => a - b)
    const priceMinCents = prices.length ? percentile(prices, 10) : null
    const priceMaxCents = prices.length ? percentile(prices, 90) : null

    return { categories, keywords, priceMinCents, priceMaxCents, sampleSize: asins.length, computedAt: new Date().toISOString() }
  } catch {
    return { ...EMPTY_AFFINITY, computedAt: new Date().toISOString() }
  }
}

/** Read the cached profile, recomputing (and persisting) when missing or stale. */
export async function getOrComputeAffinity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  userId: string,
  maxAgeMs = 24 * 60 * 60 * 1000,
): Promise<AffinityProfile> {
  try {
    const { data: row } = await admin.from('creator_affinity').select('*').eq('user_id', userId).maybeSingle()
    if (row?.computed_at && (Date.now() - new Date(row.computed_at).getTime()) < maxAgeMs) {
      return {
        categories: Array.isArray(row.categories) ? row.categories : [],
        keywords: Array.isArray(row.keywords) ? row.keywords : [],
        priceMinCents: row.price_min_cents ?? null,
        priceMaxCents: row.price_max_cents ?? null,
        sampleSize: row.sample_size ?? 0,
        computedAt: row.computed_at,
      }
    }
  } catch { /* table absent (pre-267) or read error — recompute below */ }

  const profile = await computeAffinity(admin, userId)
  try {
    await admin.from('creator_affinity').upsert({
      user_id: userId,
      categories: profile.categories,
      keywords: profile.keywords,
      price_min_cents: profile.priceMinCents,
      price_max_cents: profile.priceMaxCents,
      sample_size: profile.sampleSize,
      computed_at: profile.computedAt,
    }, { onConflict: 'user_id' })
  } catch { /* pre-267 — serve the freshly computed profile without caching */ }
  return profile
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export interface ScorableProduct {
  category?: string | null
  priceNowCents?: number | null
  monthlySold?: number | null
  videoCount?: number | null
  commissionPct?: number | null
  title?: string | null
}

/** Score a candidate 0..100 against the profile, with human-readable reasons. */
export function scoreProductForAffinity(p: ScorableProduct, profile: AffinityProfile): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0

  // Category fit (up to 40) — the strongest signal: does it match a category
  // they already earn in?
  const cat = (p.category || '').trim()
  const match = cat ? profile.categories.find(c => c.name.toLowerCase() === cat.toLowerCase()) : null
  if (match) { score += 15 + Math.round(match.weight * 25); reasons.push(`Matches your top category ${cat}`) }

  // Keyword fit (up to 15) — a topic word from their titles appears here.
  const titleWords = new Set(tokenizeTitle(p.title || ''))
  const kwHit = profile.keywords.find(k => titleWords.has(k))
  if (kwHit) { score += 15; reasons.push(`On-topic for your channel (“${kwHit}”)`) }

  // Price fit (up to 15) — inside the band their buyers convert at.
  const price = p.priceNowCents
  if (price != null && profile.priceMinCents != null && profile.priceMaxCents != null && profile.priceMaxCents > 0) {
    if (price >= profile.priceMinCents && price <= profile.priceMaxCents) { score += 15; reasons.push('In your buyers’ price range') }
    else if (price >= profile.priceMinCents * 0.6 && price <= profile.priceMaxCents * 1.6) score += 7
  }

  // Demand (up to 15).
  const sold = Number(p.monthlySold) || 0
  if (sold >= 1000) { score += 15; reasons.push(`${sold.toLocaleString()}+ bought/mo`) }
  else if (sold >= 300) score += 9
  else if (sold >= 100) score += 5

  // Low competition (up to 8) — no creator video yet.
  if (p.videoCount === 0) { score += 8; reasons.push('No creator video yet') }

  // Commission (up to 7).
  const comm = Number(p.commissionPct) || 0
  if (comm >= 10) { score += 7; reasons.push(`${comm}% commission`) }
  else if (comm >= 5) score += 4

  return { score: Math.min(100, score), reasons: reasons.slice(0, 3) }
}
