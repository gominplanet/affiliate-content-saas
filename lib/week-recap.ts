// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE WEEK RECAP: what MVP did for the creator last week, read from the
// database only. Seb: no weekly email; a page inside MVP that the top bar
// flashes until it is opened.
//
// Every number is a count of rows that actually exist (a post published, a
// comment posted, a click logged), never of what was planned. A source that
// cannot be read is named in `unread` and shown as "could not be read", which
// is not the same as zero.

import { AUTO_SKIP_PREFIX, AUTO_FAILED_PREFIX, RESOLVED_PREFIX, platformLabel } from '@/lib/channel-health'
import { UPLOAD_MARKET } from '@/lib/markets'
import type { WeekWindow } from '@/lib/week-window'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

export type RecapLink = { title: string; url: string | null }
export type WeekRecap = {
  week: { key: string; label: string; start: string; end: string }
  videos: { count: number; items: RecapLink[] } | null
  posts: { count: number; items: RecapLink[] } | null
  social: { sent: number; failed: number; byPlatform: Array<{ platform: string; count: number }> } | null
  amazonVideos: number | null
  pinnedComments: number | null
  encoreComments: number | null
  postUpdates: number | null
  clicks: { count: number; previous: number; topCountries: Array<{ country: string; count: number }> } | null
  unread: string[]
}

const SHOW = 6

export async function gatherWeek(sb: Sb, ownerId: string, w: WeekWindow, prev: WeekWindow): Promise<WeekRecap> {
  const s = w.start.toISOString(), e = w.end.toISOString()
  const unread: string[] = []
  const out: WeekRecap = {
    week: { key: w.key, label: w.label, start: s, end: e },
    videos: null, posts: null, social: null, amazonVideos: null, pinnedComments: null,
    encoreComments: null, postUpdates: null, clicks: null, unread,
  }
  async function read(label: string, fn: () => Promise<void>) {
    try { await fn() } catch { unread.push(label) }
  }
  const ok = <T,>(r: { data: T | null; error: { message?: string } | null; count?: number | null }) => {
    if (r.error) throw new Error(r.error.message || 'read failed')
    return r
  }
  const count = async (q: Sb): Promise<number> => (ok(await q).count ?? 0)

  await Promise.all([
    read('YouTube videos', async () => {
      const r = ok(await sb.from('youtube_videos').select('title,youtube_video_id', { count: 'exact' })
        .eq('user_id', ownerId).gte('published_at', s).lt('published_at', e)
        .order('published_at', { ascending: false, nullsFirst: false }).limit(SHOW))
      out.videos = {
        count: r.count ?? 0,
        items: ((r.data ?? []) as Array<{ title: string | null; youtube_video_id: string | null }>).map((v) => ({
          title: v.title || 'Untitled video', url: v.youtube_video_id ? `https://www.youtube.com/watch?v=${v.youtube_video_id}` : null,
        })),
      }
    }),
    read('blog posts', async () => {
      const r = ok(await sb.from('blog_posts').select('title,wordpress_url', { count: 'exact' })
        .eq('user_id', ownerId).eq('status', 'published').gte('published_at', s).lt('published_at', e)
        .order('published_at', { ascending: false, nullsFirst: false }).limit(SHOW))
      out.posts = {
        count: r.count ?? 0,
        items: ((r.data ?? []) as Array<{ title: string | null; wordpress_url: string | null }>).map((p) => ({ title: p.title || 'Untitled post', url: p.wordpress_url })),
      }
    }),
    read('social posts', async () => {
      const r = ok(await sb.from('scheduled_posts').select('platform,status,error_message')
        .eq('user_id', ownerId).in('status', ['completed', 'failed']).gte('updated_at', s).lt('updated_at', e).limit(2000))
      const rows = (r.data ?? []) as Array<{ platform: string | null; status: string; error_message: string | null }>
      const by = new Map<string, number>()
      let sent = 0, failed = 0
      for (const p of rows) {
        if (p.status === 'completed') {
          sent++
          const k = p.platform || 'other'
          by.set(k, (by.get(k) ?? 0) + 1)
        } else {
          const em = p.error_message || ''
          if (!(em.startsWith(AUTO_SKIP_PREFIX) || em.startsWith(RESOLVED_PREFIX) || em.startsWith(AUTO_FAILED_PREFIX))) failed++
        }
      }
      out.social = {
        sent, failed,
        byPlatform: [...by.entries()].map(([platform, n]) => ({ platform: platformLabel(platform), count: n })).sort((a, b) => b.count - a.count),
      }
    }),
    read('Amazon uploads', async () => {
      out.amazonVideos = await count(sb.from('global_sync_targets').select('id', { count: 'exact', head: true })
        .eq('user_id', ownerId).eq('domain', UPLOAD_MARKET).eq('state', 'delivered').gte('delivered_at', s).lt('delivered_at', e))
    }),
    read('pinned comments', async () => {
      out.pinnedComments = await count(sb.from('video_first_comments').select('id', { count: 'exact', head: true })
        .eq('user_id', ownerId).gte('posted_at', s).lt('posted_at', e))
    }),
    read('Encore comments', async () => {
      out.encoreComments = await count(sb.from('sale_comments').select('id', { count: 'exact', head: true })
        .eq('user_id', ownerId).gte('posted_at', s).lt('posted_at', e))
    }),
    read('post updates', async () => {
      out.postUpdates = await count(sb.from('blog_posts').select('id', { count: 'exact', head: true })
        .eq('user_id', ownerId).gte('refreshed_at', s).lt('refreshed_at', e))
    }),
    read('Passport clicks', async () => {
      // Human clicks only: link-preview fetchers and crawlers (browser 'Bot')
      // are left out, as on the Passport page. Rows from before the browser
      // was recorded have none and count as people.
      const human = (q: Sb) => q.or('browser.is.null,browser.neq.Bot')
      const total = await count(human(sb.from('passport_link_clicks').select('id', { count: 'exact', head: true })
        .eq('user_id', ownerId).gte('created_at', s).lt('created_at', e)))
      const previous = await count(human(sb.from('passport_link_clicks').select('id', { count: 'exact', head: true })
        .eq('user_id', ownerId).gte('created_at', prev.start.toISOString()).lt('created_at', prev.end.toISOString())))
      // Countries from every row, read in pages (1,000 per request at most).
      const by = new Map<string, number>()
      for (let from = 0; from < 20000; from += 1000) {
        const r = ok(await human(sb.from('passport_link_clicks').select('country')
          .eq('user_id', ownerId).gte('created_at', s).lt('created_at', e)).order('created_at').order('id').range(from, from + 999))
        const rows = (r.data ?? []) as Array<{ country: string | null }>
        for (const c of rows) {
          const k = (c.country || '').toUpperCase() || 'Unknown'
          by.set(k, (by.get(k) ?? 0) + 1)
        }
        if (rows.length < 1000) break
      }
      out.clicks = {
        count: total, previous,
        topCountries: [...by.entries()].map(([country, n]) => ({ country, count: n })).sort((a, b) => b.count - a.count).slice(0, 6),
      }
    }),
  ])
  unread.sort()
  return out
}
