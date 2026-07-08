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

// FB/Pinterest crop the edges differently (desktop trims top/bottom, mobile
// trims the sides), so the must-not-lose elements stay in the centre.
const SAFE =
  'SAFE AREA: keep the headline and the logo comfortably within the centre of the frame (both horizontally and vertically) so they survive the platform cropping the outer edges on desktop and mobile. The product scene and background may run to the edges.'

const NEGATIVE =
  'AVOID: generic / flat / Canva-template layouts, low contrast, small or thin fonts, busy or cheap-gradient backgrounds, watermarks, people, cartoon style, poor spacing, and any misspelled or invented text. Never render the word "honest".'

function colorSection(b: CoverBrief): string {
  return `COLOUR SYSTEM: ${b.colorLine} Primary = the brand colour, secondary = white, accent = the brand's secondary colour. Use large white typography mixed with accent-colour words; use the accent only where it increases emphasis.`
}

function layoutSection(b: CoverBrief): string {
  if (b.style === 'minimal') {
    return `LAYOUT: ${b.hasLogo ? 'the attached brand LOGO (reproduced faithfully, with a soft glow, integrated into the artwork) sits left or centre-left' : 'a clean brand emblem sits left'}, with one large headline reading "${b.headline}" in a modern sans-serif. Nothing else — no product scene, no cards, no ribbon. Mostly clean negative space.`
  }
  return [
    `LAYOUT — a cinematic composition in three zones (roughly 30% / 40% / 30%):`,
    `LEFT: ${b.hasLogo ? 'the attached brand LOGO, reproduced faithfully, with a soft glow / rim light, integrated naturally into the artwork (never simply pasted flat)' : 'a premium brand emblem with a soft glow'}.`,
    `CENTRE (dominant): a MASSIVE headline reading "${b.headline}" in a heavy condensed sans-serif — mix large WHITE words with large ACCENT-colour words and multiple weights for clear hierarchy.`,
    `RIGHT: a dynamic visual scene of real ${b.industry} items (products / packaging / devices) with depth, overlap and perspective — never leave this side empty.`,
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
    SAFE,
    NEGATIVE,
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
