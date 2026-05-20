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
import { fetchAmazonProduct } from '@/services/amazon'
import { fal } from '@fal-ai/client'
import { recordAnthropicUsage, recordUsage } from '@/lib/ai-usage'
import { TIERS, nextTierFor, type Tier } from '@/lib/tier'
import { checkUsageCap, PRIMARY_FEATURE } from '@/lib/usage-cap'

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
${opts.productDescription ? `DESCRIPTION: ${opts.productDescription}` : ''}
${opts.productBullets.length ? `FEATURES: ${opts.productBullets.slice(0, 4).join(' · ')}` : ''}
${hasFace ? `CREATOR'S FACE TRIGGER TOKEN: ${opts.triggerToken} — must appear at the very start of the prompt so the loaded LoRA activates.` : ''}

PROMPT RULES (Instagram-tuned):
${hasFace ? `1. START with "${opts.triggerToken}" — LoRA trigger word.
2. PORTRAIT FRAMING: ${opts.triggerToken} is the focal point — face takes up roughly 30-40% of the upper portion of the frame, product held in their hands at chest/shoulder height. This is a 4:5 PORTRAIT, so use vertical composition — person centred, product just below their face.
3. EXPRESSION: DEFAULT to a warm genuine smile — friendly, inviting. ONLY use other expressions if the video tone demands it (sceptical for scams/warnings, surprised for shocking reveals). When in doubt: smile.
4. EYE CONTACT: looking at camera. Natural.` : `1. PORTRAIT FRAMING: product is the focal point, dominantly visible centred in the frame's upper-middle.
2. SCENE: real-world setting that fits the product (kitchen if it's a food gadget, bedroom if it's bedding, etc.). Lived-in, NOT a studio.
3. COMPOSITION: this is a 4:5 PORTRAIT, vertical orientation. Product centred top-third, scene context below.`}
5. PRODUCT: clearly visible, ${hasFace ? 'held near their chest or shoulder' : 'centred and prominent'}. Look real, not photoshopped.
6. SCENE: real-world setting (kitchen, bedroom, living room, outdoor — whatever fits the product). Lived-in. Blurred background bokeh that supports the subject.
7. COMPOSITION: leave clean space at the TOP for a giant text overlay headline (Instagram users see the top first). Most of the visual energy lives in the lower 60-70% of the frame.
8. LIGHTING: editorial portrait — soft key light, gentle contrast, natural skin tones. NOT plastic, NOT over-processed.
9. End with: "4:5 portrait orientation, photorealistic, 8K, sharp focus on ${hasFace ? 'face and product' : 'product'}, editorial Instagram photography, natural skin tones, no text overlays"
10. Under 110 words.

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
    // We already have video.description with the ASIN code (verified
    // upstream by the metadata generator). Re-scrape Amazon for the
    // product title / description / bullets so the prompt has real specs.
    let productTitle = ''
    let productDescription = ''
    let productBullets: string[] = []
    const titleAsinMatch = (video.title as string).toUpperCase().match(/\b([A-Z0-9]{10})\b/)
    const asin = titleAsinMatch?.[1] || null
    if (asin) {
      try {
        const p = await fetchAmazonProduct(asin)
        productTitle = p.title
        productDescription = p.description
        productBullets = p.bullets
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

    // ── Build scene prompt + hook in parallel ───────────────────────────────
    const [scenePrompt, generatedHook] = await Promise.all([
      generateIGScenePrompt({
        triggerToken: faceModel?.trigger_token ?? null,
        faceName: faceModel?.name ?? null,
        videoTitle: video.title as string,
        productTitle,
        productDescription,
        productBullets,
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
    } else {
      // No face — use plain Flux Pro 4:5. Slightly more polished than
      // flux-lora on raw aesthetics when no LoRA needs to load.
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
