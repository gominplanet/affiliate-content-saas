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
// NEVER EMPTIED ON A GUESS (2026-10-08). The first version emptied every row
// one login could not see and every chunk a single 401 came back on, and it
// never looked at an emptied row again, so mistakes were permanent: Seb's
// whole catalogue, 3,371 videos, lost its titles and descriptions in three
// nights, and the product links in them with it. Now:
//  - a video is gone only when every way of asking answered and none saw it:
//    the login of its own channel, every other connected channel's login,
//    and MVP's API key; any ask that failed (401, outage, a token refresh
//    that threw) means "ask again tomorrow", never "gone";
//  - a whole chunk of ten or more that nobody sees is a login problem, not
//    ten deletions, and nothing is emptied;
//  - a revoked Google login fails to refresh, so that creator's videos are
//    asked with the API key alone: public ones stay fresh, private ones are
//    emptied, as the policy asks;
//  - restorePass refills rows that were emptied, for creators still
//    connected, from YouTube.
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
  // AN EMPTIED ROW WAS NOT REFRESHED: its last-refreshed time goes too, so the
  // refill (restorePass) takes it on its next run instead of a day later.
  try { await scope(sb.from('youtube_videos').update({ yt_refreshed_at: null }).eq('user_id', userId)) } catch { /* pre-406 */ }
}

type Fresh = { title: string; description: string; channelTitle: string; channelId: string | null; thumb: string | null; views: number | null }

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
      channelTitle: String(v.snippet?.channelTitle ?? ''), channelId: v.snippet?.channelId ?? null,
      thumb: (th.maxres ?? th.high ?? th.medium ?? th.default)?.url ?? null,
      views: v.statistics?.viewCount != null ? Number(v.statistics.viewCount) : null,
    })
  }
  return { ok: true, found }
}

/** Every login a creator has, by channel, and whether any could not be had.
 *  A token that threw is trouble (ask again tomorrow), never "no login". */
async function loginsOf(sb: Sb, userId: string): Promise<{ byChannel: Map<string, string>; all: string[]; trouble: boolean }> {
  const byChannel = new Map<string, string>()
  const all: string[] = []
  let trouble = false
  const { data: chans } = await sb.from('youtube_channels').select('channel_id').eq('user_id', userId)
  for (const c of (chans ?? []) as Array<{ channel_id: string | null }>) {
    if (!c.channel_id) continue
    try {
      const t = await getChannelOAuthToken(sb, userId, c.channel_id)
      if (t) { byChannel.set(c.channel_id, t); if (!all.includes(t)) all.push(t) }
    } catch { trouble = true }
  }
  try { const t = await getChannelOAuthToken(sb, userId); if (t && !all.includes(t)) all.push(t) } catch { trouble = true }
  return { byChannel, all, trouble }
}

/** Ask for these videos every way there is: the channel's own login first,
 *  then every other login, then MVP's API key. `gone` holds only the ids no
 *  one saw when every ask answered; any failed ask leaves `gone` empty. */
async function askEveryWay(ids: string[], channel: string, logins: { byChannel: Map<string, string>; all: string[]; trouble: boolean }): Promise<{ found: Map<string, Fresh>; gone: string[]; quota: boolean }> {
  const found = new Map<string, Fresh>()
  const own = logins.byChannel.get(channel) ?? null
  const order: Array<string | null> = []
  if (own) order.push(own)
  for (const t of logins.all) if (!order.includes(t)) order.push(t)
  if (process.env.YOUTUBE_API_KEY) order.push(null)
  let pending = ids.slice()
  let failed = logins.trouble
  for (const t of order) {
    if (!pending.length) break
    const got = await videosList(pending, t)
    if (!got.ok) {
      if (got.quota) return { found, gone: [], quota: true }
      failed = true
      continue
    }
    for (const id of pending) { const f = got.found.get(id); if (f) found.set(id, f) }
    pending = pending.filter((id) => !found.has(id))
  }
  if (failed || !order.length) return { found, gone: [], quota: false }
  // A WHOLE CHUNK NOBODY SEES is a login problem, not that many deletions.
  if (pending.length >= 10 && pending.length === ids.length) return { found, gone: [], quota: false }
  return { found, gone: pending, quota: false }
}

async function writeFresh(sb: Sb, userId: string, id: string, f: Fresh, stamp: string, column: 'yt_refreshed_at' | 'updated_at', oldChannel: string) {
  const patch: Record<string, unknown> = { title: f.title, description: f.description, channel_title: f.channelTitle, thumbnail_url: f.thumb, view_count: f.views, updated_at: stamp }
  if (column === 'yt_refreshed_at') patch.yt_refreshed_at = stamp
  if ((!oldChannel || oldChannel === 'unknown') && f.channelId) patch.channel_id = f.channelId
  await sb.from('youtube_videos').update(patch).eq('user_id', userId).eq('youtube_video_id', id)
}

function connectedOf(chans: unknown[] | null, integ: { youtube_oauth_refresh_token?: string | null } | null): boolean {
  return (chans ?? []).length > 0 || !!integ?.youtube_oauth_refresh_token
}

