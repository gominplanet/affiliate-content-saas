// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/youtube-data-retention (hourly): stored YouTube video data
// older than 30 days is refreshed from YouTube or emptied, and rows emptied
// for creators still connected are refilled (lib/youtube-retention).
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { retentionPass, restorePass } from '@/lib/youtube-retention'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Two thousand rows of serial writes and YouTube calls can outrun 300
  // seconds; the pass stops between chunks with a minute to spare.
  const deadline = Date.now() + (maxDuration - 60) * 1000
  const sb = createAdminClient()
  const out = await retentionPass(sb, 2000, deadline)
  // Then refill rows an earlier pass emptied for creators still connected
  // (lib/youtube-retention restorePass), with the time that is left.
  const restore = out.stoppedFor ? null : await restorePass(sb, 2000, deadline)
  return NextResponse.json({ ok: true, ...out, restore })
}
