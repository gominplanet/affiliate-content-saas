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
import { usesStudioUpload, leaveCommentToScout } from '@/lib/studio-upload'

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
  // ONE MORE LOOK for comments written off by the old single-login check,
  // which called any video the default channel could not see deleted. Asked
  // again with every connected channel; a video truly gone is then forgotten.
  await sb.from('video_first_comments').update({ state: 'waiting', last_checked_at: null })
    .eq('state', 'failed').like('last_error', 'The saved login cannot see this video%')
  // A POST THAT NEVER REPORTED BACK. The row is claimed ('posting') before the
  // comment is sent; one still claimed after fifteen minutes belongs to a run
  // that died in between, so the comment may well be on the video. Said so,
  // and never posted again by itself.
  await sb.from('video_first_comments').update({
    state: 'failed',
    last_error: 'MVP started posting this comment but never heard back, so it may already be on the video. Check the video before posting it again.',
  }).eq('state', 'posting').lt('updated_at', new Date(started - 15 * 60_000).toISOString())
  // ONLY ROWS THAT CAN BE DUE. Comments for videos scheduled later sat at the
  // head of this list and could crowd out every comment that was due.
  const { data, error } = await sb.from('video_first_comments')
    .select('id,user_id,youtube_video_id,channel_id,text,state,comment_id,created_at,publish_at,last_checked_at')
    .eq('state', 'waiting').or(`publish_at.is.null,publish_at.lte.${new Date(started).toISOString()}`)
    .order('last_checked_at', { ascending: true, nullsFirst: true }).limit(500)
  if (error) return NextResponse.json({ ok: false, error: error.code === '42P01' ? 'video_first_comments table missing (migration 377)' : error.message })
  const now = Date.now()
  // LEFT TO SCOUT FIRST. A creator on "YouTube through SCOUT" has their
  // comments posted from their own browser at no quota; the API posts one
  // only once it is SCOUT_COMMENT_GRACE_MS past its time, so it is late at
  // worst, never lost. Not even the 1-unit check is spent before then.
  const rows0 = (data ?? []) as Array<FirstCommentRow & { publish_at: string | null; last_checked_at: string | null }>
  const scoutUsers = new Set<string>()
  {
    const ids = [...new Set(rows0.map((r) => r.user_id))]
    if (ids.length) {
      const { data: tiers } = await sb.from('integrations').select('user_id,tier').in('user_id', ids)
      for (const t of (tiers ?? []) as Array<{ user_id: string; tier: string | null }>) if (usesStudioUpload(t.tier)) scoutUsers.add(t.user_id)
    }
  }
  const due = rows0
    .filter((r) => !leaveCommentToScout(scoutUsers.has(r.user_id), r.publish_at, now))
    .filter((r) => firstCommentDue(r, now)).slice(0, 150)
  let posted = 0, waiting = 0, failed = 0, gone = 0
  for (const row of due) {
    if (Date.now() - started > 270_000) break
    const out = await postFirstCommentIfPublic(sb, row)
    if (out.state === 'posted') posted++
    else if (out.state === 'failed') failed++
    else if (out.state === 'gone') gone++
    else waiting++
  }
  return NextResponse.json({ ok: true, waitingTotal: (data ?? []).length, checked: due.length, posted, waiting, failed, gone })
}
