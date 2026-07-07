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
    const { data: oldest } = await sb.from('pb_finder_cache')
      .select('user_id, synced_at').order('synced_at', { ascending: true }).limit(1).maybeSingle()
    if (!oldest) return NextResponse.json({ ok: true, skipped: 'no synced caches' })

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

    const r = await syncUserCache(admin, userId, token, { deadlineMs: 260_000 })
    return NextResponse.json({ ok: true, refreshed: userId, ...r })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 })
  }
}
