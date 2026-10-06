// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/facebook/hub  everything the creator made in MVP that can go to
//                         Facebook, with where each piece already is:
//                           reviews  their published blog posts
//                           clips    their rendered Clip Factory clips (Reel length)
//                           videos   their public YouTube videos with no clip yet
//                         plus the history of what MVP put on Facebook.
// POST /api/facebook/hub  { kind, sourceId, videoId, title, groupUrl,
//                           groupPostUrl, pagePostUrl }  record one push.
//
// The hub's one rule: the Group gets the post with the link, the Page gets a
// post (or Reel) pointing to it. Facebook only: nothing here reads TikTok,
// Instagram or anything else.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { facebookSetupEnabled } from '@/lib/facebook-link-budget'

export const dynamic = 'force-dynamic'

/** Facebook allows Page Reels of 3 to 90 seconds. */
const REEL_MAX_SEC = 90

type Push = { kind: string; source_id: string | null; video_id: string | null; title: string | null; group_url: string | null; group_post_url: string | null; page_post_url: string | null; created_at: string }

async function gate() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const { data: integ } = await admin.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!facebookSetupEnabled(integ?.tier)) return { res: NextResponse.json({ ok: true, on: false }) }
  return { user, admin }
}

/** Where a piece stands on Facebook, from every push recorded for it. Pure. */
function placeOf(pushes: Push[]): { status: 'none' | 'group' | 'both'; groupPostUrl: string | null; pagePostUrl: string | null; at: string | null } {
  if (!pushes.length) return { status: 'none', groupPostUrl: null, pagePostUrl: null, at: null }
  const both = pushes.find((p) => p.group_post_url && p.page_post_url)
  const latest = both ?? pushes[0]
  return {
    status: both ? 'both' : pushes.some((p) => p.group_post_url) ? 'group' : 'none',
    groupPostUrl: latest.group_post_url, pagePostUrl: latest.page_post_url, at: latest.created_at,
  }
}

