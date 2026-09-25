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
import { createAdminClient } from '@/lib/supabase/admin'
import { canUsePreview } from '@/lib/labs-preview'
import { getChannelOAuthToken } from '@/lib/youtube-channels'
import { YouTubeOAuthService } from '@/services/youtube'
import { wrongChannelMessage } from '@/lib/launch-channel'
import { notPublicMessage } from '@/lib/covered-sales'
import { SALE_WORDING, PRICE_LINE_LEAD, DISCLOSURE, SALE_COMMENTS_PER_DAY } from '@/lib/sale-comments'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('on_sale', intg?.tier)) {
    return NextResponse.json({ error: 'Encore is in Labs testing and not open yet.', code: 'tier_not_allowed' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({})) as { youtubeVideoId?: string; text?: string; lastingText?: string; asin?: string; saleLabel?: string }
  const videoId = String(body.youtubeVideoId || '').trim()
  const text = String(body.text || '').trim().slice(0, 1500)
  const lasting = String(body.lastingText || '').trim().slice(0, 1500)
  const asin = String(body.asin || '').trim().toUpperCase()
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !text) {
    return NextResponse.json({ error: 'A video and the comment text are both needed.' }, { status: 400 })
  }
  // THE AFTER-SALE VERSION COMES WITH IT, OR NOTHING IS POSTED. A sale
  // comment MVP cannot take the sale out of later is one that ends up saying
  // something untrue, so it is not posted at all.
  const lastingBodyPart = lasting.split(PRICE_LINE_LEAD)[0] ?? ''
  if (!/^[A-Z0-9]{10}$/.test(asin) || !lasting || !lasting.includes(PRICE_LINE_LEAD) || !lasting.endsWith(DISCLOSURE) || SALE_WORDING.test(lastingBodyPart)) {
    return NextResponse.json({ error: 'The version for after the sale is missing, so MVP could not take the sale out later. Press Write it again. Nothing was posted.' }, { status: 400 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: vid } = await (supabase as any).from('youtube_videos')
    .select('id,channel_id,title').eq('user_id', user.id).eq('youtube_video_id', videoId).maybeSingle()
  if (!vid) return NextResponse.json({ error: 'That video is not one of yours.' }, { status: 404 })

  // ONE SALE COMMENT PER VIDEO PER SALE. A second press would put the same
  // pitch on the video twice.
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: live, error: liveErr } = await (admin as any).from('sale_comments').select('id,comment_id')
    .eq('user_id', user.id).eq('youtube_video_id', videoId).eq('asin', asin).eq('state', 'on_sale').limit(1)
  // THE DAILY CAP, counted from what was actually posted (lib/sale-comments).
  {
    const since = new Date(Date.now() - 86_400_000).toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (admin as any).from('sale_comments').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('posted_at', since)
    if ((count ?? 0) >= SALE_COMMENTS_PER_DAY) {
      return NextResponse.json({
        error: `You have posted ${SALE_COMMENTS_PER_DAY} sale comments in the last 24 hours, the most per day. Nothing was posted. The oldest one frees a slot 24 hours after it went up.`,
        capped: true,
      }, { status: 429 })
    }
  }
  if (!liveErr && live?.length) {
    return NextResponse.json({
      error: 'There is already a sale comment for this product on this video. It gets edited when the sale ends. Nothing new was posted.',
      already: true, watchUrl: `https://www.youtube.com/watch?v=${videoId}&lc=${encodeURIComponent(live[0].comment_id)}`,
    }, { status: 409 })
  }

  const token = await getChannelOAuthToken(supabase, user.id, vid.channel_id ?? null)
  if (!token) return NextResponse.json({ error: 'The channel this video is on is not connected for publishing. Connect it under Settings.' }, { status: 400 })
  const yt = new YouTubeOAuthService(token)
  // THE COMMENTER IS THE VIDEO'S OWN CHANNEL, asked of YouTube. A login can
  // fall back to the default channel when the video's own is not connected,
  // and the comment would then be posted as a different channel.
  // WHEN MVP'S RECORD DOES NOT SAY WHICH CHANNEL ('unknown', as a Liftoff
  // hand-over can write), YouTube is asked. A video this login cannot see at
  // all is a video on another channel.
  // WHO CAN SEE IT is asked in the same call. A comment on a private,
  // unlisted or scheduled video is read by nobody, so "Posted." would report
  // a success that changes nothing.
  let status: Awaited<ReturnType<YouTubeOAuthService['getVideoStatus']>> = null
  let statusFailed = false
  try { status = await yt.getVideoStatus(videoId) } catch { statusFailed = true }
  if (statusFailed) {
    return NextResponse.json({ error: 'YouTube did not say whether this video is public. Nothing was posted. Try again in a minute.' }, { status: 502 })
  }
  if (!status) {
    return NextResponse.json({ error: 'The saved login cannot see this video, so it is on a channel that login is not, or it was deleted. Nothing was posted. Reconnect that channel under Settings.' }, { status: 409 })
  }
  const notPublic = notPublicMessage(status.privacy, status.publishAt)
  if (notPublic) return NextResponse.json({ error: notPublic, notPublic: true }, { status: 409 })
  let owner = String(vid.channel_id || '')
  if (!/^UC[\w-]{22}$/.test(owner)) owner = status.channelId || ''
  if (!owner) {
    return NextResponse.json({ error: 'YouTube did not say which channel this video is on. Nothing was posted.' }, { status: 502 })
  }
  {
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
    // REMEMBERED, SO THE SALE CAN BE TAKEN OUT LATER. If this cannot be
    // saved the comment is still up, and the page says it will not be
    // updated by itself, rather than letting it look like it will.
    let tracked: { id: string } | null = null
    let trackError: string | null = null
    if (id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row, error } = await (admin as any).from('sale_comments').insert({
        user_id: user.id, asin, youtube_video_id: videoId, video_title: vid.title ?? null, channel_id: owner,
        comment_id: id, sale_text: text, lasting_text: lasting, sale_label: String(body.saleLabel || '').slice(0, 80) || null,
      }).select('id').single()
      if (error || !row) trackError = error?.code === '42P01' ? 'The sale_comments table is missing (migration 374).' : (error?.message || 'not saved')
      else tracked = row
    } else trackError = 'YouTube did not return the comment id.'
    return NextResponse.json({
      ok: true, commentId: id, saleCommentId: tracked?.id ?? null, trackError,
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
