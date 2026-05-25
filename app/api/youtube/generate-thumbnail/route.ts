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
import { rankThumbnails, type ThumbnailScore } from '@/lib/thumbnail-score'
import { composeWithNanoBanana, generateWithIdeogram, rehostToFal, NANO_BANANA_COST_MODEL, IDEOGRAM_COST_MODEL } from '@/lib/thumbnail-generators'
import { resolveBestThumbnail } from '@/lib/youtube-frames'

// Telemetry context — populated at request start, read by the three
// Anthropic helpers below so each call is tagged with the right user/tier.
let TELEMETRY: { userId: string | null; tier: string | null } = { userId: null, tier: null }

// Publish-gate threshold (Phase 2 / Track A). When the best variant's
// vision-LLM score is below this, we flag `belowThreshold` so the client can
// suggest regenerating. We never auto-regenerate server-side — that would
// silently burn the user's thumbnail cap and add latency. 0–100 scale.
const THUMBNAIL_SCORE_THRESHOLD = 55

/**
 * Score + rank generated thumbnail variants best-first. Returns the URLs
 * reordered so index 0 is the strongest, the aligned scores, the top score,
 * and whether the best variant fell below the publish-gate threshold. Fully
 * best-effort: on any scoring failure the original order is preserved and
 * scores come back null, so this can never break generation.
 */
