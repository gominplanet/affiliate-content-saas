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
import { createYouTubeService } from '@/services/youtube'
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
    .select('id,user_id,media_id,reach,platform')
    .eq('status', 'pending')
    .not('media_id', 'is', null)
    .lte('posted_at', matureBefore)
    .order('posted_at', { ascending: true })
    .limit(BATCH)
  if (pErr) return NextResponse.json({ error: `query failed: ${pErr.message}` }, { status: 500 })

  const rows = (pending ?? []) as Array<{ id: string; user_id: string; media_id: string; platform: string | null }>
  if (rows.length === 0) return NextResponse.json({ ok: true, collected: 0, note: 'nothing due' })

  // Split by platform. Instagram reads per-media reach; YouTube reads public
  // view counts. Legacy rows with a null platform are treated as Instagram.
  const igRows = rows.filter(r => (r.platform ?? 'instagram') === 'instagram')
  const ytRows = rows.filter(r => r.platform === 'youtube')

  let collected = 0, failed = 0, retried = 0
  // Track (user, platform) pairs so baselines are computed WITHIN a platform —
  // YouTube views (thousands) must never share a median with IG reach (hundreds).
  const touched = new Set<string>()

  // ── Instagram: per-media insights (reach) ──────────────────────────────────
  if (igRows.length) {
    const userIds = [...new Set(igRows.map(r => r.user_id))]
    const tokenByUser = new Map<string, string | null>()
    const { data: integs } = await admin
      .from('integrations').select('user_id,instagram_access_token').in('user_id', userIds)
    for (const it of (integs ?? []) as Array<{ user_id: string; instagram_access_token: string | null }>) {
      tokenByUser.set(it.user_id, (maybeDecrypt(it.instagram_access_token) as string | undefined) || null)
    }
    for (const row of igRows) {
      const token = tokenByUser.get(row.user_id) || null
      if (!token) { await bumpAttempt(admin, row.id); retried++; continue }
      const ins = await getMediaInsights({ mediaId: row.media_id, accessToken: token })
      if (!ins || ins.reach == null) { const f = await bumpAttempt(admin, row.id); f ? failed++ : retried++; continue }
      await admin.from('reach_samples').update({
        reach: ins.reach, plays: ins.plays, likes: ins.likes, comments: ins.comments,
        saves: ins.saves, shares: ins.shares, platform: 'instagram',
        status: 'collected', fetched_at: new Date().toISOString(),
      }).eq('id', row.id)
      collected++
      touched.add(`${row.user_id}:instagram`)
    }
  }

  // ── YouTube: public view counts (the reach proxy for Shorts) ────────────────
  if (ytRows.length) {
    const apiKey = process.env.YOUTUBE_API_KEY
    if (!apiKey) {
      for (const row of ytRows) { await bumpAttempt(admin, row.id); retried++ }
    } else {
      const yt = createYouTubeService(apiKey)
      let views: Record<string, number> = {}
      try { views = await yt.getViewCounts(ytRows.map(r => r.media_id)) } catch { views = {} }
      for (const row of ytRows) {
        const v = views[row.media_id]
        if (v == null) { const f = await bumpAttempt(admin, row.id); f ? failed++ : retried++; continue }
        await admin.from('reach_samples').update({
          reach: v, plays: v, status: 'collected', fetched_at: new Date().toISOString(),
        }).eq('id', row.id)
        collected++
        touched.add(`${row.user_id}:youtube`)
      }
    }
  }

  // Baselines: median reach PER (user, platform), lift stamped within platform,
  // only on rows that don't have a lift yet (existing lifts stay stable).
  for (const key of touched) {
    const [uid, platform] = key.split(':')
    const { data: coll } = await admin
      .from('reach_samples')
      .select('id,reach,lift')
      .eq('user_id', uid)
      .eq('platform', platform)
      .eq('status', 'collected')
      .not('reach', 'is', null)
    const all = (coll ?? []) as Array<{ id: string; reach: number; lift: number | null }>
    const med = median(all.map(r => r.reach))
    if (!med || med <= 0) continue
    const missing = all.filter(r => r.lift == null)
    const CONC = 10
    for (let i = 0; i < missing.length; i += CONC) {
      await Promise.all(missing.slice(i, i + CONC).map(r =>
        admin.from('reach_samples').update({ account_median_reach: med, lift: r.reach / med }).eq('id', r.id),
      ))
    }
  }

  const users = new Set([...touched].map(k => k.split(':')[0])).size
  return NextResponse.json({ ok: true, collected, failed, retried, users })
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
