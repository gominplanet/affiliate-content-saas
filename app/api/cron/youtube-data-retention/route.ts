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
  const out = await retentionPass(createAdminClient())
  return NextResponse.json({ ok: true, ...out })
}
