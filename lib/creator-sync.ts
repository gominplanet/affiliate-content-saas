// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Brand Radar ingestion — the vendor-agnostic layer that pulls a creator's own
// content (Amazon storefront products, TikTok posts) through an external provider
// so we never depend on the in-browser SCOUT crawl (which times out on a big
// store). Provider is a config choice per source, so we can run Apify for Amazon
// and SocialCrawl for TikTok and swap either without touching callers.
//
// Everything is ENV-GATED and ships dark: with no provider token set, the feature
// shows a "connect a provider" state and nothing runs. Set the tokens in Vercel to
// turn it on. All product enrichment (brand/title/image) is layered on afterward by
// Keepa (services/keepa) — internal, never surfaced to users.

export type SyncSource = 'amazon_storefront' | 'tiktok'
export type SyncProvider = 'apify' | 'socialcrawl'

const APIFY_BASE = 'https://api.apify.com/v2'
const SOCIALCRAWL_BASE = 'https://api.socialcrawl.dev/v1'

// Actor ids are overridable by env so we can retune after the first spike without
// a deploy. Defaults are the researched actors.
const APIFY_AMAZON_ACTOR = (process.env.APIFY_AMAZON_ACTOR || 'powerai~amazon-influencer-posts-scraper').trim()

export function apifyConfigured(): boolean { return !!process.env.APIFY_TOKEN }
export function socialcrawlConfigured(): boolean { return !!process.env.SOCIALCRAWL_API_KEY }

/** Which provider handles a source, and is it configured right now. */
export function providerFor(source: SyncSource): { provider: SyncProvider; configured: boolean } {
  if (source === 'tiktok') return { provider: 'socialcrawl', configured: socialcrawlConfigured() }
  return { provider: 'apify', configured: apifyConfigured() }
}

export function anyProviderConfigured(): boolean {
  return apifyConfigured() || socialcrawlConfigured()
}

/** The public origin the provider webhook should call back on. */
function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mvpaffiliate.io').trim().replace(/\/+$/, '')
}

export interface StartedRun { runId: string; datasetId: string | null }

/**
 * Start an ASYNC Apify actor run with an ad-hoc webhook that calls us back when it
 * finishes. Returns the run + default dataset id, or null if Apify isn't set up /
 * the start failed. The webhook carries the job id + a shared secret so the
 * callback can authenticate and find its row.
 */
