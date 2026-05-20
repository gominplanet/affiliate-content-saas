/**
 * POST /api/instagram/generate-ai-image
 *
 * Generates a native 4:5 portrait AI image for an Instagram feed post —
 * tuned for the IG viewport (vertical, face + product centred). Pro-only.
 * Persists the result on youtube_videos.instagram_ai_thumbnail_url so
 * re-opening the IG modal for the same video doesn't burn a credit.
 *
 * Input:
 *   { postId, customHeadline?, faceModelId?, styleReferenceUrl? }
 *
 * Output:
 *   { ok, imageUrl, overlayHook, faceModelUsed?, regenerated?: boolean }
 *
 * Output composition matches the existing AI Thumbnail pipeline:
 *   - Person + product in a real-world setting
 *   - 4:5 portrait
 *   - Clean text-overlay zone (rendered client-side in the IG modal)
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { fetchAmazonProduct, extractAsin } from '@/services/amazon'
import { fal } from '@fal-ai/client'
import { recordAnthropicUsage, recordUsage } from '@/lib/ai-usage'
import { TIERS, nextTierFor, type Tier } from '@/lib/tier'
import { checkUsageCap, PRIMARY_FEATURE } from '@/lib/usage-cap'

/**
 * Look for an ASIN inside the FIRST TWO SENTENCES of the YouTube
 * description. Creators typically drop the Amazon affiliate URL right
 * after the hook — so even when the video title doesn't carry the
 * 10-char ASIN code, we can usually recover the product here.
 *
 * Patterns matched:
 *   - https://www.amazon.com/dp/B0XXXXXXXX
 *   - https://www.amazon.com/gp/product/B0XXXXXXXX
 *   - amzn.to/XX  (short link — followed with HEAD to get the real URL)
 *   - geni.us/XX  (geniuslink — followed with HEAD to get the real URL)
 *   - bare 10-char ASIN tokens left in the prose
 */
async function findAsinInDescription(description: string): Promise<string | null> {
  if (!description) return null
  // Take the first two sentences. Conservative cutoff so we don't chase
  // ASINs deep in the description where they're more likely to belong to
  // a different product / a CTA / a B-roll suggestion.
  const head = description.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ').slice(0, 600)

  // Direct ASIN-in-URL patterns first (no network roundtrip).
  const directMatch = head.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})\b/i)
  if (directMatch) return directMatch[1].toUpperCase()

  // Bare ASIN token (legacy creators sometimes write "B0XXXXXXXX" inline).
  const bareMatch = extractAsin(head.toUpperCase())
  if (bareMatch) return bareMatch

  // Short-link follow — amzn.to / geni.us. HEAD with redirect:'follow' so
  // we read the final URL without downloading the body.
  const shortLink = head.match(/https?:\/\/(?:www\.)?(?:amzn\.to|geni\.us)\/[A-Za-z0-9]+/i)
  if (shortLink) {
    try {
      const res = await fetch(shortLink[0], {
        method: 'HEAD',
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const finalUrl = res.url || ''
      const followed = finalUrl.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})\b/i)
      if (followed) return followed[1].toUpperCase()
    } catch { /* unreachable — fall through */ }
  }

  return null
}

/**
 * Have Claude *look at* the product image and write a 1-sentence visual
 * description (shape, colour, material, distinguishing features) we can
 * inject into the LoRA prompt. flux-lora can't accept an image reference
 * directly when a LoRA is loaded, so the textual description is how we
 * keep the product looking right.
 */
async function describeProductVisually(opts: {
  imageUrl: string
  productTitle: string
  ctx: AgentCtx
}): Promise<string> {
  try {
    const imgRes = await fetch(opts.imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!imgRes.ok) return ''
    const buf = await imgRes.arrayBuffer()
    const b64 = Buffer.from(buf).toString('base64')
    const mediaType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0]
    const anthropic = createAnthropicClient()
    const msg = await withAnthropicRetry(() => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } } as any,
          {
            type: 'text',
            text: `Describe this product's VISUAL appearance in ONE rich sentence for an image-generation prompt. Cover: form factor (handheld? freestanding? wearable?), dominant colours, material (plastic/metal/wood/fabric), shape, any distinctive visual feature (display screen, buttons, lens, handle, etc.). Do NOT name the brand. Do NOT mention text or logos. Keep it under 40 words.

Product title (context only — don't quote): "${opts.productTitle}"`,
          },
        ],
      }],
    }))
    recordAnthropicUsage(msg, {
      userId: opts.ctx.userId, tier: opts.ctx.tier,
      feature: 'ig_ai_product_vision', model: 'claude-haiku-4-5-20251001',
    })
    return (msg.content[0] as { type: string; text: string }).text.trim()
  } catch {
    return ''
  }
}

