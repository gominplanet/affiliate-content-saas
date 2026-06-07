/**
 * Helpers for placing images INSIDE the body of a generated blog post.
 *
 * The original rule (shipped May 2026, commit 6474cf8) worked great and
 * the user asked to restore it after the paragraph-fallback variants
 * caused images to cluster back-to-back. The rule, faithfully:
 *
 *   Place each image RIGHT BEFORE a usable H2 section break, spread
 *   evenly across the body. "Usable" means:
 *     - it's an H2 (not H3/H4 — those are sub-elements inside special
 *       blocks like Quick Verdict's "Skip if you:" / "Buy if you:")
 *     - it isn't the FIRST usable H2 (the opener/hook — an image right
 *       under the lead reads awkward)
 *     - it isn't the LAST usable H2 (typically a section closer — an
 *       image right before the tail blocks reads like the article ended)
 *     - it isn't a special-block heading (Quick Verdict, Related,
 *       FAQ, About, Disclosure — see SKIP_HEADING_TEXT). These either
 *       sit inside callout boxes (image inside Quick Verdict = broken)
 *       or are the article's tail (image after the conclusion = wrong).
 *
 * NO paragraph fallback. If after filtering there aren't enough usable
 * H2s for `count`, place fewer images. Quality > clustering.
 *
 * Matches both formats the codebase can produce:
 *   - Raw HTML: `<h2 class="...">Section title</h2>`   ← current writer
 *   - Gutenberg block: `<!-- wp:heading -->`            ← editor / legacy
 *
 * Used by:
 *   - /api/blog/generate — auto-places images on first generation
 *   - /api/blog/refresh-images — re-places after AI/user provides images
 */

