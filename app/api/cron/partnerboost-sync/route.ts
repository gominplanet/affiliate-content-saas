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
    //
    // THE FAILED ACCOUNTS ARE LEFT OUT IN THE QUERY, not after it. Every row of
    // one user shares its synced_at, so one account with 500 cached products
    // filled the whole page; when that account had just failed, nobody else
    // was in the page to fall back to and the sync stood still for 12 hours.
    const { data: fails } = await sb.from('system_flags').select('key, updated_at')
      .like('key', 'pb_sync_failed:%').gte('updated_at', new Date(Date.now() - 12 * 3600_000).toISOString())
    const recentFail = [...new Set(((fails ?? []) as Array<{ key: string }>).map((f) => f.key.slice('pb_sync_failed:'.length)))]
      .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    let q = sb.from('pb_finder_cache').select('user_id, synced_at').order('synced_at', { ascending: true }).limit(1)
    if (recentFail.length) q = q.not('user_id', 'in', `(${recentFail.join(',')})`)
    const { data: rows } = await q
    const oldest = ((rows ?? []) as Array<{ user_id: string; synced_at: string }>)[0]
    if (!oldest) return NextResponse.json({ ok: true, skipped: recentFail.length ? 'every stale account failed in the last 12 hours' : 'no synced caches' })
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
      // 200 seconds of the 300: a request already in flight at the deadline
      // can take 30 more, and a retry as a POST 30 after that.
      const r = await syncUserCache(admin, userId, token, { deadlineMs: 200_000 })
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