export const maxDuration = 120

interface AgentCtx { userId: string | null; tier: string | null }

// ── Anthropic retry wrapper (matches the YT thumbnail route) ────────────────
async function withAnthropicRetry<T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let delay = 1500
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await fn() }
    catch (err) {
      const status = (err as Record<string, unknown>)?.status as number | undefined
      const msg = err instanceof Error ? err.message : String(err)
      const overloaded = status === 529 || msg.includes('529') || msg.toLowerCase().includes('overloaded')
      if (!overloaded || attempt === maxAttempts) throw err
      await new Promise(r => setTimeout(r, delay))
      delay = Math.min(delay * 1.5, 12000)
    }
  }
  throw new Error('Claude overloaded')
}

/** Generate a hook for the IG overlay. Same shape as YT's generateHook but
 *  worded for IG context (shorter, more scroll-stopping). */
async function generateIGHook(videoTitle: string, ctx: AgentCtx): Promise<string> {
  const anthropic = createAnthropicClient()
  const msg = await withAnthropicRetry(() => anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 40,
    messages: [{
      role: 'user',
      content: `Write a 2-3 word ALL-CAPS Instagram-friendly hook based on this video.
RULES:
- 2-3 words MAX, complete phrase
- No emojis, no punctuation except ? or !
- Avoid: AMAZING, INCREDIBLE, INSANE, HONEST
- IG-style hooks: "GAME CHANGER!", "SAVED ME!", "DON'T BUY!", "WORTH IT?", "MUST HAVE!"
Return ONLY the hook.
Video: "${videoTitle}"`,
    }],
  }))
  recordAnthropicUsage(msg, {
    userId: ctx.userId, tier: ctx.tier,
    feature: 'ig_ai_thumbnail_hook', model: 'claude-haiku-4-5-20251001',
  })
  return (msg.content[0] as { type: string; text: string }).text.trim().toUpperCase()
}

