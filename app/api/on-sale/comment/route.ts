// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/on-sale/comment { youtubeVideoId, text } — post the sale comment
// on the creator's own video, through the channel that video is on. LABS.
//
// ONLY THEIR OWN VIDEO. The video must be one of this creator's rows, and the
// comment goes out through that video's channel login, so a comment can never
// land on somebody else's video or come from the wrong channel.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { canUsePreview } from '@/lib/labs-preview'
import { getChannelOAuthToken } from '@/lib/youtube-channels'
import { YouTubeOAuthService } from '@/services/youtube'
import { wrongChannelMessage } from '@/lib/launch-channel'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('on_sale', intg?.tier)) {
    return NextResponse.json({ error: 'On sale now is in Labs testing and not open yet.', code: 'tier_not_allowed' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({})) as { youtubeVideoId?: string; text?: string }
  const videoId = String(body.youtubeVideoId || '').trim()
  const text = String(body.text || '').trim().slice(0, 1500)
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !text) {
    return NextResponse.json({ error: 'A video and the comment text are both needed.' }, { status: 400 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: vid } = await (supabase as any).from('youtube_videos')
    .select('id,channel_id').eq('user_id', user.id).eq('youtube_video_id', videoId).maybeSingle()
  if (!vid) return NextResponse.json({ error: 'That video is not one of yours.' }, { status: 404 })

  const token = await getChannelOAuthToken(supabase, user.id, vid.channel_id ?? null)
  if (!token) return NextResponse.json({ error: 'The channel this video is on is not connected for publishing. Connect it under Settings.' }, { status: 400 })
  const yt = new YouTubeOAuthService(token)
  // THE COMMENTER IS THE VIDEO'S OWN CHANNEL, asked of YouTube. A login can
  // fall back to the default channel when the video's own is not connected,
  // and the comment would then be posted as a different channel.
  const owner = String(vid.channel_id || '')
  if (/^UC[\w-]{22}$/.test(owner)) {
    let me: { id: string; title: string } | null = null
    try { me = await yt.getMyChannel() } catch { /* said below */ }
    if (!me) return NextResponse.json({ error: 'YouTube did not say which channel this login is. Nothing was posted.' }, { status: 502 })
    if (me.id !== owner) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: named } = await (supabase as any).from('youtube_channels').select('channel_title').eq('user_id', user.id).eq('channel_id', owner).maybeSingle()
      return NextResponse.json({ error: wrongChannelMessage(String(named?.channel_title || owner), me.title).replace('Nothing was uploaded.', 'Nothing was posted.') }, { status: 409 })
    }
  }
  try {
    const id = await yt.postComment(videoId, text)
    return NextResponse.json({
      ok: true, commentId: id,
      // PINNING IS A CLICK IN STUDIO: YouTube offers no way to do it by API.
      studioUrl: `https://studio.youtube.com/video/${videoId}/comments`,
      watchUrl: `https://www.youtube.com/watch?v=${videoId}${id ? `&lc=${encodeURIComponent(id)}` : ''}`,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const friendly = /commentsDisabled|disabled comments/i.test(msg) ? 'Comments are turned off on this video.'
      : /quota/i.test(msg) ? 'YouTube\'s daily limit for MVP is used up. Try again tomorrow.'
        : /403/.test(msg) ? 'YouTube refused: the saved login may not be this video\'s channel. Reconnect it under Settings.'
          : `YouTube did not take the comment: ${msg.slice(0, 160)}`
    return NextResponse.json({ error: friendly }, { status: 502 })
  }
}
