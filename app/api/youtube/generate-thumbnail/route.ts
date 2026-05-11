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

    const { videoTitle, productTitle, asin, style } = await request.json() as {
      videoTitle: string
      productTitle?: string
      asin?: string
      style?: 'review' | 'unboxing' | 'comparison' | 'lifestyle'
    }

    // ── 1. Fetch brand profile (includes headshot) ─────────────────────────────
    const { data: brand } = await supabase
      .from('brand_profiles')
      .select('niches,author_name,headshot_url')
      .eq('user_id', user.id)
      .single()

    const b = brand as Record<string, unknown> | null
    const niches = ((b?.niches as string[]) || []).join(', ') || 'consumer products'
    const authorName = (b?.author_name as string) || ''
    const headshotUrl = (b?.headshot_url as string) || ''

    const hasHeadshot = !!headshotUrl

    // ── 2. Claude writes the image prompt ─────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const styleGuide = {
      review: 'bold dramatic product close-up, studio lighting, vivid contrasting background (red, orange, or yellow)',
      unboxing: 'product emerging from open box, excitement and discovery, clean background, dramatic lighting',
      comparison: 'two products side by side with a glowing VS divider, clean minimal background',
      lifestyle: 'product in an aspirational real-world setting, warm cinematic lighting',
    }[style ?? 'review']

    const faceInstruction = hasHeadshot
      ? `- A PERSON (${authorName || 'the presenter'}) is prominently featured showing a genuine reaction — surprised, excited, or pointing directly at the product
- The person takes up roughly 40% of the frame on one side; the product takes up the other 60%
- Facial expression is expressive and high-energy, mouth slightly open, eyes wide
- The person's clothing is casual and relatable`
      : `- NO people, NO faces — product is the sole hero`

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Write an image generation prompt for a YouTube thumbnail.

Product: ${productTitle || asin || videoTitle}
Video title: "${videoTitle}"
Niche: ${niches}
Style: ${styleGuide}

Compose the thumbnail so it:
${faceInstruction}
- Has bright, saturated colors that pop on YouTube (reds, yellows, oranges)
- Is photorealistic, ultra detailed, 4K quality
- Has NO text, NO words, NO letters anywhere
- Uses cinematic depth of field
- Has clean professional composition

Return ONLY the image prompt. Max 150 words.`,
      }],
    })

    const imagePrompt = (msg.content[0] as { type: string; text: string }).text.trim()

    // ── 3. Generate image ─────────────────────────────────────────────────────
    let thumbnailUrl: string | null = null
    let lastError = ''
    let modelUsed = ''

    // ── 3a. If headshot exists → use PuLID (face-consistent generation) ───────
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
          const images = data.images as Array<{ url: string }> | undefined
          thumbnailUrl = images?.[0]?.url ?? null
          if (thumbnailUrl) modelUsed = 'pulid'
        } else {
          lastError = `PuLID ${res.status}: ${JSON.stringify(data).slice(0, 150)}`
          console.warn('[generate-thumbnail] PuLID failed, falling back:', lastError)
        }
      } catch (err) {
        lastError = `PuLID error: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    // ── 3b. Flux Schnell — no headshot, or PuLID failed ────────────────────────
    if (!thumbnailUrl) {
      for (const model of ['fal-ai/flux/schnell', 'fal-ai/flux-schnell']) {
        try {
          const res = await fetch(`https://fal.run/${model}`, {
            method: 'POST',
            headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: imagePrompt,
              image_size: 'landscape_16_9',
              num_inference_steps: 4,
              num_images: 1,
              enable_safety_checker: false,
            }),
          })
          const data = await res.json() as Record<string, unknown>
          if (!res.ok) {
            lastError = `${model} ${res.status}: ${JSON.stringify(data).slice(0, 150)}`
            break
          }
          const images = data.images as Array<{ url: string }> | undefined
          thumbnailUrl = images?.[0]?.url ?? null
          if (thumbnailUrl) { modelUsed = model; break }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
        }
      }
    }

    // ── 3c. Replicate fallback ─────────────────────────────────────────────────
    if (!thumbnailUrl && process.env.REPLICATE_API_TOKEN) {
      try {
        const startRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
            'Content-Type': 'application/json',
            Prefer: 'wait=30',
          },
          body: JSON.stringify({
            input: { prompt: imagePrompt, aspect_ratio: '16:9', num_outputs: 1, output_format: 'jpg' },
          }),
        })
        const pred = await startRes.json() as { output?: string[]; urls?: { get: string } }
        if (startRes.ok && pred.output?.[0]) {
          thumbnailUrl = pred.output[0]
          modelUsed = 'replicate/flux-schnell'
        } else if (startRes.ok && pred.urls?.get) {
          await new Promise(r => setTimeout(r, 4000))
          const pollRes = await fetch(pred.urls.get, {
            headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` },
          })
          const pollData = await pollRes.json() as { output?: string[] }
          thumbnailUrl = pollData.output?.[0] ?? null
          if (thumbnailUrl) modelUsed = 'replicate/flux-schnell'
        } else {
          lastError = `Replicate ${startRes.status}: ${JSON.stringify(pred).slice(0, 150)}`
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
