// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Template picker: given a headline + product context, ask Haiku vision to
// (a) pick the best designer template for this content, (b) decompose the
// headline into the parts the template wants (topLine / leading / punch /
// badge / subtitle), and (c) choose a palette that contrasts the base image.
//
// One Haiku call returns everything the orchestrator needs.

import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import type { PickedTemplate, TemplateContent, TemplatePalette } from './types'
import { TEMPLATES } from './templates'

interface PickerInput {
  /** The raw headline to render. Typically the YouTube video title or a
   *  rewritten "thumbnail title" generated upstream. */
  headline: string
  /** Free-text context about the product/topic — helps the picker know
   *  whether a score badge, banner, or selective-word style fits. */
  productContext?: string | null
  /** Optional base image URL (already-generated thumbnail without text).
   *  Haiku vision uses it to choose contrasting text colours and a SAFE
   *  side for the text (i.e. the side OPPOSITE the subject). */
  baseImageUrl?: string | null
  /** Caller for usage tracking. */
  userId: string
  tier: string | null
}

/** Default palette — used if Haiku errors or returns garbage. White text +
 *  bright yellow accent + black outline + canonical red banner. */
const DEFAULT_PALETTE: TemplatePalette = {
  primary: '#FFFFFF',
  accent: '#FFD400',
  outline: '#000000',
  bannerBg: '#E50914',
}

function defaultContent(headline: string): TemplateContent {
  // Pure-mechanical fallback split — last word is the punch, rest is leading.
  // Used when Haiku is unavailable; the punch will still pop because of the
  // accent colour even without a smart split.
  const words = headline.trim().split(/\s+/)
  if (words.length <= 2) return { punch: headline }
  const punchWords = Math.min(2, Math.max(1, Math.floor(words.length / 3)))
  return {
    leading: words.slice(0, words.length - punchWords).join(' '),
    punch: words.slice(words.length - punchWords).join(' '),
  }
}

/**
 * Pick the best template + content split + palette for this headline.
 * Always returns a usable result — falls back to block-display + mechanical
 * split if the Haiku call errors. Never throws.
 */
export async function pickTemplate(input: PickerInput): Promise<PickedTemplate> {
  const headline = (input.headline || '').trim()
  if (!headline) {
    return { templateId: 'block-display', content: { punch: '' }, palette: DEFAULT_PALETTE }
  }

  const templateMenu = TEMPLATES.map(t => `- ${t.id}: ${t.whenToUse}`).join('\n')

  // The Haiku prompt: pick template id + decompose headline + propose palette.
  // Constrained JSON output so we can parse reliably.
  const prompt = `You are designing a YouTube thumbnail. Pick the BEST text template for this headline, decompose the headline into structured parts the template can render, and propose a palette that contrasts the base image (if shown).

HEADLINE: ${JSON.stringify(headline)}
PRODUCT / TOPIC CONTEXT: ${input.productContext ? JSON.stringify(input.productContext) : '(none)'}
${input.baseImageUrl ? 'BASE IMAGE: (attached — use it to pick contrasting colours and the safer side for the text)' : 'BASE IMAGE: (none)'}

AVAILABLE TEMPLATES (id: when to use):
${templateMenu}

RULES:
1. Pick the template whose "when to use" best matches this headline. If unsure, pick "block-display" — it's the safest default.
2. Decompose the headline. Identify the ONE PUNCH word/phrase that should pop (the noun, the verdict, the result — never an article/preposition). Put everything else into "leading" (a short setup) or "topLine" (a tiny line above for context). Long supporting copy goes in "subtitle" (a line below).
3. If the template is "badge-score" OR the headline contains a clear rating/verdict, output a "badge" object: { text: "9/10" or "BUY" or "WORTH IT", subtext: "VERDICT" or "OUT OF 10", iconHint: "check"|"x"|"star"|null }. Otherwise omit "badge" entirely.
4. Palette: text colours that read against the base image. White (#FFFFFF) primary + bright yellow (#FFD400) accent + black (#000) outline is the safe default — vary only if the base image is unusually bright/light (then go darker on outline) or unusually dark on the side the text sits.

Reply with EXACTLY this JSON shape, no prose:
{
  "templateId": "block-display" | "banner-pill" | "badge-score",
  "content": {
    "topLine"?: string,
    "leading"?: string,
    "punch": string,
    "subtitle"?: string,
    "badge"?: { "text": string, "subtext"?: string, "iconHint"?: "check"|"x"|"star"|null }
  },
  "palette": { "primary": "#hex", "accent": "#hex", "outline": "#hex", "bannerBg"?: "#hex" }
}`

  try {
    const client = createAnthropicClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = []
    if (input.baseImageUrl) content.push({ type: 'image', source: { type: 'url', url: input.baseImageUrl } })
    content.push({ type: 'text', text: prompt })
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content }],
    })
    recordAnthropicUsage(resp, { userId: input.userId, tier: input.tier, feature: 'thumbnail_text_picker', model: 'claude-haiku-4-5-20251001' })

    const raw = ((resp.content[0] as { type: string; text: string })?.text || '').trim()
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error('no JSON in picker response')
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))

    // Validate templateId — fall back to block-display if Haiku invented one.
    const validIds = new Set(TEMPLATES.map(t => t.id))
    const templateId = validIds.has(parsed.templateId) ? parsed.templateId : 'block-display'

    // Validate content — at minimum we need a non-empty punch.
    const content_ = parsed.content || {}
    const punch = (content_.punch || '').trim() || defaultContent(headline).punch
    const result: TemplateContent = {
      topLine: content_.topLine?.trim() || undefined,
      leading: content_.leading?.trim() || undefined,
      punch,
      subtitle: content_.subtitle?.trim() || undefined,
      badge: content_.badge && content_.badge.text ? {
        text: String(content_.badge.text).trim(),
        subtext: content_.badge.subtext ? String(content_.badge.subtext).trim() : undefined,
        iconHint: ['check', 'x', 'star'].includes(content_.badge.iconHint) ? content_.badge.iconHint : null,
      } : null,
    }

    // Validate palette — clamp anything invalid to defaults.
    const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9A-Fa-f]{3,8}$/.test(s)
    const palette: TemplatePalette = {
      primary: isHex(parsed.palette?.primary) ? parsed.palette.primary : DEFAULT_PALETTE.primary,
      accent: isHex(parsed.palette?.accent) ? parsed.palette.accent : DEFAULT_PALETTE.accent,
      outline: isHex(parsed.palette?.outline) ? parsed.palette.outline : DEFAULT_PALETTE.outline,
      bannerBg: isHex(parsed.palette?.bannerBg) ? parsed.palette.bannerBg : DEFAULT_PALETTE.bannerBg,
    }

    return { templateId, content: result, palette }
  } catch (e) {
    console.warn('[thumbnail-text-picker] fell back to default', e instanceof Error ? e.message : String(e))
    return {
      templateId: 'block-display',
      content: defaultContent(headline),
      palette: DEFAULT_PALETTE,
    }
  }
}
