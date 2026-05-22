import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { fetchAmazonProduct } from '@/services/amazon'
import { firstProductUrl, resolveFinalUrl } from '@/lib/product-link'
import { fetchProductImageFromPage } from '@/services/research'
import { createOpenAIService } from '@/services/openai'
import { fal } from '@fal-ai/client'
import { getValidYouTubeToken, createYouTubeOAuthService } from '@/services/youtube'
import { recordAnthropicUsage, recordUsage } from '@/lib/ai-usage'
import { TIERS, nextTierFor, normalizeTier, type Tier } from '@/lib/tier'
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
    let faceModel: { trigger_token: string; lora_url: string | null; name: string; source_images: string[] } | null = null
    if (faceModelId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: fm } = await (supabase as any)
        .from('face_models')
        .select('trigger_token,lora_url,status,name,source_images')
        .eq('id', faceModelId)
        .eq('user_id', user.id)
        .single()
      // gpt-image-1 needs the source headshots (no LoRA); the legacy flux-lora
      // fallback needs lora_url. Accept the model if EITHER is available.
      const srcImages: string[] = Array.isArray(fm?.source_images) ? fm.source_images : []
      if (fm && (fm.lora_url || srcImages.length > 0)) {
        faceModel = { trigger_token: fm.trigger_token, lora_url: fm.lora_url ?? null, name: fm.name, source_images: srcImages }
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

    // ── PATH G: gpt-image-1 reference-based (PREFERRED face path) ─────────────
    // Uses the creator's uploaded headshots as identity references (NO LoRA)
    // plus the real product photo, so both the person AND the product come out
    // right — the thing the flux-lora + Kontext two-stage couldn't nail. Falls
    // through to the legacy flux-lora path on any failure.
    if (faceModel && faceModel.source_images.length > 0) {
      try {
        const refImages: Array<{ data: Uint8Array; filename: string; mime: string }> = []
        for (const path of faceModel.source_images.slice(0, 4)) {
          const { data: file } = await supabase.storage.from('headshots').download(path)
          if (file) {
            const buf = new Uint8Array(await file.arrayBuffer())
            const ext = (path.split('.').pop() || 'jpg').toLowerCase()
            refImages.push({ data: buf, filename: `face_${refImages.length}.${ext}`, mime: ext === 'png' ? 'image/png' : 'image/jpeg' })
          }
        }
        // Real product photo as the LAST reference, when we have one.
        let hasProductRef = false
        if (productImageUrl) {
          try {
            const pr = await fetch(productImageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
            if (pr.ok) {
              refImages.push({ data: new Uint8Array(await pr.arrayBuffer()), filename: 'product.jpg', mime: 'image/jpeg' })
              hasProductRef = true
            }
          } catch { /* product ref optional */ }
        }
        if (refImages.length === 0) throw new Error('No reference images downloaded')

        const sceneDir = STYLE_SCENES[style] ?? STYLE_SCENES.review
        const faceRefCount = refImages.length - (hasProductRef ? 1 : 0)
        const gptPrompt = `Professional YouTube thumbnail, 16:9, photorealistic, high click-through-rate.

REFERENCE IMAGES — read carefully:
- The FIRST ${faceRefCount} reference image${faceRefCount !== 1 ? 's are' : ' is'} the PERSON. They are all the SAME ONE individual. Use them ONLY to capture that person's facial identity, hair, and likeness.
${hasProductRef ? '- The LAST reference image is the PRODUCT OBJECT only. Use it ONLY for the product\'s shape/colour/label/branding. If it contains any human, face, hand, or model, IGNORE that person completely — they are NOT the subject.' : ''}
IDENTITY (critical): render EXACTLY ONE person — the individual from the PERSON reference photos. Do NOT blend, merge, average, or mix in any other face (including anyone appearing in the product image). The face must clearly be that single person, not a hybrid.

SUBJECT: that person — preserve their exact facial identity, hair, and likeness. Relaxed, natural friendly smile (not a forced wide open-mouth grin), looking toward camera.
VIDEO TITLE: "${videoTitle}"
PRODUCT: ${hasProductRef
          ? 'the product object from the LAST reference image — reproduce it accurately (shape, colour, label text, branding).'
          : `${productTitle || 'the product from the video'}.`}
SCENE: ${sceneDir}${channelStyle ? ` Channel aesthetic: ${channelStyle}.` : ''}${styleBrief ? ` Visual style: ${styleBrief}.` : ''}
LAYOUT — follow this placement EXACTLY (this is the most important instruction):
• The PERSON is on the RIGHT HALF of the frame. Their face and body sit clearly to the RIGHT of center. DO NOT place the person in the middle. Chest-up.
• The PRODUCT is on the LEFT, in the LOWER-LEFT area — the person extends it toward the left with one hand (arm reaching across to their left), or it rests on a surface lower-left. The product must be clearly LEFT of center and BELOW the title.
• The person and the product are SEPARATED horizontally: person on the right, product on the left. They are NOT clustered together in the center.
• The TOP-LEFT region stays clean, simple, slightly darker EMPTY background — no person, no product, nothing important there (a title overlay goes on top of it).
Nothing important touches the frame edges.
LIGHTING: editorial studio lighting — soft key + subtle rim light, realistic skin texture, shallow depth of field.
Do NOT render any text, captions, watermarks, or logos in the image.`

        const imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1'
        const openai = createOpenAIService()
        const b64 = await openai.generateWithReferences({
          prompt: gptPrompt,
          images: refImages,
          size: '1536x1024',
          quality: 'high',
          model: imageModel,
        })
        const gptBlob = new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' })
        const gptUrl = await fal.storage.upload(gptBlob)
        // Telemetry: cap-counted under the stable 'yt_thumb_gptimage' feature;
        // model column records the actual model (gpt-image-1 or gpt-image-2).
        recordUsage({
          userId: TELEMETRY.userId, tier: TELEMETRY.tier,
          feature: 'yt_thumb_gptimage', model: imageModel, images: 1,
        })
        console.log('[generate-thumbnail]', imageModel, 'result:', gptUrl, `(refs: ${refImages.length}, product: ${hasProductRef})`)
        return NextResponse.json({
          ok: true,
          thumbnailUrl: gptUrl,
          thumbnailUrls: [gptUrl],
          overlayHook,
          headlineLocked: !!lockedHeadline,
          prompt: gptPrompt,
          styleBriefApplied: !!styleBrief,
          channelStyle: channelStyle ?? null,
          modelUsed: `${imageModel}-${style}`,
          faceModelUsed: faceModel.name,
          headshotUsed: true,
        })
      } catch (err) {
        console.warn('[generate-thumbnail] gpt-image-1 path failed, falling back to flux-lora:', err)
      }
    }

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
