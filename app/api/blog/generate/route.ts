import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createClaudeService } from '@/services/claude'
import { createWordPressService } from '@/services/wordpress'
import { YoutubeTranscript } from 'youtube-transcript'
import { checkUsageLimit } from '@/lib/tier'

// Phase 1: Claude generation + WordPress text publish only (~30-40s)
// Images are generated separately via /api/blog/images
export const maxDuration = 300

export async function POST(request: Request) {
  try {
    return await handleGenerate(request)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/blog/generate] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function handleGenerate(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { videoId } = await request.json()
  if (!videoId) return NextResponse.json({ error: 'videoId is required' }, { status: 400 })

  // ── Usage limit check (skip for rewrites — existing post detected) ─────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingForLimit } = await (supabase as any)
    .from('blog_posts')
    .select('id')
    .eq('user_id', user.id)
    .eq('video_id', videoId)
    .limit(1)
    .maybeSingle()

  if (!existingForLimit) {
    const usage = await checkUsageLimit(supabase, user.id)
    if (!usage.allowed) {
      return NextResponse.json({ error: usage.reason, limitReached: true }, { status: 403 })
    }
  }

  // ── 1. Fetch video ────────────────────────────────────────────────────────
  const { data: video, error: videoErr } = await supabase
    .from('youtube_videos')
    .select('*')
    .eq('user_id', user.id)
    .eq('id', videoId)
    .single()

  if (videoErr || !video) {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 })
  }

  // ── 2. Fetch brand profile ────────────────────────────────────────────────
  const { data: brand } = await supabase
    .from('brand_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (!brand) {
    return NextResponse.json(
      { error: 'Brand profile not set up. Complete your brand profile first.' },
      { status: 400 },
    )
  }

  // ── 3. Fetch WordPress credentials ───────────────────────────────────────
  const { data: integration } = await supabase
    .from('integrations')
    .select('*')
    .eq('user_id', user.id)
    .single()

  const wp = integration as Record<string, string> | null
  if (!wp?.wordpress_url || !wp?.wordpress_username || !wp?.wordpress_app_password) {
    return NextResponse.json(
      { error: 'WordPress not connected. Add your WordPress credentials in Settings.' },
      { status: 400 },
    )
  }

  // ── 4. Fetch transcript ───────────────────────────────────────────────────
  let transcript = (video as Record<string, string>).transcript || ''
  if (!transcript) {
    try {
      const segments = await YoutubeTranscript.fetchTranscript(
        (video as Record<string, string>).youtube_video_id,
        { lang: 'en' },
      )
      transcript = segments.map((s: { text: string }) => s.text).join(' ')
      await supabase
        .from('youtube_videos')
        .update({ transcript, transcript_fetched_at: new Date().toISOString() })
        .eq('id', videoId)
    } catch {
      transcript = ''
    }
  }

  // ── 5. Generate blog post with Claude ─────────────────────────────────────
  const claude = createClaudeService()
  const v = video as Record<string, unknown>
  let generated
  try {
    generated = await claude.generateBlogPost(
      {
        name: (brand as Record<string, unknown>).name as string || '',
        author_name: (brand as Record<string, unknown>).author_name as string | null,
        tagline: (brand as Record<string, unknown>).tagline as string | null,
        website_url: (brand as Record<string, unknown>).website_url as string | null,
        niches: ((brand as Record<string, unknown>).niches as string[]) || [],
        tone: ((brand as Record<string, unknown>).tone as string[]) || [],
        post_length: (brand as Record<string, unknown>).post_length as string || 'medium',
        cta_style: (brand as Record<string, unknown>).cta_style as string || 'soft_recommendation',
        affiliate_disclaimer: (brand as Record<string, unknown>).affiliate_disclaimer as string | null,
        writing_sample: (brand as Record<string, unknown>).writing_sample as string | null,
      },
      {
        videoId: v.youtube_video_id as string,
        title: v.title as string,
        description: (v.description as string) || '',
        tags: (v as Record<string, string[]>).tags || [],
        transcript,
      },
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Claude generation failed'
    await logFailure(supabase, user.id, videoId, 'blog_generation', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // ── 6. Strip image placeholders (images added later via /api/blog/images) ─
  const content = generated.content
    .replace('{{LIFESTYLE_IMAGE}}', '')
    .replace('{{SETTING_IMAGE}}', '')

  const slug = generated.slug.slice(0, 60)

  // ── 7. Resolve tag IDs ────────────────────────────────────────────────────
  const wpService = createWordPressService(
    wp.wordpress_url,
    wp.wordpress_username,
    wp.wordpress_app_password,
    wp.wordpress_api_token || undefined,
  )

  let tagIds: number[] = []
  try {
    tagIds = await wpService.resolveTagIds(generated.tags.slice(0, 10))
  } catch (err) {
    console.error('Tag resolution failed:', err)
  }

  // ── 7.1. Resolve category from brand niches ───────────────────────────────
  let categoryIds: number[] = []
  try {
    const niches = ((brand as Record<string, unknown>).niches as string[]) || []
    if (niches.length > 0) {
      const catId = await wpService.createCategory(niches[0])
      categoryIds = [catId]
    }
  } catch { /* non-fatal */ }

  // ── 7.5. Sync author display name to WordPress ───────────────────────────
  const authorName = (brand as Record<string, unknown>).author_name as string | null
  if (authorName) {
    try {
      await wpService.updateCurrentUserDisplayName(authorName)
    } catch { /* non-fatal */ }
  }

  // ── 8. Publish text post to WordPress ────────────────────────────────────
  let wpPost
  try {
    wpPost = await wpService.createPost({
      title: generated.title,
      slug,
      content,
      excerpt: generated.excerpt,
      status: 'publish',
      tags: tagIds,
      categories: categoryIds,
      comment_status: 'closed',
      ping_status: 'closed',
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'WordPress publish failed'
    await logFailure(supabase, user.id, videoId, 'wp_publish', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // ── 8.5. Upload YouTube thumbnail as featured image ───────────────────────
  const youtubeVideoId = (v as Record<string, unknown>).youtube_video_id as string
  try {
    const thumbUrl = `https://img.youtube.com/vi/${youtubeVideoId}/maxresdefault.jpg`
    let media
    try {
      media = await wpService.uploadImageFromUrl(thumbUrl, `${youtubeVideoId}.jpg`)
    } catch {
      const fallback = `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`
      media = await wpService.uploadImageFromUrl(fallback, `${youtubeVideoId}.jpg`)
    }
    await wpService.updatePost(wpPost.id, {
      title: generated.title, slug, content, excerpt: generated.excerpt,
      status: 'publish', tags: tagIds, featured_media: media.id,
    })
  } catch { /* non-fatal — post is already published without thumbnail */ }

  // ── 9. Save to blog_posts (upsert so re-generates update the WP post ID) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingPost } = await (supabase as any)
    .from('blog_posts')
    .select('id')
    .eq('user_id', user.id)
    .eq('video_id', videoId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const blogPayload = {
    user_id: user.id,
    video_id: videoId,
    title: generated.title,
    slug,
    content,
    excerpt: generated.excerpt,
    status: 'published',
    wordpress_post_id: wpPost.id,
    wordpress_url: wpPost.link,
    ai_model: 'claude-sonnet-4-6',
    generation_prompt_version: 'v3.0',
    published_at: new Date().toISOString(),
    image_prompts: generated.imagePrompts,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ep = existingPost as any
  let savedPost
  if (ep?.id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('blog_posts')
      .update(blogPayload)
      .eq('id', ep.id)
      .select()
      .single()
    savedPost = data
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('blog_posts')
      .insert(blogPayload)
      .select()
      .single()
    savedPost = data
  }

  // ── 10. Purge LiteSpeed cache so new post appears on homepage immediately ──
  try {
    const wpBase = wp.wordpress_url.replace(/\/$/, '')
    // GET existing WP customizations first, re-POST same data to trigger purge
    // without ever overwriting stored WP data with an empty object.
    let existing: unknown = {}
    try {
      const getRes = await fetch(`${wpBase}/wp-json/affiliateos/v1/customizations`)
      if (getRes.ok) existing = await getRes.json()
    } catch { /* ignore */ }
    const payload = (existing && typeof existing === 'object' && !Array.isArray(existing) && Object.keys(existing as object).length > 0)
      ? existing
      : ((integration as Record<string, unknown>).blog_customizations ?? {})
    await fetch(`${wpBase}/wp-json/affiliateos/v1/customizations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch { /* non-fatal — post is published regardless */ }

  return NextResponse.json({
    success: true,
    postId: savedPost?.id,
    wordpressPostId: wpPost.id,
    wordpressUrl: wpPost.link,
    title: generated.title,
    hasImages: false,
  })
}

async function logFailure(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerClient>>,
  userId: string,
  videoId: string,
  jobType: 'blog_generation' | 'wp_publish',
  errorMessage: string,
) {
  await supabase.from('job_failures').insert({
    user_id: userId,
    video_id: videoId,
    job_type: jobType,
    error_message: errorMessage,
    retry_count: 0,
    status: 'pending_retry',
  })
}
