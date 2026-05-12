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
    const hasHeadshot = !!headshotUrl

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

    const headshotInstruction = hasHeadshot
      ? `
IMPORTANT — PERSON IN FRAME: ${authorName} must appear in the LEFT THIRD of the image.
- Big open-mouth reaction: shocked, excited, or amazed expression
- Eyebrows raised high, eyes wide open, finger pointing at the product OR hand on cheek
- Casual relatable clothing, natural skin tones
- Person fills roughly 35-40% of the total frame width
- Product occupies the RIGHT 60-65% of the frame, dramatically lit
- Classic YouTube split thumbnail composition
- The person's face must be clear, well-lit, and front-facing`
      : `NO people or faces — product drama only`

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are a world-class YouTube thumbnail art director. Create a Flux image generation prompt that will produce a stunning, high-CTR YouTube thumbnail.

━━ PRODUCT CONTEXT ━━
${productContext || videoTitle}

━━ VIDEO CONTEXT ━━
Title: "${videoTitle}"
${videoContext ? `Description excerpt: "${videoContext}"` : ''}
Niche: ${niches}

━━ VISUAL STYLE ━━
${styleInstructions}

━━ COMPOSITION ━━
${headshotInstruction}

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

    const imagePrompt = (msg.content[0] as { type: string; text: string }).text.trim()

    // ── 4. Generate image ─────────────────────────────────────────────────────
    let thumbnailUrl: string | null = null
    let lastError = ''
    let modelUsed = ''

    // ── 4a. PuLID when headshot available (face-consistent generation) ─────────
    if (hasHeadshot) {
      try {
        const res = await fetch('https://fal.run/fal-ai/pulid', {
          method: 'POST',
          headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: imagePrompt,
            reference_images: [{ image_url: headshotUrl }],
            image_size: 'landscape_16_9',
            num_inference_steps: 20,
            num_images: 1,
          }),
        })
        const data = await res.json() as Record<string, unknown>
        if (res.ok) {
          thumbnailUrl = (data.images as Array<{ url: string }>)?.[0]?.url ?? null
          if (thumbnailUrl) modelUsed = 'pulid'
        } else {
          lastError = `PuLID ${res.status}: ${JSON.stringify(data).slice(0, 200)}`
          console.warn('[generate-thumbnail] PuLID failed, falling back to Flux:', lastError)
        }
      } catch (err) {
        lastError = `PuLID: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    // ── 4b. Flux Dev (higher quality than Schnell) ─────────────────────────────
    if (!thumbnailUrl) {
      for (const model of ['fal-ai/flux/dev', 'fal-ai/flux/schnell']) {
        try {
          const isSchnell = model.includes('schnell')
          const res = await fetch(`https://fal.run/${model}`, {
            method: 'POST',
            headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: imagePrompt,
              image_size: 'landscape_16_9',
              num_inference_steps: isSchnell ? 4 : 28,
              guidance_scale: isSchnell ? undefined : 3.5,
              num_images: 1,
              enable_safety_checker: false,
            }),
          })
          const data = await res.json() as Record<string, unknown>
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

    // ── 4c. Replicate fallback ─────────────────────────────────────────────────
    if (!thumbnailUrl && process.env.REPLICATE_API_TOKEN) {
      try {
        const startRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
            'Content-Type': 'application/json',
            Prefer: 'wait=60',
          },
          body: JSON.stringify({
            input: {
              prompt: imagePrompt,
              aspect_ratio: '16:9',
              num_outputs: 1,
              output_format: 'jpg',
              output_quality: 95,
              guidance: 3.5,
              num_inference_steps: 28,
            },
          }),
        })
        const pred = await startRes.json() as { output?: string[]; urls?: { get: string } }
        thumbnailUrl = pred.output?.[0] ?? null
        if (thumbnailUrl) modelUsed = 'replicate/flux-dev'
        else if (pred.urls?.get) {
          await new Promise(r => setTimeout(r, 6000))
          const poll = await fetch(pred.urls.get, { headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` } })
          const pollData = await poll.json() as { output?: string[] }
          thumbnailUrl = pollData.output?.[0] ?? null
          if (thumbnailUrl) modelUsed = 'replicate/flux-dev'
        }
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