/** Build a Gutenberg image block. Optional caption renders under it. */
export function gutenbergImageBlock(url: string, alt: string, caption?: string): string {
  const safeAlt = alt.replace(/"/g, '&quot;')
  const cap = caption
    ? `<figcaption class="wp-element-caption">${caption.replace(/</g, '&lt;')}</figcaption>`
    : ''
  return `\n<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->
<figure class="wp-block-image size-large"><img src="${url}" alt="${safeAlt}"/>${cap}</figure>
<!-- /wp:image -->\n`
}

/**
 * Headings (as text) that we never want to land an image next to.
 * These show up inside special UI blocks (Quick Verdict callout, CTA
 * cards) or at the structural tail of a post (Related reviews,
 * Frequently Asked Questions, About the reviewer). Matching them
 * would either drop an image INSIDE a callout box (looks broken) or
 * AFTER the natural article conclusion (reads like the photo
 * belongs to the next post). Lowercase + word-boundary compare
 * against the heading's inner text.
 */
const SKIP_HEADING_TEXT = [
  'quick verdict',
  'skip if you',
  'buy if you',
  'related reviews',
  'related posts',
  'related',
  'frequently asked questions',
  'faq',
  'faqs',
  'about the reviewer',
  'about the author',
  'about me',
  'sources',
  'references',
  'disclosure',
  'affiliate disclosure',
  'comments',
]

/**
 * Byte offsets where each USABLE H2 heading block starts, in document
 * order. "Usable" filters out tail/callout/sub-element headings — see
 * SKIP_HEADING_TEXT and the H2-only restriction above.
 *
 * Matches both formats the codebase can produce:
 *   - Raw HTML: `<h2 class="...">Section title</h2>`   ← writer output
 *   - Gutenberg block: `<!-- wp:heading -->` (level 2 default)
 *     Explicit level 3/4 Gutenberg blocks are skipped.
 */
export function headingOffsets(content: string): number[] {
  const offsets = new Set<number>()

  // Helper — does this heading's inner text match a skip pattern?
  const isSkipHeading = (atOffset: number): boolean => {
    const window = content.slice(atOffset, atOffset + 400)
    const inner = window.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]
      ?.replace(/<[^>]+>/g, '')
      ?.replace(/&amp;/g, '&')
      ?.replace(/&nbsp;/g, ' ')
      ?.replace(/&#8217;/g, "'")
      ?.replace(/&[a-z#0-9]+;/gi, '')
      ?.trim()
      ?.toLowerCase() ?? ''
    if (!inner) return false
    return SKIP_HEADING_TEXT.some(pat => inner === pat || inner.startsWith(pat + ':') || inner.startsWith(pat + ' '))
  }

  // ── 1. Gutenberg block markers ──────────────────────────────────────────
  // `<!-- wp:heading -->` (level defaults to 2) or `<!-- wp:heading
  // {"level":2} -->`. Explicit level 3/4 blocks are skipped.
  const reBlock = /<!-- wp:heading(?:\s+(\{[^}]*\}))?\s+-->/g
  let m: RegExpExecArray | null
  while ((m = reBlock.exec(content)) !== null) {
    const attrsJson = m[1]
    if (attrsJson) {
      const levelMatch = attrsJson.match(/"level"\s*:\s*(\d+)/)
      if (levelMatch && parseInt(levelMatch[1], 10) !== 2) continue
    }
    if (isSkipHeading(m.index)) continue
    offsets.add(m.index)
  }

  // ── 2. Raw HTML <h2> tags ───────────────────────────────────────────────
  // The blog writer emits these directly (verified via
  // lib/blog-self-check.ts which strips `<h2 class="…">` patterns).
  // Case-insensitive in case a WP theme round-trips with `<H2>`.
  const reTag = /<h2\b/gi
  while ((m = reTag.exec(content)) !== null) {
    if (isSkipHeading(m.index)) continue
    offsets.add(m.index)
  }

  return [...offsets].sort((a, b) => a - b)
}

/**
 * Find byte offsets where each Gutenberg/raw paragraph starts. Used as
 * a fallback when usable H2 anchors run out — better than dropping
 * images entirely (the WagComb-era bug: H2-only rule silently dropped
 * excess images, the user paid for them, no images appeared in the
 * post).
 *
 * Each offset points at the start of a `<p>` tag (raw HTML) or a
 * `<!-- wp:paragraph -->` block marker. The H2-only path stays the
 * preferred anchor; paragraph offsets only fill the overflow.
 */
export function paragraphOffsets(content: string): number[] {
  const offsets = new Set<number>()
  // Gutenberg paragraph block markers (preferred — sit above the markup).
  const reBlock = /<!-- wp:paragraph\b/g
  let m: RegExpExecArray | null
  while ((m = reBlock.exec(content)) !== null) offsets.add(m.index)
  // Raw <p> tags as a fallback for non-Gutenberg writer output.
  const reTag = /<p\b/gi
  while ((m = reTag.exec(content)) !== null) offsets.add(m.index)
  // Dedupe nearby anchor pairs. A Gutenberg paragraph is normally
  // emitted as `<!-- wp:paragraph -->\n<p>…</p>` — that's TWO matches
  // (block marker + tag), typically <60 bytes apart, both pointing at
  // the SAME paragraph. Without dedupe, a fallback pass could land two
  // images at "different" offsets that are actually the same paragraph.
  // We keep the earlier of each cluster (the block marker if present —
  // inserting BEFORE the marker keeps Gutenberg structure intact).
  // 2026-06-07: this was the SigenStor back-to-back bug.
  const sorted = [...offsets].sort((a, b) => a - b)
  const deduped: number[] = []
  for (const o of sorted) {
    if (deduped.length === 0 || o - deduped[deduped.length - 1] > 80) {
      deduped.push(o)
    }
  }
  return deduped
}

/**
 * Find ALL H2 offsets in `content` with a `skip` flag for each — used
 * to compute excluded ranges (paragraphs INSIDE Quick Verdict / FAQ /
 * Related shouldn't be valid image anchors).
 */
function allH2Anchors(content: string): Array<{ offset: number; skip: boolean }> {
  const isSkipHere = (atOffset: number): boolean => {
    const window = content.slice(atOffset, atOffset + 400)
    const inner = window.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]
      ?.replace(/<[^>]+>/g, '')
      ?.replace(/&amp;/g, '&')
      ?.replace(/&nbsp;/g, ' ')
      ?.replace(/&#8217;/g, "'")
      ?.replace(/&[a-z#0-9]+;/gi, '')
      ?.trim()
      ?.toLowerCase() ?? ''
    if (!inner) return false
    return SKIP_HEADING_TEXT.some(pat => inner === pat || inner.startsWith(pat + ':') || inner.startsWith(pat + ' '))
  }
  const all: Array<{ offset: number; skip: boolean }> = []
  const reBlock = /<!-- wp:heading(?:\s+(\{[^}]*\}))?\s+-->/g
  let m: RegExpExecArray | null
  while ((m = reBlock.exec(content)) !== null) {
    const attrs = m[1]
    if (attrs) {
      const lv = attrs.match(/"level"\s*:\s*(\d+)/)
      if (lv && parseInt(lv[1], 10) !== 2) continue
    }
    all.push({ offset: m.index, skip: isSkipHere(m.index) })
  }
  const reTag = /<h2\b/gi
  while ((m = reTag.exec(content)) !== null) {
    all.push({ offset: m.index, skip: isSkipHere(m.index) })
  }
  return all.sort((a, b) => a.offset - b.offset)
}

/**
 * Pick up to `count` byte offsets — one per image — placing them across
 * the article body. The 2026-06-07 rewrite follows the user's rules:
 *
 *   - Images can land before ANY paragraph (not just H2 boundaries).
 *   - Never at the start of the article (skip the first 10% of the body).
 *   - Never at the end (skip the last 12%).
 *   - Never inside Quick Verdict / Related / FAQ / Disclosure callouts —
 *     paragraphs inside those skip-heading sections are excluded.
 *   - Never back-to-back: every pick is at least 1200 bytes (~one
 *     paragraph) from any other pick.
 *   - Spread evenly across the eligible paragraphs.
 *
 * If the post can't fit `count` images with proper spacing, returns
 * FEWER — quality > density. Logs which picks got dropped so we can
 * see it in Vercel logs.
 */
export function pickBodyImageOffsets(content: string, count: number): number[] {
  if (count <= 0 || content.length === 0) return []

  // ── Body region: exclude intro hero (first 10%) and tail blocks
  //    (last 12%). Belt-and-braces against "image at the very start"
  //    and "image at the very end" — the user's hard rules.
  const bodyStart = Math.floor(content.length * 0.10)
  const bodyEnd = Math.floor(content.length * 0.88)

  // ── Excluded ranges: any H2 flagged as a skip-heading (Quick
  //    Verdict, Related, FAQ, etc.) and everything UNTIL the next H2.
  //    Paragraphs inside these ranges aren't valid anchors — would
  //    drop an image inside a callout box or in the tail blocks.
  const headings = allH2Anchors(content)
  const excludedRanges: Array<[number, number]> = []
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    if (h.skip) {
      const next = headings[i + 1]?.offset ?? content.length
      excludedRanges.push([h.offset, next])
    }
  }
  const isInExcluded = (o: number) => excludedRanges.some(([s, e]) => o >= s && o <= e)

  // ── Eligible paragraph anchors: in body region, not in any
  //    excluded skip-heading range. paragraphOffsets() already dedupes
  //    Gutenberg-marker / `<p>`-tag pairs into single anchors.
  const eligible = paragraphOffsets(content).filter(o =>
    o >= bodyStart && o <= bodyEnd && !isInExcluded(o),
  )

  if (eligible.length === 0) {
    console.warn('[pickBodyImageOffsets] no eligible paragraph anchors', {
      contentLength: content.length,
      requested: count,
      bodyStart, bodyEnd,
      excludedRangeCount: excludedRanges.length,
    })
    return []
  }

  // ── Spread `count` picks evenly across eligible anchors. With one
  //    eligible anchor and count=3 you get 1 pick. With 20 eligible
  //    and count=3 you get 3 picks at fractions 0, 0.5, 1.
  const picks: number[] = []
  const lastIdx = eligible.length - 1
  for (let i = 0; i < count; i++) {
    const frac = count === 1 ? 0.5 : i / (count - 1)
    const idx = Math.round(frac * lastIdx)
    const off = eligible[idx]
    if (!picks.includes(off)) picks.push(off)
  }

  // ── Belt-and-braces final pass: drop any pick within 1200 bytes
  //    (~one paragraph) of an earlier pick. Quality > density —
  //    user can re-roll if they want more images. Logs drops so we
  //    can see in Vercel when posts have too-tight structure.
  const ABSOLUTE_FLOOR = 1200
  const sortedPicks = [...new Set(picks)].sort((a, b) => a - b)
  const finalOffsets: number[] = []
  for (const o of sortedPicks) {
    if (finalOffsets.every(p => Math.abs(p - o) >= ABSOLUTE_FLOOR)) {
      finalOffsets.push(o)
    }
  }
  if (finalOffsets.length < count) {
    console.warn('[pickBodyImageOffsets] returning fewer than requested', {
      contentLength: content.length,
      requested: count,
      eligible: eligible.length,
      picked: sortedPicks,
      kept: finalOffsets,
    })
  }
  return finalOffsets
}

/**
 * Insert blocks (pre-built HTML) at the given byte offsets in `content`.
 * Iterates back-to-front so earlier offsets remain valid as later ones
 * splice in. `offsets[i]` pairs with `blocks[i]`; extra blocks beyond
 * offsets are silently dropped to avoid clustering (the picker's job
 * is to return enough offsets — this function trusts that contract).
 */
export function insertImagesAtOffsets(
  content: string,
  offsets: number[],
  blocks: string[],
): string {
  if (offsets.length === 0) return content
  const pairs = offsets
    .slice(0, blocks.length)
    .map((at, i) => ({ at, block: blocks[i] }))
    .filter(p => p.block != null)
    .sort((a, b) => b.at - a.at)
  let out = content
  for (const p of pairs) out = out.slice(0, p.at) + p.block + out.slice(p.at)
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// Legacy API — kept for backwards compatibility with any callers we
// haven't migrated yet. New code should use pickBodyImageOffsets +
// insertImagesAtOffsets above.
// ─────────────────────────────────────────────────────────────────────────

export interface BodyImagePlacement {
  /** Insert the block immediately before this heading (0-based index into
   *  headingOffsets). Out-of-range indices are clamped / appended. */
  beforeHeadingIndex: number
  block: string
}

/**
 * Legacy splice — kept for any call sites still passing
 * `BodyImagePlacement[]`. New code should use insertImagesAtOffsets.
 */
export function insertImagesAtHeadings(content: string, placements: BodyImagePlacement[]): string {
  const offsets = headingOffsets(content)
  if (offsets.length === 0) return content + placements.map(p => p.block).join('')
  const resolved = placements
    .map(p => {
      const idx = Math.max(0, Math.min(p.beforeHeadingIndex, offsets.length - 1))
      return { at: offsets[idx], block: p.block }
    })
    .sort((a, b) => b.at - a.at)
  let out = content
  for (const r of resolved) {
    out = out.slice(0, r.at) + r.block + out.slice(r.at)
  }
  return out
}

/**
 * Legacy auto-placement index picker — kept for any call sites still
 * using the index-into-headingOffsets API. New code should use
 * pickBodyImageOffsets which returns byte offsets directly.
 */
export function autoPlacementIndices(content: string, count: number): number[] {
  const total = headingOffsets(content).length
  if (total === 0 || count <= 0) return []
  if (total < 3) return [0]
  const first = 1
  const last = total - 2
  const slots = Math.min(count, last - first + 1)
  const out: number[] = []
  for (let i = 0; i < slots; i++) {
    const frac = slots === 1 ? 0.4 : i / (slots - 1)
    out.push(Math.round(first + frac * (last - first)))
  }
  return [...new Set(out)].sort((a, b) => a - b)
}
