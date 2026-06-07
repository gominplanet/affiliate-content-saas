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
 * Pick up to `count` byte offsets — one per image — placing them across
 * the article body. ALL generated images get a slot (no silent drops):
 *
 *   1. Prefer usable H2 boundaries (reads as "image introduces next
 *      section"). Interior H2s first, then last, then first.
 *   2. If H2 anchors don't cover `count`, fill the gap with paragraph
 *      offsets in the body region, enforcing a minimum byte-spacing
 *      so two images can't land back-to-back.
 *
 * Body region clamps to 5%–90% of the document so paragraph fallback
 * doesn't slide into the intro lead or the Related/FAQ tail.
 *
 * Minimum spacing scales with the document: `docLength / (count * 2 + 1)`
 * gives every image roughly equal room.
 *
 * Returns distinct offsets in document order. Will return fewer than
 * `count` ONLY if the post has too few break points overall — never
 * silently, that case is now logged by callers.
 */
export function pickBodyImageOffsets(content: string, count: number): number[] {
  if (count <= 0 || content.length === 0) return []

  const usable = headingOffsets(content)
  // ── Tier 1: H2 anchors in priority order ───────────────────────────
  const interior = usable.length >= 3 ? usable.slice(1, -1) : []
  const tail = usable.length >= 2 ? [usable[usable.length - 1]] : []
  const head = usable.length >= 1 ? [usable[0]] : []
  const h2Pool: number[] = [...interior]
  if (h2Pool.length < count) for (const t of tail) if (!h2Pool.includes(t)) h2Pool.push(t)
  if (h2Pool.length < count) for (const h of head) if (!h2Pool.includes(h)) h2Pool.push(h)

  // Spread the H2 anchors evenly across what's available (in doc order).
  const sortedH2 = [...h2Pool].sort((a, b) => a - b)
  const h2Slots = Math.min(count, sortedH2.length)
  const picked: number[] = []
  if (h2Slots > 0) {
    const lastIdx = sortedH2.length - 1
    const used = new Set<number>()
    for (let i = 0; i < h2Slots; i++) {
      const frac = h2Slots === 1 ? 0.4 : i / (h2Slots - 1)
      const idx = Math.round(frac * lastIdx)
      const off = sortedH2[idx]
      if (!used.has(off)) {
        used.add(off)
        picked.push(off)
      }
    }
  }

  // ── Tier 2: paragraph fallback for remaining slots ─────────────────
  // Only fires when count > usable H2 anchors. Picks paragraph offsets
  // in the body region (5%–90%) at least minSpacing bytes away from any
  // already-picked offset so images don't end up adjacent.
  const remaining = count - picked.length
  if (remaining > 0) {
    const bodyStart = Math.floor(content.length * 0.05)
    const bodyEnd = Math.floor(content.length * 0.90)
    const paragraphs = paragraphOffsets(content).filter(o => o >= bodyStart && o <= bodyEnd)
    const minSpacing = Math.floor(content.length / Math.max(2, count * 2 + 1))
    const tooClose = (o: number) => picked.some(p => Math.abs(p - o) < minSpacing)
    // Walk paragraphs in document order; greedily pick any that satisfies
    // the spacing constraint until we've filled `remaining` slots.
    // First pass — strict spacing. Second pass — relaxed if needed.
    for (const o of paragraphs) {
      if (picked.length >= count) break
      if (tooClose(o)) continue
      picked.push(o)
    }
    if (picked.length < count) {
      // Second pass — relax the spacing but NEVER allow back-to-back.
      // Defines "back-to-back" as <1200 bytes (≈200 words / one mid-
      // length paragraph). Even when the post has too few break points
      // to fill `count`, we'd rather return fewer images than land
      // two side-by-side. The user can re-roll if they want more
      // density. 2026-06-07: SigenStor back-to-back fix.
      const HARD_FLOOR = 1200
      const relaxed = Math.max(HARD_FLOOR, Math.floor(minSpacing / 2))
      const stillTooClose = (o: number) => picked.some(p => Math.abs(p - o) < relaxed)
      for (const o of paragraphs) {
        if (picked.length >= count) break
        if (picked.includes(o)) continue
        if (stillTooClose(o)) continue
        picked.push(o)
      }
    }
  }

  // ── Belt-and-braces final spacing guard ────────────────────────────
  // No matter how picks got assembled (Tier 1 H2s, Tier 2 first pass,
  // Tier 2 second pass), drop any offset that ends up within
  // ABSOLUTE_FLOOR bytes of an earlier pick. Sized at one full image
  // block (~600 bytes) + one short paragraph (~600 bytes), so two
  // images can NEVER render adjacent in the rendered HTML — even if a
  // Gutenberg block I didn't anticipate (e.g. wp:html / wp:html-comparison
  // / wp:table) has tag attributes that my dedupe regex missed.
  // 2026-06-07: shipped initially as Tier 2-only spacing, but the
  // SigenStor post landed 2 images 307 bytes apart in the rendered
  // HTML despite my earlier fix. Logging will confirm the picker
  // path, but the guarantee here is the final word.
  const ABSOLUTE_FLOOR = 1200
  const sortedPicks = [...new Set(picked)].sort((a, b) => a - b)
  const finalOffsets: number[] = []
  for (const o of sortedPicks) {
    if (finalOffsets.every(p => Math.abs(p - o) >= ABSOLUTE_FLOOR)) {
      finalOffsets.push(o)
    }
  }
  if (finalOffsets.length < sortedPicks.length) {
    // We dropped some picks for being too close. Caller logs whether
    // count was met. Quality > clustering — the user can re-roll.
    console.warn('[pickBodyImageOffsets] dropped picks for adjacency', {
      contentLength: content.length,
      requested: count,
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
