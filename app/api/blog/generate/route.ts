import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createClaudeService } from '@/services/claude'
import { createOpenAIService } from '@/services/openai'
import { createWordPressService } from '@/services/wordpress'
import { YoutubeTranscript } from 'youtube-transcript'

// Allow up to 120s — generation + 3 images + WP publish
export const maxDuration = 120

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { videoId } = await request.json()
  if (!videoId) return NextResponse.json({ error: 'videoId is required' }, { status: 400 })

  // ── 1. Fetch video from DB ────────────────────────────────────────────────
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
      { error: 'WordPress not connected. Complete setup first.' },
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
      // Cache it
      await supabase
        .from('youtube_videos')
        .update({ transcript, transcript_fetched_at: new Date().toISOString() })
        .eq('id', videoId)
    } catch {
      // Transcript unavailable — Claude will work with description only
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

  // ── 6. Generate 3 images with DALL-E 3 ───────────────────────────────────
  let images: { hero: string; lifestyle: string; setting: string } | null = null
  try {
    const openai = createOpenAIService()
    images = await openai.generateImageSet(generated.imagePrompts)
  } catch (err: unknown) {
    // Image generation failure is non-fatal — publish without images
    console.error('Image generation failed:', err)
  }

  // ── 7. Upload images to WordPress ─────────────────────────────────────────
  const wpService = createWordPressService(
    wp.wordpress_url,
    wp.wordpress_username,
    wp.wordpress_app_password,
  )

  const slug = generated.slug.slice(0, 60)
  let heroMediaId: number | undefined
  let lifestyleUrl = ''
  let settingUrl = ''

  if (images) {
    try {
      const [heroMedia, lifestyleMedia, settingMedia] = await Promise.all([
        wpService.uploadImageFromBase64(images.hero, `${slug}-hero.png`),
        wpService.uploadImageFromBase64(images.lifestyle, `${slug}-lifestyle.png`),
        wpService.uploadImageFromBase64(images.setting, `${slug}-setting.png`),
      ])
      heroMediaId = heroMedia.id
      lifestyleUrl = lifestyleMedia.source_url
      settingUrl = settingMedia.source_url
    } catch (err: unknown) {
      console.error('Image upload failed:', err)
    }
  }

  // ── 8. Inject image URLs into content ─────────────────────────────────────
  let content = generated.content

  if (lifestyleUrl) {
    content = content.replace(
      '{{LIFESTYLE_IMAGE}}',
      `<!-- wp:image {"sizeSlug":"large"} --><figure class="wp-block-image size-large"><img src="${lifestyleUrl}" alt="${generated.title} in use"/><figcaption class="gr-img-caption">Tested in real conditions</figcaption></figure><!-- /wp:image -->`,
    )
  } else {
    content = content.replace('{{LIFESTYLE_IMAGE}}', '')
  }

  if (settingUrl) {
    content = content.replace(
      '{{SETTING_IMAGE}}',
      `<!-- wp:image {"sizeSlug":"large"} --><figure class="wp-block-image size-large"><img src="${settingUrl}" alt="${generated.title}"/></figure><!-- /wp:image -->`,
    )
  } else {
    content = content.replace('{{SETTING_IMAGE}}', '')
  }

  // ── 9. Resolve tag IDs in WordPress ───────────────────────────────────────
  let tagIds: number[] = []
  try {
    tagIds = await wpService.resolveTagIds(generated.tags.slice(0, 8))
  } catch (err) {
    console.error('Tag resolution failed:', err)
  }

  // ── 10. Publish to WordPress ──────────────────────────────────────────────
  let wpPost
  try {
    wpPost = await wpService.createPost({
      title: generated.title,
      slug,
      content,
      excerpt: generated.excerpt,
      status: 'publish',
      tags: tagIds,
      ...(heroMediaId ? { featured_media: heroMediaId } : {}),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'WordPress publish failed'
    await logFailure(supabase, user.id, videoId, 'wp_publish', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // ── 11. Save to blog_posts table ──────────────────────────────────────────
  const { data: savedPost } = await supabase
    .from('blog_posts')
    .insert({
      user_id: user.id,
      video_id: videoId,
      title: generated.title,
      slug,
      content,
      excerpt: generated.excerpt,
      status: 'published',
      wordpress_post_id: wpPost.id,
      wordpress_url: wpPost.link,
      ai_model: 'claude-sonnet-4-5',
      generation_prompt_version: 'v2.0',
      published_at: new Date().toISOString(),
    })
    .select()
    .single()

  return NextResponse.json({
    success: true,
    postId: savedPost?.id,
    wordpressPostId: wpPost.id,
    wordpressUrl: wpPost.link,
    title: generated.title,
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
