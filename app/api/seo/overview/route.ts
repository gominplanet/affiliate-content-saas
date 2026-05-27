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
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getValidGscToken, querySearchAnalytics, inspectUrl } from '@/lib/gsc'
import { scorePostSeo } from '@/lib/seo-score'
import { fetchSitemapSlugs } from '@/lib/sitemap'
import { fetchLiveWpPostIds } from '@/lib/wp-live-posts'

export const maxDuration = 120

const INSPECT_CAP = 25          // max URL Inspections per request (latency + quota guard)
const STALE_MS = 24 * 60 * 60 * 1000

function ymd(d: Date): string { return d.toISOString().slice(0, 10) }

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await (supabase as any)
    .from('integrations')
    .select('wordpress_url,gsc_property,gsc_oauth_access_token')
    .eq('user_id', user.id)
    .single()
  const wpUrl: string = (integ?.wordpress_url || '').replace(/\/$/, '')
  const siteHost = wpUrl
  const property: string | null = integ?.gsc_property || null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: postsRaw } = await (supabase as any)
    .from('blog_posts')
    .select('id,title,slug,content,post_type,wordpress_post_id,published_at')
    .eq('user_id', user.id)
    .not('wordpress_post_id', 'is', null)
    .order('published_at', { ascending: false })
  type Post = { id: string; title: string; slug: string; content: string; post_type: string | null; wordpress_post_id: number | null; published_at: string | null }
  const posts = (postsRaw as Post[] | null) ?? []

  // Reconcile against the LIVE site: a post deleted/trashed in WordPress still
  // lingers in blog_posts and would score as a phantom 404 here. Drop any
  // catalog row whose WP post no longer exists. If the site's REST can't be
  // read (liveIds === null) or returns nothing usable, show everything — never
  // hide real posts on a transient error.
  const liveIds = await fetchLiveWpPostIds(wpUrl)
  const livePosts = (liveIds && liveIds.size > 0)
    ? posts.filter(p => p.wordpress_post_id != null && liveIds.has(p.wordpress_post_id))
    : posts

  // Existing cache (for serving stale indexing without re-inspecting).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cacheRows } = await (supabase as any)
    .from('post_seo').select('*').eq('user_id', user.id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cache = new Map<string, any>((cacheRows ?? []).map((r: any) => [r.post_id, r]))

  // ── GSC connection + one performance call by page ────────────────────────
  let token: string | null = null
  let perfByPage: Map<string, { clicks: number; impressions: number; position: number; ctr: number }> = new Map()
  if (property) {
    token = await getValidGscToken(supabase, user.id)
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

  // Which post slugs are actually in the site's sitemap (Google's discovery
  // path). `found:false` → couldn't read a sitemap, so we don't flag "missing".
  const sitemap = wpUrl ? await fetchSitemapSlugs(wpUrl) : { slugs: new Set<string>(), found: false }
  // Guard against false "missing" positives from slug drift: WordPress can
  // store a permalink slug that differs from the one MVP recorded (dedupe
  // suffixes like "-2", manual edits). If the sitemap clearly holds at least as
  // many URLs as we have posts, it's complete — treat every post as present
  // rather than alarming on a slug mismatch. We only flag specific posts when
  // the sitemap genuinely has fewer entries than the catalog.
  const sitemapComplete = sitemap.found && sitemap.slugs.size >= livePosts.length

  // Match a post's slug to a GSC page URL.
  const findPageForSlug = (slug: string): string | null => {
    if (!slug) return null
    for (const page of perfByPage.keys()) {
      if (page.includes('/' + slug)) return page
    }
    return null
  }

  let inspected = 0
  const out: Record<string, unknown>[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toUpsert: any[] = []

  for (const p of posts) {
    const { score, checks } = scorePostSeo({
      title: p.title || '', contentHtml: p.content || '', siteHost, postType: p.post_type || 'review',
      // meta description isn't on blog_posts; the FAQ/intro checks still cover AEO.
    })

    const matchedPage = findPageForSlug(p.slug)
    const url = matchedPage || (wpUrl && p.slug ? `${wpUrl}/${p.slug}` : null)
    const perf = matchedPage ? perfByPage.get(matchedPage) : undefined

    const cached = cache.get(p.id)
    let indexedState: string = cached?.indexed_state || 'unknown'
    let coverageState: string | null = cached?.coverage_state || null
    let lastCrawl: string | null = cached?.last_crawl || null

    // Refresh indexing for stale/missing rows, capped per request.
    const stale = !cached || (Date.now() - new Date(cached.checked_at || 0).getTime()) > STALE_MS
    if (connected && token && property && url && stale && inspected < INSPECT_CAP) {
      inspected++
      const ins = await inspectUrl(token, property, url)
      if (ins) {
        indexedState = ins.indexed ? 'indexed' : 'not_indexed'
        coverageState = ins.coverageState
        lastCrawl = ins.lastCrawl
      }
    }

    const row = {
      postId: p.id, title: p.title, slug: p.slug, url,
      score, checks,
      indexed: indexedState === 'indexed' ? true : indexedState === 'not_indexed' ? false : null,
      inSitemap: !sitemap.found ? null : (sitemapComplete ? true : sitemap.slugs.has((p.slug || '').toLowerCase())),
      coverageState, lastCrawl,
      clicks: perf?.clicks ?? cached?.clicks ?? 0,
      impressions: perf?.impressions ?? cached?.impressions ?? 0,
      position: perf?.position ?? cached?.position ?? null,
      ctr: perf?.ctr ?? cached?.ctr ?? null,
    }
    out.push(row)

    toUpsert.push({
      post_id: p.id, user_id: user.id, url,
      indexed_state: indexedState, coverage_state: coverageState, last_crawl: lastCrawl,
      clicks: row.clicks, impressions: row.impressions, position: row.position, ctr: row.ctr,
      seo_score: score, score_detail: checks, checked_at: new Date().toISOString(),
    })
  }

  // Persist the snapshot (best-effort; never block the response).
  if (toUpsert.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { await (supabase as any).from('post_seo').upsert(toUpsert, { onConflict: 'post_id' }) } catch { /* non-fatal */ }
  }

  const total = out.length
  const avgScore = total ? Math.round(out.reduce((s, r) => s + (r.score as number), 0) / total) : 0
  const summary = {
    total,
    avgScore,
    indexed: out.filter(r => r.indexed === true).length,
    notIndexed: out.filter(r => r.indexed === false).length,
    unknown: out.filter(r => r.indexed === null).length,
    notInSitemap: out.filter(r => r.inSitemap === false).length,
    sitemapFound: sitemap.found,
    totalClicks: out.reduce((s, r) => s + (r.clicks as number), 0),
    totalImpressions: out.reduce((s, r) => s + (r.impressions as number), 0),
  }

  return NextResponse.json({ connected, property, summary, posts: out })
}
