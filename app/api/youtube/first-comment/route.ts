// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/youtube/first-comment — the pinned first comment Co-Pilot posts on a
// video it pushed (lib/first-comments, migration 377). LABS.
//
// POST { youtubeVideoId, text?, videoTitle? } queues it (writing the text when
// none is sent), and posts it at once
// when the video is already public. A video that already has its first
// comment posted is never given a second one.
// GET lists the creator's first comments, newest first, for the page to show
// what happened and to pin the ones SCOUT has not pinned yet.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUsePreview } from '@/lib/labs-preview'
import { postFirstCommentIfPublic, type FirstCommentRow } from '@/lib/first-comments'
import { writeFirstComment } from '@/lib/first-comment-writer'
import { productLinkIn } from '@/lib/first-comment-text'
import { fillMissingVideoDetails } from '@/lib/video-details-fill'

export const runtime = 'nodejs'
export const maxDuration = 30

async function gate() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('first_comment', intg?.tier)) {
    return { error: NextResponse.json({ error: 'Pinned comments are part of the Amazon and Pro plans.', code: 'tier_not_allowed' }, { status: 403 }) }
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
  let text = String(body.text || '').trim().slice(0, 1500)
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json({ error: 'Which video is this for? No YouTube video id was sent.' }, { status: 400 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  // The video's channel, when MVP knows it; the job asks YouTube either way.
  let { data: vid } = await admin.from('youtube_videos').select('channel_id,title,description')
    .eq('user_id', g.user.id).eq('youtube_video_id', videoId).maybeSingle()
  // NEVER WRITTEN FROM A DESCRIPTION MVP NEVER READ: a video saved by id only
  // gets its real title and description from YouTube first, or its comment
  // would go out without the product link the video has.
  if (!text && vid && (!String(vid.title || '').trim() || vid.description == null)) {
    const f = (await fillMissingVideoDetails(admin, g.user.id, [videoId]).catch(() => new Map())).get(videoId)
    if (f) vid = { ...vid, title: String(vid.title || '').trim() ? vid.title : f.title, description: vid.description == null || !String(vid.description).trim() ? f.description : vid.description, channel_id: vid.channel_id || f.channelId }
  }
  const channel = /^UC[\w-]{22}$/.test(String(vid?.channel_id || '')) ? String(vid?.channel_id) : null
  // NO TEXT IS NOT NO COMMENT. A push whose generated comment came back empty
  // used to queue nothing and say nothing; the comment is written here instead,
  // from the video's own title and the link in its description.
  let written: 'sent' | 'ai' | 'plain' = 'sent'
  if (!text) {
    const w = await writeFirstComment({
      userId: g.user.id, title: body.videoTitle || vid?.title || null,
      description: vid?.description ?? null, link: productLinkIn(vid?.description),
    })
    text = w.text.slice(0, 1500)
    written = w.written
  }

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
  // BEING POSTED RIGHT NOW (by the ten-minute run): reset to waiting here,
  // it would be claimed and posted a second time.
  if (existing?.state === 'posting') {
    return NextResponse.json({ ok: true, id: existing.id, state: 'waiting', posting: true, note: 'MVP is posting this comment right now. It shows here in a moment.' })
  }
  const at = new Date().toISOString()
  let row: FirstCommentRow
  if (existing) {
    const { data: upd, error } = await admin.from('video_first_comments')
      .update({ text, state: 'waiting', last_error: null, video_title: body.videoTitle?.slice(0, 200) ?? null, channel_id: channel ?? existing.channel_id, updated_at: at })
      .eq('id', existing.id).neq('state', 'posting').neq('state', 'posted').select('id,user_id,youtube_video_id,channel_id,text,state,comment_id,created_at').maybeSingle()
    if (error) return NextResponse.json({ error: 'The first comment could not be queued.' }, { status: 500 })
    if (!upd) return NextResponse.json({ ok: true, id: existing.id, state: 'waiting', posting: true, note: 'MVP is posting this comment right now. It shows here in a moment.' })
    row = upd
  } else {
    const { data: ins, error } = await admin.from('video_first_comments')
      .insert({ user_id: g.user.id, youtube_video_id: videoId, channel_id: channel, text, video_title: body.videoTitle?.slice(0, 200) ?? null })
      .select('id,user_id,youtube_video_id,channel_id,text,state,comment_id,created_at').single()
    if (error || !ins) return NextResponse.json({ error: 'The first comment could not be queued.' }, { status: 500 })
    row = ins
  }
  const out = await postFirstCommentIfPublic(admin, row)
  return NextResponse.json({ ok: out.state !== 'failed', id: row.id, written, ...out })
}
