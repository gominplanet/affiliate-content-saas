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
    const authorName = (b?.author_name as string) || 'the host'
    const headshotUrl = (b?.headshot_url as string) || ''
    const hasHeadshot = !!headshotUrl && includePerson

    // ── 2. Build rich product + video context ──────────────────────────────────
    const productContext = [
      productTitle ? `Product name: ${productTitle}` : `ASIN: ${asin}`,
      productPrice ? `Price: ${productPrice}` : '',
      productRating ? `Rating: ${productRating}/5` : '',
      productBullets?.length ? `Key features:\n${productBullets.slice(0, 5).map(b => `  - ${b}`).join('\n')}` : '',
      productDescription ? `Product description: ${productDescription}` : '',
    ].filter(Boolean).join('\n')

    const videoContext = videoDescription
      ? videoDescription.slice(0, 400)
      : ''

    // ── 3. Claude Sonnet writes the image generation prompt ───────────────────
    // Use Sonnet here — this is the creative bottleneck, quality matters
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const styleInstructions = {
      review: 'dramatic studio hero shot — product front and centre on a dark gradient or textured background, strong rim lighting, lens flare, volumetric light rays, deep dramatic shadows, bokeh reflections on the surface below',
      unboxing: 'product dramatically emerging from premium open packaging, tissue paper and packaging elements mid-air, light wood or white marble surface, warm overhead lighting creating excitement and anticipation',
      comparison: 'split-screen showdown composition — two competing products facing off, cool blue lighting on the left, warm orange on the right, glowing neon divider in the centre, cinematic depth',
      lifestyle: 'product in a beautiful real-world scene, golden hour sunlight, rich environmental storytelling, foreground elements slightly blurred, aspirational and cinematic',
    }[style ?? 'review']

    // Always generate a PRODUCT-ONLY prompt from Claude.
    // Person composition is handled separately — PuLID receives a person-prefix prepended
    // to the product prompt. This way if PuLID fails and Flux takes over, no random
    // people are invented by the model.
    const msg = await anthropic.messages.create({
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
    })

    const productOnlyPrompt = (msg.content[0] as { type: string; text: string }).text.trim()

    // For PuLID: prepend a tight composition instruction so the face-swap model
    // knows exactly where to place the reference face. Flux fallback uses the
    // product-only prompt — no people, no surprises.
    const pulidPrompt = `YouTube thumbnail split composition: ${authorName || 'a person'} in the LEFT THIRD of frame with a wide open-mouth shocked/excited expression, eyebrows raised high, pointing at the product. Product occupies the RIGHT 65% of frame. ${productOnlyPrompt}`

    const imagePrompt = productOnlyPrompt // used for Flux fallbacks

    // ── 4. Generate image ─────────────────────────────────────────────────────
    let thumbnailUrl: string | null = null
    let lastError = ''
    let modelUsed = ''

    // Safe JSON parse — fal.ai occasionally returns plain text on errors
    async function falJson(res: globalThis.Response): Promise<Record<string, unknown>> {
      const text = await res.text()
      try { return JSON.parse(text) as Record<string, unknown> } catch { return { _raw: text } }
    }

    // Timed fetch — aborts after `ms` milliseconds so we never hang past the Vercel limit
    async function timedFetch(url: string, init: RequestInit, ms: number): Promise<globalThis.Response> {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), ms)
      try {
        return await fetch(url, { ...init, signal: ctrl.signal })
      } finally {
        clearTimeout(timer)
      }
    }

    // ── 4a. PuLID when headshot available (face-consistent generation) ─────────
    // Hard cap at 22s so a hanging PuLID never eats the whole budget
    if (hasHeadshot) {
      try {
        const res = await timedFetch('https://fal.run/fal-ai/pulid', {
          method: 'POST',
          headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: pulidPrompt,
            reference_images: [{ image_url: headshotUrl }],
            image_size: 'landscape_16_9',
            num_inference_steps: 12,   // was 20 — faster, still good quality
            num_images: 1,
          }),
        }, 22_000)
        const data = await falJson(res)
        if (res.ok) {
          thumbnailUrl = (data.images as Array<{ url: string }>)?.[0]?.url ?? null
          if (thumbnailUrl) modelUsed = 'pulid'
        } else {
          lastError = `PuLID ${res.status}: ${JSON.stringify(data).slice(0, 200)}`
          console.warn('[generate-thumbnail] PuLID failed, falling back to Flux:', lastError)
        }
      } catch (err) {
        lastError = `PuLID: ${err instanceof Error ? err.message : String(err)}`
        console.warn('[generate-thumbnail] PuLID error:', lastError)
      }
    }

    // ── 4b. Flux Dev → Schnell fallback ───────────────────────────────────────
    // Flux Dev capped at 18s; Schnell at 12s — total image budget ≤ 22+18 = 40s
    if (!thumbnailUrl) {
      for (const model of ['fal-ai/flux/dev', 'fal-ai/flux/schnell']) {
        try {
          const isSchnell = model.includes('schnell')
          const res = await timedFetch(`https://fal.run/${model}`, {
            method: 'POST',
            headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: imagePrompt,
              image_size: 'landscape_16_9',
              num_inference_steps: isSchnell ? 4 : 18,   // Dev: 18 steps (was 28)
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
    }

    // ── 4c. Replicate fallback (capped at 15s total) ──────────────────────────
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
        const pred = await falJson(startRes) as { output?: string[]; urls?: { get: string } }
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
      thumbnailUrl,
      prompt: imagePrompt,
      modelUsed,
      headshotUsed: hasHeadshot && modelUsed === 'pulid',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[generate-thumbnail]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
