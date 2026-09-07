// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The graphic-thumbnail prompt, assembled where it can be read.
//
// WHY THIS FILE EXISTS. This prompt used to be built inline inside a 3,600-line
// route handler, in a closure, inside a Promise.all, out of a dozen locals. It
// could not be printed, diffed or tested, and one afternoon of debugging showed
// exactly what that costs: four separate "fixes" to a string nobody could see in
// its final form, three of which were arguing with an instruction somewhere else
// in the same prompt that I could not see either.
//
// Every one of those bugs was the same shape. Not a missing instruction — a
// CONTRADICTION. Two sentences telling the model opposite things about the same
// subject, where the one that happened to be later or more concrete won:
//
//   "plain and neutral"           vs  a navy cable-knit polo   → a plain polo
//   "resting expression"          vs  "make them look excited" → the selfie's face
//   "content-fitting expression"  vs  a chosen expression      → skeptical, from the headline
//   "same lip shape"              vs  "mouth open in an O"     → a closed smile
//
// You cannot find that class of bug by reading a template. You find it by
// assembling the final string for every combination of inputs and looking at it,
// which is what scripts/test-thumbnail-prompt.ts now does on every build.
//
// So this module has one job and one rule. The job: turn an explicit input
// object into the exact string sent to the image model. The rule: no I/O, no
// randomness, no reading of anything it was not handed, so the same inputs
// always produce the same prompt and a test can hold it to that.

export interface ThumbnailPromptInput {
  /** Headline, already upper-cased and split by the copy step. */
  line1: string
  line2: string
  /** The art director's brief for this variant. Empty on the fallback path. */
  concept?: string
  palette?: string
  banner?: string
  callouts?: string[]
  /** The reaction the brief chose. Ignored when the creator picked one. */
  briefExpression?: string
  /** The gesture the brief chose, or the creator's pose override. */
  briefPose?: string
  badge?: string
  accentWord?: string
  /** The creator's chosen expression clause (lib/face-expression), or null. */
  expressionLine?: string | null
  /** True when the identity reference already WEARS the chosen expression. */
  expressionInReference?: boolean
  /** The "worn, not held" clause (lib/wear-product), or null. */
  wearLine?: string | null
  /** Where the product is worn, e.g. "worn on the torso". */
  wearOn?: string | null
  /** The wardrobe line used when nothing is worn. */
  outfitDirective?: string
  /** How the reference images are labelled and what they are for. */
  creatorRefLabel: string
  identityInstruction: string
  /** 1-based index of the product photo among the references, if there is one. */
  productRefNum?: number | null
  productLabel: string
  /** Real product details the design may turn into callouts. */
  productFacts?: string
  /** Pin/format-specific opening line, when the format has one. */
  formatDirective?: string
  /** Extra lines for a starburst badge / accent word. */
  boostLines?: string[]
  /** A vibe word for the fallback design menu. */
  fallbackVibe?: string
}

/** The single source of the "make me wear it" fidelity rule, repeated at the end
 *  of the prompt because recency is what an image model actually weights. */
export function garmentFinalCheck(): string {
  return 'FINAL CHECK — THE GARMENT: the item on them is the one in the product reference photo. Same colour, same pattern and texture, same collar, same trim and contrast panels, same sleeve length. If the palette or the design would look better with a different colour, the reference still wins.'
}

/** The expression's last word, which differs depending on whether the reference
 *  photo carries the expression or only the identity. Getting this backwards has
 *  the two mechanisms fighting, which is worse than either alone. */
export function expressionFinalCheck(expressionLine: string, inReference: boolean): string {
  return `FINAL CHECK — THE FACE: ${expressionLine}${inReference
    ? ' The first reference portrait already wears this exact expression — match it.'
    : ' The reference photos are the source of WHO they are and never of what their face is doing: if the expression in this render matches the reference selfie rather than the instruction above, it is wrong.'}`
}

/** The wardrobe line. It may describe what is NOT the product; it may never
 *  describe the product, because every flattening word in it lands on the
 *  garment. That is not a style note: "plain and neutral" in this sentence
 *  turned a navy cable-knit polo into a blank pale one. */
export function wardrobeLine(input: { wearLine?: string | null; outfitDirective?: string }): string {
  if (!input.wearLine) return input.outfitDirective || ''
  return 'WARDROBE: they are wearing the product itself, and it keeps EXACTLY the colour, pattern, texture, collar and trim of the reference photo — never simplified, never recoloured, never a plain version of it. Any OTHER garment visible on them (a jacket over it, a shirt under it) is unpatterned so it does not compete; that applies to those garments only and NEVER to the product.'
}

