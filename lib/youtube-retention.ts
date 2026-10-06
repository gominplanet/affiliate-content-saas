// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUTUBE DATA IS KEPT FRESH OR DELETED (YouTube API Developer Policies III.E.4).
//
// What MVP stores from YouTube about a creator's videos (title, description,
// channel name, thumbnail link, view count, captions-derived transcript) may
// not be kept longer than 30 days without being refreshed, and must be deleted
// within 7 days when the creator disconnects YouTube in MVP (30 days when they
// revoke access on Google's own security page). Written for the quota audit
// on 2026-10-05, where the privacy policy was brought in line with this.
//
// - clearYouTubeData: on disconnect, the YouTube fields of every stored video
//   are emptied at once. The rows themselves stay (scheduled posts, clips and
//   blog posts point at them by id), holding only the YouTube video id.
// - retentionPass (daily cron): rows not refreshed in 30 days are refreshed
//   from YouTube with the creator's own login (videos.list, 1 unit per 50
//   videos), or with MVP's API key for a channel connected by URL only. A
//   video YouTube no longer shows, a creator with no YouTube connection, and a
//   login Google refuses (revoked) all get their stored YouTube fields emptied.
//
// yt_refreshed_at (migration 406) records the last refresh; without it the
// pass falls back to updated_at, which other features also touch, so it is
// less strict but never deletes anything it should not.

import { ytFetch, isQuotaRefusalBody } from '@/lib/youtube-quota'
import { getChannelOAuthToken } from '@/lib/youtube-channels'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

export const YT_REFRESH_DAYS = 30
const BASE = 'https://www.googleapis.com/youtube/v3'

/** The YouTube fields emptied when MVP may no longer keep them. title and
 *  channel_title are NOT NULL columns, so they become empty strings. */
export const YT_CLEARED_FIELDS = {
  title: '', channel_title: '', description: null, thumbnail_url: null,
  view_count: null, transcript: null, transcript_fetched_at: null,
} as const

/** Empty the stored YouTube fields of one creator's videos (all, or the ids
 *  given). transcript_cues is cleared separately: older databases lack it. */
export async function clearYouTubeData(sb: Sb, userId: string, youtubeVideoIds?: string[]): Promise<void> {
  const now = new Date().toISOString()
  const scope = (q: Sb) => (youtubeVideoIds ? q.in('youtube_video_id', youtubeVideoIds) : q)
  await scope(sb.from('youtube_videos').update({ ...YT_CLEARED_FIELDS, updated_at: now }).eq('user_id', userId))
  try { await scope(sb.from('youtube_videos').update({ transcript_cues: null, transcript_cues_fetched_at: null }).eq('user_id', userId)) } catch { /* column missing */ }
}

type Fresh = { title: string; description: string; channelTitle: string; thumb: string | null; views: number | null }

