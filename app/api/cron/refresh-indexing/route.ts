/**
 * GET /api/cron/refresh-indexing
 *
 * Daily sweep that refreshes Google Search Console URL Inspection status for
 * every connected user's published posts. Runs without anyone opening the SEO
 * page — so the "Not indexed" worklist stays current and the dashboard always
 * reflects reality.
 *
 * Strategy per user:
 *   - Skip users without GSC connected (no token / no gsc_property).
 *   - Build a candidate list of published posts that are missing a cache row,
 *     stale (>STALE_MS), or known not-yet-indexed. Sort oldest-checked first
 *     so the longest-stale posts get refreshed first; not-yet-indexed posts
 *     ride at the front of that queue (they're the worklist).
 *   - Inspect up to PER_USER_QUOTA URLs per user (well under GSC's 600/day
 *     per-property quota, and keeps the per-tick wall-clock bounded).
 *   - Upsert ONLY the indexing fields on post_seo — performance metrics
 *     (clicks/impressions) are filled by /api/seo/overview on user load.
 *
 * Auth: Vercel cron sends Authorization: Bearer ${CRON_SECRET}. Any request
 * without a matching header is rejected.
 *
 * Schedule (vercel.json): daily — see crons section.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getValidGscToken, inspectUrl } from '@/lib/gsc'

export const maxDuration = 300

// Per-user inspection budget. GSC allows 600 URL inspections/day per property,
// and most users have well under 50 posts — this leaves plenty of headroom for
// the overview route's on-demand refreshes throughout the day.
const PER_USER_QUOTA = 50
const STALE_MS = 24 * 60 * 60 * 1000

export async function GET(request: Request) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  // Users with GSC connected AND WordPress wired (we need wp_url to build the
  // canonical post URL).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: usersRaw } = await supabase
    .from('integrations')
    .select('user_id,gsc_property,wordpress_url')
    .not('gsc_oauth_access_token', 'is', null)
    .not('gsc_property', 'is', null)
    .not('wordpress_url', 'is', null)
  const users = (usersRaw ?? []) as Array<{ user_id: string; gsc_property: string; wordpress_url: string }>

  let totalUsers = 0
  let totalInspected = 0
  let totalRefreshed = 0
  const errors: Array<{ userId: string; msg: string }> = []

  for (const u of users) {
    totalUsers++
    try {
      const token = await getValidGscToken(supabase, u.user_id)
      if (!token) continue
      const wpBase = String(u.wordpress_url).replace(/\/$/, '')

      // Published posts + their existing cache rows.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: postsRaw } = await supabase
        .from('blog_posts')
        .select('id,slug')
        .eq('user_id', u.user_id)
        .not('wordpress_post_id', 'is', null)
        .not('slug', 'is', null)
      const posts = (postsRaw ?? []) as Array<{ id: string; slug: string }>
      if (posts.length === 0) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: cacheRowsRaw } = await supabase
        .from('post_seo')
        .select('post_id,indexed_state,checked_at')
        .eq('user_id', u.user_id)
      const cache = new Map<string, { indexed_state: string | null; checked_at: string | null }>(
        ((cacheRowsRaw ?? []) as Array<{ post_id: string; indexed_state: string | null; checked_at: string | null }>)
          .map(r => [r.post_id, { indexed_state: r.indexed_state, checked_at: r.checked_at }]),
      )

      // Build the candidate list. Each candidate carries its priority key:
      //   - priority 0 = unknown / not-yet-indexed (these are the worklist)
      //   - priority 1 = already indexed (revalidate periodically)
      // Then sort by priority asc, then by `age` desc so the oldest stale rows
      // surface first within each tier.
      const candidates = posts.map(p => {
        const c = cache.get(p.id)
        const checked = c?.checked_at ? new Date(c.checked_at).getTime() : 0
        const age = checked ? Date.now() - checked : Number.POSITIVE_INFINITY
        const priority = c?.indexed_state === 'indexed' ? 1 : 0
        return { post: p, age, priority, url: `${wpBase}/${p.slug}` }
      })
      .filter(c => c.age > STALE_MS) // anything inspected within 24h stays fresh
      .sort((a, b) => a.priority - b.priority || b.age - a.age)
      .slice(0, PER_USER_QUOTA)

      if (candidates.length === 0) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toUpsert: any[] = []
      for (const c of candidates) {
        totalInspected++
        const ins = await inspectUrl(token, u.gsc_property, c.url)
        if (!ins) continue
        const oldState = cache.get(c.post.id)?.indexed_state || null
        const newState = ins.indexed ? 'indexed' : 'not_indexed'
        // Track de-indexing events: stamp dropped_at when a previously-indexed
        // post falls out of the index, and clear it when it comes back. Omitted
        // from the payload when there's no flip, so existing dropped_at values
        // are preserved untouched (PostgREST only updates fields you send).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row: any = {
          post_id: c.post.id,
          user_id: u.user_id,
          url: c.url,
          indexed_state: newState,
          coverage_state: ins.coverageState,
          last_crawl: ins.lastCrawl,
          checked_at: new Date().toISOString(),
        }
        if (oldState === 'indexed' && newState === 'not_indexed') {
          row.dropped_at = new Date().toISOString()
        } else if (newState === 'indexed') {
          row.dropped_at = null
        }
        toUpsert.push(row)
      }

      if (toUpsert.length) {
        // Upsert touches ONLY the indexing fields — performance metrics
        // (seo_score, clicks, impressions, top_queries) are left intact for
        // the overview route to refresh on user load.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('post_seo').upsert(toUpsert, { onConflict: 'post_id' })
        totalRefreshed += toUpsert.length
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push({ userId: u.user_id, msg })
      console.warn('[cron/refresh-indexing] user failed:', u.user_id, msg)
    }
  }

  return NextResponse.json({
    ok: true,
    users: totalUsers,
    inspected: totalInspected,
    refreshed: totalRefreshed,
    ...(errors.length ? { errors } : {}),
  })
}
