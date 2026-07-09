// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Modular image-prompt engine for the Social Launch Kit covers + avatars.
// Adapted from the "elite creative-director" cover spec: each SECTION (role,
// style, layout, background, colour, typography, supporting, ribbon, depth,
// quality, safe-area, negative) is reusable — only the brand variables change,
// so we get consistently premium covers across any industry (reviews, SaaS,
// e-commerce, podcasts, restaurants…) from the same engine.

export interface CoverBrief {
  platformLabel: string        // e.g. "Facebook Page cover"
  style: 'bold' | 'minimal'
  brandName: string
  headline: string             // short, punchy (≤ ~8 words)
  industry: string             // niche(s)
  sellingPoints: string[]      // short value props (from keywords)
  colorLine: string            // brand colour instruction (set or "from the logo")
  hasLogo: boolean
  context?: string             // optional: about / audience / tone, for accuracy
  categories?: string[]        // the brand's actual content mix, dominant first
  reservePct?: number          // fraction of TOP and of BOTTOM the crop removes
                               // (wider banners crop more) — default 0.18
  containFill?: boolean        // true for extreme-wide banners: the WHOLE image
                               // is kept (contain, never cropped) + placed on a
                               // blurred fill, so the model should use the full
                               // frame, not reserve big top/bottom margins.
}

// ── Reusable sections ────────────────────────────────────────────────────────
const ROLE =
  'You are an award-winning brand designer and creative director specializing in high-converting social media branding. Produce something that looks made by an elite creative agency — never a template.'

const STYLE_BOLD =
  'STYLE: bold, modern, clean, premium, high-contrast, dynamic composition, commercial-advertising quality, scroll-stopping, 2026 design trends, extremely polished with minimal clutter. It must instantly communicate trust and quality.'

const STYLE_MINIMAL =
  'STYLE: minimal, elegant, premium and restrained, with generous negative space. Modern and understated, quietly high-end.'

const BACKGROUND =
  'BACKGROUND: a dark, premium backdrop with gradients, soft directional lighting, depth, subtle particles / halftone texture, gentle light streaks and floating abstract shapes. Expensive-looking but NOT busy. No flat solid fill.'

const DEPTH =
  'DEPTH: soft shadows, ambient glow, rim lighting, overlapping objects, clear foreground/background separation and a layered composition. Objects may slightly overlap and extend beyond their containers, in perspective. Never flat.'

const QUALITY =
  'QUALITY: photorealistic where appropriate, sharp details, luxury lighting, ultra-high resolution, no blur, no clipart, no stock-template look.'

// The generator paints a taller frame than the final wide banner, so the top
// and bottom get cropped off. Everything that matters must live in a central
// safe band with clear margins on every edge — otherwise headlines and products
// get sliced by the crop (and FB/Pinterest trim the edges again on top). The
// reserved margin scales with the banner's aspect: a 4:1 LinkedIn cover crops
// far more top/bottom than a 2.28:1 Facebook one, so we tell the model exactly
// how much to keep clear.
function safeSection(b: CoverBrief): string {
  // Extreme-wide banners are placed WHOLE (contain, never cropped) on a blurred
  // fill, so the model should use the full frame with just a small even margin —
  // no big reserved strips (that would waste the frame once it's scaled down).
  if (b.containFill) {
    return 'FRAMING: the COMPLETE image is kept — nothing is cropped — and placed on a wider banner. Use the full frame edge to edge, but keep a small, even clear margin (about 6%) on ALL FOUR sides so no text, logo or product touches or crosses an edge. Fill the frame with a rich, balanced composition (do NOT leave large empty top or bottom areas). Every letter must be fully visible and un-clipped.'
  }
  const pct = Math.round((b.reservePct ?? 0.18) * 100)
  const band = 100 - pct * 2
  return `CRITICAL — SAFE FRAMING. The finished cover is a WIDE, SHORT banner and the TOP and BOTTOM of the artwork WILL BE CROPPED AWAY. Compose the ENTIRE design inside a central horizontal band: every word of the headline, the whole logo, and all products must sit within the middle ~${band}% of the height, with a clear empty margin on ALL FOUR sides. NOTHING important may enter the top ~${pct}% or the bottom ~${pct}% of the frame, and nothing may touch or cross any edge — leave those outer zones as plain background / gradient / atmosphere only. Every letter of the headline must be fully visible and un-clipped, well away from the top, bottom, left and right edges. If the headline is long, make it smaller or use more lines so the whole phrase fits INSIDE the safe band — never let any text or product run off, get cut, or bleed past an edge.`
}

const NEGATIVE =
  'AVOID: any humans, faces, hands or people (products and objects only); any text, letter, logo or product that is clipped, cut off, or bleeding past the frame edges; anything important placed in the top or bottom margin; generic / flat / Canva-template layouts, low contrast, small or thin fonts, busy or cheap-gradient backgrounds, watermarks, cartoon style, poor spacing, and any misspelled or invented text. Never render the word "honest".'

function colorSection(b: CoverBrief): string {
  return `COLOUR SYSTEM: ${b.colorLine} Primary = the brand colour, secondary = white, accent = the brand's secondary colour. Use large white typography mixed with accent-colour words; use the accent only where it increases emphasis.`
}

