// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/youtube/first-comment/scout  first comments due now, for SCOUT to
//                                        post at no YouTube quota.
// POST /api/youtube/first-comment/scout  { id, claim: true }  SCOUT is posting it.
//                                        { id, result }       how it went.
//
// For creators on "YouTube through SCOUT" (lib/studio-upload). Posting through
// the API costs 50 of the quota every account shares; SCOUT posts as the
// creator from their own browser instead. The ten-minute cron still posts any
// that SCOUT has not reached within SCOUT_COMMENT_GRACE_MS of their time, so a
// comment is late at worst, never lost.
//
// CLAIMED BEFORE POSTING, as the cron claims: only a waiting row can be
// taken, so SCOUT and the cron can never both post the same comment.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { usesStudioUpload } from '@/lib/studio-upload'

export const runtime = 'nodejs'
export const maxDuration = 30

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function gate(): Promise<{ user: { id: string }; sb: any } | NextResponse> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data: integ } = await sb.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!usesStudioUpload(integ?.tier)) return NextResponse.json({ ok: true, on: false, comments: [] })
  return { user, sb }
}

export async function GET() {
  const g = await gate()
  if (g instanceof NextResponse) return g
  const { user, sb } = g
  const now = new Date().toISOString()
  // New uploads whose time has come, and older videos (no publish time, the
  // video is already public), new uploads first. Older videos used to go only
  // through the API, 50 units each from the quota every account shares.
  const { data, error } = await sb.from('video_first_comments')
    .select('id,youtube_video_id,video_title,text,publish_at,last_error')
    .eq('user_id', user.id).eq('state', 'waiting').or(`publish_at.is.null,publish_at.lte.${now}`)
    .order('publish_at', { ascending: true, nullsFirst: false }).limit(10)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  // Coming up within two hours, so a background pass knows when to come back.
  const { data: soon } = await sb.from('video_first_comments').select('publish_at')
    .eq('user_id', user.id).eq('state', 'waiting').gt('publish_at', now)
    .order('publish_at', { ascending: true }).limit(1)
  return NextResponse.json({ ok: true, on: true, comments: data ?? [], nextAt: (soon ?? [])[0]?.publish_at ?? null })
}

export async function POST(req: Request) {
  const g = await gate()
  if (g instanceof NextResponse) return g
  const { user, sb } = g
  const body = await req.json().catch(() => ({})) as {
    id?: string; claim?: boolean
    result?: { ok?: boolean; commentId?: string; already?: boolean; notPublic?: boolean; error?: string; detail?: string }
  }
  const id = String(body.id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: 'Which comment?' }, { status: 400 })
  const at = new Date().toISOString()

  if (body.claim) {
    const { data: took } = await sb.from('video_first_comments')
      .update({ state: 'posting', updated_at: at }).eq('id', id).eq('user_id', user.id).eq('state', 'waiting').select('id')
    return NextResponse.json({ ok: !!took && took.length > 0 })
  }

  const r = body.result
  if (!r || typeof r !== 'object') return NextResponse.json({ ok: false, error: 'No result.' }, { status: 400 })
  const commentId = String(r.commentId || '')
  if (r.ok && /^[A-Za-z0-9_.-]{10,80}$/.test(commentId)) {
    // Written until it lands: a lost write would leave it looking unposted.
    for (let w = 0; w < 3; w++) {
      const { error } = await sb.from('video_first_comments').update({
        state: 'posted', comment_id: commentId, posted_at: at, last_checked_at: at, last_error: null, updated_at: at,
      }).eq('id', id).eq('user_id', user.id).eq('state', 'posting')
      if (!error) break
      await new Promise((res) => setTimeout(res, 800 * (w + 1)))
    }
    return NextResponse.json({ ok: true, state: 'posted' })
  }
  // NOT POSTED, AND SAID WHY. Back to waiting (the cron's API backup takes it
  // after the grace time), except a refusal no retry can fix.
  const final = r.error === 'comments-off'
  const why = r.notPublic ? null
    : r.error === 'not-owner' ? 'SCOUT could not post it: YouTube in this browser is signed in as a different channel from the one that owns the video. MVP posts it itself shortly.'
    : r.error === 'comments-off' ? 'Comments are turned off on this video, so nothing was posted.'
    : `SCOUT could not post it${r.detail ? `: ${String(r.detail).slice(0, 160)}` : ''}. MVP posts it itself shortly.`
  await sb.from('video_first_comments').update({
    state: final ? 'failed' : 'waiting',
    last_error: why,
    updated_at: at,
  }).eq('id', id).eq('user_id', user.id).eq('state', 'posting')
  return NextResponse.json({ ok: true, state: final ? 'failed' : 'waiting' })
}
