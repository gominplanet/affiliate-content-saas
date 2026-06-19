// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
/**
 * Shared Pinterest pin generation — used by /api/blog/pinterest-preview
 * (the editable preview modal, opened from both Library & Social Push
 * and the CC & EPC Campaign pills).
 *
 * Single source of truth so the prompt, banned-word scrubbing, image
 * compositing and compliance text stay consistent everywhere.
 */
import { GoogleGenAI } from '@google/genai'
import { createAnthropicClient } from '@/lib/anthropic'
import { capSocialText, SOCIAL_LIMITS } from '@/lib/social-cap'
import { scrubBanned, BANNED_RULE } from '@/lib/scrub'
import { recordUsage, usageFromAnthropic } from '@/lib/ai-usage'
import { composePin, PIN_OVERLAY_THEME_COUNT } from '@/lib/pin-compose'
import { learnProfileToPrompt } from '@/lib/learn'
import { createAdminClient } from '@/lib/supabase/admin'

export const AFFILIATE_DISCLAIMER = '📌 Disclosure: As an Amazon Associate I earn from qualifying purchases. This post may contain affiliate links — I may earn a small commission at no extra cost to you.'
export const COMPLIANCE_TAGS = '#ad #affiliate'

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY ?? '' })

export interface PinAssets {
  title: string
  description: string
  hashtags: string[]
  disclaimer: string
  complianceTags: string
  link: string
  imageBase64: string | null
  mediaType: string | null
  fallbackImageUrl: string | null
}

/** Compose the exact description that gets published (preview modal and
 *  one-click use this identically): body → hashtags → disclaimer → tags. */
export function composePinDescription(a: PinAssets): string {
  const tagLine = a.hashtags.length ? a.hashtags.map(t => `#${t}`).join(' ') : ''
  return [a.description, tagLine, a.disclaimer, a.complianceTags].filter(Boolean).join('\n\n')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildPinAssets(p: any, ctx: { userId?: string | null; tier?: string | null }): Promise<PinAssets> {
  // Apply the user's LEARN voice profile to the pin copy too (whatever
  // parts they filled in). Best-effort — a fetch failure must not block
  // pin generation.
  let learnBlock = ''
  if (ctx.userId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: bp } = await (createAdminClient() as any)
        .from('brand_profiles').select('learn_profile').eq('user_id', ctx.userId).single()
      learnBlock = learnProfileToPrompt(bp?.learn_profile)
    } catch { /* no voice profile — generate without it */ }
  }

  const anthropic = createAnthropicClient()
  const claudeMsg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are an expert affiliate marketing content strategist. Analyze this blog post and return a JSON object.

${BANNED_RULE}
${learnBlock}

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
  {
    const u = usageFromAnthropic(claudeMsg)
    recordUsage({ userId: ctx.userId, tier: ctx.tier, feature: 'pinterest_text', model: 'claude-haiku-4-5-20251001', input: u.input, output: u.output })
  }

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
      product_category: 'Product', product_name: p.title, emotion: 'excited',
      viral_hook: 'MUST SEE THIS', main_benefit: 'TOP RATED PICK',
      trust_factor: 'EDITOR\'S CHOICE', problem: 'Wasting money on bad products',
      solution: 'The best option found',
    }
  }

  const rawTags: string[] = Array.isArray(parsed.hashtags) ? parsed.hashtags : []
  const fields: Record<string, string> = {
    product_category: parsed.product_category, product_name: parsed.product_name,
    emotion: parsed.emotion, viral_hook: parsed.viral_hook, main_benefit: parsed.main_benefit,
    trust_factor: parsed.trust_factor, problem: parsed.problem, solution: parsed.solution,
  }
  for (const k of Object.keys(fields)) fields[k] = scrubBanned(fields[k])
  const hashtags = rawTags
    .map(t => scrubBanned(String(t)).replace(/[^a-z0-9]/gi, '').toLowerCase())
    .filter(Boolean).slice(0, 8)
  // Never fall back to a raw (unscrubbed) value — keep the banned word out
  // even when the scrubbed string is empty.
  const pinTitle = scrubBanned(parsed.pin_title) || scrubBanned(p.title)
  const pinDescription = scrubBanned(parsed.pinterest_description)
    || `${scrubBanned(p.title)}. See the full breakdown at the link.`

  // Roll a fresh composition + overlay style each generation so pins vary (and
  // re-roll on regenerate). Independent picks → many combinations.
  const sceneVariant = Math.floor(Math.random() * PIN_COMPOSITIONS.length)
  const styleVariant = Math.floor(Math.random() * PIN_OVERLAY_THEME_COUNT)
  const rawImage = await generatePinImage(buildViralImagePrompt(fields, sceneVariant))
  const imageResult = rawImage
    ? await composePin(rawImage.data, rawImage.mediaType, {
        viral_hook: fields.viral_hook, main_benefit: fields.main_benefit, trust_factor: fields.trust_factor,
      }, { styleSeed: styleVariant })
    : null
  if (rawImage) {
    recordUsage({ userId: ctx.userId, tier: ctx.tier, feature: 'pinterest_image', model: 'gemini-2.5-flash-image', images: 1 })
  }

  const fallbackImageUrl = p.featured_image_url || p.thumbnail_url
    || (p.video_id ? `https://i.ytimg.com/vi/${p.video_id}/hqdefault.jpg` : null)

  return {
    title: capSocialText(pinTitle, 100),
    description: capSocialText(pinDescription, SOCIAL_LIMITS.pinterest),
    hashtags,
    disclaimer: AFFILIATE_DISCLAIMER,
    complianceTags: COMPLIANCE_TAGS,
    link: (p.wordpress_url as string | null) || '',
    imageBase64: imageResult?.data ?? null,
    mediaType: imageResult?.mediaType ?? null,
    fallbackImageUrl,
  }
}

