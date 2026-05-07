import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'

// Uses the YouTube thumbnail as the featured image — no AI generation needed
export const maxDuration = 30

export async function POST(request: Request) {
  try {
    return await handleImages(request)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/blog/images] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function handleImages(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { postId } = await request.json()
  if (!postId) return NextResponse.json({ error: 'postId is required' }, { status: 400 })

  // ── 1. Load blog post + its video ────────────────────────────────────────
  const { data: post } = await supabase
    .from('blog_posts')
    .select('*, youtube_videos(youtube_video_id, thumbnail_url, title)')
    .eq('id', postId)
    .eq('user_id', user.id)
    .single()

  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = post as any
  const videoId = p.youtube_videos?.youtube_video_id as string | null
  const thumbnailUrl = p.youtube_videos?.thumbnail_url as string | null

  if (!videoId) return NextResponse.json({ error: 'No YouTube video linked to this post' }, { status: 400 })

  // ── 2. Load WordPress credentials ────────────────────────────────────────
  const { data: integration } = await supabase
    .from('integrations')
    .select('wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token')
    .eq('user_id', user.id)
    .single()

  const wp = integration as Record<string, string> | null
  if (!wp?.wordpress_url || !wp?.wordpress_username || !wp?.wordpress_app_password) {
    return NextResponse.json({ error: 'WordPress credentials missing' }, { status: 400 })
  }

  const wpService = createWordPressService(
    wp.wordpress_url,
    wp.wordpress_username,
    wp.wordpress_app_password,
    wp.wordpress_api_token || undefined,
  )

  // ── 3. Upload YouTube thumbnail as featured image ─────────────────────────
  // Try maxresdefault first, fall back to hqdefault
  const thumbUrl = thumbnailUrl
    || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`

  const slug = (p.slug as string || 'post').slice(0, 50)

  let heroMediaId: number | undefined
  try {
    const heroMedia = await wpService.uploadImageFromUrl(thumbUrl, `${slug}-hero.jpg`)
    heroMediaId = heroMedia.id
  } catch {
    // Try fallback thumbnail quality
    try {
      const fallback = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
      const heroMedia = await wpService.uploadImageFromUrl(fallback, `${slug}-hero.jpg`)
      heroMediaId = heroMedia.id
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Thumbnail upload failed'
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  // ── 4. Set as WordPress featured image ───────────────────────────────────
  try {
    await wpService.updatePost(p.wordpress_post_id as number, {
      featured_media: heroMediaId,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'WordPress update failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // ── 5. Update blog_posts record ───────────────────────────────────────────
  await supabase
    .from('blog_posts')
    .update({ has_images: true })
    .eq('id', postId)

  return NextResponse.json({ success: true, heroMediaId })
}
