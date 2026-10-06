// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/youtube-data-retention (daily): stored YouTube video data
// older than 30 days is refreshed from YouTube or emptied (lib/youtube-retention).
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { retentionPass } from '@/lib/youtube-retention'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Two thousand rows of serial writes and YouTube calls can outrun 300
  // seconds; the pass stops between chunks with a minute to spare.
  const out = await retentionPass(createAdminClient(), 2000, Date.now() + (maxDuration - 60) * 1000)
  return NextResponse.json({ ok: true, ...out })
}
