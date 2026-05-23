import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { fetchAmazonProduct } from '@/services/amazon'
import { firstProductUrl, resolveFinalUrl } from '@/lib/product-link'
import { fetchProductImageFromPage } from '@/services/research'
import { createOpenAIService, normalizeToPng } from '@/services/openai'
import { fal } from '@fal-ai/client'
import sharp from 'sharp'
import { getValidYouTubeToken, createYouTubeOAuthService } from '@/services/youtube'
import { recordAnthropicUsage, recordUsage } from '@/lib/ai-usage'
import { TIERS, nextTierFor, normalizeTier, type Tier } from '@/lib/tier'
import { checkUsageCap, PRIMARY_FEATURE } from '@/lib/usage-cap'

// Telemetry context — populated at request start, read by the three
// Anthropic helpers below so each call is tagged with the right user/tier.
let TELEMETRY: { userId: string | null; tier: string | null } = { userId: null, tier: null }

// 300s (Vercel Pro max). A face thumbnail runs the gpt-image cut-out and the
// product scene; we run them in parallel, but gpt-image high quality alone can
// take ~60s, so give generous headroom.
export const maxDuration = 300

// ── Retry wrapper for Anthropic overloaded (529) errors ──────────────────────
async function withAnthropicRetry<T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let delay = 3000
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const status = (err as Record<string, unknown>)?.status as number | undefined
      const msg = err instanceof Error ? err.message : String(err)
      const isOverloaded = status === 529 || msg.includes('529') || msg.toLowerCase().includes('overloaded')
      if (!isOverloaded || attempt === maxAttempts) {
        if (isOverloaded) throw new Error('Claude AI is temporarily overloaded — please try again in a moment.')
        throw err
      }
      console.warn(`[anthropic-retry] 529 overloaded, attempt ${attempt}/${maxAttempts}, waiting ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
      delay = Math.min(delay * 1.5, 15000)
    }
  }
  throw new Error('Claude AI is temporarily overloaded — please try again in a moment.')
}

// ── Fetch recent channel thumbnail URLs via YouTube OAuth ─────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchChannelThumbnails(supabase: any, userId: string): Promise<string[]> {
  try {
    const { data: intRow } = await supabase
      .from('integrations')
      .select('youtube_oauth_access_token,youtube_oauth_refresh_token,youtube_oauth_token_expiry')
      .eq('user_id', userId)
      .single()
    if (!intRow?.youtube_oauth_access_token) return []

    const token = await getValidYouTubeToken(intRow as Record<string, unknown>)
    const yt = createYouTubeOAuthService(token)
    const { videos } = await yt.getDraftVideos(25)

    // Prefer published thumbnails (these were "approved" by the creator)
    const published = videos.filter(v => v.status === 'public' && v.thumbnailUrl).map(v => v.thumbnailUrl)
    const all = videos.filter(v => v.thumbnailUrl).map(v => v.thumbnailUrl)
    const urls = (published.length >= 4 ? published : all).slice(0, 8)
    return urls
  } catch {
    return []  // non-fatal — skip style analysis if YouTube not connected or fails
  }
}

// ── Analyse channel thumbnails with Claude vision ─────────────────────────────
async function analyzeChannelStyle(thumbnailUrls: string[]): Promise<string | null> {
  if (thumbnailUrls.length < 2) return null
  try {
    const anthropic = createAnthropicClient()
    const imageBlocks = thumbnailUrls.map(url => ({
      type: 'image' as const,
      source: { type: 'url' as const, url },
    }))
    const msg = await withAnthropicRetry(() => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 180,
      messages: [{
        role: 'user',
        content: [
          ...imageBlocks,
          {
            type: 'text',
            text: `Analyse these YouTube channel thumbnails and describe the visual style in 2 concise sentences:
1. Background style — is it dark/bright, solid colour/blurred indoor setting, minimalist/busy?
2. Composition & energy — where is the person placed, how large is the face, what is the emotional energy (intense/calm/excited)?
Ignore any text overlays. Focus only on consistent patterns across thumbnails. Be specific and brief.`,
          },
        ],
      }],
    }))
    recordAnthropicUsage(msg, {
      userId: TELEMETRY.userId, tier: TELEMETRY.tier,
      feature: 'yt_thumb_channel_style', model: 'claude-haiku-4-5-20251001',
    })
    return (msg.content[0] as { type: string; text: string }).text.trim()
  } catch {
    return null  // non-fatal
  }
}

// ── Claude: Product scene prompt (product-only, style-aware, story-driven) ────
// Setting/mood pool — weighted toward BRIGHT, airy, Instagram-style homes so
// thumbnails aren't always moody/dark. One darker option for occasional variety.
const SCENE_MOODS = [
  'a BRIGHT, airy modern home interior — clean white walls, light wood, soft natural daylight pouring through a large window. Fresh, inviting Instagram-home aesthetic.',
  'a cozy, warm, BRIGHT kitchen or living room — homey and welcoming, lots of soft natural light, light/neutral tones.',
  'a clean, minimal, BRIGHT setting — light neutral background, crisp even daylight, fresh and modern.',
  'a stylish bright sunroom / cafe corner with green plants and big windows, airy and vibrant with natural light.',
  'a warm, sunlit golden-hour interior — bright, vibrant and lively, soft warm daylight.',
  'a sleek modern desk / shelf setup in a bright room, daylight, clean and aspirational.',
  'a moody, cinematic setting with dramatic rim lighting and a darker background (use this ONLY occasionally, for contrast).',
]

async function generateProductPrompt(opts: {
  videoTitle: string
  productTitle: string
  productDescription: string
  productBullets: string[]
  style: string
  channelStyle?: string | null
}): Promise<string> {
  const sceneMood = pick(SCENE_MOODS)
  const anthropic = createAnthropicClient()
  const msg = await withAnthropicRetry(() => anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `You are a YouTube thumbnail art director. Write a Flux image generation prompt for a product shot in a real, story-driven scene. NO faces, NO people. The product must look exactly as described — use every visual detail from the product data below.

PRODUCT DATA:
TITLE: "${opts.videoTitle}"
PRODUCT NAME: ${opts.productTitle || 'Unknown product'}
${opts.productDescription ? `DESCRIPTION: ${opts.productDescription}` : ''}
${opts.productBullets.length ? `FEATURES: ${opts.productBullets.slice(0, 4).join(' · ')}` : ''}

SETTING / MOOD (use THIS — it sets the background and lighting): ${sceneMood}
${opts.channelStyle ? `CHANNEL AESTHETIC (also match this): ${opts.channelStyle}` : ''}

YOUR TASK:
1. PRODUCT APPEARANCE — extract exact visual details from the data above: colour, shape, size, material, any text/branding on it. Describe it precisely so the AI renders the RIGHT product.
2. SCENE — place the product in the SETTING/MOOD above. A real place with depth and atmosphere, background softly blurred but recognisable. Not a plain studio, not a white background.
3. COMPOSITION — product CENTRE / CENTRE-LEFT, large and sharp. Keep the TOP-LEFT and the BOTTOM-RIGHT areas relatively clean (a title goes top-left, a person is added bottom-right later).
4. LIGHTING — MATCH the setting above. If the setting is bright/airy, use bright, natural daylight (do NOT make it dark or heavily moody). Make the product look appealing and true-to-life.
5. End with: "16:9, photorealistic, 8K, shallow depth of field, no faces, no people, no text overlays"
6. Under 90 words total.

Return ONLY the prompt.`,
    }],
  }))
  recordAnthropicUsage(msg, {
    userId: TELEMETRY.userId, tier: TELEMETRY.tier,
    feature: 'yt_thumb_product_prompt', model: 'claude-sonnet-4-6',
  })
  return (msg.content[0] as { type: string; text: string }).text.trim()
}

// ── Claude Haiku: viral, general thumbnail title ──────────────────────────────
async function generateHook(videoTitle: string): Promise<string> {
  const anthropic = createAnthropicClient()
  const msg = await withAnthropicRetry(() => anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 40,
    messages: [{
      role: 'user',
      content: `Write ONE viral, hooky YouTube thumbnail title for this video. It must be GENERAL, intriguing and FUN — built on curiosity, tension, contrast, emotion, or mystery — NOT a product-specific claim.

VIDEO: "${videoTitle}"

STRICT RULES (breaking any = bad title):
- 3 to 7 words, a complete punchy phrase.
- NEVER mention results or outcomes (no "results", "before/after", "after X days").
- NEVER make a health, medical, or benefit claim (no "cures", "gone", "weight loss", "hair growth", "cellulite", "detox", etc.).
- NEVER boast about testing for a time period (no "I tried this for 30 days", "30 days later").
- No spammy hype words (AMAZING, INSANE, INCREDIBLE). NEVER use the word HONEST.
- Keep it general and relatable — it should make ANYONE curious, even if they've never seen the product.

STYLE TO MATCH (write a FRESH one in this spirit, do not copy verbatim):
"I Didn't Expect This" · "Why Is Nobody Talking About This?" · "This Feels Illegal" · "This Makes No Sense" · "I Wasn't Ready for This" · "This Shouldn't Be This Good" · "The Internet Was Right About This" · "Tiny Gadget. Huge Difference." · "I Think This Changes Everything" · "This Is Either Genius or Stupid" · "Amazon Sent Us THIS" · "I Can't Stop Using This" · "Why Does This Even Exist?"

Return ONLY the title text — no quotes, no preamble.`,
    }],
  }))
  recordAnthropicUsage(msg, {
    userId: TELEMETRY.userId, tier: TELEMETRY.tier,
    feature: 'yt_thumb_hook', model: 'claude-haiku-4-5-20251001',
  })
  return (msg.content[0] as { type: string; text: string }).text.trim().toUpperCase()
}

// (generatePersonScenePrompt removed 2026-05-22 with the flux-lora retirement —
//  the face path is now gpt-image-1/2 with the creator's reference photos.)

// ── Claude Haiku vision: extract aesthetic from a style reference image ─────
// User uploads any image they like the look of (a competitor thumbnail, a
// moodboard pic, one of their own previous wins). We distill it into a
// short style brief that gets folded into the scene prompt — color
// palette, lighting, composition, mood. Cheap (~$0.005/call) and works
// alongside the product-image Kontext path without conflicting.
async function extractStyleBrief(referenceUrl: string): Promise<string | null> {
  try {
    const anthropic = createAnthropicClient()
    const msg = await withAnthropicRetry(() => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 180,
      messages: [{
        role: 'user',
        content: [
          { type: 'image' as const, source: { type: 'url' as const, url: referenceUrl } },
          {
            type: 'text' as const,
            text: `Analyse this thumbnail's VISUAL STYLE only — ignore the subject matter and any text overlays.
Describe in 2 short sentences:
1. Color palette + lighting (e.g. "warm sunset orange / teal shadow split, hard rim light")
2. Composition + mood (e.g. "subject hard-left, blurred busy background, high-contrast cinematic")
Be specific. No filler words. Return only the description, no preamble.`,
          },
        ],
      }],
    }))
    recordAnthropicUsage(msg, {
      userId: TELEMETRY.userId, tier: TELEMETRY.tier,
      feature: 'yt_thumb_style_brief', model: 'claude-haiku-4-5-20251001',
    })
    return (msg.content[0] as { type: string; text: string }).text.trim()
  } catch {
    return null
  }
}

// ── Generate a transparent-background cut-out of the creator ──────────────────
// Head-and-shoulders PNG with alpha, generated FRESH each time from the
// uploaded photos (gpt-image, face-only — no product, so no identity blending).
// We deliberately do NOT cache/reuse it: each thumbnail gets a different OUTFIT
// and expression (same person) so a channel's thumbnails feel varied, not
// copy-pasted. The client composites this into the bottom-right corner.
// Best-effort: returns null on any failure (thumbnail still renders, no person).
const CUTOUT_OUTFITS = [
  'a casual button-up shirt', 'a plain crew-neck t-shirt', 'a smart blazer over a tee',
  'a polo shirt', 'a cozy knit sweater', 'a denim shirt', 'a simple hoodie',
]
const CUTOUT_EXPRESSIONS = [
  'a warm friendly smile', 'a confident slight smile', 'an intrigued raised-eyebrow look',
  'a wide, pleasantly-surprised open-mouth expression', 'an approachable grin showing teeth',
  'a relaxed natural smile', 'a wide-eyed amazed "wow" expression', 'a curious, skeptical squint',
  'a delighted laughing expression', 'a playful smirk', 'a mouth-slightly-open intrigued look',
  'an excited eyebrows-up expression', 'a soft thoughtful smile',
]
const CUTOUT_POSES = [
  'head turned slightly to one side, looking back at the camera',
  'head tilted a little to the side',
  'a slight lean toward the camera',
  'chin angled down a touch with eyes up to the camera',
  'shoulders turned at a three-quarter angle, face to camera',
  'a relaxed straight-on pose facing the camera',
  'one shoulder slightly forward, casual angle',
]
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateFaceCutout(supabase: any, opts: {
  userId: string
  sourceImages: string[]
  imageModel: string
}): Promise<string | null> {
  if (!opts.sourceImages.length) return null
  try {
    const refImages: Array<{ data: Uint8Array; filename: string; mime: string }> = []
    for (const path of opts.sourceImages.slice(0, 5)) {
      const { data: file } = await supabase.storage.from('headshots').download(path)
      if (!file) continue
      try {
        // Re-encode to a clean RGB PNG so gpt-image never rejects the photo
        // for an odd format / colour mode / orientation.
        const png = await normalizeToPng(new Uint8Array(await file.arrayBuffer()))
        refImages.push({ data: png, filename: `face_${refImages.length}.png`, mime: 'image/png' })
      } catch (e) {
        console.warn('[generateFaceCutout] skipping unreadable reference photo', path, e)
      }
    }
    if (refImages.length === 0) return null
    const outfit = pick(CUTOUT_OUTFITS)
    const expression = pick(CUTOUT_EXPRESSIONS)
    const pose = pick(CUTOUT_POSES)
    // 1. Generate a tight CLOSE-UP portrait on a plain backdrop (same call
    //    Photobooth uses — reliable). We remove the background next. We want the
    //    FACE to be big (close crop, chest-up) for impact, but the whole HEAD +
    //    HAIR must stay inside the frame with margin above and on the sides so
    //    rembg gives a clean silhouette (no hard "blade" edge). Only the lower
    //    chest/shoulders may run off the BOTTOM edge — that's hidden when the
    //    cut-out is bottom-anchored in the thumbnail.
    const prompt = `A clean CLOSE-UP portrait of the SAME person shown in the reference photos — preserve their exact facial identity, hair, and likeness. All reference photos are the same one individual; render exactly that one person and do NOT blend or mix with any other face. They are wearing ${outfit}, with ${expression}, ${pose}. Flattering studio lighting, sharp focus, realistic natural skin texture. FRAMING: a tight, close-up head shot — the FACE is large and fills most of the frame (chest-up, head and the top of the shoulders only). CRITICAL — a clear, visible strip of plain background must surround the person: their head, hair, shoulders and arms must NOT touch or be cut off by the TOP, LEFT or RIGHT edges (leave an obvious empty background gap on those three sides). Only the very bottom of the chest may reach the bottom edge. BACKGROUND: a plain, perfectly even, solid VIVID CHROMA-GREEN screen (bright saturated green, like a film green screen) filling the entire background — a strong colour that clearly contrasts with the person's hair, skin and clothing so the background can be removed perfectly with no part of the person mistaken for background. No shadows on the background, no gradients. No text, no logos.`
    const openai = createOpenAIService()
    const b64 = await openai.generateWithReferences({
      prompt, images: refImages, size: '1024x1536', quality: 'medium', model: opts.imageModel,
    })
    recordUsage({
      userId: opts.userId, tier: TELEMETRY.tier,
      feature: 'yt_thumb_face_cutout', model: opts.imageModel, images: 1,
    })

    // Pad the portrait with a wide band of the same chroma-green on the top and
    // both sides BEFORE background removal. This guarantees rembg always sees
    // clean background at every edge (except the bottom, where the chest is
    // meant to run off), so it traces the real body contour as a soft silhouette
    // instead of leaving a hard straight "blade" cut where a shoulder/arm
    // touched the frame. The green matches the generated backdrop so it's
    // removed as one. We trim the transparent margin back off afterwards so the
    // face still fills the composite.
    const CHROMA = '#00b140'
    let uploadBuf: Buffer
    try {
      const meta = await sharp(Buffer.from(b64, 'base64')).metadata()
      const w = meta.width ?? 1024
      const h = meta.height ?? 1536
      uploadBuf = await sharp(Buffer.from(b64, 'base64'))
        .flatten({ background: CHROMA })
        .extend({
          top: Math.round(h * 0.14),
          left: Math.round(w * 0.16),
          right: Math.round(w * 0.16),
          bottom: 0,
          background: CHROMA,
        })
        .png()
        .toBuffer()
    } catch (e) {
      console.warn('[generateFaceCutout] padding failed, using raw portrait:', e)
      uploadBuf = Buffer.from(b64, 'base64')
    }
    const headshotUrl = await fal.storage.upload(new Blob([new Uint8Array(uploadBuf)], { type: 'image/png' }))

    // 2. Remove the background → clean transparent PNG to composite.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rembg = await fal.subscribe('fal-ai/imageutils/rembg' as any, {
        input: { image_url: headshotUrl },
        pollInterval: 2000,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cutUrl = (rembg.data as any)?.image?.url as string | undefined
      if (cutUrl) {
        recordUsage({
          userId: opts.userId, tier: TELEMETRY.tier,
          feature: 'yt_thumb_cutout_rembg', model: 'fal-rembg', images: 1,
        })
        // The transparent padding we added is trimmed back to a tight bounding
        // box on the CLIENT during compositing (alpha-bbox crop) — no extra
        // server round trip, so the face still fills the composite without
        // adding latency here.
        return cutUrl
      }
    } catch (e) {
      console.warn('[generateFaceCutout] rembg failed, using opaque headshot:', e)
    }
    // Fallback: opaque headshot (composites as a small portrait, still shows the person).
    return headshotUrl
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[generateFaceCutout] failed:', msg)
    LAST_CUTOUT_ERROR = msg.slice(0, 300)
    return null
  }
}
// Surfaced to the client console (faceDebug) so cut-out failures are visible.
let LAST_CUTOUT_ERROR = ''

