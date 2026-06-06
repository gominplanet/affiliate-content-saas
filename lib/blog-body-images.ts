/**
 * Helpers for placing images INSIDE the body of a generated blog post.
 *
 * Posts are stored as WordPress Gutenberg block markup. The natural
 * insertion boundary is right before a heading block
 * (`<!-- wp:heading ... -->`), which is where each of the 7 body
 * sections (A–G) + the FAQ begins. Dropping an image just before a
 * heading reads as "photo introducing the next section."
 *
 * Used by:
 *   - /api/blog/generate — auto-places a couple of images on first gen.
 *   - the in-body image editor (manual uploads / YouTube frames / AI).
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
 * Byte offsets where each USABLE heading block starts, in document
 * order. "Usable" means:
 *   - The heading is an H2 (raw `<h2>` or Gutenberg default level)
 *     — H3/H4 are sub-elements inside special blocks (Quick Verdict's
 *     "Skip if you:" / "Buy if you:", spec lists, etc.) and landing
 *     an image next to them looks broken.
 *   - The inner text doesn't match SKIP_HEADING_TEXT — that pattern
 *     keeps images out of Quick Verdict callouts, Related Reviews
 *     tails, and FAQ blocks that read as "the article is over".
 *
 * Matches both formats the codebase can produce:
 *   - Raw HTML: `<h2 class="...">Section title</h2>`   ← writer output
 *   - Gutenberg block: `<!-- wp:heading --> <h2>...`   ← editor / legacy
 *     Skips Gutenberg blocks with `"level":3` (or higher) attribute.
 *
 * The 2026-06-05 user report ("image inside Quick Verdict — big no no,
 * and another after the article") proved that matching all heading
 * levels + matching tail headings is harmful — every special block
 * needs to be a no-fly zone.
 */
