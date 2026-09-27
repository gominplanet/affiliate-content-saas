// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Brand recap, the reads: every link a creator published, the product each
// one is about, and the Creator Connections brand behind that product.
//
// WHERE LINKS COME FROM, and what each one can and cannot say:
//   youtube_videos        the video (asin, or asins for a comparison), checked
//                         public or unlisted with YouTube before it is offered;
//                         a private video is left out and counted
//   blog_posts            the post, and the social posts made from it (X,
//                         Facebook, LinkedIn and Pinterest from their ids;
//                         Threads, Instagram, TikTok only from a kept permalink)
//   deal_scheduled_posts  scheduled Deal Radar posts, which kept their URLs
//   amazon_scheduled_posts scheduled Amazon pushes, which kept theirs
//   product_post_links    every Deal Radar, Encore and Amazon push since
//                         migration 379
//   creator_content       anything the content library recorded
//   amazon_videos         Amazon's own video page, only when it is a /vdp/ page
//
// WHICH BRAND. A product's brand comes from the creator's own campaign rows
// first (what they joined), then the accept ledger, then the shared Creator
// Connections catalog. A product with none of those has no brand chat, so it
// is not offered.
//
// Every read fails into nothing rather than taking the page with it, and the
// ones that did fail are named in the answer, so an empty brand reads as "we
// could not look" rather than "you made nothing".

import { socialPermalink } from '@/lib/brand-recap'
import { videoVisibility } from '@/lib/covered-sales'
import { groupByBrand, linkKey, contentPlatform, productShortName, type BrandGroup, type BrandOfAsin, type ContentLink } from '@/lib/brand-content'
import { brandKey } from '@/lib/brand-normalize'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

const ASIN_RE = /^[A-Z0-9]{10}$/
const up = (s: unknown) => String(s || '').trim().toUpperCase()
const chunk = <T>(xs: T[], n = 100): T[][] => { const o: T[][] = []; for (let i = 0; i < xs.length; i += n) o.push(xs.slice(i, i + n)); return o }

async function pages<T>(run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, max = 5): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = []
  for (let p = 0; p < max; p++) {
    const r = await run(p * 1000, p * 1000 + 999)
    if (r.error) return { rows, error: r.error.message }
    rows.push(...(r.data ?? []))
    if ((r.data ?? []).length < 1000) break
  }
  return { rows, error: null }
}

export interface BrandRecapData {
  brands: BrandGroup[]
  /** Reads that failed, by name, so an empty result is never mistaken for none. */
  unread: string[]
  /** Videos left out because YouTube says they are private or scheduled. */
  privateVideos: number
  /** Whether migration 379 is in: without it nothing is logged or kept. */
  recapsTable: boolean
  linksTable: boolean
}

/** A read that must answer in time or be named as not read. Slow reads are
 *  enrichment; the page must answer inside the function's time limit, and a
 *  function that runs out returns Vercel's error page instead of anything. */
function withDeadline<T>(p: PromiseLike<T>, ms: number, fallback: T): Promise<{ value: T; timedOut: boolean }> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ value: fallback, timedOut: true }), ms)
    Promise.resolve(p).then((value) => { clearTimeout(t); resolve({ value, timedOut: false }) }, () => { clearTimeout(t); resolve({ value: fallback, timedOut: false }) })
  })
}

