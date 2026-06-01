import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

export const maxDuration = 120

export async function GET(req: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Multi-site: ?siteId=<uuid> targets a specific site; omitted → default.
    // Used by /attach-video modal — Pro multi-site users pick which site's
    // legacy posts to list. Single-site users see no UI affordance.
    const url = new URL(req.url)
    const siteId = url.searchParams.get('siteId')
    const site = await getWordPressCredentials(supabase, user.id, siteId)
    if (!site) {
      return NextResponse.json({ error: 'WordPress not connected' }, { status: 400 })
    }

    const base = site.wordpress_url.replace(/\/$/, '')
    const auth = Buffer.from(`${site.wordpress_username}:${site.wordpress_app_password.replace(/\s+/g, '')}`).toString('base64')
    const headers = { Authorization: `Basic ${auth}` }

    type RawPost = { id: number; title: { rendered: string }; link: string; date: string; featured_media: number }
    type RawMedia = { id: number; source_url: string }

    // ── 1. Fetch all posts (lightweight — no embed) ───────────────────────────
    const rawPosts: RawPost[] = []
    let page = 1
    while (true) {
      const res = await fetch(
        `${base}/wp-json/wp/v2/posts?per_page=100&page=${page}&status=publish&orderby=date&order=desc&_fields=id,title,link,date,featured_media`,
        { headers },
      )
      if (!res.ok) {
        const body = await res.text()
        if (page === 1) return NextResponse.json({ error: `WordPress ${res.status}: ${body.slice(0, 200)}` }, { status: 502 })
        break
      }
      const batch = await res.json() as RawPost[]
      if (!batch.length) break
      rawPosts.push(...batch)
      const totalPages = parseInt(res.headers.get('X-WP-TotalPages') || '1', 10)
      if (page >= totalPages) break
      page++
    }

    // ── 2. Fetch thumbnails in one batch per 100 media IDs ────────────────────
    const mediaIds = [...new Set(rawPosts.map(p => p.featured_media).filter(Boolean))]
    const thumbMap: Record<number, string> = {}
    for (let i = 0; i < mediaIds.length; i += 100) {
      const chunk = mediaIds.slice(i, i + 100)
      try {
        const mRes = await fetch(
          `${base}/wp-json/wp/v2/media?include=${chunk.join(',')}&per_page=100&_fields=id,source_url`,
          { headers },
        )
        if (mRes.ok) {
          const media = await mRes.json() as RawMedia[]
          for (const m of media) thumbMap[m.id] = m.source_url
        }
      } catch { /* thumbnails are non-fatal */ }
    }

    // ── 3. Build videoId map — fetch all blog_posts with video_id in one query ─
    // Then match in-memory via: wordpress_post_id, wordpress_url slug, or stored slug.
    // This avoids multi-query .in() issues and handles URL/slug normalization cleanly.
    const { data: allDbPosts } = await supabase
      .from('blog_posts')
      .select('wordpress_post_id,slug,wordpress_url,video_id')
      .eq('user_id', user.id)
      .not('video_id', 'is', null)
      .limit(2000)

    type DbPost = { wordpress_post_id: number | null; slug: string | null; wordpress_url: string | null; video_id: string }
    const normalize = (url: string) => url.replace(/\/$/, '').toLowerCase()

    const wpToVideoId: Record<number, string> = {}
    const urlToVideoId: Record<string, string> = {}
    const slugToVideoId: Record<string, string> = {}

    for (const p of (allDbPosts ?? []) as DbPost[]) {
      if (!p.video_id) continue
      if (p.wordpress_post_id) wpToVideoId[p.wordpress_post_id] = p.video_id
      if (p.wordpress_url) urlToVideoId[normalize(p.wordpress_url)] = p.video_id
      if (p.slug) slugToVideoId[p.slug] = p.video_id
    }

    // ── 4. For still-unmapped posts, extract YouTube ID from thumbnail filename
    const ytVideoIds = new Set<string>()
    for (const p of rawPosts) {
      const normUrl = normalize(p.link)
      const urlSlug = normUrl.split('/').filter(Boolean).pop() ?? ''
      if (wpToVideoId[p.id] || urlToVideoId[normUrl] || slugToVideoId[urlSlug]) continue
      const thumb = thumbMap[p.featured_media]
      if (!thumb) continue
      const filename = thumb.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''
      if (/^[A-Za-z0-9_-]{11}$/.test(filename)) ytVideoIds.add(filename)
    }

    const ytIdToRowId: Record<string, string> = {}
    if (ytVideoIds.size > 0) {
      const { data: ytRows } = await supabase
        .from('youtube_videos')
        .select('id,youtube_video_id')
        .eq('user_id', user.id)
        .in('youtube_video_id', [...ytVideoIds])
      for (const r of (ytRows ?? []) as { id: string; youtube_video_id: string }[]) {
        ytIdToRowId[r.youtube_video_id] = r.id
      }
    }

    // ── 5. Assemble final list ────────────────────────────────────────────────
    const posts = rawPosts.map(p => {
      const normUrl = normalize(p.link)
      const urlSlug = normUrl.split('/').filter(Boolean).pop() ?? ''
      let videoId = wpToVideoId[p.id] ?? urlToVideoId[normUrl] ?? slugToVideoId[urlSlug] ?? null
      if (!videoId) {
        const thumb = thumbMap[p.featured_media]
        const filename = thumb?.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''
        if (/^[A-Za-z0-9_-]{11}$/.test(filename)) videoId = ytIdToRowId[filename] ?? null
      }
      return {
        id: p.id,
        title: p.title?.rendered ?? '',
        link: p.link,
        date: p.date,
        thumbnail: thumbMap[p.featured_media] ?? null,
        videoId,
      }
    })

    return NextResponse.json({ posts })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
