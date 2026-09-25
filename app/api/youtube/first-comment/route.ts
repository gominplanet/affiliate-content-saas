// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/youtube/first-comment — the pinned first comment Co-Pilot posts on a
// video it pushed (lib/first-comments, migration 377). LABS.
//
// POST { youtubeVideoId, text, videoTitle? } queues it, and posts it at once
// when the video is already public. A video that already has its first
// comment posted is never given a second one.
// GET lists the creator's first comments, newest first, for the page to show
// what happened and to pin the ones SCOUT has not pinned yet.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUsePreview } from '@/lib/labs-preview'
import { postFirstCommentIfPublic, type FirstCommentRow } from '@/lib/first-comments'

export const runtime = 'nodejs'
export const maxDuration = 30

async function gate() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('first_comment', intg?.tier)) {
    return { error: NextResponse.json({ error: 'Pinned first comments are in Labs testing and not open yet.', code: 'tier_not_allowed' }, { status: 403 }) }
  }
  return { supabase, user }
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (g.supabase as any).from('video_first_comments')
    .select('id,youtube_video_id,video_title,state,comment_id,pinned,pin_error,last_error,publish_at,posted_at,created_at')
    .eq('user_id', g.user.id).order('created_at', { ascending: false }).limit(100)
  if (error) return NextResponse.json({ comments: [], missingTable: error.code === '42P01' })
  return NextResponse.json({ comments: data ?? [] })
}

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const body = await req.json().catch(() => ({})) as { youtubeVideoId?: string; text?: string; videoTitle?: string }
  const videoId = String(body.youtubeVideoId || '').trim()
  const text = String(body.text || '').trim().slice(0, 1500)
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !text) {
    return NextResponse.json({ error: 'A video and the comment text are both needed.' }, { status: 400 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  // The video's channel, when MVP knows it; the job asks YouTube either way.
  const { data: vid } = await admin.from('youtube_videos').select('channel_id')
    .eq('user_id', g.user.id).eq('youtube_video_id', videoId).maybeSingle()
  const channel = /^UC[\w-]{22}$/.test(String(vid?.channel_id || '')) ? String(vid?.channel_id) : null

  const { data: existing, error: exErr } = await admin.from('video_first_comments')
    .select('id,user_id,youtube_video_id,channel_id,text,state,comment_id,created_at')
    .eq('user_id', g.user.id).eq('youtube_video_id', videoId).maybeSingle()
  if (exErr && exErr.code === '42P01') {
    return NextResponse.json({ error: 'The first comments table is missing (migration 377), so nothing was queued.', missingTable: true }, { status: 500 })
  }
  // ONE FIRST COMMENT PER VIDEO: a re-push never adds a second.
  if (existing?.state === 'posted' && existing.comment_id) {
    return NextResponse.json({ ok: true, id: existing.id, state: 'posted', commentId: existing.comment_id, already: true })
  }
  const at = new Date().toISOString()
  let row: FirstCommentRow
  if (existing) {
    const { data: upd, error } = await admin.from('video_first_comments')
      .update({ text, state: 'waiting', last_error: null, video_title: body.videoTitle?.slice(0, 200) ?? null, channel_id: channel ?? existing.channel_id, updated_at: at })
      .eq('id', existing.id).select('id,user_id,youtube_video_id,channel_id,text,state,comment_id,created_at').single()
    if (error || !upd) return NextResponse.json({ error: 'The first comment could not be queued.' }, { status: 500 })
    row = upd
  } else {
    const { data: ins, error } = await admin.from('video_first_comments')
      .insert({ user_id: g.user.id, youtube_video_id: videoId, channel_id: channel, text, video_title: body.videoTitle?.slice(0, 200) ?? null })
      .select('id,user_id,youtube_video_id,channel_id,text,state,comment_id,created_at').single()
    if (error || !ins) return NextResponse.json({ error: 'The first comment could not be queued.' }, { status: 500 })
    row = ins
  }
  const out = await postFirstCommentIfPublic(admin, row)
  return NextResponse.json({ ok: out.state !== 'failed', id: row.id, ...out })
}