export async function startApifyRun(actorId: string, input: unknown, opts: { jobId: string }): Promise<StartedRun | null> {
  const token = process.env.APIFY_TOKEN
  if (!token) return null
  const secret = (process.env.APIFY_WEBHOOK_SECRET || token).trim()
  const webhookUrl = `${appOrigin()}/api/creator/sync/callback?job=${encodeURIComponent(opts.jobId)}&secret=${encodeURIComponent(secret)}`
  // Ad-hoc webhooks ride as a base64(JSON) query param on the run start.
  const webhooks = [{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT', 'ACTOR.RUN.ABORTED'],
    requestUrl: webhookUrl,
  }]
  const webhooksParam = Buffer.from(JSON.stringify(webhooks)).toString('base64')
  const url = `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${encodeURIComponent(token)}&webhooks=${encodeURIComponent(webhooksParam)}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input ?? {}),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) { console.warn('[creator-sync] apify start failed', res.status); return null }
    const json = await res.json() as { data?: { id?: string; defaultDatasetId?: string } }
    const runId = json?.data?.id
    if (!runId) return null
    return { runId, datasetId: json.data?.defaultDatasetId || null }
  } catch (e) {
    console.warn('[creator-sync] apify start error', e instanceof Error ? e.message : e)
    return null
  }
}

/** Read all items from an Apify dataset (paginated), capped so one ingest stays bounded. */
export async function readApifyDataset(datasetId: string, cap = 10000): Promise<Record<string, unknown>[]> {
  const token = process.env.APIFY_TOKEN
  if (!token || !datasetId) return []
  const out: Record<string, unknown>[] = []
  for (let offset = 0; offset < cap; offset += 1000) {
    const url = `${APIFY_BASE}/datasets/${encodeURIComponent(datasetId)}/items?token=${encodeURIComponent(token)}&clean=true&offset=${offset}&limit=1000`
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45_000) })
      if (!res.ok) break
      const page = await res.json() as Record<string, unknown>[]
      if (!Array.isArray(page) || !page.length) break
      out.push(...page)
      if (page.length < 1000) break
    } catch { break }
  }
  return out
}

const ASIN_RE = /\b([A-Z0-9]{10})\b/
export interface CatalogItem { asin: string; title: string | null; image: string | null; listTitle: string | null }

/**
 * Map an Apify dataset item to a catalog product. Actors vary in field names, so
 * this reads defensively: an explicit asin field, or an ASIN pulled from any url /
 * the post id; title/image from the common field spellings. Returns null when no
 * valid ASIN is present (e.g. an idea-list post that carries no product itself).
 */
export function mapAmazonItem(it: Record<string, unknown>): CatalogItem | null {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const asinRaw = s(it.asin) || s(it.ASIN) || s(it.productAsin)
  let asin = asinRaw.toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    // Try to recover an ASIN from a product url or the post/permalink.
    const url = s(it.url) || s(it.productUrl) || s(it.link) || s(it.post_url) || s(it.permalink)
    const m = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i) || url.match(ASIN_RE)
    asin = (m?.[1] || '').toUpperCase()
  }
  if (!/^[A-Z0-9]{10}$/.test(asin)) return null
  const title = s(it.title) || s(it.name) || s(it.product_title) || s(it.post_title) || null
  const image = s(it.image) || s(it.imageUrl) || s(it.thumbnail) || s(it.post_thumbnail) || s(it.image_url) || null
  const listTitle = s(it.listTitle) || s(it.list_title) || s(it.post_title) || null
  return { asin, title: title || null, image: image || null, listTitle: listTitle || null }
}

// ── TikTok (SocialCrawl) — brands a creator has worked with ──────────────────
export interface TikTokBrandSignal { brand: string; kind: 'tagged' | 'mention' | 'hashtag'; sample: string | null }

const BRAND_STOP = new Set(['ad', 'ads', 'sponsored', 'fyp', 'foryou', 'foryoupage', 'tiktokmademebuyit', 'amazonfinds', 'amazon', 'sale', 'deal', 'deals', 'viral', 'trending', 'giveaway'])

/**
 * Extract brand signals from a creator's TikTok posts. Confidence order:
 *  tagged/sponsored product > @mention of a brand account > branded hashtag.
 * Deliberately conservative — a caption LLM pass can be layered on later; this
 * deterministic pass covers the high-signal cases at no model cost.
 */
export function extractTikTokBrands(posts: Record<string, unknown>[]): TikTokBrandSignal[] {
  const out: TikTokBrandSignal[] = []
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const clean = (b: string) => b.replace(/^@/, '').replace(/[^A-Za-z0-9 &'.-]/g, '').replace(/\s+/g, ' ').trim()
  for (const p of posts) {
    const caption = s(p.text) || s(p.desc) || s(p.caption) || s(p.description)
    const isAd = p.isAd === true || p.is_ad === true || /\bsponsored\b/i.test(s(p.stickersOnItem)) || /#ad\b/i.test(caption)
    // Tagged commerce products (highest confidence).
    const productName = s((p as { product?: { title?: string } }).product?.title) || s(p.productTitle)
    if (productName) out.push({ brand: clean(productName).split(/\s+/).slice(0, 2).join(' '), kind: 'tagged', sample: caption.slice(0, 120) || null })
    // @mentions.
    for (const m of caption.matchAll(/@([A-Za-z0-9._]{2,30})/g)) {
      const b = clean(m[1]); if (b && !BRAND_STOP.has(b.toLowerCase())) out.push({ brand: b, kind: 'mention', sample: caption.slice(0, 120) || null })
    }
    // Branded hashtags on an ad/partner post (a hashtag on a sponsored post is a
    // much stronger brand signal than a generic #fyp).
    if (isAd) {
      for (const h of caption.matchAll(/#([A-Za-z0-9_]{2,30})/g)) {
        const b = clean(h[1]); if (b && b.length >= 3 && !BRAND_STOP.has(b.toLowerCase())) out.push({ brand: b, kind: 'hashtag', sample: caption.slice(0, 120) || null })
      }
    }
  }
  return out
}

/**
 * Pull a bounded page set of a creator's TikTok posts via SocialCrawl. Returns raw
 * post objects (fields vary; extractTikTokBrands maps defensively). Empty when
 * SocialCrawl isn't configured. Synchronous provider, so we page here.
 */
export async function fetchTikTokPosts(handle: string, maxPages = 8): Promise<Record<string, unknown>[]> {
  const key = process.env.SOCIALCRAWL_API_KEY
  const user = handle.replace(/^@/, '').trim()
  if (!key || !user) return []
  const out: Record<string, unknown>[] = []
  let cursor: string | null = null
  for (let i = 0; i < maxPages; i++) {
    const url = `${SOCIALCRAWL_BASE}/tiktok/user/posts?username=${encodeURIComponent(user)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    try {
      const res = await fetch(url, { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(30_000) })
      if (!res.ok) break
      const json = await res.json() as { posts?: Record<string, unknown>[]; data?: Record<string, unknown>[]; cursor?: string; nextCursor?: string; hasMore?: boolean }
      const page = json.posts || json.data || []
      if (!Array.isArray(page) || !page.length) break
      out.push(...page)
      cursor = json.nextCursor || json.cursor || null
      if (!cursor || json.hasMore === false) break
    } catch { break }
  }
  return out
}
