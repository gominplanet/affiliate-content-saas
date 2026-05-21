import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { fetchAmazonProduct } from '@/services/amazon'
import { fal } from '@fal-ai/client'
import { getValidYouTubeToken, createYouTubeOAuthService } from '@/services/youtube'
import { recordAnthropicUsage, recordUsage } from '@/lib/ai-usage'
import { TIERS, nextTierFor, type Tier } from '@/lib/tier'
import { checkUsageCap, PRIMARY_FEATURE } from '@/lib/usage-cap'

// Telemetry context — populated at request start, read by the three
// Anthropic helpers below so each call is tagged with the right user/tier.
let TELEMETRY: { userId: string | null; tier: string | null } = { userId: null, tier: null }

export const maxDuration = 120

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
const STYLE_SCENES: Record<string, string> = {
  review:     'Product IN USE on a real surface in a home or workspace — books, tools, or related objects in the background create context. Natural room light, lived-in environment, not a studio.',
  unboxing:   'Product next to or emerging from its open box on a wooden table, tissue paper scattered, warm indoor light as if someone just received a delivery.',
  comparison: 'Product placed prominently on one side of frame, strong dramatic side-lighting, background hints at a decision or test scenario (whiteboard, notes, competitor products blurred).',
  lifestyle:  'Product actively in use in its natural environment — outdoors, in the kitchen, at the gym, on a trail. Show the product doing its job. Golden-hour or natural ambient light. People or hands interacting are acceptable if they add story but NO faces.',
  hero:       'Product in a dramatic cinematic environment — weather, movement, epic scale. Dark dramatic background, strong rim lighting, product looks like the hero of an action movie.',
}

