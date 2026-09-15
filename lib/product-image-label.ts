// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying,
// redistribution, reverse-engineering, or reuse. See LICENSE.
//
// The words a composer shows when it recalls an image the creator already
// approved for a product. Split out of lib/product-image-memory (which is
// server-only) so the browser composers can render the same sentence the
// server reasons about.
//
// Reuse must never be silent. A composer that quietly swapped in an old image
// would be the same failure this repo has hit before: the screen reporting the
// plan instead of the result. Every surface that reuses says WHICH image, from
// WHERE, and from WHEN, and offers a way out.

export type ProductImageSource = 'generated' | 'upload'

export interface ProductImageRecord {
  asin: string
  imageUrl: string
  source: ProductImageSource
  /** Human label of where it was approved, e.g. 'YouTube Co-Pilot'. */
  surface: string | null
  modelUsed: string | null
  approvedAt: string
}

/**
 * How old an image has to be before reusing it silently is the wrong default.
 * Past this we still offer it, but the label says how old it is — reusing a
 * six-month-old thumbnail should be a decision, not an accident.
 */
export const STALE_AFTER_DAYS = 90

/** Whole days between two instants, floored, never negative. */
export function daysBetween(then: string | Date, now: string | Date = new Date()): number {
  const a = new Date(then).getTime()
  const b = new Date(now).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.max(0, Math.floor((b - a) / 86_400_000))
}

export interface ReuseLabel {
  /** The line shown next to the image. */
  text: string
  /** Set when the image is old enough that reusing it deserves a second look. */
  note: string | null
  stale: boolean
}

/**
 * The line the composers print above a recalled image.
 *
 * NO YEAR, ever — not in the label, not appended to it. Month and day only.
 * Age is carried by `note` in words rather than by printing a year the creator
 * would have to do arithmetic on.
 */
export function reuseLabel(
  rec: Pick<ProductImageRecord, 'source' | 'surface' | 'approvedAt'>,
  now: string | Date = new Date(),
): ReuseLabel {
  const d = new Date(rec.approvedAt)
  const when = Number.isFinite(d.getTime())
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'earlier'
  const noun = rec.source === 'upload' ? 'your own image' : 'your thumbnail'
  const where = rec.surface ? ` from ${rec.surface}` : ''
  const age = daysBetween(rec.approvedAt, now)
  const stale = age >= STALE_AFTER_DAYS
  const months = Math.max(1, Math.round(age / 30))
  return {
    text: `Reusing ${noun}${where} from ${when}`,
    note: stale
      ? `That is about ${months} month${months === 1 ? '' : 's'} old. Make a new one if the product has changed.`
      : null,
    stale,
  }
}

/** An ASIN we are willing to key on. */
export function isAsin(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Z0-9]{10}$/.test(v.trim().toUpperCase())
}
