import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

// ── Google Generative Language helpers ───────────────────────────────────────
const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta'

async function imagen4(prompt: string, geminiKey: string): Promise<string | null> {
  // Imagen 4 — text-to-image, 16:9, returns base64
  const res = await fetch(
    `${GOOGLE_BASE}/models/imagen-4.0-generate-001:predict?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: '16:9', imageSize: '1K' },
      }),
    }
  )
  const data = await res.json() as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>
    error?: { message: string }
  }
  if (!res.ok || data.error) {
    console.warn('[imagen4] error:', data.error?.message ?? res.status)
    return null
  }
  const b64 = data.predictions?.[0]?.bytesBase64Encoded
  if (!b64) return null
  return `data:image/png;base64,${b64}`
}

async function geminiEditImage(
  prompt: string,
  imageUrl: string,
  geminiKey: string
): Promise<string | null> {
  // Fetch the headshot and convert to base64
  let imageBase64 = ''
  let mimeType = 'image/jpeg'
  try {
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) throw new Error(`Headshot fetch failed: ${imgRes.status}`)
    const ct = imgRes.headers.get('content-type') ?? 'image/jpeg'
    mimeType = ct.split(';')[0].trim()
    const buf = await imgRes.arrayBuffer()
    imageBase64 = Buffer.from(buf).toString('base64')
  } catch (err) {
    console.warn('[geminiEditImage] could not fetch headshot:', err)
    return null
  }

  // gemini-2.5-flash-image — multimodal edit (camelCase keys in REST response)
  const res = await fetch(
    `${GOOGLE_BASE}/models/gemini-2.5-flash-image:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
        }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    }
  )
  const data = await res.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { mimeType: string; data: string } }> }
    }>
    error?: { message: string }
  }
  if (!res.ok || data.error) {
    console.warn('[geminiEditImage] error:', data.error?.message ?? res.status, JSON.stringify(data).slice(0, 300))
    return null
  }
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const imgPart = parts.find(p => p.inlineData?.data)
  if (!imgPart?.inlineData) return null
  return `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`
}

