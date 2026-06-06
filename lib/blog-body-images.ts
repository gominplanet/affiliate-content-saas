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
 * Pick up to `count` byte offsets — one per image — strictly at usable
 * H2 boundaries. Implements the original 2026-05 rule the user asked to
 * restore: spread images evenly between the SECOND and SECOND-TO-LAST
 * usable H2, never at the first (right under the opener) or last (right
 * before the tail blocks). NO paragraph fallback — that's what caused the
 * back-to-back clustering. If the body doesn't have enough section
 * breaks, the picker promotes the first/last usable heading into the
 * pool rather than dropping images on top of one another.
 *
 * Returns the picked offsets in document order, DISTINCT — placing two
 * images at the same heading (the bug the user reported) is always worse
 * than placing one image and dropping the duplicate.
 *
 * Algorithm tiers (try each until enough distinct slots are collected):
 *   1. Interior usable H2s (usable[1..-2]) — best, reads as "image
 *      introduces the next body section".
 *   2. Last usable H2 (usable[-1]) — OK overflow.
 *   3. First usable H2 (usable[0]) — last resort, only when we still
 *      need more slots than interior + last can provide.
 *
 * In practice tier 1 alone handles every normal 5-7 H2 post. Tiers 2/3
 * only kick in when the article is unusually short or when the user
 * asked for more images than the post has room for.
 */
export function pickBodyImageOffsets(content: string, count: number): number[] {
  if (count <= 0 || content.length === 0) return []

  const usable = headingOffsets(content)
  if (usable.length === 0) return []

  // Build the pool in priority order (interior first, then last, then first).
  // Sort interior first so the spread step lands the early image anchors
  // somewhere natural — between the opener and the tail.
  const interior = usable.length >= 3 ? usable.slice(1, -1) : []
  const tail = usable.length >= 2 ? [usable[usable.length - 1]] : []
  const head = [usable[0]]

  // Pool in priority order — pick from the front until we have `count`.
  const pool: number[] = [...interior]
  if (pool.length < count) for (const t of tail) if (!pool.includes(t)) pool.push(t)
  if (pool.length < count) for (const h of head) if (!pool.includes(h)) pool.push(h)

  const slots = Math.min(count, pool.length)
  if (slots === 0) return []

  // Sort by document order before spreading so the even-spread math
  // actually corresponds to physical position in the article.
  const sortedPool = [...pool].sort((a, b) => a - b)

  // Evenly spread `slots` indices across the available offsets. For
  // slots=1 we land at 40% of the pool (matches the original `frac =
  // 0.4` — feels more natural than dead-center).
  const picked = new Set<number>()
  const lastIdx = sortedPool.length - 1
  for (let i = 0; i < slots; i++) {
    const frac = slots === 1 ? 0.4 : i / (slots - 1)
    const idx = Math.round(frac * lastIdx)
    picked.add(sortedPool[idx])
  }

  return [...picked].sort((a, b) => a - b)
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
