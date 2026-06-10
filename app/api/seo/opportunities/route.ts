// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/seo/opportunities
//
// The revenue loop, server side (Phase 2). Joins the two outcome signals the
// app already collects but never acts on — Search Console (position /
// impressions / CTR / clicks per page) and Geniuslink (affiliate-link clicks
// per post) — and runs each post through lib/post-opportunity's classifier so
// the SEO hub can render a prioritised "fix this next" worklist instead of a
// wall of read-only stats.
//
// Cost shape: ONE bulk GSC query for the whole property (dimension=['page']),
// then Geniuslink click lookups ONLY for posts that already pull real search
// clicks — the affiliate click-out signal only matters where there's traffic
// to convert, so this bounds the per-post API calls and keeps the route fast.
//
// Reads are owner-scoped (getAuthAndOwner → ownerId) so a VA sees the parent
// account's posts + integrations, consistent with the Phase 2 resource sweep.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getValidGscToken, querySearchAnalytics } from '@/lib/gsc'
import { createGeniuslinkService } from '@/services/geniuslink'
import {
  classifyPostOpportunity,
  rankOpportunities,
  type PostMetrics,
  type PostOpportunity,
  type OpportunityKind,
} from '@/lib/post-opportunity'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface PostRow {
  id: string
  title: string | null
  wordpress_url: string | null
  geniuslink_code: string | null
  content: string | null
}

interface OpportunityResult {
  postId: string
  title: string
  url: string
  metrics: PostMetrics
  opportunity: PostOpportunity
}

/** GSC data lags ~2–3 days; end the window at today-3, span 28 days back. */
function gscWindow(): { startDate: string; endDate: string } {
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const end = new Date()
  end.setDate(end.getDate() - 3)
  const start = new Date(end)
  start.setDate(start.getDate() - 28)
  return { startDate: fmt(start), endDate: fmt(end) }
}

/** Pull geni.us/CODE out of a post body (same regex as /api/analytics/clicks). */
function extractCode(text: string | null | undefined): string | null {
  if (!text) return null
  const m = text.match(/https?:\/\/(?:www\.)?geni\.us\/([A-Za-z0-9]+)/)
  return m ? m[1] : null
}

/** Normalise a URL for fuzzy matching GSC page keys to our stored permalinks:
 *  drop protocol + leading www + trailing slash, lowercase. Exact match is
 *  tried first; this only catches http/https + www + trailing-slash drift. */
