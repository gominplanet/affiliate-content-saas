import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createAnthropicClient } from '@/lib/anthropic'
import { fetchAmazonProduct } from '@/services/amazon'
import { resolveProductReference } from '@/lib/resolve-product-reference'
import { verifyProductMatch } from '@/lib/product-image'
import { asinFromAmazonUrl } from '@/lib/product-link'
import { rememberProductImageFromUrl } from '@/lib/product-image-memory'
import { createOpenAIService, normalizeToPng } from '@/services/openai'
import { fal } from '@fal-ai/client'
import sharp from 'sharp'
import { recordAnthropicUsage, recordUsage } from '@/lib/ai-usage'
import { TIERS, nextTierFor, normalizeTier, type Tier } from '@/lib/tier'
import { pooledDesignCap, freeTrialImageBlock, freeTrialExpiredBlock, freeTrialWindow } from '@/lib/free-trial'
import { accountSignupISO } from '@/lib/free-trial-signup'
import { spendGate } from '@/lib/ai-spend'
import { checkUsageCap, PRIMARY_FEATURE } from '@/lib/usage-cap'
import { pickBestFrame } from '@/lib/thumbnail-score'
import { stripDesignBrands } from '@/lib/image-guard'
import { getOrCreateBriefs } from '@/lib/art-director-cache'
import { rehostToFal } from '@/lib/thumbnail-generators'
import { bakeSimpleHeadline, compositeBadgeOnly, type ThumbDecoration } from '@/lib/thumbnail-simple-bake'
import { scrubBanned, hasHealthClaim } from '@/lib/scrub'
import { detectWearable, wearDirective } from '@/lib/wear-product'
import { normalizeExpression, expressionDirective, expressionDescription, EXPRESSION_LABEL, politeSmileIsWrong } from '@/lib/face-expression'
import { parseGarmentVerdict, parseVerdict, GARMENT_CHECK_PROMPT, expressionCheckPrompt, type GarmentVerdict } from '@/lib/garment-match'
import { resolvePreset, presetToBriefRules, parsePresetIds, pickPresetId } from '@/lib/visual-presets'
import { buildGraphicThumbnailPrompt } from '@/lib/thumbnail-prompt'
import { buildExpressionPortraitPrompt } from '@/lib/expression-portrait'
import { FACE_BOX_PROMPT, parseFaceBox, headCropRect, headCropNote } from '@/lib/head-crop'
import {
  normalizeFraming, normalizeBuild, normalizeHeight, resolveFraming, framingLine, framingNote,
  type EffectiveFraming,
} from '@/lib/body-framing'
import { fetchStoryboardFrames } from '@/lib/youtube-storyboards'

// Telemetry context — populated at request start, read by the three
// Anthropic helpers below so each call is tagged with the right user/tier.
let TELEMETRY: { userId: string | null; tier: string | null } = { userId: null, tier: null }

/**
 * Fit a rendered graphic to the final delivered size. gpt-image only renders a
 * 2:3 portrait, so a 9:16 story can't be filled without cropping the left/right
 * edges — which clips headlines and logos. For the tall story we therefore show
 * the FULL design (no crop) over a blurred, darkened, full-bleed copy of itself
 * (the standard IG-story look), guaranteeing nothing is lost. Every other format
 * (4:5 IG, pin, landscape) is close enough that a centred cover-crop is clean.
 */
async function fitFinalGraphic(b64: string, outW: number, outH: number, isStory: boolean): Promise<Buffer> {
  const src = Buffer.from(b64, 'base64')
  if (isStory) {
    const bg = await sharp(src).resize(outW, outH, { fit: 'cover', position: 'centre' }).blur(28).modulate({ brightness: 0.6 }).toBuffer()
    const fg = await sharp(src).resize(outW, outH, { fit: 'inside' }).toBuffer()
    return sharp(bg).composite([{ input: fg, gravity: 'centre' }]).jpeg({ quality: 92 }).toBuffer()
  }
  return sharp(src).resize(outW, outH, { fit: 'cover', position: 'centre' }).jpeg({ quality: 92 }).toBuffer()
}

// 300s (Vercel Pro max). A face thumbnail runs the gpt-image cut-out and the
// product scene; we run them in parallel, but gpt-image high quality alone can
// take ~60s, so give generous headroom.
export const maxDuration = 300

// ── Retry wrapper for Anthropic overloaded (529) errors ──────────────────────
async function withAnthropicRetry<T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let delay = 3000
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const status = (err as Record<string, unknown>)?.status as number | undefined
      const msg = err instanceof Error ? err.message : String(err)
      // 2026-06-08: retry on transient upstream failures, not just 529 overloaded.
      // The Anthropic SDK's InternalServerError surfaces as `.message = "Internal
      // Server Error"` and `.status = 500` — the previous regex only caught 529
      // overloaded, so a brief Claude 500 bubbled raw to the user (same bug fix
      // 61f7bc8 applied to /api/blog/generate; this is the twin route).
      const lower = msg.toLowerCase()
      const isTransient = status === 529 || status === 500 || status === 502 || status === 503
        || lower.includes('overloaded')
        || lower.includes('internal server error')
        || /\b5\d\d\b/.test(msg)
      if (!isTransient || attempt === maxAttempts) {
        if (isTransient) throw new Error('Claude AI is temporarily unavailable (upstream returned ' + (status || '5xx') + '). Please retry in a moment.')
        throw err
      }
      console.warn(`[anthropic-retry] transient (status=${status ?? '?'}, msg=${msg.slice(0, 80)}), attempt ${attempt}/${maxAttempts}, waiting ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
      delay = Math.min(delay * 1.5, 15000)
    }
  }
  throw new Error('Claude AI is temporarily unavailable — please try again in a moment.')
}

// ── Thumbnail copy framework (2026-06-08) ──────────────────────────────────
// Structured 2-line thumbnail copy with a tagged emphasis word. Replaces the
// old "single 2-3 word string" hooks that were producing literal descriptions
// like "WATCH THIS / FOOT PEEL MASK" — high text visibility, zero click
// psychology. The 4-angle framework is from a Gemini-handoff doc the user
// validated against their own thumbnail wins:
//   - NEGATION: tell the viewer to STOP doing something normal
//   - CURIOSITY_GAP: hint at a secret nobody mentions
//   - SKEPTIC: validate the viewer's "is this BS?" suspicion
//   - VALUE_DISRUPTION: compare cost/value to a much pricier alternative
// Per-variant rotation cycles through angles so a 3-thumb batch covers 3
// distinct emotional buttons instead of three rephrasings of the same idea.
type CtrAngle = 'NEGATION' | 'CURIOSITY_GAP' | 'SKEPTIC' | 'VALUE_DISRUPTION'
interface ThumbCopy {
  angle: CtrAngle
  /** Top line. Hard cap 15 chars. */
  line1: string
  /** Bottom line. Hard cap 20 chars. */
  line2: string
  /** The ONE word (or short phrase) inside line1+line2 to render in YELLOW.
   *  Lets the baked prompt + canvas overlay both pick out the same highlight
   *  without guessing. Falls back to the most loaded word if the model
   *  returned junk. */
  emphasisWord: string
  /** Visual decoration drawn below the text block. Picked by the Haiku model
   *  based on the angle/content energy; falls back to the angle-default mapping
   *  if the model omits it. */
  decoration?: ThumbDecoration
}

// Natural decoration for each angle — ensures 4 distinct decorations in a
// 4-variant batch when the model doesn't suggest one.
const ANGLE_DECORATION: Record<CtrAngle, ThumbDecoration> = {
  NEGATION: 'check',          // problem solved ✓
  CURIOSITY_GAP: 'arrow',     // pointing at the hidden thing
  SKEPTIC: 'none',            // skeptical / clean
  VALUE_DISRUPTION: 'stars',  // 5-star value signal
}

/** Flatten to a single "LINE1 LINE2" string for legacy callers (overlay
 *  draw, response payload, picker UI). Strips Gemini-style * markers. */
/** Cap a headline line to `max` characters WITHOUT chopping a word in half.
 *  A blind slice turned "ACTUALLY TRACK ALL THAT???" into "…ALL THA"; this trims
 *  back to the last whole word instead (keeping any trailing ?/! on it), so the
 *  baked headline never shows a broken word. Falls back to a hard slice only when
 *  a single word is itself longer than the cap. */
function clampLine(s: string, max: number): string {
  const t = (s || '').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace >= Math.floor(max / 2) ? cut.slice(0, lastSpace) : cut).trim()
}

function flatCopy(c: ThumbCopy | string | null | undefined): string {
  if (!c) return ''
  // Scrub here too — flatCopy feeds the overlay-text draw + response payload,
  // and string-typed hooks bypass the per-line scrub in parseThumbCopy.
  if (typeof c === 'string') return stripDesignBrands(scrubBanned(c))
  return stripDesignBrands(scrubBanned(`${c.line1} ${c.line2}`.replace(/\*/g, '').trim()))
}

const ANGLE_DEFS: Record<CtrAngle, string> = {
  NEGATION: 'Tell the viewer to STOP doing something normal/wasteful that the product replaces. Examples: "NEVER USE | CANDLES AGAIN!" · "STOP BUYING | THESE FOREVER" · "QUIT WASTING | MONEY ON THIS". Emphasis word is usually "NEVER" / "STOP" / "QUIT".',
  CURIOSITY_GAP: 'Hint at a secret, an unspoken truth, or a singular missing piece of info. Examples: "THE *ONE* THING | NOBODY TELLS YOU" · "WHY EVERYONE | IS WRONG" · "THE SECRET | THEY HIDE". Emphasis word is usually "ONE" / "SECRET" / "WHY".',
  SKEPTIC: 'Attack the product up front to spike drama and force the click to see if it\'s vindicated. Examples: "WASTE OF | MONEY?!" · "BIGGEST SCAM | OF 2026?" · "DON\'T BELIEVE | THE HYPE". Emphasis word is usually "WASTE" / "SCAM" / "DON\'T".',
  VALUE_DISRUPTION: 'Compare the item to a much pricier/different category to make it look like an insane life-hack. Examples: "CHEAPER THAN | YOUR LATTE!" · "BEATS A $300 | GADGET?" · "$20 vs $200 | NO CONTEST". Emphasis word is usually "CHEAPER" / "BEATS" / the dollar amount.',
}

/**
 * Parse one Haiku JSON response into a clean ThumbCopy. Tolerates the model
 * occasionally returning code fences, extra prose, or fields with extra
 * whitespace. Falls back to a NEGATION default on total junk so the caller
 * never has to handle null.
 */
function parseOneCopy(raw: string, fallbackAngle: CtrAngle): ThumbCopy {
  const text = raw.trim()
  const objMatch = text.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try {
      const o = JSON.parse(objMatch[0]) as Partial<ThumbCopy>
      const angle = (o.angle as CtrAngle) || fallbackAngle
      // Scrub banned words — this headline gets BAKED into the image, so a
      // banned word can't be fixed after render. (The "never HONEST" rule.)
      const line1 = clampLine(stripDesignBrands(scrubBanned(String(o.line1 || '').trim())).toUpperCase(), 18)
      const line2 = clampLine(stripDesignBrands(scrubBanned(String(o.line2 || '').trim())).toUpperCase(), 26)
      const emphasis = stripDesignBrands(scrubBanned(String(o.emphasisWord || '').trim())).toUpperCase()
      const VALID_DECORATIONS = new Set<ThumbDecoration>(['stars', 'check', 'arrow', 'none'])
      const decoration = VALID_DECORATIONS.has(o.decoration as ThumbDecoration) ? (o.decoration as ThumbDecoration) : undefined
      if (line1 && line2) return { angle, line1, line2, emphasisWord: emphasis || line1.split(' ')[0], decoration }
    } catch { /* fall through */ }
  }
  return { angle: fallbackAngle, line1: 'WORTH IT?', line2: 'WATCH FIRST', emphasisWord: 'WORTH' }
}

// ── Claude Haiku: single ThumbCopy (kept for callers that want just one) ────
async function generateHook(videoTitle: string, productContext = '', claimsSheet = ''): Promise<string> {
  const c = await generateThumbCopy(videoTitle, 'NEGATION', productContext, claimsSheet)
  return flatCopy(c)
}

// ── Claude Haiku: distil the video transcript into a compact "claims sheet" ──
// The thumbnail copy was only ever grounded in the TITLE + the product listing,
// so a video could emphasise one thing while the title (and thus the thumbnail)
// emphasised another. This pulls the most click-worthy TRUE specifics the
// creator actually said — concrete numbers, the exact problem named, the
// standout moment — as raw material the angle generator anchors on. Best-effort:
// any failure returns '' and the caller falls back to title+product only.
async function distillThumbnailClaims(transcript: string): Promise<string> {
  const t = (transcript || '').trim()
  if (t.length < 80) return ''
  const anthropic = createAnthropicClient()
  try {
    const msg = await withAnthropicRetry(() => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 220,
      system: 'You extract the most click-worthy TRUE specifics a creator said in a product video, as raw material for a thumbnail headline. Output 3 to 6 ultra-short bullet lines, no preamble, no markdown. Capture: concrete numbers / specs / times / counts the creator stated; the EXACT problem they named; the single standout feature or moment they reacted most strongly to; any surprising result. ONLY what is actually in the transcript — never invent. No hashtags, no marketing fluff, no banned words.',
      messages: [{ role: 'user', content: `TRANSCRIPT:\n${t.slice(0, 6000)}\n\nReturn the bullet lines only.` }],
    }))
    recordAnthropicUsage(msg, {
      userId: TELEMETRY.userId, tier: TELEMETRY.tier,
      feature: 'yt_thumb_claims', model: 'claude-haiku-4-5-20251001',
    })
    return scrubBanned((msg.content[0] as { type: string; text: string }).text || '').trim()
  } catch {
    return ''
  }
}

// System prompt sets the model's PERMANENT identity for every copy call.
// Copied near-verbatim from the user's Gemini handoff (2026-06-08) — the
// "data-driven YouTube Growth Engineer" role + "CRITICAL COGNITIVE
// CONSTRAINTS" framing gave their successful Gemini run its discipline.
// Putting these rules in a system prompt (not the user message) makes them
// non-negotiable to the model — user-message rules read as suggestions
// the model can soften under task pressure.
const THUMBNAIL_COPY_SYSTEM_PROMPT = `You are a data-driven YouTube Growth Engineer. Your sole job is to generate ultra-short, high-contrast text overlays for video thumbnails.

MEANING FIDELITY — HIGHEST PRIORITY, overrides punchiness:
- The overlay MUST carry the SAME core message + intent as the video title. NEVER invert, contradict, or change what the title promises.
- The pictured PRODUCT is the HERO / the SOLUTION. The thumbnail shows the product, so "THIS", "THIS THING", "THESE", "IT" all point AT the product. NEVER write a phrase that makes the product the object of a problem, regret, conflict, or loss (e.g. implying people fight over it, waste money on it, or should avoid it) — the ONLY exception is the SKEPTIC angle, which frames doubt as a QUESTION the video answers.
- When the title describes a problem the product SOLVES (screens, mess, boredom, pain, chores), attack THAT problem — never the product.

GROUND IN THE REAL PRODUCT — anti-invention rule:
- The problem you negate / tease / question MUST be one this specific product actually addresses, drawn from the TITLE or the PRODUCT description provided. NEVER invent a generic problem the product has nothing to do with. (E.g. for a fast-heating handheld steam cleaner that replaces 6 products, valid angles attack WAITING to heat up, SCRUBBING, CHEMICALS, or owning 6 SEPARATE TOOLS — "clutter" is NOT something it solves, so it's forbidden.)
- Prefer anchoring on a CONCRETE claim from the source: a number, a time, a count, a weight ("HEATS IN 3 SEC", "REPLACES 6 TOOLS", "NO MORE SCRUBBING"). Specifics out-click vague vibes.
- If the source names no clear "old problem," do NOT manufacture one — use CURIOSITY_GAP or SKEPTIC instead.

CRITICAL COGNITIVE CONSTRAINTS:
1. DESIGN BUDGET LIMITS: Line 1 must be under 15 characters. Line 2 must be under 20 characters. If text runs longer, it fails mobile glanceability.
2. NO LITERAL TITLES: Never use the product's actual model name or dry technical labels (no "FOOT PEEL MASK", "OIL DIFFUSER", "MONEY COUNTER", brand names). Use emotional placeholders: "THIS HACK", "THE SECRET", "VIRAL TRICK", "THIS THING" — but the placeholder must read as the SOLUTION/hero, NEVER as the thing being criticised, fought over, or regretted.
3. EMBED PSYCHOLOGICAL TRIGGERS: Every generation must strictly commit to ONE of four click-through profiles — ALWAYS while preserving the title's meaning:
   - NEGATION: Kill the OLD problem/habit the product replaces — negate the PROBLEM named in the title, NOT the product ("NO MORE / SCREEN WARS", "NEVER / SCRUB AGAIN"). NEVER "NEVER [verb] THIS" where THIS is the product.
   - CURIOSITY_GAP: Intentionally hide the main subject ("THE *ONE* TOY / THAT ENDS IT").
   - SKEPTIC: Challenge value as a QUESTION the video then answers ("WORTH IT?!", "TOO GOOD / TO BE TRUE?").
   - VALUE_DISRUPTION: Contrast it against a completely different premium lifestyle luxury ("CHEAPER THAN / DAYCARE!").
4. SEMANTIC TAGGING: Isolate exactly ONE high-impact emphasis word per variation. Output it explicitly as emphasisWord so the styling layer can paint it Yellow (#FFE034) while the rest renders white.
5. ALL CAPS. Use punctuation (! ?) only when it adds emotional weight.
6. BANNED WORDS (never use): amazing, incredible, insane, honest, "watch this", "check this", "review of".
7. NEVER make health, medical, or results claims ("cures", "weight loss", "results in 7 days", "before/after").

WORKED EXAMPLE (meaning fidelity):
TITLE: "Your Kids Will Stop Fighting Over Screens the Day You Get This 6-in-1 Trampoline"
- Product = the trampoline (HERO / the solution). Problem the title names = screens / kids fighting over screen time.
- CORRECT NEGATION → line1 "NO MORE", line2 "SCREEN WARS" (negates the PROBLEM).
- CORRECT CURIOSITY_GAP → line1 "THE TOY THAT", line2 "ENDS SCREEN TIME".
- WRONG → "NEVER FIGHT / OVER THIS AGAIN" — here "THIS" is the pictured trampoline, so it says kids fight over the PRODUCT: the exact OPPOSITE of the title. Forbidden.

OUTPUT FORMAT: Return a strictly structured JSON block with: angle, line1, line2, emphasisWord, decoration. No prose, no preamble, no markdown fences — just the JSON object.

decoration: ONE visual element drawn beneath the text. Match to angle + product energy:
- "stars" → 5 gold stars. Best for VALUE_DISRUPTION or a strong quality/approval signal.
- "check" → green checkmark. Best for NEGATION (problem solved / approved).
- "arrow" → red curved arrow pointing toward the subject/product. Best for CURIOSITY_GAP.
- "none" → clean text only. Best for SKEPTIC or when energy is understated.\``

async function generateThumbCopy(videoTitle: string, angle: CtrAngle, productContext = '', claimsSheet = ''): Promise<ThumbCopy> {
  const anthropic = createAnthropicClient()
  try {
    const msg = await withAnthropicRetry(() => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: THUMBNAIL_COPY_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `VIDEO: "${videoTitle}"${productContext ? `\n\nPRODUCT (what it actually is + the real problems it solves — anchor the overlay here, do NOT invent unrelated problems):\n${productContext.slice(0, 700)}` : ''}${claimsSheet ? `\n\nWHAT THE CREATOR ACTUALLY SAID IN THIS VIDEO (the strongest grounding — prefer these REAL spoken specifics: numbers, the exact problem, the standout moment. The overlay must reflect what the video is genuinely about, not a generic angle):\n${claimsSheet.slice(0, 600)}` : ''}
ANGLE TO USE: ${angle}

Generate the thumbnail copy now. Output the JSON object only.`,
      }],
    }))
    recordAnthropicUsage(msg, {
      userId: TELEMETRY.userId, tier: TELEMETRY.tier,
      feature: 'yt_thumb_copy_v2', model: 'claude-haiku-4-5-20251001',
    })
    return parseOneCopy((msg.content[0] as { type: string; text: string }).text || '', angle)
  } catch {
    return parseOneCopy('', angle)
  }
}

