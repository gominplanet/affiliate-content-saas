import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { fetchAmazonProduct } from '@/services/amazon'
import { resolveProductReference } from '@/lib/resolve-product-reference'
import { createOpenAIService, normalizeToPng } from '@/services/openai'
import { fal } from '@fal-ai/client'
import sharp from 'sharp'
import { getValidYouTubeToken, createYouTubeOAuthService } from '@/services/youtube'
import { recordAnthropicUsage, recordUsage } from '@/lib/ai-usage'
import { TIERS, nextTierFor, normalizeTier, checkGenerationLimit, type Tier } from '@/lib/tier'
import { checkUsageCap, PRIMARY_FEATURE } from '@/lib/usage-cap'
import { rankThumbnails, pickBestFrame, type ThumbnailScore } from '@/lib/thumbnail-score'
import { type TextPosition } from '@/lib/thumbnail-textzone'
import { NO_BRAND_IMAGE_CLAUSE } from '@/lib/image-guard'
import { composeWithNanoBanana, composeWithNanoBananaPro, generateWithIdeogram, rehostToFal, rehostFacePhotos, rehostStyleRefs, applyMoodyGrade, NANO_BANANA_COST_MODEL, NANO_BANANA_PRO_COST_MODEL, IDEOGRAM_COST_MODEL } from '@/lib/thumbnail-generators'
import { renderDesignerOverlay } from '@/lib/thumbnail-text-templates'
import { analyzeTextZone } from '@/lib/thumbnail-textzone'
import { getStarredPhotoboothRefs } from '@/lib/photobooth-refs'
import { getThumbnailFaceRef } from '@/lib/identity-anchor'
import { resolveBestThumbnail } from '@/lib/youtube-frames'
import { fetchStoryboardFrames } from '@/lib/youtube-storyboards'

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
5. End with: "16:9, photorealistic, 8K, shallow depth of field, absolutely no people, no humans, no faces, no heads, no bodies, no hands, no text overlays, no brand names or retailer/marketplace logos (no Amazon/Prime/store logos), no watermarks, no copyright or trademark symbols, no price tags or badges — only the product's own physical branding"
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
      content: `Write ONE viral, poppy YouTube thumbnail title for this video. It must be GENERAL, intriguing and FUN — built on curiosity, tension, contrast, emotion, or mystery — NOT a product-specific claim.

VIDEO: "${videoTitle}"

STRICT RULES (breaking any = bad title):
- 2 OR 3 WORDS MAXIMUM. Hard ceiling. A 4-word title is a fail. Big poppy thumbnails (think vidIQ / MrBeast / Smart Toaster) live on 2–3 huge words, not phrases.
- Every word must EARN its slot — no filler, no articles ("a", "the"), no connectors ("is", "was", "it").
- NEVER mention results or outcomes (no "results", "before/after", "after X days").
- NEVER make a health, medical, or benefit claim (no "cures", "gone", "weight loss", "hair growth", "cellulite", "detox", etc.).
- NEVER boast about testing for a time period.
- No spammy hype words (AMAZING, INSANE, INCREDIBLE). NEVER use the word HONEST.
- Relatable — makes ANYONE curious even if they've never seen the product.

STYLE TO MATCH (write a FRESH one in this spirit, do not copy verbatim — count the words!):
"GAME OVER" · "WORTH IT?" · "DON'T BUY" · "MUST HAVE" · "GAME CHANGER" · "MIND BLOWN" · "TOO GOOD" · "NEW FAVE" · "HIDDEN GEM" · "REAL DEAL" · "PURE GENIUS" · "FINALLY!" · "NEED THIS" · "OH WOW" · "BIG MISTAKE" · "LIFE CHANGING" · "ACTUALLY WORKS" · "TOTALLY OBSESSED" · "BEST EVER"

Return ONLY the title text — no quotes, no preamble.`,
    }],
  }))
  recordAnthropicUsage(msg, {
    userId: TELEMETRY.userId, tier: TELEMETRY.tier,
    feature: 'yt_thumb_hook', model: 'claude-haiku-4-5-20251001',
  })
  return (msg.content[0] as { type: string; text: string }).text.trim().toUpperCase()
}

// ── Claude Haiku: N DISTINCT viral thumbnail titles (one per variant) ─────────
// When the user asks for 2–3 variants we want different headline COPY on each,
// not just restyled versions of the same line. One call returns a JSON array of
// distinct hooks. Falls back to repeating a single hook on any parse failure.
async function generateHooks(videoTitle: string, count: number): Promise<string[]> {
  const n = Math.max(1, Math.min(10, Math.floor(count)))
  if (n === 1) return [await generateHook(videoTitle)]
  try {
    const anthropic = createAnthropicClient()
    const msg = await withAnthropicRetry(() => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 160,
      messages: [{
        role: 'user',
        content: `Write ${n} DISTINCT viral YouTube thumbnail titles for this video. Each must be GENERAL, intriguing and FUN — built on curiosity, tension, contrast, emotion or mystery — NOT a product-specific claim. They must be DIFFERENT from each other (different angle/emotion/structure), not rewordings of one idea.

VIDEO: "${videoTitle}"

STRICT RULES for EACH title (breaking any = bad):
- 2 OR 3 WORDS MAXIMUM per title. Hard ceiling. A 4-word title is a fail. Big poppy thumbnails (vidIQ / MrBeast / Smart Toaster) live on 2–3 huge words, not phrases.
- Every word EARNS its slot — no filler, no articles ("a", "the"), no connectors ("is", "was", "it").
- NEVER mention results/outcomes. NEVER a health/medical/benefit claim. NEVER boast about testing for a time period.
- No spammy hype words (AMAZING, INSANE, INCREDIBLE). NEVER use the word HONEST.
- Relatable — makes ANYONE curious even if they've never seen the product.

STYLE (write FRESH ones in this spirit, do not copy verbatim — count the words!):
"GAME OVER" · "WORTH IT?" · "DON'T BUY" · "MUST HAVE" · "GAME CHANGER" · "MIND BLOWN" · "TOO GOOD" · "NEW FAVE" · "HIDDEN GEM" · "REAL DEAL" · "PURE GENIUS" · "FINALLY!" · "NEED THIS" · "OH WOW" · "BIG MISTAKE" · "LIFE CHANGING" · "ACTUALLY WORKS" · "BEST EVER"

Return ONLY a JSON array of exactly ${n} strings.`,
      }],
    }))
    recordAnthropicUsage(msg, {
      userId: TELEMETRY.userId, tier: TELEMETRY.tier,
      feature: 'yt_thumb_hooks', model: 'claude-haiku-4-5-20251001',
    })
    const text = ((msg.content[0] as { type: string; text: string }).text || '').trim()
    const m = text.match(/\[[\s\S]*\]/)
    if (m) {
      const arr = JSON.parse(m[0]) as unknown[]
      const hooks = arr.map(h => String(h || '').trim().toUpperCase()).filter(Boolean)
      if (hooks.length > 0) {
        // Pad to n by cycling if the model returned fewer than asked.
        return Array.from({ length: n }, (_, i) => hooks[i % hooks.length])
      }
    }
  } catch { /* fall through to single-hook repeat */ }
  const one = await generateHook(videoTitle)
  return Array.from({ length: n }, () => one)
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

