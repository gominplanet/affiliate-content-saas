// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Pull the most likely product / affiliate link out of a YouTube description.
 * Creators put their Amazon (or Geniuslink / amzn.to / LTK / etc.) link near
 * the top, so we scan URLs and return the first that matches a known affiliate
 * or shop host. Used to prefill the product field when a link is pasted, so the
 * caption composer has a real product to work with.
 */
const AFFILIATE_HOST = /(?:amazon\.[a-z.]+|amzn\.to|amzn\.eu|a\.co\/|geni\.us|geniuslink|shopstyle|rstyle\.me|rstyle|ltk\.|liketk|shareasale|awin1|prf\.hn|go\.magik|magiklink|impact\.com|clkuk|tidd\.ly|shop\.)/i

export function extractProductLink(text: string | null | undefined): string | null {
  if (!text) return null
  const urls = String(text).match(/https?:\/\/[^\s)<>"']+/gi) || []
  const cleaned = urls.map(u => u.replace(/[.,);\]]+$/, ''))
  // Prefer an obvious affiliate/shop host; otherwise return nothing (a random
  // link in the description isn't a product).
  return cleaned.find(u => AFFILIATE_HOST.test(u)) || null
}
