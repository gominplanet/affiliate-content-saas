import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY })

const AFFILIATE_DISCLAIMER = '📌 Disclosure: As an Amazon Associate I earn from qualifying purchases. This post may contain affiliate links — I may earn a small commission at no extra cost to you. #ad #affiliate #amazonfinds'

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
  const claudeMsg = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are an expert affiliate marketing content strategist. Analyze this blog post and return a JSON object.

Blog post title: ${p.title}
Blog post content (first 500 chars): ${p.excerpt || p.content?.substring(0, 500) || ''}
Blog URL: ${p.wordpress_url}

Return ONLY valid JSON with these exact keys:

{
  "pinterest_description": "Engaging Pinterest description under 300 chars, keyword-rich for SEO, ends with a CTA to click the link. Do NOT include hashtags here.",
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
  let fields: Record<string, string>
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    fields = JSON.parse(jsonMatch?.[0] ?? raw)
  } catch {
    fields = {
      pinterest_description: `${p.title} — Check the link for the full review!`,
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

  // Build Gemini image prompt and generate image
  const imagePrompt = buildViralImagePrompt(fields)
  const imageResult = await generatePinImage(imagePrompt)

  // Fall back to blog thumbnail if Gemini fails
  const fallbackImageUrl = p.featured_image_url || p.thumbnail_url || null

  return NextResponse.json({
    title: p.title,
    description: fields.pinterest_description,
    disclaimer: AFFILIATE_DISCLAIMER,
    imageBase64: imageResult?.data ?? null,
    mediaType: imageResult?.mediaType ?? null,
    fallbackImageUrl,
    boardName: ig.pinterest_board_name || ig.pinterest_board_id,
  })
}

function buildViralImagePrompt(f: Record<string, string>): string {
  return `Create a high-energy vertical 9:16 social media marketing graphic for a ${f.product_category}.

Composition: A dynamic split-screen or multi-layered layout.
The Person: On the left, a charismatic and expressive person (the expert) looking directly at the camera with a ${f.emotion} expression, pointing toward the product.
The Product: On the right, a crisp high-definition close-up of ${f.product_name} being used in action, showing a dramatic before vs. after result — before: ${f.problem}, after: ${f.solution}.

Visual Style: Vibrant, saturated colors with high-contrast lighting. Luxury tech / modern lifestyle aesthetic. Background slightly blurred (bokeh) to make foreground elements pop.

Typography overlays to render on the image:
- TOP HEADER: Bold chunky 3D text in neon yellow/green at the top that reads: "${f.viral_hook}"
- CENTER BANNER: High-contrast white text with slight drop shadow across the middle reading: "${f.main_benefit}"
- BOTTOM BADGE: Small clean sticker-style badge in the lower corner reading: "${f.trust_factor}"

Final quality: 8K resolution, cinematic post-processing, professional advertising photography style. Vertical portrait format, 9:16 aspect ratio.`
}

async function generatePinImage(prompt: string): Promise<{ data: string; mediaType: string } | null> {
  try {
    const response = await genai.models.generateContent({
      model: 'gemini-2.0-flash-preview-image-generation',
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
    return null
  }
}
