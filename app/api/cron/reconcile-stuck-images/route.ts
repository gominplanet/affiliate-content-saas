/**
 * GET /api/cron/reconcile-stuck-images
 *
 * Vercel cron worker. Flips blog_posts stuck in images_status='pending' to a
 * terminal 'failed' so the dashboard stops showing an eternal "Images…" spinner.
 *
 * Why this exists: /api/blog/generate sets images_status='pending' before its
 * image pass, which on an interactive request runs inside Vercel's after()
 * callback. Vercel can truncate that callback once the response is sent, killing
 * the process before it writes a terminal 'ready'/'failed'. The row then sits on
 * 'pending' forever. In-code failure paths now write terminal statuses
 * themselves; this cron only catches the process-was-killed case that no
 * in-request code can handle.
 *
 * 20-minute threshold: a healthy image pass finishes in 1-3 minutes; 20 gives
 * wide headroom so we never flip a row whose pass is still legitimately running.
 * The row carries images_status_at (migration 250) stamped when it went pending,
 * so a fresh in-flight row is never mistaken for a stuck one. Rows written before
 * that column exists have a null timestamp and are, by definition, old → flipped.
 *
 * The client renders 'failed' as an actionable "Images failed" state, so this
 * clears the spinner and points the user at the re-roll.
 *
 * Auth: Vercel cron requests carry `Authorization: Bearer ${CRON_SECRET}`.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STUCK_MINUTES = 20

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  // Millisecond-free ISO so the value has no internal '.' that PostgREST's
  // dot-delimited .or() parser could mis-split.
  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')

  // Flip pending rows that went pending >20 min ago (or, for legacy rows written
  // before migration 250, have no timestamp at all and are therefore old).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error, count } = await (admin as any)
    .from('blog_posts')
    .update({ images_status: 'failed' }, { count: 'exact' })
    .eq('images_status', 'pending')
    .or(`images_status_at.lt.${cutoff},images_status_at.is.null`)
    .select('id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    reconciled: count ?? 0,
    ids: (data ?? []).map((r: { id: string }) => r.id),
    cutoff,
  })
}