/** One daily pass over stale rows. Returns what it did, for the cron's log. */
export async function retentionPass(sb: Sb, maxRows = 2000, deadlineAt = Infinity): Promise<{ refreshed: number; cleared: number; users: number; column: 'yt_refreshed_at' | 'updated_at'; stoppedFor?: 'quota' | 'time' }> {
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
  // OUT OF TIME ENDS IT TOO, between users or chunks, never mid-write. Rows not
  // reached are still stale, so a later daily run takes them, inside 30 days.
  let timeOut = false
  for (const [userId, vids] of byUser) {
    if (quotaOut || timeOut) break
    if (Date.now() > deadlineAt) { timeOut = true; break }
    const { data: chans } = await sb.from('youtube_channels').select('channel_id').eq('user_id', userId)
    const { data: integ } = await sb.from('integrations').select('youtube_oauth_refresh_token').eq('user_id', userId).maybeSingle()
    if (!connectedOf(chans, integ)) {
      // Disconnected in MVP: the policy asks for deletion, and nothing here
      // could refresh it.
      await clearYouTubeData(sb, userId, vids.map((v) => v.id))
      cleared += vids.length
      continue
    }
    const logins = await loginsOf(sb, userId)
    const byChannel = new Map<string, string[]>()
    for (const v of vids) byChannel.set(v.channel, [...(byChannel.get(v.channel) ?? []), v.id])
    for (const [channel, ids] of byChannel) {
      if (quotaOut || timeOut) break
      for (let i = 0; i < ids.length; i += 50) {
        if (Date.now() > deadlineAt) { timeOut = true; break }
        const chunk = ids.slice(i, i + 50)
        const got = await askEveryWay(chunk, channel, logins)
        if (got.quota) { quotaOut = true; break }
        for (const [id, f] of got.found) { await writeFresh(sb, userId, id, f, stamp, column, channel); refreshed++ }
        if (got.gone.length) { await clearYouTubeData(sb, userId, got.gone); cleared += got.gone.length }
      }
    }
  }
  return { refreshed, cleared, users: byUser.size, column, ...(quotaOut ? { stoppedFor: 'quota' as const } : timeOut ? { stoppedFor: 'time' as const } : {}) }
}

/** REFILL WHAT WAS EMPTIED: rows with no title, for creators still connected
 *  to YouTube in MVP, are asked for again and refilled when YouTube shows
 *  them. Never empties anything. A row asked about is stamped, so one YouTube
 *  no longer shows is asked again a day later, not every run. */
export async function restorePass(sb: Sb, maxRows = 2000, deadlineAt = Infinity, opts: { userId?: string; everyRow?: boolean } = {}): Promise<{ restored: number; stillMissing: number; users: number; stoppedFor?: 'quota' | 'time' }> {
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString()
  const base = () => { let q = sb.from('youtube_videos').select('user_id,youtube_video_id,channel_id').eq('title', ''); if (opts.userId) q = q.eq('user_id', opts.userId); return q }
  // everyRow (the admin's Refill now): every emptied row, whatever it was last
  // asked, for one creator.
  let { data: rows, error } = opts.everyRow ? await base().limit(maxRows) : await base().or(`yt_refreshed_at.is.null,yt_refreshed_at.lt.${dayAgo}`).limit(maxRows)
  const stampable = !error
  if (error) ({ data: rows } = await base().limit(maxRows))
  const byUser = new Map<string, Array<{ id: string; channel: string }>>()
  for (const r of (rows ?? []) as Array<{ user_id: string; youtube_video_id: string; channel_id: string }>) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(r.youtube_video_id || '')) continue
    byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), { id: r.youtube_video_id, channel: r.channel_id }])
  }
  let restored = 0, stillMissing = 0
  let quotaOut = false, timeOut = false
  const stamp = new Date().toISOString()
  for (const [userId, vids] of byUser) {
    if (quotaOut || timeOut) break
    if (Date.now() > deadlineAt) { timeOut = true; break }
    const { data: chans } = await sb.from('youtube_channels').select('channel_id').eq('user_id', userId)
    const { data: integ } = await sb.from('integrations').select('youtube_oauth_refresh_token').eq('user_id', userId).maybeSingle()
    if (!connectedOf(chans, integ)) continue
    const logins = await loginsOf(sb, userId)
    const byChannel = new Map<string, string[]>()
    for (const v of vids) byChannel.set(v.channel, [...(byChannel.get(v.channel) ?? []), v.id])
    for (const [channel, ids] of byChannel) {
      if (quotaOut || timeOut) break
      for (let i = 0; i < ids.length; i += 50) {
        if (Date.now() > deadlineAt) { timeOut = true; break }
        const chunk = ids.slice(i, i + 50)
        const got = await askEveryWay(chunk, channel, logins)
        if (got.quota) { quotaOut = true; break }
        for (const [id, f] of got.found) { await writeFresh(sb, userId, id, f, stamp, stampable ? 'yt_refreshed_at' : 'updated_at', channel); restored++ }
        const missing = chunk.filter((id) => !got.found.has(id))
        stillMissing += missing.length
        if (missing.length && stampable) await sb.from('youtube_videos').update({ yt_refreshed_at: stamp }).eq('user_id', userId).in('youtube_video_id', missing)
      }
    }
  }
  return { restored, stillMissing, users: byUser.size, ...(quotaOut ? { stoppedFor: 'quota' as const } : timeOut ? { stoppedFor: 'time' as const } : {}) }
}
