// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AN AMAZON LIVE FROM YOUR TRYBE SAMPLES (Seb, 2026-11-18: "a button that
// says, let's prepare an Amazon Live with Tribe products that exist on Amazon
// ... I've received samples from Tribe. If they exist on Amazon, let's have
// MVP figure that out and then create a live show based on those products").
//
// Which of the samples you received are sold on Amazon, and under which ASIN.
// The sources, in order: your own Amazon videos, your storefront, the brand's
// Creator Connections products, then a Keepa search by name. MVP tables,
// Keepa and the Creators API only: no Amazon page is ever fetched. A listing
// counts only when it is the brand's (its brand on Keepa, one of its campaign
// ASINs, or a title that starts with the brand) AND its title has every one
// of the product's own words. A sample named only by its brand is never
// matched: that would be the brand, not the product. Pure, so it is tested
// (scripts/test-live-trybe.ts).

import { productWords, titleIsBrand } from '@/lib/trybe-finder'
import { brandKey } from '@/lib/brand-normalize'
import { stageOf } from '@/lib/trybe-week'

export type FoundBy = 'video' | 'storefront' | 'campaign' | 'keepa'

/** Where a match came from, said on the card. */
export const FOUND_WORDS: Record<FoundBy, string> = {
  video: 'In your Amazon videos',
  storefront: 'In your storefront',
  campaign: 'A Creator Connections product of the brand',
  keepa: 'Found on Amazon by its name',
}

/** Days a remembered answer stands before MVP looks again. */
export const RECHECK_DAYS = 30
/** Keepa searches in one press: 10 tokens each, so a long list is spread over presses. */
export const KEEPA_SEARCHES_PER_RUN = 12

export interface Listing { asin: string; title: string | null; brand?: string | null }

export interface SampleRow {
  id: string
  brand_name: string
  product: string
  received_at: string | null
  filmed_at: string | null
  submitted_at: string | null
  amazon_asin?: string | null
  amazon_title?: string | null
  amazon_by?: string | null
  amazon_checked_at?: string | null
}

/** Is this Amazon listing this TRYBE product? Pure. */
export function sameProduct(product: string, brand: string, l: Listing, brandAsins?: Set<string>): boolean {
  const words = productWords(product, brand)
  if (!words.length || !l.title) return false
  const key = brandKey(brand)
  const ours = !!brandAsins?.has(l.asin) || titleIsBrand(l.title, brand) || (!!l.brand && key.length >= 2 && brandKey(l.brand) === key)
  if (!ours) return false
  const t = l.title.toLowerCase()
  return words.every((w) => new RegExp(`\\b${w}`).test(t))
}

/** The first listing that is this product, from the sources in order. Pure. */
export function findListing(product: string, brand: string, sources: Array<{ by: FoundBy; listings: Listing[] }>, brandAsins?: Set<string>): { asin: string; title: string | null; by: FoundBy } | null {
  for (const src of sources) {
    const hit = src.listings.find((l) => sameProduct(product, brand, l, brandAsins))
    if (hit) return { asin: hit.asin, title: hit.title, by: src.by }
  }
  return null
}

/** The samples worth a live: the ones you received (filmed and submitted
 *  ones too), newest first, each product once. Pure. */
export function liveSamples<T extends SampleRow>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows
    .filter((r) => !!r.received_at)
    .sort((a, b) => Date.parse(b.received_at || '') - Date.parse(a.received_at || ''))
    .filter((r) => {
      const k = `${brandKey(r.brand_name)}|${r.product.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
}

/** A remembered answer still good: checked in the last RECHECK_DAYS. Pure. */
export function remembered(r: SampleRow, now = Date.now()): boolean {
  if (!r.amazon_checked_at) return false
  const t = Date.parse(r.amazon_checked_at)
  return Number.isFinite(t) && now - t < RECHECK_DAYS * 86_400_000
}

/** What one sample came to. `found`: on Amazon under `asin`. `none`: every
 *  source answered and none of them is this product. `unchecked`: a source
 *  that would have said did not answer, so nothing is claimed. */
export type ItemState = 'found' | 'none' | 'unchecked'
export interface LiveTrybeItem {
  sampleId: string
  brand: string
  product: string
  stage: ReturnType<typeof stageOf>
  state: ItemState
  asin: string | null
  title: string | null
  image: string | null
  by: FoundBy | null
  why: string
}

/** The show's title and notes for the writer, when the creator left them empty. */
export const LIVE_TRYBE_TITLE = 'Brands sent me these: tested live'
export const LIVE_TRYBE_NOTES = 'These are products brands sent me to try. Say so on the Live, and talk about each one from my own use of it.'

/** The lineup in one line, for the page. Pure. */
export function lineupWords(items: LiveTrybeItem[]): string {
  const found = items.filter((i) => i.state === 'found').length
  const none = items.filter((i) => i.state === 'none').length
  const later = items.filter((i) => i.state === 'unchecked').length
  if (!items.length) return 'No sample is marked as arrived yet. Press It arrived on a sample in TRYBE This week, then come back.'
  const parts = [`${found} of your ${items.length} sample${items.length === 1 ? '' : 's'} ${found === 1 ? 'is' : 'are'} on Amazon`]
  if (none) parts.push(`${none} not found there`)
  if (later) parts.push(`${later} not checked yet (MVP looks again next time)`)
  return `${parts.join(', ')}.`
}
