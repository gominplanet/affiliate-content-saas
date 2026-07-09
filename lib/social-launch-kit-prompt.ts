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
 * Prompt for an EXTREME-WIDE banner (X/Bluesky 3:1, LinkedIn 4:1) generated
 * NATIVELY wide by Ideogram at 3:1 — not cropped down from a 1.5:1 design. The
 * composition must fill the whole frame edge to edge. When the brand has a real
 * logo we reserve a clean left zone and composite the actual logo there
 * afterwards (Ideogram would otherwise invent a garbled fake mark); with no
 * logo we let Ideogram render the brand NAME cleanly. Ideogram bakes crisp text,
 * so we ask ONLY for the single big headline — never small chips/captions, which
 * it misspells. Key elements stay in the central 75% because a 4:1 crop trims
 * ~12.5% off the top and bottom.
 */
export function buildWideBannerPrompt(b: CoverBrief): string {
  const products = b.categories?.length ? b.categories.slice(0, 5).join(', ') : b.industry
  const logoLine = b.hasLogo
    ? 'LEFT ~20% of the frame: keep it as clean, dark, premium background with only a soft glow — NO logo, NO badge, NO emblem, NO text and NO objects there. This space is intentionally left empty because the brand\'s real logo will be placed into it afterwards.'
    : `TOP-LEFT: render the brand name "${b.brandName}" in bold, clean, correctly-spelled letters — and no other small text.`
  return [
    'You are an award-winning brand designer. Create a premium, high-converting WIDE social banner in 3:1 landscape that FILLS THE ENTIRE FRAME edge to edge with a balanced, cinematic composition — commercial-advertising quality, scroll-stopping, 2026 design trends. It must instantly communicate trust and quality.',
    b.context ? `BRAND: ${b.context}` : `BRAND: ${b.brandName}, a ${b.industry} brand.`,
    `BACKGROUND / COLOUR: ${b.colorLine} A dark, premium backdrop with gradients, soft directional lighting, depth and gentle gold/accent light streaks. Expensive-looking but not busy — no flat solid fill.`,
    logoLine,
    `CENTRE: ONE huge, bold headline in a heavy condensed sans-serif reading "${b.headline}" — mix large WHITE words with large ACCENT-colour words for hierarchy. Perfectly spelled, crisp, high contrast, on at most 3 lines. This is the focal element.`,
    `RIGHT: a dynamic, photorealistic scene of real products / objects from the brand's world${products ? ` (${products})` : ''}, with depth, overlap and perspective, filling the right third of the frame. Products and objects ONLY — absolutely no humans, faces or hands. Never leave the right side empty.`,
    'Keep the headline and every product within the CENTRAL 75% of the height (the top and bottom ~12% may be trimmed) — nothing important near the top or bottom edge.',
    'DO NOT render any small paragraph text, feature chips, badges, captions, buttons, URLs or watermarks anywhere — only the single big headline (and the brand name only if asked above). No misspelled or invented words. Never render the word "honest".',
    'Ultra sharp, no blur, photorealistic where appropriate, nothing clipped or cut off at any edge.',
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