/**
 * Auto-pick the right face model for a video by vision-comparing the video
 * frame to one reference photo from each model (e.g. Seb vs Michelle). One
 * cheap Haiku call. Returns the matching model, or null if none clearly match.
 */
async function matchFaceModelToFrame<T extends { name: string; source_images: string[] }>(
  frameUrl: string,
  models: T[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ctx: { userId: string | null; tier: string | null },
): Promise<T | null> {
  if (models.length === 0) return null
  if (models.length === 1) return models[0]
  const valid = models
    .map(m => {
      try { return { m, url: supabase.storage.from('headshots').getPublicUrl(m.source_images[0]).data.publicUrl as string } }
      catch { return null }
    })
    .filter((x): x is { m: T; url: string } => !!x?.url)
  if (valid.length === 0) return models[0]
  try {
    const anthropic = createAnthropicClient()
    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: `Image 1 is a still from a video showing the on-camera host. Each following image is a reference photo of a DIFFERENT person, numbered 1 to ${valid.length}. Which reference photo shows the SAME human as the host in image 1? Reply with ONLY that number, or 0 if none clearly match.` },
      { type: 'image', source: { type: 'url', url: frameUrl } },
    ]
    valid.forEach((v, i) => {
      content.push({ type: 'text', text: `Reference ${i + 1}:` })
      content.push({ type: 'image', source: { type: 'url', url: v.url } })
    })
    const msg = await withAnthropicRetry(() => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: content as any }],
    }))
    recordAnthropicUsage(msg, { userId: ctx.userId, tier: ctx.tier, feature: 'yt_thumb_face_match', model: 'claude-haiku-4-5-20251001' })
    const txt = (msg.content[0] as { type: string; text: string }).text || ''
    const n = parseInt(txt.match(/\d+/)?.[0] || '0', 10)
    if (n >= 1 && n <= valid.length) return valid[n - 1].m
  } catch { /* fall through — no match */ }
  return null
}

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
// Why the PRIMARY composed (Nano Banana) path didn't return an image, so when we
// fall through to a product-only fallback the UI can show exactly what happened
// (gate skipped, threw, or compose returned nothing) — no server logs needed.
let LAST_NB_FALLTHROUGH = ''

