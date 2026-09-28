// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/amazon-video-products — every minute, the next slice of each
// creator's Amazon videos whose products have not been read, from the videos'
// public pages (lib/amazon-video-products). A library of 7,000 is covered in
// well under an hour with nobody's browser involved. Stops for the minute as
// soon as Amazon answers with robot checks.
//
// Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { readVideoProducts, type ProductReadRun } from '@/lib/amazon-video-products'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const started = Date.now()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any
  const { data, error } = await sb.from('amazon_videos').select('user_id')
    .is('products_synced_at', null).limit(2000)
  if (error) return NextResponse.json({ ok: false, error: error.message })
  const users = [...new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))]
  const runs: Array<{ user: string } & ProductReadRun> = []
  for (const user of users) {
    const left = 45_000 - (Date.now() - started)
    if (left < 5_000) break
    const run = await readVideoProducts(sb, user, { budgetMs: left, concurrency: 4 })
    runs.push({ user, ...run })
    // Robot checks are about MVP's server, not this creator: nobody else will
    // fare better this minute.
    if (run.stoppedFor === 'blocked') break
  }
  return NextResponse.json({ ok: true, users: users.length, runs })
}
