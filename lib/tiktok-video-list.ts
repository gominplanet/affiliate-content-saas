// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MATCH MY TIKTOK THE OFFICIAL WAY: TikTok's video list API (Display API,
// scope video.list), from MVP's server with the creator's own TikTok
// connection. No tab, nothing in the creator's Chrome, and a daily check that
// runs while they sleep (Seb, 2026-11-09: "build both, but we're going to use
// Scout to start since I don't have the permission").
//
// OFF UNTIL TIKTOK APPROVES THE SCOPE. Asking TikTok for a scope the app is
// not approved for makes the whole connection fail, so posting to TikTok
// would break for everyone. MVP asks for video.list only when the switch
// TIKTOK_VIDEO_LIST is "on" in Vercel, which is set once TikTok approves it
// on the developer portal. Until then MVP never asks, and the page uses SCOUT.
//
// What it gives: each video's id, caption, date, cover, link and counts. What
// it does not: TikTok Shop product tags, so matching here reads the caption.

import { parseOfficialVideo, type TikTokVideo } from './tiktok-videos'

export const VIDEO_LIST_SCOPE = 'video.list'
const LIST_URL = 'https://open.tiktokapis.com/v2/video/list/'
const FIELDS = 'id,title,video_description,create_time,cover_image_url,share_url,duration,view_count,like_count'

/** Whether MVP may ask TikTok for the video list scope (set in Vercel once
 *  TikTok approves it). */
export function videoListSwitchOn(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.TIKTOK_VIDEO_LIST || '').trim().toLowerCase() === 'on'
}

/** The scopes MVP's TikTok connection asks for: posting always, the video list
 *  only when the switch is on. */
export function tiktokScopes(env: Record<string, string | undefined> = process.env): string {
  const base = ['user.info.basic', 'user.info.profile', 'video.upload', 'video.publish']
  return (videoListSwitchOn(env) ? [...base, VIDEO_LIST_SCOPE] : base).join(',')
}

export function scopesIncludeVideoList(scopeStr: string | null | undefined): boolean {
  return !!scopeStr && scopeStr.split(/[\s,]+/).includes(VIDEO_LIST_SCOPE)
}

export interface VideoListPage {
  videos: TikTokVideo[]
  cursor: number | null
  hasMore: boolean
  error: string | null
}

/** One page (up to 20 videos) of the creator's public videos, newest first. */
export async function videoListPage(token: string, handle: string, cursor: number | null, fetchImpl: typeof fetch = fetch): Promise<VideoListPage> {
  try {
    const res = await fetchImpl(`${LIST_URL}?fields=${FIELDS}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cursor ? { max_count: 20, cursor } : { max_count: 20 }),
    })
    const j = (await res.json().catch(() => null)) as { data?: { videos?: unknown[]; cursor?: number; has_more?: boolean }; error?: { code?: string; message?: string } } | null
    const code = j?.error?.code
    if (!res.ok || (code && code !== 'ok')) {
      const why = code === 'scope_not_authorized' ? 'Your TikTok connection does not allow MVP to read your videos yet. Connect TikTok again.'
        : code === 'access_token_invalid' ? 'Your TikTok connection has expired. Connect TikTok again.'
        : `TikTok answered ${res.status}${j?.error?.message ? `: ${j.error.message}` : ''}.`
      return { videos: [], cursor: null, hasMore: false, error: why }
    }
    const videos = (j?.data?.videos || []).map((v) => parseOfficialVideo(v, handle)).filter((v): v is TikTokVideo => !!v)
    return { videos, cursor: typeof j?.data?.cursor === 'number' ? j.data.cursor : null, hasMore: !!j?.data?.has_more, error: null }
  } catch (e) {
    return { videos: [], cursor: null, hasMore: false, error: `TikTok could not be reached (${e instanceof Error ? e.message : 'error'}).` }
  }
}

/** Page through the creator's videos until the end, the time is up, or a
 *  page holds only videos MVP already has (the daily check). */
export async function readVideoList(token: string, handle: string, opts: { deadline: number; maxPages?: number; known?: Set<string>; fetchImpl?: typeof fetch }): Promise<{ videos: TikTokVideo[]; reachedEnd: boolean; error: string | null; pages: number }> {
  const out: TikTokVideo[] = []
  let cursor: number | null = null
  let pages = 0
  for (; pages < (opts.maxPages ?? 150); ) {
    if (Date.now() > opts.deadline) return { videos: out, reachedEnd: false, error: null, pages }
    const p = await videoListPage(token, handle, cursor, opts.fetchImpl)
    pages++
    if (p.error) return { videos: out, reachedEnd: false, error: p.error, pages }
    out.push(...p.videos)
    if (opts.known && p.videos.length && p.videos.every((v) => opts.known!.has(v.id))) return { videos: out, reachedEnd: false, error: null, pages }
    if (!p.hasMore || p.cursor == null) return { videos: out, reachedEnd: true, error: null, pages }
    cursor = p.cursor
  }
  return { videos: out, reachedEnd: false, error: null, pages }
}
