/**
 * GET /api/analytics/clicks
 *
 * Returns last-30-day click + per-post + per-source-group analytics for
 * the /analytics page. Source of truth is Geniuslink — we look up daily
 * clicks per shortcode via /v1/reports/link-click-trend-by-resolution
 * and aggregate them into source-group buckets so the user can see
 * whether clicks are coming from their YouTube descriptions or their
 * blog posts (split per site for multi-site users).
 *
 * Source-group resolution:
 *   - blog group  ← wordpress_sites.geniuslink_group_id (cached by
 *                    /api/geniuslink/setup), name = site label.
 *   - YT group    ← integrations.geniuslink_youtube_group_id (cached
 *                    same way), name = "YouTube (MVP-YOUTUBE)".
 * Codes are grouped by the row that holds the link — blog_posts for
 * blog clicks, youtube_videos.geniuslink_yt_code for YT clicks.
 *
 * Backfill strategy: Geniuslink doesn't expose a "list-all-shortlinks"
 * endpoint, so we can't enumerate them server-side. Instead we extract
 * the geni.us/CODE shortcode from each blog post's stored content
 * (Claude embeds it in the body during generation). Any post that
 * doesn't have a geniuslink_code on the row gets one assigned from
 * content scraping, and we persist it so subsequent hits skip the
 * scrape. YT-side codes are populated at generate-metadata time
 * (no backfill needed for new generations).
 *
 * Response shape:
 *   {
 *     connected: boolean
 *     totals: { clicks, posts, topClicks }
 *     posts: Array<{ postId, title, url, clicks, code }>
 *     groups: Array<{ name, kind: 'youtube' | 'blog', clicks, linkCount }>
 *   }
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createGeniuslinkService } from '@/services/geniuslink'

interface BlogPostRow {
  id: string
  title: string | null
  wordpress_url: string | null
  geniuslink_code: string | null
  content: string | null
  wordpress_site_id: string | null
}

interface YouTubeVideoRow {
  id: string
  title: string | null
  geniuslink_yt_code: string | null
}

interface WordPressSiteRow {
  id: string
  label: string | null
  url: string
}

interface SourceGroup {
  name: string
  kind: 'youtube' | 'blog'
  clicks: number
  linkCount: number
}

/** Pull geni.us/CODE out of arbitrary text. */
function extractCode(text: string | null | undefined): string | null {
  if (!text) return null
  const m = text.match(/https?:\/\/(?:www\.)?geni\.us\/([A-Za-z0-9]+)/)
  return m ? m[1] : null
}

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Geniuslink creds
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
      .from('integrations')
      .select('geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', user.id)
      .single()

    if (!intRow?.geniuslink_api_key || !intRow?.geniuslink_api_secret) {
      return NextResponse.json({
        connected: false,
        totals: { clicks: 0, posts: 0, topClicks: 0 },
        posts: [],
        groups: [],
      })
    }

    // ── Load blog posts, YT videos (with codes), and WP sites in parallel ─────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [postsRes, ytVideosRes, sitesRes] = await Promise.all([
      supabase
        .from('blog_posts')
        .select('id,title,wordpress_url,geniuslink_code,content,wordpress_site_id')
        .eq('user_id', user.id)
        .eq('status', 'published'),
      // The regenerated DB types lag migration 114 (which added
      // geniuslink_yt_code) so we have to cast through unknown to avoid
      // SelectQueryError. Same pattern as resolveGeniuslinkGroupId in
      // lib/geniuslink-group.ts where 112/113 columns were added.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('youtube_videos')
        .select('id,title,geniuslink_yt_code')
        .eq('user_id', user.id)
        .not('geniuslink_yt_code', 'is', null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase
        .from('wordpress_sites')
        .select('id,label,url')
        .eq('user_id', user.id),
    ])
    const posts: BlogPostRow[] = (postsRes.data ?? []) as BlogPostRow[]
    const ytVideos: YouTubeVideoRow[] = ((ytVideosRes.data ?? []) as unknown) as YouTubeVideoRow[]
    const sites: WordPressSiteRow[] = (sitesRes.data ?? []) as WordPressSiteRow[]

    // Backfill: extract geni.us/CODE from content for any post missing
    // the column. Persist so we don't re-scrape next time.
    const backfills: Array<{ id: string; code: string }> = []
    for (const p of posts) {
      if (p.geniuslink_code) continue
      const code = extractCode(p.content)
      if (code) {
        p.geniuslink_code = code
        backfills.push({ id: p.id, code })
      }
    }
    if (backfills.length > 0) {
      await Promise.all(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        backfills.map(b => supabase
          .from('blog_posts')
          .update({ geniuslink_code: b.code })
          .eq('id', b.id)
        ),
      )
    }

    // ── Look up clicks for every unique shortcode (blog + YT) ─────────────────
    // Dedupe across the entire set since blog posts can share a code with
    // their parent YT video (same product, same wrap).
    const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
    const allCodes = new Set<string>()
    posts.forEach(p => { if (p.geniuslink_code) allCodes.add(p.geniuslink_code) })
    ytVideos.forEach(v => { if (v.geniuslink_yt_code) allCodes.add(v.geniuslink_yt_code) })
    const uniqueCodes = Array.from(allCodes)

    const CONCURRENCY = 8
    const DAYS = 30
    const clicksByCode = new Map<string, number>()
    for (let i = 0; i < uniqueCodes.length; i += CONCURRENCY) {
      const batch = uniqueCodes.slice(i, i + CONCURRENCY)
      const seriesBatch = await Promise.all(batch.map(code => genius.getDailyClicks(code, DAYS)))
      batch.forEach((code, idx) => {
        const total = seriesBatch[idx].reduce((s, d) => s + d.clicks, 0)
        clicksByCode.set(code, total)
      })
    }

    // ── Per-post rows (existing behavior, unchanged) ──────────────────────────
    const postRows = posts
      .map(p => ({
        postId: p.id,
        title: p.title ?? '',
        url: p.wordpress_url ?? '',
        code: p.geniuslink_code ?? null,
        clicks: p.geniuslink_code ? (clicksByCode.get(p.geniuslink_code) ?? 0) : 0,
      }))
      .sort((a, b) => b.clicks - a.clicks)

    const withClicks = postRows.filter(p => p.clicks > 0)
    const totals = {
      clicks: withClicks.reduce((sum, p) => sum + p.clicks, 0),
      posts: withClicks.length,
      topClicks: withClicks[0]?.clicks ?? 0,
    }

    // ── Per-source-group buckets ─────────────────────────────────────────────
    // Blog: bucket each post by its wordpress_site_id (multi-site users see
    // one bucket per site). Posts missing wordpress_site_id (legacy rows
    // before the multi-site migration) get a fallback "Blog" bucket.
    // YT: one bucket per user — all YT-side videos roll up to MVP-YOUTUBE.
    const siteLabelById = new Map(sites.map(s => [s.id, s.label || s.url] as const))
    const blogBuckets = new Map<string, { clicks: number; linkCount: number; label: string }>()
    for (const p of posts) {
      if (!p.geniuslink_code) continue
      const c = clicksByCode.get(p.geniuslink_code) ?? 0
      const bucketKey = p.wordpress_site_id ?? '__legacy__'
      const bucketLabel = p.wordpress_site_id
        ? (siteLabelById.get(p.wordpress_site_id) ?? 'Blog')
        : 'Blog (legacy)'
      const existing = blogBuckets.get(bucketKey)
      if (existing) {
        existing.clicks += c
        existing.linkCount += 1
      } else {
        blogBuckets.set(bucketKey, { clicks: c, linkCount: 1, label: bucketLabel })
      }
    }
    const groups: SourceGroup[] = []
    // YT bucket first (since most users will care about source split).
    const ytClicks = ytVideos.reduce((sum, v) => {
      if (!v.geniuslink_yt_code) return sum
      return sum + (clicksByCode.get(v.geniuslink_yt_code) ?? 0)
    }, 0)
    if (ytVideos.length > 0) {
      groups.push({
        name: 'YouTube (MVP-YOUTUBE)',
        kind: 'youtube',
        clicks: ytClicks,
        linkCount: ytVideos.length,
      })
    }
    // Then each blog bucket, descending by clicks.
    Array.from(blogBuckets.values())
      .sort((a, b) => b.clicks - a.clicks)
      .forEach(b => groups.push({
        name: b.label,
        kind: 'blog',
        clicks: b.clicks,
        linkCount: b.linkCount,
      }))

    return NextResponse.json({
      connected: true,
      totals,
      posts: postRows.slice(0, 25),
      groups,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
