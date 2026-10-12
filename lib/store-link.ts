// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH STORE THE CREATOR SENDS BUYERS TO (Jarrett, 2026-10-12: "I started
// using Walmart links but on the blog post they still come up as Amazon links
// at the very bottom where it says get the best price on Amazon").
//
// The blog writer took any Amazon product number it could find (in the video
// title, or any Amazon link anywhere in the description) and built the post
// around Amazon, even when the creator's product link was Walmart. The rule
// now: the store the description links FIRST is the store the post sells.
// A Walmart link (walmart.com, Walmart Creator's walmrt.us short links,
// goto.walmart.com) that comes before any Amazon link wins, title ASIN or
// not. Pure, so it is tested (scripts/test-store-link).

import { allProductUrls } from '@/lib/product-link'

export const WALMART_URL = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:walmart\.(?:com|ca)|walmrt\.us|wlmrt\.us)(?:\/|$)/i
/** Amazon, its short links, and Geniuslink (almost always Amazon). */
const AMAZON_URL = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:amazon\.[a-z.]+|amzn\.to|amzn\.eu|a\.co|geni\.us)(?:\/|$)/i

export const isWalmartUrl = (u: string) => WALMART_URL.test(String(u || '').trim())

/** The Walmart link the creator leads with, or null when the description
 *  links Amazon first or has no Walmart link. */
export function leadingWalmartLink(description: string, ownSite?: string | null): string | null {
  const links = allProductUrls(description || '', ownSite ?? null, 50)
  const w = links.findIndex((u) => WALMART_URL.test(u))
  if (w < 0) return null
  const a = links.findIndex((u) => AMAZON_URL.test(u))
  return a < 0 || w < a ? links[w] : null
}