// Order angles are rotated through when we need N variants. NEGATION first
// because it's the highest-tested click pattern; CURIOSITY_GAP next because
// it works on every category. SKEPTIC + VALUE_DISRUPTION cover follow-ups.
const ANGLE_ROTATION: CtrAngle[] = ['NEGATION', 'CURIOSITY_GAP', 'SKEPTIC', 'VALUE_DISRUPTION']

async function generateThumbCopies(videoTitle: string, count: number, productContext = '', claimsSheet = ''): Promise<ThumbCopy[]> {
  const n = Math.max(1, Math.min(10, Math.floor(count)))
  // Fan out across angles in parallel — each call is a separate JSON-shape
  // generation, easier and more reliable than asking Haiku to return an
  // array of mixed-angle objects in one go.
  const out = await Promise.all(
    Array.from({ length: n }, (_, i) => generateThumbCopy(videoTitle, ANGLE_ROTATION[i % ANGLE_ROTATION.length], productContext, claimsSheet)),
  )
  return out
}

// ── ART DIRECTOR: bespoke per-product design brief (the ChatGPT trick) ──────
// The reason a plain "make me a viral thumbnail" prompt to ChatGPT one-shots
// a great result is that a REASONING model designs it first — it studies the
// product, picks a palette + layout + headline + callouts that fit THAT
// product, then briefs the image model. We were skipping that and sending
// gpt-image one fixed template for every product, so it fell back to its safe
// default (flat white/yellow caps). This runs that missing art-direction step:
// one Sonnet call returns N distinct, product-specific design briefs. gpt-image
// then renders each brief instead of guessing.
interface ThumbBrief extends ThumbCopy {
  /** 2–4 sentences describing the whole look for THIS product: background,
   *  composition, colour palette, title styling, mood. The creative core. */
  concept: string
  /** Named colour direction (e.g. "deep purple + hot-pink accents, white type"). */
  palette: string
  /** 2–3 short real-feature callouts/specs to render as badges/checklist. */
  callouts: string[]
  /** 1–3 word starburst badge naming one real benefit ("SO SOFT"), or ''. Used
   *  when the creator turns on the auto Badge toggle without typing one. */
  badge: string
  /** Optional short banner phrase for a brush-stroke banner ("GAME CHANGER!"), or ''. */
  banner: string
  /** Content-fitting facial reaction for the creator (e.g. "wide-eyed shocked",
   *  "delighted grin", "skeptical raised eyebrow"). Drives expression VARIETY so
   *  every thumbnail isn't the same look. '' → the render picks. */
  expression: string
  /** Body pose / gesture (e.g. "pointing at the product", "arms crossed",
   *  "holding it up", "thumbs up"). Varies so it isn't always the pointing pose. */
  pose: string
}

const ART_DIRECTOR_SYSTEM = `You are a world-class YouTube thumbnail ART DIRECTOR for product-review channels. You brief an image model that renders your design.

__PRESET_RULES__

Every brief below must sit inside that house look. It is the creator's own choice and it outranks any instinct you have about what a thumbnail should be.

For the product given, output N_BRIEFS DISTINCT design briefs — each a different creative take (different palette, layout, headline approach), the way you'd pitch a few options. Ground every choice in the REAL product (its category, brand colours, standout feature, specs). Never invent specs.

Each brief has:
- line1 / line2: the headline, split into two short punchy lines (line1 ≤ 15 chars, line2 ≤ 20 chars), ALL CAPS. VARY the approach across briefs — product-descriptive ("KERATIN HAIR CARE", "22\" 144Hz MONITOR"), bold benefit ("SALON-SMOOTH HAIR"), curiosity, or a negation of the real problem. Do NOT make every headline a "NO MORE ___" negation — mix it up like a real designer. No brand model numbers as the whole headline.
- emphasisWord: the ONE word in the headline to accent in a bright colour.
- banner: a SHORT extra punch phrase for a hand-painted banner ("GAME CHANGER!", "SO POWERFUL!", "WORTH IT?!"), or "" if it doesn't need one.
- badge: a 1–3 word starburst badge naming ONE real benefit or spec from the product details, ALL CAPS, punchy ("SO SOFT", "MAX POWER!", "400 TC", "WHISPER QUIET"). Must be DIFFERENT from the banner and from every callout. Correctly spelled.
- palette: the colour direction, tuned to the product/brand (e.g. "deep purple gradient, hot-pink + white type" for a beauty product; "black + electric-orange, F1 energy" for a McLaren blender). Avoid defaulting to plain yellow-on-black every time.
- callouts: 2–3 SHORT real benefit/spec callouts drawn from the product details (e.g. "SMOOTHER", "144Hz", "NOISE REDUCTION"). Correctly spelled, a few words each.
- concept: 2–4 sentences describing the finished thumbnail — the background (vivid studio gradient, themed graphic scene, or real-life setting that suits the product), the composition, how the title is styled (which words pop, banner placement), and the mood. This is what the image model builds. Make it specific to THIS product, and make it look designed and premium, never flat.
- expression: the creator's facial REACTION, chosen to fit THIS headline/product — and VARIED across the briefs so they don't all look the same. Pick the emotion the video earns: e.g. "wide-eyed shocked", "delighted open-mouth grin", "skeptical raised eyebrow", "amazed wow face", "excited eyebrows-up", "curious intrigued look", "confident smirk", "thrilled laughing". A "worth it?" angle → skeptical; a big deal/benefit → excited or amazed. Two to four words.
- pose: the creator's body/gesture, also VARIED (not always pointing): e.g. "pointing at the product", "holding the product up", "arms crossed, confident", "thumbs up", "hand on chin, thinking", "open-handed presenting". Match it to the expression. Two to five words.

HARD RULE (non-negotiable): NEVER put the word "Amazon" (or "Prime", "Amazon Prime") anywhere in line1, line2, emphasisWord, callouts, banner, or concept. Never describe the Amazon smile / swoosh arrow logo. The design must never name or draw the retailer. Lead with the product's real category, standout feature, or benefit instead.

ANTI-CLICHÉ (non-negotiable): do NOT default to overused, generic hype phrases for the headline OR the banner. NEVER use "HIDDEN GEM", "GAME CHANGER", "GAME-CHANGING", "MUST-HAVE", "YOU NEED THIS", "LIFE CHANGING", "OBSESSED", "VIRAL". These are banned. Every brief's headline and banner must be SPECIFIC to THIS product — its category, its standout feature, a real benefit, a number/spec, or the problem it solves — and genuinely VARIED from brief to brief. Write like a designer who never repeats themselves.

OUTPUT: a strict JSON array of N_BRIEFS objects with keys line1, line2, emphasisWord, banner, badge, palette, callouts (array of strings), concept, expression, pose. No prose, no markdown fences — just the JSON array.`

// Curiosity-question override for the art-director briefs: every headline
// becomes a short question, with a matching facial reaction, and hard-bans the
// money/price/buy/amazon/"game changer" angles.
const QUESTION_DIRECTIVE = `HEADLINE STYLE — CURIOSITY QUESTION (this overrides the headline guidance above): For EVERY brief, line1 + line2 must together form ONE short, punchy QUESTION about THIS product's real claim, effect, taste/feel, quality or result — the kind that makes someone need to click to find the answer. Examples of the vibe: fish oil → "ANY FISHY" / "AFTERTASTE?"; a supplement → "DOES THIS" / "ACTUALLY WORK???"; a shaver → "IS IT REALLY" / "THAT CLOSE?"; a blender → "CAN IT CRUSH" / "FROZEN FRUIT?". NEVER name a body effect, condition or symptom, not even as the question: "DOES IT BURN FAT???", "BOOST YOUR ENERGY?" and "SUPPORTS TESTOSTERONE?" are all forbidden. Ask about the PRODUCT (does it work, is it worth it, what does it taste like, how does it compare), never about what it does to a body. End with a question mark ("?" or "???"). Set each brief's "expression" to a reaction that MATCHES its question — skeptical, doubtful, unsure, curious/intrigued, or wide-eyed surprised — so the face sells the question. The "banner" may be a short question or "".
BANNED IN THE QUESTION (non-negotiable): NEVER mention money, price, cost, "cheap", "expensive", value, "worth it", "amazon", "purchase", or "buy"/"buying"/"bought"/"should I buy", and NEVER "game changer". Ask about performance, results, taste/feel, quality or living up to the hype — never about price or buying.`

// Banned words for question headlines (mirrors art-director-pin.ts BANNED_Q).
const BANNED_Q_THUMB = /\b(money|price|pricing|priced|cost|costs|costly|cheap|cheaper|expensive|amazon|purchase|purchasing|buy|buys|buying|bought|worth\s+(?:it|the)|game[-\s]?changer)\b/i

async function designThumbnailBriefs(input: {
  /** The brand's chosen look. The art director writes INSIDE it, because a
   *  brief written loud cannot be rendered quiet, and the concept path is the
   *  normal one. See lib/visual-presets.ts. */
  presetId?: string | null
  count: number
  videoTitle: string
  productTitle?: string
  productBrand?: string
  productContext?: string
  claimsSheet?: string
  lockedHeadline?: string | null
  noHuman?: boolean
  headlineStyle?: 'statement' | 'question'
  /** Where the product is worn, when the creator asked to be shown in it. The
   *  art director has to know, or it writes a concept that stages the garment
   *  on a hanger beside them and the render dutifully obeys the concept. */
  wornOn?: string | null
  /** The expression the creator chose. Same reason: the brief names a reaction
   *  of its own, and with the Question style it is told to make that reaction
   *  skeptical. A concept describing a doubtful face beats a directive asking
   *  for an excited one, because the concept is the thing the render follows. */
  fixedExpression?: string | null
}): Promise<ThumbBrief[]> {
  const n = Math.max(1, Math.min(5, Math.floor(input.count)))
  const fixedExpression = (input.fixedExpression || '').trim()
  const isQuestion = input.headlineStyle === 'question'
  const anthropic = createAnthropicClient()
  const clampBrief = (o: Record<string, unknown>, i: number): ThumbBrief => {
    let l1 = clampLine(stripDesignBrands(scrubBanned(String(o.line1 || '').trim())).toUpperCase(), 18)
    let l2 = clampLine(stripDesignBrands(scrubBanned(String(o.line2 || '').trim())).toUpperCase(), 26)
    // Health claims are checked on the PAIR, not line by line. The headline is
    // split across two lines by design, so "DOES THIS" / "BOOST YOUR ENERGY???"
    // hides the verb on one line and the subject on the other: each half passes
    // on its own, and scrubbing them separately would leave a dangling "DOES
    // THIS" on the thumbnail. The whole headline has to go. This shipped once,
    // on a beef organ supplement, and went out to the creator's Facebook page.
    if (hasHealthClaim(`${l1} ${l2}`)) {
      if (isQuestion) { l1 = 'DOES IT'; l2 = 'ACTUALLY WORK?' }
      else { l1 = 'WHAT YOU'; l2 = 'ACTUALLY GET' }
    }
    // Question mode: enforce the banned-word rule; fall back to a safe generic
    // question if the model slipped a money/buy/amazon angle in.
    if (isQuestion && BANNED_Q_THUMB.test(`${l1} ${l2}`)) { l1 = 'DOES IT'; l2 = 'ACTUALLY WORK?' }
    const calls = Array.isArray(o.callouts)
      ? (o.callouts as unknown[]).filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map(c => stripDesignBrands(scrubBanned(c.trim())).slice(0, 28)).filter(Boolean).slice(0, 3)
      : []
    return {
      angle: ANGLE_ROTATION[i % ANGLE_ROTATION.length],
      line1: l1,
      line2: l2,
      emphasisWord: stripDesignBrands(scrubBanned(String(o.emphasisWord || '').trim())).toUpperCase().slice(0, 24),
      decoration: 'none', // gpt-image bakes its own callouts; skip the composited badge
      concept: String(o.concept || '').trim().slice(0, 900),
      palette: String(o.palette || '').trim().slice(0, 160),
      callouts: calls,
      banner: stripDesignBrands(scrubBanned(String(o.banner || '').trim())).slice(0, 40),
      badge: clampLine(stripDesignBrands(scrubBanned(String(o.badge || '').trim())).toUpperCase(), 18),
      // The creator's pick wins even if the model ignored the rule above.
      expression: fixedExpression || String(o.expression || '').trim().slice(0, 60),
      pose: String(o.pose || '').trim().slice(0, 60),
    }
  }
  const userMsg = [
    `VIDEO TITLE: "${input.videoTitle}"`,
    input.productTitle ? `PRODUCT: ${input.productTitle}` : '',
    input.productBrand ? `BRAND: ${input.productBrand}` : '',
    input.productContext ? `PRODUCT DETAILS (features / specs — ground callouts here, do NOT invent):\n${input.productContext.slice(0, 900)}` : '',
    input.claimsSheet ? `WHAT THE CREATOR SAID IN THE VIDEO (strongest grounding):\n${input.claimsSheet.slice(0, 500)}` : '',
    input.lockedHeadline ? `REQUIRED HEADLINE (use these exact words for every brief's line1+line2, just split + style them): "${input.lockedHeadline}"` : '',
    input.noHuman ? 'PRODUCT-ONLY (hard rule): these designs must contain NO people at all. Do NOT reference a person, model, hands, or anyone using the product in the concept, callouts or banner. The concept centers on the PRODUCT itself. Leave expression and pose empty.' : '',
    input.fixedExpression ? `EXPRESSION IS FIXED (hard rule, overrides every other instruction about reactions, including the headline-style guidance): the creator chose ${input.fixedExpression}. Set every brief's "expression" field to exactly that, and make sure NOTHING in the concept, banner or callouts describes them reacting any other way. Do not write a doubtful or skeptical face into the concept unless that IS the chosen expression.` : '',
    input.wornOn ? `WORN (hard rule): the creator is WEARING this product — it is ${input.wornOn}. Every concept shows it on them. Never describe it held up, presented in a hand, laid out, floating, on a hanger, on a mannequin or on a stand, and never put a second copy of it anywhere in the design. Write "pose" as how they stand or move while wearing it, never as a gesture holding it.` : '',
    '',
    `Design ${n} distinct briefs now. Output the JSON array only.`,
  ].filter(Boolean).join('\n')
  try {
    const msg = await withAnthropicRetry(() => anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1600,
      system: ART_DIRECTOR_SYSTEM
        .replace(/N_BRIEFS/g, String(n))
        .replace('__PRESET_RULES__', presetToBriefRules(resolvePreset(input.presetId)))
        + (isQuestion ? `\n\n${QUESTION_DIRECTIVE}` : ''),
      messages: [{ role: 'user', content: userMsg }],
    }))
    recordAnthropicUsage(msg, {
      userId: TELEMETRY.userId, tier: TELEMETRY.tier,
      feature: 'yt_thumb_art_director', model: 'claude-sonnet-4-6',
    })
    const raw = (msg.content[0] as { type: string; text?: string }).text || ''
    const jsonStart = raw.indexOf('[')
    const jsonEnd = raw.lastIndexOf(']')
    const arr = jsonStart >= 0 && jsonEnd > jsonStart
      ? (JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>[])
      : []
    const briefs = arr.slice(0, n).map(clampBrief).filter(b => b.line1 || b.line2)
    if (briefs.length > 0) return briefs
  } catch { /* fall through to the copy-only fallback below */ }
  // Question mode fallback: the statement copy generator below writes CTR
  // headlines (one angle is money/price framing) and applies NO banned-word
  // check, so using it here would silently drop the question style AND could
  // ship a banned price headline. Return safe, varied generic questions instead
  // — honors the toggle and can never emit a banned word.
  if (isQuestion) {
    const SAFE_Q: Array<{ line1: string; line2: string; expression: string }> = [
      { line1: 'DOES IT', line2: 'ACTUALLY WORK?', expression: 'skeptical raised eyebrow' },
      { line1: 'IS IT', line2: 'ANY GOOD?', expression: 'curious intrigued look' },
      { line1: 'DOES IT', line2: 'REALLY WORK?', expression: 'doubtful unsure' },
      { line1: 'DOES IT', line2: 'LIVE UP?', expression: 'wide-eyed surprised' },
      { line1: 'LEGIT', line2: 'OR HYPE?', expression: 'skeptical raised eyebrow' },
    ]
    return Array.from({ length: n }, (_, i): ThumbBrief => {
      const q = SAFE_Q[i % SAFE_Q.length]
      return {
        angle: ANGLE_ROTATION[i % ANGLE_ROTATION.length],
        line1: q.line1, line2: q.line2, emphasisWord: '',
        decoration: 'none', concept: '', palette: '', callouts: [], banner: '', badge: '',
        expression: input.noHuman ? '' : q.expression, pose: '',
      }
    })
  }
  // Statement-mode fallback: reuse the existing headline generator so the graphic
  // path still gets valid line1/line2 and just uses the static brief.
  const copies = await generateThumbCopies(input.videoTitle, n, input.productContext, input.claimsSheet)
  return copies.map<ThumbBrief>(c => ({ ...c, concept: '', palette: '', callouts: [], banner: '', badge: '', expression: '', pose: '' }))
}

// (generatePersonScenePrompt removed 2026-05-22 with the flux-lora retirement —
//  the face path is now gpt-image-1/2 with the creator's reference photos.)

// ── Claude Haiku vision: extract aesthetic from a style reference image ─────
// User uploads any image they like the look of (a competitor thumbnail, a
// moodboard pic, one of their own previous wins). We distill it into a
// short style brief that gets folded into the scene prompt — color
// palette, lighting, composition, mood. Cheap (~$0.005/call).

