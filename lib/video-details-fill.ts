// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// VIDEOS MVP KNOWS ONLY BY ID (Seb, 2026-10-08: pinned comments listed seven
// recent videos as bare ids, blank thumbnails, "no product link in its
// description"). The videos were real and public, with titles and links; MVP
// had saved them without title, description or thumbnail. The list then said
// there was no link, and a comment written from that empty description would
// have gone out without the product link.
//
// This reads the real snippet from YouTube for such videos (one quota unit per
// 50) and saves only what was missing. Every connected channel is asked, so a
// video on a second channel is found too. Best-effort: a video YouTube does
// not return stays as it was, and the caller says so.

import { listYouTubeChannels, getChannelOAuthToken } from '@/lib/youtube-channels'
import { YouTubeOAuthService } from '@/services/youtube'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type FilledVideo = { title: string; description: string; thumbnailUrl: string | null; channelId: string | null; channelTitle: string | null }

/** Fills title, description and thumbnail for these videos where MVP has
 *  none, from YouTube, and returns what it found by video id. */
export async function fillMissingVideoDetails(sb: Db, userId: string, ids: string[]): Promise<Map<string, FilledVideo>> {
  const found = new Map<string, FilledVideo>()
  const want = Array.from(new Set(ids.filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id)))).slice(0, 100)
  if (!want.length) return found
  const tokens: string[] = []
  const first = await getChannelOAuthToken(sb, userId).catch(() => null)
  if (first) tokens.push(first)
  for (const c of (await listYouTubeChannels(sb, userId).catch(() => [])).filter((c) => c.hasOAuth && c.channelId)) {
    const t = await getChannelOAuthToken(sb, userId, c.channelId).catch(() => null)
    if (t && !tokens.includes(t)) tokens.push(t)
  }
  for (const token of tokens) {
    const left = want.filter((id) => !found.has(id))
    if (!left.length) break
    let got: Awaited<ReturnType<YouTubeOAuthService['getVideoSnippets']>> = {}
    try { got = await new YouTubeOAuthService(token).getVideoSnippets(left) } catch { continue }
    for (const [id, v] of Object.entries(got)) found.set(id, { title: v.title, description: v.description, thumbnailUrl: v.thumbnailUrl, channelId: v.channelId, channelTitle: v.channelTitle })
  }
  // Only what was missing is written: a title or description MVP already
  // holds (perhaps edited by Co-Pilot) is never replaced here.
  for (const [id, v] of found) {
    const { data: row } = await sb.from('youtube_videos').select('id,title,description,thumbnail_url,channel_id,channel_title')
      .eq('user_id', userId).eq('youtube_video_id', id).maybeSingle()
    if (!row) continue
    const patch: Record<string, string> = {}
    if (!String(row.title || '').trim() && v.title) patch.title = v.title
    // A description YouTube holds as empty is saved as empty: known, not missing.
    if (row.description == null || (!String(row.description).trim() && v.description)) patch.description = v.description
    if (!row.thumbnail_url && v.thumbnailUrl) patch.thumbnail_url = v.thumbnailUrl
    if ((!row.channel_id || row.channel_id === 'unknown') && v.channelId) patch.channel_id = v.channelId
    if (!String(row.channel_title || '').trim() && v.channelTitle) patch.channel_title = v.channelTitle
    if (Object.keys(patch).length) await sb.from('youtube_videos').update(patch).eq('id', row.id).eq('user_id', userId)
  }
  return found
}
