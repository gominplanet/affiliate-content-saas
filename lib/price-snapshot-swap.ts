// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying,
// redistribution, reverse-engineering, or reuse. See LICENSE.
//
// SWAPPING THE "DEAL CHECK" BLOCK INSIDE A PUBLISHED POST.
//
// The block (services/keepa buildPriceSnapshotHtml) is the strongest claim on a
// deal post: "This is the lowest price we've tracked", plus a bar with a marker
// pinned at the all-time low. It is also the one part of the post that the
// price refresh never touched.
//
// Why it was missed: the refresh runs ONE Haiku pass over the article and its
// prompt says "Keep ALL HTML tags, attributes, links, images, and shortcodes
// EXACTLY as-is" and "Do not add or remove sections". The model does exactly
// that, correctly, and the deal check survives untouched while every sentence
// around it is corrected. Reported on a live post whose verdict still read
// "lowest price we've tracked" days after the price had moved.
//
// The block WAS rebuilt, but only inside the `if (!looksOk)` fallback, so the
// refresh updated it when the rewrite failed and skipped it when the rewrite
// worked. Exactly backwards.
//
// This module does the swap by walking the tag nesting rather than by regex.
// The previous attempt was:
//
//   /<div class="mvp-price-snapshot"[\s\S]*?<\/div>\s*<\/div>\s*(?:<div[^>]*><\/div>\s*)?<\/div>/i
//
// Measured, rather than assumed: that pattern captured the block EXACTLY when
// the position bar was present, and failed to match AT ALL when it was absent.
// The block has two shapes, because buildPriceSnapshotHtml only draws the bar
// when it has a current price, an all-time low and a typical price; a product
// with a percentage but no all-time low gets a verdict and no bar. On those
// posts the fallback found nothing, left the content identical, and the refresh
// answered 422 "Couldn't safely rewrite the post automatically".
//
// So the pattern described one of the two shapes. A scan describes neither and
// is right for both.

/** The marker that identifies the block. Kept here so the finder and the
 *  builder cannot drift apart about what they are looking for. */
export const PRICE_SNAPSHOT_CLASS = 'mvp-price-snapshot'

/**
 * Locate the whole snapshot block, `<div class="mvp-price-snapshot" …>` through
 * its MATCHING `</div>`, by counting nesting.
 *
 * Returns null when the post has no block, which is a normal state: a post
 * generated when Keepa had no usable history never got one.
 */
export function findPriceSnapshotBlock(html: string): { start: number; end: number } | null {
  const src = String(html ?? '')
  // The opening tag, whatever order its attributes are in.
  const open = src.search(new RegExp(`<div[^>]*class="[^"]*\\b${PRICE_SNAPSHOT_CLASS}\\b[^"]*"[^>]*>`, 'i'))
  if (open < 0) return null

  // Walk from the opening tag, counting <div …> and </div> until the depth
  // returns to zero. Self-closing divs are not valid HTML and the builder emits
  // none, so they are not a case here.
  const tag = /<\s*(\/?)div\b[^>]*>/gi
  tag.lastIndex = open
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = tag.exec(src)) !== null) {
    depth += m[1] === '/' ? -1 : 1
    if (depth === 0) return { start: open, end: m.index + m[0].length }
  }
  // Unbalanced markup: refuse rather than cut the post in half at a guess.
  return null
}

export interface SnapshotSwap {
  html: string
  /** Did the block actually change? False means the caller must not claim it did. */
  replaced: boolean
  /** Why not, when it did not. */
  reason: 'ok' | 'no-block' | 'nothing-to-say' | 'unchanged'
}

/**
 * Replace the snapshot block with a freshly built one.
 *
 * `block` is the output of buildPriceSnapshotHtml for the CURRENT price. An
 * empty string means the price history no longer supports any honest verdict,
 * in which case the old block is REMOVED rather than left standing: a stale
 * "lowest price we've tracked" is worse than no deal check at all.
 */
export function replacePriceSnapshot(html: string, block: string): SnapshotSwap {
  const src = String(html ?? '')
  const found = findPriceSnapshotBlock(src)
  if (!found) return { html: src, replaced: false, reason: 'no-block' }

  const next = src.slice(0, found.start) + block + src.slice(found.end)
  if (next === src) return { html: src, replaced: false, reason: 'unchanged' }
  return { html: next, replaced: true, reason: block ? 'ok' : 'nothing-to-say' }
}
