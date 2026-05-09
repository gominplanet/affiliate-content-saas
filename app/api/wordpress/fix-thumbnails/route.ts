import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'

export const maxDuration = 300

// YouTube placeholder images are tiny (< 5 KB). Real thumbnails are >10 KB.
const PLACEHOLDER_SIZE_THRESHOLD = 5000

async function fetchWithSize(url: string): Promise<{ buffer: Buffer; size: number; contentType: string } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    return { buffer, size: buffer.length, contentType: res.headers.get('content-type') || 'image/jpeg' }
  } catch { return null }
}

export async function POST() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: integration } = await supabase
      .from('integrations')
      .select('wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token')
      .eq('user_id', user.id)
      .single()

    const wp = integration as Record<string, string> | null
    if (!wp?.wordpress_url || !wp?.wordpress_username || !wp?.wordpress_app_password) {
      return NextResponse.json({ error: 'WordPress not connected' }, { status: 400 })
    }

    const base = wp.wordpress_url.replace(/\/$/, '')
    const auth = Buffer.from(`${wp.wordpress_username}:${wp.wordpress_app_password.replace(/\s+/g, '')}`).toString('base64')
    const headers = { Authorization: `Basic ${auth}` }

    const wpService = createWordPressService(
      wp.wordpress_url,
      wp.wordpress_username,
      wp.wordpress_app_password,
      wp.wordpress_api_token || undefined,
    )

    // ── 1. Fetch all posts with featured media ────────────────────────────────
    type RawPost = { id: number; featured_media: number; title: { rendered: string } }
    const allPosts: RawPost[] = []
    let page = 1
    while (true) {
      const res = await fetch(
        `${base}/wp-json/wp/v2/posts?per_page=100&page=${page}&status=publish&_fields=id,title,featured_media`,
        { headers },
      )
      if (!res.ok) break
      const batch = await res.json() as RawPost[]
      if (!batch.length) break
      allPosts.push(...batch.filter(p => p.featured_media))
      const totalPages = parseInt(res.headers.get('X-WP-TotalPages') || '1', 10)
      if (page >= totalPages) break
      page++
    }

    // ── 2. Fetch all media objects in batches to get filenames + URLs ─────────
    const mediaIds = [...new Set(allPosts.map(p => p.featured_media))]
    type RawMedia = { id: number; source_url: string; slug: string }
    const mediaMap: Record<number, RawMedia> = {}

    for (let i = 0; i < mediaIds.length; i += 100) {
      const chunk = mediaIds.slice(i, i + 100)
      try {
        const res = await fetch(
          `${base}/wp-json/wp/v2/media?include=${chunk.join(',')}&per_page=100&_fields=id,source_url,slug`,
          { headers },
        )
        if (res.ok) {
          const items = await res.json() as RawMedia[]
          for (const m of items) mediaMap[m.id] = m
        }
      } catch { /* continue */ }
    }

    // ── 3. For each post, check if thumbnail is a placeholder ─────────────────
    let fixed = 0
    let skipped = 0
    let failed = 0
    const results: string[] = []

    for (const post of allPosts) {
      const media = mediaMap[post.featured_media]
      if (!media) { skipped++; continue }

      // Current image — check its size
      const current = await fetchWithSize(media.source_url)
      if (!current) { skipped++; continue }

      // If it's already a real image, skip
      if (current.size >= PLACEHOLDER_SIZE_THRESHOLD) { skipped++; continue }

      // Placeholder detected — try to find YouTube ID from slug or filename
      const filename = media.source_url.split('/').pop()?.replace(/\.[^.]+$/, '') ?? media.slug
      const ytIdMatch = filename.match(/[A-Za-z0-9_-]{11}/)
      if (!ytIdMatch) { skipped++; continue }
      const ytId = ytIdMatch[0]

      // Try maxresdefault first, then hqdefault
      const title = post.title?.rendered ?? `post-${post.id}`
      let fresh: { buffer: Buffer; size: number; contentType: string } | null = null

      for (const quality of ['maxresdefault', 'sddefault', 'hqdefault']) {
        const candidate = await fetchWithSize(`https://img.youtube.com/vi/${ytId}/${quality}.jpg`)
        if (candidate && candidate.size >= PLACEHOLDER_SIZE_THRESHOLD) {
          fresh = candidate
          break
        }
      }

      if (!fresh) {
        results.push(`✗ ${title} — no valid thumbnail found`)
        failed++
        continue
      }

      try {
        // Upload new thumbnail to WordPress
        const newMedia = await wpService.uploadImageFromUrl(
          `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`,
          `${ytId}-fixed.jpg`,
        )
        // Update post featured image
        await wpService.updatePost(post.id, { featured_media: newMedia.id } as never)
        results.push(`✓ ${title}`)
        fixed++
      } catch (err) {
        results.push(`✗ ${title} — ${err instanceof Error ? err.message : 'upload failed'}`)
        failed++
      }
    }

    return NextResponse.json({
      success: true,
      total: allPosts.length,
      fixed,
      skipped,
      failed,
      results: results.slice(0, 50),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[fix-thumbnails]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