async function videosList(ids: string[], token: string | null): Promise<{ ok: true; found: Map<string, Fresh> } | { ok: false; revoked: boolean; quota: boolean }> {
  const url = new URL(`${BASE}/videos`)
  url.searchParams.set('part', 'snippet,statistics')
  url.searchParams.set('id', ids.join(','))
  url.searchParams.set('maxResults', '50')
  if (!token) url.searchParams.set('key', process.env.YOUTUBE_API_KEY || '')
  const res = await ytFetch(url.toString(), { headers: token ? { Authorization: `Bearer ${token}` } : {}, timeoutMs: 20_000 }).catch(() => null)
  if (!res) return { ok: false, revoked: false, quota: false }
  if (!res.ok) return { ok: false, revoked: res.status === 401, quota: isQuotaRefusalBody(await res.text().catch(() => '')) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json().catch(() => ({})) as { items?: any[] }
  const found = new Map<string, Fresh>()
  for (const v of data.items ?? []) {
    if (!v?.id) continue
    const th = v.snippet?.thumbnails ?? {}
    found.set(v.id, {
      title: String(v.snippet?.title ?? ''), description: String(v.snippet?.description ?? ''),
      channelTitle: String(v.snippet?.channelTitle ?? ''),
      thumb: (th.maxres ?? th.high ?? th.medium ?? th.default)?.url ?? null,
      views: v.statistics?.viewCount != null ? Number(v.statistics.viewCount) : null,
    })
  }
  return { ok: true, found }
}

/** One daily pass over stale rows. Returns what it did, for the cron's log. */
export async function retentionPass(sb: Sb, maxRows = 2000): Promise<{ refreshed: number; cleared: number; users: number; column: 'yt_refreshed_at' | 'updated_at'; stoppedFor?: 'quota' }> {
  const cutoff = new Date(Date.now() - YT_REFRESH_DAYS * 86_400_000).toISOString()
  let column: 'yt_refreshed_at' | 'updated_at' = 'yt_refreshed_at'
  let { data: rows, error } = await sb.from('youtube_videos').select('user_id,youtube_video_id,channel_id,title')
    .or(`yt_refreshed_at.is.null,yt_refreshed_at.lt.${cutoff}`).neq('title', '').limit(maxRows)
  if (error) {
    column = 'updated_at'
    ;({ data: rows } = await sb.from('youtube_videos').select('user_id,youtube_video_id,channel_id,title')
      .lt('updated_at', cutoff).neq('title', '').limit(maxRows))
  }
  const byUser = new Map<string, Array<{ id: string; channel: string }>>()
  for (const r of (rows ?? []) as Array<{ user_id: string; youtube_video_id: string; channel_id: string }>) {
    const list = byUser.get(r.user_id) ?? []
    list.push({ id: r.youtube_video_id, channel: r.channel_id })
    byUser.set(r.user_id, list)
  }
  let refreshed = 0, cleared = 0
  const stamp = new Date().toISOString()
  // ONE REFUSAL ENDS THE PASS. The allowance is shared, so every later call
  // would be refused too; tomorrow's run is well inside the 30 days.
  let quotaOut = false
  for (const [userId, vids] of byUser) {
    if (quotaOut) break
    const { data: chans } = await sb.from('youtube_channels').select('channel_id').eq('user_id', userId)
    const { data: integ } = await sb.from('integrations').select('youtube_oauth_refresh_token').eq('user_id', userId).maybeSingle()
    const connected = (chans ?? []).length > 0 || !!integ?.youtube_oauth_refresh_token
    if (!connected) {
      await clearYouTubeData(sb, userId, vids.map((v) => v.id))
      cleared += vids.length
      continue
    }
    // Asked with the login of the channel each video is on, so a private or
    // scheduled video is seen; a channel connected by URL only has no login
    // and is asked with MVP's API key (public videos only).
    const byChannel = new Map<string, string[]>()
    for (const v of vids) byChannel.set(v.channel, [...(byChannel.get(v.channel) ?? []), v.id])
    for (const [channel, ids] of byChannel) {
    if (quotaOut) break
    // A TOKEN THAT COULD NOT BE HAD IS NOT A CHANNEL WITHOUT ONE. A refresh
    // that threw used to fall back to the API key, which cannot see private
    // or scheduled videos, so they read as gone and their data was emptied.
    // null (connected by URL only) is the API key's job; a throw waits.
    let token: string | null
    try { token = await getChannelOAuthToken(sb, userId, channel) } catch { continue }
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50)
      const got = await videosList(chunk, token)
      if (!got.ok) {
        // Google refused the login: access was revoked there. Anything else
        // (quota, outage) is tried again tomorrow, well inside the 30 days.
        if (got.revoked) { await clearYouTubeData(sb, userId, chunk); cleared += chunk.length; continue }
        if (got.quota) quotaOut = true
        break
      }
      const gone: string[] = []
      for (const id of chunk) {
        const f = got.found.get(id)
        if (!f) { gone.push(id); continue }
        const patch: Record<string, unknown> = { title: f.title, description: f.description, channel_title: f.channelTitle, thumbnail_url: f.thumb, view_count: f.views, updated_at: stamp }
        if (column === 'yt_refreshed_at') patch.yt_refreshed_at = stamp
        await sb.from('youtube_videos').update(patch).eq('user_id', userId).eq('youtube_video_id', id)
        refreshed++
      }
      if (gone.length) { await clearYouTubeData(sb, userId, gone); cleared += gone.length }
    }
    }
  }
  return { refreshed, cleared, users: byUser.size, column, ...(quotaOut ? { stoppedFor: 'quota' as const } : {}) }
}
