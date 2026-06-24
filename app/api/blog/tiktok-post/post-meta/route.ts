/**
 * GET /api/blog/tiktok-post/post-meta?blogPostId=… — the small payload the
 * /tiktok-publish/[id] screen needs to render: the post title (used as the
 * default caption), the rendered vertical video URL, and an optional excerpt.
 *
 * Kept separate from /api/blog/tiktok-post so the publish screen can load
 * post + creator_info in parallel.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const blogPostId = (searchParams.get('blogPostId') || '').trim()
  if (!blogPostId) return NextResponse.json({ error: 'blogPostId is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: post } = await sb
    .from('blog_posts')
    .select('title,excerpt,youtube_videos(id,instagram_video_url,title,product_url)')
    .eq('id', blogPostId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!post) return NextResponse.json({ error: 'Post not found.' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const yt = (post as any).youtube_videos
  const ytRow = Array.isArray(yt) ? yt[0] : yt
  const videoUrl = (ytRow?.instagram_video_url as string | null) ?? null
  // youtube_videos.id — the row whose vertical render the empty-state uploader
  // patches (and the id Shop Burner loads to add a CTA box). Null only for
  // video-less posts (guides/comparisons) that can't have a vertical render.
  const videoId = (ytRow?.id as string | null) ?? null
  const productUrl = (ytRow?.product_url as string | null) ?? null
  const title = (post.title as string) || (ytRow?.title as string) || ''
  const excerpt = (post.excerpt as string) || ''

  // Default caption: title + one-line tease. TikTok captions cap at 2200
  // chars; we stay well under to leave room for the creator's edits.
  const defaultCaption = (excerpt ? `${title}\n\n${excerpt}` : title).slice(0, 1500)

  return NextResponse.json({
    title,
    videoUrl,
    videoId,
    productUrl,
    defaultCaption,
  })
}
