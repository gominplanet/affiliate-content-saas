import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createClaudeService } from '@/services/claude'
import { createWordPressService } from '@/services/wordpress'
import { YoutubeTranscript } from 'youtube-transcript'
import { checkUsageLimit, TIERS, nextTierFor, type Tier } from '@/lib/tier'
import { scrubBanned } from '@/lib/scrub'
import { discoverProductForVideo } from '@/lib/product-detect'
import { createGeniuslinkService } from '@/services/geniuslink'
import { extractAsin } from '@/services/amazon'

// Phase 1: Claude generation + WordPress text publish only (~30-40s)
// Images are generated separately via /api/blog/images
export const maxDuration = 300

export async function POST(request: Request) {
  try {
    return await handleGenerate(request)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function handleGenerate(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { videoId?: string; rewriteFeedback?: string }
  const { videoId, rewriteFeedback } = body
  if (!videoId) return NextResponse.json({ error: 'videoId is required' }, { status: 400 })

  // ── Detect rewrite vs fresh generation ────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingForLimit } = await (supabase as any)
    .from('blog_posts')
    .select('id, rewrite_count')
    .eq('user_id', user.id)
    .eq('video_id', videoId)
    .limit(1)
    .maybeSingle()

  const isRewrite = !!existingForLimit

  if (isRewrite) {
    // ── Rewrite gate (Pro-only, once per post) ──────────────────────────────
    // Manual editing in WordPress is always available; this gate stops the
    // expensive AI rewrite path from being triggered by non-Pro tiers.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('tier')
      .eq('user_id', user.id)
      .single()
    const tier = (intRow?.tier as Tier) ?? 'free'
    if (tier !== 'pro' && tier !== 'admin') {
      const next = nextTierFor(tier, 'postsPerMonth')
      return NextResponse.json({
        error: `Rewrite is a Pro feature. You can still manually edit the post in WordPress.${next ? ` Upgrade to ${next.label} to unlock AI rewrites.` : ''}`,
        limitReached: true,
        cap: 'rewrites',
        currentTier: tier,
        upgrade: next,
      }, { status: 403 })
    }
    const usedRewrites = (existingForLimit.rewrite_count as number) ?? 0
    if (usedRewrites >= 1) {
      return NextResponse.json({
        error: `This post has already been rewritten once. Pro plans allow one AI rewrite per post — further edits should be made manually in WordPress.`,
        limitReached: true,
        cap: 'rewrites',
        currentTier: tier,
        upgrade: null,
      }, { status: 403 })
    }
  } else {
    // Fresh generation — check the monthly post cap as before.
    const usage = await checkUsageLimit(supabase, user.id)
    if (!usage.allowed) {
      return NextResponse.json({
        error: usage.reason,
        limitReached: true,
        cap: 'posts',
        currentTier: usage.tier,
        upgrade: usage.upgrade,
      }, { status: 403 })
    }
  }
  // Hide-warning for unused references — used below for the prompt.
  void TIERS

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

  // ── 5. Recover an ASIN when the title doesn't carry one ───────────────────
  // If the title doesn't have a 10-char ASIN and the description has no
  // resolvable Amazon link, ask the detector whether the video is about
  // a buyable product. If yes, search Amazon for the match and wrap it
  // with Geniuslink / Associates so the blog post still gets affiliate
  // links. Failure is silent — falls back to general-mode blog.
  const v = video as Record<string, unknown>
  const rawTitle = v.title as string
  const rawDescription = (v.description as string) || ''
  let asinOverride: string | null = null
  let affiliateUrlOverride: string | null = null
  if (!extractAsin(rawTitle.toUpperCase()) && !/\/(?:dp|gp\/product)\/[A-Z0-9]{10}/.test(rawDescription)) {
    const discovered = await discoverProductForVideo(rawTitle, rawDescription, { userId: user.id, tier: (wp?.tier as string) ?? null })
    if (discovered.asin) {
      asinOverride = discovered.asin
      // Build affiliate URL using user's Geniuslink → Associates → bare.
      let url = `https://www.amazon.com/dp/${discovered.asin}`
      if (wp?.geniuslink_api_key && wp?.geniuslink_api_secret) {
        try {
          const genius = createGeniuslinkService(wp.geniuslink_api_key, wp.geniuslink_api_secret)
          url = await genius.createAsinLink(discovered.asin, discovered.productQuery || rawTitle)
        } catch { /* fall through to Associates / bare */ }
      } else if (wp?.amazon_associates_tag) {
        url = `https://www.amazon.com/dp/${discovered.asin}?tag=${wp.amazon_associates_tag}`
      }
      affiliateUrlOverride = url
    }
  }

  // ── Persistent feedback: every "what was missing" note this user
  // has ever typed into the Rewrite modal. These accumulate over time
  // and apply to every new generation — the AI keeps learning what
  // this user actually wants.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: feedbackRows } = await (supabase as any)
    .from('blog_posts')
    .select('last_rewrite_feedback,published_at')
    .eq('user_id', user.id)
    .not('last_rewrite_feedback', 'is', null)
    .order('published_at', { ascending: false })
    .limit(8)
  const persistentFeedback = (feedbackRows as Array<{ last_rewrite_feedback: string | null }> | null)
    ?.map(r => (r.last_rewrite_feedback || '').trim())
    .filter(s => s.length > 0)
    .slice(0, 8) ?? []

  // ── Voice anchors: pull the user's 2 most-recently-published posts
  // so Claude can match their voice on every new generation. This is
  // the feedback loop — the more they ship, the more "them" each new
  // draft sounds. Excluded: the post being rewritten (would self-
  // mirror) and posts without content. Shortened to ~1200 chars each
  // to keep the prompt budget reasonable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: priorRows } = await (supabase as any)
    .from('blog_posts')
    .select('title,content,video_id')
    .eq('user_id', user.id)
    .eq('status', 'published')
    .neq('video_id', videoId)
    .order('published_at', { ascending: false })
    .limit(2)
  const priorExamples = (priorRows as Array<{ title: string; content: string }> | null)?.map(p => ({
    title: p.title,
    // Strip WP blocks + HTML tags so the example reads as the prose
    // Claude originally produced, not a wall of markup.
    excerpt: (p.content || '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1200),
  })).filter(ex => ex.excerpt.length > 100) ?? []

  // ── 6. Generate blog post with Claude ─────────────────────────────────────
  const claude = createClaudeService()
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
        author_bio: (brand as Record<string, unknown>).author_bio as string | null,
        target_audience: (brand as Record<string, unknown>).target_audience as string | null,
        words_to_avoid: (brand as Record<string, unknown>).words_to_avoid as string | null,
        learn_profile: (brand as Record<string, unknown>).learn_profile,
      },
      {
        videoId: v.youtube_video_id as string,
        title: rawTitle,
        description: rawDescription,
        tags: (v as Record<string, string[]>).tags || [],
        transcript,
        asinOverride,
        affiliateUrlOverride,
      },
      { userId: user.id, tier: (wp?.tier as string) ?? null },
      isRewrite ? (rewriteFeedback?.trim() || null) : null,
      priorExamples,
      persistentFeedback,
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Claude generation failed'
    await logFailure(supabase, user.id, videoId, 'blog_generation', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // ── 5.5. Hard-enforce the banned-word rule on every user-facing field.
  //         LLM instructions aren't a guarantee; this is the last line of
  //         defense before anything is published or persisted.
  generated.title = scrubBanned(generated.title)
  generated.excerpt = scrubBanned(generated.excerpt)
  generated.content = scrubBanned(generated.content)
  generated.imagePrompts = {
    hero: scrubBanned(generated.imagePrompts.hero),
    lifestyle: scrubBanned(generated.imagePrompts.lifestyle),
    setting: scrubBanned(generated.imagePrompts.setting),
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
  }

  // ── 7.1. Resolve category — priority order:
  //         1. User's explicit pick on youtube_videos.selected_category
  //            (set via the dropdown next to "Generate post" on Content page)
  //         2. AI's pick from generated.category, if it matches a brand niche
  //         3. First brand niche as a fallback
  let categoryIds: number[] = []
  try {
    const niches = ((brand as Record<string, unknown>).niches as string[]) || []
    const userPick = ((video as Record<string, unknown>).selected_category as string | null)?.trim() || ''
    const aiPick = (generated.category || '').trim()
    // Find the niche label in a case-insensitive way so minor casing drift
    // ("home & kitchen" vs "Home & Kitchen") still resolves cleanly.
    const matched = userPick
      ? userPick // honor user pick verbatim — they may have picked outside niches
      : (niches.find(n => n.toLowerCase() === aiPick.toLowerCase()) || niches[0] || '')
    if (matched) {
      const catId = await wpService.createCategory(matched)
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

  // Extract the Geniuslink shortcode from the YouTube description so we can
  // tie it back to this post in /api/analytics/clicks. The link itself is
  // already created upstream (during generate-metadata) and lives in the
  // YouTube description; we just persist the code here for join purposes.
  const geniuslinkCode = extractGeniuslinkCode(
    (video as Record<string, unknown>).description as string | null | undefined,
  )

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
    ...(geniuslinkCode ? { geniuslink_code: geniuslinkCode } : {}),
    // Track rewrite usage so the next attempt on the same post can be
    // blocked (Pro gets one AI rewrite per post). Only mutate these
    // fields when this *is* a rewrite — fresh generations leave them
    // at the defaults (0 / null).
    ...(isRewrite
      ? {
          rewrite_count: 1,
          last_rewrite_feedback: rewriteFeedback?.trim() || null,
        }
      : {}),
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

/** Pull the shortcode out of a Geniuslink URL embedded in text.
 *  e.g. "https://geni.us/y2ClyW" -> "y2ClyW". Returns null if not found. */
function extractGeniuslinkCode(text: string | null | undefined): string | null {
  if (!text) return null
  const m = text.match(/https?:\/\/(?:www\.)?geni\.us\/([A-Za-z0-9]+)/)
  return m ? m[1] : null
}
