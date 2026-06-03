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
  /** Optional: caller has already decided which template to use (e.g. the
   *  admin playground's "force template" dropdown). The picker uses this
   *  to DECOMPOSE THE HEADLINE FOR THAT TEMPLATE — each template's
   *  punch/leading/banner/badge fields have different semantics, so the
   *  same headline must be split differently depending on the target. */
  preferredTemplateId?: string | null
}

/** Generic decomposition rules used when the picker is choosing the template
 *  itself (no caller-supplied preference). Optimised for block-display since
 *  that's the most likely choice. */
const GENERIC_DECOMPOSE_RULES = `- Identify the ONE punch word/phrase that should pop visually (the noun, the verdict, the result — never an article or preposition).
- Put everything else into "leading" (the setup before the punch) or "topLine" (a tiny line above for extra context).
- Long supporting copy goes into "subtitle" (a single line below).
- Include a "badge" object only if the template is "badge-score" OR the headline contains a clear rating/verdict ("9/10", "BUY", "SKIP", "WORTH IT").`

/** Template-specific decomposition rules. Each template renders the SAME
 *  field names (punch, leading, topLine, badge, subtitle) differently — for
 *  banner-pill the "leading" goes INSIDE the red banner, for block-display
 *  the "leading" is the white setup ABOVE the yellow punch, etc. Tuning the
 *  decomposition per-template is what makes a force-render actually look
 *  right instead of cross-wiring fields. */