function normUrl(u: string | null | undefined): string {
  if (!u) return ''
  return u
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

const AFFILIATE_LOOKUP_MIN_CLICKS = 5 // only fetch click-out data where there's traffic to convert

export async function GET() {
  try {
    const supabase = await createServerClient()
    const auth = await getAuthAndOwner(supabase)
    if (auth.error) return auth.error
    const { ownerId } = auth

    // ── Integrations: GSC property + Geniuslink creds (owner-scoped) ──────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('gsc_property,geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', ownerId)
      .maybeSingle()

    const gscProperty = (intRow?.gsc_property as string | null) ?? null

    // The worklist is GSC-driven (position/impressions are what make a post
    // "striking distance" or "under-clicked"). Without GSC there's nothing to
    // classify — return a clear connect-prompt state rather than an empty list.
    if (!gscProperty) {
      return NextResponse.json({
        connected: false,
        reason: 'gsc_not_connected',
        message: 'Connect Google Search Console to see ranking opportunities.',
        posts: [],
        summary: { total: 0, byKind: {} },
      })
    }

    let gscToken: string | null = null
    try {
      gscToken = await getValidGscToken(supabase, ownerId)
    } catch {
      gscToken = null
    }
    if (!gscToken) {
      return NextResponse.json({
        connected: false,
        reason: 'gsc_token_expired',
        message: 'Reconnect Search Console — its access token expired.',
        posts: [],
        summary: { total: 0, byKind: {} },
      })
    }

    // ── Published posts (owner-scoped) ────────────────────────────────────────
    const { data: postRaw } = await supabase
      .from('blog_posts')
      .select('id,title,wordpress_url,geniuslink_code,content')
      .eq('user_id', ownerId)
      .eq('status', 'published')
      .limit(500)
    const posts: PostRow[] = (postRaw as PostRow[] | null) ?? []
    const livePosts = posts.filter(p => p.wordpress_url)
    if (livePosts.length === 0) {
      return NextResponse.json({
        connected: true,
        reason: 'no_live_posts',
        message: 'No published posts with a live URL yet.',
        posts: [],
        summary: { total: 0, byKind: {} },
      })
    }

    // ── ONE bulk GSC query over the whole property, matched back by URL ───────
    const { startDate, endDate } = gscWindow()
    const rows = await querySearchAnalytics(gscToken, gscProperty, {
      startDate, endDate, dimensions: ['page'], rowLimit: 1000,
    })
    // Index GSC rows by both exact and normalised URL for resilient matching.
    const byExact = new Map<string, { clicks: number; impressions: number; ctr: number; position: number }>()
    const byNorm = new Map<string, { clicks: number; impressions: number; ctr: number; position: number }>()
    for (const r of rows) {
      const url = r.keys?.[0]
      if (!url) continue
      const stats = { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }
      byExact.set(url, stats)
      byNorm.set(normUrl(url), stats)
    }
    const gscFor = (url: string) => byExact.get(url) ?? byNorm.get(normUrl(url)) ?? null

    // ── Geniuslink click-out, ONLY for posts with real search traffic ─────────
    // Resolve each post's shortcode (column first, body-scrape fallback), then
    // fetch clicks only where GSC search clicks ≥ threshold. affiliateClicks
    // stays null for everything else (classifier reads null as "unmeasured").
    const hasGenius = Boolean(intRow?.geniuslink_api_key && intRow?.geniuslink_api_secret)
    const codeByPost = new Map<string, string>()
    for (const p of livePosts) {
      const code = p.geniuslink_code || extractCode(p.content)
      if (code) codeByPost.set(p.id, code)
    }

    const affiliateClicksByCode = new Map<string, number>()
    if (hasGenius) {
      // Which codes do we actually need? Only those on posts with ≥ threshold
      // search clicks — dedupe codes (a post can share a code with its video).
      const codesToFetch = new Set<string>()
      for (const p of livePosts) {
        const stats = gscFor(p.wordpress_url!)
        const code = codeByPost.get(p.id)
        if (code && stats && stats.clicks >= AFFILIATE_LOOKUP_MIN_CLICKS) codesToFetch.add(code)
      }
      const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
      const unique = Array.from(codesToFetch)
      const CONCURRENCY = 8
      for (let i = 0; i < unique.length; i += CONCURRENCY) {
        const batch = unique.slice(i, i + CONCURRENCY)
        const series = await Promise.all(
          batch.map(code => genius.getDailyClicks(code, 28).catch(() => [] as Array<{ date: string; clicks: number }>)),
        )
        batch.forEach((code, idx) => {
          affiliateClicksByCode.set(code, series[idx].reduce((s, d) => s + d.clicks, 0))
        })
      }
    }

    // ── Classify every live post ──────────────────────────────────────────────
    const results: OpportunityResult[] = livePosts.map(p => {
      const stats = gscFor(p.wordpress_url!)
      const code = codeByPost.get(p.id)
      // affiliateClicks: a number only when we fetched it (post had traffic AND
      // a matched code); null otherwise so the classifier doesn't false-positive
      // a "no click-out" on posts we never measured.
      const affiliateClicks = (hasGenius && code && affiliateClicksByCode.has(code))
        ? affiliateClicksByCode.get(code)!
        : null
      const metrics: PostMetrics = {
        position: stats?.position ?? null,
        impressions: stats?.impressions ?? 0,
        searchClicks: stats?.clicks ?? 0,
        ctr: stats?.ctr ?? 0,
        affiliateClicks,
        indexed: null, // v1: impressions proxy for indexed; URL-inspection wiring is a follow-up
      }
      return {
        postId: p.id,
        title: p.title ?? '',
        url: p.wordpress_url!,
        metrics,
        opportunity: classifyPostOpportunity(metrics),
      }
    })

    // Rank by priority; drop the pure-noise rows ('no_data') from the worklist
    // but keep them counted in the summary so the user knows coverage.
    const ranked = rankOpportunities(results)
    const worklist = ranked.filter(r => r.opportunity.kind !== 'no_data')

    const byKind = ranked.reduce((acc, r) => {
      acc[r.opportunity.kind] = (acc[r.opportunity.kind] ?? 0) + 1
      return acc
    }, {} as Record<OpportunityKind, number>)

    return NextResponse.json({
      connected: true,
      geniuslink: hasGenius,
      window: { startDate, endDate },
      summary: { total: worklist.length, byKind },
      posts: worklist.slice(0, 100),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
