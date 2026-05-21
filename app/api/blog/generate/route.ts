import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createClaudeService } from '@/services/claude'
import { createWordPressService } from '@/services/wordpress'
import { YoutubeTranscript } from 'youtube-transcript'
import { checkUsageLimit, TIERS, nextTierFor, type Tier } from '@/lib/tier'
import { scrubBanned } from '@/lib/scrub'
import { discoverProductForVideo } from '@/lib/product-detect'
import { createGeniuslinkService } from '@/services/geniuslink'
import { extractAsin, fetchAmazonProduct } from '@/services/amazon'
import { maybeEvolveLearnProfile } from '@/lib/learn-evolve'
import { gutenbergImageBlock, insertImagesAtHeadings, autoPlacementIndices } from '@/lib/blog-body-images'
import { fal } from '@fal-ai/client'
import { recordUsage, recordAnthropicUsage } from '@/lib/ai-usage'
import { createAnthropicClient } from '@/lib/anthropic'

/** Distinct camera perspectives cycled across a post's in-body images so
 *  no two shots look alike — each Kontext/flux call gets a different angle
 *  + framing even though the product reference is the same. */
const SHOT_PERSPECTIVES = [
  'extreme close-up macro detail shot, shallow depth of field, product fills the frame',
  'wide environmental shot — the product small within a full real-room setting, lots of context',
  'overhead top-down flat-lay on a clean surface, styled with a few relevant props',
  'in-hand point-of-view shot — the product held and actively being used',
  'three-quarter angle on a wooden table with soft directional side lighting',
  'low hero angle looking slightly up at the product against a softly blurred lifestyle background',
]

/** Plain-text word count of Gutenberg block markup (strips wp comments,
 *  HTML tags, and collapses whitespace). Used to scale image count. */
function bodyWordCount(content: string): number {
  const text = content
    .replace(/<!--[\s\S]*?-->/g, ' ')   // wp block comments
    .replace(/<[^>]+>/g, ' ')           // html tags
    .replace(/&[a-z]+;/gi, ' ')         // entities
    .trim()
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}

/** Pull the H2/H3 heading texts from the body, in order — used as context
 *  so each generated image relates to the section it sits above. */
function sectionHeadings(content: string): string[] {
  const out: string[] = []
  const re = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const t = m[1].replace(/<[^>]+>/g, '').trim()
    if (t) out.push(t)
  }
  return out
}

/**
 * Produce `count` distinct image-generation prompts for the post body.
 * One Haiku call returns scene prompts tied to the article's sections so
 * the photos feel relevant rather than generic. Falls back to cycling the
 * base lifestyle/setting/hero prompts if the call fails.
 */
