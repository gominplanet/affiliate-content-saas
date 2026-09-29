// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A POST WAITS FOR ITS VIDEO.
//
// MVP writes posts only from videos the public can watch (lib/video-public),
// but posts written before that rule, or written while a video was public and
// then made private, can be live with a video nobody can play. This finds
// them, switches each to a WordPress draft, and publishes it again, dated that
// day, once YouTube says the video is live.
//
// ONLY MVP'S OWN HOLDS ARE RELEASED. A hold is recorded on the post
// (blog_posts.waiting_for_video_since, migration 388) and only a post carrying
// it is ever published again; a draft the creator made stays a draft. A post
// the creator published, trashed or rescheduled themselves while it waited is
// let go without touching it.
//
// EVERY WRITE GOES TO THE POST'S OWN SITE (lib/post-site credsForPost) and is
// checked to be the same post first (checkSamePost): WordPress numbers repeat
// across a creator's sites.

import { createWordPressService } from '@/services/wordpress'
import { credsForPost, checkSamePost } from '@/lib/post-site'
import { videosNotPublic } from '@/lib/video-public'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

/** Posts newer than this are checked on every run; older ones only when
 *  their video's own publish time is still ahead. */
const RECENT_DAYS = 45
const MAX_POSTS = 400

type Row = {
  id: string; user_id: string; title: string | null; wordpress_post_id: number | null
  wordpress_url: string | null; wordpress_site_id: string | null
  waiting_for_video_since: string | null
  youtube_videos: { youtube_video_id: string | null; published_at: string | null } | null
}

const SELECT = 'id, user_id, title, wordpress_post_id, wordpress_url, wordpress_site_id, waiting_for_video_since, youtube_videos(youtube_video_id, published_at)'

export type HoldReport = {
  held: Array<{ postId: string; title: string | null; until: string | null }>
  released: Array<{ postId: string; title: string | null }>
  letGo: number
  failed: Array<{ postId: string; reason: string }>
  missingColumn?: boolean
}

export async function holdAndRelease(sb: Sb): Promise<HoldReport> {
  const out: HoldReport = { held: [], released: [], letGo: 0, failed: [] }

  // ── the posts waiting, and the published ones that might need to ──────────
  const waitingQ = await sb.from('blog_posts').select(SELECT)
    .not('waiting_for_video_since', 'is', null).not('wordpress_post_id', 'is', null).limit(MAX_POSTS)
  if (waitingQ.error) {
    if (/waiting_for_video/.test(waitingQ.error.message || '')) out.missingColumn = true
    return out // without the marker nothing can be held safely: it could never be let go
  }
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString()
  const recentQ = await sb.from('blog_posts').select(SELECT)
    .eq('status', 'published').is('waiting_for_video_since', null)
    .not('wordpress_post_id', 'is', null).not('video_id', 'is', null)
    .gte('created_at', since).order('created_at', { ascending: false }).limit(MAX_POSTS)
  // Older posts whose video is still scheduled.
  const futureVids = await sb.from('youtube_videos').select('id').gt('published_at', new Date().toISOString()).limit(1000)
  const futureIds = ((futureVids.data ?? []) as Array<{ id: string }>).map((v) => v.id)
  const olderQ = futureIds.length
    ? await sb.from('blog_posts').select(SELECT)
      .eq('status', 'published').is('waiting_for_video_since', null)
      .not('wordpress_post_id', 'is', null).in('video_id', futureIds.slice(0, 500)).limit(MAX_POSTS)
    : { data: [] }

  const waiting = (waitingQ.data ?? []) as Row[]
  const live = new Map<string, Row>()
  for (const r of [...((recentQ.data ?? []) as Row[]), ...((olderQ.data ?? []) as Row[])]) live.set(r.id, r)

  const all = [...waiting, ...live.values()].filter((r) => r.youtube_videos?.youtube_video_id)
  if (!all.length) return out
  const notPublic = new Map((await videosNotPublic(all.map((r) => ({
    youtubeVideoId: r.youtube_videos!.youtube_video_id as string,
    publishedAt: r.youtube_videos!.published_at,
  })))).map((n) => [n.youtubeVideoId, n]))

  const wpFor = async (r: Row) => {
    const site = await credsForPost(sb, r.user_id, r).catch(() => null)
    if (!site || !r.wordpress_post_id) return null
    const wp = createWordPressService(site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined)
    const same = await checkSamePost(wp, r.wordpress_post_id, r.wordpress_url)
    if (!same.ok) return { error: same.error }
    const who = await wp.getPostIdentity(r.wordpress_post_id)
    if (!who.ok) return { error: who.reason }
    return { wp, status: who.status }
  }
  const clear = (id: string) => sb.from('blog_posts').update({ waiting_for_video_since: null, waiting_for_video_until: null }).eq('id', id)

  // ── release: the video is live now ────────────────────────────────────────
  for (const r of waiting) {
    const n = notPublic.get(r.youtube_videos?.youtube_video_id || '')
    if (n) {
      // Still waiting: keep the due time current for the screen.
      await sb.from('blog_posts').update({ waiting_for_video_until: n.goesLiveAt }).eq('id', r.id)
      continue
    }
    try {
      const c = await wpFor(r)
      if (!c) continue
      if ('error' in c) { out.failed.push({ postId: r.id, reason: c.error as string }); continue }
      // The creator acted on it while it waited: theirs, not ours to publish.
      if (c.status !== 'draft') { await clear(r.id); out.letGo++; continue }
      // Dated today: it is new to readers today, and a date weeks before the
      // video existed would read as a mistake.
      await c.wp.updatePost(r.wordpress_post_id as number, { status: 'publish', date: new Date().toISOString() })
      await clear(r.id)
      out.released.push({ postId: r.id, title: r.title })
    } catch (e) {
      out.failed.push({ postId: r.id, reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) })
    }
  }

  // ── hold: live on the blog, video not playable ────────────────────────────
  for (const r of live.values()) {
    const n = notPublic.get(r.youtube_videos?.youtube_video_id || '')
    if (!n) continue
    try {
      const c = await wpFor(r)
      if (!c) continue
      if ('error' in c) { out.failed.push({ postId: r.id, reason: c.error as string }); continue }
      // Only a post that is live now. A scheduled one ('future') the creator
      // timed themselves; a draft is already not shown.
      if (c.status !== 'publish') continue
      // Marked first, so a draft MVP made is never one it does not know about.
      // If the write then fails, the mark comes off again (below) and the
      // next run tries again as if nothing happened.
      const mark = await sb.from('blog_posts').update({ waiting_for_video_since: new Date().toISOString(), waiting_for_video_until: n.goesLiveAt }).eq('id', r.id)
      if (mark.error) { out.failed.push({ postId: r.id, reason: mark.error.message }); continue }
      await c.wp.updatePost(r.wordpress_post_id as number, { status: 'draft' })
      out.held.push({ postId: r.id, title: r.title, until: n.goesLiveAt })
    } catch (e) {
      await clear(r.id)
      out.failed.push({ postId: r.id, reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) })
    }
  }
  return out
}
