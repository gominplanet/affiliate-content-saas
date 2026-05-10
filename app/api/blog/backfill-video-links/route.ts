import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const maxDuration = 120

// Backfill blog_posts records for WP posts that were published before Supabase tracking.
// Matches each orphaned WP post to a youtube_video via:
//   1. Thumbnail filename = {youtubeVideoId}.jpg (11-char YouTube ID)
//   2. Title similarity fallback
export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: integration } = await sb
    .from('integrations')
    .select('wordpress_url,wordpress_username,wordpress_app_password')
    .eq('user_id', user.id)
    .single()

  const wp = integration as Record<string, string> | null
  if (!wp?.wordpress_url) return NextResponse.json({ error: 'WordPress not connected' }, { status: 400 })

  const base = wp.wordpress_url.replace(/\/$/, '')
  const auth = Buffer.from(`${wp.wordpress_username}:${wp.wordpress_app_password.replace(/\s+/g, '')}`).toString('base64')
  const headers = { Authorization: `Basic ${auth}` }

  // ── 1. Fetch all WP posts ─────────────────────────────────────────────────
  type RawPost = { id: number; title: { rendered: string }; link: string; date: string; slug: string; featured_media: number }
  const rawPosts: RawPost[] = []
  let page = 1
  while (true) {
    const res = await fetch(
      `${base}/wp-json/wp/v2/posts?per_page=100&page=${page}&status=publish&_fields=id,title,link,date,slug,featured_media`,
      { headers },
    )
    if (!res.ok) break
    const batch = await res.json() as RawPost[]
    if (!batch.length) break
    rawPosts.push(...batch)
    const totalPages = parseInt(res.headers.get('X-WP-TotalPages') || '1', 10)
    if (page >= totalPages) break
    page++
  }

  // ── 2. Find already-tracked WP post IDs ──────────────────────────────────
  const { data: existingPosts } = await sb
    .from('blog_posts')
    .select('wordpress_post_id,wordpress_url')
    .eq('user_id', user.id)
    .not('video_id', 'is', null)

  const trackedWpIds = new Set<number>()
  const trackedUrls = new Set<string>()
  for (const p of existingPosts ?? []) {
    if (p.wordpress_post_id) trackedWpIds.add(p.wordpress_post_id)
    if (p.wordpress_url) trackedUrls.add(p.wordpress_url.replace(/\/$/, '').toLowerCase())
  }

  const untracked = rawPosts.filter(p =>
    !trackedWpIds.has(p.id) &&
    !trackedUrls.has(p.link.replace(/\/$/, '').toLowerCase())
  )

  if (untracked.length === 0) {
    return NextResponse.json({ linked: 0, skipped: 0, message: 'All posts already have video links.' })
  }

  // ── 3. Fetch thumbnails for untracked posts ───────────────────────────────
  const mediaIds = [...new Set(untracked.map(p => p.featured_media).filter(Boolean))]
  const thumbMap: Record<number, string> = {}
  for (let i = 0; i < mediaIds.length; i += 100) {
    const chunk = mediaIds.slice(i, i + 100)
    try {
      const mRes = await fetch(
        `${base}/wp-json/wp/v2/media?include=${chunk.join(',')}&per_page=100&_fields=id,source_url`,
        { headers },
      )
      if (mRes.ok) {
        const media = await mRes.json() as { id: number; source_url: string }[]
        for (const m of media) thumbMap[m.id] = m.source_url
      }
    } catch { /* non-fatal */ }
  }

  // ── 4. Build YouTube ID → video row ID map ────────────────────────────────
  // WordPress often appends size suffixes like -1024x576 or -scaled, so we
  // extract the first 11-char segment rather than requiring an exact match.
  function extractYtId(sourceUrl: string): string | null {
    const filename = sourceUrl.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''
    // Exact 11-char match
    if (/^[A-Za-z0-9_-]{11}$/.test(filename)) return filename
    // 11-char prefix followed by dash + size suffix (e.g. abc12345678-1024x576)
    const m = /^([A-Za-z0-9_-]{11})-/.exec(filename)
    if (m) return m[1]
    return null
  }

  const ytIdsFromThumbs = new Set<string>()
  for (const p of untracked) {
    const thumb = thumbMap[p.featured_media]
    if (!thumb) continue
    const ytId = extractYtId(thumb)
    if (ytId) ytIdsFromThumbs.add(ytId)
  }

  const ytIdToRowId: Record<string, string> = {}
  if (ytIdsFromThumbs.size > 0) {
    const { data: ytRows } = await sb
      .from('youtube_videos')
      .select('id,youtube_video_id')
      .eq('user_id', user.id)
      .in('youtube_video_id', [...ytIdsFromThumbs])
    for (const r of ytRows ?? []) {
      ytIdToRowId[r.youtube_video_id] = r.id
    }
  }

  // ── 5. Title-based fallback: load all youtube_videos for fuzzy match ──────
  const { data: allVideos } = await sb
    .from('youtube_videos')
    .select('id,title,youtube_video_id')
    .eq('user_id', user.id)

  function normalize(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  }

  function titleMatch(postTitle: string): string | null {
    const postNorm = normalize(postTitle)
    // Extract product name — words before "Review:" in the WP title
    const productPart = postNorm.split('review')[0].trim()
    if (!productPart) return null

    let bestId: string | null = null
    let bestScore = 0
    for (const v of allVideos ?? []) {
      const vidNorm = normalize(v.title)
      // Count how many words from productPart appear in the video title
      const words = productPart.split(' ').filter((w: string) => w.length > 2)
      const matches = words.filter((w: string) => vidNorm.includes(w)).length
      const score = matches / Math.max(words.length, 1)
      if (score > bestScore && score >= 0.4) {
        bestScore = score
        bestId = v.id
      }
    }
    return bestId
  }

  // ── 6. For still-unmatched posts, extract YouTube ID from post content ──────
  // Every post we generate embeds the video: youtube.com/embed/{videoId}
  // Fetch content only for posts that won't be matched by thumb or title.
  const needsContentCheck = untracked.filter(p => {
    const thumb = thumbMap[p.featured_media]
    const ytVideoId = thumb ? extractYtId(thumb) : null
    return !ytVideoId && !titleMatch(p.title.rendered)
  })

  const embedYtIdMap: Record<number, string> = {} // wpPostId → youtube_video row id
  for (const p of needsContentCheck) {
    try {
      const res = await fetch(
        `${base}/wp-json/wp/v2/posts/${p.id}?_fields=content`,
        { headers },
      )
      if (!res.ok) continue
      const { content } = await res.json() as { content: { rendered: string } }
      const match = /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/.exec(content?.rendered ?? '')
      if (!match) continue
      const ytId = match[1]
      // Look up in already-fetched map first, then query if not found
      let rowId = ytIdToRowId[ytId]
      if (!rowId) {
        const { data: row } = await sb
          .from('youtube_videos')
          .select('id')
          .eq('user_id', user.id)
          .eq('youtube_video_id', ytId)
          .maybeSingle()
        if (row?.id) { rowId = row.id; ytIdToRowId[ytId] = rowId }
      }
      if (rowId) {
        embedYtIdMap[p.id] = rowId
      } else if (ytId) {
        // Video not in youtube_videos table — create a minimal record so rewrite works
        const { data: newVid } = await sb
          .from('youtube_videos')
          .insert({
            user_id: user.id,
            youtube_video_id: ytId,
            title: p.title.rendered.replace(/<[^>]+>/g, ''),
            published_at: p.date,
          })
          .select('id')
          .single()
        if (newVid?.id) {
          ytIdToRowId[ytId] = newVid.id
          embedYtIdMap[p.id] = newVid.id
        }
      }
    } catch { /* non-fatal */ }
  }

  // ── 7. Insert blog_posts records for matched posts ────────────────────────
  let linked = 0
  let skipped = 0

  for (const p of untracked) {
    const thumb = thumbMap[p.featured_media]
    const ytVideoId = thumb ? extractYtId(thumb) : null

    const videoId = (ytVideoId ? ytIdToRowId[ytVideoId] : null)
      ?? titleMatch(p.title.rendered)
      ?? embedYtIdMap[p.id]
      ?? null

    if (!videoId) { skipped++; continue }

    const slug = p.link.replace(/\/$/, '').split('/').pop() ?? p.slug

    await sb.from('blog_posts').insert({
      user_id: user.id,
      video_id: videoId,
      wordpress_post_id: p.id,
      wordpress_url: p.link,
      title: p.title.rendered,
      slug,
      status: 'published',
      published_at: p.date,
      ai_model: 'unknown',
      generation_prompt_version: 'pre-tracking',
    })

    linked++
  }

  return NextResponse.json({ linked, skipped, total: untracked.length })
}
