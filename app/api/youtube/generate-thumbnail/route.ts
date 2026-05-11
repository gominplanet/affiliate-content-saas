import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { fal } from '@fal-ai/client'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!process.env.FAL_KEY) {
      return NextResponse.json({ error: 'FAL_KEY not configured — add your fal.ai API key in Vercel environment variables' }, { status: 500 })
    }

    const { videoTitle, productTitle, asin, style, imageUrl } = await request.json() as {
      videoTitle: string
      productTitle?: string
      asin?: string
      style?: 'review' | 'unboxing' | 'comparison' | 'lifestyle'
      imageUrl?: string
    }

    // ── 1. Fetch brand profile for context ─────────────────────────────────────
    const { data: brand } = await supabase
      .from('brand_profiles')
      .select('name,niches,tone')
      .eq('user_id', user.id)
      .single()

    const b = brand as Record<string, unknown> | null
    const brandName = (b?.name as string) || 'the channel'
    const niches = ((b?.niches as string[]) || []).join(', ') || 'consumer products'

    // ── 2. Use Claude to write the image prompt ────────────────────────────────
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const styleGuide = {
      review: 'bold product close-up with dramatic lighting, "REVIEW" text overlay, bright contrasting background',
      unboxing: 'product being unboxed, excitement and anticipation, hands and packaging visible',
      comparison: 'split screen style with VS elements, clean product shots on each side',
      lifestyle: 'product in a real-world setting, aspirational lifestyle photography',
    }[style ?? 'review']

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Write a detailed image generation prompt for a YouTube thumbnail.

Video: "${videoTitle}"
Product: ${productTitle || asin || 'the featured product'}
Channel niche: ${niches}
Style: ${styleGuide}

Rules for the prompt:
- Photorealistic, ultra high quality, 4K
- Bright, eye-catching colors (reds, yellows, oranges work well for CTR)
- The product must be the hero/focal point
- No faces or people (avoids uncanny valley)
- Clean professional product photography aesthetic
- Bold visual contrast between subject and background
- Include specific colors, lighting style, and composition

Return ONLY the image generation prompt, nothing else. Max 200 words.`,
      }],
    })

    const imagePrompt = (msg.content[0] as { type: string; text: string }).text.trim()

    // ── 3. Generate the thumbnail with fal.ai Flux ────────────────────────────
    fal.config({ credentials: process.env.FAL_KEY })

    const result = await fal.subscribe('fal-ai/flux/schnell', {
      input: {
        prompt: imagePrompt,
        image_size: { width: 1280, height: 720 },
        num_inference_steps: 4,
        num_images: 1,
        enable_safety_checker: true,
      },
    }) as { images?: Array<{ url: string; width: number; height: number }> }

    const thumbnailUrl = result.images?.[0]?.url
    if (!thumbnailUrl) throw new Error('fal.ai returned no image')

    return NextResponse.json({
      ok: true,
      thumbnailUrl,
      prompt: imagePrompt,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[generate-thumbnail]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