/**
 * Ask a cheap vision model whether the render put the RIGHT garment on.
 *
 * Runs only on apparel designs with "make me wear it" on, which is the only
 * place this failure happens, and costs a fraction of a cent against the $0.19
 * of the render it is guarding. Generating three variants and picking would
 * cost $0.38 extra on EVERY apparel thumbnail to fix something already right
 * about half the time; this pays for a second render only on the ones that
 * were actually wrong.
 *
 * Fails open in every direction: no product photo, a refusal, a timeout, a
 * hedge, a malformed answer — all keep the render. The only outcome that costs
 * a creator money is an explicit DIFFERENT.
 */

/**
 * Does the generated portrait actually wear the expression that was asked for?
 *
 * This is the cheapest check in the pipeline and it guards the most. The design
 * step copies the face it is handed, so a portrait that came back with the
 * polite smile these models default to produces a thumbnail with a polite
 * smile, whatever the creator picked — which is exactly the failure that took
 * an afternoon to find, because nobody could see the intermediate image.
 *
 * A fraction of a cent to look, against $0.06 to render it again. Fails open:
 * anything other than an explicit DIFFERENT keeps the portrait.
 */
async function portraitShowsExpression(opts: {
  portraitPng: Buffer | Uint8Array
  label: string
  description: string
  /** Whether a closed-mouth smile counts as a failure for THIS expression. It
   *  does not for Confident, whose correct answer is a closed-lip smirk. */
  politeSmileIsWrong: boolean
}): Promise<GarmentVerdict> {
  try {
    const anthropic = createAnthropicClient()
    const msg = await withAnthropicRetry(() => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: [
          { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: Buffer.from(opts.portraitPng).toString('base64') } },
          { type: 'text' as const, text: expressionCheckPrompt(opts.label, opts.description, opts.politeSmileIsWrong) },
        ],
      }],
    }))
    recordAnthropicUsage(msg, {
      userId: TELEMETRY.userId, tier: TELEMETRY.tier,
      feature: 'yt_thumb_expression_check', model: 'claude-haiku-4-5-20251001',
    })
    return parseVerdict((msg.content[0] as { type: string; text?: string })?.text)
  } catch (e) {
    console.warn('[expression-check] skipped:', e instanceof Error ? e.message : e)
    return { match: null, reason: 'check unavailable' }
  }
}

async function garmentMatchesProduct(opts: {
  productPng: Buffer | Uint8Array
  renderB64: string
}): Promise<GarmentVerdict> {
  try {
    const anthropic = createAnthropicClient()
    const productB64 = Buffer.from(opts.productPng).toString('base64')
    const msg = await withAnthropicRetry(() => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: [
          { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: productB64 } },
          { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: opts.renderB64 } },
          { type: 'text' as const, text: GARMENT_CHECK_PROMPT },
        ],
      }],
    }))
    recordAnthropicUsage(msg, {
      userId: TELEMETRY.userId, tier: TELEMETRY.tier,
      feature: 'yt_thumb_garment_check', model: 'claude-haiku-4-5-20251001',
    })
    const first = msg.content[0] as { type: string; text?: string }
    return parseGarmentVerdict(first?.text)
  } catch (e) {
    // Never let the guard break the thing it is guarding.
    console.warn('[garment-check] skipped:', e instanceof Error ? e.message : e)
    return { match: null, reason: 'check unavailable' }
  }
}

/**
 * Take the creator's own clothes out of an identity reference.
 *
 * Only used when the product is WORN. The design step treats the reference
 * selfies as the identity lock and reproduces what it sees in them, clothing
 * included, which is how a creator whose selfie shows a plain pale polo kept
 * getting a plain pale polo in place of the navy cable-knit one in the product
 * photo. No sentence fixes that. Removing the competing photograph does.
 *
 * A cheap vision call for the face box, then a crop at the base of the neck.
 * Fails open in the only direction that is safe: any failure returns the
 * original photo, because feeding in a badly cropped face would break the
 * identity lock that is the whole point of the reference.
 */
async function headAndNeckCrop(png: Buffer | Uint8Array): Promise<{ bytes: Buffer | Uint8Array; cropped: boolean }> {
  try {
    const src = Buffer.from(png)
    const meta = await sharp(src).metadata()
    const W = meta.width ?? 0
    const H = meta.height ?? 0
    if (!W || !H) return { bytes: png, cropped: false }

    // ASK THE QUESTION OF A SMALL COPY. This is the only place in the pipeline
    // that would otherwise hand a vision model a raw creator selfie, and a phone
    // selfie normalised to PNG runs to several megabytes before base64 adds a
    // third on top. The other two checks send an Amazon thumbnail and a
    // generated 1024px portrait, which is why they never hit this. A face box is
    // returned in fractions of the frame, so it applies to the full-resolution
    // original unchanged and nothing is lost by asking about a small JPEG.
    const probe = await sharp(src)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()

    const anthropic = createAnthropicClient()
    const msg = await withAnthropicRetry(() => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: [
          { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: probe.toString('base64') } },
          { type: 'text' as const, text: FACE_BOX_PROMPT },
        ],
      }],
    }))
    recordAnthropicUsage(msg, {
      userId: TELEMETRY.userId, tier: TELEMETRY.tier,
      feature: 'yt_thumb_head_crop', model: 'claude-haiku-4-5-20251001',
    })

    // Each failure gets its own line. "Could not be cropped" covers a refusal, a
    // box the parser rejected and a face too small to use, and those need
    // different fixes, so the log has to say which one happened.
    const box = parseFaceBox((msg.content[0] as { type: string; text?: string })?.text)
    if (!box) {
      console.warn('[head-crop] no usable face box:', String((msg.content[0] as { text?: string })?.text ?? '').slice(0, 160))
      return { bytes: png, cropped: false }
    }
    const rect = headCropRect(box, W, H)
    if (!rect) {
      console.warn(`[head-crop] face too small to crop: box=${JSON.stringify(box)} image=${W}x${H}`)
      return { bytes: png, cropped: false }
    }

    let img = sharp(src).extract(rect)
    // A crop is by definition smaller than what it came from, and a small face
    // is a weak identity lock. Put the long edge back up to something the
    // renderer can actually read a face out of.
    if (Math.max(rect.width, rect.height) < 768) {
      img = img.resize(768, 768, { fit: 'inside', withoutEnlargement: false })
    }
    return { bytes: await img.png().toBuffer(), cropped: true }
  } catch (e) {
    console.warn('[head-crop] skipped:', e instanceof Error ? e.message : e)
    return { bytes: png, cropped: false }
  }
}
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

/** The WARDROBE directive for the composed-scene prompts. When the creator pinned
 *  a wardrobe on their face (e.g. "a white lab coat"), keep that exact outfit in
 *  every thumbnail; otherwise re-dress them in a fresh everyday outfit as before. */
function wardrobeDirective(pinned?: string | null): string {
  const p = (pinned || '').trim()
  return p
    ? `WARDROBE (required): use the reference photos for the face and identity, and dress the creator in ${p} — keep this EXACT outfit in every thumbnail; do NOT substitute a different top, colour or style.`
    : `WARDROBE: use the reference photos ONLY for the face and identity — dress the creator in a FRESH, natural, casual everyday outfit (e.g. a plain tee, casual shirt, polo or light sweater) that suits the scene. Do NOT copy the exact clothing, top or colour shown in the reference photos; vary it.`
}

/**
 * Auto-pick the right face model for a video by vision-comparing the video
 * frame to one reference photo from each model (e.g. Seb vs Michelle). One
 * cheap Haiku call. Returns the matching model, or null if none clearly match.
 */
async function matchFaceModelToFrame<T extends { name: string; source_images: string[] }>(
  frameUrl: string,
  models: T[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ctx: { userId: string | null; tier: string | null },
): Promise<T | null> {
  if (models.length === 0) return null
  if (models.length === 1) return models[0]
  const valid = models
    .map(m => {
      try { return { m, url: supabase.storage.from('headshots').getPublicUrl(m.source_images[0]).data.publicUrl as string } }
      catch { return null }
    })
    .filter((x): x is { m: T; url: string } => !!x?.url)
  if (valid.length === 0) return models[0]
  try {
    const anthropic = createAnthropicClient()
    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: `Image 1 is a still from a video showing the on-camera host. Each following image is a reference photo of a DIFFERENT person, numbered 1 to ${valid.length}. Which reference photo shows the SAME human as the host in image 1? Reply with ONLY that number, or 0 if none clearly match.` },
      { type: 'image', source: { type: 'url', url: frameUrl } },
    ]
    valid.forEach((v, i) => {
      content.push({ type: 'text', text: `Reference ${i + 1}:` })
      content.push({ type: 'image', source: { type: 'url', url: v.url } })
    })
    const msg = await withAnthropicRetry(() => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: content as any }],
    }))
    recordAnthropicUsage(msg, { userId: ctx.userId, tier: ctx.tier, feature: 'yt_thumb_face_match', model: 'claude-haiku-4-5-20251001' })
    const txt = (msg.content[0] as { type: string; text: string }).text || ''
    const n = parseInt(txt.match(/\d+/)?.[0] || '0', 10)
    if (n >= 1 && n <= valid.length) return valid[n - 1].m
  } catch { /* fall through — no match */ }
  return null
}

/**
 * A portrait of the creator ALREADY WEARING the expression they picked.
 *
 * Six renders in a row came back with the same squint through three different
 * chosen expressions, and no amount of prompt wording moved it. The reason is
 * structural, not textual: the design model is handed the creator's own selfies
 * as its identity reference and told they are the highest-priority thing in the
 * brief. It copies the face in the photograph. The expression is IN the
 * photograph. A sentence asking for a different one is a sentence arguing with
 * a picture, and the picture wins every time — which is the same instinct that
 * keeps a creator recognisable, so it is not a bug to be shouted down.
 *
 * So stop arguing. Make a picture that agrees.
 *
 * This renders one new portrait from the creator's selfies wearing the chosen
 * expression, and the design step then uses THAT as its reference. The identity
 * lock now works for us: it faithfully copies a face that is already smiling.
 *
 * Costs one extra image call, so it only ever runs when a creator has actually
 * picked something. Best-effort: on any failure the caller keeps the original
 * selfies and the design comes out exactly as it does today.
 */
