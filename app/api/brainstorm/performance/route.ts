/**
 * GET /api/brainstorm/performance
 *
 * Aggregator for the Brainstorm page (Phase 1). Pulls 90-day performance
 * snapshots across the user's YouTube + WordPress universe and returns a
 * single JSON the page can render directly + the assistant can ingest
 * as context for "what should I make next" coaching.
 *
 * Sources (each best-effort — missing OAuth / no data → empty section
 * rather than a hard error, so a user who only has blog data still sees
 * the blog half):
 *
 *   - youtube_videos table (synced via /api/youtube/sync). Top + bottom
 *     by view_count. We don't re-fetch from YT here; sync is idempotent
 *     and cheap, so the dashboard nudges users to Sync first when this
 *     section looks stale.
 *
 *   - blog_posts table. Filters to status='published' so drafts don't
 *     dilute the signal.
 *
 *   - Search Console (per-page search analytics) for clicks/impressions
 *     of the top published blog URLs over the last 90d. Skipped when
 *     GSC isn't connected or no gsc_property is set.
 *
 *   - brand_profiles.niches for niche tagging on the post side; YouTube
 *     videos are tagged by detected ASIN → category lookup on the
 *     `creator_connections_catalog` rows we already have.
 *
 * All "what's working" math is computed server-side so the page is
 * dumb-render (no client-side aggregation). Response shape is stable —
 * the brainstorm prompt builder in the page reads specific keys.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getValidGscToken, querySearchAnalytics } from '@/lib/gsc'
import { getAuthAndOwner } from '@/lib/agency-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface YouTubeVideoRow {
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  published_at: string | null
  view_count: number | null
  duration_seconds: number | null
  is_vertical: boolean | null
}

interface BlogPostRow {
  id: string
  title: string
  asin: string | null
  niches: string[] | null
  post_type: string | null
  permalink: string | null
  published_at: string | null
}

/** 90-day cutoff used everywhere on this page. */
function ninetyDaysAgo(): string {
  return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
}

/** Format a 90d window for Search Console (YYYY-MM-DD strings). */
function gscWindow(): { startDate: string; endDate: string } {
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const end = new Date()
  const start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  return { startDate: fmt(start), endDate: fmt(end) }
}

