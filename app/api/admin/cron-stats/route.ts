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

  // Bounded, index-friendly queries run in parallel — replaces the old
  // `OR(status... , updated_at>=24h) LIMIT 500` pull + JS count loop (which
  // forced a wide scan and shipped up to 500 rows every 30s). Status counts
  // use head-only COUNTs (no rows transferred); the display lists are small,
  // ordered, limited fetches. Completed/failed/cancelled are scoped to the 24h
  // window so the dashboard shows recent throughput, not all-time history.
  const COLS = 'id,user_id,blog_post_id,platform,scheduled_at,status,attempts,claimed_at,last_attempt_at,error_message,updated_at,created_at'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = admin as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const countOf = (build: (q: any) => any) =>
    build(a.from('scheduled_posts').select('id', { count: 'exact', head: true }))

  const [
    pendingC, processingC, completedC, failedC, cancelledC,
    stuckCountRes, stuckRowsRes, failuresRes, lastCompletedRes, nextPendingRes,
  ] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    countOf((q: any) => q.eq('status', 'pending')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    countOf((q: any) => q.eq('status', 'processing')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    countOf((q: any) => q.eq('status', 'completed').gte('updated_at', oneDayAgo)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    countOf((q: any) => q.eq('status', 'failed').gte('updated_at', oneDayAgo)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    countOf((q: any) => q.eq('status', 'cancelled').gte('updated_at', oneDayAgo)),
    // Stuck = processing claimed >5min ago. Full count + a small display slice.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    countOf((q: any) => q.eq('status', 'processing').lt('claimed_at', fiveMinAgo)),
    a.from('scheduled_posts').select(COLS)
      .eq('status', 'processing').lt('claimed_at', fiveMinAgo)
      .order('claimed_at', { ascending: true, nullsFirst: false }).limit(20),
    a.from('scheduled_posts').select(COLS)
      .eq('status', 'failed').gte('updated_at', oneDayAgo)
      .order('updated_at', { ascending: false, nullsFirst: false }).limit(20),
    a.from('scheduled_posts').select('updated_at')
      .eq('status', 'completed')
      .order('updated_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    a.from('scheduled_posts').select('scheduled_at')
      .eq('status', 'pending')
      .order('scheduled_at', { ascending: true }).limit(1).maybeSingle(),
  ])

  const counts = {
    pending: pendingC.count ?? 0,
    processing: processingC.count ?? 0,
    completed_24h: completedC.count ?? 0,
    failed_24h: failedC.count ?? 0,
    cancelled_24h: cancelledC.count ?? 0,
  }
  const stuck = (stuckRowsRes.data ?? []) as SchedRow[]
  const recentFailures = (failuresRes.data ?? []) as SchedRow[]

  return NextResponse.json({
    counts,
    // Latest completed updated_at — a strong proxy for "cron is healthy".
    lastCompletedAt: lastCompletedRes.data?.updated_at ?? null,
    // Soonest pending scheduled_at — "should the cron be claiming now?"
    nextDuePending: nextPendingRes.data?.scheduled_at ?? null,
    stuckCount: stuckCountRes.count ?? stuck.length,
    stuck,
    recentFailures,
    sampledAt: new Date().toISOString(),
  })
}
