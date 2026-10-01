/**
 * GET /api/cron/partnerboost-sync — keep users' PartnerBoost Finder caches fresh.
 *
 * The PB Finder cache (pb_finder_cache) is per-user and takes minutes to build,
 * so we refresh ONE user per tick — the one whose cache is oldest, and only if
 * it's gone stale (> STALE_HOURS). Runs every 30 min (vercel.json), so up to ~48
 * users/day get auto-refreshed. Only users who've synced at least once are in
 * the cache, so this only maintains opted-in catalogs; new users still do their
 * first sync manually.
 *
 * Auth: Vercel cron sends Authorization: Bearer ${CRON_SECRET}.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getExternalKey } from '@/lib/external-keys'
import { syncUserCache } from '@/lib/partnerboost-sweep'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const STALE_HOURS = 20

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = admin as any

    // Oldest cache globally — a user's rows all share one synced_at, so this row
    // identifies the most-stale user.
    // ONE FAILING ACCOUNT MUST NOT HOLD THE QUEUE. A refused token (or a run
    // out of time) left that user's rows the oldest, so they were picked every
    // half hour and nobody else ever refreshed. A failure is remembered for 12
    // hours (system_flags) and the next oldest user is taken; the cache's own
    // synced_at is not touched, so its "last refreshed" stays true.
    const { data: rows } = await sb.from('pb_finder_cache')
      .select('user_id, synced_at').order('synced_at', { ascending: true }).limit(500)
    if (!rows?.length) return NextResponse.json({ ok: true, skipped: 'no synced caches' })
    const users: Array<{ user_id: string; synced_at: string }> = []
    for (const r of rows as Array<{ user_id: string; synced_at: string }>) if (!users.some((u) => u.user_id === r.user_id)) users.push(r)
    const { data: fails } = await sb.from('system_flags').select('key, updated_at').in('key', users.map((u) => `pb_sync_failed:${u.user_id}`))
    const recentFail = new Set(((fails ?? []) as Array<{ key: string; updated_at: string }>)
      .filter((f) => Date.now() - Date.parse(f.updated_at) < 12 * 3600_000).map((f) => f.key.slice('pb_sync_failed:'.length)))
    const oldest = users.find((u) => !recentFail.has(u.user_id))
    if (!oldest) return NextResponse.json({ ok: true, skipped: 'every stale account failed in the last 12 hours' })
    const markFailed = (uid: string) => sb.from('system_flags').upsert({ key: `pb_sync_failed:${uid}`, active: true, updated_at: new Date().toISOString() }, { onConflict: 'key' })

    const ageMs = Date.now() - new Date(oldest.synced_at).getTime()
    if (ageMs < STALE_HOURS * 3600_000) {
      return NextResponse.json({ ok: true, skipped: 'freshest-stale still recent', oldestSyncedAt: oldest.synced_at })
    }

    const userId = oldest.user_id as string
    const token = await getExternalKey(admin, userId, 'partnerboost')
    if (!token) {
      // Key removed — bump the timestamp so we don't re-pick this user every tick.
      await sb.from('pb_finder_cache').update({ synced_at: new Date().toISOString() }).eq('user_id', userId)
      return NextResponse.json({ ok: true, skipped: 'no token for stale user', userId })
    }

    try {
      const r = await syncUserCache(admin, userId, token, { deadlineMs: 260_000 })
      if ((r as { timedOut?: boolean }).timedOut) await markFailed(userId)
      return NextResponse.json({ ok: true, refreshed: userId, ...r })
    } catch (e) {
      await markFailed(userId)
      return NextResponse.json({ ok: false, user: userId, error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 })
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 })
  }
}
