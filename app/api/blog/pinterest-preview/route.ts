import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { GoogleGenAI } from '@google/genai'
import { capSocialText, SOCIAL_LIMITS } from '@/lib/social-cap'
import { scrubBanned, BANNED_RULE } from '@/lib/scrub'
import { composePin } from '@/lib/pin-compose'

export const maxDuration = 60

const AFFILIATE_DISCLAIMER = '📌 Disclosure: As an Amazon Associate I earn from qualifying purchases. This post may contain affiliate links — I may earn a small commission at no extra cost to you. #ad #affiliate #amazonfinds'

// Module-scoped so the top-level generatePinImage() can use it too.
const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY ?? '' })

export async function POST(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { postId } = await request.json()
  if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: post }, { data: integration }] = await Promise.all([
    (supabase as any).from('blog_posts').select('*').eq('id', postId).single(),
    (supabase as any).from('integrations').select('*').eq('user_id', user.id).single(),
  ])

  const p = post as any
  const ig = integration as any

  if (!p) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  if (!ig?.pinterest_access_token) return NextResponse.json({ error: 'Pinterest not connected' }, { status: 400 })
  if (!ig?.pinterest_board_id) return NextResponse.json({ error: 'No Pinterest board selected' }, { status: 400 })

  // Claude fills in Pinterest description + image prompt variables in one call
  const anthropic = createAnthropicClient()
  const claudeMsg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are an expert affiliate marketing content strategist. Analyze this blog post and return a JSON object.

${BANNED_RULE}

Blog post title: ${p.title}
Blog post content (first 500 chars): ${p.excerpt || p.content?.substring(0, 500) || ''}
Blog URL: ${p.wordpress_url}

Return ONLY valid JSON with these exact keys:

{
  "pin_title": "A curiosity-driven, intrigue-building Pinterest pin title. Max 90 characters. Make people NEED to click — open a loop, hint at a surprising result or mistake — but no false claims and no clickbait lies. Do not just restate the blog title.",
  "pinterest_description": "ONE or TWO short, plain sentences (max ~180 chars total) that simply explain what the post is about, ending with a soft CTA like 'See the full breakdown.' No hashtags, no hype, no keyword stuffing.",
  "hashtags": ["6 to 8 short, relevant, SEO + viral hashtags about THIS post's subject. No '#' symbol, lowercase, no spaces, no banned words. e.g. swampcooler, garagecooling, homecoolinghacks"],
  "product_category": "e.g. Face Cream, Vacuum Cleaner, Dog Toy",
  "product_name": "The specific product name from the post",
  "emotion": "One word emotion for the expert in the image: shocked | excited | relieved | disgusted | happy | amazed",
  "viral_hook": "Short all-caps hook for top of image, max 4 words e.g. STOP DOING THIS! or GAME CHANGER!",
  "main_benefit": "Bold center banner text, max 5 words e.g. THE ULTIMATE HACK or IT ACTUALLY WORKS",
  "trust_factor": "Small badge text e.g. TOP RATED or 100% SAFE or #1 PICK",
  "problem": "What the product solves, 3-5 words e.g. Dull aging skin or Dirty car interior",
  "solution": "What it delivers, 3-5 words e.g. Glowing youthful skin or Spotless in minutes"
}`,
    }],
  })

  const raw = (claudeMsg.content[0] as { type: string; text: string }).text.trim()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(jsonMatch?.[0] ?? raw)
  } catch {
    parsed = {
      pin_title: p.title,
      pinterest_description: `${p.title}. See the full breakdown at the link.`,
      hashtags: [],
      product_category: 'Product',
      product_name: p.title,
      emotion: 'excited',
      viral_hook: 'MUST SEE THIS',
      main_benefit: 'TOP RATED PICK',
      trust_factor: 'EDITOR\'S CHOICE',
      problem: 'Wasting money on bad products',
      solution: 'The best option found',
    }
  }

  // Hashtags handled separately (array); the rest are string fields for
  // the image prompt.
  const rawTags: string[] = Array.isArray(parsed.hashtags) ? parsed.hashtags : []
  const fields: Record<string, string> = {
    product_category: parsed.product_category, product_name: parsed.product_name,
    emotion: parsed.emotion, viral_hook: parsed.viral_hook, main_benefit: parsed.main_benefit,
    trust_factor: parsed.trust_factor, problem: parsed.problem, solution: parsed.solution,
  }

  // Last-line-of-defense: strip banned words from EVERY generated value
  // (banned everywhere — prompts and generations alike).
  for (const k of Object.keys(fields)) fields[k] = scrubBanned(fields[k])
  const hashtags = rawTags
    .map(t => scrubBanned(String(t)).replace(/[^a-z0-9]/gi, '').toLowerCase())
    .filter(Boolean)
    .slice(0, 8)
  const pinTitle = scrubBanned(parsed.pin_title) || scrubBanned(p.title) || p.title
  const pinDescription = scrubBanned(parsed.pinterest_description)
    || `${scrubBanned(p.title) || p.title}. See the full breakdown at the link.`

  // Build Gemini image prompt and generate image
  const imagePrompt = buildViralImagePrompt(fields)
  const rawImage = await generatePinImage(imagePrompt)
  // AI makes a clean text-free scene; we render the headline/badge
  // ourselves so text can never be clipped.
  const imageResult = rawImage
    ? await composePin(rawImage.data, rawImage.mediaType, {
        viral_hook: fields.viral_hook,
        main_benefit: fields.main_benefit,
        trust_factor: fields.trust_factor,
      })
    : null

  // Fall back to a real image if Gemini fails — a pin REQUIRES one.
  // Try the stored blog image, then the YouTube thumbnail (always exists
  // for video-derived posts).
  const fallbackImageUrl = p.featured_image_url || p.thumbnail_url
    || (p.video_id ? `https://i.ytimg.com/vi/${p.video_id}/hqdefault.jpg` : null)

  return NextResponse.json({
    // Pinterest title is capped at 100 chars by the API.
    title: capSocialText(pinTitle, 100),
    // Pinterest pin description is hard-capped at 500 chars by the API.
    description: capSocialText(pinDescription, SOCIAL_LIMITS.pinterest),
    hashtags,
    disclaimer: AFFILIATE_DISCLAIMER,
    imageBase64: imageResult?.data ?? null,
    mediaType: imageResult?.mediaType ?? null,
    fallbackImageUrl,
    boardName: ig.pinterest_board_name || ig.pinterest_board_id,
  })
}

