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
import { createAdminClient } from '@/lib/supabase/admin'
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
import { resolvePostAsins } from '@/lib/post-asin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface PostRow {
  id: string
  title: string | null
  wordpress_url: string | null
  geniuslink_code: string | null
  content: string | null
  video_id: string | null
  deal_meta: unknown
}

interface OpportunityResult {
  postId: string
  title: string
  url: string
  metrics: PostMetrics
  opportunity: PostOpportunity
  /** Uploaded Associates commissions attributed to this post's ASIN(s), or
   *  null when untracked / unresolved (revenue loop #249). */
  earningsUsd: number | null
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: postRaw } = await (supabase as any)
      .from('blog_posts')
      .select('id,title,wordpress_url,geniuslink_code,content,video_id,deal_meta')
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

    // ── Ranking-decay history: the stored PEAK position per post (task #249) ──
    // Admin client so a VA can read the owner's post_seo (its RLS is
    // auth.uid()=user_id; we're owner-scoped here). Map post_id → peak position.
    const admin = createAdminClient()
    const bestByPost = new Map<string, number>()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- post_seo.best_position not in generated types until migration 120 + regen
      const { data: seoRows } = await (admin as any)
        .from('post_seo')
        .select('post_id,best_position')
        .eq('user_id', ownerId)
      for (const r of ((seoRows ?? []) as Array<{ post_id: string; best_position: number | null }>)) {
        if (typeof r.best_position === 'number') bestByPost.set(r.post_id, r.best_position)
      }
    } catch { /* pre-migration 120 or read error — decay just won't fire */ }
    const peakUpserts: Array<{ post_id: string; user_id: string; best_position: number; best_position_at: string }> = []
    const nowIso = new Date().toISOString()

    // ── Per-post revenue attribution (revenue loop #249) ──────────────────────
    // Map post → its ASIN(s) → uploaded Associates commissions. earningsByAsin
    // stays empty (earningsTracked=false) until the user uploads an earnings CSV
    // and runs migration 121 — until then every post just shows no $ (no change).
    const earningsByAsin = new Map<string, number>()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- amazon_earnings not in generated types until migration 121 + regen
      const { data: earnRows } = await (admin as any)
        .from('amazon_earnings')
        .select('asin,earnings_usd')
        .eq('user_id', ownerId)
      for (const r of ((earnRows ?? []) as Array<{ asin: string; earnings_usd: number }>)) {
        const asin = (r.asin || '').toUpperCase()
        if (asin) earningsByAsin.set(asin, (earningsByAsin.get(asin) ?? 0) + Number(r.earnings_usd || 0))
      }
    } catch { /* pre-migration 121 — attribution just stays empty */ }
    const earningsTracked = earningsByAsin.size > 0

    // The video's resolved product_url holds a /dp/{ASIN} for Amazon-direct
    // products — load it only when there are actually earnings to attribute.
    const productUrlByVideo = new Map<string, string>()
    if (earningsTracked) {
      const videoIds = Array.from(
        new Set(livePosts.map(p => p.video_id).filter((v): v is string => Boolean(v))),
      )
      if (videoIds.length > 0) {
        try {
          const { data: vids } = await admin
            .from('youtube_videos')
            .select('id,product_url')
            .eq('user_id', ownerId)
            .in('id', videoIds)
          for (const v of ((vids ?? []) as Array<{ id: string; product_url: string | null }>)) {
            if (v.product_url) productUrlByVideo.set(v.id, v.product_url)
          }
        } catch { /* non-fatal — fall back to body-link ASIN extraction */ }
      }
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
      // Merge http/https/www/trailing-slash variants under the normalized key so
      // a duplicate GSC row doesn't clobber the canonical metrics (last-write-wins).
      // Sum clicks+impressions; recompute CTR + impression-weighted avg position.
      const nk = normUrl(url)
      const prev = byNorm.get(nk)
      if (prev) {
        const impressions = prev.impressions + stats.impressions
        const clicks = prev.clicks + stats.clicks
        byNorm.set(nk, {
          clicks,
          impressions,
          ctr: impressions > 0 ? clicks / impressions : 0,
          position: impressions > 0
            ? (prev.position * prev.impressions + stats.position * stats.impressions) / impressions
            : stats.position,
        })
      } else {
        byNorm.set(nk, stats)
      }
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
      const storedBest = bestByPost.get(p.id) ?? null
      const livePos = stats?.position ?? null
      // Track the all-time peak: if the live position beats the stored best (or
      // there's no history yet), record it. The classifier sees the OLD peak, so
      // a dip below it reads as decay; an improvement simply raises the peak.
      if (livePos != null && (storedBest == null || livePos < storedBest)) {
        peakUpserts.push({ post_id: p.id, user_id: ownerId, best_position: livePos, best_position_at: nowIso })
      }
      const metrics: PostMetrics = {
        position: livePos,
        impressions: stats?.impressions ?? 0,
        searchClicks: stats?.clicks ?? 0,
        ctr: stats?.ctr ?? 0,
        affiliateClicks,
        indexed: null, // v1: impressions proxy for indexed; URL-inspection wiring is a follow-up
        bestPosition: storedBest,
      }
      // Attribute uploaded commissions to this post via its resolved ASIN(s).
      let earningsUsd: number | null = null
      if (earningsTracked) {
        const asins = resolvePostAsins({
          dealMeta: p.deal_meta,
          productUrl: p.video_id ? productUrlByVideo.get(p.video_id) ?? null : null,
          content: p.content,
        })
        let sum = 0
        for (const a of asins) sum += earningsByAsin.get(a) ?? 0
        earningsUsd = sum > 0 ? Math.round(sum * 100) / 100 : null
      }
      return {
        postId: p.id,
        title: p.title ?? '',
        url: p.wordpress_url!,
        metrics,
        opportunity: classifyPostOpportunity(metrics),
        earningsUsd,
      }
    })

    // Rank by priority; drop the pure-noise rows ('no_data') from the worklist
    // but keep them counted in the summary so the user knows coverage.
    // Persist improved peaks (fire-and-forget — a failure just delays decay
    // detection, never blocks the response). onConflict = post_id (the PK).
    if (peakUpserts.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- post_seo.best_position not in generated types until migration 120 + regen
      try { await (admin as any).from('post_seo').upsert(peakUpserts, { onConflict: 'post_id' }) } catch { /* non-fatal */ }
    }

    const ranked = rankOpportunities(results)
    const worklist = ranked.filter(r => r.opportunity.kind !== 'no_data')

    const byKind = ranked.reduce((acc, r) => {
      acc[r.opportunity.kind] = (acc[r.opportunity.kind] ?? 0) + 1
      return acc
    }, {} as Record<OpportunityKind, number>)

    return NextResponse.json({
      connected: true,
      geniuslink: hasGenius,
      earningsTracked,
      window: { startDate, endDate },
      summary: { total: worklist.length, byKind },
      posts: worklist.slice(0, 100),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