export function headingOffsets(content: string): number[] {
  const offsets = new Set<number>()

  // Helper — does this heading's inner text match a skip pattern?
  // Pulls the text inside the next 200 chars after the offset (covers
  // long class attributes + the actual visible text).
  const isSkipHeading = (atOffset: number): boolean => {
    const window = content.slice(atOffset, atOffset + 400)
    // Extract the inner text of the first <h2>...</h2> in the window.
    const inner = window.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]
      // strip nested tags, decode the common entities, normalize whitespace.
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
 * Byte offsets where each Gutenberg/raw paragraph block STARTS, in
 * document order. Used as fallback insertion points when there aren't
 * enough usable H2 headings to spread `count` images without clustering.
 *
 * Matches:
 *   - Raw HTML: `<p>` at the start of an element (not inside an
 *     attribute value)
 *   - Gutenberg block: `<!-- wp:paragraph ...`
 *
 * Used by pickBodyImageOffsets() to break the "all images cluster at
 * the one usable heading" failure mode reported 2026-06-05.
 */
export function paragraphOffsets(content: string): number[] {
  const offsets = new Set<number>()
  // Gutenberg block markers — preferred anchor when present because the
  // image lands above the whole block (markup + content).
  const reBlock = /<!-- wp:paragraph\b/g
  let m: RegExpExecArray | null
  while ((m = reBlock.exec(content)) !== null) offsets.add(m.index)
  // Raw <p> tags — what the writer actually emits.
  const reTag = /<p\b/gi
  while ((m = reTag.exec(content)) !== null) offsets.add(m.index)
  return [...offsets].sort((a, b) => a - b)
}

/**
 * Pick up to `count` byte offsets to insert images at, spread through
 * the body of the post. Headings (filtered H2s) are preferred — they
 * read as "image introducing the next section." When the post doesn't
 * have enough usable headings, paragraph boundaries fill the gap so
 * images don't cluster at a single anchor.
 *
 * Greedy nearest-to-ideal-position picker with a minimum-separation
 * guard:
 *   1. Compute an ideal x byte-position for each image (evenly spaced
 *      through the body, with a 10% head and 15% tail margin so
 *      images don't crowd the intro / conclusion / related-posts).
 *   2. For each ideal position, pick the unused break offset closest
 *      to it that's also at least MIN_SEPARATION bytes from any
 *      already-picked offset.
 *
 * Returns the picked offsets in document order. May return fewer than
 * `count` when the body has very few break points (callers should
 * silently drop the orphan images — better than placing them on top
 * of one another).
 */
export function pickBodyImageOffsets(content: string, count: number): number[] {
  if (count <= 0 || content.length === 0) return []

  const headings = headingOffsets(content)
  const paragraphs = paragraphOffsets(content)
  const allBreaks = [...new Set([...headings, ...paragraphs])].sort((a, b) => a - b)
  if (allBreaks.length === 0) return []

  // Body region — skip first 10% (intro) and last 15% (FAQ / related /
  // about). If filtering leaves too few, expand to use everything.
  const bodyStart = Math.floor(content.length * 0.10)
  const bodyEnd = Math.floor(content.length * 0.85)
  let pool = allBreaks.filter(o => o >= bodyStart && o <= bodyEnd)
  if (pool.length < count) pool = allBreaks

  const minOffset = pool[0]
  const maxOffset = pool[pool.length - 1]
  const span = Math.max(1, maxOffset - minOffset)
  // Minimum byte gap between picks so images aren't visually back-to-back.
  // span / (count * 2) means images get ~half the available room between
  // them — generous enough to feel spread out, tight enough to allow
  // tight posts to still place all images.
  const minSeparation = Math.floor(span / Math.max(2, count * 2))

  const picked: number[] = []
  for (let i = 0; i < count; i++) {
    const idealPos = count === 1
      ? minOffset + Math.floor(span * 0.45)
      : minOffset + Math.floor((i / (count - 1)) * span)
    let best = -1
    let bestDist = Infinity
    for (const o of pool) {
      if (picked.includes(o)) continue
      if (picked.some(p => Math.abs(o - p) < minSeparation)) continue
      const dist = Math.abs(o - idealPos)
      if (dist < bestDist) {
        bestDist = dist
        best = o
      }
    }
    if (best < 0) {
      // No candidate respects min-separation — relax the constraint for
      // this one pick so we don't silently drop an image, but only if
      // there's still an unused offset.
      for (const o of pool) {
        if (picked.includes(o)) continue
        const dist = Math.abs(o - idealPos)
        if (dist < bestDist) { bestDist = dist; best = o }
      }
    }
    if (best >= 0) picked.push(best)
  }
  return picked.sort((a, b) => a - b)
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

export interface BodyImagePlacement {
  /** Insert the block immediately before this heading (0-based index into
   *  headingOffsets). Out-of-range indices are clamped / appended. */
  beforeHeadingIndex: number
  block: string
}

/**
 * Splice image blocks into `content` before the given heading indices.
 * Processes back-to-front so earlier offsets stay valid. Indices past the
 * last heading append at end-of-body (before nothing — i.e. appended).
 */
export function insertImagesAtHeadings(content: string, placements: BodyImagePlacement[]): string {
  const offsets = headingOffsets(content)
  if (offsets.length === 0) return content + placements.map(p => p.block).join('')

  // Sort descending by resolved offset so splicing doesn't shift the
  // offsets we haven't used yet.
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
 * Pick sensible auto-placement slots for N images across a post.
 *
 * Strategy (tries each tier until it has enough distinct slots):
 *   1. Interior headings (1..N-2) — best, reads as "image introduces
 *      the next section". Skips heading 0 (the H2 opener — image right
 *      below the lead reads awkward) and heading N-1 (usually the FAQ
 *      — image inside a Q&A block is weird).
 *   2. Final heading (N-1) — typically the FAQ break; OK as overflow.
 *   3. First heading (0) — only as last resort; long posts only.
 *
 * Returns AT MOST `count` slots, all distinct, in document order.
 * Caller is responsible for handling the "fewer slots than images" case
 * (typically by cycling — see refresh-images / blog/generate).
 *
 * The old version returned `[first]` whenever last <= first, which
 * caused 3 images on a 2-heading post to all stack at heading 1. Fixed
 * 2026-06-05 by promoting heading 0 + the final heading into the pool
 * when interior space is too small.
 */
export function autoPlacementIndices(content: string, count: number): number[] {
  const total = headingOffsets(content).length
  if (total === 0 || count <= 0) return []

  // Tier 1: interior slots.
  const interior: number[] = []
  for (let s = 1; s < total - 1; s++) interior.push(s)

  // Common case — we have at least `count` interior slots. Spread them
  // evenly across the interior range (matches the old behaviour for
  // normal posts).
  if (count <= interior.length && interior.length > 0) {
    const first = interior[0]
    const last = interior[interior.length - 1]
    const seen = new Set<number>()
    const out: number[] = []
    for (let i = 0; i < count; i++) {
      const frac = count === 1 ? 0.4 : i / (count - 1)
      const slot = Math.round(first + frac * (last - first))
      if (!seen.has(slot)) {
        seen.add(slot)
        out.push(slot)
      }
    }
    // Dedupe may have shrunk the list (rare, e.g. 4 images on 3 interior
    // headings). Pad from remaining interior slots so we don't return
    // fewer than count when more are available.
    if (out.length < Math.min(count, interior.length)) {
      for (const s of interior) {
        if (!seen.has(s)) {
          seen.add(s)
          out.push(s)
          if (out.length >= Math.min(count, interior.length)) break
        }
      }
    }
    return out.sort((a, b) => a - b)
  }

  // Tier 2/3 fallback: count > interior, OR no interior slots exist
  // (2-heading post). Build a wider pool — use everything we can.
  const pool: number[] = [...interior]
  // FAQ slot (last heading) — OK as overflow.
  if (total - 1 >= 0 && !pool.includes(total - 1) && total - 1 !== 0) pool.push(total - 1)
  // Intro slot (heading 0) — only on longer posts where it doesn't crowd
  // the opener. For 2-heading posts include it anyway (no other option).
  if (total <= 2 || total >= 4) {
    if (!pool.includes(0)) pool.unshift(0)
  }

  return [...new Set(pool)].sort((a, b) => a - b).slice(0, count)
}