const DECOMPOSE_RULES_BY_TEMPLATE: Record<string, string> = {
  'block-display': `- "punch" = the SINGLE most important word/phrase in the headline (the noun, the brand, the verb that drives the message). It will render in BIG YELLOW LETTERS — keep it short (1-3 words).
- "leading" = the rest of the headline that comes BEFORE the punch. It renders in slightly smaller WHITE LETTERS ABOVE the punch.
- Order matters: leading is read first, then punch as the emphasis. Don't reverse them.
- Skip "topLine" and "subtitle" unless the headline genuinely has extra context.
- Skip "badge" — block-display doesn't render badges.`,

  'banner-pill': `- "punch" = the MAIN HEADLINE STATEMENT, rendered BIG at the top in 1-2 lines (e.g. "FINALLY PERFECT", "WORTH EVERY PENNY"). This is the dominant visual element. Keep it 2-4 words.
- "leading" = a SUPPORTING TAGLINE that goes INSIDE the red banner pill below the punch (e.g. "NAIL IT EVERY TIME", "AFTER 30 DAYS", "REAL TALK", "VERDICT IN"). Must be DIFFERENT copy from the punch.
- If the headline is one continuous statement with NO natural supporting tagline (like "Check This Bag Out"), put the FULL headline as the "punch" and SYNTHESIZE a contextually-appropriate banner tagline yourself ("WORTH BUYING?", "OUR TAKE", "FINAL VERDICT", "AFTER USE", "REAL TALK") — pick what fits the product/topic context.
- Skip "topLine" and "subtitle" — banner-pill doesn't render those.
- Skip "badge".`,

  'badge-score': `- "punch" = the MAIN HEADLINE STATEMENT, rendered big in 1-2 lines (e.g. "WORTH IT?", "AFTER 30 DAYS", "I TRIED IT"). Keep 1-3 words per line.
- "badge" = REQUIRED for this template. Object with { text: the score/verdict in 4-6 chars max ("9/10", "BUY", "SKIP", "5★", "A+"), subtext: optional 1-2 word category ("VERDICT", "RATING", "FINAL"), iconHint: "check"|"x"|"star"|null }.
- If the headline has no explicit score, SYNTHESIZE one from the product context: positive review → "9/10" or "BUY" + iconHint "check"; negative review → "SKIP" + iconHint "x"; comparison → "TOP PICK" + iconHint "star".
- Skip "leading", "topLine", "subtitle".`,

  'dual-color-stack': `- "leading" = the SETUP line (top, will render in WHITE). Short — 2-4 words.
- "punch" = the PAYOFF line (bottom, will render in YELLOW). Short — 2-4 words.
- Together they should form a natural 2-line read like "THIS IS WHY / I LOVE IT" or "AFTER 30 DAYS / IT'S WORTH IT". The split should feel like spoken cadence, not a forced cut.
- Skip "topLine", "subtitle", "badge".`,

  'mega-word': `- "punch" = ONE single explosive word, rendered massive and dominant ("INCREDIBLE", "TERRIBLE", "AMAZING", "FAILED", "WINNER", "FIRE", "BROKE"). Must be ONE word — if the headline can't collapse to one word, this template is the wrong choice (return your closest single-word distillation anyway).
- "leading" = a small caption that sits ABOVE the mega word, 2-5 words ("IS IT WORTH IT?", "AFTER USING IT 30 DAYS", "MY HONEST OPINION:"). Optional but improves the composition when the punch word alone is ambiguous.
- Skip "topLine", "subtitle", "badge".`,

  'brush-highlight': `- "leading" = the setup line, 2-4 words, renders in WHITE handwritten brush above.
- "punch" = the payoff word(s), 1-3 words, renders in WHITE with a coloured highlight pill behind it. The highlight is the visual anchor — pick the most emphatic / surprising part of the headline.
- Together they should read editorial / lifestyle / hand-applied (e.g. "TINY TOOL / BIG CURLS", "ONE BLEND / I'M HOOKED").
- Skip "topLine", "subtitle", "badge".`,

  'stamp-tilt': `- "punch" = a VERDICT WORD that reads naturally as a rubber stamp: "APPROVED", "CERTIFIED", "AVOID", "VERIFIED", "TESTED", "FIRE", "TRASH", "LEGIT". One short word, max two.
- "leading" = optional small line ABOVE the stamp, 2-4 words ("AFTER 30 DAYS:", "OUR TAKE:", "FINAL RULING:"). Helps frame what the stamp is judging.
- If the headline lacks a single verdict word, synthesize one from the product context (positive → "APPROVED"; negative → "AVOID"; neutral → "TESTED").
- Skip "topLine", "subtitle", "badge".`,

  'arrow-pointer': `- "leading" = the setup line above ("LOOK AT THIS", "CHECK OUT", "TINY BUT MIGHTY"), 2-4 words.
- "punch" = the noun/subject the arrow points at, 1-3 words ("BAG", "THIS GADGET", "THE TOOL"). The arrow renders BELOW the text pointing toward the subject in the photo.
- The pairing should feel like a finger physically pointing — leading describes the action, punch names the thing.
- Skip "topLine", "subtitle", "badge".`,

  'burst-pop': `- "punch" = a single LOUD reaction word inside a comic-book starburst: "WOW!", "INSANE!", "NEW!", "EXCLUSIVE!", "BOOM!", "FIRE!", "WAIT!", "OMG!". Must be ONE word — short and punchy.
- "leading" = optional small line ABOVE the starburst, 2-4 words framing the reaction ("YOU WON'T BELIEVE", "AFTER ONE USE", "FIRST IMPRESSIONS:").
- Only use when the headline genuinely warrants comic-book energy — skip for measured/technical content.
- Skip "topLine", "subtitle", "badge".`,

  'price-tag': `- "punch" = the main headline statement, 2-4 words ("WORTH THE COST?", "ONLY $20", "DEAL OF THE WEEK", "PRICE BREAKDOWN").
- "leading" = optional setup line above, 2-3 words.
- "badge" = REQUIRED. The price tag sticker. { text: the price string ("$13.96", "$199", "75% OFF", "FREE"), subtext: optional small label above the price ("TODAY", "AMAZON", "RETAIL", "SALE"), iconHint: null }. Pull the actual price from the product context if available; otherwise estimate from the product type.
- Skip "topLine", "subtitle".`,
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

  // When the caller forces a template, the decomposition rules CHANGE. Each
  // template's punch/leading/banner/badge fields mean different things, so
  // the same headline must be split differently to render well in each.
  const decomposeRules = input.preferredTemplateId
    ? DECOMPOSE_RULES_BY_TEMPLATE[input.preferredTemplateId] || GENERIC_DECOMPOSE_RULES
    : GENERIC_DECOMPOSE_RULES

  // The Haiku prompt: pick template id + decompose headline + propose palette.
  // Constrained JSON output so we can parse reliably.
  const prompt = `You are designing a YouTube thumbnail. ${input.preferredTemplateId ? `The template "${input.preferredTemplateId}" has been chosen — decompose the headline FOR THAT TEMPLATE.` : 'Pick the BEST text template for this headline.'} Decompose the headline into structured parts the template can render, and propose a palette that contrasts the base image (if shown).

HEADLINE: ${JSON.stringify(headline)}
PRODUCT / TOPIC CONTEXT: ${input.productContext ? JSON.stringify(input.productContext) : '(none)'}
${input.baseImageUrl ? 'BASE IMAGE: (attached — use it to pick contrasting colours and the safer side for the text)' : 'BASE IMAGE: (none)'}

${input.preferredTemplateId
  ? `TEMPLATE: ${input.preferredTemplateId} (pre-selected — return this templateId verbatim in your output)`
  : `AVAILABLE TEMPLATES (id: when to use):\n${templateMenu}\n\nPick the template whose "when to use" best matches this headline. If unsure, pick "block-display" — it's the safest default.`
}

DECOMPOSITION RULES FOR ${input.preferredTemplateId ?? 'the chosen template'}:
${decomposeRules}

PALETTE RULES:
- White (#FFFFFF) primary + bright yellow (#FFD400) accent + black (#000) outline is the safe default.
- Only vary if the base image is unusually bright on the text side (then darken outline) or unusually dark (then lighten accent).

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
