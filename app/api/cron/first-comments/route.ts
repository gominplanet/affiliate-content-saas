// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/first-comments — every ten minutes, the first comments still
// waiting for their video to go public are checked when due (lib/first-comments
// firstCommentDue), and posted when the video is public.
//
// NOT GATED ON LABS: a comment that was queued is posted even if the preview
// is later closed, since the creator asked for it.
//
// Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { postFirstCommentIfPublic, firstCommentDue, type FirstCommentRow } from '@/lib/first-comments'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const started = Date.now()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any
  const { data, error } = await sb.from('video_first_comments')
    .select('id,user_id,youtube_video_id,channel_id,text,state,comment_id,created_at,publish_at,last_checked_at')
    .eq('state', 'waiting').order('last_checked_at', { ascending: true, nullsFirst: true }).limit(500)
  if (error) return NextResponse.json({ ok: false, error: error.code === '42P01' ? 'video_first_comments table missing (migration 377)' : error.message })
  const now = Date.now()
  const due = ((data ?? []) as Array<FirstCommentRow & { publish_at: string | null; last_checked_at: string | null }>)
    .filter((r) => firstCommentDue(r, now)).slice(0, 150)
  let posted = 0, waiting = 0, failed = 0
  for (const row of due) {
    if (Date.now() - started > 270_000) break
    const out = await postFirstCommentIfPublic(sb, row)
    if (out.state === 'posted') posted++
    else if (out.state === 'failed') failed++
    else waiting++
  }
  return NextResponse.json({ ok: true, waitingTotal: (data ?? []).length, checked: due.length, posted, waiting, failed })
}
