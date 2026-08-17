/**
 * GET /api/cron/refresh-wp-post-counts
 *
 * Vercel cron worker. Walks every user with a connected WP site,
 * pulls their post count via the WP REST X-WP-Total header, and
 * caches it on integrations.wp_post_count.
 *
 * Why: the dashboard layout used to do this fetch on every page load,
 * costing 300ms-2.5s per non-admin nav. Now the layout reads from
 * the cached column and only falls back to a live fetch when the
 * cache is missing or >24h stale.
 *
 * Schedule: once a day is fine — the 500-post Buying Guides threshold
 * is a slow-moving signal. Set in vercel.json.
 *
 * Auth: same CRON_SECRET bearer header as every other cron worker.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 300

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  // Pull WP-connected integrations, STALEST cache first (nulls = never
  // refreshed) so successive daily runs rotate through everyone. Without the
  // ordering the default row order meant the same first-500 refreshed every run
  // and the tail past 500 never updated once the base grew beyond 500 sites.
  // Capped at 500/run so a huge base doesn't OOM the function.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = await admin
    .from('integrations')
    .select('user_id,wordpress_url')
    .not('wordpress_url', 'is', null)
    .order('wp_post_count_updated_at', { ascending: true, nullsFirst: true })
    .limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let updated = 0
  let failed = 0
  const results = await Promise.allSettled(
    ((rows ?? []) as Array<{ user_id: string; wordpress_url: string | null }>).map(async (row) => {
      if (!row.wordpress_url) return null
      try {
        const wpBase = row.wordpress_url.replace(/\/+$/, '')
        const res = await fetch(`${wpBase}/wp-json/wp/v2/posts?per_page=1&_fields=id`, {
          signal: AbortSignal.timeout(5000),
          headers: { Accept: 'application/json' },
        })
        if (!res.ok) {
          failed++
          return null
        }
        const total = parseInt(res.headers.get('x-wp-total') || '0', 10)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any)
          .from('integrations')
          .update({ wp_post_count: total, wp_post_count_updated_at: new Date().toISOString() })
          .eq('user_id', row.user_id)
        updated++
        return { user_id: row.user_id, total }
      } catch {
        failed++
        return null
      }
    }),
  )

  return NextResponse.json({
    ok: true,
    scanned: (rows ?? []).length,
    updated,
    failed,
    sample: results.slice(0, 5).map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean),
  })
}