export async function GET() {
  const supabase = await createServerClient()
  // 2026-06-09 Phase 2 (VA): brainstorm performance aggregates owner's
  // YouTube + blog + GSC data so a VA's brainstorm coaching sees the same
  // workspace as the owner.
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const cutoff = ninetyDaysAgo()

  // ── 1. YouTube videos (last 90d) ────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ytRaw } = await (supabase as any)
    .from('youtube_videos')
    .select('youtube_video_id,title,thumbnail_url,published_at,view_count,duration_seconds,is_vertical')
    .eq('user_id', ownerId)
    .gte('published_at', cutoff)
    .order('view_count', { ascending: false, nullsFirst: false })
    .limit(50)
  const ytAll: YouTubeVideoRow[] = (ytRaw as YouTubeVideoRow[] | null) ?? []

  // Split top / bottom and compute simple averages. Bottom = lowest views
  // among videos that had a fair shake (older than 14d so a brand-new
  // post doesn't show up as "underperforming" before YT has even ranked
  // it).
  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000
  const ytMatured = ytAll.filter(v => v.published_at && new Date(v.published_at).getTime() < fourteenDaysAgo)
  const ytTop = ytAll.slice(0, 5)
  const ytBottom = [...ytMatured]
    .sort((a, b) => (a.view_count ?? 0) - (b.view_count ?? 0))
    .slice(0, 5)
  const ytAvgViews = ytAll.length > 0
    ? Math.round(ytAll.reduce((sum, v) => sum + (v.view_count ?? 0), 0) / ytAll.length)
    : 0

  // ── 2. Blog posts (last 90d) ────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: postRaw } = await (supabase as any)
    .from('blog_posts')
    .select('id,title,asin,niches,post_type,permalink,published_at')
    .eq('user_id', ownerId)
    .eq('status', 'published')
    .gte('published_at', cutoff)
    .order('published_at', { ascending: false })
    .limit(50)
  const posts: BlogPostRow[] = (postRaw as BlogPostRow[] | null) ?? []

  // ── 3. Search Console clicks/impressions for the top posts ──────────────
  // Skipped silently if GSC isn't connected. We query per-page so the row
  // limit is fine; one round trip with dimension=['page'] for the full
  // property would also work but burns more rows for posts we don't
  // surface here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations')
    .select('gsc_property')
    .eq('user_id', ownerId)
    .maybeSingle()
  const gscProperty = (intRow?.gsc_property as string | null) ?? null

  let gscToken: string | null = null
  if (gscProperty) {
    try {
      gscToken = await getValidGscToken(supabase, ownerId)
    } catch {
      // GSC connected but token refresh failed — silently skip the section.
      gscToken = null
    }
  }

  const postsWithStats: Array<BlogPostRow & {
    clicks: number
    impressions: number
    ctr: number
    position: number
  }> = []
  if (gscToken && gscProperty) {
    const { startDate, endDate } = gscWindow()
    // Single bulk query over all pages on the property; then we match
    // back to our posts by URL. Way cheaper than N round trips.
    const rows = await querySearchAnalytics(gscToken, gscProperty, {
      startDate, endDate, dimensions: ['page'], rowLimit: 100,
    })
    const byPage = new Map<string, { clicks: number; impressions: number; ctr: number; position: number }>()
    for (const row of rows) {
      const url = row.keys?.[0]
      if (!url) continue
      byPage.set(url, { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position })
    }
    for (const p of posts) {
      const stats = p.permalink ? byPage.get(p.permalink) : undefined
      postsWithStats.push({
        ...p,
        clicks: stats?.clicks ?? 0,
        impressions: stats?.impressions ?? 0,
        ctr: stats?.ctr ?? 0,
        position: stats?.position ?? 0,
      })
    }
  } else {
    // No GSC — return posts with zeroed stats so the page can still show
    // them grouped by niche / publish date.
    for (const p of posts) {
      postsWithStats.push({ ...p, clicks: 0, impressions: 0, ctr: 0, position: 0 })
    }
  }

  // Top / bottom by clicks. Posts with 0 clicks AND 0 impressions are
  // excluded from "bottom" because no signal = no judgment yet.
  const postsRanked = [...postsWithStats].sort((a, b) => b.clicks - a.clicks)
  const postsTop = postsRanked.slice(0, 5)
  const postsMatured = postsWithStats.filter(p => p.impressions > 0)
  const postsBottom = [...postsMatured].sort((a, b) => a.ctr - b.ctr).slice(0, 5)

  // ── 4. Niche performance grid ───────────────────────────────────────────
  // Group posts by niche tag, sum clicks + impressions, compute avg CTR.
  // Only counts posts that have niche tags set on the blog_posts row.
  const nichePerf = new Map<string, { postCount: number; clicks: number; impressions: number }>()
  for (const p of postsWithStats) {
    const tags = p.niches ?? []
    for (const tag of tags) {
      const entry = nichePerf.get(tag) ?? { postCount: 0, clicks: 0, impressions: 0 }
      entry.postCount += 1
      entry.clicks += p.clicks
      entry.impressions += p.impressions
      nichePerf.set(tag, entry)
    }
  }
  const niches = Array.from(nichePerf.entries())
    .map(([niche, v]) => ({
      niche,
      postCount: v.postCount,
      totalClicks: v.clicks,
      totalImpressions: v.impressions,
      avgCtr: v.impressions > 0 ? v.clicks / v.impressions : 0,
    }))
    .sort((a, b) => b.totalClicks - a.totalClicks)

  // ── 5. Coverage gaps — niches the user CLAIMS to cover on their brand
  //      profile but has 0 published posts for in the window. Useful
  //      "you said you do X but never made content for X" signal. ─────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brandRow } = await (supabase as any)
    .from('brand_profiles')
    .select('niches')
    .eq('user_id', ownerId)
    .maybeSingle()
  const claimedNiches = ((brandRow?.niches as string[] | null) ?? [])
  const coveredNiches = new Set(niches.map(n => n.niche))
  const uncoveredNiches = claimedNiches.filter(n => !coveredNiches.has(n))

  return NextResponse.json({
    window: '90d',
    generatedAt: new Date().toISOString(),
    youtube: {
      total: ytAll.length,
      avgViews: ytAvgViews,
      top: ytTop,
      bottom: ytBottom,
    },
    blog: {
      total: posts.length,
      gscConnected: Boolean(gscToken && gscProperty),
      top: postsTop,
      bottom: postsBottom,
    },
    niches: {
      covered: niches,
      uncovered: uncoveredNiches,
    },
  })
}