// ── Main route ────────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Tier + billing window for usage-cap check + telemetry.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await supabase
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
      faceAuto,
      videoDescription,
      uploadedPhotoUrl,
      cleanupPrompt,
      youtubeVideoId,
      textMode,
      capturedFrameDataUrl,
      capturedFrames,
      // 3C — Multi-product reference photos + composition note. When set, these
      // are used as the product references for Nano Banana Pro instead of the
      // single Amazon-resolved photo. Lets creators show MULTIPLE products in
      // one thumbnail (comparison videos), or multiple angles of one product.
      customProductImageUrls,
      productCompositionNote,
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
      /** A single REAL frame grabbed by the extension (jpeg data: URL). Legacy
       *  single-frame path. Superseded by capturedFrames. */
      capturedFrameDataUrl?: string | null
      /** SEVERAL real frames grabbed across the video by the extension (jpeg
       *  data: URLs). We vision-pick the best (clear face + product visible) and
       *  ground Nano Banana on it — captures the creator + product as they
       *  actually appear on camera. Absent → maxres frame. */
      capturedFrames?: string[] | null
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
      /** Optional face_models.id — when set we load that specific face's
       *  reference photos to lock the host's likeness. */
      faceModelId?: string
      /** When true (and no explicit faceModelId), the route loads ALL the
       *  user's ready face models and vision-matches the video frame to pick
       *  the right person automatically (e.g. Seb vs Michelle). */
      faceAuto?: boolean
      /** "Upload your own photo" flow — a public URL to a photo the user
       *  took of THEMSELVES with the product. We send it through Kontext to
       *  clean it up / re-render it into a polished thumbnail scene, then
       *  overlay the title. No separate face cut-out (the photo has them). */
      uploadedPhotoUrl?: string
      /** Optional free-text direction for the re-render of the uploaded photo
       *  (e.g. "bright kitchen, surprised face"). */
      cleanupPrompt?: string
      /** 3C — Up to 5 public image URLs the user uploaded as reference photos
       *  of the actual product(s). When present, these REPLACE the single
       *  Amazon-scraped product image as the references fed to Nano Banana
       *  Pro. Use cases:
       *  - Multiple angles of one product (front / side / detail)
       *  - Multiple products in a comparison-style thumbnail (Product A vs B)
       *  - Custom product when no Amazon ASIN exists
       *  Public Supabase URLs. Clamped to 5 server-side. */
      customProductImageUrls?: string[]
      /** Optional free-text composition direction explaining how to arrange the
       *  product references — e.g. "front view on the left, side angle on the
       *  right" or "Product A above, Product B below". Folded into the
       *  productRefClause so Nano Banana Pro respects it. */
      productCompositionNote?: string
    }

    const variantCount = Math.min(10, Math.max(1, Number(rawVariantCount) || 1))
    const lockedHeadline = (customHeadline || '').trim().toUpperCase()

    // ── Load the user's face model if they picked one ─────────────────────────
    // Only honored when status='ready' and lora_url is populated. If the
    // model is still training or failed, we silently fall back to no-face
    // generation rather than throwing — the user already chose, and the
    // worst outcome is a thumbnail without their face this time.
    let faceModel: { id: string; name: string; source_images: string[] } | null = null
    // Auto-match pool: all the user's ready face models (used when faceAuto is
    // on and no specific model was picked — we vision-match the frame below).
    let autoFaceModels: Array<{ id: string; name: string; source_images: string[] }> = []
    if (faceModelId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: fm } = await supabase
        .from('face_models')
        .select('name,source_images')
        .eq('id', faceModelId)
        .eq('user_id', user.id)
        .single()
      // face_models.source_images is JSONB Json[]; we always write string[].
      // Filter at the read so downstream consumers get the narrow type.
      const srcImages: string[] = Array.isArray(fm?.source_images)
        ? (fm.source_images as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      if (fm && srcImages.length > 0) {
        faceModel = { id: faceModelId, name: fm.name, source_images: srcImages }
      }
    } else if (faceAuto) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: fms } = await supabase
        .from('face_models')
        .select('id,name,source_images,status')
        .eq('user_id', user.id)
      autoFaceModels = ((fms as Array<{ id: string; name: string; source_images: string[]; status: string }>) || [])
        .filter(m => m.status === 'ready' && Array.isArray(m.source_images) && m.source_images.length > 0)
        .map(m => ({ id: m.id, name: m.name, source_images: m.source_images }))
      // Only one face on file → no need to match, just use it.
      if (autoFaceModels.length === 1) { faceModel = autoFaceModels[0]; autoFaceModels = [] }
    }

    // Cap gate — unified Generations bucket (migration 101). Bundles
    // blog + thumbnail + metadata into one count per billing period so
    // a Creator burns one bucket of 20, not 20 of each independently.
    // Skips for quickMode (hook-only call is essentially free, no
    // images generated). variantCount is passed as p_units so a "2
    // variants" click reserves 2 units up front instead of letting
    // someone 1 below cap silently overshoot.
    if (!quickMode) {
      const usage = await checkGenerationLimit(supabase, user.id, { units: variantCount })
      if (!usage.allowed) {
        return NextResponse.json({
          error: usage.reason,
          limitReached: true,
          cap: 'generations',
          currentTier: usage.tier,
          upgrade: usage.upgrade,
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

    // 3C — User-supplied product reference photos. When present, these take
    // priority over the auto-resolved Amazon image: the creator knows what
    // they want to show, especially for non-Amazon products or comparison
    // thumbnails. Clamped server-side at 5. Anything not http(s) silently
    // dropped so a malformed URL can't break the run.
    const customProductRefs: string[] = Array.isArray(customProductImageUrls)
      ? customProductImageUrls
          .filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u))
          .slice(0, 5)
      : []
    // Composition note — free-text direction for HOW the products should sit
    // relative to each other in the frame. Optional. Trimmed + length-capped
    // so a user can't shove an essay into the prompt.
    const compositionNote: string = typeof productCompositionNote === 'string'
      ? productCompositionNote.trim().slice(0, 400)
      : ''

    // Use the SINGLE SOURCE OF TRUTH for product-reference resolution so
    // thumbnails benefit from the same Amazon bot-block retry, vision-pick,
    // junk-URL filter, and gallery scrape as blog generation. Need product
    // title/description/bullets in addition to the image, so we still hit
    // Amazon directly when we have an ASIN — but the IMAGE itself comes
    // from the canonical resolver.
    const refForThumbnail = await resolveProductReference({
      title: videoTitle ?? null,
      description: videoDescription ?? null,
      asin: asin ?? null,
      traceTag: `[thumbnail:${(youtubeVideoId || 'novid').slice(0, 8)}]`,
      userId: user.id,
      tier: null,
    })
    productImageUrl = refForThumbnail.productImageUrl ?? productImageUrl

    // Fill in title / description / bullets from Amazon directly when we have
    // the ASIN — the resolver returns the image gallery but not the structured
    // text fields that the thumbnail prompt needs.
    if (asin && (!productTitle || !productDescription || !productBullets.length)) {
      try {
        const p = await fetchAmazonProduct(asin)
        if (!productTitle) productTitle = p.title
        if (!productDescription) productDescription = p.description
        if (!productBullets.length) productBullets = p.bullets
      } catch { /* fall through — resolver already logged any block */ }
    }
    // 3C — When the user uploaded their own product photos, treat the FIRST one
    // as the "single product image" for the Kontext fallback path (which only
    // takes one image_url). The NB Pro path below uses all of them. This means
    // a custom upload also unblocks the Kontext fallback for non-Amazon products.
    if (customProductRefs.length > 0) {
      productImageUrl = customProductRefs[0]
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
    // Real frames grabbed by the extension: prefer the multi-frame array
    // (vision-pick the best), then the legacy single frame, then maxres.
    let validFrames: string[] = Array.isArray(capturedFrames)
      ? capturedFrames.filter((f): f is string => typeof f === 'string' && f.startsWith('data:image/'))
      : []
    // Storyboard fallback: when there are no extension frames and we have a
    // youtubeVideoId, fetch a handful of evenly-spaced key frames from YouTube's
    // own storyboard tiles. Gives us multiple real frames from across the video
    // for grounding + auto-match, without ffmpeg, yt-dlp, or the extension.
    // Best-effort — YouTube blocks scrapers from some cloud IPs, in which case
    // we silently fall back to the maxres thumbnail path below. ~1-2s, no cost.
    if (validFrames.length === 0 && youtubeVideoId) {
      try {
        const sb = await fetchStoryboardFrames(youtubeVideoId as string, { maxFrames: 4 })
        if (sb.length > 0) validFrames = sb.map(f => f.dataUrl)
      } catch { /* best-effort */ }
    }
    const hasCapturedFrame = validFrames.length > 0 || (typeof capturedFrameDataUrl === 'string' && capturedFrameDataUrl.startsWith('data:image/'))
    // The composed NB path is the PRIMARY for creator+product thumbnails and no
    // longer REQUIRES a video frame: a face model and/or a product image are
    // enough to ground it (frame-scrubbing was removed when a face is selected).
    // We still use the real frame when one is available. Only skip NB when there
    // is nothing at all to ground on → product-only Kontext/Flux fallbacks.
    const haveFaceForNB = !!faceModel || autoFaceModels.length > 0
    LAST_NB_FALLTHROUGH = 'NB not entered: no video frame, no face model, no product image'
    if (youtubeVideoId || hasCapturedFrame || haveFaceForNB || productImageUrl) {
      LAST_NB_FALLTHROUGH = 'NB entered, resolving references…'
      try {
        // Pick the best real frame (clear face + product visible) when we have
        // several; otherwise the single frame, the uploader's maxres, or — when
        // there's no video at all — no frame (we ground on the face + product).
        let baseFrame: string | null = null
        if (validFrames.length > 1) {
          const pick = await pickBestFrame(validFrames, { productName: productTitle || undefined, ctx: { userId: user.id, tier } })
          baseFrame = validFrames[pick] ?? validFrames[0]
        } else if (validFrames.length === 1) {
          baseFrame = validFrames[0]
        } else if (typeof capturedFrameDataUrl === 'string' && capturedFrameDataUrl.startsWith('data:image/')) {
          baseFrame = capturedFrameDataUrl
        } else if (youtubeVideoId) {
          baseFrame = await resolveBestThumbnail(youtubeVideoId as string)
        }
        const frameRef = baseFrame ? await rehostToFal(baseFrame) : null
        // Proceed whenever we have SOMETHING to ground on (frame, face, or product).
        if (frameRef || haveFaceForNB || productImageUrl) {
          const wantClean = textMode === 'clean'
          // FIVE distinct title options for the picker. The user clicks the one
          // they want; on the clean (overlay) path it's re-drawn client-side on
          // the text-free image instantly — no regeneration. A locked custom
          // headline collapses to a single option.
          const titleOptions = lockedHeadline ? [lockedHeadline] : await generateHooks(videoTitle, 5)
          // `hooks` drives per-variant text (incl. baked). With variantCount=1 it's
          // just the first option; the full set rides along as titleOptions.
          const hooks = titleOptions
          // Representative hook for the response payload + variant scoring.
          const overlayHookNB = titleOptions[0]

          // Auto-match: when the user left the face on "Auto" and has multiple
          // faces, vision-match the frame to pick the right person (Seb vs
          // Michelle) instead of guessing. Sets faceModel for everything below.
          // Auto-match vision-picks the right person FROM the frame. With no
          // frame we can't match, so fall back to the first available face model.
          if (!faceModel && autoFaceModels.length > 0) {
            faceModel = frameRef
              ? await matchFaceModelToFrame(frameRef, autoFaceModels, supabase, { userId: user.id, tier })
              : autoFaceModels[0]
          }
          // "Your Face" identity references: if the user has a face model, pass
          // a few of their real photos alongside the video frame so Nano Banana
          // Pro locks the host's likeness from MULTIPLE angles — the biggest
          // lever for resemblance vs. a single frame. Best-effort.
          // Identity anchor: one Photobooth-quality gpt-image portrait of the
          // creator (cached per face), led as the PRIMARY likeness reference so
          // the composited face inherits Photobooth fidelity. A couple of the
          // raw photos ride along for extra angles. Falls back to the raw photos
          // if the anchor can't be built.
          // Thumbnails want PUNCH: lead with an "excited" anchor (cached
          // separately from the neutral one) so the composited face carries
          // high-CTR energy instead of a calm headshot expression.
          let faceRefs: string[] = []
          if (faceModel?.source_images?.length) {
            // ── Identity reference priority ───────────────────────────────────
            // 1. STARRED Photobooth shots for THIS face (clean, studio-lit,
            //    same person, ideal Nano Banana input). When present, we use
            //    these alone — mixing in raw uploads dilutes the signal.
            // 2. Excited-expression anchor (generated/cached) + a couple of
            //    raw uploads for backup angles. Anchor build is time-boxed.
            // 3. Raw uploads alone (legacy path; user hasn't run Photobooth
            //    yet on this face).
            //
            // The Photobooth path is the user's instruction: "the headshots
            // are clean and this is what the agent should be using to
            // understand what the model looks like." We treat it as the
            // ground truth when available.
            const starredPb = await getStarredPhotoboothRefs(user.id, faceModel.id, { maxRefs: 5 })
            if (starredPb.length > 0) {
              faceRefs = starredPb
            } else {
              const primaryFace = await Promise.race([
                getThumbnailFaceRef(supabase, user.id, { faceId: faceModel.id, sourceImages: faceModel.source_images, expression: 'excited', tier }),
                new Promise<null>(res => setTimeout(() => res(null), 120_000)),
              ])
              const rawRefs = await rehostFacePhotos(supabase, faceModel.source_images, primaryFace ? 2 : 5)
              faceRefs = primaryFace ? [primaryFace, ...rawRefs] : rawRefs
            }
          }
          // Product image(s) as references so the product(s) render accurately
          // (the vidIQ look). The prompt scopes the product refs to the
          // product(s) ONLY — the person is taken from the frame + face photos.
          // 3C — When the user supplied custom product photos, all of them go in
          // as refs so Nano Banana Pro can see every angle / both products.
          // Otherwise we fall back to the single auto-resolved Amazon image.
          let productRefs: string[] = []
          if (customProductRefs.length > 0) {
            const rehosted = await Promise.all(customProductRefs.map((u) => rehostToFal(u)))
            productRefs = rehosted.filter((u): u is string => !!u)
          } else if (productImageUrl) {
            const single = await rehostToFal(productImageUrl)
            if (single) productRefs = [single]
          }
          // When we have the creator's photos, lock identity to THOSE alone —
          // mixing in the lower-quality, oddly-lit video frame was letting the
          // model drift to a different-looking person. Fall back to the frame
          // only when no face photos are available.
          const identityRefs = faceRefs.length > 0 ? faceRefs : (frameRef ? [frameRef] : [])
          // ── Style references (2026-06-08, "Gemini-style" thumbnail upgrade) ──
          // 3-5 curated thumbnail examples passed as input images so the model
          // matches the visual language (cinematic blue/orange lighting, bold
          // dual-tone text with thick outlines, reviewer+product composition).
          // Single biggest CTR-quality lever — without these, Nano Banana Pro
          // defaults to its own "sterile product shot" average. Silently no-ops
          // if no refs are uploaded yet at /public/thumbnail-style-refs/.
          // ORDER MATTERS in NB Pro: face → product → style refs. The face
          // anchors identity, the product anchors form, the style refs teach
          // composition + look.
          const appBase = process.env.NEXT_PUBLIC_APP_URL
            || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
            || (request.headers.get('origin'))
          const styleRefs = await rehostStyleRefs(appBase, 4)
          const refs = [...identityRefs, ...productRefs, ...styleRefs]
          // Breadcrumb: if NB still falls through after this, the compose returned
          // nothing despite having references — surfaced via faceDebug below.
          LAST_NB_FALLTHROUGH = `NB entered with refs=${refs.length} (face=${faceRefs.length}, product=${productRefs.length}, style=${styleRefs.length}, frame=${frameRef ? 1 : 0}) — compose returned no image`

          // ── COMPOSED thumbnail (always): recompose into a designed, high-CTR
          //    "creator-review" thumbnail — host large + expressive on one side,
          //    product hero-rendered on the other with rim-light/glow, the
          //    background reimagined to fit the video. Per-variant host side +
          //    title style give the variety the user wants when generating 2–3.
          //
          //    DEFAULT (textMode 'clean'): render the scene TEXT-FREE and draw
          //    the headline with the pixel-perfect canvas overlay — image models
          //    misspell baked text ("USTNG", duplicate words), the overlay never
          //    does. BAKED toggle (textMode 'baked'): bake the title in for a
          //    fully-integrated look, at the risk of a typo.
          const TITLE_STYLES = [
            'a bold heavy CONDENSED ALL-CAPS sans-serif, the FIRST word bright YELLOW and the rest pure WHITE, with a thick solid black outline and a hard drop shadow',
            'a bold heavy CONDENSED ALL-CAPS sans-serif in pure WHITE with a thick black outline and hard drop shadow',
            'a bold heavy CONDENSED ALL-CAPS sans-serif in WHITE with ONE key word in a punchy accent colour (red or cyan), thick black outline and drop shadow',
          ]
          // Identity clause adapts to how many creator references we have. With
          // the user's face-model photos we tell the model to fuse ALL of them
          // for a much stronger likeness lock.
          const nIdentity = identityRefs.length
          const skinFidelity = `Match their skin and APPARENT AGE EXACTLY as in the reference photos: do NOT add wrinkles, fine lines, age spots, blemishes, skin roughness or extra texture, and do NOT make them look older, weathered or harsher — but do NOT de-age or plastic-smooth them either. Their complexion, skin tone and age must look natural, healthy and flattering, faithful to the photos.`
          const identityClause = faceRefs.length > 0
            ? `The ${nIdentity} reference image(s) are real photos of the SAME video creator. Reproduce their EXACT face and identity from these photos — bone structure, features, eye shape, nose, jaw, age, ETHNICITY, skin tone, hair and build. The person MUST be unmistakably THIS exact human — never substitute, invent, or generate a different-looking, different-ethnicity or different-gender person. ${skinFidelity}`
            : `REFERENCE IMAGE 1 is a still from the creator's OWN video — the person in it is the REAL host. Reproduce their EXACT face and identity: same features, age, ETHNICITY, skin tone, gender, hair and build. The person MUST be unmistakably that same individual — under NO circumstances invent, substitute, or generate a different-looking or different-ethnicity person. ${skinFidelity}`
          // Vary the OUTFIT — the reference photos are for the FACE only, not the
          // wardrobe, so thumbnails don't always show the same shirt.
          const outfitNote = `WARDROBE: use the reference photos ONLY for the face and identity — dress the creator in a FRESH, natural, casual everyday outfit (e.g. a plain tee, casual shirt, polo or light sweater) that suits the scene. Do NOT copy the exact clothing, top or colour shown in the reference photos; vary it.`
          // 3C — Multi-product reference clause. With 1 product photo we keep
          // the old single-product wording. With 2-5 we tell the model these
          // are ALL the product(s) to render (same product different angles,
          // OR different products in a comparison thumbnail), and fold in any
          // composition direction the user typed.
          const nProducts = productRefs.length
          const compositionDirective = compositionNote
            ? ` COMPOSITION DIRECTION FROM THE CREATOR (follow this exactly): "${compositionNote}".`
            : ''
          const productRefClause = nProducts === 0
            ? `Render the ACTUAL product item accurately and prominently as a clean hero object — keep its own brand mark, product name, and any label/text physically printed on the product itself so viewers recognise it. Never its retail box or any marketing-infographic packaging, and no added marketing claims, feature text, badges or callouts around it.`
            : nProducts === 1
              ? `The FINAL reference image is the PRODUCT being reviewed — render the ACTUAL PRODUCT ITEM ITSELF, matching its true shape, colour, materials AND its own branding/label/name physically printed on it (keep the brand mark and product name on the bottle/box/device so viewers immediately recognise the product). CRITICAL: if that reference is retail PACKAGING, a box, a poly-bag or a marketing/A+ Content infographic (overlay headlines like "Ultimate ___", checkmark badges, callout circles, comparison panels, feature-highlight pills, arrows pointing at parts), depict the REAL unpackaged product (in use or as a clean hero object) — NOT the box, NOT the infographic — and do NOT reproduce ANY printed MARKETING copy from it (feature lists, claims, percentages, ratings, warranty/award badges, size charts, checkmarks, checkboxes, callout pills). Do NOT copy the reference's composition, layout, framing, or staging — use it ONLY to learn what the product physically looks like. The product's OWN brand/label/name STAYS; all marketing collateral goes. Use that final image ONLY for the product; do NOT take any person, face, hands or body from it.${compositionDirective}`
              : `The FINAL ${nProducts} reference images are PRODUCT photos supplied by the creator — they may be DIFFERENT angles of the same product, OR DIFFERENT products being compared. Render ALL ${nProducts} of them visibly in the thumbnail, each matching its true shape, colour, materials AND its own branding/label/name physically printed on it (keep brand marks and product names on bottles/boxes/devices so viewers immediately recognise the products). CRITICAL: if any reference is retail PACKAGING, a box, a poly-bag or a marketing/A+ Content infographic (overlay headlines, checkmark badges, callout circles, comparison panels, feature-highlight pills), depict the REAL unpackaged product — NOT the box, NOT the infographic — and do NOT reproduce ANY printed MARKETING copy from it (feature lists, claims, percentages, ratings, warranty/award badges, size charts, checkmarks, checkboxes, callout pills). Do NOT copy the references' composition, layout, framing, or staging — use them ONLY to learn what the products physically look like. The products' OWN brand/label/name STAYS; all marketing collateral goes. Use these reference images ONLY for the products; do NOT take any person, face, hands or body from them.${compositionDirective}`
          // Cinematic color-pair pool — Gemini's winning thumbnail used "rich
          // blue and orange" lighting, which is the classic teal/orange cinema
          // grade. We rotate across variants so a 3-thumb batch isn't all the
          // same palette. EACH pair is a {rim, accent} duo — rim light separates
          // the creator from background, accent light glows around the product.
          const COLOR_PAIRS = [
            { rim: 'rich blue', accent: 'warm orange', overall: 'cinematic teal-and-orange' },
            { rim: 'deep magenta', accent: 'electric cyan', overall: 'neon-noir' },
            { rim: 'cool indigo', accent: 'golden amber', overall: 'high-end editorial' },
          ]
          // Energetic facial expressions that DON'T trigger "AI bodybuilder /
          // AI influencer" failure mode. The Gemini winner used "wide-eyed
          // smile, pointing finger" — direct gaze + decisive action.
          const EXPRESSIONS = [
            'wide-eyed and smiling, mouth slightly open in genuine surprise, eyebrows raised',
            'eyes locked on the camera with a delighted grin, head tilted just slightly',
            'a confident half-smile with one eyebrow raised, looking like they just discovered something',
          ]
          // Action verbs — what the creator is DOING with the product. Direct
          // interaction is the highest CTR signal we have. We always pick one;
          // never let the creator stand passively next to the product.
          const ACTIONS = [
            'right index finger pointing directly at the product',
            'one hand gesturing toward the product as if presenting it',
            'holding the product up just below their chin, looking at the camera',
          ]
          // Style-ref aware clause: when we have curated reference thumbnails,
          // explicitly tell the model to mimic their visual gestalt. This is
          // what made the Gemini-handoff output land — the model treats the
          // refs as the style anchor, not the prompt.
          const styleRefClause = styleRefs.length > 0
            ? `STYLE REFERENCE: the LAST ${styleRefs.length} reference image${styleRefs.length === 1 ? '' : 's'} ${styleRefs.length === 1 ? 'is an EXAMPLE' : 'are EXAMPLES'} of the exact YouTube thumbnail style we want — match ${styleRefs.length === 1 ? 'its' : 'their'} composition (creator on one side + product hero on the other), lighting punch (rich rim-light + warm accent glow), text styling (bold blocky all-caps with thick outlines + a single contrasting accent colour), and overall visual energy. Use them ONLY for style; do NOT copy the people, products, or text content from these refs — only the LOOK.`
            : ''
          const buildComposed = (i: number, withText: boolean): string => {
            const hostSide = i % 2 === 0 ? 'LEFT' : 'RIGHT'
            const productSide = hostSide === 'LEFT' ? 'RIGHT' : 'LEFT'
            const palette = COLOR_PAIRS[i % COLOR_PAIRS.length]
            const expression = EXPRESSIONS[i % EXPRESSIONS.length]
            const action = ACTIONS[i % ACTIONS.length]
            const headlineClause = withText
              ? `HEADLINE: bake the text EXACTLY "${hooks[i % hooks.length]}" as ${TITLE_STYLES[i % TITLE_STYLES.length]}. Place it in the open area clearly away from the face and the product. Spell it EXACTLY ONCE, letter-for-letter, with NO repeated or duplicated words. Add a prominent ${palette.accent.includes('orange') ? 'yellow' : 'white'} arrow with a thick black outline pointing from the headline to the product so the eye is guided from text → product.`
              : `HEADLINE SPACE: leave a generous CLEAN, uncluttered area across the TOP (especially the ${productSide === 'LEFT' ? 'upper-left' : 'upper-right'}) for a headline to be added afterwards. Render ABSOLUTELY NO text, letters, words, numbers or captions anywhere in the image.`
            // 3C — Composition swaps between single-product (host one side,
            // product the other) and multi-product (host smaller, products
            // arranged on the opposite side per the composition note when
            // given, or a sensible default arrangement when not).
            const compositionLine = nProducts >= 2
              ? `COMPOSITION: Put the creator on the ${hostSide} side, framed chest-up, ${expression}, ${action.replace('the product', 'the products')}. Render ALL ${nProducts} products visibly and large on the ${productSide} side of the frame, crisp and photorealistic, lifted off the background with a ${palette.accent} accent glow and premium rim-lighting so they pop. ${compositionNote ? `Arrange them per the creator's direction above ("${compositionNote}").` : 'Arrange them in a clean, balanced layout (side-by-side, stacked, or a small grid) so each product is clearly recognisable at thumbnail size.'} Every product must be unobscured and identifiable.`
              : `COMPOSITION: Put the creator LARGE on the ${hostSide} side, framed chest-up, ${expression}, with ${action}. Render the PRODUCT large and hero on the ${productSide} side, crisp and photorealistic, lifted off the background with a ${palette.accent} accent glow (warm light wrapping the product) and premium rim-lighting so it pops.`
            return `Create a vibrant, high-CTR YouTube thumbnail (16:9) in the polished style of top product-review channels — a DESIGNED composite, not a touched-up screengrab.
${identityClause}
${outfitNote}
${productRefClause}
${styleRefClause}
${compositionLine}
BACKGROUND: a ${palette.overall} cinematic scene that fits the video "${videoTitle}" — a dramatic blend of ${palette.rim} rim-light behind the creator and ${palette.accent} glow around the product, deep contrast, soft vignette around the edges. Do NOT make it a flat, bright, white or airy room. The rim light must visibly separate the creator from the background so the cut-out edge blends cleanly with NO visible halo or outline. Soft background bokeh and depth; vivid and eye-catching at small sizes.
${headlineClause}
${NO_BRAND_IMAGE_CLAUSE}
Ultra-sharp, professional, photorealistic.`
          }

          // wantClean (default) = overlay the title via canvas (perfect text);
          // !wantClean = bake the title into the image (integrated, may typo).
          const promptFor = (i: number): string => buildComposed(i, !wantClean)
          // Representative prompt for telemetry / the response payload.
          const nbPrompt = promptFor(0)

          // Composed scene always runs on Nano Banana PRO (best identity +
          // composition). Title is overlaid (default) or baked (toggle).
          let nbModelKey = NANO_BANANA_PRO_COST_MODEL
          let nbModelUsed = wantClean ? 'nano-banana-pro' : 'nano-banana-pro-baked'

          // Fire `variantCount` parallel single-image composes — each with its
          // own prompt (rotating host side + title style) so variants differ.
          const nbBatches = await Promise.all(
            Array.from({ length: variantCount }, (_, i) =>
              composeWithNanoBananaPro({ prompt: promptFor(i), referenceImageUrls: refs, aspectRatio: '16:9', numImages: 1 }),
            ),
          )
          let nbUrls = nbBatches.flat().filter(Boolean).slice(0, variantCount)

          // Fallback: if Pro returned nothing, retry on regular Nano Banana so we
          // still produce a thumbnail rather than failing.
          if (nbUrls.length === 0) {
            const fb = await Promise.all(
              Array.from({ length: variantCount }, (_, i) =>
                composeWithNanoBanana({ prompt: promptFor(i), referenceImageUrls: refs, aspectRatio: '16:9', numImages: 1 }),
              ),
            )
            nbUrls = fb.flat().filter(Boolean).slice(0, variantCount)
            if (nbUrls.length > 0) { nbModelKey = NANO_BANANA_COST_MODEL; nbModelUsed = wantClean ? 'nano-banana' : 'nano-banana-baked' }
          }

          // Force-moody grade: deterministically darken + add contrast + vignette
          // to every composed thumbnail so the background is moody/contrasty every
          // time and any faint cut-out halo is hidden — then rank/overlay the
          // graded versions. Best-effort per image (falls back to the original).
          if (nbUrls.length > 0) {
            nbUrls = await Promise.all(nbUrls.map(applyMoodyGrade))
          }

          if (nbUrls.length > 0) {
            for (let i = 0; i < nbUrls.length; i++) {
              recordUsage({
                userId: TELEMETRY.userId, tier: TELEMETRY.tier,
                feature: 'yt_thumb_nanobanana_image', model: nbModelKey, images: 1,
              })
            }
            const rank = await rankVariants(nbUrls, overlayHookNB, { userId: TELEMETRY.userId, tier: TELEMETRY.tier })
            // Per-variant headline placement (overlay path): we composed the
            // host on a KNOWN side per variant (even=LEFT, odd=RIGHT), so the
            // title goes in the opposite TOP corner — deterministic, no vision
            // call needed, and correct per variant (the host side rotates).
            const posForIndex = (i: number): TextPosition => (i % 2 === 0 ? 'top-right' : 'top-left')
            const textPositions = rank.urls.map(u => posForIndex(Math.max(0, nbUrls.indexOf(u))))
            const textPosition: TextPosition | null = wantClean ? (textPositions[0] ?? null) : null

            // ── DESIGNER TEXT OVERLAY ────────────────────────────────────
            // For the clean (overlay) path, server-side bake the designer
            // typography onto each ranked variant using a random template
            // from the 10-template library. Each variant gets a DIFFERENT
            // template so the user sees real visual variety. Falls back to
            // the bare clean image on any per-variant render error — the
            // client knows to handle `baked: true` either way.
            //
            // Only run on the `wantClean` path. When the caller chose
            // baked-text mode (textMode='baked'), the headline is already
            // in the image and adding another typography layer would
            // double-print the text.
            let designerTemplateIds: Array<string | null> = []
            let finalUrls: string[] = rank.urls
            let designerApplied = false
            if (wantClean) {
              designerApplied = true
              const designerResults = await Promise.all(rank.urls.map(async (cleanUrl, i) => {
                try {
                  // Find which original index this ranked URL came from so
                  // we use the matching per-variant headline.
                  const origIdx = Math.max(0, nbUrls.indexOf(cleanUrl))
                  const variantHook = hooks[origIdx] ?? overlayHookNB

                  // VISION-DETECT the safe text zone instead of assuming the
                  // host is always on the variant-index-parity side. Nano
                  // Banana can put face + product on the same side, in
                  // which case the hardcoded subjectSide buries the text
                  // ON TOP OF the product. analyzeTextZone returns where
                  // the main subject actually lives in THIS specific image
                  // — so the designer overlay text always lands in the
                  // free corner.
                  const zone = await analyzeTextZone(cleanUrl, { ctx: { userId: TELEMETRY.userId, tier: TELEMETRY.tier } })
                  // Map the vision result onto the designer's left/right side.
                  // "center" means subject fills both halves — pick the side
                  // with less weight (analyzeTextZone's position hints at it).
                  const subjectSide: 'left' | 'right' = zone?.subjectSide === 'left'
                    ? 'left'
                    : zone?.subjectSide === 'right'
                      ? 'right'
                      : (zone?.position.includes('left') ? 'right' : 'left')
                  // Vertical anchor — derived from the safe text-zone position.
                  // If vision says top-* is safe → anchor text to top. If
                  // bottom-* → anchor bottom. Default to 'top' because face +
                  // product on YouTube thumbnails usually occupy centre/lower
                  // and top anchoring keeps the half-canvas text column out
                  // of the dominant subject.
                  const verticalAnchor: 'top' | 'bottom' = zone?.position?.startsWith('bottom') ? 'bottom' : 'top'

                  const result = await renderDesignerOverlay({
                    baseImageUrl: cleanUrl,
                    headline: variantHook,
                    productContext: productTitle || null,
                    subjectSide,
                    verticalAnchor,
                    randomize: true,
                    userId: String(TELEMETRY.userId ?? ''),
                    tier: TELEMETRY.tier,
                  })
                  // Re-host the composited PNG to fal so the client gets a
                  // URL (not a 5MB data URI). rehostToFal accepts data URIs.
                  const dataUri = `data:image/png;base64,${result.png.toString('base64')}`
                  const hosted = await rehostToFal(dataUri)
                  if (!hosted) throw new Error('rehostToFal returned null')
                  recordUsage({
                    userId: TELEMETRY.userId, tier: TELEMETRY.tier,
                    feature: 'yt_thumb_designer_overlay',
                    model: `designer-text:${result.picked.templateId}`,
                    images: 1,
                  })
                  return { url: hosted, templateId: result.picked.templateId }
                } catch (e) {
                  console.warn('[designer-overlay] variant fell back to clean image', i, e instanceof Error ? e.message : String(e))
                  return { url: cleanUrl, templateId: null }
                }
              }))
              finalUrls = designerResults.map(r => r.url)
              designerTemplateIds = designerResults.map(r => r.templateId)
            }
            return NextResponse.json({
              ok: true,
              // Designer overlay (if applied) replaces the rank URLs with
              // server-baked composited versions. Otherwise serve the raw
              // ranked images for the legacy client-side canvas overlay.
              thumbnailUrl: finalUrls[0],
              thumbnailUrls: finalUrls,
              thumbnailScores: rank.scores,
              thumbnailScore: rank.topScore,
              belowThreshold: rank.belowThreshold,
              overlayHook: overlayHookNB,
              // The 5 title options for the client-side picker. On the clean
              // (overlay) path the user clicks one and it's re-drawn on the
              // text-free image instantly. Omitted/ignored on the baked path.
              // (Also omitted when designer overlay baked the text server-side.)
              titleOptions: wantClean && !designerApplied ? titleOptions : undefined,
              // Per-variant titles + placements, aligned to rank.urls order so
              // the client overlays the matching headline + corner on each
              // variant (the host side — and so the clear corner — rotates).
              overlayHooks: rank.urls.map(u => hooks[Math.max(0, nbUrls.indexOf(u))] ?? overlayHookNB),
              textPositions: wantClean && !designerApplied ? textPositions : undefined,
              // Diagnostic: which designer template each variant used. Null
              // entries = render fell back to the clean image for that slot.
              designerTemplateIds: designerApplied ? designerTemplateIds : undefined,
              headlineLocked: !!lockedHeadline,
              prompt: nbPrompt,
              styleBriefApplied: false,
              channelStyle: null,
              modelUsed: nbModelUsed,
              // baked:true → headline is already IN the image; the client must
              // NOT draw a text overlay. The designer-overlay path is also
              // server-baked typography, so it gets baked:true too.
              baked: !wantClean || designerApplied,
              textPosition: designerApplied ? null : textPosition,
              faceBox: null,
              composited: true,
              headshotUsed: false,
              personCutoutUrl: null,
              // Which face model the likeness was locked to (Auto-match result),
              // surfaced so the user can confirm it picked the right person.
              faceUsed: faceModel?.name ?? null,
              faceDebug: `nano-banana composed (source=${hasCapturedFrame ? `extension-frame[${validFrames.length || 1}]` : frameRef ? 'maxres' : 'face+product (no frame)'}, face=${faceModel?.name ?? 'none'}, faceRefs=${faceRefs.length}, productRefs=${productRefs.length}${customProductRefs.length > 0 ? ' [user-supplied]' : ''}, title=${wantClean ? 'overlay' : 'baked'})`,
            })
          }
          console.warn('[generate-thumbnail] Nano Banana (frame) returned no image; falling through')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        LAST_NB_FALLTHROUGH = `NB threw: ${msg}`.slice(0, 240)
        console.warn('[generate-thumbnail] Nano Banana frame path failed, falling through:', msg)
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
        const kontextInstruction = `Transform this user-submitted photo into a clean, professional, eye-catching YouTube thumbnail. KEEP the same person and the same product they are holding/showing — preserve their facial identity, likeness and the product's exact appearance, branding and details. Clean it up: remove clutter and distractions, fix harsh or dim lighting into bright flattering light, sharpen and colour-grade for a premium, high-contrast thumbnail look, and place them in a bright, clean, uncluttered setting with a softly blurred background. Keep the person clearly visible and well-lit. ${cleanup ? `ADDITIONAL DIRECTION: ${cleanup}. ` : ''}Do NOT add any other people. ${NO_BRAND_IMAGE_CLAUSE} Photorealistic, 16:9.`

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
          // Force-moody grade before ranking — every path gets a moody/contrasty
          // background, not just the primary NB path (see applyMoodyGrade).
          const moodyUploadUrls = await Promise.all(urls.map(applyMoodyGrade))
          const rank = await rankVariants(moodyUploadUrls, overlayHookU, { userId: TELEMETRY.userId, tier: TELEMETRY.tier })
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
      const cutoutDebug = !faceModelId
        ? 'no-faceModelId-sent (face not selected in the modal)'
        : !faceModel
          ? 'faceModelId sent but model not found / has no source photos'
          : !url
            ? `cut-out GENERATION FAILED: ${LAST_CUTOUT_ERROR || '(no error captured)'}`
            : 'ok'
      // We're in a fallback path, so the primary designed (NB) path didn't return
      // an image — prepend WHY so it's visible in the UI without server logs.
      const debug = LAST_NB_FALLTHROUGH ? `${LAST_NB_FALLTHROUGH} | cutout: ${cutoutDebug}` : cutoutDebug
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
        const kontextInstruction = `Keep ONLY the exact product object from this image — its shape, colour, material, branding, and all details. IMPORTANT: if the original image contains ANY person, model, hands, arms or body parts, REMOVE them completely — keep only the product itself, nothing human. Remove the white background and any accessories or packaging. Place the product in the following scene: ${finalScenePrompt}. The product should sit naturally in the scene with realistic shadows and lighting. The scene MUST be BRIGHT and well-lit with light, airy tones and clear background detail — NEVER dark, black, dim or moody. COMPOSITION (important): position the product on the LEFT / CENTRE-LEFT of the frame and keep the RIGHT THIRD of the image open — empty background / negative space — because a person will be composited into the bottom-right corner afterwards, so the product must NOT extend into the right third or it will be covered. CRITICAL: there must be ABSOLUTELY NO people anywhere — no humans, no faces, no heads, no bodies, no hands, no silhouettes or reflections of people in the scene or its background. The scene is completely empty of any person. No white background. ${NO_BRAND_IMAGE_CLAUSE}`

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
          // Force-moody grade the scene before ranking — defence-in-depth so the
          // fallback paths get a moody/contrasty background too (see applyMoodyGrade).
          const moodyKontextUrls = await Promise.all(kontextUrls.map(applyMoodyGrade))
          const rank = await rankVariants(moodyKontextUrls, overlayHook, { userId: TELEMETRY.userId, tier: TELEMETRY.tier })
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
        // Force-moody grade the scene before ranking (see applyMoodyGrade).
        const moodyIdeoUrls = await Promise.all(ideoUrls.map(applyMoodyGrade))
        const rank = await rankVariants(moodyIdeoUrls, overlayHook, { userId: TELEMETRY.userId, tier: TELEMETRY.tier })
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
    // Force-moody grade the scene before ranking (see applyMoodyGrade).
    const moodyFluxUrls = await Promise.all(thumbnailUrls.map(applyMoodyGrade))
    const rank = await rankVariants(moodyFluxUrls, overlayHook, { userId: TELEMETRY.userId, tier: TELEMETRY.tier })
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