async function generateProductPrompt(opts: {
  videoTitle: string
  productTitle: string
  productDescription: string
  productBullets: string[]
  style: string
  channelStyle?: string | null
}): Promise<string> {
  const sceneDirection = STYLE_SCENES[opts.style] ?? STYLE_SCENES.review
  const anthropic = createAnthropicClient()
  const msg = await withAnthropicRetry(() => anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `You are a YouTube thumbnail art director. Write a Flux image generation prompt for a product shot with an active, story-driven scene. NO faces. The product must look exactly as described — use every visual detail from the product data below.

PRODUCT DATA:
TITLE: "${opts.videoTitle}"
PRODUCT NAME: ${opts.productTitle || 'Unknown product'}
${opts.productDescription ? `DESCRIPTION: ${opts.productDescription}` : ''}
${opts.productBullets.length ? `FEATURES: ${opts.productBullets.slice(0, 4).join(' · ')}` : ''}

SCENE STYLE: ${sceneDirection}
${opts.channelStyle ? `CHANNEL AESTHETIC (match this): ${opts.channelStyle}` : ''}

YOUR TASK:
1. PRODUCT APPEARANCE — extract exact visual details from the data above: colour, shape, size, material, any text/branding on it. Describe it precisely so the AI renders the RIGHT product.
2. SCENE — pick one specific, active real-world setting that tells a story for this product. Not a studio. Not a white background. A real place with depth, context, and atmosphere.
3. COMPOSITION — product CENTRE-RIGHT, large and sharp. LEFT third is empty negative space for text overlay. Background blurred but recognisable.
4. LIGHTING — dramatic and cinematic. Makes the product look desirable.
5. End with: "16:9, photorealistic, 8K, shallow depth of field, no faces, no text overlays"
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

// ── Claude Haiku: punchy hook text ────────────────────────────────────────────
async function generateHook(videoTitle: string): Promise<string> {
  const anthropic = createAnthropicClient()
  const msg = await withAnthropicRetry(() => anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 30,
    messages: [{
      role: 'user',
      content: `Write a 2-3 word ALL-CAPS YouTube thumbnail hook.
- 2-3 words MAX, complete phrase, no preposition at end
- No hype words: AMAZING, INCREDIBLE, INSANE. NEVER use HONEST.
- End with ? or !
Examples: "WORTH IT?", "DON'T BUY!", "ACTUALLY WORKS?", "BIG MISTAKE?", "MUST HAVE?"
Return ONLY the hook text. Video: "${videoTitle}"`,
    }],
  }))
  recordAnthropicUsage(msg, {
    userId: TELEMETRY.userId, tier: TELEMETRY.tier,
    feature: 'yt_thumb_hook', model: 'claude-haiku-4-5-20251001',
  })
  return (msg.content[0] as { type: string; text: string }).text.trim().toUpperCase()
}

// ── Claude: PERSON-IN-SCENE prompt (used when a face LoRA is active) ────────
// The default generateProductPrompt is hardcoded "NO faces" + "no people"
// because it's optimized for product-only thumbnails. When a face LoRA is
// loaded we need the opposite: an active scene with the person prominently
// reacting to the product. The trigger token (e.g. "michelle6634") gets
// embedded directly so Flux + LoRA knows which subject to render.
async function generatePersonScenePrompt(opts: {
  triggerToken: string
  faceName: string
  videoTitle: string
  productTitle: string
  productDescription: string
  productBullets: string[]
  channelStyle?: string | null
}): Promise<string> {
  const anthropic = createAnthropicClient()
  const msg = await withAnthropicRetry(() => anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `You are a YouTube thumbnail art director. Write a Flux image generation prompt for a creator-style thumbnail that puts a PERSON in an active scene with a product.

CREATOR'S FACE TRIGGER TOKEN: ${opts.triggerToken}
  — Use this exact token as the SUBJECT of the prompt (e.g. "${opts.triggerToken} holding the product, surprised expression"). The token is a LoRA-trained identity reference; Flux + the loaded LoRA will render the real person when it sees this token.

VIDEO: "${opts.videoTitle}"
PRODUCT: ${opts.productTitle || 'product from the video'}
${opts.productDescription ? `DESCRIPTION: ${opts.productDescription}` : ''}
${opts.productBullets.length ? `FEATURES: ${opts.productBullets.slice(0, 4).join(' · ')}` : ''}
${opts.channelStyle ? `CHANNEL AESTHETIC (match this): ${opts.channelStyle}` : ''}

PROMPT RULES (this is a YouTube THUMBNAIL — must look engaging but NATURAL, not cartoony):

CALIBRATION NOTE: We've tuned away from "mouth-wide-open, eyes-bulging" expressions because they read as cartoonish and AI-generated. Aim for the energy of a great photojournalism portrait — present, alive, intriguing — NOT a meme-face reaction.

1. START with "${opts.triggerToken}" — the LoRA's trigger token must appear at the very start so the loaded weights activate. Then describe what they're doing.
2. PERSON FRAMING: ${opts.triggerToken} fills the frame — face takes ~30-40% of the image, MID-SHOT. Not a wide shot, not a tight close-up.
3. EXPRESSION: DEFAULT to a WARM GENUINE SMILE — friendly, inviting, slightly raised eyebrows like someone sharing a good find. People click on creators who look happy + trustworthy. ONLY use a different expression if the video's tone clearly demands it:
   - Sceptical / unimpressed look → ONLY if video title says "scam", "warning", "don't buy", "ripoff", "review fail"
   - Soft surprised (mouth slightly parted, eyes alert) → ONLY if video title says "shocked", "I didn't expect", "you won't believe"
   - Interested / examining look → ONLY if video is testing/measuring something analytical
   When uncertain, USE THE SMILE. Smile is the safe high-CTR default.
   AVOID: mouth wide open, bulging eyes, screaming face, forced grimace, exaggerated shock. Those read as cartoonish.
4. EYE CONTACT: looking AT camera or AT the product. Confident, not posed.
5. PRODUCT: held naturally near the face or shoulder, clearly visible.
6. SCENE: real-world setting, slightly blurred background — bokeh that supports the subject, doesn't replace them. Setting should feel lived-in.
7. COMPOSITION: person CENTRE or CENTRE-LEFT, product close to them. Leave clean space TOP-LEFT or BOTTOM-LEFT for a giant text overlay.
8. LIGHTING: natural editorial — soft key light + slight rim light, gentle contrast. Skin looks real, NOT plastic or over-lit.
9. End with: "16:9, photorealistic, 8K, sharp focus on face, editorial portrait lighting, shallow depth of field, natural skin tones, no text overlays"
10. Under 110 words total.

Return ONLY the prompt — no preamble.`,
    }],
  }))
  recordAnthropicUsage(msg, {
    userId: TELEMETRY.userId, tier: TELEMETRY.tier,
    feature: 'yt_thumb_person_prompt', model: 'claude-sonnet-4-6',
  })
  return (msg.content[0] as { type: string; text: string }).text.trim()
}

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
    const tier = (tierRow?.tier as Tier) ?? 'trial'
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
    } = await request.json() as {
      quickMode?: boolean
      videoTitle: string
      asin?: string
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
    let faceModel: { trigger_token: string; lora_url: string; name: string } | null = null
    if (faceModelId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: fm } = await (supabase as any)
        .from('face_models')
        .select('trigger_token,lora_url,status,name')
        .eq('id', faceModelId)
        .eq('user_id', user.id)
        .single()
      if (fm?.status === 'ready' && fm?.lora_url) {
        faceModel = { trigger_token: fm.trigger_token, lora_url: fm.lora_url, name: fm.name }
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

    // ── Fetch channel thumbnails + analyse style (best-effort) ───────────────
    fal.config({ credentials: falKey })

    const channelThumbnailUrls = await fetchChannelThumbnails(supabase, user.id)
    const channelStyle = await analyzeChannelStyle(channelThumbnailUrls)
    console.log('[generate-thumbnail] Channel style:', channelStyle ?? 'none')

    // ── Generate scene prompt + hook + (optional) style brief in parallel ───
    // When a face LoRA is selected we use the person-aware prompt generator
    // (puts the creator IN the scene with the product); otherwise the
    // standard product-only generator (no faces / no people by design).
    const [productPrompt, generatedHook, styleBrief] = await Promise.all([
      faceModel
        ? generatePersonScenePrompt({
            triggerToken: faceModel.trigger_token,
            faceName: faceModel.name,
            videoTitle,
            productTitle,
            productDescription,
            productBullets,
            channelStyle,
          })
        : generateProductPrompt({ videoTitle, productTitle, productDescription, productBullets, style, channelStyle }),
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
    // Start from the actual Amazon product photo and transform the scene around it.
    // This guarantees the product looks exactly right without relying on text descriptions.
    //
    // Skipped when a face model is selected — Kontext is a closed Flux Pro
    // variant that doesn't accept LoRA weights, so we route through the
    // LoRA-capable open-source flux-lora endpoint below instead.
    if (productImageUrl && !faceModel) {
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
            headshotUsed: false,
          })
        }
      } catch (err) {
        console.warn('[generate-thumbnail] Kontext path failed, falling back to Flux Pro:', err)
      }
    }

    // ── PATH B: Face-LoRA — user picked a trained face ────────────────────────
    // flux-lora is the open-source flux-dev base with LoRA loading. Slightly
    // less polished than flux-pro/v1.1 on raw aesthetics but the only path
    // that respects a custom LoRA. The trigger token gets prepended to the
    // prompt so the model knows which subject the LoRA encodes.
    if (faceModel) {
      console.log('[generate-thumbnail] Using flux-lora with face model:', faceModel.trigger_token)
      // The person-aware prompt already starts with the trigger token —
      // no need to prepend. finalScenePrompt also already includes the
      // style brief at the top if one was uploaded.
      const facePrompt = finalScenePrompt
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loraResult = await fal.subscribe('fal-ai/flux-lora' as any, {
        input: {
          prompt: facePrompt,
          // CALIBRATION: 1.0 keeps identity strong without over-fitting.
          // 1.1 produced cartoonish, over-rendered faces. If a user
          // reports their face doesn't look like them, the move is to
          // re-train with more varied source photos rather than crank
          // the scale.
          loras: [{ path: faceModel.lora_url, scale: 1.0 }],
          image_size: 'landscape_16_9',
          num_inference_steps: 28,
          guidance_scale: 3.5,
          num_images: variantCount,
          output_format: 'jpeg',
        },
        pollInterval: 3000,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loraImages = (loraResult.data as any)?.images as Array<{ url: string }> | undefined
      const loraUrls = (loraImages ?? []).map(i => i.url).filter(Boolean)
      if (loraUrls.length === 0) throw new Error('Face-LoRA path returned no image. Please try again.')
      for (let i = 0; i < loraUrls.length; i++) {
        recordUsage({
          userId: TELEMETRY.userId, tier: TELEMETRY.tier,
          feature: 'yt_thumb_flux_lora_image', model: 'fal-flux-lora', images: 1,
        })
      }
      return NextResponse.json({
        ok: true,
        thumbnailUrl: loraUrls[0],
        thumbnailUrls: loraUrls,
        overlayHook,
        headlineLocked: !!lockedHeadline,
        prompt: facePrompt,
        styleBriefApplied: !!styleBrief,
        channelStyle: channelStyle ?? null,
        modelUsed: `flux-lora-${style}`,
        faceModelUsed: faceModel.trigger_token,
        headshotUsed: true,
      })
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
      headshotUsed: false,
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