// ── Main route ────────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const geminiKey = process.env.GOOGLE_GEMINI_API_KEY
    const falKey = process.env.FAL_KEY

    if (!geminiKey && !falKey) {
      return NextResponse.json({ error: 'No image generation API key configured' }, { status: 500 })
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

    // ── 1. Brand profile ───────────────────────────────────────────────────────
    const { data: brand } = await supabase
      .from('brand_profiles')
      .select('niches,author_name,headshot_url,tone')
      .eq('user_id', user.id)
      .single()

    const b = brand as Record<string, unknown> | null
    const niches = ((b?.niches as string[]) || []).join(', ') || 'consumer products'
    const headshotUrl = (b?.headshot_url as string) || ''
    const hasHeadshot = !!headshotUrl && includePerson

    // ── 2. Product context ─────────────────────────────────────────────────────
    const productContext = [
      productTitle ? `Product name: ${productTitle}` : `ASIN: ${asin}`,
      productPrice ? `Price: ${productPrice}` : '',
      productRating ? `Rating: ${productRating}/5` : '',
      productBullets?.length
        ? `Key features:\n${productBullets.slice(0, 5).map(b => `  - ${b}`).join('\n')}`
        : '',
      productDescription ? `Product description: ${productDescription}` : '',
    ].filter(Boolean).join('\n')

    const videoContext = videoDescription ? videoDescription.slice(0, 400) : ''

    // ── 3. Claude: product prompt + hook in parallel ───────────────────────────
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const styleInstructions = {
      review:     'dramatic studio hero shot — product centred on a dark gradient background, strong rim lighting, lens flare, volumetric light rays, deep shadows, bokeh reflections',
      unboxing:   'product dramatically emerging from open premium packaging, tissue paper mid-air, warm overhead lighting, light wood surface, excitement and anticipation',
      comparison: 'split-screen showdown — two competing products facing off, cool blue left / warm orange right, glowing neon divider, cinematic depth',
      lifestyle:  'product in a beautiful real-world scene, golden hour sunlight, rich environmental storytelling, foreground slightly blurred, aspirational and cinematic',
    }[style ?? 'review']

    const [msg, hookMsg] = await Promise.all([
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `You are a world-class YouTube thumbnail art director. Write an image generation prompt for a stunning, high-CTR YouTube thumbnail focused on the product.

━━ PRODUCT ━━
${productContext || videoTitle}

━━ VIDEO ━━
Title: "${videoTitle}"
${videoContext ? `Description: "${videoContext}"` : ''}
Niche: ${niches}

━━ STYLE ━━
${styleInstructions}

━━ RULES ━━
- NO people, NO faces
- Product is sole hero, 60-70% of frame width, centred or slightly right
- Photorealistic commercial photography, 4K, ultra-detailed
- Rich saturated colours that pop on mobile
- Dramatic lighting: key + rim + fill — no flat lighting
- NO text, words, letters, or numbers anywhere
- Razor-sharp subject, creamy bokeh background

Write ONLY the prompt. Hyper-specific: exact colours, lighting positions, surface textures, background details. 150-200 words.`,
        }],
      }),
      anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 30,
        messages: [{
          role: 'user',
          content: `Write a 2-3 word ALL-CAPS YouTube thumbnail hook. Rules:
- 2-3 words MAX — short enough to read in 0.5 seconds
- Spark pure curiosity or mild shock — make the viewer NEED to click
- Complete phrase, never ends with a preposition
- No hype words like AMAZING, INCREDIBLE, INSANE
- NEVER use the word HONEST
- End with ? or !

Great examples: "WORTH IT?", "DON'T BUY!", "I WAS WRONG", "ACTUALLY WORKS?", "CHANGED MY MIND", "BIG MISTAKE?", "LIFE CHANGER?", "MUST HAVE?"

Return ONLY the hook text, no quotes, no explanation.

Product: ${productContext.split('\n')[0]}
Video: "${videoTitle}"`,
        }],
      }),
    ])

    const productPrompt = (msg.content[0] as { type: string; text: string }).text.trim()
    const overlayHook = (hookMsg.content[0] as { type: string; text: string }).text.trim().toUpperCase()
    const productLine = productContext.split('\n')[0].replace('Product name: ', '').replace('ASIN: ', '')

    // ── 4. Generate image ──────────────────────────────────────────────────────
    let thumbnailUrl: string | null = null
    let modelUsed = ''
    let headshotUsed = false
    let usedPrompt = productPrompt // what we show in "Copy prompt"

    // ── 4a. Person + product via Gemini multimodal edit ───────────────────────
    if (hasHeadshot && geminiKey) {
      const cleanHeadshotUrl = headshotUrl.split('?')[0]
      console.log('[thumbnail] Trying Gemini multimodal edit, headshot:', cleanHeadshotUrl)

      const editPrompt = `You are creating a YouTube thumbnail from this photo.

STEP 1 — Find the person's FACE in this image. Focus on their face, eyes, and expression.

STEP 2 — Generate a new 16:9 landscape YouTube thumbnail with this exact layout:
LEFT THIRD (0–35% of width): The person from this photo, shown from shoulders up, FACING THE CAMERA, with a wide open-mouth surprised/excited expression, eyebrows raised high, eyes wide open. Preserve their face, hair colour, skin tone and features exactly.
RIGHT TWO-THIRDS (35–100% of width): ${productLine} — large, dramatic, photorealistic commercial product shot with strong studio rim lighting against a dark gradient background.

STEP 3 — Final polish:
- High contrast, vivid colours that pop on a phone screen
- Clean hard edge between the person and product sides
- No text, no words, no numbers anywhere in the image
- Professional YouTube thumbnail quality — looks like a top affiliate channel`

      thumbnailUrl = await geminiEditImage(editPrompt, cleanHeadshotUrl, geminiKey)
      if (thumbnailUrl) {
        modelUsed = 'gemini-2.5-flash-image'
        headshotUsed = true
        usedPrompt = editPrompt
      } else {
        console.warn('[thumbnail] Gemini edit failed, falling through')
      }
    }

    // ── 4b. Product-only via Imagen 4 ─────────────────────────────────────────
    if (!thumbnailUrl && geminiKey) {
      console.log('[thumbnail] Trying Imagen 4')
      thumbnailUrl = await imagen4(productPrompt, geminiKey)
      if (thumbnailUrl) modelUsed = 'imagen-4'
      else console.warn('[thumbnail] Imagen 4 failed, falling through')
    }

    // ── 4c. Flux Schnell fallback (fal.ai) ────────────────────────────────────
    if (!thumbnailUrl && falKey) {
      console.log('[thumbnail] Falling back to Flux Schnell')
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 15_000)
        const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
          method: 'POST',
          headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: productPrompt,
            image_size: 'landscape_16_9',
            num_inference_steps: 4,
            num_images: 1,
            enable_safety_checker: false,
          }),
          signal: ctrl.signal,
        })
        clearTimeout(timer)
        const text = await res.text()
        const data = JSON.parse(text) as { images?: Array<{ url: string }> }
        thumbnailUrl = data.images?.[0]?.url ?? null
        if (thumbnailUrl) modelUsed = 'flux-schnell'
      } catch (err) {
        console.warn('[thumbnail] Flux Schnell failed:', err)
      }
    }

    if (!thumbnailUrl) {
      throw new Error('All image generation methods failed. Check API keys and try again.')
    }

    return NextResponse.json({
      ok: true,
      usesQueue: false,
      thumbnailUrl,
      prompt: usedPrompt,
      overlayHook,
      modelUsed,
      headshotUsed,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[generate-thumbnail]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
