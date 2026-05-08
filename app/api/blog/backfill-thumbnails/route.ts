import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'

export const maxDuration = 60

export async function POST() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: wp } = await supabase
      .from('integrations')
      .select('wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token')
      .eq('user_id', user.id)
      .single()

    if (!wp?.wordpress_url) return NextResponse.json({ error: 'No WordPress integration' }, { status: 400 })

    // Get all published posts with their YouTube video IDs
    const { data: posts } = await supabase
      .from('blog_posts')
      .select('id,wordpress_post_id,youtube_videos(youtube_video_id)')
      .eq('user_id', user.id)
      .eq('status', 'published')
      .not('wordpress_post_id', 'is', null)

    if (!posts?.length) return NextResponse.json({ updated: 0 })

    const wpService = createWordPressService(
      wp.wordpress_url,
      wp.wordpress_username,
      wp.wordpress_app_password,
      wp.wordpress_api_token || undefined,
    )

    let updated = 0
    let failed = 0

    for (const post of posts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vid = (post as any).youtube_videos
      const youtubeId: string | undefined = Array.isArray(vid) ? vid[0]?.youtube_video_id : vid?.youtube_video_id
      if (!youtubeId || !post.wordpress_post_id) continue

      try {
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