/** What the person is doing. When the creator chose an expression this carries
 *  the POSE only: asking here for a reaction "that fits the thumbnail" is asking
 *  for the headline's mood, and a question headline means skeptical. */
export function personActionLine(input: {
  expressionLine?: string | null
  briefExpression?: string
  briefPose?: string
}): string {
  const pose = (input.briefPose || '').trim()
  const expr = (input.briefExpression || '').trim()
  if (input.expressionLine) {
    return `${pose ? `Pose: ${pose}. ` : ''}Their facial expression is the one specified separately in this brief — use exactly that and do not substitute a reaction you think suits the headline better.`
  }
  if (expr || pose) {
    return `Give them ${expr || 'a natural, content-fitting reaction'}${pose ? `, ${pose}` : ''} — make the expression genuine and specific, not a generic stock smile.`
  }
  return 'Place them on one side reacting to the product with a genuine, content-fitting expression (not a generic smile).'
}

/** How the person is described: identity, wardrobe, action, framing. The
 *  expression clause deliberately does NOT appear here — it has its own block
 *  and its own final check, so there is exactly one place that names it. */
export function personLine(input: ThumbnailPromptInput): string {
  const expressionClause = input.expressionLine
    ? 'render the facial expression specified separately in this brief rather than copying the reference photo\'s expression'
    : 'you MUST change their expression to fit this thumbnail (do NOT copy the reference photo\'s expression)'
  return `PERSON: ${input.creatorRefLabel}. ${input.identityInstruction} Use this exact person — ${expressionClause} and may lightly retouch them, but do NOT change their inherent look (same face, skin tone, hair, age, distinctive features); they must be instantly recognisable as the same person. ${wardrobeLine(input)} ${personActionLine(input)} Place them on one side of the frame. Show them HEAD-AND-SHOULDERS to roughly CHEST-UP only. The references are head-and-chest selfies, so do NOT invent or show their full body, legs, waist-down, or overall body build — keep it an upper-body shot (they can still react, point, or gesture with hands near the frame).`
}

/** The product's own paragraph. When it is worn it appears in exactly one place
 *  and the prompt says so, because "hero shot" plus "worn" is how a shirt ends
 *  up both on the person and on a hanger beside them. */
export function productLine(input: ThumbnailPromptInput): string {
  if (input.wearLine) {
    return `PRODUCT: the product is worn, exactly as the WORN, NOT HELD rule above says${input.productRefNum ? `, and it is the item in Image ${input.productRefNum}` : ''}. It is ${input.wearOn || 'worn by the person'}, lit naturally so it reads clearly at thumbnail size, and it appears NOWHERE else in the design: no hero shot of it beside them, no copy on a hanger, a mannequin, a stand or a surface, none held in a hand. Keep its true shape, colours and its own printed branding; never invent packaging or fake logos.`
  }
  if (input.productRefNum) {
    return `PRODUCT: feature the product from Image ${input.productRefNum} accurately as the hero — its true shape, colours and its own printed branding (never invent packaging or fake logos). Light it naturally with a grounded shadow so it belongs in the scene; no glow ring or aura behind it. Show it however fits the design: hero shot, in-use, or lifestyle.`
  }
  return `PRODUCT: feature ${input.productLabel} accurately and prominently, true to life.`
}

/** The palette, which owns the design and never the product. Without the second
 *  half, a green-and-gold brief restyles a navy shirt to suit itself. */
export function paletteLine(input: ThumbnailPromptInput): string {
  const palette = (input.palette || '').trim()
  if (!palette) return ''
  return `COLOUR PALETTE: ${palette}. Do NOT default to plain yellow-on-black.${input.wearLine
    ? ' This palette governs the BACKGROUND, type and graphics ONLY. The product keeps its own real colours and pattern from the reference photo, even when they clash with the palette — a clash is correct, a recoloured product is not.'
    : ''}`
}

/** The art director's brief, and the one sentence that stops its prose from
 *  quietly re-deciding the face. A concept written about a product review
 *  describes an expression whether it was asked to or not, and it is the part of
 *  the brief a render follows most closely. */
