// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Deterministic post-generation SEO guard. Runs on the final HTML of EVERY
// generator right before publish, so the checks in lib/seo-score.ts pass from
// the get-go instead of the user finding a failing post later. This is the
// "correct by construction" backstop: prompts ask the model to comply, this
// guarantees the mechanical parts even when the model slips.
//
// It only fixes what can be fixed deterministically without inventing content:
//   • answer_first — if there's no real prose before the first heading (the
//     lead AI Overviews quote), hoist the first substantial paragraph above it.
//   • image_alt    — fill missing alt text on <img> from the keyword/title.
//
// Never fabricates prose, prices, or claims. A no-op when the post already
// complies (the common case once prompts are right).

function plainText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function wordCount(s: string): number {
  const t = plainText(s)
  return t ? t.split(/\s+/).filter(Boolean).length : 0
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Index of the first heading (HTML <h1..6> or a Gutenberg wp:heading block). */
function firstHeadingIndex(html: string): number {
  const tag = html.search(/<h[1-6][\s>]/i)
  const block = html.search(/<!--\s*wp:heading\b/i)
  const idxs = [tag, block].filter(i => i >= 0)
  return idxs.length ? Math.min(...idxs) : -1
}

// The first paragraph block after `from` — a Gutenberg paragraph (comment-
// wrapped) or a bare <p>. Returns absolute offsets into `html`, or null.
function firstParagraphAfter(html: string, from: number): { text: string; start: number; end: number } | null {
  const region = html.slice(from)
  const blockRe = /<!--\s*wp:paragraph[^>]*-->\s*<p\b[^>]*>[\s\S]*?<\/p>\s*<!--\s*\/wp:paragraph\s*-->/i
  const bareRe = /<p\b[^>]*>[\s\S]*?<\/p>/i
  const m = blockRe.exec(region) || bareRe.exec(region)
  if (!m) return null
  return { text: m[0], start: from + m.index, end: from + m.index + m[0].length }
}

/**
 * answer_first: the scorer counts the words before the first heading (the
 * direct-answer lead AI Overviews quote). If that lead is thin, move the
 * paragraph(s) that sit just after the first heading up to just BEFORE it, in
 * order, until the lead clears the 30-word bar. This fixes the common shape
 * where a post opens with an <h2> ("Quick recap") and the intro prose sits
 * under it. No-op when the lead is already strong or there's no heading /
 * paragraph to move. Never invents text.
 */
function ensureAnswerFirst(html: string): string {
  let out = html
  for (let i = 0; i < 4; i++) {
    const headIdx = firstHeadingIndex(out)
    if (headIdx === -1) break // no heading → scorer reads the whole body as lead
    if (wordCount(out.slice(0, headIdx)) >= 30) break // lead is strong enough
    const p = firstParagraphAfter(out, headIdx)
    if (!p || wordCount(p.text) < 3) break // nothing substantial to hoist
    // Remove the paragraph (it's after headIdx, so the pre-heading slice is
    // unchanged) and re-insert it immediately before the heading, preserving
    // the intro's original paragraph order across iterations.
    const without = out.slice(0, p.start) + out.slice(p.end)
    out = `${without.slice(0, headIdx)}${p.text.trim()}\n${without.slice(headIdx)}`
  }
  return out
}

/** image_alt: give every <img> that lacks alt text a descriptive one. */
function ensureImageAlt(html: string, label: string): string {
  const alt = (label || '').trim()
  if (!alt) return html
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    if (/\balt\s*=\s*["'][^"']*["']/i.test(tag)) return tag // has (possibly empty) alt already
    // Insert alt right after <img
    return tag.replace(/<img\b/i, `<img alt="${esc(alt)}"`)
  })
}

export interface SeoAutofixInput {
  title?: string | null
  seoKeyword?: string | null
}

/**
 * Run the deterministic SEO guarantees over a generated post's HTML. Safe to
 * call on any generator's final body just before publish. Idempotent + a no-op
 * when the post already complies.
 */
export function enforceSeoBasics(html: string, opts: SeoAutofixInput = {}): string {
  if (!html) return html
  const label = (opts.seoKeyword || opts.title || '').trim()
  let out = html
  out = ensureImageAlt(out, label)
  out = ensureAnswerFirst(out)
  return out
}