// ── Main route ────────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Tier + billing window for usage-cap check + telemetry.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await (supabase as any)
      .from('integrations')
      .select('tier,subscription_period_start,subscription_period_end')
      .eq('user_id', user.id)
      .single()
    const tier = normalizeTier(tierRow?.tier)
    TELEMETRY = { userId: user.id, tier }

    const falKey = process.env.FAL_KEY
    if (!falKey) return NextResponse.json({ error: 'FAL_KEY is not configured' }, { status: 500 })

    // Parse body BEFORE the cap check so the check can budget for the
    // requested variantCount (1 or 2). Otherwise a user 1 below their cap
    // could click "2 variants" and silently overshoot.
    const {
      quickMode = false,
      videoTitle,
      asin,
      productTitle: providedProductTitle,
      productDescription: providedProductDescription,
      productBullets: providedProductBullets,
      style = 'review',
      customHeadline,
      variantCount: rawVariantCount,
      styleReferenceUrl,
      faceModelId,
      videoDescription,
    } = await request.json() as {
      quickMode?: boolean
      videoTitle: string
      asin?: string
      /** The YouTube description — used to find the product link for a real
       *  product photo when there's no Amazon ASIN (non-Amazon products). */
      videoDescription?: string
      productTitle?: string
      productDescription?: string
      productBullets?: string[]
      style?: string
      /** Locked text overlay. When set, we skip the hook-generation
       *  agent entirely and use this verbatim. The image prompt
       *  explicitly tells Flux NOT to render text — overlay happens
       *  client-side via canvas, so locked text is always crisp. */
      customHeadline?: string
      /** How many variants to generate in a single shot. 1 or 2 only —
       *  clamp server-side. Each variant counts as one image against
       *  the user's thumbnail cap + AI-cost telemetry. */
      variantCount?: number
      /** Optional public image URL the user uploaded as an aesthetic
       *  anchor. Haiku vision distills color/lighting/composition into
       *  a short style brief that gets folded into the image prompt.
       *  Works alongside the product-image path — they don't conflict. */
      styleReferenceUrl?: string
      /** Optional face_models.id — when set we load the user's trained
       *  LoRA + trigger token and route generation through the LoRA-
       *  capable flux-lora endpoint so their actual face appears. */
      faceModelId?: string
    }

    const variantCount = Math.min(2, Math.max(1, Number(rawVariantCount) || 1))
    const lockedHeadline = (customHeadline || '').trim().toUpperCase()

    // ── Load the user's face model if they picked one ─────────────────────────
    // Only honored when status='ready' and lora_url is populated. If the
    // model is still training or failed, we silently fall back to no-face
    // generation rather than throwing — the user already chose, and the
    // worst outcome is a thumbnail without their face this time.
    let faceModel: { name: string; source_images: string[] } | null = null
    if (faceModelId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: fm } = await (supabase as any)
        .from('face_models')
        .select('name,source_images')
        .eq('id', faceModelId)
        .eq('user_id', user.id)
        .single()
      const srcImages: string[] = Array.isArray(fm?.source_images) ? fm.source_images : []
      if (fm && srcImages.length > 0) {
        faceModel = { name: fm.name, source_images: srcImages }
      }
    }

    // Cap gate — thumbnail generations / billing period. Pre-flight the
    // check so we never charge Fal credits + waste 3 Anthropic calls on
    // a user who's already at cap. Skips for quickMode (hook-only call
    // is essentially free, no images generated).
    if (!quickMode) {
      const thumbCap = TIERS[tier].thumbnailsPerMonth
      const capCheck = await checkUsageCap(
        supabase, user.id, PRIMARY_FEATURE.thumbnail, thumbCap,
        (tierRow?.subscription_period_start as string | null) ?? null,
        (tierRow?.subscription_period_end as string | null) ?? null,
      )
      // capCheck.used is the count BEFORE this generation; we need room
      // for `variantCount` more or we reject. Otherwise a user 1 below
      // their cap could click "2 variants" and silently overshoot.
      const wouldExceed = thumbCap !== null && capCheck && (capCheck.used + variantCount > thumbCap)
      if (capCheck?.exceeded || wouldExceed) {
        const next = nextTierFor(tier, 'thumbnailsPerMonth')
        const nextHint = next
          ? ` Upgrade to ${next.label} for ${next.limit === null ? 'unlimited' : `${next.limit} / month`}.`
          : ''
        return NextResponse.json({
          error: `You've hit your ${thumbCap} thumbnail generations for this billing period on the ${TIERS[tier].label} plan.${nextHint} Resets ${capCheck?.resetLabel ?? ''}.`,
          limitReached: true,
          cap: 'thumbnails',
          currentTier: tier,
          upgrade: next ? { tier: next.tier, label: next.label, limit: next.limit } : null,
        }, { status: 429 })
      }
    }

    // ── Quick mode: hook text only ─────────────────────────────────────────────
    if (quickMode) {
      // Locked headline short-circuits the hook agent — no AI call needed.
      const overlayHook = lockedHeadline || (await generateHook(videoTitle))
      return NextResponse.json({ ok: true, overlayHook, quickMode: true })
    }

    // ── Resolve product data + fetch real product image from Amazon ────────────
    let productImageUrl: string | null = null
    let productTitle = providedProductTitle ?? ''
    let productDescription = providedProductDescription ?? ''
    let productBullets = providedProductBullets ?? []

    if (asin) {
      try {
        const p = await fetchAmazonProduct(asin)
        productImageUrl = p.imageUrl
        if (!productTitle) productTitle = p.title
        if (!productDescription) productDescription = p.description
        if (!productBullets.length) productBullets = p.bullets
      } catch { /* fall through */ }
    }

    // NON-AMAZON products: grab the real product photo off the store/brand page
    // the creator linked in the description, so the Kontext path can render the
    // ACTUAL product (mirrors the blog pipeline). Without this, non-Amazon
    // thumbnails fell back to a text-only guess of the product.
    if (!productImageUrl && videoDescription) {
      let pageUrl = firstProductUrl(videoDescription)
      if (pageUrl && /(?:geni\.us|\bgnz\.|amzn\.to|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly)/i.test(pageUrl)) {
        pageUrl = await resolveFinalUrl(pageUrl)
      }
      if (pageUrl) {
        productImageUrl = await fetchProductImageFromPage(pageUrl)
      }
    }

    // ── Fetch channel thumbnails + analyse style (best-effort) ───────────────
    fal.config({ credentials: falKey })

    // Kick off the creator cut-out RIGHT NOW (don't await) so it runs in
    // parallel with channel analysis + prompt gen + the product scene — the
    // gpt-image cut-out is the long pole, so starting it first minimises total
    // wall-clock time.
    const cutoutPromise: Promise<string | null> = faceModel
      ? generateFaceCutout(supabase, {
          userId: user.id,
          sourceImages: faceModel.source_images,
          imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
        })
      : Promise.resolve(null)
    const resolveCutout = async (): Promise<{ url: string | null; debug: string }> => {
      const url = await cutoutPromise
      const debug = !faceModelId
        ? 'no-faceModelId-sent (face not selected in the modal)'
        : !faceModel
          ? 'faceModelId sent but model not found / has no source photos'
          : !url
            ? `cut-out GENERATION FAILED: ${LAST_CUTOUT_ERROR || '(no error captured)'}`
            : 'ok'
      return { url, debug }
    }

    const channelThumbnailUrls = await fetchChannelThumbnails(supabase, user.id)
    const channelStyle = await analyzeChannelStyle(channelThumbnailUrls)
    console.log('[generate-thumbnail] Channel style:', channelStyle ?? 'none')

    // ── Generate scene prompt + hook + (optional) style brief in parallel ───
    // The face path (gpt-image, PATH G below) builds its own prompt inline;
    // this product-only prompt feeds the Kontext / Flux-Pro no-face paths.
    const [productPrompt, generatedHook, styleBrief] = await Promise.all([
      generateProductPrompt({ videoTitle, productTitle, productDescription, productBullets, style, channelStyle }),
      lockedHeadline ? Promise.resolve('') : generateHook(videoTitle),
      styleReferenceUrl ? extractStyleBrief(styleReferenceUrl) : Promise.resolve(null),
    ])
    const overlayHook = lockedHeadline || generatedHook
    // Fold the style brief into the prompt as a high-priority directive so
    // Flux respects color / lighting / composition while still rendering
    // the product or scene we asked for.
    const finalScenePrompt = styleBrief
      ? `VISUAL STYLE (high priority — follow this aesthetic exactly): ${styleBrief}\n\nSCENE: ${productPrompt}`
      : productPrompt
    console.log('[generate-thumbnail] Scene prompt:', finalScenePrompt)
    console.log('[generate-thumbnail] Overlay text:', overlayHook, lockedHeadline ? '(LOCKED)' : '(AI)')
    if (styleBrief) console.log('[generate-thumbnail] Style brief:', styleBrief)

    // ── PATH A: Kontext — use real product image as visual reference ──────────
    // Start from the actual product photo and transform the scene around it.
    // Always product-only (no person) — the creator is composited separately.
    if (productImageUrl) {
      try {
        // fal.ai cannot reach Supabase/Amazon URLs directly — re-host first
        const imgRes = await fetch(productImageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        if (!imgRes.ok) throw new Error(`Cannot fetch product image (${imgRes.status})`)
        const imgBlob = await imgRes.blob()
        const falImageUrl = await fal.storage.upload(imgBlob)
        console.log('[generate-thumbnail] Product image uploaded to fal:', falImageUrl)

        // Kontext: preserve the product, replace background with scene
        const kontextInstruction = `Keep the exact product object from this image — its shape, colour, material, branding, and all details. Remove the white background and any accessories, packaging, or hands. Place the product in the following scene: ${finalScenePrompt}. The product should sit naturally in the scene with realistic shadows and lighting. No white background. No people. No text.`

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const kontextResult = await fal.subscribe('fal-ai/flux-pro/kontext' as any, {
          input: {
            image_url: falImageUrl,
            prompt: kontextInstruction,
            aspect_ratio: '16:9',
            num_images: variantCount,
            output_format: 'jpeg',
            guidance_scale: 5,
          },
          pollInterval: 3000,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const kontextImages = (kontextResult.data as any)?.images as Array<{ url: string }> | undefined
        const kontextUrls = (kontextImages ?? []).map(i => i.url).filter(Boolean)
        if (kontextUrls.length > 0) {
          // Record one usage row per image returned so cap counting + cost
          // telemetry stays accurate when variantCount > 1.
          for (let i = 0; i < kontextUrls.length; i++) {
            recordUsage({
              userId: TELEMETRY.userId, tier: TELEMETRY.tier,
              feature: 'yt_thumb_kontext_image', model: 'fal-flux-pro-kontext', images: 1,
            })
          }
          console.log('[generate-thumbnail] Kontext results:', kontextUrls)
          const { url: personCutoutUrl, debug: faceDebug } = await resolveCutout()
          return NextResponse.json({
            ok: true,
            // Primary url retained for backwards-compat with existing client
            // code; thumbnailUrls is the full array when variantCount > 1.
            thumbnailUrl: kontextUrls[0],
            thumbnailUrls: kontextUrls,
            overlayHook,
            headlineLocked: !!lockedHeadline,
            prompt: kontextInstruction,
            styleBriefApplied: !!styleBrief,
            channelStyle: channelStyle ?? null,
            modelUsed: `kontext-${style}`,
            headshotUsed: !!personCutoutUrl,
            personCutoutUrl,
            faceDebug,
          })
        }
      } catch (err) {
        console.warn('[generate-thumbnail] Kontext path failed, falling back to Flux Pro:', err)
      }
    }

    // (LoRA retired 2026-05-22 — the face path is gpt-image-1/2 above, PATH G.
    //  If that fails we fall through to the product-only Flux Pro path below.)

    // ── PATH C: Flux Pro fallback — no product image, no face model ───────────
    console.log('[generate-thumbnail] Using Flux Pro fallback (no product image)')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fal.subscribe('fal-ai/flux-pro/v1.1' as any, {
      input: {
        prompt: finalScenePrompt,
        image_size: 'landscape_16_9',
        num_inference_steps: 28,
        guidance_scale: 3.5,
        num_images: variantCount,
        output_format: 'jpeg',
        safety_tolerance: '2',
      },
      pollInterval: 3000,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const images = (result.data as any)?.images as Array<{ url: string }> | undefined
    const thumbnailUrls = (images ?? []).map(i => i.url).filter(Boolean)
    if (thumbnailUrls.length === 0) throw new Error('Flux Pro did not return an image. Please try again.')
    for (let i = 0; i < thumbnailUrls.length; i++) {
      recordUsage({
        userId: TELEMETRY.userId, tier: TELEMETRY.tier,
        feature: 'yt_thumb_flux_image', model: 'fal-flux-pro-v1.1', images: 1,
      })
    }

    const { url: personCutoutUrl, debug: faceDebug } = await resolveCutout()
    return NextResponse.json({
      ok: true,
      thumbnailUrl: thumbnailUrls[0],
      thumbnailUrls,
      overlayHook,
      headlineLocked: !!lockedHeadline,
      prompt: finalScenePrompt,
      styleBriefApplied: !!styleBrief,
      channelStyle: channelStyle ?? null,
      modelUsed: `flux-pro-${style}`,
      headshotUsed: !!personCutoutUrl,
      personCutoutUrl,
      faceDebug,
    })
  } catch (err) {
    // fal.ai ApiError has a .body property with the full validation detail
    const falBody = (err as Record<string, unknown>)?.body
    const msg = falBody
      ? JSON.stringify(falBody)
      : (err instanceof Error ? err.message : String(err))
    console.error('[generate-thumbnail] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
