/**
 * GET /api/admin/cron-stats
 *
 * Returns the queue snapshot used by /admin/cron — count by status, last
 * successful tick time, rows stuck in `processing` >5min, recent failures
 * with error messages.
 *
 * Why admin-only: the data spans every user's schedule rows, exposes
 * other-user blog ids, and shows raw error messages that can leak stack
 * traces. Service-role queries via the user's session would bypass RLS,
 * so we explicitly require tier='admin' before serving anything.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface SchedRow {
  id: string
  user_id: string
  blog_post_id: string | null
  platform: string | null
  scheduled_at: string
  status: string
  attempts: number | null
  claimed_at: string | null
  last_attempt_at: string | null
  error_message: string | null
  updated_at: string | null
  created_at: string
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Tier gate — read the caller's tier from integrations.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tierRow } = await supabase
    .from('integrations')
    .select('tier')
    .eq('user_id', user.id)
    .maybeSingle()
  if (tierRow?.tier !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const admin = createAdminClient()
  const now = Date.now()
  const fiveMinAgo = new Date(now - 5 * 60_000).toISOString()
  const oneDayAgo = new Date(now - 24 * 60 * 60_000).toISOString()

  // Pull all rows we care about in one shot — bounded by the 24h+ window
  // so the query stays cheap even on a busy queue.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: recent, error } = await (admin as any)
    .from('scheduled_posts')
    .select('id,user_id,blog_post_id,platform,scheduled_at,status,attempts,claimed_at,last_attempt_at,error_message,updated_at,created_at')
    .or(`status.eq.pending,status.eq.processing,updated_at.gte.${oneDayAgo}`)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows: SchedRow[] = (recent ?? []) as SchedRow[]

  // Counts by status — pending/processing reflect "right now"; the
  // completed/failed counts are the 24h window so the dashboard
  // shows recent throughput, not all-time history.
  const counts = {
    pending: 0,
    processing: 0,
    completed_24h: 0,
    failed_24h: 0,
    cancelled_24h: 0,
  }
  // Stuck rows — `processing` for >5min likely means the cron tick that
  // claimed them errored mid-flight and never wrote back a completed/
  // failed status. These rows block their slot until manually moved.
  const stuck: SchedRow[] = []
  // Last 20 failures across all users — for the "what's broken right now"
  // view at the top of the dashboard.
  const recentFailures: SchedRow[] = []

  for (const r of rows) {
    if (r.status === 'pending') counts.pending++
    else if (r.status === 'processing') {
      counts.processing++
      if (r.claimed_at && r.claimed_at < fiveMinAgo) stuck.push(r)
    } else if (r.status === 'completed') counts.completed_24h++
    else if (r.status === 'failed') {
      counts.failed_24h++
      if (recentFailures.length < 20) recentFailures.push(r)
    } else if (r.status === 'cancelled') counts.cancelled_24h++
  }

  // Last successful tick — the latest updated_at on a completed row is a
  // strong proxy for "cron is healthy and processing". If this is more
  // than ~3 minutes ago AND there are pending rows due, the cron is
  // probably broken.
  const lastCompletedAt =
    rows.find(r => r.status === 'completed' && r.updated_at)?.updated_at ?? null

  // Next-due-pending — when's the soonest pending row scheduled to fire?
  // Combined with lastCompletedAt this answers "should the cron be
  // claiming something right now?"
  let nextDuePending: string | null = null
  for (const r of rows) {
    if (r.status === 'pending') {
      if (!nextDuePending || r.scheduled_at < nextDuePending) nextDuePending = r.scheduled_at
    }
  }

  return NextResponse.json({
    counts,
    lastCompletedAt,
    nextDuePending,
    stuckCount: stuck.length,
    stuck: stuck.slice(0, 20),
    recentFailures,
    sampledAt: new Date().toISOString(),
  })
}
