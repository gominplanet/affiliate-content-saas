/**
 * GET /api/cron/collect-reach — Pulse insights collector.
 *
 * Finds reach_samples rows still 'pending' whose posts are at least a day old
 * (Instagram needs time to accumulate reach), pulls each post's insights, and
 * fills reach/plays/likes/… Then, per user, computes their median reach across
 * all collected samples and writes each row's `lift = reach / median` — so tag
 * performance is measured by how far a post beat the POSTER'S OWN baseline, not
 * by raw view counts (a small account's win counts as much as a big one's).
 *
 * Paced: a bounded batch per run. Rows that fail to resolve get an attempts++
 * and are retried next run; after 5 attempts (or a deleted/inaccessible media)
 * they're marked 'failed' so the queue drains.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMediaInsights } from '@/services/instagram'
import { maybeDecrypt } from '@/lib/secrets'

export const runtime = 'nodejs'
export const maxDuration = 300

const MATURE_HOURS = 24      // let a post accumulate reach before we read it
const MAX_ATTEMPTS = 5
const BATCH = 60             // rows per run

function median(nums: number[]): number | null {
  const xs = nums.filter(n => Number.isFinite(n)).sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const matureBefore = new Date(Date.now() - MATURE_HOURS * 3600_000).toISOString()

  // Pending rows old enough to have real numbers, with a media id to query.
  const { data: pending, error: pErr } = await admin
    .from('reach_samples')
    .select('id,user_id,media_id,reach')
    .eq('status', 'pending')
    .not('media_id', 'is', null)
    .lte('posted_at', matureBefore)
    .order('posted_at', { ascending: true })
    .limit(BATCH)
  if (pErr) return NextResponse.json({ error: `query failed: ${pErr.message}` }, { status: 500 })

  const rows = (pending ?? []) as Array<{ id: string; user_id: string; media_id: string }>
  if (rows.length === 0) return NextResponse.json({ ok: true, collected: 0, note: 'nothing due' })

  // Resolve each user's IG token once.
  const userIds = [...new Set(rows.map(r => r.user_id))]
  const tokenByUser = new Map<string, string | null>()
  {
    const { data: integs } = await admin
      .from('integrations')
      .select('user_id,instagram_access_token')
      .in('user_id', userIds)
    for (const it of (integs ?? []) as Array<{ user_id: string; instagram_access_token: string | null }>) {
      tokenByUser.set(it.user_id, (maybeDecrypt(it.instagram_access_token) as string | undefined) || null)
    }
  }

  let collected = 0, failed = 0, retried = 0
  const touchedUsers = new Set<string>()

  for (const row of rows) {
    const token = tokenByUser.get(row.user_id) || null
    if (!token) {
      // Can't read without a token — count an attempt, retry later, fail eventually.
      await bumpAttempt(admin, row.id)
      retried++
      continue
    }
    const ins = await getMediaInsights({ mediaId: row.media_id, accessToken: token })
    if (!ins || ins.reach == null) {
      // Media may still be processing, or gone. Attempt++ and move on.
      const failedNow = await bumpAttempt(admin, row.id)
      failedNow ? failed++ : retried++
      continue
    }
    await admin.from('reach_samples').update({
      reach: ins.reach,
      plays: ins.plays,
      likes: ins.likes,
      comments: ins.comments,
      saves: ins.saves,
      shares: ins.shares,
      status: 'collected',
      fetched_at: new Date().toISOString(),
    }).eq('id', row.id)
    collected++
    touchedUsers.add(row.user_id)
  }

  // Recompute each touched user's baseline (median reach over ALL their collected
  // samples) and stamp lift on every collected row that doesn't have one yet.
  for (const uid of touchedUsers) {
    const { data: coll } = await admin
      .from('reach_samples')
      .select('id,reach,lift')
      .eq('user_id', uid)
      .eq('status', 'collected')
      .not('reach', 'is', null)
    const all = (coll ?? []) as Array<{ id: string; reach: number; lift: number | null }>
    const med = median(all.map(r => r.reach))
    if (!med || med <= 0) continue
    // Only fill rows missing a lift; existing lifts stay stable (the baseline
    // shifts slowly and we don't want to churn every row every run). Each row
    // gets a different lift (reach/median), so we can't collapse this into one
    // constant UPDATE, but we can run the writes with bounded concurrency
    // instead of one serial round-trip per row (was the batch's wall-clock hog).
    const missing = all.filter(r => r.lift == null)
    const CONC = 10
    for (let i = 0; i < missing.length; i += CONC) {
      await Promise.all(missing.slice(i, i + CONC).map(r =>
        admin.from('reach_samples')
          .update({ account_median_reach: med, lift: r.reach / med })
          .eq('id', r.id),
      ))
    }
  }

  return NextResponse.json({ ok: true, collected, failed, retried, users: touchedUsers.size })
}

/** attempts++ ; mark 'failed' once we hit the ceiling. Returns true if it flipped to failed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bumpAttempt(admin: any, id: string): Promise<boolean> {
  const { data } = await admin.from('reach_samples').select('attempts').eq('id', id).maybeSingle()
  const attempts = ((data?.attempts as number | undefined) ?? 0) + 1
  const failed = attempts >= MAX_ATTEMPTS
  await admin.from('reach_samples')
    .update({ attempts, ...(failed ? { status: 'failed' } : {}) })
    .eq('id', id)
  return failed
}