async function generateExpressionPortrait(opts: {
  refs: Array<{ data: Buffer | Uint8Array; filename: string; mime: string }>
  /** Built by lib/expression-portrait, where it can be read and tested. */
  promptText: string
  imageModel?: string
}): Promise<Uint8Array | null> {
  if (!opts.refs.length) return null
  try {
    const openai = createOpenAIService()
    const prompt = opts.promptText

    const b64 = await openai.generateWithReferences({
      prompt, images: opts.refs, size: '1024x1024', quality: 'medium',
      ...(opts.imageModel ? { model: opts.imageModel } : {}),
    })
    if (!b64) return null
    return await normalizeToPng(new Uint8Array(Buffer.from(b64, 'base64')))
  } catch (e) {
    console.warn('[expression-portrait] failed, using the original selfies:', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * What the wrapper needs in order to remember the rendered image against the
 * product. Filled in as the handler resolves them, because the handler has
 * more than one success return (the designed thumbnail and the product-only
 * one) and patching each return individually is how the next one added
 * silently stops saving.
 */
interface ImageMemo {
  db: SupabaseLike | null
  userId: string | null
  /** The ASIN the SERVER resolved, not the one the client guessed. */
  asin: string | null
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any

/**
 * POST /api/youtube/generate-thumbnail
 *
 * Wrapper around the renderer. Its only job is the product-image memory: when
 * MVP makes an image for a product, remember it against that product so every
 * other composer can offer it back (lib/product-image-memory).
 *
 * Saving here rather than at "Apply to YouTube" is deliberate and was a bug
 * fix: keying off the apply step meant a creator who generated a thumbnail and
 * did not push it to YouTube got nothing remembered, which is most of the time.
 * MVP made the image; MVP should remember it.
 */
export async function POST(request: Request) {
  // Read the flag off a CLONE — the handler still needs the body stream.
  let defer = false
  try {
    const peek = await request.clone().json() as { deferImageMemory?: boolean }
    defer = peek?.deferImageMemory === true
  } catch { /* unreadable body is the handler's problem, not ours */ }

  const memo: ImageMemo = { db: null, userId: null, asin: null }
  const res = await generateThumbnail(request, memo)

  // YouTube Co-Pilot defers: this route returns the TEXT-FREE base image and
  // the browser bakes the headline on afterwards (addTextOverlay). Saving here
  // would remember a thumbnail without the creator's title on it — the one
  // image they never chose. The client saves the finished one instead.
  if (defer) return res
  if (res.status !== 200 || !memo.db || !memo.userId || !memo.asin) return res
  let body: Record<string, unknown>
  try {
    body = await res.clone().json() as Record<string, unknown>
  } catch {
    return res
  }
  const url = (Array.isArray(body.thumbnailUrls) ? body.thumbnailUrls[0] : null) || body.thumbnailUrl
  if (typeof url !== 'string' || !url) return res

  const saved = await rememberProductImageFromUrl({
    db: memo.db, userId: memo.userId, asin: memo.asin, imageUrl: url,
    surface: 'YouTube Co-Pilot',
    modelUsed: typeof body.modelUsed === 'string' ? body.modelUsed : null,
  })
  // Report the result, not the attempt. `savedForProduct` is the ASIN it is now
  // filed under, or null — a screen that says "saved" for a write that did not
  // happen is the failure this repo keeps re-finding.
  return NextResponse.json({ ...body, savedForProduct: saved ? memo.asin : null }, { status: 200 })
}

// ── Main route ────────────────────────────────────────────────────────────────
async function generateThumbnail(request: Request, memo: ImageMemo) {
  try {
    // ── SERVICE MODE ──────────────────────────────────────────────────────
    //
    // The launch-batch worker calls this route internally, off nobody's
    // request, to build the thumbnails for a batch the creator set up and then
    // walked away from. Same shared-secret pattern the generation-job runner
    // already uses for /api/blog/generate: the secret proves it is us, and the
    // header says whose account to bill and read from.
    //
    // THIS ROUTE, NOT A SECOND ONE. The batch used to call a much simpler
    // builder of its own, which is exactly why a batch thumbnail had none of
    // the options Launchpad has had for months. Two generators meant two looks
    // from one product, and only one of them could be styled.
    const svcSecret = request.headers.get('x-mvp-service')
    const isServiceCall = !!svcSecret
      && !!process.env.CRON_SECRET
      && svcSecret === process.env.CRON_SECRET
    const svcUser = isServiceCall ? (request.headers.get('x-mvp-service-user') || '') : ''
    if (isServiceCall && !svcUser) {
      return NextResponse.json({ error: 'Service call missing identity' }, { status: 400 })
    }

    const supabase = isServiceCall
      ? (createAdminClient() as unknown as Awaited<ReturnType<typeof createServerClient>>)
      : await createServerClient()
    const user = isServiceCall
      ? { id: svcUser }
      : (await supabase.auth.getUser()).data.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    memo.db = supabase
    memo.userId = user.id

    // Tier + billing window for usage-cap check + telemetry.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await supabase
      .from('integrations')
      .select('tier,subscription_period_start,subscription_period_end,amazon_associates_tag')
      .eq('user_id', user.id)
      .single()
    const tier = normalizeTier(tierRow?.tier)
    TELEMETRY = { userId: user.id, tier }

    // ── Free-tier qualifier ───────────────────────────────────────────────
    // Free AI needs a bar or it feeds signup-and-farm bots. The bar used to be a
    // connected WordPress site, which is heavy and irrelevant to an Amazon
    // influencer who will never publish a blog post. It is now an Amazon
    // Associates tag: one text field, known by heart by every real Amazon
    // creator, owned by no bot farm. Checked BEFORE any spend.
    {
      const block = freeTrialImageBlock({ tier, amazonTag: (tierRow as { amazon_associates_tag?: string | null } | null)?.amazon_associates_tag })
      if (block) return NextResponse.json({ error: block, code: 'associates_tag_required' }, { status: 403 })
    }

    // ── The free month ────────────────────────────────────────────────────
    // Free allowances used to be monthly and reset on the 1st, so a free
    // account got five thumbnails and five designs again every month forever.
    // They now run for FREE_TRIAL.trialDays from signup and do not renew. Only
    // looked up for a trial: no paying account pays for this call.
    const trialSignupISO = tier === 'trial' ? await accountSignupISO(user.id) : null
    {
      const over = freeTrialExpiredBlock({ tier, signupISO: trialSignupISO })
      if (over) {
        return NextResponse.json({
          error: over, code: 'trial_over', capExceeded: true,
          upgrade: nextTierFor(tier, 'thumbnailsPerMonth', { preferTier: 'amazon' }),
        }, { status: 403 })
      }
    }

    // gpt-image render quality is tier-gated: Pro (and admin) get HIGH for the
    // crispest, most ChatGPT-grade output; every other paid tier gets MEDIUM.
    // High costs ~3× more per image (~$0.22 vs ~$0.08), so it's a Pro perk.
    //
    // `let`, because the perk applies to the HERO thumbnail and not to bulk
    // social formats — see the downgrade just after isSocialFormat is known.
    let gfxQuality: 'medium' | 'high' = (tier === 'pro' || tier === 'admin') ? 'high' : 'medium'

    // Per-user thumbnail badge preference (Thumbnail style → Save as my default).
    // `decoration`: 'auto' (or unset) → let the model/angle pick per thumbnail;
    // 'none' → never draw one; a specific badge ('check'|'stars'|'arrow'|
    // 'speedlines'|'hot') → force THAT badge on every thumbnail. Legacy `noCheck`
    // (the old on/off toggle) still suppresses the green check under 'auto'.
    // Enforced in the decoration loop below so it can't be bypassed client-side.
    let noCheckDecoration = false
    // Default is NO badge until the creator opts in. `decoration`:
    //   'auto'  → let the model/angle pick per thumbnail (forcedDecoration=null)
    //   a badge → force it on every thumbnail
    //   'none' OR unset → no badge (the default)
    let forcedDecoration: ThumbDecoration | null = 'none'
    // The brand's chosen image look. Null is the loud default every account had
    // before presets existed, so a creator who has not picked one sees no change.
    let visualPreset: string | null = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: bp } = await (supabase as any)
        .from('brand_profiles').select('thumbnail_brand_style,visual_preset').eq('user_id', user.id).maybeSingle()
      // ROLLED, not read raw. The column now holds a comma-separated pool
      // ("bold,neon,comic") because a creator can pick several looks and have
      // each image draw one. Passing that string straight to resolvePreset
      // matches no id at all and silently returns the default, so a creator who
      // ticked three looks would have got Bold on every YouTube thumbnail and
      // nothing on screen would have said why.
      //
      // This route reads brand_profiles directly rather than going through
      // getBrandPresetId, which is the single lookup every other generator
      // uses. That is the shortcut that made this possible; the roll is applied
      // here so the behaviour matches, and a guard now forbids any other file
      // reading the column raw.
      visualPreset = pickPresetId(parsePresetIds((bp as Record<string, unknown> | null)?.visual_preset as string | null))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bs = (bp as any)?.thumbnail_brand_style || {}
      noCheckDecoration = !!bs.noCheck
      // 'hot' + 'speedlines' retired 2026-08 (cartoony / nonsensical). A stale
      // stored value now falls through to the 'none' default instead of drawing.
      const FORCEABLE = new Set<ThumbDecoration>(['check', 'stars', 'arrow', 'none'])
      if (bs.decoration === 'auto') {
        forcedDecoration = null // model/angle picks
      } else if (typeof bs.decoration === 'string' && FORCEABLE.has(bs.decoration as ThumbDecoration)) {
        forcedDecoration = bs.decoration as ThumbDecoration
      }
      // unset → keep the 'none' default (no badge)
    } catch { /* default: no badge */ }

    // Monthly AI-spend circuit breaker — a thumbnail renders a gpt-image
    // ($0.19 high, $0.06 medium), an unbounded vector for admin (no cap).
    const spendBlocked = await spendGate(user.id, tier)
    if (spendBlocked) return spendBlocked

    const falKey = process.env.FAL_KEY
    if (!falKey) return NextResponse.json({ error: 'FAL_KEY is not configured' }, { status: 500 })

    // Parse body BEFORE the cap check so the check can budget for the
    // requested variantCount (1 or 2). Otherwise a user 1 below their cap
    // could click "2 variants" and silently overshoot.
    const {
      quickMode = false,
      videoTitle,
      asin,
      productTitle: providedProductTitle,
      productDescription: providedProductDescription,
      productBullets: providedProductBullets,
      style = 'review',
      customHeadline,
      variantCount: rawVariantCount,
      styleReferenceUrl,
      faceModelId,
      faceAuto,
      noHuman,
      videoDescription,
      youtubeVideoId,
      textMode,
      capturedFrameDataUrl,
      capturedFrames,
      // 3C — Multi-product reference photos + composition note. When set, these
      // are the product references instead of the single Amazon-resolved photo. Lets creators show MULTIPLE products in
      // one thumbnail (comparison videos), or multiple angles of one product.
      customProductImageUrls,
      productCompositionNote,
      // Optional creator-pasted product link (Amazon / geni.us / store URL). When
      // present it's the AUTHORITATIVE product source — guarantees MVP renders the
      // exact product even when the title/description has no resolvable ASIN.
      productUrl,
      // Free-text creator direction for the WHOLE thumbnail — scene, mood, the
      // creator's pose/expression, background, props. Steers the composed-scene
      // prompt; never overrides identity-lock or product fidelity.
      scenePrompt,
      borderStyleIndex,
      accentColor,
      breakFrame = false,
      // 'landscape' (default) → 16:9 YouTube thumbnail. 'pin' → a 2:3 vertical
      // Pinterest pin (1000×1500): text-heavier, shopping-focused, drives a click.
      format,
      // Shared creative thinking: a key for one "post set" (one product pushed to
      // several networks). When two format requests share it, the art-director
      // brief is generated once and reused — secondary formats skip the reasoning
      // cost. Absent (YouTube co-pilot) → every design thinks fresh, as before.
      briefKey,
      // IG/story: when true (default for those formats) bake a bold "LINK IN BIO"
      // call-to-action into the design; false → keep the design clean of it.
      ctaLinkInBio,
      // Thumbnail headline style. 'statement' (default) = the current polished
      // benefit headline. 'question' = a curiosity question about the product,
      // with a matching facial reaction. User toggle, off by default.
      headlineStyle,
      // ── Boost controls (2026-09-03) — the levers that separate a designed
      //    pro thumbnail from the default composite. All optional.
      pose,
      /** "Make me wear it": the product goes ON the creator rather than being
       *  held beside them. Only acts when the product is something a person
       *  actually wears, which lib/wear-product works out from its name. */
      wearProduct,
      expression: expressionChoice,
      /** How much of the creator is in frame, and what to make of the body the
       *  references do not show. 'auto' lets the product category decide, which
       *  is the only way trousers and shoes ever get shown at all. */
      framing: framingChoice,
      bodyBuild: bodyBuildChoice,
      bodyHeight: bodyHeightChoice,
      energyEffects,
      badgeText,
      accentWord,
      autoBadge,
      autoAccent,
      visualPresetIds,
      decoration: decorationChoice,
    } = await request.json() as {
      quickMode?: boolean
      videoTitle: string
      asin?: string
      /** The YouTube description — used to find the product link for a real
       *  product photo when there's no Amazon ASIN (non-Amazon products). */
      videoDescription?: string
      /** YouTube native ID (e.g. dQw4w9WgXcQ). When present we pull the REAL
       *  video frame (img.youtube.com) and regenerate the thumbnail from it —
       *  the creator + product are already in the frame, so no face upload is
       *  needed. */
      youtubeVideoId?: string | null
      /** 'graphic' is the only mode this route still builds: gpt-image renders
       *  the design with the headline typography baked in. 'baked' and 'clean'
       *  belonged to the removed engines and now return a 400; the union keeps
       *  them so a stale client gets that answer rather than a type error. */
      /** The look, or looks, for THIS image, overriding the brand's own.
       *
       *  Launch Batch sends it. A batch is set up in one sitting and its
       *  creator should not have to go to Brand Profile and back to change how
       *  the thumbnails look, and more to the point a look chosen for one batch
       *  is not a change to the brand: setting it there would silently restyle
       *  the blog heroes and the pins too.
       *
       *  SEVERAL IS A REAL ANSWER. One id means that look every time. More than
       *  one means roll per image, which is what "mix it up" is: ten videos
       *  that do not all look like the same thumbnail twice. */
      visualPresetIds?: string[] | null
      /** The badge on the thumbnail, overriding the brand's stored setting for
       *  this image only. 'auto' lets the design decide, 'none' means no badge.
       *  Same reasoning as the looks: a batch should be set up without leaving
       *  the page, and without restyling every other surface on the way. */
      decoration?: 'auto' | 'check' | 'stars' | 'arrow' | 'none' | null
      textMode?: 'baked' | 'clean' | 'graphic'
      /** A single REAL frame grabbed by the extension (jpeg data: URL). Legacy
       *  single-frame path. Superseded by capturedFrames. */
      capturedFrameDataUrl?: string | null
      /** SEVERAL real frames grabbed across the video by the extension (jpeg
       *  data: URLs). We vision-pick the best (clear face + product visible)
       *  and ground the render on it — it captures the creator + product as
       *  they actually appear on camera. Absent → maxres frame. */
      capturedFrames?: string[] | null
      productTitle?: string
      productDescription?: string
      productBullets?: string[]
      style?: string
      /** Locked text overlay. When set, we skip the hook-generation
       *  agent entirely and use this verbatim. */
      customHeadline?: string
      /** How many variants to generate in a single shot. 1–10 — clamped
       *  server-side. Each variant counts as one image against the user's
       *  thumbnail cap + AI-cost telemetry, and the monthly cap pre-flight
       *  budgets for the full requested count. */
      variantCount?: number
      /** Optional public image URL the user uploaded as an aesthetic
       *  anchor. Haiku vision distills color/lighting/composition into
       *  a short style brief that gets folded into the image prompt.
       *  Works alongside the product-image path — they don't conflict. */
      styleReferenceUrl?: string
      /** Optional face_models.id — when set we load that specific face's
       *  reference photos to lock the host's likeness. */
      faceModelId?: string
      /** When true (and no explicit faceModelId), the route loads ALL the
       *  user's ready face models and vision-matches the video frame to pick
       *  the right person automatically (e.g. Seb vs Michelle). */
      faceAuto?: boolean
      /** When true: PRODUCT-ONLY thumbnail. No face, no human, no body parts
       *  composited or generated. The route skips face-ref loading entirely
       *  and the NB Pro prompt is rewritten to center the product hero with
       *  zero human elements. Best for unboxings, comparison shots, or
       *  branding-focused thumbnails where the product itself is the star. */
      noHuman?: boolean
      /** 3C — Up to 5 public image URLs the user uploaded as reference photos
       *  of the actual product(s). When present, these REPLACE the single
       *  Amazon-scraped product image as the references. Use cases:
       *  - Multiple angles of one product (front / side / detail)
       *  - Multiple products in a comparison-style thumbnail (Product A vs B)
       *  - Custom product when no Amazon ASIN exists
       *  Public Supabase URLs. Clamped to 5 server-side. */
      customProductImageUrls?: string[]
      /** Optional creator-pasted product link (Amazon/geni.us/store URL). */
      productUrl?: string
      /** Optional free-text composition direction explaining how to arrange the
       *  product references — e.g. "front view on the left, side angle on the
       *  right" or "Product A above, Product B below". Folded into the
       *  productRefClause. */
      productCompositionNote?: string
      /** Free-text creator direction for the entire thumbnail — e.g. "me
       *  holding the bottle, shocked face, bright kitchen, big arrow at the
       *  stain". Folded into the composed-scene prompt as a high-priority
       *  clause that steers scene/mood/pose/expression/background, but is
       *  explicitly subordinate to the identity-lock and product-fidelity
       *  rules so it can't make the model render the wrong face or fake the
       *  product. Trimmed + length-capped server-side. */
      scenePrompt?: string
      /** Live brand-style controls from the Co-Pilot block, driving THIS generation.
       *  A fixed neon border index (0-9), or null/omitted = keep borders varied. */
      borderStyleIndex?: number | null
      /** Title emphasis colour (hex) from the block; omitted = default yellow. */
      accentColor?: string
      /** When true, run rembg to cut out the creator and composite them OVER the
       *  neon border ("break the frame" effect). Off by default because rembg
       *  adds ~15-20s per generation. */
      breakFrame?: boolean
      format?: 'landscape' | 'pin' | 'ig' | 'fb' | 'story'
      briefKey?: string
      ctaLinkInBio?: boolean
      headlineStyle?: 'statement' | 'question'
      /** Creator's pose with the product. 'auto' (default) lets the angle's
       *  framing pick; the rest force a specific interaction so the person
       *  visibly holds / wears / uses the product instead of just standing near it. */
      pose?: 'auto' | 'hold' | 'wear' | 'use' | 'point' | 'thumbs'
      /** "Make me wear it". Distinct from pose:'wear', which is a gesture hint
       *  with no fidelity rules attached; this one names the body part the
       *  product goes on and holds the render to the reference photo. */
      wearProduct?: boolean
      /** The creator's chosen facial expression (lib/face-expression). */
      expression?: string
      /** 'bust' | 'full' | 'auto' (lib/body-framing). */
      framing?: string
      /** Only read for a full-body shot. */
      bodyBuild?: string
      bodyHeight?: string
      /** Add motion energy: speed lines, a streak on the product, a radial burst
       *  behind the headline, a splash for drinks/food. Off by default. */
      energyEffects?: boolean
      /** Short starburst badge text baked beside the product (e.g. "MAX POWER!").
       *  Only applies when the title is baked into the image (a clean/overlay
       *  render must stay text-free). */
      badgeText?: string
      /** One headline word to render in bright red so it jumps out (e.g. "STRONG").
       *  Overrides the brief's auto-picked emphasis word. */
      accentWord?: string
      /** Zero-typing badge: when on and no badgeText was typed, use the starburst
       *  badge the art director wrote for each brief. */
      autoBadge?: boolean
      /** Zero-typing accent: when on and no accentWord was typed, render each
       *  brief's own emphasis word in red. */
      autoAccent?: boolean
    }

    // ── A LOOK CHOSEN FOR THIS IMAGE, not for the brand ──────────────────
    //
    // The lookup above rolled the creator's own brand looks. Launch Batch names
    // its own instead, because a look chosen for one batch is not a change to
    // the brand: storing it there would silently restyle the blog heroes and
    // the pins as well, and it would mean leaving the page to change it.
    //
    // Re-rolled here rather than up there because the body is only parsed at
    // this point. Unknown ids filter out, and an override that filters down to
    // nothing falls through to the brand roll rather than to no look at all.
    {
      const asked = parsePresetIds((visualPresetIds ?? []).join(','))
      // ROLLED PER IMAGE. One id means that look every time; several means each
      // thumbnail draws its own, which is what "mix it up" is for a batch.
      if (asked.length > 0) visualPreset = pickPresetId(asked)

      // The badge, same idea and the same three states the brand setting has.
      // Unrecognised falls through to whatever the brand said rather than
      // quietly meaning "none".
      if (decorationChoice === 'auto') {
        forcedDecoration = null
      } else if (decorationChoice && ['check', 'stars', 'arrow', 'none'].includes(decorationChoice)) {
        forcedDecoration = decorationChoice as ThumbDecoration
        noCheckDecoration = decorationChoice === 'none'
      }
    }

    // Headline style: 'question' composes a curiosity question + matching face;
    // anything else = the current polished statement style (default).
    const wantQuestion = headlineStyle === 'question'

    // ── Boost controls: sanitize once, used by the composed-scene prompt ──
    // Pose → a concrete interaction with the product (overrides the angle's
    // default framing action). Anything unrecognised falls back to 'auto'.
    const POSE_ACTIONS: Record<string, string> = {
      hold:   'holding the product up in one hand and showing it clearly to the camera',
      wear:   'wearing or using the product on their body exactly as it is meant to be used',
      use:    'actively using the product as intended, caught mid-action',
      point:  'a single decisive index finger pointing straight at the product',
      thumbs: 'giving a big enthusiastic thumbs-up right beside the product',
    }
    const poseOverride: string | null = (typeof pose === 'string' && POSE_ACTIONS[pose]) ? POSE_ACTIONS[pose] : null
    const wantEffects = energyEffects === true
    // Badge + accent word get the same banned-word / brand scrub as the headline
    // (they're baked into the image, so a leak can't be fixed after render), and
    // the word-safe clamp so a badge never renders half a word.
    const badge = clampLine(stripDesignBrands(scrubBanned(String(badgeText || '').trim())).toUpperCase(), 18)
    const accentW = stripDesignBrands(scrubBanned(String(accentWord || '').trim())).toUpperCase().slice(0, 24)
    // The same Boost levers as prompt lines for the gpt-image "graphic" path (the
    // co-pilot default), which builds its prompt from the art-director brief
    // rather than buildComposed. Pose is applied separately via briefPose.
    // Resolved per brief: a typed badge / accent word always wins; otherwise the
    // auto toggles fall back to what the art director wrote for THAT brief.
    const wantAutoBadge = autoBadge === true
    const wantAutoAccent = autoAccent === true
    const gfxBoostLinesFor = (badgeFor: string, accentFor: string): string[] => [
      wantEffects ? 'ENERGY EFFECTS (the creator asked for these): make the design feel kinetic — bold speed lines radiating outward from the product, a subtle motion streak trailing it (the product ITSELF stays sharp and identifiable), a radial light burst behind the headline, and, only if the product is a drink, food or liquid, a dramatic splash frozen mid-air. High energy, still photorealistic, never cartoonish.' : '',
      badgeFor ? `STARBURST BADGE (required): beside the product add a bold STARBURST badge — a spiky sun-burst shape filled bright yellow with a thick black outline, tilted slightly for energy — reading exactly "${badgeFor}" in heavy black capitals, perfectly spelled. Keep it clear of the headline.` : '',
      accentFor ? `ACCENT WORD (required): render the headline word "${accentFor}" in bright RED (#FF2D2D) with the same thick black outline as the rest, so it jumps out from the white and yellow.` : '',
    ].filter(Boolean)
    // Sanitize the shared-brief key (opt-in; social composers only). The style is
    // folded in so a question brief is never served from a statement cache entry
    // (or vice versa) for the same post set.
    const sharedBriefKey = typeof briefKey === 'string' && briefKey.trim()
      // The wear toggle changes what the art director is asked for, so a brief
      // written before it was ticked must not be handed back after.
      ? `${briefKey.trim().slice(0, 196)}${wantQuestion ? ':q' : ''}${wearProduct === true ? ':w' : ''}${typeof expressionChoice === 'string' && expressionChoice && expressionChoice !== 'auto' ? `:x${expressionChoice}` : ''}`
      : undefined

    const variantCount = Math.min(10, Math.max(1, Number(rawVariantCount) || 1))
    // Social formats. 'pin' = 2:3 Pinterest pin, 'ig' = 4:5 Instagram post (both
    // portrait, text-heavy shopping designs). 'fb' = landscape Facebook post.
    // 'landscape' (default) = 16:9 YouTube thumbnail.
    const isPin = format === 'pin'
    const isIg = format === 'ig'
    const isFb = format === 'fb'
    const isStory = format === 'story'
    const isPortrait = isPin || isIg || isStory
    // gpt-image-2 only renders two native sizes: portrait 2:3 (1024×1536) and
    // landscape 16:9 (1536×864). We render at the closest one, then downscale/crop
    // to the exact platform dimensions below.
    const gfxSize: '1536x864' | '1024x1536' = isPortrait ? '1024x1536' : '1536x864'
    // Final delivered dimensions per platform. IG feed is 4:5 (1080×1350, the max
    // the feed allows); IG story is 9:16 full-screen (1080×1920).
    const outW = isPin ? 1000 : isIg ? 1080 : isStory ? 1080 : isFb ? 1200 : 1280
    const outH = isPin ? 1500 : isIg ? 1350 : isStory ? 1920 : isFb ? 630 : 720
    // Authoritative first prompt line that reframes the design for the target
    // format (overrides any 16:9 wording further down). Landscape/FB keep the
    // default thumbnail styling, so no directive.
    const pinDirective = isPin
      ? 'FORMAT — READ FIRST, OVERRIDES EVERYTHING BELOW: this is a 2:3 VERTICAL PINTEREST PIN (1024×1536, tall portrait), NOT a 16:9 video thumbnail — ignore any "16:9" or "landscape" wording that follows. It is a SHOPPING pin whose only job is to earn the click to buy, so use MORE text than a thumbnail: a big bold headline across the TOP, then a STACKED vertical list of 3–5 short benefit/feature callouts (checkmarks, chips or spec badges) down the middle, and a strong shop-style call-to-action near the BOTTOM (e.g. "TAP TO SHOP" or "SEE THE DEAL"). NEVER the word "Amazon". Product large and central; fill the tall frame top-to-bottom with no empty dead space. Person (if any) smaller, to one side.'
      : isIg
      ? `FORMAT — READ FIRST, OVERRIDES EVERYTHING BELOW: this is a 4:5 VERTICAL INSTAGRAM FEED POST (1080×1350, tall portrait), NOT a 16:9 video thumbnail — ignore any "16:9" or "landscape" wording that follows. A scroll-stopping shopping post: a big bold headline near the TOP, a short STACKED list of 2–4 benefit/feature callouts in the middle, product large and central. NEVER the word "Amazon". Fill the frame, but SAFE AREA: the TOP and BOTTOM ~10% get cropped — keep every word, badge, logo and the product edge inside a safe margin, never touching the top or bottom edge.${ctaLinkInBio === false ? ' Do NOT put any "LINK IN BIO", link, URL or call-to-action text in the design — keep it clean.' : ' MANDATORY: prominently design a bold "LINK IN BIO" call-to-action into the image (a pill, ribbon or badge, e.g. "🔗 LINK IN BIO TO SHOP") near the bottom (inside the safe area).'}`
      : isStory
      ? `FORMAT — READ FIRST, OVERRIDES EVERYTHING BELOW: this is a TALL VERTICAL INSTAGRAM STORY design (portrait), NOT a 16:9 video thumbnail — ignore any "16:9" or "landscape" wording that follows. A bold headline high up, the product large and central, 1–3 short punchy callouts. Fill the whole tall frame edge to edge, no empty dead space. Keep the headline a little below the very top and the call-to-action a little above the very bottom so the phone's story UI never covers them. NEVER the word "Amazon".${ctaLinkInBio === false ? ' Do NOT put any "LINK IN BIO", link, URL or call-to-action text in the design — keep it clean.' : ' MANDATORY: prominently design a bold "LINK IN BIO" call-to-action into the image (a pill, ribbon or badge, e.g. "🔗 LINK IN BIO TO SHOP") in the lower third.'}`
      : ''
    // Telemetry feature per format, so each Amazon-social format is counted
    // against its own monthly cap (below) rather than lumped as "thumbnail".
    const gfxFeature = isPin ? 'amazon_pin' : (isIg || isStory) ? 'amazon_ig' : isFb ? 'amazon_fb' : 'yt_thumb_graphic'

    // ── Bulk-social model swap (2026-08-13 "Path B", extended to all tiers) ──
    // gpt-image-2 really costs ~$0.19/render, which made the high-volume
    // pin/IG/FB caps unaffordable (300 pins × $0.19 > a whole tier's ceiling).
    // Those SOCIAL formats render on gpt-image-1 medium instead (~$0.06, no
    // visible drop at social sizes) on EVERY tier — Studio/Pro now use the same
    // Amazon-style pin/IG/FB actions, so they get the same cheap render. The
    // hero YouTube thumbnail (yt_thumb_graphic, the CTR money-shot) still stays
    // on gpt-image-2. undefined => the service's env default (gpt-image-2).
    const isSocialFormat = isPin || isIg || isFb || isStory
    const gfxModelOverride: string | undefined =
      isSocialFormat ? 'gpt-image-1' : undefined

    // THE HIGH-QUALITY PERK IS FOR THE HERO, NOT FOR BULK SOCIAL.
    //
    // gfxQuality above is tier-gated, so Pro was rendering pins, IG posts and FB
    // posts at HIGH — $0.19 a design against the $0.06 every other tier pays for
    // the same picture. The swap three lines up already exists because the
    // social formats do not need the expensive path, and its own comment says
    // there is "no visible drop at social sizes". Quality was contradicting it.
    //
    // The money is not marginal at Pro's caps: 700 social designs at high is
    // $133 a month, more than the hero thumbnails and the entire blog allowance
    // put together, spent on images viewed at 1000x1500 on a phone.
    //
    // A pin is a pin on every plan. The perk stays where it earns its price:
    // yt_thumb_graphic, the 1280x720 CTR money-shot.
    if (isSocialFormat) gfxQuality = 'medium'
    // What we LOG for the render.
    //
    // OpenAI prices gpt-image by QUALITY, not by model name, and gfxQuality
    // above is already tier-gated: Pro and admin render 'high', every other
    // tier renders 'medium'. The comment on that line has said "~3x more per
    // image (~$0.22 vs ~$0.08)" the whole time. The billing never heard it.
    //
    // Logging the bare env model booked EVERY render at the high rate ($0.19),
    // including the medium ones that actually cost about $0.06. That is not a
    // reporting detail: monthlyAiSpendCeilingUsd is what cuts a creator off, so
    // an Amazon-tier creator was burning their ceiling about three times faster
    // than their real spend, and the ceiling was sized against the inflated
    // number too.
    //
    // Book it by the quality that actually ran. 'high' keeps the env model and
    // its $0.19; the social-format override is subsumed, because those tiers
    // are on medium anyway and a Pro rendering a social format at high really
    // does pay the high rate.
    const gfxRecordOverride: string | undefined =
      gfxQuality === 'medium' ? 'gpt-image-1-medium' : undefined

    // ── Hard monthly per-format cap ────────────────────────────────────────
    // pin/ig/fb are finite ONLY on the Amazon tier (null = unlimited on Studio/
    // Pro, so they never block). The landscape-thumbnail cap (thumbnailsPerMonth)
    // is now enforced on EVERY tier as marketed — Creator 20 / Studio 250 / Pro
    // 300 / trial 5 (admin = null = unlimited). It shares one counter with the
    // blog Art Director hero (both record yt_thumb_graphic), so a plan's
    // thumbnail allowance covers co-pilot + blog heroes together. The monthly
    // $-ceiling (spendGate, above) remains the universal cost backstop.
    {
      const T = TIERS[tier]
      let capLimit: number | null = null
      let capFeatures: string[] = []
      let capLabel = 'designs'
      // The free trial pools pins, Instagram and Facebook into ONE allowance:
      // its loop is "make a design and hold it", not "make a pin, and separately
      // make a story". One counter across all three feature names, so five is
      // really five. Paid tiers have no pool and keep their per-format caps,
      // which are separate promises. See lib/free-trial.ts.
      const pooled = pooledDesignCap(T)
      const isSocialDesign = isPin || isIg || isStory || isFb
      if (pooled !== null && isSocialDesign) {
        capLimit = pooled
        capFeatures = ['amazon_pin', 'amazon_ig', 'amazon_fb']
        capLabel = 'ready-to-post designs'
      }
      else if (isPin) { capLimit = T.pinsPerMonth; capFeatures = ['amazon_pin']; capLabel = 'pins' }
      else if (isIg || isStory) { capLimit = T.igPostsPerMonth; capFeatures = ['amazon_ig']; capLabel = 'Instagram designs' }
      else if (isFb) { capLimit = T.facebookPostsPerMonth; capFeatures = ['amazon_fb']; capLabel = 'Facebook designs' }
      else { capLimit = T.thumbnailsPerMonth; capFeatures = [...PRIMARY_FEATURE.thumbnail, 'yt_thumb_graphic']; capLabel = 'thumbnails' }
      // A ZERO allowance is not a used-up allowance. Creator can now open the
      // Amazon hub (its Thumbnail Generator and Research run on Creator's own
      // limits), and its pin/Instagram/Facebook allowance is 0, so the cap
      // message would have read "You've used all 0 pins on your plan this
      // period" to somebody who had made none. Say what the plan includes and
      // offer the one that sells this.
      if (capLimit === 0) {
        return NextResponse.json({
          error: `${capLabel.charAt(0).toUpperCase()}${capLabel.slice(1)} are not part of the ${TIERS[tier].label} plan. The Amazon Influencer plan includes them.`,
          capExceeded: true,
          upgrade: nextTierFor(tier, 'thumbnailsPerMonth', { preferTier: 'amazon' }),
        }, { status: 403 })
      }
      if (typeof capLimit === 'number') {
        // A trial counts inside its own free month, not the calendar one. With
        // the calendar window, somebody who signed up on the 28th spent five
        // designs and had five more three days later.
        const tw = tier === 'trial' ? freeTrialWindow(trialSignupISO) : null
        const cap = await checkUsageCap(
          supabase, user.id, capFeatures, capLimit,
          tw ? tw.startISO : (tierRow?.subscription_period_start ?? null),
          tw ? tw.endISO : (tierRow?.subscription_period_end ?? null),
        )
        if (cap && cap.exceeded) {
          // Offer the plan that actually sells what they just ran out of. The
          // default ladder is the BLOG ladder, so a free user out of designs was
          // being pointed at Creator, which has pinsPerMonth: 0 and cannot make
          // one. An Amazon design cap offers the Amazon plan.
          return NextResponse.json({
            error: `You've used all ${capLimit} ${capLabel} on your plan this period${cap.resetLabel ? ` (resets ${cap.resetLabel})` : ''}.`,
            capExceeded: true,
            upgrade: nextTierFor(tier, 'thumbnailsPerMonth', isSocialDesign ? { preferTier: 'amazon' } : undefined),
          }, { status: 429 })
        }
      }
    }
    const lockedHeadline = (customHeadline || '').trim().toUpperCase()

    // Ground the thumbnail copy in what the creator ACTUALLY said: pull the
    // cached transcript and distil it to a claims sheet. Kicked off now so it
    // overlaps the rest of the pipeline (image gen) rather than adding latency;
    // awaited at the copy call sites. Skipped for a locked headline (no copy
    // gen) or when there's no video. Any failure → '' → title+product only.
    const claimsSheetPromise: Promise<string> = (!lockedHeadline && youtubeVideoId)
      ? (async () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: vid } = await (supabase as any)
              .from('youtube_videos')
              .select('transcript')
              .eq('user_id', user.id)
              .eq('youtube_video_id', youtubeVideoId)
              .maybeSingle()
            return await distillThumbnailClaims((vid?.transcript as string | null) || '')
          } catch { return '' }
        })()
      : Promise.resolve('')

    // For graphic mode: prefetch a storyboard frame to use as identity reference,
    // running in parallel with face-model loading + product resolution below.
    // Extension-captured frames (capturedFrames) are used if present; storyboard
    // is the server-side fallback when the extension isn't running.
    const gfxStoryboardPromise: Promise<import('@/lib/youtube-storyboards').StoryboardFrame | null> =
      (textMode === 'graphic' && youtubeVideoId && !capturedFrames?.length)
        ? fetchStoryboardFrames(youtubeVideoId as string, { maxFrames: 2 })
            .then(frames => frames[0] ?? null)
            .catch(() => null)
        : Promise.resolve(null)

    // Face comes straight from the request — the Co-Pilot block's face chips
    // (Auto / Off / Product only / a likeness model) drive it live. The saved
    // brand style is applied CLIENT-side (it prefills the block), so the route
    // never reads it; it just honours the border/accent/face it's handed.
    const isRandomFace = faceModelId === 'random'
    const effectiveFaceModelId = (isRandomFace || !faceModelId) ? undefined : faceModelId

    // ── Load the user's face model if they picked one ─────────────────────────
    // Only honored when status='ready' and lora_url is populated. If the
    // model is still training or failed, we silently fall back to no-face
    // generation rather than throwing — the user already chose, and the
    // worst outcome is a thumbnail without their face this time.
    let faceModel: { id: string; name: string; source_images: string[]; outfit_pref?: string | null } | null = null
    // Auto-match pool: all the user's ready face models (used when faceAuto is
    // on and no specific model was picked — we vision-match the frame below).
    let autoFaceModels: Array<{ id: string; name: string; source_images: string[]; outfit_pref?: string | null }> = []
    const asStrArr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    if (effectiveFaceModelId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: fm } = await (supabase as any)
        .from('face_models')
        .select('name,source_images,outfit_pref')
        .eq('id', effectiveFaceModelId)
        .eq('user_id', user.id)
        .single()
      const srcImages: string[] = fm ? asStrArr(fm.source_images) : []
      if (fm && srcImages.length > 0) {
        faceModel = { id: effectiveFaceModelId, name: fm.name, source_images: srcImages, outfit_pref: fm.outfit_pref ?? null }
      }
    } else if (faceAuto || isRandomFace) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: fms } = await (supabase as any)
        .from('face_models')
        .select('id,name,source_images,status,outfit_pref')
        .eq('user_id', user.id)
      autoFaceModels = ((fms as Array<{ id: string; name: string; source_images: unknown; status: string; outfit_pref: string | null }>) || [])
        .map(m => ({ ...m, source_images: asStrArr(m.source_images) }))
        .filter(m => m.status === 'ready' && m.source_images.length > 0)
        .map(m => ({ id: m.id, name: m.name, source_images: m.source_images, outfit_pref: m.outfit_pref ?? null }))
      // Only one face on file → no need to match, just use it.
      if (autoFaceModels.length === 1) { faceModel = autoFaceModels[0]; autoFaceModels = [] }
      if (autoFaceModels.length > 1) {
        // Random mode: pick one at random rather than auto-matching from the frame.
        // (Best-reference selection for each model is handled downstream by
        // getStarredPhotobooth refs — the earlier face_model_photos lookup here
        // queried a table that doesn't exist, so it only ever no-op'd.)
        if (isRandomFace) {
          faceModel = autoFaceModels[Math.floor(Math.random() * autoFaceModels.length)]
          autoFaceModels = []
        }
      }
    }

    // Co-Pilot thumbnails are FREE enrichment of a content piece (pricing model
    // 2026-06-15): they no longer decrement the content-piece quota. Cost is
    // bounded by the monthly $-ceiling (spendGate, checked above) instead.

    // ── Quick mode: hook text only ─────────────────────────────────────────────
    if (quickMode) {
      // Locked headline short-circuits the hook agent — no AI call needed.
      const overlayHook = lockedHeadline || (await generateHook(videoTitle, '', await claimsSheetPromise))
      return NextResponse.json({ ok: true, overlayHook, quickMode: true })
    }

    // ── IDENTITY GUARD (privacy — highest priority) ────────────────────────────
    // A rendered HUMAN face must ONLY ever come from a source the user owns:
    // their own saved face model (face_models is user_id-scoped above) or a
    // photo THEY uploaded this request. If the user hasn't set up a face model
    // and isn't doing a Product-only thumbnail, we must NOT silently fall back to
    // the video FRAME's person — that frame can contain a DIFFERENT creator
    // (a curated/public video, or a demo). Alert the user to set up their Face
    // Model instead of "doing whatever it wants". (Face models can never cross
    // accounts — the DB reads are user-scoped — so this also guarantees one
    // user's face is never rendered for another.)
    // youtubeVideoId means Co-Pilot context — always the user's own channel video,
    // so the person visible in storyboard frames is the user's own face.
    const hasOwnedFaceIdentity = !!faceModel || autoFaceModels.length > 0 || !!youtubeVideoId
    if (!noHuman && !hasOwnedFaceIdentity) {
      return NextResponse.json({
        ok: false,
        needsFaceModel: true,
        error: 'Set up your Face Model first',
        message: 'MVP only puts YOUR face on a thumbnail once you’ve added a Face Model — it will never use anyone else’s face or guess from the video. Add your face under Set up → Face Models, pick a saved face, or choose “Product only” for a thumbnail with no person.',
      }, { status: 409 })
    }

    // ── Resolve product data + fetch real product image from Amazon ────────────
    let productImageUrl: string | null = null
    let productTitle = providedProductTitle ?? ''
    let productDescription = providedProductDescription ?? ''
    let productBullets = providedProductBullets ?? []

    // 3C — User-supplied product reference photos. When present, these take
    // priority over the auto-resolved Amazon image: the creator knows what
    // they want to show, especially for non-Amazon products or comparison
    // thumbnails. Clamped server-side at 5. Anything not http(s) silently
    // dropped so a malformed URL can't break the run.
    const customProductRefs: string[] = Array.isArray(customProductImageUrls)
      ? customProductImageUrls
          .filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u))
          .slice(0, 5)
      : []
    // Composition note — free-text direction for HOW the products should sit
    // relative to each other in the frame. Optional. Trimmed + length-capped
    // so a user can't shove an essay into the prompt.
    const compositionNote: string = typeof productCompositionNote === 'string'
      ? productCompositionNote.trim().slice(0, 400)
      : ''
    // Creator's free-text thumbnail direction — steers the composed scene
    // (mood, pose, expression, background, props). Optional, trimmed + capped.
    const sceneDirection: string = typeof scenePrompt === 'string'
      ? scenePrompt.trim().slice(0, 400)
      : ''

    // Use the SINGLE SOURCE OF TRUTH for product-reference resolution so
    // thumbnails benefit from the same Amazon bot-block retry, vision-pick,
    // junk-URL filter, and gallery scrape as blog generation. Need product
    // title/description/bullets in addition to the image, so we still hit
    // Amazon directly when we have an ASIN — but the IMAGE itself comes
    // from the canonical resolver.
    // A creator-pasted product link is authoritative: prepend it to the
    // description so the resolver treats it as THE product URL (it follows
    // geni.us / short links and extracts the ASIN). Guarantees the exact product
    // even when the title/description carry no resolvable ASIN.
    const pastedProductUrl = typeof productUrl === 'string' && /^https?:\/\//.test(productUrl.trim())
      ? productUrl.trim()
      : null
    const resolverDescription = pastedProductUrl
      ? `${pastedProductUrl}\n${videoDescription ?? ''}`
      : (videoDescription ?? null)
    const refForThumbnail = await resolveProductReference({
      title: videoTitle ?? null,
      description: resolverDescription,
      // A pasted link overrides a title-detected ASIN — the creator explicitly
      // chose this product, so don't let a stale title ASIN win.
      asin: pastedProductUrl ? null : (asin ?? null),
      traceTag: `[thumbnail:${(youtubeVideoId || 'novid').slice(0, 8)}]`,
      userId: user.id,
      tier: null,
      // THE VISION PICK IS NOT OPTIONAL HERE, and it used to be skipped for
      // speed. lib/product-image exists because Amazon's MAIN image is often a
      // multi-panel marketing collage: the product staged in a kitchen with a
      // cutting board and a charging cable. Handing that to an image model gets
      // a render of the cutting board. Taking the hero image directly saved
      // three to eight seconds and bought a thumbnail showing the wrong
      // product, which costs a regenerate and the creator's trust in the whole
      // feature. The picker also returns immediately when a listing has one
      // image, so the cost is only paid where there is actually a choice.
      fastImage: false,
    })
    productImageUrl = refForThumbnail.productImageUrl ?? productImageUrl
    // WHERE THE REFERENCE CAME FROM, or that there was none. With no reference
    // the model draws a plausible product from the title alone, and that is
    // indistinguishable on screen from a render of the real one.
    const productRefSource = refForThumbnail.source
    // The resolver already scraped the product's REAL title (following the pasted
    // link / ASIN). Use it so the Art Director knows WHAT the product is. Without
    // this, a pasted-URL product left productTitle empty and the briefs came out
    // generic ("SPOTLIGHT THE PRODUCT", "HERO SHOT") instead of product-specific.
    // Guard against the resolver's fallback of echoing the caller's video title.
    if (!productTitle && refForThumbnail.productTitle && refForThumbnail.productTitle !== (videoTitle ?? '')) {
      productTitle = refForThumbnail.productTitle
    }

    // Fill in title / description / bullets from Amazon directly. Derive the ASIN
    // from the pasted product URL too — the thumbnail form sends `productUrl`, NOT
    // `asin`, when a link is pasted, so keying only off the body `asin` left the
    // structured text empty and starved the Art Director of real product context.
    const effAsin = (asin && asin.trim())
      || (pastedProductUrl ? asinFromAmazonUrl(pastedProductUrl) : null)
      || null
    // THIS is the ASIN the image belongs to. The client sends `productUrl` and
    // NOT `asin` whenever a link is pasted — the comment above records that
    // keying off the body `asin` alone has already starved this route once.
    // The product-image memory made the same mistake and filed images under a
    // null ASIN, so it now takes the resolved one from here.
    memo.asin = effAsin
    if (effAsin && (!productTitle || !productDescription || !productBullets.length)) {
      try {
        const p = await fetchAmazonProduct(effAsin)
        if (!productTitle) productTitle = p.title
        if (!productDescription) productDescription = p.description
        if (!productBullets.length) productBullets = p.bullets
      } catch { /* fall through — resolver already logged any block */ }
    }
    // 3C — When the user uploaded their own product photos, the FIRST one is
    // the "single product image" for any step that takes only one; the render
    // below uses all of them. A custom upload is also what unblocks a
    // non-Amazon product, which has no scraped image to fall back on.
    if (customProductRefs.length > 0) {
      productImageUrl = customProductRefs[0]
    }

    // ── "Make me wear it" ────────────────────────────────────────────────────
    // Resolved here, after every source of the product's NAME has been tried,
    // because the name is what decides this. A jacket goes on the torso and a
    // watch on a wrist; a power bank goes nowhere, so the toggle being on can
    // never put one on somebody's arm. The directive that comes back is mostly
    // about fidelity: an image model asked for "a person in a jacket" will draw
    // A jacket, and the whole point of an apparel design is that the viewer is
    // looking at the one they can buy.
    const wearable = wearProduct === true
      ? detectWearable({ title: productTitle })
      : { wearable: false, kind: null, on: null, keep: null }
    // A product-only design has nobody to dress, so the toggle does nothing
    // there rather than telling the model to wear something that isn't in
    // the frame.
    const wearLine = noHuman ? null : wearDirective(wearable)
    // HOW MUCH OF THEM IS IN FRAME. Every design used to be chest-up, which is
    // right for a thumbnail and impossible for trousers, shoes, socks, a dress
    // or swimwear: the wearable detector correctly says "worn on their feet" and
    // the framing rule then forbade showing feet. So the category picks the
    // default and the creator can override it either way. Build and height only
    // matter for a full-body shot, where everything below the chest is invented
    // because MVP has photos of a face and nothing else.
    const bodyBuild = normalizeBuild(bodyBuildChoice)
    const bodyHeight = normalizeHeight(bodyHeightChoice)
    const framing: EffectiveFraming = noHuman
      ? 'bust'
      : resolveFraming(normalizeFraming(framingChoice), wearable.kind)

    // The face the creator asked for. It has to beat two other instructions
    // already in the prompt (the angle's scene preset and the art director's
    // brief), so it is injected high and says it overrides. Nobody to emote in
    // a product-only design, so it does nothing there either.
    const expressionKey = noHuman ? 'auto' : normalizeExpression(expressionChoice)
    const expressionLine = expressionDirective(expressionKey)

    // ── Fetch channel thumbnails + analyse style (best-effort) ───────────────
    fal.config({ credentials: falKey })

    // ── PATH GFX: gpt-image-1 graphic-design thumbnail ────────────────────────
    // Triggered by textMode='graphic'. Identity source priority:
    //   1. Extension-captured frame (capturedFrames) — highest resolution
    //   2. Storyboard frame (gfxStoryboardPromise) — server-side, no friction
    //   3. Photobooth face model — fallback when no video context
    // Render quality is tier-gated (gfxQuality, set above): Pro/admin → high,
    // other paid tiers → medium. Co-Pilot generates one variant, so a single
    // high render stays under the timeout.
    // Falls through to the NB path on any failure so generation never blanks.
    // Only BLOCK on the storyboard frame when it's actually the identity source —
    // i.e. no captured frames AND no face model selected. With a face picked (the
    // common Co-Pilot case) the storyboard is never used, so awaiting it just
    // added 3–8s of dead latency to every generation.
    const storyboardCouldBeUsed = textMode === 'graphic'
      && !capturedFrames?.length
      && !faceModel
      && autoFaceModels.length === 0
    const gfxStoryboardFrame = storyboardCouldBeUsed ? await gfxStoryboardPromise : null
    const hasVideoFrame = !!(capturedFrames?.length) || !!gfxStoryboardFrame

    // ── PATH GFX-PRODUCT: gpt-image product-only (no face) ────────────────────
    // "Product Only" on the gpt-image engine: a clean, gorgeous product-hero
    // thumbnail with the headline baked on, no creator. Uses only the product
    // reference image. On failure it returns a retryable error: there is no
    // second engine to fall through to.
    if (textMode === 'graphic' && noHuman) {
      try {
        const openaiGfxP = createOpenAIService()
        const claimsSheetP = await claimsSheetPromise
        // Same art director as the face path — bespoke product-specific design.
        const gfxArtCtxP = [
          productTitle ? `Product: ${productTitle}` : '',
          ...((Array.isArray(productBullets) ? productBullets : []) as string[])
            .filter(b => typeof b === 'string' && b.trim().length > 0)
            .slice(0, 6)
            .map(b => `• ${b.replace(/\s+/g, ' ').trim().slice(0, 100)}`),
          productDescription ? productDescription.replace(/\s+/g, ' ').trim().slice(0, 300) : '',
        ].filter(Boolean).join('\n').slice(0, 900)
        const gfxCopiesP = await getOrCreateBriefs({
          userId: user.id,
          briefKey: sharedBriefKey,
          generate: () => designThumbnailBriefs({
            presetId: visualPreset,
            count: variantCount,
            videoTitle,
            productTitle,
            productContext: gfxArtCtxP,
            claimsSheet: claimsSheetP,
            lockedHeadline: lockedHeadline || undefined,
            noHuman: true,
            headlineStyle: wantQuestion ? 'question' : 'statement',
          }),
        })
        const productAbP = productImageUrl
          ? await fetch(productImageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) })
              .then(r => r.ok ? r.arrayBuffer() : null).catch(() => null)
          : null
        const productBytesP = productAbP ? await normalizeToPng(new Uint8Array(productAbP)).catch(() => null) : null
        if (!productBytesP) throw new Error('no product image for product-only graphic')
        const gfxModelP = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2'
        const gfxRawUrlsP = await Promise.all(
          gfxCopiesP.slice(0, variantCount).map(async (copy, idx) => {
            const attemptP = async (): Promise<string | null> => {
              const line1 = (copy.line1 || '').toUpperCase()
              const line2 = (copy.line2 || '').toUpperCase()
              const briefP = copy as ThumbBrief
              const conceptP = (briefP.concept || '').trim()
              const paletteP = (briefP.palette || '').trim()
              const bannerP = (briefP.banner || '').trim()
              // Zero-typing Boost (product-only path): typed values win, else the
              // auto toggles use this brief's own badge / emphasis word.
              const badgeP = badge || (wantAutoBadge ? String(briefP.badge || '') : '')
              const accentP = accentW || (wantAutoAccent ? String(briefP.emphasisWord || '') : '')
              const calloutsP = Array.isArray(briefP.callouts) ? briefP.callouts.filter(Boolean) : []
              const headP = conceptP
                ? [
                    `Design a UNIQUE, scroll-stopping, VIRAL product-review YouTube thumbnail — 16:9 landscape (1536×864). NO people. Bring THIS art-director brief (written for this product) to life exactly:`,
                    '',
                    `DESIGN CONCEPT: ${conceptP}`,
                    paletteP ? `COLOUR PALETTE: ${paletteP}. Do NOT default to plain yellow-on-black.` : '',
                    bannerP ? `BANNER PHRASE: render "${bannerP}" inside a hand-painted brush-stroke or torn banner (correct spelling).` : '',
                    calloutsP.length ? `CALLOUTS / BADGES: work these in as small bright checkmark items, icon chips or spec pill badges — correctly spelled, a few words each: ${calloutsP.join(' · ')}.` : '',
                    'Vibrant, modern, high-contrast, layered — never flat, dull or template-like. Mixed-weight display type where the key word pops.',
                    ...gfxBoostLinesFor(badgeP, accentP),
                  ].filter(Boolean)
                : [
                    'Design a UNIQUE, scroll-stopping, VIRAL product-review YouTube thumbnail — 16:9 landscape (1536×864). NO people. Vibrant, modern, high-contrast — never flat or plain. Bold mixed-colour display type (not plain white/yellow), a themed colourful background that suits the product, and small checkmark/spec callouts.',
                  ]
              const prompt = [
                pinDirective,
                ...headP,
                '',
                `PRODUCT (the hero): recreate the product from Image 1 accurately and prominently, filling a large part of the frame — keep its true shape, colours and its own printed branding. Do NOT invent retail packaging or extra marketing text on it. Light it naturally with a grounded shadow so it belongs in the scene; no glow ring or aura around it.`,
                'ABSOLUTELY NO PEOPLE — HARD RULE: this is a PRODUCT-ONLY design. There must be ZERO humans anywhere in the image: no person, no face, no head, no hands, no fingers, no arms, no body parts, no silhouettes, and no reflections or shadows of a person, not even small, partial, blurred, or at the edges/background. If Image 1 (the reference) shows a model, hands, or any person holding or using the product, keep ONLY the product itself and OMIT every human element entirely.',
                '',
                `MAIN HEADLINE — render this text EXACTLY, spelling perfect: "${line1} ${line2}". Style it as the concept describes (mixed colour/size/weight, banner for a key phrase) — a designed, layered look, NOT plain white-and-yellow outlined caps. Place it where it does NOT cover the product.`,
                `REAL COPY ONLY — every word on the design must be the headline above or a SPECIFIC, true detail about THIS product (its category, a real feature, a spec, a benefit). Do NOT add generic showcase or photography-direction labels such as "HERO SHOT", "FULL DETAILS", "CLOSE-UP REVEAL", "FEATURED PICK", "SPOTLIGHT", "THE PRODUCT", "PRODUCT REVIEW" — those are placeholder filler and must never appear.`,
                `FRAMING: the canvas is a full ${isPortrait ? 'tall vertical portrait' : '16:9 landscape (1536×864)'} and the entire canvas is shown — nothing is cropped. Compose within it with a small, even safe margin (about 5%) on all four sides: every headline, banner, badge, callout and the whole product must sit fully inside the frame, not touching or running off any edge. Fill the frame nicely — no big empty dead bands — just keep that clean margin all around.`,
              ].filter(Boolean).join('\n')
              const refs = [{ data: productBytesP, filename: 'product.png', mime: 'image/png' as const }]
              const b64 = await openaiGfxP.generateWithReferences({ prompt, images: refs, size: gfxSize, quality: gfxQuality, model: gfxModelOverride })
              recordUsage({ userId: TELEMETRY.userId, tier: TELEMETRY.tier, feature: gfxFeature, model: gfxRecordOverride ?? gfxModelP, images: 1 })
              const copyDec = (copy as { decoration?: ThumbDecoration }).decoration
              const gfxDec: ThumbDecoration =
                forcedDecoration === 'none' ? 'none'
                  : forcedDecoration ? forcedDecoration
                    : (copyDec && copyDec !== 'none' ? copyDec : 'none')
              try {
                let resized = await fitFinalGraphic(b64, outW, outH, isStory)
                if (gfxDec !== 'none') resized = await compositeBadgeOnly(resized, gfxDec)
                return await rehostToFal(`data:image/jpeg;base64,${resized.toString('base64')}`)
              } catch {
                return rehostToFal(`data:image/png;base64,${b64}`)
              }
            }
            // SINGLE render — no QC-retry (see the person+product path). A second
            // full render here was a main cause of the 240s client timeout.
            const url = await attemptP()
            return url
          }),
        )
        const gfxUrlsP = gfxRawUrlsP.filter((u): u is string => !!u)
        if (gfxUrlsP.length === 0) throw new Error('all product-only graphic variants failed')
        const gfxHookP = flatCopy(gfxCopiesP[0])
        return NextResponse.json({
          ok: true,
          thumbnailUrl: gfxUrlsP[0],
          thumbnailUrls: gfxUrlsP,
          thumbnailScores: gfxUrlsP.map(() => 0),
          thumbnailScore: 0,
          belowThreshold: false,
          overlayHook: gfxHookP,
          overlayHooks: gfxCopiesP.slice(0, gfxUrlsP.length).map(c => flatCopy(c)),
          headlineLocked: !!lockedHeadline,
          prompt: 'graphic-design-product-only',
          styleBriefApplied: false,
          channelStyle: null,
          modelUsed: 'gpt-image-graphic-product',
          baked: true,
          textPosition: null,
          faceBox: null,
          composited: true,
          headshotUsed: false,
          personCutoutUrl: null,
          faceUsed: 'none',
          qcWarning: false,
          faceIdentityChecked: false,
          artDirected: !!(gfxCopiesP[0] as ThumbBrief)?.concept,
          artConcept: ((gfxCopiesP[0] as ThumbBrief)?.concept || '').slice(0, 400),
          gfxQuality,
        })
      } catch (gfxPErr) {
        // gpt-image is the ONLY engine now — no Nano Banana fallback. Return a
        // clean, retryable error instead of handing back a worse image.
        const reason = gfxPErr instanceof Error ? gfxPErr.message : String(gfxPErr)
        console.warn('[thumb] product-only graphic failed:', reason)
        // No product image = Amazon blocked our server (datacenter IP). Signal
        // scrapeFailed so the client refetches the product image through SCOUT
        // (the creator's own browser, which Amazon doesn't block) and retries.
        const noImage = /no product image/i.test(reason)
        const billing = /no credits|insufficient_quota|billing|quota/i.test(reason)
        return NextResponse.json({
          ok: false,
          error: billing ? 'image-credits-exhausted' : noImage ? 'product-image-blocked' : 'thumbnail-generation-failed',
          scrapeFailed: (!billing && noImage) || undefined,
          message: billing
            ? 'The image service is out of credits. Add credits to the OpenAI account (Settings → Billing), then generate again.'
            : noImage
              ? 'Couldn’t load the product image from Amazon. Fetching it through SCOUT and retrying…'
              : 'The thumbnail engine hit a snag. Please hit Generate again.',
          gfxFallbackReason: reason,
        }, { status: 502 })
      }
    }

    // SEVERAL FACES ON FILE AND NO FRAME TO MATCH THEM AGAINST.
    //
    // Above, a single ready face model collapses straight into faceModel, and
    // several collapse only in random mode; otherwise autoFaceModels stays
    // populated so a downstream step can match the right person to the video.
    // The step that did that matching for a FRAMELESS request lived in the Nano
    // Banana path, which no longer exists, so it is done here instead. Without
    // it a creator with two faces and no captured frame reaches the graphic path
    // with no identity at all and gets a 502.
    //
    // Only when there is no frame: with one, the graphic path does its own
    // match against the video's own thumbnail a few lines down, and that match
    // is better because it can see the actual scene.
    if (!faceModel && autoFaceModels.length > 0 && !hasVideoFrame) {
      const matched = youtubeVideoId
        ? await matchFaceModelToFrame(
            `https://i.ytimg.com/vi/${youtubeVideoId}/maxresdefault.jpg`,
            autoFaceModels, supabase, { userId: user.id, tier },
          )
        : null
      faceModel = matched ?? autoFaceModels[0]
      autoFaceModels = []
    }

    // Private / inaccessible video: storyboard failed, no extension frames, no
    // face model → return a clear 409. There is nothing left to ground on, and
    // the honest answer is better than an invented face.
    if (textMode === 'graphic' && !noHuman && !hasVideoFrame && !faceModel && autoFaceModels.length === 0) {
      return NextResponse.json({
        ok: false,
        needsExtension: true,
        error: 'No identity source available',
        message: "This video is private — MVP can't pull frames from it without the browser extension. Install the SCOUT extension from the Chrome Web Store to capture your video frames, or add a Face Model under \"Your Face\" to generate a thumbnail.",
      }, { status: 409 })
    }
    if (textMode === 'graphic' && (faceModel || hasVideoFrame)) {
      try {
        const openaiGfx = createOpenAIService()
        const claimsSheetGfx = await claimsSheetPromise
        // ART DIRECTOR: one reasoning call designs N bespoke, product-specific
        // briefs (headline + palette + callouts + banner + full visual concept)
        // — the step ChatGPT does internally that we were skipping. gpt-image
        // renders each brief instead of guessing from a fixed template. Falls
        // back to the plain headline generator (empty concept) on any failure.
        const gfxArtCtx = [
          productTitle ? `Product: ${productTitle}` : '',
          ...((Array.isArray(productBullets) ? productBullets : []) as string[])
            .filter(b => typeof b === 'string' && b.trim().length > 0)
            .slice(0, 6)
            .map(b => `• ${b.replace(/\s+/g, ' ').trim().slice(0, 100)}`),
          productDescription ? productDescription.replace(/\s+/g, ' ').trim().slice(0, 300) : '',
        ].filter(Boolean).join('\n').slice(0, 900)
        const gfxCopies = await getOrCreateBriefs({
          userId: user.id,
          briefKey: sharedBriefKey,
          generate: () => designThumbnailBriefs({
            presetId: visualPreset,
            count: variantCount,
            videoTitle,
            productTitle,
            productContext: gfxArtCtx,
            claimsSheet: claimsSheetGfx,
            lockedHeadline: lockedHeadline || undefined,
            headlineStyle: wantQuestion ? 'question' : 'statement',
            wornOn: wearLine ? wearable.on : null,
            fixedExpression: expressionLine ? EXPRESSION_LABEL[expressionKey] : null,
          }),
        })

        let photoBytes: Buffer | Uint8Array
        let extraPhotoBytes: (Buffer | Uint8Array)[] = []
        let scoutUsedFaceModel = false
        let faceSelfieUsed = false
        // True once the reference photo itself carries the chosen expression, which
        // flips what the design step must be told about it.
        let expressionInReference = false
        // Whether the posed portrait actually showed the expression, and whether
        // it took a second attempt. Surfaced so a wrong face is attributable.
        let expressionVerified: boolean | null = null
        let expressionRetried = false
        // Whether the creator's own clothes were cropped out of the identity
        // references. Only meaningful when the product is worn, and reported
        // because the failure case is invisible otherwise: no crop means the
        // creator's own shirt is still the most authoritative garment in the brief.
        let refsAreHeadOnly = false
        let headCropText: string | null = null
        // The garment judge's answer, and whether it cost a second render. Surfaced
        // on the result card so a wrong garment is attributable rather than argued about.
        // A holder, not two plain locals: the render (and so the check) runs
        // inside the per-variant closure, and TypeScript cannot see across that
        // to know these were ever assigned.
        const garment: { check: GarmentVerdict | null; retried: boolean } = { check: null, retried: false }
        // Load a selfie as PNG bytes. source_images are STORAGE PATHS in the
        // private 'headshots' bucket — a raw fetch() on the bare path 400s, which
        // is exactly why the whole graphic path used to fail with "no readable
        // face photo". Download via the storage client; still handle a full
        // http URL just in case.
        const loadFacePng = async (p: string): Promise<Buffer | Uint8Array | null> => {
          try {
            let bytes: Uint8Array
            if (/^https?:\/\//i.test(p)) {
              const ab = await fetch(p, { signal: AbortSignal.timeout(12000) })
                .then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`)))
              bytes = new Uint8Array(ab)
            } else {
              const { data, error } = await supabase.storage.from('headshots').download(p)
              if (error || !data) return null
              bytes = new Uint8Array(await data.arrayBuffer())
            }
            return await normalizeToPng(bytes)
          } catch { return null }
        }
        if (capturedFrames?.length) {
          // Vision-pick the best frame for product / scene context.
          let bestIdx = 0
          if (capturedFrames.length > 1) {
            try {
              bestIdx = await pickBestFrame(capturedFrames, { productName: productTitle || undefined, ctx: { userId: user.id, tier } })
            } catch { /* keep 0 on vision failure */ }
          }

          // Always crop the video frame(s) to a tight portrait region (right 55%).
          // These go in as CONTEXT refs — pose, outfit, lighting from the real video.
          const cropFrame = async (png: Buffer | Uint8Array): Promise<Buffer | Uint8Array> => {
            try {
              const meta = await sharp(Buffer.from(png)).metadata()
              const w = meta.width ?? 1280
              const h = meta.height ?? 720
              const left = Math.round(w * 0.38)
              return await sharp(Buffer.from(png))
                .extract({ left, top: 0, width: w - left, height: h })
                .png()
                .toBuffer()
            } catch { return png }
          }
          const b64Best = capturedFrames[bestIdx].replace(/^data:[^;]+;base64,/, '')
          const bestFrameCrop = await cropFrame(await normalizeToPng(Buffer.from(b64Best, 'base64')))

          // If a face model exists, its close-up portrait photos are the IDENTITY
          // anchor (Image 1). The SCOUT frame crop is appended as a CONTEXT ref so
          // the generator also sees the creator's pose/outfit from the real video.
          // Multiple models (e.g. Michelle + Seb): vision-match against the maxres
          // thumbnail to pick the right person automatically, same as the NB path.
          let scoutFaceModel = faceModel
          if (!scoutFaceModel && autoFaceModels.length > 0) {
            if (autoFaceModels.length === 1) {
              scoutFaceModel = autoFaceModels[0]
            } else if (youtubeVideoId) {
              const matchUrl = `https://i.ytimg.com/vi/${youtubeVideoId}/maxresdefault.jpg`
              scoutFaceModel = await matchFaceModelToFrame(matchUrl, autoFaceModels, supabase, { userId: user.id, tier })
                ?? autoFaceModels[0]
            } else {
              scoutFaceModel = autoFaceModels[0]
            }
          }
          if (scoutFaceModel) {
            // Identity ref = the creator's own uploaded selfie (original or
            // optimized set — resolved upstream). We no longer prefer Photobooth
            // headshots: gpt-image re-renders the person, and a fixed studio shot
            // anchors the expression, whereas the varied selfies let it hit the
            // content-fitting expression. One selfie + the video frame crop.
            const photoUrls = scoutFaceModel.source_images.slice(0, 1)
            for (const url of photoUrls) {
              const png = await loadFacePng(url)
              if (png) { photoBytes = png; scoutUsedFaceModel = true }
            }
            // Append the video frame crop as context ref.
            if (scoutUsedFaceModel) extraPhotoBytes.push(bestFrameCrop)
          }

          // No face model (or all loads failed): use the video frame crop as the
          // primary ref, plus 2 extras from different timestamps for more angles.
          if (!scoutUsedFaceModel) {
            photoBytes = bestFrameCrop
            if (capturedFrames.length >= 3) {
              const extras = [
                Math.floor(capturedFrames.length * 0.25),
                Math.floor(capturedFrames.length * 0.75),
              ].filter(i => i !== bestIdx)
              for (const ei of extras.slice(0, 2)) {
                try {
                  const eb64 = capturedFrames[ei].replace(/^data:[^;]+;base64,/, '')
                  const ep = await normalizeToPng(Buffer.from(eb64, 'base64'))
                  extraPhotoBytes.push(await cropFrame(ep))
                } catch { /* skip bad frame */ }
              }
            }
          }
        } else if (faceModel) {
          // FACE SELECTED → the creator's own selfies are the identity source,
          // ALWAYS. (Previously a storyboard frame could win here and render a
          // generic/wrong face.) Load up to 3 selfies — a single reference drifts;
          // multiple angles give gpt-image a strong identity lock.
          // Loaded together, not one after another: three independent selfies in
          // series is three round trips on a path the creator is already waiting
          // on. Order still decides which is primary, so the identity lock is
          // unchanged.
          const urls = faceModel.source_images.slice(0, 3)
          const loaded = (await Promise.all(urls.map((u: string) => loadFacePng(u))))
            .filter((b): b is Buffer | Uint8Array => !!b)
          const primary = loaded[0] ?? null
          if (!primary) throw new Error('no readable face photo for graphic mode')
          photoBytes = primary
          faceSelfieUsed = true
          for (const bytes of loaded.slice(1)) extraPhotoBytes.push(bytes)

        } else if (gfxStoryboardFrame) {
          // No face model → the video's storyboard frame is the only identity source.
          photoBytes = await normalizeToPng(new Uint8Array(gfxStoryboardFrame.buffer))
        } else {
          throw new Error('no face identity for graphic mode')
        }

        // Runs for EVERY identity path, not just a saved face model. A creator
        // working from SCOUT frames or a storyboard picks an expression the same
        // way and was silently getting the prompt-only route, which is the one
        // that does not work.
        // Deliberately optional: the SCOUT path can reach here without an
        // identity image if every frame crop failed to decode, and a portrait of
        // nobody is not worth an image call.
        // photoBytes! because TypeScript cannot see that every branch above
        // either assigned it or threw; the `&& identityPng` guard below is the
        // runtime half, for the SCOUT path where every frame crop could fail.
        const identityPng: Buffer | Uint8Array | undefined = photoBytes!
        // THE EXPRESSION HAS TO BE IN THE REFERENCE, NOT IN A SENTENCE.
        //
        // The design step treats these selfies as the highest-priority thing
        // in the brief and copies the face in them, expression included. Six
        // renders proved that a written instruction does not beat a
        // photograph, and it should not: that same instinct is what keeps a
        // creator recognisable. So we hand it a photograph that agrees —
        // the same person, already wearing the expression they chose.
        //
        // Best-effort by design. One extra image call, only when a creator
        // actually picked something, and any failure leaves the original
        // selfies in place so the design still renders.
        if (expressionLine && identityPng) {
          const portraitRefs = [
            { data: identityPng, filename: 'face_0.png', mime: 'image/png' },
            ...extraPhotoBytes.slice(0, 2).map((b, i) => ({ data: b, filename: `face_${i + 1}.png`, mime: 'image/png' as const })),
          ]
          const portraitPrompt = buildExpressionPortraitPrompt(expressionKey)
          let posed = portraitPrompt ? await generateExpressionPortrait({
            refs: portraitRefs,
            promptText: portraitPrompt,
            imageModel: gfxModelOverride,
          }) : null

          // LOOK AT IT. The design step copies this face, so a portrait that
          // came back with the polite smile these models default to makes a
          // thumbnail with a polite smile whatever the creator picked — the
          // exact failure that took an afternoon to find, because nobody could
          // see this intermediate image. A fraction of a cent to check,
          // against $0.06 to render it again: the cheapest guard here, on the
          // one image everything downstream depends on.
          const expressionDesc = expressionDescription(expressionKey)
          if (posed && portraitPrompt && expressionDesc) {
            const v = await portraitShowsExpression({
              portraitPng: posed, label: EXPRESSION_LABEL[expressionKey], description: expressionDesc,
              politeSmileIsWrong: politeSmileIsWrong(expressionKey),
            })
            expressionVerified = v.match
            if (v.match === false) {
              console.warn(`[expression-check] re-rendering the portrait once: ${v.reason}`)
              const retry = await generateExpressionPortrait({
                refs: portraitRefs,
                promptText: `${portraitPrompt}\n\nTHE PREVIOUS ATTEMPT AT THIS PORTRAIT GOT THE EXPRESSION WRONG: ${v.reason} Commit to the expression described above, visibly and unambiguously.`,
                imageModel: gfxModelOverride,
              })
              if (retry) {
                posed = retry
                expressionRetried = true
                // SAME CHAIN AS EVERY OTHER RENDER SITE. These two were missed
                // when the quality-aware billing landed, and were wrong in both
                // directions: `'gpt-image'` is not in PRICING, so the hero path
                // fell to IMAGE_COST_FALLBACK ($0.04) against a ~$0.19 render,
                // while the social path recorded 'gpt-image-1' ($0.19) for a
                // picture rendered at medium (~$0.06). gfxRecordOverride has to
                // come FIRST: it is the one that knows the quality actually used.
                recordUsage({ userId: TELEMETRY.userId, tier: TELEMETRY.tier, feature: 'yt_thumb_expression_portrait', model: gfxRecordOverride ?? gfxModelOverride ?? (process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2'), images: 1 })
                expressionVerified = (await portraitShowsExpression({
                  portraitPng: retry, label: EXPRESSION_LABEL[expressionKey], description: expressionDesc,
                  politeSmileIsWrong: politeSmileIsWrong(expressionKey),
                })).match
              }
            }
          }
          if (posed) {
            // The new portrait leads. One original selfie stays behind it as a
            // second identity anchor, so a drift in the generated face has
            // something true to be pulled back toward.
            const anchor = extraPhotoBytes[0] ?? identityPng
            photoBytes = posed
            extraPhotoBytes = [anchor]
            expressionInReference = true
            recordUsage({ userId: TELEMETRY.userId, tier: TELEMETRY.tier, feature: 'yt_thumb_expression_portrait', model: gfxRecordOverride ?? gfxModelOverride ?? (process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2'), images: 1 })
          }
        }

        // THE CREATOR'S OWN CLOTHES ARE A COMPETING PRODUCT PHOTO.
        //
        // "Make me wear it" kept returning a plain pale polo for a product photo
        // showing a navy cable-knit one, intermittently, on the same ASIN, through
        // six rounds of rewording. The reason it could never be worded away: the
        // creator's reference selfie shows him wearing a plain pale polo. The design
        // step is told those photos are the identity lock and the highest priority
        // thing in the brief, and nothing in a photograph separates "who this person
        // is" from "what they had on that day".
        //
        // It is the same mechanism that made every expression come back as the
        // selfie's expression, and it takes the same answer. You do not out-argue a
        // photograph. So when the product is worn, the clothing is cut out of every
        // reference and the product photo becomes the only garment in the set.
        //
        // Skips the generated portrait, which is already a head-and-neck crop by
        // construction. Failing to crop is not fatal, but it IS reported: the
        // uncropped case is exactly when the wrong garment comes back, and it has
        // spent long enough looking like a mystery.
        // photoBytes! for the same reason as identityPng above: every branch
        // assigns it or throws, and TypeScript cannot see that. The truthiness
        // check is the runtime half, for the SCOUT path where every frame crop
        // can fail and leave nothing to crop.
        const primaryRef: Buffer | Uint8Array | undefined = photoBytes!
        if (wearLine && primaryRef) {
          const refs0: (Buffer | Uint8Array)[] = [primaryRef, ...extraPhotoBytes]
          const cleaned = await Promise.all(refs0.map(async (b, i) => {
            if (i === 0 && expressionInReference) return { bytes: b, cropped: true, generated: true }
            return { ...(await headAndNeckCrop(b)), generated: false }
          }))
          // AN UNCROPPABLE EXTRA IS DROPPED, NOT SHIPPED.
          //
          // The extras exist to stop identity drift, which is a real but modest
          // risk. A full selfie of the creator in their own clothes is a
          // photograph competing with the product photo, which is the bug this
          // whole path exists to kill. Those are not the same size of problem,
          // so when the lead reference is already a purpose-built head-only
          // portrait, an extra that would not crop simply does not go.
          //
          // Only when there IS such a portrait. With no portrait the lead is a
          // raw selfie, and dropping references would leave nothing to render a
          // face from, so there the honest outcome is to keep them and say so.
          const leadIsHeadOnly = cleaned[0].cropped
          const keep = leadIsHeadOnly ? cleaned.filter((c, i) => i === 0 || c.cropped) : cleaned
          const dropped = cleaned.length - keep.length

          photoBytes = keep[0].bytes
          extraPhotoBytes = keep.slice(1).map(c => c.bytes)
          refsAreHeadOnly = keep.every(c => c.cropped)
          headCropText = headCropNote(
            keep.filter(c => c.cropped && !c.generated).length,
            keep.filter(c => !c.cropped).length,
            dropped,
          )
          if (dropped) console.warn(`[head-crop] dropped ${dropped} uncroppable reference(s); the posed portrait carries identity`)
          if (!refsAreHeadOnly) console.warn('[head-crop] a creator reference kept its clothing; the wrong garment is likely')
        }

        // Product image (unchanged — fetched separately).
        const productAb = productImageUrl
          ? await fetch(productImageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) })
              .then(r => r.ok ? r.arrayBuffer() : null).catch(() => null)
          : null
        const productBytes = productAb
          ? await normalizeToPng(new Uint8Array(productAb)).catch(() => null)
          : null

        const gfxModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2'
        const productLabel = productTitle || 'the product'

        // One gpt-image-1 call per variant, all in parallel.
        const gfxRawUrls = await Promise.all(
          gfxCopies.slice(0, variantCount).map(async (copy, idx) => {
          const attempt = async (): Promise<string | null> => {
            const line1 = (copy.line1 || '').toUpperCase()
            const line2 = (copy.line2 || '').toUpperCase()
            // Art-director brief for THIS variant (empty concept ⇒ fell back to
            // the plain copy generator, so we use the generic design menu below).
            const brief = copy as ThumbBrief
            const briefConcept = (brief.concept || '').trim()
            const briefPalette = (brief.palette || '').trim()
            const briefBanner = (brief.banner || '').trim()
            const briefCallouts = Array.isArray(brief.callouts) ? brief.callouts.filter(Boolean) : []
            // The brief's own reaction and gesture are passed RAW to
            // buildGraphicThumbnailPrompt, which owns the rule about what
            // survives when the creator has chosen an expression. Deriving it
            // here as well is how two copies of one rule drift apart.
            // Boost: an explicit pose (hold / wear / use / point / thumbs) beats the
            // brief's own gesture.
            // Wearing it beats any gesture: a pose that has them holding it up
            // is the exact picture this option exists to stop.
            const briefPose = wearLine ? '' : (poseOverride || (brief.pose || '').trim())
            // Zero-typing Boost: typed values win; else the auto toggles use what the
            // art director wrote for THIS brief.
            const gfxBadge = badge || (wantAutoBadge ? (brief.badge || '') : '')
            const gfxAccent = accentW || (wantAutoAccent ? (brief.emphasisWord || '') : '')
            // The wardrobe line varies what the creator has on, which is the one
            // thing that must not vary when the product IS what they have on.
            // "anything else on them is plain and neutral" was the whole regression.
            // The model read "plain and neutral" as applying to the garment and
            // rendered a plain pale polo in place of a navy cable-knit one with a
            // white contrast collar. Nothing in that sentence may describe the
            // product, so it now only ever describes what is NOT the product.
            const gfxWardrobe = wearLine
              ? `WARDROBE: they are wearing the product itself, and it keeps EXACTLY the colour, pattern, texture, collar and trim of the reference photo — never simplified, never recoloured, never a plain version of it. Any OTHER garment visible on them (a jacket over it, a shirt under it) is unpatterned so it does not compete; that applies to those garments only and NEVER to the product.`
              : wardrobeDirective(faceModel?.outfit_pref)
            // Content-fitting facial expression. gpt-image RE-RENDERS the person
            // (it doesn't paste the selfie), so the reference photos lock identity
            // while the prompt drives the expression. Seed the FIRST variant's
            // expression from the headline's mood, then rotate so each variant
            // gives a different, high-CTR reaction to choose from.
            // Per-variant creative "vibe" — the only nudge we give, so the two
            // variants look distinct while gpt-image stays free to invent
            // everything else (composition, colours, effects, badges, layout).
            const GFX_VIBES = [
              'bold and colourful',
              'high-contrast and punchy',
              'bright, clean and modern',
              'dark, dramatic and cinematic',
              'vibrant with energetic accent colours',
            ]
            const gfxVibe = GFX_VIBES[idx % GFX_VIBES.length]
            // Short product-feature text gpt-image MAY turn into callouts/badges.
            // Rich product context (title + brand + bullet features) — the raw
            // material gpt-image turns into checkmark lists / spec badges / "#1"
            // tags, the way ChatGPT does when it has the full product page.
            const gfxFeatures = [
              productTitle ? `Product: ${productTitle}` : '',
              ...(Array.isArray(productBullets) ? productBullets : [])
                .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
                .slice(0, 6)
                .map(b => `• ${b.replace(/\s+/g, ' ').trim().slice(0, 90)}`),
              productDescription ? productDescription.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
            ].filter(Boolean).join('\n').slice(0, 800)

            const isScoutFrameMode = !!(capturedFrames?.length)

            let prompt: string
            let refs: Array<{ data: Buffer | Uint8Array; filename: string; mime: string }>

            // Both SCOUT and face-model paths use the same generative approach:
            // reference photo(s) → new composed thumbnail. SCOUT sends cropped
            // portrait regions extracted from the video frames (right 55% crop),
            // which makes the face fill a much larger portion of the reference
            // image vs. a full 16:9 wide shot. This gives gpt-image a stronger
            // identity lock than the old "transform this frame" approach, which
            // required a full layout restructuring and caused the face to drift.
            const creatorCount = 1 + extraPhotoBytes.length
            const usingFaceModel = scoutUsedFaceModel || faceSelfieUsed || (!isScoutFrameMode && !gfxStoryboardFrame)
            // When SCOUT + face model: Images 1–N are portraits (identity), last image is the video frame crop (context).
            // When SCOUT only: all images are video frame crops.
            // When face model only (no SCOUT): all images are portrait photos.
            const scoutFrameIdx = (scoutUsedFaceModel) ? creatorCount : null // 1-based index of the frame crop in refs
            let creatorRefLabel: string
            if (scoutUsedFaceModel && scoutFrameIdx) {
              const portraitCount = creatorCount - 1
              creatorRefLabel = portraitCount > 1
                ? `Images 1–${portraitCount} (close-up portrait photos — IDENTITY) + Image ${creatorCount} (video frame crop — CONTEXT/POSE)`
                : `Image 1 (close-up portrait photo — IDENTITY) + Image ${creatorCount} (video frame crop — CONTEXT/POSE)`
            } else if (creatorCount > 1) {
              creatorRefLabel = `Images 1–${creatorCount} (${usingFaceModel ? 'close-up portrait photos' : 'portrait crops from different video frames'} of the SAME person — use ALL for identity lock)`
            } else {
              creatorRefLabel = `Image 1 (${usingFaceModel ? 'close-up portrait photo' : 'portrait crop from the video'})`
            }
            const productRefNum = productBytes ? creatorCount + 1 : null
            // WHERE THE EXPRESSION WAS ACTUALLY COMING FROM.
            //
            // Five renders in a row came back with the same squint, the same
            // brow and the same head angle, through three different chosen
            // expressions and three different design concepts. That is not an
            // art director repeatedly picking skeptical. That is the reference
            // selfie being reproduced, expression and all.
            //
            // Of course it was. The model is told these photos are a "strong
            // face identity lock" and that identity is the highest priority
            // instruction in the brief, and nothing anywhere says which parts of
            // a photo are the person and which parts are just what they happened
            // to be doing when it was taken. Faced with a conflict between the
            // photo and a sentence, it keeps the photo, correctly.
            //
            // So the fix is not a louder expression instruction. Three of those
            // failed. It is telling the model that a face has two halves, and
            // that the photo only owns one of them.
            // Which way this reads depends on WHICH photo is in front of the
            // model, and getting it backwards would have the two mechanisms
            // fighting: telling it to ignore an expression we deliberately put
            // there is worse than saying nothing at all.
            const expressionSourceNote = !expressionLine
              ? ''
              : expressionInReference
                ? ' The first portrait was made for this design and the person in it is ALREADY wearing the exact expression this thumbnail needs — reproduce that expression as faithfully as you reproduce the face. It is a head-only crop and carries NO clothing information: take nothing about what they are wearing from it. Any later reference photo is there only to confirm identity; ignore the expression and the clothing in those too.'
                : ' IMPORTANT — these photos define WHO this person is, not what their face is doing: take the bone structure, eye shape and colour, nose, lip shape, hair, skin tone, apparent age and distinguishing marks from them, and do NOT copy the expression, eyebrow position, mouth position, head angle or gaze direction you see in them. Those come from the FACIAL EXPRESSION instruction in this brief and from nowhere else. The same person wearing a completely different expression is still instantly recognisable as themselves, and that is exactly what is being asked for.'
            // WHAT THE REFERENCE PHOTOS ARE FOR is the sentence that caused the
            // wrong garment, so the scope belongs here and not only in the final
            // check. A worn product means the creator's own clothes are a rival
            // product photo, and the frame crop's "outfit context" is the one
            // piece of context we now specifically do not want.
            const frameContext = wearLine
              ? (expressionLine ? 'hair style and lighting context' : 'pose, hair style and lighting context')
              : (expressionLine ? 'outfit, hair style and lighting context' : 'pose, outfit, hair style, and lighting context')
            const wardrobeSourceNote = !wearLine
              ? ''
              : refsAreHeadOnly
                ? ' Every creator photo here is a head-and-neck crop showing no clothing at all, so the product reference is the only image in this set that carries a garment.'
                : ' Whatever the creator has on in these photos is a different day and is NOT this product: take the garment from the product reference photo alone and never from what they are wearing in a reference.'
            const identityInstruction = (scoutUsedFaceModel && scoutFrameIdx
              ? `Images 1–${creatorCount - 1} are close-up portrait photos of the creator — use these as the PRIMARY face identity source. Image ${creatorCount} is a cropped frame from the actual video — use it to match the creator's ${frameContext}. Together they give you both the exact face AND the real-video look.`
              : usingFaceModel
                ? 'These are close-up portrait photos of the creator — use them for a strong face identity lock.'
                : 'These are portrait-cropped regions from the creator\'s actual video — the face fills most of each reference image.') + expressionSourceNote + wardrobeSourceNote
            if (sceneDirection) {
              // The creator typed a scene in "Describe your thumbnail" — let it
              // DRIVE the composition (setting, pose, expression, action, props)
              // instead of the default rigid left-text / center-product /
              // right-host layout. Identity lock, product fidelity and readable
              // outlined text still hold and are NEVER overridden by the direction.
              prompt = [
                'Professional YouTube thumbnail, 16:9 landscape (1536×864 px). High energy, high contrast, photorealistic.',
                ...(wearLine ? ['', wearLine] : []),
                ...(expressionLine ? ['', expressionLine] : []),
                '',
                `★ CREATOR'S SCENE DIRECTION (highest priority — build the whole thumbnail around this): "${sceneDirection}".`,
                "Match that direction for the SETTING / background, the creator's pose, expression and action, and any props described. The creator is the main subject of the scene.",
                '',
                `★ CREATOR IDENTITY (never compromise, even to fit the direction): ${identityInstruction} Reproduce this EXACT person's face with pixel-level accuracy — same facial structure, skin tone, hair colour and style, age, and distinctive features. A viewer who knows them must recognise them INSTANTLY. ${gfxWardrobe} ${framingLine({ framing, build: bodyBuild, height: bodyHeight })}`,
                '',
                wearLine
                  ? `PRODUCT: the product is worn, exactly as the WORN, NOT HELD rule above says. It appears in the frame only on the person${productRefNum ? `, and it is the item in Image ${productRefNum}` : ''} — no second copy of it anywhere, held or beside them or on a stand. Keep its true shape, colours and its own printed branding. Do NOT invent retail packaging or marketing text.`
                  : productRefNum
                  ? `PRODUCT: feature ${productLabel} (from Image ${productRefNum}) clearly and recognisably in the scene exactly as the direction implies (held, beside them, in use…). Keep its true shape, colours and its own printed branding. Do NOT invent retail packaging or marketing text.`
                  : `PRODUCT: feature ${productLabel} clearly and recognisably in the scene as the direction implies.`,
                '',
                'TEXT OVERLAY:',
                `  Top line: "${line1}" — white bold capitals, thick black stroke outline only, NO background box.`,
                `  Main line: "${line2}" — larger, bright yellow (#FFE034) bold capitals, thick black stroke outline — the dominant text. NO background box.`,
                ...gfxBoostLinesFor(gfxBadge, gfxAccent),
                `  Place the two lines where they do NOT cover the creator's face or the product (e.g. across the top or down one side). Outlined text only — no panels or filled boxes — crisp and readable at small sizes. No other text anywhere in the image${gfxBadge ? ' except the starburst badge above' : ''}.`,
                '',
                'STYLE: High-production YouTube creator thumbnail. Bold, punchy, cinematic depth of field (softly blurred background) so the creator and product stay sharp. No logos, no watermarks, no brand names rendered in the image itself.',
                // Last word, for the same reason as the default branch: the
                // creator's own scene direction above describes a mood and a
                // look, and an earlier instruction loses to it.
                ...(wearLine ? ['', 'FINAL CHECK — THE GARMENT: the item on them is the one in the product reference photo. Same colour, same pattern and texture, same collar and trim, same sleeve length. The scene direction never changes what the product looks like.'] : []),
                ...(expressionLine ? ['', `FINAL CHECK — THE FACE: ${expressionLine}`] : []),
              ].join('\n')
            } else {
              // The default graphic design. Assembled in lib/thumbnail-prompt so
              // the finished string can be printed, diffed and tested: every bug
              // in this prompt has been a CONTRADICTION between two lines written
              // hundreds of lines apart, which is invisible until you look at the
              // assembled result. scripts/test-thumbnail-prompt.ts now builds all
              // 68 combinations on every build and reads them for exactly that.
              prompt = buildGraphicThumbnailPrompt({
                presetId: visualPreset,
                line1, line2,
                concept: briefConcept,
                palette: briefPalette,
                banner: briefBanner,
                callouts: briefCallouts,
                // The RAW brief values. The module decides what survives when the
                // creator has chosen an expression, so that rule lives in one
                // place instead of being re-derived at each call site.
                briefExpression: (brief.expression || '').trim(),
                briefPose,
                expressionLine,
                expressionInReference,
                wearLine,
                wearOn: wearable.on,
                refsAreHeadOnly,
                framing,
                build: bodyBuild,
                height: bodyHeight,
                outfitDirective: wardrobeDirective(faceModel?.outfit_pref),
                creatorRefLabel,
                identityInstruction,
                productRefNum,
                productLabel,
                productFacts: gfxFeatures,
                formatDirective: pinDirective,
                boostLines: gfxBoostLinesFor(gfxBadge, gfxAccent),
                fallbackVibe: gfxVibe,
              })
            }
            refs = [
              { data: photoBytes, filename: usingFaceModel && !scoutUsedFaceModel ? 'creator_portrait.png' : usingFaceModel ? 'creator_portrait_1.png' : 'creator_crop.png', mime: 'image/png' },
              ...extraPhotoBytes.map((b, i) => {
                const isLastAndFrame = scoutUsedFaceModel && i === extraPhotoBytes.length - 1
                return { data: b, filename: isLastAndFrame ? 'creator_video_frame.png' : `creator_${i + 2}.png`, mime: 'image/png' as const }
              }),
            ]
            if (productBytes) refs.push({ data: productBytes, filename: 'product.png', mime: 'image/png' })

            // Tier-gated quality (gfxQuality): Pro/admin get HIGH for the crispest
            // ChatGPT-grade render; other paid tiers get MEDIUM. Co-Pilot generates
            // one variant, so a single high render stays well under the timeout.
            let b64 = await openaiGfx.generateWithReferences({ prompt, images: refs, size: gfxSize, quality: gfxQuality, model: gfxModelOverride })
            recordUsage({ userId: TELEMETRY.userId, tier: TELEMETRY.tier, feature: gfxFeature, model: gfxRecordOverride ?? gfxModel, images: 1 })

            // ── Did it put the right garment on? ────────────────────────────
            // Only for a worn product, and only once. Across one afternoon the
            // same polo came back correct, wrong, correct, correct, wrong, and
            // three rounds of rewording moved it twice and regressed it twice.
            // That is variance in the renderer, not a sentence to fix, so it is
            // checked rather than argued with: a fraction of a cent to look at
            // the result, and a second $0.19 render spent only on the ones that
            // were actually wrong.
            //
            // A single retry on purpose. Two would turn a bad afternoon into a
            // bill, and the second render is a fresh sample of the same coin,
            // not a smarter attempt.
            if (wearLine && productBytes && b64) {
              const verdict = await garmentMatchesProduct({ productPng: productBytes, renderB64: b64 })
              garment.check = verdict
              if (verdict.match === false) {
                console.warn(`[garment-check] re-rendering once: ${verdict.reason}`)
                const retryPrompt = `${prompt}\n\nTHE PREVIOUS ATTEMPT AT THIS DESIGN GOT THE GARMENT WRONG: ${verdict.reason} Render the item exactly as the product reference photo shows it — its real colour, its pattern and texture, its collar, trim and contrast panels — even where the design's palette would suggest something else.`
                const retry = await openaiGfx.generateWithReferences({ prompt: retryPrompt, images: refs, size: gfxSize, quality: gfxQuality, model: gfxModelOverride })
                if (retry) {
                  recordUsage({ userId: TELEMETRY.userId, tier: TELEMETRY.tier, feature: gfxFeature, model: gfxRecordOverride ?? gfxModel, images: 1 })
                  b64 = retry
                  garment.retried = true
                  // Report what the SECOND one looks like, so the card never
                  // says "wrong garment" about an image we then replaced.
                  garment.check = await garmentMatchesProduct({ productPng: productBytes, renderB64: retry })
                }
              }
            }
            // Badge the creator chose (5 stars / hot / etc). The GFX path bakes its
            // own headline via gpt-image and never runs bakeSimpleHeadline, so the
            // badge must be composited here or it never shows. forcedDecoration:
            //   'none'      → no badge
            //   a specific  → force that badge
            //   null (auto) → use this variant's own suggested decoration
            const copyDec = (copy as { decoration?: ThumbDecoration }).decoration
            const gfxDec: ThumbDecoration =
              forcedDecoration === 'none'
                ? 'none'
                : forcedDecoration
                  ? forcedDecoration
                  : (copyDec && copyDec !== 'none' ? copyDec : 'none')
            // gpt-image-2 renders NATIVE 16:9 (1536×864), so this is a pure
            // downscale to YouTube's 1280×720 — no cropping, nothing clipped.
            try {
              let resized = await fitFinalGraphic(b64, outW, outH, isStory)
              if (gfxDec !== 'none') resized = await compositeBadgeOnly(resized, gfxDec)
              return await rehostToFal(`data:image/jpeg;base64,${resized.toString('base64')}`)
            } catch {
              return rehostToFal(`data:image/png;base64,${b64}`)
            }
          }

          // Product QC + one retry. gpt-image REDRAWS the product, so it can drift
          // SINGLE render — no QC-retry. The old code re-ran a full gpt-image
          // render when a product-match check failed, which could add 60–90s and
          // push the whole request past the client's 240s timeout ("signal timed
          // out"). With native 16:9 + the art director + the resolved product
          // reference, drift is rare; speed matters more than an occasional retry.
          const gfxUrl = await attempt()
          return gfxUrl
          })
        )

        const gfxUrls = gfxRawUrls.filter((u): u is string => !!u)
        if (gfxUrls.length === 0) throw new Error('all graphic variants failed to rehost')

        // ── IS THIS EVEN THE RIGHT PRODUCT ────────────────────────────────
        //
        // gpt-image REDRAWS the product rather than pasting the reference, so
        // it can render a similar-but-different item: another model in the same
        // category, the wrong colour, the wrong number of pieces. Every other
        // surface that generates a product image checks this. The blog does,
        // Pinterest does, the hero image does. The thumbnail was the only one
        // that did not, so the one place a creator looks hardest was the one
        // place a wrong product shipped unremarked.
        //
        // CHECKED, NOT RETRIED. A QC retry used to live here and was removed
        // for a good reason: re-running gpt-image added sixty to ninety seconds
        // and pushed the request past the client's timeout, so the fix for a
        // wrong product was a request that failed entirely. This is one Haiku
        // call against the finished image, and what it finds goes on the screen
        // with a regenerate button next to it. The creator decides.
        let productMatch: boolean | null = null
        let productMatchNote: string | null = null
        if (productImageUrl && gfxUrls[0]) {
          try {
            const pv = await verifyProductMatch(
              productImageUrl, gfxUrls[0], productTitle || 'this product',
              { userId: user.id, tier: null },
            )
            // 'verification-skipped' is the verifier failing, not a verdict.
            // Recording it as a pass is how a blank check reads as a green one.
            if (pv.reason === 'verification-skipped') {
              productMatchNote = 'could not check the product this time'
            } else {
              productMatch = pv.match
              productMatchNote = pv.match ? null : pv.reason
            }
          } catch {
            productMatchNote = 'could not check the product this time'
          }
        }

        const gfxHook = flatCopy(gfxCopies[0])
        return NextResponse.json({
          ok: true,
          thumbnailUrl: gfxUrls[0],
          thumbnailUrls: gfxUrls,
          // WHAT WENT IN. Two rounds were spent arguing about a wrong-coloured
          // polo without either of us being able to see which product photo the
          // model was handed, or whether the chosen expression reached the
          // server at all. A render that disagrees with the product page is
          // either the wrong source image or a bad prompt, and those need
          // opposite fixes. Now the answer is on screen.
          sourceProductTitle: productTitle || null,
          sourceProductImageUrl: productImageUrl || null,
          // THE PRODUCT, checked the way the garment is. Three states, never
          // two: matched, did not match, and could not be judged. A blank
          // verdict rendering the same as a pass is exactly how a wrong polo
          // shipped looking verified.
          productMatch,
          productMatchNote,
          productChecked: productMatch !== null,
          // NO REFERENCE AT ALL is its own answer. The model then draws a
          // plausible product from the title, which looks identical on screen
          // to a render of the real one.
          productRefSource,
          productRefFound: !!productImageUrl,
          expressionUsed: expressionKey,
          expressionViaPortrait: expressionInReference,
          expressionVerified,
          expressionRetried,
          garmentMatch: garment.check ? garment.check.match : null,
          garmentNote: garment.check && garment.check.match === false ? garment.check.reason : null,
          garmentRetried: garment.retried,
          // Whether the garment could be judged at all. A blank verdict used to
          // be indistinguishable from a passed check on the card, which is how a
          // wrong polo shipped looking verified.
          garmentChecked: !!garment.check,
          wearApplied: !!wearLine,
          wearKind: wearable.kind,
          // Did the creator's own clothes get cropped out of the references. The
          // "no" case is the one that predicts a wrong garment, so it is never
          // silent again.
          refsHeadOnly: refsAreHeadOnly,
          headCropNote: headCropText,
          // Framing, and a plain statement that a full-body render's body is
          // generated. A creator should never have to work out for themselves
          // which parts of their own picture MVP had a photo of.
          framingUsed: framing,
          framingNote: framingNote(framing, bodyBuild, bodyHeight),
          thumbnailScores: gfxUrls.map(() => 0),
          thumbnailScore: 0,
          belowThreshold: false,
          overlayHook: gfxHook,
          overlayHooks: gfxCopies.slice(0, gfxUrls.length).map(c => flatCopy(c)),
          headlineLocked: !!lockedHeadline,
          prompt: 'graphic-design-mode',
          styleBriefApplied: false,
          channelStyle: null,
          modelUsed: 'gpt-image-graphic',
          baked: true,
          textPosition: null,
          faceBox: null,
          composited: true,
          headshotUsed: false,
          personCutoutUrl: null,
          faceUsed: hasVideoFrame ? (capturedFrames?.length ? 'video-frame-extension' : 'video-frame-storyboard') : (faceModel?.name ?? 'photobooth'),
          qcWarning: false,
          faceIdentityChecked: false,
          // Diagnostics: did the art director actually design this, and what did it say?
          artDirected: !!(gfxCopies[0] as ThumbBrief)?.concept,
          artConcept: ((gfxCopies[0] as ThumbBrief)?.concept || '').slice(0, 400),
          gfxQuality,
        })
      } catch (gfxErr) {
        // gpt-image is the ONLY engine now — no Nano Banana fallback. Return a
        // clean, retryable error instead of silently handing back a worse image.
        const reason = gfxErr instanceof Error ? gfxErr.message : String(gfxErr)
        console.warn('[generate-thumbnail] graphic path failed:', reason)
        const noImage = /no product image/i.test(reason)
        const billing = /no credits|insufficient_quota|billing|quota/i.test(reason)
        return NextResponse.json({
          ok: false,
          error: billing ? 'image-credits-exhausted' : noImage ? 'product-image-blocked' : 'thumbnail-generation-failed',
          scrapeFailed: (!billing && noImage) || undefined,
          message: billing
            ? 'The image service is out of credits. Add credits to the OpenAI account (Settings → Billing), then generate again.'
            : noImage
              ? 'Couldn’t load the product image from Amazon. Fetching it through SCOUT and retrying…'
              : 'The thumbnail engine hit a snag. Please hit Generate again.',
          gfxFallbackReason: reason,
        }, { status: 502 })
      }
    }

    // ── ONE ENGINE ────────────────────────────────────────────────────────
    //
    // Every branch above either returns or throws, so reaching here means the
    // request asked for a textMode this route no longer builds. It used to fall
    // into a cascade of five more engines (Nano Banana, an uploaded-photo
    // Kontext re-render, Kontext, Ideogram, Flux Pro); those were removed once
    // gpt-image became the only engine and the graphic path stopped falling
    // through to them. Answering plainly beats answering with silence.
    return NextResponse.json({
      ok: false,
      error: 'unsupported-text-mode',
      message: 'This version of MVP builds designed thumbnails only. Reload the page and hit Generate again.',
      textMode: textMode ?? null,
    }, { status: 400 })

  } catch (err) {
    // fal.ai ApiError has a .body property with the full validation detail
    const falBody = (err as Record<string, unknown>)?.body
    const msg = falBody
      ? JSON.stringify(falBody)
      : (err instanceof Error ? err.message : String(err))
    console.error('[generate-thumbnail] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
