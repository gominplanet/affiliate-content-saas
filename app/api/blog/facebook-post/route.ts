import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createFacebookService } from '@/services/facebook'
import { createAnthropicClient } from '@/lib/anthropic'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { postId } = await request.json()
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

    // ── 1. Fetch blog post ────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: postRow } = await (supabase as any)
      .from('blog_posts')
      .select('id,title,excerpt,content,wordpress_url,video_id')
      .eq('id', postId)
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const post = postRow as any
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    // ── 2. Fetch video for thumbnail ──────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: videoRow } = await (supabase as any)
      .from('youtube_videos')
      .select('youtube_video_id,thumbnail_url')
      .eq('id', post.video_id)
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const video = videoRow as any

    // ── 3. Fetch brand for disclaimer ─────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brandRow } = await (supabase as any)
      .from('brand_profiles')
      .select('affiliate_disclaimer,name')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brand = brandRow as any
    const disclaimer = brand?.affiliate_disclaimer || '⚠️ This post may contain affiliate links. We may earn a commission at no extra cost to you.'

    // ── 4. Fetch Facebook credentials ─────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('facebook_page_id,facebook_page_access_token')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const integration = intRow as any
    if (!integration?.facebook_page_id || !integration?.facebook_page_access_token) {
      return NextResponse.json({ error: 'Facebook not connected' }, { status: 400 })
    }

    // ── 5. Generate 300-word Facebook review with Claude ──────────────────────
    const anthropic = createAnthropicClient()
    const blogText = `Title: ${post.title}\n\nExcerpt: ${post.excerpt || ''}\n\nContent (first 1500 chars):\n${(post.content as string).replace(/<[^>]+>/g, '').slice(0, 1500)}`

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Write a compelling ~300-word Facebook post promoting this blog article.

Write in first person, conversational tone. Include 2-3 relevant emojis naturally placed. End with a clear call to action to read the full post. Do NOT include the URL or disclaimer — those will be added separately. Do NOT use hashtags.

${blogText}

Return ONLY the post text, nothing else.`,
      }],
    })

    const reviewText = (msg.content[0] as { type: string; text: string }).text.trim()

    // ── 6. Build image URL ────────────────────────────────────────────────────
    const youtubeId = video?.youtube_video_id
    const imageUrl = youtubeId
      ? `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`
      : (video?.thumbnail_url || '')

    // ── 7. Build full caption ─────────────────────────────────────────────────
    const caption = `${reviewText}\n\n🔗 Read the full post: ${post.wordpress_url}\n\n${disclaimer}`

    // ── 8. Post to Facebook ───────────────────────────────────────────────────
    const fbService = createFacebookService(
      integration.facebook_page_access_token,
      integration.facebook_page_id,
    )

    let result
    if (imageUrl) {
      result = await fbService.postPhoto({ imageUrl, caption })
    } else {
      result = await fbService.postLink({ message: caption, link: post.wordpress_url })
    }

    // ── 9. Save facebook_post_id ──────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('blog_posts')
      .update({ facebook_post_id: result.id })
      .eq('id', postId)

    return NextResponse.json({ ok: true, facebookPostId: result.id })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