function layoutSection(b: CoverBrief): string {
  if (b.style === 'minimal') {
    return `LAYOUT: ${b.hasLogo ? 'the attached brand LOGO (reproduced faithfully, with a soft glow, integrated into the artwork) sits left or centre-left' : 'a clean brand emblem sits left'}, with one large headline reading "${b.headline}" in a modern sans-serif. Nothing else — no product scene, no cards, no ribbon. Mostly clean negative space.`
  }
  return [
    `LAYOUT — a cinematic composition in three zones (roughly 30% / 40% / 30%), all sitting inside the central safe band (see SAFE AREA):`,
    `LEFT: ${b.hasLogo ? 'the attached brand LOGO, reproduced faithfully, with a soft glow / rim light, integrated naturally into the artwork (never simply pasted flat)' : 'a premium brand emblem with a soft glow'} — kept fully inside the frame with clear margin, not touching any edge.`,
    `CENTRE (dominant): a large, bold headline reading "${b.headline}" in a heavy condensed sans-serif — mix large WHITE words with large ACCENT-colour words and multiple weights for clear hierarchy. Size it so the ENTIRE phrase fits within the central safe band on AT MOST 3 lines, with clear empty space above and below — never let any line touch or cross the top or bottom edge.`,
    `RIGHT: a dynamic visual scene of real products / objects from the brand's actual content${b.categories?.length ? ` — mainly ${b.categories.slice(0, 4).join(', ')}${b.categories[0] ? `, weighted toward ${b.categories[0]} (what they publish most)` : ''}` : ` (${b.industry})`}, with depth, overlap and perspective, arranged fully inside the frame (nothing cropped by or bleeding past the right/top/bottom edges). Products and objects ONLY — absolutely no humans, faces, hands or people. Never leave this side empty.`,
  ].join(' ')
}

function supportingSection(b: CoverBrief): string {
  if (b.style === 'minimal' || !b.sellingPoints.length) return ''
  return `SUPPORTING: up to 3 short value-prop chips, each with a bold accent check icon (${b.sellingPoints.slice(0, 3).join(' · ')}), set inside clean cards or brush-stroke shapes. Do NOT add long rows of feature icons or a grid of category icons.`
}

function ribbonSection(b: CoverBrief): string {
  if (b.style === 'minimal' || b.sellingPoints.length < 2) return ''
  return `BOTTOM RIBBON (optional, thin): a slim premium footer bar with 3–4 short selling points separated by small icons (${b.sellingPoints.slice(0, 4).join(' · ')}). Keep it inside the safe area so it isn't cropped.`
}

/** The full cover prompt, composed from the sections above. */
export function buildCoverPrompt(b: CoverBrief): string {
  return [
    ROLE,
    b.style === 'minimal' ? STYLE_MINIMAL : STYLE_BOLD,
    b.context ? `BRAND: ${b.context}` : `BRAND: ${b.brandName}, a ${b.industry} brand.`,
    `Design a ${b.platformLabel} (wide landscape) for this brand.`,
    layoutSection(b),
    BACKGROUND,
    colorSection(b),
    supportingSection(b),
    ribbonSection(b),
    b.style === 'minimal' ? '' : DEPTH,
    QUALITY,
    safeSection(b),
    NEGATIVE,
  ].filter(Boolean).join('\n\n')
}

/**
 * Prompt for the EXTREME-WIDE banner (X/Bluesky 3:1, LinkedIn 4:1) BACKGROUND.
 * We do NOT ask any image model to render the headline or logo — every model
 * either garbles text at these widths or invents fake nav bars / subtitles. So
 * Ideogram makes ONLY a text-free dark backdrop + product hero on the right,
 * leaving the left two-thirds clean; then composeWideBanner() bakes the real
 * headline (opentype vector paths, accent word in brand colour) and composites
 * the creator's actual logo. `b.headline` here is used only to keep the product
 * scene on-theme — it is never rendered by the model.
 */
export function buildWideBannerPrompt(b: CoverBrief): string {
  const products = b.categories?.length
    ? 'items from this brand\'s world (' + b.categories.slice(0, 4).join(', ') + ')'
    : 'assorted real consumer-review products — a hardshell suitcase, over-ear headphones, a blender, a backpack, an insulated water bottle, a small action camera and a power bank'
  return [
    'Create ONLY a premium, wide 3:1 marketing-banner BACKGROUND — a single cinematic graphic, NOT a website, app screen, profile page or user interface (no navigation bars, menus, buttons, cards, tabs, search boxes or browser chrome).',
    `A dark, premium, cinematic backdrop (deep navy to black) with soft gradients, gentle diagonal light streaks and depth. ${b.colorLine} Use those colours only as subtle glowing light accents.`,
    `On the RIGHT ~40% of the frame: a dynamic, photorealistic hero arrangement of ${products}, with depth, overlap, perspective and studio lighting. Physical products only — no people, faces or hands.`,
    'The LEFT ~60% of the frame stays clean, dark, empty atmospheric background — NO products or objects there (that space is reserved for a logo and headline added afterwards).',
    'ABSOLUTELY NO text anywhere — no words, letters, numbers, headline, subtitle, caption, labels, logos, brand marks, watermark, product labels or screen text of any kind. If you are about to draw any letter or word, do not. Ultra sharp, photorealistic, nothing clipped at any edge. Never render the word "honest".',
  ].filter(Boolean).join('\n\n')
}

/** Circular profile picture / logo mark. */
export function buildAvatarPrompt(b: Pick<CoverBrief, 'brandName' | 'industry' | 'colorLine' | 'hasLogo' | 'context'>): string {
  return [
    'You are an elite brand designer. Create a polished, professional circular profile picture / logo mark — an iconic app-badge, perfectly centred, 1:1, high fidelity.',
    b.context ? `BRAND: ${b.context}` : `BRAND: ${b.brandName}, a ${b.industry} brand.`,
    b.hasLogo
      ? 'Reproduce the attached brand mark faithfully — refined and crisp — on a clean, on-brand background.'
      : 'Design a bold, simple geometric emblem that represents the brand, on a clean background.',
    b.colorLine,
    'Only include text that appears in the real logo — no invented words, letters or gibberish. Sharp, premium. Never render the word "honest".',
  ].join(' ')
}
