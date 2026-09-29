/**
 * GET /api/cron/video-hold
 *
 * Posts wait for their videos (lib/video-hold): a post live on the blog whose
 * YouTube video is scheduled or private becomes a WordPress draft, and is
 * published again, dated that day, when the video goes live.
 *
 * Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { holdAndRelease } from '@/lib/video-hold'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set on server' }, { status: 500 })
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const r = await holdAndRelease(createAdminClient())
  if (r.missingColumn) return NextResponse.json({ ok: false, skipped: 'Posts cannot wait for their videos until migration 388 is run.' })
  return NextResponse.json({ ok: true, held: r.held.length, released: r.released.length, letGo: r.letGo, failed: r.failed, heldPosts: r.held, releasedPosts: r.released })
}
