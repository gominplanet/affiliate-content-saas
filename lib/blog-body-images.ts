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

/** Byte offsets where each heading block starts, in document order. */
export function headingOffsets(content: string): number[] {
  const offsets: number[] = []
  const re = /<!-- wp:heading\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) offsets.push(m.index)
  return offsets
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
