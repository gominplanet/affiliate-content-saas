// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The first comment Co-Pilot posts on every video it pushes, and pins
// (migration 377).
//
// POSTED WHEN THE VIDEO IS PUBLIC, NOT BEFORE. YouTube does not take comments
// on a private or scheduled video, so a queued comment waits, and a job asks
// YouTube about it until the video is public, then posts it. Pinning happens
// in the creator's browser through SCOUT, because YouTube has no pin API.
//
// WHAT HAPPENED IS WHAT IS SAVED: waiting, posted (with the comment id),
// failed (with why), or cancelled. A comment that could not be posted never
// shows as posted.

import { getChannelOAuthToken, listYouTubeChannels } from '@/lib/youtube-channels'
import { YouTubeOAuthService } from '@/services/youtube'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

/** How long a queued comment waits for its video to go public before MVP gives up and says so. */
export const FIRST_COMMENT_MAX_WAIT_DAYS = 60

/**
 * Whether a waiting comment should be checked on this run. Each check costs
 * a unit of the YouTube quota every creator shares, so a video is asked about
 * only when there is a reason: never checked yet; its scheduled time has
 * come (every run from then until it is posted); or, with no schedule, once
 * every six hours. Pure, so the rule is tested.
 */
export function firstCommentDue(r: { publish_at: string | null; last_checked_at: string | null }, now = Date.now()): boolean {
  if (!r.last_checked_at) return true
  const last = Date.parse(r.last_checked_at)
  if (r.publish_at) {
    const pub = Date.parse(r.publish_at)
    if (pub > now) return false
    // Public within minutes of its time, usually: check each run for a day, then every six hours.
    return now - pub < 86_400_000 ? true : now - last > 6 * 3_600_000
  }
  return now - last > 6 * 3_600_000
}

export interface FirstCommentRow {
  id: string
  user_id: string
  youtube_video_id: string
  channel_id: string | null
  text: string
  state: string
  comment_id: string | null
  created_at: string
}

export type FirstCommentOutcome =
  | { state: 'posted'; commentId: string }
  | { state: 'waiting'; publishAt: string | null; reason?: 'not_public' | 'no_answer' | 'quota' }
  | { state: 'failed'; error: string }
  /** YouTube no longer has the video, so MVP forgot it: this row and the
   *  video's own record are gone. */
  | { state: 'gone' }

/**
 * Ask YouTube whether the video is public; post the comment if it is.
 * Every outcome is written to the row before it is returned.
 */
