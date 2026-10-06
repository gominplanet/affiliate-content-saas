// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE PRODUCT LINK IN A YOUTUBE DESCRIPTION.
//
// A clip cut from the creator's own YouTube video has that video's product
// link sitting in its description: the Amazon, geni.us or mvpl.ink link the
// creator (or MVP) put there. Clip Factory read only the blog post, the
// product typed in Enhance and the video's ASIN, so a video with no blog post
// and no ASIN reached Facebook with "No product link found" although the link
// was on YouTube the whole time.
//
// Picked in this order: a link that lands on Amazon or is a short link
// creators use for products (amzn.to, a.co, geni.us, mvpl.ink); then a link on
// a line that sells ("Get it", "Grab it", "Buy", "Shop", "Check price", 🛒).
// Never the creator's socials, YouTube itself, or a link hub. Pure.

const PRODUCT_HOST = /(^|\.)(amazon\.[a-z.]+|amzn\.to|amzn\.eu|a\.co|geni\.us|mvpl\.ink)$/i
const NEVER = /(^|\.)(youtube\.com|youtu\.be|facebook\.com|fb\.me|instagram\.com|tiktok\.com|twitter\.com|x\.com|threads\.net|linktr\.ee|beacons\.ai|stan\.store|pinterest\.com|patreon\.com)$/i
const SELLING_LINE = /(get it|grab it|buy|shop|check (the )?price|on amazon|🛒|👉|deal|discount|link to (the )?product)/i

function hostOf(u: string): string | null {
  try { return new URL(u).hostname.toLowerCase() } catch { return null }
}

export function productLinkFromDescription(description: string | null | undefined): string | null {
  const text = String(description || '')
  if (!text.trim()) return null
  const lines = text.split(/\r?\n/)
  const found: Array<{ url: string; line: string }> = []
  for (const line of lines) {
    for (const m of line.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []) found.push({ url: m.replace(/[.,!?;:]+$/, ''), line })
  }
  const usable = found.filter((f) => { const h = hostOf(f.url); return !!h && !NEVER.test(h) })
  const product = usable.find((f) => PRODUCT_HOST.test(hostOf(f.url) || ''))
  if (product) return product.url
  const selling = usable.find((f) => SELLING_LINE.test(f.line))
  return selling ? selling.url : null
}
