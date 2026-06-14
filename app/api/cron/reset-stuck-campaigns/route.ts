/**
 * GET /api/cron/reset-stuck-campaigns
 *
 * Vercel cron worker. Scans the `campaigns` table for rows stuck in
 * `researching` or `generating` for more than 10 minutes and flips
 * them to `failed` with a clear error message.
 *
 * Why this exists: /api/campaigns/generate is long-running (Amazon
 * scrape + Claude web-research + 32k-token blog gen + WordPress
 * publish) and routinely brushes Vercel's 5-min function ceiling.
 * When the function process dies — Vercel kills it, network blip,
 * Anthropic API stall — the inline try/catch never gets to run, so
 * the campaign row stays in `researching` (or `generating`) forever.
 * The UI shows a frozen "RESEARCHING…" pill, the user has no path
 * forward, and the row blocks the "skip if in-flight" dedup so they
 * can't re-trigger it either.
 *
 * 10-minute threshold: a healthy generate finishes inside 3-4 minutes
 * on average, with the slowest legitimate runs near 5. 10 gives 2x
 * headroom over the worst real case before we declare it dead. Users
 * can manually retry a failed row from the UI.
 *
 * Auth: Vercel cron requests carry `Authorization: Bearer ${CRON_SECRET}`.
 * Same convention as /api/cron/process-scheduled.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STUCK_MINUTES = 10

export async function GET(request: Request) {
  // Bearer-token gate — same shape as the other cron routes.
  const auth = request.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString()

  // Don't flip a row that still has an ACTIVE async generation job. The worker
  // deliberately leaves a timed-out job 'running' (the generate function keeps
  // going and may still publish), so a row can sit in 'researching' past 10 min
  // while it's legitimately in flight. Flipping it to 'failed' there shows a
  // false "failed" + Retry, and a user-triggered Retry would double-bill the
  // Opus write. The queue owns recovery for those (stale-reclaim + attempts cap).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: activeJobs } = await (admin as any)
    .from('generation_jobs')
    .select('input')
    .eq('kind', 'campaign')
    .in('status', ['queued', 'running'])
  const activeCampaignIds: string[] = Array.from(new Set(
    (activeJobs ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((j: any) => j?.input?.campaignId)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0),
  ))

  // Atomic update: any row in researching/generating that hasn't been touched
  // in 10+ minutes (and has no active job) gets flipped to failed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (admin as any)
    .from('campaigns')
    .update({
      status: 'failed',
      error_message: `Generation timed out (no progress for ${STUCK_MINUTES}+ minutes). Click Generate again to retry — Amazon scraping and AI research sometimes hang. If it fails twice in a row, try a different ASIN to rule out a product-specific issue.`,
      updated_at: new Date().toISOString(),
    }, { count: 'exact' })
    .in('status', ['researching', 'generating'])
    .lt('updated_at', cutoff)
  if (activeCampaignIds.length) {
    q = q.not('id', 'in', `(${activeCampaignIds.join(',')})`)
  }
  const { data, error, count } = await q.select('id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    reset_count: count ?? 0,
    reset_ids: (data ?? []).map((r: { id: string }) => r.id),
    cutoff,
  })
}