export async function gatherBrandRecaps(sb: Sb, ownerId: string): Promise<BrandRecapData & { timings: Record<string, number> }> {
  const unread: string[] = []
  const links: ContentLink[] = []
  const names = new Map<string, string>()
  const nameIfNone = (asin: string, title: string | null | undefined) => { if (title && !names.has(asin)) names.set(asin, productShortName(title, asin)) }
  // How long each read took, returned with the answer, so a slow page says
  // which read is slow instead of leaving it to guesswork.
  const timings: Record<string, number> = {}
  const timed = async <T>(name: string, run: () => PromiseLike<T>): Promise<T> => {
    const t0 = Date.now()
    try { return await run() } finally { timings[name] = Date.now() - t0 }
  }

  type CampRow = { asin: string | null; brand_name?: string | null; cc_campaign_id?: string | null; campaign_asins?: string[] | null; product_title?: string | null; blog_post_id?: string | null; wordpress_url?: string | null }
  type VidRow = { id: string; youtube_video_id: string | null; asin: string | null; asins?: string[] | null; title: string | null; amazon_title?: string | null; published_at: string | null; tiktok_share_url?: string | null }
  type PostRow = {
    id: string; video_id: string | null; title: string | null; wordpress_url: string | null; published_at: string | null
    deal_meta?: { asin?: string } | null; twitter_post_id?: string | null; facebook_post_id?: string | null
    linkedin_post_id?: string | null; pinterest_pin_id?: string | null; tiktok_share_url?: string | null
    social_permalinks?: Record<string, string> | null
  }
  const FULL = 'id, video_id, title, wordpress_url, published_at, deal_meta, twitter_post_id, facebook_post_id, linkedin_post_id, pinterest_pin_id, tiktok_share_url, social_permalinks'
  const LEAN = 'id, video_id, title, wordpress_url, published_at'

  // ── phase 1: every independent read at once ─────────────────────────────
  const [camp, accepted, vids, posts, dealSched, amzSched, kept, library, avp, recaps] = await Promise.all([
    timed('campaigns', async () => {
      const r = await pages<CampRow>((a, b) => sb.from('campaigns').select('asin, brand_name, cc_campaign_id, campaign_asins, product_title, blog_post_id, wordpress_url').eq('user_id', ownerId).range(a, b))
      return r.error ? pages<CampRow>((a, b) => sb.from('campaigns').select('asin, cc_campaign_id, product_title, blog_post_id, wordpress_url').eq('user_id', ownerId).range(a, b)) : r
    }),
    timed('accepted', () => sb.from('cc_accepted_campaigns').select('campaign_id, brand_name, asin').eq('user_id', ownerId).limit(5000)) as Promise<{ data: Array<{ campaign_id: string; brand_name: string | null; asin: string | null }> | null; error: { message: string } | null }>,
    timed('videos', async () => {
      const r = await pages<VidRow>((a, b) => sb.from('youtube_videos').select('id, youtube_video_id, asin, asins, title, amazon_title, published_at, tiktok_share_url').eq('user_id', ownerId).or('asin.not.is.null,asins.not.is.null').range(a, b))
      return r.error ? pages<VidRow>((a, b) => sb.from('youtube_videos').select('id, youtube_video_id, asin, title, published_at').eq('user_id', ownerId).not('asin', 'is', null).range(a, b)) : r
    }),
    timed('posts', async () => {
      const r = await pages<PostRow>((a, b) => sb.from('blog_posts').select(FULL).eq('user_id', ownerId).not('wordpress_url', 'is', null).range(a, b))
      if (!r.error) return { ...r, lean: false }
      const l = await pages<PostRow>((a, b) => sb.from('blog_posts').select(LEAN).eq('user_id', ownerId).not('wordpress_url', 'is', null).range(a, b))
      return { ...l, lean: true }
    }),
    timed('deal_scheduled', () => pages<{ asin: string; results: Array<{ platform: string; ok: boolean; url?: string }> | null; scheduled_at: string }>((a, b) =>
      sb.from('deal_scheduled_posts').select('asin, results, scheduled_at').eq('user_id', ownerId).eq('status', 'completed').range(a, b), 2)),
    timed('amazon_scheduled', () => pages<{ asin: string | null; platform: string; external_url: string | null; scheduled_at: string }>((a, b) =>
      sb.from('amazon_scheduled_posts').select('asin, platform, external_url, scheduled_at').eq('user_id', ownerId).eq('status', 'completed').not('external_url', 'is', null).range(a, b), 2)),
    timed('kept_links', () => pages<{ asin: string; platform: string; url: string; created_at: string }>((a, b) =>
      sb.from('product_post_links').select('asin, platform, url, created_at').eq('user_id', ownerId).range(a, b))),
    timed('content_library', () => pages<{ asin: string | null; platform: string | null; url: string | null; posted_at: string | null }>((a, b) =>
      sb.from('creator_content').select('asin, platform, url, posted_at').eq('user_id', ownerId).not('asin', 'is', null).range(a, b), 2)),
    timed('amazon_video_products', () => pages<{ asin: string; aci: string }>((a, b) => sb.from('amazon_video_products').select('asin, aci').eq('user_id', ownerId).range(a, b), 2)),
    timed('recaps', () => sb.from('brand_recaps').select('brand_key, urls, created_at, ok').eq('user_id', ownerId).eq('ok', true).order('created_at', { ascending: false }).limit(2000)) as Promise<{ data: Array<{ brand_key: string; urls: string[]; created_at: string }> | null; error: { message: string } | null }>,
  ])

  // ── the creator's own campaigns and accepts: the brand behind each product ──
  if (camp.error) unread.push('your campaigns')
  const brandOf = new Map<string, BrandOfAsin>()
  const setBrand = (asin: string, brand: string | null | undefined, campaignId?: string | null, strong = true) => {
    const a = up(asin)
    if (!ASIN_RE.test(a) || !String(brand || '').trim()) return
    const prev = brandOf.get(a)
    if (prev && !strong) { if (campaignId && brandKey(prev.brand) === brandKey(brand) && !prev.campaignIds.includes(campaignId)) prev.campaignIds.push(campaignId); return }
    if (prev && brandKey(prev.brand) === brandKey(brand)) { if (campaignId && !prev.campaignIds.includes(campaignId)) prev.campaignIds.push(campaignId); return }
    if (prev) return
    brandOf.set(a, { brand: String(brand).trim(), campaignIds: campaignId ? [campaignId] : [] })
  }
  const blogAsin = new Map<string, string>()
  const blogUrlAsin = new Map<string, string>()
  for (const r of camp.rows) {
    const a = up(r.asin)
    setBrand(a, r.brand_name, r.cc_campaign_id)
    for (const x of r.campaign_asins ?? []) setBrand(x, r.brand_name, r.cc_campaign_id)
    nameIfNone(a, r.product_title)
    if (r.blog_post_id && ASIN_RE.test(a)) blogAsin.set(r.blog_post_id, a)
    if (r.wordpress_url && ASIN_RE.test(a)) blogUrlAsin.set(linkKey(r.wordpress_url), a)
  }
  if (accepted.error) unread.push('your accepted campaigns')
  for (const x of accepted.data ?? []) setBrand(up(x.asin), x.brand_name, x.campaign_id)

  // ── YouTube ─────────────────────────────────────────────────────────────
  if (vids.error) unread.push('your YouTube videos')
  const videoAsins = new Map<string, string[]>()
  const videoTitle = new Map<string, string>()
  for (const v of vids.rows) {
    const list = [...new Set([up(v.asin), ...(v.asins ?? []).map(up)].filter((x) => ASIN_RE.test(x)))]
    videoAsins.set(v.id, list)
    for (const a of list) { nameIfNone(a, v.amazon_title); if (v.title && !videoTitle.has(a)) videoTitle.set(a, v.title) }
  }

  // ── phase 2: the lookups that depend on phase 1, at once, each with a deadline ──
  const ytIds = vids.rows.map((v) => v.youtube_video_id).filter(Boolean) as string[]
  const byAci = new Map<string, string[]>()
  for (const row of avp.rows) byAci.set(row.aci, [...(byAci.get(row.aci) ?? []), up(row.asin)])
  const [visR, amzVidsR] = await Promise.all([
    withDeadline(timed('youtube_visibility', () => videoVisibility(process.env.YOUTUBE_API_KEY, ytIds)), 20_000, new Map()),
    withDeadline(timed('amazon_videos', () => Promise.all(chunk([...byAci.keys()]).map((part) =>
      sb.from('amazon_videos').select('aci, media_url, published_at').eq('user_id', ownerId).in('aci', part)))), 15_000, [] as Array<{ data: unknown[] | null }>),
  ])
  const vis = visR.value as Map<string, string>
  if (visR.timedOut) unread.push('which of your videos are public (YouTube was slow)')
  if (amzVidsR.timedOut) unread.push('your Amazon videos')

  let privateVideos = 0
  for (const v of vids.rows) {
    if (!v.youtube_video_id) continue
    const seen = vis.get(v.youtube_video_id)
    if (seen === 'not_public') { privateVideos++; continue }
    for (const a of videoAsins.get(v.id) ?? []) {
      links.push({ asin: a, platform: 'youtube', url: `https://www.youtube.com/watch?v=${v.youtube_video_id}`, at: v.published_at,
        note: seen === 'unlisted' ? 'Unlisted: only people with the link can see it.' : seen ? null : 'YouTube did not say whether this video is public.' })
      if (v.tiktok_share_url) links.push({ asin: a, platform: 'tiktok', url: v.tiktok_share_url, at: v.published_at })
    }
  }

  // ── blog posts and the social posts made from them ──────────────────────
  if (posts.error) unread.push('your blog posts')
  else if (posts.lean) unread.push('the social posts made from your blog posts')
  for (const p of posts.rows) {
    const fromVideo = p.video_id ? videoAsins.get(p.video_id) ?? [] : []
    const asins = [...new Set([
      ...fromVideo, up(p.deal_meta?.asin), blogAsin.get(p.id) ?? '', p.wordpress_url ? blogUrlAsin.get(linkKey(p.wordpress_url)) ?? '' : '',
    ].filter((x) => ASIN_RE.test(x)))]
    if (!asins.length) continue
    const pl = p.social_permalinks || {}
    const at = p.published_at
    const each: Array<[ContentLink['platform'], string | null | undefined]> = [
      ['blog', p.wordpress_url],
      ['x', pl.x || (p.twitter_post_id ? socialPermalink.x(p.twitter_post_id) : null)],
      ['facebook', pl.facebook || (p.facebook_post_id ? socialPermalink.facebook(p.facebook_post_id) : null)],
      ['linkedin', pl.linkedin || (p.linkedin_post_id ? socialPermalink.linkedin(p.linkedin_post_id) : null)],
      ['pinterest', pl.pinterest || (p.pinterest_pin_id ? socialPermalink.pinterest(p.pinterest_pin_id) : null)],
      ['tiktok', pl.tiktok || p.tiktok_share_url],
      ['threads', pl.threads], ['instagram', pl.instagram], ['telegram', pl.telegram],
    ]
    for (const a of asins) for (const [platform, url] of each) if (url) links.push({ asin: a, platform, url, at })
  }

  // ── posts that kept their own URLs ──────────────────────────────────────
  if (dealSched.error) unread.push('your scheduled Deal Radar posts')
  for (const row of dealSched.rows) for (const x of row.results ?? []) {
    const platform = contentPlatform(x.platform)
    if (x.ok && x.url && platform) links.push({ asin: up(row.asin), platform, url: x.url, at: row.scheduled_at })
  }
  if (amzSched.error) unread.push('your scheduled Amazon posts')
  for (const row of amzSched.rows) {
    const platform = contentPlatform(row.platform)
    if (platform && row.external_url) links.push({ asin: up(row.asin), platform, url: row.external_url, at: row.scheduled_at })
  }
  let linksTable = true
  if (kept.error) { linksTable = !/product_post_links/.test(kept.error) || !/exist|schema cache|find/i.test(kept.error); if (linksTable) unread.push('your recent social posts') }
  for (const row of kept.rows) {
    const platform = contentPlatform(row.platform)
    if (platform) links.push({ asin: up(row.asin), platform, url: row.url, at: row.created_at })
  }
  for (const row of library.rows) {
    const platform = contentPlatform(row.platform)
    if (platform && row.url) links.push({ asin: up(row.asin), platform, url: row.url, at: row.posted_at })
  }
  for (const res of amzVidsR.value) {
    for (const row of (res.data ?? []) as Array<{ aci: string; media_url: string | null; published_at: string | null }>) {
      if (!row.media_url || !/\/vdp\//.test(row.media_url)) continue
      for (const a of byAci.get(row.aci) ?? []) links.push({ asin: a, platform: 'amazon_video', url: row.media_url, at: row.published_at })
    }
  }

  // ── phase 3: brand and name for products the creator's own rows did not cover ──
  const contentAsins = [...new Set(links.map((l) => up(l.asin)).filter((a) => ASIN_RE.test(a)))]
  const missing = contentAsins.filter((a) => !brandOf.has(a))
  // WHICH BRAND, FROM THE CATALOG. First the cc_brands_for_asins function
  // (migration 381): the whole list in one call, one index lookup each. A
  // per-product query with a LIMIT took over ten seconds each on the real
  // catalog, because Postgres may read ~800k rows from the top rather than use
  // the index. Without the function, the fallback asks one product at a time
  // with no LIMIT, which leaves the index as the planner's obvious choice.
  // Results land in `found` as they come, so a deadline keeps what was found.
  type CatRow = { campaign_id: string; brand_name: string | null; asins?: string[] | null; campaign_name: string | null }
  const catErrors: string[] = []
  const found: Array<{ asin: string; rows: CatRow[] }> = []
  const lookFor = missing.slice(0, 600)
  const queue = [...lookFor]
  let viaFunction = false
  const catR = await withDeadline(timed('catalog', async () => {
    let rpc: { data?: unknown; error: { message: string } | null }
    try { rpc = await sb.rpc('cc_brands_for_asins', { p_asins: lookFor }) } catch (e) { rpc = { error: { message: `function call failed: ${e instanceof Error ? e.message : String(e)}` } } }
    if (!rpc.error) {
      viaFunction = true
      const by = new Map<string, CatRow[]>()
      for (const r of (rpc.data ?? []) as Array<{ asin: string; brand_name: string | null; campaign_id: string; campaign_name: string | null }>) {
        by.set(r.asin, [...(by.get(r.asin) ?? []), { campaign_id: r.campaign_id, brand_name: r.brand_name, campaign_name: r.campaign_name }])
      }
      for (const a of lookFor) found.push({ asin: a, rows: by.get(a) ?? [] })
      queue.length = 0
      return found
    }
    if (!/cc_brands_for_asins|function|schema cache/i.test(String(rpc.error.message))) catErrors.push(String(rpc.error.message).slice(0, 120))
    await Promise.all(Array.from({ length: Math.min(16, queue.length) }, async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        const r = await sb.from('cc_campaign_catalog').select('campaign_id, brand_name, campaign_name').contains('asins', [a])
        if (r.error) { if (catErrors.length < 3) catErrors.push(String(r.error.message || r.error).slice(0, 120)); continue }
        found.push({ asin: a, rows: ((r.data ?? []) as CatRow[]).slice(0, 5) })
      }
    }))
    return found
  }), 25_000, found)
  if (catR.timedOut) { queue.length = 0; timings.catalog = 25_000; unread.push(`the Creator Connections catalog for ${lookFor.length - found.length} of ${lookFor.length} products (it was slow${viaFunction ? '' : '; migration 381 makes this one fast lookup'})`) }
  else if (catErrors.length) unread.push(`the Creator Connections catalog (${catErrors[0]})`)
  if (missing.length > 600) unread.push(`the brand of ${missing.length - 600} older products (only the first 600 are looked up)`)
  for (const { asin, rows } of found) {
    for (const c of rows) { setBrand(asin, c.brand_name, c.campaign_id, false); nameIfNone(asin, c.campaign_name) }
  }
  const nameless = contentAsins.filter((a) => !names.has(a) && brandOf.has(a))
  const keepaR = await withDeadline(timed('names', () => Promise.all(chunk(nameless).map((part) =>
    sb.from('keepa_product_cache').select('asin, title').in('asin', part)))), 10_000, [] as Array<{ data: unknown[] | null }>)
  for (const r of keepaR.value) for (const row of (r.data ?? []) as Array<{ asin: string; title: string | null }>) nameIfNone(up(row.asin), row.title)
  // Last resort: the title of the video about it, which beats a bare ASIN.
  for (const a of nameless) if (!names.has(a) && videoTitle.has(a)) names.set(a, productShortName(videoTitle.get(a), a))

  // ── what was already sent ───────────────────────────────────────────────
  const sent = new Map<string, Set<string>>()
  const lastRecapAt = new Map<string, string>()
  let recapsTable = true
  if (recaps.error) recapsTable = !(/brand_recaps/.test(recaps.error.message) && /exist|schema cache|find/i.test(recaps.error.message))
  if (recaps.error && recapsTable) unread.push('the recaps you already sent')
  for (const row of recaps.data ?? []) {
    const set = sent.get(row.brand_key) ?? new Set<string>()
    for (const u of row.urls ?? []) set.add(linkKey(u))
    sent.set(row.brand_key, set)
    if (!lastRecapAt.has(row.brand_key)) lastRecapAt.set(row.brand_key, row.created_at)
  }

  const brands = groupByBrand({ links, brandOf, names, sent, lastRecapAt })
  console.log('[brand-recap] timings ms', JSON.stringify(timings))
  return { brands, unread, privateVideos, recapsTable, linksTable, timings }
}