async function rankVariants(
  urls: string[],
  overlayHook: string,
  ctx: { userId?: string | null; tier?: string | null },
): Promise<{ urls: string[]; scores: Array<ThumbnailScore | null>; topScore: number | null; belowThreshold: boolean }> {
  if (urls.length === 0) return { urls, scores: [], topScore: null, belowThreshold: false }
  const ranked = await rankThumbnails(urls, { title: overlayHook, ctx })
  if (!ranked.some(r => r.score !== null)) {
    return { urls, scores: urls.map(() => null), topScore: null, belowThreshold: false }
  }
  const topScore = ranked[0].score?.score ?? null
  return {
    urls: ranked.map(r => r.url),
    scores: ranked.map(r => r.score),
    topScore,
    belowThreshold: topScore !== null && topScore < THUMBNAIL_SCORE_THRESHOLD,
  }
}

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
// Backdrops are ALWAYS BRIGHT, CLEAN and UNCLUTTERED with a strongly blurred
// shallow-depth background. NEVER dark or moody — dark scenes lose all detail
// and the creator cut-out blends into them. A busy, deep room also invites the
// model to hallucinate bystanders; a simple soft bright backdrop does not.
// Backdrops are deliberately SHALLOW with NO room depth — a product on a
// surface against a softly blurred LIGHT wall/backdrop. No open rooms, doorways
// or deep kitchens: those give the model space to hallucinate a background
// person. Always bright, never dark.
const SCENE_MOODS = [
  'a product on a clean light wooden surface, directly behind it a softly blurred plain WARM-WHITE wall filling the whole background, bright soft daylight, very shallow depth of field, no room depth.',
  'a product on a bright neutral countertop with a heavily blurred soft LIGHT-GREY wall right behind it, airy daylight, minimal, no open space or room behind.',
  'a product on a light surface against an out-of-focus soft CREAM backdrop filling the frame, gentle warm daylight, clean and uncluttered, no room visible.',
  'a product on a warm wooden tabletop with one or two softly blurred out-of-focus potted plants close behind against a blurred light wall, bright daylight, shallow depth, no open room.',
  'a product on a bright surface with a softly blurred sunlit LIGHT backdrop directly behind it, warm golden daylight, airy and simple, no deep background.',
  'a product on a sleek light shelf against a softly blurred BRIGHT WHITE wall close behind, lots of daylight, clean and aspirational, no room depth.',
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
2. SCENE — place the product in the SETTING/MOOD above. Keep the background SHALLOW and softly blurred — a wall/backdrop close behind the product, NOT an open room, doorway or deep space. The space is completely EMPTY: nobody is present anywhere, not even a blurred figure in the far background.
3. COMPOSITION — product CENTRE / CENTRE-LEFT, large and sharp. Keep the TOP-LEFT and the BOTTOM-RIGHT areas relatively clean (a title goes top-left, a person is added bottom-right later).
4. LIGHTING — MATCH the setting above. If the setting is bright/airy, use bright, natural daylight (do NOT make it dark or heavily moody). Make the product look appealing and true-to-life.
5. End with: "16:9, photorealistic, 8K, shallow depth of field, absolutely no people, no humans, no faces, no heads, no bodies, no hands, no text overlays"
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
- 3 to 5 words, a complete punchy phrase. SHORTER IS BETTER — it must render cleanly as large baked-in thumbnail text, so avoid long phrases.
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
    const prompt = `A clean CLOSE-UP SOLO portrait of EXACTLY ONE person — the MAIN subject shown in the reference photos. Preserve their exact facial identity, hair, and likeness. IMPORTANT: the reference photos may also contain OTHER people (a partner, friend, or bystander standing next to them) — IGNORE everyone else. Identify the single most prominent main subject (the largest, most central face) and render ONLY that one individual, completely ALONE. CRITICAL: there is ONLY ONE person in the entire output image — absolutely NO second person, no partner, no companion, no extra face, head, shoulder, arm, hand or body part of anyone else anywhere in the frame or its background, not even partially or at the edges. One person, alone on the backdrop. They are wearing ${outfit}, with ${expression}, ${pose}. Flattering studio lighting, sharp focus, realistic natural skin texture. FRAMING (critical): a head-and-shoulders portrait — head and the top of the shoulders, chest-up. The ENTIRE person must sit fully INSIDE the frame, floating toward the centre with a clear, generous band of plain background visible on ALL FOUR sides — top, bottom, left AND right. Their head, hair, shoulders and arms must NOT touch or be cropped by ANY edge. Do NOT zoom in so far that the shoulders or arms reach the left/right edges — pull back enough that there is obvious empty background all the way around the upper body. BACKGROUND: a plain, perfectly even, solid VIVID CHROMA-GREEN screen (bright saturated green, like a film green screen) filling the entire background — a strong colour that clearly contrasts with the person's hair, skin and clothing so the background can be removed perfectly with no part of the person mistaken for background. No shadows on the background, no gradients. No text, no logos.`
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
          top: Math.round(h * 0.12),
          left: Math.round(w * 0.14),
          right: Math.round(w * 0.14),
          bottom: Math.round(h * 0.08),
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
      uploadedPhotoUrl,
      cleanupPrompt,
      youtubeVideoId,
      textMode,
      capturedFrameDataUrl,
    } = await request.json() as {
      quickMode?: boolean
      videoTitle: string
      asin?: string
      /** The YouTube description — used to find the product link for a real
       *  product photo when there's no Amazon ASIN (non-Amazon products). */
      videoDescription?: string
      /** YouTube native ID (e.g. dQw4w9WgXcQ). When present we pull the REAL
       *  video frame (img.youtube.com) and let Nano Banana regenerate a viral
       *  thumbnail from it — the creator + product are already in the frame, so
       *  no face upload is needed. */
      youtubeVideoId?: string | null
      /** 'baked' (default): the headline typography is rendered INTO the image
       *  for the cohesive "designed" look. 'clean': return a text-free scene so
       *  the client can draw its crisp canvas overlay (the fallback). */
      textMode?: 'baked' | 'clean'
      /** A REAL frame grabbed from the user's video by the MVP Co-Pilot Helper
       *  extension (a jpeg data: URL). When present we ground Nano Banana on
       *  this instead of maxresdefault — it captures the creator + product as
       *  they actually appear on camera (vidIQ-style). Absent → maxres frame. */
      capturedFrameDataUrl?: string | null
      productTitle?: string
      productDescription?: string
      productBullets?: string[]
      style?: string
      /** Locked text overlay. When set, we skip the hook-generation
       *  agent entirely and use this verbatim. The image prompt
       *  explicitly tells Flux NOT to render text — overlay happens
       *  client-side via canvas, so locked text is always crisp. */
      customHeadline?: string
      /** How many variants to generate in a single shot. 1–10 — clamped
       *  server-side. Each variant counts as one image against the user's
       *  thumbnail cap + AI-cost telemetry, and the monthly cap pre-flight
       *  budgets for the full requested count. */
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
      /** "Upload your own photo" flow — a public URL to a photo the user
       *  took of THEMSELVES with the product. We send it through Kontext to
       *  clean it up / re-render it into a polished thumbnail scene, then
       *  overlay the title. No separate face cut-out (the photo has them). */
      uploadedPhotoUrl?: string
      /** Optional free-text direction for the re-render of the uploaded photo
       *  (e.g. "bright kitchen, surprised face"). */
      cleanupPrompt?: string
    }

    const variantCount = Math.min(10, Math.max(1, Number(rawVariantCount) || 1))
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

    // ── PATH NB (PRIMARY): Nano Banana, grounded on the REAL video frame ─────
    // Mirrors how the fast competitor works: the creator + product are ALREADY
    // in the video's own frame, so we feed THAT frame to Gemini and let it
    // regenerate a vibrant, viral thumbnail — no face upload, no client-side
    // compositing. By default the headline typography is BAKED into the image
    // (the cohesive "designed" look). textMode:'clean' instead returns a
    // text-free scene for the crisp client-overlay fallback. On any failure we
    // fall through to the Kontext / Flux paths below, so this stays safe.
    const hasCapturedFrame = typeof capturedFrameDataUrl === 'string' && capturedFrameDataUrl.startsWith('data:image/')
    if (youtubeVideoId || hasCapturedFrame) {
      try {
        // Prefer the REAL frame the extension grabbed (creator + product on
        // camera); otherwise fall back to the uploader's maxres frame.
        const baseFrame = hasCapturedFrame
          ? (capturedFrameDataUrl as string)
          : await resolveBestThumbnail(youtubeVideoId as string)
        const frameRef = await rehostToFal(baseFrame)
        if (frameRef) {
          const overlayHookNB = lockedHeadline || (await generateHook(videoTitle))
          const wantClean = textMode === 'clean'
          // A single grabbed frame often catches the creator BEFORE the product
          // is on screen (intro/hook). So we also pass the real product image as
          // a SECOND reference and tell Gemini to compose it INTO the creator's
          // scene — guaranteeing the product is present + accurate while keeping
          // the real on-camera person. (frame = person/expression/lighting;
          // product image = fidelity.)
          // IDENTITY FIRST: this is the creator's REAL video frame. Treat it as
          // an ENHANCE, not a compose — adding a separate product image as a 2nd
          // reference made Gemini regenerate (and fabricate) the person. So we
          // ground on the frame ALONE and forbid replacing anyone, which keeps
          // the actual person(s) from the video. The product comes from the
          // frame itself (we capture a frame where it's on screen).
          const refs = [frameRef]
          const identityLock = `This is the creator's REAL video frame containing real people. You MUST keep EVERY person's FACE exactly as it is — same facial features, proportions, age, ethnicity, skin tone, hair, gender and build. Do NOT replace, swap, add or remove any person, and do NOT invent a new or different-looking person — the people in the output must be the SAME individuals as in the input photo, not lookalikes or models. Do not beautify, slim, de-age or restyle their faces. Keep any product and objects already in the frame exactly as they appear.`
          const styleClause = `Now transform it into a vibrant, scroll-stopping, high-CTR viral YouTube thumbnail (16:9): dramatically re-light and colour-grade with bright, punchy, saturated, HIGH-CONTRAST colours and depth so it POPS at small sizes; give the person an energetic, expressive reaction (you may open the mouth / raise eyebrows) while keeping their face IDENTICAL; clean up and softly blur the background into a premium, modern look. CRITICAL: REMOVE any on-screen text, captions, lower-thirds, channel names, watermarks, logos or graphics that were burned into the original video frame (other than branding physically on the product itself).`
          // Baked: Gemini renders the headline INTO the image as viral type.
          const bakedPrompt = `${identityLock} ${styleClause} Render the headline text EXACTLY: "${overlayHookNB}" — large bold ALL-CAPS viral YouTube typography (dual-tone, e.g. white with one bold accent colour, thick black outline + drop shadow) in the upper-LEFT over a clear area, not covering any face or the product. Spell it EXACTLY ONCE, letter-for-letter, with NO repeated or duplicated words. No other text, no watermarks or logos (other than branding already on the product). Photorealistic, sharp focus, no borders.`
          // Clean: no text — leaves room for the client's canvas overlay.
          const cleanPrompt = `${identityLock} ${styleClause} Keep the upper-LEFT area relatively clean and uncluttered for a headline added afterwards. Render NO text, letters, numbers, captions, watermarks or logos anywhere (other than branding already on the product). Photorealistic, sharp focus, no borders.`
          const nbPrompt = wantClean ? cleanPrompt : bakedPrompt

          // Fire `variantCount` parallel single-image composes — guarantees the
          // requested number of DISTINCT variants and runs concurrently, so
          // wall-clock time ≈ a single generation.
          const nbBatches = await Promise.all(
            Array.from({ length: variantCount }, () =>
              composeWithNanoBanana({ prompt: nbPrompt, referenceImageUrls: refs, aspectRatio: '16:9', numImages: 1 }),
            ),
          )
          const nbUrls = nbBatches.flat().filter(Boolean).slice(0, variantCount)

          if (nbUrls.length > 0) {
            for (let i = 0; i < nbUrls.length; i++) {
              recordUsage({
                userId: TELEMETRY.userId, tier: TELEMETRY.tier,
                feature: 'yt_thumb_nanobanana_image', model: NANO_BANANA_COST_MODEL, images: 1,
              })
            }
            const rank = await rankVariants(nbUrls, overlayHookNB, { userId: TELEMETRY.userId, tier: TELEMETRY.tier })
            return NextResponse.json({
              ok: true,
              thumbnailUrl: rank.urls[0],
              thumbnailUrls: rank.urls,
              thumbnailScores: rank.scores,
              thumbnailScore: rank.topScore,
              belowThreshold: rank.belowThreshold,
              overlayHook: overlayHookNB,
              headlineLocked: !!lockedHeadline,
              prompt: nbPrompt,
              styleBriefApplied: false,
              channelStyle: null,
              modelUsed: wantClean ? 'nano-banana-clean' : 'nano-banana',
              // baked:true → headline is already IN the image; the client must
              // NOT draw a text overlay. baked:false (clean) → client overlays.
              baked: !wantClean,
              composited: true,
              headshotUsed: false,
              personCutoutUrl: null,
              faceDebug: `nano-banana enhance (source=${hasCapturedFrame ? 'extension-frame' : 'maxres'}, textMode=${wantClean ? 'clean' : 'baked'})`,
            })
          }
          console.warn('[generate-thumbnail] Nano Banana (frame) returned no image; falling through')
        }
      } catch (err) {
        console.warn('[generate-thumbnail] Nano Banana frame path failed, falling through:', err)
      }
    }

    // ── PATH U: user uploaded their own photo (them + the product) ───────────
    // Clean it up / re-render it into a polished YouTube thumbnail scene with
    // Kontext, then the client overlays the title. No product fetch, no face
    // cut-out — the uploaded photo already contains the person and product.
    if (typeof uploadedPhotoUrl === 'string' && /^https?:\/\//.test(uploadedPhotoUrl)) {
      try {
        const overlayHookU = lockedHeadline || (await generateHook(videoTitle))
        const photoRes = await fetch(uploadedPhotoUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        if (!photoRes.ok) throw new Error(`Cannot fetch uploaded photo (${photoRes.status})`)
        const falPhotoUrl = await fal.storage.upload(await photoRes.blob())

        const cleanup = (typeof cleanupPrompt === 'string' ? cleanupPrompt : '').trim().slice(0, 400)
        const kontextInstruction = `Transform this user-submitted photo into a clean, professional, eye-catching YouTube thumbnail. KEEP the same person and the same product they are holding/showing — preserve their facial identity, likeness and the product's exact appearance, branding and details. Clean it up: remove clutter and distractions, fix harsh or dim lighting into bright flattering light, sharpen and colour-grade for a premium, high-contrast thumbnail look, and place them in a bright, clean, uncluttered setting with a softly blurred background. Keep the person clearly visible and well-lit. ${cleanup ? `ADDITIONAL DIRECTION: ${cleanup}. ` : ''}Do NOT add any other people. Do NOT render any text, captions, watermarks or logos (other than what is physically on the product). Photorealistic, 16:9.`

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const kontextResult = await fal.subscribe('fal-ai/flux-pro/kontext' as any, {
          input: {
            image_url: falPhotoUrl,
            prompt: kontextInstruction,
            aspect_ratio: '16:9',
            num_images: variantCount,
            output_format: 'jpeg',
            guidance_scale: 4,
          },
          pollInterval: 3000,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const imgs = (kontextResult.data as any)?.images as Array<{ url: string }> | undefined
        const urls = (imgs ?? []).map(i => i.url).filter(Boolean)
        if (urls.length > 0) {
          for (let i = 0; i < urls.length; i++) {
            recordUsage({
              userId: TELEMETRY.userId, tier: TELEMETRY.tier,
              feature: 'yt_thumb_kontext_image', model: 'fal-flux-pro-kontext', images: 1,
            })
          }
          const rank = await rankVariants(urls, overlayHookU, { userId: TELEMETRY.userId, tier: TELEMETRY.tier })
          return NextResponse.json({
            ok: true,
            thumbnailUrl: rank.urls[0],
            thumbnailUrls: rank.urls,
            thumbnailScores: rank.scores,
            thumbnailScore: rank.topScore,
            belowThreshold: rank.belowThreshold,
            overlayHook: overlayHookU,
            headlineLocked: !!lockedHeadline,
            prompt: kontextInstruction,
            styleBriefApplied: false,
            channelStyle: null,
            modelUsed: 'kontext-upload',
            headshotUsed: false,
            personCutoutUrl: null,
            faceDebug: 'upload-path (no cut-out — photo already has the person)',
          })
        }
        // If Kontext returned nothing, fall through to the normal pipeline.
        console.warn('[generate-thumbnail] upload path returned no image; falling through')
      } catch (err) {
        console.warn('[generate-thumbnail] upload path failed, falling through:', err)
      }
    }

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
        const kontextInstruction = `Keep ONLY the exact product object from this image — its shape, colour, material, branding, and all details. IMPORTANT: if the original image contains ANY person, model, hands, arms or body parts, REMOVE them completely — keep only the product itself, nothing human. Remove the white background and any accessories or packaging. Place the product in the following scene: ${finalScenePrompt}. The product should sit naturally in the scene with realistic shadows and lighting. The scene MUST be BRIGHT and well-lit with light, airy tones and clear background detail — NEVER dark, black, dim or moody. COMPOSITION (important): position the product on the LEFT / CENTRE-LEFT of the frame and keep the RIGHT THIRD of the image open — empty background / negative space — because a person will be composited into the bottom-right corner afterwards, so the product must NOT extend into the right third or it will be covered. CRITICAL: there must be ABSOLUTELY NO people anywhere — no humans, no faces, no heads, no bodies, no hands, no silhouettes or reflections of people in the scene or its background. The scene is completely empty of any person. No white background. No text.`

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
          const rank = await rankVariants(kontextUrls, overlayHook, { userId: TELEMETRY.userId, tier: TELEMETRY.tier })
          return NextResponse.json({
            ok: true,
            // Primary url retained for backwards-compat with existing client
            // code; thumbnailUrls is the full array (best-first) when variantCount > 1.
            thumbnailUrl: rank.urls[0],
            thumbnailUrls: rank.urls,
            thumbnailScores: rank.scores,
            thumbnailScore: rank.topScore,
            belowThreshold: rank.belowThreshold,
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

    // ── PATH I: Ideogram v3 — text-forward scene (no product image) ──────────
    // For the no-reference case Ideogram produces stronger graphic/thumbnail-
    // style images than Flux Pro v1.1 (and far cleaner typography if we ever
    // bake text in). The headline is still overlaid client-side, so the shared
    // scene prompt tells it to avoid text. Falls through to Flux Pro on empty.
    try {
      const ideoUrls = await generateWithIdeogram({ prompt: finalScenePrompt, numImages: variantCount, renderingSpeed: 'BALANCED' })
      if (ideoUrls.length > 0) {
        for (let i = 0; i < ideoUrls.length; i++) {
          recordUsage({
            userId: TELEMETRY.userId, tier: TELEMETRY.tier,
            feature: 'yt_thumb_ideogram_image', model: IDEOGRAM_COST_MODEL, images: 1,
          })
        }
        const { url: personCutoutUrl, debug: faceDebug } = await resolveCutout()
        const rank = await rankVariants(ideoUrls, overlayHook, { userId: TELEMETRY.userId, tier: TELEMETRY.tier })
        return NextResponse.json({
          ok: true,
          thumbnailUrl: rank.urls[0],
          thumbnailUrls: rank.urls,
          thumbnailScores: rank.scores,
          thumbnailScore: rank.topScore,
          belowThreshold: rank.belowThreshold,
          overlayHook,
          headlineLocked: !!lockedHeadline,
          prompt: finalScenePrompt,
          styleBriefApplied: !!styleBrief,
          channelStyle: channelStyle ?? null,
          modelUsed: `ideogram-${style}`,
          headshotUsed: !!personCutoutUrl,
          personCutoutUrl,
          faceDebug,
        })
      }
      console.warn('[generate-thumbnail] Ideogram returned no image; falling back to Flux Pro')
    } catch (err) {
      console.warn('[generate-thumbnail] Ideogram path failed, falling back to Flux Pro:', err)
    }

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
    const rank = await rankVariants(thumbnailUrls, overlayHook, { userId: TELEMETRY.userId, tier: TELEMETRY.tier })
    return NextResponse.json({
      ok: true,
      thumbnailUrl: rank.urls[0],
      thumbnailUrls: rank.urls,
      thumbnailScores: rank.scores,
      thumbnailScore: rank.topScore,
      belowThreshold: rank.belowThreshold,
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
