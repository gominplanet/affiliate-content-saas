import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const falKey = process.env.FAL_KEY
    if (!falKey) {
      return NextResponse.json(
        { error: 'FAL_KEY not configured — add your fal.ai API key in Vercel environment variables' },
        { status: 500 }
      )
    }

    const {
      videoTitle,
      videoDescription,
      productTitle,
      productDescription,
      productBullets,
      productPrice,
      productRating,
      asin,
      style,
      includePerson = true,
    } = await request.json() as {
      videoTitle: string
      videoDescription?: string
      productTitle?: string
      productDescription?: string
      productBullets?: string[]
      productPrice?: string
      productRating?: string
      asin?: string
      style?: 'review' | 'unboxing' | 'comparison' | 'lifestyle'
      includePerson?: boolean
    }

    // ── 1. Fetch brand profile ─────────────────────────────────────────────────
    const { data: brand } = await supabase
      .from('brand_profiles')
      .select('niches,author_name,headshot_url,tone')
      .eq('user_id', user.id)
      .single()

    const b = brand as Record<string, unknown> | null
    const niches = ((b?.niches as string[]) || []).join(', ') || 'consumer products'
    const headshotUrl = (b?.headshot_url as string) || ''
    const hasHeadshot = !!headshotUrl && includePerson

    // ── 2. Build product + video context ──────────────────────────────────────
    const productContext = [
      productTitle ? `Product name: ${productTitle}` : `ASIN: ${asin}`,
      productPrice ? `Price: ${productPrice}` : '',
      productRating ? `Rating: ${productRating}/5` : '',
      productBullets?.length ? `Key features:\n${productBullets.slice(0, 5).map(b => `  - ${b}`).join('\n')}` : '',
      productDescription ? `Product description: ${productDescription}` : '',
    ].filter(Boolean).join('\n')

    const videoContext = videoDescription ? videoDescription.slice(0, 400) : ''

    // ── 3. Claude generates prompt + hook in parallel (~8s) ───────────────────
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const styleInstructions = {
      review: 'dramatic studio hero shot — product front and centre on a dark gradient or textured background, strong rim lighting, lens flare, volumetric light rays, deep dramatic shadows, bokeh reflections on the surface below',
      unboxing: 'product dramatically emerging from premium open packaging, tissue paper and packaging elements mid-air, light wood or white marble surface, warm overhead lighting creating excitement and anticipation',
      comparison: 'split-screen showdown composition — two competing products facing off, cool blue lighting on the left, warm orange on the right, glowing neon divider in the centre, cinematic depth',
      lifestyle: 'product in a beautiful real-world scene, golden hour sunlight, rich environmental storytelling, foreground elements slightly blurred, aspirational and cinematic',
    }[style ?? 'review']

    const [msg, hookMsg] = await Promise.all([
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `You are a world-class YouTube thumbnail art director. Create a Flux image generation prompt for a stunning, high-CTR YouTube thumbnail focused entirely on the product.

━━ PRODUCT CONTEXT ━━
${productContext || videoTitle}

━━ VIDEO CONTEXT ━━
Title: "${videoTitle}"
${videoContext ? `Description excerpt: "${videoContext}"` : ''}
Niche: ${niches}

━━ VISUAL STYLE ━━
${styleInstructions}

━━ COMPOSITION ━━
NO people or faces — product drama only. The product is the sole hero of the frame, occupying 60-70% of the image width, centred or slightly right of centre.

━━ TECHNICAL REQUIREMENTS ━━
- Photorealistic commercial photography quality, 4K, ultra-detailed
- Rich, saturated colours that pop on mobile screens (avoid desaturated/muted tones)
- Dramatic lighting: strong key light, rim light, fill light — NOT flat lighting
- NO text, NO words, NO letters, NO numbers anywhere in the image
- Professional depth of field: razor-sharp subject, creamy bokeh background
- The image should look like a $5,000 professional photoshoot

Write ONLY the image generation prompt. Be hyper-specific: name exact colours, lighting positions, surface textures, background details, atmosphere, and camera lens. 150-220 words.`,
        }],
      }),
      anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 30,
        messages: [{
          role: 'user',
          content: `Write a 2-4 word ALL-CAPS YouTube thumbnail hook for this product review. It MUST be a complete, self-contained phrase — never end with a preposition or leave it hanging. Make it punchy and emotional — like "WORTH IT?", "DON'T BUY!", "GAME CHANGER?", "BEST ONE YET!", "WE LOVE IT!", "LIFE CHANGING?", "ACTUALLY WORKS?". NEVER use the word HONEST. Return ONLY the hook text, no quotes, no punctuation at the end unless it's ? or !.

Product: ${productContext.split('\n')[0]}
Video title: "${videoTitle}"`,
        }],
      }),
    ])

    const productOnlyPrompt = (msg.content[0] as { type: string; text: string }).text.trim()
    const overlayHook = (hookMsg.content[0] as { type: string; text: string }).text.trim().toUpperCase()
    const imagePrompt = productOnlyPrompt

    // ── 4a. Flux Kontext via fal.ai QUEUE (image editing — starts from headshot) ──
    // Fundamentally different from PuLID: instead of face-conditioning a new image,
    // Kontext *edits* the actual headshot into the thumbnail scene. Much better composition.
    if (hasHeadshot) {
      const cleanHeadshotUrl = headshotUrl.split('?')[0]
      console.log('[generate-thumbnail] Submitting Flux Kontext to queue, headshot:', cleanHeadshotUrl)

      // Extract a short product description for the editing prompt
      const productLine = productContext.split('\n')[0].replace('Product name: ', '').replace('ASIN: ', '')

      // Kontext editing prompt: tell it exactly what to do to the headshot
      const kontextPrompt = `Transform this headshot photo into a professional YouTube thumbnail (16:9 landscape).
Keep the person's face, hair and appearance identical.
Reframe to show them from the waist up on the LEFT third of the image, with a wide surprised excited expression, mouth slightly open, eyebrows raised, looking toward the right side of the frame.
On the RIGHT two-thirds of the frame: ${productLine} shown large, dramatic, photorealistic commercial photography style, strong studio rim lighting, deep rich colours, sharp detail, dark gradient background.
The overall look should be high-contrast, punchy, and eye-catching — like a top YouTube affiliate review thumbnail. No text anywhere.`

      try {
        const submitRes = await fetch('https://queue.fal.run/fal-ai/flux-kontext', {
          method: 'POST',
          headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: cleanHeadshotUrl,
            prompt: kontextPrompt,
            num_inference_steps: 30,
            guidance_scale: 2.5,
            num_images: 1,
            output_format: 'jpeg',
            resolution_mode: '16:9',
          }),
        })

        const submitData = await submitRes.json() as { request_id?: string; error?: string }
        console.log('[generate-thumbnail] Kontext queue submit:', submitRes.status, JSON.stringify(submitData).slice(0, 300))

        if (submitRes.ok && submitData.request_id) {
          return NextResponse.json({
            ok: true,
            usesQueue: true,
            requestId: submitData.request_id,
            queueModel: 'fal-ai/flux-kontext',
            prompt: imagePrompt,
            overlayHook,
            headshotUsed: true,
          })
        }

        // Queue submit failed — fall through to Flux
        console.warn('[generate-thumbnail] Kontext queue submit failed:', submitData.error)
      } catch (err) {
        console.warn('[generate-thumbnail] Kontext queue error:', err)
      }
    }

    // ── 4b. Flux Dev → Schnell (synchronous, fast enough) ────────────────────
    let thumbnailUrl: string | null = null
    let lastError = ''
    let modelUsed = ''

    async function falJson(res: globalThis.Response): Promise<Record<string, unknown>> {
      const text = await res.text()
      try { return JSON.parse(text) as Record<string, unknown> } catch { return { _raw: text } }
    }

    async function timedFetch(url: string, init: RequestInit, ms: number): Promise<globalThis.Response> {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), ms)
      try {
        return await fetch(url, { ...init, signal: ctrl.signal })
      } finally {
        clearTimeout(timer)
      }
    }

    for (const model of ['fal-ai/flux/dev', 'fal-ai/flux/schnell']) {
      try {
        const isSchnell = model.includes('schnell')
        const res = await timedFetch(`https://fal.run/${model}`, {
          method: 'POST',
          headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: imagePrompt,
            image_size: 'landscape_16_9',
            num_inference_steps: isSchnell ? 4 : 18,
            guidance_scale: isSchnell ? undefined : 3.5,
            num_images: 1,
            enable_safety_checker: false,
          }),
        }, isSchnell ? 12_000 : 18_000)
        const data = await falJson(res)
        if (!res.ok) {
          lastError = `${model} ${res.status}: ${JSON.stringify(data).slice(0, 200)}`
          continue
        }
        thumbnailUrl = (data.images as Array<{ url: string }>)?.[0]?.url ?? null
        if (thumbnailUrl) { modelUsed = model; break }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }

    // ── 4c. Replicate fallback ────────────────────────────────────────────────
    if (!thumbnailUrl && process.env.REPLICATE_API_TOKEN) {
      try {
        const startRes = await timedFetch('https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
            'Content-Type': 'application/json',
            Prefer: 'wait=15',
          },
          body: JSON.stringify({
            input: {
              prompt: imagePrompt,
              aspect_ratio: '16:9',
              num_outputs: 1,
              output_format: 'jpg',
              output_quality: 90,
              guidance: 3.5,
              num_inference_steps: 20,
            },
          }),
        }, 16_000)
        const pred = await falJson(startRes) as { output?: string[] }
        thumbnailUrl = pred.output?.[0] ?? null
        if (thumbnailUrl) modelUsed = 'replicate/flux-dev'
      } catch (err) {
        lastError = `Replicate: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    if (!thumbnailUrl) {
      throw new Error(`Image generation failed: ${lastError}`)
    }

    return NextResponse.json({
      ok: true,
      usesQueue: false,
      thumbnailUrl,
      prompt: imagePrompt,
      overlayHook,
      modelUsed,
      headshotUsed: false,
      pulidError: hasHeadshot ? 'PuLID queue submit failed, used Flux fallback' : null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[generate-thumbnail]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