/** Person + product scene prompt tuned for 4:5 portrait IG composition. */
async function generateIGScenePrompt(opts: {
  triggerToken: string | null
  faceName: string | null
  videoTitle: string
  productTitle: string
  productDescription: string
  productBullets: string[]
  /** Vision-derived visual description from the real product image —
   *  this is what anchors the LoRA path (which can't accept an image
   *  reference). Empty string when no product was resolved. */
  productVisual: string
  /** True when we resolved a product. Forces the scene to put the
   *  product into the frame (background or foreground). */
  requireProductInScene: boolean
  ctx: AgentCtx
}): Promise<string> {
  const anthropic = createAnthropicClient()
  const hasFace = !!opts.triggerToken
  const msg = await withAnthropicRetry(() => anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Write a Flux image generation prompt for a NATIVE INSTAGRAM POST (4:5 portrait, vertical).

VIDEO: "${opts.videoTitle}"
PRODUCT: ${opts.productTitle || 'product from the video'}
${opts.productVisual ? `PRODUCT VISUAL APPEARANCE (from real product photo — describe the object in the scene to match this exactly): ${opts.productVisual}` : ''}
${opts.productDescription ? `DESCRIPTION: ${opts.productDescription}` : ''}
${opts.productBullets.length ? `FEATURES: ${opts.productBullets.slice(0, 4).join(' · ')}` : ''}
${hasFace ? `CREATOR'S FACE TRIGGER TOKEN: ${opts.triggerToken} — must appear at the very start of the prompt so the loaded LoRA activates.` : ''}

PROMPT RULES (Instagram-tuned, 4:5 portrait):

${hasFace ? `1. START with "${opts.triggerToken}" — LoRA trigger word, must be first.
2. **CRITICAL — FRAMING IS A BUST SHOT, ABOVE THE WAIST.**
   - The frame crops at or just above the waist.
   - The HEAD, NECK, SHOULDERS, and UPPER TORSO fill the frame.
   - Face occupies roughly the TOP THIRD of the image.
   - DO NOT show: hips, legs, full body, or wide "standing in a room" shots.
3. **PRODUCT MUST APPEAR IN THE SCENE.** ${opts.requireProductInScene ? 'NON-NEGOTIABLE — a clear render of the product is required.' : 'Strongly preferred.'} Place it either:
   - FOREGROUND: held in hand at chest height, presented to camera, OR
   - BACKGROUND: sitting on a counter / shelf / table behind the subject, clearly visible over the shoulder.
   ${opts.productVisual ? `Render the product to match this exact visual: "${opts.productVisual}". Get the shape, colour, and material right.` : ''}
4. EXPRESSION: DEFAULT to a warm genuine smile — friendly, inviting. Other expressions only when the video tone demands it (sceptical for scams/warnings, surprised for shocking reveals).
5. EYE CONTACT: looking directly at camera. Confident.` : `1. **CRITICAL — PRODUCT-FOCUSED CLOSE-UP.**
   - Product fills the upper-middle of the frame.
   - Hero shot — product centred, large, dominant.
   ${opts.productVisual ? `Render the product to match this exact visual: "${opts.productVisual}".` : ''}
2. SCENE: lived-in setting that fits the product. Blurred background.`}
${hasFace ? '6. ' : '3. '}SCENE: real-world setting (kitchen, bedroom, living room, outdoor — whatever fits the product). Background heavily BLURRED bokeh so it doesn't distract from the subject.
${hasFace ? '7. ' : '4. '}COMPOSITION: leave clean space at the TOP-LEFT or BOTTOM for a giant text overlay (we render text in post — your image must have negative space for it).
${hasFace ? '8. ' : '5. '}LIGHTING: editorial portrait lighting — soft key light, gentle rim light, natural skin tones. NOT plastic, NOT over-processed, NOT studio-flat.
${hasFace ? '9. ' : '6. '}**ABSOLUTELY NO TEXT, LETTERS, WORDS, LABELS, LOGOS, BRAND NAMES, NUMBERS, OR WRITING OF ANY KIND ANYWHERE IN THE IMAGE.** Product packaging must appear blank/unbranded. Clothing must be plain. Background signs, posters, books — all blank. The model is notoriously bad at rendering legible text, so the cleanest option is ZERO TEXT.
${hasFace ? '10. ' : '7. '}End with: "4:5 portrait orientation, BUST SHOT above the waist, photorealistic, 8K, sharp focus on ${hasFace ? 'face and product' : 'product'}, editorial Instagram photography, natural skin tones, blurred background bokeh, no text, no letters, no logos, no labels, no writing anywhere"
${hasFace ? '11. ' : '8. '}Under 130 words.

Return ONLY the prompt — no preamble.`,
    }],
  }))
  recordAnthropicUsage(msg, {
    userId: opts.ctx.userId, tier: opts.ctx.tier,
    feature: 'ig_ai_scene_prompt', model: 'claude-sonnet-4-6',
  })
  return (msg.content[0] as { type: string; text: string }).text.trim()
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json() as {
      postId?: string
      customHeadline?: string
      faceModelId?: string | null
      styleReferenceUrl?: string | null
      /** When true, ignore any cached generation and burn a new credit. */
      force?: boolean
    }
    const { postId, customHeadline, faceModelId, styleReferenceUrl, force } = body
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

    // ── Look up the blog_post → video chain to assemble context ───────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const [{ data: post }, { data: intRow }] = await Promise.all([
      sb.from('blog_posts')
        .select('id,user_id,video_id,title,excerpt')
        .eq('id', postId).eq('user_id', user.id).single(),
      sb.from('integrations')
        .select('tier,subscription_period_start,subscription_period_end,geniuslink_api_key,geniuslink_api_secret,amazon_associates_tag')
        .eq('user_id', user.id).single(),
    ])
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    const tier = (intRow?.tier as Tier) ?? 'free'
    if (tier !== 'pro' && tier !== 'admin') {
      return NextResponse.json({
        error: `Native Instagram AI thumbnails are a ${TIERS.pro.label} feature.`,
        limitReached: true,
        cap: 'instagram_ai',
        currentTier: tier,
        upgrade: { tier: 'pro' as Tier, label: TIERS.pro.label, limit: TIERS.pro.instagramAiThumbnailsPerMonth },
      }, { status: 403 })
    }

    // ── Pull the video row (gives us title / description / detected ASIN /
    // existing AI thumbnail URL for the dedupe path) ─────────────────────────
    const { data: video } = await sb
      .from('youtube_videos')
      .select('id,title,description,youtube_video_id,instagram_ai_thumbnail_url,instagram_ai_thumbnail_generated_at')
      .eq('id', post.video_id)
      .eq('user_id', user.id)
      .single()
    if (!video) return NextResponse.json({ error: 'Source video not found' }, { status: 404 })

    // Re-use the existing image if one was generated recently and the
    // caller didn't pass force:true. Saves a credit when the user just
    // re-opens the modal.
    if (!force && video.instagram_ai_thumbnail_url) {
      return NextResponse.json({
        ok: true,
        imageUrl: video.instagram_ai_thumbnail_url,
        // Return the cached hook too so the client can re-run the canvas
        // overlay (picks a fresh style index biased by current 👍/👎
        // history — that's how the feedback row gets a styleId on cache
        // hits, otherwise the thumbs row would never appear after a
        // re-open).
        overlayHook: (video as { instagram_ai_thumbnail_hook?: string | null }).instagram_ai_thumbnail_hook ?? '',
        cached: true,
      })
    }

    // ── Cap gate — Pro 50/month, charged ONLY when we actually generate ─────
    const cap = TIERS[tier].instagramAiThumbnailsPerMonth
    const capCheck = await checkUsageCap(
      supabase, user.id, PRIMARY_FEATURE.instagramAi, cap,
      (intRow?.subscription_period_start as string | null) ?? null,
      (intRow?.subscription_period_end as string | null) ?? null,
    )
    if (capCheck?.exceeded) {
      const next = nextTierFor(tier, 'instagramAiThumbnailsPerMonth')
      const nextHint = next
        ? ` Upgrade to ${next.label} for ${next.limit === null ? 'unlimited' : `${next.limit} / month`}.`
        : ''
      return NextResponse.json({
        error: `You've hit your ${cap} Instagram AI image generations for this billing period on the ${TIERS[tier].label} plan.${nextHint} Resets ${capCheck.resetLabel}.`,
        limitReached: true,
        cap: 'instagram_ai',
        currentTier: tier,
        upgrade: next ? { tier: next.tier, label: next.label, limit: next.limit } : null,
      }, { status: 429 })
    }

    // ── Resolve ASIN + product data ──────────────────────────────────────────
    // Priority: 1) explicit ASIN in title, 2) Amazon/Geniuslink URL in the
    // FIRST TWO SENTENCES of the description (where creators put the
    // affiliate link). When either yields an ASIN, the product MUST appear
    // in the rendered scene — the user has been explicit about this.
    let productTitle = ''
    let productDescription = ''
    let productBullets: string[] = []
    let productImageUrl: string | null = null
    let productVisual = ''
    const titleAsinMatch = (video.title as string).toUpperCase().match(/\b([A-Z0-9]{10})\b/)
    let asin: string | null = titleAsinMatch?.[1] || null
    if (!asin) {
      asin = await findAsinInDescription((video.description as string) || '')
    }
    const requireProductInScene = !!asin
    if (asin) {
      try {
        const p = await fetchAmazonProduct(asin)
        productTitle = p.title
        productDescription = p.description
        productBullets = p.bullets
        productImageUrl = p.imageUrl
      } catch { /* non-fatal */ }
    }

    // ── Look up the face model if the user picked one ───────────────────────
    let faceModel: { trigger_token: string; lora_url: string; name: string } | null = null
    if (faceModelId) {
      const { data: fm } = await sb
        .from('face_models')
        .select('trigger_token,lora_url,status,name')
        .eq('id', faceModelId)
        .eq('user_id', user.id)
        .single()
      if (fm?.status === 'ready' && fm?.lora_url) {
        faceModel = { trigger_token: fm.trigger_token, lora_url: fm.lora_url, name: fm.name }
      }
    }

    const agentCtx: AgentCtx = { userId: user.id, tier }
    const lockedHeadline = (customHeadline || '').trim().toUpperCase()

    // ── Vision pass on the product image (face path only — Kontext path
    //    uses the image directly so no description needed) ─────────────────
    if (productImageUrl && faceModel) {
      productVisual = await describeProductVisually({
        imageUrl: productImageUrl, productTitle, ctx: agentCtx,
      })
    }

    // ── Build scene prompt + hook in parallel ───────────────────────────────
    const [scenePrompt, generatedHook] = await Promise.all([
      generateIGScenePrompt({
        triggerToken: faceModel?.trigger_token ?? null,
        faceName: faceModel?.name ?? null,
        videoTitle: video.title as string,
        productTitle,
        productDescription,
        productBullets,
        productVisual,
        requireProductInScene,
        ctx: agentCtx,
      }),
      lockedHeadline ? Promise.resolve('') : generateIGHook(video.title as string, agentCtx),
    ])
    const overlayHook = lockedHeadline || generatedHook

    // ── Fal generation — 4:5 portrait, flux-lora if face model, else flux-pro
    const falKey = process.env.FAL_KEY
    if (!falKey) return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 })
    fal.config({ credentials: falKey })

    let imageUrl: string | null = null
    if (faceModel) {
      // Flux-lora portrait. Use the closest stock size — flux-lora accepts
      // image_size 'portrait_4_3' which is 1024x1280 = 4:5 ratio match.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fal.subscribe('fal-ai/flux-lora' as any, {
        input: {
          prompt: scenePrompt,
          loras: [{ path: faceModel.lora_url, scale: 1.0 }],
          image_size: 'portrait_4_3',
          num_inference_steps: 28,
          guidance_scale: 3.5,
          num_images: 1,
          output_format: 'jpeg',
        },
        pollInterval: 3000,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const images = (result.data as any)?.images as Array<{ url: string }> | undefined
      imageUrl = images?.[0]?.url || null
      if (imageUrl) {
        recordUsage({
          userId: user.id, tier,
          feature: 'ig_ai_thumbnail_image', model: 'fal-flux-lora', images: 1,
        })
      }
    } else if (productImageUrl) {
      // No face but we have a real product image — route through Kontext
      // so the rendered product matches the Amazon photo exactly (shape,
      // colour, material, branding). Kontext takes the product image as
      // a visual reference and recomposes the scene around it.
      try {
        const imgRes = await fetch(productImageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        if (!imgRes.ok) throw new Error(`Cannot fetch product image (${imgRes.status})`)
        const imgBlob = await imgRes.blob()
        const falImageUrl = await fal.storage.upload(imgBlob)
        const kontextInstruction = `Keep the exact product object from this image — its shape, colour, material, branding, and all details. Remove the white background and any accessories, packaging, or hands. Place the product in the following scene: ${scenePrompt}. The product should sit naturally in the scene with realistic shadows and lighting. ABSOLUTELY NO TEXT, LETTERS, WORDS, LABELS, LOGOS (other than what already exists on the product itself), NUMBERS, OR WRITING anywhere in the surrounding scene. 4:5 portrait orientation.`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const kontextResult = await fal.subscribe('fal-ai/flux-pro/kontext' as any, {
          input: {
            image_url: falImageUrl,
            prompt: kontextInstruction,
            aspect_ratio: '4:5',
            num_images: 1,
            output_format: 'jpeg',
            guidance_scale: 5,
          },
          pollInterval: 3000,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const kontextImages = (kontextResult.data as any)?.images as Array<{ url: string }> | undefined
        imageUrl = kontextImages?.[0]?.url || null
        if (imageUrl) {
          recordUsage({
            userId: user.id, tier,
            feature: 'ig_ai_thumbnail_image', model: 'fal-flux-pro-kontext', images: 1,
          })
        }
      } catch (err) {
        console.warn('[ig-ai-image] Kontext path failed, falling back to flux-pro:', err)
      }
    }

    // Fallback path — no face model and Kontext didn't run or failed.
    // Plain flux-pro 4:5 with the textual prompt only.
    if (!imageUrl) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fal.subscribe('fal-ai/flux-pro/v1.1' as any, {
        input: {
          prompt: scenePrompt,
          image_size: 'portrait_4_3',
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
      imageUrl = images?.[0]?.url || null
      if (imageUrl) {
        recordUsage({
          userId: user.id, tier,
          feature: 'ig_ai_thumbnail_image', model: 'fal-flux-pro-v1.1', images: 1,
        })
      }
    }

    if (!imageUrl) return NextResponse.json({ error: 'Image generation failed — please try again.' }, { status: 502 })

    // Style reference parameter is captured but currently ignored — the
    // IG prompt builder doesn't read it yet. Leaving the param on the
    // type so the modal can wire it without an API change later.
    void styleReferenceUrl

    // Persist on youtube_videos so re-opening the modal for the same
    // video shows this image without re-generating.
    await sb
      .from('youtube_videos')
      .update({
        instagram_ai_thumbnail_url: imageUrl,
        instagram_ai_thumbnail_hook: overlayHook,
        instagram_ai_thumbnail_generated_at: new Date().toISOString(),
      })
      .eq('id', video.id)
      .eq('user_id', user.id)

    return NextResponse.json({
      ok: true,
      imageUrl,
      overlayHook,
      faceModelUsed: faceModel?.trigger_token ?? null,
      cached: false,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
