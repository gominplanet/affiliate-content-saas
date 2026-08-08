/**
 * GET /api/cron/process-deal-schedules
 *
 * Vercel cron worker (every minute). Fires due Deal Radar quick posts that were
 * scheduled from the "Quick post to socials" modal. Publishes through the exact
 * same path as an immediate quick post (lib/deal-quick-post).
 *
 * The deal-ended guard: executeDealQuickPost is called with requireLiveDeal, so
 * if the ASIN has rotated out of deal_radar_cache by fire time (the deal is over)
 * the row is marked 'skipped' and nothing goes out. You never promote a dead deal.
 *
 * Auth: Vercel cron requests carry `Authorization: Bearer ${CRON_SECRET}`.
 * Concurrency: an atomic UPDATE claims pending+due rows to 'processing' first.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier, type Tier } from '@/lib/tier'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { executeDealQuickPost } from '@/lib/deal-quick-post'
import { QUICK_POST_PLATFORMS, type QuickPostPlatform } from '@/lib/deal-social-publish'
import { getDeadChannels, shouldSkipChannel, type DeadChannel } from '@/lib/channel-health'

export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_PER_TICK = 20

interface DealScheduleRow {
  id: string
  user_id: string
  asin: string
  title: string | null
  image_url: string | null
  platforms: string[] | null
  story: boolean | null
  caption: string | null
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set on server' }, { status: 500 })
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  // Stuck-claim recovery: rows stuck in 'processing' for >5 min were claimed by a
  // tick that died mid-publish. Flip them back to 'pending' so this tick retries.
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('deal_scheduled_posts')
    .update({ status: 'pending', updated_at: nowIso })
    .eq('status', 'processing').lt('claimed_at', fiveMinAgo)

  // Atomic claim — flip due+pending rows to 'processing' in one update.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: claimed, error: claimErr } = await (admin as any)
    .from('deal_scheduled_posts')
    .update({ status: 'processing', claimed_at: nowIso, updated_at: nowIso })
    .eq('status', 'pending')
    .lte('scheduled_at', nowIso)
    .select('id,user_id,asin,title,image_url,platforms,story,caption')
    .limit(MAX_PER_TICK)

  if (claimErr) return NextResponse.json({ error: `Claim failed: ${claimErr.message}` }, { status: 500 })
  const rows = (claimed ?? []) as DealScheduleRow[]
  if (rows.length === 0) return NextResponse.json({ ok: true, processed: 0 })

  // Dead-channel guard (audit #10) — mirror process-scheduled. Look up each
  // affected user's dead channels once, then drop dead platforms from each row so
  // we don't keep hammering a connection we already know is broken. One real
  // attempt/day still slips through (shouldSkipChannel), so reconnecting resumes
  // publishing on its own.
  const userIds = [...new Set(rows.map(r => r.user_id))]
  const deadByUser = new Map<string, DeadChannel[]>()
  await Promise.all(userIds.map(async (uid) => {
    deadByUser.set(uid, await getDeadChannels(admin, uid, { requireConnected: false }))
  }))
  const isDead = (uid: string, platform: string): boolean => {
    const d = (deadByUser.get(uid) || []).find(x => x.platform === platform)
    return !!d && shouldSkipChannel(d)
  }

  const results = await Promise.allSettled(rows.map(async (row) => {
    try {
      // The user's tag + geniuslink creds + tier — decrypt like every cron path.
      const { data: intRaw } = await admin
        .from('integrations')
        .select('tier,amazon_associates_tag,geniuslink_api_key,geniuslink_api_secret')
        .eq('user_id', row.user_id).maybeSingle()
      const intRow = decryptIntegrationRow(intRaw) as {
        tier?: string | null; amazon_associates_tag?: string | null
        geniuslink_api_key?: string | null; geniuslink_api_secret?: string | null
      } | null
      const tier = normalizeTier(intRow?.tier) as Tier

      const requested = (Array.isArray(row.platforms) ? row.platforms : [])
        .filter((p): p is QuickPostPlatform => QUICK_POST_PLATFORMS.includes(p as QuickPostPlatform))
      const platforms = requested.filter(p => !isDead(row.user_id, p))
      // Every requested channel is currently dead → skip the row entirely rather
      // than fire a guaranteed-failing post. Tagged so it never counts toward the
      // dead-channel streak (which would keep the channel dead forever).
      if (requested.length > 0 && platforms.length === 0) {
        await (admin as any).from("deal_scheduled_posts").update({
          status: 'skipped',
          error_message: '[auto-skipped] Connected channel(s) need reconnecting — not sent.',
          updated_at: new Date().toISOString(),
        }).eq('id', row.id)
        return { id: row.id, status: 'skipped' as const }
      }

      const out = await executeDealQuickPost({
        db: admin, userId: row.user_id, tier, intRow,
        asin: row.asin, platforms, story: row.story === true,
        caption: row.caption ?? undefined, title: row.title, imageUrl: row.image_url,
        requireLiveDeal: true,
      })

      // Deal ended before fire time → skip, don't post a dead deal.
      if (out.dealEnded && out.results.length === 0) {
        await (admin as any).from("deal_scheduled_posts").update({
          status: 'skipped',
          error_message: 'Deal was no longer live at post time — not sent.',
          updated_at: new Date().toISOString(),
        }).eq('id', row.id)
        return { id: row.id, status: 'skipped' as const }
      }
      if (out.missingTag) {
        await (admin as any).from("deal_scheduled_posts").update({
          status: 'failed',
          error_message: 'No Amazon Associates tag on file at post time.',
          updated_at: new Date().toISOString(),
        }).eq('id', row.id)
        return { id: row.id, status: 'failed' as const }
      }

      const anyOk = out.results.some((r) => r.ok)
      await (admin as any).from("deal_scheduled_posts").update({
        status: anyOk ? 'completed' : 'failed',
        results: out.results,
        error_message: anyOk ? null : (out.results.find((r) => !r.ok)?.error || 'All platforms failed').slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      return { id: row.id, status: anyOk ? ('completed' as const) : ('failed' as const) }
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500)
      console.error('[cron/process-deal-schedules] publish failed', { id: row.id, error: msg })
      await (admin as any).from("deal_scheduled_posts").update({
        status: 'failed', error_message: msg, updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      return { id: row.id, status: 'failed' as const }
    }
  }))

  const flat = results.map((r) => r.status === 'fulfilled' ? r.value : { id: 'unknown', status: 'failed' as const })
  return NextResponse.json({ ok: true, processed: rows.length, results: flat })
}
