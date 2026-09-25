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

import { getChannelOAuthToken } from '@/lib/youtube-channels'
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
  | { state: 'waiting'; publishAt: string | null }
  | { state: 'failed'; error: string }

/**
 * Ask YouTube whether the video is public; post the comment if it is.
 * Every outcome is written to the row before it is returned.
 */
export async function postFirstCommentIfPublic(sb: Sb, row: FirstCommentRow): Promise<FirstCommentOutcome> {
  const at = new Date().toISOString()
  const fail = async (error: string): Promise<FirstCommentOutcome> => {
    await sb.from('video_first_comments').update({ state: 'failed', last_error: error, last_checked_at: at, updated_at: at }).eq('id', row.id)
    return { state: 'failed', error }
  }
  if (row.state === 'posted' && row.comment_id) return { state: 'posted', commentId: row.comment_id }
  const token = await getChannelOAuthToken(sb, row.user_id, row.channel_id)
  if (!token) return fail('The channel this video is on is not connected for publishing. Connect it under Settings.')
  const yt = new YouTubeOAuthService(token)
  let status: Awaited<ReturnType<YouTubeOAuthService['getVideoStatus']>> = null
  try { status = await yt.getVideoStatus(row.youtube_video_id) } catch {
    // YouTube did not answer: not a verdict. Try again on the next run.
    await sb.from('video_first_comments').update({ last_checked_at: at }).eq('id', row.id)
    return { state: 'waiting', publishAt: null }
  }
  if (!status) return fail('The saved login cannot see this video: it was deleted, or it is on a channel that login is not. Nothing was posted.')
  if (status.privacy !== 'public') {
    const ageDays = (Date.now() - Date.parse(row.created_at)) / 86_400_000
    if (ageDays > FIRST_COMMENT_MAX_WAIT_DAYS && !status.publishAt) {
      return fail(`The video was still not public after ${FIRST_COMMENT_MAX_WAIT_DAYS} days, so MVP stopped waiting. Nothing was posted.`)
    }
    await sb.from('video_first_comments').update({
      last_checked_at: at, publish_at: status.publishAt, channel_id: status.channelId ?? row.channel_id,
    }).eq('id', row.id)
    return { state: 'waiting', publishAt: status.publishAt }
  }
  // THE COMMENTER IS THE VIDEO'S OWN CHANNEL, asked of YouTube.
  let me: { id: string } | null = null
  try { me = await yt.getMyChannel() } catch { me = null }
  if (!me || (status.channelId && me.id !== status.channelId)) {
    return fail('The saved login is not the channel this video is on, so the comment would come from the wrong channel. Nothing was posted. Reconnect that channel under Settings.')
  }
  try {
    const id = await yt.postComment(row.youtube_video_id, row.text)
    if (!id) return fail('YouTube did not return the comment id, so MVP cannot tell whether it was posted.')
    await sb.from('video_first_comments').update({
      state: 'posted', comment_id: id, posted_at: at, last_checked_at: at, last_error: null, updated_at: at,
      channel_id: status.channelId ?? row.channel_id,
    }).eq('id', row.id)
    return { state: 'posted', commentId: id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/quota/i.test(msg)) {
      // A used-up daily limit is not the comment's fault: wait for tomorrow.
      await sb.from('video_first_comments').update({ last_checked_at: at, last_error: "YouTube's daily limit for MVP was used up. It will try again." }).eq('id', row.id)
      return { state: 'waiting', publishAt: null }
    }
    return fail(/commentsDisabled|disabled comments/i.test(msg) ? 'Comments are turned off on this video.' : `YouTube did not take the comment: ${msg.slice(0, 160)}`)
  }
}