// A handful of distinct composition styles so pins don't all look like the same
// before/after split. One is picked at random per generation (and re-rolled on
// regenerate), which is the biggest lever on visual variety.
const PIN_COMPOSITIONS: Array<(f: Record<string, string>) => string> = [
  // 0 — before/after split (the original look)
  f => `A dynamic split-screen before-and-after layout. A charismatic, expressive person (the expert) looks toward camera with a ${f.emotion} expression, gesturing toward the product. Show a clear before-vs-after transformation — before: ${f.problem}; after: ${f.solution} — with ${f.product_name} in real use.`,
  // 1 — single bold hero reaction
  f => `A single bold hero shot: a charismatic person holding ${f.product_name} up toward the camera with a strong ${f.emotion} expression, the product clearly the star, in a clean modern lifestyle setting that fits a ${f.product_category}.`,
  // 2 — authentic lifestyle / in-context
  f => `An authentic lifestyle scene: ${f.product_name} in its natural real-world environment, used as intended for a ${f.product_category}, with a person interacting naturally (slightly off-centre) in a ${f.emotion} mood. Editorial, candid, unposed feel.`,
  // 3 — dramatic product close-up
  f => `A dramatic, crisp close-up of ${f.product_name} filling most of the frame with shallow depth of field; a person softly out of focus in the background reacting with a ${f.emotion} expression. Premium product-photography feel.`,
  // 4 — hands-on / point-of-view
  f => `A hands-on point-of-view scene: human hands actively using ${f.product_name} for a ${f.product_category}, shot slightly top-down, conveying the "${f.solution}" result. Tactile, satisfying, real.`,
  // 5 — flat-lay / styled arrangement
  f => `A clean, styled flat-lay from directly overhead: ${f.product_name} arranged with a few complementary props that suit a ${f.product_category}, on a tasteful surface, bright and aspirational. No people.`,
]

function buildViralImagePrompt(f: Record<string, string>, variant = 0): string {
  const composition = PIN_COMPOSITIONS[variant % PIN_COMPOSITIONS.length](f)
  return `Create a high-energy vertical photographic scene for a ${f.product_category}, 2:3 portrait aspect ratio.

Composition: ${composition}

Visual Style: Vibrant, saturated colors, high-contrast cinematic lighting, modern lifestyle / luxury-tech aesthetic, shallow depth of field so the subject pops. Leave some clean, less-busy space near the TOP and the BOTTOM of the frame (calmer areas, e.g. softer background or gradient) suitable for overlaying text later.

ABSOLUTELY NO TEXT: Do NOT render ANY text, letters, words, numbers, captions, labels, logos, watermarks, signage, UI, badges, stickers, or typography of ANY kind anywhere in the image. It must be a purely photographic scene with zero written characters. (Headline text is added separately afterward.)
NO BRANDS: Do NOT render or invent any retailer/marketplace names or logos (especially "Amazon", "Prime", "Walmart", "eBay"), any company/store logos, watermarks, copyright/trademark symbols, or price tags anywhere — only the product's own physical branding is allowed.

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