async function generateBodyImagePrompts(opts: {
  count: number
  productTitle: string
  headings: string[]
  base: { hero: string; lifestyle: string; setting: string }
  ctx: { userId: string | null; tier: string | null }
}): Promise<string[]> {
  const cycle = (n: number): string[] => {
    const pool = [opts.base.lifestyle, opts.base.setting, opts.base.hero].filter(Boolean)
    if (pool.length === 0) return []
    return Array.from({ length: n }, (_, i) => pool[i % pool.length])
  }
  if (opts.count <= 2) return cycle(opts.count)
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Write exactly ${opts.count} distinct image-generation prompts for photos placed throughout a product review article.

PRODUCT: ${opts.productTitle || 'the reviewed product'}
ARTICLE SECTIONS (one image sits above each — match the scene to the section):
${opts.headings.slice(0, opts.count).map((h, i) => `${i + 1}. ${h}`).join('\n')}

RULES:
- Each prompt: a clean, realistic editorial product photo. Vary the angle/scene (in-use lifestyle, close-up detail, flat-lay, in-situ environment).
- Show the EXACT product. No packaging, no boxes.
- NO text, letters, logos, or watermarks in the image.
- Each under 35 words.
Return ONLY a JSON array of ${opts.count} strings, nothing else.`,
      }],
    })
    recordAnthropicUsage(msg, { userId: opts.ctx.userId, tier: opts.ctx.tier, feature: 'blog_body_image_prompts', model: 'claude-haiku-4-5-20251001' })
    const raw = (msg.content[0] as { type: string; text: string }).text.trim()
    const jsonStart = raw.indexOf('[')
    const jsonEnd = raw.lastIndexOf(']')
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const arr = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as string[]
      const cleaned = arr.map(s => (s || '').trim()).filter(Boolean)
      if (cleaned.length > 0) {
        // Pad with cycled prompts if Haiku returned fewer than asked.
        while (cleaned.length < opts.count) cleaned.push(cycle(opts.count)[cleaned.length])
        return cleaned.slice(0, opts.count)
      }
    }
  } catch { /* fall through to cycle */ }
  return cycle(opts.count)
}

// Phase 1: Claude generation + WordPress text publish only (~30-40s)
// Images are generated separately via /api/blog/images
export const maxDuration = 300

/** Turn anything thrown into a human-readable string. Plain objects used
 *  to stringify as "[object Object]" via String(err), hiding the real
 *  cause (e.g. Fal / fetch rejections that aren't Error instances). */
function errToMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const maybe = err as { message?: unknown; error?: unknown; detail?: unknown }
    if (typeof maybe.message === 'string') return maybe.message
    if (typeof maybe.error === 'string') return maybe.error
    if (typeof maybe.detail === 'string') return maybe.detail
    try { return JSON.stringify(err) } catch { /* fall through */ }
  }
  return 'Unknown server error'
}

export async function POST(request: Request) {
  try {
    return await handleGenerate(request)
  } catch (err: unknown) {
    return NextResponse.json({ error: errToMessage(err) }, { status: 500 })
  }
}

async function handleGenerate(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { videoId?: string; rewriteFeedback?: string; includeImages?: boolean }
  const { videoId, rewriteFeedback } = body
  // Default ON when omitted (older callers / bulk triggers) — the Content
  // page sends the explicit per-generation choice.
  const includeImages = body.includeImages !== false
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

  // ── 5.1. Resolve the product URL we'll surface in the dashboard so the
  //         creator can click through and confirm it's the right product
  //         (this same ASIN drives the in-body image rendering). Prefer the
  //         discovery-built affiliate URL; otherwise build a plain Amazon
  //         /dp link with the Associates tag when set. No extra Geniuslink
  //         call here — this is a "visit the product" link, not a tracked
  //         click target.
  const effectiveAsin =
    extractAsin(rawTitle.toUpperCase()) ||
    rawDescription.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase() ||
    asinOverride ||
    null
  let productUrl: string | null = affiliateUrlOverride
  if (!productUrl && effectiveAsin) {
    productUrl = wp?.amazon_associates_tag
      ? `https://www.amazon.com/dp/${effectiveAsin}?tag=${wp.amazon_associates_tag}`
      : `https://www.amazon.com/dp/${effectiveAsin}`
  }
  if (productUrl) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('youtube_videos').update({ product_url: productUrl }).eq('id', videoId)
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
    const msg = err instanceof Error ? err.message : (errToMessage(err) || 'Claude generation failed')
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

  // ── 6. Clean any vestigial placeholders (the prompt no longer emits
  //        these, but strip defensively in case an old prompt variant does) ─
  let content = generated.content
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

  // ── 7.05. Auto in-body images — clean AI-generated lifestyle + setting
  //          shots spliced into the body so the post isn't a wall of text.
  //          We use the lifestyle/setting image prompts the generator
  //          already produced (landscape 4:3, no text, on-brand). This
  //          replaced raw YouTube frame grabs, which letterboxed with
  //          black bars, were low-res (480×360), and caught the creator's
  //          burned-in overlays. The in-body image editor (separate) lets
  //          the user later swap these for manual uploads or video frames.
  //          Non-fatal: on any failure we publish the text-only post.
  if (includeImages) {
    try {
      const falKey = process.env.FAL_KEY
      if (falKey) {
        fal.config({ credentials: falKey })

        // ── Resolve the REAL product image so the rendered photos match
        //    the actual product, not a generic guess. Effective ASIN comes
        //    from the title, the description's Amazon URL, or the discovery
        //    override. We fetch the Amazon product photo and re-host it on
        //    Fal storage once, then feed it into Kontext as a visual
        //    reference for every body image. Kontext keeps the product's
        //    exact shape / colour / branding while recomposing the scene.
        let falProductImageUrl: string | null = null
        let productTitleForPrompts = generated.title

        // Priority 1 — a product photo the user uploaded for this video.
        // More reliable + higher quality than scraping Amazon. Re-hosted
        // on Fal storage so Kontext can read it.
        const uploadedProductImage = (v.product_image_url as string | null)?.trim() || null
        if (uploadedProductImage) {
          try {
            const imgRes = await fetch(uploadedProductImage, { headers: { 'User-Agent': 'Mozilla/5.0' } })
            if (imgRes.ok) falProductImageUrl = await fal.storage.upload(await imgRes.blob())
          } catch { /* fall through to Amazon */ }
        }

        // Priority 2 — auto-fetch the Amazon catalog photo by ASIN
        // (effectiveAsin resolved earlier in section 5.1).
        if (effectiveAsin) {
          try {
            const p = await fetchAmazonProduct(effectiveAsin)
            if (p.title) productTitleForPrompts = p.title
            if (!falProductImageUrl && p.imageUrl) {
              const imgRes = await fetch(p.imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
              if (imgRes.ok) falProductImageUrl = await fal.storage.upload(await imgRes.blob())
            }
          } catch { /* fall back to text-only prompts */ }
        }

        // Scale image count with article length — roughly one image per
        // ~550 words, min 2, capped at 4 to keep Fal cost + latency down
        // (was 6; lowered for margin — typical reviews land at 3-4).
        const words = bodyWordCount(content)
        const imageCount = Math.max(2, Math.min(4, Math.round(words / 550)))
        const prompts = await generateBodyImagePrompts({
          count: imageCount,
          productTitle: productTitleForPrompts,
          headings: sectionHeadings(content),
          base: generated.imagePrompts,
          ctx: { userId: user.id, tier: (wp?.tier as string) ?? null },
        })

        const uploaded: Array<{ url: string; alt: string }> = []
        for (let i = 0; i < prompts.length; i++) {
          const prompt = prompts[i]
          if (!prompt || !prompt.trim()) continue
          // Force a DISTINCT perspective per image + a unique seed so no two
          // body images repeat. The reference product stays identical; only
          // the angle, framing, and scene change.
          const perspective = SHOT_PERSPECTIVES[i % SHOT_PERSPECTIVES.length]
          const seed = Math.floor(Math.random() * 1_000_000_000) + i
          try {
            let falUrl: string | undefined
            if (falProductImageUrl) {
              // Kontext — the real product photo anchors the render.
              const kontextInstruction = `Keep the exact product object from this image — its shape, colour, material, branding, and all details — but show it from a NEW, DISTINCT perspective: ${perspective}. Remove the white background and any packaging. Place the product naturally into this scene: ${prompt}. This image MUST look clearly different from the other photos in the article — different angle, different framing, different surroundings. Realistic shadows and lighting. ABSOLUTELY NO TEXT, LETTERS, WORDS, LOGOS (other than what's physically on the product), OR WATERMARKS anywhere in the scene. Landscape 4:3 editorial product photography.`
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const k = await fal.subscribe('fal-ai/flux-pro/kontext' as any, {
                input: {
                  image_url: falProductImageUrl,
                  prompt: kontextInstruction,
                  aspect_ratio: '4:3',
                  num_images: 1,
                  output_format: 'jpeg',
                  guidance_scale: 5,
                  seed,
                },
                pollInterval: 3000,
              })
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              falUrl = ((k.data as any)?.images as Array<{ url: string }> | undefined)?.[0]?.url
              if (falUrl) recordUsage({ userId: user.id, tier: (wp?.tier as string) ?? null, feature: 'blog_body_image', model: 'fal-flux-pro-kontext', images: 1 })
            }
            if (!falUrl) {
              // No product image (or Kontext failed) — plain text-prompt gen.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const result = await fal.subscribe('fal-ai/flux-pro/v1.1' as any, {
                input: {
                  prompt: `${prompt}. Shown as a ${perspective}. Editorial product photography, natural lighting, sharp focus, photorealistic, 8K. ABSOLUTELY NO TEXT, LETTERS, WORDS, LOGOS, OR WATERMARKS anywhere in the image.`,
                  image_size: 'landscape_4_3',
                  num_inference_steps: 28,
                  guidance_scale: 3.5,
                  num_images: 1,
                  output_format: 'jpeg',
                  safety_tolerance: '2',
                  seed,
                },
                pollInterval: 3000,
              })
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              falUrl = ((result.data as any)?.images as Array<{ url: string }> | undefined)?.[0]?.url
              if (falUrl) recordUsage({ userId: user.id, tier: (wp?.tier as string) ?? null, feature: 'blog_body_image', model: 'fal-flux-pro-v1.1', images: 1 })
            }
            if (!falUrl) continue
            // Re-host on the WP media library so the image is permanent
            // (Fal URLs expire) and served from the user's own domain.
            const media = await wpService.uploadImageFromUrl(falUrl, `${slug}-body${i + 1}.jpg`)
            if (media?.source_url) uploaded.push({ url: media.source_url, alt: `${generated.title} — ${i + 1}` })
          } catch { /* skip this image */ }
        }
        if (uploaded.length > 0) {
          const slots = autoPlacementIndices(content, uploaded.length)
          content = insertImagesAtHeadings(
            content,
            uploaded.map((img, i) => ({
              beforeHeadingIndex: slots[i] ?? (i + 1),
              block: gutenbergImageBlock(img.url, img.alt),
            })),
          )
        }
      }
    } catch { /* non-fatal — text-only post still publishes */ }
  }

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
    const msg = err instanceof Error ? err.message : (errToMessage(err) || 'WordPress publish failed')
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

  // Fire-and-forget LEARN-profile evolution. Reads the user's last 5
  // posts + current profile, fills empty slots with AI-inferred
  // suggestions (never overwrites manual entries). Debounced 6h so a
  // burst of publishes doesn't hammer Haiku. No await — request keeps
  // moving so the user's blog-publish flow stays fast.
  void maybeEvolveLearnProfile(supabase, { userId: user.id, tier: (wp?.tier as string) ?? null })

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
    productUrl,
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