export function creativeHead(input: ThumbnailPromptInput): string[] {
  const concept = (input.concept || '').trim()
  const callouts = (input.callouts || []).filter(Boolean)
  const banner = (input.banner || '').trim()
  if (concept) {
    return [
      'Design a UNIQUE, scroll-stopping, VIRAL YouTube thumbnail — 16:9 landscape (1536×864) — in the polished style of today\'s top product-review creators. Bring THIS art-director brief (written specifically for this product) to life exactly:',
      '',
      `DESIGN CONCEPT: ${concept}`,
      input.expressionLine
        ? 'NOTE ON THE CONCEPT ABOVE: follow it for the layout, palette, background, badges and energy. If it describes the person reacting, looking doubtful, smiling, or feeling any way at all, IGNORE that part — the facial expression is specified separately below and that specification wins.'
        : '',
      paletteLine(input),
      banner ? `BANNER PHRASE: render "${banner}" inside a hand-painted brush-stroke or torn banner as a secondary punch (correct spelling).` : '',
      callouts.length ? `CALLOUTS / BADGES: work these in as small bright checkmark items, icon chips, or spec pill badges — correctly spelled, a few words each: ${callouts.join(' · ')}.` : '',
      'Execute it vibrant, modern, high-contrast and layered — never flat, dull or template-like. Mixed-weight display type where the key word pops.',
      ...(input.boostLines || []),
    ].filter(Boolean)
  }
  return [
    `Design a UNIQUE, scroll-stopping, VIRAL YouTube thumbnail — 16:9 landscape (1536×864) — in the style of today's top product-review creators (MrBeast-era energy). It MUST look vibrant, modern and high-contrast and make the viewer want to click. NEVER flat, dull, plain or template-like. Make this one ${input.fallbackVibe || 'bold and colourful'}. YOU are the designer — own the layout, colours, fonts and effects.`,
    '',
    'USE THESE MODERN DESIGN TOOLS (pick the ones that fit this product, and mix them freely for variety):',
    '• TITLE TYPOGRAPHY: never one flat block of text, and do NOT default to the generic "plain white top line + plain yellow bottom line" look. Bold modern display font, colour the words to fit THIS product\'s palette (not always yellow), vary size and weight so the key word jumps out, and drop a short punchy phrase into a hand-painted brush-stroke or torn banner.',
    '• FEATURE CALLOUTS & ICONS: a short benefit list with bright coloured CHECKMARKS or small circular ICON chips (2–3 words each), and/or spec PILL badges (e.g. "144Hz", "FHD", "360°"), and/or a round hero badge ("#1", "BEST").',
    '• BACKGROUND: a vivid studio colour gradient, a bold themed graphic scene, OR a real-life setting — always colourful, high-contrast, with real depth (soft focus / bokeh). Never a plain flat wall.',
    input.productFacts ? `Draw callouts ONLY from these real product details (correctly spelled):\n${input.productFacts}` : '',
  ].filter(Boolean)
}

/**
 * The whole thing, in the order the model reads it.
 *
 * Order is load-bearing. The two instructions that have to beat a paragraph of
 * design direction appear twice: once up front where they set the frame, and
 * once at the very end as a FINAL CHECK, because an image model weights the last
 * thing it read. Every instruction placed only at the top lost today.
 */
export function buildGraphicThumbnailPrompt(input: ThumbnailPromptInput): string {
  return [
    input.formatDirective || '',
    ...(input.wearLine ? [input.wearLine] : []),
    ...(input.expressionLine ? [input.expressionLine] : []),
    ...creativeHead(input),
    '',
    "BRAND: if the product's brand or logo is clear, include it as a clean logo lockup.",
    '',
    'INTEGRATION (important): the person and the product must sit NATURALLY in the scene with realistic lighting and grounded shadows, like a real photo. Do NOT put a glowing outline, rim-light halo, coloured aura or cut-out edge around the person or the product — no haloing, nothing that makes them look pasted on. Keep edges clean and photographic.',
    '',
    personLine(input),
    '',
    productLine(input),
    '',
    `MAIN HEADLINE — the wording must read EXACTLY, spelling perfect: "${input.line1} ${input.line2}". Style it as the concept describes: split it across lines, give words their own colour/size/weight, use a banner for a key phrase — a designed, layered look, NOT plain white-and-yellow outlined caps. Keep the exact words and spelling. Big and instantly readable.`,
    '',
    'FRAMING: the canvas is a full 16:9 landscape (1536×864) and the entire canvas is shown — nothing is cropped. Compose within it with a small, even safe margin (about 5%) on all four sides: every headline, banner, badge, callout, the person\'s full head and the whole product must sit fully inside the frame, not touching or running off any edge. Fill the frame nicely — no big empty dead bands — just keep that clean margin all around.',
    'HARD RULES (only these): keep the person instantly recognisable, keep the product accurate to the reference, and make every piece of text correctly spelled and legible. Everything else — make it POP.',
    ...(input.wearLine ? ['', garmentFinalCheck()] : []),
    ...(input.expressionLine ? ['', expressionFinalCheck(input.expressionLine, input.expressionInReference === true)] : []),
  ].filter(Boolean).join('\n')
}
