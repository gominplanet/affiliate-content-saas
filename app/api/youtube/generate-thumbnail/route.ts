import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { fetchAmazonProduct } from '@/services/amazon'
import { fal } from '@fal-ai/client'
import { getValidYouTubeToken, createYouTubeOAuthService } from '@/services/youtube'
import { recordAnthropicUsage, recordUsage } from '@/lib/ai-usage'
import { TIERS, type Tier } from '@/lib/tier'
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
    const tier = (tierRow?.tier as Tier) ?? 'free'
    TELEMETRY = { userId: user.id, tier }

    // Cap gate — thumbnail generations / billing period. Pre-flight the
    // check so we never charge Fal credits + waste 3 Anthropic calls on
    // a user who's already at cap.
    const thumbCap = TIERS[tier].thumbnailsPerMonth
    const capCheck = await checkUsageCap(
      supabase, user.id, PRIMARY_FEATURE.thumbnail, thumbCap,
      (tierRow?.subscription_period_start as string | null) ?? null,
      (tierRow?.subscription_period_end as string | null) ?? null,
    )
    if (capCheck?.exceeded) {
      return NextResponse.json({
        error: `You've hit your ${thumbCap} thumbnail generations for this billing period on the ${TIERS[tier].label} plan. Resets ${capCheck.resetLabel}.`,
        limitReached: true,
      }, { status: 429 })
    }

    const falKey = process.env.FAL_KEY
    if (!falKey) return NextResponse.json({ error: 'FAL_KEY is not configured' }, { status: 500 })

    const {
      quickMode = false,
      videoTitle,
      asin,
      productTitle: providedProductTitle,
      productDescription: providedProductDescription,
      productBullets: providedProductBullets,
      style = 'review',
    } = await request.json() as {
      quickMode?: boolean
      videoTitle: string
      asin?: string
      productTitle?: string
      productDescription?: string
      productBullets?: string[]
      style?: string
    }

    // ── Quick mode: hook text only ─────────────────────────────────────────────
    if (quickMode) {
      const overlayHook = await generateHook(videoTitle)
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

    // ── Generate scene prompt + hook in parallel ──────────────────────────────
    const [productPrompt, overlayHook] = await Promise.all([
      generateProductPrompt({ videoTitle, productTitle, productDescription, productBullets, style, channelStyle }),
      generateHook(videoTitle),
    ])
    console.log('[generate-thumbnail] Scene prompt:', productPrompt)

    // ── PATH A: Kontext — use real product image as visual reference ──────────
    // Start from the actual Amazon product photo and transform the scene around it.
    // This guarantees the product looks exactly right without relying on text descriptions.
    if (productImageUrl) {
      try {
        // fal.ai cannot reach Supabase/Amazon URLs directly — re-host first
        const imgRes = await fetch(productImageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        if (!imgRes.ok) throw new Error(`Cannot fetch product image (${imgRes.status})`)
        const imgBlob = await imgRes.blob()
        const falImageUrl = await fal.storage.upload(imgBlob)
        console.log('[generate-thumbnail] Product image uploaded to fal:', falImageUrl)

        // Kontext: preserve the product, replace background with scene
        const kontextInstruction = `Keep the exact product object from this image — its shape, colour, material, branding, and all details. Remove the white background and any accessories, packaging, or hands. Place the product in the following scene: ${productPrompt}. The product should sit naturally in the scene with realistic shadows and lighting. No white background. No people. No text.`

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const kontextResult = await fal.subscribe('fal-ai/flux-pro/kontext' as any, {
          input: {
            image_url: falImageUrl,
            prompt: kontextInstruction,
            aspect_ratio: '16:9',
            num_images: 1,
            output_format: 'jpeg',
            guidance_scale: 5,
          },
          pollInterval: 3000,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const kontextImages = (kontextResult.data as any)?.images as Array<{ url: string }> | undefined
        const kontextUrl = kontextImages?.[0]?.url
        if (kontextUrl) {
          recordUsage({
            userId: TELEMETRY.userId, tier: TELEMETRY.tier,
            feature: 'yt_thumb_kontext_image', model: 'fal-flux-pro-kontext', images: 1,
          })
          console.log('[generate-thumbnail] Kontext result:', kontextUrl)
          return NextResponse.json({
            ok: true,
            thumbnailUrl: kontextUrl,
            overlayHook,
            prompt: kontextInstruction,
            channelStyle: channelStyle ?? null,
            modelUsed: `kontext-${style}`,
            headshotUsed: false,
          })
        }
      } catch (err) {
        console.warn('[generate-thumbnail] Kontext path failed, falling back to Flux Pro:', err)
      }
    }

    // ── PATH B: Flux Pro fallback — no product image available ────────────────
    console.log('[generate-thumbnail] Using Flux Pro fallback (no product image)')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fal.subscribe('fal-ai/flux-pro/v1.1' as any, {
      input: {
        prompt: productPrompt,
        image_size: 'landscape_16_9',
        num_inference_steps: 28,
        guidance_scale: 3.5,
        num_images: 1,
        output_format: 'jpeg',
        safety_tolerance: '2',
      },
      pollInterval: 3000,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const images = (result.data as any)?.images as Array<{ url: string }> | undefined
    const thumbnailUrl = images?.[0]?.url
    if (!thumbnailUrl) throw new Error('Flux Pro did not return an image. Please try again.')
    recordUsage({
      userId: TELEMETRY.userId, tier: TELEMETRY.tier,
      feature: 'yt_thumb_flux_image', model: 'fal-flux-pro-v1.1', images: 1,
    })

    return NextResponse.json({
      ok: true,
      thumbnailUrl,
      overlayHook,
      prompt: productPrompt,
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
