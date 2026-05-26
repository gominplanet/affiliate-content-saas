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
import { analyzeTextZone } from '@/lib/thumbnail-textzone'
import { composeWithNanoBananaPro, composeWithNanoBanana, rehostToFal, rehostFacePhotos, NANO_BANANA_PRO_COST_MODEL, NANO_BANANA_COST_MODEL } from '@/lib/thumbnail-generators'
import { NO_BRAND_IMAGE_CLAUSE } from '@/lib/image-guard'

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
    // Sonnet (not Haiku) — the description quality directly determines
    // how well flux-lora renders the product, since LoRA can't accept an
    // image reference. Worth the extra cost.
    const msg = await withAnthropicRetry(() => anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } } as any,
          {
            type: 'text',
            text: `You are writing a short visual reference for an AI image generator that CANNOT see this image. Your description determines whether the product gets rendered correctly or as a generic blob.

Describe this product's VISUAL appearance in TWO precise sentences:
  - Sentence 1: form factor + overall shape + size cue (handheld / counter-top / wearable / etc.) + dominant colours + material (plastic / brushed metal / wood / fabric / glass).
  - Sentence 2: distinctive visual features — display screens, buttons, lens, knobs, handles, grilles, stand, fabric texture, anything that makes the SHAPE recognisable. Be CONCRETE: "a single round black knob in the centre", "a vertical strip of three buttons on the right", "a circular LCD display showing dashes".

Rules:
  - 60 words MAX.
  - Do NOT name the brand or use brand-specific language.
  - Do NOT mention any text, letters, or logos visible on the product.
  - Write so a stranger could SKETCH the product from your description.

Product title (context only — don't quote): "${opts.productTitle}"`,
          },
        ],
      }],
    }))
    recordAnthropicUsage(msg, {
      userId: opts.ctx.userId, tier: opts.ctx.tier,
      feature: 'ig_ai_product_vision', model: 'claude-sonnet-4-6',
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
2. **CRITICAL — TIGHT HEAD-AND-SHOULDERS PORTRAIT. The face dominates the frame.**
   - The frame crops at the upper chest / collarbone — NOT at the waist.
   - The FACE fills roughly **the TOP 55-65% of the image**.
   - The viewer sees: forehead, full face (eyes, nose, mouth must be large and clear), neck, top of shoulders. That is ALL.
   - DO NOT show: the waist, hips, legs, full torso, both full arms, t-shirt covering the chest, or any "standing in a room" wide framing.
   - Think LinkedIn headshot zoom — not full-body portrait. The face is the hero of the composition.
3. **EXPRESSION IS THE STAR.** Eyes wide open and engaged, eyebrows expressive, mouth conveying the emotion clearly. The face must feel ALIVE — not posed, not flat.
4. **PRODUCT MUST APPEAR IN THE SCENE.** ${opts.requireProductInScene ? 'NON-NEGOTIABLE — a clear, accurate render of the product is required.' : 'Strongly preferred.'} Place it either:
   - FOREGROUND: held up CLOSE TO THE FACE — beside the cheek, at the jawline, or just below the chin. The hand holding it is barely visible, just enough to grip. NEVER at belly height with both arms extended.
   - BACKGROUND: sitting on a counter or shelf behind the subject, slightly out of focus but recognisable.
   ${opts.productVisual ? `**RENDER THE PRODUCT EXACTLY TO MATCH THIS VISUAL DESCRIPTION:** "${opts.productVisual}". Get the form factor, dominant colours, material, and distinctive features RIGHT — this is non-negotiable. If the description says it's a black handheld device with a circular display, that is what must appear — not a generic random object.` : ''}
5. EXPRESSION: DEFAULT to a warm genuine smile — friendly, inviting. Other expressions only when the video tone demands it (sceptical for scams/warnings, surprised for shocking reveals).
6. EYE CONTACT: looking directly at camera. Confident, present.` : `1. **CRITICAL — PRODUCT-FOCUSED CLOSE-UP.**
   - Product fills the upper-middle of the frame.
   - Hero shot — product centred, large, dominant.
   ${opts.productVisual ? `Render the product to match this exact visual: "${opts.productVisual}".` : ''}
2. SCENE: lived-in setting that fits the product. Blurred background.`}
${hasFace ? '7. ' : '3. '}SCENE: real-world setting (kitchen, bedroom, living room, outdoor — whatever fits the product). Background **heavily BLURRED bokeh** — visible enough to give context but never sharp. The face stays in crisp focus.
${hasFace ? '8. ' : '4. '}COMPOSITION: leave clean space at the TOP-LEFT or BOTTOM for a giant text overlay (we render text in post — your image must have negative space for it).
${hasFace ? '9. ' : '5. '}LIGHTING: editorial portrait lighting — soft key light, gentle rim light, natural skin tones. NOT plastic, NOT over-processed, NOT studio-flat.
${hasFace ? '10. ' : '6. '}**ABSOLUTELY NO TEXT, LETTERS, WORDS, LABELS, LOGOS, BRAND NAMES, NUMBERS, OR WRITING OF ANY KIND ANYWHERE IN THE IMAGE.** Product packaging must appear blank/unbranded. Clothing must be plain. Background signs, posters, books — all blank. The model is notoriously bad at rendering legible text, so the cleanest option is ZERO TEXT.
${hasFace ? '11. ' : '7. '}End with: "4:5 portrait orientation, tight HEAD-AND-SHOULDERS portrait, face dominates the frame, photorealistic, 8K, sharp focus on ${hasFace ? 'face and product, face is the hero' : 'product'}, editorial Instagram photography, natural skin tones, blurred background bokeh, no text, no letters, no logos, no labels, no writing anywhere"
${hasFace ? '12. ' : '8. '}Under 140 words.

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

    const tier = (intRow?.tier as Tier) ?? 'trial'
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
    // New instant face models store source_images (no LoRA); older ones have a
    // lora_url. We support both — source_images drive the Nano Banana Pro
    // identity path below, lora_url the legacy flux-lora path.
    let faceModel: { trigger_token: string | null; lora_url: string | null; name: string; source_images: string[] } | null = null
    if (faceModelId) {
      const { data: fm } = await sb
        .from('face_models')
        .select('trigger_token,lora_url,status,name,source_images')
        .eq('id', faceModelId)
        .eq('user_id', user.id)
        .single()
      const srcImages: string[] = Array.isArray(fm?.source_images) ? fm.source_images : []
      if (fm?.status === 'ready' && (fm?.lora_url || srcImages.length > 0)) {
        faceModel = { trigger_token: fm.trigger_token ?? null, lora_url: fm.lora_url ?? null, name: fm.name, source_images: srcImages }
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

    // ── PRIMARY: Nano Banana Pro composed portrait from the user's face photos ─
    // "Your Face" multi-photo identity refs + the real product → a designed 4:5
    // IG image with the host's true likeness, text-free (the title is overlaid
    // crisply client-side). Mirrors the YouTube composed path. Only when the
    // face model has source photos (the instant, no-LoRA models).
    const igFaceRefs = faceModel?.source_images?.length
      ? await rehostFacePhotos(sb, faceModel.source_images, 3)
      : []
    if (igFaceRefs.length > 0) {
      try {
        const igProductRef = productImageUrl ? await rehostToFal(productImageUrl) : null
        const refs = igProductRef ? [...igFaceRefs, igProductRef] : igFaceRefs
        const igProductClause = igProductRef
          ? `The FINAL reference image is the PRODUCT — render it EXACTLY (shape, colour, materials, any real branding on it); use that image ONLY for the product, never for a person.`
          : `Render any product in the scene accurately and prominently.`
        const igPrompt = `Create a vibrant, scroll-stopping NATIVE INSTAGRAM image (4:5 portrait) in the polished style of a top product reviewer.
The reference photos show the SAME real creator — reproduce their EXACT face and identity (bone structure, features, eye shape, nose, jaw, age, ethnicity, skin tone, hair); unmistakably this real person, photorealistic, never generic or altered.
WARDROBE: use the photos ONLY for the face and identity — dress them in a FRESH, natural casual outfit that suits the scene; do NOT copy the clothing or top shown in the reference photos.
${igProductClause}
COMPOSITION: a TIGHT head-and-shoulders portrait — the face fills the upper-middle and is the hero, with an energetic, expressive reaction (excited, surprised or delighted), looking at the camera, holding the product up near the face/jawline. Lived-in setting with a heavily blurred bokeh background; editorial portrait lighting, natural skin tones.
HEADLINE SPACE: leave a generous CLEAN, uncluttered area at the TOP for a headline to be added afterwards. Render ABSOLUTELY NO text, letters, words, numbers or captions anywhere.
${NO_BRAND_IMAGE_CLAUSE}
Ultra-sharp, photorealistic, 4:5 portrait.`
        const composed = await composeWithNanoBananaPro({ prompt: igPrompt, referenceImageUrls: refs, aspectRatio: '4:5', numImages: 1 })
        imageUrl = composed[0] || null
        if (imageUrl) {
          recordUsage({ userId: user.id, tier, feature: 'ig_ai_thumbnail_image', model: NANO_BANANA_PRO_COST_MODEL, images: 1 })
        } else {
          const fb = await composeWithNanoBanana({ prompt: igPrompt, referenceImageUrls: refs, aspectRatio: '4:5', numImages: 1 })
          imageUrl = fb[0] || null
          if (imageUrl) recordUsage({ userId: user.id, tier, feature: 'ig_ai_thumbnail_image', model: NANO_BANANA_COST_MODEL, images: 1 })
        }
      } catch (err) {
        console.warn('[ig-ai-image] Nano Banana composed path failed, falling back:', err)
      }
    }

    if (!imageUrl && faceModel?.lora_url) {
      // Flux-lora portrait. Use the closest stock size — flux-lora accepts
      // image_size 'portrait_4_3' which is 1024x1280 = 4:5 ratio match.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fal.subscribe('fal-ai/flux-lora' as any, {
        input: {
          prompt: scenePrompt,
          loras: [{ path: faceModel.lora_url, scale: 1.0 }],
          image_size: 'portrait_4_3',
          num_inference_steps: 32,
          // Higher guidance pushes the model to follow the prompt more
          // tightly — especially the tight-portrait framing + product
          // visual description. Was 3.5; reports of generic products and
          // loose framing prompted the bump to 5.0.
          guidance_scale: 5.0,
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
    }
    if (!imageUrl && productImageUrl) {
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

    // Smart text-zone: a cheap vision pass on the finished image tells the
    // client overlay which corner is clear of the face/subject (best-effort).
    let textPosition: string | null = null
    let faceBox: { x: number; y: number; w: number; h: number } | null = null
    if (overlayHook) {
      const tz = await analyzeTextZone(imageUrl, { ctx: agentCtx })
      textPosition = tz?.position ?? null
      faceBox = tz?.faceBox ?? null
    }

    return NextResponse.json({
      ok: true,
      imageUrl,
      overlayHook,
      textPosition,
      faceBox,
      faceModelUsed: faceModel?.trigger_token ?? null,
      cached: false,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