function buildViralImagePrompt(f: Record<string, string>): string {
  return `Create a high-energy vertical photographic scene for a ${f.product_category}, 2:3 portrait aspect ratio.

Composition: A dynamic split-screen / before-and-after layout.
The Person: A charismatic, expressive person (the expert) looking toward the camera with a ${f.emotion} expression, gesturing toward the product.
The Product: A crisp, high-definition view of ${f.product_name} in real use, showing a clear before-vs-after transformation — before: ${f.problem}, after: ${f.solution}.

Visual Style: Vibrant, saturated colors, high-contrast cinematic lighting, modern lifestyle / luxury-tech aesthetic, shallow depth of field so the subject pops. Leave some clean, less-busy space near the TOP and the BOTTOM of the frame (calmer areas, e.g. softer background or gradient) suitable for overlaying text later.

ABSOLUTELY NO TEXT: Do NOT render ANY text, letters, words, numbers, captions, labels, logos, watermarks, signage, UI, badges, stickers, or typography of ANY kind anywhere in the image. It must be a purely photographic scene with zero written characters. (Headline text is added separately afterward.)

Final quality: high resolution, photorealistic, professional advertising photography, cinematic post-processing. Vertical 2:3 portrait. Completely text-free.`
}

async function generatePinImage(prompt: string): Promise<{ data: string; mediaType: string } | null> {
  let delay = 8000
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await genai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: prompt,
        config: { responseModalities: ['IMAGE'] },
      })
      const parts = response.candidates?.[0]?.content?.parts
      if (!parts) return null
      for (const part of parts) {
        if (part.inlineData?.data) {
          return { data: part.inlineData.data, mediaType: part.inlineData.mimeType || 'image/png' }
        }
      }
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const isOverloaded = msg.includes('503') || msg.toLowerCase().includes('unavailable') || msg.toLowerCase().includes('high demand')
      if (!isOverloaded || attempt === 4) return null
      await new Promise(r => setTimeout(r, delay))
      delay = Math.min(delay * 2, 30000)
    }
  }
  return null
}
