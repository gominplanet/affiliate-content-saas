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

    // ── 1. Fetch brand profile ─────────────────────────────────────────────────
    const { data: brand } = await supabase
      .from('brand_profiles')
      .select('niches')
      .eq('user_id', user.id)
      .single()

    const b = brand as Record<string, unknown> | null
    const niches = ((b?.niches as string[]) || []).join(', ') || 'consumer products'

    // ── 2. Claude writes the image prompt ─────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const styleGuide = {
      review: 'bold dramatic product close-up shot, studio lighting with rim light, vibrant contrasting background (red, orange, or yellow), professional product photography',
      unboxing: 'product emerging from open box with packaging, excitement and discovery feel, clean white or gradient background, dramatic lighting',
      comparison: 'two products side by side with a glowing VS divider, clean minimal background, equal dramatic lighting on both',
      lifestyle: 'product in a real-world aspirational setting, natural lifestyle photography, warm cinematic lighting',
    }[style ?? 'review']

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Write a detailed image generation prompt for a YouTube thumbnail.

Product: ${productTitle || asin || videoTitle}
Video: "${videoTitle}"
Niche: ${niches}
Style: ${styleGuide}

Requirements:
- Photorealistic product photography, 4K ultra detailed
- NO text, NO words, NO letters in the image
- NO people, NO faces
- The product is the clear hero/focal point
- Bright saturated colors that pop on YouTube
- ${styleGuide}
- Cinematic depth of field
- Clean professional composition

Return ONLY the image prompt, nothing else. Max 150 words.`,
      }],
    })

    const imagePrompt = (msg.content[0] as { type: string; text: string }).text.trim()

    // ── 3. Generate with fal.ai REST API (more reliable than SDK in serverless) ─
    // Try flux-schnell first, fall back to fast-sdxl
    const models = [
      'fal-ai/flux/schnell',
      'fal-ai/flux-schnell',
      'fal-ai/fast-sdxl',
    ]

    let thumbnailUrl: string | null = null
    let lastError = ''

    for (const model of models) {
      try {
        const res = await fetch(`https://fal.run/${model}`, {
          method: 'POST',
          headers: {
            Authorization: `Key ${falKey}`,
            'Content-Type': 'application/json',
          },
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
          lastError = `${model} → ${res.status}: ${JSON.stringify(data).slice(0, 200)}`
          console.error('[generate-thumbnail]', lastError)
          continue
        }

        const images = data.images as Array<{ url: string }> | undefined
        thumbnailUrl = images?.[0]?.url ?? null
        if (thumbnailUrl) break
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        continue
      }
    }

    if (!thumbnailUrl) {
      throw new Error(`All fal.ai models failed. Last error: ${lastError}`)
    }

    return NextResponse.json({ ok: true, thumbnailUrl, prompt: imagePrompt })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[generate-thumbnail]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
