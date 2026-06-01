import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

export const maxDuration = 60

/**
 * Backfill featured images on every published post by uploading the YouTube
 * thumbnail (maxres → hqdefault fallback) and assigning it as the featured
 * media. Useful for legacy posts that shipped without thumbnails.
 *
 * MULTI-SITE: each post routes to its OWN wordpress_sites row via
 * wordpress_site_id, with a per-site wpService cache to avoid rebuilding
 * the service for every post. Posts on the Wine blog upload thumbnails to
 * Wine; posts on Main upload to Main.
 */
export async function POST() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    // Get all published posts with their YouTube video IDs + site routing.
    const { data: posts } = await sb
      .from('blog_posts')
      .select('id,wordpress_post_id,wordpress_site_id,youtube_videos(youtube_video_id)')
      .eq('user_id', user.id)
      .eq('status', 'published')
      .not('wordpress_post_id', 'is', null)

    if (!posts?.length) return NextResponse.json({ updated: 0 })

    // Per-site wpService cache (multi-site).
    const userId = user.id
    const siteCache = new Map<string, ReturnType<typeof createWordPressService> | null>()
    async function svcFor(siteId: string | null | undefined) {
      const key = siteId ?? '__default__'
      if (siteCache.has(key)) return siteCache.get(key)!
      const s = await getWordPressCredentials(supabase, userId, siteId ?? null)
      if (!s) { siteCache.set(key, null); return null }
      const svc = createWordPressService(s.wordpress_url, s.wordpress_username, s.wordpress_app_password, s.wordpress_api_token || undefined)
      siteCache.set(key, svc)
      return svc
    }
    // Default-site guard so a fully-unconnected user gets the legacy 400.
    if (!(await svcFor(null))) {
      return NextResponse.json({ error: 'No WordPress integration' }, { status: 400 })
    }

    let updated = 0
    let failed = 0

    for (const post of posts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vid = (post as any).youtube_videos
      const youtubeId: string | undefined = Array.isArray(vid) ? vid[0]?.youtube_video_id : vid?.youtube_video_id
      if (!youtubeId || !post.wordpress_post_id) continue

      try {
        const wpService = await svcFor(post.wordpress_site_id)
        if (!wpService) { failed++; continue }
        const thumbUrl = `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`
        let media
        try {
          media = await wpService.uploadImageFromUrl(thumbUrl, `${youtubeId}.jpg`)
        } catch {
          const fallback = `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`
          media = await wpService.uploadImageFromUrl(fallback, `${youtubeId}.jpg`)
        }
        await wpService.updatePost(post.wordpress_post_id, { featured_media: media.id } as Parameters<typeof wpService.updatePost>[1])
        updated++
      } catch {
        failed++
      }
    }

    return NextResponse.json({ updated, failed, total: posts.length })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