export async function GET() {
  const g = await gate()
  if ('res' in g) return g.res
  const { user, admin } = g
  const now = new Date().toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any
  const [postsQ, clipsQ, videosQ, pushQ] = await Promise.all([
    db.from('blog_posts').select('id,title,wordpress_url,video_id,created_at')
      .eq('user_id', user.id).eq('status', 'published').not('wordpress_url', 'is', null)
      .order('created_at', { ascending: false }).limit(40),
    db.from('youtube_shorts').select('id,video_id,hook,rendered_url,start_sec,end_sec,created_at,status')
      .eq('user_id', user.id).eq('status', 'rendered').not('rendered_url', 'is', null)
      .order('created_at', { ascending: false }).limit(60),
    db.from('youtube_videos').select('id,title,thumbnail_url,published_at,youtube_video_id')
      .eq('user_id', user.id).lte('published_at', now)
      .order('published_at', { ascending: false, nullsFirst: false }).limit(40),
    db.from('facebook_posts').select('kind,source_id,video_id,title,group_url,group_post_url,page_post_url,created_at')
      .eq('user_id', user.id).order('created_at', { ascending: false }).limit(300),
  ])
  const { data: brand } = await db.from('brand_profiles').select('affiliate_disclaimer').eq('user_id', user.id).maybeSingle()

  const pushes: Push[] = pushQ.error ? [] : (pushQ.data ?? [])
  const recorded = !pushQ.error
  const byKey = new Map<string, Push[]>()
  const add = (k: string, p: Push) => byKey.set(k, [...(byKey.get(k) ?? []), p])
  for (const p of pushes) {
    add(`${p.kind}:${p.source_id ?? ''}`, p)
    // A clip re-burned in Enhance posts from a new file address, so it is
    // also matched by its video and title.
    if (p.kind === 'clip' && p.video_id && p.title) add(`clipv:${p.video_id}:${p.title}`, p)
  }

  const titles = new Map<string, string>()
  for (const v of (videosQ.data ?? []) as Array<{ id: string; title: string | null }>) titles.set(v.id, v.title ?? '')

  const reviews = ((postsQ.data ?? []) as Array<{ id: string; title: string | null; wordpress_url: string; video_id: string | null; created_at: string }>)
    .map((p) => ({ id: p.id, title: p.title || 'Untitled review', url: p.wordpress_url, videoId: p.video_id, createdAt: p.created_at, ...placeOf(byKey.get(`blog:${p.id}`) ?? []) }))

  const clipRows = ((clipsQ.data ?? []) as Array<{ id: string; video_id: string; hook: string | null; rendered_url: string; start_sec: number; end_sec: number; created_at: string }>)
  const clips = clipRows
    .map((c) => ({ id: c.id, title: c.hook || titles.get(c.video_id) || 'Clip', videoId: c.video_id, videoTitle: titles.get(c.video_id) ?? null, url: c.rendered_url, seconds: Math.round(Number(c.end_sec) - Number(c.start_sec)), createdAt: c.created_at, ...placeOf(byKey.get(`clip:${c.rendered_url}`) ?? byKey.get(`clipv:${c.video_id}:${c.hook || ''}`) ?? []) }))
    .filter((c) => c.seconds >= 3 && c.seconds <= REEL_MAX_SEC)

  // Videos with no rendered clip yet: the next Reels to make.
  const clipped = new Set(clipRows.map((c) => c.video_id))
  const videos = ((videosQ.data ?? []) as Array<{ id: string; title: string | null; thumbnail_url: string | null; published_at: string | null }>)
    .filter((v) => !clipped.has(v.id))
    .slice(0, 12)
    .map((v) => ({ id: v.id, title: v.title || 'Video', thumbnailUrl: v.thumbnail_url, publishedAt: v.published_at }))

  const history = pushes.slice(0, 30).map((p) => ({
    kind: p.kind, title: p.title, groupPostUrl: p.group_post_url, pagePostUrl: p.page_post_url, at: p.created_at,
  }))

  // IN THE GROUP, NOT ON THE PAGE YET: Group posts whose Page post never went
  // out (Facebook refused it, the tab closed, an older SCOUT). Newest first, one
  // per Group post, and gone once any push for that Group post reached the Page.
  const onPage = new Set(pushes.filter((p) => p.group_post_url && p.page_post_url).map((p) => p.group_post_url as string))
  const seenGroupPost = new Set<string>()
  const pending = pushes.filter((p) => {
    const g = p.group_post_url
    if (!g || p.page_post_url || onPage.has(g) || seenGroupPost.has(g)) return false
    seenGroupPost.add(g)
    return true
  }).slice(0, 25)
  // The thumbnail a review's Page post carries: its video's, when it has one.
  const blogIds = pending.filter((p) => p.kind === 'blog' && p.source_id).map((p) => p.source_id as string)
  const thumbs = new Map<string, string>()
  if (blogIds.length) {
    const { data: bp } = await db.from('blog_posts').select('id,video_id').eq('user_id', user.id).in('id', blogIds)
    const vids = ((bp ?? []) as Array<{ id: string; video_id: string | null }>).filter((r) => r.video_id)
    if (vids.length) {
      const { data: vv } = await db.from('youtube_videos').select('id,thumbnail_url').eq('user_id', user.id).in('id', vids.map((r) => r.video_id))
      const t = new Map(((vv ?? []) as Array<{ id: string; thumbnail_url: string | null }>).map((v) => [v.id, v.thumbnail_url]))
      for (const r of vids) { const u = t.get(r.video_id as string); if (u) thumbs.set(r.id, u) }
    }
  }
  const unfinished = pending.map((p) => ({
    kind: p.kind, title: p.title, sourceId: p.source_id, videoId: p.video_id, groupUrl: p.group_url,
    groupPostUrl: p.group_post_url as string, at: p.created_at,
    // A clip's Page Reel needs the clip itself: its address is the source id.
    clipUrl: p.kind === 'clip' && p.source_id && /^https:\/\//i.test(p.source_id) ? p.source_id : null,
    imageUrl: p.kind === 'blog' && p.source_id ? thumbs.get(p.source_id) ?? null : null,
  }))

  return NextResponse.json({ ok: true, on: true, recorded, reviews, clips, videos, history, unfinished, disclaimer: (brand?.affiliate_disclaimer as string | null) ?? null })
}

export async function POST(req: Request) {
  const g = await gate()
  if ('res' in g) return g.res
  const { user, admin } = g
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  // 'post': a Group post made outside MVP, shared on the Page from Meta Hub.
  const kind = b.kind === 'blog' || b.kind === 'clip' || b.kind === 'post' ? b.kind : null
  if (!kind) return NextResponse.json({ error: 'Which kind of post?' }, { status: 400 })
  const str = (v: unknown, n = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
  const fb = (v: unknown) => { const s = str(v); return s && /^https:\/\/(www\.|web\.|m\.)?facebook\.com\//i.test(s) ? s : null }
  const uuid = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('facebook_posts').insert({
    user_id: user.id, kind, source_id: str(b.sourceId), video_id: uuid(b.videoId), title: str(b.title, 200),
    group_url: fb(b.groupUrl), group_post_url: fb(b.groupPostUrl), page_post_url: fb(b.pagePostUrl),
  })
  if (error) return NextResponse.json({ ok: false, error: /facebook_posts/.test(error.message || '') ? 'Needs migration 402.' : error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
