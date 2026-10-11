// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH NICHE A BRAND MESSAGE MENTIONS (Alejandro, 2026-10-12: "how can I NOT
// have any niche or category showing in my CC message? I de-selected them all
// but it is still showing some").
//
// Unticking every category in the Outreach Profile used to fall back to the
// niche on the Brand page, so "none" was impossible and nothing on screen said
// where the words came from. Now:
//   - "Don't mention a niche or category" ticked: no niche line at all, and
//     the writer is told not to name one.
//   - Categories ticked: those, and only those.
//   - Nothing ticked: the Brand page niche, and the card says so by name.
// Pure, shared by every message writer (CC outreach, TRYBE) and the card.

export interface NicheSource { outreach_profile?: unknown; niche?: unknown; niches?: unknown }

export interface NicheLine {
  /** The fact line for the writer, or '' for none. */
  fact: string
  /** Extra instruction for the writer ('' when there is nothing to forbid). */
  rule: string
  /** Where the words came from, for the card. */
  source: 'off' | 'categories' | 'brand' | 'none'
  /** The words used, for the card. */
  words: string
}

export function brandPageNiche(bp: NicheSource): string {
  const n = typeof bp.niche === 'string' ? bp.niche.trim() : ''
  if (n) return n
  return Array.isArray(bp.niches) ? (bp.niches as unknown[]).map(String).map((x) => x.trim()).filter(Boolean).slice(0, 3).join(', ') : ''
}

export function outreachNiche(bp: NicheSource): NicheLine {
  const op = bp.outreach_profile && typeof bp.outreach_profile === 'object' ? bp.outreach_profile as Record<string, unknown> : {}
  if (op.omitCategories === true) {
    return { fact: '', rule: 'Do NOT name a niche, a product category or a type of product the creator covers. They are open to any product.', source: 'off', words: '' }
  }
  const cats = Array.isArray(op.categories) ? (op.categories as unknown[]).map(String).map((x) => x.trim()).filter(Boolean).slice(0, 8) : []
  if (cats.length) return { fact: `Content categories I cover: ${cats.join(', ')}`, rule: '', source: 'categories', words: cats.join(', ') }
  const niche = brandPageNiche(bp)
  if (niche) return { fact: `Niche: ${niche}`, rule: '', source: 'brand', words: niche }
  return { fact: '', rule: '', source: 'none', words: '' }
}