export async function postFirstCommentIfPublic(sb: Sb, rowIn: FirstCommentRow): Promise<FirstCommentOutcome> {
  let row = rowIn
  const at = new Date().toISOString()
  const fail = async (error: string): Promise<FirstCommentOutcome> => {
    await sb.from('video_first_comments').update({ state: 'failed', last_error: error, last_checked_at: at, updated_at: at }).eq('id', row.id)
    return { state: 'failed', error }
  }
  if (row.state === 'posted' && row.comment_id) return { state: 'posted', commentId: row.comment_id }
  const token = await getChannelOAuthToken(sb, row.user_id, row.channel_id)
  if (!token) return fail('The channel this video is on is not connected for publishing. Connect it under Settings.')
  let yt = new YouTubeOAuthService(token)
  let status: Awaited<ReturnType<YouTubeOAuthService['getVideoStatus']>> = null
  let unsure = false
  try { status = await yt.getVideoStatus(row.youtube_video_id) } catch {
    // YouTube did not answer: not a verdict. Try again on the next run.
    await sb.from('video_first_comments').update({ last_checked_at: at }).eq('id', row.id)
    return { state: 'waiting', publishAt: null, reason: 'no_answer' }
  }
  // NOT SEEN BY ONE LOGIN IS NOT GONE. A private or scheduled video is only
  // visible to the channel it is on, and when MVP did not know that channel it
  // asked with the default one and called the video deleted. Every other
  // connected channel is asked before anything is written off.
  if (!status) {
    const others = (await listYouTubeChannels(sb, row.user_id).catch(() => []))
      .filter((c) => c.hasOAuth && c.channelId && c.channelId !== row.channel_id)
    for (const c of others) {
      const t = await getChannelOAuthToken(sb, row.user_id, c.channelId).catch(() => null)
      if (!t || t === token) continue
      const other = new YouTubeOAuthService(t)
      // A check that THREW (quota, timeout) is not "cannot see it".
      const seen = await other.getVideoStatus(row.youtube_video_id).catch(() => { unsure = true; return null })
      if (seen) { yt = other; status = seen; row = { ...row, channel_id: c.channelId }; break }
    }
  }
  if (!status && unsure) {
    await sb.from('video_first_comments').update({ last_checked_at: at }).eq('id', row.id)
    return { state: 'waiting', publishAt: null, reason: 'no_answer' }
  }
  if (!status) {
    // DELETED FROM YOUTUBE IS FORGOTTEN BY MVP. Only when it is certain: the
    // channel the video belongs to is connected, and even its own login cannot
    // see it. A video on a channel that is not connected might simply be out
    // of sight, and wiping it would be the wrong answer to a disconnect.
    const { data: vid } = await sb.from('youtube_videos').select('id,channel_id')
      .eq('user_id', row.user_id).eq('youtube_video_id', row.youtube_video_id).maybeSingle()
    const owner = String(vid?.channel_id || row.channel_id || '')
    const connected = owner ? (await listYouTubeChannels(sb, row.user_id).catch(() => [])).some((c) => c.channelId === owner && c.hasOAuth) : false
    // AND ITS LOGIN IS THAT CHANNEL. A Brand Account picked wrongly at
    // Google's chooser is "connected" while seeing nothing of the channel's
    // private or scheduled videos; deleting then wiped a real video.
    let ownerConfirmed = false
    if (connected) {
      try {
        const tok = await getChannelOAuthToken(sb, row.user_id, owner)
        const mine = tok ? await new YouTubeOAuthService(tok).getMyChannel() : null
        ownerConfirmed = !!mine && mine.id === owner
      } catch {
        // Could not ask (quota, timeout): wait, rather than fail or forget.
        await sb.from('video_first_comments').update({ last_checked_at: at }).eq('id', row.id)
        return { state: 'waiting', publishAt: null, reason: 'no_answer' }
      }
    }
    if (connected && ownerConfirmed) {
      await sb.from('video_first_comments').delete().eq('id', row.id)
      if (vid?.id) await sb.from('youtube_videos').delete().eq('id', vid.id).eq('user_id', row.user_id)
      return { state: 'gone' }
    }
    return fail('None of your connected YouTube channels can see this video. If it was deleted, MVP forgets it once the channel it was on is connected; if it is on a channel not connected to MVP, connect that channel. Nothing was posted.')
  }
  if (status.privacy !== 'public') {
    const ageDays = (Date.now() - Date.parse(row.created_at)) / 86_400_000
    if (ageDays > FIRST_COMMENT_MAX_WAIT_DAYS && !status.publishAt) {
      return fail(`The video was still not public after ${FIRST_COMMENT_MAX_WAIT_DAYS} days, so MVP stopped waiting. Nothing was posted.`)
    }
    await sb.from('video_first_comments').update({
      last_checked_at: at, publish_at: status.publishAt, channel_id: status.channelId ?? row.channel_id,
    }).eq('id', row.id)
    return { state: 'waiting', publishAt: status.publishAt, reason: 'not_public' }
  }
  // THE COMMENTER IS THE VIDEO'S OWN CHANNEL, asked of YouTube.
  let me: { id: string } | null = null
  try { me = await yt.getMyChannel() } catch (e) {
    // Could not ask is not "the wrong channel": that sentence failed comments
    // for good on a used-up quota. Try again on the next run.
    const why = e instanceof Error ? e.message : String(e)
    await sb.from('video_first_comments').update({
      last_checked_at: at,
      ...(/quota/i.test(why) ? { last_error: "YouTube's daily limit for MVP was used up. It will try again." } : {}),
    }).eq('id', row.id)
    return { state: 'waiting', publishAt: null, reason: /quota/i.test(why) ? 'quota' : 'no_answer' }
  }
  if (!me || (status.channelId && me.id !== status.channelId)) {
    return fail('The saved login is not the channel this video is on, so the comment would come from the wrong channel. Nothing was posted. Reconnect that channel under Settings.')
  }
  // CLAIMED BEFORE POSTING, so the ten-minute run and a creator's own Post
  // button cannot both post it. Only a row still waiting (or failed, which
  // the button retries) can be taken; whoever loses the claim posts nothing.
  const { data: took } = await sb.from('video_first_comments')
    .update({ state: 'posting', updated_at: at }).eq('id', row.id).in('state', ['waiting', 'failed']).select('id')
  if (!took || took.length === 0) return { state: 'waiting', publishAt: null, reason: 'no_answer' }
  try {
    const id = await yt.postComment(row.youtube_video_id, row.text)
    if (!id) return fail('YouTube did not return the comment id, so MVP cannot tell whether it was posted.')
    // Written until it lands: a lost write here would leave the row looking
    // unposted and invite a second comment.
    for (let w = 0; w < 3; w++) {
      const { error: wErr } = await sb.from('video_first_comments').update({
        state: 'posted', comment_id: id, posted_at: at, last_checked_at: at, last_error: null, updated_at: at,
        channel_id: status.channelId ?? row.channel_id,
      }).eq('id', row.id)
      if (!wErr) break
      await new Promise((r) => setTimeout(r, 800 * (w + 1)))
    }
    return { state: 'posted', commentId: id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/quota/i.test(msg)) {
      // A used-up daily limit is not the comment's fault: wait for tomorrow.
      await sb.from('video_first_comments').update({ state: 'waiting', last_checked_at: at, last_error: "YouTube's daily limit for MVP was used up. It will try again." }).eq('id', row.id)
      return { state: 'waiting', publishAt: null, reason: 'quota' }
    }
    return fail(/commentsDisabled|disabled comments/i.test(msg) ? 'Comments are turned off on this video.' : `YouTube did not take the comment: ${msg.slice(0, 160)}`)
  }
}
