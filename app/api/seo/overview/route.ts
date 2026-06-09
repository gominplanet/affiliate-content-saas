/**
 * GET /api/seo/overview
 *
 * The data behind the SEO hub. For every published post:
 *   - computes the on-page/AEO score (lib/seo-score, no network), and
 *   - if Google Search Console is connected: merges search performance
 *     (clicks/impressions/position) from ONE Search Analytics call, and the
 *     indexing status from URL Inspection (capped per request + cached in
 *     post_seo so we stay well under GSC's quota).
 *
 * Results are cached in post_seo; stale/missing rows are refreshed on demand.
 * Works without GSC — you still get the content score.
 *
 * MULTI-SITE: each post's wordpress_site_id determines which WP install
 * provides its sitemap + live-id reconciliation + base URL. The same GSC
 * property is queried for all sites (creators typically GSC-verify ONE
 * property covering their network; if they have separate properties we'd
 * need per-site GSC properties which is out of scope for v1).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getValidGscToken, querySearchAnalytics, inspectUrl } from '@/lib/gsc'
import { scorePostSeo } from '@/lib/seo-score'
import { fetchSitemapSlugs } from '@/lib/sitemap'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials, listSites } from '@/lib/wordpress-sites'
import { getAuthAndOwner } from '@/lib/agency-auth'

export const maxDuration = 120

const INSPECT_CAP = 25          // max URL Inspections per request (latency + quota guard)
const STALE_MS = 24 * 60 * 60 * 1000

function ymd(d: Date): string { return d.toISOString().slice(0, 10) }

// Per-site context cached during the overview call so we don't re-fetch a
// sitemap / live-id list for every post on the same site.
interface SiteContext {
  wpBase: string
  liveIds: Set<number> | null
  sitemapSlugs: Set<string>
  sitemapFound: boolean
}

export async function GET() {
  const supabase = await createServerClient()
  // 2026-06-09 Phase 2 (VA): all resource reads (integrations, blog_posts,
  // post_seo, GSC token, WP credentials) go through ownerId so VAs see the
  // owner's SEO dashboard. user.id only used for the post_seo upsert below
  // where we keep it as ownerId too — post_seo lives on the owner's side.
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  // Per-user: GSC property only. WP credentials are per-site (loaded below).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await supabase
    .from('integrations')
    .select('gsc_property')
    .eq('user_id', ownerId)
    .single()
  const property: string | null = integ?.gsc_property || null

  // Bounded read — the SEO overview UI shows the user's recent posts; we
  // cap at 300 so a 500-post user doesn't transfer 5-50MB of HTML on
  // every dashboard render (audit P01, 2026-06-04). The score for older
  // posts is already in post_seo cache and surfaces on the post-detail
  // page. Real fix: cache score_detail on post_seo + re-score on save,
  // tracked as a follow-up.
  const POSTS_OVERVIEW_CAP = 300
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: postsRaw } = await supabase
    .from('blog_posts')
    .select('id,title,slug,content,post_type,wordpress_post_id,wordpress_site_id,published_at')
    .eq('user_id', ownerId)
    .not('wordpress_post_id', 'is', null)
    .order('published_at', { ascending: false })
    .limit(POSTS_OVERVIEW_CAP)
  type Post = { id: string; title: string; slug: string; content: string; post_type: string | null; wordpress_post_id: number | null; wordpress_site_id: string | null; published_at: string | null }
  const posts = (postsRaw as Post[] | null) ?? []

  // ── Multi-site setup: resolve every site referenced by these posts, once.
  // Build siteCache keyed by wordpress_sites.id (or LEGACY_BUCKET for nulls).
  const sites = await listSites(supabase, ownerId)
  const defaultSiteId = sites.find(s => s.isDefault)?.id ?? sites[0]?.id ?? null
  const LEGACY_BUCKET = '__legacy__'
  const referencedSiteIds = new Set<string>()
  for (const p of posts) referencedSiteIds.add(p.wordpress_site_id ?? defaultSiteId ?? LEGACY_BUCKET)

  // Perf (audit 2026-06-02): site context was built in a serial loop.
  // For 3-site Pro users that's ~2.4s of waterfall (each iteration:
  // credential lookup + getPublishedPostIds + sitemap fetch, each
  // ~800ms). The sites are independent — parallelize them.
  const siteCache = new Map<string, SiteContext | null>()
  const siteResults = await Promise.all(
    Array.from(referencedSiteIds).map(async (key): Promise<[string, SiteContext | null]> => {
      const lookupId = key === LEGACY_BUCKET ? null : key
      const creds = await getWordPressCredentials(supabase, ownerId, lookupId)
      if (!creds) return [key, null]
      const wpBase = creds.wordpress_url.replace(/\/$/, '')
      // Live IDs + sitemap can also run in parallel (independent
      // network calls).
      const [liveIds, sm] = await Promise.all([
        (async () => {
          try {
            const wpSvc = createWordPressService(
              creds.wordpress_url,
              creds.wordpress_username,
              creds.wordpress_app_password,
              creds.wordpress_api_token || undefined,
            )
            return await wpSvc.getPublishedPostIds()
          } catch { return null }
        })(),
        wpBase ? fetchSitemapSlugs(wpBase) : Promise.resolve({ slugs: new Set<string>(), found: false }),
      ])
      return [key, { wpBase, liveIds, sitemapSlugs: sm.slugs, sitemapFound: sm.found }]
    })
  )
  for (const [k, v] of siteResults) siteCache.set(k, v)

  // Per-post site context resolver — same pattern as fix-all/indexnow.
  function siteFor(p: Post): SiteContext | null {
    const key = p.wordpress_site_id ?? defaultSiteId ?? LEGACY_BUCKET
    return siteCache.get(key) ?? null
  }

  // Reconcile against the LIVE site: a post deleted/trashed in WordPress still
  // lingers in blog_posts and would score as a phantom 404 here. Drop any
  // catalog row whose WP post no longer exists ON ITS SITE. If the site's
  // REST can't be read (liveIds === null) or returns nothing usable, show
  // everything from that site — never hide real posts on a transient error.
  const livePosts = posts.filter(p => {
    const ctx = siteFor(p)
    if (!ctx) return true     // unreachable site → still surface its posts
    if (!ctx.liveIds || ctx.liveIds.size === 0) return true
    return p.wordpress_post_id != null && ctx.liveIds.has(p.wordpress_post_id)
  })

  // Existing cache (for serving stale indexing without re-inspecting).
  // Perf (audit 2026-06-02): narrowed from select('*'). The old query
  // pulled `score_detail` (JSONB blob, ~10KB per row) for the whole
  // catalog. For a 200-post user that's 2MB of JSON deserialized
  // every page load just to read 10 scalars. Cut to the actual fields
  // referenced below. score_detail isn't read by overview — only by
  // the per-post fix route.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cacheRows } = await supabase
    .from('post_seo')
    .select('post_id,indexed_state,coverage_state,last_crawl,clicks,impressions,position,ctr,dropped_at,checked_at,score')
    .eq('user_id', ownerId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cache = new Map<string, any>((cacheRows ?? []).map((r: any) => [r.post_id, r]))

  // ── GSC connection + one performance call by page ────────────────────────
  let token: string | null = null
  let perfByPage: Map<string, { clicks: number; impressions: number; position: number; ctr: number }> = new Map()
  if (property) {
    token = await getValidGscToken(supabase, ownerId)
    if (token) {
      const end = new Date(); end.setDate(end.getDate() - 3)   // GSC has ~3-day lag
      const start = new Date(); start.setDate(start.getDate() - 31)
      const rows = await querySearchAnalytics(token, property, {
        startDate: ymd(start), endDate: ymd(end), dimensions: ['page'], rowLimit: 1000,
      })
      perfByPage = new Map(rows.map(r => [(r.keys?.[0] || ''), { clicks: r.clicks, impressions: r.impressions, position: r.position, ctr: r.ctr }]))
    }
  }
  const connected = !!(property && token)

  // Match a post's slug to a GSC page URL.
  const findPageForSlug = (slug: string): string | null => {
    if (!slug) return null
    for (const page of perfByPage.keys()) {
      if (page.includes('/' + slug)) return page
    }
    return null
  }

  const out: Record<string, unknown>[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toUpsert: any[] = []

  // ── Phase 1: synchronous scoring + decide which rows need a fresh GSC ping
  // Build the list of work to do BEFORE we start inspecting, so we can fan
  // out the URL Inspections concurrently with a fixed concurrency cap.
  // Sequential was ~800ms/inspection × 25 = ~20s wall time. Parallel-of-5
  // brings that down to ~4s without hammering GSC.
  type Pending = {
    post: typeof livePosts[number]
    score: number
    checks: ReturnType<typeof scorePostSeo>['checks']
    url: string | null
    perf: { clicks: number; impressions: number; position: number; ctr: number } | undefined
    cached: ReturnType<typeof cache.get>
    needsInspect: boolean
    siteCtx: SiteContext | null
  }
  const pending: Pending[] = livePosts.map(p => {
    const siteCtx = siteFor(p)
    const wpBase = siteCtx?.wpBase ?? ''
    const { score, checks } = scorePostSeo({
      title: p.title || '', contentHtml: p.content || '', siteHost: wpBase, postType: p.post_type || 'review',
    })
    const matchedPage = findPageForSlug(p.slug)
    const url = matchedPage || (wpBase && p.slug ? `${wpBase}/${p.slug}` : null)
    const perf = matchedPage ? perfByPage.get(matchedPage) : undefined
    const cached = cache.get(p.id)
    const stale = !cached || (Date.now() - new Date(cached.checked_at || 0).getTime()) > STALE_MS
    const needsInspect = !!(connected && token && property && url && stale)
    return { post: p, score, checks, url, perf, cached, needsInspect, siteCtx }
  })

  // Apply the INSPECT_CAP — pick the first N that need inspection.
  const toInspect = pending.filter(p => p.needsInspect).slice(0, INSPECT_CAP)
  const inspectResults = new Map<string, Awaited<ReturnType<typeof inspectUrl>>>()
  if (toInspect.length && token && property) {
    const CONCURRENCY = 5
    for (let i = 0; i < toInspect.length; i += CONCURRENCY) {
      const chunk = toInspect.slice(i, i + CONCURRENCY)
      const results = await Promise.all(chunk.map(async pp => {
        const ins = await inspectUrl(token!, property!, pp.url!)
        return [pp.post.id, ins] as const
      }))
      for (const [id, ins] of results) inspectResults.set(id, ins)
    }
  }

  // Per-site sitemapComplete pre-computation — same logic as before but
  // per-site, since each post's "is it in MY sitemap" depends on its own site.
  const sitemapCompleteBySite = new Map<string, boolean>()
  for (const [key, ctx] of siteCache.entries()) {
    if (!ctx) { sitemapCompleteBySite.set(key, false); continue }
    const sitePostCount = livePosts.filter(p => (p.wordpress_site_id ?? defaultSiteId ?? LEGACY_BUCKET) === key).length
    sitemapCompleteBySite.set(key, ctx.sitemapFound && ctx.sitemapSlugs.size >= sitePostCount)
  }
  function sitemapCompleteFor(p: Post): boolean {
    const key = p.wordpress_site_id ?? defaultSiteId ?? LEGACY_BUCKET
    return sitemapCompleteBySite.get(key) ?? false
  }

  // ── Phase 2: assemble the output rows with whatever inspection data we got
  for (const pp of pending) {
    const { post: p, score, checks, url, perf, cached, siteCtx } = pp
    let indexedState: string = cached?.indexed_state || 'unknown'
    let coverageState: string | null = cached?.coverage_state || null
    let lastCrawl: string | null = cached?.last_crawl || null
    const ins = inspectResults.get(p.id)
    if (ins) {
      indexedState = ins.indexed ? 'indexed' : 'not_indexed'
      coverageState = ins.coverageState
      lastCrawl = ins.lastCrawl
    }

    const inSitemap = !siteCtx?.sitemapFound
      ? null
      : (sitemapCompleteFor(p) ? true : siteCtx.sitemapSlugs.has((p.slug || '').toLowerCase()))

    const row = {
      postId: p.id, title: p.title, slug: p.slug, url,
      // Exposed so the SEO page can show "Rebuild from video" on each row —
      // the modal needs the live WP id to POST /api/blog/attach-video.
      wordpressPostId: p.wordpress_post_id,
      // Site identity so the UI can show "Wine Reviews" / "Tech Picks" pill
      // next to each row when the user has multi-site connected.
      wordpressSiteId: p.wordpress_site_id,
      score, checks,
      indexed: indexedState === 'indexed' ? true : indexedState === 'not_indexed' ? false : null,
      inSitemap,
      coverageState, lastCrawl,
      // When the nightly cron sees a post flip indexed → not_indexed, it stamps
      // dropped_at. Cleared (null) when the post comes back. The SEO page uses
      // this for the "recently dropped" banner + a per-row pill.
      droppedAt: (cached?.dropped_at as string | null | undefined) ?? null,
      clicks: perf?.clicks ?? cached?.clicks ?? 0,
      impressions: perf?.impressions ?? cached?.impressions ?? 0,
      position: perf?.position ?? cached?.position ?? null,
      ctr: perf?.ctr ?? cached?.ctr ?? null,
    }
    out.push(row)

    toUpsert.push({
      post_id: p.id, user_id: ownerId, url,
      indexed_state: indexedState, coverage_state: coverageState, last_crawl: lastCrawl,
      clicks: row.clicks, impressions: row.impressions, position: row.position, ctr: row.ctr,
      seo_score: score, score_detail: checks, checked_at: new Date().toISOString(),
    })
  }

  // Persist the snapshot (best-effort; never block the response).
  if (toUpsert.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { await supabase.from('post_seo').upsert(toUpsert, { onConflict: 'post_id' }) } catch { /* non-fatal */ }
  }

  const total = out.length
  const avgScore = total ? Math.round(out.reduce((s, r) => s + (r.score as number), 0) / total) : 0
  // "Recently dropped" = posts whose dropped_at landed in the last 7 days. The
  // SEO page surfaces this count as an alert banner so unexpected de-indexings
  // are visible without digging through every row.
  const DROP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
  const now = Date.now()
  const recentlyDropped = out.filter(r => {
    const d = r.droppedAt as string | null
    if (!d) return false
    const t = new Date(d).getTime()
    return Number.isFinite(t) && (now - t) < DROP_WINDOW_MS && r.indexed === false
  }).length
  // sitemapFound is true if ANY of the user's sites has a readable sitemap.
  // (The per-row inSitemap is still per-site accurate; this is the global
  // UI flag for the "couldn't read your sitemap" banner.)
  const anySitemapFound = Array.from(siteCache.values()).some(c => c?.sitemapFound === true)
  const summary = {
    total,
    avgScore,
    indexed: out.filter(r => r.indexed === true).length,
    notIndexed: out.filter(r => r.indexed === false).length,
    unknown: out.filter(r => r.indexed === null).length,
    notInSitemap: out.filter(r => r.inSitemap === false).length,
    recentlyDropped,
    sitemapFound: anySitemapFound,
    totalClicks: out.reduce((s, r) => s + (r.clicks as number), 0),
    totalImpressions: out.reduce((s, r) => s + (r.impressions as number), 0),
  }

  // Expose the connected sites so the SEO page can render a per-site filter.
  const exposedSites = sites.map(s => ({ id: s.id, label: s.label, isDefault: s.isDefault }))
  return NextResponse.json({ connected, property, summary, posts: out, sites: exposedSites })
}
