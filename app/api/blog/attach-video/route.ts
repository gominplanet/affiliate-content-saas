/**
 * POST /api/blog/attach-video — link a YouTube video to a legacy WordPress
 * post so the existing /api/blog/generate pipeline can rebuild the body in
 * place.
 *
 * Why this exists:
 *   Pre-MVP posts on a creator's site got a low SEO score because they
 *   don't have a comparison table / pros-cons / specs — and there's no
 *   source video in MVP's DB to ground a real rewrite on. This route lets
 *   the creator paste a YouTube URL for the legacy post and:
 *     1. Imports the YT video into youtube_videos.
 *     2. Pulls the legacy WP post's title/slug/content via REST.
 *     3. Creates (or updates) a blog_posts row that links the WP post id
 *        to the new video. Subsequent /api/blog/generate calls with that
 *        videoId will UPDATE the same WP post (preserving slug + Google
 *        indexing) instead of creating a new one.
 *
 * Body: { wordpressPostId: number, youtubeUrl: string }
 * Returns: { videoId: string, blogPostId: string, wordpressPostId: number }
 *
 * Errors are categorised so the modal can show a useful message instead of
 * a generic 500.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

export const maxDuration = 60

/** Extract an 11-char YouTube video ID from any of the common URL shapes:
 *  /watch?v=, youtu.be/, /shorts/, /embed/, /v/. Returns null when the
 *  string doesn't carry a recognisable YouTube ID. */
function parseYouTubeId(input: string): string | null {
  const s = (input || '').trim()
  if (!s) return null
  // Bare 11-char id — already an id, not a URL.
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s
  try {
    const u = new URL(s)
    const host = u.hostname.replace(/^www\./i, '').toLowerCase()
    // youtu.be/<id>
    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0]
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
    }
    // youtube.com/* paths
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const v = u.searchParams.get('v')
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v
      // /shorts/<id>, /embed/<id>, /v/<id>, /live/<id>
      const m = u.pathname.match(/^\/(?:shorts|embed|v|live)\/([A-Za-z0-9_-]{11})/)
      if (m) return m[1]
    }
  } catch { /* not a URL */ }
  return null
}

interface YtSnippetResponse {
  items?: Array<{
    snippet?: {
      title?: string
      description?: string
      channelId?: string
      channelTitle?: string
      publishedAt?: string
      thumbnails?: {
        maxres?: { url?: string }
        high?: { url?: string }
        medium?: { url?: string }
        default?: { url?: string }
      }
    }
    contentDetails?: { duration?: string }
    statistics?: { viewCount?: string }
  }>
}

/** Pull title + description + channel + thumbnail for a single video via the
 *  YouTube Data API key (no OAuth — public metadata only). Returns null when
 *  the id doesn't resolve or the API rejects the key. */
async function fetchYouTubeMetadata(apiKey: string, videoId: string) {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos')
  url.searchParams.set('part', 'snippet,contentDetails,statistics')
  url.searchParams.set('id', videoId)
  url.searchParams.set('key', apiKey)
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) return null
  const data = await res.json() as YtSnippetResponse
  const item = data.items?.[0]
  const snip = item?.snippet
  if (!snip?.title) return null
  // ISO 8601 PT#H#M#S → seconds.
  const iso = item?.contentDetails?.duration ?? 'PT0S'
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  const h = m?.[1] ? parseInt(m[1], 10) : 0
  const min = m?.[2] ? parseInt(m[2], 10) : 0
  const sec = m?.[3] ? parseInt(m[3], 10) : 0
  const durationSeconds = h * 3600 + min * 60 + sec
  const thumbnail =
    snip.thumbnails?.maxres?.url ??
    snip.thumbnails?.high?.url ??
    snip.thumbnails?.medium?.url ??
    snip.thumbnails?.default?.url ??
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
  return {
    youtube_video_id: videoId,
    title: snip.title,
    description: snip.description ?? '',
    thumbnail_url: thumbnail,
    channel_id: snip.channelId ?? '',
    channel_title: snip.channelTitle ?? '',
    published_at: snip.publishedAt ?? new Date().toISOString(),
    view_count: parseInt(item?.statistics?.viewCount ?? '0', 10) || 0,
    duration_seconds: durationSeconds,
  }
}

