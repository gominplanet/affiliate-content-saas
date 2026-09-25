// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Comparison videos: one video about two to four products.
//
// THE CREATOR SAYS SO FIRST. A comparison is not guessed from the title: the
// creator switches it on in Co-Pilot and sets each product (an ASIN or any
// product link) before Generate metadata. Everything downstream then covers
// every product: titles in comparison form, one tracked link per product in
// the description, tags for every brand, a thumbnail with each product's own
// photo, and "On sale now" watching all of them.
//
// Pure helpers here, shared by the Co-Pilot page and the routes, so the page
// and the server agree on what a valid comparison is.

import { normalizeAsinInput, amazonProductUrlRegex } from '@/lib/asin'

export const COMPARISON_MIN = 2
export const COMPARISON_MAX = 4

/** One product slot as the creator filled it in. */
export interface ComparisonSlotInput {
  /** An ASIN, an Amazon link, or any product link (geni.us, a store page). */
  input: string
  /** Optional role in the video: "Budget pick", "Best overall". */
  label?: string
}

/** One slot after reading what was typed: an ASIN when one could be read
 *  straight from it, otherwise the link, for the server to follow. */
export interface ComparisonSlot {
  asin: string | null
  url: string | null
  label: string
}

/**
 * The slots, cleaned: blanks dropped, ASINs read from Amazon links, labels
 * trimmed, the same product twice kept once. An error says why when there are
 * not two to four usable products, so the page can say it before anything is
 * generated.
 */
export function readComparisonSlots(raw: unknown): { slots: ComparisonSlot[]; error: string | null } {
  const list = Array.isArray(raw) ? raw : []
  const slots: ComparisonSlot[] = []
  const seen = new Set<string>()
  for (const item of list.slice(0, 8)) {
    const input = String((item as ComparisonSlotInput | null)?.input ?? '').trim()
    if (!input) continue
    const label = String((item as ComparisonSlotInput | null)?.label ?? '').trim().slice(0, 40)
    const asin = normalizeAsinInput(input)
    const url = asin ? null : (/^https?:\/\//i.test(input) ? input.slice(0, 500) : null)
    if (!asin && !url) {
      return { slots: [], error: `"${input.slice(0, 40)}" is not an ASIN or a link. Paste the product's ASIN or its link.` }
    }
    const key = asin ?? url!
    if (seen.has(key)) continue
    seen.add(key)
    slots.push({ asin, url, label })
  }
  if (slots.length < COMPARISON_MIN) return { slots, error: `A comparison needs at least ${COMPARISON_MIN} different products.` }
  if (slots.length > COMPARISON_MAX) return { slots: slots.slice(0, COMPARISON_MAX), error: `A comparison can have at most ${COMPARISON_MAX} products.` }
  return { slots, error: null }
}

/**
 * Product links already in a description, in order, for filling the slots
 * in: Amazon product links read as ASINs, and short links (geni.us, amzn.to)
 * kept as links for the server to follow. At most COMPARISON_MAX.
 */
export function productLinksInText(text: string | null | undefined): string[] {
  const out: string[] = []
  const add = (v: string) => { if (v && !out.includes(v)) out.push(v) }
  const s = String(text || '')
  for (const m of s.match(amazonProductUrlRegex('gi')) ?? []) {
    const a = normalizeAsinInput(m)
    add(a ?? m)
  }
  for (const m of s.match(/https?:\/\/(?:www\.)?(?:geni\.us|amzn\.to|a\.co)\/[A-Za-z0-9_\-/]+/gi) ?? []) add(m)
  return out.slice(0, COMPARISON_MAX)
}

/** A short name for a product: the part of an Amazon title before the first
 *  comma, bar or bracket, which is usually the brand and model. */
export function shortProductName(title: string, max = 60): string {
  const t = String(title || '').split(/[,|(\[]/)[0].replace(/\s+/g, ' ').trim()
  return (t || String(title || '')).slice(0, max).trim()
}

/** The description's product lines: one per product, its name (and role), then
 *  its own link. "1. Budget pick: Ninja AF101: https://..." */
export function comparisonLinkLines(products: Array<{ name: string; label?: string; link: string }>): string[] {
  return products.map((p, i) => `${i + 1}. ${p.label ? `${p.label}: ` : ''}${p.name}: ${p.link}`)
}
