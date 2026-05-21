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
 * Pick sensible auto-placement slots for N images across a post: spread
 * them between the 2nd heading and the last, skipping the FAQ tail. For
 * the common 2-image case this lands one after the intro and one mid-body.
 */
export function autoPlacementIndices(content: string, count: number): number[] {
  const headings = headingOffsets(content).length
  if (headings <= 1 || count <= 0) return []
  // Usable heading slots: skip heading 0 (the H2 hook opener) and the
  // final heading (usually the FAQ). Leaves the body section breaks.
  const first = 1
  const last = Math.max(first, headings - 2)
  if (last <= first) return [first].slice(0, count)
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const frac = count === 1 ? 0.4 : i / (count - 1)
    out.push(Math.round(first + frac * (last - first)))
  }
  // De-dupe while preserving order.
  return [...new Set(out)]
}
