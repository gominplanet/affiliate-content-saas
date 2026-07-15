/**
 * GET /api/cron/heal-thumbnails
 *
 * Scheduled auto-heal for posts that published WITHOUT a featured thumbnail
 * because the host was rejecting WP media uploads (blog_posts.thumbnail_blocked,
 * migration 177). Finds every user with blocked posts and re-attaches their
 * thumbnails — so the moment a site can accept uploads again (host firewall
 * fixed, or the plugin auto-updates to v1.0.69 which routes media through the
 * body-auth proxy), the backlog heals itself with zero user action.
 *
 * Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Bounded on purpose: caps users/run, the per-owner heal caps posts + has a
 * circuit breaker (stops after a few failures on a still-blocked site), and the
 * shared WordPressService paces writes. A site still blocking uploads is poked
 * a few times, not hammered; healed posts clear the marker and drop out next
 * run, so the working set shrinks to zero.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reattachThumbnailsForOwner } from '@/lib/reattach-thumbnails'

export const maxDuration = 300

const MAX_USERS_PER_RUN = 15

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set on server' }, { status: 500 })
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  // Distinct owners with at least one blocked post. Drift-safe: if migration
  // 177 isn't applied, the column read errors → nothing to do.
  let ownerIds: string[] = []
  try {
    const { data, error } = await admin
      .from('blog_posts')
      .select('user_id')
      .eq('thumbnail_blocked', true)
      .limit(3000)
    if (error) throw error
    const ids = ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)
    ownerIds = [...new Set(ids)].slice(0, MAX_USERS_PER_RUN)
  } catch {
    return NextResponse.json({ ok: true, skipped: 'thumbnail_blocked column not present or unreadable' })
  }

  const results: Array<{ ownerId: string; fixed?: number; stillBlocked?: number; error?: string }> = []
  for (const ownerId of ownerIds) {
    try {
      const r = await reattachThumbnailsForOwner(admin, ownerId, { limit: 40 })
      results.push({ ownerId, fixed: r.fixed, stillBlocked: r.stillBlocked })
    } catch (e) {
      results.push({ ownerId, error: (e instanceof Error ? e.message : String(e)).slice(0, 140) })
    }
  }

  const totalFixed = results.reduce((s, r) => s + (r.fixed ?? 0), 0)
  const totalStillBlocked = results.reduce((s, r) => s + (r.stillBlocked ?? 0), 0)
  return NextResponse.json({ ok: true, users: ownerIds.length, totalFixed, totalStillBlocked, results })
}