interface WpPostFields {
  title: string
  slug: string
  content: string
  excerpt: string
  link: string
  date: string
  featured_media: number
}

async function fetchLegacyWpPost(
  base: string,
  authHeader: string,
  postId: number,
): Promise<WpPostFields | null> {
  // Browser-like UA — Hostinger's WAF routinely blocks the Node default UA on
  // REST GETs for some sites (same workaround the publish path uses).
  const headers = {
    Authorization: authHeader,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  }
  const res = await fetch(
    `${base}/wp-json/wp/v2/posts/${postId}?_fields=id,title,slug,content,excerpt,link,date,featured_media&context=edit`,
    { headers, signal: AbortSignal.timeout(15_000) },
  )
  if (!res.ok) {
    // Retry without `context=edit` — some hosts strip the param.
    const r2 = await fetch(
      `${base}/wp-json/wp/v2/posts/${postId}?_fields=id,title,slug,content,excerpt,link,date,featured_media`,
      { headers, signal: AbortSignal.timeout(15_000) },
    )
    if (!r2.ok) return null
    return parseWpPost(await r2.json())
  }
  return parseWpPost(await res.json())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function parseWpPost(p: any): WpPostFields | null {
    if (!p || typeof p !== 'object') return null
    return {
      title: (p.title?.rendered ?? p.title?.raw ?? '') as string,
      slug: (p.slug ?? '') as string,
      content: (p.content?.rendered ?? p.content?.raw ?? '') as string,
      excerpt: (p.excerpt?.rendered ?? p.excerpt?.raw ?? '') as string,
      link: (p.link ?? '') as string,
      date: (p.date ?? new Date().toISOString()) as string,
      featured_media: Number(p.featured_media ?? 0),
    }
  }
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { wordpressPostId?: number; youtubeUrl?: string; siteId?: string | null }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const wpPostId = Number(body.wordpressPostId)
  const youtubeUrl = (body.youtubeUrl || '').trim()
  if (!Number.isFinite(wpPostId) || wpPostId <= 0) {
    return NextResponse.json({ error: 'wordpressPostId is required.' }, { status: 400 })
  }
  if (!youtubeUrl) {
    return NextResponse.json({ error: 'Paste the YouTube URL for this post.' }, { status: 400 })
  }
  const youtubeVideoId = parseYouTubeId(youtubeUrl)
  if (!youtubeVideoId) {
    return NextResponse.json({
      error: 'That doesn\'t look like a YouTube URL. Use the full URL (e.g. https://www.youtube.com/watch?v=…).',
    }, { status: 400 })
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'YouTube API key isn\'t configured on the server.' }, { status: 500 })
  }

  // ── Look up WP credentials ──────────────────────────────────────────────────
  // Multi-site: if the user has multiple sites, the modal should pass siteId
  // identifying WHICH site this legacy post lives on. Omitted → default site.
  const site = await getWordPressCredentials(supabase, user.id, body.siteId)
  if (!site) {
    return NextResponse.json({ error: 'Connect WordPress in Settings before linking videos.' }, { status: 400 })
  }
  const base = site.wordpress_url.replace(/\/$/, '')
  const authHeader = 'Basic ' + Buffer.from(
    `${site.wordpress_username}:${site.wordpress_app_password.replace(/\s+/g, '')}`,
  ).toString('base64')

  // ── Pull the legacy WP post (need title/slug/content for the blog_posts row)
  const wpPost = await fetchLegacyWpPost(base, authHeader, wpPostId)
  if (!wpPost) {
    return NextResponse.json({
      error: 'Couldn\'t read that WordPress post. It may have been deleted, or your app password no longer has access.',
    }, { status: 404 })
  }

  // ── Pull YouTube metadata ───────────────────────────────────────────────────
  const ytMeta = await fetchYouTubeMetadata(apiKey, youtubeVideoId)
  if (!ytMeta) {
    return NextResponse.json({
      error: 'YouTube couldn\'t find that video. Double-check the URL is public and the ID is correct.',
    }, { status: 404 })
  }

  // ── Upsert the YouTube row ─────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: existingVideo } = await sb
    .from('youtube_videos')
    .select('id')
    .eq('user_id', user.id)
    .eq('youtube_video_id', youtubeVideoId)
    .maybeSingle()

  let videoRowId: string
  if (existingVideo?.id) {
    // Already in the catalog — refresh the snippet so the row reflects the
    // current title/description (the creator may have edited it on YouTube).
    await sb
      .from('youtube_videos')
      .update({
        title: ytMeta.title,
        description: ytMeta.description,
        thumbnail_url: ytMeta.thumbnail_url,
        channel_id: ytMeta.channel_id,
        channel_title: ytMeta.channel_title,
        published_at: ytMeta.published_at,
        view_count: ytMeta.view_count,
        duration_seconds: ytMeta.duration_seconds,
      })
      .eq('id', existingVideo.id)
    videoRowId = existingVideo.id as string
  } else {
    const { data: inserted, error: insErr } = await sb
      .from('youtube_videos')
      .insert({ user_id: user.id, ...ytMeta })
      .select('id')
      .single()
    if (insErr || !inserted?.id) {
      return NextResponse.json({
        error: `Couldn't save the video to your catalog: ${insErr?.message || 'unknown'}`,
      }, { status: 500 })
    }
    videoRowId = inserted.id as string
  }

  // ── Find / create the blog_posts row that points at this WP post ───────────
  const { data: byWp } = await sb
    .from('blog_posts')
    .select('id,video_id,wordpress_post_id')
    .eq('user_id', user.id)
    .eq('wordpress_post_id', wpPostId)
    .maybeSingle()

  // If the YT video is already tied to a DIFFERENT WP post, we can't reuse
  // the row (unique constraint on user_id+video_id). Tell the user instead
  // of silently swapping which legacy post gets the rewrite.
  const { data: byVideo } = await sb
    .from('blog_posts')
    .select('id,wordpress_post_id')
    .eq('user_id', user.id)
    .eq('video_id', videoRowId)
    .maybeSingle()
  if (byVideo?.id && byVideo.wordpress_post_id && byVideo.wordpress_post_id !== wpPostId) {
    return NextResponse.json({
      error: `This YouTube video is already linked to another post in MVP (WordPress post #${byVideo.wordpress_post_id}). Use a different video or unlink the other post first.`,
    }, { status: 409 })
  }

  let blogPostId: string
  if (byWp?.id) {
    // Update the existing row — link/refresh the video and keep the WP post
    // id in place. Wipe rewrite_count so the user gets a full Pro rewrite on
    // this newly-attached video.
    const { data: updated } = await sb
      .from('blog_posts')
      .update({
        video_id: videoRowId,
        rewrite_count: 0,
        last_rewrite_feedback: null,
      })
      .eq('id', byWp.id)
      .select('id')
      .single()
    blogPostId = (updated?.id ?? byWp.id) as string
  } else {
    // No row yet — create one with the legacy WP post's title/slug/content so
    // generate's existing-post detection (and the SEO score reads) work
    // immediately. status='published' because the post is already live on WP.
    const { data: inserted, error: insErr } = await sb
      .from('blog_posts')
      .insert({
        user_id: user.id,
        video_id: videoRowId,
        wordpress_post_id: wpPostId,
        wordpress_url: wpPost.link,
        // Tag with the wordpress_sites row this legacy post lives on so
        // future actions (refresh-images, generate rewrite) route to the
        // correct site automatically.
        ...(site.site_id !== 'legacy' ? { wordpress_site_id: site.site_id } : {}),
        title: wpPost.title,
        slug: wpPost.slug,
        content: wpPost.content,
        excerpt: wpPost.excerpt,
        status: 'published',
        published_at: wpPost.date,
        ai_model: 'unknown',
        generation_prompt_version: 'legacy-attached',
      })
      .select('id')
      .single()
    if (insErr || !inserted?.id) {
      return NextResponse.json({
        error: `Couldn't link the video to your post: ${insErr?.message || 'unknown'}`,
      }, { status: 500 })
    }
    blogPostId = inserted.id as string
  }

  return NextResponse.json({
    videoId: videoRowId,
    blogPostId,
    wordpressPostId: wpPostId,
    youtubeTitle: ytMeta.title,
  })
}
